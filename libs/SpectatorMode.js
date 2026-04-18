/**
 * @module SpectatorMode
 * Reusable spectator camera system for dead players.
 * Cycles through alive entities with Tab/Arrow keys, shows HUD overlay.
 */

let overlay = null;

export class SpectatorMode {
    /**
     * @param {object} opts
     * @param {function} opts.getEntityName - Resolve entity ID to display name
     * @param {function} [opts.onRequestRespawn] - Called when player clicks "Play Again"
     * @param {boolean} [opts.isPeekMode] - If true, shows Join/Close buttons instead of respawn
     * @param {function} [opts.onRequestJoin] - Called when observer clicks "Join Game" (peek mode)
     * @param {function} [opts.onRequestClose] - Called when observer presses Esc (peek mode)
     * @param {boolean} [opts.allowFreeFly] - If false, disables free-fly camera toggle (default: true)
     */
    constructor({ getEntityName, onRequestRespawn, isPeekMode, onRequestJoin, onRequestClose, allowFreeFly }) {
        this.getEntityName = getEntityName;
        this.onRequestRespawn = onRequestRespawn;
        this.isPeekMode = isPeekMode || false;
        this.onRequestJoin = onRequestJoin;
        this.onRequestClose = onRequestClose;
        this.allowFreeFly = allowFreeFly !== false; // default true
        this.active = false;
        this._entities = []; // array of { id, mesh }
        this._targetIndex = 0;
        this._freeFly = false;
        this._freeFlyPos = null; // { x, y, z }
        this._freeFlyAngle = 0;
        this._freeFlyPitch = -0.5;
        this._keysDown = new Set();
        this._onKeyDown = this._handleKey.bind(this);
        this._onKeyUp = this._handleKeyUp.bind(this);
    }

    /**
     * Start spectating. Builds alive entity list from provided map.
     * @param {Map<number, THREE.Mesh>} remoteMeshes - entityId -> mesh
     */
    start(remoteMeshes) {
        this._buildEntityList(remoteMeshes);
        if (this._entities.length === 0 && !this.isPeekMode) {
            // No one to spectate — trigger respawn immediately
            if (this.onRequestRespawn) this.onRequestRespawn();
            return;
        }
        this.active = true;
        this._targetIndex = 0;
        // In peek mode with no players, auto-enter free-fly (if allowed)
        if (this._entities.length === 0 && this.isPeekMode && this.allowFreeFly) {
            this._freeFly = true;
            this._freeFlyPos = { x: 0, y: 25, z: 0 };
        }
        this._showHUD();
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
    }

    /**
     * Update spectator state each frame. Call from game loop.
     * @param {Map<number, THREE.Mesh>} remoteMeshes - current alive entity meshes
     */
    update(remoteMeshes) {
        if (!this.active) return;

        // Rebuild entity list to track who's still alive
        const prevTargetId = this._entities[this._targetIndex]?.id;
        this._buildEntityList(remoteMeshes);

        if (this._entities.length === 0 && !this.isPeekMode) {
            this.stop();
            return;
        }

        // If in free-fly mode, update camera position from WASD keys
        if (this._freeFly && this._freeFlyPos) {
            const speed = 0.5;
            const sin = Math.sin(this._freeFlyAngle);
            const cos = Math.cos(this._freeFlyAngle);
            if (this._keysDown.has('w')) { this._freeFlyPos.x -= sin * speed; this._freeFlyPos.z -= cos * speed; }
            if (this._keysDown.has('s')) { this._freeFlyPos.x += sin * speed; this._freeFlyPos.z += cos * speed; }
            if (this._keysDown.has('a')) { this._freeFlyPos.x -= cos * speed; this._freeFlyPos.z += sin * speed; }
            if (this._keysDown.has('d')) { this._freeFlyPos.x += cos * speed; this._freeFlyPos.z -= sin * speed; }
            if (this._keysDown.has('q')) { this._freeFlyPos.y += speed * 0.5; }
            if (this._keysDown.has('e')) { this._freeFlyPos.y -= speed * 0.5; }
        }

        // If entities appeared while in peek free-fly, switch to follow
        if (this.isPeekMode && this._freeFly && this._entities.length > 0) {
            this._freeFly = false;
            this._targetIndex = 0;
        }

        // Try to keep following the same target
        if (!this._freeFly && prevTargetId != null && this._entities.length > 0) {
            const idx = this._entities.findIndex(e => e.id === prevTargetId);
            if (idx >= 0) {
                this._targetIndex = idx;
            } else {
                // Target died — advance to next
                this._targetIndex = this._targetIndex % this._entities.length;
            }
        }

        this._updateHUD();
    }

    /**
     * Stop spectating. Removes HUD and keyboard listener.
     */
    stop() {
        this.active = false;
        this._freeFly = false;
        this._keysDown.clear();
        this._removeHUD();
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('keyup', this._onKeyUp);
        this._entities = [];
    }

    /**
     * Get the mesh of the currently spectated entity.
     * @returns {THREE.Mesh|null}
     */
    getTargetMesh() {
        if (!this.active) return null;
        if (this._freeFly) return null; // camera controlled by getFreeFlyCamera
        if (this._entities.length === 0) return null;
        return this._entities[this._targetIndex]?.mesh || null;
    }

    /**
     * Get the ID of the currently spectated entity.
     * @returns {number|null}
     */
    getTargetId() {
        if (!this.active || this._entities.length === 0) return null;
        return this._entities[this._targetIndex]?.id || null;
    }

    /**
     * Get free-fly camera position and look target.
     * @returns {{ position: {x,y,z}, lookAt: {x,y,z} } | null}
     */
    getFreeFlyCamera() {
        if (!this.active || !this._freeFly || !this._freeFlyPos) return null;
        const p = this._freeFlyPos;
        const dist = 20;
        return {
            position: { x: p.x, y: p.y, z: p.z },
            lookAt: {
                x: p.x - Math.sin(this._freeFlyAngle) * dist,
                y: p.y + Math.sin(this._freeFlyPitch) * dist,
                z: p.z - Math.cos(this._freeFlyAngle) * dist,
            },
        };
    }

    /** Is free-fly camera active? */
    isFreeFly() {
        return this._freeFly;
    }

    _buildEntityList(remoteMeshes) {
        this._entities = [];
        for (const [id, mesh] of remoteMeshes) {
            if (mesh && mesh.visible) {
                this._entities.push({ id, mesh });
            }
        }
    }

    _handleKey(e) {
        if (!this.active) return;
        const key = e.key.toLowerCase();

        // Track keys for free-fly movement
        if ('wasdqe'.includes(key)) {
            this._keysDown.add(key);
        }

        // Free-fly: arrow keys rotate camera
        if (this._freeFly) {
            if (e.key === 'ArrowLeft') { this._freeFlyAngle -= 0.08; return; }
            if (e.key === 'ArrowRight') { this._freeFlyAngle += 0.08; return; }
            if (e.key === 'ArrowUp') { this._freeFlyPitch = Math.min(this._freeFlyPitch + 0.05, 1.2); return; }
            if (e.key === 'ArrowDown') { this._freeFlyPitch = Math.max(this._freeFlyPitch - 0.05, -1.2); return; }
        }

        if (key === 'f' && this.allowFreeFly) {
            // Toggle free-fly camera
            e.preventDefault();
            if (this._freeFly) {
                // Switch back to follow mode (if entities exist)
                if (this._entities.length > 0) {
                    this._freeFly = false;
                }
            } else {
                // Enter free-fly — start at current target position or center
                const target = this._entities[this._targetIndex];
                if (target && target.mesh) {
                    const p = target.mesh.position;
                    this._freeFlyPos = { x: p.x, y: p.y + 15, z: p.z + 20 };
                } else {
                    this._freeFlyPos = { x: 0, y: 25, z: 0 };
                }
                this._freeFly = true;
            }
            this._updateHUD();
            return;
        }

        if (e.key === 'Escape' && this.isPeekMode) {
            e.preventDefault();
            this.stop();
            if (this.onRequestClose) this.onRequestClose();
            return;
        }

        if (e.key === 'Tab' || (e.key === 'ArrowRight' && !this._freeFly)) {
            e.preventDefault();
            if (this._entities.length > 0) {
                this._targetIndex = (this._targetIndex + 1) % this._entities.length;
                if (this._freeFly) this._freeFly = false;
                this._updateHUD();
            }
        } else if (e.key === 'ArrowLeft' && !this._freeFly) {
            e.preventDefault();
            if (this._entities.length > 0) {
                this._targetIndex = (this._targetIndex - 1 + this._entities.length) % this._entities.length;
                this._updateHUD();
            }
        } else if ((e.key === 'Enter' || e.key === ' ') && !this.isPeekMode) {
            e.preventDefault();
            this.stop();
            if (this.onRequestRespawn) this.onRequestRespawn();
        }
    }

    _handleKeyUp(e) {
        const key = e.key.toLowerCase();
        this._keysDown.delete(key);
    }

    _showHUD() {
        this._removeHUD();

        overlay = document.createElement('div');
        overlay.id = 'spectator-hud';
        overlay.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'right:0',
            'z-index:9500', 'pointer-events:none',
            'display:flex', 'flex-direction:column', 'align-items:center',
            'padding-top:16px', 'font-family:monospace',
        ].join(';');

        // Badge
        const badge = document.createElement('div');
        badge.style.cssText = [
            'background:rgba(0,0,0,0.7)', 'color:#00ffcc',
            'padding:6px 18px', 'border-radius:20px',
            'font-size:12px', 'font-weight:bold',
            'letter-spacing:2px', 'text-transform:uppercase',
            'border:1px solid rgba(0,255,204,0.3)',
        ].join(';');
        badge.textContent = 'SPECTATING';
        overlay.appendChild(badge);

        // Name row with left/right arrows
        const nameRow = document.createElement('div');
        nameRow.style.cssText = [
            'display:flex', 'align-items:center', 'gap:16px',
            'margin-top:10px', 'pointer-events:auto',
        ].join(';');

        const arrowStyle = [
            'background:rgba(255,255,255,0.1)', 'border:1px solid rgba(255,255,255,0.2)',
            'color:#fff', 'font-size:18px', 'width:36px', 'height:36px',
            'border-radius:50%', 'cursor:pointer',
            'display:flex', 'align-items:center', 'justify-content:center',
            'transition:background 0.15s',
        ].join(';');

        const leftBtn = document.createElement('button');
        leftBtn.innerHTML = '\u25C0';
        leftBtn.style.cssText = arrowStyle;
        leftBtn.addEventListener('mouseenter', () => { leftBtn.style.background = 'rgba(0,255,204,0.2)'; });
        leftBtn.addEventListener('mouseleave', () => { leftBtn.style.background = 'rgba(255,255,255,0.1)'; });
        leftBtn.addEventListener('click', () => {
            this._targetIndex = (this._targetIndex - 1 + this._entities.length) % this._entities.length;
            this._updateHUD();
        });
        nameRow.appendChild(leftBtn);

        // Player name
        const nameEl = document.createElement('div');
        nameEl.id = 'spectator-name';
        nameEl.style.cssText = 'color:#fff; font-size:18px; font-weight:bold; min-width:120px; text-align:center;';
        nameRow.appendChild(nameEl);

        const rightBtn = document.createElement('button');
        rightBtn.innerHTML = '\u25B6';
        rightBtn.style.cssText = arrowStyle;
        rightBtn.addEventListener('mouseenter', () => { rightBtn.style.background = 'rgba(0,255,204,0.2)'; });
        rightBtn.addEventListener('mouseleave', () => { rightBtn.style.background = 'rgba(255,255,255,0.1)'; });
        rightBtn.addEventListener('click', () => {
            this._targetIndex = (this._targetIndex + 1) % this._entities.length;
            this._updateHUD();
        });
        nameRow.appendChild(rightBtn);
        overlay.appendChild(nameRow);

        // Count + controls hint
        const hint = document.createElement('div');
        hint.id = 'spectator-hint';
        hint.style.cssText = 'color:rgba(255,255,255,0.4); font-size:11px; margin-top:4px;';
        overlay.appendChild(hint);

        // Bottom bar with action button
        const bottomBar = document.createElement('div');
        bottomBar.style.cssText = [
            'position:fixed', 'bottom:30px', 'left:0', 'right:0',
            'display:flex', 'justify-content:center', 'gap:12px',
            'pointer-events:auto',
        ].join(';');

        if (this.isPeekMode) {
            // Peek mode: "Join Game" button
            const joinBtn = document.createElement('button');
            joinBtn.textContent = 'Join Game';
            joinBtn.style.cssText = [
                'padding:10px 32px',
                'font:bold 14px monospace', 'color:#000',
                'background:#4ade80', 'border:none', 'border-radius:6px',
                'cursor:pointer', 'letter-spacing:1px',
            ].join(';');
            joinBtn.addEventListener('mouseenter', () => { joinBtn.style.background = '#6ee7a0'; });
            joinBtn.addEventListener('mouseleave', () => { joinBtn.style.background = '#4ade80'; });
            joinBtn.addEventListener('click', () => {
                this.stop();
                if (this.onRequestJoin) this.onRequestJoin();
            });
            bottomBar.appendChild(joinBtn);
        } else {
            // Normal spectator: "Play Again" button
            const btn = document.createElement('button');
            btn.textContent = 'Play Again';
            btn.style.cssText = [
                'padding:8px 28px',
                'font:bold 14px monospace', 'color:#000',
                'background:#00ffcc', 'border:none', 'border-radius:6px',
                'cursor:pointer', 'letter-spacing:1px',
            ].join(';');
            btn.addEventListener('mouseenter', () => { btn.style.background = '#33ffd9'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = '#00ffcc'; });
            btn.addEventListener('click', () => {
                this.stop();
                if (this.onRequestRespawn) this.onRequestRespawn();
            });
            bottomBar.appendChild(btn);
        }
        overlay.appendChild(bottomBar);

        document.body.appendChild(overlay);
        this._updateHUD();
    }

    _updateHUD() {
        if (!overlay) return;
        const target = this._entities[this._targetIndex];
        const nameEl = document.getElementById('spectator-name');
        const hintEl = document.getElementById('spectator-hint');

        if (nameEl) {
            if (this._freeFly) {
                nameEl.textContent = 'Free Camera';
            } else if (this._entities.length === 0) {
                nameEl.textContent = 'Waiting for players...';
            } else if (target) {
                const name = this.getEntityName ? this.getEntityName(target.id) : `Player ${target.id}`;
                nameEl.textContent = name;
            }
        }

        if (hintEl) {
            const parts = [];
            if (this._entities.length > 0 && !this._freeFly) {
                parts.push(`${this._targetIndex + 1}/${this._entities.length}`);
                parts.push('Tab: cycle');
            }
            if (this.allowFreeFly) {
                parts.push(this._freeFly ? '[F] Follow' : '[F] Free Fly');
                if (this._freeFly) parts.push('WASD: move');
            }
            if (this.isPeekMode) {
                parts.push('[Esc] Close');
            } else {
                parts.push('Enter: respawn');
            }
            hintEl.textContent = parts.join(' \u2022 ');
        }
    }

    _removeHUD() {
        if (overlay) {
            overlay.remove();
            overlay = null;
        }
    }
}
