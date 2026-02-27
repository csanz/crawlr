/**
 * @module Clouds
 * Low-poly drifting clouds that float above the game world.
 * Each cloud is a group of merged spheres with soft shadows.
 */
import * as THREE from 'three';
import { GROUND_SIZE_VISUAL } from './PhysicsConfig.js';

const CLOUD_COUNT = 12;
const CLOUD_HEIGHT_MIN = 45;
const CLOUD_HEIGHT_MAX = 65;
const CLOUD_SPEED_MIN = 1.2;
const CLOUD_SPEED_MAX = 3.0;
const CLOUD_SPREAD = GROUND_SIZE_VISUAL * 0.6;

const clouds = [];

/**
 * Creates low-poly clouds above the game world.
 * @param {THREE.Scene} scene
 */
export function createClouds(scene) {
    const cloudMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 1.0,
        metalness: 0,
        flatShading: true,
    });

    for (let i = 0; i < CLOUD_COUNT; i++) {
        const group = new THREE.Group();

        // Each cloud is 3-6 low-poly blobs clustered together
        const blobCount = 3 + Math.floor(Math.random() * 4);
        const baseScale = 3 + Math.random() * 4;

        for (let b = 0; b < blobCount; b++) {
            // Low-poly icosahedron for chunky look
            const radius = baseScale * (0.6 + Math.random() * 0.5);
            const geo = new THREE.IcosahedronGeometry(radius, 1);
            const mesh = new THREE.Mesh(geo, cloudMaterial);

            // Squash vertically for flat cloud shape
            mesh.scale.y = 0.35 + Math.random() * 0.15;

            // Offset blobs within the cluster
            mesh.position.set(
                (Math.random() - 0.5) * baseScale * 2,
                (Math.random() - 0.5) * baseScale * 0.3,
                (Math.random() - 0.5) * baseScale * 1.5
            );

            mesh.castShadow = true;
            group.add(mesh);
        }

        // Position cloud in the world
        group.position.set(
            (Math.random() - 0.5) * CLOUD_SPREAD * 2,
            CLOUD_HEIGHT_MIN + Math.random() * (CLOUD_HEIGHT_MAX - CLOUD_HEIGHT_MIN),
            (Math.random() - 0.5) * CLOUD_SPREAD * 2
        );

        // Random drift direction and speed
        const angle = Math.random() * Math.PI * 2;
        const speed = CLOUD_SPEED_MIN + Math.random() * (CLOUD_SPEED_MAX - CLOUD_SPEED_MIN);

        clouds.push({
            group,
            velocity: new THREE.Vector2(Math.cos(angle) * speed, Math.sin(angle) * speed),
            startY: group.position.y,
            bobOffset: Math.random() * Math.PI * 2,
        });

        scene.add(group);
    }
}

/**
 * Updates cloud positions each frame. Call from the game loop.
 * @param {number} dt - delta time in seconds
 */
export function updateClouds(dt) {
    const boundary = CLOUD_SPREAD * 1.2;

    for (const cloud of clouds) {
        // Drift horizontally
        cloud.group.position.x += cloud.velocity.x * dt;
        cloud.group.position.z += cloud.velocity.y * dt;

        // Gentle vertical bob
        cloud.bobOffset += dt * 0.3;
        cloud.group.position.y = cloud.startY + Math.sin(cloud.bobOffset) * 0.8;

        // Wrap around when drifting too far
        if (cloud.group.position.x > boundary) cloud.group.position.x = -boundary;
        if (cloud.group.position.x < -boundary) cloud.group.position.x = boundary;
        if (cloud.group.position.z > boundary) cloud.group.position.z = -boundary;
        if (cloud.group.position.z < -boundary) cloud.group.position.z = boundary;
    }
}
