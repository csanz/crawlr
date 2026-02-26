/**
 * @module Player
 * Player creation, movement, glow effects, and growth.
 */
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d';
import { moveState } from './InputHandler.js';
import {
    PLAYER_SPEED,
    PLAYER_RUN_MULTIPLIER,
    TAIL_SEGMENT_COLOR,
    TAIL_SEGMENT_ROUNDNESS,
    FALL_GRAVITY_MULTIPLIER,
    LOW_JUMP_MULTIPLIER,
    GRAVITY
} from './PhysicsConfig.js';

// Pre-allocated reusable vectors for movement calculation
const cameraForward = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const desiredVelocity = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);

/** Target rotation for the visual mesh (exported for GameLoop) */
export let targetPlayerQuaternion = new THREE.Quaternion();

// Glow-related module state
let playerGlowMesh = null;
let glowLight = null;

/** Shared glow state readable by the tail system */
export const glowState = {
    isGlowing: false,
    intensity: 0,
    color: new THREE.Color(TAIL_SEGMENT_COLOR)
};

// Shared eye geometries (created once)
let _eyeWhiteGeo = null;
let _eyePupilGeo = null;

function getEyeWhiteGeo() {
    if (!_eyeWhiteGeo) _eyeWhiteGeo = new THREE.SphereGeometry(0.22, 10, 8);
    return _eyeWhiteGeo;
}
function getEyePupilGeo() {
    if (!_eyePupilGeo) _eyePupilGeo = new THREE.SphereGeometry(0.10, 8, 6);
    return _eyePupilGeo;
}

const _eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const _eyePupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

/**
 * Adds two cartoon eyes on top of a head mesh (player or bot).
 * Positioned on the +Y face (top), looking up, like slither.io.
 * Stores pupil references on mesh.userData for googly-eye physics.
 * @param {THREE.Mesh} mesh
 */
export function addEyes(mesh) {
    const spacing = 0.25;
    const height = 0.45;   // sitting on top of the cube
    const forward = 0.35;  // pushed toward the front face
    const eyes = [];
    const pupils = [];

    for (const side of [-1, 1]) {
        // White of the eye
        const eyeWhite = new THREE.Mesh(getEyeWhiteGeo(), _eyeWhiteMat);
        eyeWhite.position.set(side * spacing, height, forward);
        mesh.add(eyeWhite);

        // Black pupil — on the surface of the white, looking up
        const pupil = new THREE.Mesh(getEyePupilGeo(), _eyePupilMat);
        pupil.position.set(0, 0.18, 0);
        eyeWhite.add(pupil);

        eyes.push(eyeWhite);
        pupils.push(pupil);
    }

    // Store refs for googly-eye physics + squint
    mesh.userData.eyes = eyes;
    mesh.userData.pupils = pupils;
    mesh.userData.eyePhysics = { prevAngle: 0, offsetX: 0, velX: 0, squint: 0, pushZ: 0, painSquint: 0 };

    // Self-running random blink animation
    let nextBlink = 4000 + Math.random() * 6000; // 4-10s until first blink
    let blinkStart = 0;
    const BLINK_DURATION = 120; // ms — how long the eyes stay shut

    const animate = () => {
        const now = performance.now();

        if (blinkStart > 0) {
            // Currently blinking
            const elapsed = now - blinkStart;
            if (elapsed < BLINK_DURATION) {
                // Eyes shut — squish Y to nearly flat
                const t = elapsed / BLINK_DURATION;
                const squish = t < 0.5 ? 1 - t * 2 : (t - 0.5) * 2; // close then open
                for (const eye of eyes) eye.scale.y = 0.1 + squish * 0.9;
            } else {
                // Blink done — reset and schedule next
                for (const eye of eyes) eye.scale.y = 1;
                blinkStart = 0;
                nextBlink = now + 5000 + Math.random() * 8000; // 5-13s until next
            }
        } else if (now >= nextBlink) {
            blinkStart = now;
        }

        requestAnimationFrame(animate);
    };

    // Stagger start so not all snakes blink at the same time
    setTimeout(() => requestAnimationFrame(animate), Math.random() * 3000);
}

/**
 * Creates a rounded box geometry matching the tail segment style.
 * @returns {THREE.BufferGeometry}
 */
function createPlayerGeometry() {
    const geometry = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
    const positions = geometry.attributes.position;

    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        const length = Math.sqrt(x * x + y * y + z * z);
        positions.setXYZ(
            i,
            x + (x / length) * TAIL_SEGMENT_ROUNDNESS,
            y + (y / length) * TAIL_SEGMENT_ROUNDNESS,
            z + (z / length) * TAIL_SEGMENT_ROUNDNESS
        );
    }

    geometry.computeVertexNormals();
    return geometry;
}

/**
 * Creates the player's visual mesh and physics body.
 * @param {THREE.Scene} scene
 * @param {RAPIER.World} world
 * @param {THREE.WebGLRenderer} renderer
 * @returns {{playerMesh: THREE.Mesh, playerBody: RAPIER.RigidBody}}
 */
export function createPlayer(scene, world, renderer) {
    const playerColor = new THREE.Color().setHSL(Math.random(), 1.0, 0.5);

    const playerMesh = new THREE.Mesh(
        createPlayerGeometry(),
        new THREE.MeshStandardMaterial({ color: playerColor, roughness: 0.5 })
    );
    playerMesh.castShadow = true;
    scene.add(playerMesh);

    // Glow mesh (additive blending sphere around the player)
    playerGlowMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.8, 16, 16),
        new THREE.MeshBasicMaterial({
            color: playerColor,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        })
    );
    playerMesh.add(playerGlowMesh);

    // Single point light for the player (only light in the game besides directional + ambient)
    glowLight = new THREE.PointLight(playerColor, 0, 6);
    glowLight.position.set(0, 0.5, 0);
    playerMesh.add(glowLight);

    playerMesh.userData.glowColor = playerColor;
    glowState.color = playerColor;

    // Add cartoon eyes
    addEyes(playerMesh);

    // Physics body
    const playerBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(0.0, 1.0, 0.0)
    );
    const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
            .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL),
        playerBody
    );
    collider.userData = { type: 'player', entityId: 'player' };

    return { playerMesh, playerBody };
}

/**
 * Updates the player's velocity based on keyboard input and camera direction.
 * @param {RAPIER.RigidBody} playerBody
 * @param {THREE.Camera} camera
 */
export function updatePlayerMovement(playerBody, camera) {
    camera.getWorldDirection(cameraForward);
    cameraRight.crossVectors(cameraForward, worldUp).normalize();

    // Project onto XZ plane
    cameraForward.y = 0;
    cameraRight.y = 0;
    cameraForward.normalize();
    cameraRight.normalize();

    const moveZ = moveState.forward - moveState.backward;
    const moveX = moveState.right - moveState.left;

    desiredVelocity.set(0, 0, 0);
    desiredVelocity.addScaledVector(cameraForward, moveZ);
    desiredVelocity.addScaledVector(cameraRight, moveX);

    // Update target rotation when moving
    if (desiredVelocity.lengthSq() > 0.01) {
        desiredVelocity.normalize();
        const angle = Math.atan2(desiredVelocity.x, desiredVelocity.z);
        targetPlayerQuaternion.setFromAxisAngle(worldUp, angle);
    }

    const baseSpeed = moveState.run ? PLAYER_SPEED * PLAYER_RUN_MULTIPLIER : PLAYER_SPEED;
    const currentSpeed = baseSpeed * (moveState.powerSpeedMultiplier || 1.0);
    desiredVelocity.multiplyScalar(currentSpeed);

    const currentVelocity = playerBody.linvel();

    // During air dash (flip), don't override horizontal velocity — let the impulse carry
    if (moveState.flipping) {
        playerBody.setLinvel({
            x: currentVelocity.x,
            y: currentVelocity.y,
            z: currentVelocity.z
        }, true);
        return;
    }

    playerBody.setLinvel({
        x: desiredVelocity.x,
        y: currentVelocity.y,
        z: desiredVelocity.z
    }, true);
}

/**
 * Applies extra gravity for better jump feel.
 * When falling: stronger pull-down for a snappy, weighty landing.
 * When rising with jump released: slightly faster deceleration for variable jump height.
 * @param {RAPIER.RigidBody} playerBody
 */
export function applyJumpGravity(playerBody) {
    const vel = playerBody.linvel();
    const pos = playerBody.translation();
    const dt = 0.016; // physics timestep approximation
    const airborne = pos.y > 1.5; // only apply air physics when clearly off the ground

    if (vel.y < -0.5) {
        // Falling — pull-down for landing
        const extraForce = GRAVITY.y * (FALL_GRAVITY_MULTIPLIER - 1);
        playerBody.applyImpulse({ x: 0, y: extraForce * dt, z: 0 }, true);
    } else if (airborne && Math.abs(vel.y) <= 0.8 && Math.abs(vel.y) > 0.01) {
        // Apex — brief hang at the peak (only when airborne)
        playerBody.applyImpulse({ x: 0, y: -GRAVITY.y * 0.3 * dt, z: 0 }, true);
    } else if (vel.y > 0.1 && !moveState.jump) {
        // Rising but jump key released — cut the jump short
        const extraForce = GRAVITY.y * (LOW_JUMP_MULTIPLIER - 1);
        playerBody.applyImpulse({ x: 0, y: extraForce * dt, z: 0 }, true);
    }
}

/**
 * Updates the player's glow/pulse effect based on run state.
 * @param {THREE.Mesh} playerMesh
 */
export function updatePlayerGlow(playerMesh) {
    if (!playerGlowMesh || !glowLight) return;

    const time = performance.now() * 0.001;

    // Counteract parent scale so glow stays tight to the body
    const parentScale = playerMesh.scale.x || 1;
    const inverseScale = 1 / parentScale;

    if (moveState.run) {
        const pulseIntensity = 0.2 + Math.sin(time * 3) * 0.03;

        const targetOpacity = 0.03 * pulseIntensity;
        playerGlowMesh.material.opacity += (targetOpacity - playerGlowMesh.material.opacity) * 0.08;

        playerGlowMesh.scale.setScalar(inverseScale);

        const targetIntensity = 0.1 * pulseIntensity;
        glowLight.intensity += (targetIntensity - glowLight.intensity) * 0.08;

        glowState.isGlowing = true;
        glowState.intensity = pulseIntensity;
    } else {
        playerGlowMesh.material.opacity *= 0.9;
        glowLight.intensity *= 0.9;

        const currentScale = playerGlowMesh.scale.x;
        playerGlowMesh.scale.setScalar(currentScale + (inverseScale - currentScale) * 0.1);

        if (playerGlowMesh.material.opacity < 0.05) {
            glowState.isGlowing = false;
            glowState.intensity = 0;
        } else {
            glowState.intensity = playerGlowMesh.material.opacity / 0.35;
        }
    }
}

/**
 * Computes growth for a given scale. Each tier takes more coins to fill.
 * Tier 1: 1.0→2.0 (0.05/coin = 20 coins), Tier 2: 2.0→3.0 (0.035 = ~29 coins),
 * Tier 3: 3.0→4.0 (0.025 = 40 coins), etc. Slows down each level.
 * @param {number} currentScale
 * @returns {number} new scale
 */
export function computeGrowth(currentScale) {
    const tier = Math.floor(currentScale);
    const rate = Math.max(0.025, 0.05 - (tier - 1) * 0.01);
    return currentScale + rate;
}

/**
 * Grows the player mesh when collecting a coin.
 * @param {THREE.Mesh} playerMesh
 */
export function growPlayer(playerMesh) {
    const newScale = computeGrowth(playerMesh.scale.x);
    playerMesh.scale.setScalar(newScale);
}

// Reusable Euler to avoid allocation in hot loop
const _euler = new THREE.Euler();

/**
 * Googly-eye spring physics + speed/jump effects. Call once per frame.
 * - Turning: pupils shift laterally (inertia), spring back
 * - Sprinting: eyes squint (wind), pupils push backward
 * - Jumping up: eyes go wide (excited), pupils shift up
 * - Falling: eyes narrow slightly, pupils shift down (looking at ground)
 * @param {THREE.Mesh} mesh - Mesh that has had addEyes() called on it
 * @param {number} dt - Delta time in seconds
 * @param {number} [speed=0] - Horizontal movement speed
 * @param {number} [sprintThreshold=10] - Speed above which squint kicks in
 * @param {number} [velY=0] - Vertical velocity (positive = rising, negative = falling)
 */
export function updateEyePhysics(mesh, dt, speed = 0, sprintThreshold = 10, velY = 0) {
    const pupils = mesh.userData.pupils;
    const eyes = mesh.userData.eyes;
    const state = mesh.userData.eyePhysics;
    if (!pupils || !state) return;

    // --- Lateral googly physics (turning) ---
    _euler.setFromQuaternion(mesh.quaternion, 'YXZ');
    const angle = _euler.y;

    let angVel = angle - state.prevAngle;
    if (angVel > Math.PI) angVel -= Math.PI * 2;
    if (angVel < -Math.PI) angVel += Math.PI * 2;
    state.prevAngle = angle;

    const inertia = -angVel * 18;
    const spring = -100 * state.offsetX;
    const damp = -10 * state.velX;

    state.velX += (inertia + spring + damp) * dt;
    state.offsetX += state.velX * dt;

    const MAX_X = 0.08;
    if (state.offsetX > MAX_X) { state.offsetX = MAX_X; state.velX *= -0.3; }
    if (state.offsetX < -MAX_X) { state.offsetX = -MAX_X; state.velX *= -0.3; }

    // --- Speed effects: squint + pupil push-back ---
    const speedFactor = Math.min(1, Math.max(0, (speed - sprintThreshold) / 6));

    let targetSquint = speedFactor * 0.55;
    const targetPushZ = -speedFactor * 0.06;
    state.pushZ += (targetPushZ - state.pushZ) * Math.min(1, 6 * dt);

    // --- Jump effects: just subtle pupil shifts ---
    let pupilYOffset = 0;

    if (velY > 2) {
        // Rising — pupils glance up slightly
        pupilYOffset = Math.min(0.015, (velY - 2) * 0.003);
    } else if (velY < -2) {
        // Falling — pupils glance down slightly
        pupilYOffset = Math.max(-0.015, (velY + 2) * 0.003);
    }

    // Squint: lerp toward target
    state.squint += (targetSquint - state.squint) * Math.min(1, 8 * dt);

    // Decay pain squint (set externally by electrocution)
    if (state.painSquint > 0) {
        state.painSquint = Math.max(0, state.painSquint - dt * 1.2);
    }

    // --- Apply ---
    for (const pupil of pupils) {
        pupil.position.x = state.offsetX;
        pupil.position.y = 0.18 + pupilYOffset;
        pupil.position.z = state.pushZ;
    }

    if (eyes) {
        const totalSquint = Math.min(0.95, state.squint + state.painSquint);
        for (const eye of eyes) {
            eye.scale.y = 1 - totalSquint;
        }
    }
}
