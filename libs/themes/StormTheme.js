/**
 * @module StormTheme
 * Storm weather effect with smooth transitions.
 * Fog, lighting, rain, sound, and lightning strikes that reduce entity size.
 */
import * as THREE from 'three';
import { playSound, playEffect } from '../Sound.js';
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

        // Storm ambient sound (starts silent, fades in with storm)
        this._stormSound = playSound('storm', 0);
        this._stormVolume = 0.4; // target max volume
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

        // Stop sound
        if (this._stormSound) {
            this._stormSound.stop();
            this._stormSound = null;
        }
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
    },

    _spawnLightning(scene, playerPosition) {
        // Pick strike position: near player with some randomness
        const strikeX = (playerPosition ? playerPosition.x : 0) + (Math.random() - 0.5) * 40;
        const strikeZ = (playerPosition ? playerPosition.z : 0) + (Math.random() - 0.5) * 40;
        const strikeY = 0.5; // ground level

        // Lightning strike sound effect
        playEffect('lightning:strike');

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

        // Create visual bolt (jagged line from sky to ground)
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
            lifetime: 0.4 // seconds visible
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
            const elapsed = performance.now() - glowStart;
            if (elapsed < 400) {
                glowMat.opacity = 0.6 * (1 - elapsed / 400);
                requestAnimationFrame(fadeGlow);
            } else {
                scene.remove(glowMesh);
                glowGeo.dispose();
                glowMat.dispose();
            }
        };
        requestAnimationFrame(fadeGlow);

        // Emit lightning event with strike position for damage
        eventBus.emit('lightning:strike', {
            x: strikeX,
            z: strikeZ,
            hitRadius: LIGHTNING_HIT_RADIUS,
            sizeLoss: LIGHTNING_SIZE_LOSS,
            minSize: LIGHTNING_MIN_SIZE
        });
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
