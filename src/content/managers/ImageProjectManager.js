// a:/Tools n Programs/SD-GrokScripts/grok-video-prompter-extension/src/content/managers/ImageProjectManager.js
// Manages image-centric project history with version control.
// Dependencies: StateManager

window.ImageProjectManager = class ImageProjectManager {
    constructor(stateManager) {
        this.stateManager = stateManager;
        this.accountProjects = new Map(); // accountId -> Map(imageId -> projectData)
        this.activeAccountId = null;
        this.activeProject = null;
        this.activeImageId = null;
        this.autoLoadOnImageAccess = true;

        this.onProjectUpdated = null;
    }

    /**
     * Initialize project manager and load existing data
     */
    initialize() {
        this.loadProjectData();
    }

    /**
     * Register a new image project or update existing one
     * Unified method supporting both legacy prompt entries and new metadata schema.
     * 
     * @param {string} accountId - Account ID
     * @param {string} imageId - Unique image identifier
     * @param {object} data - Prompt entry data OR metadata object
     * @param {object} options - Additional options (e.g. imageUrl, isGeneration)
     */
    async registerImageProject(accountId, imageId, data = {}, options = {}) {
        if (!accountId || !imageId) {
            console.warn('[GVP History] Missing accountId or imageId for project registration');
            return;
        }

        const projects = this._ensureAccountProjects(accountId);
        // Pass imageUrl from options if available for creation
        const project = projects.get(imageId) || this._createProject(imageId, options);

        project.lastAccessed = Date.now();
        if (options.imageUrl) {
            project.imageUrl = options.imageUrl;
        }

        // Handle Prompt Entry (Legacy/Current UI usage)
        // If data has 'prompt' or 'type', treat it as a prompt entry
        if (data.prompt || data.type) {
            project.promptEntries.push({
                id: `prompt_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`,
                ...data,
                timestamp: data.timestamp || Date.now()
            });
            project.promptEntries.sort((a, b) => b.timestamp - a.timestamp);
        }

        // Handle Generation History (New Schema)
        // If options.isGeneration is true, OR if data looks like a generation event
        const isGeneration = options.isGeneration || data.source === 'generation';

        if (isGeneration) {
            const timestamp = data.timestamp || Date.now();

            // Map data to new schema
            const historyEntry = {
                timestamp,
                sourceType: data.sourceType || 'generated',
                prompt: data.prompt || '',
                mode: data.mode || 'normal',
                toggles: data.toggles || {},
                status: data.status || (data.moderated ? 'failed' : 'success'),
                moderation: data.moderation || { flagged: !!data.moderated, progressAtFlag: 0 },
                mediaUrls: data.mediaUrls || {
                    image: project.imageUrl || '',
                    video: data.videoUrl || ''
                },
                models: data.models || {
                    imageModel: data.modelName || '',
                    videoModel: ''
                }
            };

            project.generationHistory.push(historyEntry);

            // Update stats
            project.metadata.totalGenerations++;
            if (historyEntry.status === 'success') {
                project.metadata.successfulGenerations++;
            }
        }

        // Save to memory
        projects.set(imageId, project);
        this.accountProjects.set(accountId, projects);

        // Update active state if matches
        if (this.activeAccountId === accountId && this.activeImageId === imageId) {
            this.activeProject = project;
        }

        // Persist to IndexedDB
        await this.saveProjectData(accountId, imageId, project);

        console.log(`[GVP History] Registered project for account ${accountId} image ${imageId}`);

        if (typeof this.onProjectUpdated === 'function') {
            try {
                this.onProjectUpdated({ accountId, imageId, project });
            } catch (callbackError) {
                console.error('[GVP History] onProjectUpdated callback failed:', callbackError);
            }
        }
    }

    /**
     * Load project data when image is accessed
     * @param {string} imageId - Image identifier
     * @returns {object|null} Project data or null if not found
     */
    async loadImageProject(imageId, accountId = this.activeAccountId) {
        const projects = this._ensureAccountProjects(accountId);
        if (!projects || !projects.has(imageId)) {
            console.log(`[GVP History] No existing project for image ${imageId}`);
            return null;
        }

        const project = projects.get(imageId);
        project.lastAccessed = Date.now();

        // Set as active project for UI
        this.activeProject = project;
        if (accountId && accountId !== this.activeAccountId) {
            this.activeAccountId = accountId;
        }
        this.activeImageId = imageId;

        console.log(`[GVP History] Loaded project for account ${accountId} image ${imageId} with ${project.promptEntries.length} prompts`);
        return project;
    }

    /**
     * Get all JSON versions for an image
     * @param {string} imageId - Image identifier
     * @returns {Array} Array of JSON versions
     */
    getImageJsonVersions(imageId) {
        const projects = this._ensureAccountProjects(this.activeAccountId);
        const project = projects?.get(imageId);
        return project ? project.promptEntries : [];
    }

    /**
     * Set favorite JSON for an image
     * @param {string} imageId - Image identifier
     * @param {string} jsonId - JSON version ID
     */
    setFavoriteJson(imageId, jsonId) {
        const projects = this._ensureAccountProjects(this.activeAccountId);
        const project = projects?.get(imageId);
        if (project) {
            project.promptEntries.forEach(json => {
                json.isFavorite = json.id === jsonId;
            });
            project.metadata.favoriteJson = jsonId;
            this.saveProjectData(this.activeAccountId, imageId, project);
        }
    }

    /**
     * Delete a JSON version
     * @param {string} imageId - Image identifier
     * @param {string} jsonId - JSON version ID
     */
    deleteJsonVersion(imageId, jsonId) {
        const projects = this._ensureAccountProjects(this.activeAccountId);
        const project = projects?.get(imageId);
        if (project) {
            project.promptEntries = project.promptEntries.filter(json => json.id !== jsonId);
            this.saveProjectData(this.activeAccountId, imageId, project);
            console.log(`[GVP History] Deleted JSON version ${jsonId} for image ${imageId}`);
        }
    }

    /**
     * Get statistics for an image project
     * @param {string} imageId - Image identifier
     * @returns {object|null} Project statistics or null
     */
    getProjectStats(imageId) {
        const projects = this._ensureAccountProjects(this.activeAccountId);
        const project = projects?.get(imageId);
        if (!project) return null;

        return {
            totalPrompts: project.promptEntries.length,
            totalGenerations: project.metadata.totalGenerations,
            successfulGenerations: project.metadata.successfulGenerations,
            favoriteJson: project.metadata.favoriteJson,
            lastAccessed: project.lastAccessed,
            createdAt: project.createdAt
        };
    }

    /**
     * Extract image ID from URL
     * @param {string} imageUrl - Image URL
     * @returns {string|null} Extracted image ID
     */
    extractImageId(imageUrl) {
        // Extract unique identifier from image URL
        const match = imageUrl.match(/\/([^\/]+)\/(content|image)\.jpg$/);
        return match ? match[1] : null;
    }

    // =========================================================================
    // PERSISTENCE (INDEXEDDB)
    // =========================================================================

    /**
     * Save project data to IndexedDB
     * @param {string} accountId 
     * @param {string} imageId 
     * @param {Object} projectData 
     */
    async saveProjectData(accountId, imageId, projectData) {
        if (!this.stateManager?.storageManager?.indexedDBManager) {
            console.warn('[GVP History] IndexedDBManager not available, cannot save project.');
            return;
        }

        try {
            await this.stateManager.storageManager.indexedDBManager.saveImageProject(accountId, imageId, projectData);
        } catch (error) {
            console.error('[GVP History] Failed to save project to IndexedDB:', error);
        }
    }

    /**
     * Load project data from IndexedDB
     */
    async loadProjectData() {
        if (!this.stateManager?.storageManager?.indexedDBManager) {
            console.warn('[GVP History] IndexedDBManager not available, cannot load projects.');
            return;
        }

        try {
            // First, try to migrate legacy data if it exists
            await this.stateManager.storageManager.indexedDBManager.migrateImageProjectsFromChromeStorage();

            // Load active account from chrome.storage (still safe for small data)
            const storageResult = await chrome.storage.local.get(['gvp-active-account']);
            let accountId = storageResult['gvp-active-account'];

            // Fallback: Check StateManager if chrome.storage is empty
            if (!accountId && this.stateManager?.state?.multiGenHistory?.activeAccountId) {
                accountId = this.stateManager.state.multiGenHistory.activeAccountId;
                console.log(`[GVP History] Inferred active account from StateManager: ${accountId}`);
                // Sync back to storage
                chrome.storage.local.set({ 'gvp-active-account': accountId });
            }
            this.activeAccountId = accountId || 'default';

            // Load projects for the active account
            const projects = await this.stateManager.storageManager.indexedDBManager.getImageProjectsByAccount(this.activeAccountId);

            // Reconstruct the Map structure
            if (!this.accountProjects.has(this.activeAccountId)) {
                this.accountProjects.set(this.activeAccountId, new Map());
            }

            const accountMap = this.accountProjects.get(this.activeAccountId);
            if (projects && projects.length > 0) {
                for (const project of projects) {
                    if (project && project.imageId) {
                        accountMap.set(project.imageId, project);
                    }
                }
                console.log(`[GVP History] Loaded ${projects.length} projects for account ${this.activeAccountId} from IndexedDB`);
            } else {
                console.log(`[GVP History] No existing projects found for account ${this.activeAccountId}`);
            }

            // Sync from Gallery Data (Backfill)
            this.syncFromGalleryData().catch(err => console.warn('[GVP History] Gallery sync failed:', err));

        } catch (error) {
            console.error('[GVP History] Failed to load project data:', error);
        }
    }

    /**
     * Sync project history from cached Gallery Data
     */
    async syncFromGalleryData() {
        if (!this.stateManager?.storageManager?.indexedDBManager) return;

        console.log('[GVP History] 🔄 Syncing from Gallery Data...');
        const galleryPosts = await this.stateManager.storageManager.indexedDBManager.getAllGalleryPosts();

        if (!galleryPosts || galleryPosts.length === 0) {
            console.log('[GVP History] No gallery data to sync.');
            return;
        }

        let syncedCount = 0;
        for (const post of galleryPosts) {
            // Adopt 'default' or missing account posts into current active account
            let accountId = post.accountId;
            if ((!accountId || accountId === 'default') && this.activeAccountId && this.activeAccountId !== 'default') {
                accountId = this.activeAccountId;
            }
            // Fallback to active (or default if active is default)
            accountId = accountId || this.activeAccountId;

            const imageId = post.imageId || post.id;

            if (!imageId || !accountId) continue;

            const projects = this._ensureAccountProjects(accountId);
            // Ensure project exists so we can check duplicates
            if (!projects.has(imageId)) {
                projects.set(imageId, this._createProject(imageId, { imageUrl: post.imageUrl || post.thumbnailUrl }));
            }
            const project = projects.get(imageId);

            const timestamp = post.timestamp || Date.now();
            const imagePrompt = post.prompt || post.originalPrompt;

            // 1. Sync Image Prompt (as Prompt Entry)
            if (imagePrompt) {
                const isPromptDuplicate = project.promptEntries.some(e =>
                    e.prompt === imagePrompt ||
                    (e.timestamp === timestamp)
                );

                if (!isPromptDuplicate) {
                    await this.registerImageProject(accountId, imageId, {
                        prompt: imagePrompt,
                        timestamp: timestamp,
                        type: 'raw', // Assume raw unless it parses as JSON
                        source: 'gallery_image'
                    }, { isGeneration: false, imageUrl: post.imageUrl });
                    syncedCount++;
                }
            }

            // 2. Sync Video Generations (from childPosts)
            const rawPost = post.raw || post;
            if (Array.isArray(rawPost.childPosts)) {
                for (const child of rawPost.childPosts) {
                    if (child.mediaType === 'MEDIA_POST_TYPE_VIDEO') {
                        const videoPrompt = child.prompt || '';
                        const videoUrl = child.mediaUrl || '';
                        const videoTimestamp = child.createdAt || timestamp;

                        // Check duplicate by videoUrl or timestamp
                        const isVideoDuplicate = project.generationHistory.some(h =>
                            (videoUrl && h.mediaUrls?.video === videoUrl) ||
                            (h.timestamp === videoTimestamp)
                        );

                        if (!isVideoDuplicate) {
                            await this.registerImageProject(accountId, imageId, {
                                sourceType: 'gallery_video',
                                prompt: videoPrompt,
                                timestamp: videoTimestamp,
                                mediaUrls: {
                                    image: post.imageUrl || post.thumbnailUrl || '',
                                    video: videoUrl
                                },
                                models: {
                                    imageModel: post.modelName || '',
                                    videoModel: '' // Video model often not in childPost
                                },
                                status: 'success',
                                mode: 'normal'
                            }, { isGeneration: true, imageUrl: post.imageUrl });
                            syncedCount++;
                        }
                    }
                }
            }
        }

        if (syncedCount > 0) {
            console.log(`[GVP History] ✅ Synced ${syncedCount} entries (prompts/videos) from Gallery Data`);
        } else {
            console.log('[GVP History] Gallery sync complete (no new entries).');
        }
    }

    /**
     * Get all projects for UI display
     * @returns {Array} Array of project summaries
     */
    getAllProjects() {
        const projects = this._ensureAccountProjects(this.activeAccountId);
        if (!projects) return [];

        return Array.from(projects.values()).map(project => ({
            imageId: project.imageId,
            imageUrl: project.imageUrl,
            promptCount: project.promptEntries.length,
            lastAccessed: project.lastAccessed,
            createdAt: project.createdAt,
            sourceType: project.generationHistory?.[0]?.sourceType || 'unknown'
        }));
    }

    setActiveAccount(accountId) {
        if (accountId && accountId !== this.activeAccountId) {
            this.activeAccountId = accountId;
            this.activeProject = null;
            chrome.storage.local.set({ 'gvp-active-account': accountId });
        }
    }

    getActiveAccount() {
        return this.activeAccountId;
    }

    appendPromptEntry(accountId, imageId, entry) {
        // This method now maps to the unified registerImageProject
        // It assumes 'entry' is a prompt entry object.
        return this.registerImageProject(accountId, imageId, entry, { isGeneration: false });
    }

    getPromptHistory(accountId, imageId, options = {}) {
        const projects = this._ensureAccountProjects(accountId);
        const project = projects?.get(imageId);
        if (!project) return [];

        const { modelFilter, includeRaw = true, includeJson = true } = options;
        return project.promptEntries.filter((entry) => {
            if (modelFilter && entry.modelName && !entry.modelName.toLowerCase().includes(modelFilter.toLowerCase())) {
                return false;
            }

            if (!includeRaw && entry.type === 'raw') {
                return false;
            }

            if (!includeJson && entry.type === 'json') {
                return false;
            }

            return true;
        });
    }

    _ensureAccountProjects(accountId) {
        if (!accountId) {
            return null;
        }

        if (!this.accountProjects.has(accountId)) {
            this.accountProjects.set(accountId, new Map());
        }

        return this.accountProjects.get(accountId);
    }

    _createProject(imageId, options = {}) {
        return {
            imageId,
            imageUrl: options.imageUrl || null,
            createdAt: Date.now(),
            lastAccessed: Date.now(),
            promptEntries: [],
            generationHistory: [],
            metadata: {
                totalGenerations: 0,
                successfulGenerations: 0,
                favoriteJson: null,
                tags: []
            }
        };
    }

    getActiveImageId() {
        return this.activeImageId;
    }

    ensureActiveContext({ accountId, imageId } = {}) {
        let resolvedAccount = accountId || this.activeAccountId;
        let resolvedImage = imageId || this.activeImageId;

        if (!resolvedAccount && resolvedImage) {
            for (const [candidateAccount, projects] of this.accountProjects.entries()) {
                if (projects.has(resolvedImage)) {
                    resolvedAccount = candidateAccount;
                    break;
                }
            }
        }

        if (!resolvedAccount && this.accountProjects.size > 0) {
            const iterator = this.accountProjects.keys();
            const firstAccountId = iterator.next().value;
            if (firstAccountId) {
                resolvedAccount = firstAccountId;
            }
        }

        let projects = null;
        if (resolvedAccount) {
            projects = this.accountProjects.get(resolvedAccount) || null;
            if (!projects) {
                projects = new Map();
                this.accountProjects.set(resolvedAccount, projects);
            }
        }

        if (!resolvedImage && projects && projects.size > 0) {
            const iterator = projects.keys();
            const firstImageId = iterator.next().value;
            if (firstImageId) {
                resolvedImage = firstImageId;
            }
        }

        if (resolvedAccount) {
            this.activeAccountId = resolvedAccount;
        }

        if (resolvedImage) {
            this.activeImageId = resolvedImage;
            if (projects && projects.has(resolvedImage)) {
                this.activeProject = projects.get(resolvedImage) || null;
            }
        }

        return {
            accountId: this.activeAccountId,
            imageId: this.activeImageId
        };
    }
};