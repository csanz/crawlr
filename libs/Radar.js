/**
 * @module Radar
 * Draws a circular mini-map overlay showing the player and nearby entities.
 */
import { GROUND_SIZE_VISUAL } from './PhysicsConfig.js';

// Cache canvas reference and context - avoid DOM lookup every frame
let _radarCanvas = null;
let _radarCtx = null;

/**
 * Draws the radar showing player position and nearby entities.
 * @param {THREE.Vector3} currentPlayer - Current player position
 * @param {Array} others - Array of objects with x, z, color, and type properties
 */
export function drawRadar(currentPlayer, others) {
    if (!_radarCanvas) {
        _radarCanvas = document.getElementById('radar');
        if (!_radarCanvas) return;
        _radarCtx = _radarCanvas.getContext('2d');
    }

    const ctx = _radarCtx;
    const radarSize = _radarCanvas.width;
    const radarRadius = radarSize / 2;
    const radarScale = radarSize / (GROUND_SIZE_VISUAL * 1.2);

    // Clear the radar
    ctx.clearRect(0, 0, radarSize, radarSize);

    // Draw background
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.beginPath();
    ctx.arc(radarRadius, radarRadius, radarRadius, 0, 2 * Math.PI);
    ctx.fill();

    // Draw radar grid
    ctx.strokeStyle = "rgba(0, 255, 0, 0.2)";
    ctx.lineWidth = 1;

    for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(radarRadius, radarRadius, radarRadius * i / 3, 0, 2 * Math.PI);
        ctx.stroke();
    }

    // Draw crosshairs
    ctx.beginPath();
    ctx.moveTo(radarRadius, 0);
    ctx.lineTo(radarRadius, radarSize);
    ctx.moveTo(0, radarRadius);
    ctx.lineTo(radarSize, radarRadius);
    ctx.stroke();

    // Draw ground boundary
    const halfGroundSize = GROUND_SIZE_VISUAL / 2;
    const groundCorners = [
        { x: -halfGroundSize, z: -halfGroundSize },
        { x: halfGroundSize, z: -halfGroundSize },
        { x: halfGroundSize, z: halfGroundSize },
        { x: -halfGroundSize, z: halfGroundSize }
    ];

    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < groundCorners.length; i++) {
        const dx = (groundCorners[i].x - currentPlayer.x) * radarScale;
        const dz = (groundCorners[i].z - currentPlayer.z) * radarScale;
        if (i === 0) ctx.moveTo(radarRadius + dx, radarRadius + dz);
        else ctx.lineTo(radarRadius + dx, radarRadius + dz);
    }
    ctx.closePath();
    ctx.stroke();

    // Draw self (center)
    ctx.fillStyle = "lime";
    ctx.beginPath();
    ctx.arc(radarRadius, radarRadius, 5, 0, 2 * Math.PI);
    ctx.fill();

    // Draw all entities in a single pass (no double-draw for coins)
    const time = performance.now() * 0.001;
    const coinPulseScale = 0.7 + Math.sin(time * 3) * 0.3;

    for (let i = 0; i < others.length; i++) {
        const obj = others[i];
        const dx = (obj.x - currentPlayer.x) * radarScale;
        const dz = (obj.z - currentPlayer.z) * radarScale;

        if (dx * dx + dz * dz < radarRadius * radarRadius) {
            if (obj.type === 'coin') {
                ctx.fillStyle = "rgba(255, 255, 0, 0.7)";
                ctx.beginPath();
                ctx.arc(radarRadius + dx, radarRadius + dz, 2 * coinPulseScale, 0, 2 * Math.PI);
                ctx.fill();
            } else if (obj.type === 'ring') {
                // Diamond shape for power rings
                const rx = radarRadius + dx;
                const rz = radarRadius + dz;
                const s = 3.5;
                ctx.fillStyle = obj.color || '#ffffff';
                ctx.beginPath();
                ctx.moveTo(rx, rz - s);
                ctx.lineTo(rx + s, rz);
                ctx.lineTo(rx, rz + s);
                ctx.lineTo(rx - s, rz);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1;
                ctx.stroke();
            } else {
                ctx.fillStyle = obj.color || 'red';
                ctx.beginPath();
                ctx.arc(radarRadius + dx, radarRadius + dz, 3, 0, 2 * Math.PI);
                ctx.fill();
            }
        }
    }
}
