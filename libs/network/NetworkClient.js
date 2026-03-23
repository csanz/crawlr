/**
 * @module NetworkClient
 * WebTransport client for connecting to the crawlr-game-engine.
 * Handles connection lifecycle, join handshake, input sending, and snapshot receiving.
 */
import { createLogger } from '../Logger.js';
import {
    encodeJoinRequest,
    encodeInput,
    decodeJoinResponse,
    decodeSnapshot,
    decodeEvent,
    LengthPrefixedReader,
} from './Protocol.js';

const log = createLogger('NetworkClient');

export class NetworkClient {
    constructor() {
        this.transport = null;
        this.sendStream = null;
        this.recvStream = null;
        this.playerId = null;
        this.connected = false;
        this.tick = 0;

        this._snapshotCallback = null;
        this._eventCallback = null;
        this._disconnectCallback = null;
        this._datagramReaderTask = null;
        this._reliableReaderTask = null;
    }

    /**
     * Connect to the game server.
     * @param {string} url - WebTransport server URL (e.g., "https://localhost:4433")
     */
    async connect(url) {
        log.info(`Connecting to ${url}...`);
        try {
            // Fetch the server's self-signed certificate hash so the browser
            // can trust it via serverCertificateHashes (no OS-level trust needed).
            const options = {};
            const certHashes = await this._fetchCertHash(url);
            if (certHashes) {
                options.serverCertificateHashes = certHashes;
                log.info('Using serverCertificateHashes for self-signed cert');
            }

            this.transport = new WebTransport(url, options);
            await this.transport.ready;
            this.connected = true;
            log.info('WebTransport connected');

            // Listen for connection close
            this.transport.closed.then(() => {
                log.info('Transport closed');
                this.connected = false;
                if (this._disconnectCallback) this._disconnectCallback();
            }).catch(err => {
                log.warn('Transport closed with error:', err);
                this.connected = false;
                if (this._disconnectCallback) this._disconnectCallback();
            });
        } catch (err) {
            log.error('Failed to connect:', err);
            throw err;
        }
    }

    /**
     * Fetch the server's certificate SHA-256 hash from the companion HTTP endpoint.
     * The engine serves this on (WebTransport port + 1).
     * @param {string} serverUrl - The WebTransport URL (https://host:port)
     * @returns {Array|null} serverCertificateHashes array or null
     */
    async _fetchCertHash(serverUrl) {
        try {
            const url = new URL(serverUrl);
            const hashPort = parseInt(url.port) + 1;
            const hashUrl = `http://${url.hostname}:${hashPort}`;
            log.info(`Fetching cert hash from ${hashUrl}...`);

            const response = await fetch(hashUrl);
            const hashArray = await response.json();
            const hashBytes = new Uint8Array(hashArray);

            if (hashBytes.length !== 32) {
                log.warn(`Unexpected cert hash length: ${hashBytes.length}`);
                return null;
            }

            log.info('Got certificate hash:', Array.from(hashBytes).map(b => b.toString(16).padStart(2, '0')).join(':'));
            return [{
                algorithm: 'sha-256',
                value: hashBytes.buffer,
            }];
        } catch (err) {
            log.warn('Could not fetch cert hash (may not need it for trusted certs):', err.message);
            return null;
        }
    }

    /**
     * Send join request and wait for response.
     * @param {string} name - Player display name
     * @param {string} room - Room ID to join
     * @returns {{ status: number, playerId: number, payload: Uint8Array }}
     */
    async sendJoinRequest(name, room) {
        // Open a bidirectional stream for the handshake
        const bidi = await this.transport.createBidirectionalStream();
        const writer = bidi.writable.getWriter();
        const rawReader = bidi.readable.getReader();

        // Create a stateful reader that preserves leftover bytes between reads.
        // This is critical: the server may send the join response and the
        // PICKUP_BULK event in the same QUIC chunk, so we must not lose bytes.
        const lpReader = new LengthPrefixedReader(rawReader);

        // Send join request
        const joinMsg = encodeJoinRequest(name, room);
        await writer.write(joinMsg);
        log.info(`Sent join request: name="${name}", room="${room}"`);

        // Read join response (length-prefixed)
        const responseData = await lpReader.read();
        if (!responseData) {
            throw new Error('No join response received');
        }

        const response = decodeJoinResponse(responseData);
        if (!response) {
            throw new Error('Invalid join response');
        }

        if (response.status === 0) {
            this.playerId = response.playerId;
            log.info(`Join accepted! Player ID: ${this.playerId}`);

            // Keep the stream open for reliable messages.
            // Reuse the same LengthPrefixedReader so any bytes already buffered
            // from the join response chunk are not lost.
            this._lpReader = lpReader;
            this._reliableWriter = writer;

            // Start reading reliable events
            this._startReliableReader();
        } else {
            log.warn('Join rejected');
        }

        return response;
    }

    /**
     * Send a reliable message to the server via the bidi stream.
     * @param {Uint8Array} data
     */
    sendReliable(data) {
        if (!this.connected || !this._reliableWriter) return;
        try {
            // Length-prefixed: [len:u32 LE][data]
            const frame = new Uint8Array(4 + data.length);
            const view = new DataView(frame.buffer);
            view.setUint32(0, data.length, true);
            frame.set(data, 4);
            this._reliableWriter.write(frame);
        } catch (err) {
            // Ignore write errors
        }
    }

    /**
     * Send player input as an unreliable datagram.
     */
    sendInput(dx, dz, flags, angle) {
        if (!this.connected || !this.transport) return;

        this.tick++;
        const data = encodeInput(this.tick, dx, dz, flags, angle);

        try {
            const writer = this.transport.datagrams.writable.getWriter();
            writer.write(data);
            writer.releaseLock();
        } catch (err) {
            // Datagram send can fail silently (unreliable)
        }
    }

    /**
     * Register a callback for incoming snapshots.
     * @param {function} callback - Called with decoded snapshot data
     */
    onSnapshot(callback) {
        this._snapshotCallback = callback;
        this._startDatagramReader();
    }

    /**
     * Register a callback for incoming reliable events.
     * @param {function} callback - Called with decoded event data
     */
    onEvent(callback) {
        this._eventCallback = callback;
    }

    /**
     * Register a callback for disconnect.
     * @param {function} callback
     */
    onDisconnect(callback) {
        this._disconnectCallback = callback;
    }

    /**
     * Start reading datagrams (snapshots from server).
     */
    _startDatagramReader() {
        if (this._datagramReaderTask) return;

        const reader = this.transport.datagrams.readable.getReader();
        this._datagramReaderTask = (async () => {
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;

                    const data = new Uint8Array(value);
                    const snapshot = decodeSnapshot(data);
                    if (snapshot && this._snapshotCallback) {
                        this._snapshotCallback(snapshot);
                    }
                }
            } catch (err) {
                log.debug('Datagram reader ended:', err.message);
            }
        })();
    }

    /**
     * Start reading reliable events from the bidi stream.
     */
    _startReliableReader() {
        if (!this._lpReader) return;

        this._reliableReaderTask = (async () => {
            try {
                while (true) {
                    const data = await this._lpReader.read();
                    if (!data) break;

                    const event = decodeEvent(data);
                    if (event && this._eventCallback) {
                        this._eventCallback(event);
                    }
                }
            } catch (err) {
                log.debug('Reliable reader ended:', err.message);
            }
        })();
    }

    /**
     * Disconnect from the server.
     */
    disconnect() {
        if (this.transport) {
            try {
                this.transport.close();
            } catch (e) { /* ignore */ }
            this.transport = null;
        }
        this.connected = false;
        this.playerId = null;
    }
}
