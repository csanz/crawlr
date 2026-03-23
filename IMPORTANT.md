# Important: Do Not Modify These Files

## Multiplayer-Critical Files (crawlr-game-web)

The following files are **synced from the platform version** (`platform/jx-games/crawlr-game/`).
Modifying them can cause multiplayer flickering/jitter that is extremely hard to debug.

### Do NOT modify without testing multiplayer:

| File | Why |
|------|-----|
| `libs/GameLoop.js` | Client-side prediction, reconciliation, camera follow. Even small changes (extra multipliers, different tail spacing, removing networkMode guards) cause camera jitter visible as scene-wide flickering. |
| `libs/RemotePlayer.js` | Remote entity rendering. Adding per-player objects (glow meshes, particle systems, outline meshes) or changing tail segment count (TAIL_NET_MULTIPLIER) tanks framerate and causes jitter. |
| `libs/CameraSetup.js` | Camera orbit, zoom, auto-follow. Parameter changes affect camera stability. |
| `libs/Tail.js` | Tail segment positioning, history buffer. Changes to maxHistoryLength, emissive materials, or segment follow logic affect both visuals and performance. |
| `libs/MuteButton.js` | Imported by GameLoop.js — must exist. |

### What went wrong (March 2026)

Added these per-remote-player features that destroyed multiplayer performance:
- `SpeedParticleSystem` per remote player (10 bots = 10 particle systems)
- Glow mesh per remote player (transparent additive-blending)
- Outline mesh per non-bot player
- `TAIL_NET_MULTIPLIER = 3` tripled tail segment count (~600 meshes vs ~200)
- Removed rate-limiting on tail segment changes
- Removed `networkMode` guard on lightning damage (client fought server over scale)
- Changed interpolation from `t=0.5` to `t=1.0`

Result: camera jitter making the entire scene (mountains, coins, everything) flicker.

### Safe to modify

- `libs/network/Protocol.js` — wire format decoding (v1 version byte support)
- `libs/network/NetworkManager.js` — event handling, snapshot storage
- `app.js` — game startup, event wiring, UI flow
- All HUD files, Sound.js, themes, etc.

### Testing checklist before committing multiplayer changes

1. `npx vite build` — compiles clean
2. Join multiplayer (`?mode=multiplayer`)
3. Verify NO flickering on static objects (mountains, ground)
4. Verify smooth camera follow (no jitter)
5. Verify remote players render and move smoothly
6. Verify tails render correctly on both local and remote players
