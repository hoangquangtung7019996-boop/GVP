// a:/Tools n Programs/SD-GrokScripts/grok-video-prompter-extension/src/content/managers/StateManager.js
// Manages the application's state.
// Dependencies: None

window.StateManager = class StateManager {
    constructor(indexedDBManager = null) {
        // Initialize StorageManager for persistence with IndexedDB support
        this.storageManager = new window.StorageManager(indexedDBManager);
        this.indexedDBManager = indexedDBManager;
        this._storageInitialized = false;

        // Listen for late IndexedDB initialization (v1.47 emergency fallback support)
        window.addEventListener('gvp:idb-late-init', async () => {
            window.Logger.info('StateManager', '📥 Late IndexedDB initialization detected. Reloading data...');
            await this._loadSettings();
            window.Logger.info('StateManager', '✅ Late data load complete.');
        });

        // Track 30-second timeouts for pending generations
        this._generationTimeouts = new Map(); // attemptId -> { timeoutId, imageId }

        // Track gallery bulk sync completion per account (optimization)
        this._accountSyncComplete = new Map(); // accountId -> boolean

        this.state = {
            isOpen: false,
            activeTab: 'gvp-json-editor',
            promptData: this._getEmptyPromptData(),
            rawInput: '',
            debugMode: false,
            ui: {
                categoryViewMode: 'grid',
                activeCategory: null,
                activeSubArray: null,
                drawerExpanded: false,
                wrapInQuotes: false,
                quickLaunchMode: null,
                quickLaunchSuppressed: false,
                quickVideoFromEdit: false  // Toggle for Quick Video from edited images
            },
            fullscreenContent: {
                category: null,
                subArray: null,
                value: '',
                formattedValue: ''
            },
            generation: {
                status: 'idle',
                lastPrompt: null,
                lastVideoPromptRaw: null,
                retryCount: 0,
                useSpicy: false,
                showGenerationRail: false,  // NEW v1.21.48: Standalone rail toggle
                useNativeSpicy: false,  // NEW: Flag when native spicy button was clicked
                uploadPrompt: null,      // NEW: Prompt to inject on file upload
                // NEW: Enhanced generation tracking
                currentGenerationId: null,
                isGenerating: false,
                moderationData: {
                    isModerated: false,
                    moderationReason: null,
                    retryCount: 0,
                    lastRetryTime: null,
                    retryHistory: []
                },
                // NEW: DOM-based progress tracking
                progressTracking: new Map() // key -> { progress, context, timestamp }
            },
            multiGeneration: {
                activeGenerations: new Map(),
                completedGenerations: new Map(),
                queuedGenerations: [],
                maxConcurrent: 3
            },
            multiGenHistory: this._createEmptyMultiGenHistory(),
            // NEW: Image-centric history tracking
            imageProjects: new Map(),
            // NEW: Gallery API data from /rest/media/post/list
            galleryData: {
                posts: [],              // Raw posts from API
                videoIndex: new Map(),  // videoId -> video object
                imageIndex: new Map(),  // imageId -> post object
                lastUpdate: null,       // Timestamp of last API ingestion
                source: null            // 'favorites' | 'gallery' | null
            },
            // NEW v6: Unified video history (from /list API, persists across refreshes)
            unifiedHistory: [],
            settings: {
                defaultMode: 'normal',
                autoRetry: true,
                maxRetries: 3,
                soundEnabled: true,
                silentMode: false,
                wrapInQuotes: false,
                autoMinimize: false,
                debugMode: false,
                customDropdownOptions: {},
                // Moderation and retry settings
                autoRetryOnModeration: true,
                maxModerationRetries: 3,
                retryDelayMultiplier: 1.5,
                progressiveEnhancement: true,
                fallbackToNormalMode: false,
                logModerationEvents: true,
                notifyOnModerationRetry: true,
                uploadModeEnabled: false,
                // Quick Launch settings
                rawTemplates: [],
                jsonPresets: [],
                debugLogging: false, // Verbose logging toggle
                autoNavigateBackAfterImageEdit: false, // Toggle for Auto-Back after Image Edit
                // Guillotine Exploit settings (public asset conversion)
                guillotineEnabled: false,    // Enable iframe guillotine for upload mode
                guillotineDelay: 245,        // TCP kill delay in ms (245ms = sweet spot)
                wordSwapAutoEnabled: true,   // Auto-cycle Word Swap rules on dispatch (toggle in Word Swapper modal)
            },
            activeAccountId: null
        };
        // CRITICAL FIX: Do NOT load settings in constructor!
        // Settings must load AFTER IndexedDB initializes
        this._settingsPromise = null; // Will be set in initialize()
        this._settingsLoadPromise = null; // v1.47 FIXED: Shared promise to prevent concurrent loads
        this._multiGenHistorySaveTimer = null;
        this.MULTI_GEN_LIMITS = Object.freeze({
            maxImages: 5000, // Increased from 36 for IndexedDB support
            maxAttemptsPerImage: 50,
            maxProgressEvents: 100,
            maxStreamChars: 100000,
            maxPayloadChars: 50000
        });
    }

    /**
     * ------------------------------------------------------------------
     * Generation Registration (Rail Integration)
     * ------------------------------------------------------------------
     */

    /**
     * Generate a unique ID for a generation attempt
     */
    generateGenerationId() {
        return `gen_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Register the start of a generation and notify the Rail
     * @param {Object} data - { videoId, imageId, parentPostId, prompt, thumbnailUrl }
     * @returns {string} videoId
     */
    registerGenerationStart(data) {
        const { videoId, imageId } = data;
        const id = videoId || `pending_${Date.now()}`;

        // FIX: Removed optimistic rail update to prevent "hallucinated" items (gen_ vs real UUID).
        // The Rail will rely solely on NetworkInterceptor events for 100% accuracy.

        // Use window.Logger instead of this.log
        window.Logger.info('StateManager', 'Registered generation start (awaiting network)', { id, imageId });
        return id;
    }

    /**
     * ------------------------------------------------------------------
     * Multi-Gen History helpers (state scaffolding only – persistence
     * wiring is handled separately in StorageManager).
     * ------------------------------------------------------------------
     */
    _createEmptyMultiGenHistory() {
        return {
            images: new Map(),
            order: [],
            lastImageByAccount: new Map(),
            armedRequests: new Map(),
            activeAccountId: null
        };
    }

    /**
     * Generic state update (merges partial state)
     * @param {Object} partialState 
     */
    updateState(partialState) {
        if (!partialState || typeof partialState !== 'object') return;

        // Deep merge helper or simple shallow merge? 
        // For 'ui' we need at least one level deep usually, but simple approach:

        // Helper to merge deeply nested objects safely
        const deepMerge = (target, source) => {
            for (const key in source) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    if (!target[key]) target[key] = {};
                    deepMerge(target[key], source[key]);
                } else {
                    target[key] = source[key];
                }
            }
        };

        deepMerge(this.state, partialState);

        // Emit general update
        window.dispatchEvent(new CustomEvent('gvp:state-updated', { detail: this.state }));
    }

    _enforceMultiGenHistoryLimits(context = 'general') {
        const limits = this.MULTI_GEN_LIMITS;
        const history = this.state?.multiGenHistory;
        if (!limits || !history) {
            return;
        }

        let mutated = false;

        // Trim oldest images beyond limit (order newest-first)
        while (history.order.length > limits.maxImages) {
            const removedId = history.order.pop();
            if (removedId) {
                if (this.deleteMultiGenImage(removedId)) {
                    mutated = true;
                }
            }
        }

        const orderSnapshot = [...history.order];
        for (const imageId of orderSnapshot) {
            let entry = history.images.get(imageId);
            if (!entry) {
                continue;
            }

            while (entry.attempts.length > limits.maxAttemptsPerImage) {
                const trimmedAttempt = entry.attempts[entry.attempts.length - 1];
                if (!trimmedAttempt) break;
                if (this.deleteMultiGenAttempt(imageId, trimmedAttempt.id)) {
                    mutated = true;
                    entry = history.images.get(imageId);
                    if (!entry) break;
                } else {
                    break;
                }
            }

            entry = history.images.get(imageId);
            if (!entry) {
                continue;
            }

            entry.attempts.forEach(attempt => {
                if (!Array.isArray(attempt.progressEvents)) {
                    attempt.progressEvents = [];
                }
                const overflow = attempt.progressEvents.length - limits.maxProgressEvents;
                if (overflow > 0) {
                    attempt.progressEvents.splice(0, overflow);
                    mutated = true;
                }

                if (typeof attempt.rawStream === 'string' && attempt.rawStream.length > limits.maxStreamChars) {
                    attempt.rawStream = attempt.rawStream.slice(-limits.maxStreamChars);
                    mutated = true;
                }

                if (typeof attempt.payloadSnapshot === 'string' && attempt.payloadSnapshot.length > limits.maxPayloadChars) {
                    attempt.payloadSnapshot = attempt.payloadSnapshot.slice(0, limits.maxPayloadChars) + '...';
                    mutated = true;
                } else if (attempt.payloadSnapshot && typeof attempt.payloadSnapshot === 'object') {
                    try {
                        const serialized = JSON.stringify(attempt.payloadSnapshot);
                        if (serialized.length > limits.maxPayloadChars) {
                            attempt.payloadSnapshot = null;
                            mutated = true;
                        }
                    } catch {
                        attempt.payloadSnapshot = null;
                        mutated = true;
                    }
                }
            });

            this._recalculateHistoryCounters(entry);
        }

        if (mutated) {
            window.Logger.warn('[GVP][State] Multi-gen history trimmed to maintain storage budget', { context });
            this._scheduleMultiGenHistorySave();
        }
    }

    _normalizeRawStream(value) {
        if (typeof value !== 'string') {
            return value || null;
        }
        const limit = this.MULTI_GEN_LIMITS?.maxStreamChars || 8000;
        if (value.length > limit) {
            return value.slice(-limit);
        }
        return value;
    }

    _generateGuid(prefix = 'run') {
        try {
            if (window.crypto?.randomUUID) {
                return `${prefix}_${window.crypto.randomUUID()}`;
            }
        } catch (error) {
            window.Logger.warn('[GVP] crypto.randomUUID unavailable, falling back to Date.now()', error);
        }
        return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    }

    _nowIso() {
        return new Date().toISOString();
    }

    _dispatchMultiGenHistoryUpdate(detail) {
        try {
            const payload = { ...(detail || {}) };

            // Primary event consumed by UI
            window.dispatchEvent(new CustomEvent('gvp:multi-gen-history-update', {
                detail: payload
            }));

            // Legacy event name (kept for compatibility with any listeners)
            window.dispatchEvent(new CustomEvent('gvp:multi-gen-history-updated', {
                detail: { ...(detail || {}) }
            }));
        } catch (error) {
            window.Logger.error('[GVP] Failed to dispatch multi-gen history event', error);
        }
    }

    resetMultiGenHistoryState() {
        this.state.multiGenHistory = this._createEmptyMultiGenHistory();
        this._dispatchMultiGenHistoryUpdate({ reason: 'reset' });
        this._scheduleMultiGenHistorySave();
    }

    getMultiGenHistorySnapshot() {
        const snapshot = {
            images: {},
            order: Array.from(this.state.multiGenHistory.order),
            lastImageByAccount: {},
            activeAccountId: this.state.multiGenHistory.activeAccountId || null
        };

        this.state.multiGenHistory.images.forEach((entry, imageId) => {
            snapshot.images[imageId] = this._cloneHistoryEntry(entry);
        });

        this.state.multiGenHistory.lastImageByAccount.forEach((imageId, accountId) => {
            snapshot.lastImageByAccount[accountId] = imageId;
        });

        return snapshot;
    }

    hydrateMultiGenHistory(raw = {}) {
        const nextState = this._createEmptyMultiGenHistory();

        // Handle Map or Object for images
        let imagesEntries = [];
        if (raw?.images instanceof Map) {
            imagesEntries = Array.from(raw.images.entries());
        } else if (raw?.images && typeof raw.images === 'object') {
            imagesEntries = Object.entries(raw.images);
        }

        const order = Array.isArray(raw?.order) ? raw.order.filter(id => typeof id === 'string') : [];
        const lastImage = raw?.lastImageByAccount && typeof raw.lastImageByAccount === 'object'
            ? raw.lastImageByAccount
            : {};
        const activeAccountId = typeof raw?.activeAccountId === 'string' ? raw.activeAccountId : null;

        imagesEntries.forEach(([imageId, entry]) => {
            if (!imageId) return;
            const hydrated = this._hydrateHistoryEntry(entry);
            hydrated.imageId = hydrated.imageId || imageId;

            // Sanitize timestamp (clamp future dates to now)
            if (hydrated.timestamp && hydrated.timestamp > Date.now() + 60000) { // Allow 1 min drift
                window.Logger.warn(`[GVP StateManager] ⚠️ Clamping future timestamp for ${imageId}:`, hydrated.timestamp);
                hydrated.timestamp = Date.now();
            }

            // Backfill lastSuccessAt if missing but successful attempts exist
            if (!hydrated.lastSuccessAt && Array.isArray(hydrated.attempts)) {
                const success = hydrated.attempts.find(a => a.status === 'success');
                if (success) {
                    hydrated.lastSuccessAt = success.finishedAt || success.updatedAt || this._nowIso();
                }
            }

            nextState.images.set(imageId, hydrated);
        });

        order.forEach((imageId) => {
            if (typeof imageId === 'string' && nextState.images.has(imageId)) {
                nextState.order.push(imageId);
            }
        });

        Object.entries(lastImage).forEach(([accountId, imageId]) => {
            if (accountId && imageId) {
                nextState.lastImageByAccount.set(accountId, imageId);
            }
        });

        if (activeAccountId) {
            nextState.activeAccountId = activeAccountId;
        } else if (this.state.multiGenHistory?.activeAccountId) {
            nextState.activeAccountId = this.state.multiGenHistory.activeAccountId;
        }

        this.state.multiGenHistory = nextState;
        this._dispatchMultiGenHistoryUpdate({ reason: 'hydrate' });

        // Restore timeouts for pending attempts (after page refresh)
        this._restorePendingTimeouts();
        this._enforceMultiGenHistoryLimits('hydrate');
    }

    _cloneHistoryEntry(entry) {
        if (!entry) return null;
        return {
            accountId: entry.accountId,
            imageId: entry.imageId,
            thumbnailUrl: entry.thumbnailUrl,
            attempts: entry.attempts.map(attempt => ({ ...attempt, progressEvents: attempt.progressEvents.map(evt => ({ ...evt })) })),
            successCount: entry.successCount,
            failCount: entry.failCount,
            lastSuccessAt: entry.lastSuccessAt,
            lastModeratedAt: entry.lastModeratedAt,
            expanded: entry.expanded,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            originalPostId: entry.originalPostId || null
        };
    }

    _hydrateHistoryEntry(rawEntry = {}) {
        const entry = {
            accountId: rawEntry.accountId || 'unknown-account',
            imageId: rawEntry.imageId || '',
            thumbnailUrl: rawEntry.thumbnailUrl || '',
            attempts: Array.isArray(rawEntry.attempts)
                ? rawEntry.attempts.map(attempt => this._hydrateHistoryAttempt(attempt))
                : [],
            successCount: Number(rawEntry.successCount) || 0,
            failCount: Number(rawEntry.failCount) || 0,
            lastSuccessAt: rawEntry.lastSuccessAt || null,
            lastModeratedAt: rawEntry.lastModeratedAt || null,
            expanded: Boolean(rawEntry.expanded),
            createdAt: rawEntry.createdAt || this._nowIso(),
            updatedAt: rawEntry.updatedAt || this._nowIso(),
            originalPostId: rawEntry.originalPostId || null
        };

        if (!entry.attempts.some(attempt => attempt.expanded)) {
            if (entry.attempts.length) {
                entry.attempts[0].expanded = true;
            }
        }

        return entry;
    }

    _hydrateHistoryAttempt(rawAttempt = {}) {
        const attempt = {
            id: rawAttempt.id || this._generateGuid('attempt'),
            startedAt: rawAttempt.startedAt || this._nowIso(),
            finishedAt: rawAttempt.finishedAt || null,
            prompt: rawAttempt.prompt || null,
            status: rawAttempt.status || 'pending',
            moderated: Boolean(rawAttempt.moderated),
            moderationReason: rawAttempt.moderationReason || null,
            progressEvents: Array.isArray(rawAttempt.progressEvents)
                ? rawAttempt.progressEvents.map(evt => ({
                    progress: Number(evt.progress) || 0,
                    moderated: Boolean(evt.moderated),
                    timestamp: evt.timestamp || this._nowIso()
                }))
                : [],
            lastCleanProgress: rawAttempt.lastCleanProgress ?? null,
            moderatedAtProgress: rawAttempt.moderatedAtProgress ?? null,
            currentProgress: Number(rawAttempt.currentProgress) || 0,
            videoPrompt: rawAttempt.videoPrompt || null,
            videoId: rawAttempt.videoId || null,
            videoUrl: rawAttempt.videoUrl || null,
            upscaledVideoUrl: rawAttempt.upscaledVideoUrl || null,
            responseId: rawAttempt.responseId || null,
            expanded: rawAttempt.expanded === undefined ? false : Boolean(rawAttempt.expanded),
            finalMessage: rawAttempt.finalMessage || null,
            rawStream: rawAttempt.rawStream || null,
            payloadSnapshot: rawAttempt.payloadSnapshot || null,
            error: rawAttempt.error || null
        };

        return attempt;
    }

    setLastMultiGenImage(accountId, imageId) {
        if (!accountId || !imageId) {
            return;
        }
        const current = this.state.multiGenHistory.lastImageByAccount.get(accountId);
        if (current === imageId) {
            return;
        }
        this.state.multiGenHistory.lastImageByAccount.set(accountId, imageId);
        this._scheduleMultiGenHistorySave();
    }

    getLastMultiGenImage(accountId) {
        return this.state.multiGenHistory.lastImageByAccount.get(accountId) || null;
    }

    clearLastMultiGenImage(accountId) {
        if (!accountId) return;
        if (this.state.multiGenHistory.lastImageByAccount.delete(accountId)) {
            this._scheduleMultiGenHistorySave();
        }
    }

    armMultiGenRequest(requestId, meta = {}) {
        if (!requestId) return;
        this.state.multiGenHistory.armedRequests.set(requestId, {
            ...meta,
            armedAt: this._nowIso()
        });
    }

    getArmedMultiGenRequest(requestId) {
        if (!requestId) return null;
        return this.state.multiGenHistory.armedRequests.get(requestId) || null;
    }

    disarmMultiGenRequest(requestId) {
        if (!requestId) return;
        this.state.multiGenHistory.armedRequests.delete(requestId);
    }

    ensureMultiGenImageEntry(accountId, imageId, thumbnailUrl = '', originalPostId = null) {
        if (!imageId) {
            return null;
        }

        const history = this.state.multiGenHistory;
        let entry = history.images.get(imageId);
        const now = this._nowIso();
        let created = false;
        let mutated = false;

        if (!entry) {
            entry = {
                accountId: accountId || 'unknown-account',
                imageId,
                thumbnailUrl: thumbnailUrl || '',
                attempts: [],
                successCount: 0,
                failCount: 0,
                lastSuccessAt: null,
                lastModeratedAt: null,
                expanded: false,
                createdAt: now,
                updatedAt: now,
                originalPostId: originalPostId || null
            };
            history.images.set(imageId, entry);
            history.order = history.order.filter(id => id !== imageId);
            history.order.unshift(imageId);
            created = true;
            mutated = true;
        } else {
            if (accountId && entry.accountId !== accountId) {
                entry.accountId = accountId;
                mutated = true;
            }
            if (thumbnailUrl && !entry.thumbnailUrl) {
                entry.thumbnailUrl = thumbnailUrl;
                mutated = true;
            }
            if (originalPostId && !entry.originalPostId) {
                entry.originalPostId = originalPostId;
                mutated = true;
            }
            if (mutated) {
                entry.updatedAt = now;
            }
        }

        if (created) {
            this._dispatchMultiGenHistoryUpdate({ type: 'image-created', imageId });
        }

        if (mutated) {
            this._scheduleMultiGenHistorySave();
        }
        this._enforceMultiGenHistoryLimits('ensure-entry');
        return entry;
    }

    getMultiGenHistoryEntry(imageId, { clone = true } = {}) {
        if (!imageId) return null;
        const entry = this.state.multiGenHistory.images.get(imageId);
        if (!entry) return null;
        return clone ? this._cloneHistoryEntry(entry) : entry;
    }

    getMultiGenHistoryEntries(options = {}) {
        const accountId = options.accountId || this.getActiveMultiGenAccount();

        // VIDEO-CENTRIC SORTING (v7)
        // Flatten all attempts into a single list of "virtual" entries
        return this.getAllVideos(accountId);
    }

    /**
     * Get all videos flattened and sorted by timestamp (Video-Centric View)
     * @param {string} accountId 
     */
    getAllVideos(accountId) {
        // Use multiGenHistory.images which is now populated from Unified Store via getMultiGenHistory
        const allImages = Array.from(this.state.multiGenHistory.images.values());
        const flattenedEntries = [];

        for (const imageEntry of allImages) {
            // Filter by account if specified
            if (accountId && imageEntry.accountId !== accountId) {
                continue;
            }

            // If no attempts, skip
            if (!imageEntry.attempts || imageEntry.attempts.length === 0) {
                continue;
            }

            // Create a virtual entry for EACH attempt
            for (const attempt of imageEntry.attempts) {
                // Create a shallow copy of the image entry but with ONLY this attempt
                const videoEntry = {
                    ...imageEntry,
                    // Use the attempt's ID as the virtual entry ID to ensure uniqueness in UI keys
                    // But keep imageId for reference
                    virtualId: `${imageEntry.imageId}_${attempt.id}`,
                    attempts: [attempt], // Single attempt

                    // Use attempt timestamp for sorting
                    timestamp: attempt.timestamp || attempt.finishedAt || attempt.startedAt || imageEntry.timestamp,
                    updatedAt: attempt.timestamp || attempt.finishedAt || attempt.startedAt || imageEntry.updatedAt,

                    // CRITICAL: Override image-level stats with attempt-level stats for correct sorting
                    lastSuccessAt: attempt.status === 'success' ? (attempt.finishedAt || attempt.timestamp) : null,
                    createdAt: attempt.startedAt || attempt.timestamp || imageEntry.createdAt,
                    lastModeratedAt: attempt.status === 'moderated' ? (attempt.finishedAt || attempt.timestamp) : null
                };
                flattenedEntries.push(videoEntry);
            }
        }

        // Sort by timestamp descending (Newest First)
        flattenedEntries.sort((a, b) => {
            const timeA = new Date(a.timestamp || 0).getTime();
            const timeB = new Date(b.timestamp || 0).getTime();
            return timeB - timeA;
        });

        return flattenedEntries;
    }

    // Helper to get timestamp
    getMultiGenHistoryEntries_getTimestamp(entry) {
        return entry.timestamp || entry.updatedAt || entry.createdAt || 0;
    }

    getActiveMultiGenAccount() {
        return this.state.multiGenHistory.activeAccountId || null;
    }

    // ============================================================
    // Gallery Bulk Sync Tracking (persisted to chrome.storage)
    // ============================================================

    /**
     * Check if gallery bulk sync has been completed for an account
     * @param {string} accountId - The account ID to check
     * @returns {boolean} True if sync is complete
     */
    isAccountSyncComplete(accountId) {
        if (!accountId) return false;
        return this._accountSyncComplete.has(accountId);
    }

    /**
     * Mark gallery bulk sync as complete for an account
     * Stores timestamp and counts for debugging
     * @param {string} accountId - The account ID to mark
     * @param {number} imageCount - Number of images synced
     * @param {number} videoCount - Number of videos synced (optional)
     */
    async markAccountSyncComplete(accountId, imageCount = 0, videoCount = 0) {
        if (!accountId) return;

        const syncData = {
            timestamp: Date.now(),
            imageCount,
            videoCount
        };

        this._accountSyncComplete.set(accountId, syncData);

        // Persist to chrome.storage
        try {
            const key = `gvp-bulk-sync-${accountId}`;
            await chrome.storage.local.set({ [key]: syncData });
            window.Logger.info('StateManager', `✅ Bulk sync complete for ${accountId.slice(0, 8)}... (${imageCount} images, ${videoCount} videos)`);
        } catch (err) {
            window.Logger.error('StateManager', 'Failed to persist sync status', err);
        }
    }

    /**
     * Load sync status from chrome.storage AND check IndexedDB for existing data
     * @param {string} accountId - The account ID to check
     * @returns {boolean} True if already synced
     */
    async loadAccountSyncStatus(accountId) {
        if (!accountId) return false;

        try {
            // Check chrome.storage for existing sync data
            const key = `gvp-bulk-sync-${accountId}`;
            const result = await chrome.storage.local.get(key);
            const syncData = result[key];

            if (syncData && typeof syncData === 'object' && syncData.timestamp) {
                this._accountSyncComplete.set(accountId, syncData);
                const ageMs = Date.now() - syncData.timestamp;
                const ageStr = ageMs < 3600000 ? `${Math.round(ageMs / 60000)}m` :
                    ageMs < 86400000 ? `${Math.round(ageMs / 3600000)}h` :
                        `${Math.round(ageMs / 86400000)}d`;
                window.Logger.info('StateManager', `✅ Restored sync: ${syncData.imageCount} images, ${syncData.videoCount} videos (${ageStr} ago)`);
                return true;
            }

            // Legacy: handle old boolean flag
            if (syncData === true) {
                this._accountSyncComplete.set(accountId, { timestamp: Date.now(), imageCount: 0, videoCount: 0 });
                window.Logger.info('StateManager', '✅ Restored sync status (legacy flag)');
                return true;
            }

            // Fallback: check if we already have data in IndexedDB
            if (this.indexedDBManager?.initialized) {
                const entries = await this.indexedDBManager.getAllUnifiedEntries(accountId, 0); // Get all to count
                if (entries && entries.length > 0) {
                    const videoCount = entries.reduce((sum, e) => sum + (e.attempts?.length || 0), 0);
                    const syncData = { timestamp: Date.now(), imageCount: entries.length, videoCount };
                    this._accountSyncComplete.set(accountId, syncData);
                    await chrome.storage.local.set({ [key]: syncData });
                    window.Logger.info('StateManager', `✅ Found existing data: ${entries.length} images, ${videoCount} videos - marked synced`);
                    return true;
                }
            }
        } catch (err) {
            window.Logger.error('StateManager', 'Failed to load sync status', err);
        }
        return false;
    }

    /**
     * Reset gallery sync status for an account (used for manual refresh)
     * @param {string} accountId - The account ID to reset
     */
    async resetAccountSync(accountId) {
        if (!accountId) return;
        this._accountSyncComplete.delete(accountId);

        try {
            const key = `gvp-bulk-sync-${accountId}`;
            await chrome.storage.local.remove(key);
            window.Logger.info('StateManager', `🔄 Gallery sync reset for account ${accountId.slice(0, 8)}...`);
        } catch (err) {
            window.Logger.error('StateManager', 'Failed to reset sync status', err);
        }
    }

    setActiveMultiGenAccount(accountId) {
        const normalized = typeof accountId === 'string' ? accountId.trim() : null;

        if (!normalized) {
            const hadActive = !!this.state.multiGenHistory.activeAccountId;
            if (!hadActive) {
                return false;
            }

            // Clear all timeouts when clearing account
            this._generationTimeouts.forEach((data, attemptId) => {
                this._clearGenerationTimeout(attemptId);
            });

            this.state.multiGenHistory.activeAccountId = null;
            this.state.multiGenHistory.images.clear();
            this.state.multiGenHistory.order = [];
            this.state.multiGenHistory.lastImageByAccount.clear();
            this.state.multiGenHistory.armedRequests.clear();
            window.Logger.info('[GVP][State] Active account cleared');
            this._dispatchMultiGenHistoryUpdate({ type: 'account-changed', accountId: null });
            this._scheduleMultiGenHistorySave();
            return true;
        }

        if (this.state.multiGenHistory.activeAccountId === normalized) {
            return false;
        }

        // Clear timeouts for attempts that will be removed
        this.state.multiGenHistory.images.forEach((entry, imageId) => {
            if (!entry || entry.accountId !== normalized) {
                // Clear timeouts for all attempts in this image entry
                entry.attempts.forEach(attempt => {
                    this._clearGenerationTimeout(attempt.id);
                });
            }
        });

        this.state.multiGenHistory.activeAccountId = normalized;
        this.state.activeAccountId = normalized;

        // ✅ NEW: Persist active account ID to chrome.storage.local
        chrome.storage.local.set({ 'gvp-active-account': normalized }, () => {
            // window.Logger.debug('StateManager', 'Saved active account ID to storage:', normalized);
        });

        // Remove entries belonging to other accounts
        const keptOrder = [];
        this.state.multiGenHistory.images.forEach((entry, imageId) => {
            if (!entry || entry.accountId !== normalized) {
                this.state.multiGenHistory.images.delete(imageId);
            } else {
                keptOrder.push(imageId);
            }
        });
        this.state.multiGenHistory.order = keptOrder;

        // Reset auxiliary tracking to the active account
        this.state.multiGenHistory.lastImageByAccount.clear();
        this.state.multiGenHistory.armedRequests.clear();

        // ✅ NEW: Clear and reload gallery data for new account
        window.Logger.info('[GVP][State] Clearing gallery data for account switch');
        this.state.galleryData = {
            posts: [],
            videoIndex: new Map(),
            imageIndex: new Map(),
            lastUpdate: null,
            source: null
        };

        // ✅ NEW v6: Clear unified history for account switch
        this.state.unifiedHistory = [];

        // Load gallery data for new account from IndexedDB
        if (this.indexedDBManager) {
            this.loadGalleryDataFromIndexedDB(normalized)
                .then((loaded) => {
                    if (loaded) {
                        window.Logger.info('[GVP][State] ✅ Gallery data loaded for new account');
                        this._dispatchGalleryDataUpdate({
                            reason: 'account-switch',
                            accountId: normalized
                        });
                    } else {
                        window.Logger.info('[GVP][State] No gallery data found for new account');
                    }
                })
                .catch(error => {
                    window.Logger.error('[GVP][State] Failed to load gallery data for new account:', error);
                });

            // ✅ NEW v6: Load unified history for new account
            this.loadUnifiedHistory(normalized)
                .then((loaded) => {
                    if (loaded) {
                        window.Logger.info('[GVP Unified] ✅ Loaded unified history for account switch');
                    } else {
                        window.Logger.info('[GVP Unified] No unified history found for new account');
                    }
                })
                .catch(error => {
                    window.Logger.error('[GVP Unified] Failed to load unified history for new account:', error);
                });
        }

        window.Logger.info('[GVP][State] Active account changed', normalized);
        this._dispatchMultiGenHistoryUpdate({ type: 'account-changed', accountId: normalized });
        this._scheduleMultiGenHistorySave();
        return true;
    }

    createMultiGenAttempt(accountId, imageId, options = {}) {
        const entry = this.ensureMultiGenImageEntry(accountId, imageId, options.thumbnailUrl, options.originalPostId);
        if (!entry) {
            return null;
        }

        const now = this._nowIso();
        let payloadSnapshot = options.payloadSnapshot ?? null;
        if (payloadSnapshot && typeof payloadSnapshot === 'object') {
            try {
                payloadSnapshot = JSON.stringify(payloadSnapshot);
            } catch {
                payloadSnapshot = null;
            }
        }
        if (typeof payloadSnapshot === 'string' && payloadSnapshot.length > this.MULTI_GEN_LIMITS.maxPayloadChars) {
            payloadSnapshot = payloadSnapshot.slice(0, this.MULTI_GEN_LIMITS.maxPayloadChars) + '...';
        }
        const attempt = {
            id: this._generateGuid('attempt'),
            startedAt: now,
            finishedAt: null,
            prompt: options.prompt || null,
            status: 'pending',
            moderated: false,
            moderationReason: null,
            progressEvents: [],
            lastCleanProgress: null,
            moderatedAtProgress: null,
            currentProgress: 0,
            videoPrompt: null,
            videoId: null,
            videoUrl: null,
            responseId: options.responseId || null,
            expanded: entry.attempts.length === 0,
            finalMessage: null,
            rawStream: null,
            error: null,
            payloadSnapshot
        };

        entry.attempts.unshift(attempt);
        entry.updatedAt = now;

        // Start 30-second timeout for this pending generation
        window.Logger.info('[GVP] About to start timeout for attempt', attempt.id, 'imageId:', imageId);
        try {
            this._startGenerationTimeout(attempt.id, imageId);
            window.Logger.info('[GVP] Timeout start succeeded for attempt', attempt.id);
        } catch (err) {
            window.Logger.error('[GVP] ❌ Failed to start timeout', err);
        }

        this._dispatchMultiGenHistoryUpdate({ type: 'attempt-created', imageId, attemptId: attempt.id });
        this._scheduleMultiGenHistorySave();
        this._enforceMultiGenHistoryLimits('attempt-created');
        return attempt;
    }

    updateMultiGenAttempt(imageId, attemptId, updates = {}) {
        const entry = this.state.multiGenHistory.images.get(imageId);
        if (!entry) return null;
        const attempt = entry.attempts.find(item => item.id === attemptId);
        if (!attempt) return null;

        Object.assign(attempt, updates);
        entry.updatedAt = this._nowIso();
        this._dispatchMultiGenHistoryUpdate({ type: 'attempt-updated', imageId, attemptId });

        // OPTIMIZATION: Use incremental save for single entry updates
        this._persistMultiGenEntry(entry);

        return attempt;
    }

    appendMultiGenProgress(imageId, attemptId, progress, meta = {}) {
        const entry = this.state.multiGenHistory.images.get(imageId);
        if (!entry) return null;
        const attempt = entry.attempts.find(item => item.id === attemptId);
        if (!attempt) return null;

        const value = Number(progress);
        const progressEntry = {
            progress: Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0,
            moderated: meta.moderated === true,
            timestamp: meta.timestamp || this._nowIso()
        };

        attempt.progressEvents.push(progressEntry);
        // window.Logger.info('[GVP][State] Multi-Gen progress appended', { ... }); 
        attempt.currentProgress = progressEntry.progress;

        // Reset the 30-second timeout since we received progress
        this._startGenerationTimeout(attemptId, imageId);
        if (progressEntry.moderated) {
            attempt.moderated = true;
            const lastClean = Number.isFinite(attempt.lastCleanProgress) ? attempt.lastCleanProgress : null;
            const preModerationProgress = Number.isFinite(lastClean) ? lastClean : progressEntry.progress;
            attempt.moderatedAtProgress = preModerationProgress;
            attempt.currentProgress = preModerationProgress;
            attempt.moderationReason = meta.moderationReason || attempt.moderationReason;
            this._syncModeratedProgressToUnified(imageId, attemptId, preModerationProgress, {
                moderationReason: meta.moderationReason,
                videoId: meta.videoId
            }).catch((err) => {
                window.Logger.warn('StateManager', 'Failed to sync moderated progress to unified store', err);
            });
        } else {
            attempt.lastCleanProgress = progressEntry.progress;
        }

        if (meta.videoUrl) {
            attempt.videoUrl = meta.videoUrl;
        }
        if (meta.videoId) {
            attempt.videoId = meta.videoId;
        }
        if (meta.videoPrompt !== undefined) {
            attempt.videoPrompt = meta.videoPrompt;
        }
        if (meta.finalMessage !== undefined) {
            attempt.finalMessage = meta.finalMessage;
        }

        entry.updatedAt = this._nowIso();
        this._dispatchMultiGenHistoryUpdate({ type: 'progress', imageId, attemptId, progress: progressEntry.progress });

        // OPTIMIZATION: Throttled Writes
        // Only persist on significant events: Start (0%), Completion (100%), Moderation, or Error
        const shouldPersist =
            progressEntry.progress === 0 ||
            progressEntry.progress >= 100 ||
            progressEntry.moderated ||
            meta.error;

        if (shouldPersist) {
            this._persistMultiGenEntry(entry);
        }

        this._enforceMultiGenHistoryLimits('progress');
        return progressEntry;
    }

    finalizeMultiGenAttempt(imageId, attemptId, meta = {}) {
        const entry = this.state.multiGenHistory.images.get(imageId);
        if (!entry) return null;
        const attemptIndex = entry.attempts.findIndex(item => item.id === attemptId);
        if (attemptIndex === -1) return null;
        const attempt = entry.attempts[attemptIndex];

        if (meta.rawStream !== undefined) {
            attempt.rawStream = this._normalizeRawStream(meta.rawStream);
        }
        if (meta.videoUrl) {
            attempt.videoUrl = meta.videoUrl;
        }
        if (meta.videoId) {
            attempt.videoId = meta.videoId;
        }
        if (meta.videoPrompt !== undefined) {
            attempt.videoPrompt = meta.videoPrompt;
        }
        if (meta.finalMessage !== undefined) {
            attempt.finalMessage = meta.finalMessage;
        }
        if (meta.prompt !== undefined) {
            attempt.prompt = meta.prompt;
        }
        if (meta.error) {
            attempt.error = meta.error;
        }

        if (attempt.finishedAt) {
            return attempt;
        }

        // Clear timeout since attempt is being finalized
        this._clearGenerationTimeout(attemptId);

        attempt.finishedAt = this._nowIso();

        const lastProgress = attempt.progressEvents.length
            ? attempt.progressEvents[attempt.progressEvents.length - 1].progress
            : attempt.currentProgress || 0;

        if (meta.moderated === true || attempt.moderated) {
            attempt.moderated = true;
            if (attempt.moderatedAtProgress === null || attempt.moderatedAtProgress === undefined) {
                const lastClean = Number.isFinite(attempt.lastCleanProgress) ? attempt.lastCleanProgress : null;
                const fallbackProgress = Number.isFinite(lastProgress) ? lastProgress : null;
                if (Number.isFinite(lastClean)) {
                    attempt.moderatedAtProgress = lastClean;
                } else if (Number.isFinite(fallbackProgress)) {
                    attempt.moderatedAtProgress = fallbackProgress;
                }
            }
            if (Number.isFinite(attempt.moderatedAtProgress)) {
                attempt.currentProgress = attempt.moderatedAtProgress;
            }
            attempt.status = 'moderated';
            entry.lastModeratedAt = attempt.finishedAt;
            this._syncModeratedProgressToUnified(imageId, attemptId, attempt.currentProgress, {
                moderationReason: attempt.moderationReason,
                videoId: attempt.videoId
            }).catch((err) => {
                window.Logger.warn('StateManager', 'Failed to sync moderated finalization to unified store', err);
            });
        } else if (meta.status === 'failed') {
            attempt.status = 'failed';
        } else if (meta.status === 'success' || lastProgress === 100) {
            attempt.status = 'success';
            entry.lastSuccessAt = attempt.finishedAt;
        } else {
            attempt.status = 'failed';
        }

        this._recalculateHistoryCounters(entry);
        entry.updatedAt = attempt.finishedAt;
        this._dispatchMultiGenHistoryUpdate({ type: 'attempt-finalized', imageId, attemptId, status: attempt.status });
        this._scheduleMultiGenHistorySave();
        this._enforceMultiGenHistoryLimits('attempt-finalized');
        return attempt;
    }

    deleteMultiGenAttempt(imageId, attemptId) {
        const entry = this.state.multiGenHistory.images.get(imageId);
        if (!entry) return false;
        const index = entry.attempts.findIndex(item => item.id === attemptId);
        if (index === -1) return false;

        // Clear timeout if this attempt had one
        this._clearGenerationTimeout(attemptId);

        entry.attempts.splice(index, 1);
        this._recalculateHistoryCounters(entry);

        if (!entry.attempts.length) {
            this.state.multiGenHistory.images.delete(imageId);
            this.state.multiGenHistory.order = this.state.multiGenHistory.order.filter(id => id !== imageId);
            this.state.multiGenHistory.lastImageByAccount.forEach((value, key) => {
                if (value === imageId) {
                    this.state.multiGenHistory.lastImageByAccount.delete(key);
                }
            });
            this._dispatchMultiGenHistoryUpdate({ type: 'image-removed', imageId });
        } else {
            entry.attempts[0].expanded = true;
            entry.updatedAt = this._nowIso();
            this._dispatchMultiGenHistoryUpdate({ type: 'attempt-deleted', imageId, attemptId });
        }
        this._scheduleMultiGenHistorySave();
        return true;
    }

    deleteMultiGenImage(imageId) {
        const entry = this.state.multiGenHistory.images.get(imageId);
        if (!entry) return false;

        // Clear all timeouts for this image's attempts
        entry.attempts.forEach(attempt => {
            this._clearGenerationTimeout(attempt.id);
        });

        // Remove from maps and order
        this.state.multiGenHistory.images.delete(imageId);
        this.state.multiGenHistory.lastImageByAccount.forEach((value, key) => {
            if (value === imageId) {
                this.state.multiGenHistory.lastImageByAccount.delete(key);
            }
        });
        this.state.multiGenHistory.order = this.state.multiGenHistory.order.filter(id => id !== imageId);

        this._dispatchMultiGenHistoryUpdate({ type: 'image-removed', imageId });
        this._scheduleMultiGenHistorySave();
        return true;
    }

    clearMultiGenHistory() {
        this.resetMultiGenHistoryState();
        if (this._storageInitialized) {
            this.storageManager.clearMultiGenHistory().catch((error) => {
                window.Logger.error('[GVP] Failed to clear multi-gen history storage', error);
            });
        }
        this._scheduleMultiGenHistorySave();
    }

    /**
     * Start timeout for a pending generation attempt.
     * If no progress update is received within the timeout duration, the attempt will be deleted.
     * @param {string} attemptId - The attempt ID
     * @param {string} imageId - The image ID
     * @param {number} duration - Timeout duration in milliseconds (default: 30000)
     */
    _startGenerationTimeout(attemptId, imageId, duration = 30000) {
        // Clear existing timeout if any
        this._clearGenerationTimeout(attemptId);

        const timeoutId = setTimeout(() => {
            window.Logger.info('[GVP] Generation timeout reached', { attemptId, imageId, duration: duration + 'ms' });
            this._handleGenerationTimeout(attemptId, imageId);
        }, duration);

        this._generationTimeouts.set(attemptId, { timeoutId, imageId });
        window.Logger.info('[GVP] Started timeout for attempt', attemptId, 'duration:', Math.round(duration / 1000) + 's');
    }

    /**
     * Clear the timeout for a specific attempt.
     * Called when attempt receives progress update or is finalized.
     */
    _clearGenerationTimeout(attemptId) {
        const timeoutData = this._generationTimeouts.get(attemptId);
        if (timeoutData) {
            clearTimeout(timeoutData.timeoutId);
            this._generationTimeouts.delete(attemptId);
            window.Logger.info('[GVP] Cleared timeout for attempt', attemptId);
        }
    }

    /**
     * Handle timeout expiration - delete the stalled attempt.
     * Stores deleted attempt data for undo functionality.
     */
    _handleGenerationTimeout(attemptId, imageId) {
        this._generationTimeouts.delete(attemptId);

        const entry = this.state.multiGenHistory.images.get(imageId);
        if (!entry) {
            window.Logger.warn('[GVP] Cannot timeout - image entry not found', imageId);
            return;
        }

        const attemptIndex = entry.attempts.findIndex(item => item.id === attemptId);
        if (attemptIndex === -1) {
            window.Logger.warn('[GVP] Cannot timeout - attempt not found', attemptId);
            return;
        }

        const attempt = entry.attempts[attemptIndex];

        // Only timeout if still pending
        if (attempt.status !== 'pending') {
            window.Logger.info('[GVP] Attempt no longer pending, skipping timeout', { attemptId, status: attempt.status });
            return;
        }

        // Store for undo (in case user wants to restore it)
        const deletedData = {
            imageId,
            attempt: { ...attempt },
            deletedAt: this._nowIso()
        };

        // Delete the attempt
        const deleted = this.deleteMultiGenAttempt(imageId, attempt.id);

        if (deleted) {
            window.Logger.info('[GVP] Deleted stalled generation attempt', attemptId);

            // Dispatch custom event with undo data
            window.dispatchEvent(new CustomEvent('gvp:generation-timeout', {
                detail: {
                    attemptId,
                    imageId,
                    deletedData,
                    message: 'Removed stalled generation after 30s timeout'
                }
            }));
        }
    }

    /**
     * Restore timeouts for pending attempts after page refresh.
     * Called during hydration to handle attempts that were pending when page was refreshed.
     */
    _restorePendingTimeouts() {
        const now = Date.now();
        const images = this.state.multiGenHistory.images;

        window.Logger.info('[GVP] Checking for pending attempts to restore timeouts...');

        images.forEach((entry, imageId) => {
            entry.attempts.forEach(attempt => {
                if (attempt.status === 'pending') {
                    const startTime = new Date(attempt.startedAt).getTime();
                    const age = now - startTime;

                    if (age > 30000) {
                        // Already stale (older than 30s) - delete immediately
                        window.Logger.info('[GVP] Deleting stale attempt from before page refresh', {
                            attemptId: attempt.id,
                            age: Math.round(age / 1000) + 's'
                        });
                        this.deleteMultiGenAttempt(imageId, attempt.id);
                    } else {
                        // Still fresh - restart timeout for remaining time
                        const remaining = 30000 - age;
                        window.Logger.info('[GVP] Restarting timeout for pending attempt', {
                            attemptId: attempt.id,
                            age: Math.round(age / 1000) + 's',
                            remaining: Math.round(remaining / 1000) + 's'
                        });
                        this._startGenerationTimeout(attempt.id, imageId, remaining);
                    }
                }
            });
        });
    }

    /**
     * Restore a deleted attempt (for undo functionality).
     */
    restoreMultiGenAttempt(imageId, attemptData) {
        const entry = this.state.multiGenHistory.images.get(imageId);
        if (!entry) {
            window.Logger.error('[GVP] Cannot restore - image entry not found', imageId);
            return false;
        }

        // Add the attempt back to the beginning
        entry.attempts.unshift(attemptData);
        entry.updatedAt = this._nowIso();

        this._recalculateHistoryCounters(entry);
        this._dispatchMultiGenHistoryUpdate({ type: 'attempt-restored', imageId, attemptId: attemptData.id });
        this._scheduleMultiGenHistorySave();

        window.Logger.log('[GVP] Restored generation attempt', attemptData.id);
        return true;
    }

    _recalculateHistoryCounters(entry) {
        let success = 0;
        let fail = 0;
        entry.attempts.forEach((attempt) => {
            if (attempt.status === 'success') success += 1;
            else if (attempt.status === 'moderated' || attempt.status === 'failed') fail += 1;
        });
        entry.successCount = success;
        entry.failCount = fail;
    }

    setMultiGenImageExpanded(imageId, expanded) {
        const entry = this.state.multiGenHistory.images.get(imageId);
        if (!entry) {
            return;
        }
        const next = !!expanded;
        if (entry.expanded === next) {
            return;
        }
        entry.expanded = next;
        this._dispatchMultiGenHistoryUpdate({ type: 'image-expanded', imageId, expanded: next });
        this._scheduleMultiGenHistorySave();
    }

    _scheduleMultiGenHistorySave(delay = 150) {
        if (!this._storageInitialized) {
            return;
        }

        if (typeof window === 'undefined' || typeof window.setTimeout !== 'function') {
            return;
        }

        if (this._multiGenHistorySaveTimer) {
            window.clearTimeout(this._multiGenHistorySaveTimer);
        }

        this._multiGenHistorySaveTimer = window.setTimeout(() => {
            this._multiGenHistorySaveTimer = null;
            this._persistMultiGenHistory().catch((error) => {
                window.Logger.error('Failed to persist multi-gen history', error);
            });
        }, Math.max(0, delay));
    }

    /**
     * Persist a single multi-gen entry immediately (Incremental)
     * @param {Object} entry 
     */
    async _persistMultiGenEntry(entry) {
        if (!this._storageInitialized || !entry) return;

        try {
            await this.storageManager.saveMultiGenEntry(entry);
        } catch (error) {
            window.Logger.error('Failed to persist multi-gen entry', error);
        }
    }

    async _persistMultiGenHistory() {
        if (!this._storageInitialized) {
            return;
        }

        // V7 UNIFIED STORAGE OPTIMIZATION:
        // We do NOT want to save the entire history snapshot anymore.
        // Persistence is now handled granularly via saveUnifiedEntry / upsertMultiGenEntry.
        // Saving the whole snapshot causes massive redundant writes and overwrites flags like dataSyncComplete.

        // console.log('[GVP StateManager] ⏭️ _persistMultiGenHistory skipped (Unified Storage handles persistence incrementally)');
        return;

        // LEGACY CODE BELOW DISABLED:
        /*
        const snapshot = this.getMultiGenHistorySnapshot();
        await this.storageManager.saveMultiGenHistory(snapshot);
        */
    }

    /**
     * Sync moderated progress into unified IndexedDB storage
     * (single source of truth for video data)
     * @param {string} imageId 
     * @param {string} attemptId 
     * @param {number} progressValue 
     * @param {Object} meta 
     */
    async _syncModeratedProgressToUnified(imageId, attemptId, progressValue, meta = {}) {
        if (!this.indexedDBManager?.initialized || !imageId) {
            return;
        }

        const clamped = Number.isFinite(progressValue)
            ? Math.max(0, Math.min(100, progressValue))
            : 0;

        try {
            const unifiedEntry = await this.indexedDBManager.getUnifiedEntry(imageId);
            if (!unifiedEntry || !Array.isArray(unifiedEntry.attempts)) {
                return;
            }

            const attempt = unifiedEntry.attempts.find(a =>
                a.id === attemptId ||
                a.videoId === attemptId ||
                a.assetId === attemptId
            );

            if (!attempt) {
                return;
            }

            attempt.progress = clamped;
            attempt.lastProgress = clamped;
            attempt.moderatedAtProgress = clamped;
            attempt.moderated = true;
            attempt.status = 'moderated';
            attempt.updatedAt = new Date().toISOString();
            attempt.finishedAt = attempt.finishedAt || attempt.updatedAt;
            if (meta?.moderationReason) {
                attempt.moderationReason = attempt.moderationReason || meta.moderationReason;
            }

            unifiedEntry.updatedAt = attempt.updatedAt;
            await this.indexedDBManager.saveUnifiedEntry(unifiedEntry);
        } catch (error) {
            window.Logger.warn('StateManager', 'Failed to sync moderated progress to unified storage:', error);
        }
    }

    getCustomDropdownOptions() {
        return { ...(this.state.settings.customDropdownOptions || {}) };
    }

    async setCustomDropdownValue(fieldKey, value) {
        if (!fieldKey) {
            return;
        }
        const trimmed = typeof value === 'string' ? value.trim() : '';
        if (!trimmed) {
            return;
        }
        await this.setCustomDropdownValues({ [fieldKey]: [trimmed] });
    }

    async setCustomDropdownValues(valueMap = {}) {
        const current = this._normalizeCustomDropdownOptions(this.state.settings.customDropdownOptions);
        const incoming = this._normalizeCustomDropdownOptions(valueMap);
        const merged = this._mergeCustomDropdownOptions(current, incoming);

        if (!this._haveCustomDropdownOptionsChanged(current, merged)) {
            return;
        }

        this.state.settings.customDropdownOptions = merged;

        try {
            await this._persistCustomDropdownOptions(merged);
        } catch (error) {
            if (error?.message?.includes('context')) {
                window.Logger.warn('StateManager', 'Extension context invalidated while saving custom dropdown options');
            } else {
                window.Logger.error('StateManager', 'Failed to persist custom dropdown options:', error);
            }
        }

        this.saveSettings();

        window.dispatchEvent(new CustomEvent('gvp:custom-dropdown-updated', {
            detail: { options: { ...merged } }
        }));
    }

    async clearCustomDropdownValues(keys = null) {
        const current = this._normalizeCustomDropdownOptions(this.state.settings.customDropdownOptions);
        const next = { ...current };

        if (Array.isArray(keys) && keys.length) {
            keys.forEach((key) => {
                if (typeof key === 'string') {
                    delete next[key];
                }
            });
        } else {
            Object.keys(next).forEach((key) => delete next[key]);
        }

        this.state.settings.customDropdownOptions = next;

        try {
            await this._persistCustomDropdownOptions(next);
        } catch (error) {
            if (error?.message?.includes('context')) {
                window.Logger.warn('StateManager', 'Extension context invalidated while clearing custom dropdown options');
            } else {
                window.Logger.error('StateManager', 'Failed to clear custom dropdown options:', error);
            }
        }

        this.saveSettings();

        window.dispatchEvent(new CustomEvent('gvp:custom-dropdown-updated', {
            detail: { options: { ...next } }
        }));
    }

    _normalizeCustomDropdownOptions(options = {}) {
        if (!options || typeof options !== 'object') {
            return {};
        }

        const normalized = {};

        Object.entries(options).forEach(([key, value]) => {
            if (!key || typeof key !== 'string') {
                return;
            }

            const values = Array.isArray(value) ? value : [value];
            const cleaned = values
                .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
                .filter(Boolean);

            if (!cleaned.length) {
                return;
            }

            const pruned = this._pruneIncrementalCustomDropdownValues(Array.from(new Set(cleaned)));
            if (pruned.length) {
                normalized[key] = pruned;
            }
        });

        return normalized;
    }

    _mergeCustomDropdownOptions(base = {}, incoming = {}) {
        const merged = { ...base };

        Object.entries(incoming || {}).forEach(([key, values]) => {
            if (!key || !Array.isArray(values)) {
                return;
            }

            const existing = Array.isArray(merged[key]) ? merged[key] : [];
            const combined = [...existing, ...values]
                .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
                .filter(Boolean);

            if (!combined.length) {
                delete merged[key];
                return;
            }

            const pruned = this._pruneIncrementalCustomDropdownValues(Array.from(new Set(combined)));
            if (pruned.length) {
                merged[key] = pruned;
            } else {
                delete merged[key];
            }
        });

        return merged;
    }

    _pruneIncrementalCustomDropdownValues(values = []) {
        if (!Array.isArray(values) || values.length < 3) {
            return Array.isArray(values) ? values : [];
        }

        const sanitized = values
            .filter((val) => typeof val === 'string')
            .map((val) => val.trim())
            .filter(Boolean);

        if (sanitized.length < 3) {
            return Array.from(new Set(sanitized));
        }

        const sorted = [...sanitized].sort((a, b) => a.length - b.length);
        const sequences = [];

        sorted.forEach((value) => {
            const lower = value.toLowerCase();
            let matched = false;

            for (const seq of sequences) {
                const last = seq[seq.length - 1];
                const lastLower = last.toLowerCase();
                if (lower.startsWith(lastLower) && lower.length === lastLower.length + 1) {
                    seq.push(value);
                    matched = true;
                    break;
                }
            }

            if (!matched) {
                sequences.push([value]);
            }
        });

        const removeSet = new Set();
        sequences.forEach((seq) => {
            if (seq.length >= 3) {
                for (let i = 0; i < seq.length - 1; i += 1) {
                    removeSet.add(seq[i].toLowerCase());
                }
            }
        });

        if (!removeSet.size) {
            return Array.from(new Set(sanitized));
        }

        const seen = new Set();
        const result = [];
        sanitized.forEach((value) => {
            const lower = value.toLowerCase();
            if (removeSet.has(lower)) {
                return;
            }
            if (!seen.has(lower)) {
                result.push(value);
                seen.add(lower);
            }
        });

        return result;
    }

    _haveCustomDropdownOptionsChanged(previous = {}, next = {}) {
        const prevKeys = Object.keys(previous);
        const nextKeys = Object.keys(next);

        if (prevKeys.length !== nextKeys.length) {
            return true;
        }

        for (const key of nextKeys) {
            const prevValues = Array.isArray(previous[key]) ? previous[key] : [];
            const nextValues = Array.isArray(next[key]) ? next[key] : [];

            if (prevValues.length !== nextValues.length) {
                return true;
            }

            const prevSet = new Set(prevValues);
            for (const value of nextValues) {
                if (!prevSet.has(value)) {
                    return true;
                }
            }
        }

        return false;
    }

    async _persistCustomDropdownOptions(options = {}) {
        if (!this.indexedDBManager) {
            window.Logger.warn('StateManager', 'IndexedDB not available, skipping dropdown options save');
            return;
        }

        try {
            // Save each category separately to IndexedDB
            const categories = Object.keys(options);
            for (const category of categories) {
                const values = options[category];
                if (Array.isArray(values) && values.length > 0) {
                    await this.indexedDBManager.saveCustomDropdownOptions(category, values);
                }
            }
        } catch (error) {
            window.Logger.error('StateManager', 'Failed to persist custom dropdown options to IndexedDB:', error);
            throw error;
        }
    }

    getState() {
        return this.state;
    }

    setState(updates) {
        Object.assign(this.state, updates);
    }

    /**
     * Update generation progress from DOM monitoring
     * @param {Object} progressData - { key, progress, context, timestamp }
     */
    updateGenerationProgress(progressData) {
        if (!progressData || !progressData.key) {
            window.Logger.warn('StateManager', 'Invalid progress data');
            return;
        }

        const { key, progress, context, timestamp } = progressData;

        // Store in progress tracking map
        this.state.generation.progressTracking.set(key, {
            progress,
            context,
            timestamp,
            lastUpdate: Date.now()
        });

        window.Logger.debug('StateManager', 'Progress updated:', {
            key,
            progress: `${progress}%`,
            contextType: context?.type
        });

        // Clean up completed entries after 5 minutes
        if (progress === 100) {
            setTimeout(() => {
                this.state.generation.progressTracking.delete(key);
            }, 300000);
        }
    }

    /**
     * Get current generation progress
     * @param {string} key - Generation key
     * @returns {Object|null} Progress data
     */
    getGenerationProgress(key) {
        return this.state.generation.progressTracking.get(key) || null;
    }

    /**
     * Get all active generation progress
     * @returns {Array} Array of progress data
     */
    getAllGenerationProgress() {
        const result = [];
        this.state.generation.progressTracking.forEach((data, key) => {
            result.push({ key, ...data });
        });
        return result;
    }

    /**
     * Update attempt progress from DOM monitoring
     * @param {string} imageId - Image ID
     * @param {number} progress - Progress percentage (0-100)
     */
    updateAttemptProgress(imageId, progress) {
        if (!imageId || !Number.isFinite(progress)) {
            return;
        }

        // Find the image entry
        const entry = this.state.multiGenHistory?.images?.get(imageId);
        if (!entry) {
            return;
        }

        // Find the active (pending) attempt
        const activeAttempt = entry.attempts.find(a => a.status === 'pending');
        if (!activeAttempt) {
            return;
        }

        // Update progress
        const clampedProgress = Math.max(0, Math.min(100, progress));
        activeAttempt.currentProgress = clampedProgress;

        // Add to progress events if significantly different
        if (!activeAttempt.progressEvents) {
            activeAttempt.progressEvents = [];
        }

        const lastEvent = activeAttempt.progressEvents[activeAttempt.progressEvents.length - 1];
        if (!lastEvent || Math.abs(lastEvent.progress - clampedProgress) >= 5) {
            activeAttempt.progressEvents.push({
                progress: clampedProgress,
                timestamp: Date.now()
            });
        }

        window.Logger.debug('StateManager', 'Updated attempt progress:', {
            imageId,
            attemptId: activeAttempt.id,
            progress: `${clampedProgress}%`
        });
    }

    _getEmptyPromptData() {
        return {
            shot: { motion_level: 'medium', camera_depth: 'medium shot', camera_view: 'eye level', camera_movement: '' },
            scene: { location: '', environment: '' },
            cinematography: { lighting: '', style: '', texture: '', depth_of_field: '' },
            visual_details: { objects: [], positioning: [], text_elements: [] },
            motion: '',
            audio: { music: '', ambient: '', sound_effect: '', mix_level: '' },
            dialogue: [],
            tags: []
        };
    }

    _normalizePromptDataStructure(data = {}) {
        const base = this._getEmptyPromptData();
        const clone = JSON.parse(JSON.stringify(data || {}));

        base.shot = { ...base.shot, ...(clone.shot || {}) };
        base.scene = { ...base.scene, ...(clone.scene || {}) };
        base.cinematography = { ...base.cinematography, ...(clone.cinematography || {}) };

        const visual = clone.visual_details || {};
        base.visual_details = {
            objects: Array.isArray(visual.objects) ? this._fixCorruptedObjects(visual.objects) : [],
            positioning: typeof visual.positioning === 'string' ? visual.positioning : '',
            text_elements: typeof visual.text_elements === 'string' ? visual.text_elements : ''
        };

        base.motion = typeof clone.motion === 'string' ? clone.motion : '';

        const audio = clone.audio || {};
        base.audio = {
            music: typeof audio.music === 'string' ? audio.music : '',
            ambient: typeof audio.ambient === 'string' ? audio.ambient : '',
            sound_effect: typeof audio.sound_effect === 'string' ? audio.sound_effect : '',
            mix_level: typeof audio.mix_level === 'string' ? audio.mix_level : ''
        };

        base.dialogue = Array.isArray(clone.dialogue)
            ? clone.dialogue.map(line => ({ ...(line || {}) }))
            : [];

        base.tags = Array.isArray(clone.tags)
            ? clone.tags.map(tag => (typeof tag === 'string' ? tag : '')).filter(Boolean)
            : [];

        return base;
    }

    _fixCorruptedObjects(objects) {
        // Detects and fixes character array corruption in objects
        // e.g., {"0":"L","1":"e","2":"f"} → "Lef"
        if (!Array.isArray(objects)) return [];

        return objects.map(item => {
            // If item is already a string, keep it
            if (typeof item === 'string') return item;

            // If item is an object with numeric keys (corrupted), reconstruct string
            if (item && typeof item === 'object') {
                const keys = Object.keys(item).sort((a, b) => Number(a) - Number(b));
                const isCorrupted = keys.length > 0 && keys.every(k => !isNaN(k));

                if (isCorrupted) {
                    // Reconstruct string from character array
                    const reconstructed = keys.map(k => item[k]).join('');
                    window.Logger.warn('StateManager', 'Fixed corrupted object:', { corrupted: item, fixed: reconstructed });
                    return reconstructed;
                }
            }

            // Fallback: convert to string or empty
            return String(item || '');
        }).filter(Boolean);
    }

    _normalizeJsonPresets(presets) {
        if (!Array.isArray(presets)) {
            return [];
        }
        return presets
            .filter(item => item && typeof item === 'object' && typeof item.name === 'string')
            .map(item => ({
                name: item.name.trim(),
                data: this._normalizePromptDataStructure(item.data),
                savedAt: item.savedAt || this._nowIso()
            }))
            .filter(item => item.name.length > 0)
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    _normalizeRawTemplates(templates) {
        if (!Array.isArray(templates)) return [];
        return templates.map(t => ({
            id: t.id || crypto.randomUUID(),
            name: t.name || 'Untitled Template',
            fieldPath: t.fieldPath || 'shot.motion_level',
            prefix: t.prefix || '',
            suffix: t.suffix || '',
            prefixOnly: !!t.prefixOnly,
            enabled: t.enabled !== false,
            applyToRaw: !!t.applyToRaw,
            dialogueTemplate: t.dialogueTemplate || {
                prefixLines: [],
                suffixLines: []
            }
        }));
    }

    /**
     * NEW v6: Scan DOM for Account ID in asset URLs
     * Fallback for when NetworkInterceptor misses non-fetch requests
     */
    scanForAccountId() {
        if (this.state.activeAccountId) return; // Already have it

        try {
            // Look for images or videos with /users/{UUID}/ pattern
            const assets = document.querySelectorAll('img[src*="/users/"], video[src*="/users/"]');

            // DEBUG: Log what we found
            if (assets.length > 0) {
                window.Logger.debug('StateManager', `🕵️ DOM Scan found ${assets.length} candidate assets. First:`, assets[0].src);
            }

            for (const asset of assets) {
                const src = asset.src || '';
                // Match /users/{UUID}/ pattern (standard Grok asset path)
                const match = src.match(/\/users\/([a-f0-9-]{36})\//i);
                if (match && match[1]) {
                    const accountId = match[1];
                    window.Logger.info('StateManager', `🕵️ DOM Scan found Account ID: ${accountId.substring(0, 12)}...`);

                    // ✅ Use central setter to trigger updates, persistence, and unified history load
                    this.setActiveMultiGenAccount(accountId);
                    return; // Found it, stop scanning
                }
            }
        } catch (e) {
            // Ignore DOM errors
        }
    }

    async _loadSettings() {
        // v1.47 FIXED: Return existing promise if load is already in progress
        if (this._settingsLoadPromise) {
            window.Logger.debug('StateManager', '⏳ _loadSettings already in progress, returning shared promise');
            return this._settingsLoadPromise;
        }

        this._settingsLoadPromise = new Promise((resolve, reject) => {
            window.Logger.info('StateManager', '🔄 Loading settings and IndexedDB data...');

            // Use Chrome storage for settings, IndexedDB for large data
            chrome.storage.local.get(['gvp-settings', 'gvp-custom-dropdown-values', 'gvp-active-account'], async (result) => {
                try {
                    const saved = result['gvp-settings'];
                    const savedAccountId = result['gvp-active-account'];

                    if (savedAccountId) {
                        window.Logger.info('StateManager', '🔄 Restoring active account ID from storage:', savedAccountId);
                        this.setActiveMultiGenAccount(savedAccountId);
                        // Load bulk sync status to skip re-sync if already done
                        await this.loadAccountSyncStatus(savedAccountId);
                    }

                    if (saved) {
                        // Load basic settings
                        this.state.settings = { ...this.state.settings, ...saved };

                        // Try to find account ID from DOM immediately
                        this.scanForAccountId();

                        // Ensure legacy arrays are cleared from memory if they came from local storage
                        // (They will be replaced by IDB data below)
                        this.state.settings.jsonPresets = [];
                        this.state.settings.rawTemplates = [];

                        this.state.ui.wrapInQuotes = this.state.settings.wrapInQuotes;
                        this._dispatchWrapModeChanged(this.state.settings.wrapInQuotes);
                        this._dispatchUploadModeChanged(this.state.settings.uploadModeEnabled);
                        window.Logger.info('StateManager', '✅ Basic settings loaded from chrome.storage');
                    }

                    // Load Custom Dropdown Options from IndexedDB first
                    if (this.storageManager?.indexedDBManager) {
                        try {
                            const allCustomDropdowns = await this.storageManager.indexedDBManager.getAllCustomDropdownOptions();
                            const normalizedFromDB = this._normalizeCustomDropdownOptions(allCustomDropdowns);
                            const settingsCustoms = this._normalizeCustomDropdownOptions(this.state.settings.customDropdownOptions);
                            this.state.settings.customDropdownOptions = this._mergeCustomDropdownOptions(settingsCustoms, normalizedFromDB);
                            window.Logger.info('StateManager', `✅ Loaded custom dropdown options from IndexedDB: ${Object.keys(allCustomDropdowns).length} categories`);
                        } catch (error) {
                            window.Logger.error('StateManager', 'Failed to load custom dropdowns from IndexedDB:', error);
                            // Fallback to chrome.storage if IndexedDB fails
                            const storedCustoms = this._normalizeCustomDropdownOptions(result['gvp-custom-dropdown-values']);
                            const settingsCustoms = this._normalizeCustomDropdownOptions(this.state.settings.customDropdownOptions);
                            this.state.settings.customDropdownOptions = this._mergeCustomDropdownOptions(settingsCustoms, storedCustoms);
                        }
                    } else {
                        // Fallback: Load from chrome.storage.local if IndexedDB not available
                        const storedCustoms = this._normalizeCustomDropdownOptions(result['gvp-custom-dropdown-values']);
                        const settingsCustoms = this._normalizeCustomDropdownOptions(this.state.settings.customDropdownOptions);
                        this.state.settings.customDropdownOptions = this._mergeCustomDropdownOptions(settingsCustoms, storedCustoms);
                    }

                    // CRITICAL: Wait for ALL IndexedDB data to load before UI renders
                    if (this.storageManager.indexedDBManager) {
                        window.Logger.info('StateManager', '🔄 Loading IndexedDB data...');

                        // Load JSON Presets from IndexedDB
                        window.Logger.debug('StateManager', '📥 Loading JSON Presets...');
                        const presets = await this.storageManager.indexedDBManager.getJsonPresets();
                        window.Logger.debug('StateManager', '🔍 DEBUG: Raw presets from IndexedDB:', presets);
                        window.Logger.debug('StateManager', '🔍 DEBUG: Presets array length:', presets?.length);
                        window.Logger.debug('StateManager', '🔍 DEBUG: Presets is array?', Array.isArray(presets));
                        if (presets?.length > 0) {
                            window.Logger.debug('StateManager', '🔍 DEBUG: First preset structure:', presets[0]);
                        }

                        this.state.settings.jsonPresets = this._normalizeJsonPresets(presets);
                        window.Logger.debug('StateManager', '🔍 DEBUG: After normalize, length:', this.state.settings.jsonPresets.length);
                        window.Logger.info('StateManager', `✅ Loaded ${this.state.settings.jsonPresets.length} JSON presets`);

                        // Load Raw Templates from IndexedDB
                        window.Logger.debug('StateManager', '📥 Loading Raw Templates...');
                        const templates = await this.storageManager.indexedDBManager.getRawTemplates();
                        window.Logger.debug('StateManager', '🔍 DEBUG: Raw templates from IndexedDB:', templates);
                        window.Logger.debug('StateManager', '🔍 DEBUG: Templates array length:', templates?.length);
                        if (templates?.length > 0) {
                            window.Logger.debug('StateManager', '🔍 DEBUG: First template structure:', templates[0]);
                        }

                        this.state.settings.rawTemplates = this._normalizeRawTemplates(templates);
                        window.Logger.debug('StateManager', '🔍 DEBUG: After normalize, length:', this.state.settings.rawTemplates.length);
                        window.Logger.info('StateManager', `✅ Loaded ${this.state.settings.rawTemplates.length} raw templates`);

                        // Load Multi-Gen History from IndexedDB
                        window.Logger.debug('StateManager', '📥 Loading Multi-Gen History...');
                        try {
                            const historyData = await this.storageManager.indexedDBManager.getMultiGenHistory();
                            if (historyData && historyData.images) {
                                this.state.multiGenHistory.images = historyData.images;
                                this.state.multiGenHistory.order = Array.from(historyData.images.keys());
                                window.Logger.info('StateManager', `✅ Loaded ${historyData.images.size} multi-gen history entries`);
                            } else {
                                window.Logger.info('StateManager', 'ℹ️ No multi-gen history found in IndexedDB');
                            }
                        } catch (error) {
                            window.Logger.error('StateManager', 'Failed to load multi-gen history from IndexedDB:', error);
                        }

                        // ✅ NEW: Load Gallery Data (Video Playlist) from IndexedDB
                        let accountToLoad = this.state.multiGenHistory.activeAccountId;

                        // Fallback: If no active account, try to find most recent account from IndexedDB
                        if (!accountToLoad && this.indexedDBManager) {
                            window.Logger.info('StateManager', '📥 No active account set, checking for most recent account in IndexedDB...');
                            try {
                                // Get all posts ordered by timestamp to find most recent account
                                const allGalleryData = await this.indexedDBManager.getAllGalleryPosts({ limit: 1 });
                                if (allGalleryData.length > 0) {
                                    accountToLoad = allGalleryData[0].accountId;
                                    this.state.multiGenHistory.activeAccountId = accountToLoad; // Sync inferred account
                                    window.Logger.info('StateManager', `📥 Found most recent account: ${accountToLoad?.substring(0, 8)}...`);
                                }
                            } catch (error) {
                                window.Logger.warn('StateManager', 'Failed to get most recent account:', error);
                            }
                        }

                        if (accountToLoad) {
                            window.Logger.info('StateManager', `📥 Loading gallery data for account ${accountToLoad.substring(0, 8)}...`);
                            try {
                                await this.loadGalleryDataFromIndexedDB(accountToLoad);
                            } catch (error) {
                                window.Logger.error('StateManager', 'Failed to load gallery data from IndexedDB:', error);
                            }
                        } else {
                            window.Logger.info('StateManager', '⏭️ No account found, skipping gallery data load (will load on first API call)');
                        }

                        window.Logger.info('StateManager', '✅ All IndexedDB data loaded');

                        // Display comprehensive summary of loaded data
                        // window.Logger.info('StateManager', '📊 INDEXEDDB DATA SUMMARY');
                        window.Logger.info('StateManager', `📦 JSON Presets:        ${this.state.settings.jsonPresets.length} loaded`);
                        // window.Logger.info('StateManager', '   → Used by: JSON Editor tab, Form presets dropdown');
                        window.Logger.info('StateManager', `📦 Raw Templates:       ${this.state.settings.rawTemplates.length} loaded`);
                        // window.Logger.info('StateManager', '   → Used by: Raw Input tab, Template manager');
                        window.Logger.info('StateManager', `📦 Multi-Gen History:   ${this.state.multiGenHistory.images.size} images`);
                        // window.Logger.info('StateManager', '   → Used by: Merged History tab, Progress tracking');
                        window.Logger.info('StateManager', `📦 Custom Dropdowns:    ${Object.keys(this.state.settings.customDropdownOptions).length} fields configured`);
                        // window.Logger.info('StateManager', '   → Used by: All form dropdowns across JSON editor');
                    } else {
                        window.Logger.warn('StateManager', '⚠️ IndexedDB not available, using chrome.storage fallback');
                    }

                    if (this.state.settings.silentMode) {
                        this.applySilentModeAudioDefaults();
                    }

                    window.dispatchEvent(new CustomEvent('gvp:custom-dropdown-updated', {
                        detail: { options: { ...this.state.settings.customDropdownOptions } }
                    }));

                    // Dispatch update for presets/templates
                    this._dispatchPresetsUpdated();
                    this._dispatchTemplatesUpdated();

                    window.Logger.info('StateManager', '🎉 Settings initialization complete - ready for UI rendering');
                    resolve();
                } catch (error) {
                    window.Logger.error('StateManager', '❌ Failed to load settings:', error);
                    // Resolve anyway to prevent blocking initialization
                    resolve();
                } finally {
                    this._settingsLoadPromise = null;
                }
            });
        });

        return this._settingsLoadPromise;
    }

    saveSettings() {
        // Use Chrome storage for settings, EXCLUDING large data
        try {
            // Check if extension context is still valid
            if (!chrome.runtime || !chrome.storage) {
                window.Logger.warn('StateManager', 'Extension context invalidated, skipping settings save');
                return;
            }

            // Create a copy of settings to save
            const settingsToSave = { ...this.state.settings };

            // CRITICAL: Exclude large data sets from chrome.storage.local
            // They are saved individually to IndexedDB via their own methods
            settingsToSave.jsonPresets = [];
            settingsToSave.rawTemplates = [];

            chrome.storage.local.set({ 'gvp-settings': settingsToSave }, () => {
                if (chrome.runtime.lastError) {
                    window.Logger.error('StateManager', 'Failed to save settings:', chrome.runtime.lastError);
                }
            });
        } catch (error) {
            if (error.message.includes('Extension context invalidated')) {
                window.Logger.warn('StateManager', 'Extension context invalidated during settings save');
            } else {
                window.Logger.error('StateManager', 'Error saving settings:', error);
            }
        }
    }

    setWrapInQuotes(enabled) {
        const normalized = !!enabled;
        const state = this.getState();
        if (state.settings.wrapInQuotes === normalized) {
            return;
        }
        state.settings.wrapInQuotes = normalized;
        state.ui.wrapInQuotes = normalized;
        this.saveSettings();
        this._dispatchWrapModeChanged(normalized);
    }

    isUploadAutomationEnabled() {
        return !!this.state.settings.uploadModeEnabled;
    }

    setUploadAutomationEnabled(enabled) {
        const normalized = !!enabled;
        if (this.state.settings.uploadModeEnabled === normalized) {
            return;
        }
        this.state.settings.uploadModeEnabled = normalized;
        this.saveSettings();
        this._dispatchUploadModeChanged(normalized);
    }

    setGuillotineEnabled(enabled) {
        const normalized = !!enabled;
        if (this.state.settings.guillotineEnabled === normalized) {
            return;
        }
        this.state.settings.guillotineEnabled = normalized;
        this.saveSettings();
        window.Logger.info('StateManager', `🔪 Guillotine mode ${normalized ? 'ENABLED' : 'DISABLED'}`);
    }

    setGuillotineDelay(ms) {
        const clamped = Math.max(100, Math.min(500, Number(ms) || 245));
        this.state.settings.guillotineDelay = clamped;
        this.saveSettings();
        window.Logger.info('StateManager', `🔪 Guillotine delay set to ${clamped}ms`);
    }

    async getJsonPresets() {
        if (this.storageManager && this.storageManager.indexedDBManager) {
            try {
                const presets = await this.storageManager.indexedDBManager.getJsonPresets();

                // Deduplicate by name (keep most recent)
                const seen = new Map();
                for (const preset of presets) {
                    if (!seen.has(preset.name) || (preset.savedAt > (seen.get(preset.name).savedAt || 0))) {
                        seen.set(preset.name, preset);
                    }
                }
                const dedupedPresets = Array.from(seen.values());

                // Update local state cache
                this.state.settings.jsonPresets = dedupedPresets;
                return dedupedPresets.map((preset) => ({
                    name: preset.name,
                    savedAt: preset.savedAt,
                    data: JSON.parse(JSON.stringify(preset.data || {}))
                }));
            } catch (error) {
                window.Logger.error('StateManager', 'Failed to fetch presets from IndexedDB:', error);
                return [];
            }
        }

        // Fallback to memory if IndexedDB not available
        const presets = Array.isArray(this.state.settings.jsonPresets)
            ? this.state.settings.jsonPresets
            : [];
        return presets.map((preset) => ({
            name: preset.name,
            savedAt: preset.savedAt,
            data: JSON.parse(JSON.stringify(preset.data || {}))
        }));
    }

    async saveJsonPreset(name, promptData) {
        if (typeof name !== 'string') {
            return { success: false, reason: 'invalid-name' };
        }
        const trimmed = name.trim();
        if (!trimmed) {
            return { success: false, reason: 'empty-name' };
        }

        const normalizedData = this._normalizePromptDataStructure(promptData);
        const newPreset = {
            name: trimmed,
            savedAt: this._nowIso(),
            data: normalizedData
        };

        // Update State
        const presets = this.state.settings.jsonPresets;
        const existingIndex = presets.findIndex(preset => preset.name.toLowerCase() === trimmed.toLowerCase());

        if (existingIndex >= 0) {
            presets[existingIndex] = newPreset;
        } else {
            presets.push(newPreset);
            presets.sort((a, b) => a.name.localeCompare(b.name));
        }

        // Persist to IndexedDB
        window.Logger.debug('StateManager', 'saveJsonPreset - storageManager:', !!this.storageManager);
        window.Logger.debug('StateManager', 'saveJsonPreset - indexedDBManager:', !!this.storageManager?.indexedDBManager);
        window.Logger.debug('StateManager', 'saveJsonPreset - indexedDBManager.initialized:', this.storageManager?.indexedDBManager?.initialized);

        if (this.storageManager?.indexedDBManager) {
            try {
                const result = await this.storageManager.indexedDBManager.saveJsonPreset(newPreset);
                window.Logger.debug('StateManager', 'saveJsonPreset - IndexedDB save result:', result);
            } catch (error) {
                window.Logger.error('StateManager', 'Failed to save preset to IndexedDB:', error);
            }
        } else {
            window.Logger.warn('StateManager', 'IndexedDB not available, preset saved to memory only');
        }

        this._dispatchPresetsUpdated();
        return { success: true };
    }

    async deleteJsonPreset(name) {
        if (!name) return { success: false };

        const presets = this.state.settings.jsonPresets;
        const index = presets.findIndex(p => p.name === name);

        if (index !== -1) {
            presets.splice(index, 1);

            // Remove from IndexedDB
            if (this.storageManager.indexedDBManager) {
                await this.storageManager.indexedDBManager.deleteJsonPreset(name);
            }

            this._dispatchPresetsUpdated();
            return { success: true };
        }
        return { success: false, reason: 'not-found' };
    }

    async renameJsonPreset(oldName, newName) {
        if (!oldName || !newName) return { success: false };

        const presets = this.state.settings.jsonPresets;
        const index = presets.findIndex(p => p.name === oldName);

        if (index !== -1) {
            const preset = presets[index];
            const newPreset = {
                ...preset,
                name: newName,
                savedAt: this._nowIso()
            };

            // Update State
            presets.splice(index, 1); // Remove old

            // Add new (sorted)
            const newIndex = presets.findIndex(p => p.name.localeCompare(newName) > 0);
            if (newIndex === -1) {
                presets.push(newPreset);
            } else {
                presets.splice(newIndex, 0, newPreset);
            }

            // Update IndexedDB
            if (this.storageManager.indexedDBManager) {
                await this.storageManager.indexedDBManager.deleteJsonPreset(oldName);
                await this.storageManager.indexedDBManager.saveJsonPreset(newPreset);
            }

            this._dispatchPresetsUpdated();
            return { success: true };
        }
        return { success: false, reason: 'not-found' };
    }

    _dispatchPresetsUpdated() {
        window.dispatchEvent(new CustomEvent('gvp:json-presets-updated', {
            detail: { presets: this.getJsonPresets() }
        }));
    }

    // ========================================
    // Raw Templates Management
    // ========================================

    getRawTemplates() {
        return Array.isArray(this.state.settings.rawTemplates)
            ? JSON.parse(JSON.stringify(this.state.settings.rawTemplates))
            : [];
    }

    async saveRawTemplate(template) {
        window.Logger.debug('StateManager', 'saveRawTemplate CALLED', template);
        if (!template) return { success: false };

        // Ensure ID
        if (!template.id) {
            template.id = crypto.randomUUID();
        } const templates = this.state.settings.rawTemplates;
        const index = templates.findIndex(t => t.id === template.id);

        if (index >= 0) {
            templates[index] = template;
        } else {
            templates.push(template);
        }

        // Persist to IndexedDB
        window.Logger.debug('StateManager', 'saveRawTemplate - storageManager:', !!this.storageManager);
        window.Logger.debug('StateManager', 'saveRawTemplate - indexedDBManager:', !!this.storageManager?.indexedDBManager);
        window.Logger.debug('StateManager', 'saveRawTemplate - indexedDBManager.initialized:', this.storageManager?.indexedDBManager?.initialized);

        if (this.storageManager?.indexedDBManager) {
            try {
                const result = await this.storageManager.indexedDBManager.saveRawTemplate(template);
                window.Logger.debug('StateManager', 'saveRawTemplate - IndexedDB save result:', result);
            } catch (error) {
                window.Logger.error('StateManager', 'Failed to save template to IndexedDB:', error);
            }
        } else {
            window.Logger.warn('StateManager', 'IndexedDB not available for templates, saved to memory only');
        }

        this._dispatchTemplatesUpdated();
        // Return the actual template (with id) for callers that need to use it
        return template;
    }

    async deleteRawTemplate(id) {
        if (!id) return { success: false };

        // CRITICAL FIX: Reload from IndexedDB first to ensure we're in sync
        if (this.storageManager?.indexedDBManager) {
            const freshTemplates = await this.storageManager.indexedDBManager.getRawTemplates();
            if (freshTemplates) {
                this.state.settings.rawTemplates = freshTemplates;
            }
        }

        const templates = this.state.settings.rawTemplates;
        const index = templates.findIndex(t => t.id === id);

        if (index !== -1) {
            templates.splice(index, 1);

            // Remove from IndexedDB
            if (this.storageManager.indexedDBManager) {
                await this.storageManager.indexedDBManager.deleteRawTemplate(id);
            }

            this._dispatchTemplatesUpdated();
            return { success: true };
        }
        return { success: false };
    }

    _dispatchTemplatesUpdated() {
        window.dispatchEvent(new CustomEvent('gvp:raw-templates-updated', {
            detail: { templates: this.getRawTemplates() }
        }));
    }

    // Compatibility methods for UIRawInputManager
    async setTemplate(template) {
        window.Logger.debug('StateManager', 'setTemplate CALLED', template);
        return this.saveRawTemplate(template);
    }

    async removeTemplate(templateId) {
        return this.deleteRawTemplate(templateId);
    }

    // ========================================
    // Saved Prompt Slots Management (IndexedDB v4)
    // ========================================

    /**
     * Get all saved prompt slots from IndexedDB
     * @returns {Promise<Object>} Map of slotId -> {prompt, savedAt}
     */
    async getSavedPromptSlots() {
        if (!this.indexedDBManager) {
            window.Logger.warn('StateManager', 'IndexedDB not available');
            return {};
        }
        return await this.indexedDBManager.getSavedPromptSlots();
    }

    /**
     * Get a single saved prompt slot
     * @param {number} slotId - Slot ID (1-based)
     * @returns {Promise<Object|null>} {prompt, savedAt} or null
     */
    async getSavedPromptSlot(slotId) {
        if (!this.indexedDBManager) {
            return null;
        }
        return await this.indexedDBManager.getSavedPromptSlot(slotId);
    }

    /**
     * Save a prompt to a slot
     * @param {number} slotId - Slot ID (1-based)
     * @param {string} prompt - Prompt text
     * @param {string} [name] - Optional custom name for the slot
     * @returns {Promise<boolean>} Success status
     */
    async saveSavedPromptSlot(slotId, prompt, name = '') {
        if (!this.indexedDBManager || !slotId || typeof prompt !== 'string') {
            return false;
        }

        try {
            await this.indexedDBManager.saveSavedPromptSlot(slotId, {
                prompt: prompt.trim(),
                name: name?.trim() || '',
                savedAt: new Date().toISOString()
            });

            // Dispatch event for UI updates
            window.dispatchEvent(new CustomEvent('gvp:saved-prompts-updated', {
                detail: { slotId }
            }));

            return true;
        } catch (error) {
            window.Logger.error('StateManager', 'Failed to save prompt slot:', error);
            return false;
        }
    }

    /**
     * Rename a saved prompt slot (without changing the prompt)
     * @param {number} slotId - Slot ID (1-based)
     * @param {string} name - New name for the slot
     * @returns {Promise<boolean>} Success status
     */
    async renameSavedPromptSlot(slotId, name) {
        if (!this.indexedDBManager || !slotId) {
            return false;
        }

        try {
            const existing = await this.indexedDBManager.getSavedPromptSlot(slotId);
            if (!existing || !existing.prompt) {
                window.Logger.warn('StateManager', 'Cannot rename empty slot:', slotId);
                return false;
            }

            await this.indexedDBManager.saveSavedPromptSlot(slotId, {
                ...existing,
                name: name?.trim() || '',
                savedAt: existing.savedAt || new Date().toISOString()
            });

            // Dispatch event for UI updates
            window.dispatchEvent(new CustomEvent('gvp:saved-prompts-updated', {
                detail: { slotId }
            }));

            return true;
        } catch (error) {
            window.Logger.error('StateManager', 'Failed to rename prompt slot:', error);
            return false;
        }
    }

    /**
     * Delete a saved prompt slot
     * @param {number} slotId - Slot ID (1-based)
     * @returns {Promise<boolean>} Success status
     */
    async deleteSavedPromptSlot(slotId) {
        if (!this.indexedDBManager || !slotId) {
            return false;
        }

        try {
            await this.indexedDBManager.deleteSavedPromptSlot(slotId);

            // Dispatch event for UI updates
            window.dispatchEvent(new CustomEvent('gvp:saved-prompts-updated', {
                detail: { slotId, deleted: true }
            }));

            return true;
        } catch (error) {
            window.Logger.error('StateManager', 'Failed to delete prompt slot:', error);
            return false;
        }
    }

    // ========================================
    // Prompt Library (IndexedDB v13)
    // ========================================

    /** Save or update a prompt entry. @param {Object} prompt @returns {Promise<boolean>} */
    async savePrompt(prompt) {
        if (!this.indexedDBManager) return false;
        return await this.indexedDBManager.savePrompt(prompt);
    }

    /** Get a single prompt by id. @param {string} id @returns {Promise<Object|null>} */
    async getPrompt(id) {
        if (!this.indexedDBManager) return null;
        return await this.indexedDBManager.getPrompt(id);
    }

    /**
     * Get all prompts, optionally filtered by type.
     * @param {string|null} [type] 'image'|'video'|null
     * @returns {Promise<Object[]>}
     */
    async getPrompts(type = null) {
        if (!this.indexedDBManager) return [];
        return await this.indexedDBManager.getPrompts(type);
    }

    /** Delete a prompt and its versions. @param {string} id @returns {Promise<boolean>} */
    async deletePrompt(id) {
        if (!this.indexedDBManager) return false;
        await this.indexedDBManager.deletePromptVersions(id);
        return await this.indexedDBManager.deletePrompt(id);
    }

    /** Save a version snapshot. @param {Object} version @returns {Promise<boolean>} */
    async savePromptVersion(version) {
        if (!this.indexedDBManager) return false;
        return await this.indexedDBManager.savePromptVersion(version);
    }

    /** Get all versions for a prompt. @param {string} promptId @returns {Promise<Object[]>} */
    async getPromptVersions(promptId) {
        if (!this.indexedDBManager) return [];
        return await this.indexedDBManager.getPromptVersions(promptId);
    }

    /** Save a folder. @param {Object} folder @returns {Promise<boolean>} */
    async saveFolder(folder) {
        if (!this.indexedDBManager) return false;
        return await this.indexedDBManager.saveFolder(folder);
    }

    /** Get all folders. @returns {Promise<Object[]>} */
    async getFolders() {
        if (!this.indexedDBManager) return [];
        return await this.indexedDBManager.getFolders();
    }

    /** Delete a folder. @param {string} id @returns {Promise<boolean>} */
    async deleteFolder(id) {
        if (!this.indexedDBManager) return false;
        return await this.indexedDBManager.deleteFolder(id);
    }

    /** Save a tag definition. @param {Object} tag @returns {Promise<boolean>} */
    async savePromptTag(tag) {
        if (!this.indexedDBManager) return false;
        return await this.indexedDBManager.savePromptTag(tag);
    }

    /** Get all tag definitions. @returns {Promise<Object[]>} */
    async getPromptTags() {
        if (!this.indexedDBManager) return [];
        return await this.indexedDBManager.getPromptTags();
    }

    /** Delete a tag. @param {string} id @returns {Promise<boolean>} */
    async deletePromptTag(id) {
        if (!this.indexedDBManager) return false;
        return await this.indexedDBManager.deletePromptTag(id);
    }

    /**
     * Log a prompt dispatch event (fire-and-forget from UIRawInputManager).
     * Writes to usageLog and updates recents list.
     * @param {Object} entry - UsageLogEntry
     * @returns {Promise<boolean>}
     */
    async logPromptUsage(entry) {
        if (!this.indexedDBManager) return false;
        return await this.indexedDBManager.logPromptUsage(entry);
    }

    /**
     * Get usage stats for a prompt (derived from usageLog).
     * @param {string} promptId
     * @returns {Promise<{useCount, lastUsedAt, moderationRate}>}
     */
    async getPromptUsageStats(promptId) {
        if (!this.indexedDBManager) return { useCount: 0, lastUsedAt: null, moderationRate: 0 };
        return await this.indexedDBManager.getPromptUsageStats(promptId);
    }

    /**
     * Add a prompt to the recents list (auto-caps at 20).
     * @param {Object} entry - { id, prompt_body, dispatched_at, generation_type }
     * @returns {Promise<boolean>}
     */
    async addRecentPrompt(entry) {
        if (!this.indexedDBManager) return false;
        return await this.indexedDBManager.addRecentPrompt(entry, 20);
    }

    /**
     * Get the most recent prompts list.
     * @param {number} [limit=20]
     * @returns {Promise<Object[]>}
     */
    async getRecentPrompts(limit = 20) {
        if (!this.indexedDBManager) return [];
        return await this.indexedDBManager.getRecentPrompts(limit);
    }

    // ========================================
    // Custom Objects Management (IndexedDB v4)
    // ========================================


    /**
     * Save a custom object preset
     * @param {string} objectString - "Name: description" format
     * @returns {Promise<Object|null>} Saved object with id or null
     */
    async saveCustomObject(objectString) {
        if (!this.indexedDBManager || typeof objectString !== 'string') {
            return null;
        }

        const trimmed = objectString.trim();
        if (!trimmed.includes(':')) {
            window.Logger.warn('StateManager', 'Invalid object format, must be "Name: description"');
            return null;
        }

        try {
            const obj = {
                id: crypto.randomUUID(),
                value: trimmed,
                savedAt: new Date().toISOString()
            };

            await this.indexedDBManager.saveCustomObject(obj);

            // Dispatch event for UI updates
            window.dispatchEvent(new CustomEvent('gvp:custom-objects-updated'));

            return obj;
        } catch (error) {
            window.Logger.error('StateManager', 'Failed to save custom object:', error);
            return null;
        }
    }

    /**
     * Get all custom object presets
     * @returns {Promise<Array>} Array of {id, value, savedAt}
     */
    async getCustomObjects() {
        if (!this.indexedDBManager) {
            return [];
        }
        const raw = await this.indexedDBManager.getCustomObjects();
        if (!Array.isArray(raw)) return [];
        return raw
            .map(entry => {
                const value = typeof entry?.value === 'string'
                    ? entry.value
                    : (typeof entry?.data === 'string'
                        ? entry.data
                        : (typeof entry?.data?.value === 'string' ? entry.data.value : ''));
                if (!value) return null;
                return {
                    id: entry.id || entry?.data?.id || crypto.randomUUID(),
                    value,
                    savedAt: entry.savedAt || entry?.data?.savedAt || null
                };
            })
            .filter(Boolean);
    }

    /**
     * Delete a custom object preset
     * @param {string} id - Object ID
     * @returns {Promise<boolean>} Success status
     */
    async deleteCustomObject(id) {
        if (!this.indexedDBManager || !id) {
            return false;
        }

        try {
            await this.indexedDBManager.deleteCustomObject(id);

            // Dispatch event for UI updates
            window.dispatchEvent(new CustomEvent('gvp:custom-objects-updated'));

            return true;
        } catch (error) {
            window.Logger.error('StateManager', 'Failed to delete custom object:', error);
            return false;
        }
    }

    // ========================================
    // Custom Dialogues Management (IndexedDB v4)
    // ========================================

    /**
     * Save a custom dialogue preset
     * @param {Object} dialogueObj - Dialogue object matching Video.json schema
     * @returns {Promise<Object|null>} Saved dialogue with id or null
     */
    async saveCustomDialogue(dialogueObj) {
        if (!this.indexedDBManager || !dialogueObj || typeof dialogueObj !== 'object') {
            return null;
        }

        // Validate required dialogue fields (per Video.json)
        const required = ['characters', 'content', 'accent', 'language', 'emotion', 'type'];
        for (const field of required) {
            if (!dialogueObj[field]) {
                window.Logger.warn('StateManager', `Missing required dialogue field: ${field}`);
                return null;
            }
        }

        try {
            const obj = {
                id: crypto.randomUUID(),
                ...dialogueObj,
                savedAt: new Date().toISOString()
            };

            await this.indexedDBManager.saveCustomDialogue(obj);

            // Dispatch event for UI updates
            window.dispatchEvent(new CustomEvent('gvp:custom-dialogues-updated'));

            return obj;
        } catch (error) {
            window.Logger.error('StateManager', 'Failed to save custom dialogue:', error);
            return null;
        }
    }

    /**
     * Get all custom dialogue presets
     * @returns {Promise<Array>} Array of dialogue objects
     */
    async getCustomDialogues() {
        if (!this.indexedDBManager) {
            return [];
        }
        return await this.indexedDBManager.getCustomDialogues();
    }

    /**
     * Delete a custom dialogue preset
     * @param {string} id - Dialogue ID
     * @returns {Promise<boolean>} Success status
     */
    async deleteCustomDialogue(id) {
        if (!this.indexedDBManager || !id) {
            return false;
        }

        try {
            await this.indexedDBManager.deleteCustomDialogue(id);

            // Dispatch event for UI updates
            window.dispatchEvent(new CustomEvent('gvp:custom-dialogues-updated'));

            return true;
        } catch (error) {
            window.Logger.error('StateManager', 'Failed to delete custom dialogue:', error);
            return false;
        }
    }


    async applyJsonPreset(name) {
        if (typeof name !== 'string') {
            return false;
        }
        const presets = await this.getJsonPresets();
        const preset = presets.find(entry => entry.name.toLowerCase() === name.trim().toLowerCase());
        if (!preset) {
            return false;
        }
        this.state.promptData = this._normalizePromptDataStructure(preset.data);
        this._dispatchPromptDataUpdated({ source: 'json-preset', name: preset.name });
        return true;
    }

    _dispatchJsonPresetsUpdated() {
        try {
            window.dispatchEvent(new CustomEvent('gvp:json-presets-updated', {
                detail: {
                    presets: this.getJsonPresets().map(({ name, savedAt }) => ({ name, savedAt }))
                }
            }));
        } catch (error) {
            window.Logger.error('StateManager', 'Failed to dispatch json presets update', error);
        }
    }

    _dispatchPromptDataUpdated(detail = {}) {
        try {
            window.dispatchEvent(new CustomEvent('gvp:prompt-data-updated', {
                detail: {
                    ...detail,
                    timestamp: Date.now()
                }
            }));
        } catch (error) {
            window.Logger.error('StateManager', 'Failed to dispatch prompt data update', error);
        }
    }

    _dispatchWrapModeChanged(enabled) {
        try {
            window.dispatchEvent(new CustomEvent('gvp:wrap-mode-changed', {
                detail: { enabled: !!enabled }
            }));
        } catch (error) {
            window.Logger.error('StateManager', 'Failed to dispatch wrap mode change', error);
        }
    }

    _dispatchUploadModeChanged(enabled) {
        try {
            window.dispatchEvent(new CustomEvent('gvp:upload-mode-changed', {
                detail: { enabled: !!enabled }
            }));
        } catch (error) {
            window.Logger.error('StateManager', 'Failed to dispatch upload mode change', error);
        }
    }

    _parseVideoPromptJson(rawJsonString) {
        try {
            return JSON.parse(rawJsonString);
        } catch (error) {
            const repaired = this._repairVideoPromptJson(rawJsonString);
            if (repaired && repaired !== rawJsonString) {
                window.Logger.warn('StateManager', '⚠️ Repairing malformed videoPrompt payload before parsing');
                return JSON.parse(repaired);
            }
            throw error;
        }
    }

    _repairVideoPromptJson(rawJsonString) {
        if (typeof rawJsonString !== 'string' || !rawJsonString.includes('"dialogue"')) {
            return rawJsonString;
        }

        let repaired = rawJsonString;

        const dialogueRegex = /"dialogue"\s*:\s*\[(.*?)\]/gs;
        repaired = repaired.replace(dialogueRegex, (match, inner) => {
            const trimmed = inner.trim();
            if (!trimmed.length) {
                return '"dialogue":[]';
            }

            const segments = trimmed
                .split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/)
                .map(segment => {
                    const value = segment.trim();
                    if (!value) {
                        return '""';
                    }

                    if (value.startsWith('"') && value.endsWith('"')) {
                        return value;
                    }

                    const normalized = value
                        .replace(/^"+|"+$/g, '')
                        .replace(/\\"/g, '"');

                    return JSON.stringify(normalized);
                })
                .join(',');

            return `"dialogue":[${segments}]`;
        });

        return repaired;
    }

    /**
     * Update promptData from a videoPrompt string (from API response)
     * @param {string} videoPromptString - The stringified videoPrompt from API
     */
    updatePromptDataFromVideoPrompt(videoPromptString) {
        if (!videoPromptString || typeof videoPromptString !== 'string') {
            window.Logger.warn('StateManager', 'Invalid videoPrompt string');
            return false;
        }

        let trimmed = videoPromptString.trim();
        if (!trimmed) {
            window.Logger.warn('StateManager', 'Empty videoPrompt string received');
            return false;
        }

        // Some responses double-stringify the JSON payload. Strip wrapping quotes if present.
        const isWrappedByQuotes = trimmed.startsWith('"') && trimmed.endsWith('"');
        if (isWrappedByQuotes) {
            try {
                trimmed = JSON.parse(trimmed);
            } catch (doubleParseErr) {
                window.Logger.warn('StateManager', 'Failed to unwrap double-stringified videoPrompt');
                this.state.generation.lastPrompt = null;
                this.state.generation.lastVideoPromptRaw = videoPromptString;
                return false;
            }
            trimmed = typeof trimmed === 'string' ? trimmed.trim() : '';
        }

        let candidate = trimmed;
        const looksLikeJson = candidate.startsWith('{') || candidate.startsWith('[');

        if (!looksLikeJson) {
            const extracted = this._extractJsonPayload(candidate);
            if (extracted) {
                candidate = extracted.trim();
            }
        }

        if (!candidate || (!candidate.startsWith('{') && !candidate.startsWith('['))) {
            if (this.state.generation.lastVideoPromptRaw !== videoPromptString) {
                window.Logger.debug('StateManager', 'Skipping non-JSON videoPrompt payload');
            }
            this.state.generation.lastPrompt = null;
            this.state.generation.lastVideoPromptRaw = videoPromptString;
            return false;
        }

        try {
            const parsedPrompt = this._parseVideoPromptJson(candidate);
            window.Logger.info('StateManager', '✅ Parsed videoPrompt from API response');

            this.state.promptData = { ...this.state.promptData, ...parsedPrompt };
            if (this.state.settings?.silentMode) {
                this.applySilentModeAudioDefaults();
            }

            this.state.generation.lastPrompt = candidate;
            this.state.generation.lastVideoPromptRaw = null;
            window.Logger.info('StateManager', '✅ Updated promptData with parsed videoPrompt');

            return true;
        } catch (error) {
            window.Logger.error('StateManager', 'Failed to parse videoPrompt JSON', error);
            this.state.generation.lastPrompt = null;
            this.state.generation.lastVideoPromptRaw = videoPromptString;
            return false;
        }
    }

    _extractJsonPayload(rawString) {
        if (!rawString || typeof rawString !== 'string') {
            return null;
        }

        const firstBrace = rawString.indexOf('{');
        const firstBracket = rawString.indexOf('[');

        if (firstBrace === -1 && firstBracket === -1) {
            return null;
        }

        let startIndex;
        let openChar;
        let closeChar;

        if (firstBrace === -1 || (firstBracket !== -1 && firstBracket < firstBrace)) {
            startIndex = firstBracket;
            openChar = '[';
            closeChar = ']';
        } else {
            startIndex = firstBrace;
            openChar = '{';
            closeChar = '}';
        }

        let depth = 0;
        let inString = false;
        let isEscaped = false;

        for (let i = startIndex; i < rawString.length; i++) {
            const char = rawString[i];

            if (inString) {
                if (isEscaped) {
                    isEscaped = false;
                } else if (char === '\\') {
                    isEscaped = true;
                } else if (char === '"') {
                    inString = false;
                }
                continue;
            }

            if (char === '"') {
                inString = true;
                continue;
            }

            if (char === openChar) {
                depth += 1;
            } else if (char === closeChar) {
                depth -= 1;
                if (depth === 0) {
                    return rawString.slice(startIndex, i + 1);
                }
            }
        }

        return null;
    }

    async initialize() {
        //CRITICAL: Load settings HERE, not in constructor
        // This ensures IndexedDB is initialized first!
        if (!this._settingsPromise) {
            window.Logger.info('StateManager', '🔧 initialize() called - starting settings load');
            // Start loading settings
            await this._loadSettings();

            // Fallback: Periodic scan for Account ID (in case DOM loads late)
            let scanAttempts = 0;
            const scanInterval = setInterval(() => {
                if (this.state.activeAccountId) {
                    clearInterval(scanInterval);
                    return;
                }
                scanAttempts++;
                this.scanForAccountId();
                if (scanAttempts >= 10) clearInterval(scanInterval);
            }, 2000);

            this.initialized = true;
        }
        return this._settingsPromise;
    }

    /**
     * Generate unique ID for video generations
     * @returns {string} Unique generation identifier
     */
    generateGenerationId() {
        return `gen_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    applySilentModeAudioDefaults() {
        const state = this.getState();
        if (!state.promptData) {
            state.promptData = this._getEmptyPromptData();
        }
        // Set motion level for silent mode
        state.promptData.shot = state.promptData.shot || {};
        state.promptData.shot.motion_level = 'high';

        state.promptData.audio = state.promptData.audio || {};
        state.promptData.audio.music = 'none';
        state.promptData.audio.ambient = 'none';
        state.promptData.audio.sound_effect = 'heavy breathing';
        state.promptData.audio.mix_level = 'dialogue slightly louder than sound_effects no music no ambient sounds';
    }

    getTemplateForField(fieldPath) {
        if (!fieldPath) {
            return [];
        }
        const templates = this.state.settings.rawTemplates || [];
        return templates.filter(template => template.fieldPath === fieldPath);
    }

    setTemplate(templateEntry) {
        if (!templateEntry || !templateEntry.fieldPath) {
            window.Logger.warn('StateManager', 'Invalid template entry provided');
            return null;
        }

        const templates = Array.isArray(this.state.settings.rawTemplates)
            ? [...this.state.settings.rawTemplates]
            : [];

        const normalizedEntry = this._normalizeTemplateEntry(templateEntry);
        const existingIndex = templates.findIndex(t => t.id === normalizedEntry.id);

        if (existingIndex >= 0) {
            templates[existingIndex] = { ...templates[existingIndex], ...normalizedEntry };
        } else {
            templates.push(normalizedEntry);
        }

        this.state.settings.rawTemplates = templates;
        this.saveSettings();
        return normalizedEntry;
    }

    setRawTemplates(templates) {
        if (!Array.isArray(templates)) {
            this.state.settings.rawTemplates = [];
        } else {
            this.state.settings.rawTemplates = templates.map(entry => this._normalizeTemplateEntry(entry));
        }
        this.saveSettings();
    }

    removeTemplate(templateId) {
        if (!templateId) {
            return;
        }

        const templates = Array.isArray(this.state.settings.rawTemplates)
            ? this.state.settings.rawTemplates.filter(template => template.id !== templateId)
            : [];

        this.state.settings.rawTemplates = templates;
        this.saveSettings();
    }

    async loadRawTemplatesFromStorage() {
        return new Promise((resolve) => {
            if (!chrome?.storage?.local) {
                resolve([]);
                return;
            }

            chrome.storage.local.get(['gvp-settings'], (result) => {
                const saved = result['gvp-settings'];
                const templates = saved?.rawTemplates ? this._normalizeRawTemplates(saved.rawTemplates) : [];
                resolve(templates);
            });
        });
    }

    _normalizePromptDataStructure(data) {
        if (!data || typeof data !== 'object') {
            data = {};
        }

        // Helper to ensure object exists
        const ensureObj = (obj) => (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
        // Helper to ensure array exists
        const ensureArr = (arr) => (Array.isArray(arr)) ? arr : [];
        // Helper to ensure string
        const ensureStr = (str, defaultVal = '') => (typeof str === 'string') ? str : defaultVal;

        const normalized = {
            shot: ensureObj(data.shot),
            scene: ensureObj(data.scene),
            cinematography: ensureObj(data.cinematography),
            visual_details: ensureObj(data.visual_details),
            motion: ensureStr(data.motion, ''),
            audio: ensureObj(data.audio),
            dialogue: ensureArr(data.dialogue),
            tags: ensureArr(data.tags)
        };

        // 1. Shot
        normalized.shot.motion_level = ensureStr(normalized.shot.motion_level, 'Medium');
        normalized.shot.camera_depth = ensureStr(normalized.shot.camera_depth, 'Medium shot');
        normalized.shot.camera_view = ensureStr(normalized.shot.camera_view, 'Eye level');
        normalized.shot.camera_movement = ensureStr(normalized.shot.camera_movement, 'Static');

        // 2. Scene
        normalized.scene.location = ensureStr(normalized.scene.location, '');
        normalized.scene.environment = ensureStr(normalized.scene.environment, '');

        // 3. Cinematography
        normalized.cinematography.lighting = ensureStr(normalized.cinematography.lighting, 'Natural');
        normalized.cinematography.style = ensureStr(normalized.cinematography.style, 'Realistic');
        normalized.cinematography.texture = ensureStr(normalized.cinematography.texture, 'High fidelity');
        normalized.cinematography.depth_of_field = ensureStr(normalized.cinematography.depth_of_field, 'Deep focus');

        // 4. Visual Details
        normalized.visual_details.objects = ensureArr(normalized.visual_details.objects);
        normalized.visual_details.positioning = ensureArr(normalized.visual_details.positioning);
        normalized.visual_details.text_elements = ensureArr(normalized.visual_details.text_elements);

        // 5. Audio
        normalized.audio.music = ensureStr(normalized.audio.music, 'None'); // Critical default
        normalized.audio.ambient = ensureStr(normalized.audio.ambient, '');
        normalized.audio.sound_effect = ensureStr(normalized.audio.sound_effect, '');
        normalized.audio.mix_level = ensureStr(normalized.audio.mix_level, '');

        // 6. Dialogue (Normalize each entry)
        normalized.dialogue = normalized.dialogue.map(d => ({
            characters: ensureStr(d.characters, ''),
            content: ensureStr(d.content, ''),
            accent: ensureStr(d.accent, ''),
            language: ensureStr(d.language, 'English'),
            emotion: ensureStr(d.emotion, 'Neutral'),
            type: ensureStr(d.type, 'Speaking'),
            subtitles: !!d.subtitles,
            start_time: ensureStr(d.start_time, '00:00:00.000'),
            end_time: ensureStr(d.end_time, '00:00:05.000')
        }));

        // 7. Tags
        // Ensure it's an array of strings
        normalized.tags = normalized.tags.map(t => String(t));

        return normalized;
    }

    applyTemplatesToPrompt(promptData) {
        const source = promptData
            ? JSON.parse(JSON.stringify(promptData))
            : JSON.parse(JSON.stringify(this.state.promptData || this._getEmptyPromptData()));
        const baseData = this._normalizePromptDataStructure(source);

        const templates = this._repairRawTemplates()
            .filter(template => template.enabled && !template.applyToRaw);

        if (!templates.length) {
            return baseData;
        }

        templates.forEach(template => {
            this._applyTemplateRule(baseData, template);
        });

        return baseData;
    }

    applyTemplatesToRawPrompt(rawPrompt) {
        if (!rawPrompt || typeof rawPrompt !== 'string') {
            return rawPrompt || '';
        }

        let result = rawPrompt;
        const templates = this._repairRawTemplates()
            .filter(template => template.enabled && template.applyToRaw);

        if (!templates.length) {
            return result;
        }

        templates.forEach(template => {
            const fieldMeta = (window.uiConstants?.RAW_TEMPLATE_FIELDS || []).find(field => field.value === template.fieldPath);
            if (!fieldMeta || (fieldMeta.type !== 'scalar' && fieldMeta.type !== 'array')) {
                return;
            }

            const prefix = template.prefix || '';
            const suffix = template.suffix || '';

            if (template.prefixOnly) {
                const segments = [prefix, suffix].filter(Boolean);
                result = segments.join('\n');
                return;
            }

            if (fieldMeta.type === 'scalar') {
                result = `${prefix}${result}${suffix}`;
                return;
            }

            if (fieldMeta.type === 'array') {
                const before = prefix ? `${prefix}\n` : '';
                const after = suffix ? `\n${suffix}` : '';
                result = `${before}${result}${after}`;
            }
        });

        return result;
    }

    _repairRawTemplates() {
        const existing = Array.isArray(this.state.settings.rawTemplates)
            ? this.state.settings.rawTemplates
            : [];
        const normalized = this._normalizeRawTemplates(existing);

        // Detect changes (length or any entry differs)
        let changed = normalized.length !== existing.length;
        if (!changed) {
            for (let i = 0; i < normalized.length; i++) {
                const a = normalized[i];
                const b = existing[i];
                if (JSON.stringify(a) !== JSON.stringify(b)) {
                    changed = true;
                    break;
                }
            }
        }

        if (changed) {
            this.state.settings.rawTemplates = normalized;
            this.saveSettings();
        }

        return normalized;
    }

    _applyTemplateRule(target, template) {
        const fieldPath = template.fieldPath || template.value || template.targetField || null;
        if (!fieldPath) {
            window.Logger.warn('StateManager', 'Skipping template with missing fieldPath', template);
            return;
        }

        const resolved = this._resolveTemplatePath(target, fieldPath);
        if (!resolved) {
            window.Logger.warn('StateManager', `Unable to resolve template path: ${fieldPath}`);
            return;
        }

        const { parent, key, isArray } = resolved;
        if (!parent) {
            window.Logger.warn('StateManager', `Missing parent for template path: ${template.fieldPath}`);
            return;
        }

        if (isArray) {
            const existing = Array.isArray(parent[key]) ? [...parent[key]] : [];

            if (template.fieldPath === 'dialogue[]') {
                const normalizedDialogues = this._normalizeDialogueTemplate(template.dialogueTemplate);
                const prefixLines = this._cloneDialogueLines(normalizedDialogues.prefixLines);
                const suffixLines = this._cloneDialogueLines(normalizedDialogues.suffixLines);
                const hasDialogueBlocks = prefixLines.length > 0 || suffixLines.length > 0;

                if (hasDialogueBlocks) {
                    if (template.prefixOnly) {
                        parent[key] = [...prefixLines, ...suffixLines];
                    } else {
                        parent[key] = [...prefixLines, ...existing, ...suffixLines];
                    }
                    return;
                }
            }

            const prefix = template.prefix || '';
            const suffix = template.suffix || '';

            if (template.prefixOnly) {
                const replacement = [];
                if (prefix) replacement.push(prefix);
                if (suffix) replacement.push(suffix);
                parent[key] = replacement;
            } else {
                const updated = [...existing];
                if (prefix) {
                    updated.unshift(prefix);
                }
                if (suffix) {
                    updated.push(suffix);
                }
                parent[key] = updated;
            }
            return;
        }

        const currentValue = parent[key] !== undefined && parent[key] !== null
            ? String(parent[key])
            : '';
        const prefix = template.prefix || '';
        const suffix = template.suffix || '';
        const base = template.prefixOnly ? '' : currentValue;
        parent[key] = `${prefix}${base}${suffix}`;
    }

    _resolveTemplatePath(target, fieldPath) {
        if (!fieldPath) {
            return null;
        }

        const segments = fieldPath.split('.');
        let current = target;

        for (let i = 0; i < segments.length; i++) {
            const isLast = i === segments.length - 1;
            const rawSegment = segments[i];
            const isArray = rawSegment.endsWith('[]');
            const segment = isArray ? rawSegment.slice(0, -2) : rawSegment;

            if (!segment) {
                return null;
            }

            if (isLast) {
                if (current && typeof current === 'object' && !(segment in current)) {
                    current[segment] = isArray ? [] : '';
                }
                return { parent: current, key: segment, isArray };
            }

            if (!(segment in current) || current[segment] === null) {
                current[segment] = {};
            }
            current = current[segment];
        }
        return null;
    }

    _normalizeRawTemplates(entries) {
        if (!Array.isArray(entries)) {
            return [];
        }

        const seenIds = new Set();
        return entries
            .map(entry => this._normalizeTemplateEntry(entry))
            .filter(entry => {
                if (!entry.fieldPath) {
                    return false;
                }
                if (seenIds.has(entry.id)) {
                    entry.id = this._generateTemplateId();
                }
                seenIds.add(entry.id);
                return true;
            });
    }

    _normalizeTemplateEntry(entry) {
        const inferFieldPath = (raw) => {
            if (typeof raw === 'string' && raw.trim()) {
                return raw.trim();
            }
            return '';
        };

        const fieldFromLabel = (label) => {
            try {
                const fields = (window.uiConstants && Array.isArray(window.uiConstants.RAW_TEMPLATE_FIELDS))
                    ? window.uiConstants.RAW_TEMPLATE_FIELDS
                    : [];
                const match = fields.find(f => f.label === label);
                return match ? match.value : '';
            } catch (e) {
                return '';
            }
        };

        const inferredFieldPath =
            inferFieldPath(entry?.fieldPath) ||
            inferFieldPath(entry?.value) ||
            inferFieldPath(entry?.targetField) ||
            fieldFromLabel(entry?.label);

        const inferName = () => {
            if (typeof entry?.name === 'string' && entry.name.trim()) {
                return entry.name.trim();
            }
            if (typeof entry?.label === 'string' && entry.label.trim()) {
                return entry.label.trim();
            }
            // fallback to field label
            const fields = (window.uiConstants && Array.isArray(window.uiConstants.RAW_TEMPLATE_FIELDS))
                ? window.uiConstants.RAW_TEMPLATE_FIELDS
                : [];
            const match = fields.find(f => f.value === inferredFieldPath);
            return match ? match.label : 'Template';
        };

        const normalized = {
            id: entry && entry.id ? entry.id : this._generateTemplateId(),
            fieldPath: inferredFieldPath,
            name: inferName(),
            prefix: entry && entry.prefix ? entry.prefix : '',
            suffix: entry && entry.suffix ? entry.suffix : '',
            enabled: entry && typeof entry.enabled === 'boolean' ? entry.enabled : true,
            prefixOnly: Boolean(entry && entry.prefixOnly),
            dialogueTemplate: this._normalizeDialogueTemplate(entry?.dialogueTemplate),
            applyToRaw: Boolean(entry && entry.applyToRaw),
            autoApply: entry && typeof entry.autoApply === 'boolean' ? entry.autoApply : false
        };

        return normalized;
    }

    _generateTemplateId() {
        return `tmpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    _normalizeDialogueTemplate(templateData) {
        const defaultStructure = { prefixLines: [], suffixLines: [] };
        if (!templateData || typeof templateData !== 'object') {
            return defaultStructure;
        }

        const normalizeLines = (lines) => {
            if (!Array.isArray(lines)) {
                return [];
            }
            return lines
                .map(line => this._normalizeDialogueLine(line))
                .filter(line => !this._isDialogueLineEmpty(line));
        };

        return {
            prefixLines: normalizeLines(templateData.prefixLines),
            suffixLines: normalizeLines(templateData.suffixLines)
        };
    }

    _cloneDialogueLines(lines) {
        if (!Array.isArray(lines)) {
            return [];
        }
        return lines.map(line => this._normalizeDialogueLine(line));
    }

    _normalizeDialogueLine(line) {
        const defaults = {
            characters: '',
            content: '',
            accent: 'neutral',
            language: 'English',
            emotion: '',
            type: 'spoken',
            subtitles: false,
            start_time: '00:00:00.000',
            end_time: '00:00:01.000'
        };

        if (typeof line === 'string' && line.trim()) {
            return {
                ...defaults,
                content: line.trim()
            };
        }

        if (!line || typeof line !== 'object') {
            return { ...defaults };
        }

        const normalized = {
            ...defaults,
            ...line
        };

        normalized.characters = (normalized.characters || '').trim();
        normalized.content = (normalized.content || '').trim();
        normalized.accent = (normalized.accent || 'neutral').trim();
        normalized.language = (normalized.language || 'English').trim();
        normalized.emotion = (normalized.emotion || '').trim();
        normalized.type = (normalized.type || 'spoken').trim();
        normalized.subtitles = Boolean(normalized.subtitles);
        normalized.start_time = this._normalizeDialogueTimestamp(normalized.start_time);
        normalized.end_time = this._normalizeDialogueTimestamp(normalized.end_time);

        return normalized;
    }

    _normalizeDialogueTimestamp(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return this._formatSecondsToTimestamp(Math.max(0, value));
        }
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
        return '00:00:00.000';
    }

    _formatSecondsToTimestamp(seconds) {
        const totalMillis = Math.round((Number.isFinite(seconds) ? seconds : 0) * 1000);
        const clampedMillis = Math.max(totalMillis, 0);
        const millis = clampedMillis % 1000;
        const totalSeconds = Math.floor(clampedMillis / 1000);
        const secs = totalSeconds % 60;
        const totalMinutes = Math.floor(totalSeconds / 60);
        const mins = totalMinutes % 60;
        const hours = Math.floor(totalMinutes / 60);

        const pad = (num, size = 2) => String(num).padStart(size, '0');
        const padMillis = (num) => String(num).padStart(3, '0');

        return `${pad(hours)}:${pad(mins)}:${pad(secs)}.${padMillis(millis)}`;
    }

    _isDialogueLineEmpty(line) {
        if (!line) {
            return true;
        }
        const content = (line.content || '').trim();
        const characters = (line.characters || '').trim();
        const accent = (line.accent || '').trim();
        const language = (line.language || '').trim();
        const emotion = (line.emotion || '').trim();
        const type = (line.type || '').trim();

        return !content && !characters && !accent && !language && !emotion && !type;
    }

    /**
     * Register a new video generation
     * @param {string} generationId - Unique generation identifier
     * @param {string} prompt - The prompt being generated
     * @param {object} options - Generation options (mode, imageUrl, etc.)
     */
    registerGeneration(generationId, prompt, options = {}) {
        const generationData = {
            id: generationId,
            startTime: Date.now(),
            progress: 0,
            isComplete: false,
            isRefused: false,
            moderationRetryCount: 0,
            initialPrompt: prompt,
            finalPrompt: null,
            mode: options.mode || this.state.generation.useSpicy ? 'spicy' : 'normal',

            // ENHANCED: Image tracking
            imageId: options.imageId || null,
            imageUrl: options.imageUrl || null,
            imageReference: options.imageReference || null,

            // Video output tracking
            videoUrl: null,
            videoId: null,
            assetId: null,
            audioUrls: [],

            // ENHANCED: Moderation tracking
            moderated: false,
            moderationTimestamp: null,

            // ENHANCED: Correlation tracking
            requestId: options.requestId || null, // x-xai-request-id from headers
            conversationId: options.conversationId || null,
            responseId: null,

            // Timing
            endTime: null,
            duration: null,

            // Status tracking
            status: 'initializing',
            lastUpdated: Date.now()
        };

        this.state.multiGeneration.activeGenerations.set(generationId, generationData);
        this.state.generation.currentGenerationId = generationId;
        this.state.generation.isGenerating = true;

        // Save to persistent storage
        this._saveGenerationToStorage(generationId, generationData);

        window.Logger.info('StateManager', `Registered generation: ${generationId} for imageId: ${generationData.imageId}`);
        return generationData;
    }

    /**
     * Update generation data
     * @param {string} generationId - Generation identifier
     * @param {object} updates - Properties to update
     */
    updateGeneration(generationId, updates) {
        const generation = this.state.multiGeneration.activeGenerations.get(generationId);
        if (generation) {
            // Update with new data and timestamp
            Object.assign(generation, updates, { lastUpdated: Date.now() });

            // Persist to storage
            this._updateGenerationInStorage(generationId, updates);

            window.Logger.debug('StateManager', `Updated generation ${generationId}:`, updates);
        }
    }

    /**
     * Mark generation as complete
     * @param {string} generationId - Generation identifier
     * @param {object} finalData - Final generation data
     */
    completeGeneration(generationId, finalData = {}) {
        const generation = this.state.multiGeneration.activeGenerations.get(generationId);
        if (generation) {
            generation.isComplete = true;
            generation.endTime = Date.now();
            generation.duration = generation.endTime - generation.startTime;
            generation.status = finalData.moderated ? 'moderated' : 'completed';
            generation.lastUpdated = Date.now();
            Object.assign(generation, finalData);

            // Move to completed
            this.state.multiGeneration.completedGenerations.set(generationId, generation);
            this.state.multiGeneration.activeGenerations.delete(generationId);

            // Update current generation state
            if (this.state.generation.currentGenerationId === generationId) {
                this.state.generation.isGenerating = false;
                this.state.generation.currentGenerationId = null;
            }

            // Persist to storage
            this._completeGenerationInStorage(generationId, generation);

            window.Logger.info('StateManager', `✅ Completed generation ${generationId} in ${generation.duration}ms (status: ${generation.status})`);
        }
    }

    /**
     * Initialize storage and restore any saved generations
     */
    async initializeStorage() {
        if (this._storageInitialized) {
            return;
        }

        try {
            const restoredData = await this.storageManager.initialize();

            // Restore active generations
            if (restoredData.activeGenerations) {
                Object.entries(restoredData.activeGenerations).forEach(([id, data]) => {
                    this.state.multiGeneration.activeGenerations.set(id, data);
                });
            }

            // Restore completed generations
            if (restoredData.completedGenerations) {
                Object.entries(restoredData.completedGenerations).forEach(([id, data]) => {
                    this.state.multiGeneration.completedGenerations.set(id, data);
                });
            }

            if (restoredData.multiGenHistory) {
                this.hydrateMultiGenHistory(restoredData.multiGenHistory);
            }

            this._storageInitialized = true;
            window.Logger.info('StateManager', 'StorageManager initialized and data restored');
            this._scheduleMultiGenHistorySave(0);
        } catch (error) {
            window.Logger.error('StateManager', 'Failed to initialize storage:', error);
        }
    }

    /**
     * Find generation by imageId (for correlating responses with requests)
     * @param {string} imageId - Image identifier
     * @returns {Object|null} Generation data or null
     */
    findGenerationByImageId(imageId) {
        if (!imageId) return null;

        // Search in active generations
        for (const [id, gen] of this.state.multiGeneration.activeGenerations) {
            if (gen.imageId === imageId) {
                return gen;
            }
        }

        return null;
    }

    /**
     * Find generation by videoId (for correlating progress updates)
     * @param {string} videoId - Video identifier from response
     * @returns {Object|null} Generation data or null
     */
    findGenerationByVideoId(videoId) {
        if (!videoId) return null;

        // Search in active generations
        for (const [id, gen] of this.state.multiGeneration.activeGenerations) {
            if (gen.videoId === videoId) {
                return gen;
            }
        }

        return null;
    }

    /**
     * Clear all completed generations
     */
    async clearCompletedGenerations() {
        this.state.multiGeneration.completedGenerations.clear();
        await this.storageManager.clearCompletedGenerations();
        window.Logger.info('StateManager', 'Cleared all completed generations');
    }

    /**
     * Get generation statistics
     * @returns {Object} Statistics
     */
    getGenerationStats() {
        const active = this.state.multiGeneration.activeGenerations.size;
        const completed = this.state.multiGeneration.completedGenerations.size;

        let failed = 0;
        let moderated = 0;

        this.state.multiGeneration.completedGenerations.forEach(gen => {
            if (gen.status === 'failed') failed++;
            if (gen.moderated === true) moderated++;
        });

        return {
            active,
            queued: this.state.multiGeneration.queuedGenerations.length,
            completed,
            failed,
            moderated
        };
    }

    // ============================================================
    // STORAGE HELPER METHODS (Private)
    // ============================================================

    /**
     * Save new generation to storage
     * @private
     */
    async _saveGenerationToStorage(generationId, generationData) {
        if (!this._storageInitialized) {
            await this.initializeStorage();
        }

        await this.storageManager.saveActiveGeneration(generationId, generationData);
    }

    /**
     * Update generation in storage
     * @private
     */
    async _updateGenerationInStorage(generationId, updates) {
        if (!this._storageInitialized) return;

        await this.storageManager.updateActiveGeneration(generationId, updates);
    }

    /**
     * Complete generation in storage
     * @private
     */
    async _completeGenerationInStorage(generationId, finalData) {
        if (!this._storageInitialized) return;

        await this.storageManager.completeGeneration(generationId, finalData);
    }

    // ============================================================
    // GALLERY API DATA METHODS (/rest/media/post/list)
    // ============================================================

    /**
     * Load gallery data from IndexedDB for the given account
     * @param {string} accountId - Account to load data for
     * @returns {Promise<boolean>} True if data was loaded successfully
     */
    async loadGalleryDataFromIndexedDB(accountId) {
        if (!this.indexedDBManager) {
            window.Logger.warn('StateManager', 'Cannot load gallery data - IndexedDB not initialized');
            return false;
        }

        if (!accountId) {
            window.Logger.warn('StateManager', 'Cannot load gallery data - no account ID provided');
            return false;
        }

        try {
            window.Logger.info('StateManager', `📂 Loading gallery data from IndexedDB for account ${accountId.substring(0, 8)}...`);

            const posts = await this.indexedDBManager.getGalleryPosts(accountId, {
                sortBy: 'timestamp',
                limit: null // Load all (up to MAX_GALLERY_POSTS limit enforced by IndexedDB)
            });

            // CHECK FOR ORPHANS: Also load 'default' posts to migrate them
            if (accountId !== 'default') {
                const defaultPosts = await this.indexedDBManager.getGalleryPosts('default', { limit: null });
                if (defaultPosts && defaultPosts.length > 0) {
                    window.Logger.info('StateManager', `🧹 Found ${defaultPosts.length} orphaned 'default' posts. Migrating to ${accountId}...`);

                    // Update account ID for these posts
                    const migratedPosts = defaultPosts.map(p => ({ ...p, accountId: accountId }));

                    // Save updated posts back to IndexedDB (permanently fix them)
                    await this.indexedDBManager.saveGalleryPosts(migratedPosts, accountId);

                    // Add to main list so they appear immediately
                    if (posts) {
                        posts.push(...migratedPosts);
                    }
                }
            }

            if (!posts || posts.length === 0) {
                window.Logger.info('StateManager', 'No stored gallery data found for this account');
                return false;
            }

            // Ingest stored posts (this rebuilds video/image indexes)
            this.ingestGalleryData(posts, {
                source: 'indexeddb',
                accountId: accountId
            });

            window.Logger.info('StateManager', `✅ Loaded ${posts.length} posts from IndexedDB`);
            return true;
        } catch (error) {
            window.Logger.error('StateManager', '❌ Failed to load gallery data from IndexedDB:', error);
            return false;
        }
    }

    /**
     * Ingest gallery data from /rest/media/post/list API response
     * @param {Array} posts - Array of post objects from API
     * @param {Object} meta - Metadata about the API call
     * @returns {Object} Ingestion results
     */
    ingestGalleryData(posts, meta = {}) {
        if (!Array.isArray(posts) || !posts.length) {
            window.Logger.warn('StateManager', 'No posts provided to ingestGalleryData');
            return { success: false, reason: 'empty-posts' };
        }

        window.Logger.debug('StateManager', '📥 Ingesting gallery data', {
            postCount: posts.length,
            source: meta.source || 'unknown',
            existingPosts: this.state.galleryData.posts.length,
            existingVideos: this.state.galleryData.videoIndex.size
        });

        // MERGE new posts with existing ones (de-dupe by imageId)
        // ORDER-PRESERVING MERGE: The new batch's order is canonical (it mirrors /list API order).
        // If the new batch is larger than existing, use new order as base; existing-only posts append.
        const _getId = p => p.imageId || p.postId || p.raw?.id || p.id;

        const existingById = new Map();
        this.state.galleryData.posts.forEach(p => {
            const id = _getId(p);
            if (id) existingById.set(id, p);
        });

        const newById = new Map();
        posts.forEach(p => {
            const id = _getId(p);
            if (id) newById.set(id, p);
        });

        // Start with the new batch in its original array order
        const merged = [...posts];
        const mergedIds = new Set(posts.map(_getId).filter(Boolean));

        // Append any existing-only posts that aren't in the new batch (preserves their data)
        for (const [id, existingPost] of existingById) {
            if (!mergedIds.has(id)) {
                merged.push(existingPost);
            }
        }

        this.state.galleryData.posts = merged;
        this.state.galleryData.lastUpdate = Date.now();
        this.state.galleryData.source = meta.source || null;

        // Rebuild indexes from ALL merged posts (not just new ones)
        const videoIndex = new Map();
        const imageIndex = new Map();
        let videoCount = 0;

        this.state.galleryData.posts.forEach(post => {
            // NetworkInterceptor normalizes posts - raw data is in post.raw
            const rawPost = post.raw || post;
            const imageId = post.imageId || rawPost.id;

            // DEBUG: Log first post structure
            if (posts.indexOf(post) === 0) {
                window.Logger.debug('StateManager', '🔍 First post structure:', {
                    normalized: Object.keys(post),
                    hasRaw: !!post.raw,
                    rawKeys: post.raw ? Object.keys(post.raw).slice(0, 15) : [],
                    imageId: imageId,
                    mediaType: rawPost.mediaType,
                    hasChildPosts: Array.isArray(rawPost.childPosts),
                    childPostsCount: rawPost.childPosts?.length || 0
                });
                if (rawPost.childPosts?.length > 0) {
                    window.Logger.debug('StateManager', '🔍 First childPost:', rawPost.childPosts[0]);
                }
            }

            if (imageId) {
                imageIndex.set(imageId, post);
            }

            // Extract videos from childPosts (check raw post)
            if (Array.isArray(rawPost.childPosts)) {
                rawPost.childPosts.forEach(video => {
                    if (video.mediaType === 'MEDIA_POST_TYPE_VIDEO') {
                        const videoId = video.id;
                        if (videoId) {
                            videoIndex.set(videoId, {
                                ...video,
                                parentPost: post,
                                parentImageId: imageId,
                                parentImageUrl: post.imageUrl || rawPost.mediaUrl,
                                parentThumbnailUrl: post.thumbnailUrl || rawPost.thumbnailImageUrl,
                                parentPrompt: rawPost.prompt || rawPost.originalPrompt,
                                isApiSource: true,
                                liked: post.likeStatus || false
                            });
                            videoCount++;
                        }
                    }
                });
            }

            // Also check if the raw post itself is a video (not a child)
            if (rawPost.mediaType === 'MEDIA_POST_TYPE_VIDEO' && rawPost.mediaUrl) {
                const videoId = rawPost.id;
                if (videoId && !videoIndex.has(videoId)) {
                    videoIndex.set(videoId, {
                        ...rawPost,
                        parentPost: null,
                        parentImageId: rawPost.originalPostId || null,
                        parentImageUrl: null,
                        parentThumbnailUrl: post.thumbnailUrl || rawPost.thumbnailImageUrl,
                        parentPrompt: rawPost.prompt || rawPost.originalPrompt,
                        isApiSource: true,
                        liked: post.likeStatus || false
                    });
                    videoCount++;
                    window.Logger.debug('StateManager', '📹 Found standalone video post:', videoId);
                }
            }
        });

        this.state.galleryData.videoIndex = videoIndex;
        this.state.galleryData.imageIndex = imageIndex;

        window.Logger.info('StateManager', '✅ Gallery data ingested', {
            newPosts: posts.length,
            totalPosts: this.state.galleryData.posts.length,
            totalVideos: videoIndex.size,
            totalImages: imageIndex.size,
            source: meta.source
        });

        // ✅ NEW: Persist to IndexedDB for cross-session availability
        if (this.indexedDBManager) {
            // Extract account ID from posts or use active account
            let accountId = meta.accountId;
            if (!accountId && this.state.galleryData.posts.length > 0) {
                // Try to extract from first post with userId (correct field from API)
                // Fallback to accountId for backward compat
                const postWithAccount = this.state.galleryData.posts.find(p => p.userId || p.accountId);
                accountId = postWithAccount?.userId || postWithAccount?.accountId;

                if (accountId) {
                    if (accountId) {
                        window.Logger.debug('StateManager', `📋 Extracted account ID from gallery posts: ${accountId.substring(0, 12)}...`);
                    }
                }

                if (!accountId) {
                    accountId = this.state.multiGenHistory.activeAccountId;
                }

                if (accountId) {
                    window.Logger.info('StateManager', `✅ Setting active account ID from gallery data: ${accountId.substring(0, 12)}...`);
                    this.state.activeAccountId = accountId;
                    // SYNC: Ensure multiGenHistory also has the ID
                    if (this.state.multiGenHistory) {
                        this.state.multiGenHistory.activeAccountId = accountId;
                    }

                    // ✅ Trigger unified history load only if not already loaded for this account
                    // FIX: Prevents redundant IndexedDB reads on every /list scroll
                    const alreadyLoaded = this.state.unifiedHistory.length > 0 &&
                        this.state.unifiedHistory[0]?.accountId === accountId;

                    if (this.indexedDBManager?.initialized && !alreadyLoaded) {
                        window.Logger.info('StateManager', '📥 First load of unified history for account...');
                        this.loadUnifiedHistory(accountId).catch(err =>
                            window.Logger.error('StateManager', '❌ Failed to auto-load unified history:', err)
                        );
                    }
                }

                // NOTE: Gallery data now persisted via unified storage in NetworkInterceptor
                window.Logger.info('StateManager', `ℹ️ Gallery data in-memory only (${this.state.galleryData.posts.length} posts), persistence handled by unified storage`);

                // Dispatch event for UI updates
                this._dispatchGalleryDataUpdate({
                    reason: 'ingestion',
                    postCount: posts.length,
                    videoCount,
                    source: meta.source
                });

                // ✅ NEW v6: Also ingest into unified storage
                // This handles cases where page bridge calls StateManager directly
                if (this.state.activeAccountId) {
                    // We can trigger a background sync or just rely on the next loadUnifiedHistory
                    // For now, let's just log it
                    // console.log('[GVP StateManager] ℹ️ Gallery ingestion complete, unified storage will be updated on next sync');
                }
            }

            return {
                success: true,
                postCount: posts.length,
                videoCount,
                imageCount: imageIndex.size
            };
        }
    }

    /**
     * Get video data by videoId
     * @param {string} videoId - Video identifier
     * @returns {Object|null} Video object or null
     */
    getVideoById(videoId) {
        if (!videoId) return null;
        return this.state.galleryData.videoIndex.get(videoId) || null;
    }

    /**
     * Load gallery data from IndexedDB for the given account
     * @param {string} accountId - Account ID to load data for
     * @returns {Promise<boolean>} True if data was loaded, false otherwise
     */
    async loadGalleryDataFromIndexedDB(accountId) {
        if (!this.indexedDBManager || !accountId) {
            return false;
        }

        try {
            // LIMIT: Only load last 500 posts to prevent memory bloat
            const posts = await this.indexedDBManager.getGalleryPosts(accountId, {
                limit: 500,
                sortBy: 'timestamp'
            });

            if (!posts || posts.length === 0) {
                window.Logger.info('StateManager', `No gallery data found in IndexedDB for account ${accountId.substring(0, 8)}...`);
                return false;
            }

            // Clear existing data
            this.state.galleryData.posts = [];
            this.state.galleryData.videoIndex.clear();
            this.state.galleryData.imageIndex.clear();

            // Ingest loaded posts
            this.ingestGalleryData(posts, {
                source: 'indexeddb-load',
                accountId: accountId
            });

            window.Logger.info('StateManager', `✅ Loaded ${posts.length} gallery posts from IndexedDB`);
            return true;
        } catch (error) {
            window.Logger.error('StateManager', '❌ Failed to load gallery data from IndexedDB', error);
            return false;
        }
    }

    /**
     * NEW v6: Load unified video history from IndexedDB for the given account
     * @param {string} accountId - Account ID to load data for
     * @returns {Promise<boolean>} True if data was loaded, false otherwise
     */
    async loadUnifiedHistory(accountId) {
        if (!this.indexedDBManager || !accountId) {
            window.Logger.warn('StateManager', '❌ Cannot load unified history - IndexedDB or accountId missing', {
                hasIndexedDB: !!this.indexedDBManager,
                hasAccountId: !!accountId
            });
            return false;
        }

        try {
            window.Logger.debug('StateManager', '🔍 Fetching entries from IndexedDB...');

            // Load ALL entries (no limit)
            const entries = await this.indexedDBManager.getAllUnifiedEntries(accountId, 0);

            if (!entries || entries.length === 0) {
                window.Logger.info('StateManager', `ℹ️ No unified history found for account ${accountId.substring(0, 8)}...`);
                this.state.unifiedHistory = [];
                return false;
            }

            window.Logger.debug('StateManager', '📊 Processing loaded entries...', {
                entryCount: entries.length
            });

            this.state.unifiedHistory = entries;

            // Backfill missing thumbnails from known fields and persist updates
            const updatedEntries = this._enrichUnifiedThumbnails(entries);
            if (updatedEntries.length > 0 && this.indexedDBManager?.saveUnifiedEntries) {
                try {
                    await this.indexedDBManager.saveUnifiedEntries(updatedEntries);
                    window.Logger.info('StateManager', `✅ Backfilled thumbnails for ${updatedEntries.length} entries`);
                } catch (saveErr) {
                    window.Logger.warn('StateManager', '⚠️ Failed to persist backfilled thumbnails', saveErr);
                }
            }

            const totalVideos = entries.reduce((sum, e) => sum + e.attempts.length, 0);

            window.Logger.info('StateManager', `✅ Loaded ${entries.length} unified entries from IndexedDB`, {
                imageCount: entries.length,
                totalVideos: totalVideos,
                sampleImageIds: entries.slice(0, 5).map(e => e.imageId),
                firstImageVideoCount: entries[0]?.attempts.length || 0
            });

            // Dispatch event for UI update
            window.Logger.debug('StateManager', '📢 Dispatching gvp-unified-history-loaded event...');
            window.dispatchEvent(new CustomEvent('gvp-unified-history-loaded', {
                detail: {
                    accountId: accountId,
                    entryCount: entries.length,
                    videoCount: totalVideos
                }
            }));

            window.Logger.debug('StateManager', '✅ Event dispatched successfully');

            return true;
        } catch (error) {
            window.Logger.error('StateManager', '❌ Failed to load unified history', {
                error,
                accountId: accountId?.substring(0, 12),
                errorMessage: error.message,
                errorStack: error.stack
            });
            this.state.unifiedHistory = [];
            return false;
        }
    }

    /**
     * Get unified history entries for UI rendering
     * @param {Object} options - Options { clone: boolean }
     * @returns {Array<Object>} Array of unified history entries
     */
    getUnifiedHistoryEntries(options = { clone: false }) {
        if (!this.state.unifiedHistory) {
            return [];
        }

        if (options.clone) {
            return JSON.parse(JSON.stringify(this.state.unifiedHistory));
        }

        return this.state.unifiedHistory;
    }

    /**
     * Flatten unified history entries into individual videos for UI components
     * @param {string|null} accountId - Optional account filter
     * @param {Object} options - { sortBy: 'newest' | 'oldest' }
     * @returns {Array<Object>} Array of video objects
     */
    getAllUnifiedVideos(accountId = null, options = {}) {
        const sortBy = options.sortBy || 'newest';
        const entries = this.getUnifiedHistoryEntries({ clone: false }) || [];
        const filteredEntries = accountId
            ? entries.filter(e => e.accountId === accountId)
            : entries;

        const videos = [];

        // Normalize video URLs - ensure they have proper domains
        const normalizeVideoUrl = (url) => {
            if (!url) return null;
            // Already absolute URL
            if (url.startsWith('https://') || url.startsWith('http://')) {
                return url;
            }
            // Relative URL starting with 'users/' - add domain
            if (url.startsWith('users/')) {
                return `https://assets.grok.com/${url}`;
            }
            // Other relative paths
            if (url.startsWith('/')) {
                return `https://assets.grok.com${url}`;
            }
            // Unknown format - prefix anyway
            return `https://assets.grok.com/${url}`;
        };

        const coerceTime = (value) => {
            if (!value) return 0;
            const ts = typeof value === 'number' ? value : Date.parse(value);
            return Number.isFinite(ts) ? ts : 0;
        };

        const seenVideoIds = new Set();

        filteredEntries.forEach(entry => {
            const parentImageId = entry.imageId;
            const parentThumb = entry.imageThumbnailUrl
                || entry.thumbnailUrl
                || entry.thumbnailImageUrl
                || entry.imageUrl
                || entry.imageReference
                || null;
            const parentPrompt = entry.imagePrompt
                || entry.prompt
                || entry.projectSettings?.prompt
                || '';
            const parentTime = entry.updatedAt || entry.createdAt || entry.imageCreateTime || entry.createTime;

            if (!Array.isArray(entry.attempts)) {
                return;
            }

            entry.attempts.forEach(attempt => {
                const effectiveVideoId = attempt.videoId || attempt.id;

                // DEDUPLICATION: Check if we've already seen this video ID
                if (effectiveVideoId && seenVideoIds.has(effectiveVideoId)) {
                    return;
                }

                if (attempt.videoId) {
                    seenVideoIds.add(attempt.videoId);
                }
                // Also track the ID itself (which might be the videoId or an attempt GUID)
                seenVideoIds.add(attempt.id);

                const attemptId = attempt.id || attempt.videoId || `attempt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                videos.push({
                    id: attemptId,
                    virtualId: `${parentImageId}_${attemptId}`,
                    videoUrl: normalizeVideoUrl(attempt.upscaledVideoUrl || attempt.videoUrl || attempt.mediaUrl),
                    upscaledVideoUrl: normalizeVideoUrl(attempt.upscaledVideoUrl),
                    thumbnailUrl: attempt.thumbnailUrl
                        || attempt.thumbnailImageUrl
                        || parentThumb,
                    thumbnailImageUrl: attempt.thumbnailImageUrl
                        || attempt.thumbnailUrl
                        || parentThumb,
                    videoPrompt: attempt.videoPrompt || '',
                    mode: attempt.mode || 'normal',
                    modelName: attempt.modelName,
                    resolution: attempt.resolution,
                    timestamp: attempt.timestamp || attempt.finishedAt || attempt.startedAt || parentTime,
                    parentImageId: attempt.parentImageId || parentImageId,
                    parentImageThumbnail: parentThumb,
                    parentImagePrompt: parentPrompt,
                    liked: entry.liked || false,
                    isApiSource: attempt.isApiSource !== false,
                    status: attempt.status || 'success'
                });
            });
        });

        if (sortBy === 'oldest') {
            videos.sort((a, b) => coerceTime(a.timestamp) - coerceTime(b.timestamp));
        } else {
            videos.sort((a, b) => coerceTime(b.timestamp) - coerceTime(a.timestamp));
        }

        return videos;
    }

    /**
     * Upscale a video
     * @param {string} videoId - The virtual ID of the video (imageId_attemptId)
     * @returns {Promise<string|null>} The upscaled video URL or null
     */
    async upscaleVideo(videoId) {
        window.Logger.debug('StateManager', '🔄 upscaleVideo called with:', videoId);

        if (!videoId) {
            window.Logger.error('StateManager', '❌ upscaleVideo aborted: Missing videoId');
            return null;
        }

        // Parse IDs
        const parts = videoId.split('_');
        if (parts.length < 2) {
            window.Logger.error('StateManager', '❌ upscaleVideo aborted: Invalid ID format', videoId);
            return null;
        }

        const imageId = parts[0];
        const attemptId = parts.slice(1).join('_');

        window.Logger.info('StateManager', '⚡ Upscaling video...', { imageId, attemptId });

        // Find the attempt
        const imageEntry = this.state.multiGenHistory.images.get(imageId);
        if (!imageEntry) {
            window.Logger.error('StateManager', 'Image entry not found', imageId);
            return null;
        }

        const attempt = imageEntry.attempts.find(a => a.id === attemptId);
        if (!attempt) {
            window.Logger.error('StateManager', 'Attempt not found', attemptId);
            return null;
        }

        const originalUrl = attempt.videoUrl || attempt.mediaUrl;
        // Fix: Strip 'attempt_' prefix if present to get the raw UUID
        // Prioritize the explicit videoId (UUID) if available, otherwise fallback to stripping "attempt_" from the ID
        const originalId = attempt.videoId || attempt.id.replace(/^attempt_/, '');

        if (!originalId) {
            window.Logger.error('StateManager', 'No video ID found for attempt', attemptId);
            return null;
        }

        try {
            // Call Upscale API
            // Endpoint: /rest/media/video/upscale
            // Payload: { videoId: "uuid" }
            const payload = { videoId: originalId };
            window.Logger.debug('StateManager', '🚀 Sending Upscale Request:', payload);

            const response = await fetch('/rest/media/video/upscale', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Upscale API failed: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const data = await response.json();
            window.Logger.debug('StateManager', '📥 Upscale Response:', data);

            const upscaledUrl = data.hdMediaUrl;

            if (!upscaledUrl) {
                throw new Error('No hdMediaUrl returned from API');
            }

            window.Logger.info('StateManager', '✅ Upscale successful:', upscaledUrl);

            // Update State
            attempt.upscaledVideoUrl = upscaledUrl;

            // Persist
            // We need to update the entire unified entry
            // Find the unified entry in state.unifiedHistory if possible, or build it
            // Actually `multiGenHistory.images` is derived from unifiedHistory
            // So updating `imageEntry` (which is a reference to the object in the map) should be enough IF `saveUnifiedEntry` uses it.

            // Re-construct Unified Entry from imageEntry to save it?
            // IndexedDBManager.saveUnifiedEntry expects the unified structure.
            // checking imageEntry structure: it has `attempts` array.
            // It should be compatible.

            if (this.indexedDBManager) {
                window.Logger.debug('StateManager', '💾 Persisting upscale to IndexedDB...', {
                    imageId: imageEntry.imageId,
                    accountId: imageEntry.accountId,
                    upscaledUrl
                });
                await this.indexedDBManager.saveUnifiedEntry(imageEntry);
            }

            // Dispatch update event

            window.dispatchEvent(new CustomEvent('gvp-unified-history-updated', {
                detail: {
                    action: 'update',
                    entryId: imageEntry.imageId
                }
            }));

            return upscaledUrl;

        } catch (error) {
            window.Logger.error('StateManager', '❌ Upscale failed', error);
            // Optional: return null or throw?
            // Let's return null and let UI handle error
            return null;
        }
    }

    /**
     * v1.21.16: ROBUST SYNC - Only enriches entries that are incomplete
     * ENFORCES `dataSyncComplete` flag to prevent redundant writes
     * @param {Array} entries
     * @returns {Array} entries that were modified
     */
    _enrichUnifiedThumbnails(entries = []) {
        const updated = [];
        let skippedComplete = 0;
        let skippedHasThumb = 0;

        for (const entry of entries) {
            if (!entry || !Array.isArray(entry.attempts)) continue;

            // CRITICAL: If entry is marked as fully synced, DO NOT TOUCH IT
            // This guarantees we never re-process completed entries
            if (entry.dataSyncComplete === true || entry.thumbnailsPopulated === true) {
                skippedComplete++;
                continue;
            }

            // Check if we have the minimum required data to be considered "Complete"
            // 1. Must have a thumbnail (or be a video-only entry with a video thumbnail)
            // 2. Must have at least one attempt (if it's a video generation)
            // 3. Must have a prompt
            const hasThumbnail = !!(entry.thumbnailUrl || entry.imageThumbnailUrl || entry.imageUrl);
            const hasAttempts = entry.attempts.length > 0;
            const hasPrompt = !!(entry.prompt || entry.imagePrompt);

            // If we have all critical data, mark as complete and SAVE ONE LAST TIME
            if (hasThumbnail && hasAttempts && hasPrompt) {
                entry.dataSyncComplete = true; // NEW Flag (Semantic)
                entry.thumbnailsPopulated = true; // Legacy Flag (Backwards Compat)
                updated.push(entry);
                continue;
            }

            // If we are here, something is missing. Try to "Smart Repair" from attempts or Gallery Data.
            let modified = false;

            // 1. Repair from Internal Attempts (Self-Healing)
            if (!hasThumbnail) {
                for (const attempt of entry.attempts) {
                    const candidate = attempt.thumbnailUrl || attempt.imageReference || attempt.thumbnailImageUrl;
                    if (candidate) {
                        entry.thumbnailUrl = candidate;
                        entry.imageThumbnailUrl = candidate;
                        modified = true;
                        break;
                    }
                }
            }

            if (!hasPrompt) {
                for (const attempt of entry.attempts) {
                    if (attempt.videoPrompt || attempt.prompt) {
                        entry.imagePrompt = attempt.videoPrompt || attempt.prompt;
                        entry.prompt = entry.imagePrompt;
                        modified = true;
                        break;
                    }
                }
            }

            // 2. Repair from External Gallery Data (Cross-Healing)
            // If internal attempts failed, check the scraped Gallery Posts
            // NOTE: 'galleryData.imageIndex' is the Map<imageId, post> built by ingestGalleryData
            if ((!entry.thumbnailUrl || !entry.imagePrompt) && this.state.galleryData?.imageIndex) {
                // Try to find matching post by Image ID
                let galleryPost = this.state.galleryData.imageIndex.get(entry.imageId);

                // Fallback: If not formatted as imageId, try finding it in videoIndex (for standalone videos)
                if (!galleryPost && this.state.galleryData.videoIndex) {
                    // Sometimes entry.imageId IS the videoId in legacy data
                    const videoData = this.state.galleryData.videoIndex.get(entry.imageId);
                    if (videoData) {
                        galleryPost = {
                            thumbnailUrl: videoData.thumbnailUrl || videoData.parentThumbnailUrl,
                            prompt: videoData.prompt || videoData.parentPrompt
                        };
                    }
                }

                if (galleryPost) {
                    if (!entry.thumbnailUrl && galleryPost.thumbnailUrl) {
                        entry.thumbnailUrl = galleryPost.thumbnailUrl;
                        entry.imageThumbnailUrl = galleryPost.thumbnailUrl;
                        modified = true;
                    }
                    if (!entry.imagePrompt && (galleryPost.prompt || galleryPost.originalPrompt)) {
                        entry.imagePrompt = galleryPost.prompt || galleryPost.originalPrompt;
                        entry.prompt = entry.imagePrompt;
                        modified = true;
                    }
                }
            }

            // If we managed to fix it, mark as complete
            if (modified) {
                // Check completeness again
                if (entry.thumbnailUrl && (entry.prompt || entry.imagePrompt)) {
                    entry.dataSyncComplete = true;
                    entry.thumbnailsPopulated = true;
                }
                updated.push(entry);
            }
        }

        if (skippedComplete > 0 || updated.length > 0) {
            window.Logger.info('StateManager', `🔒 Sync Check: ${skippedComplete} locked (complete), ${updated.length} updated/repaired`);
        }

        return updated;
    }

    /**
     * Diagnostic Tool: Smart Repair for Oldest and Newest Entries
     * Scans for incomplete entries and attempts to fix them internally
     * @returns {Promise<Object>} Report of actions taken
     */
    async enrichOldestAndNewest() {
        return this.repairAllUnifiedData();
    }

    /**
     * FULL REPAIR: Scans and repairs ALL unified history entries
     * Essential for recovering from mass data wipes or migrations
     */
    async repairAllUnifiedData() {
        window.Logger.info('StateManager', '🔧 Starting FULL Smart Repair...');
        const entries = this.state.unifiedHistory || [];
        if (entries.length === 0) return { error: 'No history', count: 0 };

        window.Logger.info('StateManager', `🔧 Analyzing ALL ${entries.length} entries for repair...`);

        // Run verification logic on EVERYTHING
        const updated = this._enrichUnifiedThumbnails(entries);

        let saveSuccess = false;
        if (updated.length > 0 && this.indexedDBManager) {
            // Batch save in chunks of 500 to avoid IDB transactions timing out
            const chunkSize = 500;
            for (let i = 0; i < updated.length; i += chunkSize) {
                const chunk = updated.slice(i, i + chunkSize);
                window.Logger.debug('StateManager', `💾 Saving repair chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(updated.length / chunkSize)}...`);
                await this.indexedDBManager.saveUnifiedEntries(chunk);
            }
            saveSuccess = true;
        }

        const report = {
            scanned: entries.length,
            repairedAndSaved: updated.length,
            alreadyComplete: entries.filter(e => e.dataSyncComplete === true).length,
            stillIncomplete: entries.filter(e => !e.dataSyncComplete).length,
            saveSuccess
        };

        window.Logger.info('StateManager', '✅ Full Repair Complete', report);
        return report;
    }

    /**
     * v1.21.16: Diagnostic tool - Analyze 20 oldest + 20 newest entries for missing fields
     * Returns a report of which fields are missing across sample entries
     * @returns {Object} Diagnostic report
     */
    async diagnosticUnifiedHistory() {
        const entries = this.state.unifiedHistory || [];
        if (entries.length === 0) {
            return { error: 'No entries in unified history', total: 0 };
        }

        // Sort by createdAt (oldest first for oldest, newest first for newest)
        const sorted = [...entries].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        const oldest20 = sorted.slice(0, 20);
        const newest20 = sorted.slice(-20).reverse();

        // Define required fields for entry-level
        const entryFields = ['imageId', 'accountId', 'thumbnailUrl', 'createdAt', 'thumbnailsPopulated'];
        // Define required fields for attempt-level  
        const attemptFields = ['videoId', 'videoUrl', 'prompt', 'status', 'finishedAt'];

        const analyzeEntries = (entriesList, label) => {
            const results = [];

            for (const entry of entriesList) {
                const missingEntry = [];
                const attemptIssues = [];

                // Check entry-level fields
                for (const field of entryFields) {
                    if (!entry[field]) {
                        missingEntry.push(field);
                    }
                }

                // Check attempt-level fields
                if (Array.isArray(entry.attempts)) {
                    entry.attempts.forEach((attempt, idx) => {
                        const missingAttempt = [];
                        for (const field of attemptFields) {
                            if (!attempt[field]) {
                                missingAttempt.push(field);
                            }
                        }
                        if (missingAttempt.length > 0) {
                            attemptIssues.push({ index: idx, missing: missingAttempt });
                        }
                    });
                }

                if (missingEntry.length > 0 || attemptIssues.length > 0) {
                    results.push({
                        imageId: entry.imageId?.substring(0, 8) + '...',
                        createdAt: entry.createdAt?.substring(0, 10) || 'N/A',
                        attemptCount: entry.attempts?.length || 0,
                        missingFields: missingEntry,
                        attemptIssues: attemptIssues.length > 0 ? attemptIssues : null
                    });
                }
            }

            return {
                label,
                total: entriesList.length,
                withIssues: results.length,
                clean: entriesList.length - results.length,
                issues: results
            };
        };

        const oldestReport = analyzeEntries(oldest20, '20 Oldest');
        const newestReport = analyzeEntries(newest20, '20 Newest');

        // Count overall field presence
        const fieldStats = {};
        for (const field of [...entryFields]) {
            fieldStats[field] = {
                present: entries.filter(e => !!e[field]).length,
                missing: entries.filter(e => !e[field]).length
            };
        }

        return {
            total: entries.length,
            entriesWithThumbnails: entries.filter(e => !!e.thumbnailUrl).length,
            entriesMarkedPopulated: entries.filter(e => e.thumbnailsPopulated === true).length,
            oldest: oldestReport,
            newest: newestReport,
            fieldStats
        };
    }

    /**
     * Get post (image) data by imageId
     * @param {string} imageId - Image identifier
     * @returns {Object|null} Post object or null
     */
    getImageById(imageId) {
        if (!imageId) return null;
        return this.state.galleryData.imageIndex.get(imageId) || null;
    }

    /**
     * Get all videos from gallery data
     * @returns {Array} Array of video objects with enriched parent data
     */
    getAllVideosFromGallery() {
        return Array.from(this.state.galleryData.videoIndex.values());
    }

    /**
     * Get videos filtered by criteria
     * @param {Object} filters - Filter criteria
     * @returns {Array} Filtered video array
     */
    getFilteredVideos(filters = {}) {
        const videos = this.getAllVideosFromGallery();

        let filtered = videos;

        // Filter by mode (normal, custom, extremely-spicy-or-crazy)
        if (filters.mode) {
            filtered = filtered.filter(v => v.mode === filters.mode);
        }

        // Filter by liked status
        if (filters.liked === true) {
            filtered = filtered.filter(v => {
                // Check normalized post likeStatus
                if (v.parentPost?.likeStatus === true) return true;
                // Check raw post userInteractionStatus
                if (v.parentPost?.raw?.userInteractionStatus?.likeStatus === true) return true;
                // Check liked field directly on video
                if (v.liked === true) return true;
                return false;
            });
        }

        // Filter by date range
        if (filters.startDate) {
            filtered = filtered.filter(v =>
                new Date(v.createTime) >= new Date(filters.startDate)
            );
        }

        if (filters.endDate) {
            filtered = filtered.filter(v =>
                new Date(v.createTime) <= new Date(filters.endDate)
            );
        }

        // Filter by has prompt
        if (filters.hasPrompt === true) {
            filtered = filtered.filter(v =>
                (v.originalPrompt && v.originalPrompt.trim().length > 0) ||
                (v.parentPrompt && v.parentPrompt.trim().length > 0)
            );
        }

        return filtered;
    }

    /**
     * Check if gallery data is available
     * @returns {boolean} True if data is available
     */
    hasGalleryData() {
        const data = this.state.galleryData;
        const hasData = data.posts.length > 0 && data.lastUpdate !== null;

        window.Logger.debug('StateManager', '🔍 hasGalleryData check', {
            posts: data.posts.length,
            videos: data.videoIndex.size,
            lastUpdate: data.lastUpdate,
            source: data.source,
            result: hasData
        });

        // Gallery data is valid for entire session - no expiry
        // User is browsing historical favorites that don't change
        return hasData;
    }

    /**
     * Clear gallery data
     */
    clearGalleryData() {
        this.state.galleryData = {
            posts: [],
            videoIndex: new Map(),
            imageIndex: new Map(),
            lastUpdate: null,
            source: null
        };

        window.Logger.info('StateManager', '🗑️ Gallery data cleared');

        this._dispatchGalleryDataUpdate({
            reason: 'cleared'
        });
    }

    /**
     * Dispatch gallery data update event
     * @private
     */
    _dispatchGalleryDataUpdate(detail) {
        try {
            window.dispatchEvent(new CustomEvent('gvp:gallery-data-updated', {
                detail: { ...(detail || {}) }
            }));
        } catch (error) {
            window.Logger.error('StateManager', 'Failed to dispatch gallery data event', error);
        }
    }

    /**
     * Get gallery data statistics
     * @returns {Object} Statistics about gallery data
     */
    getGalleryDataStats() {
        const data = this.state.galleryData;

        const stats = {
            totalPosts: data.posts.length,
            totalVideos: data.videoIndex.size,
            totalImages: data.imageIndex.size,
            lastUpdate: data.lastUpdate,
            source: data.source,
            age: data.lastUpdate ? Date.now() - data.lastUpdate : null,
            isFresh: this.hasGalleryData()
        };

        // Count by mode
        const modeCount = { normal: 0, custom: 0, spicy: 0, other: 0 };
        this.state.galleryData.videoIndex.forEach(video => {
            if (video.mode === 'normal') modeCount.normal++;
            else if (video.mode === 'custom') modeCount.custom++;
            else if (video.mode === 'extremely-spicy-or-crazy') modeCount.spicy++;
            else modeCount.other++;
        });
        stats.modeCount = modeCount;

        // Count liked videos
        stats.likedVideos = Array.from(data.videoIndex.values())
            .filter(v => v.parentPost?.userInteractionStatus?.likeStatus === true)
            .length;

        return stats;
    }
    /**
     * Trigger legacy store cleanup (v7)
     */
    async cleanupLegacyStores() {
        if (this.indexedDBManager) {
            return await this.indexedDBManager.cleanupLegacyStores();
        }
        return false;
    }

    /**
     * Get current state snapshot
     */
    getState() {
        return { ...this.state };
    }

    /**
     * DEBUG TOOL: Scans Unified History for entries that are marked "complete"
     * but are missing critical data (videoUrl/thumbnailUrl/prompt).
     * @returns {Array} List of problematic entry IDs
     */
    async debugLogMissingData() {
        window.Logger.debug('StateManager', 'Scanning Unified History for incomplete "completed" entries...');

        // Ensure we have the latest data
        if (!this.state.unifiedHistory || this.state.unifiedHistory.length === 0) {
            await this.loadUnifiedHistoryFromIndexedDB();
        }

        const missingEntries = [];
        const stats = {
            total: this.state.unifiedHistory.length,
            missingThumbnail: 0,
            missingVideoUrl: 0,
            missingPrompt: 0,
            missingAttempts: 0
        };

        for (const entry of this.state.unifiedHistory) {
            // Check for missing parent metadata
            let isIncomplete = false;
            let issues = [];

            // Case 1: Parent missing thumbnail
            if (!entry.thumbnailUrl && !entry.videoUrl && !entry.imageUrl) {
                // It's just a shell
                issues.push('NO_MEDIA');
            }

            // Case 2: "Completed" child videos missing URL/Thumbnail
            if (entry.generatedVideoAttempts && entry.generatedVideoAttempts.length > 0) {
                entry.generatedVideoAttempts.forEach(attempt => {
                    if (attempt.status === 'success' || attempt.status === 'completed') {
                        if (!attempt.videoUrl) {
                            stats.missingVideoUrl++;
                            issues.push(`Video ${attempt.id} missing URL`);
                            isIncomplete = true;
                        }
                        if (!attempt.thumbnailUrl) {
                            stats.missingThumbnail++;
                            issues.push(`Video ${attempt.id} missing Thumb`);
                            isIncomplete = true;
                        }
                    }
                });
            } else if (entry.dataSyncComplete && (!entry.generatedVideoAttempts || entry.generatedVideoAttempts.length === 0)) {
                // Marked as synced but has no videos? might be correct if it's just an image, 
                // but if we are looking for lost children, this is a candidate.
                stats.missingAttempts++;
                issues.push('Marked Complete but No Videos');
                isIncomplete = true;
            }

            if (isIncomplete) {
                missingEntries.push({
                    id: entry.id,
                    issues: issues,
                    type: entry.mediaType
                });
            }
        }

        window.Logger.debug('StateManager', 'Scan Complete', {
            stats: stats,
            missingEntries: missingEntries
        });
        window.Logger.debug('StateManager', `Found ${missingEntries.length} candidates for repair.`);
        return missingEntries;
    }

    /**
     * Finds the first "Ghost" entry (Marked complete but no videos) and returns it raw.
     * Used for user verification.
     */
    inspectFirstGhostEntry() {
        if (!this.state.unifiedHistory) return null;

        const ghost = this.state.unifiedHistory.find(e => e.dataSyncComplete && (!e.generatedVideoAttempts || e.generatedVideoAttempts.length === 0));

        if (ghost) {
            window.Logger.debug('StateManager', '👻 Found Ghost Entry:', ghost);

            // DIAGNOSTIC SCRIPT for USER
            if (ghost.id && ghost.id.startsWith('attempt_')) {
                ghost._Analysis = "CRITICAL: This is an ATTEMPT id saved as a Parent Entry. It is a 'Zombie'. It has no videos because it IS a video.";
            } else if (ghost.status === 'moderated') {
                ghost._Analysis = "CRITICAL: This object has a 'status' field. Parent entries should NOT have status. It looks like a saved Attempt.";
            } else {
                ghost._Analysis = "This is a Parent Image Entry, but its 'generatedVideoAttempts' list is empty. We need to fetch the child videos from Grok.";
            }

            return ghost;
        } else {
            window.Logger.debug('StateManager', 'No ghost entries found.');
            return null;
        }
    }

    /**
     * REPAIR FUNCTION: Fetches the last 500 items from /list and forces a re-ingest
     * leveraging the modified NetworkInterceptor logic to fill gaps.
     */
    async repairUnifiedHistoryFromListApi(limit = 500) {
        window.Logger.info('StateManager', `[Repair] Starting Smart Repair (Limit: ${limit})...`);
        const msg = `[Repair] Fetching ${limit} items from API...`;
        window.Logger.info('StateManager', msg);

        try {
            // 1. Fetch from API
            const response = await fetch('https://grok.com/rest/media/post/list', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    limit: limit,
                    filter: {
                        source: 'MEDIA_POST_SOURCE_LIKED'
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            const posts = data.items || data.posts || [];

            window.Logger.info('StateManager', `[Repair] Fetched ${posts.length} items. Ingesting...`);

            // 2. Pass to NetworkInterceptor for "Smart Ingestion"
            // Access via global app instance or UI manager fallback
            const interceptor = window.gvpAppInstance?.networkInterceptor || window.gvpUIManager?.networkInterceptor;

            if (interceptor) {
                await interceptor._ingestListToUnified(posts);
                window.Logger.info('StateManager', '[Repair] ✅ Ingestion Triggered. Check console for "Unified" logs.');

                // Trigger a re-log of missing data to show improvement
                setTimeout(() => this.debugLogMissingData(), 5000);
            } else {
                window.Logger.error('StateManager', '[Repair] ❌ NetworkInterceptor not found on window.gvpAppInstance or window.gvpUIManager!');
            }

        } catch (error) {
            window.Logger.error('StateManager', '[Repair] ❌ Failed', error);
        }
    }

    /**
     * EXPORT TOOL: Generates a JSON file of all missing/incomplete entries
     */
    async exportMissingDataReport() {
        const missingData = await this.debugLogMissingData();

        if (!missingData || missingData.length === 0) {
            alert('No missing data found to export! Your database looks healthy.');
            return 0;
        }

        const jsonString = JSON.stringify(missingData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `gvp_missing_data_report_${timestamp}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        window.Logger.info('StateManager', `[Export] Exported ${missingData.length} entries to ${filename}`);
        return missingData.length;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PREV/NEXT NAVIGATION (v1.23.27)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Extract current image ID from browser URL
     * @private
     * @returns {string|null} Image ID or null if not on an image page
     */
    _getCurrentImageIdFromUrl() {
        const match = window.location.pathname.match(/\/imagine\/post\/([^/?#]+)/i);
        return match ? match[1] : null;
    }

    /**
     * Get the next image ID for gallery navigation.
     * Strategy 1 (PRIMARY): galleryData.posts — follows /list API order (last-interacted-with first)
     * Strategy 2 (FALLBACK): multiGenHistory — sorted by timestamp DESC
     * @returns {string|null} Next image ID or null if at end
     */
    getNextImageId() {
        let currentId = this._getCurrentImageIdFromUrl();
        if (!currentId) return null;

        // Strategy 1 (PRIMARY): galleryData.posts — follows /list API order
        const galleryResult = this._getAdjacentGalleryPostId(currentId, 1);
        if (galleryResult) return galleryResult;

        // If currentId is a child/video post, resolve to parent for the fallback
        const posts = this.state.galleryData?.posts;
        if (posts?.length) {
            const _getId = p => p.imageId || p.postId || p.raw?.id || p.id;
            const resolvedId = this._resolveChildToParentId(currentId, posts, _getId);
            if (resolvedId) currentId = resolvedId;
        }

        // Strategy 2 (FALLBACK): multiGenHistory — sorted by timestamp
        const accountId = this.getActiveMultiGenAccount();
        const entries = this.getAllVideos(accountId);
        if (entries && entries.length > 0) {
            const seenImageIds = new Set();
            const uniqueImageIds = [];
            for (const entry of entries) {
                if (entry.imageId && !seenImageIds.has(entry.imageId)) {
                    seenImageIds.add(entry.imageId);
                    uniqueImageIds.push(entry.imageId);
                }
            }
            const currentIndex = uniqueImageIds.indexOf(currentId);
            if (currentIndex !== -1 && currentIndex < uniqueImageIds.length - 1) {
                return uniqueImageIds[currentIndex + 1];
            }
        }

        return null;
    }

    /**
     * Get the previous image ID for gallery navigation.
     * Strategy 1 (PRIMARY): galleryData.posts — follows /list API order (last-interacted-with first)
     * Strategy 2 (FALLBACK): multiGenHistory — sorted by timestamp DESC
     * @returns {string|null} Previous image ID or null if at start
     */
    getPrevImageId() {
        let currentId = this._getCurrentImageIdFromUrl();
        if (!currentId) return null;

        // Strategy 1 (PRIMARY): galleryData.posts — follows /list API order
        const galleryResult = this._getAdjacentGalleryPostId(currentId, -1);
        if (galleryResult) return galleryResult;

        // If currentId is a child/video post, resolve to parent for the fallback
        const posts = this.state.galleryData?.posts;
        if (posts?.length) {
            const _getId = p => p.imageId || p.postId || p.raw?.id || p.id;
            const resolvedId = this._resolveChildToParentId(currentId, posts, _getId);
            if (resolvedId) currentId = resolvedId;
        }

        // Strategy 2 (FALLBACK): multiGenHistory
        const accountId = this.getActiveMultiGenAccount();
        const entries = this.getAllVideos(accountId);
        if (entries && entries.length > 0) {
            const seenImageIds = new Set();
            const uniqueImageIds = [];
            for (const entry of entries) {
                if (entry.imageId && !seenImageIds.has(entry.imageId)) {
                    seenImageIds.add(entry.imageId);
                    uniqueImageIds.push(entry.imageId);
                }
            }
            const currentIndex = uniqueImageIds.indexOf(currentId);
            if (currentIndex > 0) {
                return uniqueImageIds[currentIndex - 1];
            }
        }

        return null;
    }

    /**
     * Find next/prev post ID from galleryData.posts (/list API order).
     * Order = most recently interacted-with first.
     * @param {string} currentId - Current post/image ID
     * @param {number} direction - +1 for next, -1 for prev
     * @returns {string|null}
     */
    _getAdjacentGalleryPostId(currentId, direction) {
        const posts = this.state.galleryData?.posts;
        if (!posts || posts.length === 0) return null;

        const _getId = p => p.imageId || p.postId || p.raw?.id || p.id;
        const postIds = posts.map(_getId).filter(Boolean);
        let idx = postIds.indexOf(currentId);

        // Child→Parent resolution: if currentId is a video/child post ID,
        // resolve it to the parent post ID so navigation still works.
        if (idx === -1) {
            const parentId = this._resolveChildToParentId(currentId, posts, _getId);
            if (parentId) {
                idx = postIds.indexOf(parentId);
                if (idx !== -1) {
                    window.Logger.info('StateManager', `🧭🔄 Resolved child→parent: ${currentId.slice(0, 8)} → ${parentId.slice(0, 8)}`);
                }
            }
        }

        if (idx === -1) {
            window.Logger.warn('StateManager', '🧭❌ Gallery nav: currentId NOT found (even after child→parent)', {
                currentId: currentId.slice(0, 12),
                gallerySize: postIds.length,
                first3: postIds.slice(0, 3).map(id => id.slice(0, 12))
            });
            return null;
        }

        const targetIdx = idx + direction;
        if (targetIdx < 0 || targetIdx >= postIds.length) return null;

        window.Logger.info('StateManager', `🧭 Gallery nav: ${direction > 0 ? 'next' : 'prev'} → ${postIds[targetIdx].slice(0, 8)}`);
        return postIds[targetIdx];
    }

    /**
     * Resolve a child/video/edited-image post ID to its parent post ID.
     * Scans galleryData.posts[].raw.{childPosts, videos, images}[] for the childId.
     * Lazily builds and caches a reverse lookup map for O(1) subsequent lookups.
     * @param {string} childId - The child post ID (from URL)
     * @param {Array} posts - galleryData.posts
     * @param {Function} _getId - ID extractor function
     * @returns {string|null} Parent post ID, or null if not a known child
     */
    _resolveChildToParentId(childId, posts, _getId) {
        // Rebuild reverse map if gallery data changed since last build
        const currentSize = posts.length;
        if (!this._childToParentMap || this._childToParentMapSize !== currentSize) {
            this._childToParentMap = new Map();
            this._childToParentMapSize = currentSize;
            for (const post of posts) {
                const parentId = _getId(post);
                if (!parentId) continue;
                const rawPost = post.raw || post;

                // Strategy 1: Scan childPosts[] for video/edit children
                if (Array.isArray(rawPost.childPosts)) {
                    for (const child of rawPost.childPosts) {
                        if (child.id) this._childToParentMap.set(child.id, parentId);
                    }
                }

                // Strategy 2: Scan videos[] array (video children)
                if (Array.isArray(rawPost.videos)) {
                    for (const video of rawPost.videos) {
                        if (video.id) this._childToParentMap.set(video.id, parentId);
                    }
                }

                // Strategy 3: Scan images[] for edited image children
                // images[0] is usually the original (id === parentId), subsequent entries are edits
                if (Array.isArray(rawPost.images)) {
                    for (const img of rawPost.images) {
                        if (img.id && img.id !== parentId) {
                            this._childToParentMap.set(img.id, parentId);
                        }
                    }
                }

                // Strategy 4: Top-level video post with originalPostId
                // (for shared/public videos that appear directly in /list)
                if (rawPost.originalPostId && rawPost.mediaType === 'MEDIA_POST_TYPE_VIDEO') {
                    this._childToParentMap.set(parentId, rawPost.originalPostId);
                }
            }
            window.Logger.debug('StateManager', `🗺️ Built child→parent map: ${this._childToParentMap.size} entries from ${currentSize} posts`);
        }
        return this._childToParentMap.get(childId) || null;
    }

    /**
     * Public helper to get the parent ID of a child post (e.g. video variant).
     * @param {string} childId 
     * @returns {string|null}
     */
    getParentImageId(childId) {
        if (!childId) return null;

        // 1. Try internal memory map (cached from gallery data)
        const cached = this._childToParentMap?.get(childId);
        if (cached) return cached;

        // 2. Try gallery data directly if map not built
        if (this.state.galleryData?.posts) {
            const _getId = p => p.imageId || p.postId || p.raw?.id || p.id;
            const resolved = this._resolveChildToParentId(childId, this.state.galleryData.posts, _getId);
            if (resolved) return resolved;
        }

        // 3. Try looking up in multiGenHistory (for persisted heritage)
        const entry = this.state.multiGenHistory.images.get(childId);
        if (entry?.originalPostId) return entry.originalPostId;

        return null;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PROMPT LIBRARY — Proxy wrappers (v1.45.7)
    // UIPromptLibraryManager calls these; they delegate to IndexedDBManager.
    // ═══════════════════════════════════════════════════════════════════════════

    /** Retrieve all saved prompts. @returns {Promise<Array>} */
    async getPrompts() {
        if (!this.indexedDBManager) return [];
        return this.indexedDBManager.getPrompts();
    }

    /** Retrieve all saved prompt folders. @returns {Promise<Array>} */
    async getFolders() {
        if (!this.indexedDBManager) return [];
        return this.indexedDBManager.getFolders();
    }

    /** Retrieve all unique prompt tags. @returns {Promise<Array>} */
    async getPromptTags() {
        if (!this.indexedDBManager) return [];
        return this.indexedDBManager.getPromptTags ? this.indexedDBManager.getPromptTags() : [];
    }

    /** Persist (create or update) a prompt. @param {Object} prompt */
    async savePrompt(prompt) {
        if (!this.indexedDBManager) return;
        return this.indexedDBManager.savePrompt(prompt);
    }

    /** Persist (create or update) a folder. @param {Object} folder */
    async saveFolder(folder) {
        if (!this.indexedDBManager) return;
        return this.indexedDBManager.saveFolder(folder);
    }

    /** Persist a prompt version snapshot. @param {Object} version */
    async savePromptVersion(version) {
        if (!this.indexedDBManager) return;
        return this.indexedDBManager.savePromptVersion(version);
    }

    /** Retrieve usage stats for a specific prompt. @returns {Promise<Object>} */
    async getPromptUsageStats(promptId) {
        if (!this.indexedDBManager) return { useCount: 0, lastUsedAt: null };
        return this.indexedDBManager.getPromptUsageStats(promptId);
    }

};
