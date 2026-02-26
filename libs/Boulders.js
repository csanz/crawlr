/**
 * @module Boulders
 * Low-poly rock formations scattered across the playfield for cover/hiding.
 * Matches the game's cartoonish art style — clean geometry, warm gray tones.
 * Stores material ref on scene.userData.boulders for theme access.
 */
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d';

const SOLO_COUNT = 20;
const CLUSTER_COUNT = 10;
const MIN_DIST = 18;
const MAX_DIST = 100;

// Clean low-poly dodecahedron — naturally looks like a faceted rock
const ROCK_GEO = new THREE.DodecahedronGeometry(1, 0);

const ROCK_MAT = new THREE.MeshStandardMaterial({
    color: 0xb0aca6,
    roughness: 0.88,
    metalness: 0.02,
    flatShading: true
});

/**
 * Creates boulders with visual meshes and physics colliders.
 * If boulderData is provided, uses it directly; otherwise generates randomly.
 */
export function createBoulders(scene, world, boulderData = null) {
    const boulders = boulderData || generateBoulderData();

    const mesh = new THREE.InstancedMesh(ROCK_GEO, ROCK_MAT, boulders.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < boulders.length; i++) {
        const b = boulders[i];
        const halfY = b.radius * b.scaleY;
        dummy.position.set(b.x, halfY * 0.45, b.z);
        dummy.scale.set(b.radius * b.scaleX, b.radius * b.scaleY, b.radius * b.scaleZ);
        dummy.rotation.set(b.rotX, b.rotY, b.rotZ);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        // Use color from data (deterministic) instead of generating at render time
        color.setRGB(b.colorR, b.colorG, b.colorB);
        mesh.setColorAt(i, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);

    // Physics: one static cuboid collider per boulder — sized to match visual
    for (const b of boulders) {
        const hx = b.radius * b.scaleX * 0.9;
        const hy = b.radius * b.scaleY * 0.9;
        const hz = b.radius * b.scaleZ * 0.9;
        // Bottom at ground level, extends up to match the visible rock
        const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
            .setTranslation(b.x, hy, b.z);
        world.createCollider(desc);
    }

    // Store positions for spawn avoidance (pickup spawner reads this)
    const positions = boulders.map(b => ({ x: b.x, z: b.z, r: Math.max(b.radius * b.scaleX, b.radius * b.scaleZ) }));
    scene.userData.boulders = { mesh, material: ROCK_MAT, positions };
    return { mesh, material: ROCK_MAT };
}

export function generateBoulderData() {
    const boulders = [];
    const placed = [];

    // Solo boulders — mix of flat and tall
    placeBoulders(placed, boulders, SOLO_COUNT, (x, z) => {
        const tall = Math.random() < 0.25;
        const base = 0.62 + Math.random() * 0.12;
        return {
            x, z,
            radius: 1.5 + Math.random() * 2,
            scaleX: tall ? 0.7 + Math.random() * 0.2 : 0.9 + Math.random() * 0.4,
            scaleY: tall ? 1.5 + Math.random() * 1.0 : 0.6 + Math.random() * 0.5,
            scaleZ: tall ? 0.7 + Math.random() * 0.2 : 0.9 + Math.random() * 0.4,
            rotX: (Math.random() - 0.5) * 0.15,
            rotY: Math.random() * Math.PI * 2,
            rotZ: (Math.random() - 0.5) * 0.15,
            colorR: base,
            colorG: base * 0.98,
            colorB: base * 0.96
        };
    });

    // Clusters — 2-4 rocks grouped together, sometimes with a tall anchor
    for (let c = 0; c < CLUSTER_COUNT; c++) {
        let cx, cz, found = false;
        for (let a = 0; a < 40; a++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = MIN_DIST + 10 + Math.random() * (MAX_DIST - MIN_DIST - 10);
            cx = Math.cos(angle) * dist;
            cz = Math.sin(angle) * dist;
            if (!tooClose(placed, cx, cz, 10)) { found = true; break; }
        }
        if (!found) continue;

        const count = 2 + Math.floor(Math.random() * 3);
        const hasAnchor = Math.random() < 0.5;

        for (let i = 0; i < count; i++) {
            const x = cx + (Math.random() - 0.5) * 6;
            const z = cz + (Math.random() - 0.5) * 6;
            const isAnchor = hasAnchor && i === 0;
            const radius = isAnchor ? 2 + Math.random() * 1.5 : 1 + Math.random() * 1.5;
            const base = 0.62 + Math.random() * 0.12;

            boulders.push({
                x, z, radius,
                scaleX: isAnchor ? 0.8 + Math.random() * 0.2 : 0.8 + Math.random() * 0.5,
                scaleY: isAnchor ? 1.8 + Math.random() * 0.8 : 0.5 + Math.random() * 0.6,
                scaleZ: isAnchor ? 0.8 + Math.random() * 0.2 : 0.8 + Math.random() * 0.5,
                rotX: (Math.random() - 0.5) * 0.15,
                rotY: Math.random() * Math.PI * 2,
                rotZ: (Math.random() - 0.5) * 0.15,
                colorR: base,
                colorG: base * 0.98,
                colorB: base * 0.96
            });
            placed.push({ x, z, r: radius });
        }
    }

    // Large rock formations — dramatic landmarks spread around the map
    const FORMATION_COUNT = 3;
    for (let f = 0; f < FORMATION_COUNT; f++) {
        let cx, cz, found = false;
        for (let a = 0; a < 60; a++) {
            const angle = (f / FORMATION_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
            const dist = 50 + Math.random() * 40;
            cx = Math.cos(angle) * dist;
            cz = Math.sin(angle) * dist;
            if (!tooClose(placed, cx, cz, 15)) { found = true; break; }
        }
        if (!found) continue;

        // Big central monolith
        const mainRadius = 3.5 + Math.random() * 2;
        const mainBase = 0.62 + Math.random() * 0.12;
        boulders.push({
            x: cx, z: cz, radius: mainRadius,
            scaleX: 0.9 + Math.random() * 0.3,
            scaleY: 2.5 + Math.random() * 1.5,
            scaleZ: 0.9 + Math.random() * 0.3,
            rotX: (Math.random() - 0.5) * 0.1,
            rotY: Math.random() * Math.PI * 2,
            rotZ: (Math.random() - 0.5) * 0.1,
            colorR: mainBase,
            colorG: mainBase * 0.98,
            colorB: mainBase * 0.96
        });
        placed.push({ x: cx, z: cz, r: mainRadius });

        // 5-8 surrounding rocks of varying size
        const surroundCount = 5 + Math.floor(Math.random() * 4);
        for (let i = 0; i < surroundCount; i++) {
            const a = (i / surroundCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
            const d = mainRadius + 1 + Math.random() * 4;
            const x = cx + Math.cos(a) * d;
            const z = cz + Math.sin(a) * d;
            const tall = Math.random() < 0.3;
            const radius = 1.5 + Math.random() * 2;
            const base = 0.62 + Math.random() * 0.12;

            boulders.push({
                x, z, radius,
                scaleX: tall ? 0.6 + Math.random() * 0.3 : 0.8 + Math.random() * 0.5,
                scaleY: tall ? 1.5 + Math.random() * 1.2 : 0.6 + Math.random() * 0.8,
                scaleZ: tall ? 0.6 + Math.random() * 0.3 : 0.8 + Math.random() * 0.5,
                rotX: (Math.random() - 0.5) * 0.2,
                rotY: Math.random() * Math.PI * 2,
                rotZ: (Math.random() - 0.5) * 0.2,
                colorR: base,
                colorG: base * 0.98,
                colorB: base * 0.96
            });
            placed.push({ x, z, r: radius });
        }
    }

    return boulders;
}

function placeBoulders(placed, boulders, count, create) {
    let attempts = 0, added = 0;
    while (added < count && attempts < 200) {
        attempts++;
        const angle = Math.random() * Math.PI * 2;
        const dist = MIN_DIST + Math.random() * (MAX_DIST - MIN_DIST);
        const x = Math.cos(angle) * dist;
        const z = Math.sin(angle) * dist;
        if (tooClose(placed, x, z, 7)) continue;

        const b = create(x, z);
        boulders.push(b);
        placed.push({ x, z, r: b.radius });
        added++;
    }
}

function tooClose(placed, x, z, minDist) {
    for (const p of placed) {
        const dx = x - p.x, dz = z - p.z;
        if (dx * dx + dz * dz < minDist * minDist) return true;
    }
    return false;
}
