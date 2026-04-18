/**
 * @module ChatUI
 * In-game chat window for multiplayer mode.
 * Press T to focus, Enter to send, Esc to blur.
 * Supports @PlayerName whispers (private messages).
 */
import { eventBus } from '@jazaix/jx-sdk';
import { getPlayerNames } from './PlayerList.js';

const MAX_MESSAGES = 50;

let container = null;
let messageArea = null;
let input = null;
let networkManager = null;
let messages = [];
let mobileToggle = null;

// Autocomplete state
let autocompleteEl = null;
let autocompleteCandidates = [];
let autocompleteIndex = -1;

/**
 * Deterministic color from entity ID (matches RemotePlayer HSL formula).
 */
function nameColor(entityId) {
    const hue = ((entityId * 137.508) % 360);
    return `hsl(${Math.round(hue)}, 70%, 65%)`;
}

/**
 * Escape HTML to prevent XSS in chat messages.
 */
function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Initialize the chat UI. Only call in multiplayer mode.
 * @param {import('./network/NetworkManager.js').NetworkManager} nm
 */
export function initChatUI(nm) {
    networkManager = nm;

    // Container
    container = document.createElement('div');
    container.id = 'chat-ui';
    container.style.cssText = [
        'position:absolute',
        'top:60px',
        'left:10px',
        'width:260px',
        'z-index:100',
        'pointer-events:auto',
        'font:12px monospace',
        'display:flex',
        'flex-direction:column',
        'max-height:220px',
    ].join(';');
    document.body.appendChild(container);

    // Message area
    messageArea = document.createElement('div');
    messageArea.style.cssText = [
        'flex:1',
        'overflow-y:auto',
        'padding:4px 6px',
        'background:transparent',
        'border-radius:6px 6px 0 0',
        'max-height:170px',
        'scrollbar-width:thin',
        'transition:background 0.2s ease',
    ].join(';');
    container.appendChild(messageArea);

    // Autocomplete dropdown (positioned above input)
    autocompleteEl = document.createElement('div');
    autocompleteEl.style.cssText = [
        'display:none',
        'background:rgba(20,20,30,0.95)',
        'border:1px solid rgba(255,255,255,0.2)',
        'border-radius:4px',
        'max-height:100px',
        'overflow-y:auto',
        'font:12px monospace',
        'scrollbar-width:thin',
    ].join(';');
    container.appendChild(autocompleteEl);

    // Input bar (hidden by default, shown on hover/focus)
    input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 200;
    input.placeholder = 'T to chat, @name to whisper...';
    input.style.cssText = [
        'width:100%',
        'box-sizing:border-box',
        'padding:4px 6px',
        'background:rgba(0,0,0,0.5)',
        'border:1px solid rgba(255,255,255,0.15)',
        'border-radius:0 0 6px 6px',
        'color:#fff',
        'font:12px monospace',
        'outline:none',
        'opacity:0',
        'height:0',
        'padding:0',
        'border:none',
        'transition:all 0.2s ease',
        'overflow:hidden',
    ].join(';');
    container.appendChild(input);

    // Hover behavior: show background + input on hover, hide when idle
    const showChat = () => {
        messageArea.style.background = 'rgba(0,0,0,0.35)';
        input.style.opacity = '1';
        input.style.height = 'auto';
        input.style.padding = '4px 6px';
        input.style.border = '1px solid rgba(255,255,255,0.15)';
    };
    const hideChat = () => {
        // Don't hide if input is focused
        if (document.activeElement === input) return;
        messageArea.style.background = 'transparent';
        input.style.opacity = '0';
        input.style.height = '0';
        input.style.padding = '0';
        input.style.border = 'none';
    };
    container.addEventListener('mouseenter', showChat);
    container.addEventListener('mouseleave', hideChat);
    input.addEventListener('focus', showChat);
    input.addEventListener('blur', hideChat);

    // Prevent game keys (WASD, space, etc.) while typing
    input.addEventListener('keydown', (e) => {
        e.stopPropagation();

        // Autocomplete navigation
        if (autocompleteEl.style.display !== 'none') {
            if (e.key === 'Tab' || e.key === 'ArrowDown') {
                e.preventDefault();
                autocompleteIndex = (autocompleteIndex + 1) % autocompleteCandidates.length;
                renderAutocomplete();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                autocompleteIndex = (autocompleteIndex - 1 + autocompleteCandidates.length) % autocompleteCandidates.length;
                renderAutocomplete();
                return;
            }
            if (e.key === 'Enter' && autocompleteIndex >= 0) {
                e.preventDefault();
                acceptAutocomplete();
                return;
            }
        }

        if (e.key === 'Enter') {
            const text = input.value.trim();
            if (text && networkManager) {
                // Check for @mention whisper pattern
                const whisperMatch = text.match(/^@(\S+)\s+(.+)$/);
                if (whisperMatch) {
                    const targetName = whisperMatch[1];
                    const whisperText = whisperMatch[2];

                    // Validate target exists in known players before sending
                    const names = getPlayerNames();
                    const found = [...names.values()].some(
                        n => n.toLowerCase() === targetName.toLowerCase()
                    );
                    if (!found) {
                        addMessage({ type: 'system', text: `Player "${targetName}" not found` });
                    } else {
                        networkManager.sendWhisperMessage(targetName, whisperText);
                        // Show local echo immediately (server echo may arrive later)
                        addMessage({ type: 'whisper', senderName: targetName, text: whisperText, direction: 1 });
                    }
                } else {
                    networkManager.sendChatMessage(text);
                }
            }
            input.value = '';
            hideAutocomplete();
        } else if (e.key === 'Escape') {
            input.value = '';
            input.blur();
            hideAutocomplete();
        }
    });

    // Autocomplete on input change
    input.addEventListener('input', () => {
        updateAutocomplete();
    });

    // Global T key to focus chat (also reveals it)
    window.addEventListener('keydown', (e) => {
        if (e.key === 't' && document.activeElement !== input) {
            e.preventDefault();
            showChat();
            input.focus();
        }
    });

    // Listen for chat messages from server
    eventBus.on('chat:message', (data) => {
        addMessage({ type: 'chat', senderId: data.senderId, senderName: data.senderName, text: data.text });
    });

    // Listen for whisper messages from server
    // direction=0: incoming whisper (from another player to us)
    // direction=1: echo (server confirming our whisper was delivered) — skip since we show local echo
    eventBus.on('chat:whisper', (data) => {
        if (data.direction === 1) return; // Already shown as local echo
        addMessage({ type: 'whisper', senderName: data.senderName, text: data.text, direction: data.direction });
    });

    // Listen for chat history on join (prepend buffered messages)
    eventBus.on('chat:history', (data) => {
        if (!data.messages || data.messages.length === 0) return;
        const historyMsgs = data.messages.map(m => ({
            type: 'chat',
            senderId: m.senderId,
            senderName: m.senderName,
            text: m.text,
        }));
        messages = [...historyMsgs, ...messages];
        if (messages.length > MAX_MESSAGES) {
            messages = messages.slice(messages.length - MAX_MESSAGES);
        }
        renderMessages();
    });

    // Mobile toggle button
    const isMobile = 'ontouchstart' in window;
    if (isMobile) {
        container.style.display = 'none';
        mobileToggle = document.createElement('button');
        mobileToggle.textContent = '\u{1F4AC}';
        mobileToggle.style.cssText = [
            'position:absolute',
            'top:60px',
            'left:10px',
            'z-index:101',
            'background:rgba(0,0,0,0.5)',
            'border:1px solid rgba(255,255,255,0.2)',
            'border-radius:6px',
            'color:#fff',
            'font-size:18px',
            'padding:4px 8px',
            'cursor:pointer',
        ].join(';');
        mobileToggle.addEventListener('click', () => {
            const showing = container.style.display !== 'none';
            container.style.display = showing ? 'none' : 'flex';
        });
        document.body.appendChild(mobileToggle);
    }
}

function addMessage(msg) {
    messages.push(msg);
    if (messages.length > MAX_MESSAGES) messages.shift();
    renderMessages();
}

function renderMessages() {
    if (!messageArea) return;
    let html = '';
    for (const msg of messages) {
        if (msg.type === 'system') {
            // System/error messages in yellow
            html += `<div style="margin-bottom:2px;word-wrap:break-word;color:#f59e0b;font-style:italic;font-size:11px;">`;
            html += escapeHtml(msg.text);
            html += `</div>`;
        } else if (msg.type === 'whisper') {
            // Purple italic styling for whispers
            const prefix = msg.direction === 1
                ? `<span style="color:#c084fc;font-style:italic;">[To ${escapeHtml(msg.senderName)}]</span>`
                : `<span style="color:#c084fc;font-style:italic;">[From ${escapeHtml(msg.senderName)}]</span>`;
            html += `<div style="margin-bottom:2px;word-wrap:break-word;">`;
            html += `${prefix} <span style="color:#c084fc;font-style:italic;">${escapeHtml(msg.text)}</span>`;
            html += `</div>`;
        } else {
            const color = nameColor(msg.senderId);
            html += `<div style="margin-bottom:2px;word-wrap:break-word;">`;
            html += `<span style="color:${color};font-weight:bold;">${escapeHtml(msg.senderName)}</span>`;
            html += `<span style="color:rgba(255,255,255,0.85);">: ${escapeHtml(msg.text)}</span>`;
            html += `</div>`;
        }
    }
    messageArea.innerHTML = html;
    messageArea.scrollTop = messageArea.scrollHeight;
}

// ─── Autocomplete ──────────────────────────────────────────────

function updateAutocomplete() {
    const val = input.value;
    // Detect @partial at the start or after a space
    const match = val.match(/@(\S*)$/);
    if (!match) {
        hideAutocomplete();
        return;
    }

    const partial = match[1].toLowerCase();
    const names = getPlayerNames();
    autocompleteCandidates = [];

    for (const [, name] of names) {
        if (name.toLowerCase().startsWith(partial)) {
            autocompleteCandidates.push(name);
        }
    }

    if (autocompleteCandidates.length === 0) {
        hideAutocomplete();
        return;
    }

    // Cap at 6 results
    autocompleteCandidates = autocompleteCandidates.slice(0, 6);
    autocompleteIndex = 0;
    renderAutocomplete();
    autocompleteEl.style.display = 'block';
}

function renderAutocomplete() {
    if (!autocompleteEl) return;
    let html = '';
    for (let i = 0; i < autocompleteCandidates.length; i++) {
        const name = autocompleteCandidates[i];
        const bg = i === autocompleteIndex ? 'rgba(192,132,252,0.3)' : 'transparent';
        html += `<div style="padding:3px 8px;cursor:pointer;color:#fff;background:${bg};" data-idx="${i}">@${escapeHtml(name)}</div>`;
    }
    autocompleteEl.innerHTML = html;

    // Click handler for autocomplete items
    for (const el of autocompleteEl.children) {
        el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            autocompleteIndex = parseInt(el.dataset.idx);
            acceptAutocomplete();
        });
    }
}

function acceptAutocomplete() {
    if (autocompleteIndex < 0 || autocompleteIndex >= autocompleteCandidates.length) return;
    const name = autocompleteCandidates[autocompleteIndex];
    // Replace the @partial with @name
    const val = input.value;
    const match = val.match(/@(\S*)$/);
    if (match) {
        input.value = val.substring(0, match.index) + '@' + name + ' ';
    }
    hideAutocomplete();
    input.focus();
}

function hideAutocomplete() {
    if (autocompleteEl) autocompleteEl.style.display = 'none';
    autocompleteCandidates = [];
    autocompleteIndex = -1;
}
