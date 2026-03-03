/**
 * @module StormTheme
 * Storm weather effect with smooth transitions.
 * Fog, lighting, rain, sound, and lightning strikes that reduce entity size.
 */
import * as THREE from 'three';
import { playSound, playSpatialSound, playSpatialEffect, fadeOutAmbiance, fadeInAmbiance } from '../Sound.js';
import { eventBus } from '../EventBus.js';

const RAIN_COUNT = 500;
const RAIN_SPEED = 25;
const RAIN_AREA = 60;
const RAIN_HEIGHT = 30;
const FADE_IN = 3;   // seconds to reach full intensity
const FADE_OUT = 3;  // seconds to return to normal

// Storm target values (defaults, can be overridden via theme properties)
const STORM_FOG_COLOR = 0x1a1a2e;
const STORM_FOG_DENSITY = 0.045;
const STORM_AMBIENT = 0.25;
const STORM_DIRECTIONAL = 0.3;
const STORM_RAIN_OPACITY = 0.6;

// Lightning config
const LIGHTNING_MIN_INTERVAL = 3;   // seconds between strikes
const LIGHTNING_MAX_INTERVAL = 6;
const LIGHTNING_HIT_RADIUS = 8;     // units — entities within this radius lose size
const LIGHTNING_SIZE_LOSS = 0.15;   // scale reduction per hit
const LIGHTNING_MIN_SIZE = 1.0;     // can't shrink below starting size
const LIGHTNING_FLASH_DURATION = 150; // ms
const LIGHTNING_WARN_DURATION = 1200; // ms — ground warning before bolt drops

// Puddle config
const PUDDLE_MIN_INTERVAL = 4;     // seconds between spawns
const PUDDLE_MAX_INTERVAL = 6;
const PUDDLE_RADIUS = 4;           // units
const PUDDLE_EXPAND_TIME = 0.5;    // seconds — fast pop-up
const PUDDLE_ACTIVE_TIME = 12;     // seconds — full-size active phase
const PUDDLE_DRAIN_TIME = 1.5;     // seconds — shrink and fade
const PUDDLE_MAX_AGE = PUDDLE_EXPAND_TIME + PUDDLE_ACTIVE_TIME + PUDDLE_DRAIN_TIME;
const PUDDLE_TINT_START = 0.05;    // seconds — blue tint warning (instant)
const PUDDLE_ESCAPE_TIME = 0.3;    // seconds — jump instantly or drown
const PUDDLE_DROWN_DURATION = 2.3; // seconds — drowning animation (matches sound)

export const StormTheme = {
    name: 'Storm',
    duration: 30,
    preMessage: { text: 'A storm is coming...', delay: -2 },
    postMessage: { text: 'You survived the storm. The sun is coming out.', delay: 0 },

    // Player appearance during storm — slight blue emissive glow
    playerTheme: {
        roughness: 0.3,
        emissive: 0x223355,
        emissiveIntensity: 0.2
    },

    // Fog settings — configurable per theme
    fog: {
        color: STORM_FOG_COLOR,
        density: STORM_FOG_DENSITY
    },

    // Lighting settings
    lighting: {
        ambient: STORM_AMBIENT,
        directional: STORM_DIRECTIONAL
    },

    _savedFog: null,
    _savedLights: [],
    _rainMesh: null,
    _rainVelocities: null,
    _stormSound: null,
    _stormFog: null,
    _lightningTimer: 0,
    _lightningNextAt: 0,
    _lightningBolts: [],     // active visual bolts
    _flashOverlay: null,
    _botManager: null,
    _deathManager: null,
    _puddles: [],
    _puddleTimer: 0,
    _puddleNextAt: 0,
    _puddleOverlaps: null,   // Map<entityId, seconds>
    _puddleTinted: null,     // Set<entityId> — entities currently tinted blue
    _puddleSinking: null,    // Map<entityId, originalY>
    _drowningEntities: null, // Map<entityId, { elapsed, soundHandle, origY }>
    _bubbleParticles: [],    // active bubble particle meshes
    _scene: null,            // stored scene ref for admin/test spawning

    activate(scene) {
        // Save original state
        this._savedFog = scene.fog;
        this._savedLights = [];
        scene.traverse(obj => {
            if (obj.isAmbientLight || obj.isDirectionalLight) {
                this._savedLights.push({ light: obj, original: obj.intensity });
            }
        });

        // Create storm fog (starts transparent — density 0)
        this._stormFog = new THREE.FogExp2(this.fog.color, 0);
        scene.fog = this._stormFog;

        // Create rain (starts invisible)
        const positions = new Float32Array(RAIN_COUNT * 3);
        this._rainVelocities = new Float32Array(RAIN_COUNT);
        for (let i = 0; i < RAIN_COUNT; i++) {
            positions[i * 3] = (Math.random() - 0.5) * RAIN_AREA;
            positions[i * 3 + 1] = Math.random() * RAIN_HEIGHT;
            positions[i * 3 + 2] = (Math.random() - 0.5) * RAIN_AREA;
            this._rainVelocities[i] = RAIN_SPEED + Math.random() * 5;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0xaaaacc,
            size: 0.15,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this._rainMesh = new THREE.Points(geometry, material);
        scene.add(this._rainMesh);

        // Lightning timer
        this._lightningTimer = 0;
        this._lightningNextAt = LIGHTNING_MIN_INTERVAL + Math.random() * (LIGHTNING_MAX_INTERVAL - LIGHTNING_MIN_INTERVAL);
        this._lightningBolts = [];

        // Flash overlay (screen-wide white flash)
        this._flashOverlay = document.createElement('div');
        this._flashOverlay.style.cssText = 'position:fixed; inset:0; z-index:7000; background:#fff; pointer-events:none; opacity:0; transition:opacity 0.05s;';
        document.body.appendChild(this._flashOverlay);

        // Puddle state
        this._puddles = [];
        this._puddleTimer = 0;
        this._puddleNextAt = PUDDLE_MIN_INTERVAL + Math.random() * (PUDDLE_MAX_INTERVAL - PUDDLE_MIN_INTERVAL);
        this._puddleOverlaps = new Map();
        this._puddleTinted = new Set();
        this._puddleSinking = new Map();
        this._drowningEntities = new Map();
        this._bubbleParticles = [];
        this._scene = scene;

        // Storm ambient sound (starts silent, fades in with storm)
        this._stormSound = playSound('storm', 0);
        this._stormVolume = 0.2; // target max volume

        // Fade out the default ambiance music
        fadeOutAmbiance(3);
    },

    deactivate(scene) {
        // Restore original fog
        scene.fog = this._savedFog;
        this._savedFog = null;
        this._stormFog = null;

        // Restore original light intensities
        for (const entry of this._savedLights) {
            entry.light.intensity = entry.original;
        }
        this._savedLights = [];

        // Remove rain
        if (this._rainMesh) {
            scene.remove(this._rainMesh);
            this._rainMesh.geometry.dispose();
            this._rainMesh.material.dispose();
            this._rainMesh = null;
        }
        this._rainVelocities = null;

        // Remove lightning bolts
        for (const bolt of this._lightningBolts) {
            scene.remove(bolt.mesh);
            bolt.mesh.geometry.dispose();
            bolt.mesh.material.dispose();
        }
        this._lightningBolts = [];

        // Remove flash overlay
        if (this._flashOverlay) {
            this._flashOverlay.remove();
            this._flashOverlay = null;
        }

        // Remove puddles
        for (const puddle of this._puddles) {
            scene.remove(puddle.mesh);
            puddle.mesh.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
        }
        this._puddles = [];

        // Stop drowning sounds, unfreeze entities, clean up
        if (this._drowningEntities) {
            for (const [entityId, state] of this._drowningEntities) {
                if (state.soundHandle) state.soundHandle.stop();
                if (entityId === 'player') eventBus.emit('player:freeze', false);
            }
            this._drowningEntities = null;
        }

        // Clean up bubble particles
        for (const p of this._bubbleParticles) {
            scene.remove(p.mesh);
            p.mesh.geometry.dispose();
            p.mesh.material.dispose();
        }
        this._bubbleParticles = [];

        // Restore tinted/sinking entities
        this._restoreAllEntities();
        this._puddleOverlaps = null;
        this._puddleTinted = null;
        this._puddleSinking = null;
        this._scene = null;

        // Stop storm sound and restore ambiance
        if (this._stormSound) {
            this._stormSound.stop();
            this._stormSound = null;
        }
        fadeInAmbiance(3);
    },

    update(dt, scene, playerPosition, elapsed, remaining) {
        // Compute transition progress: 0->1 fade in, hold at 1, 1->0 fade out
        let t = 1;
        if (elapsed < FADE_IN) {
            t = elapsed / FADE_IN;
        }
        if (remaining < FADE_OUT) {
            t = Math.min(t, remaining / FADE_OUT);
        }
        t = Math.max(0, Math.min(1, t));

        // Smooth easing
        const ease = t * t * (3 - 2 * t); // smoothstep

        // Lerp fog density
        if (this._stormFog) {
            this._stormFog.density = this.fog.density * ease;
        }

        // Lerp light intensities
        for (const entry of this._savedLights) {
            const target = entry.light.isAmbientLight ? this.lighting.ambient : this.lighting.directional;
            entry.light.intensity = entry.original + (target - entry.original) * ease;
        }

        // Lerp rain opacity
        if (this._rainMesh) {
            this._rainMesh.material.opacity = STORM_RAIN_OPACITY * ease;

            // Follow player
            if (playerPosition) {
                this._rainMesh.position.x = playerPosition.x;
                this._rainMesh.position.z = playerPosition.z;
            }

            // Animate rain falling
            const posArr = this._rainMesh.geometry.attributes.position.array;
            for (let i = 0; i < RAIN_COUNT; i++) {
                posArr[i * 3 + 1] -= this._rainVelocities[i] * dt;
                if (posArr[i * 3 + 1] < 0) {
                    posArr[i * 3 + 1] = RAIN_HEIGHT;
                    posArr[i * 3] = (Math.random() - 0.5) * RAIN_AREA;
                    posArr[i * 3 + 2] = (Math.random() - 0.5) * RAIN_AREA;
                }
            }
            this._rainMesh.geometry.attributes.position.needsUpdate = true;
        }

        // Ramp sound volume with storm intensity
        if (this._stormSound) {
            this._stormSound.setVolume(this._stormVolume * ease);
        }

        // Lightning system — only during full intensity (after fade-in, before fade-out)
        if (ease > 0.8) {
            this._lightningTimer += dt;
            if (this._lightningTimer >= this._lightningNextAt) {
                this._lightningTimer = 0;
                this._lightningNextAt = LIGHTNING_MIN_INTERVAL + Math.random() * (LIGHTNING_MAX_INTERVAL - LIGHTNING_MIN_INTERVAL);
                this._spawnLightning(scene, playerPosition);
            }

            // Puddle spawning
            this._puddleTimer += dt;
            if (this._puddleTimer >= this._puddleNextAt) {
                this._puddleTimer = 0;
                this._puddleNextAt = PUDDLE_MIN_INTERVAL + Math.random() * (PUDDLE_MAX_INTERVAL - PUDDLE_MIN_INTERVAL);
                this._spawnPuddle(scene, playerPosition);
            }
        }

        // Update active lightning bolts (fade out)
        for (let i = this._lightningBolts.length - 1; i >= 0; i--) {
            const bolt = this._lightningBolts[i];
            bolt.age += dt;
            if (bolt.age > bolt.lifetime) {
                scene.remove(bolt.mesh);
                bolt.mesh.geometry.dispose();
                bolt.mesh.material.dispose();
                this._lightningBolts.splice(i, 1);
            } else {
                // Fade out bolt
                bolt.mesh.material.opacity = 1 - (bolt.age / bolt.lifetime);
            }
        }

        // Update puddles (animation + overlap checks)
        this._updatePuddles(dt, scene, playerPosition);
    },

    _spawnLightning(scene, playerPosition) {
        // Pick a random entity to strike near (player or any bot)
        const targets = [];
        if (playerPosition) targets.push(playerPosition);
        if (this._botManager) {
            for (const bot of this._botManager.bots) {
                targets.push(bot.mesh.position);
            }
        }
        const target = targets.length > 0
            ? targets[Math.floor(Math.random() * targets.length)]
            : { x: 0, z: 0 };
        const strikeX = target.x + (Math.random() - 0.5) * 20;
        const strikeZ = target.z + (Math.random() - 0.5) * 20;
        this._fireLightning(scene, strikeX, strikeZ);
    },

    strikeLightningAt(scene, x, z) {
        this._fireLightning(scene, x, z);
    },

    _fireLightning(scene, strikeX, strikeZ) {
        // --- Phase 1: Warning glow on the ground ---
        const warnRadius = LIGHTNING_HIT_RADIUS;
        const warnGeo = new THREE.CircleGeometry(warnRadius, 32);
        const warnMat = new THREE.MeshBasicMaterial({
            color: 0xffddaa,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const warnMesh = new THREE.Mesh(warnGeo, warnMat);
        warnMesh.position.set(strikeX, 0.12, strikeZ);
        warnMesh.rotation.x = -Math.PI / 2;
        scene.add(warnMesh);

        // Pulsing warning animation — grows brighter and pulses faster
        const warnStart = performance.now();
        const animateWarn = () => {
            const elapsed = performance.now() - warnStart;
            if (elapsed >= LIGHTNING_WARN_DURATION) return;
            const t = elapsed / LIGHTNING_WARN_DURATION; // 0→1
            // Ramp opacity up with increasing pulse speed
            const pulseSpeed = 8 + t * 20;
            const pulse = 0.5 + 0.5 * Math.sin(elapsed * pulseSpeed / 1000);
            warnMat.opacity = (0.1 + t * 0.35) * pulse;
            // Shrink slightly to feel like it's focusing
            const scale = 1.0 - t * 0.3;
            warnMesh.scale.setScalar(scale);
            requestAnimationFrame(animateWarn);
        };
        requestAnimationFrame(animateWarn);

        // --- Phase 2: After warning delay, fire the actual bolt ---
        setTimeout(() => {
            // Remove warning
            scene.remove(warnMesh);
            warnGeo.dispose();
            warnMat.dispose();

            // Lightning strike sound
            playSpatialEffect('lightning:strike', strikeX, strikeZ);

            // Screen flash
            if (this._flashOverlay) {
                this._flashOverlay.style.opacity = '0.6';
                setTimeout(() => {
                    if (this._flashOverlay) this._flashOverlay.style.opacity = '0.3';
                    setTimeout(() => {
                        if (this._flashOverlay) this._flashOverlay.style.opacity = '0';
                    }, 50);
                }, LIGHTNING_FLASH_DURATION);
            }

            // Create visual bolt
            const boltGeometry = this._createBoltGeometry(strikeX, strikeZ);
            const boltMaterial = new THREE.MeshBasicMaterial({
                color: 0xeeeeff,
                transparent: true,
                opacity: 1,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const boltMesh = new THREE.Mesh(boltGeometry, boltMaterial);
            scene.add(boltMesh);

            this._lightningBolts.push({
                mesh: boltMesh,
                age: 0,
                lifetime: 0.4
            });

            // Ground impact glow
            const glowGeo = new THREE.CircleGeometry(3, 16);
            const glowMat = new THREE.MeshBasicMaterial({
                color: 0xaabbff,
                transparent: true,
                opacity: 0.6,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide
            });
            const glowMesh = new THREE.Mesh(glowGeo, glowMat);
            glowMesh.position.set(strikeX, 0.15, strikeZ);
            glowMesh.rotation.x = -Math.PI / 2;
            scene.add(glowMesh);

            // Fade out ground glow
            const glowStart = performance.now();
            const fadeGlow = () => {
                const el = performance.now() - glowStart;
                if (el < 400) {
                    glowMat.opacity = 0.6 * (1 - el / 400);
                    requestAnimationFrame(fadeGlow);
                } else {
                    scene.remove(glowMesh);
                    glowGeo.dispose();
                    glowMat.dispose();
                }
            };
            requestAnimationFrame(fadeGlow);

            // Emit damage event
            eventBus.emit('lightning:strike', {
                x: strikeX,
                z: strikeZ,
                hitRadius: LIGHTNING_HIT_RADIUS,
                sizeLoss: LIGHTNING_SIZE_LOSS,
                minSize: LIGHTNING_MIN_SIZE
            });
        }, LIGHTNING_WARN_DURATION);
    },

    setDeathManager(dm) {
        this._deathManager = dm;
    },

    spawnPuddleAt(scene, x, z) {
        this._createPuddleMesh(scene, x, z);
    },

    _spawnPuddle(scene, playerPosition) {
        // Pick a random entity to spawn directly under
        const targets = [];
        if (playerPosition) {
            const playerMesh = this._deathManager && this._deathManager.entities
                ? this._deathManager.entities.get('player')?.mesh : null;
            const size = playerMesh ? playerMesh.scale.x : 1;
            targets.push({ x: playerPosition.x, z: playerPosition.z, size });
        }
        if (this._botManager) {
            for (const bot of this._botManager.bots) {
                targets.push({ x: bot.mesh.position.x, z: bot.mesh.position.z, size: bot.mesh.scale.x });
            }
        }
        const target = targets.length > 0
            ? targets[Math.floor(Math.random() * targets.length)]
            : { x: 0, z: 0, size: 1 };
        // Scale puddle radius by entity size (bigger entity = bigger puddle)
        const radius = PUDDLE_RADIUS * Math.max(1, target.size);
        this._createPuddleMesh(scene, target.x, target.z, radius);
    },

    _createPuddleMesh(scene, px, pz, radius) {
        radius = radius || PUDDLE_RADIUS;
        // Create puddle group
        const group = new THREE.Group();

        // Main puddle circle
        const circleGeo = new THREE.CircleGeometry(radius, 32);
        const circleMat = new THREE.MeshBasicMaterial({
            color: 0x2266aa,
            transparent: true,
            opacity: 0.45,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const circle = new THREE.Mesh(circleGeo, circleMat);
        circle.rotation.x = -Math.PI / 2;
        group.add(circle);

        // Edge ripple ring
        const ringGeo = new THREE.RingGeometry(radius * 0.85, radius, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x44aaff,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        group.add(ring);

        group.position.set(px, 0.08, pz);
        group.scale.setScalar(0); // starts invisible, expands
        scene.add(group);

        this._puddles.push({
            mesh: group,
            circleMat,
            ringMat,
            x: px,
            z: pz,
            radius: radius,
            age: 0,
            maxAge: PUDDLE_MAX_AGE,
            expanding: true
        });
    },

    _updatePuddles(dt, scene, playerPosition) {
        const activeEntities = this._gatherEntities(playerPosition);

        for (let i = this._puddles.length - 1; i >= 0; i--) {
            const puddle = this._puddles[i];
            puddle.age += dt;

            // Remove expired puddles
            if (puddle.age >= puddle.maxAge) {
                scene.remove(puddle.mesh);
                puddle.mesh.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) child.material.dispose();
                });
                this._puddles.splice(i, 1);
                continue;
            }

            // Phase animations
            if (puddle.age < PUDDLE_EXPAND_TIME) {
                // Expanding phase: scale 0 → 1
                const t = puddle.age / PUDDLE_EXPAND_TIME;
                puddle.mesh.scale.setScalar(t);
                puddle.expanding = true;
            } else if (puddle.age > PUDDLE_EXPAND_TIME + PUDDLE_ACTIVE_TIME) {
                // Drain phase: shrink + fade
                puddle.expanding = false;
                const drainT = (puddle.age - PUDDLE_EXPAND_TIME - PUDDLE_ACTIVE_TIME) / PUDDLE_DRAIN_TIME;
                puddle.mesh.scale.setScalar(1 - drainT);
                puddle.circleMat.opacity = 0.45 * (1 - drainT);
                puddle.ringMat.opacity = 0.3 * (1 - drainT);
            } else {
                // Active phase — full size with ripple animation
                puddle.expanding = false;
                puddle.mesh.scale.setScalar(1);
                // Ripple: oscillate ring opacity
                const ripple = 0.15 + 0.15 * Math.sin(puddle.age * 4);
                puddle.ringMat.opacity = ripple;
            }
        }

        // Check overlaps only for non-expanding puddles
        this._checkPuddleOverlaps(dt, activeEntities);

        // Update drowning animations
        this._updateDrowning(dt, scene);

        // Update bubble particles
        this._updateBubbles(dt, scene);
    },

    _gatherEntities(playerPosition) {
        const entities = [];
        if (playerPosition) {
            entities.push({ id: 'player', position: playerPosition, mesh: null });
        }
        if (this._botManager) {
            for (const bot of this._botManager.bots) {
                entities.push({ id: bot.id, position: bot.mesh.position, mesh: bot.mesh });
            }
        }
        return entities;
    },

    _checkPuddleOverlaps(dt, entities) {
        if (!this._puddleOverlaps) return;

        // Track which entities are currently in a puddle
        const inPuddle = new Set();

        for (const puddle of this._puddles) {
            if (puddle.expanding) continue; // not active yet
            if (puddle.age > PUDDLE_EXPAND_TIME + PUDDLE_ACTIVE_TIME) continue; // draining

            const r2 = puddle.radius * puddle.radius;

            for (const entity of entities) {
                // Skip entities already in drowning animation
                if (this._drowningEntities && this._drowningEntities.has(entity.id)) continue;

                const dx = entity.position.x - puddle.x;
                const dz = entity.position.z - puddle.z;
                if (dx * dx + dz * dz >= r2) continue;

                // Entity is inside puddle — check if jumping (y > 1.5)
                if (entity.position.y > 1.5) continue;

                inPuddle.add(entity.id);

                // Increment overlap timer
                const prev = this._puddleOverlaps.get(entity.id) || 0;
                const elapsed = prev + dt;
                this._puddleOverlaps.set(entity.id, elapsed);

                // Visual effects based on time in puddle
                const mesh = this._resolveEntityMesh(entity.id);
                if (!mesh) continue;

                if (elapsed >= PUDDLE_TINT_START && !this._puddleTinted.has(entity.id)) {
                    this._applyPuddleTint(entity.id, mesh);
                }

                if (elapsed >= PUDDLE_TINT_START && this._puddleTinted.has(entity.id) && mesh.material) {
                    const tintProgress = Math.min(1, (elapsed - PUDDLE_TINT_START) / (PUDDLE_ESCAPE_TIME - PUDDLE_TINT_START));
                    mesh.material.emissiveIntensity = 0.3 + tintProgress * 0.4;
                }

                // Point of no return — start drowning sequence
                if (elapsed >= PUDDLE_ESCAPE_TIME) {
                    this._startDrowning(entity.id, mesh);
                }
            }
        }

        // Reset timers and restore visuals for entities that left all puddles
        if (this._puddleOverlaps) {
            for (const [entityId, time] of this._puddleOverlaps) {
                if (time > 0 && !inPuddle.has(entityId) &&
                    !(this._drowningEntities && this._drowningEntities.has(entityId))) {
                    this._restoreEntity(entityId);
                    this._puddleOverlaps.set(entityId, 0);
                }
            }
        }
    },

    _resolveEntityMesh(entityId) {
        if (entityId === 'player') {
            // playerPosition is a Vector3 — need the actual mesh from botManager parent or scene
            // We look it up via the scene's children (player mesh has userData.type or name label)
            // Simpler: we can find it through the deathManager's registered entities
            if (this._deathManager && this._deathManager.entities) {
                const entry = this._deathManager.entities.get('player');
                if (entry) return entry.mesh;
            }
            return null;
        }
        if (this._botManager) {
            const bot = this._botManager.bots.find(b => b.id === entityId);
            if (bot) return bot.mesh;
        }
        return null;
    },

    _applyPuddleTint(entityId, mesh) {
        if (!mesh.material || !mesh.material.emissive) return;
        // Save originals if not already saved
        if (!mesh.userData._puddleOrigEmissive) {
            mesh.userData._puddleOrigEmissive = mesh.material.emissive.clone();
            mesh.userData._puddleOrigEmissiveIntensity = mesh.material.emissiveIntensity || 0;
        }
        mesh.material.emissive.set(0x2266cc);
        mesh.material.emissiveIntensity = 0.3;
        this._puddleTinted.add(entityId);
    },

    _restoreEntity(entityId) {
        const mesh = this._resolveEntityMesh(entityId);
        if (mesh && mesh.material && this._puddleTinted && this._puddleTinted.has(entityId)) {
            if (mesh.userData._puddleOrigEmissive) {
                mesh.material.emissive.copy(mesh.userData._puddleOrigEmissive);
                mesh.material.emissiveIntensity = mesh.userData._puddleOrigEmissiveIntensity;
                delete mesh.userData._puddleOrigEmissive;
                delete mesh.userData._puddleOrigEmissiveIntensity;
            }
            this._puddleTinted.delete(entityId);
        }
        if (this._puddleSinking && this._puddleSinking.has(entityId)) {
            if (mesh) {
                mesh.position.y = this._puddleSinking.get(entityId);
            }
            this._puddleSinking.delete(entityId);
        }
    },

    _restoreAllEntities() {
        if (!this._puddleTinted) return;
        for (const entityId of this._puddleTinted) {
            const mesh = this._resolveEntityMesh(entityId);
            if (mesh && mesh.material && mesh.userData._puddleOrigEmissive) {
                mesh.material.emissive.copy(mesh.userData._puddleOrigEmissive);
                mesh.material.emissiveIntensity = mesh.userData._puddleOrigEmissiveIntensity;
                delete mesh.userData._puddleOrigEmissive;
                delete mesh.userData._puddleOrigEmissiveIntensity;
            }
        }
        if (this._puddleSinking) {
            for (const [entityId, origY] of this._puddleSinking) {
                const mesh = this._resolveEntityMesh(entityId);
                if (mesh) mesh.position.y = origY;
            }
        }
    },

    _startDrowning(entityId, mesh) {
        if (!this._drowningEntities) return;
        if (this._drowningEntities.has(entityId)) return;

        // Play drowning sound spatially
        const sx = mesh.position.x;
        const sz = mesh.position.z;
        const soundHandle = playSpatialSound('drowning', 0.4, sx, sz);

        // Freeze the entity in place
        if (entityId === 'player') {
            eventBus.emit('player:freeze', true);
        } else if (this._botManager) {
            const bot = this._botManager.bots.find(b => b.id === entityId);
            if (bot && bot.body) {
                bot.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
                bot.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            }
        }

        this._drowningEntities.set(entityId, {
            elapsed: 0,
            soundHandle,
            origY: mesh.position.y
        });
    },

    _updateDrowning(dt, scene) {
        if (!this._drowningEntities) return;

        for (const [entityId, state] of this._drowningEntities) {
            state.elapsed += dt;
            const progress = Math.min(1, state.elapsed / PUDDLE_DROWN_DURATION);

            const mesh = this._resolveEntityMesh(entityId);
            if (!mesh) {
                // Entity gone — unfreeze player if needed
                if (entityId === 'player') eventBus.emit('player:freeze', false);
                this._drowningEntities.delete(entityId);
                continue;
            }

            // Keep entity frozen each frame (bot AI tries to move)
            if (entityId !== 'player' && this._botManager) {
                const bot = this._botManager.bots.find(b => b.id === entityId);
                if (bot && bot.body) {
                    bot.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
                }
            }

            // Progressive sinking — sink up to 0.6 units down
            mesh.position.y = state.origY - 0.6 * progress;

            // Intensify blue tint
            if (mesh.material && mesh.material.emissive) {
                mesh.material.emissive.set(0x2266cc);
                mesh.material.emissiveIntensity = 0.7 + progress * 0.3;
            }

            // Squint eyes in distress
            if (mesh.userData?.eyePhysics) {
                mesh.userData.eyePhysics.painSquint = 0.5 + progress * 0.4;
            }

            // Spawn bubble particles periodically (every ~0.15s)
            if (Math.floor(state.elapsed / 0.15) > Math.floor((state.elapsed - dt) / 0.15)) {
                this._spawnBubbles(mesh, scene, 2 + Math.floor(progress * 3));
            }

            // Drowning complete — kill entity and unfreeze
            if (state.elapsed >= PUDDLE_DROWN_DURATION) {
                if (entityId === 'player') {
                    eventBus.emit('player:freeze', false);
                }
                if (this._deathManager) {
                    this._deathManager.killEntity(entityId, 'puddle');
                }
                eventBus.emit('puddle:drown', { entityId });
                this._restoreEntity(entityId);
                this._puddleOverlaps.set(entityId, 0);
                this._drowningEntities.delete(entityId);
            }
        }
    },

    _spawnBubbles(mesh, scene, count) {
        for (let i = 0; i < count; i++) {
            const size = 0.06 + Math.random() * 0.08;
            const geo = new THREE.SphereGeometry(size, 6, 4);
            const mat = new THREE.MeshBasicMaterial({
                color: Math.random() > 0.4 ? 0x88ccff : 0xffffff,
                transparent: true,
                opacity: 0.7,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const bubble = new THREE.Mesh(geo, mat);
            // Spawn around the entity with some random offset
            bubble.position.set(
                mesh.position.x + (Math.random() - 0.5) * 0.8,
                mesh.position.y + Math.random() * 0.3,
                mesh.position.z + (Math.random() - 0.5) * 0.8
            );
            scene.add(bubble);

            this._bubbleParticles.push({
                mesh: bubble,
                geo,
                mat,
                vy: 1.5 + Math.random() * 2,        // rise speed
                vx: (Math.random() - 0.5) * 0.5,     // slight drift
                vz: (Math.random() - 0.5) * 0.5,
                life: 0,
                maxLife: 0.5 + Math.random() * 0.6
            });
        }
    },

    _updateBubbles(dt, scene) {
        for (let i = this._bubbleParticles.length - 1; i >= 0; i--) {
            const p = this._bubbleParticles[i];
            p.life += dt;
            if (p.life >= p.maxLife) {
                scene.remove(p.mesh);
                p.geo.dispose();
                p.mat.dispose();
                this._bubbleParticles.splice(i, 1);
                continue;
            }
            const t = p.life / p.maxLife;
            p.mesh.position.y += p.vy * dt;
            p.mesh.position.x += p.vx * dt;
            p.mesh.position.z += p.vz * dt;
            p.mat.opacity = 0.7 * (1 - t);
            // Bubbles grow slightly as they rise
            p.mesh.scale.setScalar(1 + t * 0.5);
        }
    },

    _createBoltGeometry(targetX, targetZ) {
        // Build a jagged bolt from high up down to the strike point
        const startY = 40;
        const endY = 0.5;
        const segments = 8 + Math.floor(Math.random() * 4);
        const width = 0.3;

        const vertices = [];
        const indices = [];

        let x = targetX + (Math.random() - 0.5) * 5;
        let z = targetZ + (Math.random() - 0.5) * 5;

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const y = startY + (endY - startY) * t;

            // Jagged offset (more at middle, less at endpoints)
            const jitter = Math.sin(t * Math.PI) * 3;
            const offX = i === 0 || i === segments ? 0 : (Math.random() - 0.5) * jitter;
            const offZ = i === 0 || i === segments ? 0 : (Math.random() - 0.5) * jitter;

            const px = x + offX + (targetX - x) * t;
            const pz = z + offZ + (targetZ - z) * t;

            // Two vertices per segment point (left/right for width)
            const idx = i * 2;
            vertices.push(px - width, y, pz);
            vertices.push(px + width, y, pz);

            if (i < segments) {
                const next = (i + 1) * 2;
                indices.push(idx, idx + 1, next);
                indices.push(idx + 1, next + 1, next);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        return geometry;
    }
};
