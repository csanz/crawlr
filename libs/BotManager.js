/**
 * @module BotManager
 * AI bot snakes — spawning, state machine AI, movement, and tail management.
 */
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d';
import { SnakeTail } from './Tail.js';
import { eventBus } from './EventBus.js';
import { addEyes, computeGrowth } from './Player.js';
import {
    PLAYER_SPEED,
    COIN_SPAWN_AREA_XZ,
    GROUND_SIZE_VISUAL,
    TAIL_SEGMENT_ROUNDNESS,
    BOT_SPEED_MULTIPLIER,
    BOT_SPRINT_SPEED_MULTIPLIER,
    BOT_INITIAL_TAIL_LENGTH,
    BOT_VISION_RANGE,
    BOT_DANGER_RANGE,
    BOT_WANDER_TURN_INTERVAL_MIN,
    BOT_WANDER_TURN_INTERVAL_MAX
} from './PhysicsConfig.js';
import { createLogger } from './Logger.js';
import { addNameLabel, generateBotName } from './NameLabels.js';

const log = createLogger('BotManager');

// AI states
const AI_STATE = {
    WANDER: 'WANDER',
    CHASE_COIN: 'CHASE_COIN',
    AVOID_RING: 'AVOID_RING',
    AVOID: 'AVOID',
    ATTACK: 'ATTACK'
};

// Pre-allocated reusable vectors
const _dir = new THREE.Vector3();
const _toTarget = new THREE.Vector3();

// Shared bot geometry (created once)
let sharedBotGeometry = null;

function getSharedBotGeometry() {
    if (sharedBotGeometry) return sharedBotGeometry;

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
    sharedBotGeometry = geometry;
    return geometry;
}

export class BotManager {
    /**
     * @param {THREE.Scene} scene
     * @param {RAPIER.World} world
     * @param {PickupManager} pickupManager
     * @param {DeathManager} deathManager
     */
    constructor(scene, world, pickupManager, deathManager) {
        this.scene = scene;
        this.world = world;
        this.pickupManager = pickupManager;
        this.deathManager = deathManager;
        this.bots = [];
        this.nextBotId = 0;
    }

    /**
     * Spawn a new bot snake.
     * @returns {Object} The bot data
     */
    spawnBot() {
        const id = `bot-${this.nextBotId++}`;
        const hue = Math.random();
        const color = new THREE.Color().setHSL(hue, 0.9, 0.55);

        // Create mesh
        const material = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
        const mesh = new THREE.Mesh(getSharedBotGeometry(), material);
        mesh.castShadow = true;
        addEyes(mesh);

        // Floating name label
        const botName = generateBotName();
        addNameLabel(mesh, botName);

        const spawnX = (Math.random() - 0.5) * COIN_SPAWN_AREA_XZ * 0.8;
        const spawnZ = (Math.random() - 0.5) * COIN_SPAWN_AREA_XZ * 0.8;
        mesh.position.set(spawnX, 1.0, spawnZ);
        this.scene.add(mesh);

        // Physics body
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(spawnX, 1.0, spawnZ)
            .setLinearDamping(0.5);
        const body = this.world.createRigidBody(bodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
            .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
        const collider = this.world.createCollider(colliderDesc, body);
        collider.userData = { type: 'bot', entityId: id };

        // Create tail
        const tail = new SnakeTail(this.scene, this.world, mesh, color, id);

        // Register with death manager
        this.deathManager.registerEntity(id, { mesh, body, tail, isBot: true });

        // Build initial tail segments
        for (let i = 0; i < BOT_INITIAL_TAIL_LENGTH; i++) {
            tail.updatePositionHistory(mesh.position);
        }
        // Fill some history so segments have spread
        for (let i = 0; i < 50; i++) {
            tail.updatePositionHistory(mesh.position);
        }
        for (let i = 0; i < BOT_INITIAL_TAIL_LENGTH; i++) {
            tail.addSegment(mesh.position.clone());
        }

        const bot = {
            id,
            mesh,
            body,
            tail,
            color,
            angle: Math.random() * Math.PI * 2,
            aiState: AI_STATE.WANDER,
            stateTimer: 0,
            wanderTurnTimer: this.randomWanderInterval(),
            sprinting: false,
            prevAngle: 0,
            spinAccum: 0       // cumulative angle change to detect circling
        };

        this.bots.push(bot);

        eventBus.emit('entity:spawned', {
            id,
            position: { x: spawnX, y: 1.0, z: spawnZ },
            isBot: true
        });

        log.info(`Spawned ${id} at (${spawnX.toFixed(1)}, ${spawnZ.toFixed(1)})`);
        return bot;
    }

    /**
     * Grow a bot's tail by one segment (called when bot collects a coin).
     * @param {string} botId
     */
    growBotTail(botId) {
        const bot = this.bots.find(b => b.id === botId);
        if (!bot) return;
        bot.tail.addSegment(bot.mesh.position.clone());
        // Grow the bot mesh (same tier system as player)
        bot.mesh.scale.setScalar(computeGrowth(bot.mesh.scale.x));
    }

    /**
     * Update all bots.
     * @param {number} dt
     * @param {THREE.Vector3} playerPosition
     * @param {PickupManager} pickupManager
     */
    update(dt, playerPosition, pickupManager) {
        const halfGround = GROUND_SIZE_VISUAL / 2 - 5;
        const activeCoins = pickupManager.getActive('coin');
        const activeFruits = pickupManager.getActive('fruit');
        const activeWaterDrops = pickupManager.getActive('waterdrop');
        const activeRings = pickupManager.getActive('ring');

        for (const bot of this.bots) {
            this.updateAI(bot, dt, playerPosition, activeCoins, activeRings, activeFruits, activeWaterDrops);
            this.updateMovement(bot, dt, halfGround);

            // Sync mesh to physics
            const pos = bot.body.translation();
            bot.mesh.position.set(pos.x, pos.y, pos.z);

            // Update tail
            bot.tail.updatePositionHistory(bot.mesh.position);
            bot.tail.updatePositions(true);

            // Emit move event
            eventBus.emit('entity:move', {
                id: bot.id,
                x: pos.x,
                z: pos.z,
                angle: bot.angle,
                sprinting: bot.sprinting
            });
        }
    }

    /**
     * AI state machine.
     */
    updateAI(bot, dt, playerPos, activeCoins, activeRings, activeFruits, activeWaterDrops) {
        bot.stateTimer += dt;

        // Find nearest ring (higher priority than coins)
        let nearestRing = null;
        let nearestRingDist = Infinity;
        if (activeRings) {
            for (const [, ringData] of activeRings) {
                const dx = ringData.mesh.position.x - bot.mesh.position.x;
                const dz = ringData.mesh.position.z - bot.mesh.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist < nearestRingDist) {
                    nearestRingDist = dist;
                    nearestRing = ringData;
                }
            }
        }

        // Find nearest coin
        let nearestCoin = null;
        let nearestCoinDist = Infinity;
        if (activeCoins) {
            activeCoins.forEach(coinData => {
                const dx = coinData.mesh.position.x - bot.mesh.position.x;
                const dz = coinData.mesh.position.z - bot.mesh.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist < nearestCoinDist) {
                    nearestCoinDist = dist;
                    nearestCoin = coinData;
                }
            });
        }

        // Find nearest fruit — prefer over coins if within vision range (worth 2x)
        if (activeFruits) {
            for (const [, fruitData] of activeFruits) {
                const dx = fruitData.mesh.position.x - bot.mesh.position.x;
                const dz = fruitData.mesh.position.z - bot.mesh.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist < BOT_VISION_RANGE && dist < nearestCoinDist) {
                    nearestCoinDist = dist;
                    nearestCoin = fruitData;
                }
            }
        }

        // Find nearest water drop — prefer like fruits (worth 2x)
        if (activeWaterDrops) {
            for (const [, dropData] of activeWaterDrops) {
                const dx = dropData.mesh.position.x - bot.mesh.position.x;
                const dz = dropData.mesh.position.z - bot.mesh.position.z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist < BOT_VISION_RANGE && dist < nearestCoinDist) {
                    nearestCoinDist = dist;
                    nearestCoin = dropData;
                }
            }
        }

        // Find nearest threat (other snake heads)
        let nearestThreatDist = Infinity;
        let nearestThreatAngle = 0;

        // Check player as threat
        if (playerPos) {
            const dx = playerPos.x - bot.mesh.position.x;
            const dz = playerPos.z - bot.mesh.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < nearestThreatDist) {
                nearestThreatDist = dist;
                nearestThreatAngle = Math.atan2(dx, dz);
            }
        }

        // Check other bots as threats
        for (const other of this.bots) {
            if (other.id === bot.id) continue;
            const dx = other.mesh.position.x - bot.mesh.position.x;
            const dz = other.mesh.position.z - bot.mesh.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < nearestThreatDist) {
                nearestThreatDist = dist;
                nearestThreatAngle = Math.atan2(dx, dz);
            }
        }

        // State transitions
        switch (bot.aiState) {
            case AI_STATE.WANDER:
                if (nearestThreatDist < BOT_DANGER_RANGE) {
                    bot.aiState = AI_STATE.AVOID;
                    bot.stateTimer = 0;
                } else if (nearestRing && nearestRingDist < BOT_DANGER_RANGE) {
                    // Ring nearby — steer away from it
                    bot.aiState = AI_STATE.AVOID_RING;
                    bot.stateTimer = 0;
                } else if (nearestCoin && nearestCoinDist < BOT_VISION_RANGE) {
                    bot.aiState = AI_STATE.CHASE_COIN;
                    bot.stateTimer = 0;
                } else {
                    // Random wandering turns
                    bot.wanderTurnTimer -= dt;
                    if (bot.wanderTurnTimer <= 0) {
                        bot.angle += (Math.random() - 0.5) * Math.PI * 0.8;
                        bot.wanderTurnTimer = this.randomWanderInterval();
                    }
                }
                bot.sprinting = false;
                break;

            case AI_STATE.AVOID_RING:
                if (bot.stateTimer > 1.0 || !nearestRing || nearestRingDist > BOT_DANGER_RANGE * 1.5) {
                    bot.aiState = AI_STATE.WANDER;
                    bot.stateTimer = 0;
                } else {
                    // Steer away from nearest ring
                    const ringAngle = Math.atan2(
                        nearestRing.mesh.position.x - bot.mesh.position.x,
                        nearestRing.mesh.position.z - bot.mesh.position.z
                    );
                    const awayFromRing = ringAngle + Math.PI;
                    bot.angle = this.lerpAngle(bot.angle, awayFromRing, dt * 6);
                }
                bot.sprinting = false;
                break;

            case AI_STATE.CHASE_COIN:
                if (nearestThreatDist < BOT_DANGER_RANGE) {
                    bot.aiState = AI_STATE.AVOID;
                    bot.stateTimer = 0;
                } else if (nearestRing && nearestRingDist < BOT_DANGER_RANGE) {
                    // Ring in the way — dodge it first
                    bot.aiState = AI_STATE.AVOID_RING;
                    bot.stateTimer = 0;
                } else if (!nearestCoin || nearestCoinDist > BOT_VISION_RANGE) {
                    bot.aiState = AI_STATE.WANDER;
                    bot.stateTimer = 0;
                } else {
                    // Steer toward nearest coin
                    const targetAngle = Math.atan2(
                        nearestCoin.mesh.position.x - bot.mesh.position.x,
                        nearestCoin.mesh.position.z - bot.mesh.position.z
                    );
                    bot.angle = this.lerpAngle(bot.angle, targetAngle, dt * 5);

                    // Sprint if we have tail segments to burn
                    bot.sprinting = bot.tail.getLength() > 5 && nearestCoinDist < BOT_VISION_RANGE * 0.5;
                }
                break;

            case AI_STATE.AVOID:
                if (bot.stateTimer > 1.0 || nearestThreatDist > BOT_DANGER_RANGE * 1.5) {
                    bot.aiState = AI_STATE.WANDER;
                    bot.stateTimer = 0;
                } else {
                    // Turn away from threat
                    const awayAngle = nearestThreatAngle + Math.PI;
                    bot.angle = this.lerpAngle(bot.angle, awayAngle, dt * 8);
                }
                bot.sprinting = false;
                break;

            case AI_STATE.ATTACK:
                if (nearestThreatDist > BOT_VISION_RANGE || bot.tail.getLength() <= 5) {
                    bot.aiState = AI_STATE.WANDER;
                    bot.stateTimer = 0;
                } else {
                    // Steer to cut off target
                    const cutoffAngle = nearestThreatAngle + Math.PI * 0.3;
                    bot.angle = this.lerpAngle(bot.angle, cutoffAngle, dt * 4);
                    bot.sprinting = bot.tail.getLength() > 8;
                }
                break;
        }

        // Check if bot should enter attack mode
        if (bot.aiState === AI_STATE.WANDER && bot.tail.getLength() > 10 && nearestThreatDist < BOT_VISION_RANGE) {
            bot.aiState = AI_STATE.ATTACK;
            bot.stateTimer = 0;
        }

        // Spin detection — break out of tight circles
        let angleDelta = bot.angle - bot.prevAngle;
        if (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
        if (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
        bot.spinAccum += Math.abs(angleDelta);
        bot.spinAccum *= 0.95; // decay
        bot.prevAngle = bot.angle;

        // If accumulated turning exceeds ~2 full rotations, force a breakout
        if (bot.spinAccum > Math.PI * 4) {
            bot.angle += (Math.random() - 0.5) * Math.PI;
            bot.aiState = AI_STATE.WANDER;
            bot.stateTimer = 0;
            bot.spinAccum = 0;
            bot.wanderTurnTimer = this.randomWanderInterval();
        }

        // Time-cap ATTACK state to prevent indefinite circling
        if (bot.aiState === AI_STATE.ATTACK && bot.stateTimer > 5) {
            bot.aiState = AI_STATE.WANDER;
            bot.stateTimer = 0;
            bot.wanderTurnTimer = this.randomWanderInterval();
        }

        // Sprint burns tail for bots too
        if (bot.sprinting && bot.tail.getLength() > 0) {
            bot.sprintBurnTimer = (bot.sprintBurnTimer || 0) + dt;
            if (bot.sprintBurnTimer >= 1.5) {
                bot.sprintBurnTimer -= 1.5;
                bot.tail.removeLastSegments(1);
                eventBus.emit('tail:burned', {
                    entityId: bot.id,
                    segmentsBurned: 1,
                    newLength: bot.tail.getLength()
                });
            }
        } else {
            bot.sprintBurnTimer = 0;
        }
    }

    /**
     * Update bot movement — apply velocity via Rapier.
     */
    updateMovement(bot, dt, halfGround) {
        const ringHandler = this.pickupManager ? this.pickupManager.getHandler('ring') : null;
        const powerMultiplier = (ringHandler && ringHandler.hasPower(bot.id, 'SPEED_BURST')) ? 2.0 : 1.0;
        const speed = PLAYER_SPEED * BOT_SPEED_MULTIPLIER *
            (bot.sprinting ? BOT_SPRINT_SPEED_MULTIPLIER : 1) * powerMultiplier;

        const vx = Math.sin(bot.angle) * speed;
        const vz = Math.cos(bot.angle) * speed;

        const currentVel = bot.body.linvel();
        bot.body.setLinvel({ x: vx, y: currentVel.y, z: vz }, true);

        // Update mesh rotation
        const targetQuat = new THREE.Quaternion();
        targetQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), bot.angle);
        bot.mesh.quaternion.slerp(targetQuat, 0.15);

        // Bounce off ground edges
        const pos = bot.body.translation();
        let bounced = false;
        if (pos.x > halfGround) {
            bot.angle = Math.PI - bot.angle;
            bounced = true;
        } else if (pos.x < -halfGround) {
            bot.angle = Math.PI - bot.angle;
            bounced = true;
        }
        if (pos.z > halfGround) {
            bot.angle = -bot.angle;
            bounced = true;
        } else if (pos.z < -halfGround) {
            bot.angle = -bot.angle;
            bounced = true;
        }

        // Clamp position to stay within bounds
        if (bounced) {
            const cx = Math.max(-halfGround, Math.min(halfGround, pos.x));
            const cz = Math.max(-halfGround, Math.min(halfGround, pos.z));
            bot.body.setTranslation({ x: cx, y: pos.y, z: cz }, true);
        }
    }

    /**
     * Smoothly interpolate between two angles.
     */
    lerpAngle(current, target, t) {
        let diff = target - current;
        // Normalize to -PI..PI
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        return current + diff * Math.min(t, 1);
    }

    randomWanderInterval() {
        return BOT_WANDER_TURN_INTERVAL_MIN +
            Math.random() * (BOT_WANDER_TURN_INTERVAL_MAX - BOT_WANDER_TURN_INTERVAL_MIN);
    }
}
