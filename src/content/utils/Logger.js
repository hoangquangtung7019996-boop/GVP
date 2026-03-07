/**
 * Logger.js
 * Centralized logging utility for Grok Video Prompter
 * v1.21.45: Enhanced with feature prefixes and debug toggle
 * 
 * Usage:
 *   Logger.debug('NetworkInterceptor', 'Processing payload', data);
 *   Logger.info('StateManager', 'Settings loaded');
 *   Logger.warn('Upload', 'Queue paused');
 *   Logger.error('IndexedDB', 'Failed to save', err);
 */

window.GVPLogger = class GVPLogger {
    static LEVELS = {
        DEBUG: 0,    // Verbose - all details
        INFO: 1,     // Normal - key events only
        WARN: 2,     // Warnings only
        ERROR: 3,    // Errors only
        NONE: 4      // Silent
    };

    static _level = this.LEVELS.INFO; // Default: INFO (Production Ready)
    static _prefix = '[GVP]';
    static _initialized = false;
    static _mutedModules = new Set(); // Modules to silence regardless of level

    /**
     * Initialize logger from stored settings
     */
    static async initialize() {
        if (this._initialized) return;

        try {
            const result = await chrome.storage.local.get('gvpDebugMode');
            if (result.gvpDebugMode === true) {
                this._level = this.LEVELS.DEBUG;
                console.log(`${this._prefix} 🐞 Debug logging enabled (from settings)`);
            } else {
                this._level = this.LEVELS.INFO; // Explicitly enforce INFO if not enabled
            }
            this._initialized = true;
        } catch (e) {
            // Fallback to INFO if storage fails
            this._level = this.LEVELS.INFO;
            this._initialized = true;
        }
    }

    /**
     * Set the current log level
     * @param {number|string} level - Level constant or name
     */
    static setLevel(level) {
        if (typeof level === 'string') {
            const normalized = level.toUpperCase();
            if (this.LEVELS[normalized] !== undefined) {
                this._level = this.LEVELS[normalized];
            }
        } else if (typeof level === 'number') {
            this._level = level;
        }
    }

    /**
     * Enable or disable debug mode and persist to storage
     * @param {boolean} enabled 
     */
    static async setDebugMode(enabled) {
        this._level = enabled ? this.LEVELS.DEBUG : this.LEVELS.INFO;

        try {
            await chrome.storage.local.set({ gvpDebugMode: enabled });
        } catch (e) {
            // Ignore storage errors
        }

        if (enabled) {
            console.log(`${this._prefix} 🐞 Debug logging ENABLED - verbose output active`);
        } else {
            console.log(`${this._prefix} 🔇 Debug logging DISABLED - minimal output`);
        }
    }

    /**
     * Check if debug mode is enabled
     * @returns {boolean}
     */
    static isDebugEnabled() {
        return this._level <= this.LEVELS.DEBUG;
    }

    /**
     * Mute a specific module/feature
     * @param {string} feature 
     */
    static mute(feature) {
        this._mutedModules.add(feature);
    }

    /**
     * Unmute a specific module/feature
     * @param {string} feature 
     */
    static unmute(feature) {
        this._mutedModules.delete(feature);
    }

    /**
     * Check if module is muted
     */
    static isMuted(feature) {
        return this._mutedModules.has(feature);
    }

    /**
     * Format message with feature prefix
     * @param {string} feature - Feature name (e.g., 'NetworkInterceptor')
     * @param {string} message - Log message
     * @returns {string}
     */
    static _format(feature, message) {
        return `${this._prefix} [${feature}] ${message}`;
    }

    /**
     * Debug log - only when debug mode enabled
     * @param {string} feature - Feature/component name
     * @param {string} message - Log message
     * @param {...any} args - Additional data
     */
    static debug(feature, message, ...args) {
        if (this.isMuted(feature)) return;
        if (this._level <= this.LEVELS.DEBUG) {
            if (args.length > 0) {
                console.log(this._format(feature, `🐛 ${message}`), ...args);
            } else {
                console.log(this._format(feature, `🐛 ${message}`));
            }
        }
    }

    /**
     * Info log - shown in normal mode
     * @param {string} feature - Feature/component name  
     * @param {string} message - Log message
     * @param {...any} args - Additional data
     */
    static info(feature, message, ...args) {
        if (this.isMuted(feature)) return;
        if (this._level <= this.LEVELS.INFO) {
            if (args.length > 0) {
                console.info(this._format(feature, message), ...args);
            } else {
                console.info(this._format(feature, message));
            }
        }
    }

    /**
     * Warning log - always shown unless NONE
     * @param {string} feature - Feature/component name
     * @param {string} message - Log message
     * @param {...any} args - Additional data
     */
    static warn(feature, message, ...args) {
        // Warnings usually shouldn't be muted, but we respect the mute flag if explicit
        if (this.isMuted(feature)) return;
        if (this._level <= this.LEVELS.WARN) {
            if (args.length > 0) {
                console.warn(this._format(feature, `⚠️ ${message}`), ...args);
            } else {
                console.warn(this._format(feature, `⚠️ ${message}`));
            }
        }
    }

    /**
     * Error log - always shown unless NONE
     * @param {string} feature - Feature/component name
     * @param {string} message - Log message
     * @param {...any} args - Additional data
     */
    static error(feature, message, ...args) {
        // Errors usually shouldn't be muted, but we respect the mute flag if explicit
        if (this.isMuted(feature)) return;
        if (this._level <= this.LEVELS.ERROR) {
            if (args.length > 0) {
                console.error(this._format(feature, `❌ ${message}`), ...args);
            } else {
                console.error(this._format(feature, `❌ ${message}`));
            }
        }
    }

    /**
     * Performance metric log - only in debug mode
     * @param {string} feature - Feature/component name
     * @param {string} label - Operation name
     * @param {number} durationMs - Duration in milliseconds
     */
    static perf(feature, label, durationMs) {
        if (this._level <= this.LEVELS.DEBUG) {
            console.log(this._format(feature, `⚡ ${label}: ${durationMs.toFixed(2)}ms`));
        }
    }
};

// Alias for backward compatibility
window.Logger = window.GVPLogger;

// Initialize from stored settings
window.GVPLogger.initialize();

// Silence noisy modules by default
window.GVPLogger.mute('QuickLaunch.TargetScan');

