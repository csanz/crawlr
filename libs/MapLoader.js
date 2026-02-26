/**
 * @module MapLoader
 * Loads deterministic map data from JSON for consistent world layout.
 * Falls back to random generation if the map file is unavailable.
 */
import { createLogger } from './Logger.js';
import { generateBoulderData } from './Boulders.js';
import { generateMountainData, generateTreeData } from './BorderMountains.js';
import { MAX_COINS, COIN_SPAWN_AREA_XZ, MAX_RINGS, RING_SPAWN_AREA_XZ, BOT_COUNT } from './PhysicsConfig.js';

const log = createLogger('MapLoader');

const MAP_VERSION = 1;

/**
 * Fetches and parses a map JSON file.
 * Returns null on failure (caller should fall back to random generation).
 */
export async function loadMap(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) {
            log.warn(`Map not found at ${url} (${res.status}) — using random generation`);
            return null;
        }
        const data = await res.json();
        if (!validateMap(data)) {
            log.warn('Map validation failed — using random generation');
            return null;
        }
        log.info(`Loaded map "${data.meta.name}" v${data.meta.version} — ${data.boulders.length} boulders, ${data.mountains.length} mountains, ${data.trees.length} trees`);
        return data;
    } catch (err) {
        log.warn(`Failed to load map: ${err.message} — using random generation`);
        return null;
    }
}

/**
 * Validates that a map object has the required structure.
 */
function validateMap(data) {
    if (!data || typeof data !== 'object') return false;
    if (!data.meta || data.meta.version !== MAP_VERSION) return false;
    if (!Array.isArray(data.boulders) || data.boulders.length === 0) return false;
    if (!Array.isArray(data.mountains) || data.mountains.length === 0) return false;
    if (!Array.isArray(data.trees) || data.trees.length === 0) return false;
    if (!data.spawnZones) return false;
    return true;
}

/**
 * Captures the current random generation output as a map object.
 * Call this once to produce a default.json, then save the result.
 */
export function generateMapSnapshot() {
    const boulders = generateBoulderData();
    const mountains = generateMountainData();
    const trees = generateTreeData();

    return {
        meta: { version: MAP_VERSION, name: 'default-valley' },
        boulders,
        mountains,
        trees,
        spawnZones: {
            player: { x: 0, z: 0 },
            bots: { count: BOT_COUNT, areaXZ: 190 },
            coins: { maxCount: MAX_COINS, areaXZ: COIN_SPAWN_AREA_XZ },
            rings: { maxCount: MAX_RINGS, areaXZ: RING_SPAWN_AREA_XZ }
        }
    };
}
