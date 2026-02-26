/**
 * @module FruitPickup
 * Rare fruit pickup — worth 2x coins and 2x growth.
 * Spawns infrequently, auto-despawns after 15s, with sparkle particles.
 */
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d';
import { BasePickup } from './BasePickup.js';
import { playEffect } from '../Sound.js';
import { addTailSegment } from '../Tail.js';
import { growPlayer } from '../Player.js';
import { eventBus } from '../EventBus.js';
import {
    MAX_FRUITS, FRUIT_RADIUS, FRUIT_COLOR,
    COIN_DROP_HEIGHT, COIN_SPAWN_AREA_XZ
} from '../PhysicsConfig.js';

export class FruitPickup extends BasePickup {
    constructor(scene, world) {
        super(scene, world);
        this.playerBody = null;
        this.playerMesh = null;
        this.botManager = null;
        this._ringHandler = null;
        this._coinPickup = null;
    }

    static get config() {
        return {
            type: 'fruit',
            maxCount: MAX_FRUITS,
            spawnAreaXZ: COIN_SPAWN_AREA_XZ,
            spawnHeight: COIN_DROP_HEIGHT,
            despawnAfter: 15,
            radarColor: 'orange',
            radarShape: 'circle'
        };
    }

    static get sounds() {
        return { collect: { name: 'fruitCollect', volume: 0.25 } };
    }

    setPlayerBody(playerBody) { this.playerBody = playerBody; }
    setPlayerMesh(playerMesh) { this.playerMesh = playerMesh; }
    setBotManager(botManager) { this.botManager = botManager; }
    setRingHandler(ringHandler) { this._ringHandler = ringHandler; }
    setCoinPickup(coinPickup) { this._coinPickup = coinPickup; }

    create(position) {
        const group = new THREE.Group();
        group.position.copy(position);

        // Main sphere — larger than coins
        const sphereGeo = new THREE.SphereGeometry(FRUIT_RADIUS * 0.7, 12, 10);
        const material = new THREE.MeshStandardMaterial({
            color: FRUIT_COLOR,
            emissive: FRUIT_COLOR,
            emissiveIntensity: 1.8,
            metalness: 0.4,
            roughness: 0.25,
        });
        const mainMesh = new THREE.Mesh(sphereGeo, material);
        group.add(mainMesh);

        // Outer glow
        const glowGeo = new THREE.SphereGeometry(FRUIT_RADIUS, 14, 10);
        const glowMat = new THREE.MeshBasicMaterial({
            color: FRUIT_COLOR,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const glowMesh = new THREE.Mesh(glowGeo, glowMat);
        group.add(glowMesh);

        // 3 orbiting sparkle particles
        const sparkleGeo = new THREE.SphereGeometry(0.08, 6, 4);
        for (let i = 0; i < 3; i++) {
            const sparkleMat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.8,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const sparkle = new THREE.Mesh(sparkleGeo, sparkleMat);
            sparkle.userData.sparkleIndex = i;
            group.add(sparkle);
        }

        this.scene.add(group);

        // Physics body
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z);
        const body = this.world.createRigidBody(bodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.ball(FRUIT_RADIUS)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
            .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
        const collider = this.world.createCollider(colliderDesc, body);
        collider.userData = { type: 'fruit', mesh: group };

        return { mesh: group, body, spawnedAt: performance.now() * 0.001 };
    }

    updateInstance(instance, time, dt) {
        const body = this.world.getRigidBody(instance.body.handle);
        if (!body) return;

        const pos = body.translation();
        instance.mesh.position.set(pos.x, pos.y, pos.z);

        // Slower floating bob than coins
        const floatOffset = Math.sin(time * 1.5) * 0.15;
        instance.mesh.position.y += floatOffset;

        // Y rotation
        instance.mesh.rotation.y += 0.015;

        // Glow pulsing
        if (instance.mesh.children.length >= 2) {
            const mainMesh = instance.mesh.children[0];
            const glowMesh = instance.mesh.children[1];

            const pulseFactor = 1.0 + Math.sin(time * 2.5) * 0.12;
            glowMesh.scale.set(pulseFactor, pulseFactor, pulseFactor);
            glowMesh.material.opacity = 0.25 + Math.sin(time * 3) * 0.12;

            if (mainMesh.material) {
                mainMesh.material.emissiveIntensity = 1.5 + Math.sin(time * 3) * 0.4;
            }
        }

        // Sparkle orbit animation
        for (let i = 2; i < instance.mesh.children.length; i++) {
            const sparkle = instance.mesh.children[i];
            const idx = sparkle.userData.sparkleIndex ?? (i - 2);
            const angle = time * 3 + (idx * Math.PI * 2 / 3);
            const orbitRadius = FRUIT_RADIUS * 1.2;
            sparkle.position.set(
                Math.cos(angle) * orbitRadius,
                Math.sin(time * 4 + idx) * 0.15,
                Math.sin(angle) * orbitRadius
            );
            sparkle.material.opacity = 0.5 + Math.sin(time * 5 + idx) * 0.3;
        }

        // Fade near despawn (last 2 seconds)
        if (instance.spawnedAt) {
            const age = time - instance.spawnedAt;
            const despawnTime = FruitPickup.config.despawnAfter;
            const fadeStart = despawnTime - 2;
            if (age > fadeStart) {
                const fadeAlpha = 1 - (age - fadeStart) / 2;
                const alpha = Math.max(0, fadeAlpha);
                // Pulse rapidly when fading
                const flashAlpha = alpha * (0.5 + 0.5 * Math.sin(time * 12));
                instance.mesh.children.forEach(child => {
                    if (child.material && child.material.transparent) {
                        child.material.opacity = child.material.opacity * flashAlpha;
                    }
                });
                if (instance.mesh.children[0]?.material) {
                    instance.mesh.children[0].material.opacity = flashAlpha;
                    instance.mesh.children[0].material.transparent = true;
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
        // 2x coin value
        if (this._coinPickup) {
            this._coinPickup.coinsCollected += 2;
        }

        playEffect('fruit:collect');

        // 2x growth
        if (this.playerMesh) {
            growPlayer(this.playerMesh);
            growPlayer(this.playerMesh);
        }

        // 2x tail segments (or 6x with growth surge)
        const hasGrowthSurge = this._ringHandler && this._ringHandler.hasPower('player', 'GROWTH_SURGE');
        const segmentsToAdd = hasGrowthSurge ? 6 : 2;
        const playerPos = context.entityMesh ? context.entityMesh.position.clone() : null;
        setTimeout(() => {
            for (let i = 0; i < segmentsToAdd; i++) {
                addTailSegment(this.scene, playerPos);
            }
        }, 0);

        eventBus.emit('tail:grew', { entityId: 'player', newLength: -1 });
        return { consumed: true };
    }

    _collectBot(botId, instance, context) {
        if (this.botManager) {
            const hasGrowthSurge = this._ringHandler && this._ringHandler.hasPower(botId, 'GROWTH_SURGE');
            const surgeCount = hasGrowthSurge ? 6 : 2;
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
            color: 'orange',
            type: 'fruit'
        };
    }
}
