/**
 * @module PushableBlock
 * Creates a pushable physics block the player can interact with.
 */
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d';
import { loadTexture } from './TextureLoader.js';

/**
 * Creates the pushable block's visual mesh and physics body.
 * @param {THREE.Scene} scene - The Three.js scene.
 * @param {RAPIER.World} world - The Rapier physics world.
 * @param {THREE.WebGLRenderer} renderer - The Three.js renderer (for texture loading).
 * @param {THREE.Vector3} initialPosition - The starting position for the block.
 * @returns {{blockMesh: THREE.Mesh, blockBody: RAPIER.RigidBody}}
 */
export function createPushableBlock(scene, world, renderer, initialPosition = new THREE.Vector3(2, 0.5, 0)) {
    // Load the block texture
    const blockTexture = loadTexture('/assets/block-texture.png', renderer);

    // Create visual representation for the block
    const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
    const blockMaterial = new THREE.MeshStandardMaterial({ 
        map: blockTexture, // Apply the texture
        roughness: 0.5     // Reduce roughness
    });
    const blockMesh = new THREE.Mesh(blockGeometry, blockMaterial);
    blockMesh.castShadow = true; // Allow block to cast shadows
    blockMesh.position.copy(initialPosition); // Set initial visual position
    scene.add(blockMesh);

    // Create pushable block physics body and collider
    const blockBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(initialPosition.x, initialPosition.y, initialPosition.z);
    const blockBody = world.createRigidBody(blockBodyDesc);
    const blockColliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5);
    world.createCollider(blockColliderDesc, blockBody);
    return { blockMesh, blockBody };
} 