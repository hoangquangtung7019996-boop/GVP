// LookupLoader.js - Utility for lazy-loading massive lookup tables
// Dependencies: Logger

window.LookupLoader = class LookupLoader {
    static _cache = new Map();
    static _loading = new Map();

    /**
     * Loads a lookup table by name (e.g., 'parts')
     * @param {string} type 
     * @returns {Promise<Object>}
     */
    static async loadLookup(type) {
        if (this._cache.has(type)) {
            return this._cache.get(type);
        }

        if (this._loading.has(type)) {
            return this._loading.get(type);
        }

        const promise = this._fetchLookup(type);
        this._loading.set(type, promise);

        try {
            const data = await promise;
            this._cache.set(type, data);
            return data;
        } finally {
            this._loading.delete(type);
        }
    }

    /**
     * Loads a specific field from a lookup table
     * @param {string} type - e.g. 'parts'
     * @param {string} fieldKey - e.g. 'audio.ambient'
     * @returns {Promise<any>}
     */
    static async getField(type, fieldKey) {
        const lookup = await this.loadLookup(type);
        return lookup ? lookup[fieldKey] : null;
    }

    static async _fetchLookup(type) {
        const filename = `gvp_${type}_lookups.json`;
        const url = chrome.runtime.getURL(`public/data/${filename}`);
        
        window.Logger?.debug('LookupLoader', `Fetching lookup: ${type} from ${url}`);
        
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            window.Logger?.error('LookupLoader', `Failed to load lookup ${type}:`, error);
            return null;
        }
    }
};
