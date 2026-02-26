# Technical Design: Slither Tail Implementation

## Overview

This document outlines the implementation of a snake-like tail system for our game, where the player's tail grows incrementally as they collect gold coins.

## Core Mechanics

### Position History Buffer

- Maintain an array of past player positions
- Record player positions each frame
- Limit history length based on maximum expected tail segments

### Tail Segment Management

- Each tail segment follows a position from the history buffer
- Segments are spaced by a configurable number of frames
- New segments are added when gold coins are collected

### Visual Implementation

- Each segment is a separate mesh
- Segments follow with a slight delay for a natural snake-like movement
- Optional: Add scaling, rotation, and wiggle effects for visual appeal

## Implementation Details

### Data Structures

```js
// Position history array
let positionHistory = [];
const maxHistoryLength = 1000;

// Tail segments array
let tailSegments = [];
const tailSegmentSpacing = 10; // frames between segments
```

### Key Functions

#### Position History

```js
function updatePositionHistory() {
  positionHistory.unshift(playerMesh.position.clone());
  if (positionHistory.length > maxHistoryLength) {
    positionHistory.pop();
  }
}
```

#### Adding Tail Segments

```js
function addTailSegment() {
  const segmentGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  const segmentMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
  const segmentMesh = new THREE.Mesh(segmentGeometry, segmentMaterial);

  segmentMesh.position.copy(playerMesh.position);
  scene.add(segmentMesh);
  tailSegments.push(segmentMesh);
}
```

#### Updating Tail Positions

```js
function updateTailPositions() {
  for (let i = 0; i < tailSegments.length; i++) {
    const historyIndex = (i + 1) * tailSegmentSpacing;
    if (positionHistory[historyIndex]) {
      tailSegments[i].position.lerp(positionHistory[historyIndex], 0.4);
    }
  }
}
```

#### Integration with Coin Collection

```js
function onCoinCollected(coin) {
  scene.remove(coin);
  addTailSegment();
}
```

## Enhancements

### Segment Orientation

```js
if (positionHistory[historyIndex + 1]) {
  tailSegments[i].lookAt(positionHistory[historyIndex + 1]);
}
```

### Animated Wiggle

```js
tailSegments[i].position.x += Math.sin(performance.now() * 0.001 + i) * 0.05;
```

### Tail Tapering

```js
segmentMesh.scale.setScalar(1 - i * 0.03);
```

## Integration with Current Codebase

The implementation will integrate with our existing Three.js and Rapier physics setup. The tail segments will be visual-only with no physics colliders to maximize performance.