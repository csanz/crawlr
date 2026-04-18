/**
 * @module CrawlrNet
 * Crawlr-game network adapter wrapping @jazaix/jx-sdk.
 *
 * Provides crawlr-specific APIs on top of the SDK's generic transport layer:
 *  - sendInput(dx, dz, flags, angle) — encodes crawlr's 13-byte input format
 *  - sendRespawnRequest(), sendChatMessage(), sendWhisperMessage(), sendCollectRequest()
 *  - Snapshot extra decoding (pickups, scores, weather, timer)
 *  - Join response payload parsing into serverSettings
 *  - Game-specific event dispatch (death, pickups, sounds, chat, round end)
 */
import { NetworkClient, Protocol, eventBus } from '@jazaix/jx-sdk';
import { createLogger } from './Logger.js';
import { playSpatialEffect, playSpatialSound } from './Sound.js';

export { eventBus } from '@jazaix/jx-sdk';

const log = createLogger('CrawlrNet');

// ── Crawlr entity schema (must match CrawlrEntity in Rust engine) ──────────
const CRAWLR_SCHEMA = [
    { name: 'id', type: 'id' },
    { name: 'x', type: 'number' },
    { name: 'y', type: 'number' },
    { name: 'z', type: 'number' },
    { name: 'vx', type: 'number' },
    { name: 'vy', type: 'number' },
    { name: 'vz', type: 'number' },
    { name: 'angle', type: 'number' },
    { name: 'scale', type: 'number' },
    { name: 'flags', type: 'uint16' },
];

// ── Crawlr event types (must match crawlr/game.rs) ─────────────────────────
const EVENT_PLAYER_JOINED    = 0;
const EVENT_PLAYER_LEFT      = 1;
const EVENT_PLAYER_DIED      = 2;
const EVENT_PLAYER_RESPAWNED = 3;
const EVENT_SOUND            = 4;
const EVENT_PICKUP_SPAWN     = 5;
const EVENT_PICKUP_REMOVE    = 6;
const EVENT_PICKUP_BULK      = 7;
const EVENT_ROUND_END        = 8;
const EVENT_CHAT             = 9;
const EVENT_CHAT_HISTORY     = 10;
const EVENT_WHISPER          = 11;

const MSG_GAME = 0x50;

/** Number of snapshots to buffer for interpolation. */
const SNAPSHOT_BUFFER_SIZE = 3;

export class CrawlrNet {
    /**
     * @param {string} serverUrl - WebTransport server URL
     */
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
        this.client = new NetworkClient();
        this.client.setSchema(CRAWLR_SCHEMA);
        this.localPlayerId = null;
        this.connected = false;

        // Snapshot interpolation buffer
        this._snapshots = [];
        this.latestTick = 0;

        // Latest decoded extra data
        this.latestExtra = {
            pickups: [], scores: [], roundRemaining: 600,
            weatherState: 0, stormRemaining: 0, lightning: [], puddles: [],
        };

        // Remote entity states: entityId → { x, y, z, vx, vy, vz, angle, scale, flags }
        this.remoteEntities = new Map();
        this._knownEntities = new Set();

        // Pickup state from reliable stream events
        this.pickupMap = new Map();

        // Server physics settings (from join response payload)
        this.serverSettings = null;
    }

    /**
     * Connect to server and join a room.
     * @param {string} playerName
     * @param {string} roomId
     * @param {string} token
     * @param {string} gameKey
     * @returns {Promise<boolean>}
     */
    async connect(playerName, roomId = 'default', token = '', gameKey = '') {
        try {
            await this.client.connect(this.serverUrl);
            const response = await this.client.sendJoinRequest(playerName, roomId, token, 0, gameKey);

            if (response.status !== 0) {
                log.warn('Join rejected');
                this.lastError = 'Server rejected join request';
                return false;
            }

            this.localPlayerId = response.playerId;
            this.connected = true;

            // Parse server physics settings from join payload (6 x f32 = 24 bytes)
            if (response.payload && response.payload.byteLength >= 24) {
                const pv = new DataView(response.payload.buffer, response.payload.byteOffset, response.payload.byteLength);
                this.serverSettings = {
                    gravity: pv.getFloat32(0, true),
                    playerSpeed: pv.getFloat32(4, true),
                    runMultiplier: pv.getFloat32(8, true),
                    jumpForce: pv.getFloat32(12, true),
                    boundary: pv.getFloat32(16, true),
                    roundDuration: pv.getFloat32(20, true),
                };
            }

            this.client.onSnapshot((snapshot) => this._onSnapshot(snapshot));
            this.client.onEvent((event) => this._onEvent(event));
            this.client.onDisconnect(() => {
                this.connected = false;
                log.info('Disconnected from server');
                eventBus.emit('network:disconnected', {});
            });

            log.info(`Connected as player ${this.localPlayerId}`);
            return true;
        } catch (err) {
            log.error('Connection failed:', err);
            this.lastError = err.message || String(err);
            return false;
        }
    }

    // ── Input ────────────────────────────────────────────────────────────────

    /**
     * Send crawlr player input as an unreliable datagram.
     * @param {number} dx - Movement direction X (-1..1)
     * @param {number} dz - Movement direction Z (-1..1)
     * @param {number} flags - Bit flags (bit0=sprint, bit1=jump, etc.)
     * @param {number} angle - Facing angle in radians
     */
    sendInput(dx, dz, flags, angle) {
        if (!this.connected) return;
        const buf = new ArrayBuffer(13);
        const view = new DataView(buf);
        view.setFloat32(0, dx, true);
        view.setFloat32(4, dz, true);
        view.setUint8(8, flags);
        view.setFloat32(9, angle, true);
        this.client.sendInput(new Uint8Array(buf));
    }

    /**
     * Send a pickup collection request to the server.
     * @param {number} pickupId
     */
    sendCollectRequest(pickupId) {
        if (!this.connected) return;
        const data = new Uint8Array(5);
        const view = new DataView(data.buffer);
        view.setUint8(0, Protocol.MSG.COLLECT);
        view.setUint32(1, pickupId, true);
        this.client.sendReliable(data);
    }

    /** Send a respawn request to the server (after death screen). */
    sendRespawnRequest() {
        if (!this.connected) return;
        this.client.sendReliable(new Uint8Array([Protocol.MSG.RESPAWN]));
    }

    /**
     * Send a chat message to the server.
     * @param {string} text
     */
    sendChatMessage(text) {
        if (!this.connected || !text) return;
        const textBytes = new TextEncoder().encode(text);
        const buf = new ArrayBuffer(1 + 2 + textBytes.length);
        const view = new DataView(buf);
        view.setUint8(0, Protocol.MSG.CHAT);
        view.setUint16(1, textBytes.length, true);
        new Uint8Array(buf, 3).set(textBytes);
        this.client.sendReliable(new Uint8Array(buf));
    }

    /**
     * Send a whisper (DM) to a specific player by name.
     * @param {string} targetName
     * @param {string} text
     */
    sendWhisperMessage(targetName, text) {
        if (!this.connected || !targetName || !text) return;
        const nameBytes = new TextEncoder().encode(targetName);
        const textBytes = new TextEncoder().encode(text);
        const buf = new ArrayBuffer(1 + 1 + nameBytes.length + 2 + textBytes.length);
        const view = new DataView(buf);
        let off = 0;
        view.setUint8(off, Protocol.MSG.WHISPER); off += 1;
        view.setUint8(off, nameBytes.length); off += 1;
        new Uint8Array(buf, off, nameBytes.length).set(nameBytes); off += nameBytes.length;
        view.setUint16(off, textBytes.length, true); off += 2;
        new Uint8Array(buf, off, textBytes.length).set(textBytes);
        this.client.sendReliable(new Uint8Array(buf));
    }

    /**
     * Send a generic game message to the server.
     * @param {string} type - Message subtype identifier (e.g. "use-item", "emote")
     * @param {*} data - JSON-serializable payload
     */
    sendMessage(type, data) {
        if (!this.connected || !type) return;
        const typeBytes = new TextEncoder().encode(type);
        const payloadBytes = new TextEncoder().encode(JSON.stringify(data));
        const buf = new ArrayBuffer(1 + 1 + typeBytes.length + 4 + payloadBytes.length);
        const view = new DataView(buf);
        let off = 0;
        view.setUint8(off, MSG_GAME); off += 1;
        view.setUint8(off, typeBytes.length); off += 1;
        new Uint8Array(buf, off, typeBytes.length).set(typeBytes); off += typeBytes.length;
        view.setUint32(off, payloadBytes.length, true); off += 4;
        new Uint8Array(buf, off, payloadBytes.length).set(payloadBytes);
        this.client.sendReliable(new Uint8Array(buf));
    }

    // ── Snapshot handling ────────────────────────────────────────────────────

    /** @private */
    _onSnapshot(snapshot) {
        snapshot._arrivedAt = performance.now();
        this._snapshots.push(snapshot);
        if (this._snapshots.length > SNAPSHOT_BUFFER_SIZE) {
            this._snapshots.shift();
        }
        this.latestTick = snapshot.tick;
        eventBus.emit('network:snapshot', snapshot);

        // Decode extra data FIRST so entity detection can use display names
        if (snapshot.extra && snapshot.extra.byteLength > 0) {
            this.latestExtra = decodeSnapshotExtra(snapshot.extra);
        }

        // Update remote entity states from latest snapshot
        const seenIds = new Set();
        for (const entity of snapshot.entities) {
            seenIds.add(entity.id);
            this.remoteEntities.set(entity.id, { ...entity });

            // Detect new entities
            if (!this._knownEntities.has(entity.id) && entity.id !== this.localPlayerId) {
                this._knownEntities.add(entity.id);
                const isBot = (entity.flags & 0x08) !== 0;
                const scoreInfo = this.latestExtra.scores.find(s => s.playerId === entity.id);
                const name = scoreInfo ? scoreInfo.displayName : `Player ${entity.id}`;
                eventBus.emit('entity:joined', {
                    entityId: entity.id,
                    name,
                    remote: true,
                    isBot,
                });
            }
        }

        // Detect removed entities
        for (const id of this._knownEntities) {
            if (!seenIds.has(id)) {
                this._knownEntities.delete(id);
                eventBus.emit('entity:left', { entityId: id });
            }
        }
    }

    // ── Event handling ───────────────────────────────────────────────────────

    /** @private */
    _onEvent(event) {
        switch (event.eventType) {
            case EVENT_PLAYER_JOINED:
                log.info(`Player ${event.playerId} joined`);
                if (event.playerId !== this.localPlayerId) {
                    eventBus.emit('entity:joined', {
                        entityId: event.playerId,
                        name: `Player ${event.playerId}`,
                        remote: true,
                    });
                }
                break;

            case EVENT_PLAYER_LEFT:
                log.info(`Player ${event.playerId} left`);
                eventBus.emit('entity:left', { entityId: event.playerId });
                break;

            case EVENT_PLAYER_DIED: {
                let killerId = 0;
                if (event.payload && event.payload.byteLength >= 8) {
                    const view = new DataView(event.payload.buffer, event.payload.byteOffset, event.payload.byteLength);
                    killerId = view.getUint32(0, true) + view.getUint32(4, true) * 0x100000000;
                }
                log.info(`Player ${event.playerId} killed by ${killerId}`);
                eventBus.emit('entity:died', {
                    id: event.playerId === this.localPlayerId ? 'player' : event.playerId,
                    killedBy: killerId === this.localPlayerId ? 'player' : killerId,
                    tailLength: 0,
                });
                break;
            }

            case EVENT_PLAYER_RESPAWNED:
                log.info(`Player ${event.playerId} respawned`);
                eventBus.emit('player:respawned', { playerId: event.playerId });
                break;

            case EVENT_PICKUP_SPAWN: {
                if (!event.payload || event.payload.byteLength < 17) break;
                const spView = new DataView(event.payload.buffer, event.payload.byteOffset, event.payload.byteLength);
                const spId = spView.getUint32(0, true);
                const spType = spView.getUint8(4);
                const spX = spView.getFloat32(5, true);
                const spY = spView.getFloat32(9, true);
                const spZ = spView.getFloat32(13, true);
                this.pickupMap.set(spId, { id: spId, type: spType, x: spX, y: spY, z: spZ, vy: 0, grounded: spType === 3 });
                break;
            }

            case EVENT_PICKUP_REMOVE: {
                if (!event.payload || event.payload.byteLength < 4) break;
                const rmView = new DataView(event.payload.buffer, event.payload.byteOffset, event.payload.byteLength);
                this.pickupMap.delete(rmView.getUint32(0, true));
                break;
            }

            case EVENT_PICKUP_BULK: {
                if (!event.payload || event.payload.byteLength < 2) break;
                const bkView = new DataView(event.payload.buffer, event.payload.byteOffset, event.payload.byteLength);
                const bkCount = bkView.getUint16(0, true);
                this.pickupMap.clear();
                let bkOff = 2;
                for (let i = 0; i < bkCount && bkOff + 17 <= event.payload.byteLength; i++) {
                    const id = bkView.getUint32(bkOff, true); bkOff += 4;
                    const type_ = bkView.getUint8(bkOff); bkOff += 1;
                    const x = bkView.getFloat32(bkOff, true); bkOff += 4;
                    const y = bkView.getFloat32(bkOff, true); bkOff += 4;
                    const z = bkView.getFloat32(bkOff, true); bkOff += 4;
                    this.pickupMap.set(id, { id, type: type_, x, y, z, vy: 0, grounded: type_ === 3 || y <= 0.5 });
                }
                break;
            }

            case EVENT_ROUND_END: {
                if (!event.payload || event.payload.byteLength < 5) break;
                const reView = new DataView(event.payload.buffer, event.payload.byteOffset, event.payload.byteLength);
                const decoder = new TextDecoder();
                let reOff = 0;
                const roundNumber = reView.getUint32(reOff, true); reOff += 4;
                const reCount = reView.getUint8(reOff); reOff += 1;
                const rankings = [];
                for (let i = 0; i < reCount && reOff < event.payload.byteLength; i++) {
                    const idLow = reView.getUint32(reOff, true);
                    const idHigh = reView.getUint32(reOff + 4, true);
                    const id = idLow + idHigh * 0x100000000;
                    reOff += 8;
                    const score = reView.getUint32(reOff, true); reOff += 4;
                    const tailLength = reView.getUint16(reOff, true); reOff += 2;
                    const scale = reView.getFloat32(reOff, true); reOff += 4;
                    const nameLen = reView.getUint8(reOff); reOff += 1;
                    const nameBytes = new Uint8Array(event.payload.buffer, event.payload.byteOffset + reOff, nameLen);
                    const name = decoder.decode(nameBytes);
                    reOff += nameLen;
                    const hue = (id * 137.508) % 360 / 360;
                    const color = `hsl(${Math.round(hue * 360)}, 70%, 55%)`;
                    rankings.push({ id, score, tailLength, size: scale, color, name });
                }
                log.info(`Round ${roundNumber} ended, ${rankings.length} rankings`);
                eventBus.emit('round:end', { roundNumber, rankings });
                break;
            }

            case EVENT_SOUND: {
                if (!event.payload || event.payload.byteLength < 1) break;
                const pView = new DataView(event.payload.buffer, event.payload.byteOffset, event.payload.byteLength);
                const nameLen = pView.getUint8(0);
                if (event.payload.byteLength < 1 + nameLen + 8) break;
                const nameBytes = new Uint8Array(event.payload.buffer, event.payload.byteOffset + 1, nameLen);
                const soundName = new TextDecoder().decode(nameBytes);
                const sx = pView.getFloat32(1 + nameLen, true);
                const sz = pView.getFloat32(1 + nameLen + 4, true);
                const handle = playSpatialEffect(soundName, sx, sz);
                if (!handle) {
                    playSpatialSound(soundName, 0.3, sx, sz);
                }
                eventBus.emit('network:sound', { soundName, x: sx, z: sz, playerId: event.playerId });
                break;
            }

            case EVENT_CHAT: {
                if (!event.payload || event.payload.byteLength < 4) break;
                const chat = decodeChatPayload(event.payload);
                eventBus.emit('chat:message', {
                    senderId: event.playerId,
                    senderName: chat.senderName,
                    text: chat.text,
                });
                break;
            }

            case EVENT_CHAT_HISTORY: {
                if (!event.payload || event.payload.byteLength < 2) break;
                const messages = decodeChatHistoryPayload(event.payload);
                eventBus.emit('chat:history', { messages });
                break;
            }

            case EVENT_WHISPER: {
                if (!event.payload || event.payload.byteLength < 4) break;
                const whisper = decodeWhisperPayload(event.payload);
                eventBus.emit('chat:whisper', {
                    senderName: whisper.senderName,
                    text: whisper.text,
                    direction: whisper.direction,
                });
                break;
            }
        }
    }

    // ── Interpolation ────────────────────────────────────────────────────────

    /**
     * Get the interpolated state for a remote entity.
     * @param {number} entityId
     * @returns {{ x, y, z, vx, vy, vz, angle, scale, flags } | null}
     */
    getInterpolatedState(entityId) {
        if (this._snapshots.length < 2) {
            return this.remoteEntities.get(entityId) || null;
        }

        const prev = this._snapshots[this._snapshots.length - 2];
        const curr = this._snapshots[this._snapshots.length - 1];

        const prevEntity = prev.entities.find(e => e.id === entityId);
        const currEntity = curr.entities.find(e => e.id === entityId);

        if (!prevEntity || !currEntity) {
            return this.remoteEntities.get(entityId) || null;
        }

        // Time-based interpolation: how far are we between the two snapshots?
        const now = performance.now();
        const snapGap = curr._arrivedAt - prev._arrivedAt;
        const elapsed = now - curr._arrivedAt;
        // t goes from 0 (at curr arrival) to 1 (at next expected arrival)
        // We extrapolate slightly beyond curr using the same velocity
        const t = snapGap > 0 ? Math.min(1.5, (elapsed + snapGap) / snapGap) : 1;

        return {
            x: prevEntity.x + (currEntity.x - prevEntity.x) * t,
            y: prevEntity.y + (currEntity.y - prevEntity.y) * t,
            z: prevEntity.z + (currEntity.z - prevEntity.z) * t,
            vx: currEntity.vx,
            vy: currEntity.vy,
            vz: currEntity.vz,
            angle: currEntity.angle,
            scale: currEntity.scale,
            flags: currEntity.flags,
        };
    }

    /** Get the local player's state from the latest snapshot. */
    getLocalPlayerState() {
        return this.remoteEntities.get(this.localPlayerId) || null;
    }

    /** Get all remote entity IDs (excluding local player). */
    getRemoteEntityIds() {
        const ids = [];
        for (const id of this.remoteEntities.keys()) {
            if (id !== this.localPlayerId) {
                ids.push(id);
            }
        }
        return ids;
    }

    /**
     * Connect as an observer (spectator). No entity is created on the server.
     * Receives snapshots and events but cannot send input.
     * @param {string} roomId
     * @param {string} token
     * @param {string} gameKey
     * @returns {Promise<boolean>}
     */
    async connectAsObserver(roomId, token = '', gameKey = '') {
        try {
            await this.client.connect(this.serverUrl);
            const response = await this.client.sendJoinRequest(
                '__observer__', roomId, token, Protocol.JOIN_FLAGS.OBSERVER, gameKey
            );

            if (response.status !== 0) {
                log.warn('Observer join rejected');
                this.lastError = 'Server rejected observer request';
                return false;
            }

            this.localPlayerId = response.playerId;
            this.connected = true;
            this.isObserver = true;

            this.client.onSnapshot((snapshot) => this._onSnapshot(snapshot));
            this.client.onEvent((event) => this._onEvent(event));
            this.client.onDisconnect(() => {
                this.connected = false;
                log.info('Observer disconnected from server');
                eventBus.emit('network:disconnected', {});
            });

            log.info(`Connected as observer ${this.localPlayerId} to room ${roomId}`);
            return true;
        } catch (err) {
            log.error('Observer connection failed:', err);
            this.lastError = err.message || String(err);
            return false;
        }
    }

    disconnect() {
        this.client.disconnect();
        this.connected = false;
    }
}

// ── Snapshot extra decoder (crawlr-specific) ────────────────────────────────

function decodeSnapshotExtra(data) {
    if (!data || data.byteLength === 0) {
        return {
            pickups: [], scores: [], roundRemaining: 0,
            weatherState: 0, stormRemaining: 0, lightning: [], puddles: [],
        };
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const decoder = new TextDecoder();
    let offset = 0;

    // Version detection: v1+ starts with version byte (1-255).
    const firstByte = view.getUint8(0);
    if (firstByte >= 1 && firstByte <= 127) {
        offset += 1;
    }

    // Pickups
    const pickupCount = view.getUint16(offset, true); offset += 2;
    const pickups = [];
    for (let i = 0; i < pickupCount; i++) {
        const id = view.getUint32(offset, true); offset += 4;
        const type_ = view.getUint8(offset); offset += 1;
        const x = view.getFloat32(offset, true); offset += 4;
        const y = view.getFloat32(offset, true); offset += 4;
        const z = view.getFloat32(offset, true); offset += 4;
        pickups.push({ id, type: type_, x, y, z });
    }

    // Scores
    const scoreCount = view.getUint16(offset, true); offset += 2;
    const scores = [];
    for (let i = 0; i < scoreCount; i++) {
        const idLow = view.getUint32(offset, true);
        const idHigh = view.getUint32(offset + 4, true);
        const playerId = idLow + idHigh * 0x100000000;
        offset += 8;
        const score = view.getUint32(offset, true); offset += 4;
        const tailLength = view.getUint16(offset, true); offset += 2;
        const powerUp = view.getUint8(offset); offset += 1;
        const nameLen = view.getUint8(offset); offset += 1;
        const nameBytes = new Uint8Array(data.buffer, data.byteOffset + offset, nameLen);
        const displayName = decoder.decode(nameBytes);
        offset += nameLen;
        scores.push({ playerId, score, tailLength, powerUp, displayName });
    }

    // Weather
    const weatherState = view.getUint8(offset); offset += 1;
    const stormRemaining = view.getFloat32(offset, true); offset += 4;

    // Lightning strikes
    const lightningCount = view.getUint8(offset); offset += 1;
    const lightning = [];
    for (let i = 0; i < lightningCount; i++) {
        const x = view.getFloat32(offset, true); offset += 4;
        const z = view.getFloat32(offset, true); offset += 4;
        const radius = view.getFloat32(offset, true); offset += 4;
        lightning.push({ x, z, radius });
    }

    // Puddles
    const puddleCount = view.getUint8(offset); offset += 1;
    const puddles = [];
    for (let i = 0; i < puddleCount; i++) {
        const id = view.getUint32(offset, true); offset += 4;
        const x = view.getFloat32(offset, true); offset += 4;
        const z = view.getFloat32(offset, true); offset += 4;
        const radius = view.getFloat32(offset, true); offset += 4;
        const age = view.getFloat32(offset, true); offset += 4;
        puddles.push({ id, x, z, radius, age });
    }

    // Round remaining
    const roundRemaining = view.getFloat32(offset, true);

    return { pickups, scores, roundRemaining, weatherState, stormRemaining, lightning, puddles };
}

// ── Chat payload decoders (crawlr-specific) ─────────────────────────────────

function decodeChatPayload(payload) {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const decoder = new TextDecoder();
    let offset = 0;
    const nameLen = view.getUint8(offset); offset += 1;
    const nameBytes = new Uint8Array(payload.buffer, payload.byteOffset + offset, nameLen);
    const senderName = decoder.decode(nameBytes);
    offset += nameLen;
    const textLen = view.getUint16(offset, true); offset += 2;
    const textBytes = new Uint8Array(payload.buffer, payload.byteOffset + offset, textLen);
    const text = decoder.decode(textBytes);
    return { senderName, text };
}

function decodeChatHistoryPayload(payload) {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const decoder = new TextDecoder();
    let offset = 0;

    const count = view.getUint16(offset, true); offset += 2;
    const messages = [];

    for (let i = 0; i < count && offset < payload.byteLength; i++) {
        const idLow = view.getUint32(offset, true);
        const idHigh = view.getUint32(offset + 4, true);
        const senderId = idLow + idHigh * 0x100000000;
        offset += 8;

        const nameLen = view.getUint8(offset); offset += 1;
        const nameBytes = new Uint8Array(payload.buffer, payload.byteOffset + offset, nameLen);
        const senderName = decoder.decode(nameBytes);
        offset += nameLen;

        const textLen = view.getUint16(offset, true); offset += 2;
        const textBytes = new Uint8Array(payload.buffer, payload.byteOffset + offset, textLen);
        const text = decoder.decode(textBytes);
        offset += textLen;

        messages.push({ senderId, senderName, text });
    }

    return messages;
}

function decodeWhisperPayload(payload) {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const decoder = new TextDecoder();
    let offset = 0;
    const nameLen = view.getUint8(offset); offset += 1;
    const nameBytes = new Uint8Array(payload.buffer, payload.byteOffset + offset, nameLen);
    const senderName = decoder.decode(nameBytes);
    offset += nameLen;
    const textLen = view.getUint16(offset, true); offset += 2;
    const textBytes = new Uint8Array(payload.buffer, payload.byteOffset + offset, textLen);
    const text = decoder.decode(textBytes);
    offset += textLen;
    const direction = view.getUint8(offset);
    return { senderName, text, direction };
}
