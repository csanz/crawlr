/**
 * @module Sound
 * Audio system for loading and playing game sound effects.
 * Initializes on first user interaction to comply with browser autoplay policies.
 */
import { createLogger } from './Logger.js';

const log = createLogger('Sound');

/** @type {AudioContext|null} */
let audioContext = null;

/** @type {Object<string, AudioBuffer>} Loaded sound buffers keyed by name */
const sounds = {};

/** Whether sound is muted */
let muted = false;

/** Ambiance loop state */
let ambianceSource = null;
let ambianceGain = null;
const AMBIANCE_VOLUME = 0.15;

/**
 * Initializes the Web Audio context and begins loading sounds.
 * Must be called from a user interaction event (click/keydown) to comply
 * with browser autoplay policies.
 * @returns {AudioContext} The audio context instance
 */
export function initSoundSystem() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        log.info('Audio context initialized');
        loadSounds();
    }
    return audioContext;
}

/**
 * Effect sound registry — maps effect names to sound config.
 * Add new effects here: { sound, volume, [pitchRange] }
 */
const effectRegistry = {};

/**
 * Registers a sound effect. Call after initSoundSystem().
 * @param {string} effectName - Effect identifier (e.g. 'lightning:strike')
 * @param {{ sound: string, volume?: number, pitchMin?: number, pitchMax?: number }} config
 */
export function registerEffect(effectName, config) {
    effectRegistry[effectName] = {
        sound: config.sound,
        volume: config.volume ?? 1.0,
        pitchMin: config.pitchMin ?? 1.0,
        pitchMax: config.pitchMax ?? 1.0
    };
}

/**
 * Plays a registered effect by name.
 * @param {string} effectName
 * @param {number} [volumeOverride] - Optional volume override
 * @returns {Object|undefined} Sound handle with stop() and setVolume()
 */
export function playEffect(effectName, volumeOverride) {
    const config = effectRegistry[effectName];
    if (!config) return;
    const vol = volumeOverride ?? config.volume;

    // Random pitch variation if configured
    if (config.pitchMin !== 1.0 || config.pitchMax !== 1.0) {
        return playSoundWithPitch(config.sound, vol, config.pitchMin, config.pitchMax);
    }
    return playSound(config.sound, vol);
}

/**
 * Loads all game sound assets.
 * @private
 */
function loadSounds() {
    // Gameplay sounds
    loadSound('coinCollect', '/coin-collect.mp3');
    loadSound('fruitCollect', '/coin-collect-large.mp3');
    loadSound('ringJump', '/ring-jump.mp3');
    loadSound('ringHit', '/ring-hit.mp3');

    // Theme sounds
    loadSound('storm', '/themes/theme_storm_ambient.mp3');

    // Effect sounds
    loadSound('lightningStrike', '/effects/lightning-strike.mp3');
    loadSound('electrocutedLightning', '/effects/electrocuted-lightning.mp3');
    loadSound('electrocutedRing', '/effects/electrocuted-ring.mp3');
    loadSound('dashSwish', '/effects/dash-swish.mp3');
    loadSound('squeel', '/effects/squeel.mp3');
    loadSound('waterDrink', '/effects/water-drink.mp3');
    loadSound('gulp', '/effects/gulp.mp3');
    loadSound('gameover', '/effects/gameover.mp3');
    loadSound('postStormBirds', '/effects/post-storm-birds.mp3');

    // Ambiance music — looping background track
    loadSound('ambiance', '/ambiance-default.mp3');

    // Register effects
    registerEffect('fruit:collect', { sound: 'gulp', volume: 0.25, pitchMin: 0.95, pitchMax: 1.05 });
    registerEffect('waterdrop:collect', { sound: 'waterDrink', volume: 0.25, pitchMin: 0.95, pitchMax: 1.05 });
    registerEffect('dash', { sound: 'dashSwish', volume: 0.3, pitchMin: 0.9, pitchMax: 1.1 });
    registerEffect('lightning:strike', { sound: 'lightningStrike', volume: 0.3, pitchMin: 0.85, pitchMax: 1.15 });
    registerEffect('lightning:hit', { sound: 'electrocutedLightning', volume: 0.5, pitchMin: 0.9, pitchMax: 1.1 });
    registerEffect('ring:hit', { sound: 'electrocutedRing', volume: 0.5, pitchMin: 0.9, pitchMax: 1.1 });
}

/**
 * Fetches and decodes a single audio file into the sound library.
 * @param {string} name - Key to store the sound under
 * @param {string} url - Path to the audio file
 */
export function loadSound(name, url) {
    fetch(url)
        .then(response => response.arrayBuffer())
        .then(arrayBuffer => audioContext.decodeAudioData(arrayBuffer))
        .then(audioBuffer => {
            sounds[name] = audioBuffer;
            log.debug(`Loaded sound: ${name}`);
            // Auto-start ambiance loop once its buffer is decoded
            if (name === 'ambiance') startAmbiance();
        })
        .catch(error => log.error(`Failed to load sound "${name}"`, error));
}

/**
 * Toggles mute on/off.
 * @returns {boolean} New muted state
 */
export function toggleMute() {
    muted = !muted;
    if (ambianceGain) {
        ambianceGain.gain.value = muted ? 0 : AMBIANCE_VOLUME;
    }
    return muted;
}

/**
 * @returns {boolean} Whether sound is currently muted
 */
export function isMuted() {
    return muted;
}

/**
 * Plays a loaded sound by name.
 * @param {string} name - Sound key from loadSound()
 * @param {number} [volume=1.0] - Playback volume (0.0–1.0)
 * @returns {Object|undefined} Handle with stop() and setVolume()
 */
export function playSound(name, volume = 1.0) {
    if (muted) return;
    if (!audioContext) {
        log.warn('Audio context not initialized — call initSoundSystem first');
        return;
    }

    const sound = sounds[name];
    if (!sound) {
        log.warn(`Sound "${name}" not loaded yet`);
        return;
    }

    const source = audioContext.createBufferSource();
    source.buffer = sound;

    // Volume control via gain node
    const gainNode = audioContext.createGain();
    gainNode.gain.value = volume;

    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    source.start(0);

    // Return a handle with stop + volume control
    return {
        stop() { try { source.stop(); } catch (_) {} },
        setVolume(v) { gainNode.gain.value = v; }
    };
}

/**
 * Plays a sound with random pitch variation.
 * @param {string} name - Sound name
 * @param {number} volume - Playback volume
 * @param {number} pitchMin - Minimum playback rate
 * @param {number} pitchMax - Maximum playback rate
 * @returns {Object|undefined} Sound handle
 */
export function playSoundWithPitch(name, volume = 1.0, pitchMin = 1.0, pitchMax = 1.0) {
    if (muted) return;
    if (!audioContext) return;

    const sound = sounds[name];
    if (!sound) return;

    const source = audioContext.createBufferSource();
    source.buffer = sound;
    source.playbackRate.value = pitchMin + Math.random() * (pitchMax - pitchMin);

    const gainNode = audioContext.createGain();
    gainNode.gain.value = volume;

    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    source.start(0);

    return {
        stop() { try { source.stop(); } catch (_) {} },
        setVolume(v) { gainNode.gain.value = v; }
    };
}

/**
 * Plays a random snippet from a sound buffer with a volume fade-out.
 * Picks a random start offset and plays for `duration` seconds,
 * fading volume to 0 over the last `fadeOut` seconds.
 * @param {string} name - Sound name
 * @param {{ volume?: number, duration?: number, fadeOut?: number }} opts
 * @returns {Object|undefined} Sound handle with stop()
 */
export function playSnippet(name, { volume = 0.3, duration = 5, fadeOut = 2 } = {}) {
    if (muted || !audioContext) return;

    const buffer = sounds[name];
    if (!buffer) {
        log.warn(`Sound "${name}" not loaded yet (snippet)`);
        return;
    }

    // Pick a random start point, leaving room for the snippet duration
    const maxOffset = Math.max(0, buffer.duration - duration);
    const offset = Math.random() * maxOffset;

    const source = audioContext.createBufferSource();
    source.buffer = buffer;

    const gainNode = audioContext.createGain();
    gainNode.gain.value = volume;

    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    source.start(0, offset, duration);

    // Schedule the fade-out using Web Audio's linearRampToValueAtTime
    const now = audioContext.currentTime;
    const fadeStart = now + duration - fadeOut;
    gainNode.gain.setValueAtTime(volume, fadeStart);
    gainNode.gain.linearRampToValueAtTime(0, now + duration);

    return {
        stop() { try { source.stop(); } catch (_) {} },
        setVolume(v) { gainNode.gain.setValueAtTime(v, audioContext.currentTime); }
    };
}

/**
 * Starts the ambiance music loop. Called automatically once the ambiance sound loads.
 */
export function startAmbiance() {
    if (ambianceSource || !audioContext) return;
    const buffer = sounds['ambiance'];
    if (!buffer) return;

    ambianceSource = audioContext.createBufferSource();
    ambianceSource.buffer = buffer;
    ambianceSource.loop = true;

    ambianceGain = audioContext.createGain();
    ambianceGain.gain.value = muted ? 0 : AMBIANCE_VOLUME;

    ambianceSource.connect(ambianceGain);
    ambianceGain.connect(audioContext.destination);
    ambianceSource.start(0);
    log.info('Ambiance music started');
}

/**
 * Plays the coin collection sound.
 * @param {number} [volume=1.0] - Playback volume
 * @returns {Object|undefined} Sound handle
 */
export function playCoinCollect(volume = 1.0) {
    return playSound('coinCollect', volume);
}
