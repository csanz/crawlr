/**
 * @module SprintSystem
 * Tail-burning sprint: hold Shift to sprint, consuming tail segments as fuel.
 * No stamina bar — your tail IS your fuel.
 */
import { moveState } from './InputHandler.js';
import { SPRINT_BURN_INTERVAL } from './PhysicsConfig.js';
import { eventBus } from './EventBus.js';

let burnTimer = 0;

/**
 * Updates sprint state each frame. Sprinting burns tail segments.
 * @param {number} dt - Delta time in seconds
 * @param {import('./Tail.js').SnakeTail|null} tail - The player's SnakeTail instance
 */
export function updateSprint(dt, tail) {
    const tailLength = tail ? tail.getLength() : 0;

    if (moveState.sprintHeld && tailLength > 0) {
        moveState.run = 1;
        burnTimer += dt;
        if (burnTimer >= SPRINT_BURN_INTERVAL) {
            burnTimer -= SPRINT_BURN_INTERVAL;
            if (tail) {
                tail.removeLastSegments(1);
                eventBus.emit('tail:burned', {
                    entityId: 'player',
                    segmentsBurned: 1,
                    newLength: tail.getLength()
                });
            }
        }
        eventBus.emit('entity:sprinting', { id: 'player', active: true });
    } else {
        moveState.run = 0;
        burnTimer = 0;
        if (moveState.sprintHeld) {
            // Shift held but no tail — no sprint
            eventBus.emit('entity:sprinting', { id: 'player', active: false });
        }
    }
}

/**
 * Returns current sprint state for HUD rendering.
 * @param {import('./Tail.js').SnakeTail|null} tail
 */
export function getSprintState(tail, playerScale) {
    const tailLength = tail ? tail.getLength() : 0;
    const isActive = moveState.sprintHeld && tailLength > 0;
    return {
        tailLength,
        burnProgress: burnTimer / SPRINT_BURN_INTERVAL, // 0..1 how close to burning next segment
        isActive,
        isEmpty: tailLength <= 0,
        sprintHeld: moveState.sprintHeld,
        playerScale: playerScale || 1.0
    };
}
