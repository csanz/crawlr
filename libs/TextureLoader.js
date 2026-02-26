/**
 * @module TextureLoader
 * Utility for loading and configuring textures with repeat wrapping and anisotropy.
 */
import * as THREE from 'three';

/**
 * Loads a texture from the given URL.
 * Configures repeat wrapping suitable for ground textures.
 *
 * @param {string} url - The path to the texture image.
 * @param {THREE.WebGLRenderer} renderer - The Three.js renderer instance.
 * @param {number} [repeatX=1] - How many times the texture should repeat horizontally.
 * @param {number} [repeatY=1] - How many times the texture should repeat vertically.
 * @returns {THREE.Texture} The configured texture object.
 */
export function loadTexture(url, renderer, repeatX = 1, repeatY = 1) {
    const loader = new THREE.TextureLoader();
    const texture = loader.load(url);

    // Set wrapping to repeat
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    // Set repetition amount
    texture.repeat.set(repeatX, repeatY);

    // Optional: Improve texture quality
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    // Use the passed renderer instance
    texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());

    return texture;
} 