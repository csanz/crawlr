/**
 * @module NetworkManager
 * Bridges the network layer (NetworkClient) with the game state.
 * Handles: input sending, snapshot interpolation, event dispatch, pickup sync.
 */
import { createLogger } from '../Logger.js';
import { NetworkClient } from './NetworkClient.js';
import { decodeSnapshotExtra, encodeRespawnRequest, EVENT_PLAYER_JOINED, EVENT_PLAYER_LEFT, EVENT_PLAYER_DIED, EVENT_PLAYER_RESPAWNED, EVENT_SOUND, EVENT_PICKUP_SPAWN, EVENT_PICKUP_REMOVE, EVENT_PICKUP_BULK, EVENT_ROUND_END } from './Protocol.js';
import { eventBus } from '../EventBus.js';
import { playSpatialEffect, playSpatialSound } from '../Sound.js';

const log = createLogger('NetworkManager');

/** Number of snapshots to buffer for interpolation. */
const SNAPSHOT_BUFFER_SIZE = 3;

/** Interpolation delay in seconds (one tick at 20Hz). */
const INTERP_DELAY = 0.05;

export class NetworkManager {
    /**
     * @param {string} serverUrl - WebTransport server URL
     */
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
        this.client = new NetworkClient();
        this.localPlayerId = null;
        this.connected = false;

        // Snapshot interpolation buffer: ring buffer of last N snapshots
        this._snapshots = [];
        /** Latest server tick number (increments each time a new snapshot arrives) */
        this.latestTick = 0;

        // Latest decoded extra data (pickups, scores, weather, lightning, roundRemaining)
        this.latestExtra = {
            pickups: [], scores: [], roundRemaining: 600,
            weatherState: 0, stormRemaining: 0, lightning: [], puddles: [],
        };

        // Map of remote entity states for rendering
        // entityId -> { x, y, z, vx, vy, vz, angle, scale, flags }
        this.remoteEntities = new Map();

        // Track which entity IDs we've seen (for join/leave detection)
        this._knownEntities = new Set();

        // Pickup state from reliable stream events (replaces snapshot-based pickups)
        // Map<id, { id, type, x, y, z, vy, grounded }>
        this.pickupMap = new Map();

        // Server physics settings (received in join response payload).
        // Client prediction uses these instead of hardcoded values.
        this.serverSettings = null;
    }

    /**
     * Connect to server and join a room.
     * @param {string} playerName
     * @param {string} roomId
     * @returns {Promise<boolean>} true if join succeeded
     */
    async connect(playerName, roomId = 'default') {
        try {
            await this.client.connect(this.serverUrl);
            const response = await this.client.sendJoinRequest(playerName, roomId);

            if (response.status !== 0) {
                log.warn('Join rejected');
                this.lastError = 'Server rejected join request';
                return false;
            }

            this.localPlayerId = response.playerId;
            this.connected = true;
            this.serverSettings = response.serverSettings;

            // Register snapshot handler
            this.client.onSnapshot((snapshot) => this._onSnapshot(snapshot));

            // Register event handler
            this.client.onEvent((event) => this._onEvent(event));

            // Register disconnect handler
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

    /**
     * Send the current input state to the server.
     * @param {number} dx - Movement direction X (-1..1)
     * @param {number} dz - Movement direction Z (-1..1)
     * @param {number} flags - Bit flags (bit0=sprint, bit1=jump)
     * @param {number} angle - Facing angle in radians
     */
    sendInput(dx, dz, flags, angle) {
        if (!this.connected) return;
        this.client.sendInput(dx, dz, flags, angle);
    }

    /**
     * Send a pickup collection request to the server.
     * @param {number} pickupId - The pickup ID to collect
     */
    sendCollectRequest(pickupId) {
        if (!this.connected) return;
        // Wire format: [MSG_COLLECT:u8][pickup_id:u32 LE]
        const data = new Uint8Array(5);
        const view = new DataView(data.buffer);
        view.setUint8(0, 0x30); // MSG_COLLECT
        view.setUint32(1, pickupId, true);
        this.client.sendReliable(data);
    }

    /**
     * Send a respawn request to the server (after death screen).
     */
    sendRespawnRequest() {
        if (!this.connected) return;
        this.client.sendReliable(encodeRespawnRequest());
    }

    /**
     * Handle incoming snapshot from server.
     */
    _onSnapshot(snapshot) {
        // Buffer the snapshot
        this._snapshots.push(snapshot);
        if (this._snapshots.length > SNAPSHOT_BUFFER_SIZE) {
            this._snapshots.shift();
        }
        this.latestTick = snapshot.tick;

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
                // Use displayName from score data (decoded above)
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

    /**
     * Handle incoming reliable event from server.
     */
    _onEvent(event) {
        switch (event.eventType) {
            case EVENT_PLAYER_JOINED:
                log.info(`Player ${event.playerId} joined`);
                // Don't create a remote mesh for ourselves
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
                // Payload contains killer_id as u64 LE
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
                break;

            case EVENT_PICKUP_SPAWN: {
                // Payload: [id:u32 LE][type:u8][x:f32 LE][y:f32 LE][z:f32 LE]
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
                // Payload: [id:u32 LE]
                if (!event.payload || event.payload.byteLength < 4) break;
                const rmView = new DataView(event.payload.buffer, event.payload.byteOffset, event.payload.byteLength);
                const rmId = rmView.getUint32(0, true);
                this.pickupMap.delete(rmId);
                break;
            }

            case EVENT_PICKUP_BULK: {
                // Payload: [count:u16 LE][id:u32][type:u8][x:f32][y:f32][z:f32]...
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
                    // Rings are always grounded (they float); others: grounded if y <= 0.5
                    this.pickupMap.set(id, { id, type: type_, x, y, z, vy: 0, grounded: type_ === 3 || y <= 0.5 });
                }
                break;
            }

            case EVENT_ROUND_END: {
                // Payload: [round_number:u32][count:u8][per-entity: player_id:u64, score:u32, tail_length:u16, scale:f32, name_len:u8, name:utf8]
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
                    // Deterministic color from entity ID (same formula as RemotePlayer)
                    const hue = (id * 137.508) % 360 / 360;
                    const color = `hsl(${Math.round(hue * 360)}, 70%, 55%)`;
                    rankings.push({ id, score, tailLength, size: scale, color, name });
                }
                log.info(`Round ${roundNumber} ended, ${rankings.length} rankings`);
                eventBus.emit('round:end', { roundNumber, rankings });
                break;
            }

            case EVENT_SOUND: {
                // Payload: [name_len:u8][name:utf8][x:f32 LE][z:f32 LE]
                if (!event.payload || event.payload.byteLength < 1) break;
                const pView = new DataView(event.payload.buffer, event.payload.byteOffset, event.payload.byteLength);
                const nameLen = pView.getUint8(0);
                if (event.payload.byteLength < 1 + nameLen + 8) break;
                const nameBytes = new Uint8Array(event.payload.buffer, event.payload.byteOffset + 1, nameLen);
                const soundName = new TextDecoder().decode(nameBytes);
                const sx = pView.getFloat32(1 + nameLen, true);
                const sz = pView.getFloat32(1 + nameLen + 4, true);

                // Play spatial sound — try registered effect first, fall back to raw sound name
                const handle = playSpatialEffect(soundName, sx, sz);
                if (!handle) {
                    playSpatialSound(soundName, 0.3, sx, sz);
                }

                // Emit on eventBus for debug stream view
                eventBus.emit('network:sound', { soundName, x: sx, z: sz, playerId: event.playerId });
                break;
            }
        }
    }

    /**
     * Get the interpolated state for a remote entity.
     * Uses time-based interpolation between the two most recent snapshots,
     * with velocity extrapolation when rendering ahead of the latest snapshot.
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

        // Simple lerp with t=0.5 (halfway between two snapshots)
        const t = 0.5;

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

    /**
     * Get the local player's state from the latest snapshot.
     */
    getLocalPlayerState() {
        return this.remoteEntities.get(this.localPlayerId) || null;
    }

    /**
     * Get all remote entity IDs (excluding local player).
     */
    getRemoteEntityIds() {
        const ids = [];
        for (const id of this.remoteEntities.keys()) {
            if (id !== this.localPlayerId) {
                ids.push(id);
            }
        }
        return ids;
    }

    disconnect() {
        this.client.disconnect();
        this.connected = false;
    }
}
