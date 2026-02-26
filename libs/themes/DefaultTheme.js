/**
 * @module DefaultTheme
 * Baseline atmosphere: subtle distant haze and softened lighting.
 * Applied once at startup. Other themes save/restore on top of this.
 * Also defines the default player theme (fallback when no theme overrides).
 */
import * as THREE from 'three';

/** Default player appearance — used as baseline */
export const DEFAULT_PLAYER_THEME = {
    roughness: 0.5,
    metalness: 0,
    emissive: 0x000000,
    emissiveIntensity: 0
};

export const DefaultTheme = {
    name: 'Default',

    // Player theme baseline (not applied via ThemeManager since DefaultTheme
    // is only called once at startup — but stored here for reference)
    playerTheme: DEFAULT_PLAYER_THEME,

    // Fog settings — configurable per theme
    fog: {
        color: 0x87ceeb,
        near: 40,
        far: 150
    },

    // Lighting settings
    lighting: {
        ambient: 0.55,
        directional: 0.8
    },

    apply(scene) {
        // Slightly soften lighting so it's not harsh, but still daylight
        scene.traverse(obj => {
            if (obj.isAmbientLight) {
                obj.intensity = this.lighting.ambient;
            } else if (obj.isDirectionalLight) {
                obj.intensity = this.lighting.directional;
            }
        });

        // Fog — configurable near/far for visibility range
        scene.fog = new THREE.Fog(this.fog.color, this.fog.near, this.fog.far);
    }
};
