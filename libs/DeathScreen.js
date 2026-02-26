/**
 * @module DeathScreen
 * Shows "You died!" overlay when the player dies.
 * Displays score, killer info, and a "Play Again" button — like slither.io.
 */

let overlay = null;

/**
 * Shows the death screen. Returns a promise that resolves when the player clicks "Play Again".
 * @param {object} opts
 * @param {string} opts.killedBy - Who killed the player
 * @param {number} opts.score - Current score (coins collected)
 * @param {number} opts.tailLength - Tail length at death
 * @param {function} opts.getEntityName - Function to resolve entity id to display name
 * @returns {Promise<void>}
 */
export function showDeathScreen({ killedBy, score, tailLength, getEntityName }) {
    // Remove existing if still showing
    if (overlay) {
        overlay.remove();
        overlay = null;
    }

    const killerName = getEntityName ? getEntityName(killedBy) : killedBy;

    return new Promise((resolve) => {
        overlay = document.createElement('div');
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:10000',
            'display:flex', 'align-items:center', 'justify-content:center',
            'background:rgba(0,0,0,0.7)',
            'font-family:monospace', 'color:#fff'
        ].join(';');

        const box = document.createElement('div');
        box.style.cssText = 'text-align:center;';

        // Title
        const title = document.createElement('div');
        title.textContent = 'You died!';
        title.style.cssText = 'font-size:28px; font-weight:bold; color:#ff4444; margin-bottom:12px;';
        box.appendChild(title);

        // Killed by
        const killedByEl = document.createElement('div');
        killedByEl.textContent = `Killed by ${killerName}`;
        killedByEl.style.cssText = 'font-size:14px; color:rgba(255,255,255,0.7); margin-bottom:16px;';
        box.appendChild(killedByEl);

        // Stats row
        const stats = document.createElement('div');
        stats.style.cssText = 'display:flex; gap:24px; justify-content:center; font-size:12px; color:rgba(255,255,255,0.5); margin-bottom:24px;';

        const scoreStat = document.createElement('span');
        scoreStat.textContent = `Score: ${score}`;
        stats.appendChild(scoreStat);

        const tailStat = document.createElement('span');
        tailStat.textContent = `Tail lost: ${tailLength}`;
        stats.appendChild(tailStat);

        box.appendChild(stats);

        // Play Again button
        const btn = document.createElement('button');
        btn.textContent = 'Play Again';
        btn.style.cssText = [
            'padding:10px 36px',
            'font:bold 16px monospace', 'color:#000',
            'background:#00ffcc', 'border:none', 'border-radius:8px',
            'cursor:pointer', 'letter-spacing:1px'
        ].join(';');
        btn.addEventListener('mouseenter', () => { btn.style.background = '#33ffd9'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = '#00ffcc'; });
        btn.addEventListener('click', dismiss);
        box.appendChild(btn);

        // Also dismiss on Enter or Space
        const onKey = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                dismiss();
            }
        };
        window.addEventListener('keydown', onKey);

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function dismiss() {
            window.removeEventListener('keydown', onKey);
            if (overlay) {
                overlay.remove();
                overlay = null;
            }
            resolve();
        }
    });
}
