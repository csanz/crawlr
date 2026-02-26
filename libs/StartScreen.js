/**
 * @module StartScreen
 * Slither.io-style start screen with name input.
 * Shows before the game begins. On submit, hides and calls back with the name.
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

        overlay = document.createElement('div');
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:10000',
            'display:flex', 'align-items:center', 'justify-content:center',
            'background:rgba(0,0,0,0.8)',
            'font-family:monospace'
        ].join(';');

        const box = document.createElement('div');
        box.style.cssText = [
            'text-align:center', 'color:#fff', 'max-width:320px', 'width:100%'
        ].join(';');

        // Title
        const title = document.createElement('div');
        title.textContent = 'Crawlr';
        title.style.cssText = 'font-size:42px; font-weight:bold; color:#00ffcc; margin-bottom:8px; letter-spacing:2px;';
        box.appendChild(title);

        // Subtitle
        const sub = document.createElement('div');
        sub.textContent = 'collect coins, grow your tail, avoid other snakes';
        sub.style.cssText = 'font-size:12px; color:rgba(255,255,255,0.5); margin-bottom:32px;';
        box.appendChild(sub);

        // Name label
        const label = document.createElement('div');
        label.textContent = 'What is your name?';
        label.style.cssText = 'font-size:14px; color:rgba(255,255,255,0.8); margin-bottom:12px;';
        box.appendChild(label);

        // Name input
        input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 16;
        input.placeholder = 'Enter name...';
        input.value = localStorage.getItem('crawlr_playerName') || '';
        input.style.cssText = [
            'width:200px', 'padding:10px 16px',
            'font:16px monospace', 'text-align:center',
            'background:rgba(255,255,255,0.1)', 'border:1px solid rgba(255,255,255,0.3)',
            'border-radius:8px', 'color:#fff', 'outline:none',
            'margin-bottom:20px'
        ].join(';');
        input.addEventListener('focus', () => {
            input.style.borderColor = '#00ffcc';
        });
        input.addEventListener('blur', () => {
            input.style.borderColor = 'rgba(255,255,255,0.3)';
        });
        box.appendChild(input);

        // Play button
        const btn = document.createElement('div');
        btn.style.cssText = 'margin-top:4px;';

        const playBtn = document.createElement('button');
        playBtn.textContent = 'Play';
        playBtn.style.cssText = [
            'padding:10px 40px',
            'font:bold 16px monospace', 'color:#000',
            'background:#00ffcc', 'border:none', 'border-radius:8px',
            'cursor:pointer', 'letter-spacing:1px'
        ].join(';');
        playBtn.addEventListener('mouseenter', () => {
            playBtn.style.background = '#33ffd9';
        });
        playBtn.addEventListener('mouseleave', () => {
            playBtn.style.background = '#00ffcc';
        });
        playBtn.addEventListener('click', submit);
        btn.appendChild(playBtn);
        box.appendChild(btn);

        // Controls hint
        const hint = document.createElement('div');
        hint.textContent = 'WASD to move | Shift to sprint | ? for help';
        hint.style.cssText = 'font-size:10px; color:rgba(255,255,255,0.3); margin-top:24px;';
        box.appendChild(hint);

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        // Enter key submits
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submit();
            e.stopPropagation(); // Don't trigger game inputs
        });
        // Prevent game input while typing
        input.addEventListener('keyup', (e) => e.stopPropagation());

        // Auto-focus
        setTimeout(() => input.focus(), 100);
    });
}

function submit() {
    const name = (input.value.trim() || 'Player').substring(0, 16);
    localStorage.setItem('crawlr_playerName', name);
    overlay.remove();
    overlay = null;
    if (resolvePromise) {
        resolvePromise(name);
        resolvePromise = null;
    }
}
