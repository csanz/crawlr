/**
 * @module GameMenu
 * Hamburger menu with player list, controls layout toggle, and leave-game button.
 * Works on both mobile and desktop.
 */
import { getPlayerNames } from './PlayerList.js';
import { getHand, setHand, isTouchActive } from './TouchControls.js';

let menuBtn = null;
let modal = null;
let playerListEl = null;
let handToggleRow = null;
let _isOpen = false;

/**
 * Initialize the hamburger menu. Call once after game start.
 */
export function initGameMenu() {
    // --- Hamburger button (top-left) ---
    menuBtn = document.createElement('button');
    menuBtn.id = 'game-menu-btn';
    menuBtn.innerHTML = '<span></span><span></span><span></span>';
    menuBtn.style.cssText = [
        'position:fixed',
        'top:12px',
        'left:12px',
        'z-index:3000',
        'width:40px',
        'height:40px',
        'background:rgba(0,0,0,0.4)',
        'border:1px solid rgba(255,255,255,0.25)',
        'border-radius:8px',
        'cursor:pointer',
        'display:flex',
        'flex-direction:column',
        'align-items:center',
        'justify-content:center',
        'gap:4px',
        'padding:0',
        'backdrop-filter:blur(4px)',
        '-webkit-backdrop-filter:blur(4px)',
    ].join(';');

    for (const span of menuBtn.querySelectorAll('span')) {
        span.style.cssText = 'display:block;width:20px;height:2px;background:rgba(255,255,255,0.8);border-radius:1px;transition:transform 0.2s;';
    }

    menuBtn.addEventListener('click', toggle);
    document.body.appendChild(menuBtn);

    // --- Modal overlay ---
    modal = document.createElement('div');
    modal.id = 'game-menu-modal';
    modal.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2999',
        'background:rgba(0,0,0,0.7)',
        'backdrop-filter:blur(6px)',
        '-webkit-backdrop-filter:blur(6px)',
        'display:none',
        'align-items:center',
        'justify-content:center',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
        'background:rgba(20,20,30,0.95)',
        'border:1px solid rgba(255,255,255,0.15)',
        'border-radius:12px',
        'padding:24px',
        'min-width:260px',
        'max-width:340px',
        'width:80vw',
        'max-height:70vh',
        'overflow-y:auto',
        'font-family:monospace',
        'color:#fff',
    ].join(';');

    // --- Players section ---
    const title = document.createElement('div');
    title.textContent = 'Players';
    title.style.cssText = 'font-size:16px;font-weight:bold;margin-bottom:12px;color:rgba(255,255,255,0.9);';
    panel.appendChild(title);

    playerListEl = document.createElement('div');
    playerListEl.style.cssText = 'margin-bottom:16px;';
    panel.appendChild(playerListEl);

    // --- Controls layout (only on touch devices) ---
    if (isTouchActive()) {
        const divider1 = document.createElement('div');
        divider1.style.cssText = 'height:1px;background:rgba(255,255,255,0.1);margin-bottom:16px;';
        panel.appendChild(divider1);

        const settingsLabel = document.createElement('div');
        settingsLabel.textContent = 'Controls';
        settingsLabel.style.cssText = 'font-size:14px;font-weight:bold;margin-bottom:12px;color:rgba(255,255,255,0.7);';
        panel.appendChild(settingsLabel);

        handToggleRow = document.createElement('div');
        handToggleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';

        const handLabel = document.createElement('span');
        handLabel.textContent = 'Layout';
        handLabel.style.cssText = 'font-size:13px;color:rgba(255,255,255,0.7);';
        handToggleRow.appendChild(handLabel);

        const handBtnGroup = document.createElement('div');
        handBtnGroup.style.cssText = 'display:flex;gap:4px;';

        const leftBtn = createToggleBtn('Left-handed', 'left');
        const rightBtn = createToggleBtn('Right-handed', 'right');
        handBtnGroup.appendChild(leftBtn);
        handBtnGroup.appendChild(rightBtn);
        handToggleRow.appendChild(handBtnGroup);

        panel.appendChild(handToggleRow);
    }

    // --- Leave button ---
    const divider2 = document.createElement('div');
    divider2.style.cssText = 'height:1px;background:rgba(255,255,255,0.1);margin-bottom:16px;';
    panel.appendChild(divider2);

    const leaveBtn = document.createElement('button');
    leaveBtn.textContent = 'Leave Game';
    leaveBtn.style.cssText = [
        'width:100%',
        'padding:12px',
        'background:rgba(220,50,50,0.8)',
        'border:1px solid rgba(255,100,100,0.4)',
        'border-radius:8px',
        'color:#fff',
        'font-family:monospace',
        'font-size:14px',
        'font-weight:bold',
        'cursor:pointer',
        'transition:background 0.2s',
    ].join(';');
    leaveBtn.addEventListener('mouseenter', () => { leaveBtn.style.background = 'rgba(220,50,50,1)'; });
    leaveBtn.addEventListener('mouseleave', () => { leaveBtn.style.background = 'rgba(220,50,50,0.8)'; });
    leaveBtn.addEventListener('click', leaveGame);
    panel.appendChild(leaveBtn);

    modal.appendChild(panel);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });

    document.body.appendChild(modal);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _isOpen) close();
    });
}

function createToggleBtn(label, value) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.dataset.hand = value;
    const isActive = getHand() === value;
    btn.style.cssText = [
        'padding:6px 12px',
        'font:12px monospace',
        `background:${isActive ? 'rgba(0,255,204,0.25)' : 'rgba(255,255,255,0.06)'}`,
        `border:1px solid ${isActive ? 'rgba(0,255,204,0.5)' : 'rgba(255,255,255,0.15)'}`,
        `color:${isActive ? '#00ffcc' : 'rgba(255,255,255,0.6)'}`,
        'border-radius:6px',
        'cursor:pointer',
        'transition:all 0.2s',
    ].join(';');

    btn.addEventListener('click', () => {
        setHand(value);
        // Update button styles
        const siblings = btn.parentElement.querySelectorAll('button');
        for (const s of siblings) {
            const active = s.dataset.hand === value;
            s.style.background = active ? 'rgba(0,255,204,0.25)' : 'rgba(255,255,255,0.06)';
            s.style.borderColor = active ? 'rgba(0,255,204,0.5)' : 'rgba(255,255,255,0.15)';
            s.style.color = active ? '#00ffcc' : 'rgba(255,255,255,0.6)';
        }
    });

    return btn;
}

function toggle() {
    if (_isOpen) close();
    else open();
}

function open() {
    _isOpen = true;
    modal.style.display = 'flex';
    refreshPlayerList();

    const spans = menuBtn.querySelectorAll('span');
    spans[0].style.transform = 'rotate(45deg) translate(4px, 4px)';
    spans[1].style.opacity = '0';
    spans[2].style.transform = 'rotate(-45deg) translate(4px, -4px)';
}

function close() {
    _isOpen = false;
    modal.style.display = 'none';

    const spans = menuBtn.querySelectorAll('span');
    spans[0].style.transform = 'none';
    spans[1].style.opacity = '1';
    spans[2].style.transform = 'none';
}

function refreshPlayerList() {
    const names = getPlayerNames();
    let html = '';

    if (names.size === 0) {
        html = '<div style="color:rgba(255,255,255,0.4);font-size:12px;">No players yet</div>';
    } else {
        for (const [id, name] of names) {
            const isLocal = id === 'player';
            const color = isLocal ? '#00ffcc' : 'rgba(255,255,255,0.85)';
            const badge = isLocal ? ' <span style="color:rgba(255,255,255,0.35);font-size:10px;">(you)</span>' : '';
            html += `<div style="padding:6px 8px;border-radius:6px;margin-bottom:4px;background:rgba(255,255,255,0.05);display:flex;align-items:center;gap:8px;">`;
            html += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${isLocal ? '#00ffcc' : 'rgba(255,255,255,0.4)'};flex-shrink:0;"></span>`;
            html += `<span style="color:${color};font-size:13px;">${name}${badge}</span>`;
            html += `</div>`;
        }
    }

    playerListEl.innerHTML = html;
}

function leaveGame() {
    // Disconnect from the server so other players see "left the game"
    if (window.__networkManager) {
        window.__networkManager.disconnect();
    }

    // Navigate back to the portal lobby page
    const params = new URLSearchParams(window.location.search);
    const returnUrl = params.get('returnUrl');
    if (returnUrl) {
        window.location.href = returnUrl;
        return;
    }

    // Fallback: construct portal origin and go to home
    const portalOrigin = window.location.port === '3000'
        ? window.location.origin
        : `${window.location.protocol}//${window.location.hostname}:3000`;
    window.location.href = portalOrigin;
}

/** Returns true if the menu is currently open */
export function isGameMenuOpen() {
    return _isOpen;
}
