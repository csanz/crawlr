/**
 * @module RendererSetup
 * WebGL renderer creation and configuration.
 */
import * as THREE from 'three';

/**
 * Creates and configures the WebGL renderer.
 * @returns {THREE.WebGLRenderer}
 */
export function setupRenderer() {
    const renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance"
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Shadow settings
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Modern color space settings (replaces deprecated gammaOutput/gammaFactor)
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    document.body.appendChild(renderer.domElement);
    // Handle window resize - also update camera if available
    window.addEventListener('resize', () => {
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    return renderer;
}
