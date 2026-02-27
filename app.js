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
import { initLeaderboard, updateLeaderboardStats } from './libs/Leaderboard.js';
import { initInputHandler } from './libs/InputHandler.js';
import { createPlayer } from './libs/Player.js';
import { createPushableBlock } from './libs/PushableBlock.js';
import { createSkySphere } from './libs/SkySphere.js';
import { setupRenderer } from './libs/RendererSetup.js';
import { createGround } from './libs/Ground.js';
import { createBorderMountains } from './libs/BorderMountains.js';
import { createBoulders } from './libs/Boulders.js';
import { GRAVITY, BOT_COUNT, COIN_SPAWN_AREA_XZ } from './libs/PhysicsConfig.js';
import { addNameLabel } from './libs/NameLabels.js';
import { initSoundSystem, playSnippet, playSound } from './libs/Sound.js';
import { initTailSystem, getPlayerTail } from './libs/Tail.js';
import { PickupManager, CoinPickup, FruitPickup, WaterDropPickup, RingPickup } from './libs/pickups/index.js';
import { CollisionHandler } from './libs/CollisionHandler.js';
import { GameLoop } from './libs/GameLoop.js';
import { DeathManager } from './libs/DeathManager.js';
import { BotManager } from './libs/BotManager.js';
import { eventBus } from './libs/EventBus.js';
import { initPlayerList, setPlayerName, registerBot, getEntityName } from './libs/PlayerList.js';
import { showStartScreen } from './libs/StartScreen.js';
import { showDeathScreen } from './libs/DeathScreen.js';
import { ThemeManager } from './libs/themes/ThemeManager.js';
import { DefaultTheme } from './libs/themes/DefaultTheme.js';
import { StormTheme } from './libs/themes/StormTheme.js';
import { initThemeAdmin } from './libs/ThemeAdmin.js';
import { initPowerUpHUD } from './libs/PowerUpHUD.js';
import { loadMap } from './libs/MapLoader.js';
import { createClouds, updateClouds } from './libs/Clouds.js';
import { RoundManager } from './libs/RoundManager.js';
import { initRoundHUD, hideRoundHUD, showRoundHUD } from './libs/RoundHUD.js';
import { showPodiumScreen } from './libs/PodiumScreen.js';
import { initActivityFeed } from './libs/ActivityFeed.js';

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
    if (event.key.toLowerCase() === 'p') {
        window.statsEnabled = !window.statsEnabled;
        stats.dom.style.display = window.statsEnabled ? 'block' : 'none';
    }
});

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
showStartScreen().then(playerName => {
    startGame(playerName);
});

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
        registerBot(bot.id);
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

    gameLoop.start();
    log.info('Game loop started');

    // Debug: log events to console
    if (typeof window !== 'undefined') {
        window.__eventBus = eventBus;
    }
}
