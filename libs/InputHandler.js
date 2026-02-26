/**
 * @module InputHandler
 * Keyboard input handling for player movement (WASD + Shift + Space).
 */
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d';
import { PLAYER_JUMP_FORCE } from './PhysicsConfig.js';
import { playEffect } from './Sound.js';

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

export function initInputHandler(playerBody, playerMesh) {
    _playerMesh = playerMesh;
    window.addEventListener('keydown', (event) => {
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
                moveState.muteTrigger = true;
                break;
            case ' ':
                if (event.repeat) break; // ignore held key repeats
                moveState.jump = 1;
                if (playerBody) {
                    const currentVel = playerBody.linvel();
                    const scaleOffset = _playerMesh ? (_playerMesh.scale.x - 1) * 0.5 : 0;
                    const onGround = _playerMesh && _playerMesh.position.y < 1.15 + scaleOffset;
                    if (onGround) {
                        // Ground jump
                        const sizeBonus = _playerMesh ? 1 + (_playerMesh.scale.x - 1) * 0.3 : 1;
                        playerBody.applyImpulse({ x: 0, y: PLAYER_JUMP_FORCE * sizeBonus, z: 0 }, true);
                        moveState.doubleJumped = false;
                    } else if (!moveState.doubleJumped) {
                        // Air dash: forward burst + slight lift + flip
                        moveState.doubleJumped = true;
                        moveState.flipping = true;
                        moveState.flipProgress = 0;
                        playEffect('dash');

                        // Slight upward boost
                        playerBody.applyImpulse({ x: 0, y: PLAYER_JUMP_FORCE * 0.3, z: 0 }, true);

                        // Fast forward burst in the direction the player is facing
                        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(_playerMesh.quaternion);
                        playerBody.applyImpulse({
                            x: forward.x * 8,
                            y: 0,
                            z: forward.z * 8
                        }, true);
                    }
                }
                break;
            case 'arrowleft':
                moveState.cameraLeftTrigger = true;
                break;
            case 'arrowright':
                moveState.cameraRightTrigger = true;
                break;
        }
    });

    window.addEventListener('keyup', (event) => {
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
    });
} 