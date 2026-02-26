/**
 * @module BasePickup
 * Abstract base class for all pickup types. Defines the lifecycle contract
 * that each pickup handler must implement.
 */

export class BasePickup {
    constructor(scene, world) {
        this.scene = scene;
        this.world = world;
    }

    /** Override: static configuration for this pickup type. */
    static get config() {
        throw new Error('BasePickup.config must be overridden');
    }

    /** Override: sound definitions { collect: { name, volume } } */
    static get sounds() {
        return {};
    }

    /**
     * Build mesh + physics body at the given position.
     * Must return an instance object with at least { mesh, body }.
     * @param {THREE.Vector3} position
     * @returns {{ mesh, body, [key: string]: any }}
     */
    create(position) {
        throw new Error('BasePickup.create() must be overridden');
    }

    /**
     * Per-frame animation for a single instance (float, rotate, glow).
     * @param {Object} instance - The instance returned by create()
     * @param {number} time - Current time in seconds
     * @param {number} dt - Delta time
     */
    updateInstance(instance, time, dt) {
        // Optional — no-op by default
    }

    /**
     * Handle collision with an entity. Return value controls what happens next.
     * @param {string} entityId - 'player' or bot id
     * @param {Object} instance - The pickup instance
     * @param {Object} context - { playerMesh, botManager, playerBody, tail, entityMesh }
     * @returns {{ consumed: boolean, deferred?: Object }}
     */
    onCollect(entityId, instance, context) {
        throw new Error('BasePickup.onCollect() must be overridden');
    }

    /**
     * Tick deferred state (e.g. ring pass-through/stun timers).
     * Return true when the deferred action is complete.
     * @param {Object} data - The deferred data from onCollect
     * @param {number} dt - Delta time
     * @returns {boolean} true when done
     */
    updateDeferred(data, dt) {
        return true;
    }

    /**
     * Per-type global updates (cooldowns, particles).
     * @param {number} dt - Delta time
     */
    updateGlobal(dt) {
        // Optional — no-op by default
    }

    /**
     * Return radar info for an instance.
     * @param {Object} instance
     * @returns {{ x: number, z: number, color: string, type: string }}
     */
    getRadarInfo(instance) {
        throw new Error('BasePickup.getRadarInfo() must be overridden');
    }

    /**
     * Pre-physics update hook (e.g. velocity backup).
     */
    prePhysicsUpdate() {
        // Optional — no-op by default
    }

    /**
     * Clean up mesh + physics for an instance.
     * @param {Object} instance
     */
    dispose(instance) {
        if (instance.mesh) {
            this.scene.remove(instance.mesh);
            instance.mesh.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => mat.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        }
        if (instance.body) {
            try {
                this.world.removeRigidBody(instance.body);
            } catch (_) {
                // Body may already be removed
            }
        }
    }
}
