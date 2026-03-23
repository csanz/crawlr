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
     * @param {function} opts.onRequestRespawn - Called when player clicks "Play Again"
     */
    constructor({ getEntityName, onRequestRespawn }) {
        this.getEntityName = getEntityName;
        this.onRequestRespawn = onRequestRespawn;
        this.active = false;
        this._entities = []; // array of { id, mesh }
        this._targetIndex = 0;
        this._onKeyDown = this._handleKey.bind(this);
    }

    /**
     * Start spectating. Builds alive entity list from provided map.
     * @param {Map<number, THREE.Mesh>} remoteMeshes - entityId -> mesh
     */
    start(remoteMeshes) {
        this._buildEntityList(remoteMeshes);
        if (this._entities.length === 0) {
            // No one to spectate — trigger respawn immediately
            if (this.onRequestRespawn) this.onRequestRespawn();
            return;
        }
        this.active = true;
        this._targetIndex = 0;
        this._showHUD();
        window.addEventListener('keydown', this._onKeyDown);
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

        if (this._entities.length === 0) {
            this.stop();
            return;
        }

        // Try to keep following the same target
        if (prevTargetId != null) {
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
        this._removeHUD();
        window.removeEventListener('keydown', this._onKeyDown);
        this._entities = [];
    }

    /**
     * Get the mesh of the currently spectated entity.
     * @returns {THREE.Mesh|null}
     */
    getTargetMesh() {
        if (!this.active || this._entities.length === 0) return null;
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
        if (e.key === 'Tab' || e.key === 'ArrowRight') {
            e.preventDefault();
            this._targetIndex = (this._targetIndex + 1) % this._entities.length;
            this._updateHUD();
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            this._targetIndex = (this._targetIndex - 1 + this._entities.length) % this._entities.length;
            this._updateHUD();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.stop();
            if (this.onRequestRespawn) this.onRequestRespawn();
        }
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

        // Bottom bar with Play Again button
        const bottomBar = document.createElement('div');
        bottomBar.style.cssText = [
            'position:fixed', 'bottom:30px', 'left:0', 'right:0',
            'display:flex', 'justify-content:center',
            'pointer-events:auto',
        ].join(';');

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
        overlay.appendChild(bottomBar);

        document.body.appendChild(overlay);
        this._updateHUD();
    }

    _updateHUD() {
        if (!overlay) return;
        const target = this._entities[this._targetIndex];
        const nameEl = document.getElementById('spectator-name');
        const hintEl = document.getElementById('spectator-hint');

        if (nameEl && target) {
            const name = this.getEntityName ? this.getEntityName(target.id) : `Player ${target.id}`;
            nameEl.textContent = name;
        }

        if (hintEl) {
            const idx = this._targetIndex + 1;
            const total = this._entities.length;
            hintEl.textContent = `${idx}/${total} \u2022 Tab/Arrows: cycle \u2022 Enter: respawn`;
        }
    }

    _removeHUD() {
        if (overlay) {
            overlay.remove();
            overlay = null;
        }
    }
}
