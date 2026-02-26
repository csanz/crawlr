/**
 * @module RoundManager
 * Central round lifecycle manager. Tracks countdown timer, emits round events,
 * and computes end-of-round rankings from entity data.
 */
import { eventBus } from './EventBus.js';
import { ROUND_DURATION } from './PhysicsConfig.js';

export class RoundManager {
    /**
     * @param {number} [duration] - Round length in seconds (default from PhysicsConfig)
     */
    constructor(duration) {
        this.duration = duration || ROUND_DURATION;
        this.remaining = this.duration;
        this.active = false;
        this.roundNumber = 0;
        this._warningSent = false;
        this._entities = null; // set externally each frame or at round end
    }

    /**
     * Begin a new round countdown.
     */
    start() {
        this.roundNumber++;
        this.remaining = this.duration;
        this.active = true;
        this._warningSent = false;
        eventBus.emit('round:start', { roundNumber: this.roundNumber, duration: this.duration });
    }

    /**
     * Called each frame from GameLoop.
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        if (!this.active) return;

        this.remaining -= dt;

        // Warning at 30 seconds
        if (!this._warningSent && this.remaining <= 30) {
            this._warningSent = true;
            eventBus.emit('round:warning', { remaining: this.remaining });
        }

        // Round ended
        if (this.remaining <= 0) {
            this.remaining = 0;
            this.active = false;
            const rankings = this._entities ? this.getRankings(this._entities) : [];
            eventBus.emit('round:end', {
                roundNumber: this.roundNumber,
                rankings
            });
        }
    }

    /**
     * @returns {number} Seconds left in current round
     */
    getRemainingTime() {
        return Math.max(0, this.remaining);
    }

    /**
     * @returns {boolean} True if a round is in progress
     */
    isRoundActive() {
        return this.active;
    }

    /**
     * Prepare for next round (called before start).
     */
    reset() {
        this.remaining = this.duration;
        this.active = false;
        this._warningSent = false;
    }

    /**
     * Change round duration.
     * @param {number} seconds
     */
    setDuration(seconds) {
        this.duration = seconds;
        // Also update the current round's remaining time
        if (this.active) {
            this.remaining = seconds;
            this._warningSent = false;
        }
    }

    /**
     * Store entity references for ranking at round end.
     * @param {Array} entities - Array of { id, tailLength, size, color, alive }
     */
    setEntities(entities) {
        this._entities = entities;
    }

    /**
     * Sort entities by score (same formula as PlayerList), return top 3.
     * @param {Array} entities
     * @returns {Array<{id, name, size, tailLength, score, rank}>}
     */
    getRankings(entities) {
        const ranked = entities
            .map(e => ({
                id: e.id,
                size: e.size,
                tailLength: e.tailLength,
                score: e.tailLength + Math.round((e.size - 1) * 10),
                color: e.color
            }))
            .sort((a, b) => b.score - a.score);

        return ranked.slice(0, 3).map((e, i) => ({
            ...e,
            rank: i + 1
        }));
    }
}
