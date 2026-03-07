window.GrokSettingsManager = class GrokSettingsManager {
    constructor() {
        this.API_ENDPOINT = '/rest/user-settings';
        this._settings = null;
        this._lastFetch = 0;
        this._CACHE_TTL = 10000; // 10 seconds
        this._fetchPromise = null;
    }

    /**
     * Fetch current settings from Grok
     * Uses GET request to /rest/user-settings
     */
    async getSettings(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && this._settings && (now - this._lastFetch < this._CACHE_TTL)) {
            return this._settings;
        }

        if (this._fetchPromise) {
            return this._fetchPromise;
        }

        this._fetchPromise = (async () => {
            try {
                console.log('[GVP Settings] Fetching user settings...');
                const response = await fetch(this.API_ENDPOINT, {
                    method: 'GET', // Assuming GET works to retrieve current state
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                this._settings = data;
                this._lastFetch = Date.now();
                console.log('[GVP Settings] Settings fetched:', this._settings);
                return this._settings;
            } catch (error) {
                console.error('[GVP Settings] Failed to fetch settings:', error);
                throw error;
            } finally {
                this._fetchPromise = null;
            }
        })();

        return this._fetchPromise;
    }

    /**
     * Update a specific preference setting
     * Performs a read-modify-write operation to preserve other settings
     * @param {string} key - The key in the 'preferences' object
     * @param {any} value - The new value
     */
    async updatePreference(key, value) {
        try {
            // 1. Get current settings to ensure we have the full object
            const currentSettings = await this.getSettings(true); // Force refresh to be safe

            if (!currentSettings || !currentSettings.preferences) {
                throw new Error('Invalid settings structure received');
            }

            // 2. Prepare updated payload
            // We must send the ENTIRE object back, not just the patch
            const newSettings = JSON.parse(JSON.stringify(currentSettings)); // Deep clone
            newSettings.preferences[key] = value;

            console.log(`[GVP Settings] Updating preference '${key}' to:`, value);

            // 3. Send update
            const response = await fetch(this.API_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(newSettings)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const updatedData = await response.json();

            // 4. Update cache
            this._settings = updatedData;
            this._lastFetch = Date.now();

            console.log('[GVP Settings] Update successful');
            return true;

        } catch (error) {
            console.error('[GVP Settings] Failed to update preference:', error);
            throw error;
        }
    }

    /**
     * Helper to get the specific auto-generation setting
     */
    async getDisableVideoGenerationOnUpload() {
        const settings = await this.getSettings();
        return settings?.preferences?.disableVideoGenerationOnUpload ?? true; // Default to true (disabled) if missing
    }

    /**
     * Helper to set the specific auto-generation setting
     */
    async setDisableVideoGenerationOnUpload(disabled) {
        return this.updatePreference('disableVideoGenerationOnUpload', disabled);
    }
};
