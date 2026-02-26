/**
 * @module CoinPickup
 * Coin pickup handler — ported from CoinManager.js + Coin.js.
 * Instant collection: grow player, add tail, play sound.
 */
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d';
import { BasePickup } from './BasePickup.js';
import { playCoinCollect } from '../Sound.js';
import { addTailSegment } from '../Tail.js';
import { growPlayer } from '../Player.js';
import { eventBus } from '../EventBus.js';
import {
    MAX_COINS, COIN_DROP_HEIGHT, COIN_SPAWN_AREA_XZ,
    COIN_RADIUS, COIN_COLOR
} from '../PhysicsConfig.js';

export class CoinPickup extends BasePickup {
    constructor(scene, world) {
        super(scene, world);
        this.coinsCollected = 0;
        this.playerBody = null;
        this.playerMesh = null;
        this.botManager = null;
        this.lastVelocity = null;

        // Reference to the ring handler for growth surge checks
        this._ringHandler = null;
    }

    static get config() {
        return {
            type: 'coin',
            maxCount: MAX_COINS,
            spawnAreaXZ: COIN_SPAWN_AREA_XZ,
            spawnHeight: COIN_DROP_HEIGHT,
            despawnAfter: null, // coins don't auto-despawn
            radarColor: 'yellow',
            radarShape: 'circle'
        };
    }

    static get sounds() {
        return { collect: { name: 'coinCollect', volume: 0.15 } };
    }

    setPlayerBody(playerBody) {
        this.playerBody = playerBody;
    }

    setPlayerMesh(playerMesh) {
        this.playerMesh = playerMesh;
    }

    setBotManager(botManager) {
        this.botManager = botManager;
    }

    setRingHandler(ringHandler) {
        this._ringHandler = ringHandler;
    }

    create(position) {
        const coinGroup = new THREE.Group();
        coinGroup.position.copy(position);

        // Main sphere
        const sphereGeometry = new THREE.SphereGeometry(COIN_RADIUS * 0.7, 10, 8);
        const material = new THREE.MeshStandardMaterial({
            color: COIN_COLOR,
            emissive: COIN_COLOR,
            emissiveIntensity: 1.5,
            metalness: 0.5,
            roughness: 0.2,
        });
        const coinMesh = new THREE.Mesh(sphereGeometry, material);
        coinGroup.add(coinMesh);

        // Outer glow sphere
        const glowGeometry = new THREE.SphereGeometry(COIN_RADIUS, 12, 8);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: COIN_COLOR,
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
        coinGroup.add(glowMesh);

        this.scene.add(coinGroup);

        // Physics body
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z);
        const body = this.world.createRigidBody(bodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.ball(COIN_RADIUS)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
            .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
        const collider = this.world.createCollider(colliderDesc, body);
        collider.userData = { type: 'coin', mesh: coinGroup };

        return { mesh: coinGroup, body };
    }

    updateInstance(instance, time, dt) {
        const body = this.world.getRigidBody(instance.body.handle);
        if (!body) return;

        const pos = body.translation();
        instance.mesh.position.set(pos.x, pos.y, pos.z);

        // Floating bob
        const floatOffset = Math.sin(time * 2) * 0.1;
        instance.mesh.position.y += floatOffset;

        // Rotation
        instance.mesh.rotation.x += 0.01;
        instance.mesh.rotation.y += 0.005;

        // Glow pulsing
        if (instance.mesh.children.length >= 2) {
            const coinMesh = instance.mesh.children[0];
            const glowMesh = instance.mesh.children[1];

            const pulseFactor = 1.0 + Math.sin(time * 3) * 0.1;
            glowMesh.scale.set(pulseFactor, pulseFactor, pulseFactor);
            glowMesh.material.opacity = 0.25 + Math.sin(time * 4) * 0.1;

            if (coinMesh.material) {
                coinMesh.material.emissiveIntensity = 1.0 + Math.sin(time * 3.5) * 0.3;
            }
        }
    }

    prePhysicsUpdate() {
        if (this.playerBody) {
            const vel = this.playerBody.linvel();
            if (Math.abs(vel.x) > 0.01 || Math.abs(vel.z) > 0.01) {
                if (!this.lastVelocity) {
                    this.lastVelocity = { x: vel.x, y: vel.y, z: vel.z };
                } else {
                    this.lastVelocity.x = vel.x;
                    this.lastVelocity.y = vel.y;
                    this.lastVelocity.z = vel.z;
                }
            }
        }
    }

    onCollect(entityId, instance, context) {
        if (entityId === 'player') {
            return this._collectPlayer(instance, context);
        } else {
            return this._collectBot(entityId, instance, context);
        }
    }

    _collectPlayer(instance, context) {
        let currentVel = null;
        if (this.playerBody) {
            currentVel = this.playerBody.linvel();
        }

        this.coinsCollected++;
        playCoinCollect(0.15);

        if (this.playerMesh) {
            growPlayer(this.playerMesh);
        }

        // Growth surge: 3 tail segments per coin if ring power active
        const hasGrowthSurge = this._ringHandler && this._ringHandler.hasPower('player', 'GROWTH_SURGE');
        const segmentsToAdd = hasGrowthSurge ? 3 : 1;
        const playerPos = context.entityMesh ? context.entityMesh.position.clone() : null;
        setTimeout(() => {
            for (let i = 0; i < segmentsToAdd; i++) {
                addTailSegment(this.scene, playerPos);
            }
        }, 0);

        // Preserve player velocity
        if (this.playerBody) {
            const velToUse = currentVel || this.lastVelocity;
            if (velToUse && (Math.abs(velToUse.x) > 0.01 || Math.abs(velToUse.z) > 0.01)) {
                this.playerBody.setLinvel({ x: velToUse.x, y: velToUse.y, z: velToUse.z }, true);
                for (let i = 1; i <= 3; i++) {
                    setTimeout(() => {
                        if (this.playerBody && this.playerBody.isValid()) {
                            const factor = 1 - (i * 0.1);
                            this.playerBody.setLinvel({
                                x: velToUse.x * factor,
                                y: velToUse.y,
                                z: velToUse.z * factor
                            }, true);
                        }
                    }, i * 16);
                }
            }
        }

        eventBus.emit('tail:grew', { entityId: 'player', newLength: -1 });
        return { consumed: true };
    }

    _collectBot(botId, instance, context) {
        if (this.botManager) {
            const hasGrowthSurge = this._ringHandler && this._ringHandler.hasPower(botId, 'GROWTH_SURGE');
            const surgeCount = hasGrowthSurge ? 3 : 1;
            for (let i = 0; i < surgeCount; i++) {
                this.botManager.growBotTail(botId);
            }
        }
        return { consumed: true };
    }

    getRadarInfo(instance) {
        return {
            x: instance.mesh.position.x,
            z: instance.mesh.position.z,
            color: 'yellow',
            type: 'coin'
        };
    }
}
