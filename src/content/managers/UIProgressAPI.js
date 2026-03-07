// UIProgressAPI.js - API-based progress monitoring (works from any page)
// Polls the /new endpoint to get generation progress

window.Logger.info('Progress', '📡 UIProgressAPI.js file loaded');

window.UIProgressAPI = class UIProgressAPI {
    constructor(stateManager, uiManager = null) {
        this.stateManager = stateManager;
        this.uiManager = uiManager;
        this.isMonitoring = false;
        this.pollInterval = null;
        this.activeGenerations = new Map(); // videoId -> { imageId, startTime, lastProgress }
        this.pollFrequency = 3000; // 3 seconds

        window.Logger.info('Progress', 'UIProgressAPI initialized');
    }

    /**
     * Set UIManager reference
     */
    setUIManager(uiManager) {
        this.uiManager = uiManager;
        window.Logger.debug('Progress', 'UIManager reference set');
    }

    /**
     * Start API-based monitoring
     */
    startMonitoring() {
        if (this.isMonitoring) {
            window.Logger.debug('Progress', 'Already monitoring');
            return;
        }

        window.Logger.info('Progress', '📡 Starting API progress monitoring...');
        this.isMonitoring = true;

        // Poll immediately, then on interval
        this._pollProgress();
        this.pollInterval = setInterval(() => {
            this._pollProgress();
        }, this.pollFrequency);
    }

    /**
     * Stop monitoring
     */
    stopMonitoring() {
        window.Logger.info('Progress', 'Stopping monitoring');

        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        this.activeGenerations.clear();
        this.isMonitoring = false;
    }

    /**
     * Add a generation to monitor
     */
    addGeneration(videoId, imageId) {
        this.activeGenerations.set(videoId, {
            imageId,
            startTime: Date.now(),
            lastProgress: 0
        });

        window.Logger.debug('Progress', 'Added generation to monitor:', { videoId, imageId });
    }

    /**
     * Remove completed generation
     */
    removeGeneration(videoId) {
        this.activeGenerations.delete(videoId);
        window.Logger.debug('Progress', 'Removed completed generation:', videoId);
    }

    /**
     * Set up stream monitoring for /new responses
     */
    async _pollProgress() {
        // This method is now called by NetworkInterceptor when /new streams are received
        // No longer polling - monitoring actual stream responses instead

        // Only log when there are active generations to avoid console spam
        if (this.activeGenerations.size > 0) {
            window.Logger.debug('Progress', '📡 Stream monitoring active, tracking', this.activeGenerations.size, 'generations');
        }
    }

    /**
     * Process progress data from /new stream response
     */
    /**
     * Process progress data from /new stream response
     */
    processStreamResponse(streamData) {
        if (!streamData?.result?.response?.streamingVideoGenerationResponse) {
            return;
        }

        const resp = streamData.result.response.streamingVideoGenerationResponse;
        const videoId = resp.videoId || resp.assetId;
        const progress = resp.progress;
        const moderated = resp.moderated === true;

        if (!videoId || !Number.isFinite(progress)) {
            return;
        }

        // Check if we're monitoring this generation
        const genData = this.activeGenerations.get(videoId);
        if (!genData) {
            return; // Not monitoring this one
        }

        // Track last valid progress (when not moderated)
        if (!moderated) {
            genData.lastValidProgress = progress;
        }

        // Only update if:
        // 1. Progress is 100% (Completion)
        // 2. Moderated flag is true (Moderation)
        // 3. Progress changed significantly (optional, but we want to avoid spamming even for completion)

        const isComplete = progress >= 100;
        const isModerated = moderated;

        if (isComplete || isModerated) {
            // Determine final progress to display
            let displayProgress = progress;

            if (isModerated) {
                // Use last valid progress if available, otherwise 0
                displayProgress = genData.lastValidProgress || 0;
                window.Logger.warn('Progress', '🛑 Video moderated. Using last valid progress:', displayProgress);
            }

            window.Logger.debug('Progress', 'Final update:', {
                videoId,
                imageId: genData.imageId,
                progress: `${displayProgress}%`,
                status: isModerated ? 'moderated' : 'completed'
            });

            // Update progress
            this._updateProgress(videoId, genData.imageId, displayProgress);

            // Remove from monitoring since it's done (either complete or moderated)
            this.removeGeneration(videoId);
        } else {
            // Log internal tracking but DO NOT update UI
            // window.Logger.debug('Progress', 'Tracking internal progress:', progress, '%');
            genData.lastProgress = progress;
        }
    }

    /**
     * Process progress data from API response (legacy - keeping for compatibility)
     */
    _processProgressData(data) {
        // This method is deprecated - using processStreamResponse instead
        window.Logger.warn('Progress', 'Legacy _processProgressData called - should use processStreamResponse');
    }

    /**
     * Find conversation containing a specific video
     */
    _findConversationByVideo(conversations, videoId) {
        for (const conv of conversations) {
            if (conv.videoId === videoId || conv.assetId === videoId) {
                return conv;
            }

            // Check nested messages
            if (conv.messages) {
                for (const msg of conv.messages) {
                    if (msg.streamingVideoGenerationResponse) {
                        const resp = msg.streamingVideoGenerationResponse;
                        if (resp.assetId === videoId || resp.videoUrl?.includes(videoId)) {
                            return conv;
                        }
                    }
                }
            }
        }
        return null;
    }

    /**
     * Extract progress from conversation
     */
    _extractProgressFromConversation(conversation) {
        if (!conversation) return null;

        // Check direct progress field
        if (Number.isFinite(conversation.progress)) {
            return Math.max(0, Math.min(100, conversation.progress));
        }

        // Check streaming response
        if (conversation.messages) {
            for (const msg of conversation.messages) {
                if (msg.streamingVideoGenerationResponse) {
                    const resp = msg.streamingVideoGenerationResponse;
                    if (Number.isFinite(resp.progress)) {
                        return Math.max(0, Math.min(100, resp.progress));
                    }
                }
            }
        }

        return null;
    }

    /**
     * Update progress in StateManager and UI
     */
    _updateProgress(videoId, imageId, progress) {
        // Update StateManager progress tracking
        if (this.stateManager) {
            const progressData = {
                key: videoId,
                progress,
                context: {
                    type: 'video',
                    videoId,
                    imageId
                },
                timestamp: Date.now()
            };

            // Store in state
            this.stateManager.updateGenerationProgress?.(progressData);

            // Update multi-gen history
            this.stateManager.updateAttemptProgress?.(imageId, progress);
        }

        // Store in chrome.storage for external access
        this._storeProgressExternal(videoId, progress, imageId);

        // Broadcast to popup/background
        this._broadcastProgress(videoId, progress, imageId);

        // Trigger UI refresh if available
        // OPTIMIZATION: Do NOT call refreshHistoryTab here.
        // stateManager.updateAttemptProgress already dispatches 'gvp:multi-gen-history-update'
        // which UIManager listens to and updates the specific card efficiently.
        // Calling refreshHistoryTab causes a full re-render of the entire list on every progress tick!
        // if (this.uiManager?.refreshHistoryTab) {
        //     this.uiManager.refreshHistoryTab(false);
        // }
    }

    /**
     * Store progress in IndexedDB for external monitoring
     */
    async _storeProgressExternal(videoId, progress, imageId) {
        try {
            // Use IndexedDB via StateManager
            const indexedDB = this.stateManager?.storageManager?.indexedDBManager;
            if (!indexedDB) {
                window.Logger.warn('Progress', 'IndexedDB not available, skipping external storage');
                return;
            }

            // UNIFIED STORE UPDATE:
            // Instead of saving to the deleted 'progress' store, we update the unified entry directly
            if (imageId) {
                const entry = await indexedDB.getUnifiedEntry(imageId);
                if (entry && entry.attempts) {
                    const attempt = entry.attempts.find(a => a.id === videoId);
                    if (attempt) {
                        attempt.progress = progress;
                        attempt.lastProgress = progress; // Persist for moderation display
                        attempt.updatedAt = new Date().toISOString();

                        // FIX v1.21.48: Terminal-state-only persistence
                        // Only save to IndexedDB on completion or moderation to prevent per-tick spam
                        // (Was causing 8-10 writes per video instead of 1-2)
                        const isComplete = progress >= 100;
                        const isModerated = attempt.moderated === true || attempt.status === 'moderated';

                        if (isComplete || isModerated) {
                            await indexedDB.saveUnifiedEntry(entry);
                            window.Logger.debug('Progress', '💾 Saved final state to Unified Store:', { videoId, progress, isModerated });
                        }
                        // For intermediate progress: update in-memory only, skip disk write
                    }
                }
            }

        } catch (error) {
            window.Logger.error('Progress', 'Failed to store progress:', error);
        }
    }

    /**
     * Broadcast progress update
     */
    _broadcastProgress(videoId, progress, imageId) {
        try {
            // Send message to background/popup
            chrome.runtime.sendMessage({
                type: 'gvp-progress-update',
                key: videoId,
                progress,
                context: { type: 'video', videoId, imageId },
                timestamp: Date.now(),
                source: 'api'
            }).catch(err => {
                // Ignore if no listener
            });
        } catch (error) {
            // Extension context may be invalidated
        }

        // Also dispatch custom event for in-page listeners
        window.dispatchEvent(new CustomEvent('gvp:progress-update', {
            detail: {
                key: videoId,
                progress,
                context: { type: 'video', videoId, imageId },
                source: 'api'
            }
        }));
    }



    /**
     * Get all active generations being monitored
     */
    getActiveGenerations() {
        const result = [];
        this.activeGenerations.forEach((data, videoId) => {
            result.push({
                videoId,
                imageId: data.imageId,
                startTime: data.startTime,
                lastProgress: data.lastProgress,
                duration: Date.now() - data.startTime
            });
        });
        return result;
    }
};
