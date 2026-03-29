/**
 * @module lobby
 * Server browser / lobby page for Crawlr multiplayer.
 * Lists available servers, shows player counts, Quick Join, and server details.
 */

import { ADMIN_API_URL } from './libs/PhysicsConfig.js';

const WS_RECONNECT_DELAY = 3000;
const HTTP_FALLBACK_POLL = 5000;

let playerName = localStorage.getItem('crawlr_player_name') || '';
let currentView = playerName ? 'servers' : 'name'; // 'name' | 'servers' | 'detail' | 'waiting'
let servers = [];
let selectedServer = null;
let ws = null;
let wsReconnectTimer = null;
let httpFallbackTimer = null;

// ── Boot ─────────────────────────────────────────────────────────────────

init();

function init() {
    // Load font
    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap';
    document.head.appendChild(fontLink);

    injectStyles();
    render();

    if (currentView === 'servers') {
        connectWebSocket();
    }
}

// ── WebSocket ────────────────────────────────────────────────────────────

function connectWebSocket() {
    if (ws && ws.readyState <= WebSocket.OPEN) return;

    // Derive WS URL from admin API URL (http→ws, https→wss)
    const wsUrl = ADMIN_API_URL.replace(/^http/, 'ws') + '/api/lobby/ws';
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('Lobby WS connected');
        stopHttpFallback();
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (Array.isArray(data)) {
                servers = data;
                updateServerListUI();
            }
        } catch (e) {
            console.warn('Lobby WS parse error:', e);
        }
    };

    ws.onclose = () => {
        console.log('Lobby WS disconnected, reconnecting...');
        ws = null;
        startHttpFallback(); // fall back to HTTP polling while reconnecting
        wsReconnectTimer = setTimeout(connectWebSocket, WS_RECONNECT_DELAY);
    };

    ws.onerror = () => {
        // onclose will fire next, which handles reconnect
    };
}

function disconnectWebSocket() {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    stopHttpFallback();
    if (ws) { ws.close(); ws = null; }
}

function startHttpFallback() {
    if (httpFallbackTimer) return;
    httpFallbackTimer = setInterval(fetchServersHttp, HTTP_FALLBACK_POLL);
}

function stopHttpFallback() {
    if (httpFallbackTimer) { clearInterval(httpFallbackTimer); httpFallbackTimer = null; }
}

/** Update the server list UI without re-rendering the whole page */
function updateServerListUI() {
    if (currentView === 'servers') {
        const listEl = document.getElementById('lobby-server-list');
        if (listEl) {
            listEl.innerHTML = servers.length === 0
                ? '<p class="lobby-empty">No servers found. Click Quick Join to create one!</p>'
                : servers.map(s => renderServerCard(s)).join('');
            bindServerCardEvents();
        } else {
            renderServerList();
        }
    } else if (currentView === 'waiting' && selectedServer) {
        // Check if a slot opened on the server we're waiting for
        const updated = servers.find(s => s.server_id === selectedServer.server_id);
        if (updated && updated.player_count < updated.max_players) {
            joinServer(selectedServer.server_id);
        }
    }
}

// ── API ──────────────────────────────────────────────────────────────────

async function fetchServersHttp() {
    try {
        const res = await fetch(`${ADMIN_API_URL}/api/lobby/servers`);
        servers = await res.json();
        updateServerListUI();
    } catch (e) {
        console.warn('Failed to fetch servers:', e);
    }
}

async function fetchServerDetail(serverId) {
    try {
        const res = await fetch(`${ADMIN_API_URL}/api/lobby/servers/${serverId}`);
        return await res.json();
    } catch (e) {
        console.warn('Failed to fetch server detail:', e);
        return null;
    }
}

async function quickJoin() {
    try {
        const res = await fetch(`${ADMIN_API_URL}/api/lobby/quickjoin`);
        const data = await res.json();
        joinServer(data.server_id);
    } catch (e) {
        console.warn('Quick join failed:', e);
    }
}

function joinServer(serverId) {
    window.location.href = `/index.html?mode=multiplayer&room=${encodeURIComponent(serverId)}`;
}


// ── Views ────────────────────────────────────────────────────────────────

function render() {
    const root = document.getElementById('lobby-root');
    if (root) root.remove();

    const div = document.createElement('div');
    div.id = 'lobby-root';
    div.className = 'lobby-overlay';
    document.body.appendChild(div);

    switch (currentView) {
        case 'name': renderNameEntry(div); break;
        case 'servers': renderServerList(div); break;
        case 'detail': renderServerDetail(div); break;
        case 'waiting': renderWaiting(div); break;
    }
}

function renderNameEntry(container) {
    container = container || document.getElementById('lobby-root');
    container.innerHTML = `
        <div class="lobby-card lobby-card--narrow lobby-fade-up">
            <div class="lobby-character">
                <div class="lobby-char-body">
                    <div class="lobby-char-eye lobby-char-eye--left"><div class="lobby-char-pupil"></div></div>
                    <div class="lobby-char-eye lobby-char-eye--right"><div class="lobby-char-pupil"></div></div>
                    <div class="lobby-char-mouth"></div>
                </div>
                <div class="lobby-char-tail">
                    <div class="lobby-char-tail-seg"></div>
                    <div class="lobby-char-tail-seg"></div>
                    <div class="lobby-char-tail-seg"></div>
                </div>
            </div>
            <h1 class="lobby-title">CRAWLR</h1>
            <p class="lobby-subtitle">Enter your name to get started</p>
            <input id="lobby-name-input" class="lobby-input" type="text" placeholder="Your name..." maxlength="16" value="${playerName}" autofocus>
            <button id="lobby-name-btn" class="lobby-btn lobby-btn--primary">Continue</button>
        </div>
    `;

    const input = document.getElementById('lobby-name-input');
    const btn = document.getElementById('lobby-name-btn');

    const submit = () => {
        const name = input.value.trim();
        if (!name) return;
        playerName = name;
        localStorage.setItem('crawlr_player_name', name);
        currentView = 'servers';
        render();
        connectWebSocket();
    };

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    input.focus();
}

function renderServerList(container) {
    container = container || document.getElementById('lobby-root');
    container.innerHTML = `
        <div class="lobby-card lobby-fade-up">
            <div class="lobby-header">
                <div>
                    <h1 class="lobby-title">CRAWLR</h1>
                    <p class="lobby-welcome">Welcome, ${playerName}!</p>
                </div>
                <button id="lobby-quick-join" class="lobby-btn lobby-btn--accent">Quick Join</button>
            </div>
            <div id="lobby-server-list" class="lobby-server-list">
                ${servers.length === 0
                    ? '<p class="lobby-empty">No servers found. Click Quick Join to create one!</p>'
                    : servers.map(s => renderServerCard(s)).join('')
                }
            </div>
            <div class="lobby-footer">
                <button id="lobby-solo-btn" class="lobby-btn lobby-btn--secondary">Play Solo</button>
                <button id="lobby-change-name" class="lobby-btn lobby-btn--link">Change Name</button>
            </div>
        </div>
    `;

    document.getElementById('lobby-quick-join').addEventListener('click', quickJoin);
    document.getElementById('lobby-solo-btn').addEventListener('click', () => {
        window.location.href = '/index.html';
    });
    document.getElementById('lobby-change-name').addEventListener('click', () => {
        currentView = 'name';
        disconnectWebSocket();
        render();
    });

    bindServerCardEvents();
}

function bindServerCardEvents() {
    const root = document.getElementById('lobby-root');
    if (!root) return;

    root.querySelectorAll('.lobby-server-card').forEach(card => {
        const sid = card.dataset.serverId;
        const joinBtn = card.querySelector('.lobby-join-btn');
        const detailBtn = card.querySelector('.lobby-detail-btn');

        if (joinBtn) {
            joinBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isFull = card.dataset.full === 'true';
                if (isFull) {
                    selectedServer = servers.find(s => s.server_id === sid);
                    currentView = 'waiting';
                    render();
                } else {
                    joinServer(sid);
                }
            });
        }
        if (detailBtn) {
            detailBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showDetail(sid);
            });
        }
    });
}

function renderServerCard(s) {
    const isFull = s.player_count >= s.max_players;
    const pct = Math.round((s.player_count / s.max_players) * 100);
    const previewNames = (s.preview_names || []).slice(0, 3);
    const extra = s.human_count > 3 ? ` +${s.human_count - 3} more` : '';

    return `
        <div class="lobby-server-card${isFull ? ' lobby-server-card--full' : ''}" data-server-id="${s.server_id}" data-full="${isFull}">
            <div class="lobby-server-top">
                <div class="lobby-server-name">${escapeHtml(s.name)}</div>
                <div class="lobby-server-count">${s.player_count}/${s.max_players}</div>
            </div>
            <div class="lobby-progress-bar">
                <div class="lobby-progress-fill" style="width:${pct}%"></div>
            </div>
            <div class="lobby-server-bottom">
                <span class="lobby-server-players">${previewNames.map(escapeHtml).join(', ')}${extra}</span>
                <div class="lobby-server-actions">
                    <button class="lobby-detail-btn" title="Details">&#9432;</button>
                    <button class="lobby-join-btn lobby-btn lobby-btn--small${isFull ? ' lobby-btn--disabled' : ''}">${isFull ? 'FULL' : 'Join'}</button>
                </div>
            </div>
        </div>
    `;
}

async function showDetail(serverId) {
    selectedServer = await fetchServerDetail(serverId);
    if (!selectedServer) return;
    currentView = 'detail';
    render();
}

function renderServerDetail(container) {
    container = container || document.getElementById('lobby-root');
    const s = selectedServer;
    if (!s) { currentView = 'servers'; render(); return; }

    const isFull = s.player_count >= s.max_players;
    const humans = (s.players || []).filter(p => !p.is_bot);
    const bots = (s.players || []).filter(p => p.is_bot);

    container.innerHTML = `
        <div class="lobby-card lobby-fade-up">
            <div class="lobby-header">
                <button id="lobby-back" class="lobby-btn lobby-btn--link">&larr; Back</button>
                <h2 class="lobby-title">${escapeHtml(s.display_name || s.name || s.room_id)}</h2>
            </div>
            <p class="lobby-subtitle">${s.player_count}/${s.max_players} players &middot; ${s.state}</p>
            ${humans.length > 0 ? `
                <h3 class="lobby-section-title">Players</h3>
                <div class="lobby-player-list">
                    ${humans.map(p => `
                        <div class="lobby-player-row">
                            <span class="lobby-player-name">${escapeHtml(p.display_name)}</span>
                            <span class="lobby-player-score">${p.score} pts</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            ${bots.length > 0 ? `
                <h3 class="lobby-section-title">Bots (${bots.length})</h3>
                <div class="lobby-player-list lobby-player-list--bots">
                    ${bots.map(p => `
                        <div class="lobby-player-row lobby-player-row--bot">
                            <span class="lobby-player-name">${escapeHtml(p.display_name)}</span>
                            <span class="lobby-player-score">${p.score} pts</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            <div class="lobby-footer">
                <button id="lobby-detail-join" class="lobby-btn lobby-btn--primary${isFull ? ' lobby-btn--disabled' : ''}">${isFull ? 'Server Full' : 'Join Server'}</button>
            </div>
        </div>
    `;

    document.getElementById('lobby-back').addEventListener('click', () => {
        currentView = 'servers';
        render();
        updateServerListUI(); // refresh from cached data
    });

    const joinBtn = document.getElementById('lobby-detail-join');
    if (!isFull) {
        joinBtn.addEventListener('click', () => joinServer(s.room_id));
    }
}

function renderWaiting(container) {
    container = container || document.getElementById('lobby-root');
    const s = selectedServer;
    const name = s ? (s.name || s.display_name || s.server_id) : 'Server';

    container.innerHTML = `
        <div class="lobby-card lobby-card--narrow lobby-fade-up">
            <h2 class="lobby-title">${escapeHtml(name)}</h2>
            <p class="lobby-subtitle">Server is full. Waiting for a spot...</p>
            <div class="lobby-spinner"></div>
            <div class="lobby-footer">
                <button id="lobby-wait-back" class="lobby-btn lobby-btn--secondary">Back to Servers</button>
                <button id="lobby-wait-quick" class="lobby-btn lobby-btn--accent">Quick Join Another</button>
            </div>
        </div>
    `;

    document.getElementById('lobby-wait-back').addEventListener('click', () => {
        currentView = 'servers';
        render();
        updateServerListUI();
    });
    document.getElementById('lobby-wait-quick').addEventListener('click', quickJoin);

    // Slot checking is handled by updateServerListUI() via WS push
}

// ── Helpers ──────────────────────────────────────────────────────────────

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// ── Styles ───────────────────────────────────────────────────────────────

function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Fredoka', sans-serif;
            background: linear-gradient(180deg, #87CEEB 0%, #a8d8ea 40%, #5A9A3C 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .lobby-overlay {
            width: 100%;
            max-width: 600px;
            padding: 20px;
        }

        .lobby-card {
            background: rgba(255,255,255,0.95);
            border-radius: 20px;
            padding: 32px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.12);
        }
        .lobby-card--narrow { max-width: 400px; margin: 0 auto; text-align: center; }

        .lobby-fade-up {
            animation: lobby-fade-up 0.4s ease-out;
        }
        @keyframes lobby-fade-up {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .lobby-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
        }

        .lobby-title {
            font-size: 28px;
            font-weight: 700;
            color: #3a3a3a;
            letter-spacing: 2px;
        }
        .lobby-welcome {
            font-size: 14px;
            color: #777;
            margin-top: 2px;
        }
        .lobby-subtitle {
            font-size: 14px;
            color: #888;
            margin-bottom: 16px;
        }
        .lobby-section-title {
            font-size: 14px;
            color: #666;
            margin: 16px 0 8px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .lobby-empty {
            text-align: center;
            color: #aaa;
            padding: 40px 0;
            font-size: 15px;
        }

        /* Buttons */
        .lobby-btn {
            font-family: 'Fredoka', sans-serif;
            font-size: 15px;
            font-weight: 600;
            border: none;
            border-radius: 12px;
            padding: 10px 20px;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .lobby-btn:hover { transform: scale(1.04); }
        .lobby-btn:active { transform: scale(0.97); }

        .lobby-btn--primary {
            background: linear-gradient(135deg, #66BB6A, #43A047);
            color: #fff;
            box-shadow: 0 3px 10px rgba(76,175,80,0.3);
        }
        .lobby-btn--accent {
            background: linear-gradient(135deg, #42A5F5, #1E88E5);
            color: #fff;
            box-shadow: 0 3px 10px rgba(33,150,243,0.3);
        }
        .lobby-btn--secondary {
            background: #f0f0f0;
            color: #555;
        }
        .lobby-btn--link {
            background: none;
            color: #888;
            padding: 6px 10px;
            font-size: 13px;
        }
        .lobby-btn--link:hover { color: #555; }
        .lobby-btn--small {
            font-size: 13px;
            padding: 6px 14px;
            border-radius: 8px;
        }
        .lobby-btn--disabled {
            opacity: 0.5;
            cursor: default;
            pointer-events: none;
        }

        /* Input */
        .lobby-input {
            font-family: 'Fredoka', sans-serif;
            width: 100%;
            font-size: 18px;
            padding: 12px 16px;
            border: 2px solid #e0e0e0;
            border-radius: 12px;
            outline: none;
            margin-bottom: 16px;
            text-align: center;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .lobby-input:focus {
            border-color: #4CAF50;
            box-shadow: 0 0 0 3px rgba(76,175,80,0.2);
        }

        /* Server list */
        .lobby-server-list {
            max-height: 400px;
            overflow-y: auto;
            margin: 8px 0 16px;
        }

        .lobby-server-card {
            border: 2px solid #e8e8e8;
            border-radius: 14px;
            padding: 14px 16px;
            margin-bottom: 10px;
            transition: border-color 0.15s, box-shadow 0.15s;
            cursor: default;
        }
        .lobby-server-card:hover {
            border-color: #ccc;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .lobby-server-card--full {
            border-color: #f5c6cb;
            background: #fff5f5;
        }

        .lobby-server-top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
        }
        .lobby-server-name {
            font-weight: 600;
            font-size: 16px;
            color: #3a3a3a;
        }
        .lobby-server-count {
            font-size: 14px;
            color: #888;
            font-weight: 600;
        }

        .lobby-progress-bar {
            height: 6px;
            background: #eee;
            border-radius: 3px;
            overflow: hidden;
            margin-bottom: 8px;
        }
        .lobby-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #66BB6A, #43A047);
            border-radius: 3px;
            transition: width 0.3s ease;
        }
        .lobby-server-card--full .lobby-progress-fill {
            background: linear-gradient(90deg, #ef5350, #e53935);
        }

        .lobby-server-bottom {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .lobby-server-players {
            font-size: 13px;
            color: #999;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
            margin-right: 8px;
        }
        .lobby-server-actions {
            display: flex;
            gap: 6px;
            align-items: center;
        }
        .lobby-detail-btn {
            background: none;
            border: none;
            font-size: 18px;
            cursor: pointer;
            color: #aaa;
            padding: 2px 6px;
            transition: color 0.15s;
        }
        .lobby-detail-btn:hover { color: #555; }

        /* Player list */
        .lobby-player-list {
            border: 1px solid #eee;
            border-radius: 10px;
            max-height: 200px;
            overflow-y: auto;
        }
        .lobby-player-list--bots { opacity: 0.7; }
        .lobby-player-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 14px;
            border-bottom: 1px solid #f5f5f5;
            font-size: 14px;
        }
        .lobby-player-row:last-child { border-bottom: none; }
        .lobby-player-row--bot { font-style: italic; }
        .lobby-player-name { color: #3a3a3a; }
        .lobby-player-score { color: #999; font-size: 13px; }

        .lobby-footer {
            display: flex;
            justify-content: center;
            gap: 12px;
            margin-top: 16px;
        }

        /* Spinner */
        .lobby-spinner {
            width: 40px; height: 40px;
            border: 4px solid #eee;
            border-top-color: #42A5F5;
            border-radius: 50%;
            margin: 20px auto;
            animation: lobby-spin 0.8s linear infinite;
        }
        @keyframes lobby-spin {
            to { transform: rotate(360deg); }
        }

        /* Character (reuse StartScreen style) */
        .lobby-character {
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 16px;
        }
        .lobby-char-body {
            width: 60px; height: 60px;
            background: linear-gradient(135deg, #66BB6A, #4CAF50);
            border-radius: 14px;
            position: relative;
            animation: lobby-bounce 2s ease-in-out infinite;
        }
        @keyframes lobby-bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-8px); }
        }
        .lobby-char-eye {
            position: absolute;
            width: 14px; height: 14px;
            background: #fff;
            border-radius: 50%;
            top: 14px;
        }
        .lobby-char-eye--left { left: 12px; }
        .lobby-char-eye--right { right: 12px; }
        .lobby-char-pupil {
            width: 7px; height: 7px;
            background: #333;
            border-radius: 50%;
            margin: 3px auto 0;
        }
        .lobby-char-mouth {
            position: absolute;
            bottom: 12px;
            left: 50%;
            transform: translateX(-50%);
            width: 16px; height: 4px;
            border-bottom: 2px solid rgba(0,0,0,0.25);
            border-radius: 0 0 8px 8px;
        }
        .lobby-char-tail {
            display: flex;
            gap: 4px;
            margin-left: 4px;
        }
        .lobby-char-tail-seg {
            width: 14px; height: 14px;
            background: linear-gradient(135deg, #A0D468, #8CC152);
            border-radius: 6px;
            animation: lobby-tail-wiggle 1.5s ease-in-out infinite;
        }
        .lobby-char-tail-seg:nth-child(2) { animation-delay: 0.15s; width: 12px; height: 12px; }
        .lobby-char-tail-seg:nth-child(3) { animation-delay: 0.3s; width: 10px; height: 10px; }
        @keyframes lobby-tail-wiggle {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-3px); }
        }
    `;
    document.head.appendChild(style);
}
