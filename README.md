# Crawlr

A 3D snake game built with [Three.js](https://threejs.org/) and [Rapier](https://rapier.rs/) physics. Grow your tail by collecting coins, dodge lightning storms, race AI bots, and compete for the top of the leaderboard.

<!-- Add a screenshot or GIF here -->
<!-- ![Crawlr gameplay](screenshot.png) -->

## Features

- **3D physics-based gameplay** -- Rapier3D handles collisions, gravity, and movement
- **AI bots** -- 10 bot snakes with state-machine AI (wander, chase, avoid, attack)
- **Tail mechanics** -- Collect coins to grow, sprint to burn tail segments as fuel
- **Pickup system** -- Coins, fruits (2x value), power rings (shield, speed burst, growth surge), and post-storm water drops
- **Storm weather** -- Dynamic storms with lightning strikes, fog, and ambient audio. Bigger snakes are more likely to get struck
- **Round system** -- Timed rounds with podium screen showing top 3 players
- **Sprint & dash** -- Hold Shift to sprint (burns tail), double-tap Space for an air dash with flip animation
- **Minimap radar** -- Bottom-right radar showing all entities and pickups
- **Eye physics** -- Googly eyes with inertia, squinting during sprints, and pain reactions on electrocution

## Controls

| Key | Action |
|-----|--------|
| `W` `A` `S` `D` | Move |
| `Shift` | Sprint (burns tail segments) |
| `Space` | Jump |
| `Space` (mid-air) | Air dash with flip |
| `Z` | Cycle zoom level |
| `V` | Cycle camera angle |
| `M` | Toggle mute |
| `P` | Toggle FPS stats |
| `` ` `` | Toggle admin panel |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- npm (comes with Node.js)

### Installation

```bash
git clone <your-repo-url>
cd simple-game-slither
npm install
```

### Development

```bash
npm run dev
```

Opens at `http://localhost:5173`. Vite provides hot module reloading.

### Build for Production

```bash
npm run build
```

Output goes to `dist/`. Preview the build with:

```bash
npm run preview
```

### Deploy to Vercel

The project works out of the box with Vercel:

1. Push to GitHub
2. Import the repo in [Vercel](https://vercel.com)
3. Framework preset: **Vite**
4. Build command: `npm run build`
5. Output directory: `dist`

## Project Structure

```
crawlr/
├── app.js                    # Entry point -- wires all systems together
├── index.html                # Minimal HTML shell
├── vite.config.js            # Vite + WASM plugin config
├── libs/
│   ├── PhysicsConfig.js      # All gameplay constants (speeds, sizes, counts)
│   ├── GameLoop.js           # Main update loop -- physics, rendering, effects
│   ├── EventBus.js           # Pub/sub event system
│   ├── Logger.js             # Scoped debug logger
│   │
│   ├── Player.js             # Player mesh, movement, glow, eye physics
│   ├── InputHandler.js       # Keyboard input -> moveState
│   ├── Tail.js               # Snake tail system (ring buffer + segments)
│   ├── SprintSystem.js       # Sprint-burns-tail mechanic
│   │
│   ├── BotManager.js         # AI bot spawning + state machine
│   ├── CollisionHandler.js   # Physics collision routing
│   ├── DeathManager.js       # Entity death, respawn, coin scattering
│   ├── RoundManager.js       # Round timer + end-of-round rankings
│   │
│   ├── pickups/
│   │   ├── BasePickup.js     # Abstract base class (lifecycle contract)
│   │   ├── PickupManager.js  # Spawn, track, despawn, collision queue
│   │   ├── CoinPickup.js     # Basic collectible (+1 score, +1 growth)
│   │   ├── FruitPickup.js    # Rare 2x pickup (15s despawn)
│   │   ├── WaterDropPickup.js # Post-storm 2x bonus (20s despawn)
│   │   ├── RingPickup.js     # Power rings (shield/speed/growth surge)
│   │   └── index.js          # Barrel exports
│   │
│   ├── themes/
│   │   ├── ThemeManager.js   # Theme scheduling + lifecycle
│   │   ├── DefaultTheme.js   # Clear weather baseline
│   │   └── StormTheme.js     # Storm with lightning, fog, rain audio
│   │
│   ├── Sound.js              # Web Audio API -- load, play, effects, snippets
│   ├── CameraSetup.js        # Camera, orbit controls, zoom/angle cycling
│   ├── Lighting.js           # Directional + ambient lighting
│   ├── RendererSetup.js      # Three.js WebGL renderer config
│   ├── SpeedParticles.js     # Speed-line particles during movement
│   │
│   ├── Ground.js             # Ground plane mesh + physics
│   ├── BorderMountains.js    # Map boundary mountains
│   ├── Boulders.js           # Boulder obstacles
│   ├── PushableBlock.js      # Physics-interactive block
│   ├── SkySphere.js          # Sky background sphere
│   ├── MapLoader.js          # Load map layout from JSON
│   │
│   ├── StartScreen.js        # Name entry + start overlay
│   ├── DeathScreen.js        # Death overlay with stats
│   ├── PodiumScreen.js       # End-of-round top 3 with snake avatars
│   ├── ScoreHUD.js           # Coin counter display
│   ├── SprintHUD.js          # Sprint fuel bar
│   ├── PowerUpHUD.js         # Active power-up indicator
│   ├── RoundHUD.js           # Round timer display
│   ├── KeyboardHelp.js       # Controls hint overlay
│   ├── Leaderboard.js        # Live leaderboard sidebar
│   ├── Radar.js              # Minimap canvas rendering
│   ├── PlayerList.js         # Entity name registry
│   ├── NameLabels.js         # 3D floating name labels
│   ├── TextureLoader.js      # Texture loading utility
│   └── ThemeAdmin.js         # Dev admin panel (` key)
│
├── public/
│   ├── style.css             # Base styles
│   ├── assets/               # Textures (ground, player, sky, tail)
│   ├── effects/              # Sound effects (dash, lightning, birds)
│   ├── themes/               # Theme audio (storm ambient)
│   ├── maps/                 # Map data (default.json)
│   └── *.mp3                 # Core audio (ambiance, coin collect)
│
└── docs/                     # Design documents
```

## Architecture

### Event-Driven Design

All inter-module communication goes through `EventBus`. Key events:

| Event | Payload | Description |
|-------|---------|-------------|
| `entity:move` | `{ id, x, z, angle, sprinting }` | Entity position update |
| `entity:died` | `{ id, killedBy, tailLength }` | Entity death |
| `entity:spawned` | `{ id, position, isBot }` | New entity entered |
| `tail:grew` | `{ entityId, newLength }` | Tail segment added |
| `tail:burned` | `{ entityId, segmentsBurned }` | Sprint consumed tail |
| `pickup:collected` | `{ type, entityId, position }` | Pickup collected |
| `lightning:strike` | `{ x, z, hitRadius, sizeLoss }` | Lightning bolt |
| `lightning:hit` | `{ entityId, newSize }` | Entity struck by lightning |
| `ring:hit` | `{ entityId, segmentsLost }` | Entity hit ring obstacle |
| `ring:shocked` | `{ entityId }` | Ring electrocution visual |
| `theme:started` | `{ name }` | Weather theme activated |
| `theme:ended` | `{ name }` | Weather theme ended |
| `round:start` | `{ roundNumber, duration }` | New round began |
| `round:end` | `{ roundNumber, rankings }` | Round finished |
| `player:freeze` | `boolean` | Freeze/unfreeze player input |

### Pickup System

All pickups extend `BasePickup` and are managed by `PickupManager`:

```
BasePickup (abstract)
  ├── CoinPickup       maxCount: 400, no despawn
  ├── FruitPickup      maxCount: 8, despawns after 15s
  ├── WaterDropPickup  maxCount: 0 (event-spawned only), despawns after 20s
  └── RingPickup       maxCount: 5, jump-through for powers
```

Each pickup defines: `config`, `create()`, `updateInstance()`, `onCollect()`, `getRadarInfo()`.

### Bot AI State Machine

Bots cycle through states based on proximity to threats, coins, and rings:

```
WANDER -> CHASE_COIN  (coin/fruit/waterdrop nearby)
       -> AVOID       (threat nearby)
       -> AVOID_RING  (ring nearby)
       -> ATTACK      (long tail + threat visible)
```

Anti-circling detection forces a breakout after ~2 full rotations.

### Theme System

Themes are scheduled randomly by `ThemeManager` and affect the environment:

- **DefaultTheme** -- Clear sky, normal lighting
- **StormTheme** -- Darkened sky, fog, lightning strikes, rain audio. When it ends, spawns 12 water drop pickups and plays bird sounds

## Adding a New Pickup

1. Create `libs/pickups/MyPickup.js` extending `BasePickup`
2. Define `static get config()` with `type`, `maxCount`, `spawnAreaXZ`, `spawnHeight`, `despawnAfter`
3. Implement `create()`, `updateInstance()`, `onCollect()`, `getRadarInfo()`
4. Export from `libs/pickups/index.js`
5. Register in `app.js`: `new MyPickup(scene, world)` then `pickupManager.register()`
6. Add collision routing in `CollisionHandler.js` (player + bot blocks)
7. Add bot targeting in `BotManager.js` `updateAI()` if bots should chase it

## Adding a New Theme

1. Create `libs/themes/MyTheme.js` with static `name`, `duration`, `apply()`, `remove()`, `update()`
2. Register in `app.js`: `themeManager.registerTheme(MyTheme)`
3. Listen for `theme:ended` with `{ name: 'MyTheme' }` for post-theme effects

## Tech Stack

- **[Three.js](https://threejs.org/)** -- 3D rendering (WebGL)
- **[Rapier3D](https://rapier.rs/)** -- Physics engine (WASM)
- **[Vite](https://vitejs.dev/)** -- Build tool with WASM support
- **[stats.js](https://github.com/mrdoob/stats.js/)** -- FPS/performance monitor
- **Web Audio API** -- Sound effects with pitch variation and volume fades

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Test locally with `npm run dev`
5. Commit with a descriptive message
6. Push and open a PR

### Code Style

- ES modules (`import`/`export`) throughout
- JSDoc comments on all exported functions
- Use `EventBus` for cross-module communication (no direct imports between unrelated systems)
- Use `Logger.js` for debug output (never raw `console.log`)
- Constants go in `PhysicsConfig.js`
- Keep files focused -- one system per module

## License

MIT
