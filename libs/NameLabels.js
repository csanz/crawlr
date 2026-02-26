/**
 * @module NameLabels
 * Floating name tags above each player/bot head using canvas-based sprites.
 */
import * as THREE from 'three';

const BOT_NAMES = [
    'Slippy', 'Zigzag', 'Chomper', 'Wiggles', 'Blitz',
    'Fang', 'Noodle', 'Pixel', 'Dash', 'Turbo',
    'Viper', 'Coil', 'Zippy', 'Munch', 'Rascal',
    'Bubbles', 'Sparky', 'Sneaky', 'Glider', 'Nibbles'
];

let usedNames = [];

function pickName() {
    if (usedNames.length >= BOT_NAMES.length) usedNames = [];
    const available = BOT_NAMES.filter(n => !usedNames.includes(n));
    const name = available[Math.floor(Math.random() * available.length)];
    usedNames.push(name);
    return name;
}

function createLabelSprite(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 128;
    canvas.height = 32;

    // Measure text to fit pill tightly
    ctx.font = '14px sans-serif';
    const metrics = ctx.measureText(text);
    const textW = metrics.width;
    const pillW = textW + 12;
    const pillH = 18;
    const x = (canvas.width - pillW) / 2;
    const y = (canvas.height - pillH) / 2;

    // Tight semi-transparent black pill
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.roundRect(x, y, pillW, pillH, 9);
    ctx.fill();

    // White text
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;

    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        sizeAttenuation: true
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.8, 0.45, 1);
    return sprite;
}

/**
 * Adds a floating name label above a mesh.
 * @param {THREE.Mesh} mesh
 * @param {string} name
 */
export function addNameLabel(mesh, name) {
    const sprite = createLabelSprite(name);
    sprite.position.set(0, 1.1, 0); // just above the head
    mesh.add(sprite);
    mesh.userData.nameLabel = sprite;
    mesh.userData.displayName = name;
}

/**
 * Generates a random bot name.
 * @returns {string}
 */
export function generateBotName() {
    return pickName();
}
