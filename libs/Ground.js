/**
 * @module Ground
 * Creates the ground plane and physics collider.
 */
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d';
import { loadTexture } from './TextureLoader.js';
import { GROUND_PLANE_SIZE } from './PhysicsConfig.js';

/**
 * Creates the visual ground plane and its physics collider.
 * @param {THREE.Scene} scene - The Three.js scene.
 * @param {RAPIER.World} world - The Rapier physics world.
 * @param {THREE.WebGLRenderer} renderer - The Three.js renderer (for texture loading).
 * @returns {THREE.Mesh} The ground plane mesh.
 */
export function createGround(scene, world, renderer) {
    const groundTexture = loadTexture('/assets/ground-texture-2.png', renderer, 37, 37);

    const groundGeometry = new THREE.PlaneGeometry(GROUND_PLANE_SIZE, GROUND_PLANE_SIZE);
    const groundMaterial = new THREE.MeshStandardMaterial({
        map: groundTexture,
        side: THREE.DoubleSide,
        roughness: 0.8
    });
    const groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
    groundPlane.rotation.x = Math.PI / 2;
    groundPlane.receiveShadow = true;
    scene.add(groundPlane);

    // Physics collider (half-extents) positioned so top surface is at y=0
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(GROUND_PLANE_SIZE / 2, 0.1, GROUND_PLANE_SIZE / 2);
    groundColliderDesc.setTranslation(0.0, -0.1, 0.0);
    world.createCollider(groundColliderDesc);

    return groundPlane;
}
