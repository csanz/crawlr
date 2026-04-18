/**
 * @module Leaderboard
 * Persistent all-time leaderboard tracking multiple stats across sessions.
 * Categories: Biggest Size, Most Kills, Highest Coins, Longest Tail.
 * In multiplayer: adds a "Live" tab showing real-time player rankings from snapshots.
 * Toggle with L key.
 */
import { eventBus } from '@jazaix/jx-sdk';

const STORAGE_KEY = 'crawlr_records';
const MAX_ENTRIES = 10;

let overlay = null;
let contentEl = null;
let activeTab = 'size';
let playerName = '';

// Current session tracking
const session = {
    maxSize: 1.0,
    kills: 0,
    coins: 0,
    maxTail: 0
};

// Callbacks for live stats
let getStatsFn = null;

// Network mode refs for live tab
let networkManager = null;
let isMultiplayer = false;
let liveRefreshInterval = null;

const TABS = [
    { key: 'size', label: 'Biggest', icon: '\u2b24', field: 'maxSize', format: v => v.toFixed(1) + 'x' },
    { key: 'kills', label: 'Kills', icon: '\u2620', field: 'kills', format: v => String(v) },
    { key: 'coins', label: 'Coins', icon: '\u25cf', field: 'coins', format: v => String(v) },
    { key: 'tail', label: 'Tail', icon: '\u2501', field: 'maxTail', format: v => String(v) }
];

/**
 * Initializes the leaderboard system.
 * @param {function} getStats - Returns { coins, tailLength, size }
 * @param {string} name - Player display name
 */
export function initLeaderboard(getStats, name) {
    getStatsFn = getStats;
    playerName = name || 'You';

    createOverlay();
    setupEventListeners();

    // Save on page close
    window.addEventListener('beforeunload', () => saveSession());
}

/**
 * Update player name (called if name changes).
 */
export function setLeaderboardName(name) {
    playerName = name;
}

/**
 * Enable the Live tab for multiplayer mode.
 * @param {import('./network/NetworkManager.js').NetworkManager} nm
 */
export function setLeaderboardNetworkManager(nm) {
    networkManager = nm;
    isMultiplayer = true;
    activeTab = 'live';

    // Unhide the live tab button
    const liveBtn = overlay?.querySelector('[data-tab="live"]');
    if (liveBtn) liveBtn.style.display = '';
}

function setupEventListeners() {
    // Track kills
    eventBus.on('entity:died', (payload) => {
        if (payload.killedBy === 'player') {
            session.kills++;
        }
        // Reset session peaks on player death
        if (payload.id === 'player') {
            saveSession();
            session.maxSize = 1.0;
            session.kills = 0;
            session.coins = 0;
            session.maxTail = 0;
        }
    });

    // Track coin collection via score:changed events
    eventBus.on('score:changed', (payload) => {
        if (!payload || payload.entityId !== 'player') return;
        session.coins = payload.coins;
    });
}

/**
 * Call each frame to update peak tracking.
 */
export function updateLeaderboardStats() {
    if (!getStatsFn) return;
    const stats = getStatsFn();
    if (stats.size > session.maxSize) session.maxSize = stats.size;
    if (stats.tailLength > session.maxTail) session.maxTail = stats.tailLength;
    session.coins = stats.coins;
}

function getRecords() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch { return []; }
}

function saveSession() {
    if (!getStatsFn) return;
    const stats = getStatsFn();

    // Update peaks one last time
    if (stats.size > session.maxSize) session.maxSize = stats.size;
    if (stats.tailLength > session.maxTail) session.maxTail = stats.tailLength;
    session.coins = stats.coins;

    // Only save if there's something meaningful
    if (session.maxSize <= 1.0 && session.kills === 0 && session.coins === 0 && session.maxTail === 0) return;

    const records = getRecords();
    records.push({
        name: playerName,
        maxSize: Math.round(session.maxSize * 10) / 10,
        kills: session.kills,
        coins: session.coins,
        maxTail: session.maxTail,
        date: new Date().toLocaleDateString()
    });

    // Keep only top entries per category (deduplicate by keeping best overall)
    if (records.length > MAX_ENTRIES * 4) {
        // Keep entries that appear in top 10 of any category
        const keep = new Set();
        for (const tab of TABS) {
            const sorted = [...records].sort((a, b) => (b[tab.field] || 0) - (a[tab.field] || 0));
            sorted.slice(0, MAX_ENTRIES).forEach((_, i) => keep.add(records.indexOf(sorted[i]) >= 0 ? sorted[i] : null));
        }
        // Fallback: just keep last 40
        records.length = Math.min(records.length, MAX_ENTRIES * 4);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function createOverlay() {
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; inset:0; z-index:9999; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,0.7);';

    const box = document.createElement('div');
    box.style.cssText = 'background:rgba(20,20,30,0.95); border:1px solid rgba(255,255,255,0.15); border-radius:12px; padding:24px 32px; min-width:300px; max-width:400px; font-family:monospace; color:#fff;';

    const title = document.createElement('div');
    title.textContent = 'Leaderboard';
    title.style.cssText = 'font-size:16px; font-weight:bold; margin-bottom:12px; color:#ffcc00; text-align:center;';
    box.appendChild(title);

    // Tab bar
    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex; gap:4px; margin-bottom:16px;';
    tabBar.id = 'lb-tabs';

    // Live tab (hidden until multiplayer is activated)
    const liveBtn = document.createElement('button');
    liveBtn.textContent = '\u25b6 Live';
    liveBtn.dataset.tab = 'live';
    liveBtn.style.cssText = 'flex:1; padding:6px 4px; border:none; border-radius:6px; font:11px monospace; cursor:pointer; transition:background 0.2s, color 0.2s; display:none;';
    liveBtn.addEventListener('click', () => {
        activeTab = 'live';
        renderContent();
        updateTabStyles(tabBar);
    });
    tabBar.appendChild(liveBtn);

    for (const tab of TABS) {
        const btn = document.createElement('button');
        btn.textContent = `${tab.icon} ${tab.label}`;
        btn.dataset.tab = tab.key;
        btn.style.cssText = 'flex:1; padding:6px 4px; border:none; border-radius:6px; font:11px monospace; cursor:pointer; transition:background 0.2s, color 0.2s;';
        btn.addEventListener('click', () => {
            activeTab = tab.key;
            renderContent();
            updateTabStyles(tabBar);
        });
        tabBar.appendChild(btn);
    }

    box.appendChild(tabBar);

    contentEl = document.createElement('div');
    box.appendChild(contentEl);

    const footer = document.createElement('div');
    footer.textContent = 'Press L or Esc to close';
    footer.style.cssText = 'margin-top:16px; font-size:10px; color:rgba(255,255,255,0.3); text-align:center;';
    box.appendChild(footer);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) hideOverlay();
    });

    window.addEventListener('keydown', (e) => {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (e.key.toLowerCase() === 'l') {
            toggleLeaderboard();
        } else if (e.key === 'Escape' && overlay.style.display === 'flex') {
            hideOverlay();
        }
    });
}

function hideOverlay() {
    if (!overlay) return;
    overlay.style.display = 'none';
    if (liveRefreshInterval) {
        clearInterval(liveRefreshInterval);
        liveRefreshInterval = null;
    }
}

function updateTabStyles(tabBar) {
    for (const btn of tabBar.children) {
        const isActive = btn.dataset.tab === activeTab;
        btn.style.background = isActive ? 'rgba(255,204,0,0.25)' : 'rgba(255,255,255,0.05)';
        btn.style.color = isActive ? '#ffcc00' : 'rgba(255,255,255,0.5)';
    }
}

function renderContent() {
    if (!contentEl) return;

    // Stop live refresh if switching away
    if (activeTab !== 'live' && liveRefreshInterval) {
        clearInterval(liveRefreshInterval);
        liveRefreshInterval = null;
    }

    if (activeTab === 'live') {
        renderLiveContent();
        // Auto-refresh while visible
        if (!liveRefreshInterval) {
            liveRefreshInterval = setInterval(() => {
                if (overlay && overlay.style.display === 'flex' && activeTab === 'live') {
                    renderLiveContent();
                }
            }, 500);
        }
        return;
    }

    const tab = TABS.find(t => t.key === activeTab);
    if (!tab) return;

    const records = getRecords();
    const stats = getStatsFn ? getStatsFn() : { coins: 0, tailLength: 0, size: 1 };

    // Current session value for this category
    let currentVal;
    switch (tab.key) {
        case 'size': currentVal = Math.max(session.maxSize, stats.size); break;
        case 'kills': currentVal = session.kills; break;
        case 'coins': currentVal = stats.coins; break;
        case 'tail': currentVal = Math.max(session.maxTail, stats.tailLength); break;
    }

    contentEl.innerHTML = '';

    // Current session row
    const now = document.createElement('div');
    now.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:6px 8px; margin-bottom:8px; background:rgba(255,204,0,0.15); border-radius:6px; font-size:13px;';
    now.innerHTML = `<span style="color:#ffcc00">Now (${playerName})</span><span style="color:#fff; font-weight:bold">${tab.format(currentVal)}</span>`;
    contentEl.appendChild(now);

    // Sort records by the active tab's field
    const sorted = [...records]
        .sort((a, b) => (b[tab.field] || 0) - (a[tab.field] || 0))
        .slice(0, MAX_ENTRIES);

    if (sorted.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No records yet - play to set records!';
        empty.style.cssText = 'color:rgba(255,255,255,0.3); font-size:11px; text-align:center; padding:12px 0;';
        contentEl.appendChild(empty);
        return;
    }

    for (let i = 0; i < sorted.length; i++) {
        const entry = sorted[i];
        const val = entry[tab.field] || 0;

        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:4px 8px; margin-bottom:3px; font-size:12px;';

        // Medal for top 3
        let rankText = `#${i + 1}`;
        let rankColor = 'rgba(255,255,255,0.4)';
        if (i === 0) { rankText = '\ud83e\udd47'; rankColor = '#ffd700'; }
        else if (i === 1) { rankText = '\ud83e\udd48'; rankColor = '#c0c0c0'; }
        else if (i === 2) { rankText = '\ud83e\udd49'; rankColor = '#cd7f32'; }

        const rank = document.createElement('span');
        rank.textContent = rankText;
        rank.style.cssText = `color:${rankColor}; width:24px; text-align:center; font-size:${i < 3 ? '14px' : '10px'};`;

        const name = document.createElement('span');
        name.textContent = entry.name || 'Unknown';
        name.style.cssText = 'color:rgba(255,255,255,0.85); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';

        const value = document.createElement('span');
        value.textContent = tab.format(val);
        value.style.cssText = 'color:#fff; font-weight:bold; min-width:40px; text-align:right;';

        const date = document.createElement('span');
        date.textContent = entry.date || '';
        date.style.cssText = 'color:rgba(255,255,255,0.2); font-size:9px; min-width:60px; text-align:right;';

        row.appendChild(rank);
        row.appendChild(name);
        row.appendChild(value);
        row.appendChild(date);
        contentEl.appendChild(row);
    }
}

function renderLiveContent() {
    if (!contentEl || !networkManager) return;

    const extra = networkManager.latestExtra;
    const scores = extra.scores || [];
    const localId = networkManager.localPlayerId;

    // Sort by score descending
    const sorted = [...scores].sort((a, b) => b.score - a.score);

    contentEl.innerHTML = '';

    if (sorted.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'Waiting for players...';
        empty.style.cssText = 'color:rgba(255,255,255,0.3); font-size:11px; text-align:center; padding:12px 0;';
        contentEl.appendChild(empty);
        return;
    }

    // Header row
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; gap:6px; padding:2px 8px; margin-bottom:6px; font-size:10px; color:rgba(255,255,255,0.35);';
    header.innerHTML = '<span style="width:24px"></span><span style="flex:1">Name</span><span style="min-width:36px;text-align:right">Score</span><span style="min-width:28px;text-align:right">Tail</span><span style="min-width:32px;text-align:right">Size</span>';
    contentEl.appendChild(header);

    for (let i = 0; i < sorted.length; i++) {
        const s = sorted[i];
        const isLocal = s.playerId === localId;

        // Get entity scale from remoteEntities (or local state)
        const entity = networkManager.remoteEntities.get(s.playerId);
        const scale = entity ? entity.scale : 1;

        // Deterministic color (same formula as RemotePlayer)
        const hue = (s.playerId * 137.508) % 360;
        const color = `hsl(${Math.round(hue)}, 70%, 55%)`;

        const row = document.createElement('div');
        const bg = isLocal ? 'background:rgba(0,255,204,0.12);' : '';
        row.style.cssText = `display:flex; align-items:center; gap:6px; padding:3px 8px; margin-bottom:2px; border-radius:4px; font-size:12px; ${bg}`;

        // Medal / rank
        let rankText = `#${i + 1}`;
        let rankColor = 'rgba(255,255,255,0.4)';
        if (i === 0) { rankText = '\ud83e\udd47'; rankColor = '#ffd700'; }
        else if (i === 1) { rankText = '\ud83e\udd48'; rankColor = '#c0c0c0'; }
        else if (i === 2) { rankText = '\ud83e\udd49'; rankColor = '#cd7f32'; }

        const rankEl = document.createElement('span');
        rankEl.textContent = rankText;
        rankEl.style.cssText = `color:${rankColor}; width:24px; text-align:center; font-size:${i < 3 ? '14px' : '10px'};`;

        const nameEl = document.createElement('span');
        nameEl.textContent = s.displayName || `Player`;
        const nameColor = isLocal ? '#00ffcc' : 'rgba(255,255,255,0.85)';
        nameEl.style.cssText = `color:${nameColor}; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`;

        const scoreEl = document.createElement('span');
        scoreEl.textContent = String(s.score);
        scoreEl.style.cssText = 'color:#fff; font-weight:bold; min-width:36px; text-align:right;';

        const tailEl = document.createElement('span');
        tailEl.textContent = String(s.tailLength);
        tailEl.style.cssText = 'color:rgba(255,255,255,0.5); min-width:28px; text-align:right; font-size:11px;';

        const sizeEl = document.createElement('span');
        sizeEl.textContent = scale.toFixed(1) + 'x';
        sizeEl.style.cssText = 'color:rgba(255,255,255,0.5); min-width:32px; text-align:right; font-size:11px;';

        row.appendChild(rankEl);
        row.appendChild(nameEl);
        row.appendChild(scoreEl);
        row.appendChild(tailEl);
        row.appendChild(sizeEl);
        contentEl.appendChild(row);
    }
}

function toggleLeaderboard() {
    if (!overlay) return;
    const visible = overlay.style.display === 'flex';
    if (!visible) {
        renderContent();
        const tabBar = overlay.querySelector('#lb-tabs');
        if (tabBar) updateTabStyles(tabBar);
    } else {
        hideOverlay();
        return;
    }
    overlay.style.display = 'flex';
}
