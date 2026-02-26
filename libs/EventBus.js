/**
 * @module EventBus
 * Simple pub/sub event system. Multiplayer-ready — a future network layer
 * can subscribe to any event and relay it to other clients.
 */

class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    /**
     * Subscribe to an event.
     * @param {string} event
     * @param {Function} fn
     */
    on(event, fn) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(fn);
    }

    /**
     * Unsubscribe from an event.
     * @param {string} event
     * @param {Function} fn
     */
    off(event, fn) {
        const fns = this.listeners.get(event);
        if (!fns) return;
        const idx = fns.indexOf(fn);
        if (idx !== -1) fns.splice(idx, 1);
    }

    /**
     * Emit an event with a payload.
     * @param {string} event
     * @param {Object} payload
     */
    emit(event, payload) {
        const fns = this.listeners.get(event);
        if (!fns) return;
        for (let i = 0; i < fns.length; i++) {
            fns[i](payload);
        }
    }
}

export const eventBus = new EventBus();
