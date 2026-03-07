// a:/Tools n Programs/SD-GrokScripts/grok-video-prompter-extension/src/content/managers/MultiVideoManager.js
// Manages multiple concurrent video generations with queue management.
// Dependencies: StateManager, ReactAutomation

window.MultiVideoManager = class MultiVideoManager {
    constructor(stateManager, reactAutomation) {
        this.stateManager = stateManager;
        this.reactAutomation = reactAutomation;
        this.maxConcurrent = 3; // Maximum simultaneous generations
        this.generationCounter = 0;
        this.isMonitoringActive = false;
    }

    /**
     * Initiate multiple generations simultaneously
     * @param {Array} promptConfigs - Array of {prompt, mode, imageUrl, imageId} objects
     * @returns {Promise<Array>} Array of generation results
     */
    async initiateMultipleGenerations(promptConfigs) {
        console.log(`[GVP Multi] Initiating ${promptConfigs.length} simultaneous generations`);

        const results = [];

        // Process in batches to respect concurrency limits
        for (let i = 0; i < promptConfigs.length; i += this.maxConcurrent) {
            const batch = promptConfigs.slice(i, i + this.maxConcurrent);

            const batchPromises = batch.map(async (config, index) => {
                const generationId = `gen_${Date.now()}_${this.generationCounter++}`;
                return await this.initiateSingleGeneration(generationId, config, i + index);
            });

            const batchResults = await Promise.allSettled(batchPromises);
            results.push(...batchResults);
        }

        return results;
    }

    /**
     * Initiate a single generation with tracking
     * @param {string} generationId - Unique generation identifier
     * @param {object} config - Generation configuration
     * @param {number} queuePosition - Position in queue
     * @returns {Promise<object>} Generation result
     */
    async initiateSingleGeneration(generationId, config, queuePosition) {
        const state = this.stateManager.getState();

        const generationData = {
            id: generationId,
            startTime: Date.now(),
            progress: 0,
            isComplete: false,
            isRefused: false,
            retryCount: 0,
            initialPrompt: config.prompt,
            finalPrompt: null,
            mode: config.mode || 'normal',
            imageId: config.imageId || null, // ENHANCED: Image ID tracking
            imageUrl: config.imageUrl || null,
            videoUrl: null,
            videoId: null,
            assetId: null,
            audioUrls: [],
            endTime: null,
            duration: null,
            queuePosition: queuePosition,
            status: 'initializing'
        };

        // Register with state manager - ENHANCED: pass imageId
        this.stateManager.registerGeneration(generationId, config.prompt, {
            mode: config.mode || 'normal',
            imageId: config.imageId,
            imageUrl: config.imageUrl
        });

        try {
            // Send to generation
            await this.reactAutomation.sendToGenerator(config.prompt, false);

            generationData.status = 'generating';

            // Update UI status
            if (window.gvpUIManager) {
                window.gvpUIManager.updateGenerationStatus('generating', {
                    generationId: generationId,
                    queuePosition: queuePosition
                });
            }

            return { generationId, success: true, generationData };

        } catch (error) {
            console.error(`[GVP Multi] Failed to initiate generation ${generationId}:`, error);
            generationData.status = 'failed';
            generationData.error = error.message;

            // Update UI status
            if (window.gvpUIManager) {
                window.gvpUIManager.updateGenerationStatus('failed', {
                    generationId: generationId,
                    reason: error.message
                });
            }

            return { generationId, success: false, error: error.message, generationData };
        }
    }

    /**
     * Add generation to queue if at max concurrent limit
     * @param {object} config - Generation configuration
     * @returns {boolean} True if queued, false if initiated immediately
     */
    queueGeneration(config) {
        const state = this.stateManager.getState();
        const activeCount = state.multiGeneration.activeGenerations.size;

        if (activeCount >= this.maxConcurrent) {
            state.multiGeneration.queuedGenerations.push(config);
            console.log(`[GVP Multi] Queued generation - ${state.multiGeneration.queuedGenerations.length} waiting`);
            return true;
        }

        return false; // Not queued, will be initiated immediately
    }

    /**
     * Process queued generations when slots become available
     */
    async processQueue() {
        const state = this.stateManager.getState();

        while (state.multiGeneration.queuedGenerations.length > 0) {
            const activeCount = state.multiGeneration.activeGenerations.size;

            if (activeCount < this.maxConcurrent) {
                const config = state.multiGeneration.queuedGenerations.shift();
                const generationId = `gen_${Date.now()}_${this.generationCounter++}`;

                console.log(`[GVP Multi] Processing queued generation: ${generationId}`);
                await this.initiateSingleGeneration(generationId, config, 0);
            } else {
                // Wait and check again
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    /**
     * Monitor all active generations for stuck/timeout scenarios
     * Only monitors multi-video scenarios, not single generations
     */
    async monitorActiveGenerations() {
        if (this.isMonitoringActive) return;
        this.isMonitoringActive = true;

        const monitorInterval = setInterval(() => {
            const state = this.stateManager.getState();
            const now = Date.now();
            const activeCount = state.multiGeneration.activeGenerations.size;

            // Only monitor if we have multiple concurrent generations
            if (activeCount <= 1) {
                // Single generation - don't monitor for timeout
                // NetworkInterceptor will handle completion
                return;
            }

            for (const [generationId, generation] of state.multiGeneration.activeGenerations.entries()) {
                // Check for stuck generations (no progress for 15 minutes)
                if (generation.status === 'generating' &&
                    now - generation.startTime > 900000) {

                    console.warn(`[GVP Multi] Generation ${generationId} appears stuck (15+ minutes)`);
                    this.handleStuckGeneration(generationId);
                }

                // Check for timeout (30 minutes max - for multi-video scenarios)
                if (now - generation.startTime > 1800000) {
                    console.warn(`[GVP Multi] Generation ${generationId} timed out (30+ minutes)`);
                    this.handleTimeoutGeneration(generationId);
                }
            }

            // Process queue if slots available
            this.processQueue();
        }, 5000); // Check every 5 seconds

        // Cleanup monitoring after 1 hour of inactivity
        setTimeout(() => {
            clearInterval(monitorInterval);
            this.isMonitoringActive = false;
        }, 3600000);
    }

    /**
     * Handle stuck generation
     * @param {string} generationId - Stuck generation ID
     */
    handleStuckGeneration(generationId) {
        const state = this.stateManager.getState();
        const generation = state.multiGeneration.activeGenerations.get(generationId);

        if (generation && generation.retryCount < 2) {
            generation.retryCount++;
            generation.status = 'retrying';
            console.log(`[GVP Multi] Retrying stuck generation ${generationId} (attempt ${generation.retryCount})`);

            // Update UI
            if (window.gvpUIManager) {
                window.gvpUIManager.updateGenerationStatus('retrying', {
                    generationId: generationId,
                    retryCount: generation.retryCount
                });
            }
        } else {
            this.markGenerationFailed(generationId, 'STUCK_MAX_RETRIES');
        }
    }

    /**
     * Handle timeout generation
     * @param {string} generationId - Timed out generation ID
     */
    handleTimeoutGeneration(generationId) {
        this.markGenerationFailed(generationId, 'TIMEOUT');
    }

    /**
     * Mark generation as failed
     * @param {string} generationId - Generation ID
     * @param {string} reason - Failure reason
     */
    markGenerationFailed(generationId, reason) {
        const state = this.stateManager.getState();
        const generation = state.multiGeneration.activeGenerations.get(generationId);

        if (generation) {
            generation.status = 'failed';
            generation.endTime = Date.now();
            generation.duration = generation.endTime - generation.startTime;
            generation.failureReason = reason;

            // Move to completed
            state.multiGeneration.completedGenerations.set(generationId, generation);
            state.multiGeneration.activeGenerations.delete(generationId);

            console.log(`[GVP Multi] ❌ Generation ${generationId} failed: ${reason}`);

            // Update UI
            if (window.gvpUIManager) {
                window.gvpUIManager.updateGenerationStatus('failed', {
                    generationId: generationId,
                    reason: reason
                });
            }

            // Process queue
            this.processQueue();
        }
    }

    /**
     * Get generation statistics
     * @returns {object} Statistics object
     */
    getStatistics() {
        const state = this.stateManager.getState();
        const active = state.multiGeneration.activeGenerations;
        const completed = state.multiGeneration.completedGenerations;
        const queued = state.multiGeneration.queuedGenerations;

        return {
            activeCount: active.size,
            completedCount: completed.size,
            queuedCount: queued.length,
            totalInitiated: this.generationCounter,
            averageDuration: this.calculateAverageDuration(completed)
        };
    }

    /**
     * Calculate average duration of completed generations
     * @param {Map} completed - Completed generations map
     * @returns {number} Average duration in milliseconds
     */
    calculateAverageDuration(completed) {
        const durations = Array.from(completed.values())
        .filter(gen => gen.duration)
        .map(gen => gen.duration);

        if (durations.length === 0) return 0;

        const sum = durations.reduce((a, b) => a + b, 0);
        return Math.round(sum / durations.length);
    }

    /**
     * Cancel all active generations
     */
    cancelAllGenerations() {
        const state = this.stateManager.getState();
        const active = state.multiGeneration.activeGenerations;

        for (const [generationId] of active) {
            this.markGenerationFailed(generationId, 'CANCELLED_BY_USER');
        }

        console.log(`[GVP Multi] Cancelled ${active.size} active generations`);
    }

    /**
     * Pause/resume monitoring
     * @param {boolean} pause - True to pause, false to resume
     */
    setMonitoringPaused(pause) {
        // Future enhancement: Allow pausing monitoring
        console.log(`[GVP Multi] Monitoring ${pause ? 'paused' : 'resumed'}`);
    }

    // ======
    // GVP MODIFICATION: Add cancelGeneration method
    // ======
    cancelGeneration(identifier) {
        console.log(`[GVP Multi] CancelGeneration called for identifier: ${identifier}`);
        
        const state = this.stateManager.getState();
        const active = state.multiGeneration.activeGenerations;
        
        // Try to find by imageId first, then by generationId
        let targetGeneration = null;
        
        // Try as imageId
        for (const [genId, genData] of active) {
            if (genData.imageId === identifier) {
                targetGeneration = { genId, genData };
                break;
            }
        }
        
        // If not found, try as generationId
        if (!targetGeneration && active.has(identifier)) {
            const genData = active.get(identifier);
            targetGeneration = { genId: identifier, genData };
        }
        
        if (!targetGeneration) {
            console.log(`[GVP Multi] No active generation found for identifier: ${identifier}`);
            return;
        }
        
        const targetId = targetGeneration.genData?.imageId || identifier;
        console.log(`[GVP Multi] Cancelling generation ${targetGeneration.genId} for id: ${targetId}`);
        
        // Remove from active generations
        active.delete(targetGeneration.genId);
        
        // Update state manager
        if (this.stateManager && typeof this.stateManager.updateGenerationStatus === 'function') {
            this.stateManager.updateGenerationStatus(targetId, 'cancelled');
        }
        
        // Remove from storage
        if (window.gvpStorageManager && typeof window.gvpStorageManager.removeActiveGeneration === 'function') {
            window.gvpStorageManager.removeActiveGeneration(targetId);
        }
        
        // Trigger UI refresh
        if (window.gvpUIGenerationsManager && typeof window.gvpUIGenerationsManager.refreshGenerationList === 'function') {
            window.gvpUIGenerationsManager.refreshGenerationList();
        }
        
        console.log(`[GVP Multi] Successfully cancelled generation for id: ${targetId}`);
    }
};