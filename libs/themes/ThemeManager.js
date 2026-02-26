/**
 * @module ThemeManager
 * Orchestrates weather/theme activations. Schedules random themes during gameplay,
 * manages their lifecycle, and emits events via EventBus.
 * Shows pre/post messages as overlays with configurable timing.
 *
 * Message config: { text: string, delay: number }
 *   preMessage delay: negative = seconds before theme starts (e.g. -2 = 2s before)
 *   postMessage delay: 0 = immediately when theme ends, positive = seconds after
 */
import * as THREE from 'three';
import { eventBus } from '../EventBus.js';
import { createLogger } from '../Logger.js';

const log = createLogger('ThemeManager');

const MIN_INTERVAL = 30;
const MAX_INTERVAL = 60;
const MSG_DISPLAY_DURATION = 3000; // ms to show each message
const FOG_FADE_IN_DURATION = 0.8; // seconds to fade default fog back in

export class ThemeManager {
    constructor(scene) {
        this.scene = scene;
        this.themes = [];
        this.activeTheme = null;
        this.remaining = 0;
        this.elapsed = 0;
        this.cooldown = this._randomInterval();
        this._pendingTheme = null;   // theme waiting to activate after pre-message
        this._preDelay = 0;          // countdown before activation

        // Player theme support
        this._playerMesh = null;
        this._playerTail = null;
        this._savedPlayerState = null;
        this._savedTailStates = [];

        // Post-deactivation fog fade-in
        this._fogFadeIn = null; // { elapsed, duration, targetNear, targetFar }
    }

    setPlayerMesh(mesh) {
        this._playerMesh = mesh;
    }

    setPlayerTail(tail) {
        this._playerTail = tail;
    }

    registerTheme(theme) {
        this.themes.push(theme);
        log.info(`Registered theme: ${theme.name}`);
    }

    update(dt, playerPosition) {
        // Smooth fog fade-in after theme deactivation
        if (this._fogFadeIn) {
            this._fogFadeIn.elapsed += dt;
            const t = Math.min(1, this._fogFadeIn.elapsed / this._fogFadeIn.duration);
            const ease = t * t * (3 - 2 * t); // smoothstep

            const fog = this.scene.fog;
            if (fog && fog.isFog) {
                // Lerp from far-away fog (invisible) to target values
                fog.near = this._fogFadeIn.startNear + (this._fogFadeIn.targetNear - this._fogFadeIn.startNear) * ease;
                fog.far = this._fogFadeIn.startFar + (this._fogFadeIn.targetFar - this._fogFadeIn.startFar) * ease;
            }

            // Also smoothly restore light intensities
            if (this._fogFadeIn.lights) {
                for (const entry of this._fogFadeIn.lights) {
                    entry.light.intensity = entry.start + (entry.target - entry.start) * ease;
                }
            }

            if (t >= 1) {
                this._fogFadeIn = null;
            }
        }

        // Waiting for pre-message delay before activating
        if (this._pendingTheme) {
            this._preDelay -= dt;
            if (this._preDelay <= 0) {
                this._doActivate(this._pendingTheme);
                this._pendingTheme = null;
            }
            return;
        }

        // Active theme is running
        if (this.activeTheme) {
            this.elapsed += dt;
            this.remaining -= dt;
            this.activeTheme.update(dt, this.scene, playerPosition, this.elapsed, this.remaining);

            // Keep new tail segments in sync with player theme
            if (this.activeTheme.playerTheme && this._playerTail) {
                const pt = this.activeTheme.playerTheme;
                for (let i = this._savedTailStates.length; i < this._playerTail.segments.length; i++) {
                    const segMat = this._playerTail.segments[i].mesh.material;
                    this._savedTailStates.push({
                        emissive: segMat.emissive ? segMat.emissive.clone() : null,
                        emissiveIntensity: segMat.emissiveIntensity
                    });
                    if (pt.emissive != null && segMat.emissive) segMat.emissive.setHex(pt.emissive);
                    if (pt.emissiveIntensity != null) segMat.emissiveIntensity = pt.emissiveIntensity;
                }
            }

            if (this.remaining <= 0) {
                this._deactivate();
            }
            return;
        }

        // Countdown to next theme
        this.cooldown -= dt;
        if (this.cooldown <= 0 && this.themes.length > 0) {
            this._scheduleActivation();
        }
    }

    _scheduleActivation() {
        const theme = this.themes[Math.floor(Math.random() * this.themes.length)];
        const preMsg = theme.preMessage;

        if (preMsg && preMsg.delay < 0) {
            // Show message now, activate after the delay
            this._showMessage(preMsg.text);
            this._pendingTheme = theme;
            this._preDelay = Math.abs(preMsg.delay);
        } else {
            // No pre-delay, activate immediately
            this._doActivate(theme);
            if (preMsg) this._showMessage(preMsg.text);
        }
    }

    _doActivate(theme) {
        this.activeTheme = theme;
        this.remaining = theme.duration;
        this.elapsed = 0;
        theme.activate(this.scene);

        // Apply player theme if defined
        if (theme.playerTheme && this._playerMesh) {
            this._applyPlayerTheme(theme.playerTheme);
        }

        eventBus.emit('theme:started', { name: theme.name });
        log.info(`Theme started: ${theme.name} (${theme.duration}s)`);
    }

    _deactivate() {
        const theme = this.activeTheme;
        theme.deactivate(this.scene);

        // Restore player appearance
        if (this._savedPlayerState && this._playerMesh) {
            this._restorePlayerTheme();
        }

        this.activeTheme = null;
        this.cooldown = this._randomInterval();
        eventBus.emit('theme:ended', { name: theme.name });
        log.info(`Theme ended: ${theme.name}`);

        // Start smooth fog fade-in so the default fog doesn't snap in abruptly.
        // The fog was restored by deactivate() — now push it to "invisible" and lerp back.
        const fog = this.scene.fog;
        if (fog && fog.isFog) {
            const targetNear = fog.near;
            const targetFar = fog.far;
            // Start with fog slightly pushed out so it's faint but not absent
            fog.near = 150;
            fog.far = 250;

            // Capture current light intensities as starting points
            const lights = [];
            this.scene.traverse(obj => {
                if (obj.isAmbientLight || obj.isDirectionalLight) {
                    lights.push({ light: obj, start: obj.intensity, target: obj.intensity });
                }
            });

            this._fogFadeIn = {
                elapsed: 0,
                duration: FOG_FADE_IN_DURATION,
                startNear: 150,
                startFar: 250,
                targetNear,
                targetFar,
                lights
            };
        }

        // Post message
        const postMsg = theme.postMessage;
        if (postMsg) {
            const delayMs = (postMsg.delay || 0) * 1000;
            if (delayMs <= 0) {
                this._showMessage(postMsg.text);
            } else {
                setTimeout(() => this._showMessage(postMsg.text), delayMs);
            }
        }
    }

    _showMessage(text) {
        const el = document.createElement('div');
        el.textContent = text;
        el.style.cssText = [
            'position:fixed',
            'top:20%',
            'left:50%',
            'transform:translateX(-50%)',
            'z-index:8000',
            'font:bold 22px monospace',
            'color:#fff',
            'text-align:center',
            'text-shadow:0 2px 12px rgba(0,0,0,0.7)',
            'pointer-events:none',
            'opacity:0',
            'transition:opacity 0.8s ease-in-out',
            'white-space:nowrap'
        ].join(';');
        document.body.appendChild(el);

        requestAnimationFrame(() => { el.style.opacity = '1'; });

        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 800);
        }, MSG_DISPLAY_DURATION);
    }

    _randomInterval() {
        return MIN_INTERVAL + Math.random() * (MAX_INTERVAL - MIN_INTERVAL);
    }

    forceStart(name) {
        if (this.activeTheme) this._deactivate();
        this._pendingTheme = null;
        const theme = this.themes.find(t => t.name === name);
        if (!theme) return;

        if (theme.preMessage) this._showMessage(theme.preMessage.text || theme.preMessage);
        this._pendingTheme = theme;
        this._preDelay = theme.preMessage?.delay ? Math.abs(theme.preMessage.delay) : 0;
        if (this._preDelay <= 0) {
            this._doActivate(theme);
            this._pendingTheme = null;
        }
    }

    forceStop() {
        if (this.activeTheme) this._deactivate();
    }

    _applyPlayerTheme(pt) {
        const mat = this._playerMesh.material;
        this._savedPlayerState = {
            roughness: mat.roughness,
            metalness: mat.metalness,
            emissive: mat.emissive.clone(),
            emissiveIntensity: mat.emissiveIntensity
        };

        if (pt.roughness != null) mat.roughness = pt.roughness;
        if (pt.metalness != null) mat.metalness = pt.metalness;
        if (pt.emissive != null) mat.emissive.setHex(pt.emissive);
        if (pt.emissiveIntensity != null) mat.emissiveIntensity = pt.emissiveIntensity;

        // Apply emissive to tail segments so head and tail match
        this._savedTailStates = [];
        if (this._playerTail) {
            for (const seg of this._playerTail.segments) {
                const segMat = seg.mesh.material;
                this._savedTailStates.push({
                    emissive: segMat.emissive ? segMat.emissive.clone() : null,
                    emissiveIntensity: segMat.emissiveIntensity
                });
                if (pt.emissive != null && segMat.emissive) segMat.emissive.setHex(pt.emissive);
                if (pt.emissiveIntensity != null) segMat.emissiveIntensity = pt.emissiveIntensity;
            }
        }
    }

    _restorePlayerTheme() {
        const mat = this._playerMesh.material;
        const s = this._savedPlayerState;
        mat.roughness = s.roughness;
        mat.metalness = s.metalness;
        mat.emissive.copy(s.emissive);
        mat.emissiveIntensity = s.emissiveIntensity;
        this._savedPlayerState = null;

        // Restore tail segment emissive
        if (this._playerTail) {
            for (let i = 0; i < this._savedTailStates.length && i < this._playerTail.segments.length; i++) {
                const segMat = this._playerTail.segments[i].mesh.material;
                const saved = this._savedTailStates[i];
                if (saved.emissive && segMat.emissive) segMat.emissive.copy(saved.emissive);
                segMat.emissiveIntensity = saved.emissiveIntensity;
            }
        }
        this._savedTailStates = [];
    }

    dispose() {
        if (this.activeTheme) {
            this.activeTheme.deactivate(this.scene);
            if (this._savedPlayerState && this._playerMesh) {
                this._restorePlayerTheme();
            }
            this.activeTheme = null;
        }
    }
}
