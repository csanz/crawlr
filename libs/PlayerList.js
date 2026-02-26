/**
 * @module PlayerList
 * Always-visible player list on the left side showing all snakes ranked by tail length.
 * Bots get random fake names. Player is highlighted.
 */

const BOT_NAMES = [
    'Slinky', 'Viper', 'Noodle', 'Zigzag', 'Fang',
    'Slick', 'Cobra', 'Wiggles', 'Pixel', 'Blitz',
    'Mamba', 'Rattle', 'Speedy', 'Shadow', 'Flash',
    'Twister', 'Dash', 'Streak', 'Bolt', 'Glide',
    'Razor', 'Drift', 'Surge', 'Nova', 'Turbo',
    'Ripple', 'Spark', 'Zephyr', 'Phantom', 'Storm'
];

let container = null;
let rows = [];
let nameMap = new Map(); // entityId → display name

/**
 * Pick a unique random name for a bot.
 */
function pickName() {
    const used = new Set(nameMap.values());
    const available = BOT_NAMES.filter(n => !used.has(n));
    if (available.length === 0) return 'Snake' + Math.floor(Math.random() * 99);
    return available[Math.floor(Math.random() * available.length)];
}

/**
 * Creates the player list container element.
 */
export function initPlayerList() {
    container = document.createElement('div');
    container.style.cssText = [
        'position:absolute',
        'top:60px',
        'left:10px',
        'z-index:100',
        'pointer-events:none',
        'user-select:none',
        'font:12px monospace',
        'color:#fff',
        'min-width:130px'
    ].join(';');
    document.body.appendChild(container);
}

/**
 * Register the player's display name.
 * @param {string} name
 */
export function setPlayerName(name) {
    nameMap.set('player', name);
}

/**
 * Register a bot with a random fake name.
 * @param {string} botId
 * @returns {string} The assigned name
 */
export function registerBot(botId) {
    const name = pickName();
    nameMap.set(botId, name);
    return name;
}

/**
 * Get the display name for an entity id.
 * @param {string} entityId
 * @returns {string}
 */
export function getEntityName(entityId) {
    if (entityId === 'boundary') return 'the void';
    return nameMap.get(entityId) || entityId;
}

/**
 * Updates the player list display. Call once per frame.
 * @param {Array<{id: string, tailLength: number, size: number, color: string, alive: boolean}>} entities
 */
export function updatePlayerList(entities) {
    if (!container) return;

    // Score = tail length + size bonus, sort descending
    for (const e of entities) {
        e.score = e.tailLength + Math.round((e.size - 1) * 10);
    }
    entities.sort((a, b) => b.score - a.score);

    // Find champion (highest size)
    let championId = null;
    let maxSize = 0;
    for (const e of entities) {
        if (e.alive && e.size > maxSize) {
            maxSize = e.size;
            championId = e.id;
        }
    }

    let html = '';
    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        const name = nameMap.get(e.id) || e.id;
        const isPlayer = e.id === 'player';
        const isChampion = e.id === championId && maxSize > 1.5;
        const opacity = e.alive ? 1 : 0.4;
        const highlight = isPlayer
            ? 'background:rgba(255,255,255,0.1); border-radius:4px;'
            : '';
        const nameColor = isPlayer ? '#00ffcc' : 'rgba(255,255,255,0.85)';
        const rankColor = 'rgba(255,255,255,0.4)';
        const sizeDisplay = e.size.toFixed(1) + 'x';
        const championLabel = isChampion
            ? '<span style="color:#ffd700; font-size:9px; margin-right:2px">&#x1F451; CHAMPION</span> '
            : '';

        html += `<div style="display:flex; align-items:center; gap:6px; padding:2px 6px; margin-bottom:2px; opacity:${opacity}; ${highlight}">`;
        html += `<span style="color:${rankColor}; width:16px; text-align:right; font-size:10px">${i + 1}</span>`;
        html += `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${e.color}; flex-shrink:0"></span>`;
        html += `<span style="color:${isChampion ? '#ffd700' : nameColor}; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${championLabel}${name}</span>`;
        html += `<span style="color:rgba(255,255,255,0.35); font-size:9px; min-width:24px; text-align:right">${sizeDisplay}</span>`;
        html += `<span style="color:rgba(255,255,255,0.5); font-size:10px; min-width:16px; text-align:right">${e.tailLength}</span>`;
        html += `</div>`;
    }

    container.innerHTML = html;
}
