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
const _tailPos = new THREE.Vector3(); // reusable vec for tail position clamping

// Pre-allocated reusable objects to avoid per-frame GC pressure
const _rTargetQuat = new THREE.Quaternion();
const _rYAxis = new THREE.Vector3(0, 1, 0);
const _rLocalRight = new THREE.Vector3();
const _rFlipQuat = new THREE.Quaternion();
const _rScaleVec = new THREE.Vector3();
const _rGlowColor = new THREE.Color();

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

    // Glow mesh (additive blending sphere — no PointLight for perf)
    const glowMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.8, 12, 12),
        new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false,
        })
    );
    mesh.add(glowMesh);

    scene.add(mesh);

    // Create tail (no physics world for remote players)
    const tail = new SnakeTail(scene, null, mesh, color, `remote-${entityId}`);
    tail.segmentSpacing = 8;
    remotePlayers.set(entityId, {
        mesh, color, tail, lastTailLength: 0,
        glowMesh,
        // Action detection state
        wasOnGround: true, prevServerFlipping: false, sprinting: false,
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

    // Sprint detection from flags bit 2 (0x04)
    remote.sprinting = (state.flags & 0x04) !== 0;

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
    _rTargetQuat.setFromAxisAngle(_rYAxis, state.angle);
    remote.baseYawQuat.copy(_rTargetQuat);

    // --- Flip animation (matches single-player exactly) ---
    if (remote.flipping) {
        remote.flipProgress += dt * 3.0; // ~0.33s for full flip
        if (remote.flipProgress >= 1) {
            remote.flipping = false;
            remote.flipProgress = 0;
            mesh.quaternion.slerp(_rTargetQuat, 0.15);
            // Clear tail flip rotations
            if (tail) {
                for (const seg of tail.segments) seg.mesh.rotation.x = 0;
            }
        } else {
            // Roll around the local right axis, composed with base yaw
            const flipAngle = remote.flipProgress * Math.PI * 2;
            _rLocalRight.set(1, 0, 0).applyQuaternion(remote.baseYawQuat);
            _rFlipQuat.setFromAxisAngle(_rLocalRight, flipAngle);
            mesh.quaternion.copy(_rFlipQuat).multiply(remote.baseYawQuat);

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
        mesh.quaternion.slerp(_rTargetQuat, 0.15);
    }

    // Scale
    const targetScale = state.scale || 1;
    _rScaleVec.set(targetScale, targetScale, targetScale);
    mesh.scale.lerp(_rScaleVec, 0.1);

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
    } else if (remote.sprinting && mesh.material && mesh.userData.glowColor) {
        // Sprint glow — pulsing emissive + glow mesh + light (matches local player)
        const sprintPulse = 0.6 + Math.sin(performance.now() * 0.003) * 0.15;
        mesh.material.emissive.copy(mesh.userData.glowColor);
        mesh.material.emissiveIntensity = 0.8 * sprintPulse;
    } else if (mesh.material && mesh.userData.glowColor) {
        mesh.material.emissive.copy(mesh.userData.glowColor).multiplyScalar(0.15);
        mesh.material.emissiveIntensity = 0.3;
    }

    // Animate glow mesh (sprint or power-up activates, otherwise fades)
    if (remote.glowMesh) {
        const parentScale = mesh.scale.x || 1;
        const inverseScale = 1 / parentScale;
        if (remote.sprinting || powerUpType > 0) {
            const pulse = 0.6 + Math.sin(performance.now() * 0.003) * 0.15;
            const targetOpacity = 0.4 * pulse;
            remote.glowMesh.material.opacity += (targetOpacity - remote.glowMesh.material.opacity) * 0.25;
            remote.glowMesh.scale.setScalar(inverseScale * 1.4);
        } else {
            remote.glowMesh.material.opacity *= 0.85;
            const cur = remote.glowMesh.scale.x;
            remote.glowMesh.scale.setScalar(cur + (inverseScale - cur) * 0.1);
        }
    }

    // Store velocity for eye physics
    remote.vx = state.vx || 0;
    remote.vy = state.vy || 0;
    remote.vz = state.vz || 0;

    // Tail: update position history and sync segment count
    if (tail) {
        // Clamp tail Y to ground level (match local player behavior in GameLoop.js)
        const tailGroundY = 0.5 + scaleOffset;
        const tailY = Math.max(mesh.position.y, tailGroundY);
        _tailPos.set(mesh.position.x, tailY, mesh.position.z);
        tail.updatePositionHistory(_tailPos, 0.05);

        // Sync segment count from server-authoritative tailLength
        // Rate-limit adds (like local player) so history can fill before segments need it
        const MAX_REMOTE_TAIL_ADD = 2;
        const currentLen = tail.getLength();
        const diff = tailLength - currentLen;
        if (diff > 0) {
            const toAdd = Math.min(diff, MAX_REMOTE_TAIL_ADD);
            // Seed history backward so new segments don't collapse onto head
            const historyNeeded = (currentLen + toAdd) * tail.segmentSpacing;
            const historyHave = tail.positionHistory ? tail.positionHistory.length : 0;
            if (historyHave < historyNeeded) {
                // Extrapolate backward from current direction
                const dx = remote.vx || 0;
                const dz = remote.vz || 0;
                const speed = Math.sqrt(dx * dx + dz * dz);
                const dirX = speed > 0.1 ? -dx / speed : 0;
                const dirZ = speed > 0.1 ? -dz / speed : 0;
                const step = 0.15; // spacing between seeded points
                const toSeed = historyNeeded - historyHave;
                for (let i = 0; i < toSeed; i++) {
                    const dist = (historyHave + i + 1) * step;
                    tail.pushHistoryBack(
                        _tailPos.x + dirX * dist,
                        tailY,
                        _tailPos.z + dirZ * dist
                    );
                }
            }
            for (let i = 0; i < toAdd; i++) {
                tail.addSegment(mesh.position.clone());
            }
        } else if (diff < 0) {
            tail.removeLastSegments(-diff);
        }


        // Sync glow state from power-up or sprint
        if (powerUpType > 0) {
            const glowColors = { 1: 0x4488ff, 2: 0xffffff, 3: 0x44ff44, 4: 0xff8800 };
            tail.glowState.isGlowing = true;
            tail.glowState.intensity = 0.8;
            tail.glowState.color = _rGlowColor.set(glowColors[powerUpType] || 0xffffff);
        } else if (remote.sprinting) {
            tail.glowState.isGlowing = true;
            tail.glowState.intensity = 0.6 + Math.sin(performance.now() * 0.003) * 0.15;
            tail.glowState.color = mesh.userData.glowColor || _rGlowColor.set(0xffffff);
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
export function getRemoteSprintData() {
    const result = [];
    for (const [entityId, remote] of remotePlayers) {
        if (remote.sprinting && remote.mesh.visible) {
            result.push({
                mesh: remote.mesh,
                color: remote.color,
                vx: remote.vx || 0,
                vz: remote.vz || 0,
            });
        }
    }
    return result;
}

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
