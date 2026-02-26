# Code Organization

## Structure Overview

This codebase is organized into modular components, with core game systems separated into libraries under the `libs/` directory. The main entry point is `app.js`, which imports and initializes these systems.

## Key Modules

### Core Game Structure
- **app.js**: Main entry point that initializes the game world and components
- **libs/GameLoop.js**: Manages the main game loop and coordinates system updates

### Rendering & Visuals
- **libs/RendererSetup.js**: Configures the Three.js renderer
- **libs/CameraSetup.js**: Sets up camera and orbit controls
- **libs/Lighting.js**: Handles scene lighting
- **libs/SkySphere.js**: Creates the game's sky background
- **libs/TextureLoader.js**: Utility for loading textures

### Physics & Game Objects
- **libs/PhysicsConfig.js**: Contains physics-related configuration values
- **libs/Ground.js**: Creates the ground plane
- **libs/Player.js**: Manages player creation and movement
- **libs/Coin.js**: Defines coin objects
- **libs/CoinManager.js**: Handles spawning and managing coins
- **libs/PushableBlock.js**: Implements pushable block mechanics

### Game Systems
- **libs/InputHandler.js**: Processes keyboard/mouse input
- **libs/CollisionHandler.js**: Detects and handles object collisions
- **libs/Sound.js**: Manages game audio
- **libs/Tail.js**: Implements the snake-like tail system

## Data Flow

1. **Initialization**: app.js initializes all systems and game objects
2. **Main Loop**: GameLoop.js coordinates the update cycle:
   - Process physics (Rapier)
   - Handle collisions
   - Update player movement
   - Update visual positions
   - Update tail
   - Render frame

## System Interactions

- **Player → Tail**: Player movement is recorded in position history for tail to follow
- **Coins → Tail**: When coins are collected, a new tail segment is added
- **Input → Player**: User input controls player movement
- **Physics → Visuals**: Physics engine positions are applied to Three.js meshes 