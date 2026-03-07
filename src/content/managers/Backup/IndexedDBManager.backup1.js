/**
 * IndexedDBManager.js
 * Handles unlimited storage using IndexedDB for large datasets
 * Replaces chrome.storage.local for multi-gen history and progress tracking
 */

window.IndexedDBManager = class IndexedDBManager {
    constructor() {
        this.dbName = 'GrokVideoPrompter';
        this.dbVersion = 1;
        this.db = null;
        this.initialized = false;
        this.migrationComplete = false;

        // Object store names
        this.STORES = {
            MULTI_GEN_HISTORY: 'multiGenHistory',
            PROGRESS_TRACKING: 'progressTracking',
            SETTINGS_BACKUP: 'settingsBackup'
        };
    }

    /**
     * Initialize IndexedDB and create object stores
     */
    async initialize() {
        if (this.initialized) {
            return true;
        }

        try {
            console.log('[GVP IndexedDB] Initializing database...');

            this.db = await this._openDatabase();
            this.initialized = true;

            console.log('[GVP IndexedDB] ✅ Database initialized successfully');

            // Check if migration needed
            await this._checkMigrationStatus();

            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Initialization failed:', error);
            this.initialized = false;
            return false;
        }
    }

    /**
     * Open or create the IndexedDB database
     */
    _openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                reject(new Error(`IndexedDB open failed: ${request.error}`));
            };

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onupgradeneeded = (event) => {
                console.log('[GVP IndexedDB] Upgrading database schema...');
                const db = event.target.result;

                // Create object stores if they don't exist
                if (!db.objectStoreNames.contains(this.STORES.MULTI_GEN_HISTORY)) {
                    const historyStore = db.createObjectStore(this.STORES.MULTI_GEN_HISTORY, { keyPath: 'imageId' });
                    historyStore.createIndex('accountId', 'accountId', { unique: false });
                    historyStore.createIndex('timestamp', 'timestamp', { unique: false });
                    console.log('[GVP IndexedDB] Created multiGenHistory store');
                }

                if (!db.objectStoreNames.contains(this.STORES.PROGRESS_TRACKING)) {
                    db.createObjectStore(this.STORES.PROGRESS_TRACKING, { keyPath: 'generationId' });
                    console.log('[GVP IndexedDB] Created progressTracking store');
                }

                if (!db.objectStoreNames.contains(this.STORES.SETTINGS_BACKUP)) {
                    db.createObjectStore(this.STORES.SETTINGS_BACKUP, { keyPath: 'key' });
                    console.log('[GVP IndexedDB] Created settingsBackup store');
                }
            };
        });
    }

    /**
     * Check if migration from chrome.storage has been completed
     */
    async _checkMigrationStatus() {
        try {
            if (!chrome?.storage?.local) {
                this.migrationComplete = true;
                return;
            }

            const result = await chrome.storage.local.get('gvp-indexeddb-migrated');
            this.migrationComplete = result['gvp-indexeddb-migrated'] === true;

            if (!this.migrationComplete) {
                console.log('[GVP IndexedDB] Migration not complete, will run migration...');
            }
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to check migration status:', error);
        }
    }

    /**
     * Save multi-gen history snapshot
     */
    async saveMultiGenHistory(snapshot) {
        if (!this.initialized || !snapshot) {
            return false;
        }

        try {
            const transaction = this.db.transaction([this.STORES.MULTI_GEN_HISTORY], 'readwrite');
            const store = transaction.objectStore(this.STORES.MULTI_GEN_HISTORY);

            // Clear existing data
            await this._clearStore(store);

            // Convert Map or Object to array and save each entry
            let entries = [];
            if (snapshot.images instanceof Map) {
                entries = Array.from(snapshot.images.entries());
            } else if (typeof snapshot.images === 'object' && snapshot.images !== null) {
                entries = Object.entries(snapshot.images);
            }

            for (const [imageId, entry] of entries) {
                const data = {
                    imageId,
                    accountId: entry.accountId || null,
                    timestamp: entry.timestamp || Date.now(),
                    ...entry
                };
                await this._putData(store, data);
            }

            console.log('[GVP IndexedDB] ✅ Saved multi-gen history:', entries.length, 'entries');
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to save multi-gen history:', error);
            return false;
        }
    }

    /**
     * Get multi-gen history snapshot
     */
    async getMultiGenHistory() {
        if (!this.initialized) {
            return null;
        }

        try {
            const transaction = this.db.transaction([this.STORES.MULTI_GEN_HISTORY], 'readonly');
            const store = transaction.objectStore(this.STORES.MULTI_GEN_HISTORY);
            const entries = await this._getAllData(store);

            // Reconstruct Map
            const images = new Map();
            entries.forEach(entry => {
                const { imageId, ...data } = entry;
                images.set(imageId, data);
            });

            console.log('[GVP IndexedDB] Retrieved multi-gen history:', images.size, 'entries');

            return {
                images,
                lastModified: Date.now()
            };
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to get multi-gen history:', error);
            return null;
        }
    }

    /**
     * Clear multi-gen history
     */
    async clearMultiGenHistory() {
        if (!this.initialized) {
            return false;
        }

        try {
            const transaction = this.db.transaction([this.STORES.MULTI_GEN_HISTORY], 'readwrite');
            const store = transaction.objectStore(this.STORES.MULTI_GEN_HISTORY);
            await this._clearStore(store);

            console.log('[GVP IndexedDB] ✅ Cleared multi-gen history');
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to clear multi-gen history:', error);
            return false;
        }
    }

    /**
     * Save progress tracking data
     */
    async saveProgress(generationId, data) {
        if (!this.initialized || !generationId) {
            return false;
        }

        try {
            const transaction = this.db.transaction([this.STORES.PROGRESS_TRACKING], 'readwrite');
            const store = transaction.objectStore(this.STORES.PROGRESS_TRACKING);

            const progressData = {
                generationId,
                timestamp: Date.now(),
                ...data
            };

            await this._putData(store, progressData);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to save progress:', error);
            return false;
        }
    }

    /**
     * Get progress tracking data
     */
    async getProgress(generationId) {
        if (!this.initialized || !generationId) {
            return null;
        }

        try {
            const transaction = this.db.transaction([this.STORES.PROGRESS_TRACKING], 'readonly');
            const store = transaction.objectStore(this.STORES.PROGRESS_TRACKING);
            return await this._getData(store, generationId);
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to get progress:', error);
            return null;
        }
    }

    /**
     * Delete progress tracking data
     */
    async deleteProgress(generationId) {
        if (!this.initialized || !generationId) {
            return false;
        }

        try {
            const transaction = this.db.transaction([this.STORES.PROGRESS_TRACKING], 'readwrite');
            const store = transaction.objectStore(this.STORES.PROGRESS_TRACKING);
            await this._deleteData(store, generationId);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to delete progress:', error);
            return false;
        }
    }

    /**
     * Get all progress entries
     */
    async getAllProgress() {
        if (!this.initialized) {
            return [];
        }

        try {
            const transaction = this.db.transaction([this.STORES.PROGRESS_TRACKING], 'readonly');
            const store = transaction.objectStore(this.STORES.PROGRESS_TRACKING);
            return await this._getAllData(store);
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to get all progress:', error);
            return [];
        }
    }

    /**
     * Clean up old progress entries (older than specified time)
     */
    async cleanupOldProgress(maxAgeMs = 3600000) { // Default 1 hour
        if (!this.initialized) {
            return 0;
        }

        try {
            const transaction = this.db.transaction([this.STORES.PROGRESS_TRACKING], 'readwrite');
            const store = transaction.objectStore(this.STORES.PROGRESS_TRACKING);
            const allProgress = await this._getAllData(store);

            const cutoff = Date.now() - maxAgeMs;
            let deleted = 0;

            for (const entry of allProgress) {
                if (entry.timestamp < cutoff) {
                    await this._deleteData(store, entry.generationId);
                    deleted++;
                }
            }

            console.log('[GVP IndexedDB] Cleaned up', deleted, 'old progress entries');
            return deleted;
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to cleanup old progress:', error);
            return 0;
        }
    }

    /**
     * Migrate data from chrome.storage.local to IndexedDB
     */
    async migrateFromChromeStorage() {
        if (this.migrationComplete || !chrome?.storage?.local) {
            console.log('[GVP IndexedDB] Migration already complete or chrome.storage unavailable');
            return true;
        }

        try {
            console.log('[GVP IndexedDB] 🔄 Starting migration from chrome.storage...');

            // Get all chrome.storage data
            const allData = await chrome.storage.local.get(null);
            let migratedCount = 0;

            // Migrate multi-gen history
            if (allData['gvp_multigen_history']) {
                const historySnapshot = allData['gvp_multigen_history'];
                const saved = await this.saveMultiGenHistory(historySnapshot);
                if (saved) {
                    migratedCount++;
                    // CRITICAL: Delete immediately to free space for migration flag
                    await chrome.storage.local.remove('gvp_multigen_history');
                    console.log('[GVP IndexedDB] ✅ Migrated & cleared multi-gen history');
                }
            }

            // Migrate progress tracking entries
            const progressKeys = Object.keys(allData).filter(key => key.startsWith('gvp-progress-'));
            for (const key of progressKeys) {
                const generationId = key.replace('gvp-progress-', '');
                const saved = await this.saveProgress(generationId, allData[key]);
                if (saved) {
                    migratedCount++;
                    // Delete immediately
                    await chrome.storage.local.remove(key);
                }
            }
            if (progressKeys.length > 0) {
                console.log('[GVP IndexedDB] ✅ Migrated', progressKeys.length, 'progress entries');
            }

            // Mark migration complete
            await chrome.storage.local.set({ 'gvp-indexeddb-migrated': true });
            this.migrationComplete = true;

            console.log('[GVP IndexedDB] ✅ Migration complete:', migratedCount, 'items migrated');

            // Optional: Clean up old data to free chrome.storage space
            await this._cleanupOldChromeStorageData(allData);

            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Migration failed:', error);
            return false;
        }
    }

    /**
     * Clean up migrated data from chrome.storage to free space
     */
    async _cleanupOldChromeStorageData(allData) {
        try {
            const keysToRemove = [];

            // Remove multi-gen history
            if (allData['gvp_multigen_history']) {
                keysToRemove.push('gvp_multigen_history');
            }

            // Remove old progress entries
            keysToRemove.push(...Object.keys(allData).filter(key => key.startsWith('gvp-progress-')));

            if (keysToRemove.length > 0) {
                await chrome.storage.local.remove(keysToRemove);
                console.log('[GVP IndexedDB] 🧹 Cleaned up', keysToRemove.length, 'old chrome.storage keys');
            }
        } catch (error) {
            console.warn('[GVP IndexedDB] Failed to cleanup old chrome.storage data:', error);
        }
    }

    // ========================================
    // Low-level IndexedDB helpers
    // ========================================

    _putData(store, data) {
        return new Promise((resolve, reject) => {
            const request = store.put(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    _getData(store, key) {
        return new Promise((resolve, reject) => {
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    _deleteData(store, key) {
        return new Promise((resolve, reject) => {
            const request = store.delete(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    _getAllData(store) {
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    _clearStore(store) {
        return new Promise((resolve, reject) => {
            const request = store.clear();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
};
