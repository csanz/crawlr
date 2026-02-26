/**
 * @module RoundHUD
 * Countdown timer display for timed rounds.
 * Positioned top-center below the score HUD. Pulses red when under 30 seconds.
 */

let el = null;
let flashEl = null;
let lastDisplay = '';
let flashShown = false;

/**
 * Creates the round HUD DOM elements.
 */
export function initRoundHUD() {
    el = document.createElement('div');
    el.style.cssText = [
        'position:absolute',
        'top:36px',
        'left:50%',
        'transform:translateX(-50%)',
        'z-index:100',
        'font:bold 20px monospace',
        'color:#fff',
        'text-shadow:0 2px 8px rgba(0,0,0,0.7)',
        'pointer-events:none',
        'user-select:none',
        'transition:color 0.3s'
    ].join(';');
    document.body.appendChild(el);

    // Flash text element for "FINAL 30 SECONDS!"
    flashEl = document.createElement('div');
    flashEl.style.cssText = [
        'position:absolute',
        'top:62px',
        'left:50%',
        'transform:translateX(-50%)',
        'z-index:100',
        'font:bold 14px monospace',
        'color:#ff4444',
        'text-shadow:0 0 10px rgba(255,68,68,0.8)',
        'pointer-events:none',
        'user-select:none',
        'opacity:0',
        'transition:opacity 0.5s'
    ].join(';');
    flashEl.textContent = 'FINAL 30 SECONDS!';
    document.body.appendChild(flashEl);
}

/**
 * Updates the timer display.
 * @param {number} seconds - Remaining seconds
 */
export function updateRoundHUD(seconds) {
    if (!el) return;

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const display = `${mins}:${secs.toString().padStart(2, '0')}`;

    if (display === lastDisplay) return;
    lastDisplay = display;

    el.textContent = display;

    // Pulse red when under 30 seconds
    if (seconds <= 30) {
        const pulse = Math.sin(Date.now() * 0.008) * 0.5 + 0.5;
        const r = Math.round(255);
        const g = Math.round(60 + pulse * 60);
        const b = Math.round(60 + pulse * 60);
        el.style.color = `rgb(${r},${g},${b})`;
        el.style.textShadow = `0 0 12px rgba(255,68,68,${0.4 + pulse * 0.4})`;

        // Show flash text once
        if (!flashShown) {
            flashShown = true;
            flashEl.style.opacity = '1';
            setTimeout(() => {
                if (flashEl) flashEl.style.opacity = '0';
            }, 2500);
        }
    } else {
        el.style.color = '#fff';
        el.style.textShadow = '0 2px 8px rgba(0,0,0,0.7)';
    }
}

/**
 * Hides the round HUD (during podium/start screen).
 */
export function hideRoundHUD() {
    if (el) el.style.display = 'none';
    if (flashEl) flashEl.style.display = 'none';
}

/**
 * Shows the round HUD.
 */
export function showRoundHUD() {
    if (el) el.style.display = '';
    if (flashEl) flashEl.style.display = '';
    flashShown = false;
    lastDisplay = '';
}
