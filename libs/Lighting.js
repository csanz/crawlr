/**
 * @module Lighting
 * Scene lighting setup with ambient and directional lights.
 * The directional light follows the player so shadows stay visible.
 */
import * as THREE from 'three';

/** Offset from player position to directional light position */
const LIGHT_OFFSET = new THREE.Vector3(5, 10, 7.5);

/** Reference to the directional light for follow updates */
let _directionalLight = null;

/**
 * Configures ambient and directional lighting with shadow support.
 * @param {THREE.Scene} scene
 * @returns {THREE.DirectionalLight} The directional light (for follow updates)
 */
export function setupLighting(scene) {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    _directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    _directionalLight.position.copy(LIGHT_OFFSET);
    _directionalLight.castShadow = true;
    scene.add(_directionalLight);

    // Shadow map resolution - 1024 is sufficient for this game
    _directionalLight.shadow.mapSize.width = 1024;
    _directionalLight.shadow.mapSize.height = 1024;
    _directionalLight.shadow.camera.near = 0.5;
    _directionalLight.shadow.camera.far = 60;

    // Tighter shadow camera = better shadow quality per texel
    _directionalLight.shadow.camera.left = -30;
    _directionalLight.shadow.camera.right = 30;
    _directionalLight.shadow.camera.top = 30;
    _directionalLight.shadow.camera.bottom = -30;

    _directionalLight.shadow.bias = -0.0005;

    return _directionalLight;
}

/**
 * Moves the directional light to follow the player so shadows stay visible.
 * @param {THREE.Vector3} playerPosition - Current player world position
 */
export function updateLightPosition(playerPosition) {
    if (!_directionalLight) return;
    _directionalLight.position.set(
        playerPosition.x + LIGHT_OFFSET.x,
        playerPosition.y + LIGHT_OFFSET.y,
        playerPosition.z + LIGHT_OFFSET.z
    );
    _directionalLight.target.position.set(
        playerPosition.x,
        playerPosition.y,
        playerPosition.z
    );
    _directionalLight.target.updateMatrixWorld();
} 