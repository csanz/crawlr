/**
 * @module PickupManager
 * Central orchestrator for all pickup types. Replaces CoinManager + PowerRingManager
 * in the game loop with a single unified interface.
 */
import * as THREE from 'three';
import { eventBus } from '../EventBus.js';

export class PickupManager {
    constructor(scene, world) {
        this.scene = scene;
        this.world = world;

        // Registered pickup handlers: Map<type, handler>
        this.handlers = new Map();

        // Active instances per type: Map<type, Map<handle, instance>>
        this.instances = new Map();

        // Collision queue (populated during physics callback, processed next frame)
        this.collisionQueue = [];

        // Active deferred actions: Array<{ type, handle, data }>
        this.deferredActions = [];
    }

    /**
     * Register a pickup handler.
     * @param {BasePickup} handler
     */
    register(handler) {
        const type = handler.constructor.config.type;
        this.handlers.set(type, handler);
        this.instances.set(type, new Map());
    }

    /**
     * Get a handler by type name.
     * @param {string} type
     * @returns {BasePickup}
     */
    getHandler(type) {
        return this.handlers.get(type);
    }

    /**
     * Get active instances for a type (for bot AI queries).
     * @param {string} type
     * @returns {Map}
     */
    getActive(type) {
        return this.instances.get(type) || new Map();
    }

    /**
     * Pre-physics update (e.g. coin velocity backup).
     */
    prePhysicsUpdate() {
        for (const handler of this.handlers.values()) {
            handler.prePhysicsUpdate();
        }
    }

    /**
     * Queue a collision for processing next frame.
     * Called from CollisionHandler during physics callback.
     * @param {string} type - Pickup type ('coin', 'ring')
     * @param {string} entityId - Entity that collided ('player', 'bot-0', etc.)
     * @param {number} handle - Physics body handle
     * @param {Object} [extraData] - Additional collision data
     */
    queueCollision(type, entityId, handle, extraData) {
        this.collisionQueue.push({ type, entityId, handle, extraData });
    }

    /**
     * Process queued collisions from last frame.
     * Calls onCollect on each handler, manages consumed/deferred results.
     */
    processCollisions() {
        for (const { type, entityId, handle } of this.collisionQueue) {
            const handler = this.handlers.get(type);
            const activeMap = this.instances.get(type);
            if (!handler || !activeMap) continue;

            const instance = activeMap.get(handle);
            if (!instance) continue;

            // Build context for the handler
            const context = {
                entityMesh: this._getEntityMesh(entityId),
                entityId
            };

            const result = handler.onCollect(entityId, instance, context);

            if (result.consumed) {
                // Instant pickup — dispose and remove
                handler.dispose(instance);
                activeMap.delete(handle);

                eventBus.emit('pickup:collected', {
                    type,
                    entityId,
                    position: instance.mesh ? {
                        x: instance.mesh.position.x,
                        y: instance.mesh.position.y,
                        z: instance.mesh.position.z
                    } : null
                });
            } else if (result.deferred) {
                // Deferred action — keep instance (possibly modified), track state
                activeMap.delete(handle); // Remove from active map so it won't re-trigger
                this.deferredActions.push({
                    type,
                    handle,
                    data: result.deferred
                });
            }
        }
        this.collisionQueue = [];
    }

    /**
     * Spawn instances for each type up to maxCount.
     */
    spawn() {
        // Cache boulder positions for avoidance
        const boulderPositions = this.scene.userData.boulders?.positions || [];

        for (const [type, handler] of this.handlers) {
            const config = handler.constructor.config;
            const activeMap = this.instances.get(type);

            while (activeMap.size < config.maxCount) {
                let position;
                let attempts = 0;

                // Try to find a position that doesn't overlap boulders
                do {
                    // Randomize drop height so coins rain down in staggered waves
                    const height = config.spawnHeight > 1
                        ? config.spawnHeight * (0.3 + Math.random() * 0.7)
                        : config.spawnHeight;
                    position = new THREE.Vector3(
                        (Math.random() - 0.5) * config.spawnAreaXZ,
                        height,
                        (Math.random() - 0.5) * config.spawnAreaXZ
                    );
                    attempts++;
                } while (attempts < 20 && this._overlapsAnyBoulder(position, boulderPositions));

                const instance = handler.create(position);
                activeMap.set(instance.body.handle, instance);

                eventBus.emit('pickup:spawned', {
                    type,
                    id: instance.body.handle,
                    position: { x: position.x, y: position.y, z: position.z }
                });
            }
        }
    }

    _overlapsAnyBoulder(position, boulderPositions) {
        const clearance = 5; // minimum distance from boulder center
        for (const b of boulderPositions) {
            const dx = position.x - b.x;
            const dz = position.z - b.z;
            const minDist = b.r + clearance;
            if (dx * dx + dz * dz < minDist * minDist) return true;
        }
        return false;
    }

    /**
     * Spawn a specific pickup at a given position (e.g. coin scattering on death).
     * @param {string} type
     * @param {THREE.Vector3} position
     */
    spawnAt(type, position) {
        const handler = this.handlers.get(type);
        const activeMap = this.instances.get(type);
        if (!handler || !activeMap) return;

        const instance = handler.create(position);
        activeMap.set(instance.body.handle, instance);
    }

    /**
     * Main update: animate instances, tick deferred states, auto-despawn, global updates.
     * @param {number} dt
     */
    update(dt) {
        const time = performance.now() * 0.001;

        // Update each instance
        for (const [type, handler] of this.handlers) {
            const config = handler.constructor.config;
            const activeMap = this.instances.get(type);

            for (const [handle, instance] of activeMap) {
                // Auto-despawn check
                if (config.despawnAfter && instance.spawnedAt) {
                    if (time - instance.spawnedAt > config.despawnAfter) {
                        handler.dispose(instance);
                        activeMap.delete(handle);
                        continue;
                    }
                }

                handler.updateInstance(instance, time, dt);
            }

            // Global update (cooldowns, particles)
            handler.updateGlobal(dt);
        }

        // Tick deferred actions
        for (let i = this.deferredActions.length - 1; i >= 0; i--) {
            const action = this.deferredActions[i];
            const handler = this.handlers.get(action.type);
            if (!handler) {
                this.deferredActions.splice(i, 1);
                continue;
            }

            const done = handler.updateDeferred(action.data, dt);
            if (done) {
                this.deferredActions.splice(i, 1);
            }
        }
    }

    /**
     * Clear all active pickups and deferred actions (for round reset).
     */
    clearAll() {
        for (const [type, handler] of this.handlers) {
            const activeMap = this.instances.get(type);
            for (const [handle, instance] of activeMap) {
                handler.dispose(instance);
            }
            activeMap.clear();
        }
        this.deferredActions = [];
        this.collisionQueue = [];
    }

    /**
     * Aggregated radar data for all pickup types.
     * @returns {Array<{ x, z, color, type }>}
     */
    getRadarData() {
        const data = [];
        for (const [type, handler] of this.handlers) {
            const activeMap = this.instances.get(type);
            for (const [, instance] of activeMap) {
                data.push(handler.getRadarInfo(instance));
            }
        }
        return data;
    }

    /**
     * Get entity mesh for context building.
     * @private
     */
    _getEntityMesh(entityId) {
        if (entityId === 'player') {
            // Try to get from coin handler (which has playerMesh ref)
            const coinHandler = this.handlers.get('coin');
            return coinHandler ? coinHandler.playerMesh : null;
        }
        // For bots, get from botManager
        const coinHandler = this.handlers.get('coin');
        if (coinHandler && coinHandler.botManager) {
            const bot = coinHandler.botManager.bots.find(b => b.id === entityId);
            return bot ? bot.mesh : null;
        }
        return null;
    }
}
