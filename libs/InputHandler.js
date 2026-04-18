/**
 * @module InputHandler
 * Keyboard input handling for player movement (WASD + Shift + Space).
 */
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d';
import { PLAYER_JUMP_FORCE } from './PhysicsConfig.js';
import { playEffect } from './Sound.js';
import { eventBus } from '@jazaix/jx-sdk';

/** Queue of jump events for network prediction to consume */
export const pendingJumps = [];

/** Whether input handler is in network mode (queue jumps instead of applying Rapier impulses) */
let _networkMode = false;

/** Enable/disable network mode for the input handler */
export function setInputNetworkMode(v) { _networkMode = v; }

/** Cached player body reference for triggerJump */
let _playerBody = null;

/** Current movement state based on key presses */
export const moveState = {
    forward: 0,
    backward: 0,
    left: 0,
    right: 0,
    run: 0,
    jump: 0,
    sprintHeld: false,
    zoomTrigger: false,
    angleTrigger: false,
    muteTrigger: false,
    mapToggleTrigger: false,
    friendOutlineTrigger: false,
    cameraLeftTrigger: false,
    cameraRightTrigger: false,
    powerSpeedMultiplier: 1.0,
    doubleJumped: false,       // tracks if double-jump has been used this airtime
    flipProgress: 0,           // 0-1 flip animation progress
    flipping: false            // currently doing a flip
};

/**
 * Initializes the keyboard event listeners for player movement.
 * @param {RAPIER.RigidBody} playerBody - The player's Rapier rigid body instance.
 */
let _playerMesh = null;

/**
 * Shared jump logic — handles ground jump, air dash, and flip.
 * Called by both keyboard handler and touch controls.
 */
export function triggerJump() {
    moveState.jump = 1;
    if (_networkMode) {
        const scaleOffset = _playerMesh ? (_playerMesh.scale.x - 1) * 0.5 : 0;
        const onGround = _playerMesh && _playerMesh.position.y < 1.15 + scaleOffset;
        if (onGround) {
            playEffect('jump');
            const sizeBonus = _playerMesh ? 1 + (_playerMesh.scale.x - 1) * 0.3 : 1;
            pendingJumps.push({ type: 'ground', sizeBonus });
            moveState.doubleJumped = false;
        } else if (!moveState.doubleJumped) {
            moveState.doubleJumped = true;
            moveState.flipping = true;
            moveState.flipProgress = 0;
            playEffect('dash');
            pendingJumps.push({ type: 'airDash' });
        }
    } else if (_playerBody) {
        const scaleOffset = _playerMesh ? (_playerMesh.scale.x - 1) * 0.5 : 0;
        const onGround = _playerMesh && _playerMesh.position.y < 1.15 + scaleOffset;
        if (onGround) {
            playEffect('jump');
            const sizeBonus = _playerMesh ? 1 + (_playerMesh.scale.x - 1) * 0.3 : 1;
            _playerBody.applyImpulse({ x: 0, y: PLAYER_JUMP_FORCE * sizeBonus, z: 0 }, true);
            moveState.doubleJumped = false;
        } else if (!moveState.doubleJumped) {
            moveState.doubleJumped = true;
            moveState.flipping = true;
            moveState.flipProgress = 0;
            playEffect('dash');
            _playerBody.applyImpulse({ x: 0, y: PLAYER_JUMP_FORCE * 0.3, z: 0 }, true);
            const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(_playerMesh.quaternion);
            _playerBody.applyImpulse({ x: forward.x * 8, y: 0, z: forward.z * 8 }, true);
        }
    }
}

export function initInputHandler(playerBody, playerMesh) {
    _playerMesh = playerMesh;
    _playerBody = playerBody;
    window.addEventListener('keydown', (event) => {
        // Skip game input when typing in a text field (chat, etc.)
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        switch (event.key.toLowerCase()) {
            case 'w':
                moveState.forward = 1;
                break;
            case 's':
                moveState.backward = 1;
                break;
            case 'a':
                moveState.left = 1;
                break;
            case 'd':
                moveState.right = 1;
                break;
            case 'shift':
                moveState.sprintHeld = true;
                break;
            case 'z':
                moveState.zoomTrigger = true;
                break;
            case 'v':
                moveState.angleTrigger = true;
                break;
            case 'm':
                moveState.mapToggleTrigger = true;
                break;
            case 'n':
                moveState.muteTrigger = true;
                break;
            case 'f':
                moveState.friendOutlineTrigger = true;
                break;
            case ' ':
                if (event.repeat) break; // ignore held key repeats
                triggerJump();
                break;
            case 'arrowleft':
                moveState.cameraLeftTrigger = true;
                break;
            case 'arrowright':
                moveState.cameraRightTrigger = true;
                break;
        }
        // Emit input state on every meaningful keydown
        if ('wasd shift'.includes(event.key.toLowerCase()) || event.key === ' ') {
            eventBus.emit('entity:input', {
                id: 'player',
                forward: moveState.forward,
                backward: moveState.backward,
                left: moveState.left,
                right: moveState.right,
                run: moveState.run,
                jump: moveState.jump
            });
        }
    });

    // Reset all movement when window loses focus (prevents stuck keys)
    const resetMovement = () => {
        moveState.forward = 0;
        moveState.backward = 0;
        moveState.left = 0;
        moveState.right = 0;
        moveState.jump = 0;
        moveState.sprintHeld = false;
    };
    window.addEventListener('blur', resetMovement);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) resetMovement();
    });

    window.addEventListener('keyup', (event) => {
        // Skip game input when typing in a text field (chat, etc.)
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        switch (event.key.toLowerCase()) {
            case 'w':
                moveState.forward = 0;
                break;
            case 's':
                moveState.backward = 0;
                break;
            case 'a':
                moveState.left = 0;
                break;
            case 'd':
                moveState.right = 0;
                break;
            case 'shift':
                moveState.sprintHeld = false;
                break;
            case ' ':
                moveState.jump = 0;
                break;
        }
        // Emit input state on every meaningful keyup
        if ('wasd shift'.includes(event.key.toLowerCase()) || event.key === ' ') {
            eventBus.emit('entity:input', {
                id: 'player',
                forward: moveState.forward,
                backward: moveState.backward,
                left: moveState.left,
                right: moveState.right,
                run: moveState.run,
                jump: moveState.jump
            });
        }
    });
}

/**
 * Compute camera-relative movement direction for network input.
 * @param {THREE.PerspectiveCamera} camera
 * @returns {{ dx: number, dz: number, flags: number, angle: number }}
 */
export function getNetworkInput(camera) {
    // Camera forward/right projected onto XZ plane
    const cameraFwd = new THREE.Vector3();
    camera.getWorldDirection(cameraFwd);
    cameraFwd.y = 0;
    cameraFwd.normalize();

    const cameraRight = new THREE.Vector3();
    cameraRight.crossVectors(cameraFwd, new THREE.Vector3(0, 1, 0)).normalize();

    // Combine WASD into a direction
    let dx = 0;
    let dz = 0;

    if (moveState.forward) {
        dx += cameraFwd.x;
        dz += cameraFwd.z;
    }
    if (moveState.backward) {
        dx -= cameraFwd.x;
        dz -= cameraFwd.z;
    }
    if (moveState.left) {
        dx -= cameraRight.x;
        dz -= cameraRight.z;
    }
    if (moveState.right) {
        dx += cameraRight.x;
        dz += cameraRight.z;
    }

    // Normalize
    const mag = Math.sqrt(dx * dx + dz * dz);
    if (mag > 0.01) {
        dx /= mag;
        dz /= mag;
    }

    // Compute facing angle from movement direction
    let angle = 0;
    if (mag > 0.01) {
        angle = Math.atan2(dx, dz);
    }

    // Flags: bit0 = sprint, bit1 = jump
    let flags = 0;
    if (moveState.sprintHeld) flags |= 0x01;
    if (moveState.jump) flags |= 0x02;

    return { dx, dz, flags, angle };
}