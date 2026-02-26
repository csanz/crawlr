/**
 * @module Tail
 * Manages snake-like tails that grow behind entities.
 * Uses a ring buffer for position history and shared geometry for segments.
 * Refactored into SnakeTail class — each entity (player + each bot) gets its own instance.
 * Backward-compatible module-level wrappers are provided for the player's tail.
 */
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d';
import {
    TAIL_SEGMENT_SPACING,
    TAIL_SEGMENT_COLOR,
    TAIL_MAX_SEGMENTS,
    TAIL_WIGGLE_AMOUNT,
    TAIL_FOLLOW_SPEED,
    TAIL_SCALE_FACTOR,
    TAIL_MIN_SCALE,
    TAIL_SEGMENT_ROUNDNESS
} from './PhysicsConfig.js';

// Shared geometry singletons — created once, reused by all SnakeTail instances
let sharedSegmentGeometry = null;
let sharedGlowGeometry = null;

// Pre-allocated reusable objects to avoid GC pressure
const _tempVec3 = new THREE.Vector3();
const _tempColor = new THREE.Color();

/**
 * Creates the shared tail segment geometry (called once, reused by all segments).
 * @returns {THREE.BufferGeometry}
 */
function getSharedSegmentGeometry() {
    if (sharedSegmentGeometry) return sharedSegmentGeometry;

    const geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8, 2, 2, 2);
    const positions = geometry.attributes.position;

    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        const length = Math.sqrt(x * x + y * y + z * z);
        const nx = x / length;
        const ny = y / length;
        const nz = z / length;
        positions.setXYZ(
            i,
            x + nx * TAIL_SEGMENT_ROUNDNESS,
            y + ny * TAIL_SEGMENT_ROUNDNESS,
            z + nz * TAIL_SEGMENT_ROUNDNESS
        );
    }

    geometry.computeVertexNormals();
    sharedSegmentGeometry = geometry;
    return geometry;
}

/**
 * Gets the shared glow geometry (called once, reused by all segments).
 * @returns {THREE.BufferGeometry}
 */
function getSharedGlowGeometry() {
    if (sharedGlowGeometry) return sharedGlowGeometry;
    sharedGlowGeometry = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    return sharedGlowGeometry;
}

/**
 * Creates a burst particle effect when a new tail segment is added.
 * @param {THREE.Scene} scene
 * @param {THREE.Vector3} position
 * @param {number} color
 */
function createAddEffectAt(scene, position, color) {
    const particleCount = 12;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = []; // per-particle upward velocity + slight spread

    for (let i = 0; i < particleCount; i++) {
        // Start clustered near the collection point with slight random spread
        positions[i * 3]     = position.x + (Math.random() - 0.5) * 0.6;
        positions[i * 3 + 1] = position.y + Math.random() * 0.3;
        positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.6;

        velocities.push({
            x: (Math.random() - 0.5) * 1.5,   // slight horizontal drift
            y: 3 + Math.random() * 4,           // strong upward burst
            z: (Math.random() - 0.5) * 1.5
        });
    }

    const posAttr = new THREE.BufferAttribute(positions, 3);
    geometry.setAttribute('position', posAttr);

    const particleMaterial = new THREE.PointsMaterial({
        color: color,
        size: 0.15,
        transparent: true,
        opacity: 1.0
    });

    const particles = new THREE.Points(geometry, particleMaterial);
    scene.add(particles);

    const startTime = performance.now();
    let lastTime = startTime;

    const animate = () => {
        const now = performance.now();
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        const elapsed = now - startTime;
        const duration = 800;

        if (elapsed < duration) {
            const arr = posAttr.array;
            for (let i = 0; i < particleCount; i++) {
                const v = velocities[i];
                arr[i * 3]     += v.x * dt;
                arr[i * 3 + 1] += v.y * dt;
                arr[i * 3 + 2] += v.z * dt;
                // Gravity pulls them back down
                v.y -= 6 * dt;
            }
            posAttr.needsUpdate = true;

            particleMaterial.opacity = 1 - (elapsed / duration);
            particleMaterial.size = 0.15 * (1 - elapsed / duration * 0.5);
            requestAnimationFrame(animate);
        } else {
            scene.remove(particles);
            geometry.dispose();
            particleMaterial.dispose();
        }
    };

    animate();
}

// ─── SnakeTail Class ─────────────────────────────────────────────────────────

export class SnakeTail {
    /**
     * @param {THREE.Scene} scene
     * @param {RAPIER.World} world - Rapier physics world (for sensor colliders)
     * @param {THREE.Mesh} ownerMesh - The head mesh this tail follows
     * @param {THREE.Color|number} color - Tail segment color
     * @param {string} entityId - Unique entity identifier (e.g. 'player', 'bot-0')
     */
    constructor(scene, world, ownerMesh, color, entityId) {
        this.scene = scene;
        this.world = world;
        this.ownerMesh = ownerMesh;
        this.color = color instanceof THREE.Color ? color : new THREE.Color(color);
        this.entityId = entityId;

        // Ring buffer for position history
        this.maxHistoryLength = 1000;
        this.positionHistory = new Float32Array(this.maxHistoryLength * 3);
        this.historyHead = 0;
        this.historyCount = 0;

        // Segments: { mesh, glowMesh, body }
        this.segments = [];

        // Glow state tracked per-instance
        this.glowState = {
            isGlowing: false,
            intensity: 0,
            color: this.color
        };

        // Pre-create shared geometries if not yet done
        getSharedSegmentGeometry();
        getSharedGlowGeometry();
    }

    /**
     * Reads a position from the ring buffer.
     * @param {number} index - 0 = newest
     * @returns {THREE.Vector3|null}
     */
    getHistoryPosition(index) {
        if (index >= this.historyCount) return null;
        const slot = (this.historyHead - index + this.maxHistoryLength) % this.maxHistoryLength;
        const offset = slot * 3;
        _tempVec3.set(
            this.positionHistory[offset],
            this.positionHistory[offset + 1],
            this.positionHistory[offset + 2]
        );
        return _tempVec3;
    }

    /**
     * Pushes the current position into the ring buffer.
     * @param {THREE.Vector3} position
     */
    updatePositionHistory(position) {
        this.historyHead = (this.historyHead + 1) % this.maxHistoryLength;
        const offset = this.historyHead * 3;
        this.positionHistory[offset] = position.x;
        this.positionHistory[offset + 1] = position.y;
        this.positionHistory[offset + 2] = position.z;

        if (this.historyCount < this.maxHistoryLength) {
            this.historyCount++;
        }
    }

    /**
     * Adds a new tail segment with glow mesh and physics sensor at the given position.
     * @param {THREE.Vector3} initialPosition
     * @returns {THREE.Mesh|null}
     */
    addSegment(initialPosition) {
        if (this.segments.length >= TAIL_MAX_SEGMENTS) {
            return null;
        }

        const segIdx = this.segments.length;

        // Visual mesh
        const segmentMaterial = new THREE.MeshStandardMaterial({
            color: this.color,
            roughness: 0.7
        });
        const segmentMesh = new THREE.Mesh(getSharedSegmentGeometry(), segmentMaterial);
        segmentMesh.position.copy(initialPosition);

        const baseScale = this.ownerMesh ? this.ownerMesh.scale.x : 1.0;
        const scaleFactor = Math.max(TAIL_MIN_SCALE, 1 - segIdx * TAIL_SCALE_FACTOR) * baseScale;
        segmentMesh.scale.setScalar(scaleFactor);
        segmentMesh.userData.segmentIndex = segIdx;
        segmentMesh.rotation.y = Math.random() * Math.PI * 0.25;
        segmentMesh.castShadow = true;

        // Glow mesh
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: this.color,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const glowMesh = new THREE.Mesh(getSharedGlowGeometry(), glowMaterial);
        segmentMesh.add(glowMesh);

        // Physics sensor collider (kinematic body)
        let body = null;
        if (this.world) {
            const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
                .setTranslation(initialPosition.x, initialPosition.y, initialPosition.z);
            body = this.world.createRigidBody(bodyDesc);
            const colliderDesc = RAPIER.ColliderDesc.cuboid(0.4, 0.4, 0.4)
                .setSensor(true)
                .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
                .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
            const collider = this.world.createCollider(colliderDesc, body);
            collider.userData = { type: 'tail', entityId: this.entityId, segmentIndex: segIdx };
        }

        this.scene.add(segmentMesh);
        this.segments.push({ mesh: segmentMesh, glowMesh, body });

        createAddEffectAt(this.scene, initialPosition, this.color.getHex ? this.color.getHex() : this.color);

        return segmentMesh;
    }

    /**
     * Updates positions of all tail segments by lerping toward their history targets.
     * @param {boolean} [applyWiggle=true]
     */
    updatePositions(applyWiggle = true) {
        const time = performance.now() * 0.001;

        for (let i = 0; i < this.segments.length; i++) {
            const historyIndex = i * TAIL_SEGMENT_SPACING;
            if (historyIndex >= this.historyCount) continue;

            const pos = this.getHistoryPosition(historyIndex);
            if (!pos) continue;

            const seg = this.segments[i];
            const mesh = seg.mesh;

            // Lerp toward target
            mesh.position.x += (pos.x - mesh.position.x) * TAIL_FOLLOW_SPEED;
            mesh.position.y += (pos.y - mesh.position.y) * TAIL_FOLLOW_SPEED;
            mesh.position.z += (pos.z - mesh.position.z) * TAIL_FOLLOW_SPEED;

            if (applyWiggle) {
                mesh.position.x += Math.sin(time * 2 + i * 0.5) * TAIL_WIGGLE_AMOUNT;
                mesh.position.z += Math.cos(time * 2 + i * 0.5) * TAIL_WIGGLE_AMOUNT;
            }

            // Update segment scale
            if (this.ownerMesh) {
                const targetScale = Math.max(TAIL_MIN_SCALE, 1 - i * TAIL_SCALE_FACTOR) * this.ownerMesh.scale.x;
                const currentScale = mesh.scale.x;
                const newScale = currentScale + (targetScale - currentScale) * 0.3;
                mesh.scale.setScalar(newScale);
            }

            // Update kinematic body position
            if (seg.body) {
                seg.body.setNextKinematicTranslation(mesh.position);
            }
        }

        this.updateGlow();
    }

    /**
     * Updates the glow effect on all tail segments.
     */
    updateGlow() {
        if (!this.segments.length) return;

        const fadeFactor = 0.7;

        for (let i = 0; i < this.segments.length; i++) {
            const seg = this.segments[i];
            const glow = seg.glowMesh;
            if (!glow) continue;

            if (this.glowState.isGlowing) {
                const segmentIntensity = this.glowState.intensity * Math.pow(fadeFactor, i);

                if (segmentIntensity < 0.02 || i > 12) {
                    glow.material.opacity = 0;
                    continue;
                }

                glow.material.opacity = 0.12 * segmentIntensity;
                const baseScale = seg.mesh.scale.x;
                glow.scale.setScalar(1.05);

                if (i > 0) {
                    const hueShift = (i / this.segments.length) * 0.2;
                    _tempColor.copy(this.glowState.color);
                    _tempColor.offsetHSL(hueShift, 0, 0);
                    glow.material.color.copy(_tempColor);
                }
            } else {
                glow.material.opacity *= 0.85;
            }
        }
    }

    /**
     * Removes segments from the tail end.
     * @param {number} count - Number of segments to remove
     * @returns {number} Actual number removed
     */
    removeLastSegments(count) {
        let removed = 0;
        while (removed < count && this.segments.length > 0) {
            const seg = this.segments.pop();
            this.scene.remove(seg.mesh);
            if (seg.mesh.material) seg.mesh.material.dispose();
            if (seg.glowMesh && seg.glowMesh.material) seg.glowMesh.material.dispose();
            if (seg.body && this.world) {
                this.world.removeRigidBody(seg.body);
            }
            removed++;
        }
        return removed;
    }

    /**
     * Gets the current number of tail segments.
     * @returns {number}
     */
    getLength() {
        return this.segments.length;
    }

    /**
     * Removes all tail segments and resets position history.
     */
    reset() {
        for (const seg of this.segments) {
            this.scene.remove(seg.mesh);
            if (seg.mesh.material) seg.mesh.material.dispose();
            if (seg.mesh.children) {
                seg.mesh.children.forEach(child => {
                    if (child.material) child.material.dispose();
                });
            }
            if (seg.body && this.world) {
                this.world.removeRigidBody(seg.body);
            }
        }

        this.segments = [];
        this.positionHistory = new Float32Array(this.maxHistoryLength * 3);
        this.historyHead = 0;
        this.historyCount = 0;
    }

    /**
     * Full cleanup — call when entity is permanently destroyed.
     */
    dispose() {
        this.reset();
    }
}

// ─── Backward-compatible module-level wrappers for the player's tail ─────────

/** @type {SnakeTail|null} */
let playerTail = null;

/** Expose player tail instance for external use (sprint system, etc.) */
export function getPlayerTail() {
    return playerTail;
}

/**
 * Initializes the player's tail system.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Mesh} playerMesh
 * @param {THREE.Scene} [scene]
 * @param {RAPIER.World} [world]
 */
export function initTailSystem(renderer, playerMesh, scene, world) {
    // Pre-create shared geometries
    getSharedSegmentGeometry();
    getSharedGlowGeometry();

    if (scene && world && playerMesh) {
        const color = playerMesh.userData.glowColor || new THREE.Color(TAIL_SEGMENT_COLOR);
        playerTail = new SnakeTail(scene, world, playerMesh, color, 'player');
    }

    return {
        updatePositionHistory,
        addTailSegment,
        updateTailPositions
    };
}

export function updatePositionHistory(playerPosition) {
    if (playerTail) playerTail.updatePositionHistory(playerPosition);
}

export function addTailSegment(scene, initialPosition) {
    if (playerTail) return playerTail.addSegment(initialPosition);
    return null;
}

export function updateTailPositions(applyWiggle = true) {
    if (playerTail) playerTail.updatePositions(applyWiggle);
}

export function getTailLength() {
    if (playerTail) return playerTail.getLength();
    return 0;
}

export function resetTail(scene) {
    if (playerTail) playerTail.reset();
}

export function setPlayerMeshReference(playerMesh) {
    if (playerTail) playerTail.ownerMesh = playerMesh;
}

/**
 * Sets the glow state on the player's tail (called from Player.js glow updates).
 * @param {Object} externalGlowState - { isGlowing, intensity, color }
 */
export function syncPlayerGlowState(externalGlowState) {
    if (playerTail) {
        playerTail.glowState.isGlowing = externalGlowState.isGlowing;
        playerTail.glowState.intensity = externalGlowState.intensity;
        playerTail.glowState.color = externalGlowState.color;
    }
}
