/**
 * @module DeathManager
 * Handles death sequences, coin scattering, respawn, and invulnerability for any entity.
 */
import * as THREE from 'three';
import { eventBus } from './EventBus.js';
import { COIN_SPAWN_AREA_XZ } from './PhysicsConfig.js';
import { createLogger } from './Logger.js';

const log = createLogger('DeathManager');

const INVULNERABILITY_DURATION = 2.0; // seconds
const BLINK_INTERVAL = 0.15;          // seconds between opacity toggles
const MAX_SCATTERED_COINS = 10;       // cap to avoid lag

export class DeathManager {
    /**
     * @param {THREE.Scene} scene
     * @param {RAPIER.World} world
     * @param {PickupManager} pickupManager
     */
    constructor(scene, world, pickupManager) {
        this.scene = scene;
        this.world = world;
        this.pickupManager = pickupManager;

        // Registered entities: Map<entityId, { mesh, body, tail, isBot, originalColor, originalOpacity }>
        this.entities = new Map();

        // Invulnerability timers: Map<entityId, { timer, blinkTimer, visible }>
        this.invulnerable = new Map();

        // RingPickup handler reference — set externally for shield/ghost immunity
        this._ringHandler = null;
    }

    /**
     * Sets the RingPickup handler reference for shield/ghost immunity.
     * @param {RingPickup} ringHandler
     */
    setRingHandler(ringHandler) {
        this._ringHandler = ringHandler;
    }

    /**
     * Register an entity so DeathManager can manage its death/respawn.
     * @param {string} id
     * @param {{ mesh: THREE.Mesh, body: RAPIER.RigidBody, tail: SnakeTail, isBot: boolean }} data
     */
    registerEntity(id, { mesh, body, tail, isBot }) {
        this.entities.set(id, {
            mesh,
            body,
            tail,
            isBot,
            originalColor: mesh.material.color.clone(),
            originalOpacity: mesh.material.opacity != null ? mesh.material.opacity : 1.0
        });
    }

    /**
     * Kill an entity — scatter coins from tail, reset, respawn.
     * @param {string} entityId - The entity that died
     * @param {string} killedById - The entity whose tail was hit
     */
    killEntity(entityId, killedById) {
        const entity = this.entities.get(entityId);
        if (!entity) return;

        // Skip if invulnerable
        if (this.isInvulnerable(entityId)) return;

        // Skip if entity has shield or ghost power
        if (this._ringHandler) {
            if (this._ringHandler.hasPower(entityId, 'SHIELD') ||
                this._ringHandler.hasPower(entityId, 'GHOST')) {
                return;
            }
        }

        const deathPos = {
            x: entity.mesh.position.x,
            y: entity.mesh.position.y,
            z: entity.mesh.position.z
        };
        const tailLength = entity.tail.getLength();

        log.info(`${entityId} killed by ${killedById} (tail: ${tailLength})`);

        // Scatter coins from tail segments (capped)
        const coinsToScatter = Math.min(tailLength, MAX_SCATTERED_COINS);
        for (let i = 0; i < coinsToScatter; i++) {
            const seg = entity.tail.segments[i];
            if (seg && seg.mesh) {
                const pos = seg.mesh.position.clone();
                // Offset slightly so coins don't stack
                pos.x += (Math.random() - 0.5) * 2;
                pos.z += (Math.random() - 0.5) * 2;
                pos.y = 5; // Drop from above
                this.pickupManager.spawnAt('coin', pos);
            }
        }

        // Deactivate any active power
        if (this._ringHandler) {
            this._ringHandler.deactivatePower(entityId);
        }

        // Reset tail
        entity.tail.reset();

        // Reset player scale
        entity.mesh.scale.setScalar(1.0);

        // Brief death flash (turn white)
        entity.mesh.material.color.set(0xffffff);
        setTimeout(() => {
            if (entity.mesh.material) {
                entity.mesh.material.color.copy(entity.originalColor);
            }
        }, 500);

        // Respawn at random position
        const spawnX = (Math.random() - 0.5) * COIN_SPAWN_AREA_XZ * 0.8;
        const spawnZ = (Math.random() - 0.5) * COIN_SPAWN_AREA_XZ * 0.8;
        entity.body.setTranslation({ x: spawnX, y: 1.0, z: spawnZ }, true);
        entity.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        entity.body.setAngvel({ x: 0, y: 0, z: 0 }, true);

        // Start invulnerability
        this.invulnerable.set(entityId, {
            timer: INVULNERABILITY_DURATION,
            blinkTimer: 0,
            visible: true
        });

        // Emit events
        eventBus.emit('entity:died', {
            id: entityId,
            killedBy: killedById,
            position: deathPos,
            tailLength
        });
        eventBus.emit('entity:spawned', {
            id: entityId,
            position: { x: spawnX, y: 1.0, z: spawnZ },
            isBot: entity.isBot
        });
    }

    /**
     * Update invulnerability timers and blinking effect.
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        for (const [entityId, state] of this.invulnerable) {
            state.timer -= dt;

            if (state.timer <= 0) {
                // Invulnerability expired — ensure visible
                const entity = this.entities.get(entityId);
                if (entity) {
                    entity.mesh.visible = true;
                    entity.mesh.material.opacity = entity.originalOpacity;
                }
                this.invulnerable.delete(entityId);
                continue;
            }

            // Blinking effect
            state.blinkTimer += dt;
            if (state.blinkTimer >= BLINK_INTERVAL) {
                state.blinkTimer -= BLINK_INTERVAL;
                state.visible = !state.visible;
                const entity = this.entities.get(entityId);
                if (entity) {
                    entity.mesh.visible = state.visible;
                }
            }
        }
    }

    /**
     * Check if an entity is currently invulnerable.
     * @param {string} entityId
     * @returns {boolean}
     */
    isInvulnerable(entityId) {
        return this.invulnerable.has(entityId);
    }

    /**
     * Soft reset for round transitions — resets position, scale, tail, and velocity
     * without coin scatter, death flash, death event, or invulnerability.
     * @param {string} entityId
     */
    resetEntity(entityId) {
        const entity = this.entities.get(entityId);
        if (!entity) return;

        // Clear any active invulnerability
        if (this.invulnerable.has(entityId)) {
            entity.mesh.visible = true;
            entity.mesh.material.opacity = entity.originalOpacity;
            this.invulnerable.delete(entityId);
        }

        // Deactivate any active ring power
        if (this._ringHandler) {
            this._ringHandler.deactivatePower(entityId);
        }

        // Reset tail
        entity.tail.reset();

        // Reset scale
        entity.mesh.scale.setScalar(1.0);

        // Restore original color
        entity.mesh.material.color.copy(entity.originalColor);

        // Respawn at random position
        const spawnX = (Math.random() - 0.5) * COIN_SPAWN_AREA_XZ * 0.8;
        const spawnZ = (Math.random() - 0.5) * COIN_SPAWN_AREA_XZ * 0.8;
        entity.body.setTranslation({ x: spawnX, y: 1.0, z: spawnZ }, true);
        entity.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        entity.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
}
