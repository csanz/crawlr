/**
 * @module SkySphere
 * Creates the sky environment sphere surrounding the scene.
 */
import * as THREE from 'three';
import { loadTexture } from './TextureLoader.js';

/**
 * Creates and adds a textured sky sphere to the scene.
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer
 */
export function createSkySphere(scene, renderer) {
    const skyTexture = loadTexture('/assets/sky-texture.png', renderer);
    const skyGeometry = new THREE.SphereGeometry(500, 32, 16); // Large sphere, reduced segments
    // Invert the geometry on the x-axis so that all of the faces point inward
    skyGeometry.scale(-1, 1, 1);
    const skyMaterial = new THREE.MeshBasicMaterial({ 
        map: skyTexture, 
        side: THREE.FrontSide // Ensure material is visible from the inside
    }); 
    const skySphere = new THREE.Mesh(skyGeometry, skyMaterial);
    scene.add(skySphere);
} 