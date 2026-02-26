/**
 * @module CollisionHandler
 * Processes physics collision events and dispatches to the unified PickupManager.
 */
import { createLogger } from './Logger.js';
import { eventBus } from './EventBus.js';

const log = createLogger('Collision');

export class CollisionHandler {
    /**
     * @param {RAPIER.World} world - The Rapier physics world
     * @param {PickupManager} pickupManager - Unified pickup manager
     */
    constructor(world, pickupManager) {
        this.world = world;
        this.pickupManager = pickupManager;
        this.deathManager = null;
        this.botManager = null;
    }

    /**
     * Set the DeathManager reference (set after construction to avoid circular deps).
     * @param {DeathManager} deathManager
     */
    setDeathManager(deathManager) {
        this.deathManager = deathManager;
    }

    /**
     * Set the BotManager reference.
     * @param {BotManager} botManager
     */
    setBotManager(botManager) {
        this.botManager = botManager;
    }

    /**
     * Process collision events from the event queue
     * @param {EventQueue} eventQueue - Rapier physics event queue
     * @param {THREE.Mesh} playerMesh - Player mesh for position reference
     */
    processCollisions(eventQueue, playerMesh) {
        eventQueue.drainCollisionEvents((handle1, handle2, started) => {
            const collider1 = this.world.getCollider(handle1);
            const collider2 = this.world.getCollider(handle2);

            if (!collider1 || !collider2) return;

            const type1 = collider1?.userData?.type;
            const type2 = collider2?.userData?.type;

            // Player-coin collision
            if ((type1 === 'player' && type2 === 'coin') || (type2 === 'player' && type1 === 'coin')) {
                this.handlePickupCollision(collider1, collider2, type1, type2, started, 'player', 'coin');
            }

            // Head-to-tail collision (player or bot head hits any tail sensor)
            if ((type1 === 'player' && type2 === 'tail') || (type2 === 'player' && type1 === 'tail') ||
                (type1 === 'bot' && type2 === 'tail') || (type2 === 'bot' && type1 === 'tail')) {
                this.handleHeadTailCollision(collider1, collider2, type1, type2, started);
            }

            // Bot-coin collision
            if ((type1 === 'bot' && type2 === 'coin') || (type2 === 'bot' && type1 === 'coin')) {
                const botCollider = (type1 === 'bot') ? collider1 : collider2;
                const botId = botCollider?.userData?.entityId;
                if (botId) {
                    this.handlePickupCollision(collider1, collider2, type1, type2, started, botId, 'coin');
                }
            }

            // Player-fruit collision
            if ((type1 === 'player' && type2 === 'fruit') || (type2 === 'player' && type1 === 'fruit')) {
                this.handlePickupCollision(collider1, collider2, type1, type2, started, 'player', 'fruit');
            }

            // Bot-fruit collision
            if ((type1 === 'bot' && type2 === 'fruit') || (type2 === 'bot' && type1 === 'fruit')) {
                const botCollider = (type1 === 'bot') ? collider1 : collider2;
                const botId = botCollider?.userData?.entityId;
                if (botId) {
                    this.handlePickupCollision(collider1, collider2, type1, type2, started, botId, 'fruit');
                }
            }

            // Player-waterdrop collision
            if ((type1 === 'player' && type2 === 'waterdrop') || (type2 === 'player' && type1 === 'waterdrop')) {
                this.handlePickupCollision(collider1, collider2, type1, type2, started, 'player', 'waterdrop');
            }

            // Bot-waterdrop collision
            if ((type1 === 'bot' && type2 === 'waterdrop') || (type2 === 'bot' && type1 === 'waterdrop')) {
                const botCollider = (type1 === 'bot') ? collider1 : collider2;
                const botId = botCollider?.userData?.entityId;
                if (botId) {
                    this.handlePickupCollision(collider1, collider2, type1, type2, started, botId, 'waterdrop');
                }
            }

            // Player-ring collision
            if ((type1 === 'player' && type2 === 'ring') || (type2 === 'player' && type1 === 'ring')) {
                this.handlePickupCollision(collider1, collider2, type1, type2, started, 'player', 'ring');
            }

            // Bot-ring collision
            if ((type1 === 'bot' && type2 === 'ring') || (type2 === 'bot' && type1 === 'ring')) {
                const botCollider = (type1 === 'bot') ? collider1 : collider2;
                const botId = botCollider?.userData?.entityId;
                if (botId) {
                    this.handlePickupCollision(collider1, collider2, type1, type2, started, botId, 'ring');
                }
            }
        });
    }

    /**
     * Generic pickup collision handler — queues collision to PickupManager.
     */
    handlePickupCollision(collider1, collider2, type1, type2, started, entityId, pickupType) {
        if (!started) return;

        const pickupCollider = (type1 === pickupType) ? collider1 : collider2;
        const parentBody = pickupCollider?.parent();
        const handle = parentBody?.handle;

        if (handle != null) {
            this.pickupManager.queueCollision(pickupType, entityId, handle);
        }
    }

    /**
     * Handles a head-to-tail collision (any entity head hits another entity's tail sensor).
     */
    handleHeadTailCollision(collider1, collider2, type1, type2, started) {
        if (!started) return;
        if (!this.deathManager) return;

        // Determine which is the head and which is the tail
        let headEntityId, tailEntityId;

        if (type1 === 'tail') {
            tailEntityId = collider1.userData.entityId;
            headEntityId = collider2.userData.entityId;
        } else {
            tailEntityId = collider2.userData.entityId;
            headEntityId = collider1.userData.entityId;
        }

        // Ignore self-collision (head entity === tail entity)
        if (headEntityId === tailEntityId) return;

        // Kill the head entity
        this.deathManager.killEntity(headEntityId, tailEntityId);
    }
}
