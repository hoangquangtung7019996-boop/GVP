// a:/Tools n Programs/SD-GrokScripts/grok-video-prompter-extension/src/content/managers/StateManager.js
// Manages the application's state.
// Dependencies: None

window.StateManager = class StateManager {
    constructor() {
        // Initialize StorageManager for persistence
        this.storageManager = new window.StorageManager();
        this._storageInitialized = false;
        
        // Track 30-second timeouts for pending generations
        this._generationTimeouts = new Map(); // attemptId -> { timeoutId, imageId }
        
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
                quickLaunchSuppressed: false
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
                // Aurora Auto-Injector settings
                auroraEnabled: false,
                auroraAspectRatio: 'square', // 'portrait', 'landscape', 'square'
                auroraBlankPngPortrait: '',
                auroraBlankPngLandscape: '',
                auroraBlankPngSquare: '',
                auroraCacheExpiry: 30 * 60 * 1000, // 30 minutes
                rawTemplates: [],
                jsonPresets: []
            }
        };
        this._settingsPromise = this._loadSettings();
        this._multiGenHistorySaveTimer = null;
        this.MULTI_GEN_LIMITS = Object.freeze({
            maxImages: 36,
            maxAttemptsPerImage: 6,
            maxProgressEvents: 25,
            maxStreamChars: 8000,
            maxPayloadChars: 4000
        });
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
            console.warn('[GVP][State] Multi-gen history trimmed to maintain storage budget', { context });
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
            console.warn('[GVP] crypto.randomUUID unavailable, falling back to Date.now()', error);
        }
        return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    }

    _nowIso() {
        return new Date().toISOString();
    }

    _dispatchMultiGenHistoryUpdate(detail) {
        try {
            window.dispatchEvent(new CustomEvent('gvp:multi-gen-history-updated', {
                detail: { ...(detail || {}) }
            }));
        } catch (error) {
            console.error('[GVP] Failed to dispatch multi-gen history event', error);
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
        const images = raw?.images && typeof raw.images === 'object' ? raw.images : {};
        const order = Array.isArray(raw?.order) ? raw.order.filter(id => typeof id === 'string') : [];
        const lastImage = raw?.lastImageByAccount && typeof raw.lastImageByAccount === 'object'
            ? raw.lastImageByAccount
            : {};
        const activeAccountId = typeof raw?.activeAccountId === 'string' ? raw.activeAccountId : null;

        Object.entries(images).forEach(([imageId, entry]) => {
            if (!imageId) return;
            const hydrated = this._hydrateHistoryEntry(entry);
            hydrated.imageId = hydrated.imageId || imageId;
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
            updatedAt: entry.updatedAt
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
            updatedAt: rawEntry.updatedAt || this._nowIso()
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

    ensureMultiGenImageEntry(accountId, imageId, thumbnailUrl = '') {
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
                updatedAt: now
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
        const { clone = true } = options || {};
        const entries = [];
        const activeAccount = this.state.multiGenHistory.activeAccountId;
        this.state.multiGenHistory.order.forEach((imageId) => {
            const entry = this.state.multiGenHistory.images.get(imageId);
            if (!entry) return;
            if (activeAccount && entry.accountId && entry.accountId !== activeAccount) {
                return;
            }
            entries.push(clone ? this._cloneHistoryEntry(entry) : entry);
        });
        return entries;
    }

    getActiveMultiGenAccount() {
        return this.state.multiGenHistory.activeAccountId || null;
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
            console.log('[GVP][State] Active account cleared');
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

        console.log('[GVP][State] Active account changed', normalized);
        this._dispatchMultiGenHistoryUpdate({ type: 'account-changed', accountId: normalized });
        this._scheduleMultiGenHistorySave();
        return true;
    }

    createMultiGenAttempt(accountId, imageId, options = {}) {
        const entry = this.ensureMultiGenImageEntry(accountId, imageId, options.thumbnailUrl);
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
        console.log('[GVP] About to start timeout for attempt', attempt.id, 'imageId:', imageId);
        try {
            this._startGenerationTimeout(attempt.id, imageId);
            console.log('[GVP] Timeout start succeeded for attempt', attempt.id);
        } catch (err) {
            console.error('[GVP] ❌ Failed to start timeout', err);
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
        this._scheduleMultiGenHistorySave();
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
        console.log('[GVP][State] Multi-Gen progress appended', {
            imageId,
            attemptId,
            progress: progressEntry.progress,
            totalEvents: attempt.progressEvents.length
        });
        attempt.currentProgress = progressEntry.progress;
        
        // Reset the 30-second timeout since we received progress
        this._startGenerationTimeout(attemptId, imageId);
        if (progressEntry.moderated) {
            attempt.moderated = true;
            attempt.moderatedAtProgress = progressEntry.progress;
            attempt.moderationReason = meta.moderationReason || attempt.moderationReason;
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
        this._scheduleMultiGenHistorySave();
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
            attempt.status = 'moderated';
            entry.lastModeratedAt = attempt.finishedAt;
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
                console.error('[GVP] Failed to clear multi-gen history storage', error);
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
            console.log('[GVP] Generation timeout reached', { attemptId, imageId, duration: duration + 'ms' });
            this._handleGenerationTimeout(attemptId, imageId);
        }, duration);
        
        this._generationTimeouts.set(attemptId, { timeoutId, imageId });
        console.log('[GVP] Started timeout for attempt', attemptId, 'duration:', Math.round(duration / 1000) + 's');
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
            console.log('[GVP] Cleared timeout for attempt', attemptId);
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
            console.warn('[GVP] Cannot timeout - image entry not found', imageId);
            return;
        }
        
        const attemptIndex = entry.attempts.findIndex(item => item.id === attemptId);
        if (attemptIndex === -1) {
            console.warn('[GVP] Cannot timeout - attempt not found', attemptId);
            return;
        }
        
        const attempt = entry.attempts[attemptIndex];
        
        // Only timeout if still pending
        if (attempt.status !== 'pending') {
            console.log('[GVP] Attempt no longer pending, skipping timeout', { attemptId, status: attempt.status });
            return;
        }
        
        // Store for undo (in case user wants to restore it)
        const deletedData = {
            imageId,
            attempt: { ...attempt },
            deletedAt: this._nowIso()
        };
        
        // Delete the attempt
        const deleted = this.deleteMultiGenAttempt(imageId, attemptId);
        
        if (deleted) {
            console.log('[GVP] Deleted stalled generation attempt', attemptId);
            
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
        
        console.log('[GVP] Checking for pending attempts to restore timeouts...');
        
        images.forEach((entry, imageId) => {
            entry.attempts.forEach(attempt => {
                if (attempt.status === 'pending') {
                    const startTime = new Date(attempt.startedAt).getTime();
                    const age = now - startTime;
                    
                    if (age > 30000) {
                        // Already stale (older than 30s) - delete immediately
                        console.log('[GVP] Deleting stale attempt from before page refresh', {
                            attemptId: attempt.id,
                            age: Math.round(age / 1000) + 's'
                        });
                        this.deleteMultiGenAttempt(imageId, attempt.id);
                    } else {
                        // Still fresh - restart timeout for remaining time
                        const remaining = 30000 - age;
                        console.log('[GVP] Restarting timeout for pending attempt', {
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
            console.error('[GVP] Cannot restore - image entry not found', imageId);
            return false;
        }
        
        // Add the attempt back to the beginning
        entry.attempts.unshift(attemptData);
        entry.updatedAt = this._nowIso();
        
        this._recalculateHistoryCounters(entry);
        this._dispatchMultiGenHistoryUpdate({ type: 'attempt-restored', imageId, attemptId: attemptData.id });
        this._scheduleMultiGenHistorySave();
        
        console.log('[GVP] Restored generation attempt', attemptData.id);
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
                console.error('[GVP] Failed to persist multi-gen history', error);
            });
        }, Math.max(0, delay));
    }

    async _persistMultiGenHistory() {
        if (!this._storageInitialized) {
            return;
        }

        const snapshot = this.getMultiGenHistorySnapshot();
        await this.storageManager.saveMultiGenHistory(snapshot);
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
                console.warn('[GVP] Extension context invalidated while saving custom dropdown options');
            } else {
                console.error('[GVP] Failed to persist custom dropdown options:', error);
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
                console.warn('[GVP] Extension context invalidated while clearing custom dropdown options');
            } else {
                console.error('[GVP] Failed to clear custom dropdown options:', error);
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

    _persistCustomDropdownOptions(options = {}) {
        if (!chrome?.storage?.local) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            try {
                chrome.storage.local.set({ 'gvp-custom-dropdown-values': options }, () => {
                    if (chrome.runtime?.lastError) {
                        reject(new Error(chrome.runtime.lastError.message || 'Failed to persist custom dropdown options'));
                        return;
                    }
                    resolve();
                });
            } catch (error) {
                reject(error);
            }
        });
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
            console.warn('[GVP StateManager] Invalid progress data');
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

        console.log('[GVP StateManager] Progress updated:', {
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

        console.log('[GVP StateManager] Updated attempt progress:', {
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
            visual_details: { objects: [], positioning: '', text_elements: '' },
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
                    console.warn('[GVP] Fixed corrupted object:', { corrupted: item, fixed: reconstructed });
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

    _loadSettings() {
        // Use Chrome storage instead of localStorage
        return new Promise((resolve) => {
            chrome.storage.local.get(['gvp-settings', 'gvp-custom-dropdown-values'], (result) => {
                const saved = result['gvp-settings'];
                if (saved) {
                    this.state.settings = { ...this.state.settings, ...saved };
                    this.state.ui.wrapInQuotes = this.state.settings.wrapInQuotes;
                    this._dispatchWrapModeChanged(this.state.settings.wrapInQuotes);
                    this._dispatchAuroraModeChanged(this.state.settings.auroraEnabled);
                    this._dispatchUploadModeChanged(this.state.settings.uploadModeEnabled);
                }

                const storedCustoms = this._normalizeCustomDropdownOptions(result['gvp-custom-dropdown-values']);
                const settingsCustoms = this._normalizeCustomDropdownOptions(this.state.settings.customDropdownOptions);
                const mergedCustoms = this._mergeCustomDropdownOptions(settingsCustoms, storedCustoms);
                this.state.settings.customDropdownOptions = mergedCustoms;

                 this.state.settings.jsonPresets = this._normalizeJsonPresets(this.state.settings.jsonPresets);

                this.state.settings.rawTemplates = this._normalizeRawTemplates(this.state.settings.rawTemplates);
                if (this.state.settings.silentMode) {
                    this.applySilentModeAudioDefaults();
                }

                window.dispatchEvent(new CustomEvent('gvp:custom-dropdown-updated', {
                    detail: { options: { ...mergedCustoms } }
                }));

                resolve();
            });
        });
    }

    saveSettings() {
        // Use Chrome storage instead of localStorage
        try {
            // Check if extension context is still valid
            if (!chrome.runtime || !chrome.storage) {
                console.warn('[GVP] Extension context invalidated, skipping settings save');
                return;
            }

            chrome.storage.local.set({ 'gvp-settings': this.state.settings }, () => {
                if (chrome.runtime.lastError) {
                    console.error('[GVP] Failed to save settings:', chrome.runtime.lastError);
                }
            });
        } catch (error) {
            if (error.message.includes('Extension context invalidated')) {
                console.warn('[GVP] Extension context invalidated during settings save');
            } else {
                console.error('[GVP] Error saving settings:', error);
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

    setAuroraEnabled(enabled) {
        const normalized = !!enabled;
        if (this.state.settings.auroraEnabled === normalized) {
            return;
        }
        this.state.settings.auroraEnabled = normalized;
        this.saveSettings();
        this._dispatchAuroraModeChanged(normalized);
    }

    getJsonPresets() {
        const presets = Array.isArray(this.state.settings.jsonPresets)
            ? this.state.settings.jsonPresets
            : [];
        return presets.map((preset) => ({
            name: preset.name,
            savedAt: preset.savedAt,
            data: JSON.parse(JSON.stringify(preset.data || {}))
        }));
    }

    saveJsonPreset(name, promptData) {
        if (typeof name !== 'string') {
            return { success: false, reason: 'invalid-name' };
        }
        const trimmed = name.trim();
        if (!trimmed) {
            return { success: false, reason: 'empty-name' };
        }

        const normalizedData = this._normalizePromptDataStructure(promptData);
        const presets = this.getJsonPresets();
        const existingIndex = presets.findIndex(preset => preset.name.toLowerCase() === trimmed.toLowerCase());
        const newPreset = {
            name: trimmed,
            savedAt: this._nowIso(),
            data: normalizedData
        };

        if (existingIndex >= 0) {
            presets[existingIndex] = newPreset;
        } else {
            presets.push(newPreset);
            presets.sort((a, b) => a.name.localeCompare(b.name));
        }

        this.state.settings.jsonPresets = presets.map(preset => ({
            name: preset.name,
            savedAt: preset.savedAt,
            data: this._normalizePromptDataStructure(preset.data)
        }));
        this.saveSettings();
        this._dispatchJsonPresetsUpdated();
        return { success: true, name: trimmed, replaced: existingIndex >= 0 };
    }

    removeJsonPreset(name) {
        if (typeof name !== 'string') {
            return false;
        }
        const presets = this.getJsonPresets();
        const filtered = presets.filter(preset => preset.name.toLowerCase() !== name.trim().toLowerCase());
        if (filtered.length === presets.length) {
            return false;
        }
        this.state.settings.jsonPresets = filtered.map(preset => ({
            name: preset.name,
            savedAt: preset.savedAt,
            data: this._normalizePromptDataStructure(preset.data)
        }));
        this.saveSettings();
        this._dispatchJsonPresetsUpdated();
        return true;
    }

    applyJsonPreset(name) {
        if (typeof name !== 'string') {
            return false;
        }
        const presets = this.getJsonPresets();
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
            console.error('[GVP] Failed to dispatch json presets update', error);
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
            console.error('[GVP] Failed to dispatch prompt data update', error);
        }
    }

    _dispatchWrapModeChanged(enabled) {
        try {
            window.dispatchEvent(new CustomEvent('gvp:wrap-mode-changed', {
                detail: { enabled: !!enabled }
            }));
        } catch (error) {
            console.error('[GVP] Failed to dispatch wrap mode change', error);
        }
    }

    _dispatchUploadModeChanged(enabled) {
        try {
            window.dispatchEvent(new CustomEvent('gvp:upload-mode-changed', {
                detail: { enabled: !!enabled }
            }));
        } catch (error) {
            console.error('[GVP] Failed to dispatch upload mode change', error);
        }
    }

    _dispatchAuroraModeChanged(enabled) {
        try {
            window.dispatchEvent(new CustomEvent('gvp:aurora-mode-changed', {
                detail: { enabled: !!enabled }
            }));
        } catch (error) {
            console.error('[GVP] Failed to dispatch aurora mode change', error);
        }
    }

    _parseVideoPromptJson(rawJsonString) {
        try {
            return JSON.parse(rawJsonString);
        } catch (error) {
            const repaired = this._repairVideoPromptJson(rawJsonString);
            if (repaired && repaired !== rawJsonString) {
                console.warn('[GVP] ⚠️ Repairing malformed videoPrompt payload before parsing');
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
            console.warn('[GVP] Invalid videoPrompt string');
            return false;
        }

        let trimmed = videoPromptString.trim();
        if (!trimmed) {
            console.warn('[GVP] Empty videoPrompt string received');
            return false;
        }

        // Some responses double-stringify the JSON payload. Strip wrapping quotes if present.
        const isWrappedByQuotes = trimmed.startsWith('"') && trimmed.endsWith('"');
        if (isWrappedByQuotes) {
            try {
                trimmed = JSON.parse(trimmed);
            } catch (doubleParseErr) {
                console.warn('[GVP] Failed to unwrap double-stringified videoPrompt');
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
                console.debug('[GVP] Skipping non-JSON videoPrompt payload');
            }
            this.state.generation.lastPrompt = null;
            this.state.generation.lastVideoPromptRaw = videoPromptString;
            return false;
        }

        try {
            const parsedPrompt = this._parseVideoPromptJson(candidate);
            console.log('[GVP] ✅ Parsed videoPrompt from API response');

            this.state.promptData = { ...this.state.promptData, ...parsedPrompt };
            if (this.state.settings?.silentMode) {
                this.applySilentModeAudioDefaults();
            }

            this.state.generation.lastPrompt = candidate;
            this.state.generation.lastVideoPromptRaw = null;
            console.log('[GVP] ✅ Updated promptData with parsed videoPrompt');

            return true;
        } catch (error) {
            console.error('[GVP] Failed to parse videoPrompt JSON:', error);
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
        // Ensure settings (including silent mode) are loaded before continuing
        return this._settingsPromise || Promise.resolve();
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
        state.promptData.audio = state.promptData.audio || {};
        state.promptData.audio.music = 'none';
        state.promptData.audio.ambient = 'none';
        state.promptData.audio.sound_effect = 'none';
        state.promptData.audio.mix_level = 'No music, no ambient room noise, maximum dialogue audio, medium human sounds.';
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
            console.warn('[GVP] Invalid template entry provided');
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

    applyTemplatesToPrompt(promptData) {
        const baseData = promptData
            ? JSON.parse(JSON.stringify(promptData))
            : this._getEmptyPromptData();

        const templates = (this.state.settings.rawTemplates || []).filter(template => template.enabled);

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
        const templates = (this.state.settings.rawTemplates || [])
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

    _applyTemplateRule(target, template) {
        const resolved = this._resolveTemplatePath(target, template.fieldPath);
        if (!resolved) {
            console.warn(`[GVP] Unable to resolve template path: ${template.fieldPath}`);
            return;
        }

        const { parent, key, isArray } = resolved;
        if (!parent) {
            console.warn(`[GVP] Missing parent for template path: ${template.fieldPath}`);
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
        const normalized = {
            id: entry && entry.id ? entry.id : this._generateTemplateId(),
            fieldPath: entry && entry.fieldPath ? entry.fieldPath : '',
            prefix: entry && entry.prefix ? entry.prefix : '',
            suffix: entry && entry.suffix ? entry.suffix : '',
            enabled: entry && typeof entry.enabled === 'boolean' ? entry.enabled : true,
            prefixOnly: Boolean(entry && entry.prefixOnly),
            dialogueTemplate: this._normalizeDialogueTemplate(entry?.dialogueTemplate),
            applyToRaw: Boolean(entry && entry.applyToRaw)
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

        console.log(`[GVP] Registered generation: ${generationId} for imageId: ${generationData.imageId}`);
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
            
            console.log(`[GVP] Updated generation ${generationId}:`, updates);
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

            console.log(`[GVP] ✅ Completed generation ${generationId} in ${generation.duration}ms (status: ${generation.status})`);
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
            console.log('[GVP] StorageManager initialized and data restored');
            this._scheduleMultiGenHistorySave(0);
        } catch (error) {
            console.error('[GVP] Failed to initialize storage:', error);
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
        console.log('[GVP] Cleared all completed generations');
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
     * Ingest gallery data from /rest/media/post/list API response
     * @param {Array} posts - Array of post objects from API
     * @param {Object} meta - Metadata about the API call
     * @returns {Object} Ingestion results
     */
    ingestGalleryData(posts, meta = {}) {
        if (!Array.isArray(posts) || !posts.length) {
            console.warn('[GVP][StateManager] No posts provided to ingestGalleryData');
            return { success: false, reason: 'empty-posts' };
        }

        console.log('[GVP][StateManager] 📥 Ingesting gallery data', {
            postCount: posts.length,
            source: meta.source || 'unknown',
            existingPosts: this.state.galleryData.posts.length,
            existingVideos: this.state.galleryData.videoIndex.size
        });

        // MERGE new posts with existing ones (de-dupe by imageId)
        const existingPostsMap = new Map();
        this.state.galleryData.posts.forEach(p => {
            const id = p.imageId || p.raw?.id || p.id;
            if (id) existingPostsMap.set(id, p);
        });
        
        posts.forEach(p => {
            const id = p.imageId || p.raw?.id || p.id;
            if (id) existingPostsMap.set(id, p); // New posts overwrite old
        });
        
        this.state.galleryData.posts = Array.from(existingPostsMap.values());
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
                console.log('[GVP][StateManager] 🔍 First post structure:', {
                    normalized: Object.keys(post),
                    hasRaw: !!post.raw,
                    rawKeys: post.raw ? Object.keys(post.raw).slice(0, 15) : [],
                    imageId: imageId,
                    mediaType: rawPost.mediaType,
                    hasChildPosts: Array.isArray(rawPost.childPosts),
                    childPostsCount: rawPost.childPosts?.length || 0
                });
                if (rawPost.childPosts?.length > 0) {
                    console.log('[GVP][StateManager] 🔍 First childPost:', rawPost.childPosts[0]);
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
                    console.log('[GVP][StateManager] 📹 Found standalone video post:', videoId);
                }
            }
        });

        this.state.galleryData.videoIndex = videoIndex;
        this.state.galleryData.imageIndex = imageIndex;

        console.log('[GVP][StateManager] ✅ Gallery data ingested', {
            newPosts: posts.length,
            totalPosts: this.state.galleryData.posts.length,
            totalVideos: videoIndex.size,
            totalImages: imageIndex.size,
            source: meta.source
        });

        // Dispatch event for UI updates
        this._dispatchGalleryDataUpdate({
            reason: 'ingestion',
            postCount: posts.length,
            videoCount,
            source: meta.source
        });

        return {
            success: true,
            postCount: posts.length,
            videoCount,
            imageCount: imageIndex.size
        };
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
        
        console.log('[GVP][StateManager] 🔍 hasGalleryData check:', {
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

        console.log('[GVP][StateManager] 🗑️ Gallery data cleared');
        
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
            console.error('[GVP] Failed to dispatch gallery data event', error);
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
};
