/**
 * @module BorderMountains
 * Multi-layered low-poly mountain border with snow caps and trees.
 * Uses InstancedMesh (shared geometry, minimal draw calls) for performance.
 * Stores mesh references on scene.userData.mountains for theme access.
 */
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d';
import { GROUND_SIZE_VISUAL } from './PhysicsConfig.js';

// Wall sits well inside the front mountain row — blocks all passage
const WALL_DISTANCE = 110;
const WALL_HEIGHT = 20;
const WALL_THICKNESS = 5;

// Mountain row configs — front to back, increasingly tall and sparse
const MOUNTAIN_ROWS = [
    { distance: 118, spread: 6,  perSide: 18, minR: 3,  maxR: 5.5, minH: 6,  maxH: 13, snowChance: 0 },
    { distance: 128, spread: 7,  perSide: 18, minR: 4,  maxR: 7,   minH: 10, maxH: 20, snowChance: 0.15 },
    { distance: 140, spread: 9,  perSide: 16, minR: 5,  maxR: 10,  minH: 16, maxH: 30, snowChance: 0.35 },
    { distance: 160, spread: 12, perSide: 14, minR: 8,  maxR: 15,  minH: 26, maxH: 45, snowChance: 0.55 },
];

const CORNERS_PER_ROW = [4, 5, 4, 3];

// Tree config — scattered in the foothills zone before mountains
const TREE_COUNT_PER_SIDE = 30;
const TREE_MIN_DIST = 96;
const TREE_MAX_DIST = 114;

/**
 * Creates border mountains, trees, and wall colliders.
 * If mapData is provided, uses mapData.mountains and mapData.trees; otherwise generates randomly.
 * Stores references on scene.userData.mountains.
 */
export function createBorderMountains(scene, world, mapData = null) {
    const mountainData = mapData ? mapData.mountains : generateMountainData();
    const treeData = mapData ? mapData.trees : generateTreeData();

    const meshes = createMountainVisuals(scene, mountainData);
    const treeMeshes = createTreeVisuals(scene, treeData);
    createWallColliders(world);

    scene.userData.mountains = { ...meshes, ...treeMeshes };
    return scene.userData.mountains;
}

// --- Data Generators (exported for MapLoader) ---

export function generateMountainData() {
    const mountains = [];

    for (let r = 0; r < MOUNTAIN_ROWS.length; r++) {
        const row = MOUNTAIN_ROWS[r];
        const stagger = r % 2 === 1;

        for (let side = 0; side < 4; side++) {
            for (let i = 0; i < row.perSide; i++) {
                const step = 1 / row.perSide;
                let t = (i * step) - 0.5 + step * 0.5;
                if (stagger) t += step * 0.5;

                const along = t * GROUND_SIZE_VISUAL * 1.1;
                const radius = row.minR + Math.random() * (row.maxR - row.minR);
                const height = row.minH + Math.random() * (row.maxH - row.minH);
                const distJitter = (Math.random() - 0.5) * row.spread;
                const sideJitter = (Math.random() - 0.5) * 4;
                const dist = row.distance + distJitter;

                const pos = sideToXZ(side, along + sideJitter, dist);
                const rotY = Math.random() * Math.PI;
                const hasSnowCap = Math.random() < row.snowChance && height > 12;

                mountains.push({ x: pos.x, z: pos.z, radius, height, rotY, hasSnowCap });
            }
        }

        // Corner fills
        const cornersCount = CORNERS_PER_ROW[r] || 3;
        const corners = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
        for (const [cx, cz] of corners) {
            for (let i = 0; i < cornersCount; i++) {
                const dist = row.distance + (Math.random() - 0.5) * row.spread;
                const angle = Math.atan2(cz, cx) + (Math.random() - 0.5) * 0.7;
                const x = Math.cos(angle) * dist;
                const z = Math.sin(angle) * dist;
                const radius = row.minR + Math.random() * (row.maxR - row.minR);
                const height = row.minH + Math.random() * (row.maxH - row.minH);
                const rotY = Math.random() * Math.PI;
                const hasSnowCap = Math.random() < row.snowChance && height > 14;

                mountains.push({ x, z, radius, height, rotY, hasSnowCap });
            }
        }
    }

    return mountains;
}

export function generateTreeData() {
    const trees = [];

    for (let side = 0; side < 4; side++) {
        for (let i = 0; i < TREE_COUNT_PER_SIDE; i++) {
            const t = (i / TREE_COUNT_PER_SIDE) - 0.5 + (Math.random() * 0.03);
            const along = t * GROUND_SIZE_VISUAL * 1.05;
            const dist = TREE_MIN_DIST + Math.random() * (TREE_MAX_DIST - TREE_MIN_DIST);
            const pos = sideToXZ(side, along + (Math.random() - 0.5) * 6, dist);

            trees.push({
                x: pos.x,
                z: pos.z,
                trunkRadius: 0.25 + Math.random() * 0.25,
                trunkHeight: 1.5 + Math.random() * 2.5,
                canopyRadius: 1.2 + Math.random() * 1.5,
                canopyHeight: 2.5 + Math.random() * 3,
                rotY: Math.random() * Math.PI
            });
        }
    }

    // Corner trees
    const corners = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [cx, cz] of corners) {
        for (let i = 0; i < 5; i++) {
            const dist = TREE_MIN_DIST + Math.random() * (TREE_MAX_DIST - TREE_MIN_DIST);
            const angle = Math.atan2(cz, cx) + (Math.random() - 0.5) * 0.8;
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;

            trees.push({
                x, z,
                trunkRadius: 0.25 + Math.random() * 0.25,
                trunkHeight: 1.5 + Math.random() * 2.5,
                canopyRadius: 1.2 + Math.random() * 1.5,
                canopyHeight: 2.5 + Math.random() * 3,
                rotY: Math.random() * Math.PI
            });
        }
    }

    return trees;
}

// --- Mountain Visuals ---

function createMountainVisuals(scene, mountainData) {
    const coneGeo = new THREE.ConeGeometry(1, 1, 6);

    const mountainMat = new THREE.MeshStandardMaterial({
        color: 0x5a6e5a,
        roughness: 0.9,
        flatShading: true
    });

    const snowMat = new THREE.MeshStandardMaterial({
        color: 0xf0f0f0,
        roughness: 0.7,
        flatShading: true
    });

    // Build snow caps from mountain data
    const snowCaps = [];
    for (const m of mountainData) {
        if (m.hasSnowCap) {
            snowCaps.push(snowCapFromCone(m));
        }
    }

    const mountainMesh = new THREE.InstancedMesh(coneGeo, mountainMat, mountainData.length);
    mountainMesh.castShadow = true;
    applyConeTransforms(mountainMesh, mountainData);
    scene.add(mountainMesh);

    let snowMesh = null;
    if (snowCaps.length > 0) {
        snowMesh = new THREE.InstancedMesh(coneGeo, snowMat, snowCaps.length);
        snowMesh.castShadow = true;
        applyConeTransforms(snowMesh, snowCaps);
        scene.add(snowMesh);
    }

    return { mountainMesh, mountainMat, snowMesh, snowMat };
}

// --- Tree Visuals ---

function createTreeVisuals(scene, treeData) {
    const trunkGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
    const canopyGeo = new THREE.ConeGeometry(1, 1, 6);

    const trunkMat = new THREE.MeshStandardMaterial({
        color: 0x5a3a1a,
        roughness: 0.9,
        flatShading: true
    });

    const canopyMat = new THREE.MeshStandardMaterial({
        color: 0x2d5a1e,
        roughness: 0.85,
        flatShading: true
    });

    // Convert tree data to trunk/canopy instance arrays
    const trunks = [];
    const canopies = [];

    for (const t of treeData) {
        trunks.push({
            x: t.x, z: t.z,
            radius: t.trunkRadius, height: t.trunkHeight,
            yOffset: t.trunkHeight / 2,
            rotY: t.rotY
        });

        canopies.push({
            x: t.x, z: t.z,
            radius: t.canopyRadius, height: t.canopyHeight,
            yOffset: t.trunkHeight + t.canopyHeight / 2,
            rotY: t.rotY
        });
    }

    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, trunks.length);
    trunkMesh.castShadow = true;
    applyTreeTransforms(trunkMesh, trunks);
    scene.add(trunkMesh);

    const canopyMesh = new THREE.InstancedMesh(canopyGeo, canopyMat, canopies.length);
    canopyMesh.castShadow = true;
    applyTreeTransforms(canopyMesh, canopies);
    scene.add(canopyMesh);

    // Store canopy positions for gameplay systems (lightning shelter check)
    scene.userData.treeCanopies = canopies.map(c => ({ x: c.x, z: c.z, radius: c.radius }));

    return { trunkMesh, trunkMat, canopyMesh, canopyMat };
}

// --- Helpers ---

function sideToXZ(side, along, distance) {
    switch (side) {
        case 0: return { x: along, z: -distance };
        case 1: return { x: along, z: distance };
        case 2: return { x: -distance, z: along };
        case 3: return { x: distance, z: along };
    }
}

function snowCapFromCone(cone) {
    const snowHeight = cone.height * 0.28;
    const snowRadius = cone.radius * 0.32;
    return {
        x: cone.x, z: cone.z,
        radius: snowRadius, height: snowHeight,
        yOffset: cone.height * 0.72 + snowHeight / 2,
        rotY: cone.rotY
    };
}

function applyConeTransforms(mesh, cones) {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < cones.length; i++) {
        const c = cones[i];
        const y = c.yOffset !== undefined ? c.yOffset : c.height / 2;
        dummy.position.set(c.x, y, c.z);
        dummy.scale.set(c.radius * 2, c.height, c.radius * 2);
        dummy.rotation.set(0, c.rotY, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
}

function applyTreeTransforms(mesh, items) {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < items.length; i++) {
        const t = items[i];
        dummy.position.set(t.x, t.yOffset, t.z);
        dummy.scale.set(t.radius * 2, t.height, t.radius * 2);
        dummy.rotation.set(0, t.rotY, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
}

// --- Physics: 4 wall colliders ---

function createWallColliders(world) {
    // Walls sit just inside the front mountain row — can't walk through or climb
    const halfLen = WALL_DISTANCE + WALL_THICKNESS; // extends past corners
    const walls = [
        { x: 0, z: -WALL_DISTANCE, hx: halfLen, hz: WALL_THICKNESS },
        { x: 0, z: WALL_DISTANCE,  hx: halfLen, hz: WALL_THICKNESS },
        { x: -WALL_DISTANCE, z: 0, hx: WALL_THICKNESS, hz: halfLen },
        { x: WALL_DISTANCE,  z: 0, hx: WALL_THICKNESS, hz: halfLen }
    ];

    for (const w of walls) {
        const desc = RAPIER.ColliderDesc.cuboid(w.hx, WALL_HEIGHT / 2, w.hz)
            .setTranslation(w.x, WALL_HEIGHT / 2, w.z);
        world.createCollider(desc);
    }
}
