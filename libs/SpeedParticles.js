/**
 * @module SpeedParticles
 * Particle effects emitted behind the player when sprinting.
 */
import * as THREE from 'three';
import { moveState } from './InputHandler.js';
import { TAIL_SEGMENT_COLOR } from './PhysicsConfig.js';

// Configuration for speed particles
const MAX_PARTICLES = 40;
const PARTICLE_SPAWN_RATE = 0.1;
const PARTICLE_SIZE_RANGE = [0.05, 0.15];
const PARTICLE_LIFE_RANGE = [0.3, 1.0];
const PARTICLE_SPEED_RANGE = [0.3, 0.8];
const PARTICLE_COLORS = [
    new THREE.Color(TAIL_SEGMENT_COLOR),
    new THREE.Color(0xFFFFFF),
    new THREE.Color(0x00FFCC)
];

// Pre-allocated reusable vectors
const _spawnDir = new THREE.Vector3();
const _spawnPos = new THREE.Vector3();

export class SpeedParticleSystem {
    /**
     * @param {THREE.Scene} scene - The scene to add particle systems to
     * @param {THREE.Mesh} playerMesh - The player mesh (particles spawn relative to it)
     */
    constructor(scene, playerMesh) {
        this.scene = scene;
        this.playerMesh = playerMesh;
        this.particles = [];
        this.particleGroup = new THREE.Group();
        scene.add(this.particleGroup);

        this.materials = [
            new THREE.PointsMaterial({
                color: PARTICLE_COLORS[0],
                size: PARTICLE_SIZE_RANGE[1],
                transparent: true,
                opacity: 0.7,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
            new THREE.PointsMaterial({
                color: PARTICLE_COLORS[1],
                size: PARTICLE_SIZE_RANGE[0] * 1.5,
                transparent: true,
                opacity: 0.5,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
            new THREE.PointsMaterial({
                color: PARTICLE_COLORS[2],
                size: PARTICLE_SIZE_RANGE[0],
                transparent: true,
                opacity: 0.8,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            })
        ];

        this.particleGeometries = [];
        this.particleSystems = [];

        // Pre-allocate position buffers for each system (reused every frame)
        this._systemPositionBuffers = [];
        this._systemCounts = [];

        for (let i = 0; i < this.materials.length; i++) {
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array(MAX_PARTICLES * 3);
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

            const system = new THREE.Points(geometry, this.materials[i]);
            system.frustumCulled = false;
            this.particleGeometries.push(geometry);
            this.particleSystems.push(system);
            this.particleGroup.add(system);

            // Pre-allocate per-system buffers
            this._systemPositionBuffers.push(new Float32Array(MAX_PARTICLES * 3));
            this._systemCounts.push(0);
        }

        this.lastSpawnTime = 0;
    }

    /**
     * Main update — spawns new particles when sprinting and updates existing ones.
     * @param {{ x: number, y: number, z: number }} playerVelocity - Current player velocity
     * @param {number} deltaTime - Seconds since last frame
     */
    update(playerVelocity, deltaTime) {
        const isRunning = moveState.run;
        const shouldEmit = isRunning &&
                        (Math.abs(playerVelocity.x) > 0.1 || Math.abs(playerVelocity.z) > 0.1);

        const currentTime = performance.now() / 1000;

        if (shouldEmit && (currentTime - this.lastSpawnTime) > PARTICLE_SPAWN_RATE) {
            this.lastSpawnTime = currentTime;
            this.spawnParticles(playerVelocity);
        }

        this.updateParticles(currentTime, deltaTime);
    }

    /**
     * Spawns a small burst of particles behind the player based on velocity direction.
     * @param {{ x: number, y: number, z: number }} playerVelocity - Current player velocity
     * @private
     */
    spawnParticles(playerVelocity) {
        // Reuse pre-allocated vectors
        _spawnDir.set(-playerVelocity.x, 0, -playerVelocity.z).normalize();

        _spawnPos.copy(this.playerMesh.position);
        _spawnPos.x += (Math.random() - 0.5) * 0.5;
        _spawnPos.y += (Math.random() - 0.5) * 0.5 + 0.5;
        _spawnPos.z += (Math.random() - 0.5) * 0.5;

        const particleCount = Math.ceil(Math.random() * 2 + 1);
        const speedRange = PARTICLE_SPEED_RANGE[1] - PARTICLE_SPEED_RANGE[0];
        const sizeRange = PARTICLE_SIZE_RANGE[1] - PARTICLE_SIZE_RANGE[0];
        const lifeRange = PARTICLE_LIFE_RANGE[1] - PARTICLE_LIFE_RANGE[0];

        for (let i = 0; i < particleCount; i++) {
            const systemIndex = Math.floor(Math.random() * this.particleSystems.length);
            const speed = PARTICLE_SPEED_RANGE[0] + Math.random() * speedRange;

            const particle = {
                px: _spawnPos.x + (Math.random() - 0.5) * 0.2,
                py: _spawnPos.y + (Math.random() - 0.5) * 0.2,
                pz: _spawnPos.z + (Math.random() - 0.5) * 0.2,
                vx: _spawnDir.x * speed + (Math.random() - 0.5) * 0.3,
                vy: 0.2 + Math.random() * 0.3 + (Math.random() - 0.5) * 0.2,
                vz: _spawnDir.z * speed + (Math.random() - 0.5) * 0.3,
                size: PARTICLE_SIZE_RANGE[0] + Math.random() * sizeRange,
                life: PARTICLE_LIFE_RANGE[0] + Math.random() * lifeRange,
                startTime: performance.now() / 1000,
                systemIndex: systemIndex
            };

            this.particles.push(particle);
        }
    }

    /**
     * Advances particle physics, removes dead particles, and updates GPU buffers.
     * @param {number} currentTime - Current time in seconds
     * @param {number} deltaTime - Seconds since last frame
     * @private
     */
    updateParticles(currentTime, deltaTime) {
        if (this.particles.length === 0) {
            // Set draw range to 0 for all systems
            for (let i = 0; i < this.particleSystems.length; i++) {
                this.particleGeometries[i].setDrawRange(0, 0);
            }
            return;
        }

        // Reset counts (reuse pre-allocated buffers)
        for (let i = 0; i < this._systemCounts.length; i++) {
            this._systemCounts[i] = 0;
        }

        const aliveParticles = [];

        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            const age = currentTime - p.startTime;

            if (age < p.life) {
                p.px += p.vx * deltaTime;
                p.py += p.vy * deltaTime;
                p.pz += p.vz * deltaTime;
                p.vy += 0.1 * deltaTime;

                const sysIndex = p.systemIndex;
                const count = this._systemCounts[sysIndex];
                if (count < MAX_PARTICLES) {
                    const idx = count * 3;
                    this._systemPositionBuffers[sysIndex][idx] = p.px;
                    this._systemPositionBuffers[sysIndex][idx + 1] = p.py;
                    this._systemPositionBuffers[sysIndex][idx + 2] = p.pz;
                    this._systemCounts[sysIndex]++;
                }

                aliveParticles.push(p);
            }
        }

        // Update geometry buffers
        for (let i = 0; i < this.particleSystems.length; i++) {
            const positions = this.particleGeometries[i].attributes.position;
            const count = this._systemCounts[i];

            if (count > 0) {
                positions.array.set(this._systemPositionBuffers[i]);
                positions.needsUpdate = true;
                this.particleGeometries[i].setDrawRange(0, count);
            } else {
                this.particleGeometries[i].setDrawRange(0, 0);
            }
        }

        this.particles = aliveParticles;
    }

    /**
     * Removes all particle systems from the scene and disposes GPU resources.
     */
    dispose() {
        this.particleSystems.forEach(system => {
            this.scene.remove(system);
            system.geometry.dispose();
            system.material.dispose();
        });
        this.scene.remove(this.particleGroup);
    }
}
