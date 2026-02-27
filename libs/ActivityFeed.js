/**
 * @module ActivityFeed
 * Rolling event log in the bottom-left corner showing kills, ring events,
 * lightning strikes, and weather changes.
 */
import { eventBus } from './EventBus.js';
import { getEntityName } from './PlayerList.js';

const MAX_ITEMS = 5;
let container = null;

const EVENT_CONFIG = {
    'entity:died':    { icon: '\u{1F480}', color: '#ff4444' },
    'ring:jumped':    { icon: '\u25CB',    color: '#00ffff' },
    'ring:hit':       { icon: '\u25B3',    color: '#ffaa00' },
    'lightning:hit':  { icon: '\u26A1',    color: '#ffff44' },
    'theme:started':  { icon: '\u{1F327}', color: '#66aaff' },
    'theme:ended':    { icon: '\u{1F327}', color: '#66aaff' },
};

function addItem(icon, text, color, bright) {
    if (!container) return;
    const el = document.createElement('div');
    el.style.cssText = `font:12px monospace; color:${bright ? '#fff' : 'rgba(255,255,255,0.65)'}; text-shadow:0 0 4px rgba(0,0,0,0.9); padding:2px 0; white-space:nowrap; animation:feedIn 0.3s ease-out, feedOut 0.5s ease-in 3.5s forwards;`;
    el.innerHTML = `<span style="color:${color}">${icon}</span> ${text}`;
    el.addEventListener('animationend', (e) => {
        if (e.animationName === 'feedOut') el.remove();
    });
    container.appendChild(el);
    // Trim oldest if over max
    while (container.children.length > MAX_ITEMS) {
        container.removeChild(container.firstChild);
    }
}

function isPlayer(id) { return id === 'player'; }

function formatMessage(event, data) {
    switch (event) {
        case 'entity:died': {
            const victim = getEntityName(data.id);
            const killer = getEntityName(data.killedBy);
            return { text: `${killer} eliminated ${victim}`, bright: isPlayer(data.id) || isPlayer(data.killedBy) };
        }
        case 'ring:jumped': {
            const name = isPlayer(data.entityId) ? 'You' : getEntityName(data.entityId);
            return { text: `${name} jumped ring +${data.segmentsGained}`, bright: isPlayer(data.entityId) };
        }
        case 'ring:hit': {
            const name = isPlayer(data.entityId) ? 'You' : getEntityName(data.entityId);
            return { text: `${name} hit ring -${data.segmentsLost}`, bright: isPlayer(data.entityId) };
        }
        case 'lightning:hit': {
            const name = isPlayer(data.entityId) ? 'You' : getEntityName(data.entityId);
            return { text: `${name} struck by lightning`, bright: isPlayer(data.entityId) };
        }
        case 'theme:started':
            return { text: `${data.name} rolls in`, bright: false };
        case 'theme:ended':
            return { text: `${data.name} clears up`, bright: false };
        default:
            return null;
    }
}

export function initActivityFeed() {
    // Inject CSS animations
    const style = document.createElement('style');
    style.textContent = `
        @keyframes feedIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes feedOut { from { opacity:1; } to { opacity:0; } }
    `;
    document.head.appendChild(style);

    container = document.createElement('div');
    container.style.cssText = 'position:absolute; bottom:30px; left:10px; z-index:100; pointer-events:none; user-select:none;';
    document.body.appendChild(container);

    for (const event of Object.keys(EVENT_CONFIG)) {
        eventBus.on(event, (data) => {
            const cfg = EVENT_CONFIG[event];
            const msg = formatMessage(event, data);
            if (msg) addItem(cfg.icon, msg.text, cfg.color, msg.bright);
        });
    }
}
