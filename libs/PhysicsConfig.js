/**
 * @module PhysicsConfig
 * Central configuration for all physics and gameplay constants.
 * This file should have no imports from other game modules.
 */

// Ground settings
export const GROUND_SIZE_VISUAL = 250;
export const GROUND_PLANE_SIZE = 300;
export const GROUND_SIZE_PHYSICS = 100;

// World settings
export const GRAVITY = { x: 0.0, y: -9.81, z: 0.0 };

// Player movement settings
export const PLAYER_SPEED = 5.2;
export const PLAYER_RUN_MULTIPLIER = 1.8;
export const PLAYER_JUMP_FORCE = 7.0;
export const FALL_GRAVITY_MULTIPLIER = 3.0;   // Pull-down for landing
export const LOW_JUMP_MULTIPLIER = 2.0;        // Extra gravity on ascent when jump key released (shorter hops)

// Coin settings
export const MAX_COINS = 400;
export const COIN_RADIUS = 0.3;
export const COIN_DROP_HEIGHT = 10.0;
export const COIN_SPAWN_AREA_XZ = GROUND_SIZE_VISUAL * 0.95;
export const COIN_COLOR = 0xffff00; // Bright yellow

// Fruit settings
export const MAX_FRUITS = 8;
export const FRUIT_RADIUS = 0.5;
export const FRUIT_COLOR = 0xff6b35;

// Water drop settings (post-storm bonus pickups)
export const WATERDROP_RADIUS = 0.4;
export const WATERDROP_COLOR = 0x44aaff;

// Tail settings
export const TAIL_SEGMENT_SPACING = 5;
export const TAIL_SEGMENT_COLOR = 0x00cc99;
export const TAIL_MAX_SEGMENTS = 50;
export const TAIL_WIGGLE_AMOUNT = 0.05;
export const TAIL_FOLLOW_SPEED = 0.6;
export const TAIL_SCALE_FACTOR = 0.04;
export const TAIL_MIN_SCALE = 0.5;
export const TAIL_SEGMENT_ROUNDNESS = 0.1;

// Sprint settings (tail-burning mechanic)
export const SPRINT_BURN_INTERVAL = 1.5;   // seconds before each tail segment is consumed

// Bot settings
export const BOT_COUNT = 10;
export const BOT_SPEED_MULTIPLIER = 0.80;
export const BOT_SPRINT_SPEED_MULTIPLIER = 1.5;
export const BOT_INITIAL_TAIL_LENGTH = 3;
export const BOT_VISION_RANGE = 20;
export const BOT_DANGER_RANGE = 8;
export const BOT_WANDER_TURN_INTERVAL_MIN = 1;   // seconds
export const BOT_WANDER_TURN_INTERVAL_MAX = 3;   // seconds

// Ring obstacle settings
export const MAX_RINGS = 5;
export const RING_SPAWN_AREA_XZ = GROUND_SIZE_VISUAL * 0.78;
export const RING_STAMINA_PENALTY = 3;  // tail segments lost on contact

// Round settings
export const ROUND_DURATION = 600;  // 10 minutes in seconds