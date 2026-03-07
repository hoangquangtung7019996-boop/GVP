/**
 * VideoQueueManager.js - Queue Processing Engine
 * Handles batch video generation from queue items
 * 
 * Dependencies: StateManager, UIVideoQueueManager, ReactAutomation
 */

window.VideoQueueManager = class VideoQueueManager {
    /**
     * @param {Object} stateManager - State management
     * @param {Object} uiQueueManager - UIVideoQueueManager instance
     */
    constructor(stateManager, uiQueueManager = null) {
        this.stateManager = stateManager;
        this.uiQueueManager = uiQueueManager;

        // Processing state
        this.isRunning = false;
        this.isPaused = false;
        this.currentItemId = null;

        // Prompt mode: 'raw' | 'json' | 'sequential' | 'random'
        this.promptMode = 'json'; // Default to JSON form
        this.promptPack = null;
        this.promptIndex = 0;

        // Automation / Looping
        this.loopMode = 'off'; // 'off' | 'moderated' | 'full'
        this.maxCycles = 0;    // 0 = unlimited
        this.currentCycle = 1;

        // Safety tracking
        this.moderationStreak = 0;
        this.rateLimitUntil = null;
        this.maxModerationStreak = 3;

        // Timing (configurable)
        this.delayBetweenItems = 3000; // ms between items
        this.navigationTimeout = 10000; // ms to wait for page load
        this.cooldownDelay = 1000; // ms to wait after triggering before allowing same imageId again

        // Duplicate prevention: track recently triggered imageIds
        // Map<imageId, timestamp> - prevents same image being triggered twice
        this._recentlyTriggered = new Map();

        // Event binding
        this._boundHandleRailProgress = this._handleRailProgress.bind(this);

        // Logger
        this.log = {
            debug: (...args) => window.Logger?.debug('QueueEngine', ...args),
            info: (...args) => window.Logger?.info('QueueEngine', ...args),
            warn: (...args) => window.Logger?.warn('QueueEngine', ...args),
            error: (...args) => window.Logger?.error('QueueEngine', ...args)
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Start processing the queue
     */
    start() {
        // Todo: Verify persistence check
        // if (this._shouldWipeOnNavigation()) {
        //     this.log.warn('⚠️ Queue wiped due to navigation away from gallery context');
        //     this.stop();
        //     this.uiQueueManager.clearAll();
        //     return;
        // }
        if (this.isRunning && !this.isPaused) {
            this.log.warn('Already running');
            return;
        }

        this.log.info('▶️ Starting queue processing', {
            mode: this.promptMode,
            loop: this.loopMode,
            cycle: `${this.currentCycle}/${this.maxCycles || '∞'}`
        });

        this.isRunning = true;
        this.isPaused = false;
        this.moderationStreak = 0;

        // Reset previously triggered items to pending so they can be reprocessed
        this._resetTriggeredItems();

        // Listen for generation events
        window.addEventListener('gvp:vidgen-beacon', this._boundHandleRailProgress);

        // Emit status event
        this._emitStatus('running');

        // Start processing
        this._processNext();
    }

    /**
     * Pause processing (resumable)
     */
    pause() {
        if (!this.isRunning) return;

        this.log.info('⏸️ Pausing queue processing');
        this.isPaused = true;
        this._emitStatus('paused');
    }

    /**
     * Resume from pause
     */
    resume() {
        if (!this.isRunning || !this.isPaused) return;

        this.log.info('▶️ Resuming queue processing');
        this.isPaused = false;
        this._emitStatus('running');
        this._processNext();
    }

    /**
     * Stop processing and reset
     */
    stop() {
        this.log.info('⏹️ Stopping queue processing');
        this.isRunning = false;
        this.isPaused = false;
        this.currentItemId = null;
        this.promptIndex = 0;
        this.moderationStreak = 0;
        this.rateLimitUntil = null;
        this.currentCycle = 1; // Reset cycle count on full stop

        if (this.processTimeoutId) {
            clearTimeout(this.processTimeoutId);
            this.processTimeoutId = null;
        }

        window.removeEventListener('gvp:vidgen-beacon', this._boundHandleRailProgress);
        this._emitStatus('stopped');
    }

    /**
     * Load a prompt pack for sequential/random mode
     * @param {Object} pack - PromptPack object
     */
    loadPromptPack(pack) {
        if (!pack?.prompts?.length) {
            this.log.warn('Invalid or empty prompt pack');
            return false;
        }

        this.promptPack = pack;
        this.promptIndex = 0;
        this.log.info('📦 Loaded prompt pack:', pack.packName || 'Unnamed', 'with', pack.prompts.length, 'prompts');
        return true;
    }

    /**
     * Set prompt mode
     * @param {'raw'|'json'|'sequential'|'random'} mode
     */
    setPromptMode(mode) {
        if (!['raw', 'json', 'sequential', 'random'].includes(mode)) {
            this.log.warn('Invalid prompt mode:', mode);
            return;
        }
        this.promptMode = mode;
        this.log.info('Prompt mode set to:', mode);
    }

    /**
     * Set automation loop mode
     * @param {'off'|'moderated'|'full'} mode 
     */
    setLoopMode(mode) {
        if (!['off', 'moderated', 'full'].includes(mode)) return;
        this.loopMode = mode;
        this.log.info('Loop mode set to:', mode);
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            currentItemId: this.currentItemId,
            promptMode: this.promptMode,
            promptIndex: this.promptIndex,
            moderationStreak: this.moderationStreak,
            rateLimitUntil: this.rateLimitUntil,
            loopMode: this.loopMode,
            currentCycle: this.currentCycle,
            maxCycles: this.maxCycles
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // PROCESSING LOOP
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Process the next item
     */
    async _processNext() {
        if (!this.isRunning || this.isPaused) {
            this.log.debug('Not processing - stopped or paused');
            return;
        }

        // Check rate limit
        if (this.rateLimitUntil && Date.now() < this.rateLimitUntil) {
            // IF we are in a 429 state (long wait), check if we should stop loop
            // NOTE: Usually stop() is called immediately on 429, but if logic resumes...
            const waitMs = this.rateLimitUntil - Date.now();
            this.log.warn('Rate limited, waiting', Math.ceil(waitMs / 1000), 'seconds');
            this.processTimeoutId = setTimeout(() => this._processNext(), waitMs);
            return;
        }

        // Get next pending item from UI queue
        const nextItem = this._getNextPendingItem();

        // QUEUE COMPLETE HANDLING
        if (!nextItem) {
            this._handleQueueComplete();
            return;
        }

        this.currentItemId = nextItem.id;
        const imageId = nextItem.imageId || nextItem.id;
        this.log.info('Processing item:', nextItem.id, 'imageId:', imageId);
        this._emitStatus('processing', { itemId: nextItem.id });

        // DUPLICATE PREVENTION: Check if this imageId was triggered recently
        const lastTriggered = this._recentlyTriggered.get(imageId);
        if (lastTriggered && (Date.now() - lastTriggered) < this.cooldownDelay) {
            this.log.warn(`⏸️ Cooldown active for imageId ${imageId}, skipping (${Date.now() - lastTriggered}ms ago)`);
            this.processTimeoutId = setTimeout(() => this._processNext(), 100);
            return;
        }

        try {
            // Navigate to post page
            const navigateId = imageId;
            const navigated = await this._navigateToPost(navigateId);
            if (!navigated) {
                this.log.error('Failed to navigate to post');
                this._markItemFailed(nextItem.id, 'Navigation failed');
                this.processTimeoutId = setTimeout(() => this._processNext(), 1000);
                return;
            }

            // LOCK: Mark this imageId as triggered
            this._recentlyTriggered.set(imageId, Date.now());

            // Get prompt based on mode
            const prompt = this._getNextPrompt();

            // Trigger video generation
            const triggered = await this._triggerVideoGeneration(prompt);
            if (!triggered) {
                this.log.error('Failed to trigger video generation');
                this._markItemFailed(nextItem.id, 'Generation failed');
                this.processTimeoutId = setTimeout(() => this._processNext(), 1000);
                return;
            }

            // Mark as triggered
            this._updateItemStatus(nextItem.id, 'triggered');
            this.log.info(`✅ Item triggered successfully: ${nextItem.id}`);

            // IMMEDIATELY continue to next item (fire-and-forget pattern)
            this.processTimeoutId = setTimeout(() => this._processNext(), this.delayBetweenItems);

        } catch (error) {
            this.log.error('Processing error:', error);
            this._markItemFailed(nextItem.id, error.message);
            this.processTimeoutId = setTimeout(() => this._processNext(), this.delayBetweenItems);
        }
    }

    /**
 * Handle queue completion (loops, cycle limits)
 */
    _handleQueueComplete() {
        this.log.info('✅ Cycle complete:', this.currentCycle);

        // Check loop mode
        if (this.loopMode === 'off') {
            this._showToast('Queue processing complete!', 'success');
            this.stop();
            return;
        }

        // Check cycle limits
        if (this.maxCycles > 0 && this.currentCycle >= this.maxCycles) {
            this.log.info('🛑 Max cycles reached:', this.maxCycles);
            this._showToast(`Queue complete (Limit: ${this.maxCycles} cycles)`, 'success');
            this.stop();
            return;
        }

        // Handle Loops
        let hasItemsToProcess = false;

        if (this.loopMode === 'moderated') {
            // Clear successful items
            this._clearByStatus('success');

            // Reset moderated items to pending, but limit to 3 retries
            let resetCount = 0;
            let permBlockCount = 0;

            if (this.uiQueueManager?.queueItems) {
                for (const [id, item] of this.uiQueueManager.queueItems) {
                    if (item.status === 'moderated') {
                        item.moderatedRetries = (item.moderatedRetries || 0) + 1;
                        if (item.moderatedRetries <= 3) {
                            item.status = 'pending';
                            resetCount++;
                        } else {
                            permBlockCount++;
                        }
                    }
                }
                if (resetCount > 0 || permBlockCount > 0) {
                    this.uiQueueManager._renderGrid?.();
                    this.uiQueueManager._updateStats?.();
                }
            }

            if (resetCount > 0) {
                this.log.info(`🔄 Moderated Loop: Retrying ${resetCount} items (${permBlockCount} permanently blocked)`);
                hasItemsToProcess = true;
            } else {
                this.log.info(`🔄 Moderated Loop: No items to retry (${permBlockCount} permanently blocked)`);
            }

        } else if (this.loopMode === 'full') {
            // Reset ALL items to pending
            const resetCount = this._resetAllToPending();
            if (resetCount > 0) {
                this.log.info(`🔄 Full Loop: Repeating ${resetCount} items`);
                hasItemsToProcess = true;
            }
        }

        if (hasItemsToProcess) {
            this.currentCycle++;
            this._showToast(`Starting Cycle ${this.currentCycle}...`, 'info');
            this.log.info(`🔄 Starting Cycle ${this.currentCycle}`);
            // Small delay before restarting loop
            setTimeout(() => this._processNext(), 2000);
        } else {
            this._showToast('Loop complete - no items left', 'success');
            this.stop();
        }
    }
    /**
     * Get next pending item from UI queue
     * v1.23.19: Smart edit scheduling - only 1 edit per parent at a time
     */
    _getNextPendingItem() {
        if (!this.uiQueueManager?.queueItems) return null;

        // v1.23.19: Build set of parents that have an edit currently generating
        const parentsWithActiveEdits = new Set();
        for (const [id, item] of this.uiQueueManager.queueItems) {
            if (item.isEdit && item.parentImageId &&
                (item.status === 'generating' || item.status === 'triggered')) {
                parentsWithActiveEdits.add(item.parentImageId);
            }
        }

        for (const [id, item] of this.uiQueueManager.queueItems) {
            if (item.status === 'pending') {
                // v1.23.19: If this is an edit and its parent has an active edit, skip it
                if (item.isEdit && item.parentImageId && parentsWithActiveEdits.has(item.parentImageId)) {
                    this.log.debug(`⏳ Skipping edit ${id.slice(0, 8)} - parent has active edit`);
                    continue;
                }
                return item;
            }
        }
        return null;
    }

    /**
     * Get next prompt based on mode
     */
    _getNextPrompt() {
        switch (this.promptMode) {
            case 'sequential':
                if (!this.promptPack?.prompts?.length) return '';
                const seqPrompt = this.promptPack.prompts[this.promptIndex % this.promptPack.prompts.length];
                this.promptIndex++;
                return seqPrompt?.text || '';

            case 'random':
                if (!this.promptPack?.prompts?.length) return '';
                const randIdx = Math.floor(Math.random() * this.promptPack.prompts.length);
                return this.promptPack.prompts[randIdx]?.text || '';

            case 'json':
                // Use JSON form values
                return window.gvpUIManager?.uiFormManager?.getFormattedPrompt?.() || '';

            case 'raw':
                // Use Raw tab text
                return window.gvpUIManager?.uiRawInputManager?.getCurrentRawPrompt?.() || '';

            case 'form': // Legacy fallback
            default:
                // Use strict fallback logic
                const jsonPrompt = window.gvpUIManager?.uiFormManager?.getFormattedPrompt?.();
                if (jsonPrompt) return jsonPrompt;
                return window.gvpUIManager?.uiRawInputManager?.getCurrentRawPrompt?.() || '';
        }
    }

    /**
     * Legacy helper - unused but kept for safety reference
     */
    _getFormPrompt() {
        return this._getNextPrompt();
    }

    // ═══════════════════════════════════════════════════════════════════
    // NAVIGATION & VIDEO TRIGGER
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Navigate to image post page using SPA navigation (no page refresh)
     * Uses history.pushState + popstate event like the rail manager
     * @param {string} imageId - Image ID to navigate to (IndexedDB primary key)
     */
    async _navigateToPost(imageId) {
        if (!imageId) {
            this.log.error('No image ID provided');
            return false;
        }

        const targetUrl = `/imagine/post/${imageId}`;

        // Check if already on the right page
        if (window.location.pathname === targetUrl) {
            this.log.debug('Already on target page');
            return true;
        }

        this.log.info('SPA navigating to:', targetUrl);

        // Emit navigation event to signal navigation in progress
        document.dispatchEvent(new CustomEvent('gvp:queue-navigation', {
            detail: { imageId, url: targetUrl }
        }));

        // Use SPA navigation: history.pushState + popstate event
        window.history.pushState({}, '', targetUrl);
        window.dispatchEvent(new PopStateEvent('popstate'));

        // Wait for React router to process and render content
        // 2.5 seconds is enough for the video composer to appear
        await new Promise(r => setTimeout(r, 2500));

        // Trust that navigation succeeded
        this.log.info('Navigation complete:', targetUrl);
        return true;
    }

    /**
     * Trigger video generation using ReactAutomation.sendToGenerator()
     */
    async _triggerVideoGeneration(prompt) {
        try {
            // Use the existing ReactAutomation.sendToGenerator() which handles everything
            const reactAutomation = window.gvpReactAutomation;

            if (!reactAutomation?.sendToGenerator) {
                this.log.error('ReactAutomation not available');
                return false;
            }

            // Ensure we have a prompt (use empty string if none - will use default form prompt)
            const videoPrompt = prompt || '';
            this.log.info('Calling ReactAutomation.sendToGenerator()...');

            // sendToGenerator returns a Promise that resolves after clicking Make Video
            await reactAutomation.sendToGenerator(videoPrompt, { autoSubmit: true, isRaw: false });

            this.log.info('✅ Video generation triggered via sendToGenerator');
            return true;

        } catch (error) {
            this.log.error('sendToGenerator failed:', error.message);
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // EVENT HANDLING
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Handle generation-progress event from generation tracking
     */
    _handleRailProgress(event) {
        const detail = event.detail || {};
        // Beacon payload: { videoId, imageId, parentPostId, progress, moderated, videoUrl, thumbnailUrl }
        // NB: there is NO 'status' field on beacon - status is inferred from progress/moderated boolean
        const { videoId, imageId, progress, moderated } = detail;

        if (!this.isRunning) return;

        const matchId = imageId || videoId;

        // Check if this is for our current item
        if (this.currentItemId && (matchId === this.currentItemId || videoId === this.currentItemId)) {
            if (moderated === true) {
                // Moderated: beacon sets moderated=true (not a status string)
                this.log.warn('🚫 Generation moderated:', videoId);
                this.moderationStreak++;
                this._updateItemStatus(this.currentItemId, 'moderated');

                if (this.moderationStreak >= this.maxModerationStreak) {
                    this.log.warn('Moderation streak limit reached, pausing');
                    this._showToast(`Moderation streak (${this.moderationStreak}x) - pausing`, 'warning');
                    this.pause();
                } else {
                    setTimeout(() => this._processNext(), this.delayBetweenItems);
                }
            } else if (progress >= 100) {
                // Success: 100% terminal beacon
                this.log.info('✅ Generation complete:', videoId);
                this.moderationStreak = 0;
                this._updateItemStatus(this.currentItemId, 'success');
                setTimeout(() => this._processNext(), this.delayBetweenItems);
            }
            // progress < 100 and not moderated: still generating, no action needed
        }
    }

    /**
     * Handle 429 rate limit detection
     * @param {number} retryAfterMs - Milliseconds to wait
     */
    handleRateLimit(retryAfterMs = 60000) {
        this.log.warn('429 Rate limit detected!');

        if (this.processTimeoutId) {
            clearTimeout(this.processTimeoutId);
            this.processTimeoutId = null;
        }

        // Stops queue entirely if in loop mode as per requirement
        if (this.loopMode !== 'off') {
            this.log.error('🛑 429 Rate limit hit while looping - STOPPING QUEUE');
            this._showToast('🛑 429 Rate Limit Hit - Stopping Queue', 'error');
            this.stop();
            return;
        }

        // Normal pause logic for non-loop mode (optional, but safer to stop too?)
        // User requested: "Stop on other errors... no only 429"
        // Implies 429 should be a hard stop.
        this.log.warn('Pausing for rate limit:', retryAfterMs / 1000, 'seconds');
        this.rateLimitUntil = Date.now() + retryAfterMs;
        this._showToast(`Rate limited - resuming in ${Math.ceil(retryAfterMs / 1000)}s`, 'warning');
        this._emitStatus('rate_limited', { resumeAt: this.rateLimitUntil });
    }

    // ═══════════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Update item status in UI queue
     */
    _updateItemStatus(itemId, status) {
        if (this.uiQueueManager?.queueItems?.has(itemId)) {
            const item = this.uiQueueManager.queueItems.get(itemId);
            item.status = status;
            if (status === 'success' || status === 'moderated') {
                item.completedAt = Date.now();
            }
            this.uiQueueManager._renderGrid?.();
            this.uiQueueManager._updateStats?.();
        }
    }

    /**
     * Clear items by status (from UI wrapper)
     */
    _clearByStatus(status) {
        if (this.uiQueueManager?._clearByStatus) {
            this.uiQueueManager._clearByStatus(status);
        }
    }

    /**
     * Reset items of a specific status to another status
     * @returns {number} Count of items reset
     */
    _resetByStatus(fromStatus, toStatus) {
        if (!this.uiQueueManager?.queueItems) return 0;
        let count = 0;
        for (const [id, item] of this.uiQueueManager.queueItems) {
            if (item.status === fromStatus) {
                item.status = toStatus;
                count++;
            }
        }
        if (count > 0) {
            this.uiQueueManager._renderGrid?.();
            this.uiQueueManager._updateStats?.();
        }
        return count;
    }

    /**
     * Reset ALL items to pending (for Full Repeat)
     * @returns {number} Count
     */
    _resetAllToPending() {
        if (!this.uiQueueManager?.queueItems) return 0;
        let count = 0;
        for (const [id, item] of this.uiQueueManager.queueItems) {
            item.status = 'pending';
            count++;
        }
        if (count > 0) {
            this.uiQueueManager._renderGrid?.();
            this.uiQueueManager._updateStats?.();
        }
        return count;
    }

    /**
     * Reset 'triggered' items back to 'pending' so they can be reprocessed
     */
    _resetTriggeredItems() {
        if (!this.uiQueueManager?.queueItems) return;

        let resetCount = 0;
        for (const [id, item] of this.uiQueueManager.queueItems) {
            if (item.status === 'triggered') {
                item.status = 'pending';
                resetCount++;
            }
        }

        if (resetCount > 0) {
            this.log.info(`🔄 Reset ${resetCount} triggered items to pending`);
            this.uiQueueManager._renderGrid?.();
            this.uiQueueManager._updateStats?.();
        }
    }

    /**
     * Mark item as failed
     */
    _markItemFailed(itemId, reason) {
        this.log.error('Item failed:', itemId, reason);
        this._updateItemStatus(itemId, 'moderated'); // Use moderated status for failures
    }

    /**
     * Emit status event
     */
    _emitStatus(status, extra = {}) {
        window.dispatchEvent(new CustomEvent('gvp:queue-status', {
            detail: { status, ...extra }
        }));
    }

    /**
     * Show toast notification
     */
    _showToast(message, type = 'info') {
        window.gvpUIManager?.showToast?.(message, type);
    }

    /**
     * Cleanup
     */
    destroy() {
        this.stop();
        this.log.info('VideoQueueManager destroyed');
    }
};
