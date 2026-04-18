/**
 * @module FriendFinder
 * X-ray style friend highlighting — shows human players through walls
 * with glowing outlines that conform to the player's 3D shape.
 */
import * as THREE from 'three';

let _canvas = null;
let _ctx = null;
const _projected = new THREE.Vector3();
const _distVec = new THREE.Vector3();
const _cornerVec = new THREE.Vector3();

// 8 corners of a unit cube centered at origin
const CUBE_CORNERS = [
    [-0.5, -0.5, -0.5], [-0.5, -0.5,  0.5],
    [-0.5,  0.5, -0.5], [-0.5,  0.5,  0.5],
    [ 0.5, -0.5, -0.5], [ 0.5, -0.5,  0.5],
    [ 0.5,  0.5, -0.5], [ 0.5,  0.5,  0.5],
];

// Edges of a cube (pairs of corner indices)
const CUBE_EDGES = [
    [0,1],[2,3],[4,5],[6,7], // z-axis edges
    [0,2],[1,3],[4,6],[5,7], // y-axis edges
    [0,4],[1,5],[2,6],[3,7], // x-axis edges
];

function ensureCanvas() {
    if (_canvas) return;
    _canvas = document.createElement('canvas');
    _canvas.id = 'friend-finder';
    _canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:999;';
    document.body.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');
}

/**
 * Project a 3D point to screen coordinates.
 * Returns { x, y, behind } where behind=true if the point is behind the camera.
 */
function projectToScreen(point, camera, w, h) {
    _cornerVec.copy(point);
    _cornerVec.project(camera);
    return {
        x: ((_cornerVec.x + 1) / 2) * w,
        y: ((1 - _cornerVec.y) / 2) * h,
        behind: _cornerVec.z > 1,
    };
}

/**
 * Draw X-ray friend indicators on screen.
 * @param {THREE.PerspectiveCamera} camera
 * @param {Map} remotePlayerMeshes - entityId -> THREE.Mesh
 * @param {boolean} active - Whether friend finder is toggled on
 */
export function drawFriendIndicators(camera, remotePlayerMeshes, active) {
    if (!active) {
        if (_canvas) _canvas.style.display = 'none';
        return;
    }

    ensureCanvas();
    _canvas.style.display = 'block';

    const w = window.innerWidth;
    const h = window.innerHeight;
    if (_canvas.width !== w || _canvas.height !== h) {
        _canvas.width = w;
        _canvas.height = h;
    }

    const ctx = _ctx;
    ctx.clearRect(0, 0, w, h);

    const time = performance.now() * 0.001;
    const pulse = 0.7 + Math.sin(time * 4) * 0.3;

    for (const [entityId, mesh] of remotePlayerMeshes) {
        if (!mesh.visible) continue;
        if (mesh.userData.isBot) continue;

        const name = mesh.userData.displayName || `Player ${entityId}`;
        const color = mesh.userData.glowColor
            ? '#' + mesh.userData.glowColor.getHexString()
            : '#00ffcc';

        const dist = _distVec.copy(mesh.position).sub(camera.position).length();
        const distText = Math.round(dist) + 'm';

        // Project mesh center to check if on screen
        _projected.copy(mesh.position);
        _projected.project(camera);
        const centerSx = ((_projected.x + 1) / 2) * w;
        const centerSy = ((1 - _projected.y) / 2) * h;
        const behind = _projected.z > 1;

        const margin = 50;
        const onScreen = !behind && centerSx >= -50 && centerSx <= w + 50 && centerSy >= -50 && centerSy <= h + 50;

        if (onScreen) {
            // Project all 8 corners of the player's bounding box
            const scale = mesh.scale.x || 1;
            const screenCorners = [];
            let anyBehind = false;

            for (const [cx, cy, cz] of CUBE_CORNERS) {
                // Scale corners by mesh scale, then transform to world space
                _cornerVec.set(cx * scale, cy * scale, cz * scale);
                _cornerVec.applyQuaternion(mesh.quaternion);
                _cornerVec.add(mesh.position);

                const sc = projectToScreen(_cornerVec, camera, w, h);
                screenCorners.push(sc);
                if (sc.behind) anyBehind = true;
            }

            if (!anyBehind) {
                ctx.save();
                ctx.shadowColor = color;
                ctx.shadowBlur = 12 * pulse;
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.globalAlpha = 0.8 * pulse;

                // Draw all 12 edges of the cube
                for (const [i, j] of CUBE_EDGES) {
                    const a = screenCorners[i];
                    const b = screenCorners[j];
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                    ctx.stroke();
                }

                // Name tag above the top of the projected box
                let minY = Infinity;
                let avgX = 0;
                for (const sc of screenCorners) {
                    if (sc.y < minY) minY = sc.y;
                    avgX += sc.x;
                }
                avgX /= screenCorners.length;

                ctx.shadowBlur = 6;
                ctx.font = 'bold 13px monospace';
                ctx.textAlign = 'center';
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.95;
                ctx.fillText(name, avgX, minY - 10);

                ctx.font = '10px monospace';
                ctx.globalAlpha = 0.6;
                ctx.fillText(distText, avgX, minY - 24);

                ctx.restore();
            }
        } else {
            // Off-screen: arrow at screen edge
            let ex = centerSx;
            let ey = centerSy;

            if (behind) {
                ex = w - centerSx;
                ey = h - centerSy;
            }

            ex = Math.max(margin, Math.min(w - margin, ex));
            ey = Math.max(margin, Math.min(h - margin, ey));

            const angle = Math.atan2(
                (behind ? h - centerSy : centerSy) - ey,
                (behind ? w - centerSx : centerSx) - ex
            );

            ctx.save();
            ctx.translate(ex, ey);

            ctx.shadowColor = color;
            ctx.shadowBlur = 12 * pulse;
            ctx.globalAlpha = pulse;
            ctx.fillStyle = color;

            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(14, 0);
            ctx.lineTo(-6, -8);
            ctx.lineTo(-3, 0);
            ctx.lineTo(-6, 8);
            ctx.closePath();
            ctx.fill();
            ctx.rotate(-angle);

            ctx.font = 'bold 11px monospace';
            ctx.textAlign = 'center';
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.9;
            ctx.fillText(name, 0, -16);
            ctx.font = '10px monospace';
            ctx.globalAlpha = 0.7;
            ctx.fillText(distText, 0, 18);

            ctx.restore();
        }
    }
}

export function disposeFriendFinder() {
    if (_canvas) {
        _canvas.remove();
        _canvas = null;
        _ctx = null;
    }
}
