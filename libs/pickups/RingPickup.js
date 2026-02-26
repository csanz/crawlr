/**
 * @module RingPickup
 * Ring obstacle pickup handler — ported from PowerRingManager.js + PowerRing.js.
 * Jump through for tail growth reward. Walk into for tail penalty + freeze.
 * Auto-despawns after ~10 seconds.
 */
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d';
import { BasePickup } from './BasePickup.js';
import { MAX_RINGS, RING_SPAWN_AREA_XZ, RING_STAMINA_PENALTY } from '../PhysicsConfig.js';
import { eventBus } from '../EventBus.js';
import { playEffect } from '../Sound.js';

// Ring color palette
const RING_COLORS = [0xff4444, 0xff8800, 0xcc44ff, 0xff2266, 0xffaa00];

// Cooldown per entity to avoid draining all segments in one pass-through
const HIT_COOLDOWN = 1.5; // seconds

// Particle settings
const PARTICLE_COUNT = 24;
const PARTICLE_LIFETIME = 0.8; // seconds

// Fade-out duration for graceful disappearance
const FADE_OUT_DURATION = 0.8; // seconds
const DESPAWN_FADE_START = 1.5; // seconds before despawn to begin fading

export class RingPickup extends BasePickup {
    constructor(scene, world) {
        super(scene, world);

        // Per-entity hit cooldowns: Map<entityId, remaining seconds>
        this.hitCooldowns = new Map();

        // Active particle effects
        this.particles = [];

        // Handles already processed (prevent double-fire)
        this.processedHandles = new Set();

        // External references
        this.botManager = null;
        this._playerMesh = null;
        this._playerTail = null;

        // Screen shake state
        this._shaking = false;
        this._shakeRaf = null;
    }

    static get config() {
        return {
            type: 'ring',
            maxCount: MAX_RINGS,
            spawnAreaXZ: RING_SPAWN_AREA_XZ,
            spawnHeight: 4.5,
            despawnAfter: 10, // auto-despawn after 10 seconds
            radarColor: null, // per-instance color
            radarShape: 'ring'
        };
    }

    setBotManager(botManager) {
        this.botManager = botManager;
    }

    setPlayerMesh(mesh) {
        this._playerMesh = mesh;
    }

    setPlayerTail(tail) {
        this._playerTail = tail;
    }

    create(position) {
        const color = RING_COLORS[Math.floor(Math.random() * RING_COLORS.length)];
        const group = new THREE.Group();

        // Upright torus
        const torusGeo = new THREE.TorusGeometry(3.0, 0.2, 16, 32);
        const torusMat = new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.4,
            roughness: 0.3,
            metalness: 0.7
        });
        const torus = new THREE.Mesh(torusGeo, torusMat);
        torus.castShadow = true;
        group.add(torus);

        // Glow torus
        const glowGeo = new THREE.TorusGeometry(3.0, 0.4, 16, 32);
        const glowMat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.15,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        group.add(glow);

        group.position.copy(position);
        group.position.y = 4.5;
        this.scene.add(group);

        // Physics body (kinematic, doesn't fall)
        const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(position.x, 4.5, position.z);
        const body = this.world.createRigidBody(bodyDesc);

        // Sensor collider
        const colliderDesc = RAPIER.ColliderDesc.cuboid(3.0, 3.0, 0.35)
            .setSensor(true)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
            .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
        const collider = this.world.createCollider(colliderDesc, body);
        collider.userData = { type: 'ring', mesh: group, color };

        return { mesh: group, body, color, spawnedAt: performance.now() * 0.001 };
    }

    updateInstance(instance, time, dt) {
        // Pronounced bounce + rotation (base 4.5 keeps ring bottom above ground: 4.5 - 1.2 - 3.2 = 0.1)
        instance.mesh.position.y = 4.5 + Math.sin(time * 0.8 + instance.mesh.position.x) * 1.2;
        instance.mesh.rotation.y += 0.005;

        // Graceful fade near auto-despawn
        const config = RingPickup.config;
        if (config.despawnAfter && instance.spawnedAt) {
            const age = time - instance.spawnedAt;
            const fadeStart = config.despawnAfter - DESPAWN_FADE_START;
            if (age > fadeStart) {
                const t = Math.max(0, 1 - (age - fadeStart) / DESPAWN_FADE_START);
                this._setRingOpacity(instance.mesh, t);
                const s = 0.6 + t * 0.4; // shrink from 1.0 to 0.6
                instance.mesh.scale.setScalar(s);
            }
        }

        // Sync physics body position for sensor collider
        if (instance.body) {
            instance.body.setNextKinematicTranslation({
                x: instance.mesh.position.x,
                y: instance.mesh.position.y,
                z: instance.mesh.position.z
            });
        }
    }

    onCollect(entityId, instance, context) {
        const handle = instance.body ? instance.body.handle : null;

        // Skip if on cooldown or already processed
        if (this.hitCooldowns.has(entityId)) return { consumed: false };
        if (handle != null && this.processedHandles.has(handle)) return { consumed: false };

        let tail = null;
        let entityMesh = null;
        let isJumping = false;

        if (entityId === 'player') {
            tail = this._playerTail;
            entityMesh = this._playerMesh;
            isJumping = entityMesh && entityMesh.position.y > 1.2;
        } else if (this.botManager) {
            const bot = this.botManager.bots.find(b => b.id === entityId);
            if (bot) {
                tail = bot.tail;
                entityMesh = bot.mesh;
                isJumping = bot.mesh && bot.mesh.position.y > 1.2;
            }
        }

        // Check if entity is actually near the torus body vs passing through the center hole.
        // Torus major radius = 3.0, tube = 0.2. Transform entity to ring's local space,
        // measure distance to the ring circle. Only trigger if close to the actual ring body.
        const touchingRing = this._isTouchingTorusBody(entityMesh, instance.mesh);

        if (!touchingRing && isJumping) {
            // Clean pass through the center — reward path
            if (handle != null) this.processedHandles.add(handle);
            if (instance.body) {
                this.world.removeRigidBody(instance.body);
                instance.body = null;
            }
            this.hitCooldowns.set(entityId, HIT_COOLDOWN);

            return {
                consumed: false,
                deferred: {
                    mode: 'passing',
                    landed: false,
                    celebrateTimer: 0.2,
                    safetyTimer: 3.0,
                    entityId,
                    tail,
                    entityMesh,
                    ring: instance,
                    handle
                }
            };
        }

        if (!touchingRing) {
            // Not touching ring and not jumping through — ignore
            return { consumed: false };
        }

        // --- Hitting the ring body ---
        if (handle != null) {
            this.processedHandles.add(handle);
        }

        // Remove physics body so it won't re-trigger
        if (instance.body) {
            this.world.removeRigidBody(instance.body);
            instance.body = null;
        }

        this.hitCooldowns.set(entityId, HIT_COOLDOWN);

        if (isJumping) {
            // Freeze mid-air + shake for dramatic effect
            if (entityId === 'player') {
                eventBus.emit('player:freeze', true);
                this._startScreenShake(instance.mesh);
                playEffect('ring:hit');
            }
            eventBus.emit('ring:shocked', { entityId });

            return {
                consumed: false,
                deferred: {
                    mode: 'airFreeze',
                    freezeTimer: 0.35,
                    landed: false,
                    celebrateTimer: 0.2,
                    safetyTimer: 3.0,
                    entityId,
                    tail,
                    entityMesh,
                    ring: instance,
                    handle
                }
            };
        } else {
            // Freeze player
            if (entityId === 'player') {
                eventBus.emit('player:freeze', true);
                this._startScreenShake(instance.mesh);
                playEffect('ring:hit');
            }
            eventBus.emit('ring:shocked', { entityId });

            // Subtle glow increase
            instance.mesh.traverse(child => {
                if (child.material && child.material.emissiveIntensity !== undefined) {
                    child.material.emissiveIntensity = 0.8;
                }
            });

            // Spawn hit particles
            this._spawnHitEffect(instance.mesh.position.clone(), instance.color);

            return {
                consumed: false,
                deferred: {
                    mode: 'stunned',
                    timer: 0.4,
                    entityId,
                    tail,
                    entityMesh,
                    ring: instance,
                    handle
                }
            };
        }
    }

    updateDeferred(data, dt) {
        // Mid-air freeze: hold in place briefly, then unfreeze and wait for landing
        if (data.mode === 'airFreeze') {
            data.freezeTimer -= dt;
            if (data.freezeTimer <= 0) {
                const { entityId, tail } = data;

                // Unfreeze and stop shake
                if (entityId === 'player') {
                    eventBus.emit('player:freeze', false);
                    this._stopScreenShake();
                }

                // Penalty — you hit the ring, not passed through cleanly
                if (tail && tail.getLength() > 0) {
                    const segmentsToRemove = Math.min(RING_STAMINA_PENALTY, tail.getLength());
                    tail.removeLastSegments(segmentsToRemove);
                    eventBus.emit('ring:hit', {
                        entityId,
                        segmentsLost: segmentsToRemove,
                        remaining: tail.getLength()
                    });
                }

                // Transition to fade-out
                data.mode = 'fadeOut';
                data.fadeTimer = FADE_OUT_DURATION;
            }
            return false;
        }

        if (data.mode === 'passing') {
            data.safetyTimer -= dt;

            // Wait for entity to land (y drops below 1.2) or safety timeout
            if (!data.landed) {
                const y = data.entityMesh ? data.entityMesh.position.y : 0;
                if (y < 1.2 || data.safetyTimer <= 0) {
                    data.landed = true;
                }
                return false;
            }

            // Brief pause after landing, then celebrate
            data.celebrateTimer -= dt;
            if (data.celebrateTimer > 0 && data.safetyTimer > 0) {
                return false;
            }

            const { ring, entityId, tail, entityMesh, handle } = data;
            const ringPos = ring.mesh.position.clone();

            // Success celebration effect
            this._spawnSuccessEffect(ringPos);
            this._spawnShockwave(ringPos, ring.color);

            // Reward tail growth
            if (tail) {
                const segmentsToAdd = RING_STAMINA_PENALTY;
                const pos = entityMesh ? entityMesh.position.clone() : undefined;
                for (let i = 0; i < segmentsToAdd; i++) {
                    tail.addSegment(pos);
                }

                // Flash player with ring color, then pulse back
                if (entityMesh && entityMesh.material) {
                    const origColor = entityMesh.material.color.clone();
                    const origEmissive = entityMesh.material.emissive ? entityMesh.material.emissive.clone() : new THREE.Color(0);
                    const origEmissiveIntensity = entityMesh.material.emissiveIntensity || 0;

                    entityMesh.material.color.set(ring.color);
                    entityMesh.material.emissive = new THREE.Color(ring.color);
                    entityMesh.material.emissiveIntensity = 0.6;

                    // Pulse back over 500ms
                    const start = performance.now();
                    const pulseBack = () => {
                        const elapsed = performance.now() - start;
                        const t = Math.min(1, elapsed / 500);
                        const ease = t * t; // ease-in
                        if (entityMesh.material) {
                            entityMesh.material.color.lerpColors(new THREE.Color(ring.color), origColor, ease);
                            entityMesh.material.emissiveIntensity = 0.6 * (1 - ease) + origEmissiveIntensity * ease;
                            if (t >= 1) {
                                entityMesh.material.emissive.copy(origEmissive);
                                entityMesh.material.emissiveIntensity = origEmissiveIntensity;
                                return;
                            }
                        }
                        requestAnimationFrame(pulseBack);
                    };
                    requestAnimationFrame(pulseBack);
                }

                eventBus.emit('ring:jumped', {
                    entityId,
                    segmentsGained: segmentsToAdd,
                    total: tail.getLength()
                });
            }

            // Transition to graceful fade-out instead of instant removal
            data.mode = 'fadeOut';
            data.fadeTimer = FADE_OUT_DURATION;
            return false;
        }

        if (data.mode === 'stunned') {
            data.timer -= dt;
            // Fade the ring out during the hold
            if (data.ring.mesh) {
                const t = Math.max(0, data.timer / 0.4);
                data.ring.mesh.traverse(child => {
                    if (child.material && child.material.opacity !== undefined) {
                        child.material.transparent = true;
                        child.material.opacity = t;
                    }
                });
            }

            if (data.timer <= 0) {
                const { entityId, tail } = data;

                // Remove tail segments
                if (tail && tail.getLength() > 0) {
                    const segmentsToRemove = Math.min(RING_STAMINA_PENALTY, tail.getLength());
                    tail.removeLastSegments(segmentsToRemove);

                    eventBus.emit('ring:hit', {
                        entityId,
                        segmentsLost: segmentsToRemove,
                        remaining: tail.getLength()
                    });
                }

                // Unfreeze and stop shake
                if (entityId === 'player') {
                    eventBus.emit('player:freeze', false);
                    this._stopScreenShake();
                }

                // Transition to graceful fade-out
                data.mode = 'fadeOut';
                data.fadeTimer = FADE_OUT_DURATION;
            }
            return false;
        }

        // Graceful fade-out: shrink + fade opacity, then dispose
        if (data.mode === 'fadeOut') {
            data.fadeTimer -= dt;
            const t = Math.max(0, data.fadeTimer / FADE_OUT_DURATION);
            const { ring, handle } = data;

            if (ring.mesh) {
                this._setRingOpacity(ring.mesh, t);
                const s = 0.5 + t * 0.5; // shrink from 1.0 to 0.5
                ring.mesh.scale.setScalar(s);
            }

            if (data.fadeTimer <= 0) {
                if (ring.mesh) {
                    this.scene.remove(ring.mesh);
                    ring.mesh.traverse(child => {
                        if (child.geometry) child.geometry.dispose();
                        if (child.material) child.material.dispose();
                    });
                }
                if (handle != null) this.processedHandles.delete(handle);
                return true; // done
            }
            return false;
        }

        return true;
    }

    updateGlobal(dt) {
        // Tick cooldowns
        for (const [entityId, remaining] of this.hitCooldowns) {
            const newVal = remaining - dt;
            if (newVal <= 0) {
                this.hitCooldowns.delete(entityId);
            } else {
                this.hitCooldowns.set(entityId, newVal);
            }
        }

        // Animate particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.age += dt;
            if (p.age >= p.lifetime) {
                this.scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
                this.particles.splice(i, 1);
                continue;
            }
            const t = p.age / p.lifetime;
            p.mesh.position.addScaledVector(p.velocity, dt);
            p.velocity.y -= 4 * dt; // gravity
            p.mesh.material.opacity = 1 - t;
            const s = p.startScale * (1 - t * 0.5);
            p.mesh.scale.setScalar(s);
        }
    }

    getRadarInfo(instance) {
        const colorHex = '#' + instance.color.toString(16).padStart(6, '0');
        return {
            x: instance.mesh.position.x,
            z: instance.mesh.position.z,
            color: colorHex,
            type: 'ring'
        };
    }

    // --- Stubs kept for API compatibility (powers removed) ---
    hasPower() { return false; }
    getActivePower() { return null; }
    deactivatePower() {}

    _isTouchingTorusBody(entityMesh, ringGroup) {
        if (!entityMesh || !ringGroup) return true; // fallback: assume touching
        const MAJOR_RADIUS = 3.0;
        const TOUCH_THRESHOLD = 1.0; // player half-size (0.5) + tube (0.2) + tolerance (0.3)

        // Get entity position in ring's local space
        const dx = entityMesh.position.x - ringGroup.position.x;
        const dy = entityMesh.position.y - ringGroup.position.y;
        const dz = entityMesh.position.z - ringGroup.position.z;

        // Ring rotates around Y — undo that rotation to get into local space
        const angle = -ringGroup.rotation.y;
        const lx = dx * Math.cos(angle) - dz * Math.sin(angle);
        const lz = dx * Math.sin(angle) + dz * Math.cos(angle);
        const ly = dy;

        // Torus lies in the XY plane (default THREE.TorusGeometry orientation).
        // Distance from entity to the ring circle (radius 3.0) in the XY plane:
        const distInPlane = Math.sqrt(lx * lx + ly * ly);
        const distToRing = Math.abs(distInPlane - MAJOR_RADIUS);

        return distToRing < TOUCH_THRESHOLD;
    }

    _setRingOpacity(group, opacity) {
        group.traverse(child => {
            if (!child.material) return;
            child.material.transparent = true;
            child.material.opacity = child.material.blending === THREE.AdditiveBlending
                ? opacity * 0.15  // glow mesh baseline is 0.15
                : opacity;
        });
    }

    _spawnSuccessEffect(position) {
        const colors = [0x44ff44, 0xffdd00, 0x88ff88, 0xffff66];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const color = colors[Math.floor(Math.random() * colors.length)];
            const geo = new THREE.SphereGeometry(0.12, 6, 6);
            const mat = new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 1,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(position);

            const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
            const speed = 3 + Math.random() * 4;
            const velocity = new THREE.Vector3(
                Math.cos(angle) * speed,
                2 + Math.random() * 3,
                Math.sin(angle) * speed
            );

            const startScale = 0.8 + Math.random() * 0.6;
            mesh.scale.setScalar(startScale);
            this.scene.add(mesh);

            this.particles.push({
                mesh, velocity, age: 0,
                lifetime: PARTICLE_LIFETIME + Math.random() * 0.3,
                startScale
            });
        }
    }

    _startScreenShake(ringMesh) {
        if (this._shaking) return;
        this._shaking = true;

        // Red flash overlay for impact
        const flash = document.createElement('div');
        flash.style.cssText = 'position:fixed;inset:0;z-index:7000;background:red;pointer-events:none;opacity:0.3;';
        document.body.appendChild(flash);
        this._flashOverlay = flash;

        // Save ring original position for shake
        this._shakeRingMesh = ringMesh || null;
        this._shakeRingOrigin = ringMesh ? ringMesh.position.clone() : null;

        const body = document.body;
        const intensity = 6; // pixels — strong shake
        const shake = () => {
            if (!this._shaking) {
                body.style.transform = '';
                // Clean up flash
                if (this._flashOverlay) {
                    this._flashOverlay.remove();
                    this._flashOverlay = null;
                }
                // Reset ring position
                if (this._shakeRingMesh && this._shakeRingOrigin) {
                    this._shakeRingMesh.position.copy(this._shakeRingOrigin);
                    this._shakeRingMesh = null;
                    this._shakeRingOrigin = null;
                }
                return;
            }
            const x = (Math.random() - 0.5) * 2 * intensity;
            const y = (Math.random() - 0.5) * 2 * intensity;
            body.style.transform = `translate(${x}px, ${y}px)`;

            // Shake the ring mesh too
            if (this._shakeRingMesh && this._shakeRingOrigin) {
                this._shakeRingMesh.position.x = this._shakeRingOrigin.x + (Math.random() - 0.5) * 0.8;
                this._shakeRingMesh.position.z = this._shakeRingOrigin.z + (Math.random() - 0.5) * 0.8;
            }

            // Pulse flash opacity
            if (this._flashOverlay) {
                this._flashOverlay.style.opacity = (0.15 + Math.random() * 0.2).toString();
            }

            this._shakeRaf = requestAnimationFrame(shake);
        };
        this._shakeRaf = requestAnimationFrame(shake);
    }

    _stopScreenShake() {
        this._shaking = false;
        document.body.style.transform = '';
    }

    _spawnShockwave(position, color) {
        // Expanding ring of light at the ring's position
        const ringGeo = new THREE.RingGeometry(0.5, 1.0, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.copy(position);
        ringMesh.rotation.x = -Math.PI / 2;
        this.scene.add(ringMesh);

        const start = performance.now();
        const duration = 600; // ms
        const expand = () => {
            const elapsed = performance.now() - start;
            const t = Math.min(1, elapsed / duration);
            const ease = 1 - (1 - t) * (1 - t); // ease-out

            const scale = 1 + ease * 8; // expand from 1x to 9x
            ringMesh.scale.setScalar(scale);
            ringMat.opacity = 0.8 * (1 - t);

            if (t < 1) {
                requestAnimationFrame(expand);
            } else {
                this.scene.remove(ringMesh);
                ringGeo.dispose();
                ringMat.dispose();
            }
        };
        requestAnimationFrame(expand);
    }

    _spawnHitEffect(position, ringColor) {
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const geo = new THREE.BoxGeometry(0.15, 0.15, 0.04);
            const mat = new THREE.MeshBasicMaterial({
                color: i % 3 === 0 ? 0xff2222 : ringColor,
                transparent: true,
                opacity: 1,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(position);
            mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

            const velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 8,
                Math.random() * 4,
                (Math.random() - 0.5) * 8
            );

            const startScale = 0.6 + Math.random() * 0.5;
            mesh.scale.setScalar(startScale);
            this.scene.add(mesh);

            this.particles.push({
                mesh, velocity, age: 0,
                lifetime: PARTICLE_LIFETIME * 0.7 + Math.random() * 0.3,
                startScale
            });
        }
    }
}
