/**
 * @module PodiumScreen
 * End-of-round results overlay showing top 3 players with snake avatars and medals.
 * 10-second mandatory wait before allowing next round.
 */

let overlay = null;

const MEDAL_COLORS = ['#ffd700', '#c0c0c0', '#cd7f32']; // gold, silver, bronze
const MEDAL_LABELS = ['1st', '2nd', '3rd'];
const MEDAL_EMOJI = ['\u{1F451}', '\u{1F948}', '\u{1F949}']; // crown, silver medal, bronze medal
const MIN_WAIT_MS = 10000;

/**
 * Creates a CSS snake avatar — a colored rounded box with cartoon eyes.
 * @param {string} color - CSS color
 * @param {number} size - Avatar size in pixels
 * @returns {HTMLElement}
 */
function createSnakeAvatar(color, size) {
    const avatar = document.createElement('div');
    avatar.style.cssText = [
        `width:${size}px`, `height:${size}px`,
        `background:${color}`,
        `border-radius:${size * 0.2}px`,
        'position:relative',
        'flex-shrink:0',
        `box-shadow:0 2px 8px rgba(0,0,0,0.4), inset 0 ${size * 0.05}px ${size * 0.1}px rgba(255,255,255,0.2)`,
    ].join(';');

    // Eyes
    const eyeSize = size * 0.28;
    const pupilSize = eyeSize * 0.5;
    for (const side of [-1, 1]) {
        const eye = document.createElement('div');
        eye.style.cssText = [
            `width:${eyeSize}px`, `height:${eyeSize}px`,
            'background:#fff', 'border-radius:50%',
            'position:absolute',
            `top:${size * 0.15}px`,
            `left:${size * 0.5 + side * size * 0.18 - eyeSize / 2}px`,
            'box-shadow:0 1px 2px rgba(0,0,0,0.2)',
        ].join(';');

        const pupil = document.createElement('div');
        pupil.style.cssText = [
            `width:${pupilSize}px`, `height:${pupilSize}px`,
            'background:#000', 'border-radius:50%',
            'position:absolute',
            `top:${eyeSize * 0.15}px`,
            `left:${(eyeSize - pupilSize) / 2}px`,
        ].join(';');
        eye.appendChild(pupil);
        avatar.appendChild(eye);
    }

    return avatar;
}

/**
 * Shows the podium screen with end-of-round rankings.
 * @param {object} opts
 * @param {Array<{id, rank, size, tailLength, score, color}>} opts.rankings - Top 3
 * @param {number} opts.roundNumber - Which round just ended
 * @param {function} opts.getEntityName - Resolves entity id to display name
 * @returns {Promise<void>} Resolves when dismissed
 */
export function showPodiumScreen({ rankings, roundNumber, getEntityName }) {
    if (overlay) {
        overlay.remove();
        overlay = null;
    }

    return new Promise((resolve) => {
        overlay = document.createElement('div');
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:10000',
            'display:flex', 'align-items:center', 'justify-content:center',
            'background:rgba(0,0,0,0.85)',
            'font-family:monospace', 'color:#fff',
            'animation:podiumFadeIn 0.5s ease-out'
        ].join(';');

        const style = document.createElement('style');
        style.textContent = `
            @keyframes podiumFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes podiumSlideUp {
                from { opacity: 0; transform: translateY(30px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes podiumBounce {
                0% { transform: scale(0.3); opacity: 0; }
                60% { transform: scale(1.1); opacity: 1; }
                100% { transform: scale(1); opacity: 1; }
            }
            @keyframes shimmer {
                0%, 100% { opacity: 0.3; }
                50% { opacity: 0.6; }
            }
        `;
        overlay.appendChild(style);

        const box = document.createElement('div');
        box.style.cssText = 'text-align:center; max-width:460px; width:90%;';

        // Round complete title
        const title = document.createElement('div');
        title.textContent = `Round ${roundNumber} Complete!`;
        title.style.cssText = 'font-size:28px; font-weight:bold; color:#ffd700; margin-bottom:6px; letter-spacing:2px; text-shadow:0 2px 12px rgba(255,215,0,0.3);';
        box.appendChild(title);

        const subtitle = document.createElement('div');
        subtitle.textContent = 'Final Standings';
        subtitle.style.cssText = 'font-size:12px; color:rgba(255,255,255,0.4); margin-bottom:28px; text-transform:uppercase; letter-spacing:4px;';
        box.appendChild(subtitle);

        // Podium entries
        const avatarSizes = [52, 44, 40]; // 1st bigger

        for (let i = 0; i < rankings.length; i++) {
            const r = rankings[i];
            const name = getEntityName ? getEntityName(r.id) : r.id;
            const isPlayer = r.id === 'player';
            const medalColor = MEDAL_COLORS[i] || '#888';

            const row = document.createElement('div');
            row.style.cssText = [
                'display:flex', 'align-items:center', 'gap:14px',
                `padding:${i === 0 ? '16px 18px' : '12px 16px'}`, 'margin-bottom:10px',
                `border-radius:${i === 0 ? '12px' : '8px'}`,
                `background:${isPlayer ? 'rgba(0,255,204,0.12)' : 'rgba(255,255,255,0.04)'}`,
                `border:1px solid ${isPlayer ? 'rgba(0,255,204,0.25)' : 'rgba(255,255,255,0.06)'}`,
                `animation:podiumSlideUp 0.5s ease-out ${0.3 + i * 0.2}s both`,
                i === 0 ? 'box-shadow:0 0 20px rgba(255,215,0,0.1)' : ''
            ].join(';');

            // Medal badge
            const medal = document.createElement('div');
            medal.style.cssText = [
                'font-size:22px', 'flex-shrink:0', 'width:30px', 'text-align:center',
                `animation:podiumBounce 0.5s ease-out ${0.5 + i * 0.2}s both`
            ].join(';');
            medal.textContent = MEDAL_EMOJI[i] || MEDAL_LABELS[i];
            row.appendChild(medal);

            // Snake avatar
            const avatar = createSnakeAvatar(r.color || '#888', avatarSizes[i] || 40);
            avatar.style.animation = `podiumBounce 0.4s ease-out ${0.6 + i * 0.2}s both`;
            row.appendChild(avatar);

            // Name + stats column
            const info = document.createElement('div');
            info.style.cssText = 'flex:1; text-align:left; min-width:0;';

            const nameEl = document.createElement('div');
            nameEl.textContent = name;
            nameEl.style.cssText = [
                `font-size:${i === 0 ? '18px' : '15px'}`, 'font-weight:bold',
                `color:${isPlayer ? '#00ffcc' : '#fff'}`,
                'overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap'
            ].join(';');
            info.appendChild(nameEl);

            const statsEl = document.createElement('div');
            statsEl.style.cssText = 'font-size:11px; color:rgba(255,255,255,0.45); margin-top:2px;';
            statsEl.textContent = `${r.size.toFixed(1)}x size \u00B7 ${r.tailLength} tail`;
            info.appendChild(statsEl);

            row.appendChild(info);

            // Score
            const scoreEl = document.createElement('div');
            scoreEl.textContent = r.score;
            scoreEl.style.cssText = [
                `font-size:${i === 0 ? '26px' : '20px'}`, 'font-weight:bold',
                `color:${medalColor}`, 'min-width:40px', 'text-align:right',
                'text-shadow:0 1px 4px rgba(0,0,0,0.3)'
            ].join(';');
            row.appendChild(scoreEl);

            box.appendChild(row);
        }

        // Empty podium slots
        for (let i = rankings.length; i < 3; i++) {
            const row = document.createElement('div');
            row.style.cssText = [
                'display:flex', 'align-items:center', 'gap:14px',
                'padding:12px 16px', 'margin-bottom:10px',
                'border-radius:8px', 'background:rgba(255,255,255,0.02)',
                'border:1px solid rgba(255,255,255,0.04)',
                'color:rgba(255,255,255,0.15)', 'font-size:13px',
                `animation:podiumSlideUp 0.5s ease-out ${0.3 + i * 0.2}s both`
            ].join(';');
            row.textContent = `${MEDAL_LABELS[i]} \u2014 empty`;
            box.appendChild(row);
        }

        // Bottom section: loading bar + button
        const bottomWrap = document.createElement('div');
        bottomWrap.style.cssText = 'margin-top:32px; animation:podiumSlideUp 0.5s ease-out 1s both;';

        // Loading text with countdown
        const loadingText = document.createElement('div');
        loadingText.style.cssText = 'font-size:13px; color:rgba(255,255,255,0.5); margin-bottom:12px; letter-spacing:1px;';
        let countdown = Math.ceil(MIN_WAIT_MS / 1000);
        loadingText.textContent = `Next game loading... ${countdown}s`;
        bottomWrap.appendChild(loadingText);

        // Progress bar
        const barOuter = document.createElement('div');
        barOuter.style.cssText = [
            'width:200px', 'height:4px', 'border-radius:2px',
            'background:rgba(255,255,255,0.1)', 'margin:0 auto 20px',
            'overflow:hidden'
        ].join(';');
        const barInner = document.createElement('div');
        barInner.style.cssText = [
            'width:0%', 'height:100%', 'border-radius:2px',
            'background:#00ffcc',
            `transition:width ${MIN_WAIT_MS}ms linear`
        ].join(';');
        barOuter.appendChild(barInner);
        bottomWrap.appendChild(barOuter);

        // Start the bar animation after a frame
        requestAnimationFrame(() => { barInner.style.width = '100%'; });

        // Next Round button (hidden initially)
        const btn = document.createElement('button');
        btn.textContent = 'Next Round';
        btn.disabled = true;
        btn.style.cssText = [
            'padding:12px 40px',
            'font:bold 16px monospace', 'color:#000',
            'background:rgba(255,255,255,0.15)', 'border:none', 'border-radius:8px',
            'cursor:not-allowed', 'letter-spacing:1px',
            'opacity:0.4', 'transition:all 0.3s ease'
        ].join(';');
        bottomWrap.appendChild(btn);

        box.appendChild(bottomWrap);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        // Countdown interval
        const countdownInterval = setInterval(() => {
            countdown--;
            if (countdown > 0) {
                loadingText.textContent = `Next game loading... ${countdown}s`;
            } else {
                loadingText.textContent = 'Ready!';
                loadingText.style.color = '#00ffcc';
                clearInterval(countdownInterval);
            }
        }, 1000);

        // Enable button after minimum wait
        let canDismiss = false;
        const enableTimer = setTimeout(() => {
            canDismiss = true;
            btn.disabled = false;
            btn.style.background = '#00ffcc';
            btn.style.cursor = 'pointer';
            btn.style.opacity = '1';
            btn.addEventListener('mouseenter', () => { btn.style.background = '#33ffd9'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = '#00ffcc'; });
        }, MIN_WAIT_MS);

        btn.addEventListener('click', () => { if (canDismiss) dismiss(); });

        // Keyboard dismiss (only after wait)
        const onKey = (e) => {
            if (!canDismiss) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                dismiss();
            }
        };
        window.addEventListener('keydown', onKey);

        function dismiss() {
            clearTimeout(enableTimer);
            clearInterval(countdownInterval);
            window.removeEventListener('keydown', onKey);
            if (overlay) {
                overlay.remove();
                overlay = null;
            }
            resolve();
        }
    });
}
