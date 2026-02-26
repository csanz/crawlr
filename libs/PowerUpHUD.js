/**
 * @module PowerUpHUD
 * Shows a brief warning flash when hitting a ring obstacle.
 * Kept minimal — just a fading "RING HIT! -X STAMINA" text.
 */
import { eventBus } from './EventBus.js';

let container = null;
let fadeTimer = 0;

/**
 * Creates the power-up HUD container and listens for ring hits.
 */
export function initPowerUpHUD() {
    container = document.createElement('div');
    container.style.cssText = [
        'position:absolute',
        'top:44px',
        'right:10px',
        'z-index:100',
        'pointer-events:none',
        'user-select:none',
        'font:bold 11px monospace',
        'color:#ff4444',
        'width:160px',
        'text-align:center',
        'opacity:0',
        'transition:opacity 0.3s'
    ].join(';');
    document.body.appendChild(container);

    // Listen for ring hits on the player
    eventBus.on('ring:hit', (data) => {
        if (data.entityId === 'player') {
            showWarning(data.segmentsLost);
        }
    });
}

function showWarning(segmentsLost) {
    if (!container) return;
    container.textContent = `RING HIT! -${segmentsLost} STAMINA`;
    container.style.opacity = '1';
    fadeTimer = 1.5;
}

/**
 * Update the HUD fade timer. Call each frame.
 */
export function updatePowerUpHUD() {
    if (!container || fadeTimer <= 0) return;
    fadeTimer -= 1 / 60; // approximate dt
    if (fadeTimer <= 0) {
        container.style.opacity = '0';
    }
}
