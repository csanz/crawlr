#!/usr/bin/env node
/**
 * Lobby bot management CLI for Crawlr.
 *
 * Usage:
 *   node scripts/lobby-bots.mjs status                           # Show all servers
 *   node scripts/lobby-bots.mjs fill                             # Fill all servers to ~80%
 *   node scripts/lobby-bots.mjs fill --count 30 --server lobby-1 # Fill specific server
 *   node scripts/lobby-bots.mjs clear                            # Remove all lobby bots
 *   node scripts/lobby-bots.mjs clear --server lobby-1           # Remove bots from one server
 */

const API_URL = process.env.ADMIN_API_URL || 'http://localhost:4435';

const args = process.argv.slice(2);
const command = args[0];

function getArg(name) {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

async function fetchJson(path, opts = {}) {
    const res = await fetch(`${API_URL}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
    });
    return res.json();
}

async function status() {
    const servers = await fetchJson('/api/lobby/servers');
    if (servers.length === 0) {
        console.log('No servers running.');
        return;
    }
    console.log('\nServer Status:');
    console.log('─'.repeat(60));
    for (const s of servers) {
        const bar = '█'.repeat(Math.round(s.player_count / s.max_players * 20)).padEnd(20, '░');
        const names = (s.preview_names || []).join(', ');
        console.log(`  ${s.name.padEnd(20)} ${String(s.player_count).padStart(3)}/${s.max_players} ${bar}  ${s.state}`);
        if (names) console.log(`${''.padStart(24)}${names}`);
    }
    console.log('');
}

async function fill() {
    const targetServer = getArg('server');
    const count = parseInt(getArg('count') || '0', 10);
    const servers = await fetchJson('/api/lobby/servers');

    const targets = targetServer
        ? servers.filter(s => s.server_id === targetServer)
        : servers;

    if (targets.length === 0) {
        console.log(targetServer ? `Server "${targetServer}" not found.` : 'No servers running.');
        return;
    }

    for (const s of targets) {
        const available = s.max_players - s.player_count;
        const toSpawn = count > 0 ? Math.min(count, available) : Math.round(s.max_players * 0.8) - s.player_count;
        if (toSpawn <= 0) {
            console.log(`  ${s.name}: already at/above target (${s.player_count}/${s.max_players})`);
            continue;
        }

        const result = await fetchJson('/api/lobby/bots', {
            method: 'POST',
            body: JSON.stringify({ server_id: s.server_id, count: toSpawn }),
        });
        console.log(`  ${s.name}: spawned ${result.spawned || 0} bots`);
    }
}

async function clear() {
    const targetServer = getArg('server');
    const servers = await fetchJson('/api/lobby/servers');

    const targets = targetServer
        ? servers.filter(s => s.server_id === targetServer)
        : servers;

    if (targets.length === 0) {
        console.log(targetServer ? `Server "${targetServer}" not found.` : 'No servers running.');
        return;
    }

    for (const s of targets) {
        const result = await fetchJson(`/api/lobby/bots/${s.server_id}`, { method: 'DELETE' });
        console.log(`  ${s.name}: removed ${result.removed || 0} bots`);
    }
}

// ── Main ─────────────────────────────────────────────────────────────────

switch (command) {
    case 'status':
        await status();
        break;
    case 'fill':
        await fill();
        await status();
        break;
    case 'clear':
        await clear();
        await status();
        break;
    default:
        console.log(`Usage: node scripts/lobby-bots.mjs <status|fill|clear> [--server <id>] [--count <n>]`);
        process.exit(1);
}
