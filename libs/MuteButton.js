/**
 * @module MuteButton
 * Persistent mute/unmute button in the game HUD.
 */
import { toggleMute, isMuted } from './Sound.js';

let btn = null;

const SPEAKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
const MUTED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;

function updateIcon() {
    if (!btn) return;
    btn.innerHTML = isMuted() ? MUTED_SVG : SPEAKER_SVG;
    btn.title = isMuted() ? 'Unmute (M)' : 'Mute (M)';
    btn.style.opacity = isMuted() ? '0.5' : '0.8';
}

/**
 * Creates the mute button element.
 */
export function initMuteButton() {
    btn = document.createElement('button');
    btn.style.cssText = 'position:absolute; top:12px; right:12px; z-index:200; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.2); border-radius:6px; color:#fff; cursor:pointer; padding:6px; line-height:0; transition:opacity 0.2s;';
    btn.addEventListener('click', () => {
        toggleMute();
        updateIcon();
    });
    updateIcon();
    document.body.appendChild(btn);
}

/**
 * Syncs the button icon with current mute state (call after external mute toggle).
 */
export function syncMuteButton() {
    updateIcon();
}
