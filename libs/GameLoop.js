/**
 * @module GameLoop
 * Orchestrates the main game loop: physics, rendering, and all subsystem updates.
 */
import * as THREE from 'three';
import { createLogger } from './Logger.js';
import { updatePlayerMovement, applyJumpGravity, targetPlayerQuaternion, updatePlayerGlow, glowState, updateEyePhysics } from './Player.js';
import { updatePositionHistory, updateTailPositions, getPlayerTail, syncPlayerGlowState } from './Tail.js';
import { updateCameraFollow, updateCameraOrbit, updateAutoFollow, stepOrbitLeft, stepOrbitRight, cycleZoom, cycleAngle } from './CameraSetup.js';
import { syncMuteButton } from './MuteButton.js';
import { updateLightPosition } from './Lighting.js';
import { drawRadar, toggleRadarSize } from './Radar.js';
import { SpeedParticleSystem } from './SpeedParticles.js';
import { moveState, pendingJumps, setInputNetworkMode } from './InputHandler.js';
import { updateSprint, getSprintState } from './SprintSystem.js';
import { drawSprintHUD } from './SprintHUD.js';
import { updateScoreHUD } from './ScoreHUD.js';
import { eventBus } from '@jazaix/jx-sdk';
import { updatePlayerList } from './PlayerList.js';
import { updateLeaderboardStats } from './Leaderboard.js';
import { updatePowerUpHUD } from './PowerUpHUD.js';
import { updateRoundHUD } from './RoundHUD.js';
import { playEffect, playSound, playSpatialEffect, playSpatialSound, setListenerPosition } from './Sound.js';
import { updateClouds } from './Clouds.js';
import { getNetworkInput } from './InputHandler.js';
import { PLAYER_SPEED, PLAYER_RUN_MULTIPLIER, PLAYER_JUMP_FORCE } from './PhysicsConfig.js';
import {
    createRemotePlayer,
    updateRemotePlayer,
    removeRemotePlayer,
    updateRemoteEyes,
    getRemoteRadarData,
    getRemotePlayerListData,
    getRemoteFlipData,
    getRemoteSprintData,
} from './RemotePlayer.js';
import { StormTheme } from './themes/StormTheme.js';
import { drawFriendIndicators } from './FriendFinder.js';

const log = createLogger('GameLoop');

// Pre-allocated reusable objects to avoid GC pressure in hot loops
const _tmpColor = new THREE.Color(0x88bbff);
const _tmpVec3 = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _upVec = new THREE.Vector3(0, 1, 0);
const _playerEuler = new THREE.Euler();
const _fwdVec = new THREE.Vector3();
const _flipRight = new THREE.Vector3();
const _flipQuat = new THREE.Quaternion();
const _initPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();

export class GameLoop {
    /**
     * @param {THREE.Scene} scene
     * @param {RAPIER.World} world
     * @param {RAPIER.EventQueue} eventQueue
     * @param {THREE.WebGLRenderer} renderer
     * @param {THREE.PerspectiveCamera} camera
     * @param {OrbitControls} controls
     */
    constructor(scene, world, eventQueue, renderer, camera, controls) {
        this.scene = scene;
        this.world = world;
        this.eventQueue = eventQueue;
        this.renderer = renderer;
        this.camera = camera;
        this.controls = controls;

        this.playerBody = null;
        this.playerMesh = null;
        this.blockBody = null;
        this.blockMesh = null;
        this.pickupManager = null;
        this.collisionHandler = null;
        this.botManager = null;
        this.deathManager = null;
        this.stats = null;
        this.speedParticles = null;
        this.themeManager = null;
        this.roundManager = null;

        this.lastFrameTime = performance.now();
        this.deltaTime = 0;
        this.cameraLookAtOffset = new THREE.Vector3(0, 1, 0);
        this.playerFrozen = false;

        // Network mode
        this.networkMode = false;
        this.networkManager = null;
        this._remotePlayerMeshes = new Map(); // entityId -> mesh
        this._pickupMeshes = new Map(); // pickupId -> mesh
        this._fadingPickups = []; // { mesh, timer, duration, type }

        // Spectator mode — when set, camera follows spectated player
        this.spectatorTarget = null;

        // Champion crown
        this.championId = null;
        this.crownMesh = null;

        // Flip trail particles
        this.flipParticles = [];

        this.loop = this.loop.bind(this);

        // Listen for lightning strikes to apply size damage
        eventBus.on('lightning:strike', (data) => this.handleLightningStrike(data));

        // Ring electrocution — electric arcs + eye pinch (same as lightning hit)
        eventBus.on('ring:shocked', (data) => {
            const mesh = this._resolveEntityMesh(data.entityId);
            if (mesh) {
                this._spawnElectricArcs(mesh);
            }
            const baseVol = data.entityId === 'player' ? 0.25 : 0.15;
            const sx = mesh ? mesh.position.x : 0;
            const sz = mesh ? mesh.position.z : 0;
            setTimeout(() => playSpatialSound('squeel', baseVol, sx, sz), 400);
        });

        // Listen for ring stun freeze/unfreeze
        eventBus.on('player:freeze', (frozen) => {
            this.playerFrozen = frozen;
            if (frozen && this.playerBody) {
                this.playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
            }
        });
    }

    /**
     * Configures all gameplay components before starting the loop.
     */
    setup(playerMesh, playerBody, blockMesh, blockBody, pickupManager, collisionHandler, stats, botManager, deathManager) {
        this.playerMesh = playerMesh;
        this.playerBody = playerBody;
        this.blockMesh = blockMesh;
        this.blockBody = blockBody;
        this.pickupManager = pickupManager;
        this.collisionHandler = collisionHandler;
        this.stats = stats;
        this.botManager = botManager || null;
        this.deathManager = deathManager || null;

        this.speedParticles = new SpeedParticleSystem(this.scene, this.playerMesh);
    }

    setThemeManager(themeManager) {
        this.themeManager = themeManager;
    }

    setRoundManager(roundManager) {
        this.roundManager = roundManager;
    }

    /**
     * Enable network mode with a NetworkManager instance.
     * In network mode: no local physics, positions from server snapshots.
     */
    setNetworkMode(networkManager) {
        this.networkMode = true;
        this.networkManager = networkManager;

        // Enable network mode in InputHandler (queues jumps instead of Rapier impulses)
        setInputNetworkMode(true);

        // Set local player color to match what remote players see
        // (uses same deterministic formula as RemotePlayer.js)
        if (networkManager.localPlayerId && this.playerMesh) {
            const hue = (networkManager.localPlayerId * 137.508) % 360 / 360;
            const playerColor = new THREE.Color().setHSL(hue, 0.7, 0.55);
            if (this.playerMesh.material) {
                this.playerMesh.material.color.copy(playerColor);
                this.playerMesh.material.emissive.copy(playerColor).multiplyScalar(0.15);
            }
            this.playerMesh.userData.glowColor = playerColor;

            // Update glow mesh + point light color to match
            for (const child of this.playerMesh.children) {
                if (child.isMesh && child.material && child.material.blending === THREE.AdditiveBlending) {
                    child.material.color.copy(playerColor);
                }
                if (child.isLight) {
                    child.color.copy(playerColor);
                }
            }
            // Update shared glow state color
            glowState.color = playerColor;

            // Update tail color to match
            const playerTail = getPlayerTail();
            if (playerTail) {
                playerTail.setColor(playerColor);
                // Slightly wider than single-player (5) because network mode
                // has no physics jitter to keep history entries distinct.
                playerTail.segmentSpacing = 8;
            }
        }

        // Client-side prediction state
        this._predicted = { x: 0, y: 0.5, z: 0, vx: 0, vy: 0, vz: 0 };
        this._predictedInited = false;
        // Base yaw quaternion for flip animation composition
        this._baseYawQuat = new THREE.Quaternion();
        // Snapshot-based correction: only correct when new data arrives
        this._lastProcessedTick = 0;
        this._correctionRemaining = 0;  // frames left to spread correction over
        this._correctionDx = 0;
        this._correctionDy = 0;
        this._correctionDz = 0;

        // Listen for remote entity join/leave
        eventBus.on('entity:joined', (data) => {
            if (data.remote && !this._remotePlayerMeshes.has(data.entityId)) {
                const { mesh } = createRemotePlayer(this.scene, data.entityId, data.name);
                this._remotePlayerMeshes.set(data.entityId, mesh);
            }
        });

        eventBus.on('entity:left', (data) => {
            if (this._remotePlayerMeshes.has(data.entityId)) {
                removeRemotePlayer(this.scene, data.entityId);
                this._remotePlayerMeshes.delete(data.entityId);
            }
        });

        // Reset local player tail on respawn (server clears tail_length + history)
        eventBus.on('player:respawned', (data) => {
            if (data.playerId === networkManager.localPlayerId) {
                const tail = getPlayerTail();
                if (tail) tail.reset();
            }
        });
    }

    start() {
        this.lastFrameTime = performance.now();
        requestAnimationFrame(this.loop);
    }

    loop() {
        try {
            const currentTime = performance.now();
            this.deltaTime = (currentTime - this.lastFrameTime) / 1000;
            this.lastFrameTime = currentTime;

            if (this.deltaTime > 0.1) this.deltaTime = 0.1;
            if (this.deltaTime <= 0) this.deltaTime = 0.016;

            // Process input triggers
            if (moveState.zoomTrigger) {
                moveState.zoomTrigger = false;
                cycleZoom();
            }
            if (moveState.angleTrigger) {
                moveState.angleTrigger = false;
                cycleAngle();
            }
            if (moveState.muteSynced) {
                moveState.muteSynced = false;
                syncMuteButton();
            }
            if (moveState.cameraLeftTrigger) {
                moveState.cameraLeftTrigger = false;
                stepOrbitLeft();
            }
            if (moveState.cameraRightTrigger) {
                moveState.cameraRightTrigger = false;
                stepOrbitRight();
            }
            if (moveState.mapToggleTrigger) {
                moveState.mapToggleTrigger = false;
                toggleRadarSize();
            }
            if (moveState.friendOutlineTrigger) {
                moveState.friendOutlineTrigger = false;
                this._friendOutlineActive = !this._friendOutlineActive;
            }

            // Network mode: send input, receive state from server
            if (this.networkMode) {
                this._networkLoop();
            } else {
                this._localLoop();
            }

            if (this.stats && window.statsEnabled) {
                this.stats.end();
            }

        } catch (err) {
            log.error('Game loop error', err);
        }

        requestAnimationFrame(this.loop);
    }

    /**
     * The original single-player loop logic (unchanged).
     */
    _localLoop() {
        // Update sprint (tail-burning mechanic) — skip if frozen
        const playerTail = getPlayerTail();
        if (!this.playerFrozen) {
            updateSprint(this.deltaTime, playerTail);
        }

        if (this.stats && window.statsEnabled) {
            this.stats.begin();
        }

        // Pickup system: pre-physics, process collisions from last frame, spawn
        this.pickupManager.prePhysicsUpdate();
        this.pickupManager.processCollisions();
        this.pickupManager.spawn();

        // Step physics world
        this.world.step(this.eventQueue);

        // Process collisions
        this.collisionHandler.processCollisions(this.eventQueue, this.playerMesh);

        // Update player movement and jump physics — skip if frozen
        if (!this.playerFrozen) {
            updatePlayerMovement(this.playerBody, this.camera);
            applyJumpGravity(this.playerBody);
        } else {
            // Stop the player while death screen is up
            this.playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }

        const playerVel = this.playerBody ? this.playerBody.linvel() : { x: 0, y: 0, z: 0 };

        // Update visual positions
        this.updateVisualPositions();

        // Update listener position for spatial audio
        if (this.playerMesh) {
            setListenerPosition(this.playerMesh.position.x, this.playerMesh.position.z);
        }

        // Check head-to-tail overlaps (backup for sensor collisions)
        this.checkHeadTailOverlaps();

        // Check ring overlaps (backup for sensor events on kinematic ring bodies)
        this.checkRingOverlaps();

        // Check head-to-head collisions (bigger eats smaller)
        this.checkHeadHeadOverlaps();

        // Check if player/bots fell off the edge
        this.checkBoundaryDeath();

        // Rotate crown gently
        if (this.crownMesh) {
            this.crownMesh.rotation.y += this.deltaTime * 1.5;
        }

        // Update player glow effect
        updatePlayerGlow(this.playerMesh);

        // Sync glow state to tail (replaces the old import-from-Player pattern)
        syncPlayerGlowState(glowState);

        // Update speed particles
        if (this.speedParticles) {
            try {
                this.speedParticles.update(playerVel, this.deltaTime);
            } catch (err) {
                log.error('Particle update failed', err);
            }
        }

        // Update tail
        updatePositionHistory(this.playerMesh.position);
        updateTailPositions(true);

        // Update all pickups (animation, deferred, auto-despawn)
        this.pickupManager.update(this.deltaTime);

        // Googly-eye physics (player + bots)
        const playerSpeed = Math.sqrt(playerVel.x * playerVel.x + playerVel.z * playerVel.z);
        updateEyePhysics(this.playerMesh, this.deltaTime, playerSpeed, 10, playerVel.y);
        if (this.botManager) {
            for (const bot of this.botManager.bots) {
                const bv = bot.body.linvel();
                const botSpeed = Math.sqrt(bv.x * bv.x + bv.z * bv.z);
                updateEyePhysics(bot.mesh, this.deltaTime, botSpeed, 10, bv.y);
            }
        }

        // Update bot manager
        if (this.botManager) {
            this.botManager.update(this.deltaTime, this.playerMesh.position, this.pickupManager);
        }

        // Update death manager (invulnerability timers, blinking)
        if (this.deathManager) {
            this.deathManager.update(this.deltaTime);
        }

        // Update theme/weather system
        if (this.themeManager) {
            this.themeManager.update(this.deltaTime, this.playerMesh?.position);
        }

        // Drift clouds
        updateClouds(this.deltaTime);

        // Move directional light to follow player
        updateLightPosition(this.playerMesh.position);

        // Auto-follow camera bias (only while sprinting in one direction 2s+)
        updateAutoFollow(this.deltaTime, playerVel, moveState.run > 0);

        // Update camera orbit (smooth interpolation toward target)
        updateCameraOrbit(this.deltaTime);

        // Update camera
        updateCameraFollow(this.camera, this.controls, this.playerMesh, this.cameraLookAtOffset, this.deltaTime);

        // Update radar display
        this.updateRadar();

        // Update HUDs
        drawSprintHUD(getSprintState(playerTail, this.playerMesh.scale.x));
        updateScoreHUD(this.pickupManager.getHandler('coin').coinsCollected);
        this.updatePlayerListHUD(playerTail);
        updateLeaderboardStats();

        // Update power-up HUD
        const ringHandler = this.pickupManager.getHandler('ring');
        if (ringHandler) {
            updatePowerUpHUD(ringHandler.getActivePower('player'));
        }

        // Update round manager and HUD
        if (this.roundManager) {
            this.roundManager.update(this.deltaTime);
            updateRoundHUD(this.roundManager.getRemainingTime());
        }

        // Emit player move event
        _playerEuler.setFromQuaternion(this.playerMesh.quaternion, 'YXZ');
        eventBus.emit('entity:move', {
            id: 'player',
            x: this.playerMesh.position.x,
            z: this.playerMesh.position.z,
            angle: _playerEuler.y,
            sprinting: moveState.run > 0
        });

        // Render
        this.renderer.render(this.scene, this.camera);

        if (this.stats && window.statsEnabled) {
            this.stats.end();
        }
    }

    /**
     * Network mode loop: server-authoritative, client renders from snapshots.
     */
    _networkLoop() {
        if (this.stats && window.statsEnabled) {
            this.stats.begin();
        }

        const nm = this.networkManager;
        const extra = nm.latestExtra;

        // 1. Send input to server every frame
        if (!this.playerFrozen && !this._localWasDead) {
            const input = getNetworkInput(this.camera);
            nm.sendInput(input.dx, input.dz, input.flags, input.angle);
        }

        // 2. Client-side prediction for local player
        //    Matches single-player physics: updatePlayerMovement + applyJumpGravity
        const localState = nm.getLocalPlayerState();
        if (localState && this.playerMesh) {
            // Check alive flag (bit 0) from server
            const localAlive = (localState.flags & 0x01) !== 0;
            if (!localAlive) {
                this.playerMesh.visible = false;
                this._localWasDead = true;
                // Stop all prediction — player is dead, don't move
                this._predicted.vx = 0;
                this._predicted.vy = 0;
                this._predicted.vz = 0;
            } else {
                // Respawn: snap prediction to new position
                if (this._localWasDead) {
                    this._predictedInited = false;
                    this._localWasDead = false;
                }
                this.playerMesh.visible = true;
            }

            const dt = this.deltaTime;
            const p = this._predicted;

            // Skip all prediction and movement when dead
            if (!localAlive) {
                // Just snap mesh to server position (so death location is correct)
                const so = (localState.scale - 1) * 0.5;
                this.playerMesh.position.set(localState.x, localState.y + so, localState.z);
            }

            // Initialize prediction from first server snapshot
            if (localAlive && !this._predictedInited) {
                p.x = localState.x;
                p.y = localState.y;
                p.z = localState.z;
                p.vx = 0;
                p.vy = 0;
                p.vz = 0;
                this._predictedInited = true;
            }

            // All prediction/movement only when alive
            if (localAlive) {

            // Process pending jumps from InputHandler
            while (pendingJumps.length > 0) {
                const jump = pendingJumps.shift();
                if (jump.type === 'ground') {
                    p.vy = PLAYER_JUMP_FORCE * jump.sizeBonus;
                } else if (jump.type === 'airDash') {
                    // Upward boost (same as single-player: JUMP_FORCE * 0.3)
                    p.vy += PLAYER_JUMP_FORCE * 0.3;
                    // Forward burst in facing direction (same as single-player: forward * 8)
                    _fwdVec.set(0, 0, 1).applyQuaternion(this.playerMesh.quaternion);
                    p.vx += _fwdVec.x * 8;
                    p.vz += _fwdVec.z * 8;
                }
            }

            // During flip: freeze horizontal input — let dash impulse carry
            // (matches single-player: updatePlayerMovement returns early during flip)
            if (!moveState.flipping) {
                const input = getNetworkInput(this.camera);
                const sprint = (input.flags & 0x01) !== 0;
                const speed = PLAYER_SPEED * (sprint ? PLAYER_RUN_MULTIPLIER : 1.0)
                    * moveState.powerSpeedMultiplier;

                const mag = Math.sqrt(input.dx * input.dx + input.dz * input.dz);
                if (mag > 0.01) {
                    p.vx = (input.dx / mag) * speed;
                    p.vz = (input.dz / mag) * speed;
                } else {
                    p.vx = 0;
                    p.vz = 0;
                }
            }
            // else: vx/vz preserved from dash impulse (momentum carries)

            // Apply gravity (base: 9.81)
            p.vy -= 9.81 * dt;

            // Enhanced gravity multipliers (matches single-player applyJumpGravity)
            const airborne = p.y > 1.5;
            if (p.vy < -0.5) {
                // Falling — pull-down for snappy landing (FALL_GRAVITY_MULTIPLIER = 3.0)
                p.vy -= 9.81 * (3.0 - 1) * dt;
            } else if (airborne && Math.abs(p.vy) <= 0.8 && Math.abs(p.vy) > 0.01) {
                // Apex — brief hang-time (counteract 70% of gravity)
                p.vy += 9.81 * 0.3 * dt;
            } else if (p.vy > 0.1 && !moveState.jump) {
                // Rising but jump released — cut short (LOW_JUMP_MULTIPLIER = 2.0)
                p.vy -= 9.81 * (2.0 - 1) * dt;
            }

            // Integrate position
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;

            // Clamp: ground at y=0.5, boundary at [-120, 120]
            if (p.y < 0.5) {
                p.y = 0.5;
                p.vy = 0;
                moveState.doubleJumped = false;
                // End flip on landing (matches server: flip_timer = 0 on ground clamp)
                if (moveState.flipping) {
                    moveState.flipping = false;
                    moveState.flipProgress = 0;
                }
            }
            p.x = Math.max(-120, Math.min(120, p.x));
            p.z = Math.max(-120, Math.min(120, p.z));

            // Server reconciliation: only correct when a NEW snapshot arrives.
            // Between snapshots, trust the prediction fully (physics match server).
            const currentTick = nm.latestTick;
            if (currentTick !== this._lastProcessedTick) {
                this._lastProcessedTick = currentTick;

                // Measure error between prediction and server
                const errX = localState.x - p.x;
                const errY = localState.y - p.y;
                const errZ = localState.z - p.z;
                const errDist = Math.sqrt(errX * errX + errY * errY + errZ * errZ);

                if (errDist > 5.0) {
                    // Large error: snap immediately (respawn/teleport)
                    p.x = localState.x;
                    p.y = localState.y;
                    p.z = localState.z;
                    p.vy = 0;
                    this._correctionRemaining = 0;
                } else if (errDist > 0.05) {
                    // Spread correction over ~6 frames (~100ms) for smoothness
                    const frames = 6;
                    this._correctionDx = errX / frames;
                    this._correctionDy = errY / frames;
                    this._correctionDz = errZ / frames;
                    this._correctionRemaining = frames;
                }
            }

            // Apply queued correction (spreads over a few frames, then stops)
            if (this._correctionRemaining > 0) {
                p.x += this._correctionDx;
                p.y += this._correctionDy;
                p.z += this._correctionDz;
                this._correctionRemaining--;
            }

            // Apply predicted position to mesh
            // Skip position override during puddle drowning animation
            const scaleOffset = (localState.scale - 1) * 0.5;
            if (!this.playerMesh.userData._puddleDrowning) {
                this.playerMesh.position.x = p.x;
                this.playerMesh.position.y = p.y + scaleOffset;
                this.playerMesh.position.z = p.z;
            }

            // Scale from server
            const s = localState.scale || 1;
            _tmpVec3.set(s, s, s);
            this.playerMesh.scale.lerp(_tmpVec3, 0.1);

            // Rotation from server angle — save base yaw for flip animation
            const targetQuat = _tmpQuat.setFromAxisAngle(_upVec, localState.angle);
            this._baseYawQuat.copy(targetQuat);
            this.playerMesh.quaternion.slerp(targetQuat, 0.15);

            // Update targetPlayerQuaternion so _spawnFlipParticle uses correct orientation
            targetPlayerQuaternion.copy(targetQuat);

            } // end if (localAlive) — prediction block

            // Invulnerability blinking (skip if dead — visibility already set above)
            if (localAlive) {
                const invuln = (localState.flags & 0x02) !== 0;
                if (invuln) {
                    this.playerMesh.visible = Math.floor(performance.now() / 100) % 2 === 0;
                } else {
                    this.playerMesh.visible = true;
                }
            }
        }

        // 3. Update all remote player positions
        for (const entityId of nm.getRemoteEntityIds()) {
            const state = nm.getInterpolatedState(entityId);
            if (state) {
                const scoreInfo = extra.scores.find(s => s.playerId === entityId);
                // Create remote player mesh if we haven't yet
                if (!this._remotePlayerMeshes.has(entityId)) {
                    const name = scoreInfo ? scoreInfo.displayName : `Player ${entityId}`;
                    const { mesh } = createRemotePlayer(this.scene, entityId, name);
                    this._remotePlayerMeshes.set(entityId, mesh);
                }
                // Update bot flag every frame (so friend finder can filter)
                const rmesh = this._remotePlayerMeshes.get(entityId);
                if (rmesh) rmesh.userData.isBot = (state.flags & 0x08) !== 0;
                const remoteTailLen = scoreInfo ? scoreInfo.tailLength : 0;
                updateRemotePlayer(entityId, state, this.deltaTime, remoteTailLen);
            }
        }

        // Remove stale remote players
        for (const [entityId] of this._remotePlayerMeshes) {
            if (!nm.remoteEntities.has(entityId) || entityId === nm.localPlayerId) {
                removeRemotePlayer(this.scene, entityId);
                this._remotePlayerMeshes.delete(entityId);
            }
        }

        // Friend finder: screen-space indicators when F is toggled
        drawFriendIndicators(this.camera, this._remotePlayerMeshes, this._friendOutlineActive);

        // 4. Update pickups from reliable stream events (with client-side gravity)
        this._lastDt = this.deltaTime;
        this._updateNetworkPickups();

        // 4b. Update weather VFX from server
        this._updateNetworkWeather();

        // 4c. Lightning VFX from server — use StormTheme's full visual chain
        //      Only fire on the first frame we see this snapshot's strikes (deduplicate)
        if (extra.lightning && extra.lightning.length > 0 && nm.latestTick !== this._lastLightningTick) {
            this._lastLightningTick = nm.latestTick;
            for (const strike of extra.lightning) {
                if (this._networkStormActive && StormTheme._isActive) {
                    StormTheme.strikeLightningAt(this.scene, strike.x, strike.z);
                } else {
                    this._spawnBolt(strike.x, strike.z);
                }
            }
        }

        // 4d. Spectator mode: update entity list each frame
        if (this.spectatorTarget && this.spectatorTarget.active) {
            this.spectatorTarget.update(this._remotePlayerMeshes);
        }

        // 5. Update listener position for spatial audio
        // Follow spectated player when spectating
        const followMesh = (this.spectatorTarget && this.spectatorTarget.active)
            ? this.spectatorTarget.getTargetMesh() || this.playerMesh
            : this.playerMesh;
        if (followMesh) {
            setListenerPosition(followMesh.position.x, followMesh.position.z);
        }

        // 6. Visual effects that still run in network mode
        // Set moveState.run for glow + particle effects (sprint in network mode)
        if (localState) {
            const serverSprinting = (localState.flags & 0x04) !== 0;
            moveState.run = (moveState.sprintHeld || serverSprinting) ? 1 : 0;
        }
        updatePlayerGlow(this.playerMesh);
        syncPlayerGlowState(glowState);

        // Update tail — clamp Y to ground minimum (matches RemotePlayer approach)
        // so the tail doesn't float permanently, but still follows jump arcs naturally.
        // Use minDistance to prevent history pollution when standing still.
        const localTail = getPlayerTail();
        if (localTail) {
            const scOff = localState ? (localState.scale - 1) * 0.5 : 0;
            const groundY = 0.5 + scOff;
            const tailY = Math.max(this.playerMesh.position.y, groundY);
            _tmpVec3.set(this.playerMesh.position.x, tailY, this.playerMesh.position.z);
            localTail.updatePositionHistory(_tmpVec3, 0.05);
        }

        // Sync local player tail segment count from server BEFORE positioning.
        // Rate-limit adds/removes to avoid visual oscillation when the server
        // value fluctuates frame-to-frame (sprint burn, pickups, ring hits).
        const MAX_TAIL_CHANGE_PER_FRAME = 1;
        const localScore = extra.scores.find(s => s.playerId === nm.localPlayerId);
        const playerTail = getPlayerTail();
        if (localScore && playerTail) {
            const serverTailLen = localScore.tailLength;
            const currentTailLen = playerTail.getLength();
            const diff = serverTailLen - currentTailLen;
            if (diff > 0) {
                const toAdd = Math.min(diff, MAX_TAIL_CHANGE_PER_FRAME);
                for (let i = 0; i < toAdd; i++) {
                    const segIdx = currentTailLen + i;
                    const histIdx = segIdx * playerTail.segmentSpacing;
                    const histPos = playerTail.getHistoryPosition(histIdx);
                    if (histPos) {
                        _initPos.set(histPos.x, histPos.y, histPos.z);
                    } else if (playerTail.segments.length > 0) {
                        // Place at last segment so it appears at the tail end
                        // instead of popping in at the player's head
                        _initPos.copy(playerTail.segments[playerTail.segments.length - 1].mesh.position);
                    } else {
                        _initPos.copy(this.playerMesh.position);
                    }
                    playerTail.addSegment(_initPos.clone());
                }
            } else if (diff < 0) {
                const toRemove = Math.min(-diff, MAX_TAIL_CHANGE_PER_FRAME);
                playerTail.removeLastSegments(toRemove);
            }
        }

        // Position all segments (including newly added ones)
        updateTailPositions(true);

        // Flip animation (local player double-jump) — matches single-player exactly
        if (moveState.flipping && this.playerMesh) {
            moveState.flipProgress += this.deltaTime * 3.0; // ~0.33s for full flip
            if (moveState.flipProgress >= 1) {
                moveState.flipping = false;
                moveState.flipProgress = 0;
                if (playerTail) {
                    for (const seg of playerTail.segments) seg.mesh.rotation.x = 0;
                }
            } else {
                // Roll around the player's local right axis, composed with base yaw
                const baseQuat = this._baseYawQuat || targetPlayerQuaternion;
                const flipAngle = moveState.flipProgress * Math.PI * 2;
                _flipRight.set(1, 0, 0).applyQuaternion(baseQuat);
                _flipQuat.setFromAxisAngle(_flipRight, flipAngle);
                this.playerMesh.quaternion.copy(_flipQuat).multiply(baseQuat);

                // Spin tail segments with staggered delay
                if (playerTail) {
                    for (let i = 0; i < playerTail.segments.length; i++) {
                        const delay = Math.min(1, moveState.flipProgress - i * 0.04);
                        if (delay > 0) {
                            const segAngle = delay * Math.PI * 2;
                            playerTail.segments[i].mesh.rotation.x = segAngle;
                        }
                    }
                }

                // Spiral particle trail
                this._spawnFlipParticle();
            }
        }
        this._updateFlipParticles();

        // Speed particles (local player sprint + remote sprinters)
        const playerVel = localState ? { x: localState.vx, y: localState.vy, z: localState.vz } : { x: 0, y: 0, z: 0 };
        if (this.speedParticles) {
            this.speedParticles.update(playerVel, this.deltaTime);

            // Spawn sprint particles for remote players
            for (const rs of getRemoteSprintData()) {
                if (Math.abs(rs.vx) > 0.1 || Math.abs(rs.vz) > 0.1) {
                    this.speedParticles.spawnAt(rs.mesh.position, { x: rs.vx, z: rs.vz });
                }
            }
        }

        // Googly eyes (use actual velocity from server)
        const playerSpeed = Math.sqrt(playerVel.x * playerVel.x + playerVel.z * playerVel.z);
        updateEyePhysics(this.playerMesh, this.deltaTime, playerSpeed, 10, playerVel.y);
        updateRemoteEyes(this.deltaTime);

        // Spawn flip particles for flipping remote players
        for (const rf of getRemoteFlipData()) {
            this._spawnRemoteFlipParticle(rf.mesh, rf.flipProgress, rf.baseYawQuat, rf.color);
        }

        // Drift clouds
        updateClouds(this.deltaTime);

        // Lighting + camera: follow spectated player when spectating
        const camTarget = (this.spectatorTarget && this.spectatorTarget.active)
            ? this.spectatorTarget.getTargetMesh() || this.playerMesh
            : this.playerMesh;
        updateLightPosition(camTarget.position);
        updateAutoFollow(this.deltaTime, playerVel, moveState.run > 0);
        updateCameraOrbit(this.deltaTime);
        updateCameraFollow(this.camera, this.controls, camTarget, this.cameraLookAtOffset, this.deltaTime);

        // Radar (with remote players)
        this._updateNetworkRadar();

        // HUDs from server data
        if (localScore) {
            updateScoreHUD(localScore.score);
        }

        // Power-up HUD from server entity flags
        if (localState) {
            const puType = (localState.flags >> 4) & 0x07;
            if (puType > 0) {
                const puNames = ['', 'SHIELD', 'GHOST', 'GROWTH_SURGE', 'SPEED'];
                updatePowerUpHUD({ type: puNames[puType] || '', remaining: 10 });
            } else {
                updatePowerUpHUD(null);
            }
        }

        // Round timer from server
        if (extra.roundRemaining > 0) {
            updateRoundHUD(extra.roundRemaining);
        }

        // Sprint HUD (uses local input state + server-synced tail length)
        drawSprintHUD(getSprintState(playerTail, this.playerMesh ? this.playerMesh.scale.x : 1));

        // Player list from server scores
        this._updateNetworkPlayerList();

        // Crown
        if (this.crownMesh) {
            this.crownMesh.rotation.y += this.deltaTime * 1.5;
        }

        // Render
        this.renderer.render(this.scene, this.camera);

        if (this.stats && window.statsEnabled) {
            this.stats.end();
        }
    }

    /**
     * Update pickup meshes from server snapshot data.
     * Supports coin (0), fruit (1), water drop (2), and ring (3) types.
     */
    _updateNetworkPickups() {
        if (!this.networkManager) return;
        const pickupMap = this.networkManager.pickupMap;
        const dt = this._lastDt || 0.016;

        // Client-side gravity for non-grounded, non-ring pickups
        for (const p of pickupMap.values()) {
            if (p.grounded || p.type === 3) continue;
            p.vy -= 9.81 * dt;
            p.y += p.vy * dt;
            if (p.y <= 0.5) {
                p.y = 0.5;
                p.vy = 0;
                p.grounded = true;
            }
        }

        // Client-side collection detection: check if player is near any grounded pickup
        // and send collection request to server (client-initiated, server-validated)
        if (this.playerMesh && this.networkManager.connected) {
            const px = this.playerMesh.position.x;
            const pz = this.playerMesh.position.z;
            const COLLECT_DIST_SQ = 2.25; // 1.5 units squared (matches server)

            for (const p of pickupMap.values()) {
                if (p.type === 3) continue; // rings have special logic
                if (!p.grounded && p.y > 1.5) continue; // skip airborne pickups
                const dx = px - p.x;
                const dz = pz - p.z;
                if (dx * dx + dz * dz < COLLECT_DIST_SQ) {
                    // Tell the server we're touching this pickup
                    this.networkManager.sendCollectRequest(p.id);
                }
            }
        }

        // Add new pickups / update existing mesh positions
        for (const p of pickupMap.values()) {
            if (!this._pickupMeshes.has(p.id)) {
                let mesh;
                switch (p.type) {
                    case 1: { // Fruit — orange sphere, radius 0.5
                        const geo = new THREE.SphereGeometry(0.5, 10, 8);
                        const mat = new THREE.MeshStandardMaterial({
                            color: 0xff8800, emissive: 0xff6600, emissiveIntensity: 0.3,
                            roughness: 0.3, metalness: 0.4,
                        });
                        mesh = new THREE.Mesh(geo, mat);
                        break;
                    }
                    case 2: { // Water drop — blue sphere, radius 0.4
                        const geo = new THREE.SphereGeometry(0.4, 10, 8);
                        const mat = new THREE.MeshStandardMaterial({
                            color: 0x4488ff, emissive: 0x2266cc, emissiveIntensity: 0.4,
                            roughness: 0.2, metalness: 0.6, transparent: true, opacity: 0.85,
                        });
                        mesh = new THREE.Mesh(geo, mat);
                        break;
                    }
                    case 3: { // Ring — group with torus + glow (matching single-player RingPickup)
                        const ringGroup = new THREE.Group();
                        const geo = new THREE.TorusGeometry(4.0, 0.3, 16, 32);
                        const mat = new THREE.MeshStandardMaterial({
                            color: 0xff4444, emissive: 0xff4444, emissiveIntensity: 0.4,
                            roughness: 0.3, metalness: 0.7, transparent: true, opacity: 1.0,
                        });
                        mat.userData = { origOpacity: 1.0 };
                        const torus = new THREE.Mesh(geo, mat);
                        torus.castShadow = true;
                        ringGroup.add(torus);
                        // Glow torus
                        const glowGeo = new THREE.TorusGeometry(4.0, 0.6, 16, 32);
                        const glowMat = new THREE.MeshBasicMaterial({
                            color: 0xff4444, transparent: true, opacity: 0.15,
                            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
                        });
                        glowMat.userData = { origOpacity: 0.15 };
                        ringGroup.add(new THREE.Mesh(glowGeo, glowMat));
                        mesh = ringGroup;
                        break;
                    }
                    default: { // Coin (0) — gold coin with glow
                        const group = new THREE.Group();
                        const coinGeo = new THREE.SphereGeometry(0.3, 8, 6);
                        const coinMat = new THREE.MeshStandardMaterial({
                            color: 0xffff00, emissive: 0xffaa00, emissiveIntensity: 1.0,
                            roughness: 0.3, metalness: 0.5,
                        });
                        const coinMesh = new THREE.Mesh(coinGeo, coinMat);
                        coinMesh.castShadow = true;
                        group.add(coinMesh);

                        // Glow sphere
                        const glowGeo = new THREE.SphereGeometry(0.45, 8, 6);
                        const glowMat = new THREE.MeshBasicMaterial({
                            color: 0xffdd44, transparent: true, opacity: 0.25,
                            blending: THREE.AdditiveBlending, depthWrite: false,
                        });
                        group.add(new THREE.Mesh(glowGeo, glowMat));

                        mesh = group;
                        break;
                    }
                }
                mesh.position.set(p.x, p.y, p.z);
                if (mesh.isMesh) mesh.castShadow = true;
                mesh.userData.pickupType = p.type;
                this.scene.add(mesh);
                this._pickupMeshes.set(p.id, mesh);
            } else {
                // Update position from client-side gravity simulation
                const mesh = this._pickupMeshes.get(p.id);
                mesh.position.x = p.x;
                mesh.position.z = p.z;
                // Y is set below in animation (baseY = p.y from gravity sim)
                mesh.userData.baseY = p.y;
            }
        }

        // Remove collected/despawned pickups (not in pickupMap anymore)
        // Sound is handled by the server's EVENT_SOUND (spatial attenuation).
        // Rings get a fadeout animation; other pickups get a particle burst.
        for (const [id, mesh] of this._pickupMeshes) {
            if (!pickupMap.has(id)) {
                const pType = mesh.userData.pickupType || 0;

                if (pType === 3) {
                    // Ring: start fadeout animation (shrink + fade + shockwave)
                    this._fadingPickups.push({
                        mesh, timer: 0, duration: 0.6, type: pType,
                        startScale: mesh.scale.x || 1,
                    });
                    // Spawn shockwave ring at collection point
                    this._spawnRingShockwave(mesh.position);
                    this._spawnPickupBurst(mesh.position, pType);
                } else {
                    if (this.playerMesh) {
                        const dx = mesh.position.x - this.playerMesh.position.x;
                        const dz = mesh.position.z - this.playerMesh.position.z;
                        if (dx * dx + dz * dz < 2500) {
                            this._spawnPickupBurst(mesh.position, pType);
                        }
                    }
                    this.scene.remove(mesh);
                    if (mesh.isMesh) {
                        mesh.geometry.dispose();
                        mesh.material.dispose();
                    } else if (mesh.isGroup) {
                        mesh.traverse(c => { if (c.isMesh) { c.geometry.dispose(); c.material.dispose(); } });
                    }
                }
                this._pickupMeshes.delete(id);
            }
        }

        // Update fading pickups (ring fadeout animation)
        for (let i = this._fadingPickups.length - 1; i >= 0; i--) {
            const f = this._fadingPickups[i];
            f.timer += this.deltaTime;
            const t = Math.min(1, f.timer / f.duration);

            // Shrink and fade
            const scale = f.startScale * (1 - t * 0.5); // shrink to 50%
            f.mesh.scale.setScalar(scale);
            f.mesh.traverse(c => {
                if (c.isMesh && c.material) {
                    const orig = c.material.userData?.origOpacity ?? 1.0;
                    c.material.opacity = orig * (1 - t);
                    c.material.transparent = true;
                }
            });

            if (f.timer >= f.duration) {
                this.scene.remove(f.mesh);
                f.mesh.traverse(c => { if (c.isMesh) { c.geometry.dispose(); c.material.dispose(); } });
                this._fadingPickups.splice(i, 1);
            }
        }

        // Animate existing pickups
        const time = performance.now() * 0.001;
        for (const [id, mesh] of this._pickupMeshes) {
            const pType = mesh.userData.pickupType || 0;
            const baseY = mesh.userData.baseY ?? mesh.position.y;
            if (pType === 3) {
                // Ring: slow spin + pronounced bounce (matching single-player RingPickup)
                mesh.rotation.y += 0.005;
                mesh.position.y = baseY + Math.sin(time * 0.8 + mesh.position.x) * 1.2;
            } else {
                // Coin/fruit/water: bob + spin (matching single-player feel)
                mesh.position.y = baseY + Math.sin(time * 2 + id * 0.1) * 0.1;
                mesh.rotation.x += 0.01;
                mesh.rotation.y += 0.005;

                // Coin glow pulsing
                if (pType === 0 && mesh.isGroup && mesh.children.length >= 2) {
                    const coinChild = mesh.children[0];
                    const glowChild = mesh.children[1];
                    const pulse = 1.0 + Math.sin(time * 3) * 0.1;
                    glowChild.scale.set(pulse, pulse, pulse);
                    glowChild.material.opacity = 0.25 + Math.sin(time * 4) * 0.1;
                    if (coinChild.material) {
                        coinChild.material.emissiveIntensity = 1.0 + Math.sin(time * 3.5) * 0.3;
                    }
                }
            }
        }
    }

    /**
     * Weather VFX driven by server state.
     * weatherState: 0=clear, 1=warning, 2=active (storm)
     * Uses StormTheme for full rain/fog/lighting effects, synchronized from server.
     */
    _updateNetworkWeather() {
        if (!this.networkManager) return;
        const extra = this.networkManager.latestExtra;
        const ws = extra.weatherState || 0;
        const stormRemaining = extra.stormRemaining || 0;

        // Warning phase (ws=1): show message, don't activate yet
        if (ws === 1 && !this._networkStormWarning && !this._networkStormActive) {
            this._networkStormWarning = true;
            this._showThemeMessage('A storm is coming...');
            eventBus.emit('theme:started', { name: 'Storm' });
        }

        // Active phase (ws=2): activate StormTheme with full effects
        if (ws === 2 && !this._networkStormActive) {
            this._networkStormActive = true;
            this._networkStormWarning = false;
            const stormDuration = StormTheme.duration || 30;
            this._networkStormElapsed = Math.max(0, stormDuration - stormRemaining);
            StormTheme.activate(this.scene);
        }

        // Joining mid-storm: ws=1 or ws=2 but we missed the warning
        if (ws >= 1 && !this._networkStormActive && !this._networkStormWarning) {
            this._networkStormActive = true;
            const stormDuration = StormTheme.duration || 30;
            this._networkStormElapsed = Math.max(0, stormDuration - stormRemaining);
            StormTheme.activate(this.scene);
        }

        if (ws === 0 && (this._networkStormActive || this._networkStormWarning)) {
            // Storm ends — deactivate StormTheme
            this._networkStormActive = false;
            this._networkStormWarning = false;
            StormTheme.deactivate(this.scene);
            this._showThemeMessage('You survived the storm. The sun is coming out.');
            // Emit theme:ended so post-storm effects trigger (bird sounds, water drops)
            eventBus.emit('theme:ended', { name: 'Storm' });
        }

        // Update StormTheme each frame while active (drives rain, fog fade, lightning bolts)
        if (this._networkStormActive) {
            this._networkStormElapsed = (this._networkStormElapsed || 0) + this.deltaTime;
            const playerPos = this.playerMesh ? this.playerMesh.position : new THREE.Vector3();
            // Pass elapsed and remaining for fade in/out transitions
            // StormTheme.update handles rain, fog, and lightning bolts internally
            // We skip StormTheme's local lightning spawning — server sends those via snapshot
            StormTheme.update(this.deltaTime, this.scene, playerPos, this._networkStormElapsed, stormRemaining);

            // Sync puddles from server (always call to clean up expired ones too)
            if (extra.puddles) {
                StormTheme.syncServerPuddles(this.scene, extra.puddles);
            }
        } else if (ws === 0) {
            // Storm ended — clean up any remaining server puddles
            StormTheme.syncServerPuddles(this.scene, []);
        }
    }

    /**
     * Show a themed overlay message (mirrors ThemeManager._showMessage).
     */
    _showThemeMessage(text) {
        const el = document.createElement('div');
        el.textContent = text;
        el.style.cssText = [
            'position:fixed', 'top:20%', 'left:50%', 'transform:translateX(-50%)',
            'z-index:8000', 'font:bold clamp(14px, 4vw, 22px) monospace', 'color:#fff', 'text-align:center',
            'text-shadow:0 2px 12px rgba(0,0,0,0.7)', 'pointer-events:none',
            'opacity:0', 'transition:opacity 0.8s ease-in-out', 'max-width:90vw',
            'padding:0 12px', 'box-sizing:border-box'
        ].join(';');
        document.body.appendChild(el);
        requestAnimationFrame(() => { el.style.opacity = '1'; });
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 800);
        }, 3000);
    }

    /**
     * Radar display in network mode.
     */
    _updateNetworkRadar() {
        if (!this.playerMesh) return;
        const others = getRemoteRadarData();

        // Add pickups to radar, color by type
        const radarColors = { 0: 'gold', 1: 'orange', 2: '#4488ff', 3: '#ff4444' };
        const radarTypes = { 0: 'coin', 1: 'fruit', 2: 'waterdrop', 3: 'ring' };
        for (const [id, mesh] of this._pickupMeshes) {
            const pType = mesh.userData.pickupType || 0;
            others.push({
                x: mesh.position.x, z: mesh.position.z,
                color: radarColors[pType] || 'gold',
                type: radarTypes[pType] || 'coin',
            });
        }

        drawRadar(this.playerMesh.position, others);
    }

    /**
     * Player list in network mode (from server scores).
     */
    _updateNetworkPlayerList() {
        if (!this.networkManager) return;
        const entities = [];

        // Local player
        const extra = this.networkManager.latestExtra;
        const localScore = extra.scores.find(s => s.playerId === this.networkManager.localPlayerId);
        const playerColor = this.playerMesh.userData.glowColor
            ? '#' + this.playerMesh.userData.glowColor.getHexString()
            : '#00ffcc';
        entities.push({
            id: 'player',
            tailLength: localScore ? localScore.tailLength : 0,
            size: this.playerMesh.scale.x,
            color: playerColor,
            alive: true,
        });

        // Remote players
        const remotePlayers = getRemotePlayerListData(this.networkManager);
        entities.push(...remotePlayers);

        updatePlayerList(entities);
        this.updateChampionCrown(entities);
    }

    /**
     * Distance-based head-vs-tail overlap check.
     * Backs up Rapier sensor events which can miss intersections.
     */
    checkHeadTailOverlaps() {
        if (!this.deathManager || !this.botManager) return;

        const HEAD_HALF = 0.5; // player/bot head cuboid(0.5) half-extent
        const SEG_BASE_HALF = 0.4; // tail segment cuboid(0.4) base half-extent (scaled per segment)
        const SKIP_SEGMENTS = 3; // skip first 3 segments near head to avoid neck-proximity false kills
        const playerTail = getPlayerTail();

        // Check each bot head against player tail
        if (playerTail) {
            for (const bot of this.botManager.bots) {
                if (this.deathManager.isInvulnerable(bot.id)) continue;
                const bx = bot.mesh.position.x;
                const bz = bot.mesh.position.z;
                for (let s = SKIP_SEGMENTS; s < playerTail.segments.length; s++) {
                    const seg = playerTail.segments[s];
                    if (!seg || !seg.mesh) continue;
                    const segHalf = seg.mesh.scale.x * SEG_BASE_HALF;
                    const killDist = HEAD_HALF + segHalf;
                    const dx = bx - seg.mesh.position.x;
                    const dz = bz - seg.mesh.position.z;
                    if (dx * dx + dz * dz < killDist * killDist) {
                        this.deathManager.killEntity(bot.id, 'player');
                        break;
                    }
                }
            }
        }

        // Check player head against each bot tail
        if (this.playerMesh && !this.deathManager.isInvulnerable('player')) {
            const px = this.playerMesh.position.x;
            const pz = this.playerMesh.position.z;
            for (const bot of this.botManager.bots) {
                if (!bot.tail) continue;
                for (let s = SKIP_SEGMENTS; s < bot.tail.segments.length; s++) {
                    const seg = bot.tail.segments[s];
                    if (!seg || !seg.mesh) continue;
                    const segHalf = seg.mesh.scale.x * SEG_BASE_HALF;
                    const killDist = HEAD_HALF + segHalf;
                    const dx = px - seg.mesh.position.x;
                    const dz = pz - seg.mesh.position.z;
                    if (dx * dx + dz * dz < killDist * killDist) {
                        this.deathManager.killEntity('player', bot.id);
                        break;
                    }
                }
            }
        }

        // Check bot heads against other bot tails
        for (const bot of this.botManager.bots) {
            if (this.deathManager.isInvulnerable(bot.id)) continue;
            const bx = bot.mesh.position.x;
            const bz = bot.mesh.position.z;
            for (const other of this.botManager.bots) {
                if (other.id === bot.id) continue;
                if (!other.tail) continue;
                for (let s = SKIP_SEGMENTS; s < other.tail.segments.length; s++) {
                    const seg = other.tail.segments[s];
                    if (!seg || !seg.mesh) continue;
                    const segHalf = seg.mesh.scale.x * SEG_BASE_HALF;
                    const killDist = HEAD_HALF + segHalf;
                    const dx = bx - seg.mesh.position.x;
                    const dz = bz - seg.mesh.position.z;
                    if (dx * dx + dz * dz < killDist * killDist) {
                        this.deathManager.killEntity(bot.id, other.id);
                        break;
                    }
                }
            }
        }
    }

    /**
     * Backup distance-based ring overlap check.
     * Backs up Rapier sensor events which can miss kinematic-sensor intersections.
     */
    checkRingOverlaps() {
        if (!this.pickupManager) return;
        const activeMap = this.pickupManager.getActive('ring');
        if (!activeMap || activeMap.size === 0) return;

        // Build entity list
        const entities = [];
        if (this.playerMesh) {
            entities.push({ id: 'player', pos: this.playerMesh.position });
        }
        if (this.botManager) {
            for (const bot of this.botManager.bots) {
                entities.push({ id: bot.id, pos: bot.mesh.position });
            }
        }

        // Ring sensor reach: major radius (4.0) + player half (0.5) + margin
        const RING_TRIGGER_DIST_SQ = 5.5 * 5.5; // ~30.25

        for (const [handle, instance] of activeMap) {
            if (!instance.mesh) continue;
            const rx = instance.mesh.position.x;
            const rz = instance.mesh.position.z;

            for (const entity of entities) {
                const dx = entity.pos.x - rx;
                const dz = entity.pos.z - rz;
                if (dx * dx + dz * dz < RING_TRIGGER_DIST_SQ) {
                    this.pickupManager.queueCollision('ring', entity.id, handle);
                }
            }
        }
    }

    /**
     * Head-to-head collision: bigger entity eats smaller. Near-equal sizes bounce apart.
     */
    checkHeadHeadOverlaps() {
        if (!this.deathManager || !this.botManager) return;

        const HEAD_COLLISION_DIST_SQ = 1.5;
        const SIZE_TIE_THRESHOLD = 0.2;
        const BOUNCE_IMPULSE = 8;

        // Build entity list: player + all bots
        const entities = [];
        if (this.playerMesh && this.playerBody) {
            entities.push({
                id: 'player',
                mesh: this.playerMesh,
                body: this.playerBody,
                size: this.playerMesh.scale.x
            });
        }
        for (const bot of this.botManager.bots) {
            entities.push({
                id: bot.id,
                mesh: bot.mesh,
                body: bot.body,
                size: bot.mesh.scale.x
            });
        }

        for (let a = 0; a < entities.length; a++) {
            for (let b = a + 1; b < entities.length; b++) {
                const ea = entities[a];
                const eb = entities[b];
                if (this.deathManager.isInvulnerable(ea.id) || this.deathManager.isInvulnerable(eb.id)) continue;

                // Skip if either entity is airborne (jumping over)
                const dy = Math.abs(ea.mesh.position.y - eb.mesh.position.y);
                if (dy > 1.0) continue;

                const dx = ea.mesh.position.x - eb.mesh.position.x;
                const dz = ea.mesh.position.z - eb.mesh.position.z;
                if (dx * dx + dz * dz >= HEAD_COLLISION_DIST_SQ) continue;

                const sizeDiff = Math.abs(ea.size - eb.size);
                if (sizeDiff < SIZE_TIE_THRESHOLD) {
                    // Near-equal: bounce both apart
                    const dist = Math.sqrt(dx * dx + dz * dz) || 0.1;
                    const nx = dx / dist;
                    const nz = dz / dist;
                    ea.body.applyImpulse({ x: nx * BOUNCE_IMPULSE, y: 2, z: nz * BOUNCE_IMPULSE }, true);
                    eb.body.applyImpulse({ x: -nx * BOUNCE_IMPULSE, y: 2, z: -nz * BOUNCE_IMPULSE }, true);
                } else {
                    // Bigger eats smaller
                    const [bigger, smaller] = ea.size > eb.size ? [ea, eb] : [eb, ea];
                    this.deathManager.killEntity(smaller.id, bigger.id);
                }
            }
        }
    }

    checkBoundaryDeath() {
        if (!this.deathManager) return;

        // Player: safety net for falling through geometry
        if (this.playerMesh.position.y < -5) {
            this.deathManager.killEntity('player', 'boundary');
        }

        // Bots: safety net for falling through geometry
        if (this.botManager) {
            for (const bot of this.botManager.bots) {
                if (bot.mesh.position.y < -5) {
                    this.deathManager.killEntity(bot.id, 'boundary');
                }
            }
        }
    }

    updateRadar() {
        if (!this.playerMesh) return;

        const currentPlayerPos = this.playerMesh.position;
        const others = [];

        if (this.blockMesh) {
            others.push({
                x: this.blockMesh.position.x,
                z: this.blockMesh.position.z,
                color: 'blue',
                type: 'block'
            });
        }

        // Add all pickup radar data
        const pickupRadar = this.pickupManager.getRadarData();
        for (const item of pickupRadar) {
            others.push(item);
        }

        // Add bots to radar
        if (this.botManager) {
            for (const bot of this.botManager.bots) {
                others.push({
                    x: bot.mesh.position.x,
                    z: bot.mesh.position.z,
                    color: '#' + bot.color.getHexString(),
                    type: 'bot'
                });
            }
        }

        drawRadar(currentPlayerPos, others);
    }

    updatePlayerListHUD(playerTail) {
        const entities = [];

        // Player
        const playerColor = this.playerMesh.userData.glowColor
            ? '#' + this.playerMesh.userData.glowColor.getHexString()
            : '#00ffcc';
        entities.push({
            id: 'player',
            tailLength: playerTail ? playerTail.getLength() : 0,
            size: this.playerMesh.scale.x,
            color: playerColor,
            alive: true
        });

        // Bots
        if (this.botManager) {
            for (const bot of this.botManager.bots) {
                entities.push({
                    id: bot.id,
                    tailLength: bot.tail.getLength(),
                    size: bot.mesh.scale.x,
                    color: '#' + bot.color.getHexString(),
                    alive: true
                });
            }
        }

        updatePlayerList(entities);

        // Feed entities to round manager for end-of-round rankings
        if (this.roundManager) {
            this.roundManager.setEntities(entities);
        }

        // Update champion crown
        this.updateChampionCrown(entities);
    }

    createCrownMesh() {
        const group = new THREE.Group();
        // Gold base ring
        const baseGeo = new THREE.TorusGeometry(0.4, 0.08, 8, 16);
        const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xffa500, emissiveIntensity: 0.3, roughness: 0.3, metalness: 0.8 });
        const base = new THREE.Mesh(baseGeo, goldMat);
        base.rotation.x = Math.PI / 2;
        group.add(base);

        // Crown points (5 small cones)
        const pointGeo = new THREE.ConeGeometry(0.1, 0.3, 4);
        for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2;
            const point = new THREE.Mesh(pointGeo, goldMat);
            point.position.set(Math.cos(angle) * 0.35, 0.15, Math.sin(angle) * 0.35);
            group.add(point);
        }

        group.scale.setScalar(0.8);
        return group;
    }

    updateChampionCrown(entities) {
        // Find champion (biggest alive entity)
        let championId = null;
        let maxSize = 1.5; // minimum size to qualify
        for (const e of entities) {
            if (e.alive && e.size > maxSize) {
                maxSize = e.size;
                championId = e.id;
            }
        }

        if (!championId) {
            // No champion — hide crown
            if (this.crownMesh && this.crownMesh.parent) {
                this.crownMesh.parent.remove(this.crownMesh);
            }
            this.championId = null;
            return;
        }

        if (championId === this.championId && this.crownMesh) return; // no change

        // Announce crown change
        eventBus.emit('crown:changed', {
            newChampion: championId,
            oldChampion: this.championId
        });

        // Create crown if needed
        if (!this.crownMesh) {
            this.crownMesh = this.createCrownMesh();
        }

        // Remove from old parent
        if (this.crownMesh.parent) {
            this.crownMesh.parent.remove(this.crownMesh);
        }

        // Find the champion's mesh and parent the crown to it
        let championMesh = null;
        if (championId === 'player') {
            championMesh = this.playerMesh;
        } else if (this.botManager) {
            const bot = this.botManager.bots.find(b => b.id === championId);
            if (bot) championMesh = bot.mesh;
        }

        if (championMesh) {
            championMesh.add(this.crownMesh);
            this.crownMesh.position.set(0, 0.9, 0);
            // Gentle rotation
            this.crownMesh.rotation.y += 0.01;
        }

        this.championId = championId;
    }

    handleLightningStrike(data) {
        const { x, z, hitRadius, sizeLoss, minSize } = data;
        const ringHandler = this.pickupManager ? this.pickupManager.getHandler('ring') : null;

        // Spawn visual bolt if requested (test button — storm theme creates its own)
        if (data.spawnBolt) {
            this._spawnBolt(x, z);
        }

        // Check player distance to strike
        if (this.playerMesh) {
            const playerShielded = ringHandler && ringHandler.hasPower('player', 'SHIELD');
            const playerSheltered = this._isUnderTree(this.playerMesh.position);
            if (!playerShielded && !playerSheltered) {
                const dx = this.playerMesh.position.x - x;
                const dz = this.playerMesh.position.z - z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                const playerHitRadius = hitRadius * (1 + Math.log2(this.playerMesh.scale.x) * 0.15);
                if (dist < playerHitRadius) {
                    // In network mode, server is authoritative for tail/scale —
                    // only apply VFX here to avoid double-removal oscillation.
                    if (!this.networkMode) {
                        const newScale = Math.max(minSize, this.playerMesh.scale.x - sizeLoss);
                        this.playerMesh.scale.setScalar(newScale);

                        const playerTail = getPlayerTail();
                        if (playerTail) {
                            playerTail.removeLastSegments(3);
                        }

                        eventBus.emit('lightning:hit', { entityId: 'player', newSize: newScale });
                        eventBus.emit('entity:sizeChanged', { entityId: 'player', newSize: newScale });
                    }

                    // VFX always plays regardless of mode
                    this._spawnElectricArcs(this.playerMesh);
                    this._startLightningShake();
                    playEffect('lightning:hit');
                    setTimeout(() => playSound('squeel', 0.25), 400);
                }
            }
        }

        // Check bots (only in single-player — no bots in network mode)
        if (!this.networkMode && this.botManager) {
            for (const bot of this.botManager.bots) {
                const botShielded = ringHandler && ringHandler.hasPower(bot.id, 'SHIELD');
                const botSheltered = this._isUnderTree(bot.mesh.position);
                if (botShielded || botSheltered) continue;

                const dx = bot.mesh.position.x - x;
                const dz = bot.mesh.position.z - z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                const botHitRadius = hitRadius * (1 + Math.log2(bot.mesh.scale.x) * 0.15);
                if (dist < botHitRadius) {
                    const newScale = Math.max(minSize, bot.mesh.scale.x - sizeLoss);
                    bot.mesh.scale.setScalar(newScale);

                    if (bot.tail) {
                        bot.tail.removeLastSegments(3);
                    }

                    this._spawnElectricArcs(bot.mesh);
                    const bx = bot.mesh.position.x, bz = bot.mesh.position.z;
                    setTimeout(() => playSpatialSound('squeel', 0.15, bx, bz), 400);
                    eventBus.emit('lightning:hit', { entityId: bot.id, newSize: newScale });
                    eventBus.emit('entity:sizeChanged', { entityId: bot.id, newSize: newScale });
                }
            }
        }
    }

    /**
     * Spawns a visual lightning bolt from sky to ground at (x, z).
     */
    _spawnBolt(targetX, targetZ) {
        const startY = 40;
        const endY = 0.5;
        const segments = 8 + Math.floor(Math.random() * 4);
        const width = 0.3;
        const vertices = [];
        const indices = [];

        let bx = targetX + (Math.random() - 0.5) * 5;
        let bz = targetZ + (Math.random() - 0.5) * 5;

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const y = startY + (endY - startY) * t;
            const jitter = Math.sin(t * Math.PI) * 3;
            const offX = i === 0 || i === segments ? 0 : (Math.random() - 0.5) * jitter;
            const offZ = i === 0 || i === segments ? 0 : (Math.random() - 0.5) * jitter;
            const px = bx + offX + (targetX - bx) * t;
            const pz = bz + offZ + (targetZ - bz) * t;
            const idx = i * 2;
            vertices.push(px - width, y, pz);
            vertices.push(px + width, y, pz);
            if (i < segments) {
                const next = (i + 1) * 2;
                indices.push(idx, idx + 1, next);
                indices.push(idx + 1, next + 1, next);
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geo.setIndex(indices);

        const mat = new THREE.MeshBasicMaterial({
            color: 0xeeeeff, transparent: true, opacity: 1,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
        });
        const bolt = new THREE.Mesh(geo, mat);
        this.scene.add(bolt);

        // Ground glow
        const glowGeo = new THREE.CircleGeometry(3, 16);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0xaabbff, transparent: true, opacity: 0.6,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.position.set(targetX, 0.15, targetZ);
        glow.rotation.x = -Math.PI / 2;
        this.scene.add(glow);

        // Fade out both
        const scene = this.scene;
        const start = performance.now();
        const fade = () => {
            const elapsed = performance.now() - start;
            if (elapsed < 400) {
                const t = elapsed / 400;
                mat.opacity = 1 - t;
                glowMat.opacity = 0.6 * (1 - t);
                requestAnimationFrame(fade);
            } else {
                scene.remove(bolt); geo.dispose(); mat.dispose();
                scene.remove(glow); glowGeo.dispose(); glowMat.dispose();
            }
        };
        requestAnimationFrame(fade);
    }

    /**
     * Electric arc particles around an entity — bright sparks that jump outward and fade.
     * @param {THREE.Mesh} mesh
     */
    _resolveEntityMesh(entityId) {
        if (entityId === 'player') return this.playerMesh;
        if (this.botManager) {
            const bot = this.botManager.bots.find(b => b.id === entityId);
            if (bot) return bot.mesh;
        }
        return null;
    }

    _spawnElectricArcs(mesh) {
        if (!mesh) return;
        const scene = this.scene;
        const arcCount = 16;
        const arcs = [];

        // Squint eyes in pain (decays naturally via updateEyePhysics)
        if (mesh.userData?.eyePhysics) {
            mesh.userData.eyePhysics.painSquint = 0.85;
        }

        // Brief emissive flash on the entity itself
        if (mesh.material && mesh.material.emissive) {
            // Store true original emissive only once (avoids capturing mid-flash values)
            if (!mesh.userData._origEmissive) {
                mesh.userData._origEmissive = mesh.material.emissive.clone();
                mesh.userData._origEmissiveIntensity = mesh.material.emissiveIntensity || 0;
            }
            const origEmissive = mesh.userData._origEmissive;
            const origIntensity = mesh.userData._origEmissiveIntensity;

            mesh.material.emissive.set(0x88bbff);
            mesh.material.emissiveIntensity = 1.0;

            // Cancel any existing fade
            if (mesh.userData._emissiveFadeId) {
                cancelAnimationFrame(mesh.userData._emissiveFadeId);
            }

            const fadeStart = performance.now();
            const fadeEmissive = () => {
                const t = (performance.now() - fadeStart) / 500;
                if (t < 1 && mesh.material) {
                    // Lerp both color and intensity back to original
                    mesh.material.emissive.copy(origEmissive).lerp(_tmpColor.set(0x88bbff), 1 - t);
                    mesh.material.emissiveIntensity = origIntensity + (1.0 - origIntensity) * (1 - t);
                    mesh.userData._emissiveFadeId = requestAnimationFrame(fadeEmissive);
                } else if (mesh.material) {
                    mesh.material.emissive.copy(origEmissive);
                    mesh.material.emissiveIntensity = origIntensity;
                    mesh.userData._emissiveFadeId = null;
                    delete mesh.userData._origEmissive;
                    delete mesh.userData._origEmissiveIntensity;
                }
            };
            mesh.userData._emissiveFadeId = requestAnimationFrame(fadeEmissive);
        }

        // Spawn spark particles
        for (let i = 0; i < arcCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const elevation = (Math.random() - 0.3) * Math.PI;
            const speed = 3 + Math.random() * 5;

            const geo = new THREE.SphereGeometry(0.06 + Math.random() * 0.06, 4, 3);
            const mat = new THREE.MeshBasicMaterial({
                color: Math.random() > 0.3 ? 0x88ccff : 0xffffff,
                transparent: true, opacity: 1,
                blending: THREE.AdditiveBlending, depthWrite: false
            });
            const spark = new THREE.Mesh(geo, mat);
            spark.position.copy(mesh.position);
            spark.position.y += 0.5;
            scene.add(spark);

            arcs.push({
                mesh: spark, geo, mat,
                vx: Math.cos(angle) * Math.cos(elevation) * speed,
                vy: Math.sin(elevation) * speed + 2,
                vz: Math.sin(angle) * Math.cos(elevation) * speed,
                life: 0,
                maxLife: 0.3 + Math.random() * 0.3
            });
        }

        // Also spawn 3 small arc lines (jagged segments from entity outward)
        for (let i = 0; i < 3; i++) {
            const angle = Math.random() * Math.PI * 2;
            const reach = 1.5 + Math.random() * 1.5;
            const pts = [];
            const segs = 4;
            for (let s = 0; s <= segs; s++) {
                const t = s / segs;
                pts.push(new THREE.Vector3(
                    mesh.position.x + Math.cos(angle) * reach * t + (s > 0 && s < segs ? (Math.random() - 0.5) * 0.8 : 0),
                    mesh.position.y + 0.5 + (Math.random() - 0.5) * 0.5 * t,
                    mesh.position.z + Math.sin(angle) * reach * t + (s > 0 && s < segs ? (Math.random() - 0.5) * 0.8 : 0)
                ));
            }
            const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
            const lineMat = new THREE.LineBasicMaterial({
                color: 0xaaddff, transparent: true, opacity: 1,
                blending: THREE.AdditiveBlending, depthWrite: false
            });
            const line = new THREE.Line(lineGeo, lineMat);
            scene.add(line);
            arcs.push({ mesh: line, geo: lineGeo, mat: lineMat, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0.25 + Math.random() * 0.15, isLine: true });
        }

        const startTime = performance.now();
        const animate = () => {
            const now = performance.now();
            const dt = 0.016;
            let alive = false;
            for (const arc of arcs) {
                arc.life += dt;
                if (arc.life >= arc.maxLife) {
                    if (arc.mesh.parent) {
                        scene.remove(arc.mesh);
                        arc.geo.dispose();
                        arc.mat.dispose();
                    }
                    continue;
                }
                alive = true;
                const t = arc.life / arc.maxLife;
                arc.mat.opacity = 1 - t * t;
                if (!arc.isLine) {
                    arc.mesh.position.x += arc.vx * dt;
                    arc.mesh.position.y += arc.vy * dt;
                    arc.mesh.position.z += arc.vz * dt;
                    arc.vy -= 12 * dt; // gravity on sparks
                    arc.mesh.scale.setScalar(1 - t * 0.6);
                }
            }
            if (alive) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    /**
     * Screen shake when hit by lightning — vibrates document.body for 400ms.
     */
    _startLightningShake() {
        if (this._lightningShaking) return;
        this._lightningShaking = true;

        // White flash overlay
        const flash = document.createElement('div');
        flash.style.cssText = 'position:fixed;inset:0;z-index:8000;background:#fff;pointer-events:none;opacity:0.5;transition:opacity 0.3s;';
        document.body.appendChild(flash);
        setTimeout(() => { flash.style.opacity = '0'; }, 50);
        setTimeout(() => { flash.remove(); }, 400);

        const intensity = 5;
        const shakeFrame = () => {
            if (!this._lightningShaking) {
                document.body.style.transform = '';
                return;
            }
            const ox = (Math.random() - 0.5) * intensity * 2;
            const oy = (Math.random() - 0.5) * intensity * 2;
            document.body.style.transform = `translate(${ox}px, ${oy}px)`;
            requestAnimationFrame(shakeFrame);
        };
        requestAnimationFrame(shakeFrame);

        setTimeout(() => {
            this._lightningShaking = false;
            document.body.style.transform = '';
        }, 400);
    }

    /**
     * Checks if a position is under a tree canopy (sheltered from lightning).
     * @param {THREE.Vector3} position
     * @returns {boolean}
     */
    _isUnderTree(position) {
        const canopies = this.scene.userData.treeCanopies;
        if (!canopies) return false;
        for (const c of canopies) {
            const dx = position.x - c.x;
            const dz = position.z - c.z;
            if (dx * dx + dz * dz < c.radius * c.radius) return true;
        }
        return false;
    }

    updateVisualPositions() {
        const playerPos = this.playerBody.translation();
        // Offset Y so the mesh bottom stays on the ground as the player grows
        const scaleOffset = (this.playerMesh.scale.x - 1) * 0.5;
        this.playerMesh.position.set(playerPos.x, playerPos.y + scaleOffset, playerPos.z);
        this.playerMesh.quaternion.slerp(targetPlayerQuaternion, 0.15);

        // Double-jump flip animation
        if (moveState.flipping) {
            moveState.flipProgress += this.deltaTime * 3.0; // ~0.33s for full flip
            if (moveState.flipProgress >= 1) {
                moveState.flipping = false;
                moveState.flipProgress = 0;
                // Clear tail flip rotations
                const playerTail = getPlayerTail();
                if (playerTail) {
                    for (const seg of playerTail.segments) {
                        seg.mesh.rotation.x = 0;
                    }
                }
            } else {
                // Roll around the player's local forward (Z) axis
                const flipAngle = moveState.flipProgress * Math.PI * 2;
                const localRight = new THREE.Vector3(1, 0, 0).applyQuaternion(targetPlayerQuaternion);
                const flipQuat = new THREE.Quaternion().setFromAxisAngle(localRight, flipAngle);
                this.playerMesh.quaternion.copy(flipQuat).multiply(targetPlayerQuaternion);

                // Spin tail segments with staggered delay
                const playerTail = getPlayerTail();
                if (playerTail) {
                    for (let i = 0; i < playerTail.segments.length; i++) {
                        const delay = Math.min(1, moveState.flipProgress - i * 0.04);
                        if (delay > 0) {
                            const segAngle = delay * Math.PI * 2;
                            playerTail.segments[i].mesh.rotation.x = segAngle;
                        }
                    }
                }

                // Spiral particle trail
                this._spawnFlipParticle();
            }
        }

        // Reset double-jump when landing
        if (playerPos.y < 1.2 && moveState.doubleJumped) {
            moveState.doubleJumped = false;
        }

        // Update flip trail particles
        this._updateFlipParticles();

        const blockPos = this.blockBody.translation();
        const blockRot = this.blockBody.rotation();
        this.blockMesh.position.set(blockPos.x, blockPos.y, blockPos.z);
        this.blockMesh.quaternion.set(blockRot.x, blockRot.y, blockRot.z, blockRot.w);
    }

    _spawnFlipParticle() {
        if (!this.playerMesh) return;
        const playerColor = this.playerMesh.userData.glowColor || new THREE.Color(0x00ffcc);
        const scale = this.playerMesh.scale.x || 1;

        // Spawn 2 particles per frame in a spiral around the player
        for (let j = 0; j < 2; j++) {
            const angle = moveState.flipProgress * Math.PI * 4 + j * Math.PI;
            const r = 1.2 * scale;
            const offset = new THREE.Vector3(
                Math.cos(angle) * r,
                Math.sin(angle) * r,
                (Math.random() - 0.5) * 0.5 * scale
            );
            // Rotate offset to match player facing
            offset.applyQuaternion(targetPlayerQuaternion);

            const particleSize = Math.max(0.15, 0.12 * scale);
            const geo = new THREE.SphereGeometry(particleSize, 4, 4);
            const mat = new THREE.MeshBasicMaterial({
                color: j === 0 ? playerColor : 0xffffff,
                transparent: true,
                opacity: 0.9,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(this.playerMesh.position).add(offset);
            this.scene.add(mesh);

            this.flipParticles.push({
                mesh, age: 0, lifetime: 0.4,
                velocity: offset.clone().multiplyScalar(2)
            });
        }
    }

    _updateFlipParticles() {
        for (let i = this.flipParticles.length - 1; i >= 0; i--) {
            const p = this.flipParticles[i];
            p.age += this.deltaTime;
            if (p.age >= p.lifetime) {
                this.scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
                this.flipParticles.splice(i, 1);
                continue;
            }
            const t = p.age / p.lifetime;
            p.mesh.position.addScaledVector(p.velocity, this.deltaTime);
            p.mesh.material.opacity = 0.9 * (1 - t);
            p.mesh.scale.setScalar(1 - t * 0.7);
        }
    }

    /**
     * Spawn flip trail particles for a remote player (same visual as local player).
     */
    _spawnRemoteFlipParticle(mesh, flipProgress, baseYawQuat, playerColor) {
        if (!mesh) return;
        const scale = mesh.scale.x || 1;

        for (let j = 0; j < 2; j++) {
            const angle = flipProgress * Math.PI * 4 + j * Math.PI;
            const r = 1.2 * scale;
            const offset = new THREE.Vector3(
                Math.cos(angle) * r,
                Math.sin(angle) * r,
                (Math.random() - 0.5) * 0.5 * scale
            );
            offset.applyQuaternion(baseYawQuat);

            const particleSize = Math.max(0.15, 0.12 * scale);
            const geo = new THREE.SphereGeometry(particleSize, 4, 4);
            const mat = new THREE.MeshBasicMaterial({
                color: j === 0 ? playerColor : 0xffffff,
                transparent: true,
                opacity: 0.9,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const m = new THREE.Mesh(geo, mat);
            m.position.copy(mesh.position).add(offset);
            this.scene.add(m);

            this.flipParticles.push({
                mesh: m, age: 0, lifetime: 0.4,
                velocity: offset.clone().multiplyScalar(2)
            });
        }
    }

    /**
     * Spawn a small particle burst at a pickup's position when collected.
     * @param {THREE.Vector3} pos - world position of the collected pickup
     * @param {number} pType - pickup type (0=coin, 1=fruit, 2=water)
     */
    _spawnRingShockwave(pos) {
        const geo = new THREE.RingGeometry(0.5, 1.0, 32);
        const mat = new THREE.MeshBasicMaterial({
            color: 0xff4444, transparent: true, opacity: 0.7,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(geo, mat);
        ring.position.copy(pos);
        ring.rotation.x = -Math.PI / 2;
        this.scene.add(ring);

        const duration = 0.6;
        const start = performance.now();
        const animate = () => {
            const t = (performance.now() - start) / (duration * 1000);
            if (t >= 1) {
                this.scene.remove(ring);
                ring.geometry.dispose();
                ring.material.dispose();
                return;
            }
            const scale = 1 + t * 8; // expand outward
            ring.scale.setScalar(scale);
            ring.material.opacity = 0.7 * (1 - t);
            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    _spawnPickupBurst(pos, pType) {
        const colors = [0xffff00, 0xff8800, 0x44aaff]; // coin, fruit, water
        const color = colors[pType] || 0xffff00;
        const count = pType === 0 ? 6 : 8;

        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const speed = 2 + Math.random() * 2;
            const geo = new THREE.SphereGeometry(0.08, 4, 4);
            const mat = new THREE.MeshBasicMaterial({
                color, transparent: true, opacity: 0.9,
                blending: THREE.AdditiveBlending, depthWrite: false,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(pos);
            this.scene.add(mesh);

            this.flipParticles.push({
                mesh, age: 0, lifetime: 0.3,
                velocity: new THREE.Vector3(
                    Math.cos(angle) * speed,
                    1 + Math.random() * 2,
                    Math.sin(angle) * speed
                )
            });
        }
    }
}
