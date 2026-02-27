/**
 * @module StartScreen
 * Crawlr start screen — cute low-poly style matching the game aesthetic.
 * Bright, playful, with a bouncy character preview and warm colors.
 */

let overlay = null;
let input = null;
let resolvePromise = null;

/**
 * Shows the start screen and returns a promise that resolves with the player name.
 * @returns {Promise<string>}
 */
export function showStartScreen() {
    return new Promise((resolve) => {
        resolvePromise = resolve;

        // Load a rounded, friendly font
        const fontLink = document.createElement('link');
        fontLink.rel = 'stylesheet';
        fontLink.href = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap';
        document.head.appendChild(fontLink);

        // Inject styles
        const styleEl = document.createElement('style');
        styleEl.id = 'crawlr-start-styles';
        styleEl.textContent = `
            @keyframes crawlr-bounce {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-12px); }
            }
            @keyframes crawlr-wobble {
                0%, 100% { transform: rotate(-3deg); }
                50% { transform: rotate(3deg); }
            }
            @keyframes crawlr-fade-up {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes crawlr-coin-float {
                0%, 100% { transform: translateY(0) rotate(0deg); }
                25% { transform: translateY(-6px) rotate(5deg); }
                75% { transform: translateY(4px) rotate(-3deg); }
            }
            @keyframes crawlr-cloud-drift {
                0% { transform: translateX(-20px); }
                100% { transform: translateX(20px); }
            }
            @keyframes crawlr-eye-blink {
                0%, 42%, 46%, 100% { transform: scaleY(1); }
                44% { transform: scaleY(0.1); }
            }
            @keyframes crawlr-pupil-look {
                0%, 100% { transform: translate(0, 0); }
                25% { transform: translate(2px, -1px); }
                50% { transform: translate(-2px, 0); }
                75% { transform: translate(1px, 1px); }
            }
            @keyframes crawlr-tail-wiggle {
                0%, 100% { transform: translateX(0); }
                25% { transform: translateX(-2px); }
                75% { transform: translateX(2px); }
            }
            .crawlr-play-btn {
                transition: all 0.15s ease !important;
            }
            .crawlr-play-btn:hover {
                transform: scale(1.06) !important;
                box-shadow: 0 6px 20px rgba(76,175,80,0.4) !important;
            }
            .crawlr-play-btn:active {
                transform: scale(0.97) !important;
            }
            .crawlr-input:focus {
                border-color: #4CAF50 !important;
                box-shadow: 0 0 0 3px rgba(76,175,80,0.2) !important;
            }
            .crawlr-feature-card:hover {
                transform: translateY(-2px) !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.1) !important;
            }
        `;
        document.head.appendChild(styleEl);

        // --- Overlay ---
        overlay = document.createElement('div');
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:10000',
            'display:flex', 'align-items:center', 'justify-content:center',
            'font-family: Fredoka, "Nunito", "Varela Round", system-ui, sans-serif',
            'overflow:hidden'
        ].join(';');

        // --- Sky + grass background ---
        const bg = document.createElement('div');
        bg.style.cssText = [
            'position:absolute', 'inset:0',
            'background: linear-gradient(180deg, #87CEEB 0%, #B0E0F0 40%, #90D490 60%, #5A9A3C 100%)'
        ].join(';');
        overlay.appendChild(bg);

        // --- Clouds ---
        createClouds(overlay);

        // --- Floating coins in background ---
        createFloatingCoins(overlay);

        // --- Simple low-poly trees on sides ---
        createTrees(overlay);

        // --- Main card ---
        const card = document.createElement('div');
        card.style.cssText = [
            'position:relative', 'z-index:2',
            'text-align:center', 'color:#3a3a3a',
            'max-width:380px', 'width:88%',
            'padding:32px 28px 28px',
            'background:rgba(255,255,255,0.92)',
            'border-radius:24px',
            'box-shadow: 0 8px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)',
            'animation: crawlr-fade-up 0.5s ease-out'
        ].join(';');

        // --- Cute character with googly eyes ---
        const charWrap = document.createElement('div');
        charWrap.style.cssText = 'margin-bottom:12px; animation: crawlr-bounce 2s ease-in-out infinite;';

        const charRow = document.createElement('div');
        charRow.style.cssText = 'display:inline-flex; align-items:flex-end; gap:4px;';

        // Tail segments (behind character)
        for (let i = 2; i >= 0; i--) {
            const seg = document.createElement('div');
            const size = 20 - i * 4;
            const shade = ['#8B6914', '#A07818', '#B8901C'][i];
            seg.style.cssText = [
                `width:${size}px`, `height:${size}px`,
                `background:${shade}`,
                `border-radius:5px`,
                `box-shadow: inset -2px -2px 0 rgba(0,0,0,0.15)`,
                `animation: crawlr-tail-wiggle ${0.8 + i * 0.15}s ease-in-out ${i * 0.1}s infinite`
            ].join(';');
            charRow.appendChild(seg);
        }

        // Main body (green cube)
        const body = document.createElement('div');
        body.style.cssText = [
            'position:relative',
            'width:52px', 'height:52px',
            'background:linear-gradient(145deg, #5BCC5B, #4CAF50)',
            'border-radius:10px',
            'box-shadow: inset -3px -3px 0 rgba(0,0,0,0.12), 2px 3px 8px rgba(0,0,0,0.15)',
            'animation: crawlr-wobble 3s ease-in-out infinite'
        ].join(';');

        // Eyes container
        const eyesWrap = document.createElement('div');
        eyesWrap.style.cssText = 'position:absolute; top:10px; left:50%; transform:translateX(-50%); display:flex; gap:6px;';

        // Left eye
        eyesWrap.appendChild(createEye(0));
        // Right eye
        eyesWrap.appendChild(createEye(0.3));

        body.appendChild(eyesWrap);

        // Little mouth
        const mouth = document.createElement('div');
        mouth.style.cssText = [
            'position:absolute', 'bottom:12px', 'left:50%', 'transform:translateX(-50%)',
            'width:12px', 'height:6px',
            'border-bottom:2.5px solid rgba(0,0,0,0.25)',
            'border-radius:0 0 6px 6px'
        ].join(';');
        body.appendChild(mouth);

        charRow.appendChild(body);
        charWrap.appendChild(charRow);
        card.appendChild(charWrap);

        // --- Title ---
        const title = document.createElement('div');
        title.textContent = 'Crawlr';
        title.style.cssText = [
            'font-size:48px', 'font-weight:700', 'color:#4CAF50',
            'letter-spacing:2px', 'margin-bottom:2px',
            'text-shadow: 2px 3px 0 rgba(0,0,0,0.1)',
            'animation: crawlr-fade-up 0.5s ease-out 0.1s both'
        ].join(';');
        card.appendChild(title);

        // --- Subtitle ---
        const sub = document.createElement('div');
        sub.textContent = 'Collect coins, grow your tail, rule the arena!';
        sub.style.cssText = [
            'font-size:13px', 'color:#888', 'font-weight:400',
            'margin-bottom:20px',
            'animation: crawlr-fade-up 0.5s ease-out 0.15s both'
        ].join(';');
        card.appendChild(sub);

        // --- Feature pills ---
        const features = document.createElement('div');
        features.style.cssText = [
            'display:flex', 'justify-content:center', 'gap:8px',
            'margin-bottom:22px', 'flex-wrap:wrap',
            'animation: crawlr-fade-up 0.5s ease-out 0.2s both'
        ].join(';');

        const featureData = [
            { icon: '\u26a1', label: 'Sprint', color: '#FFF3E0', border: '#FFB74D' },
            { icon: '\u26c8\ufe0f', label: 'Storms', color: '#E3F2FD', border: '#64B5F6' },
            { icon: '\ud83e\udd47', label: 'Compete', color: '#FFF8E1', border: '#FFD54F' },
        ];

        featureData.forEach(f => {
            const pill = document.createElement('div');
            pill.className = 'crawlr-feature-card';
            pill.style.cssText = [
                `padding:8px 14px`,
                `border-radius:12px`,
                `background:${f.color}`,
                `border:1.5px solid ${f.border}`,
                'font-size:12px', 'font-weight:600', 'color:#555',
                'transition: all 0.15s ease', 'cursor:default'
            ].join(';');
            pill.textContent = `${f.icon} ${f.label}`;
            features.appendChild(pill);
        });
        card.appendChild(features);

        // --- Name input section ---
        const inputSection = document.createElement('div');
        inputSection.style.cssText = 'animation: crawlr-fade-up 0.5s ease-out 0.25s both;';

        const label = document.createElement('div');
        label.textContent = 'What\'s your name?';
        label.style.cssText = 'font-size:14px; color:#777; margin-bottom:10px; font-weight:600;';
        inputSection.appendChild(label);

        input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 16;
        input.className = 'crawlr-input';
        input.placeholder = 'Type your name...';
        input.value = localStorage.getItem('crawlr_playerName') || '';
        input.style.cssText = [
            'width:200px', 'padding:11px 18px',
            'font: 15px Fredoka, "Nunito", system-ui, sans-serif',
            'text-align:center',
            'background:#f5f5f5', 'border:2px solid #ddd',
            'border-radius:14px', 'color:#333', 'outline:none',
            'transition:all 0.2s ease'
        ].join(';');
        inputSection.appendChild(input);
        card.appendChild(inputSection);

        // --- Play button ---
        const btnWrap = document.createElement('div');
        btnWrap.style.cssText = 'margin-top:16px; animation: crawlr-fade-up 0.5s ease-out 0.3s both;';

        const playBtn = document.createElement('button');
        playBtn.className = 'crawlr-play-btn';
        playBtn.textContent = 'PLAY!';
        playBtn.style.cssText = [
            'padding:14px 60px',
            'font: bold 18px Fredoka, "Nunito", system-ui, sans-serif',
            'color:#fff', 'letter-spacing:2px',
            'background:linear-gradient(180deg, #66BB6A, #43A047)',
            'border:none', 'border-radius:16px',
            'cursor:pointer',
            'box-shadow: 0 4px 0 #2E7D32, 0 6px 16px rgba(76,175,80,0.3)',
            'text-shadow: 0 1px 2px rgba(0,0,0,0.2)'
        ].join(';');
        playBtn.addEventListener('click', submit);
        btnWrap.appendChild(playBtn);
        card.appendChild(btnWrap);

        // --- Controls hint ---
        const hint = document.createElement('div');
        hint.style.cssText = [
            'font-size:11px', 'color:#aaa', 'margin-top:18px',
            'animation: crawlr-fade-up 0.5s ease-out 0.35s both'
        ].join(';');
        hint.innerHTML = [
            '<b style="color:#4CAF50">WASD</b> move',
            '<b style="color:#4CAF50">SHIFT</b> sprint',
            '<b style="color:#4CAF50">SPACE</b> jump',
            '<b style="color:#4CAF50">?</b> help'
        ].join(' &nbsp;\u00b7&nbsp; ');
        card.appendChild(hint);

        overlay.appendChild(card);
        document.body.appendChild(overlay);

        // Enter key submits
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submit();
            e.stopPropagation();
        });
        input.addEventListener('keyup', (e) => e.stopPropagation());

        setTimeout(() => input.focus(), 100);
    });
}

function createEye(delay) {
    const eye = document.createElement('div');
    eye.style.cssText = [
        'width:14px', 'height:14px',
        'background:#fff',
        'border-radius:50%',
        'position:relative',
        'box-shadow: inset 0 1px 2px rgba(0,0,0,0.1)',
        `animation: crawlr-eye-blink 5s ease-in-out ${delay}s infinite`
    ].join(';');

    const pupil = document.createElement('div');
    pupil.style.cssText = [
        'width:7px', 'height:7px',
        'background:#222',
        'border-radius:50%',
        'position:absolute', 'top:4px', 'left:4px',
        `animation: crawlr-pupil-look 4s ease-in-out ${delay + 1}s infinite`
    ].join(';');

    const shine = document.createElement('div');
    shine.style.cssText = [
        'width:3px', 'height:3px',
        'background:#fff',
        'border-radius:50%',
        'position:absolute', 'top:1px', 'left:5px'
    ].join(';');
    pupil.appendChild(shine);
    eye.appendChild(pupil);
    return eye;
}

function createClouds(container) {
    const cloudData = [
        { left: '5%', top: '8%', scale: 1, dur: 8 },
        { left: '70%', top: '5%', scale: 1.3, dur: 10 },
        { left: '35%', top: '15%', scale: 0.8, dur: 7 },
        { left: '85%', top: '18%', scale: 0.6, dur: 9 },
    ];

    cloudData.forEach(c => {
        const cloud = document.createElement('div');
        cloud.style.cssText = [
            'position:absolute', 'pointer-events:none', 'z-index:1',
            `left:${c.left}`, `top:${c.top}`,
            `transform:scale(${c.scale})`,
            `animation: crawlr-cloud-drift ${c.dur}s ease-in-out infinite alternate`,
            'opacity:0.7'
        ].join(';');

        // Cloud shape using overlapping circles
        const blob = document.createElement('div');
        blob.style.cssText = 'position:relative; width:80px; height:32px;';

        const parts = [
            { w: 36, h: 28, l: 22, t: 4, r: 14 },
            { w: 28, h: 22, l: 4, t: 10, r: 11 },
            { w: 30, h: 24, l: 44, t: 8, r: 12 },
        ];
        parts.forEach(p => {
            const d = document.createElement('div');
            d.style.cssText = [
                'position:absolute', 'background:white',
                `width:${p.w}px`, `height:${p.h}px`,
                `left:${p.l}px`, `top:${p.t}px`,
                `border-radius:${p.r}px`
            ].join(';');
            blob.appendChild(d);
        });
        cloud.appendChild(blob);
        container.appendChild(cloud);
    });
}

function createFloatingCoins(container) {
    const coins = [
        { left: '10%', top: '55%', size: 16, delay: 0 },
        { left: '88%', top: '45%', size: 14, delay: 0.5 },
        { left: '15%', top: '35%', size: 12, delay: 1.2 },
        { left: '80%', top: '65%', size: 18, delay: 0.8 },
        { left: '50%', top: '80%', size: 14, delay: 1.5 },
        { left: '25%', top: '72%', size: 10, delay: 2 },
        { left: '72%', top: '28%', size: 12, delay: 0.3 },
    ];

    coins.forEach(c => {
        const coin = document.createElement('div');
        coin.style.cssText = [
            'position:absolute', 'pointer-events:none', 'z-index:1',
            `left:${c.left}`, `top:${c.top}`,
            `width:${c.size}px`, `height:${c.size}px`,
            'border-radius:50%',
            'background:radial-gradient(circle at 35% 35%, #FFE766, #FFD700, #DAA520)',
            `box-shadow: 0 0 ${c.size / 2}px rgba(255,215,0,0.4), inset -1px -1px 2px rgba(0,0,0,0.15)`,
            `animation: crawlr-coin-float ${2 + Math.random()}s ease-in-out ${c.delay}s infinite`,
            'opacity:0.8'
        ].join(';');
        container.appendChild(coin);
    });
}

function createTrees(container) {
    const treeData = [
        { left: '3%', bottom: '8%', scale: 1 },
        { left: '8%', bottom: '5%', scale: 0.7 },
        { right: '4%', bottom: '10%', scale: 0.9 },
        { right: '10%', bottom: '6%', scale: 0.6 },
    ];

    treeData.forEach(t => {
        const tree = document.createElement('div');
        const pos = t.left ? `left:${t.left}` : `right:${t.right}`;
        tree.style.cssText = [
            'position:absolute', 'pointer-events:none', 'z-index:1',
            pos, `bottom:${t.bottom}`,
            `transform:scale(${t.scale})`
        ].join(';');

        // Trunk
        const trunk = document.createElement('div');
        trunk.style.cssText = [
            'width:10px', 'height:20px',
            'background:#8B6914',
            'margin:0 auto',
            'border-radius:2px',
            'box-shadow: inset -2px 0 0 rgba(0,0,0,0.15)'
        ].join(';');

        // Foliage (triangle-ish shape using stacked divs)
        const crown = document.createElement('div');
        crown.style.cssText = 'text-align:center;';

        const layers = [
            { w: 24, h: 18, color: '#2E7D32' },
            { w: 32, h: 18, color: '#388E3C' },
            { w: 40, h: 20, color: '#43A047' },
        ];

        layers.forEach((l, i) => {
            const leaf = document.createElement('div');
            leaf.style.cssText = [
                `width:0`, `height:0`,
                `border-left:${l.w / 2}px solid transparent`,
                `border-right:${l.w / 2}px solid transparent`,
                `border-bottom:${l.h}px solid ${l.color}`,
                `margin: 0 auto ${-4}px`
            ].join(';');
            crown.appendChild(leaf);
        });

        tree.appendChild(crown);
        tree.appendChild(trunk);
        container.appendChild(tree);
    });
}

function submit() {
    const name = (input.value.trim() || 'Player').substring(0, 16);
    localStorage.setItem('crawlr_playerName', name);

    // Fade out transition
    overlay.style.transition = 'opacity 0.4s ease-out';
    overlay.style.opacity = '0';
    setTimeout(() => {
        overlay.remove();
        overlay = null;
        const styleEl = document.getElementById('crawlr-start-styles');
        if (styleEl) styleEl.remove();
        if (resolvePromise) {
            resolvePromise(name);
            resolvePromise = null;
        }
    }, 400);
}
