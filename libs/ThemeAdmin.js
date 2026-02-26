/**
 * @module ThemeAdmin
 * Dev overlay for testing themes. Toggle with backtick (`).
 * Shows registered themes with Start/Stop buttons.
 */
import { eventBus } from './EventBus.js';
import { playEffect } from './Sound.js';


let panel = null;
let themeManager = null;
let visible = false;
let playerMeshRef = null;
let roundManagerRef = null;

export function initThemeAdmin(tm, playerMesh, roundManager) {
    themeManager = tm;
    playerMeshRef = playerMesh || null;
    roundManagerRef = roundManager || null;

    panel = document.createElement('div');
    panel.style.cssText = [
        'position:fixed',
        'top:10px',
        'right:10px',
        'z-index:9999',
        'background:rgba(0,0,0,0.85)',
        'border:1px solid rgba(255,255,255,0.15)',
        'border-radius:8px',
        'padding:12px 16px',
        'font:13px/1.6 monospace',
        'color:#ccc',
        'min-width:180px',
        'display:none',
        'user-select:none',
        'backdrop-filter:blur(6px)'
    ].join(';');
    document.body.appendChild(panel);

    window.addEventListener('keydown', (e) => {
        if (e.key === '`') {
            visible = !visible;
            panel.style.display = visible ? 'block' : 'none';
            if (visible) render();
        }
    });

    eventBus.on('theme:started', () => { if (visible) render(); });
    eventBus.on('theme:ended', () => { if (visible) render(); });
}

function render() {
    if (!panel || !themeManager) return;

    const active = themeManager.activeTheme;
    let html = '<div style="color:#fff;font-weight:bold;margin-bottom:8px;font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:0.6">Themes</div>';

    for (const theme of themeManager.themes) {
        const isActive = active && active.name === theme.name;

        if (isActive) {
            html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">`;
            html += `<span style="color:#4f4;flex:1">${theme.name}</span>`;
            html += `<span style="color:rgba(255,255,255,0.3);font-size:11px">${Math.ceil(themeManager.remaining)}s</span>`;
            html += `<button data-action="stop" style="${btnStyle('#c33')}">Stop</button>`;
            html += `</div>`;
        } else {
            html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">`;
            html += `<span style="flex:1">${theme.name}</span>`;
            html += `<button data-action="start" data-theme="${theme.name}" style="${btnStyle('#2a6')}">Start</button>`;
            html += `</div>`;
        }
    }

    if (active) {
        html += `<div style="margin-top:4px;font-size:10px;color:rgba(255,255,255,0.3)">Remaining updates live</div>`;
    }

    // Lightning test section
    html += `<div style="border-top:1px solid rgba(255,255,255,0.1);margin-top:10px;padding-top:8px">`;
    html += `<div style="color:#fff;font-weight:bold;margin-bottom:6px;font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:0.6">Effects</div>`;
    html += `<button data-action="lightning" style="${btnStyle('#c90')}">&#9889; Strike Player</button>`;
    html += `</div>`;

    // Round timer section
    if (roundManagerRef) {
        html += `<div style="border-top:1px solid rgba(255,255,255,0.1);margin-top:10px;padding-top:8px">`;
        html += `<div style="color:#fff;font-weight:bold;margin-bottom:6px;font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:0.6">Round Timer</div>`;
        const remaining = roundManagerRef.getRemainingTime();
        const mins = Math.floor(remaining / 60);
        const secs = Math.floor(remaining % 60);
        html += `<div style="color:rgba(255,255,255,0.5);font-size:11px;margin-bottom:6px">${mins}:${secs.toString().padStart(2, '0')} remaining (Round ${roundManagerRef.roundNumber})</div>`;
        html += `<div style="display:flex;gap:4px;flex-wrap:wrap">`;
        html += `<button data-action="round-duration" data-duration="30" style="${btnStyle(roundManagerRef.duration === 30 ? '#c90' : '#555')}">30s</button>`;
        html += `<button data-action="round-duration" data-duration="120" style="${btnStyle(roundManagerRef.duration === 120 ? '#c90' : '#555')}">2m</button>`;
        html += `<button data-action="round-duration" data-duration="300" style="${btnStyle(roundManagerRef.duration === 300 ? '#c90' : '#555')}">5m</button>`;
        html += `<button data-action="round-duration" data-duration="600" style="${btnStyle(roundManagerRef.duration === 600 ? '#c90' : '#555')}">10m</button>`;
        html += `</div>`;
        html += `</div>`;
    }

    // Test podium button
    html += `<div style="border-top:1px solid rgba(255,255,255,0.1);margin-top:10px;padding-top:8px">`;
    html += `<button data-action="show-podium" style="${btnStyle('#569')}">&#127942; Show Podium</button>`;
    html += `</div>`;

    html += `<div style="margin-top:10px;font-size:10px;color:rgba(255,255,255,0.2)">Press \` to close</div>`;
    panel.innerHTML = html;

    // Wire up buttons
    panel.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            if (action === 'start') {
                themeManager.forceStart(btn.dataset.theme);
            } else if (action === 'stop') {
                themeManager.forceStop();
            } else if (action === 'lightning') {
                // Simulate lightning striking the player
                const px = playerMeshRef ? playerMeshRef.position.x : 0;
                const pz = playerMeshRef ? playerMeshRef.position.z : 0;
                playEffect('lightning:strike');
                eventBus.emit('lightning:strike', {
                    x: px,
                    z: pz,
                    hitRadius: 10,
                    sizeLoss: 0.15,
                    minSize: 1.0,
                    spawnBolt: true
                });
            } else if (action === 'show-podium') {
                eventBus.emit('admin:show-podium');
            } else if (action === 'round-duration') {
                const duration = parseInt(btn.dataset.duration, 10);
                if (roundManagerRef && duration) {
                    roundManagerRef.setDuration(duration);
                }
            }
            render();
        });
    });

    // Live-update remaining time while active (themes or round timer)
    if (visible && (active || roundManagerRef)) {
        clearTimeout(panel._timer);
        panel._timer = setTimeout(() => { if (visible) render(); }, 1000);
    }
}

function btnStyle(bg) {
    return [
        `background:${bg}`,
        'color:#fff',
        'border:none',
        'border-radius:4px',
        'padding:2px 10px',
        'font:11px monospace',
        'cursor:pointer'
    ].join(';');
}
