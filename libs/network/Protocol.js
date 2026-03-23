/**
 * @module Protocol
 * Binary protocol codec matching the Rust engine's codec.rs.
 * All multi-byte values are little-endian to match Rust's to_le_bytes().
 */

// Message types (must match protocol/messages.rs)
export const MSG_INPUT = 0x01;
export const MSG_SNAPSHOT = 0x02;
export const MSG_EVENT = 0x10;
export const MSG_JOIN_REQUEST = 0x20;
export const MSG_JOIN_RESPONSE = 0x21;
export const MSG_RESPAWN = 0x33;

// Event types (must match crawlr/game.rs)
export const EVENT_PLAYER_JOINED = 0;
export const EVENT_PLAYER_LEFT = 1;
export const EVENT_PLAYER_DIED = 2;
export const EVENT_PLAYER_RESPAWNED = 3;
export const EVENT_SOUND = 4;
export const EVENT_PICKUP_SPAWN = 5;
export const EVENT_PICKUP_REMOVE = 6;
export const EVENT_PICKUP_BULK = 7;
export const EVENT_ROUND_END = 8;

/**
 * Encode a join request message (length-prefixed for reliable stream).
 * Wire: [MSG_JOIN_REQUEST:u8][name_len:u16 LE][name:utf8][room_len:u16 LE][room:utf8]
 * Returns the full length-prefixed message ready for stream writing.
 */
export function encodeJoinRequest(name, room) {
    const nameBytes = new TextEncoder().encode(name);
    const roomBytes = new TextEncoder().encode(room);
    const payloadLen = 1 + 2 + nameBytes.length + 2 + roomBytes.length;
    // Length prefix (u32 LE) + payload
    const buf = new ArrayBuffer(4 + payloadLen);
    const view = new DataView(buf);
    let offset = 0;

    // Length prefix
    view.setUint32(offset, payloadLen, true); offset += 4;

    // MSG_JOIN_REQUEST
    view.setUint8(offset, MSG_JOIN_REQUEST); offset += 1;

    // Name
    view.setUint16(offset, nameBytes.length, true); offset += 2;
    new Uint8Array(buf, offset, nameBytes.length).set(nameBytes);
    offset += nameBytes.length;

    // Room
    view.setUint16(offset, roomBytes.length, true); offset += 2;
    new Uint8Array(buf, offset, roomBytes.length).set(roomBytes);

    return new Uint8Array(buf);
}

/**
 * Decode a join response from a length-prefixed reliable stream message.
 * After stripping the 4-byte length prefix:
 * [MSG_JOIN_RESPONSE:u8][status:u8][player_id:u64 LE][payload...]
 * Payload (if present): [gravity:f32][speed:f32][runMultiplier:f32][jumpForce:f32][boundary:f32][roundDuration:f32]
 * @returns {{ status: number, playerId: number, payload: Uint8Array, serverSettings: object|null }}
 */
export function decodeJoinResponse(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const msgType = view.getUint8(0);
    if (msgType !== MSG_JOIN_RESPONSE) return null;

    const status = view.getUint8(1);
    // Read player_id as two u32s (low, high) since DataView has no getUint64
    const playerIdLow = view.getUint32(2, true);
    const playerIdHigh = view.getUint32(6, true);
    const playerId = playerIdLow + playerIdHigh * 0x100000000;
    const payload = data.slice(10);

    // Parse server physics settings from payload (6 × f32 = 24 bytes)
    let serverSettings = null;
    if (payload.byteLength >= 24) {
        const pv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        serverSettings = {
            gravity: pv.getFloat32(0, true),
            playerSpeed: pv.getFloat32(4, true),
            runMultiplier: pv.getFloat32(8, true),
            jumpForce: pv.getFloat32(12, true),
            boundary: pv.getFloat32(16, true),
            roundDuration: pv.getFloat32(20, true),
        };
    }

    return { status, playerId, payload, serverSettings };
}

/**
 * Encode player input as a datagram.
 * Wire: [MSG_INPUT:u8][tick:u32 LE][extra_len:u32 LE][extra:13 bytes]
 * Extra: [dx:f32 LE][dz:f32 LE][flags:u8][angle:f32 LE]
 */
export function encodeInput(tick, dx, dz, flags, angle) {
    const extraLen = 13;
    const totalLen = 1 + 4 + 4 + extraLen; // 22 bytes
    const buf = new ArrayBuffer(totalLen);
    const view = new DataView(buf);
    let offset = 0;

    view.setUint8(offset, MSG_INPUT); offset += 1;
    view.setUint32(offset, tick, true); offset += 4;
    view.setUint32(offset, extraLen, true); offset += 4;

    // Extra payload (PlayerInput)
    view.setFloat32(offset, dx, true); offset += 4;
    view.setFloat32(offset, dz, true); offset += 4;
    view.setUint8(offset, flags); offset += 1;
    view.setFloat32(offset, angle, true);

    return new Uint8Array(buf);
}

/**
 * Decode a snapshot datagram.
 * Wire: [MSG_SNAPSHOT:u8][tick:u32 LE][server_time:f64 LE][entity_count:u32 LE]
 *       [entities...][extra_len:u32 LE][extra...]
 * Entity: [id:u64 LE][x:f32][y:f32][z:f32][vx:f32][vy:f32][vz:f32][angle:f32][scale:f32][flags:u16]
 * @returns {{ tick, serverTime, entities[], extra }}
 */
export function decodeSnapshot(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    const msgType = view.getUint8(offset); offset += 1;
    if (msgType !== MSG_SNAPSHOT) return null;

    const tick = view.getUint32(offset, true); offset += 4;
    const serverTime = view.getFloat64(offset, true); offset += 8;
    const entityCount = view.getUint32(offset, true); offset += 4;

    const entities = [];
    for (let i = 0; i < entityCount; i++) {
        const idLow = view.getUint32(offset, true);
        const idHigh = view.getUint32(offset + 4, true);
        const id = idLow + idHigh * 0x100000000;
        offset += 8;

        const x = view.getFloat32(offset, true); offset += 4;
        const y = view.getFloat32(offset, true); offset += 4;
        const z = view.getFloat32(offset, true); offset += 4;
        const vx = view.getFloat32(offset, true); offset += 4;
        const vy = view.getFloat32(offset, true); offset += 4;
        const vz = view.getFloat32(offset, true); offset += 4;
        const angle = view.getFloat32(offset, true); offset += 4;
        const scale = view.getFloat32(offset, true); offset += 4;
        const flags = view.getUint16(offset, true); offset += 2;

        entities.push({ id, x, y, z, vx, vy, vz, angle, scale, flags });
    }

    const extraLen = view.getUint32(offset, true); offset += 4;
    const extra = data.slice(offset, offset + extraLen);

    return { tick, serverTime, entities, extra };
}

/**
 * Decode the snapshot extra bytes (versioned format).
 * v1: [version:u8][pickup_count:u16 LE]...
 * v0 (legacy, no version byte): [pickup_count:u16 LE]...
 */
export function decodeSnapshotExtra(data) {
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
    // Legacy v0 starts with pickup_count:u16, which is typically 0x0000.
    const firstByte = view.getUint8(0);
    if (firstByte >= 1 && firstByte <= 127) {
        // Versioned format — skip the version byte
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

/**
 * Decode a reliable event message.
 * Wire: [MSG_EVENT:u8][event_type:u8][tick:u32 LE][player_id:u64 LE][payload_len:u32 LE][payload...]
 */
export function decodeEvent(data) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    const msgType = view.getUint8(offset); offset += 1;
    if (msgType !== MSG_EVENT) return null;

    const eventType = view.getUint8(offset); offset += 1;
    const tick = view.getUint32(offset, true); offset += 4;
    const idLow = view.getUint32(offset, true);
    const idHigh = view.getUint32(offset + 4, true);
    const playerId = idLow + idHigh * 0x100000000;
    offset += 8;
    const payloadLen = view.getUint32(offset, true); offset += 4;
    const payload = data.slice(offset, offset + payloadLen);

    return { eventType, tick, playerId, payload };
}

/**
 * Stateful length-prefixed reader that preserves leftover bytes between calls.
 * QUIC streams may deliver multiple messages in a single chunk; this class
 * ensures no bytes are lost between consecutive read() calls.
 */
export class LengthPrefixedReader {
    constructor(reader) {
        this._reader = reader;
        this._pending = new Uint8Array(0);
    }

    /** Read one length-prefixed message. Returns Uint8Array or null on EOF. */
    async read() {
        // Read 4-byte length prefix
        if (!await this._ensure(4)) return null;
        const len = new DataView(
            this._pending.buffer, this._pending.byteOffset, 4
        ).getUint32(0, true);
        this._pending = this._pending.subarray(4);
        if (len > 1024 * 1024) return null;

        // Read payload
        if (!await this._ensure(len)) return null;
        const payload = this._pending.slice(0, len);
        this._pending = this._pending.subarray(len);
        return payload;
    }

    async _ensure(n) {
        while (this._pending.length < n) {
            const { value, done } = await this._reader.read();
            if (done) return false;
            const chunk = new Uint8Array(value);
            const merged = new Uint8Array(this._pending.length + chunk.length);
            merged.set(this._pending, 0);
            merged.set(chunk, this._pending.length);
            this._pending = merged;
        }
        return true;
    }
}

/**
 * Encode a respawn request (1 byte, server identifies player from stream).
 * @returns {Uint8Array}
 */
export function encodeRespawnRequest() {
    return new Uint8Array([MSG_RESPAWN]);
}

/**
 * Read a length-prefixed message from a readable stream reader.
 * @deprecated Use LengthPrefixedReader for multi-message streams.
 */
export async function readLengthPrefixed(reader) {
    const r = new LengthPrefixedReader(reader);
    return r.read();
}
