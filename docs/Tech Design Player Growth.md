# Technical Design: Player Growth System

## Overview
This document outlines the implementation of dynamic player growth in our game. Players will grow in size as they collect coins, with color consistency between the player and their tail.

## Core Features
1. **Player Growth**: Increase player size incrementally with each coin collection
2. **Player Coloring**: Assign random bright colors to each player
3. **Tail Coloring**: Match tail segments to player color
4. **Maintain Existing Mechanics**: Preserve Shift-to-run behavior

## Implementation Plan

### Phase 1: Player Growth Mechanism
**Task 1.1: Add Growth Function**
- Add `growPlayer()` function to `libs/Player.js`
- Define growth increment per coin collection (~0.05 units)
- Implement uniform scaling on x, y, and z axes

**Task 1.2: Growth Constraints**
- Define maximum growth size to prevent players from becoming too large
- Add optional decay mechanism to gradually reduce size over time

### Phase 2: Color System
**Task 2.1: Player Color Generation**
- Modify `createPlayer()` in `libs/Player.js` to generate random bright colors
- Store color in `playerMesh.userData.color` for reference
- Implement HSL color model for better control over brightness and saturation

**Task 2.2: Color Access Helper**
- Add `getPlayerColor()` utility function
- Ensure color consistency across different components

### Phase 3: Tail Integration
**Task 3.1: Update Coin Collection Logic**
- Modify `processCoinCollection()` in `libs/CoinManager.js`
- Trigger both player growth and tail segment creation on coin collection
- Pass player mesh reference to CoinManager for access to color data

**Task 3.2: Tail Coloring**
- Update `addTailSegment()` in `libs/Tail.js` to accept color parameter
- Apply player color to new tail segments

### Phase 4: Testing & Refinement
**Task 4.1: Visual Balance Testing**
- Test different growth rates for gameplay balance
- Ensure camera behavior works well with larger player sizes

**Task 4.2: Performance Optimization**
- Monitor performance impact with many tail segments
- Implement culling or simplification for distant tail segments if needed

## Technical Considerations

### Camera Adjustments
The current camera setup in `libs/CameraSetup.js` may need adjustment to accommodate larger player models:
- Consider dynamically adjusting `minDistance` based on player size
- Review camera follow logic to maintain optimal viewing angle

### Physics Implications
- Determine if physics body should scale with visual mesh
- Consider collision performance with larger hitboxes

### Potential Future Enhancements
- Visual effects for growth (particle effects, animation)
- Size-based gameplay mechanics (larger players move slower)
- Power-ups that temporarily modify growth rate

## Dependencies
- Three.js for rendering
- Existing player, camera, and tail systems

## Implementation Timeline
- Phase 1: 1-2 days
- Phase 2: 1 day
- Phase 3: 1-2 days
- Phase 4: 1-2 days

Total estimated time: 4-7 days 