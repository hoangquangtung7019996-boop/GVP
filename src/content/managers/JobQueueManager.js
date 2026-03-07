// JobQueueManager.js - Background job queue for batch operations
// Dependencies: StateManager, IndexedDBManager
// Inspired by ImagineGod's job queue pattern

window.JobQueueManager = class JobQueueManager {
    constructor(stateManager) {
        this.stateManager = stateManager;
        this.jobs = [];
        this.isProcessing = false;
        this.currentJobId = null;
        this._persistenceKey = 'gvp-job-queue';

        // Job types
        this.JOB_TYPES = {
            UPSCALE: 'upscale',
            UNLIKE: 'unlike',
            RELIKE: 'relike',
            PROCESS_POSTS: 'process-posts'
        };

        // Bind handlers
        this._boundVisibilityChange = this._handleVisibilityChange.bind(this);
        document.addEventListener('visibilitychange', this._boundVisibilityChange);

        window.Logger?.info?.('JobQueue', 'JobQueueManager initialized');
    }

    // ═══════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════

    /**
     * Add a job to the queue
     * @param {Object} job - Job object with type and data
     * @returns {string} Job ID
     */
    addJob(job) {
        const jobId = this._generateJobId();
        const newJob = {
            id: jobId,
            type: job.type,
            data: job.data || {},
            status: 'pending',
            progress: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            error: null
        };

        this.jobs.push(newJob);
        this._persist();
        this._dispatchEvent('job-added', newJob);

        window.Logger?.info?.('JobQueue', `Job added: ${job.type}`, { jobId });

        // Start processing if idle
        if (!this.isProcessing) {
            this._processNext();
        }

        return jobId;
    }

    /**
     * Add batch upscale job
     * @param {string[]} videoIds - Array of video IDs to upscale
     * @returns {string} Job ID
     */
    addUpscaleJob(videoIds) {
        return this.addJob({
            type: this.JOB_TYPES.UPSCALE,
            data: { videoIds, processed: 0, total: videoIds.length }
        });
    }

    /**
     * Add batch unlike job
     * @param {string[]} postIds - Array of post IDs to unlike
     * @returns {string} Job ID
     */
    addUnlikeJob(postIds) {
        return this.addJob({
            type: this.JOB_TYPES.UNLIKE,
            data: { postIds, processed: 0, total: postIds.length }
        });
    }

    /**
     * Add batch relike job  
     * @param {string[]} postIds - Array of post IDs to relike
     * @returns {string} Job ID
     */
    addRelikeJob(postIds) {
        return this.addJob({
            type: this.JOB_TYPES.RELIKE,
            data: { postIds, processed: 0, total: postIds.length }
        });
    }

    /**
     * Remove a job from the queue
     * @param {string} jobId - Job ID to remove
     */
    removeJob(jobId) {
        const index = this.jobs.findIndex(j => j.id === jobId);
        if (index !== -1) {
            const removed = this.jobs.splice(index, 1)[0];
            this._persist();
            this._dispatchEvent('job-removed', removed);
            window.Logger?.info?.('JobQueue', `Job removed: ${jobId}`);
        }
    }

    /**
     * Get job by ID
     * @param {string} jobId - Job ID
     * @returns {Object|null} Job object or null
     */
    getJob(jobId) {
        return this.jobs.find(j => j.id === jobId) || null;
    }

    /**
     * Get all jobs
     * @returns {Object[]} Array of jobs
     */
    getAllJobs() {
        return [...this.jobs];
    }

    /**
     * Get pending jobs count
     * @returns {number} Count of pending jobs
     */
    getPendingCount() {
        return this.jobs.filter(j => j.status === 'pending').length;
    }

    /**
     * Clear completed jobs
     */
    clearCompleted() {
        this.jobs = this.jobs.filter(j => j.status !== 'completed');
        this._persist();
        this._dispatchEvent('jobs-cleared');
    }

    /**
     * Pause processing
     */
    pause() {
        this.isProcessing = false;
        window.Logger?.info?.('JobQueue', 'Queue paused');
    }

    /**
     * Resume processing
     */
    resume() {
        if (!this.isProcessing && this.jobs.some(j => j.status === 'pending')) {
            this._processNext();
        }
    }

    /**
     * Load persisted jobs from storage
     */
    async loadFromStorage() {
        try {
            const stored = await chrome.storage.local.get(this._persistenceKey);
            if (stored[this._persistenceKey]) {
                this.jobs = stored[this._persistenceKey];
                window.Logger?.info?.('JobQueue', `Loaded ${this.jobs.length} jobs from storage`);

                // Resume any pending jobs
                if (this.jobs.some(j => j.status === 'pending' || j.status === 'processing')) {
                    this._processNext();
                }
            }
        } catch (error) {
            window.Logger?.warn?.('JobQueue', 'Failed to load jobs from storage', error);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // INTERNAL PROCESSING
    // ═══════════════════════════════════════════════════════════════

    async _processNext() {
        if (this.isProcessing) return;

        const nextJob = this.jobs.find(j => j.status === 'pending');
        if (!nextJob) {
            window.Logger?.debug?.('JobQueue', 'No pending jobs');
            return;
        }

        this.isProcessing = true;
        this.currentJobId = nextJob.id;
        nextJob.status = 'processing';
        nextJob.updatedAt = Date.now();
        this._persist();
        this._dispatchEvent('job-started', nextJob);

        try {
            switch (nextJob.type) {
                case this.JOB_TYPES.UPSCALE:
                    await this._processUpscaleJob(nextJob);
                    break;
                case this.JOB_TYPES.UNLIKE:
                    await this._processUnlikeJob(nextJob);
                    break;
                case this.JOB_TYPES.RELIKE:
                    await this._processRelikeJob(nextJob);
                    break;
                default:
                    throw new Error(`Unknown job type: ${nextJob.type}`);
            }

            nextJob.status = 'completed';
            nextJob.progress = 100;
            window.Logger?.info?.('JobQueue', `Job completed: ${nextJob.id}`);

        } catch (error) {
            nextJob.status = 'failed';
            nextJob.error = error.message;
            window.Logger?.error?.('JobQueue', `Job failed: ${nextJob.id}`, error);
        }

        nextJob.updatedAt = Date.now();
        this.isProcessing = false;
        this.currentJobId = null;
        this._persist();
        this._dispatchEvent('job-completed', nextJob);

        // Process next job if any
        setTimeout(() => this._processNext(), 500);
    }

    async _processUpscaleJob(job) {
        const { videoIds } = job.data;
        job.data.processed = 0;

        for (const videoId of videoIds) {
            try {
                await this._upscaleVideo(videoId);
                job.data.processed++;
                job.progress = Math.round((job.data.processed / job.data.total) * 100);
                this._persist();
                this._dispatchEvent('job-progress', job);

                // Rate limit: wait between requests
                await this._delay(1000);
            } catch (error) {
                window.Logger?.warn?.('JobQueue', `Failed to upscale video: ${videoId}`, error);
            }
        }
    }

    async _processUnlikeJob(job) {
        const { postIds } = job.data;
        job.data.processed = 0;

        for (const postId of postIds) {
            try {
                await this._unlikePost(postId);
                job.data.processed++;
                job.progress = Math.round((job.data.processed / job.data.total) * 100);
                this._persist();
                this._dispatchEvent('job-progress', job);

                await this._delay(500);
            } catch (error) {
                window.Logger?.warn?.('JobQueue', `Failed to unlike post: ${postId}`, error);
            }
        }
    }

    async _processRelikeJob(job) {
        const { postIds } = job.data;
        job.data.processed = 0;

        for (const postId of postIds) {
            try {
                await this._relikePost(postId);
                job.data.processed++;
                job.progress = Math.round((job.data.processed / job.data.total) * 100);
                this._persist();
                this._dispatchEvent('job-progress', job);

                await this._delay(500);
            } catch (error) {
                window.Logger?.warn?.('JobQueue', `Failed to relike post: ${postId}`, error);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // API CALLS (Stubs - implement based on Grok's actual API)
    // ═══════════════════════════════════════════════════════════════

    async _upscaleVideo(videoId) {
        // TODO: Implement when Grok's upscale API is documented
        // Similar to ImagineGod's `/rest/media/video/upscale` pattern
        window.Logger?.debug?.('JobQueue', `Upscaling video: ${videoId} (stub)`);

        // Placeholder - actual implementation would call:
        // await fetch('/rest/media/video/upscale', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify({ videoId }),
        //     credentials: 'include'
        // });

        return { success: true, videoId };
    }

    async _unlikePost(postId) {
        // TODO: Implement unlike API call
        window.Logger?.debug?.('JobQueue', `Unliking post: ${postId} (stub)`);
        return { success: true, postId };
    }

    async _relikePost(postId) {
        // TODO: Implement relike API call
        window.Logger?.debug?.('JobQueue', `Reliking post: ${postId} (stub)`);
        return { success: true, postId };
    }

    // ═══════════════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════════════

    _generateJobId() {
        return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    _persist() {
        try {
            chrome.storage.local.set({ [this._persistenceKey]: this.jobs });
        } catch (error) {
            window.Logger?.warn?.('JobQueue', 'Failed to persist jobs', error);
        }
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    _dispatchEvent(type, data = null) {
        document.dispatchEvent(new CustomEvent(`gvp:job-queue:${type}`, { detail: data }));
    }

    _handleVisibilityChange() {
        // Resume processing when page becomes visible
        if (document.visibilityState === 'visible' && !this.isProcessing) {
            const pending = this.jobs.some(j => j.status === 'pending');
            if (pending) {
                window.Logger?.debug?.('JobQueue', 'Page visible, resuming queue');
                this._processNext();
            }
        }
    }

    destroy() {
        document.removeEventListener('visibilitychange', this._boundVisibilityChange);
        this.pause();
        window.Logger?.info?.('JobQueue', 'JobQueueManager destroyed');
    }
};

// Auto-instantiate if StateManager exists
if (!window.gvpJobQueueManager) {
    window.gvpJobQueueManager = new window.JobQueueManager(window.gvpStateManager || null);
    window.gvpJobQueueManager.loadFromStorage();
}
