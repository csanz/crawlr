/**
 * @module app
 * Game entry point. Initializes the scene, physics, and starts the game loop.
 */
import * as THREE from 'three';
import Stats from 'stats.js';
import { createLogger } from './libs/Logger.js';
import { setupLighting } from './libs/Lighting.js';
import { setupCamera, setupOrbitControls } from './libs/CameraSetup.js';
import { initSprintHUD } from './libs/SprintHUD.js';
import { initScoreHUD } from './libs/ScoreHUD.js';
import { initKeyboardHelp } from './libs/KeyboardHelp.js';
import { initLeaderboard, updateLeaderboardStats, setLeaderboardNetworkManager } from './libs/Leaderboard.js';
import { initInputHandler } from './libs/InputHandler.js';
import { createPlayer } from './libs/Player.js';
import { createPushableBlock } from './libs/PushableBlock.js';
import { createSkySphere } from './libs/SkySphere.js';
import { setupRenderer } from './libs/RendererSetup.js';
import { createGround } from './libs/Ground.js';
import { createBorderMountains } from './libs/BorderMountains.js';
import { createBoulders } from './libs/Boulders.js';
import { GRAVITY, BOT_COUNT, COIN_SPAWN_AREA_XZ, SERVER_URL, ADMIN_API_URL } from './libs/PhysicsConfig.js';
import { CrawlrNet } from './libs/CrawlrNet.js';
import { addNameLabel } from './libs/NameLabels.js';
import { initSoundSystem, playSnippet, playSound } from './libs/Sound.js';
import { initTailSystem, getPlayerTail } from './libs/Tail.js';
import { PickupManager, CoinPickup, FruitPickup, WaterDropPickup, RingPickup } from './libs/pickups/index.js';
import { CollisionHandler } from './libs/CollisionHandler.js';
import { GameLoop } from './libs/GameLoop.js';
import { DeathManager } from './libs/DeathManager.js';
import { BotManager } from './libs/BotManager.js';
import { eventBus } from '@jazaix/jx-sdk';
import { initPlayerList, setPlayerName, registerBot, getEntityName } from './libs/PlayerList.js';
import { showStartScreen } from './libs/StartScreen.js';
import { showDeathScreen } from './libs/DeathScreen.js';
import { SpectatorMode } from './libs/SpectatorMode.js';
import { ThemeManager } from './libs/themes/ThemeManager.js';
import { DefaultTheme } from './libs/themes/DefaultTheme.js';
import { StormTheme } from './libs/themes/StormTheme.js';
import { initThemeAdmin } from './libs/ThemeAdmin.js';
import { initPowerUpHUD } from './libs/PowerUpHUD.js';
import { loadMap } from './libs/MapLoader.js';
import { createClouds, updateClouds } from './libs/Clouds.js';
import { RoundManager } from './libs/RoundManager.js';
import { initRoundHUD, hideRoundHUD, showRoundHUD, showRoundStart } from './libs/RoundHUD.js';
import { showPodiumScreen } from './libs/PodiumScreen.js';
import { initActivityFeed } from './libs/ActivityFeed.js';
import { initTouchControls } from './libs/TouchControls.js';
import { initGameMenu } from './libs/GameMenu.js';
import { initChatUI } from './libs/ChatUI.js';
import { NetDebug } from '@jazaix/jx-sdk';

const log = createLogger('App');

// --- Scene setup ---
log.info('Initializing scene');
const scene = new THREE.Scene();
const camera = setupCamera(window.innerWidth, window.innerHeight);
scene.add(camera);
camera.lookAt(scene.position);

const renderer = setupRenderer();
const controls = setupOrbitControls(camera, renderer.domElement);
log.info('Renderer and camera ready');

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
});

// --- Stats (toggle with P key) ---
const stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.dom);
stats.dom.style.position = 'absolute';
stats.dom.style.top = '0px';
stats.dom.style.left = '0px';
stats.dom.style.zIndex = '100';
window.statsEnabled = false;
stats.dom.style.display = 'none';

window.addEventListener('keydown', (event) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (event.key.toLowerCase() === 'p') {
        window.statsEnabled = !window.statsEnabled;
        stats.dom.style.display = window.statsEnabled ? 'block' : 'none';
    }
    if (event.key === 'N' && event.shiftKey) {
        window.__netDebug?.toggle();
    }
});

// --- Network debug overlay (Shift+N or ?debug=perf) ---
const _netDebug = new NetDebug();
window.__netDebug = _netDebug;
if (new URLSearchParams(window.location.search).get('debug') === 'perf') {
    _netDebug.show();
}

// --- HUD ---
initSprintHUD();
initScoreHUD();
initKeyboardHelp();
initPlayerList();
initPowerUpHUD();
initRoundHUD();
initActivityFeed();

// --- Environment ---
createSkySphere(scene, renderer);
const directionalLight = setupLighting(scene);
scene.add(directionalLight.target);

// --- Show start screen, then init game ---

// If multiplayer mode requested without a room, redirect to lobby
const _urlParams = new URLSearchParams(window.location.search);
const _isSpectator = _urlParams.get('mode') === 'spectator';

if (_isSpectator) {
    // Spectator/peek mode — no start screen, no player name needed
    startSpectatorMode();
} else if (_urlParams.get('mode') === 'multiplayer' && !_urlParams.get('room')) {
    window.location.href = '/lobby.html';
} else {
    // If name is provided via URL (from portal), skip the start screen entirely
    const urlName = _urlParams.get('name');
    const namePromise = urlName
        ? Promise.resolve(urlName)
        : showStartScreen();

    namePromise.then(playerName => {
        // Persist for future visits
        localStorage.setItem('crawlr_playerName', playerName);

        const isMultiplayer = _urlParams.get('mode') === 'multiplayer';
        if (isMultiplayer) {
            startMultiplayerGame(playerName);
        } else {
            startGame(playerName);
        }
    });
}

/**
 * Spectator/peek mode: connects as an observer (no entity, no input).
 * Renders the live game and allows camera follow + free-fly.
 * Communicates with the parent window (portal PeekModal) via postMessage.
 */
async function startSpectatorMode() {
    log.info('Starting spectator/peek mode...');

    const params = new URLSearchParams(window.location.search);
    const room = params.get('room') || 'default';
    const token = params.get('token') || '';

    // Show connecting overlay
    const overlay = document.createElement('div');
    overlay.id = 'connecting-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-family:monospace;';
    overlay.textContent = 'Connecting as spectator...';
    document.body.appendChild(overlay);

    // Connect as observer (spectator mode — no entity created, no player count)
    const networkManager = new CrawlrNet(SERVER_URL);
    // Game key is auto-loaded from jx.config.js → window.__JX_CONFIG__ → SDK.
    // The typeof guard handles cases where SDK script hasn't loaded yet.
    const gameKey = (typeof JxSDK !== 'undefined' && JxSDK.getGameKey) ? JxSDK.getGameKey() || '' : '';
    const connected = await networkManager.connectAsObserver(room, token, gameKey);

    if (!connected) {
        overlay.innerHTML = `<div style="text-align:center;"><div>Failed to connect</div><div style="font-size:14px;color:#aaa;margin-top:8px;">${networkManager.lastError || ''}</div></div>`;
        return;
    }
    overlay.remove();

    // Attach network debug overlay
    _netDebug.setNetworkManager(networkManager);

    // Load Rapier for visual scene setup (no physics stepping)
    const RAPIER = await import('@dimforge/rapier3d');
    const world = new RAPIER.World(GRAVITY);
    const eventQueue = new RAPIER.EventQueue(true);

    // Initialize sound on first interaction
    const startSound = () => { initSoundSystem(); };
    document.addEventListener('click', startSound, { once: true });
    document.addEventListener('keydown', startSound, { once: true });

    // Load map and create environment
    const mapData = await loadMap('/maps/default.json');
    createGround(scene, world, renderer);
    createBorderMountains(scene, world, mapData);
    createBoulders(scene, world, mapData ? mapData.boulders : null);
    createClouds(scene);
    DefaultTheme.apply(scene);

    // No local player mesh, no input handler, no touch controls
    // Minimal pickup manager for rendering server pickups
    const pickupManager = new PickupManager(scene, world);
    const coinPickup = new CoinPickup(scene, world);
    pickupManager.register(coinPickup);
    const collisionHandler = new CollisionHandler(world, pickupManager);
    const deathManager = new DeathManager(scene, world, pickupManager);

    // Dummy player mesh (invisible — needed by GameLoop but observer has no player)
    const { playerMesh, playerBody } = createPlayer(scene, world, renderer);
    playerMesh.visible = false;
    const { blockMesh, blockBody } = createPushableBlock(scene, world, renderer);

    // Storm theme for visual weather
    StormTheme.setDeathManager(deathManager);
    StormTheme.setPlayerMesh(playerMesh);
    StormTheme._networkMode = true;

    // Fetch game settings to check if free-fly is allowed
    let allowFreeFly = true;
    try {
        const gameSlug = params.get('game') || 'crawlr';
        const settingsRes = await fetch(`${ADMIN_API_URL}/api/games/${gameSlug}/settings`);
        if (settingsRes.ok) {
            const settings = await settingsRes.json();
            if (settings?.general?.allow_spectator_free_fly === false) {
                allowFreeFly = false;
            }
        }
    } catch { /* use default (true) */ }

    // Spectator mode with peek options
    const spectatorMode = new SpectatorMode({
        getEntityName,
        isPeekMode: true,
        allowFreeFly,
        onRequestJoin: () => {
            // Tell parent to join this server
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'peek:join' }, '*');
            }
        },
        onRequestClose: () => {
            networkManager.disconnect();
            if (window.parent !== window) {
                window.parent.postMessage({ type: 'peek:close' }, '*');
            }
        },
    });

    // Configure game loop in network mode
    const gameLoop = new GameLoop(scene, world, eventQueue, renderer, camera, controls);
    gameLoop.setup(playerMesh, playerBody, blockMesh, blockBody, pickupManager, collisionHandler, stats, null, deathManager);
    gameLoop.setNetworkMode(networkManager);
    gameLoop.playerFrozen = true; // No local player to control

    // Share remote meshes with storm theme
    StormTheme.setRemotePlayerMeshes(gameLoop._remotePlayerMeshes);

    // Start spectator mode immediately — follows remote players
    spectatorMode.start(gameLoop._remotePlayerMeshes);
    gameLoop.spectatorTarget = spectatorMode;

    gameLoop.start();
    log.info('Spectator game loop started');

    // postMessage bridge with parent (portal PeekModal)
    if (window.parent !== window) {
        window.parent.postMessage({ type: 'peek:ready' }, '*');

        window.addEventListener('message', (e) => {
            if (!e.data || typeof e.data.type !== 'string') return;
            if (e.data.type === 'peek:close') {
                networkManager.disconnect();
                spectatorMode.stop();
            }
        });
    }
}

async function startGame(playerName) {
    // Load map data (falls back to random if unavailable)
    const mapData = await loadMap('/maps/default.json');

    // --- Physics & Game Objects ---
    log.info('Loading Rapier3D physics engine...');
    const RAPIER = await import('@dimforge/rapier3d');
    log.info('Physics engine loaded');
    const world = new RAPIER.World(GRAVITY);

    // Initialize sound on first user interaction
    const startSound = () => { initSoundSystem(); };
    document.addEventListener('click', startSound, { once: true });
    document.addEventListener('keydown', startSound, { once: true });

    // Create game objects — pass map data for deterministic layout
    const groundPlane = createGround(scene, world, renderer);
    createBorderMountains(scene, world, mapData);
    createBoulders(scene, world, mapData ? mapData.boulders : null);
    createClouds(scene);
    DefaultTheme.apply(scene);
    const { playerMesh, playerBody } = createPlayer(scene, world, renderer);
    playerBody.userData = { type: 'player' };

    // Player name label
    addNameLabel(playerMesh, 'You');

    // Initialize tail system (now needs scene and world for sensor colliders)
    initTailSystem(renderer, playerMesh, scene, world);

    const eventQueue = new RAPIER.EventQueue(true);
    initInputHandler(playerBody, playerMesh);
    initTouchControls();
    initGameMenu();

    const { blockMesh, blockBody } = createPushableBlock(scene, world, renderer);
    blockBody.userData = { type: 'block' };

    // --- Pickup system ---
    const pickupManager = new PickupManager(scene, world);
    const coinPickup = new CoinPickup(scene, world);
    const fruitPickup = new FruitPickup(scene, world);
    const waterDropPickup = new WaterDropPickup(scene, world);
    const ringPickup = new RingPickup(scene, world);
    pickupManager.register(coinPickup);
    pickupManager.register(fruitPickup);
    pickupManager.register(waterDropPickup);
    pickupManager.register(ringPickup);

    // Wire coin pickup references
    coinPickup.setPlayerBody(playerBody);
    coinPickup.setPlayerMesh(playerMesh);
    coinPickup.setRingHandler(ringPickup);

    // Wire fruit pickup references
    fruitPickup.setPlayerBody(playerBody);
    fruitPickup.setPlayerMesh(playerMesh);
    fruitPickup.setRingHandler(ringPickup);
    fruitPickup.setCoinPickup(coinPickup);

    // Wire water drop pickup references
    waterDropPickup.setPlayerBody(playerBody);
    waterDropPickup.setPlayerMesh(playerMesh);
    waterDropPickup.setRingHandler(ringPickup);
    waterDropPickup.setCoinPickup(coinPickup);

    // Create death manager (uses pickupManager for coin scattering)
    const deathManager = new DeathManager(scene, world, pickupManager);

    // Register player with death manager
    const playerTail = getPlayerTail();

    // Init leaderboard (after playerTail is available)
    initLeaderboard(() => ({
        coins: coinPickup.coinsCollected,
        tailLength: playerTail ? playerTail.getLength() : 0,
        size: playerMesh.scale.x
    }), playerName);
    deathManager.registerEntity('player', {
        mesh: playerMesh,
        body: playerBody,
        tail: playerTail,
        isBot: false
    });

    // Register player name for player list
    setPlayerName(playerName);
    eventBus.emit('entity:joined', { entityId: 'player', name: playerName });

    // Create bot manager
    const botManager = new BotManager(scene, world, pickupManager, deathManager);

    // Wire ring pickup references
    ringPickup.setPlayerMesh(playerMesh);
    ringPickup.setBotManager(botManager);
    ringPickup.setPlayerTail(playerTail);

    // Wire coin pickup bot reference
    coinPickup.setBotManager(botManager);

    // Wire fruit pickup bot reference
    fruitPickup.setBotManager(botManager);

    // Wire water drop pickup bot reference
    waterDropPickup.setBotManager(botManager);

    // Wire death manager ring reference (for shield/ghost immunity)
    deathManager.setRingHandler(ringPickup);

    const collisionHandler = new CollisionHandler(world, pickupManager);
    collisionHandler.setDeathManager(deathManager);
    collisionHandler.setBotManager(botManager);

    // Spawn bots and register their names
    for (let i = 0; i < BOT_COUNT; i++) {
        const bot = botManager.spawnBot();
        const botName = registerBot(bot.id);
        eventBus.emit('entity:joined', { entityId: bot.id, name: botName });
    }

    // Listen for player death — freeze input, show death screen, resume on "Play Again"
    eventBus.on('entity:died', (payload) => {
        if (payload.id === 'player') {
            gameLoop.playerFrozen = true;
            playSound('gameover', 0.3);
            showDeathScreen({
                killedBy: payload.killedBy,
                score: coinPickup.coinsCollected,
                tailLength: payload.tailLength,
                getEntityName
            }).then(() => {
                gameLoop.playerFrozen = false;
            });
        }
    });

    // Configure and start game loop
    const gameLoop = new GameLoop(scene, world, eventQueue, renderer, camera, controls);
    gameLoop.setup(playerMesh, playerBody, blockMesh, blockBody, pickupManager, collisionHandler, stats, botManager, deathManager);

    // Theme/weather system
    const themeManager = new ThemeManager(scene);
    themeManager.setPlayerMesh(playerMesh);
    themeManager.setPlayerTail(playerTail);
    StormTheme._botManager = botManager;
    StormTheme.setDeathManager(deathManager);
    themeManager.registerTheme(StormTheme);
    gameLoop.setThemeManager(themeManager);

    // Spawn water drops when storm ends
    eventBus.on('theme:ended', (payload) => {
        if (payload.name === 'Storm') {
            const dropCount = 12;
            for (let i = 0; i < dropCount; i++) {
                const pos = new THREE.Vector3(
                    (Math.random() - 0.5) * COIN_SPAWN_AREA_XZ,
                    1,
                    (Math.random() - 0.5) * COIN_SPAWN_AREA_XZ
                );
                pickupManager.spawnAt('waterdrop', pos);
            }
            log.info(`Storm ended — spawned ${dropCount} water drops`);

            // Post-storm bird sounds — play a few random snippets staggered over time
            playSnippet('postStormBirds', { volume: 0.25, duration: 6, fadeOut: 2.5 });
            setTimeout(() => playSnippet('postStormBirds', { volume: 0.18, duration: 5, fadeOut: 2 }), 3000);
            setTimeout(() => playSnippet('postStormBirds', { volume: 0.15, duration: 4, fadeOut: 2 }), 7000);
        }
    });

    // Round system
    const roundManager = new RoundManager();
    gameLoop.setRoundManager(roundManager);

    initThemeAdmin(themeManager, playerMesh, roundManager);

    // Round reset helper — resets all entities and pickups for a new round
    function resetRound() {
        // Reset player
        deathManager.resetEntity('player');
        coinPickup.coinsCollected = 0;
        eventBus.emit('score:changed', { entityId: 'player', coins: 0 });

        // Reset all bots
        for (const bot of botManager.bots) {
            deathManager.resetEntity(bot.id);
            // Reset bot AI state
            bot.aiState = 'WANDER';
            bot.sprinting = false;
            bot.spinAccum = 0;
        }

        // Clear and respawn pickups
        pickupManager.clearAll();

        log.info('Round reset complete');
    }

    // Listen for round end
    eventBus.on('round:end', async (payload) => {
        gameLoop.playerFrozen = true;
        hideRoundHUD();

        await showPodiumScreen({
            rankings: payload.rankings,
            roundNumber: payload.roundNumber,
            getEntityName
        });

        // Reset everything for next round
        resetRound();
        showRoundHUD();

        // Start next round
        roundManager.start();
        gameLoop.playerFrozen = false;
        showRoundStart(roundManager.roundNumber);
    });

    // Admin: test podium with current standings
    eventBus.on('admin:show-podium', async () => {
        const entities = roundManager._entities || [];
        const rankings = roundManager.getRankings(entities);
        gameLoop.playerFrozen = true;
        await showPodiumScreen({
            rankings,
            roundNumber: roundManager.roundNumber,
            getEntityName
        });
        gameLoop.playerFrozen = false;
    });

    // Start the first round
    roundManager.start();
    showRoundStart(1);

    gameLoop.start();
    log.info('Game loop started');

    // Debug: log events to console
    if (typeof window !== 'undefined') {
        window.__eventBus = eventBus;
    }
}

/**
 * Multiplayer mode: connects to the Rust game engine, renders from server snapshots.
 * No local physics — the server is authoritative.
 */
async function startMultiplayerGame(playerName) {
    log.info('Starting multiplayer mode...');

    // Show connecting overlay
    const overlay = document.createElement('div');
    overlay.id = 'connecting-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-family:monospace;';
    overlay.textContent = 'Connecting to server...';
    document.body.appendChild(overlay);

    // Connect to server
    const networkManager = new CrawlrNet(SERVER_URL);
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room') || 'default';
    const token = params.get('token') || '';
    // Game key auto-loaded from jx.config.js via SDK (see index.html load order)
    const gameKey = (typeof JxSDK !== 'undefined' && JxSDK.getGameKey) ? JxSDK.getGameKey() || '' : '';
    const connected = await networkManager.connect(playerName, room, token, gameKey);

    if (!connected) {
        const reason = networkManager.lastError || 'Unknown error';
        overlay.innerHTML = `<div style="text-align:center;max-width:600px;padding:20px;">
            <div style="font-size:24px;margin-bottom:16px;">Failed to connect</div>
            <div style="font-size:14px;color:#f88;margin-bottom:16px;">${reason}</div>
            <div style="font-size:14px;color:#aaa;">Ensure the engine is running (cargo run).<br>Click to play single-player instead.</div>
        </div>`;
        overlay.style.cursor = 'pointer';
        overlay.addEventListener('click', () => {
            overlay.remove();
            // Fall back to single-player
            startGame(playerName);
        });
        return;
    }

    overlay.remove();

    // Attach network debug overlay
    _netDebug.setNetworkManager(networkManager);

    // Initialize chat UI for multiplayer
    initChatUI(networkManager);

    // Load Rapier just for creating a minimal world (we need it for createGround/etc visual setup)
    // In network mode, physics won't step — just visuals.
    const RAPIER = await import('@dimforge/rapier3d');
    const world = new RAPIER.World(GRAVITY);
    const eventQueue = new RAPIER.EventQueue(true);

    // Initialize sound on first user interaction
    const startSound = () => { initSoundSystem(); };
    document.addEventListener('click', startSound, { once: true });
    document.addEventListener('keydown', startSound, { once: true });

    // Load map for visual environment
    const mapData = await loadMap('/maps/default.json');

    // Create visual environment (no physics interaction in multiplayer)
    const groundPlane = createGround(scene, world, renderer);
    createBorderMountains(scene, world, mapData);
    createBoulders(scene, world, mapData ? mapData.boulders : null);
    createClouds(scene);
    DefaultTheme.apply(scene);

    // Create local player visual mesh (no physics body used)
    const { playerMesh, playerBody } = createPlayer(scene, world, renderer);
    playerBody.userData = { type: 'player' };
    addNameLabel(playerMesh, playerName);

    // Initialize tail system (visual only in multiplayer)
    initTailSystem(renderer, playerMesh, scene, world);

    initInputHandler(playerBody, playerMesh);
    initTouchControls();
    initGameMenu();

    // Create a dummy block (still needed for visual scene)
    const { blockMesh, blockBody } = createPushableBlock(scene, world, renderer);
    blockBody.userData = { type: 'block' };

    // Minimal pickup manager (server manages pickups, client just renders them)
    const pickupManager = new PickupManager(scene, world);
    const coinPickup = new CoinPickup(scene, world);
    pickupManager.register(coinPickup);

    // Minimal collision handler (unused in network mode)
    const collisionHandler = new CollisionHandler(world, pickupManager);

    // Create death manager (for death events from server)
    const deathManager = new DeathManager(scene, world, pickupManager);
    const playerTail = getPlayerTail();
    deathManager.registerEntity('player', {
        mesh: playerMesh,
        body: playerBody,
        tail: playerTail,
        isBot: false
    });

    setPlayerName(playerName);
    eventBus.emit('entity:joined', { entityId: 'player', name: playerName });

    // Init leaderboard
    initLeaderboard(() => ({
        coins: 0,
        tailLength: playerTail ? playerTail.getLength() : 0,
        size: playerMesh.scale.x
    }), playerName);
    setLeaderboardNetworkManager(networkManager);

    // Spectator mode instance
    const spectatorMode = new SpectatorMode({
        getEntityName,
        onRequestRespawn: () => {
            gameLoop.spectatorTarget = null;
            gameLoop.playerFrozen = false;
            networkManager.sendRespawnRequest();
        },
    });

    // Listen for death events from server
    eventBus.on('entity:died', async (payload) => {
        if (payload.id === 'player') {
            gameLoop.playerFrozen = true;
            playSound('gameover', 0.3);
            const choice = await showDeathScreen({
                killedBy: payload.killedBy,
                score: 0,
                tailLength: payload.tailLength,
                getEntityName,
                showSpectate: true,
            });
            if (choice === 'spectate') {
                spectatorMode.start(gameLoop._remotePlayerMeshes);
                gameLoop.spectatorTarget = spectatorMode;
            } else {
                gameLoop.playerFrozen = false;
                networkManager.sendRespawnRequest();
            }
        }
    });

    // Storm theme needs deathManager and player mesh for puddle drowning
    StormTheme.setDeathManager(deathManager);
    StormTheme.setPlayerMesh(playerMesh);
    StormTheme._networkMode = true;

    // Post-storm effects (bird sounds) — same as single-player path
    eventBus.on('theme:ended', (payload) => {
        if (payload.name === 'Storm') {
            playSnippet('postStormBirds', { volume: 0.25, duration: 6, fadeOut: 2.5 });
            setTimeout(() => playSnippet('postStormBirds', { volume: 0.18, duration: 5, fadeOut: 2 }), 3000);
            setTimeout(() => playSnippet('postStormBirds', { volume: 0.15, duration: 4, fadeOut: 2 }), 7000);
        }
    });

    // Configure game loop in NETWORK MODE
    const gameLoop = new GameLoop(scene, world, eventQueue, renderer, camera, controls);
    gameLoop.setup(playerMesh, playerBody, blockMesh, blockBody, pickupManager, collisionHandler, stats, null, deathManager);
    gameLoop.setNetworkMode(networkManager);

    // Share remote player meshes with StormTheme for puddle/drowning effects
    StormTheme.setRemotePlayerMeshes(gameLoop._remotePlayerMeshes);

    // Listen for round end from server
    eventBus.on('round:end', async (payload) => {
        gameLoop.playerFrozen = true;

        // Exit spectator mode if active
        if (spectatorMode.active) {
            spectatorMode.stop();
            gameLoop.spectatorTarget = null;
        }

        // Clear local pickup meshes (server clears them too)
        if (gameLoop.clearPickupMeshes) gameLoop.clearPickupMeshes();

        hideRoundHUD();

        await showPodiumScreen({
            rankings: payload.rankings,
            roundNumber: payload.roundNumber,
            getEntityName,
            localPlayerId: networkManager.localPlayerId,
        });

        showRoundHUD();
        gameLoop.playerFrozen = false;
        showRoundStart(payload.roundNumber + 1);
    });

    // Clouds and lighting still update
    gameLoop.start();
    log.info('Multiplayer game loop started');

    if (typeof window !== 'undefined') {
        window.__eventBus = eventBus;
        window.__networkManager = networkManager;
    }
}
