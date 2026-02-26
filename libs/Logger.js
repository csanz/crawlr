/**
 * @module Logger
 * Structured logging utility with module namespacing and configurable levels.
 *
 * Usage:
 *   import { createLogger } from './Logger.js';
 *   const log = createLogger('MyModule');
 *   log.info('Initialized');
 *   log.warn('Something unexpected', { detail: 123 });
 *   log.error('Failed to load', error);
 *   log.debug('Verbose info');  // Only shown when level is DEBUG
 */

/** @enum {number} Log level thresholds */
const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    SILENT: 4
};

/** Current minimum log level (messages below this are suppressed) */
let currentLevel = LOG_LEVELS.INFO;

/**
 * Sets the global minimum log level.
 * @param {'DEBUG'|'INFO'|'WARN'|'ERROR'|'SILENT'} level - The minimum level to display
 */
export function setLogLevel(level) {
    currentLevel = LOG_LEVELS[level] ?? LOG_LEVELS.INFO;
}

/**
 * Gets the current log level name.
 * @returns {string} The current level name
 */
export function getLogLevel() {
    return Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === currentLevel) || 'INFO';
}

/**
 * Creates a namespaced logger for a specific module.
 * All messages are prefixed with [ModuleName] for easy filtering in DevTools.
 *
 * @param {string} moduleName - The module name used as a log prefix
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 */
export function createLogger(moduleName) {
    const prefix = `[${moduleName}]`;
    return {
        /** @param {...*} args */
        debug: (...args) => { if (currentLevel <= LOG_LEVELS.DEBUG) console.debug(prefix, ...args); },
        /** @param {...*} args */
        info: (...args) => { if (currentLevel <= LOG_LEVELS.INFO) console.info(prefix, ...args); },
        /** @param {...*} args */
        warn: (...args) => { if (currentLevel <= LOG_LEVELS.WARN) console.warn(prefix, ...args); },
        /** @param {...*} args */
        error: (...args) => { if (currentLevel <= LOG_LEVELS.ERROR) console.error(prefix, ...args); },
    };
}

// Expose log level control on window for runtime debugging in DevTools
// Usage: window.setLogLevel('DEBUG') to see all messages
if (typeof window !== 'undefined') {
    window.setLogLevel = setLogLevel;
    window.getLogLevel = getLogLevel;
}
