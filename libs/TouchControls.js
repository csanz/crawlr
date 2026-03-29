/**
 * @module TouchControls
 * Virtual joystick + action buttons for mobile/tablet.
 * Auto-detects touch devices; no-ops on desktop.
 * Feeds into moveState from InputHandler — no changes to GameLoop or physics.
 *
 * Supports left/right-handed layouts via localStorage key 'jx_controls_hand'.
 * 'right' (default) = joystick left, buttons right.
 * 'left' = joystick right, buttons left.
 */
import { moveState, triggerJump } from './InputHandler.js';
import { stepOrbitLeft, stepOrbitRight } from './CameraSetup.js';

const STORAGE_KEY = 'jx_controls_hand'; // platform-level, not game-specific

/** Whether touch controls are active */
let _active = false;

// --- Joystick state ---
const JOYSTICK_BASE_R = 60;
const JOYSTICK_THUMB_R = 28;
const DEADZONE = 0.15;
const RESTING_OFFSET_X = 80;  // px from edge for resting indicator
const RESTING_OFFSET_Y = 160; // px from bottom

let joystickTouchId = null;
let joystickCenterX = 0;
let joystickCenterY = 0;

// DOM refs
let container = null;
let joystickEl = null;
let joystickBase = null;
let joystickThumb = null;
let joystickResting = null;  // always-visible hint circle
let cameraZone = null;
let jumpBtn = null;
let sprintBtn = null;

// --- Action buttons ---
let jumpTouchId = null;
let sprintTouchId = null;

// --- Camera swipe ---
const SWIPE_THRESHOLD = 40;
let cameraTouchId = null;
let cameraStartX = 0;
let cameraAccumX = 0;

function isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function makeEl(tag, styles, text) {
    const el = document.createElement(tag);
    Object.assign(el.style, styles);
    if (text) el.textContent = text;
    return el;
}

/** Get current handedness ('right' = default, joystick on left) */
export function getHand() {
    return localStorage.getItem(STORAGE_KEY) || 'right';
}

/** Set handedness and re-layout */
export function setHand(hand) {
    localStorage.setItem(STORAGE_KEY, hand);
    if (_active) applyLayout();
}

/**
 * Apply the current handedness layout to all touch elements.
 */
function applyLayout() {
    const hand = getHand();
    // 'right' = right-handed = joystick LEFT, buttons RIGHT
    // 'left'  = left-handed  = joystick RIGHT, buttons LEFT
    const joySide = hand === 'right' ? 'left' : 'right';
    const btnSide = hand === 'right' ? 'right' : 'left';
    const camSide = hand === 'right' ? 'right' : 'left'; // camera zone opposite to joystick

    // Joystick zone
    joystickEl.style.left = joySide === 'left' ? '0' : 'auto';
    joystickEl.style.right = joySide === 'right' ? '0' : 'auto';

    // Resting indicator
    joystickResting.style.left = joySide === 'left' ? `${RESTING_OFFSET_X}px` : 'auto';
    joystickResting.style.right = joySide === 'right' ? `${RESTING_OFFSET_X}px` : 'auto';

    // Camera zone
    cameraZone.style.left = camSide === 'left' ? 'auto' : '0';
    cameraZone.style.right = camSide === 'right' ? 'auto' : '0';
    // Camera is on the button side (opposite joystick), upper portion
    cameraZone.style.left = btnSide === 'left' ? '0' : 'auto';
    cameraZone.style.right = btnSide === 'right' ? '0' : 'auto';

    // Buttons
    const btnGap = 20;
    const btnSize = 80;
    jumpBtn.style.left = btnSide === 'left' ? `${btnGap}px` : 'auto';
    jumpBtn.style.right = btnSide === 'right' ? `${btnGap}px` : 'auto';
    sprintBtn.style.left = btnSide === 'left' ? `${btnGap}px` : 'auto';
    sprintBtn.style.right = btnSide === 'right' ? `${btnGap}px` : 'auto';
}

/**
 * Initialize touch controls. Call after game start. No-ops on desktop.
 */
export function initTouchControls() {
    if (!isTouchDevice()) return;
    _active = true;

    // --- Container ---
    container = makeEl('div', {
        position: 'fixed',
        inset: '0',
        zIndex: '2000',
        pointerEvents: 'none',
        userSelect: 'none',
        webkitUserSelect: 'none',
    });
    container.id = 'touch-controls';

    // --- Joystick zone (half screen) ---
    joystickEl = makeEl('div', {
        position: 'absolute',
        top: '0',
        width: '50%',
        height: '100%',
        pointerEvents: 'auto',
        touchAction: 'none',
    });

    // Resting indicator — always visible so player knows where to touch
    joystickResting = makeEl('div', {
        position: 'absolute',
        bottom: `${RESTING_OFFSET_Y - JOYSTICK_BASE_R}px`,
        width: `${JOYSTICK_BASE_R * 2}px`,
        height: `${JOYSTICK_BASE_R * 2}px`,
        borderRadius: '50%',
        border: '2px solid rgba(255,255,255,0.15)',
        background: 'rgba(255,255,255,0.04)',
        transform: 'translate(-50%, 0)',
        pointerEvents: 'none',
    });
    // Inner dot hint
    const restingDot = makeEl('div', {
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: `${JOYSTICK_THUMB_R * 2}px`,
        height: `${JOYSTICK_THUMB_R * 2}px`,
        borderRadius: '50%',
        background: 'rgba(255,255,255,0.1)',
        transform: 'translate(-50%, -50%)',
    });
    joystickResting.appendChild(restingDot);
    joystickEl.appendChild(joystickResting);

    // Active base (shown on touch)
    joystickBase = makeEl('div', {
        position: 'absolute',
        width: `${JOYSTICK_BASE_R * 2}px`,
        height: `${JOYSTICK_BASE_R * 2}px`,
        borderRadius: '50%',
        border: '2px solid rgba(255,255,255,0.3)',
        background: 'rgba(255,255,255,0.08)',
        display: 'none',
        transform: 'translate(-50%, -50%)',
    });

    joystickThumb = makeEl('div', {
        position: 'absolute',
        width: `${JOYSTICK_THUMB_R * 2}px`,
        height: `${JOYSTICK_THUMB_R * 2}px`,
        borderRadius: '50%',
        background: 'rgba(255,255,255,0.5)',
        display: 'none',
        transform: 'translate(-50%, -50%)',
    });

    joystickEl.appendChild(joystickBase);
    joystickEl.appendChild(joystickThumb);
    container.appendChild(joystickEl);

    // --- Camera swipe zone (opposite half, upper portion) ---
    cameraZone = makeEl('div', {
        position: 'absolute',
        top: '0',
        width: '50%',
        height: '55%',
        pointerEvents: 'auto',
        touchAction: 'none',
    });
    container.appendChild(cameraZone);

    // --- Action buttons ---
    const btnSize = 80;
    const btnGap = 20;

    jumpBtn = makeEl('div', {
        position: 'absolute',
        bottom: `${btnSize + btnGap * 2 + 10}px`,
        width: `${btnSize}px`,
        height: `${btnSize}px`,
        borderRadius: '50%',
        border: '2px solid rgba(255,255,255,0.4)',
        background: 'rgba(255,255,255,0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(255,255,255,0.8)',
        fontSize: '14px',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        pointerEvents: 'auto',
        touchAction: 'none',
    }, 'JUMP');

    sprintBtn = makeEl('div', {
        position: 'absolute',
        bottom: `${btnGap}px`,
        width: `${btnSize}px`,
        height: `${btnSize}px`,
        borderRadius: '50%',
        border: '2px solid rgba(255,255,255,0.4)',
        background: 'rgba(255,255,255,0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(255,255,255,0.8)',
        fontSize: '12px',
        fontFamily: 'monospace',
        fontWeight: 'bold',
        pointerEvents: 'auto',
        touchAction: 'none',
    }, 'SPRINT');

    container.appendChild(jumpBtn);
    container.appendChild(sprintBtn);
    document.body.appendChild(container);

    // Apply initial layout from saved preference
    applyLayout();

    // =========================================================================
    // Touch handlers
    // =========================================================================

    // --- Joystick ---
    joystickEl.addEventListener('touchstart', (e) => {
        if (joystickTouchId !== null) return;
        const t = e.changedTouches[0];
        joystickTouchId = t.identifier;
        joystickCenterX = t.clientX;
        joystickCenterY = t.clientY;

        const rect = joystickEl.getBoundingClientRect();
        const lx = t.clientX - rect.left;
        const ly = t.clientY - rect.top;

        joystickBase.style.left = `${lx}px`;
        joystickBase.style.top = `${ly}px`;
        joystickBase.style.display = 'block';

        joystickThumb.style.left = `${lx}px`;
        joystickThumb.style.top = `${ly}px`;
        joystickThumb.style.display = 'block';

        // Hide resting indicator while active
        joystickResting.style.display = 'none';

        e.preventDefault();
    }, { passive: false });

    joystickEl.addEventListener('touchmove', (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier !== joystickTouchId) continue;

            const dx = t.clientX - joystickCenterX;
            const dy = t.clientY - joystickCenterY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxDist = JOYSTICK_BASE_R;

            const clampedDist = Math.min(dist, maxDist);
            const angle = Math.atan2(dy, dx);
            const thumbX = Math.cos(angle) * clampedDist;
            const thumbY = Math.sin(angle) * clampedDist;

            const rect = joystickEl.getBoundingClientRect();
            const cx = joystickCenterX - rect.left;
            const cy = joystickCenterY - rect.top;
            joystickThumb.style.left = `${cx + thumbX}px`;
            joystickThumb.style.top = `${cy + thumbY}px`;

            const norm = dist / maxDist;
            if (norm < DEADZONE) {
                moveState.forward = 0;
                moveState.backward = 0;
                moveState.left = 0;
                moveState.right = 0;
            } else {
                const nx = dx / dist;
                const ny = dy / dist;
                moveState.left = nx < -0.4 ? 1 : 0;
                moveState.right = nx > 0.4 ? 1 : 0;
                moveState.forward = ny < -0.4 ? 1 : 0;
                moveState.backward = ny > 0.4 ? 1 : 0;
            }

            e.preventDefault();
        }
    }, { passive: false });

    const joystickEnd = (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier !== joystickTouchId) continue;
            joystickTouchId = null;
            joystickBase.style.display = 'none';
            joystickThumb.style.display = 'none';
            joystickResting.style.display = 'block';
            moveState.forward = 0;
            moveState.backward = 0;
            moveState.left = 0;
            moveState.right = 0;
        }
    };
    joystickEl.addEventListener('touchend', joystickEnd, { passive: false });
    joystickEl.addEventListener('touchcancel', joystickEnd, { passive: false });

    // --- Jump button ---
    jumpBtn.addEventListener('touchstart', (e) => {
        if (jumpTouchId !== null) return;
        jumpTouchId = e.changedTouches[0].identifier;
        jumpBtn.style.background = 'rgba(255,255,255,0.35)';
        triggerJump();
        e.preventDefault();
    }, { passive: false });

    const jumpEnd = (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier !== jumpTouchId) continue;
            jumpTouchId = null;
            jumpBtn.style.background = 'rgba(255,255,255,0.12)';
            moveState.jump = 0;
        }
    };
    jumpBtn.addEventListener('touchend', jumpEnd, { passive: false });
    jumpBtn.addEventListener('touchcancel', jumpEnd, { passive: false });

    // --- Sprint button ---
    sprintBtn.addEventListener('touchstart', (e) => {
        if (sprintTouchId !== null) return;
        sprintTouchId = e.changedTouches[0].identifier;
        sprintBtn.style.background = 'rgba(255,255,255,0.35)';
        moveState.sprintHeld = true;
        e.preventDefault();
    }, { passive: false });

    const sprintEnd = (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier !== sprintTouchId) continue;
            sprintTouchId = null;
            sprintBtn.style.background = 'rgba(255,255,255,0.12)';
            moveState.sprintHeld = false;
        }
    };
    sprintBtn.addEventListener('touchend', sprintEnd, { passive: false });
    sprintBtn.addEventListener('touchcancel', sprintEnd, { passive: false });

    // --- Camera swipe zone ---
    cameraZone.addEventListener('touchstart', (e) => {
        if (cameraTouchId !== null) return;
        const t = e.changedTouches[0];
        cameraTouchId = t.identifier;
        cameraStartX = t.clientX;
        cameraAccumX = 0;
        e.preventDefault();
    }, { passive: false });

    cameraZone.addEventListener('touchmove', (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier !== cameraTouchId) continue;
            const dx = t.clientX - cameraStartX;
            const delta = dx - cameraAccumX;
            if (Math.abs(dx) >= SWIPE_THRESHOLD) {
                if (delta < -SWIPE_THRESHOLD) {
                    stepOrbitRight();
                    cameraAccumX = dx;
                } else if (delta > SWIPE_THRESHOLD) {
                    stepOrbitLeft();
                    cameraAccumX = dx;
                }
            }
            e.preventDefault();
        }
    }, { passive: false });

    const cameraEnd = (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier !== cameraTouchId) continue;
            cameraTouchId = null;
        }
    };
    cameraZone.addEventListener('touchend', cameraEnd, { passive: false });
    cameraZone.addEventListener('touchcancel', cameraEnd, { passive: false });
}

/** Returns true if touch controls are currently active */
export function isTouchActive() {
    return _active;
}
