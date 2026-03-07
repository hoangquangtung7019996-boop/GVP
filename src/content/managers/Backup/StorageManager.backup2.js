/**
 * StorageManager.js
 * Handles persistent storage of generation data using Chrome Storage API
 * Enables data survival across page reloads and browser sessions
 */

class StorageManager {
    constructor() {
        this.STORAGE_KEYS = {
            ACTIVE_GENERATIONS: 'gvp_active_generations',
            COMPLETED_GENERATIONS: 'gvp_completed_generations',
            GENERATION_STATS: 'gvp_generation_stats',
            LAST_SYNC: 'gvp_last_sync',
            MULTI_GEN_HISTORY: 'gvp_multi_gen_history'
        };
        
        this.MAX_COMPLETED_HISTORY = 100; // Keep last 100 completed generations
        this.initialized = false;
    }

    /**
     * Initialize storage and restore any existing data
     * @returns {Promise<Object>} Restored data
     */
    async initialize() {
        try {
            const data = await this._getAllStorageData();
            this.initialized = true;
            console.log('[StorageManager] Initialized with data:', {
                activeCount: Object.keys(data.activeGenerations || {}).length,
                completedCount: Object.keys(data.completedGenerations || {}).length,
                historyImages: Object.keys(data.multiGenHistory?.images || {}).length
            });
            return data;
        } catch (error) {
            console.error('[StorageManager] Initialization failed:', error);
            return {
                activeGenerations: {},
                completedGenerations: {},
                stats: this._getDefaultStats(),
                multiGenHistory: null
            };
        }
    }

    /**
     * Save active generation to storage
     * @param {string} generationId - Unique generation identifier
     * @param {Object} generationData - Generation data object
     */
    async saveActiveGeneration(generationId, generationData) {
        try {
            const activeGens = await this._getStorageItem(this.STORAGE_KEYS.ACTIVE_GENERATIONS) || {};
            activeGens[generationId] = {
                ...generationData,
                lastUpdated: Date.now()
            };
            
            await this._setStorageItem(this.STORAGE_KEYS.ACTIVE_GENERATIONS, activeGens);
            await this._updateLastSync();
            
            console.log(`[StorageManager] Saved active generation: ${generationId}`);
        } catch (error) {
            console.error('[StorageManager] Failed to save active generation:', error);
        }
    }

    /**
     * Update existing active generation
     * @param {string} generationId - Generation identifier
     * @param {Object} updates - Partial data to update
     */
    async updateActiveGeneration(generationId, updates) {
        try {
            const activeGens = await this._getStorageItem(this.STORAGE_KEYS.ACTIVE_GENERATIONS) || {};
            
            if (activeGens[generationId]) {
                activeGens[generationId] = {
                    ...activeGens[generationId],
                    ...updates,
                    lastUpdated: Date.now()
                };
                
                await this._setStorageItem(this.STORAGE_KEYS.ACTIVE_GENERATIONS, activeGens);
                console.log(`[StorageManager] Updated generation: ${generationId}`);
            }
        } catch (error) {
            console.error('[StorageManager] Failed to update active generation:', error);
        }
    }

    /**
     * Move generation from active to completed
     * @param {string} generationId - Generation identifier
     * @param {Object} finalData - Final generation data
     */
    async completeGeneration(generationId, finalData) {
        try {
            // Get current data
            const activeGens = await this._getStorageItem(this.STORAGE_KEYS.ACTIVE_GENERATIONS) || {};
            let completedGens = await this._getStorageItem(this.STORAGE_KEYS.COMPLETED_GENERATIONS) || {};
            
            // Move to completed
            if (activeGens[generationId]) {
                completedGens[generationId] = {
                    ...activeGens[generationId],
                    ...finalData,
                    completedAt: Date.now(),
                    lastUpdated: Date.now()
                };
                
                delete activeGens[generationId];
                
                // Trim completed history if needed
                completedGens = this._trimCompletedHistory(completedGens);
                
                // Save both
                await Promise.all([
                    this._setStorageItem(this.STORAGE_KEYS.ACTIVE_GENERATIONS, activeGens),
                    this._setStorageItem(this.STORAGE_KEYS.COMPLETED_GENERATIONS, completedGens)
                ]);
                
                await this._updateStats();
                console.log(`[StorageManager] Completed generation: ${generationId}`);
            }
        } catch (error) {
            console.error('[StorageManager] Failed to complete generation:', error);
        }
    }

    /**
     * Remove active generation (for failures or cancellations)
     * @param {string} generationId - Generation identifier
     */
    async removeActiveGeneration(generationId) {
        try {
            const activeGens = await this._getStorageItem(this.STORAGE_KEYS.ACTIVE_GENERATIONS) || {};
            delete activeGens[generationId];
            
            await this._setStorageItem(this.STORAGE_KEYS.ACTIVE_GENERATIONS, activeGens);
            await this._updateStats();
            
            console.log(`[StorageManager] Removed active generation: ${generationId}`);
        } catch (error) {
            console.error('[StorageManager] Failed to remove active generation:', error);
        }
    }

    /**
     * Get all active generations
     * @returns {Promise<Object>} Map of active generations
     */
    async getActiveGenerations() {
        try {
            return await this._getStorageItem(this.STORAGE_KEYS.ACTIVE_GENERATIONS) || {};
        } catch (error) {
            console.error('[StorageManager] Failed to get active generations:', error);
            return {};
        }
    }

    /**
     * Get all completed generations
     * @returns {Promise<Object>} Map of completed generations
     */
    async getCompletedGenerations() {
        try {
            return await this._getStorageItem(this.STORAGE_KEYS.COMPLETED_GENERATIONS) || {};
        } catch (error) {
            console.error('[StorageManager] Failed to get completed generations:', error);
            return {};
        }
    }

    /**
     * Clear all completed generations
     */
    async clearCompletedGenerations() {
        try {
            await this._setStorageItem(this.STORAGE_KEYS.COMPLETED_GENERATIONS, {});
            await this._updateStats();
            console.log('[StorageManager] Cleared completed generations');
        } catch (error) {
            console.error('[StorageManager] Failed to clear completed generations:', error);
        }
    }

    /**
     * Get generation statistics
     * @returns {Promise<Object>} Statistics object
     */
    async getStats() {
        try {
            return await this._getStorageItem(this.STORAGE_KEYS.GENERATION_STATS) || this._getDefaultStats();
        } catch (error) {
            console.error('[StorageManager] Failed to get stats:', error);
            return this._getDefaultStats();
        }
    }

    /**
     * Persist multi-generation history snapshot
     * @param {Object|null} snapshot
     */
    async saveMultiGenHistory(snapshot) {
        try {
            await this._setStorageItem(this.STORAGE_KEYS.MULTI_GEN_HISTORY, snapshot || null);
        } catch (error) {
            console.error('[StorageManager] Failed to save multi-gen history:', error);
        }
    }

    /**
     * Retrieve stored multi-generation history snapshot
     * @returns {Promise<Object|null>}
     */
    async getMultiGenHistory() {
        try {
            return await this._getStorageItem(this.STORAGE_KEYS.MULTI_GEN_HISTORY) || null;
        } catch (error) {
            console.error('[StorageManager] Failed to load multi-gen history:', error);
            return null;
        }
    }

    /**
     * Clear stored multi-generation history snapshot
     */
    async clearMultiGenHistory() {
        try {
            await this._setStorageItem(this.STORAGE_KEYS.MULTI_GEN_HISTORY, null);
        } catch (error) {
            console.error('[StorageManager] Failed to clear multi-gen history:', error);
        }
    }

    /**
     * Get all storage data at once
     * @returns {Promise<Object>} All storage data
     */
    async _getAllStorageData() {
        try {
            const keys = Object.values(this.STORAGE_KEYS);
            const result = await chrome.storage.local.get(keys);
            
            return {
                activeGenerations: result[this.STORAGE_KEYS.ACTIVE_GENERATIONS] || {},
                completedGenerations: result[this.STORAGE_KEYS.COMPLETED_GENERATIONS] || {},
                stats: result[this.STORAGE_KEYS.GENERATION_STATS] || this._getDefaultStats(),
                lastSync: result[this.STORAGE_KEYS.LAST_SYNC] || Date.now(),
                multiGenHistory: result[this.STORAGE_KEYS.MULTI_GEN_HISTORY] || null
            };
        } catch (error) {
            console.error('[StorageManager] Failed to get all storage data:', error);
            throw error;
        }
    }

    /**
     * Get single storage item
     * @param {string} key - Storage key
     * @returns {Promise<any>} Stored value
     */
    async _getStorageItem(key) {
        if (!this._isContextValid()) {
            console.debug('[StorageManager] Skipping storage read (extension context invalidated)');
            return undefined;
        }

        const result = await chrome.storage.local.get(key);
        return result[key];
    }

    /**
     * Set single storage item
     * @param {string} key - Storage key
     * @param {any} value - Value to store
     */
    async _setStorageItem(key, value) {
        if (!this._isContextValid()) {
            console.debug('[StorageManager] Skipping storage write (extension context invalidated)');
            return;
        }

        await chrome.storage.local.set({ [key]: value });
    }

    /**
     * Update statistics based on current state
     */
    async _updateStats() {
        try {
            const [activeGens, completedGens] = await Promise.all([
                this.getActiveGenerations(),
                this.getCompletedGenerations()
            ]);
            
            const stats = {
                totalActive: Object.keys(activeGens).length,
                totalCompleted: Object.keys(completedGens).length,
                totalFailed: Object.values(completedGens).filter(g => g.status === 'failed').length,
                totalModerated: Object.values(completedGens).filter(g => g.moderated === true).length,
                lastUpdated: Date.now()
            };
            
            await this._setStorageItem(this.STORAGE_KEYS.GENERATION_STATS, stats);
        } catch (error) {
            console.error('[StorageManager] Failed to update stats:', error);
        }
    }

    /**
     * Update last sync timestamp
     */
    async _updateLastSync() {
        await this._setStorageItem(this.STORAGE_KEYS.LAST_SYNC, Date.now());
    }

    /**
     * Trim completed history to max limit
     * @param {Object} completedGens - Completed generations map
     * @returns {Object} Trimmed map
     */
    _trimCompletedHistory(completedGens) {
        const entries = Object.entries(completedGens);
        
        if (entries.length <= this.MAX_COMPLETED_HISTORY) {
            return completedGens;
        }
        
        // Sort by completedAt timestamp (newest first)
        entries.sort((a, b) => (b[1].completedAt || 0) - (a[1].completedAt || 0));
        
        // Keep only the most recent ones
        const trimmed = {};
        entries.slice(0, this.MAX_COMPLETED_HISTORY).forEach(([id, data]) => {
            trimmed[id] = data;
        });
        
        console.log(`[StorageManager] Trimmed completed history from ${entries.length} to ${this.MAX_COMPLETED_HISTORY}`);
        return trimmed;
    }

    /**
     * Get default statistics object
     * @returns {Object} Default stats
     */
    _getDefaultStats() {
        return {
            totalActive: 0,
            totalCompleted: 0,
            totalFailed: 0,
            totalModerated: 0,
            lastUpdated: Date.now()
        };
    }

    /**
     * Clear all storage (for debugging/reset)
     */
    async clearAll() {
        try {
            if (!this._isContextValid()) {
                console.debug('[StorageManager] Skipping storage clear (extension context invalidated)');
                return;
            }

            const keys = Object.values(this.STORAGE_KEYS);
            await chrome.storage.local.remove(keys);
            console.log('[StorageManager] Cleared all storage');
        } catch (error) {
            console.error('[StorageManager] Failed to clear storage:', error);
        }
    }

    _isContextValid() {
        try {
            return Boolean(chrome?.runtime?.id);
        } catch (_) {
            return false;
        }
    }
}

// Export for use in other modules
window.StorageManager = StorageManager;
