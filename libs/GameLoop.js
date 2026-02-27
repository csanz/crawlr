/**
 * @module GameLoop
 * Orchestrates the main game loop: physics, rendering, and all subsystem updates.
 */
import * as THREE from 'three';
import { createLogger } from './Logger.js';
import { updatePlayerMovement, applyJumpGravity, targetPlayerQuaternion, updatePlayerGlow, glowState, updateEyePhysics } from './Player.js';
import { updatePositionHistory, updateTailPositions, getPlayerTail, syncPlayerGlowState } from './Tail.js';
import { updateCameraFollow, updateCameraOrbit, updateAutoFollow, stepOrbitLeft, stepOrbitRight, cycleZoom, cycleAngle } from './CameraSetup.js';
import { toggleMute } from './Sound.js';
import { updateLightPosition } from './Lighting.js';
import { drawRadar } from './Radar.js';
import { SpeedParticleSystem } from './SpeedParticles.js';
import { moveState } from './InputHandler.js';
import { updateSprint, getSprintState } from './SprintSystem.js';
import { drawSprintHUD } from './SprintHUD.js';
import { updateScoreHUD } from './ScoreHUD.js';
import { eventBus } from './EventBus.js';
import { updatePlayerList } from './PlayerList.js';
import { updateLeaderboardStats } from './Leaderboard.js';
import { updatePowerUpHUD } from './PowerUpHUD.js';
import { updateRoundHUD } from './RoundHUD.js';
import { playEffect, playSound } from './Sound.js';
import { updateClouds } from './Clouds.js';

const log = createLogger('GameLoop');

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
            if (data.entityId === 'player') {
                setTimeout(() => playSound('squeel', 0.25), 400);
            }
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
            if (moveState.muteTrigger) {
                moveState.muteTrigger = false;
                toggleMute();
            }
            if (moveState.cameraLeftTrigger) {
                moveState.cameraLeftTrigger = false;
                stepOrbitLeft();
            }
            if (moveState.cameraRightTrigger) {
                moveState.cameraRightTrigger = false;
                stepOrbitRight();
            }

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
            updateCameraFollow(this.camera, this.controls, this.playerMesh, this.cameraLookAtOffset);

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
            eventBus.emit('entity:move', {
                id: 'player',
                x: this.playerMesh.position.x,
                z: this.playerMesh.position.z,
                angle: 0,
                sprinting: moveState.run > 0
            });

            // Render
            this.renderer.render(this.scene, this.camera);

            if (this.stats && window.statsEnabled) {
                this.stats.end();
            }

        } catch (err) {
            log.error('Game loop error', err);
        }

        requestAnimationFrame(this.loop);
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
                // Bigger entities have a slightly larger effective hit radius
                const playerHitRadius = hitRadius * Math.sqrt(this.playerMesh.scale.x);
                if (dist < playerHitRadius) {
                    const newScale = Math.max(minSize, this.playerMesh.scale.x - sizeLoss);
                    this.playerMesh.scale.setScalar(newScale);

                    // Remove tail segments
                    const playerTail = getPlayerTail();
                    if (playerTail) {
                        playerTail.removeLastSegments(3);
                    }

                    // Electric arc particles + screen shake + sound
                    this._spawnElectricArcs(this.playerMesh);
                    this._startLightningShake();
                    playEffect('lightning:hit');
                    setTimeout(() => playSound('squeel', 0.25), 400);

                    eventBus.emit('lightning:hit', { entityId: 'player', newSize: newScale });
                }
            }
        }

        // Check bots
        if (this.botManager) {
            for (const bot of this.botManager.bots) {
                const botShielded = ringHandler && ringHandler.hasPower(bot.id, 'SHIELD');
                const botSheltered = this._isUnderTree(bot.mesh.position);
                if (botShielded || botSheltered) continue;

                const dx = bot.mesh.position.x - x;
                const dz = bot.mesh.position.z - z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                const botHitRadius = hitRadius * Math.sqrt(bot.mesh.scale.x);
                if (dist < botHitRadius) {
                    const newScale = Math.max(minSize, bot.mesh.scale.x - sizeLoss);
                    bot.mesh.scale.setScalar(newScale);

                    if (bot.tail) {
                        bot.tail.removeLastSegments(3);
                    }

                    this._spawnElectricArcs(bot.mesh);
                    eventBus.emit('lightning:hit', { entityId: bot.id, newSize: newScale });
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
                    mesh.material.emissive.copy(origEmissive).lerp(new THREE.Color(0x88bbff), 1 - t);
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
}
