/**
 * @module WaterDropPickup
 * Post-storm bonus pickup — blue water drops left behind after a storm ends.
 * Worth 2x coins and 2x growth (same as fruit). Auto-despawns after 20s.
 * Only spawned via event listener (maxCount=0 prevents auto-spawn).
 */
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d';
import { BasePickup } from './BasePickup.js';
import { playEffect } from '../Sound.js';
import { addTailSegment } from '../Tail.js';
import { growPlayer } from '../Player.js';
import { eventBus } from '../EventBus.js';
import {
    WATERDROP_RADIUS, WATERDROP_COLOR,
    COIN_SPAWN_AREA_XZ
} from '../PhysicsConfig.js';

export class WaterDropPickup extends BasePickup {
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
            type: 'waterdrop',
            maxCount: 0,
            spawnAreaXZ: COIN_SPAWN_AREA_XZ,
            spawnHeight: 1,
            despawnAfter: 20,
            radarColor: '#44aaff',
            radarShape: 'circle'
        };
    }

    static get sounds() {
        return { collect: { name: 'fruitCollect', volume: 0.2 } };
    }

    setPlayerBody(playerBody) { this.playerBody = playerBody; }
    setPlayerMesh(playerMesh) { this.playerMesh = playerMesh; }
    setBotManager(botManager) { this.botManager = botManager; }
    setRingHandler(ringHandler) { this._ringHandler = ringHandler; }
    setCoinPickup(coinPickup) { this._coinPickup = coinPickup; }

    create(position) {
        const group = new THREE.Group();
        group.position.copy(position);

        // Main water drop sphere — blue with emissive glow
        const sphereGeo = new THREE.SphereGeometry(WATERDROP_RADIUS * 0.7, 12, 10);
        const material = new THREE.MeshStandardMaterial({
            color: WATERDROP_COLOR,
            emissive: WATERDROP_COLOR,
            emissiveIntensity: 1.8,
            metalness: 0.5,
            roughness: 0.15,
            transparent: true,
            opacity: 0.9
        });
        const mainMesh = new THREE.Mesh(sphereGeo, material);
        group.add(mainMesh);

        // Outer glow
        const glowGeo = new THREE.SphereGeometry(WATERDROP_RADIUS, 14, 10);
        const glowMat = new THREE.MeshBasicMaterial({
            color: WATERDROP_COLOR,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const glowMesh = new THREE.Mesh(glowGeo, glowMat);
        group.add(glowMesh);

        // Ripple ring beneath (water ripple effect)
        const ringGeo = new THREE.RingGeometry(WATERDROP_RADIUS * 0.8, WATERDROP_RADIUS * 1.4, 24);
        const ringMat = new THREE.MeshBasicMaterial({
            color: WATERDROP_COLOR,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const rippleRing = new THREE.Mesh(ringGeo, ringMat);
        rippleRing.rotation.x = -Math.PI / 2;
        rippleRing.position.y = -WATERDROP_RADIUS * 0.5;
        group.add(rippleRing);

        this.scene.add(group);

        // Physics body
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z);
        const body = this.world.createRigidBody(bodyDesc);
        const colliderDesc = RAPIER.ColliderDesc.ball(WATERDROP_RADIUS)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
            .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
        const collider = this.world.createCollider(colliderDesc, body);
        collider.userData = { type: 'waterdrop', mesh: group };

        return { mesh: group, body, spawnedAt: performance.now() * 0.001 };
    }

    updateInstance(instance, time, dt) {
        const body = this.world.getRigidBody(instance.body.handle);
        if (!body) return;

        const pos = body.translation();
        instance.mesh.position.set(pos.x, pos.y, pos.z);

        // Gentle float bob
        const floatOffset = Math.sin(time * 1.2) * 0.1;
        instance.mesh.position.y += floatOffset;

        // Glow pulsing and ripple animation
        if (instance.mesh.children.length >= 3) {
            const mainMesh = instance.mesh.children[0];
            const glowMesh = instance.mesh.children[1];
            const rippleRing = instance.mesh.children[2];

            // Glow pulse
            const pulseFactor = 1.0 + Math.sin(time * 2.0) * 0.1;
            glowMesh.scale.set(pulseFactor, pulseFactor, pulseFactor);
            glowMesh.material.opacity = 0.2 + Math.sin(time * 2.5) * 0.1;

            if (mainMesh.material) {
                mainMesh.material.emissiveIntensity = 1.5 + Math.sin(time * 2.5) * 0.4;
            }

            // Ripple scale animation — expands and fades cyclically
            const rippleCycle = (time * 0.8) % 1.0;
            const rippleScale = 1.0 + rippleCycle * 0.6;
            rippleRing.scale.set(rippleScale, rippleScale, 1);
            rippleRing.material.opacity = 0.3 * (1.0 - rippleCycle);
        }

        // Fade in last 3s before despawn
        if (instance.spawnedAt) {
            const age = time - instance.spawnedAt;
            const despawnTime = WaterDropPickup.config.despawnAfter;
            const fadeStart = despawnTime - 3;
            if (age > fadeStart) {
                const fadeAlpha = 1 - (age - fadeStart) / 3;
                const alpha = Math.max(0, fadeAlpha);
                const flashAlpha = alpha * (0.5 + 0.5 * Math.sin(time * 10));
                instance.mesh.children.forEach(child => {
                    if (child.material && child.material.transparent) {
                        child.material.opacity = child.material.opacity * flashAlpha;
                    }
                });
                if (instance.mesh.children[0]?.material) {
                    instance.mesh.children[0].material.opacity = 0.9 * flashAlpha;
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

        playEffect('waterdrop:collect');

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
            color: '#44aaff',
            type: 'waterdrop'
        };
    }
}
