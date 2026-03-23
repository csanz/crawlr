/**
 * @module RemotePlayer
 * Manages visual meshes for remote players received from the server.
 * No physics bodies — positions come from server snapshots.
 */
import * as THREE from 'three';
import { addEyes, updateEyePhysics } from './Player.js';
import { addNameLabel } from './NameLabels.js';
import { TAIL_SEGMENT_ROUNDNESS } from './PhysicsConfig.js';
import { SnakeTail } from './Tail.js';
import { playSpatialEffect } from './Sound.js';

const remotePlayers = new Map(); // entityId -> { mesh, color, tail, lastTailLength, ... }

// Shared geometry for all remote players
let _sharedGeo = null;
function getSharedGeometry() {
    if (!_sharedGeo) {
        const geometry = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const z = positions.getZ(i);
            const length = Math.sqrt(x * x + y * y + z * z);
            positions.setXYZ(
                i,
                x + (x / length) * TAIL_SEGMENT_ROUNDNESS,
                y + (y / length) * TAIL_SEGMENT_ROUNDNESS,
                z + (z / length) * TAIL_SEGMENT_ROUNDNESS
            );
        }
        geometry.computeVertexNormals();
        _sharedGeo = geometry;
    }
    return _sharedGeo;
}

/**
 * Create a visual mesh for a remote player.
 * @param {THREE.Scene} scene
 * @param {number} entityId
 * @param {string} displayName
 * @returns {{ mesh: THREE.Mesh, color: THREE.Color }}
 */
export function createRemotePlayer(scene, entityId, displayName) {
    // Random color based on entity ID
    const hue = (entityId * 137.508) % 360 / 360;
    const color = new THREE.Color().setHSL(hue, 0.7, 0.55);

    const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.35,
        metalness: 0.1,
        emissive: color.clone().multiplyScalar(0.15),
        emissiveIntensity: 0.3,
    });

    const mesh = new THREE.Mesh(getSharedGeometry(), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(0, 1, 0);

    // Store metadata
    mesh.userData.entityId = entityId;
    mesh.userData.glowColor = color;

    // Add eyes and name label
    addEyes(mesh);
    addNameLabel(mesh, displayName || `Player ${entityId}`);

    scene.add(mesh);

    // Create tail (no physics world for remote players)
    // Use tighter segment spacing for network mode (server ticks at 20Hz, so history is sparser)
    const tail = new SnakeTail(scene, null, mesh, color, `remote-${entityId}`);
    tail.segmentSpacing = 2;
    remotePlayers.set(entityId, {
        mesh, color, tail, lastTailLength: 0,
        // Action detection state
        wasOnGround: true, prevServerFlipping: false,
        // Flip animation state
        flipping: false, flipProgress: 0, baseYawQuat: new THREE.Quaternion(),
    });

    return { mesh, color };
}

/**
 * Update a remote player's visual state from a server snapshot entity.
 * @param {number} entityId
 * @param {{ x, y, z, angle, scale, flags }} state
 * @param {number} dt - Delta time for smooth interpolation
 * @param {number} [tailLength=0] - Server-authoritative tail length
 */
export function updateRemotePlayer(entityId, state, dt, tailLength = 0) {
    const remote = remotePlayers.get(entityId);
    if (!remote) return;

    const { mesh, tail } = remote;

    // --- Death/alive detection from flags bit 0 ---
    const alive = (state.flags & 0x01) !== 0;
    if (!alive) {
        mesh.visible = false;
        if (tail) for (const s of tail.segments) { s.mesh.visible = false; if (s.glowMesh) s.glowMesh.visible = false; }
        remote.wasDead = true;
        return; // Skip all updates while dead
    }
    // Respawn detected: was dead, now alive — snap position (don't lerp across map)
    if (remote.wasDead) {
        const so = (state.scale - 1) * 0.5;
        mesh.position.set(state.x, state.y + so, state.z);
        remote.wasDead = false;
    }
    mesh.visible = true;
    if (tail) for (const s of tail.segments) { s.mesh.visible = true; if (s.glowMesh) s.glowMesh.visible = true; }

    // --- Action detection from server flags ---
    const scaleOffset = (state.scale - 1) * 0.5;
    const onGround = state.y < 1.5 + scaleOffset;
    const serverFlipping = (state.flags & 0x80) !== 0; // bit 7: air dash flip

    // Detect ground jump: was on ground, now airborne with upward velocity
    const vy = state.vy || 0;
    if (remote.wasOnGround && !onGround && vy > 4.0 && !remote.flipping) {
        playSpatialEffect('jump', mesh.position.x, mesh.position.z);
    }

    // Detect air dash start: server flip flag just turned on
    if (serverFlipping && !remote.prevServerFlipping && !remote.flipping) {
        remote.flipping = true;
        remote.flipProgress = 0;
        playSpatialEffect('dash', mesh.position.x, mesh.position.z);
    }

    remote.prevServerFlipping = serverFlipping;
    remote.wasOnGround = onGround;

    // --- Smooth position interpolation ---
    const lerpSpeed = 12;
    const t = Math.min(1, lerpSpeed * dt);

    // Horizontal: smooth lerp
    mesh.position.x += (state.x - mesh.position.x) * t;
    mesh.position.z += (state.z - mesh.position.z) * t;

    // Vertical: physics extrapolation for realistic jump/fall arcs.
    // Use server velocity with gravity between snapshots, then blend
    // toward the server's authoritative Y to stay in sync.
    const targetY = state.y + scaleOffset;
    const GRAVITY = 9.81;
    if (remote._predVy === undefined) remote._predVy = vy;
    // Blend predicted vy toward server vy
    remote._predVy += (vy - remote._predVy) * 0.3;
    remote._predVy -= GRAVITY * dt;
    mesh.position.y += remote._predVy * dt;
    // Correct toward server Y to prevent drift
    mesh.position.y += (targetY - mesh.position.y) * 0.15;
    // Clamp to ground
    const groundY = 0.5 + scaleOffset;
    if (mesh.position.y < groundY) {
        mesh.position.y = groundY;
        remote._predVy = 0;
    }

    // Rotation from angle — save base yaw for flip composition
    const targetQuat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        state.angle
    );
    remote.baseYawQuat.copy(targetQuat);

    // --- Flip animation (matches single-player exactly) ---
    if (remote.flipping) {
        remote.flipProgress += dt * 3.0; // ~0.33s for full flip
        if (remote.flipProgress >= 1) {
            remote.flipping = false;
            remote.flipProgress = 0;
            mesh.quaternion.slerp(targetQuat, 0.15);
            // Clear tail flip rotations
            if (tail) {
                for (const seg of tail.segments) seg.mesh.rotation.x = 0;
            }
        } else {
            // Roll around the local right axis, composed with base yaw
            const flipAngle = remote.flipProgress * Math.PI * 2;
            const localRight = new THREE.Vector3(1, 0, 0).applyQuaternion(remote.baseYawQuat);
            const flipQuat = new THREE.Quaternion().setFromAxisAngle(localRight, flipAngle);
            mesh.quaternion.copy(flipQuat).multiply(remote.baseYawQuat);

            // Spin tail segments with staggered delay
            if (tail) {
                for (let i = 0; i < tail.segments.length; i++) {
                    const delay = Math.min(1, remote.flipProgress - i * 0.04);
                    if (delay > 0) {
                        tail.segments[i].mesh.rotation.x = delay * Math.PI * 2;
                    }
                }
            }
        }
    } else {
        mesh.quaternion.slerp(targetQuat, 0.15);
    }

    // Scale
    const targetScale = state.scale || 1;
    mesh.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);

    // Invulnerability blinking (flags bit 1)
    const invulnerable = (state.flags & 0x02) !== 0;
    if (invulnerable) {
        mesh.visible = Math.floor(performance.now() / 100) % 2 === 0;
    } else {
        mesh.visible = true;
    }

    // Power-up glow (bits 4-6 of flags)
    const powerUpType = (state.flags >> 4) & 0x07;
    if (powerUpType > 0 && mesh.material) {
        const glowColors = { 1: 0x4488ff, 2: 0xffffff, 3: 0x44ff44, 4: 0xff8800 };
        const glowColor = glowColors[powerUpType] || 0xffffff;
        mesh.material.emissive.setHex(glowColor);
        mesh.material.emissiveIntensity = 0.5 + Math.sin(performance.now() * 0.005) * 0.2;
    } else if (mesh.material && mesh.userData.glowColor) {
        mesh.material.emissive.copy(mesh.userData.glowColor).multiplyScalar(0.15);
        mesh.material.emissiveIntensity = 0.3;
    }

    // Store velocity for eye physics
    remote.vx = state.vx || 0;
    remote.vy = state.vy || 0;
    remote.vz = state.vz || 0;

    // Tail: update position history and sync segment count
    // Use minDistance to prevent history pollution when lerp converges between snapshots
    if (tail) {
        tail.updatePositionHistory(mesh.position, 0.05);

        // Sync segment count — rate-limit to avoid visual oscillation
        const MAX_REMOTE_TAIL_CHANGE = 2;
        const currentLen = tail.getLength();
        const diff = tailLength - currentLen;
        if (diff > 0) {
            const toAdd = Math.min(diff, MAX_REMOTE_TAIL_CHANGE);
            for (let i = 0; i < toAdd; i++) {
                tail.addSegment(mesh.position.clone());
            }
        } else if (diff < 0) {
            const toRemove = Math.min(-diff, MAX_REMOTE_TAIL_CHANGE);
            tail.removeLastSegments(toRemove);
        }

        // Sync glow state from power-up
        if (powerUpType > 0) {
            const glowColors = { 1: 0x4488ff, 2: 0xffffff, 3: 0x44ff44, 4: 0xff8800 };
            tail.glowState.isGlowing = true;
            tail.glowState.intensity = 0.8;
            tail.glowState.color = new THREE.Color(glowColors[powerUpType] || 0xffffff);
        } else {
            tail.glowState.isGlowing = false;
        }

        tail.updatePositions(true);
    }
}

/**
 * Remove a remote player's mesh from the scene.
 * @param {THREE.Scene} scene
 * @param {number} entityId
 */
export function removeRemotePlayer(scene, entityId) {
    const remote = remotePlayers.get(entityId);
    if (!remote) return;

    if (remote.tail) remote.tail.dispose();
    scene.remove(remote.mesh);
    remote.mesh.geometry = null; // shared, don't dispose
    remote.mesh.material.dispose();
    remotePlayers.delete(entityId);
}

/**
 * Update eye physics for all remote players.
 * @param {number} dt
 */
export function updateRemoteEyes(dt) {
    for (const [entityId, remote] of remotePlayers) {
        const speed = Math.sqrt((remote.vx || 0) ** 2 + (remote.vz || 0) ** 2);
        updateEyePhysics(remote.mesh, dt, speed, 10, remote.vy || 0);
    }
}

/**
 * Get all remote player meshes for radar display.
 * @returns {Array<{ x, z, color, type }>}
 */
export function getRemoteRadarData() {
    const data = [];
    for (const [entityId, remote] of remotePlayers) {
        data.push({
            x: remote.mesh.position.x,
            z: remote.mesh.position.z,
            color: '#' + remote.color.getHexString(),
            type: 'remote',
        });
    }
    return data;
}

/**
 * Get the count of remote players.
 */
export function getRemotePlayerCount() {
    return remotePlayers.size;
}

/**
 * Get remote players currently doing a flip (for particle spawning).
 * @returns {Array<{ mesh: THREE.Mesh, flipProgress: number, baseYawQuat: THREE.Quaternion, color: THREE.Color }>}
 */
export function getRemoteFlipData() {
    const result = [];
    for (const [entityId, remote] of remotePlayers) {
        if (remote.flipping && remote.flipProgress > 0 && remote.flipProgress < 1) {
            result.push({
                mesh: remote.mesh,
                flipProgress: remote.flipProgress,
                baseYawQuat: remote.baseYawQuat,
                color: remote.color,
            });
        }
    }
    return result;
}

/**
 * Get all remote player data for the player list HUD.
 */
export function getRemotePlayerListData(networkManager) {
    const entities = [];
    for (const [entityId, remote] of remotePlayers) {
        // Find score info from latest snapshot extra
        const scoreInfo = networkManager.latestExtra.scores.find(s => s.playerId === entityId);
        // Check if this entity is a bot (flags bit 3)
        const entityState = networkManager.remoteEntities.get(entityId);
        const isBot = entityState ? (entityState.flags & 0x08) !== 0 : false;
        entities.push({
            id: entityId,
            tailLength: scoreInfo ? scoreInfo.tailLength : 0,
            size: remote.mesh.scale.x,
            color: '#' + remote.color.getHexString(),
            alive: true,
            displayName: scoreInfo ? scoreInfo.displayName : `Player ${entityId}`,
            isBot,
        });
    }
    return entities;
}
