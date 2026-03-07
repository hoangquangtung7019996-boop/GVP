/**
 * IndexedDBManager.js
 * Handles unlimited storage using IndexedDB for large datasets
 * Replaces chrome.storage.local for multi-gen history and progress tracking
 */

window.IndexedDBManager = class IndexedDBManager {
    static instance = null;
    constructor() {
        IndexedDBManager.instance = this;
        this.dbName = 'GrokVideoPrompter';
        this.dbVersion = 19; // v19: Optimized Omnibox search via lowercase indexes
        this.db = null;
        this.initialized = false;
        this.migrationComplete = false;

        // Multi-tab synchronization
        this.syncChannel = new BroadcastChannel('gvp_db_sync');
        this._setupSyncListener();

        // Object store names
        this.STORES = {
            MULTI_GEN_HISTORY: 'multiGenHistory',
            PROGRESS_TRACKING: 'progressTracking',
            SETTINGS_BACKUP: 'settingsBackup',
            GALLERY_DATA: 'galleryData',
            IMAGE_PROJECTS: 'imageProjects',
            JSON_PRESETS: 'jsonPresets',
            RAW_TEMPLATES: 'rawTemplates',
            SAVED_PROMPT_SLOTS: 'savedPromptSlots',       // v4 (dormant from v13)
            CUSTOM_DROPDOWNS: 'customDropdownOptions',    // v4
            CUSTOM_OBJECTS: 'customObjects',              // v4
            CUSTOM_DIALOGUES: 'customDialogues',          // v4
            UNIFIED_VIDEO_HISTORY: 'unifiedVideoHistory', // v6
            // v13: Prompt Library
            PROMPTS: 'prompts',
            PROMPT_VERSIONS: 'promptVersions',
            FOLDERS: 'folders',
            PROMPT_TAGS: 'promptTags',
            USAGE_LOG: 'usageLog',
            RECENTS: 'recents',
            // v14: Phase 2 Tools
            CHUNKS: 'chunks',
            SWAP_RULES: 'swap_rules',
            // v17: Gallery parent-UUID resolution index
            PARENT_INDEX: 'parentIndex'
        };

        // Storage limits (from HANDOVER.md)
        this.LIMITS = {
            MAX_IMAGES: 36,                    // Total images tracked in multi-gen history
            MAX_ATTEMPTS_PER_IMAGE: 6,         // Max attempts per image
            MAX_PROGRESS_SAMPLES: 25,          // Max progress events per generation
            MAX_PAYLOAD_SIZE: 10000,           // Max chars for raw stream/payload data
            MAX_GALLERY_POSTS: 100000,         // Effectively unlimited (was 200)
            MAX_IMAGE_PROJECT_AGE_DAYS: 90,    // Days to keep image project history
            CLEANUP_BATCH_SIZE: 10             // Items to process per cleanup batch
        };
    }

    /**
     * Set up listener for multi-tab synchronization
     */
    _setupSyncListener() {
        this.syncChannel.onmessage = (event) => {
            const { type, storeName, data } = event.data;
            // Emit a global event that other managers (like UIGalleryManager) can listen to
            window.dispatchEvent(new CustomEvent('gvp:idb-sync', {
                detail: { type, storeName, data }
            }));
        };
    }

    /**
     * Broadcast a change to other tabs
     */
    _broadcastChange(type, storeName, data = null) {
        if (this.syncChannel) {
            this.syncChannel.postMessage({ type, storeName, data });
        }
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

            // v12.1: Integrity Check - Log total entry counts for diagnostic visibility
            const stats = await this.getStorageStats();
            if (stats) {
                const totalEntries = Object.values(stats).reduce((sum, s) => sum + s.count, 0);
                if (totalEntries === 0) {
                    console.warn('[GVP IndexedDB] ⚠️ DATABASE IS EMPTY. This may indicate a recent wipe or fresh install.');
                } else {
                    console.log(`[GVP IndexedDB] 📊 Integrity Check: ${totalEntries} total entries found across ${Object.keys(stats).length} stores.`);
                    // Log specific important stores
                    console.log(`[GVP IndexedDB] 📝 Prompts: ${stats[this.STORES.SAVED_PROMPT_SLOTS]?.count || 0} | 🎬 History: ${stats[this.STORES.UNIFIED_VIDEO_HISTORY]?.count || 0}`);
                }
            }

            // Why: Request persistent storage to prevent Chrome from evicting IDB under storage pressure
            // This is the primary defense against "random IDB wipes" — non-persistent origins can be pruned
            try {
                if (navigator.storage && navigator.storage.persist) {
                    const granted = await navigator.storage.persist();
                    console.log(`[GVP IndexedDB] 🔒 Storage persistence: ${granted ? 'GRANTED ✅' : 'DENIED ⚠️'}`);
                    if (!granted) {
                        console.warn('[GVP IndexedDB] ⚠️ Persistent storage denied — IDB may be evicted under storage pressure.');
                    }
                }
            } catch (persistError) {
                console.warn('[GVP IndexedDB] ⚠️ Could not request persistent storage:', persistError);
            }

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
                const oldVersion = event.oldVersion;
                console.log(`[GVP IndexedDB] Upgrading database schema from v${oldVersion} to v${event.newVersion}...`);
                const db = event.target.result;
                const transaction = event.target.transaction;

                // Sequential migration execution
                for (let v = oldVersion + 1; v <= event.newVersion; v++) {
                    if (IndexedDBManager.MIGRATIONS[v]) {
                        console.log(`[GVP IndexedDB] 🚀 Applying migration v${v}...`);
                        IndexedDBManager.MIGRATIONS[v](db, transaction, this.STORES);
                    }
                }

                console.log(`[GVP IndexedDB] ✅ Schema upgrade complete to v${event.newVersion}`);
            };
        });
    }

    /**
     * Migration Registry
     * Functions to apply schema changes for each version
     */
    static MIGRATIONS = {
        1: (db, transaction, STORES) => {
            if (!db.objectStoreNames.contains(STORES.MULTI_GEN_HISTORY)) {
                const historyStore = db.createObjectStore(STORES.MULTI_GEN_HISTORY, { keyPath: 'imageId' });
                historyStore.createIndex('accountId', 'accountId', { unique: false });
                historyStore.createIndex('timestamp', 'timestamp', { unique: false });
                historyStore.createIndex('status', 'status', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORES.PROGRESS_TRACKING)) {
                const progressStore = db.createObjectStore(STORES.PROGRESS_TRACKING, { keyPath: 'generationId' });
                progressStore.createIndex('imageId', 'imageId', { unique: false });
                progressStore.createIndex('timestamp', 'timestamp', { unique: false });
                progressStore.createIndex('status', 'status', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORES.SETTINGS_BACKUP)) {
                db.createObjectStore(STORES.SETTINGS_BACKUP, { keyPath: 'key' });
            }
        },
        2: (db, transaction, STORES) => {
            if (!db.objectStoreNames.contains(STORES.GALLERY_DATA)) {
                const galleryStore = db.createObjectStore(STORES.GALLERY_DATA, { keyPath: 'postId' });
                galleryStore.createIndex('accountId', 'accountId', { unique: false });
                galleryStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORES.IMAGE_PROJECTS)) {
                const projectsStore = db.createObjectStore(STORES.IMAGE_PROJECTS, { keyPath: 'compositeKey' });
                projectsStore.createIndex('accountId', 'accountId', { unique: false });
                projectsStore.createIndex('imageId', 'imageId', { unique: false });
                projectsStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
            // Add status index to history if missing (should be there from v1, but defensive)
            const historyStore = transaction.objectStore(STORES.MULTI_GEN_HISTORY);
            if (!historyStore.indexNames.contains('status')) {
                historyStore.createIndex('status', 'status', { unique: false });
            }
            const progressStore = transaction.objectStore(STORES.PROGRESS_TRACKING);
            if (!progressStore.indexNames.contains('imageId')) progressStore.createIndex('imageId', 'imageId', { unique: false });
            if (!progressStore.indexNames.contains('timestamp')) progressStore.createIndex('timestamp', 'timestamp', { unique: false });
            if (!progressStore.indexNames.contains('status')) progressStore.createIndex('status', 'status', { unique: false });
        },
        3: (db, transaction, STORES) => {
            if (!db.objectStoreNames.contains(STORES.JSON_PRESETS)) {
                const presetStore = db.createObjectStore(STORES.JSON_PRESETS, { keyPath: 'name' });
                presetStore.createIndex('savedAt', 'savedAt', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORES.RAW_TEMPLATES)) {
                const templateStore = db.createObjectStore(STORES.RAW_TEMPLATES, { keyPath: 'id' });
                templateStore.createIndex('name', 'name', { unique: false });
            }
        },
        4: (db, transaction, STORES) => {
            // v4 introduced unified store
            if (!db.objectStoreNames.contains(STORES.UNIFIED_VIDEO_HISTORY)) {
                const unifiedStore = db.createObjectStore(STORES.UNIFIED_VIDEO_HISTORY, { keyPath: 'imageId' });
                unifiedStore.createIndex('accountId', 'accountId', { unique: false });
                unifiedStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                unifiedStore.createIndex('createdAt', 'createdAt', { unique: false });
            }

            if (!db.objectStoreNames.contains(STORES.SAVED_PROMPT_SLOTS)) {
                const slotsStore = db.createObjectStore(STORES.SAVED_PROMPT_SLOTS, { keyPath: 'slotId' });
                slotsStore.createIndex('active', 'active', { unique: false });
                slotsStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORES.CUSTOM_DROPDOWNS)) {
                db.createObjectStore(STORES.CUSTOM_DROPDOWNS, { keyPath: 'category' });
            }
            if (!db.objectStoreNames.contains(STORES.CUSTOM_OBJECTS)) {
                const objectsStore = db.createObjectStore(STORES.CUSTOM_OBJECTS, { keyPath: 'id' });
                objectsStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORES.CUSTOM_DIALOGUES)) {
                db.createObjectStore(STORES.CUSTOM_DIALOGUES, { keyPath: 'id' });
            }
        },
        6: (db, transaction, STORES) => {
            if (!db.objectStoreNames.contains(STORES.UNIFIED_VIDEO_HISTORY)) {
                const unifiedStore = db.createObjectStore(STORES.UNIFIED_VIDEO_HISTORY, { keyPath: 'imageId' });
                unifiedStore.createIndex('accountId', 'accountId', { unique: false });
                unifiedStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }
        },
        12: (db, transaction, STORES) => {
            const legacyStores = [STORES.MULTI_GEN_HISTORY, STORES.IMAGE_PROJECTS, STORES.GALLERY_DATA, STORES.PROGRESS_TRACKING];
            legacyStores.forEach(name => {
                if (db.objectStoreNames.contains(name)) {
                    transaction.objectStore(name).clear();
                }
            });
        },
        13: (db, transaction, STORES) => {
            if (!db.objectStoreNames.contains(STORES.PROMPTS)) {
                const ps = db.createObjectStore(STORES.PROMPTS, { keyPath: 'id' });
                ps.createIndex('type', 'type', { unique: false });
                ps.createIndex('folder_id', 'folder_id', { unique: false });
                ps.createIndex('is_pinned', 'is_pinned', { unique: false });
                ps.createIndex('updated_at', 'updated_at', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORES.PROMPT_VERSIONS)) {
                const pvs = db.createObjectStore(STORES.PROMPT_VERSIONS, { keyPath: 'id' });
                pvs.createIndex('prompt_id', 'prompt_id', { unique: false });
                pvs.createIndex('version_num', 'version_num', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORES.FOLDERS)) {
                const fs = db.createObjectStore(STORES.FOLDERS, { keyPath: 'id' });
                fs.createIndex('parent_id', 'parent_id', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORES.PROMPT_TAGS)) {
                const ts = db.createObjectStore(STORES.PROMPT_TAGS, { keyPath: 'id' });
                ts.createIndex('name', 'name', { unique: true });
            }
            if (!db.objectStoreNames.contains(STORES.USAGE_LOG)) {
                const uls = db.createObjectStore(STORES.USAGE_LOG, { keyPath: 'id' });
                uls.createIndex('prompt_id', 'prompt_id', { unique: false });
                uls.createIndex('dispatched_at', 'dispatched_at', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORES.RECENTS)) {
                const rs = db.createObjectStore(STORES.RECENTS, { keyPath: 'id' });
                rs.createIndex('dispatched_at', 'dispatched_at', { unique: false });
            }
        },
        16: (db, transaction, STORES) => {
            if (!db.objectStoreNames.contains(STORES.CHUNKS)) db.createObjectStore(STORES.CHUNKS, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(STORES.SWAP_RULES)) db.createObjectStore(STORES.SWAP_RULES, { keyPath: 'id' });
        },
        17: (db, transaction, STORES) => {
            if (!db.objectStoreNames.contains(STORES.PARENT_INDEX)) {
                const pi = db.createObjectStore(STORES.PARENT_INDEX, { keyPath: 'childId' });
                pi.createIndex('rootId', 'rootId', { unique: false });
            }
        },
        18: (db, transaction, STORES) => {
            // v18 placeholder for specific FTS or Omnibox stores if needed
            // Currently using unified store indexes, but dedicated keyword stores are better for performance
            if (!db.objectStoreNames.contains('fts_index')) {
                const fts = db.createObjectStore('fts_index', { keyPath: 'key' });
                fts.createIndex('type', 'type', { unique: false }); // 'prompt' or 'history'
                console.log('[GVP IndexedDB] Created fts_index store (v18)');
            }
        },
        19: (db, transaction, STORES) => {
            const unifiedStore = transaction.objectStore(STORES.UNIFIED_VIDEO_HISTORY);

            // Add lowercase indexes for performant search
            if (!unifiedStore.indexNames.contains('prompt_lc')) {
                unifiedStore.createIndex('prompt_lc', 'prompt_lc', { unique: false });
            }
            if (!unifiedStore.indexNames.contains('customName_lc')) {
                unifiedStore.createIndex('customName_lc', 'customName_lc', { unique: false });
            }
            if (!unifiedStore.indexNames.contains('imageId_lc')) {
                unifiedStore.createIndex('imageId_lc', 'imageId_lc', { unique: false });
            }
            console.log('[GVP IndexedDB] Created lowercase search indexes (v19)');
        }
    };

    /**
     * Check if migration from chrome.storage has been completed
     */
    async _checkMigrationStatus() {
        try {
            if (!chrome?.storage?.local) {
                this.migrationComplete = true;
                return;
            }

            const result = await chrome.storage.local.get('gvp-indexeddb-migrated-v4');
            this.migrationComplete = result['gvp-indexeddb-migrated-v4'] === true;

            if (!this.migrationComplete) {
                console.log('[GVP IndexedDB] Migration not complete, will run migration...');
                await this.migrateFromChromeStorage();
            }
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to check migration status:', error);
        }
    }



    /**
     * Save multi-gen history snapshot
     * REDIRECTED TO UNIFIED STORE (v7)
     */
    async saveMultiGenHistory(snapshot) {
        if (!this.initialized || !snapshot) {
            return false;
        }

        try {
            // Convert Map or Object to array
            let entries = [];
            if (snapshot.images instanceof Map) {
                entries = Array.from(snapshot.images.values());
            } else if (typeof snapshot.images === 'object' && snapshot.images !== null) {
                entries = Object.values(snapshot.images);
            }

            // Save to unified store
            return this.saveUnifiedEntries(entries);
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to save multi-gen history (redirected):', error);
            return false;
        }
    }

    /**
     * Get multi-gen history snapshot
     * REDIRECTED FROM UNIFIED STORE (v7)
     */
    async getMultiGenHistory() {
        if (!this.initialized) {
            return null;
        }

        try {
            // Get all entries from unified store
            const transaction = this.db.transaction([this.STORES.UNIFIED_VIDEO_HISTORY], 'readonly');
            const store = transaction.objectStore(this.STORES.UNIFIED_VIDEO_HISTORY);
            const entries = await this._getAllData(store);

            // Reconstruct Map for StateManager
            const images = new Map();
            entries.forEach(entry => {
                if (entry.imageId) {
                    images.set(entry.imageId, entry);
                }
            });

            console.log('[GVP IndexedDB] Retrieved multi-gen history from Unified Store:', images.size, 'entries');

            return {
                images,
                lastModified: Date.now()
            };
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to get multi-gen history from Unified Store:', error);
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
     * @param {string} generationId
     * @param {Object} data
     */
    /**
     * Save progress tracking data
     * @deprecated Legacy store removed in v9
     */
    async saveProgress(generationId, data) {
        return true;
    }

    /**
     * Get progress tracking data
     */
    /**
     * Get progress tracking data
     * @deprecated Legacy store removed in v9
     */
    async getProgress(generationId) {
        return null;
    }

    /**
     * Delete progress tracking data
     */
    /**
     * Delete progress tracking data
     * @deprecated Legacy store removed in v9
     */
    async deleteProgress(generationId) {
        return true;
    }

    /**
     * Get all progress entries
     */
    /**
     * Get all progress entries
     * @deprecated Legacy store removed in v9
     */
    async getAllProgress() {
        return [];
    }

    /**
     * Clean up old progress entries (older than specified time)
     */
    /**
     * Clean up old progress entries
     * @deprecated Legacy store removed in v9
     */
    async cleanupOldProgress(maxAgeMs = 3600000) {
        return 0;
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

            // 1. Migrate multi-gen history (if not already done)
            // 1. Migrate multi-gen history (if not already done)
            // CRITICAL FIX: Ensure we don't overwrite IDB with legacy data repeatedly
            const multigenMigrated = await chrome.storage.local.get('gvp-multigen-migrated-v7');
            if (allData['gvp_multigen_history'] && !multigenMigrated['gvp-multigen-migrated-v7']) {
                const historySnapshot = allData['gvp_multigen_history'];
                const saved = await this.saveMultiGenHistory(historySnapshot);
                if (saved) {
                    migratedCount++;
                    await chrome.storage.local.remove('gvp_multigen_history');
                    // Mark as explicitly migrated to prevent re-runs
                    await chrome.storage.local.set({ 'gvp-multigen-migrated-v7': true });
                    console.log('[GVP IndexedDB] ✅ Migrated & cleared multi-gen history');
                }
            } else if (allData['gvp_multigen_history']) {
                // Was already migrated but data lingers? Clean it up.
                console.log('[GVP IndexedDB] 🧹 Cleaning up lingering legacy multi-gen history...');
                await chrome.storage.local.remove('gvp_multigen_history');
            }

            // 2. Migrate progress tracking entries
            const progressKeys = Object.keys(allData).filter(key => key.startsWith('gvp-progress-'));
            for (const key of progressKeys) {
                const generationId = key.replace('gvp-progress-', '');
                const saved = await this.saveProgress(generationId, allData[key]);
                if (saved) {
                    migratedCount++;
                    await chrome.storage.local.remove(key);
                }
            }
            if (progressKeys.length > 0) {
                console.log('[GVP IndexedDB] ✅ Migrated', progressKeys.length, 'progress entries');
            }

            // 3. Migrate JSON Presets & Raw Templates from gvp-settings
            if (allData['gvp-settings']) {
                const settings = allData['gvp-settings'];
                let settingsModified = false;

                // Migrate JSON Presets
                if (Array.isArray(settings.jsonPresets) && settings.jsonPresets.length > 0) {
                    console.log(`[GVP IndexedDB] Migrating ${settings.jsonPresets.length} JSON presets...`);
                    for (const preset of settings.jsonPresets) {
                        await this.saveJsonPreset(preset);
                    }
                    settings.jsonPresets = []; // Clear from settings
                    settingsModified = true;
                    migratedCount += settings.jsonPresets.length;
                }

                // Migrate Raw Templates
                if (Array.isArray(settings.rawTemplates) && settings.rawTemplates.length > 0) {
                    console.log(`[GVP IndexedDB] Migrating ${settings.rawTemplates.length} raw templates...`);
                    for (const template of settings.rawTemplates) {
                        // Ensure ID exists
                        if (!template.id) template.id = crypto.randomUUID();
                        await this.saveRawTemplate(template);
                    }
                    settings.rawTemplates = []; // Clear from settings
                    settingsModified = true;
                    migratedCount += settings.rawTemplates.length;
                }

                if (settingsModified) {
                    await chrome.storage.local.set({ 'gvp-settings': settings });
                    console.log('[GVP IndexedDB] ✅ Cleared migrated data from gvp-settings');
                }
            }

            // 4. Migrate Saved Prompt Slots from chrome.storage.local
            const savedPromptsData = allData['gvp-saved-prompts'];
            const savedPromptsConfig = allData['gvp-saved-prompts-config'];

            if (savedPromptsData || savedPromptsConfig) {
                console.log('[GVP IndexedDB] Migrating saved prompt slots...');

                // Parse config to get active slots
                let activeSlots = [1, 2, 3]; // default
                if (savedPromptsConfig) {
                    try {
                        const config = JSON.parse(savedPromptsConfig);
                        if (Array.isArray(config.slots)) {
                            activeSlots = config.slots;
                        }
                    } catch (e) {
                        console.warn('[GVP IndexedDB] Failed to parse saved prompts config:', e);
                    }
                }

                // Parse prompts data
                let promptsObj = {};
                if (savedPromptsData) {
                    try {
                        promptsObj = JSON.parse(savedPromptsData);
                    } catch (e) {
                        console.warn('[GVP IndexedDB] Failed to parse saved prompts data:', e);
                    }
                }

                // Migrate each slot
                for (const slotId of activeSlots) {
                    const slotKey = `slot${slotId}`;
                    const slotData = promptsObj[slotKey];

                    await this.saveSavedPromptSlot(slotId, {
                        slotId,
                        active: true,
                        prompt: slotData?.prompt || '',
                        timestamp: slotData?.timestamp || Date.now()
                    });
                }

                // Remove from chrome.storage
                await chrome.storage.local.remove(['gvp-saved-prompts', 'gvp-saved-prompts-config']);
                console.log(`[GVP IndexedDB] ✅ Migrated ${activeSlots.length} saved prompt slots`);
                migratedCount += activeSlots.length;
            }

            // 5. Migrate Custom Dropdown Options from chrome.storage.local
            const customDropdownValues = allData['gvp-custom-dropdown-values'];

            if (customDropdownValues) {
                console.log('[GVP IndexedDB] Migrating custom dropdown options...');

                try {
                    const dropdownObj = typeof customDropdownValues === 'string'
                        ? JSON.parse(customDropdownValues)
                        : customDropdownValues;

                    // Each category becomes a store entry
                    for (const [category, options] of Object.entries(dropdownObj)) {
                        if (Array.isArray(options) && options.length > 0) {
                            await this.saveCustomDropdownOptions(category, options);
                        }
                    }

                    // Remove from chrome.storage
                    await chrome.storage.local.remove('gvp-custom-dropdown-values');
                    const categoryCount = Object.keys(dropdownObj).length;
                    console.log(`[GVP IndexedDB] ✅ Migrated custom dropdowns for ${categoryCount} categories`);
                    migratedCount += categoryCount;
                } catch (e) {
                    console.warn('[GVP IndexedDB] Failed to migrate custom dropdowns:', e);
                }
            }

            // Mark migration complete (v4)
            await chrome.storage.local.set({ 'gvp-indexeddb-migrated-v4': true });
            this.migrationComplete = true;

            console.log('[GVP IndexedDB] ✅ Migration complete:', migratedCount, 'items migrated');

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
    // parentIndex: O(1) gallery parent UUID resolution (v17)
    // ========================================

    /**
     * Write a single childId → rootId link to the parentIndex store.
     * @param {string} childId  - The child post UUID (edited image or video post)
     * @param {string} rootId   - The root/parent post UUID this child belongs to
     * @returns {Promise<boolean>}
     */
    async setParentLink(childId, rootId) {
        if (!this.initialized || !childId || !rootId) return false;
        try {
            const tx = this.db.transaction([this.STORES.PARENT_INDEX], 'readwrite');
            const store = tx.objectStore(this.STORES.PARENT_INDEX);
            await this._putData(store, { childId, rootId });
            return true;
        } catch (err) {
            window.Logger?.warn('IndexedDB', '⚠️ setParentLink failed', { childId, rootId, err });
            return false;
        }
    }

    /**
     * Batch-write an array of { childId, rootId } pairs in a single transaction.
     * Called from NetworkInterceptor._applyGalleryDataset() during /list ingestion.
     * @param {Array<{childId:string, rootId:string}>} pairs
     * @returns {Promise<boolean>}
     */
    async setParentLinks(pairs) {
        console.log(`[GVP][IDB] setParentLinks called with ${pairs?.length || 0} pairs`);
        if (!this.initialized || !Array.isArray(pairs) || !pairs.length) {
            console.warn(`[GVP][IDB] setParentLinks early exit: initialized=${this.initialized}, pairs=${pairs?.length}`);
            return false;
        }
        try {
            const tx = this.db.transaction([this.STORES.PARENT_INDEX], 'readwrite');
            const store = tx.objectStore(this.STORES.PARENT_INDEX);
            let written = 0;
            for (const { childId, rootId } of pairs) {
                if (childId && rootId) {
                    store.put({ childId, rootId });
                    written++;
                }
            }
            console.log(`[GVP][IDB] setParentLinks: ${written}/${pairs.length} pairs queued for write`);
            return new Promise((resolve, reject) => {
                tx.oncomplete = () => {
                    console.log(`[GVP][IDB] ✅ setParentLinks transaction complete: ${written} pairs committed`);
                    resolve(true);
                };
                tx.onerror = () => {
                    console.error(`[GVP][IDB] ❌ setParentLinks transaction FAILED:`, tx.error);
                    reject(tx.error);
                };
            });
        } catch (err) {
            console.error(`[GVP][IDB] ❌ setParentLinks exception:`, err);
            window.Logger?.warn('IndexedDB', '⚠️ setParentLinks batch failed', err);
            return false;
        }
    }

    /**
     * Resolve the root UUID for any child UUID via O(1) IDB lookup.
     * Returns the rootId if found, or null if the UUID is not in the index.
     * @param {string} childId - UUID to look up
     * @returns {Promise<string|null>}
     */
    async resolveRoot(childId) {
        if (!this.initialized || !childId) return null;
        try {
            const tx = this.db.transaction([this.STORES.PARENT_INDEX], 'readonly');
            const store = tx.objectStore(this.STORES.PARENT_INDEX);
            const record = await this._getData(store, childId);
            console.log(`[GVP][IDB] resolveRoot(${childId.substring(0, 8)}…) → ${record?.rootId ? record.rootId.substring(0, 8) + '…' : 'NULL'}`);
            return record?.rootId ?? null;
        } catch (err) {
            console.error(`[GVP][IDB] resolveRoot FAILED for ${childId.substring(0, 8)}…:`, err);
            window.Logger?.warn('IndexedDB', '⚠️ resolveRoot failed', { childId, err });
            return null;
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
    // ========================================
    // Gallery Data Management (NEW in v2)
    // ========================================

    /**
     * Save gallery posts from API responses
     * @param {Array} posts - Array of post objects from gallery API
     * @param {string} accountId - Account ID for indexing
     */
    async saveGalleryPosts(posts, accountId) {
        if (!this.initialized || !posts || !Array.isArray(posts)) {
            return false;
        }

        try {
            const transaction = this.db.transaction([this.STORES.GALLERY_DATA], 'readwrite');
            const store = transaction.objectStore(this.STORES.GALLERY_DATA);

            let savedCount = 0;
            for (const post of posts) {
                const data = {
                    postId: post.id || post.postId,
                    accountId: accountId || post.accountId,
                    timestamp: post.timestamp || Date.now(),
                    thumbnail: post.thumbnail || post.image_url || null,
                    status: post.status || 'unknown',
                    success: post.success !== false,
                    ...post
                };
                await this._putData(store, data);
                savedCount++;
            }

            // ✅ UNLIMITED STORAGE: Pruning disabled per user request
            // Per-account isolation maintained via accountId field
            // await this._pruneGalleryData(accountId);

            console.log(`[GVP IndexedDB]  Saved ${savedCount} gallery posts`);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB]  Failed to save gallery posts:', error);
            return false;
        }
    }

    /**
     * Get gallery posts for an account
     * @param {string} accountId - Account ID to filter by
     * @param {Object} options - Query options (limit, offset, etc.)
     */
    /**
     * Get gallery posts for an account
     * @deprecated Legacy store removed in v9
     */
    async getGalleryPosts(accountId, options = {}) {
        return [];
    }

    /**
     * Get all gallery posts across all accounts (for finding most recent account)
     * @param {Object} options - Query options (limit, sortBy)
     */
    /**
     * Get all gallery posts across all accounts
     * @deprecated Legacy store removed in v9
     */
    async getAllGalleryPosts(options = {}) {
        return [];
    }

    /**
     * Clear all gallery data for an account
     */
    async clearGalleryData(accountId) {
        if (!this.initialized) {
            return false;
        }

        try {
            const posts = await this.getGalleryPosts(accountId);
            const transaction = this.db.transaction([this.STORES.GALLERY_DATA], 'readwrite');
            const store = transaction.objectStore(this.STORES.GALLERY_DATA);

            for (const post of posts) {
                await this._deleteData(store, post.postId);
            }

            console.log(`[GVP IndexedDB]  Cleared ${posts.length} gallery posts for account ${accountId}`);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB]  Failed to clear gallery data:', error);
            return false;
        }
    }

    /**
     * Prune oldest gallery posts to stay within limit
     * @deprecated Pruning disabled in v1.17.2 for unlimited storage
     */
    async _pruneGalleryData(accountId) {
        // Pruning disabled per user request for unlimited video storage
        // Keeping method stub for backward compatibility
        return;
    }

    // ========================================
    // Unified Video History Management (NEW in v6)
    // ========================================

    /**
     * Upsert a multi-gen entry with a safe merge strategy
     * (Prevents StateManager from stripping projectSettings/galleryMeta)
     * @param {Object} entry 
     * @returns {Promise<boolean>}
     */
    async upsertMultiGenEntry(entry) {
        if (!this.initialized || !entry || !entry.imageId) return false;

        try {
            // 1. Get existing entry to preserve metadata that StateManager doesn't track
            const existing = await this.getUnifiedEntry(entry.imageId);

            let mergedEntry;
            if (existing) {
                // 2. Perform safe merge: Keep metadata, update attempts/status
                mergedEntry = {
                    ...existing,
                    ...entry,
                    updatedAt: new Date().toISOString()
                };

                // Special handling: Keep the original createdAt if it exists
                if (existing.createdAt) {
                    mergedEntry.createdAt = existing.createdAt;
                }
            } else {
                // New entry
                mergedEntry = {
                    ...entry,
                    createdAt: entry.createdAt || new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
            }

            // 3. Save the final merged result
            return await this.saveUnifiedEntry(mergedEntry);
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed during upsertMultiGenEntry:', error);
            return false;
        }
    }

    /**
     * Merge multiple unified entries (Import/Sync)
     * Handles deep merging of attempts and preservation of existing metadata
     * @param {Array<Object>} entries 
     * @returns {Promise<Object>} { success: number, fail: number }
     */
    async mergeUnifiedEntries(entries) {
        if (!this.initialized || !Array.isArray(entries)) return { success: 0, fail: 0 };

        let success = 0;
        let fail = 0;

        // Process in chunks to avoid blocking UI
        const chunkSize = 20;
        for (let i = 0; i < entries.length; i += chunkSize) {
            const chunk = entries.slice(i, i + chunkSize);

            await Promise.all(chunk.map(async (importedEntry) => {
                try {
                    // Normalize imported entry
                    if (!importedEntry.imageId) return;

                    const existing = await this.getUnifiedEntry(importedEntry.imageId);
                    let finalEntry;

                    if (existing) {
                        // MERGE STRATEGY:
                        // 1. Preserve existing projectSettings if present (local truth)
                        // 2. Prioritize higher resolution thumbnails
                        // 3. Smart merge attempts (deduplicate)

                        // Merge attempts
                        const mergedAttempts = this._mergeAttempts(existing.attempts, importedEntry.attempts);

                        // Determine thumbnail (prefer existing if valid, else import)
                        const thumb = existing.thumbnailUrl || importedEntry.thumbnailUrl;

                        finalEntry = {
                            ...importedEntry, // Start with import basics
                            ...existing,      // Overlay existing (preserves creation dates, local settings)
                            attempts: mergedAttempts,
                            thumbnailUrl: thumb,
                            updatedAt: new Date().toISOString()
                        };

                        // Specific field protection: Project Settings
                        // If existing has settings, keep them. If not, take import's.
                        if (existing.projectSettings && Object.keys(existing.projectSettings).length > 0) {
                            finalEntry.projectSettings = existing.projectSettings;
                        } else if (importedEntry.projectSettings) {
                            finalEntry.projectSettings = importedEntry.projectSettings;
                        }

                    } else {
                        // New Entry - Ensure defaults
                        finalEntry = {
                            ...importedEntry,
                            createdAt: importedEntry.createdAt || new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                            attempts: this._mergeAttempts([], importedEntry.attempts) // Clean any duplicates in import itself
                        };
                    }

                    await this.saveUnifiedEntry(finalEntry);
                    success++;
                } catch (err) {
                    console.error(`[GVP IndexedDB] Failed to merge entry ${importedEntry.imageId}`, err);
                    fail++;
                }
            }));
        }

        return { success, fail };
    }

    /**
     * Helper: Merge and deduplicate attempts
     * @param {Array} existingArr 
     * @param {Array} importedArr 
     * @returns {Array} Sorted, unique attempts
     */
    _mergeAttempts(existingArr = [], importedArr = []) {
        const combined = [...(existingArr || []), ...(importedArr || [])];
        const uniqueMap = new Map();

        combined.forEach(attempt => {
            if (!attempt) return;

            // Generate a robust ID if missing
            // Fallback for legacy data: Hash functionality using timestamp + videoId
            const id = attempt.id || attempt.videoId || `legacy_${attempt.timestamp}_${attempt.status}`;

            if (uniqueMap.has(id)) {
                // If collision, prefer the one with more data or 'success' status
                const current = uniqueMap.get(id);
                if (attempt.status === 'success' && current.status !== 'success') {
                    uniqueMap.set(id, attempt);
                }
                // Otherwise keep existing (first one wins usually, or local wins)
            } else {
                uniqueMap.set(id, attempt);
            }
        });

        // Convert back to array
        const results = Array.from(uniqueMap.values());

        // Sort by timestamp (newest last)
        return results.sort((a, b) => {
            const tA = new Date(a.timestamp || 0).getTime();
            const tB = new Date(b.timestamp || 0).getTime();
            return tA - tB;
        });
    }

    /**
     * Save a unified video history entry
     * @param {Object} entry - The entry to save
     * @returns {Promise<boolean>}
     */
    async saveUnifiedEntry(entry) {
        if (!this.initialized || !entry || !entry.imageId) {
            console.warn('[GVP IndexedDB] ⚠️ Cannot save unified entry: Invalid data', entry);
            return false;
        }

        try {
            const transaction = this.db.transaction([this.STORES.UNIFIED_VIDEO_HISTORY], 'readwrite');
            const store = transaction.objectStore(this.STORES.UNIFIED_VIDEO_HISTORY);

            // Ensure timestamp
            if (!entry.updatedAt) {
                entry.updatedAt = new Date().toISOString();
            }

            // Populate lowercase fields for optimized search
            entry.prompt_lc = (entry.prompt || '').toLowerCase();
            entry.customName_lc = (entry.customName || '').toLowerCase();
            entry.imageId_lc = (entry.imageId || '').toLowerCase();

            await this._putData(store, entry);

            // Multi-tab sync
            this._broadcastChange('UPDATE', this.STORES.UNIFIED_VIDEO_HISTORY, { imageId: entry.imageId });

            console.log(`[GVP IndexedDB] 💾 SAVED to UNIFIED_VIDEO_HISTORY: ${entry.imageId}`, {
                accountId: entry.accountId,
                timestamp: entry.updatedAt,
                prompt: entry.prompt ? entry.prompt.substring(0, 50) + '...' : 'N/A'
            });
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to save unified entry:', error);
            return false;
        }
    }

    /**
     * Save multiple unified video history entries in a single transaction
     * @param {Array<Object>} entries - The entries to save
     * @returns {Promise<boolean>}
     */
    async saveUnifiedEntries(entries) {
        if (!this.initialized || !Array.isArray(entries)) {
            return false;
        }

        if (entries.length === 0) {
            return true;
        }

        try {
            const transaction = this.db.transaction([this.STORES.UNIFIED_VIDEO_HISTORY], 'readwrite');
            const store = transaction.objectStore(this.STORES.UNIFIED_VIDEO_HISTORY);

            let savedCount = 0;
            for (const entry of entries) {
                if (!entry.updatedAt) {
                    entry.updatedAt = new Date().toISOString();
                }

                // Populate lowercase fields for optimized search
                entry.prompt_lc = (entry.prompt || '').toLowerCase();
                entry.customName_lc = (entry.customName || '').toLowerCase();
                entry.imageId_lc = (entry.imageId || '').toLowerCase();

                await this._putData(store, entry);
                savedCount++;
            }

            return new Promise((resolve, reject) => {
                transaction.oncomplete = () => {
                    console.log(`[GVP IndexedDB] 💾 BATCH SAVED ${savedCount} entries to UNIFIED_VIDEO_HISTORY`);
                    // Multi-tab sync
                    this._broadcastChange('BATCH_UPDATE', this.STORES.UNIFIED_VIDEO_HISTORY);
                    resolve(true);
                };
                transaction.onerror = () => reject(transaction.error);
            });
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to save unified entries batch:', error);
            return false;
        }
    }

    /**
     * Get multiple unified video history entries in a single transaction
     * @param {Array<string>} imageIds - Array of Image IDs to retrieve
     * @returns {Promise<Map<string, Object>>} Map of imageId -> entry
     */
    async getUnifiedEntriesBatch(imageIds) {
        if (!this.initialized || !Array.isArray(imageIds) || imageIds.length === 0) {
            return new Map();
        }

        try {
            const uniqueIds = [...new Set(imageIds)];
            const transaction = this.db.transaction([this.STORES.UNIFIED_VIDEO_HISTORY], 'readonly');
            const store = transaction.objectStore(this.STORES.UNIFIED_VIDEO_HISTORY);
            const results = new Map();

            const promises = uniqueIds.map(id => {
                return new Promise((resolve) => {
                    const request = store.get(id);
                    request.onsuccess = () => resolve({ id, data: request.result });
                    request.onerror = () => {
                        console.warn(`[GVP IndexedDB] Failed to batch get ${id}`);
                        resolve({ id, data: null });
                    };
                });
            });

            const entries = await Promise.all(promises);
            entries.forEach(entry => {
                if (entry.data) {
                    results.set(entry.id, entry.data);
                }
            });

            return results;
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to get unified entries batch:', error);
            return new Map();
        }
    }

    /**
     * Get a single unified video history entry by imageId
     * @param {string} imageId - Image ID to retrieve
     * @returns {Promise<Object|null>}
     */
    async getUnifiedEntry(imageId) {
        // console.log('[GVP IndexedDB] 🔍 getUnifiedEntry called', { imageId });

        if (!this.initialized || !imageId) {
            return null;
        }

        try {
            const transaction = this.db.transaction([this.STORES.UNIFIED_VIDEO_HISTORY], 'readonly');
            const store = transaction.objectStore(this.STORES.UNIFIED_VIDEO_HISTORY);
            const entry = await this._getData(store, imageId);
            return entry;
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to get unified entry:', error, { imageId });
            return null;
        }
    }

    /**
     * Get all unified video history entries for an account
     * @param {string} accountId - Account ID to filter by
     * @returns {Promise<Array>}
     */
    async getAllUnifiedEntries(accountId, limit = 500) {
        console.log('[GVP IndexedDB] 📦 getAllUnifiedEntries called', {
            accountId: accountId?.substring(0, 12) + '...',
            limit,
            initialized: this.initialized
        });

        if (!this.initialized || !accountId) {
            console.warn('[GVP IndexedDB] ⚠️ Cannot get entries - not initialized or no accountId', {
                initialized: this.initialized,
                hasAccountId: !!accountId
            });
            return [];
        }

        try {
            console.log('[GVP IndexedDB] 🔎 Querying index for accountId:', accountId.substring(0, 12) + '...');

            const transaction = this.db.transaction([this.STORES.UNIFIED_VIDEO_HISTORY], 'readonly');
            const store = transaction.objectStore(this.STORES.UNIFIED_VIDEO_HISTORY);
            const index = store.index('accountId');

            const request = index.getAll(accountId);
            const entries = await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });

            // ✅ Sort by createTime/updatedAt/createdAt (descending) - Newest First
            entries.sort((a, b) => {
                const timeA = new Date(a.createTime || a.updatedAt || a.createdAt || 0).getTime();
                const timeB = new Date(b.createTime || b.updatedAt || b.createdAt || 0).getTime();
                return timeB - timeA;
            });

            const totalVideos = entries.reduce((sum, e) => sum + (e.attempts?.length || 0), 0);

            // Apply limit
            const limitedEntries = limit > 0 ? entries.slice(0, limit) : entries;

            console.log(`[GVP IndexedDB] ✅ Retrieved ${limitedEntries.length}/${entries.length} unified entries for account ${accountId.substring(0, 8)}...`, {
                imageCount: limitedEntries.length,
                totalVideos: totalVideos,
                sampleImageIds: limitedEntries.slice(0, 3).map(e => e.imageId)
            });

            return limitedEntries;
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to get all unified entries:', error, {
                accountId: accountId?.substring(0, 12)
            });
            return [];
        }
    }

    /**
     * Clear all unified video history entries for an account
     * @param {string} accountId - Account ID to clear
     * @returns {Promise<boolean>}
     */
    async clearUnifiedHistory(accountId) {
        if (!this.initialized || !accountId) {
            return false;
        }

        try {
            // Use getAllUnifiedEntries(accountId, 0) for an uncapped read to ensure we delete everything
            const entries = await this.getAllUnifiedEntries(accountId, 0);
            const transaction = this.db.transaction([this.STORES.UNIFIED_VIDEO_HISTORY], 'readwrite');
            const store = transaction.objectStore(this.STORES.UNIFIED_VIDEO_HISTORY);

            for (const entry of entries) {
                await this._deleteData(store, entry.imageId);
            }

            console.log(`[GVP IndexedDB] ✅ Cleared ${entries.length} unified entries for account ${accountId}`);

            // Multi-tab sync: Only broadcast CLEAR if we actually processed the full set
            // (Since we used offset 0, this is definitive)
            this._broadcastChange('CLEAR', this.STORES.UNIFIED_VIDEO_HISTORY, {
                accountId,
                count: entries.length
            });

            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to clear unified history:', error);
            return false;
        }
    }

    // ========================================
    // Image Projects Management (NEW in v2)
    // ========================================


    /**
     * Save an image project state
     * @param {string} accountId
     * @param {string} imageId
     * @param {Object} data
     */
    /**
     * Save an image project state
     * REDIRECTED TO UNIFIED STORE (v7)
     * @param {string} accountId
     * @param {string} imageId
     * @param {Object} data
     */
    async saveImageProject(accountId, imageId, data) {
        if (!this.initialized || !accountId || !imageId) {
            return false;
        }

        try {
            // 1. Save to Unified Store (Primary)
            const unifiedEntry = await this.getUnifiedEntry(imageId) || {
                imageId,
                accountId,
                attempts: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            unifiedEntry.projectSettings = {
                ...unifiedEntry.projectSettings,
                ...data,
                timestamp: Date.now()
            };
            unifiedEntry.updatedAt = new Date().toISOString();

            await this.saveUnifiedEntry(unifiedEntry);

            // Legacy store write removed in v8 cleanup

            console.log(`[GVP IndexedDB] ✅ Saved image project (Unified): ${accountId}:${imageId}`);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to save image project:', error);
            return false;
        }
    }


    /**
     * Get image project data
     * REDIRECTED TO UNIFIED STORE (v7)
     * @param {string} accountId - Account ID
     * @param {string} imageId - Image ID
     */
    async getImageProject(accountId, imageId) {
        if (!this.initialized || !accountId || !imageId) {
            return null;
        }

        try {
            // Unified Store Only
            const unifiedEntry = await this.getUnifiedEntry(imageId);
            if (unifiedEntry && unifiedEntry.projectSettings) {
                return unifiedEntry.projectSettings;
            }
            return null;
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to get image project:', error);
            return null;
        }
    }

    /**
     * Get all image projects for an account
     * @param {string} accountId - Account ID
     */
    async getImageProjectsByAccount(accountId, limit = 500) {
        if (!this.initialized || !accountId) {
            return [];
        }

        try {
            // Use unified store
            const unifiedEntries = await this.getAllUnifiedEntries(accountId, limit);
            return unifiedEntries
                .filter(e => e.projectSettings && Object.keys(e.projectSettings).length > 0)
                .map(e => ({
                    ...e.projectSettings,
                    imageId: e.imageId,
                    accountId: e.accountId,
                    timestamp: e.updatedAt
                }));
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to get image projects:', error);
            return [];
        }
    }


    /**
     * Delete image project
     * @param {string} accountId - Account ID
     * @param {string} imageId - Image ID
     */
    async deleteImageProject(accountId, imageId) {
        if (!this.initialized || !accountId || !imageId) {
            return false;
        }

        try {
            const transaction = this.db.transaction([this.STORES.IMAGE_PROJECTS], 'readwrite');
            const store = transaction.objectStore(this.STORES.IMAGE_PROJECTS);
            const compositeKey = `${accountId}:${imageId}`;

            await this._deleteData(store, compositeKey);
            console.log(`[GVP IndexedDB]  Deleted image project: ${compositeKey}`);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB]  Failed to delete image project:', error);
            return false;
        }
    }

    /**
     * Migrate image projects from chrome.storage.local
     */
    async migrateImageProjectsFromChromeStorage() {
        if (!this.initialized) return;

        try {
            const result = await chrome.storage.local.get(['gvp-image-projects']);
            const projectsArray = result['gvp-image-projects'];

            if (!projectsArray || !Array.isArray(projectsArray)) {
                console.log('[GVP IndexedDB] No legacy image projects found to migrate.');
                return;
            }

            // CRITICAL FIX: Check if already migrated to prevent overwriting Unified Store
            const flag = await chrome.storage.local.get('gvp-image-projects-migrated-v7');
            if (flag['gvp-image-projects-migrated-v7']) {
                console.log('[GVP IndexedDB] Image projects already migrated provided by v7 flag.');
                // Cleanup if still present
                await chrome.storage.local.remove('gvp-image-projects');
                return;
            }

            console.log('[GVP IndexedDB] Migrating image projects from chrome.storage...');
            let count = 0;

            // projectsArray structure: [[accountId, [[imageId, projectData], ...]], ...]
            for (const [accountId, entries] of projectsArray) {
                if (!Array.isArray(entries)) continue;

                for (const [imageId, projectData] of entries) {
                    if (projectData) {
                        // Ensure accountId is attached
                        projectData.accountId = accountId;
                        // Use the new save method
                        await this.saveImageProject(accountId, imageId, projectData);
                        count++;
                    }
                }
            }

            console.log(`[GVP IndexedDB] Successfully migrated ${count} image projects.`);

            // Optional: Clear legacy storage after successful migration
            await chrome.storage.local.remove('gvp-image-projects');
            // CRITICAL: Set flag
            await chrome.storage.local.set({ 'gvp-image-projects-migrated-v7': true });

        } catch (error) {
            console.error('[GVP IndexedDB] Failed to migrate image projects:', error);
        }
    }

    // ========================================
    // JSON Presets Management (NEW in v3)
    // ========================================

    async saveJsonPreset(preset) {
        if (!this.initialized || !preset || !preset.name) return false;
        try {
            const transaction = this.db.transaction([this.STORES.JSON_PRESETS], 'readwrite');
            const store = transaction.objectStore(this.STORES.JSON_PRESETS);
            await this._putData(store, preset);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to save JSON preset:', error);
            return false;
        }
    }

    async getJsonPresets() {
        if (!this.initialized) return [];
        try {
            const transaction = this.db.transaction([this.STORES.JSON_PRESETS], 'readonly');
            const store = transaction.objectStore(this.STORES.JSON_PRESETS);
            return await this._getAllData(store);
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to get JSON presets:', error);
            return [];
        }
    }

    async deleteJsonPreset(name) {
        if (!this.initialized || !name) return false;
        try {
            const transaction = this.db.transaction([this.STORES.JSON_PRESETS], 'readwrite');
            const store = transaction.objectStore(this.STORES.JSON_PRESETS);
            await this._deleteData(store, name);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to delete JSON preset:', error);
            return false;
        }
    }

    // ========================================
    // Raw Templates Management (NEW in v3)
    // ========================================

    async saveRawTemplate(template) {
        if (!this.initialized || !template || !template.id) return false;
        try {
            const transaction = this.db.transaction([this.STORES.RAW_TEMPLATES], 'readwrite');
            const store = transaction.objectStore(this.STORES.RAW_TEMPLATES);
            await this._putData(store, template);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to save raw template:', error);
            return false;
        }
    }

    async getRawTemplates() {
        if (!this.initialized) return [];
        try {
            const transaction = this.db.transaction([this.STORES.RAW_TEMPLATES], 'readonly');
            const store = transaction.objectStore(this.STORES.RAW_TEMPLATES);
            return await this._getAllData(store);
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to get raw templates:', error);
            return [];
        }
    }

    async deleteRawTemplate(id) {
        if (!this.initialized || !id) return false;
        try {
            const transaction = this.db.transaction([this.STORES.RAW_TEMPLATES], 'readwrite');
            const store = transaction.objectStore(this.STORES.RAW_TEMPLATES);
            await this._deleteData(store, id);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to delete raw template:', error);
            return false;
        }
    }

    // ========================================
    // Saved Prompt Slots Management (NEW in v4)
    // ========================================

    async saveSavedPromptSlot(slotId, data) {
        if (!this.initialized || !slotId) return false;
        try {
            const slotData = {
                slotId,
                active: data.active !== undefined ? data.active : true,
                name: data.name || '',
                prompt: data.prompt || '',
                timestamp: data.timestamp || Date.now()
            };
            const transaction = this.db.transaction([this.STORES.SAVED_PROMPT_SLOTS], 'readwrite');
            const store = transaction.objectStore(this.STORES.SAVED_PROMPT_SLOTS);
            await this._putData(store, slotData);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to save saved prompt slot:', error);
            return false;
        }
    }

    async getSavedPromptSlots() {
        if (!this.initialized) return [];
        try {
            const transaction = this.db.transaction([this.STORES.SAVED_PROMPT_SLOTS], 'readonly');
            const store = transaction.objectStore(this.STORES.SAVED_PROMPT_SLOTS);
            return await this._getAllData(store);
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to get saved prompt slots:', error);
            return [];
        }
    }

    async getSavedPromptSlot(slotId) {
        if (!this.initialized || !slotId) return null;
        try {
            const transaction = this.db.transaction([this.STORES.SAVED_PROMPT_SLOTS], 'readonly');
            const store = transaction.objectStore(this.STORES.SAVED_PROMPT_SLOTS);
            return await this._getData(store, slotId);
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to get saved prompt slot:', error);
            return null;
        }
    }

    async deleteSavedPromptSlot(slotId) {
        if (!this.initialized || !slotId) return false;
        try {
            const transaction = this.db.transaction([this.STORES.SAVED_PROMPT_SLOTS], 'readwrite');
            const store = transaction.objectStore(this.STORES.SAVED_PROMPT_SLOTS);
            await this._deleteData(store, slotId);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to delete saved prompt slot:', error);
            return false;
        }
    }

    // ========================================
    // Custom Dropdown Options Management (NEW in v4)
    // ========================================

    async saveCustomDropdownOptions(category, options) {
        if (!this.initialized || !category) return false;
        try {
            const data = {
                category,
                options: Array.isArray(options) ? options : [],
                timestamp: Date.now()
            };
            const transaction = this.db.transaction([this.STORES.CUSTOM_DROPDOWNS], 'readwrite');
            const store = transaction.objectStore(this.STORES.CUSTOM_DROPDOWNS);
            await this._putData(store, data);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to save custom dropdown options:', error);
            return false;
        }
    }


    async getCustomDropdownOptions(category) {
        if (!this.initialized || !category) return [];
        try {
            const transaction = this.db.transaction([this.STORES.CUSTOM_DROPDOWNS], 'readonly');
            const store = transaction.objectStore(this.STORES.CUSTOM_DROPDOWNS);
            const data = await this._getData(store, category);
            return data?.options || [];
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to get custom dropdown options:', error);
            return [];
        }
    }

    async getAllCustomDropdownOptions() {
        if (!this.initialized) return {};
        try {
            const transaction = this.db.transaction([this.STORES.CUSTOM_DROPDOWNS], 'readonly');
            const store = transaction.objectStore(this.STORES.CUSTOM_DROPDOWNS);
            const allData = await this._getAllData(store);
            const result = {};
            for (const item of allData) {
                result[item.category] = item.options;
            }
            return result;
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to get all custom dropdown options:', error);
            return {};
        }
    }

    async deleteCustomDropdownOptions(category) {
        if (!this.initialized || !category) return false;
        try {
            const transaction = this.db.transaction([this.STORES.CUSTOM_DROPDOWNS], 'readwrite');
            const store = transaction.objectStore(this.STORES.CUSTOM_DROPDOWNS);
            await this._deleteData(store, category);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to delete custom dropdown options:', error);
            return false;
        }
    }

    // ========================================
    // Custom Objects Management (NEW in v4)
    // ========================================

    async saveCustomObject(object) {
        if (!this.initialized || !object) return false;
        try {
            const objectData = {
                id: object.id || crypto.randomUUID(),
                data: object.data || object,
                timestamp: Date.now()
            };
            const transaction = this.db.transaction([this.STORES.CUSTOM_OBJECTS], 'readwrite');
            const store = transaction.objectStore(this.STORES.CUSTOM_OBJECTS);
            await this._putData(store, objectData);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to save custom object:', error);
            return false;
        }
    }

    async getCustomObjects() {
        if (!this.initialized) return [];
        try {
            const transaction = this.db.transaction([this.STORES.CUSTOM_OBJECTS], 'readonly');
            const store = transaction.objectStore(this.STORES.CUSTOM_OBJECTS);
            return await this._getAllData(store);
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to get custom objects:', error);
            return [];
        }
    }

    async deleteCustomObject(id) {
        if (!this.initialized || !id) return false;
        try {
            const transaction = this.db.transaction([this.STORES.CUSTOM_OBJECTS], 'readwrite');
            const store = transaction.objectStore(this.STORES.CUSTOM_OBJECTS);
            await this._deleteData(store, id);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to delete custom object:', error);
            return false;
        }
    }

    // ========================================
    // Custom Dialogues Management (NEW in v4)
    // ========================================

    async saveCustomDialogue(dialogue) {
        if (!this.initialized || !dialogue) return false;
        try {
            const dialogueData = {
                id: dialogue.id || crypto.randomUUID(),
                data: dialogue.data || dialogue,
                timestamp: Date.now()
            };
            const transaction = this.db.transaction([this.STORES.CUSTOM_DIALOGUES], 'readwrite');
            const store = transaction.objectStore(this.STORES.CUSTOM_DIALOGUES);
            await this._putData(store, dialogueData);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to save custom dialogue:', error);
            return false;
        }
    }

    async getCustomDialogues() {
        if (!this.initialized) return [];
        try {
            const transaction = this.db.transaction([this.STORES.CUSTOM_DIALOGUES], 'readonly');
            const store = transaction.objectStore(this.STORES.CUSTOM_DIALOGUES);
            return await this._getAllData(store);
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to get custom dialogues:', error);
            return [];
        }
    }

    async deleteCustomDialogue(id) {
        if (!this.initialized || !id) return false;
        try {
            const transaction = this.db.transaction([this.STORES.CUSTOM_DIALOGUES], 'readwrite');
            const store = transaction.objectStore(this.STORES.CUSTOM_DIALOGUES);
            await this._deleteData(store, id);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to delete custom dialogue:', error);
            return false;
        }
    }

    // ========================================
    // Storage Management & Pruning (NEW in v2)
    // ========================================

    /**
     * Get storage statistics for all stores
     */
    async getStorageStats() {
        if (!this.initialized) {
            return null;
        }

        try {
            const stats = {};
            const storeNames = Object.values(this.STORES);

            for (const storeName of storeNames) {
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const count = await new Promise((resolve, reject) => {
                    const request = store.count();
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });

                stats[storeName] = { count };
            }

            return stats;
        } catch (error) {
            console.error('[GVP IndexedDB]  Failed to get storage stats:', error);
            return null;
        }
    }

    /**
     * Prune old data across all stores to enforce limits
     */
    async pruneOldData() {
        if (!this.initialized) {
            return false;
        }

        try {
            console.log('[GVP IndexedDB]  Starting data pruning...');

            // Prune old image projects (beyond retention days)
            await this._pruneImageProjects();

            // Prune old progress tracking (completed generations)
            await this._pruneProgressTracking();

            console.log('[GVP IndexedDB]  Pruning complete');
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB]  Pruning failed:', error);
            return false;
        }
    }

    /**
     * Prune image projects older than retention period
     */
    async _pruneImageProjects() {
        try {
            const transaction = this.db.transaction([this.STORES.IMAGE_PROJECTS], 'readwrite');
            const store = transaction.objectStore(this.STORES.IMAGE_PROJECTS);
            const allProjects = await this._getAllData(store);

            const cutoffTime = Date.now() - (this.LIMITS.MAX_IMAGE_PROJECT_AGE_DAYS * 24 * 60 * 60 * 1000);
            let prunedCount = 0;

            for (const project of allProjects) {
                if (project.timestamp < cutoffTime) {
                    await this._deleteData(store, project.compositeKey);
                    prunedCount++;
                }
            }

            if (prunedCount > 0) {
                console.log(`[GVP IndexedDB]  Pruned ${prunedCount} old image projects`);
            }
        } catch (error) {
            console.error('[GVP IndexedDB]  Image project pruning failed:', error);
        }
    }

    /**
     * Prune completed/old progress tracking entries
     */
    async _pruneProgressTracking() {
        try {
            const transaction = this.db.transaction([this.STORES.PROGRESS_TRACKING], 'readwrite');
            const store = transaction.objectStore(this.STORES.PROGRESS_TRACKING);
            const allProgress = await this._getAllData(store);

            const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days
            let prunedCount = 0;

            for (const progress of allProgress) {
                const isOld = progress.timestamp < cutoffTime;
                const isCompleted = progress.status === 'completed' || progress.status === 'failed';

                if (isOld || (isCompleted && progress.timestamp < Date.now() - (24 * 60 * 60 * 1000))) {
                    await this._deleteData(store, progress.generationId);
                    prunedCount++;
                }
            }

            if (prunedCount > 0) {
                console.log(`[GVP IndexedDB]  Pruned ${prunedCount} old progress entries`);
            }
        } catch (error) {
            console.error('[GVP IndexedDB]  Progress tracking pruning failed:', error);
        }
    }

    /**
     * Cleanup legacy stores after migration (v7)
     * Deletes multiGenHistory, imageProjects, and galleryData
     */
    async cleanupLegacyStores() {
        if (!this.initialized) return false;

        try {
            console.log('[GVP IndexedDB] 🧹 Starting cleanup of legacy stores...');

            const legacyStores = [
                this.STORES.MULTI_GEN_HISTORY,
                this.STORES.IMAGE_PROJECTS,
                this.STORES.GALLERY_DATA,
                this.STORES.PROGRESS_TRACKING
            ];

            const transaction = this.db.transaction(legacyStores, 'readwrite');

            for (const storeName of legacyStores) {
                const store = transaction.objectStore(storeName);
                await this._clearStore(store);
                console.log(`[GVP IndexedDB] 🗑️ Cleared legacy store: ${storeName}`);
            }

            console.log('[GVP IndexedDB] ✨ Legacy cleanup complete.');
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to cleanup legacy stores:', error);
            return false;
        }
    }

    /**
     * Enhanced saveProgress with automatic limit enforcement
     */
    async saveProgressWithLimit(generationId, data) {
        if (!this.initialized || !generationId) {
            return false;
        }

        try {
            if (data.rawPayload && data.rawPayload.length > this.LIMITS.MAX_PAYLOAD_SIZE) {
                data.rawPayload = data.rawPayload.substring(0, this.LIMITS.MAX_PAYLOAD_SIZE) + '... [truncated]';
            }

            if (data.progressSamples && Array.isArray(data.progressSamples)) {
                if (data.progressSamples.length > this.LIMITS.MAX_PROGRESS_SAMPLES) {
                    data.progressSamples = data.progressSamples.slice(-this.LIMITS.MAX_PROGRESS_SAMPLES);
                }
            }

            return await this.saveProgress(generationId, data);
        } catch (error) {
            console.error('[GVP IndexedDB]  Failed to save progress with limit:', error);
            return false;
        }
    }

    /**
     * Get progress entries by image ID
     */
    async getProgressByImageId(imageId) {
        if (!this.initialized || !imageId) {
            return [];
        }

        try {
            const transaction = this.db.transaction([this.STORES.PROGRESS_TRACKING], 'readonly');
            const store = transaction.objectStore(this.STORES.PROGRESS_TRACKING);
            const index = store.index('imageId');

            const request = index.getAll(imageId);
            const results = await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });

            return results;
        } catch (error) {
            console.error('[GVP IndexedDB]  Failed to get progress by imageId:', error);
            return [];
        }
    }

    /**
     * Delete all progress entries for an image
     */
    async deleteProgressByImageId(imageId) {
        if (!this.initialized || !imageId) {
            return false;
        }

        try {
            const progressEntries = await this.getProgressByImageId(imageId);
            const transaction = this.db.transaction([this.STORES.PROGRESS_TRACKING], 'readwrite');
            const store = transaction.objectStore(this.STORES.PROGRESS_TRACKING);

            for (const entry of progressEntries) {
                await this._deleteData(store, entry.generationId);
            }

            console.log(`[GVP IndexedDB]  Deleted ${progressEntries.length} progress entries for image ${imageId}`);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB]  Failed to delete progress by imageId:', error);
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // v13: PROMPT LIBRARY — CRUD Methods
    // ─────────────────────────────────────────────────────────────────

    /**
     * Save (upsert) a prompt entry to the library.
     * @param {Object} prompt - PromptEntry object with `id` as keyPath
     * @returns {Promise<boolean>}
     */
    async savePrompt(prompt) {
        if (!this.initialized || !prompt?.id) return false;
        try {
            const tx = this.db.transaction([this.STORES.PROMPTS], 'readwrite');
            await new Promise((res, rej) => {
                const req = tx.objectStore(this.STORES.PROMPTS).put(prompt);
                req.onsuccess = () => res();
                req.onerror = () => rej(req.error);
            });
            return true;
        } catch (e) {
            window.Logger?.error('IDB', 'savePrompt failed', e);
            return false;
        }
    }

    /**
     * Get a single prompt by id.
     * @param {string} id
     * @returns {Promise<Object|null>}
     */
    async getPrompt(id) {
        if (!this.initialized || !id) return null;
        try {
            const tx = this.db.transaction([this.STORES.PROMPTS], 'readonly');
            return await new Promise((res, rej) => {
                const req = tx.objectStore(this.STORES.PROMPTS).get(id);
                req.onsuccess = () => res(req.result || null);
                req.onerror = () => rej(req.error);
            });
        } catch (e) {
            window.Logger?.error('IDB', 'getPrompt failed', e);
            return null;
        }
    }

    /**
     * Get all prompts, optionally filtered by type ('image'|'video').
     * Returns sorted by updated_at descending.
     * @param {string|null} [type]
     * @returns {Promise<Object[]>}
     */
    async getPrompts(type = null) {
        if (!this.initialized) return [];
        try {
            const tx = this.db.transaction([this.STORES.PROMPTS], 'readonly');
            const store = tx.objectStore(this.STORES.PROMPTS);
            let results = await new Promise((res, rej) => {
                const req = type
                    ? store.index('type').getAll(type)
                    : store.getAll();
                req.onsuccess = () => res(req.result || []);
                req.onerror = () => rej(req.error);
            });
            // Sort by updated_at descending
            results.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
            return results;
        } catch (e) {
            window.Logger?.error('IDB', 'getPrompts failed', e);
            return [];
        }
    }

    /**
     * Delete a prompt by id.
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deletePrompt(id) {
        if (!this.initialized || !id) return false;
        try {
            const tx = this.db.transaction([this.STORES.PROMPTS], 'readwrite');
            await new Promise((res, rej) => {
                const req = tx.objectStore(this.STORES.PROMPTS).delete(id);
                req.onsuccess = () => res();
                req.onerror = () => rej(req.error);
            });
            return true;
        } catch (e) {
            window.Logger?.error('IDB', 'deletePrompt failed', e);
            return false;
        }
    }

    // ── Prompt Versions ──────────────────────────────────────────────

    /**
     * Save a version snapshot for a prompt.
     * @param {Object} version - PromptVersion with `id`, `prompt_id`
     * @returns {Promise<boolean>}
     */
    async savePromptVersion(version) {
        if (!this.initialized || !version?.id) return false;
        try {
            const tx = this.db.transaction([this.STORES.PROMPT_VERSIONS], 'readwrite');
            await new Promise((res, rej) => {
                const req = tx.objectStore(this.STORES.PROMPT_VERSIONS).put(version);
                req.onsuccess = () => res();
                req.onerror = () => rej(req.error);
            });
            return true;
        } catch (e) {
            window.Logger?.error('IDB', 'savePromptVersion failed', e);
            return false;
        }
    }

    /**
     * Get all versions for a prompt, sorted by version_num ascending.
     * @param {string} promptId
     * @returns {Promise<Object[]>}
     */
    async getPromptVersions(promptId) {
        if (!this.initialized || !promptId) return [];
        try {
            const tx = this.db.transaction([this.STORES.PROMPT_VERSIONS], 'readonly');
            const results = await new Promise((res, rej) => {
                const req = tx.objectStore(this.STORES.PROMPT_VERSIONS).index('prompt_id').getAll(promptId);
                req.onsuccess = () => res(req.result || []);
                req.onerror = () => rej(req.error);
            });
            return results.sort((a, b) => (a.version_num || 0) - (b.version_num || 0));
        } catch (e) {
            window.Logger?.error('IDB', 'getPromptVersions failed', e);
            return [];
        }
    }

    /**
     * Delete all version records for a given prompt id.
     * @param {string} promptId
     * @returns {Promise<boolean>}
     */
    async deletePromptVersions(promptId) {
        if (!this.initialized || !promptId) return false;
        try {
            const versions = await this.getPromptVersions(promptId);
            const tx = this.db.transaction([this.STORES.PROMPT_VERSIONS], 'readwrite');
            const store = tx.objectStore(this.STORES.PROMPT_VERSIONS);
            await Promise.all(versions.map(v =>
                new Promise((res, rej) => {
                    const req = store.delete(v.id);
                    req.onsuccess = res;
                    req.onerror = () => rej(req.error);
                })
            ));
            return true;
        } catch (e) {
            window.Logger?.error('IDB', 'deletePromptVersions failed', e);
            return false;
        }
    }

    // ── Folders ───────────────────────────────────────────────────────

    /**
     * Save (upsert) a folder.
     * @param {Object} folder - { id, name, parent_id, order }
     * @returns {Promise<boolean>}
     */
    async saveFolder(folder) {
        if (!this.initialized || !folder?.id) return false;
        try {
            const tx = this.db.transaction([this.STORES.FOLDERS], 'readwrite');
            await new Promise((res, rej) => {
                const req = tx.objectStore(this.STORES.FOLDERS).put(folder);
                req.onsuccess = () => res();
                req.onerror = () => rej(req.error);
            });
            return true;
        } catch (e) {
            window.Logger?.error('IDB', 'saveFolder failed', e);
            return false;
        }
    }

    /**
     * Get all folders.
     * @returns {Promise<Object[]>}
     */
    async getFolders() {
        if (!this.initialized) return [];
        try {
            const tx = this.db.transaction([this.STORES.FOLDERS], 'readonly');
            return await new Promise((res, rej) => {
                const req = tx.objectStore(this.STORES.FOLDERS).getAll();
                req.onsuccess = () => res(req.result || []);
                req.onerror = () => rej(req.error);
            });
        } catch (e) {
            window.Logger?.error('IDB', 'getFolders failed', e);
            return [];
        }
    }

    /**
     * Delete a folder by id.
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteFolder(id) {
        if (!this.initialized || !id) return false;
        try {
            const tx = this.db.transaction([this.STORES.FOLDERS], 'readwrite');
            await new Promise((res, rej) => {
                const req = tx.objectStore(this.STORES.FOLDERS).delete(id);
                req.onsuccess = () => res();
                req.onerror = () => rej(req.error);
            });
            return true;
        } catch (e) {
            window.Logger?.error('IDB', 'deleteFolder failed', e);
            return false;
        }
    }

    // ── Tags ──────────────────────────────────────────────────────────

    /**
     * Save (upsert) a tag definition.
     * @param {Object} tag - { id, name, color? }
     * @returns {Promise<boolean>}
     */
    async savePromptTag(tag) {
        if (!this.initialized || !tag?.id) return false;
        try {
            const tx = this.db.transaction([this.STORES.PROMPT_TAGS], 'readwrite');
            await new Promise((res, rej) => {
                const req = tx.objectStore(this.STORES.PROMPT_TAGS).put(tag);
                req.onsuccess = () => res();
                req.onerror = () => rej(req.error);
            });
            return true;
        } catch (e) {
            window.Logger?.error('IDB', 'savePromptTag failed', e);
            return false;
        }
    }

    /**
     * Get all tag definitions.
     * @returns {Promise<Object[]>}
     */
    async getPromptTags() {
        if (!this.initialized) return [];
        try {
            const tx = this.db.transaction([this.STORES.PROMPT_TAGS], 'readonly');
            return await new Promise((res, rej) => {
                const req = tx.objectStore(this.STORES.PROMPT_TAGS).getAll();
                req.onsuccess = () => res(req.result || []);
                req.onerror = () => rej(req.error);
            });
        } catch (e) {
            window.Logger?.error('IDB', 'getPromptTags failed', e);
            return [];
        }
    }

    /**
     * Delete a tag by id.
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deletePromptTag(id) {
        if (!this.initialized || !id) return false;
        try {
            const tx = this.db.transaction([this.STORES.PROMPT_TAGS], 'readwrite');
            await new Promise((res, rej) => {
                const req = tx.objectStore(this.STORES.PROMPT_TAGS).delete(id);
                req.onsuccess = () => res();
                req.onerror = () => rej(req.error);
            });
            return true;
        } catch (e) {
            window.Logger?.error('IDB', 'deletePromptTag failed', e);
            return false;
        }
    }

    // ── Usage Log ─────────────────────────────────────────────────────

    /**
     * Append a usage log entry (async, non-blocking caller).
     * @param {Object} entry - UsageLogEntry with `id`, `prompt_id`, `dispatched_at`, etc.
     * @returns {Promise<boolean>}
     */
    async logPromptUsage(entry) {
        if (!this.initialized || !entry?.id) return false;
        try {
            const tx = this.db.transaction([this.STORES.USAGE_LOG], 'readwrite');
            await new Promise((res, rej) => {
                const req = tx.objectStore(this.STORES.USAGE_LOG).add(entry);
                req.onsuccess = () => res();
                req.onerror = () => rej(req.error);
            });
            return true;
        } catch (e) {
            window.Logger?.error('IDB', 'logPromptUsage failed', e);
            return false;
        }
    }

    /**
     * Get usage stats for a specific prompt (use count, last used, moderation rate).
     * @param {string} promptId
     * @returns {Promise<{useCount: number, lastUsedAt: string|null, moderationRate: number}>}
     */
    async getPromptUsageStats(promptId) {
        if (!this.initialized || !promptId) return { useCount: 0, lastUsedAt: null, moderationRate: 0 };
        try {
            const tx = this.db.transaction([this.STORES.USAGE_LOG], 'readonly');
            const entries = await new Promise((res, rej) => {
                const req = tx.objectStore(this.STORES.USAGE_LOG).index('prompt_id').getAll(promptId);
                req.onsuccess = () => res(req.result || []);
                req.onerror = () => rej(req.error);
            });
            const useCount = entries.length;
            const lastUsedAt = entries.length
                ? entries.sort((a, b) => b.dispatched_at.localeCompare(a.dispatched_at))[0].dispatched_at
                : null;
            const moderated = entries.filter(e => e.moderation_result === 'moderated').length;
            const moderationRate = useCount > 0 ? moderated / useCount : 0;
            return { useCount, lastUsedAt, moderationRate };
        } catch (e) {
            window.Logger?.error('IDB', 'getPromptUsageStats failed', e);
            return { useCount: 0, lastUsedAt: null, moderationRate: 0 };
        }
    }

    // ── Recents ───────────────────────────────────────────────────────

    /**
     * Upsert a recent prompt entry and cap the store at `limit` entries (FIFO by dispatched_at).
     * @param {Object} entry - { id, prompt_body, dispatched_at, generation_type }
     * @param {number} [limit=20]
     * @returns {Promise<boolean>}
     */
    async addRecentPrompt(entry, limit = 20) {
        if (!this.initialized || !entry?.id) return false;
        try {
            const tx = this.db.transaction([this.STORES.RECENTS], 'readwrite');
            const store = tx.objectStore(this.STORES.RECENTS);

            // Add entry
            await new Promise((res, rej) => {
                const req = store.put(entry);
                req.onsuccess = () => res();
                req.onerror = () => rej(req.error);
            });

            // Fetch all sorted by dispatched_at asc
            const all = await new Promise((res, rej) => {
                const req = store.index('dispatched_at').getAll();
                req.onsuccess = () => res(req.result || []);
                req.onerror = () => rej(req.error);
            });

            // Evict oldest if over limit
            if (all.length > limit) {
                all.sort((a, b) => a.dispatched_at.localeCompare(b.dispatched_at));
                const toDelete = all.slice(0, all.length - limit);
                await Promise.all(toDelete.map(e =>
                    new Promise((res, rej) => {
                        const req = store.delete(e.id);
                        req.onsuccess = res;
                        req.onerror = () => rej(req.error);
                    })
                ));
            }

            return true;
        } catch (e) {
            window.Logger?.error('IDB', 'addRecentPrompt failed', e);
            return false;
        }
    }

    /**
     * Get recent prompts sorted by dispatched_at descending.
     * @param {number} [limit=20]
     * @returns {Promise<Object[]>}
     */
    async getRecentPrompts(limit = 20) {
        if (!this.initialized) return [];
        try {
            const tx = this.db.transaction([this.STORES.RECENTS], 'readonly');
            const all = await new Promise((res, rej) => {
                const req = tx.objectStore(this.STORES.RECENTS).getAll();
                req.onsuccess = () => res(req.result || []);
                req.onerror = () => rej(req.error);
            });
            return all
                .sort((a, b) => b.dispatched_at.localeCompare(a.dispatched_at))
                .slice(0, limit);
        } catch (e) {
            window.Logger?.error('IDB', 'getRecentPrompts failed', e);
            return [];
        }
    }

    // ========================================
    // Generic Store Operations (for Phase 2 Managers)
    // ========================================

    /**
     * Get all items from a generic store
     * @param {string} storeName - Name of the object store
     * @returns {Promise<Array>}
     */
    async getAll(storeName) {
        if (!this.initialized) return [];
        try {
            const tx = this.db.transaction([storeName], 'readonly');
            return await new Promise((resolve, reject) => {
                const request = tx.objectStore(storeName).getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            window.Logger?.error('IDBManager', `getAll failed for ${storeName}`, error);
            return [];
        }
    }

    /**
     * Put an item into a generic store
     * @param {string} storeName - Name of the object store
     * @param {Object} item - Item to store
     * @returns {Promise<boolean>}
     */
    async put(storeName, item) {
        if (!this.initialized) return false;
        try {
            const tx = this.db.transaction([storeName], 'readwrite');
            return await new Promise((resolve, reject) => {
                const request = tx.objectStore(storeName).put(item);
                request.onsuccess = () => {
                    // Multi-tab sync
                    this._broadcastChange('UPDATE', storeName, item);
                    resolve(true);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            window.Logger?.error('IDBManager', `put failed for ${storeName}`, error);
            return false;
        }
    }

    /**
     * Update an existing item by ID
     */
    async update(storeName, id, item) {
        // In IndexedDB, put acts as upsert if keypath exists
        return this.put(storeName, item);
    }

    /**
     * Delete an item from a generic store by its key
     * @param {string} storeName - Name of the object store
     * @param {string} key - Key to delete
     * @returns {Promise<boolean>}
     */
    async delete(storeName, key) {
        if (!this.initialized) return false;
        try {
            const tx = this.db.transaction([storeName], 'readwrite');
            return await new Promise((resolve, reject) => {
                const request = tx.objectStore(storeName).delete(key);
                request.onsuccess = () => {
                    // Multi-tab sync
                    this._broadcastChange('DELETE', storeName, { key });
                    resolve(true);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            window.Logger?.error('IDBManager', `delete failed for ${storeName}`, error);
            return false;
        }
    }

    /**
     * Get statistics about storage usage across all stores
     * @returns {Promise<Object>} Object mapping store names to item counts
     */
    async getStorageStats() {
        if (!this.initialized) return null;
        try {
            const stats = {};
            const storeNames = Array.from(this.db.objectStoreNames);
            const transaction = this.db.transaction(storeNames, 'readonly');

            await Promise.all(storeNames.map(name => {
                return new Promise((resolve) => {
                    const request = transaction.objectStore(name).count();
                    request.onsuccess = () => {
                        stats[name] = { count: request.result };
                        resolve();
                    };
                    request.onerror = () => {
                        stats[name] = { count: 0, error: true };
                        resolve();
                    };
                });
            }));

            return stats;
        } catch (error) {
            console.error('[GVP IndexedDB] Failed to get storage stats:', error);
            return null;
        }
    }

    /**
     * Export the entire database content as a JSON object
     * @returns {Promise<Object>} All data from all object stores
     */
    async exportFullDatabase() {
        if (!this.initialized) return null;
        try {
            const backup = {
                version: this.dbVersion,
                timestamp: new Date().toISOString(),
                stores: {}
            };

            const storeNames = Array.from(this.db.objectStoreNames);
            const transaction = this.db.transaction(storeNames, 'readonly');

            for (const name of storeNames) {
                const store = transaction.objectStore(name);
                backup.stores[name] = await this._getAllData(store);
            }

            return backup;
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Full database export failed:', error);
            throw error;
        }
    }

    /**
     * Import database content from a JSON backup object
     * @param {Object} backupData - The data to import
     * @param {Object} options - Import options
     * @param {boolean} options.merge - If true, skips clearing existing data (upsert only)
     * @returns {Promise<boolean>}
     */
    async importFullDatabase(backupData, options = { merge: false }) {
        if (!this.initialized || !backupData) {
            throw new Error('Invalid backup data provided for import');
        }

        const isMerge = !!options.merge;

        // v1.46.12: Support legacy export format (pre-v1.46)
        // Old format: { exportedAt, accountId, entries: [...] }
        // New format: { version, timestamp, stores: { storeName: [...] } }
        let normalizedData = backupData;
        if (backupData.entries && !backupData.stores) {
            console.log('[GVP IndexedDB] 🔄 Legacy export format detected. Normalizing...');
            normalizedData = {
                version: 0, // Legacy
                timestamp: backupData.exportedAt || new Date().toISOString(),
                stores: {
                    [this.STORES.UNIFIED_VIDEO_HISTORY]: backupData.entries
                }
            };
        }

        if (!normalizedData.stores) {
            throw new Error('Invalid backup data: missing "stores" or "entries" property');
        }

        try {
            console.log(`[GVP IndexedDB] 📥 Starting full database import (${isMerge ? 'Merge' : 'Replace'})...`);

            if (!isMerge) {
                // 1. Clear all current stores
                const storeNames = Array.from(this.db.objectStoreNames);
                const transaction = this.db.transaction(storeNames, 'readwrite');

                for (const name of storeNames) {
                    // If we have data for this store in the backup, clear it first
                    if (normalizedData.stores[name]) {
                        const store = transaction.objectStore(name);
                        store.clear();
                        console.log(`[GVP IndexedDB] 🧹 Cleared store for import: ${name}`);
                    }
                }

                // wait for clears to complete
                await new Promise((resolve, reject) => {
                    transaction.oncomplete = resolve;
                    transaction.onerror = () => reject(transaction.error);
                });
            } else {
                console.log('[GVP IndexedDB] ⏭️ Skipping store clear (Merge mode)');
            }

            // 2. Repopulate stores
            const storeNames = Array.from(this.db.objectStoreNames);
            const importTransaction = this.db.transaction(storeNames, 'readwrite');
            let totalImported = 0;

            for (const [name, items] of Object.entries(normalizedData.stores)) {
                if (!storeNames.includes(name)) {
                    console.warn(`[GVP IndexedDB] ⚠️ Skipping unknown store in backup: ${name}`);
                    continue;
                }

                const store = importTransaction.objectStore(name);
                for (const item of items) {
                    store.put(item);
                    totalImported++;
                }
                console.log(`[GVP IndexedDB] ✅ Imported ${items.length} items into store: ${name}`);
            }

            await new Promise((resolve, reject) => {
                importTransaction.oncomplete = resolve;
                importTransaction.onerror = () => reject(importTransaction.error);
            });

            console.log(`[GVP IndexedDB] ✨ Full import complete. Total items: ${totalImported}`);
            return true;
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Database import failed:', error);
            throw error;
        }
    }

    /**
     * Get ALL unified video history entries across ALL accounts
     * Why: The standard getAllUnifiedEntries() is scoped to a single accountId index.
     * This method fetches everything in the store for cross-account IDB export.
     * @returns {Promise<Array>} All entries regardless of account
     */
    async getAllUnifiedEntriesGlobal() {
        if (!this.initialized) {
            console.warn('[GVP IndexedDB] ⚠️ Cannot get global entries - not initialized');
            return [];
        }

        try {
            const transaction = this.db.transaction([this.STORES.UNIFIED_VIDEO_HISTORY], 'readonly');
            const store = transaction.objectStore(this.STORES.UNIFIED_VIDEO_HISTORY);
            const request = store.getAll();

            const entries = await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });

            // Sort by time descending (newest first)
            entries.sort((a, b) => {
                const timeA = new Date(a.createTime || a.updatedAt || a.createdAt || 0).getTime();
                const timeB = new Date(b.createTime || b.updatedAt || b.createdAt || 0).getTime();
                return timeB - timeA;
            });

            return entries;
        } catch (error) {
            console.error('[GVP IndexedDB] ❌ Failed to get global unified entries:', error);
            return [];
        }
    }

    /**
     * Search unified history by query string (for Omnibox)
     * @param {string} query 
     * @returns {Promise<Array>}
     */
    async searchUnifiedHistory(query) {
        if (!this.initialized || !query) return [];
        const q = query.toLowerCase();

        try {
            const resultsMap = new Map();
            const transaction = this.db.transaction([this.STORES.UNIFIED_VIDEO_HISTORY], 'readonly');
            const store = transaction.objectStore(this.STORES.UNIFIED_VIDEO_HISTORY);

            // Targeted prefix lookups on lowercase indexes
            const indexes = ['imageId_lc', 'customName_lc', 'prompt_lc'];
            const range = IDBKeyRange.bound(q, q + '\uffff');

            for (const indexName of indexes) {
                if (resultsMap.size >= 10) break;
                if (!store.indexNames.contains(indexName)) continue;

                const index = store.index(indexName);
                const matches = await new Promise((resolve) => {
                    const localMatches = [];
                    const request = index.openCursor(range);
                    request.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (!cursor || (resultsMap.size + localMatches.length) >= 10) {
                            resolve(localMatches);
                            return;
                        }
                        const entry = cursor.value;
                        if (!resultsMap.has(entry.imageId)) {
                            localMatches.push(entry);
                        }
                        cursor.continue();
                    };
                    request.onerror = () => resolve([]);
                });

                for (const match of matches) {
                    resultsMap.set(match.imageId, match);
                }
            }

            return Array.from(resultsMap.values());
        } catch (error) {
            console.error('[GVP IndexedDB] Search failed:', error);
            return [];
        }
    }

    /**
     * Generate a diagnostic report of the database state
     * @returns {Promise<Object>}
     */
    async getDatabaseReport() {
        if (!this.initialized) return { error: 'Not initialized' };

        const report = {
            timestamp: new Date().toISOString(),
            version: this.dbVersion,
            stores: {},
            totalEntries: 0,
            storageEstimate: null,
            accounts: {}
        };

        try {
            const stats = await this.getStorageStats();
            report.stores = stats;
            report.totalEntries = Object.values(stats).reduce((sum, s) => sum + s.count, 0);

            if (navigator.storage && navigator.storage.estimate) {
                report.storageEstimate = await navigator.storage.estimate();
            }

            // Get account distribution from Unified History
            const history = await this.getAllUnifiedEntriesGlobal();
            const accountDist = {};
            history.forEach(entry => {
                const aid = entry.accountId || 'unknown';
                accountDist[aid] = (accountDist[aid] || 0) + 1;
            });
            report.accounts = accountDist;

            return report;
        } catch (error) {
            console.error('[GVP IndexedDB] Diagnostic report failed:', error);
            return { error: error.message };
        }
    }

};
