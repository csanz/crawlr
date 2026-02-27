/**
 * @module KeyboardHelp
 * Toggleable overlay showing all keyboard shortcuts.
 * Press ? to toggle.
 */

let overlay = null;
let hint = null;

const SHORTCUTS = [
    ['W A S D', 'Move'],
    ['Shift (hold)', 'Sprint (burns tail)'],
    ['Space', 'Jump'],
    ['Arrow L/R', 'Rotate camera'],
    ['Z', 'Cycle zoom'],
    ['V', 'Cycle perspective'],
    ['M', 'Mute / unmute'],
    ['L', 'Leaderboard'],
    ['P', 'Toggle FPS'],
    ['?', 'Toggle this help'],
];

/**
 * Creates the help overlay and the persistent hint element.
 */
export function initKeyboardHelp() {
    // Persistent hint in bottom-left
    hint = document.createElement('div');
    hint.textContent = '? for controls';
    hint.style.cssText = 'position:absolute; bottom:140px; left:10px; z-index:100; color:rgba(255,255,255,0.7); font:13px monospace; pointer-events:none; user-select:none; text-shadow:0 0 4px rgba(0,0,0,0.8);';
    document.body.appendChild(hint);

    // Full overlay (hidden by default)
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; inset:0; z-index:9999; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,0.7);';

    const box = document.createElement('div');
    box.style.cssText = 'background:rgba(20,20,30,0.95); border:1px solid rgba(255,255,255,0.15); border-radius:12px; padding:24px 32px; max-width:320px; font-family:monospace; color:#fff;';

    const title = document.createElement('div');
    title.textContent = 'Controls';
    title.style.cssText = 'font-size:16px; font-weight:bold; margin-bottom:16px; color:#00ffcc;';
    box.appendChild(title);

    for (const [key, desc] of SHORTCUTS) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:8px; gap:16px;';

        const keyEl = document.createElement('span');
        keyEl.textContent = key;
        keyEl.style.cssText = 'background:rgba(255,255,255,0.1); padding:2px 8px; border-radius:4px; font-size:12px; white-space:nowrap;';

        const descEl = document.createElement('span');
        descEl.textContent = desc;
        descEl.style.cssText = 'color:rgba(255,255,255,0.7); font-size:12px;';

        row.appendChild(keyEl);
        row.appendChild(descEl);
        box.appendChild(row);
    }

    const footer = document.createElement('div');
    footer.textContent = 'Press ? or Esc to close';
    footer.style.cssText = 'margin-top:16px; font-size:10px; color:rgba(255,255,255,0.3); text-align:center;';
    box.appendChild(footer);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Click on backdrop (outside box) closes the overlay
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.style.display = 'none';
        }
    });

    // Listen for ? key to toggle, Escape to close
    window.addEventListener('keydown', (e) => {
        if (e.key === '?') {
            toggleHelp();
        } else if (e.key === 'Escape' && overlay.style.display === 'flex') {
            overlay.style.display = 'none';
        }
    });
}

function toggleHelp() {
    if (!overlay) return;
    const visible = overlay.style.display === 'flex';
    overlay.style.display = visible ? 'none' : 'flex';
}
