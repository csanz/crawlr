/**
 * @module ScoreHUD
 * Displays the current coin count at the top center of the screen.
 */

let el = null;
let lastScore = -1;

/**
 * Creates the score display element.
 */
export function initScoreHUD() {
    el = document.createElement('div');
    el.style.cssText = 'position:absolute; top:12px; left:50%; transform:translateX(-50%); z-index:100; pointer-events:none; user-select:none; font:bold 18px monospace; color:#fff; text-shadow:0 0 6px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,0.6);';
    el.textContent = '0';
    document.body.appendChild(el);
}

/**
 * Updates the displayed score (only touches DOM when value changes).
 * @param {number} count
 */
export function updateScoreHUD(count) {
    if (!el || count === lastScore) return;
    lastScore = count;
    el.textContent = count;
}
