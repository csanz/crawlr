/**
 * @module CameraSetup
 * Camera creation, OrbitControls setup, zoom levels, and player-follow logic.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Pre-allocated vector to avoid per-frame allocation
const _cameraTargetLookAt = new THREE.Vector3();

/** Camera orbit — step-based rotation with smooth interpolation */
const ORBIT_STEP = Math.PI / 4; // 45 degrees per press
const ORBIT_LERP_SPEED = 6;     // interpolation speed (higher = snappier)
let targetOrbitAngle = 0;
let currentOrbitAngle = 0;
let lastAppliedOrbit = 0; // tracks what was applied last frame to compute delta

/** Auto-follow: subtle camera drift toward movement direction while sprinting */
const AUTO_FOLLOW_DELAY = 2.0;       // seconds of sustained movement before kicking in
const AUTO_FOLLOW_STRENGTH = 0.35;   // 0-1: how much to rotate toward movement (subtle bias)
const AUTO_FOLLOW_LERP = 1.2;        // rotation speed (radians/sec-ish)
let moveDirectionTimer = 0;          // how long player has been moving in ~same direction
let lastMoveAngle = 0;               // last frame's movement angle
let autoFollowAngle = 0;             // current auto-follow bias
let autoFollowActive = false;
let manualOrbitUsedAt = 0;           // timestamp of last manual orbit input

/**
 * Zoom level presets: [minDistance, maxDistance, label]
 * Close = default gameplay view, Mid = wider view, Far = full overview
 */
const ZOOM_LEVELS = [
    { min: 14, max: 25, label: 'Close' },
    { min: 25, max: 45, label: 'Mid' },
    { min: 40, max: 70, label: 'Far' },
];

/**
 * Camera angle presets: [minPolar, maxPolar, label]
 * Top-down = nearly overhead, Angled = default, Low = behind character
 */
const ANGLE_LEVELS = [
    { minPolar: Math.PI / 6,   maxPolar: Math.PI / 4.5, label: 'Angled' },
    { minPolar: Math.PI / 10,  maxPolar: Math.PI / 7,   label: 'Top-down' },
    { minPolar: Math.PI / 4,   maxPolar: Math.PI / 3,   label: 'Low' },
];

/** Current zoom level index */
let currentZoomLevel = 0;
let currentAngleLevel = 2; // Start at 'Low' angle for more horizon view

/**
 * Creates the perspective camera.
 * @param {number} width - Viewport width.
 * @param {number} height - Viewport height.
 * @returns {THREE.PerspectiveCamera}
 */
export function setupCamera(width, height) {
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.set(0, 3, 5);
    return camera;
}

/**
 * Configures OrbitControls for the camera.
 * @param {THREE.PerspectiveCamera} camera
 * @param {HTMLCanvasElement} domElement
 * @returns {OrbitControls}
 */
export function setupOrbitControls(camera, domElement) {
    const controls = new OrbitControls(camera, domElement);
    controls.enableDamping = false;
    controls.minDistance = ZOOM_LEVELS[0].min;
    controls.maxDistance = ZOOM_LEVELS[0].max;
    return controls;
}

/**
 * Cycles to the next zoom level and returns the new level label.
 * Also stores a pending distance so updateCameraFollow can snap the camera.
 * @returns {string} The name of the new zoom level
 */
let pendingZoomSnap = false;

export function cycleZoom() {
    currentZoomLevel = (currentZoomLevel + 1) % ZOOM_LEVELS.length;
    pendingZoomSnap = true;
    return ZOOM_LEVELS[currentZoomLevel].label;
}

/**
 * Gets the current zoom level label.
 * @returns {string}
 */
export function getZoomLabel() {
    return ZOOM_LEVELS[currentZoomLevel].label;
}

/**
 * Cycles to the next camera angle preset.
 * @returns {string} The name of the new angle level
 */
export function cycleAngle() {
    currentAngleLevel = (currentAngleLevel + 1) % ANGLE_LEVELS.length;
    return ANGLE_LEVELS[currentAngleLevel].label;
}

/**
 * Steps the camera orbit left by one increment (45 degrees).
 */
export function stepOrbitLeft() {
    targetOrbitAngle += ORBIT_STEP;
    manualOrbitUsedAt = performance.now() * 0.001;
    autoFollowAngle = 0;
    moveDirectionTimer = 0;
}

/**
 * Steps the camera orbit right by one increment (45 degrees).
 */
export function stepOrbitRight() {
    targetOrbitAngle -= ORBIT_STEP;
    manualOrbitUsedAt = performance.now() * 0.001;
    autoFollowAngle = 0;
    moveDirectionTimer = 0;
}

/**
 * Smoothly interpolates the current orbit angle toward the target.
 * @param {number} dt - Delta time in seconds
 */
export function updateCameraOrbit(dt) {
    const diff = targetOrbitAngle - currentOrbitAngle;
    if (Math.abs(diff) > 0.001) {
        currentOrbitAngle += diff * Math.min(1, ORBIT_LERP_SPEED * dt);
    } else {
        currentOrbitAngle = targetOrbitAngle;
    }
}

/**
 * Update auto-follow camera bias based on player movement.
 * Call each frame with the player's physics velocity and sprint state.
 * @param {number} dt
 * @param {{ x: number, z: number }} velocity - Player's horizontal velocity
 * @param {boolean} sprinting - Whether the player is currently sprinting
 */
export function updateAutoFollow(dt, velocity, sprinting) {
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    const now = performance.now() * 0.001;

    // Don't auto-follow for 3s after manual orbit input
    if (now - manualOrbitUsedAt < 3) {
        moveDirectionTimer = 0;
        autoFollowActive = false;
        return;
    }

    // Only track when moving at reasonable speed AND sprinting
    if (speed < 2 || !sprinting) {
        moveDirectionTimer = 0;
        autoFollowActive = false;
        // Decay auto-follow angle back to 0
        if (Math.abs(autoFollowAngle) > 0.001) {
            autoFollowAngle *= (1 - 2 * dt);
        }
        return;
    }

    // Current world-space movement angle
    const moveAngle = Math.atan2(velocity.x, velocity.z);

    // Check if direction is roughly consistent (within ~30 degrees)
    let angleDiff = moveAngle - lastMoveAngle;
    // Normalize to [-PI, PI]
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    if (Math.abs(angleDiff) < 0.5) {
        moveDirectionTimer += dt;
    } else {
        moveDirectionTimer = Math.max(0, moveDirectionTimer - dt * 2);
    }
    lastMoveAngle = moveAngle;

    // Activate after sustained movement
    if (moveDirectionTimer >= AUTO_FOLLOW_DELAY) {
        autoFollowActive = true;

        // Compute desired orbit angle to look in movement direction
        // Camera azimuth should place the camera BEHIND the player
        const desiredAzimuth = moveAngle;
        const currentAzimuth = currentOrbitAngle;

        // How far we need to rotate
        let delta = desiredAzimuth - currentAzimuth;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;

        // Apply only a fraction (subtle bias, not full follow)
        const bias = delta * AUTO_FOLLOW_STRENGTH;
        autoFollowAngle += (bias - autoFollowAngle) * Math.min(1, AUTO_FOLLOW_LERP * dt);

        // Apply as an offset to the orbit target
        targetOrbitAngle += autoFollowAngle * dt;
    } else {
        autoFollowActive = false;
        if (Math.abs(autoFollowAngle) > 0.001) {
            autoFollowAngle *= (1 - 2 * dt);
        }
    }
}

/**
 * Updates the camera to follow the player each frame.
 * Applies current zoom level constraints to OrbitControls.
 * @param {THREE.PerspectiveCamera} camera
 * @param {OrbitControls} controls
 * @param {THREE.Mesh} playerMesh
 * @param {THREE.Vector3} cameraLookAtOffset
 */
export function updateCameraFollow(camera, controls, playerMesh, cameraLookAtOffset) {
    _cameraTargetLookAt.copy(playerMesh.position).add(cameraLookAtOffset);

    const zoom = ZOOM_LEVELS[currentZoomLevel];
    const angle = ANGLE_LEVELS[currentAngleLevel];
    controls.minPolarAngle = angle.minPolar;
    controls.maxPolarAngle = angle.maxPolar;
    controls.minDistance = zoom.min;
    controls.maxDistance = zoom.max;
    controls.target.copy(_cameraTargetLookAt);

    // Snap camera distance into new zoom range when toggled
    if (pendingZoomSnap) {
        pendingZoomSnap = false;
        const dist = camera.position.distanceTo(_cameraTargetLookAt);
        if (dist < zoom.min || dist > zoom.max) {
            const targetDist = (zoom.min + zoom.max) / 2;
            const dir = camera.position.clone().sub(_cameraTargetLookAt).normalize();
            camera.position.copy(_cameraTargetLookAt).addScaledVector(dir, targetDist);
        }
    }

    // Apply orbit offset — only apply the delta since last frame to avoid runaway spin
    const orbitDelta = currentOrbitAngle - lastAppliedOrbit;
    if (Math.abs(orbitDelta) > 0.0001) {
        controls.minAzimuthAngle = -Infinity;
        controls.maxAzimuthAngle = Infinity;
        const dist = camera.position.distanceTo(_cameraTargetLookAt);
        const polar = controls.getPolarAngle();
        const azimuth = controls.getAzimuthalAngle() + orbitDelta;
        camera.position.x = _cameraTargetLookAt.x + dist * Math.sin(polar) * Math.sin(azimuth);
        camera.position.y = _cameraTargetLookAt.y + dist * Math.cos(polar);
        camera.position.z = _cameraTargetLookAt.z + dist * Math.sin(polar) * Math.cos(azimuth);
        lastAppliedOrbit = currentOrbitAngle;
    }

    camera.lookAt(_cameraTargetLookAt);
    controls.update();
}
