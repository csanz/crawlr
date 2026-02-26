/**
 * @module SprintHUD
 * Draws a tail-segment fuel bar for the sprint ability with tier/level indicator.
 * Bar fills proportionally within the current tier. Shows "Lv.X" and "LEVEL UP!" on tier transitions.
 * Uses a 2D canvas overlay — zero 3D/GPU overhead.
 */
import { TAIL_MAX_SEGMENTS } from './PhysicsConfig.js';

let canvas = null;
let ctx = null;

const WIDTH = 160;
const HEIGHT = 28;
const BAR_X = 8;
const BAR_Y = 16;
const BAR_W = WIDTH - 16;
const BAR_H = 8;
const CORNER_R = 4;

// Tier tracking for level-up effect
let lastTier = 1;
let levelUpTimer = 0;
const LEVEL_UP_DURATION = 1.5; // seconds

/**
 * Creates and appends the sprint HUD canvas.
 */
export function initSprintHUD() {
    canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    canvas.style.cssText = 'position:absolute; top:10px; right:10px; z-index:100; pointer-events:none;';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
}

/**
 * Draws a rounded rectangle path.
 */
function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

/**
 * Draws the sprint fuel bar with tier indicator.
 * @param {object} state - Sprint state from getSprintState()
 */
export function drawSprintHUD(state) {
    if (!ctx) return;

    const dt = 1 / 60; // approximate frame time
    const scale = state.playerScale || 1.0;
    const currentTier = Math.floor(scale);

    // Detect tier transition
    if (currentTier > lastTier) {
        levelUpTimer = LEVEL_UP_DURATION;
    }
    lastTier = currentTier;

    if (levelUpTimer > 0) {
        levelUpTimer -= dt;
    }

    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    // Label
    ctx.fillStyle = state.isActive ? '#ffffff'
        : state.isEmpty ? 'rgba(255,255,255,0.35)'
        : 'rgba(255,255,255,0.6)';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('SHIFT', BAR_X, 2);

    // Segment count (center-ish)
    ctx.textAlign = 'center';
    ctx.fillStyle = state.isActive ? '#00ffcc' : 'rgba(255,255,255,0.5)';
    ctx.fillText(`${state.tailLength}`, WIDTH / 2, 2);

    // Tier/Level display (right-aligned)
    ctx.textAlign = 'right';
    if (levelUpTimer > 0) {
        // Gold flash during level-up
        const flash = Math.sin(levelUpTimer * 8) * 0.3 + 0.7;
        ctx.fillStyle = `rgba(255,215,0,${flash})`;
        ctx.font = 'bold 10px monospace';
        ctx.fillText('LEVEL UP!', WIDTH - 8, 2);
    } else {
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold 10px monospace';
        ctx.fillText(`Lv.${currentTier}`, WIDTH - 8, 2);
    }

    // Bar background
    roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, CORNER_R);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fill();

    // Border — pulses red when empty and shift held, gold flash on level-up
    if (levelUpTimer > 0) {
        const flash = Math.sin(levelUpTimer * 8) * 0.3 + 0.7;
        ctx.strokeStyle = `rgba(255,215,0,${flash})`;
        ctx.lineWidth = 2;
    } else if (state.isEmpty && state.sprintHeld) {
        const pulse = 0.3 + Math.sin(performance.now() * 0.008) * 0.2;
        ctx.strokeStyle = `rgba(255,68,68,${pulse})`;
        ctx.lineWidth = 1.5;
    } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
    }
    ctx.stroke();

    // Fill bar — shows progress within current tier
    const tierProgress = scale - currentTier; // 0..1 progress within tier
    const fraction = Math.min(state.tailLength / TAIL_MAX_SEGMENTS, 1);
    // When sprinting, show the burn progress eating into the current segment
    const burnAdjust = state.isActive ? (state.burnProgress / TAIL_MAX_SEGMENTS) : 0;
    const fillFraction = Math.max(0, fraction - burnAdjust);

    // Use tier progress for the bar fill (so it resets each tier)
    const tierFillW = BAR_W * tierProgress;
    const segmentFillW = BAR_W * fillFraction;

    // Draw tier progress as background
    if (tierFillW > 0) {
        ctx.save();
        roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, CORNER_R);
        ctx.clip();

        ctx.fillStyle = 'rgba(255,215,0,0.15)';
        ctx.fillRect(BAR_X, BAR_Y, tierFillW, BAR_H);
        ctx.restore();
    }

    // Draw segment fill on top
    if (segmentFillW > 0) {
        ctx.save();
        roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, CORNER_R);
        ctx.clip();

        // Color based on fuel level
        let color;
        if (fraction > 0.5) {
            color = '#00ffcc';
        } else if (fraction > 0.25) {
            color = '#ffcc00';
        } else {
            color = '#ff4444';
        }

        ctx.fillStyle = color;
        ctx.fillRect(BAR_X, BAR_Y, segmentFillW, BAR_H);

        // Pulse glow when actively sprinting
        if (state.isActive) {
            const pulse = 0.15 + Math.sin(performance.now() * 0.008) * 0.1;
            ctx.fillStyle = `rgba(255,255,255,${pulse})`;
            ctx.fillRect(BAR_X, BAR_Y, segmentFillW, BAR_H);
        }

        ctx.restore();
    }
}
