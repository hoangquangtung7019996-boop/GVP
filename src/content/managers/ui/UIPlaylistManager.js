// UIPlaylistManager.js - Manages auto-playing video playlist
// Discovers all videos from multi-gen history and plays them sequentially

window.Logger.info('UIPlaylist', '🎬 UIPlaylistManager.js file loaded (v1.21.43)');

window.UIPlaylistManager = class UIPlaylistManager {
    constructor(stateManager, shadowRoot, reactAutomation = null, uiModalManager = null, networkInterceptor = null) {
        this.stateManager = stateManager;
        this.shadowRoot = shadowRoot;
        this.reactAutomation = reactAutomation;
        this.uiModalManager = uiModalManager;
        this.networkInterceptor = networkInterceptor;

        // Playlist state
        this.playlist = [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.playerModal = null;
        this.videoElement = null;

        // UI elements
        this.playlistContainer = null;
        this.videoTitle = null;
        this.currentTimeDisplay = null;
        this.progressBar = null;
        this.playPauseBtn = null;
        this.prevBtn = null;
        this.nextBtn = null;
        this.shuffleBtn = null;
        this.loopBtn = null;

        // Settings
        this.shuffle = false;
        this.loop = false;
        this.autoAdvance = true;
        this._missingThumbWarnings = 0;
        this.maxPlaylistItems = Number.MAX_SAFE_INTEGER; // no cap (per user request)
        this._skipWarnings = 0;
        this._consecutiveErrors = 0;  // v1.21.23: Error throttling for autoplay loop prevention
        this._maxConsecutiveErrors = 5;
        this.filterImageId = null;
        this.allVideos = [];
        this._thumbObserver = null;
        this.activeSort = 'date-desc';
        this._preFilterState = null;

        // Sorting
        this.sortBy = 'date'; // 'date', 'mode', 'liked'
        this.sortOrder = 'desc'; // 'asc', 'desc'

        // Late-init reactivity: Re-build playlist if IDB becomes ready
        this._boundHandleLateInit = () => {
            window.Logger.info('UIPlaylist', '📥 Late IDB init detected, refreshing playlist...');
            const accountId = this.stateManager?.state?.multiGenHistory?.activeAccountId;
            if (accountId) {
                this.playlist = this.buildPlaylistFromApi({});
                if (this.playerModal && this.playerModal.parentElement) {
                    window.Logger.info('UIPlaylist', 'Playlist modal open, rebuilding list items');
                    this._updatePlayerUI();
                    this._renderPlaylist({ preserveScroll: true });
                }
            }
        };
        window.addEventListener('gvp:idb-late-init', this._boundHandleLateInit);
    }

    /**
     * Build playlist from multi-gen history
     * @param {string} sortMode - Sorting mode (success-desc, updated-desc, etc.)
     * @returns {Array} Playlist items with video data
     */
    /**
     * @deprecated Use buildPlaylistFromApi() instead. This method uses the old multiGenHistory
     * which does not have enriched URLs/thumbnails from unified storage.
     */
    buildPlaylist(sortMode = 'success-desc') {
        window.Logger.warn('Playlist', '⚠️ DEPRECATED: buildPlaylist() called. Use buildPlaylistFromApi() instead.');
        const entries = this.stateManager?.getMultiGenHistoryEntries?.({ clone: true }) || [];
        const videos = [];

        entries.forEach(entry => {
            // Get all successful attempts with videos
            const successfulAttempts = entry.attempts.filter(
                attempt => attempt.status === 'success' && attempt.videoUrl
            );

            successfulAttempts.forEach(attempt => {
                videos.push({
                    videoUrl: attempt.videoUrl,
                    videoId: attempt.videoId,
                    imageId: entry.imageId,
                    imageUrl: entry.imageUrl,
                    prompt: attempt.prompt || 'No prompt',
                    timestamp: attempt.timestamp || attempt.finishedAt || attempt.startedAt,
                    assetId: attempt.assetId,
                    upscaledVideoUrl: attempt.upscaledVideoUrl || null
                });
            });
        });

        // Sort based on mode
        this._sortPlaylist(videos, sortMode);

        window.Logger.info('Playlist', 'Built playlist with', videos.length, 'videos');
        return videos;
    }

    _sortPlaylist(videos, mode) {
        const coerceTime = (value) => {
            if (!value) return 0;
            const ts = typeof value === 'number' ? value : Date.parse(value);
            return Number.isFinite(ts) ? ts : 0;
        };

        switch (mode) {
            case 'updated-desc':
            case 'success-desc':
                videos.sort((a, b) => coerceTime(b.timestamp) - coerceTime(a.timestamp));
                break;
            case 'success-asc':
                videos.sort((a, b) => coerceTime(a.timestamp) - coerceTime(b.timestamp));
                break;
            default:
                // Keep original order
                break;
        }
    }

    _sortCurrentPlaylist(mode) {
        if (!mode || !Array.isArray(this.playlist)) return;
        const [sortBy, order] = mode.split('-');
        if (mode === 'random') {
            this._shufflePlaylist();
            return;
        }
        if (sortBy === 'date') {
            this.playlist.sort((a, b) => {
                const dateA = new Date(a.createTime || 0).getTime();
                const dateB = new Date(b.createTime || 0).getTime();
                return order === 'desc' ? dateB - dateA : dateA - dateB;
            });
        }
    }

    /**
     * Build playlist from gallery data (loaded from IndexedDB or live API)
     * 
     * **ARCHITECTURE NOTE:**
     * - Gallery data is automatically loaded from IndexedDB on extension startup (StateManager.initialize)
     * - NetworkInterceptor captures new API responses and persists to IndexedDB
     * - This method reads from state.galleryData which is populated from EITHER:
     *   1. IndexedDB (instant, on startup) - PRIMARY SOURCE
     *   2. Live API calls (when user scrolls Favorites page)
     * 
     * @param {Object} filters - Optional filters (mode, liked, hasPrompt, etc.)
     * @returns {Array} Playlist items with enriched video data
     */
    /**
     * Build playlist from unified history (IndexedDB)
     * @param {Object} filters - Optional filters (mode, liked, hasPrompt, etc.)
     * @returns {Array} Playlist items with enriched video data
     */
    buildPlaylistFromApi(filters = {}) {
        // GVP: Switch to Unified History
        const accountId = this.stateManager?.state?.multiGenHistory?.activeAccountId;

        if (!accountId) {
            window.Logger.warn('Playlist', 'No active account ID found for playlist');
            return [];
        }

        window.Logger.debug('Playlist', '🔍 Fetching unified videos for account:', accountId);

        // Get flattened videos from StateManager (already sorted by newest)
        let videos = this.stateManager.getAllUnifiedVideos(accountId, { sortBy: 'newest' });

        // ALWAYS apply base filters: must have playable URL and not be moderated
        videos = videos
            .filter(video => !!video?.videoUrl)
            .filter(video => video?.moderated !== true && video?.status !== 'moderated');

        // Apply optional Filters
        if (filters.liked) {
            videos = videos.filter(v => v.liked);
        }
        if (filters.mode) {
            videos = videos.filter(v => v.mode === filters.mode);
        }

        window.Logger.debug('Playlist', '📊 Retrieved', videos.length, 'unified videos (filtered)');

        const playlist = videos.map(video => {
            const thumb =
                video.thumbnailUrl ||
                video.parentImageThumbnail ||
                video.imageUrl ||
                video.parentImageUrl ||
                video.parentThumbnailUrl ||
                null;

            const parentImageThumb =
                video.parentImageThumbnail ||
                video.parentThumbnailUrl ||
                video.parentImageUrl ||
                null;

            return {
                videoUrl: video.videoUrl,
                mediaUrl: video.videoUrl,
                videoId: video.id,
                virtualId: video.virtualId, // Crucial for Upscale/Delete operations
                imageId: video.parentImageId,
                imageUrl: parentImageThumb,
                thumbnailUrl: thumb,
                parentImageUrl: parentImageThumb,
                parentThumbnailUrl: parentImageThumb,
                prompt: video.videoPrompt || video.parentImagePrompt || 'No prompt',
                originalPrompt: video.videoPrompt,
                timestamp: video.timestamp,
                createTime: video.timestamp,
                mode: video.mode || 'normal',
                resolution: video.resolution,
                modelName: video.modelName,
                assetId: video.id,
                isApiSource: true,
                liked: video.liked || false,
                parentPost: null, // Deprecated structure
                upscaledVideoUrl: video.upscaledVideoUrl || null
            };
        });

        window.Logger.info('Playlist', '📊 Built Unified playlist', {
            total: playlist.length,
            modes: this._countModes(playlist),
            liked: playlist.filter(v => v.liked).length
        });

        return playlist;
    }

    /**
     * Count videos by mode for logging
     * @private
     */
    _countModes(playlist) {
        const counts = { normal: 0, custom: 0, spicy: 0, other: 0 };
        playlist.forEach(v => {
            if (v.mode === 'normal') counts.normal++;
            else if (v.mode === 'custom') counts.custom++;
            else if (v.mode === 'extremely-spicy-or-crazy') counts.spicy++;
            else counts.other++;
        });
        return counts;
    }

    /**
     * Auto-scroll favorites page to load all videos, then play
     * Now uses API data if available, falls back to DOM scraping
     */
    async playFromFavorites() {
        window.Logger.info('Playlist', '🔍 Building playlist from favorites...');

        // Check if we're on favorites/saved page
        const path = window.location.pathname;
        const isFavorites = path.includes('/imagine/saved') || path.includes('/imagine/favorites');
        if (!isFavorites) {
            this.uiModalManager?.showWarning('Navigate to Favorites page first!');
            return;
        }

        try {
            // ALWAYS prefer unified history for favorites - it has ALL videos
            // Gallery API data is paginated and only contains current page (~40 posts)
            window.Logger.debug('Playlist', '🔍 Checking for API data...', {
                hasStateManager: !!this.stateManager,
                hasMethod: !!this.stateManager?.hasGalleryData,
                methodResult: this.stateManager?.hasGalleryData?.()
            });

            let videos = [];

            // For favorites, skip gallery data - it's incomplete (only current page)
            // Always use unified history which has ALL videos
            window.Logger.debug('Playlist', 'ℹ️ Skipping API data for favorites (paginated, incomplete)');

            // Use unified IndexedDB store for complete video history
            if (videos.length === 0) {
                const accountId = this.stateManager?.state?.multiGenHistory?.activeAccountId;
                window.Logger.debug('Playlist', '🔍 Trying unified history for playlist...', { accountId });

                if (this.stateManager?.loadUnifiedHistory && accountId) {
                    try {
                        await this.stateManager.loadUnifiedHistory(accountId);
                    } catch (err) {
                        window.Logger.warn('Playlist', '⚠️ Failed to load unified history on demand:', err);
                    }
                }

                const unifiedVideos = this.stateManager?.getAllUnifiedVideos?.(accountId, { sortBy: 'newest' }) || [];
                window.Logger.debug('Playlist', '📦 Unified history returned', unifiedVideos.length, 'videos');

                videos = unifiedVideos
                    .filter(video => !!video?.videoUrl) // skip entries with no playable URL
                    .filter(video => video?.moderated !== true && video?.status !== 'moderated')
                    .map(video => ({
                        videoUrl: video.videoUrl,
                        mediaUrl: video.videoUrl,
                        videoId: video.id,
                        virtualId: video.virtualId, // Crucial for Upscale/Delete operations
                        imageId: video.parentImageId,
                        imageUrl: video.parentImageThumbnail || video.parentThumbnailUrl || video.parentImageUrl,
                        thumbnailUrl: video.thumbnailUrl || video.parentImageThumbnail || video.parentThumbnailUrl || video.parentImageUrl,
                        parentImageUrl: video.parentImageThumbnail || video.parentThumbnailUrl || video.parentImageUrl,
                        parentThumbnailUrl: video.parentImageThumbnail || video.parentThumbnailUrl || video.parentImageUrl,
                        prompt: video.videoPrompt || video.parentImagePrompt || 'No prompt',
                        originalPrompt: video.videoPrompt,
                        timestamp: video.timestamp,
                        createTime: video.timestamp,
                        mode: video.mode || 'normal',
                        resolution: video.resolution,
                        modelName: video.modelName,
                        assetId: video.id,
                        isApiSource: true,
                        isApiSource: true,
                        liked: video.liked || false,
                        parentPost: null,
                        upscaledVideoUrl: video.upscaledVideoUrl || null
                    }));
            }

            // Cap to avoid overwhelming UI with massive histories
            if (videos.length > this.maxPlaylistItems) {
                window.Logger.info('Playlist', '?? Truncating playlist to max items', this.maxPlaylistItems, 'of', videos.length);
                videos = videos.slice(0, this.maxPlaylistItems);
            }

            if (videos.length > 0) {
                this.filterImageId = null;
                this._skipWarnings = 0;
                this.allVideos = videos;
                this.playlist = [...videos];
                this._sortCurrentPlaylist(this.activeSort || 'date-desc');
                if (this.shuffle) {
                    this._shufflePlaylist();
                }

                this.currentIndex = 0;
                this.isPlaying = true;

                this._createPlayerModal();
                this._showPlayer();
                this._loadVideo(0);
                return;
            }

            window.Logger.warn('Playlist', '⚠️ No videos found; showing empty shell. DOM scraping is disabled.');

            // Show the UI shell even if we have no data, so user can see the player
            this.playlist = [];
            this._createPlayerModal();
            this._showPlayer();
            this._renderPlaylist();
            this.uiModalManager?.showWarning('Video Playlist needs fresh data. Reload the page to fetch favorites via API.');
            window.Logger.warn('Playlist', 'Auto-scroll disabled. DOM scraping removed.');

        } catch (error) {
            window.Logger.error('Playlist', 'Error loading favorites:', error);
            this.playlist = [];
            this._createPlayerModal();
            this._showPlayer();
            this._renderPlaylist();
            this.uiModalManager?.showError('Failed to load videos from Favorites');
        }
    }





    /**
     * Start playlist playback
     * @param {string} sortMode - Sorting mode to use (default: 'date-desc')
     */
    play(sortMode = 'date-desc') {
        // v1.21.23: Use unified history via buildPlaylistFromApi() instead of deprecated buildPlaylist()
        window.Logger.info('Playlist', '🎬 Starting playback via unified history...');
        this.playlist = this.buildPlaylistFromApi({});
        this.allVideos = [...this.playlist];
        this.filterImageId = null;
        this._skipWarnings = 0;
        this._sortCurrentPlaylist(this.activeSort || sortMode);

        if (!this.playlist.length) {
            this.uiModalManager?.showWarning('No videos found in unified history. Try syncing first!');
            return;
        }

        this._createPlayerModal();
        this._showPlayer();
        if (this.playlist.length) {
            if (this.shuffle) {
                this._shufflePlaylist();
            }
            this.currentIndex = 0;
            this.isPlaying = true;
            this._loadVideo(0);
        } else {
            this._renderPlaylist();
        }
    }

    /**
     * Play videos from a specific history entry in the player modal.
     * Called from history card 🎥 button.
     * @param {Object} entry - History entry with imageId and attempts array
     */
    playForHistoryEntry(entry) {
        if (!entry || !entry.imageId) {
            window.Logger.warn('Playlist', 'No entry provided for playForHistoryEntry');
            return;
        }

        window.Logger.info('Playlist', '🎬 Playing videos for image:', entry.imageId);

        // Build playlist from this entry's successful attempts
        const successfulAttempts = (entry.attempts || []).filter(
            attempt => attempt.status === 'success' && attempt.videoUrl
        );

        if (!successfulAttempts.length) {
            this.uiModalManager?.showWarning('No successful videos found for this image.');
            return;
        }

        // Convert attempts to playlist format
        const videos = successfulAttempts.map(attempt => ({
            videoUrl: attempt.videoUrl,
            mediaUrl: attempt.videoUrl,
            videoId: attempt.videoId || attempt.id,
            imageId: entry.imageId,
            imageUrl: entry.thumbnailUrl || entry.imageUrl || entry.imageThumbnailUrl,
            thumbnailUrl: entry.thumbnailUrl || entry.imageUrl || entry.imageThumbnailUrl,
            prompt: attempt.prompt || entry.prompt || 'No prompt',
            timestamp: attempt.finishedAt || attempt.timestamp || attempt.startedAt,
            createTime: attempt.finishedAt || attempt.timestamp || attempt.startedAt,
            mode: attempt.mode || 'normal',
            assetId: attempt.assetId || attempt.videoId,
            upscaledVideoUrl: attempt.upscaledVideoUrl || null
        }));

        // Sort by timestamp descending (newest first)
        videos.sort((a, b) => {
            const timeA = new Date(a.timestamp || 0).getTime();
            const timeB = new Date(b.timestamp || 0).getTime();
            return timeB - timeA;
        });

        window.Logger.info('Playlist', '📊 Built single-image playlist:', videos.length, 'videos');

        // Set up playlist state
        this.allVideos = [...videos];
        this.playlist = [...videos];
        this.filterImageId = entry.imageId;
        this._skipWarnings = 0;
        this.currentIndex = 0;
        this.isPlaying = true;

        // Open player and load first video
        this._createPlayerModal();
        this._showPlayer();
        this._renderPlaylist();
        this._loadVideo(0);
    }

    /**
     * Create fullscreen player modal
     */
    _createPlayerModal() {
        if (this.playerModal) {

            return; // Already created
        }

        const modal = document.createElement('div');
        modal.id = 'gvp-playlist-player';
        modal.className = 'gvp-playlist-player';

        modal.innerHTML = `
            <style>
                /* Player Modal - Full Screen */
                .gvp-playlist-player {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    background: rgba(0, 0, 0, 0.95);
                    z-index: 999999;
                    display: none;
                }
                
                .gvp-playlist-player.active {
                    display: flex;
                }
                
                .gvp-playlist-player .gvp-playlist-content {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    padding: 20px;
                    margin-right: 320px;
                    overflow: hidden;
                    box-sizing: border-box;
                }
                
                /* Close Button */
                .gvp-playlist-player .gvp-playlist-close {
                    position: absolute;
                    top: 20px;
                    right: 340px;
                    width: 40px;
                    height: 40px;
                    border: 2px solid var(--gvp-border);
                    border-radius: 50%;
                    background: var(--gvp-bg-secondary);
                    color: #fff;
                    font-size: 24px;
                    font-weight: bold;
                    cursor: pointer;
                    z-index: 10;
                    transition: all 0.2s;
                }
                
                .gvp-playlist-player .gvp-playlist-close:hover {
                    background: var(--gvp-accent);
                    border-color: var(--gvp-accent);
                    transform: scale(1.1);
                }

                /* Upscale Button */
                .gvp-upscale-video {
                    background: linear-gradient(135deg, #FFD700, #FFA500) !important;
                    color: #000 !important;
                    border: none !important;
                    font-weight: bold !important;
                    text-shadow: none !important;
                }
                .gvp-upscale-video:disabled {
                    background: var(--gvp-border) !important;
                    color: var(--gvp-text-muted) !important;
                    cursor: not-allowed;
                }
                
                /* HD Badge */
                .gvp-thumb-hd-badge {
                    position: absolute;
                    top: 4px;
                    right: 4px;
                    background: rgba(0, 0, 0, 0.8);
                    color: #FFD700;
                    padding: 2px 5px;
                    border-radius: 4px;
                    font-size: 10px;
                    font-weight: bold;
                    border: 1px solid #FFD700;
                    z-index: 5;
                    pointer-events: none;
                    box-shadow: 0 0 4px rgba(0,0,0,0.5);
                }
                
                /* Expanded Video Container */
                .gvp-playlist-player .gvp-video-container-expanded {
                    position: relative;
                    flex: 1;
                    background: #000;
                    border: 2px solid var(--gvp-border);
                    border-radius: 8px;
                    overflow: hidden;
                    margin-bottom: 12px;
                    width: 100%;
                }
                
                .gvp-playlist-player .gvp-playlist-video {
                    width: 100%;
                    height: 100%;
                    object-fit: contain;
                }
                
                .gvp-playlist-player .gvp-playlist-loading {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    color: #fff;
                    font-size: 18px;
                }
                
                /* Counter Overlay on Video */
                .gvp-playlist-player .gvp-video-counter-overlay {
                    position: absolute;
                    top: 12px;
                    right: 12px;
                    background: rgba(0, 0, 0, 0.8);
                    backdrop-filter: blur(8px);
                    padding: 8px 16px;
                    border-radius: 6px;
                    color: #fff;
                    font-size: 14px;
                    font-weight: 600;
                    z-index: 5;
                }
                
                /* Compact Accordion */
                .gvp-playlist-player .gvp-metadata-accordion {
                    border: 1px solid var(--gvp-border);
                    border-radius: 6px;
                    background: #2a2a2a;
                    margin-bottom: 12px;
                    width: 100%;
                    max-width: 100%;
                    box-sizing: border-box;
                }
                
                .gvp-playlist-player .gvp-accordion-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 10px 16px;
                    cursor: pointer;
                    user-select: none;
                    transition: background 0.2s;
                    position: relative;
                    z-index: 1;
                    width: 100%;
                    max-width: 100%;
                    box-sizing: border-box;
                }
                
                .gvp-playlist-player .gvp-accordion-header:hover {
                    background: #333;
                }
                
                .gvp-playlist-player .gvp-accordion-title {
                    font-size: 14px;
                    font-weight: 600;
                    color: #fff;
                    flex: 1;
                    min-width: 0;
                }
                
                .gvp-playlist-player .gvp-accordion-arrow {
                    transition: transform 0.2s;
                    display: inline-block;
                    margin-right: 8px;
                }
                
                .gvp-playlist-player .gvp-metadata-accordion[open] .gvp-accordion-arrow {
                    transform: rotate(90deg);
                }
                
                .gvp-playlist-player .gvp-accordion-actions {
                    display: flex;
                    gap: 8px;
                    z-index: 10;
                    position: relative;
                    margin-right: auto;
                }
                
                .gvp-playlist-player .gvp-action-btn {
                    padding: 6px 12px;
                    border: 1px solid #3a3a3a;
                    border-radius: 4px;
                    background: #1a1a1a;
                    color: #fff;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                    text-decoration: none;
                    display: inline-block;
                    white-space: nowrap;
                    position: relative;
                    z-index: 20;
                }
                
                .gvp-playlist-player .gvp-action-btn:hover {
                    background: #333;
                    border-color: #4E4E4E;
                }
                
                .gvp-playlist-player .gvp-accordion-content {
                    padding: 16px;
                    border-top: 1px solid #3a3a3a;
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 12px;
                }
                
                .gvp-playlist-player .gvp-metadata-row {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                
                .gvp-playlist-player .gvp-metadata-label {
                    font-size: 11px;
                    text-transform: uppercase;
                    color: #9ca3af;
                    font-weight: 600;
                    letter-spacing: 0.5px;
                }
                
                .gvp-playlist-player .gvp-metadata-value {
                    font-size: 13px;
                    color: #fff;
                }
                
                .gvp-playlist-player .gvp-prompt-block {
                    grid-column: 1 / -1;
                    margin-top: 8px;
                }
                
                .gvp-playlist-player .gvp-prompt-label {
                    font-size: 11px;
                    text-transform: uppercase;
                    color: #9ca3af;
                    font-weight: 600;
                    letter-spacing: 0.5px;
                    margin-bottom: 8px;
                }
                
                .gvp-playlist-player .gvp-prompt-text {
                    padding: 12px;
                    background: #1a1a1a;
                    border: 1px solid #3a3a3a;
                    border-radius: 4px;
                    color: #fff;
                    font-size: 13px;
                    line-height: 1.5;
                    max-height: 120px;
                    overflow-y: auto;
                }
                
                /* Playback Controls - Centered */
                .gvp-playlist-player .gvp-playback-controls {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    gap: 12px;
                    padding: 12px 0;
                }
                
                .gvp-playlist-player .gvp-control-btn {
                    width: 48px;
                    height: 48px;
                    border: 2px solid #3a3a3a;
                    border-radius: 50%;
                    background: #2a2a2a;
                    color: #fff;
                    font-size: 18px;
                    cursor: pointer;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .gvp-playlist-player .gvp-control-btn:hover {
                    background: #333;
                    border-color: #4E4E4E;
                    transform: scale(1.1);
                }
                
                .gvp-playlist-player .gvp-control-primary {
                    width: 56px;
                    height: 56px;
                    background: #262626;
                    border: 2px solid #48494b;
                    font-size: 20px;
                }
                
                .gvp-playlist-player .gvp-control-primary:hover {
                    background: #343434;
                    transform: scale(1.15);
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
                }
                
                /* Playlist Sidebar */
                .gvp-playlist-player .gvp-playlist-sidebar {
                    position: fixed;
                    right: 0;
                    top: 0;
                    width: 320px;
                    height: 100vh;
                    background: #141414;
                    border-left: 1px solid #2f2f2f;
                    display: flex;
                    flex-direction: column;
                }

                .gvp-playlist-player .gvp-playlist-sidebar-header {
                    padding: 12px;
                    border-bottom: 1px solid #2f2f2f;
                    background: #181818;
                }

                .gvp-playlist-player .gvp-playlist-header-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: #fff;
                    margin-bottom: 6px;
                }
                
                /* Sorting control (single dropdown) */
                .gvp-playlist-player .gvp-playlist-sort-controls {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }

                .gvp-playlist-player .gvp-playlist-select {
                    padding: 8px 10px;
                    background: #1f1f1f;
                    border: 1px solid #2f2f2f;
                    border-radius: 4px;
                    color: #f4f4f5;
                    font-size: 12px;
                    cursor: pointer;
                    appearance: none;
                }

                .gvp-playlist-player .gvp-playlist-select:hover {
                    background: #252525;
                    border-color: #3a3a3a;
                }

                .gvp-playlist-player .gvp-playlist-select:focus {
                    outline: 1px solid #48494b;
                    border-color: #48494b;
                }
                
                .gvp-playlist-player .gvp-playlist-items {
                    flex: 1;
                    overflow-y: auto;
                    padding: 8px;
                }
                
                .gvp-playlist-player .gvp-playlist-item {
                    display: flex;
                    gap: 12px;
                    padding: 8px;
                    margin-bottom: 8px;
                    background: #2a2a2a;
                    border: 1px solid #3a3a3a;
                    border-radius: 4px;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                
                .gvp-playlist-player .gvp-playlist-item:hover {
                    background: #333;
                    border-color: #4E4E4E;
                }
                
                .gvp-playlist-player .gvp-playlist-item.active {
                    background: #333;
                    border-color: #f4f4f5;
                }
                
                .gvp-playlist-player .gvp-playlist-item-thumb {
                    width: 100px;
                    height: 100px;
                    object-fit: contain;
                    border-radius: 4px;
                    background: #1a1a1a;
                    flex-shrink: 0;
                }
                
                .gvp-playlist-player .gvp-playlist-item-info {
                    flex: 1;
                    min-width: 0;
                }

                /* Video Playlist (thumbnail list) */
                .gvp-playlist-player .gvp-playlist-items {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    padding: 8px;
                    background: #141414;
                }

                .gvp-playlist-player .gvp-playlist-thumb-btn {
                    display: flex;
                    align-items: flex-start;
                    gap: 8px;
                    width: 100%;
                    background: #1b1b1b;
                    border: 1px solid #2f2f2f;
                    border-radius: 6px;
                    padding: 8px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .gvp-playlist-player .gvp-playlist-thumb-btn:hover {
                    background: #222;
                    border-color: #3a3a3a;
                }

                .gvp-playlist-player .gvp-playlist-thumb-btn.active {
                    background: #262626;
                    border-color: #48494b;
                }

                .gvp-playlist-player .gvp-thumb-image {
                    width: 112px;
                    height: 112px;
                    object-fit: contain;
                    border-radius: 4px;
                    border: 1px solid #2f2f2f;
                    background: #0f0f0f;
                    flex-shrink: 0;
                    align-self: flex-start;
                }

                /* v1.21.45: Shimmer animation for lazy loading */
                .gvp-playlist-player .gvp-thumb-image.gvp-thumb-loading {
                    background: linear-gradient(90deg, #1a1a1a 0%, #2a2a2a 50%, #1a1a1a 100%);
                    background-size: 200% 100%;
                    animation: gvp-shimmer 1.5s infinite;
                }

                .gvp-playlist-player .gvp-thumb-image.gvp-thumb-loaded {
                    animation: gvp-fade-in 0.3s ease-out;
                }

                @keyframes gvp-shimmer {
                    0% { background-position: 200% 0; }
                    100% { background-position: -200% 0; }
                }

                @keyframes gvp-fade-in {
                    from { opacity: 0.5; }
                    to { opacity: 1; }
                }

                .gvp-playlist-player .gvp-thumb-focus-btn {
                    margin-left: auto;
                    padding: 4px 6px;
                    font-size: 10px;
                    border-radius: 4px;
                    border: 1px solid #2f2f2f;
                    background: #1f1f1f;
                    color: #ddd;
                    cursor: pointer;
                    transition: all 0.15s ease;
                }

                .gvp-playlist-player .gvp-thumb-focus-btn:hover {
                    background: #2a2a2a;
                    border-color: #3a3a3a;
                    color: #fff;
                }

                .gvp-playlist-player .gvp-playlist-filter-banner {
                    display: none;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                    padding: 6px 10px;
                    background: #1b1b1b;
                    border-bottom: 1px solid #2f2f2f;
                    color: #d1d5db;
                    font-size: 12px;
                }

                .gvp-playlist-player .gvp-filter-clear-btn {
                    padding: 4px 8px;
                    font-size: 11px;
                    border-radius: 4px;
                    border: 1px solid #2f2f2f;
                    background: #242424;
                    color: #e5e7eb;
                    cursor: pointer;
                }

                .gvp-playlist-player .gvp-filter-clear-btn:hover {
                    background: #2f2f2f;
                }

                .gvp-playlist-player .gvp-thumb-number {
                    color: #a3a3a3;
                    font-size: 11px;
                    font-weight: 600;
                }

                .gvp-playlist-player .gvp-playlist-item-index {
                    font-size: 11px;
                    color: #9ca3af;
                    margin-bottom: 4px;
                }
                
                .gvp-playlist-player .gvp-playlist-item-mode {
                    font-size: 12px;
                    color: #fff;
                    font-weight: 500;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
            </style>
            
            <div class="gvp-playlist-content">
                <!-- Close button -->
                <button class="gvp-playlist-close" title="Close player">×</button>
                
                <!-- Expanded Video Container -->
                <div class="gvp-video-container-expanded">
                    <video class="gvp-playlist-video" controls autoplay></video>
                    <div class="gvp-playlist-loading">Loading...</div>
                    <div class="gvp-video-counter-overlay">1 / ${this.playlist.length}</div>
                </div>
                
                <!-- Compact Accordion -->
                <details class="gvp-metadata-accordion">
                    <summary class="gvp-accordion-header">
                        <span class="gvp-accordion-title">
                            <span class="gvp-accordion-arrow">▶</span>
                            Details
                        </span>
                        <div class="gvp-accordion-actions">
                            <button class="gvp-action-btn gvp-copy-current-prompt" title="Copy prompt">📋 Copy</button>
                            <button class="gvp-action-btn gvp-upscale-video" title="Upscale to HD">⚡ Upscale</button>
                            <button class="gvp-action-btn gvp-open-image-page" title="Open image page (instant)">📍 Image</button>
                        </div>
                    </summary>
                    <div class="gvp-accordion-content">
                        <div class="gvp-metadata-row">
                            <span class="gvp-metadata-label">Mode</span>
                            <span class="gvp-metadata-value" id="gvp-meta-mode">normal</span>
                        </div>
                        <div class="gvp-metadata-row">
                            <span class="gvp-metadata-label">Created</span>
                            <span class="gvp-metadata-value" id="gvp-meta-created">Unknown</span>
                        </div>
                        <div class="gvp-metadata-row">
                            <span class="gvp-metadata-label">Video Model</span>
                            <span class="gvp-metadata-value" id="gvp-meta-video-model">Unknown</span>
                        </div>
                        <div class="gvp-metadata-row">
                            <span class="gvp-metadata-label">Image Model</span>
                            <span class="gvp-metadata-value" id="gvp-meta-image-model">N/A</span>
                        </div>
                        <div class="gvp-prompt-block" id="gvp-image-prompt-block" style="display: none;">
                            <div class="gvp-prompt-label">Image Prompt</div>
                            <div class="gvp-prompt-text" id="gvp-image-prompt-text"></div>
                        </div>
                        <div class="gvp-prompt-block" id="gvp-video-prompt-block" style="display: none;">
                            <div class="gvp-prompt-label">Video Prompt</div>
                            <div class="gvp-prompt-text" id="gvp-video-prompt-text"></div>
                        </div>
                    </div>
                </details>
                
                <!-- Centered Playback Controls -->
                <div class="gvp-playback-controls">
                    <button class="gvp-control-btn" id="gvp-playlist-prev" title="Previous Video">⏮</button>
                    <button class="gvp-control-btn gvp-control-primary" id="gvp-playlist-play" title="Play/Pause">▶</button>
                    <button class="gvp-control-btn" id="gvp-playlist-next" title="Next Video">⏭</button>
                    <button class="gvp-control-btn" id="gvp-playlist-loop" title="Toggle Loop">🔁</button>
                </div>
            </div>
            
            <!-- Playlist Sidebar -->
            <div class="gvp-playlist-sidebar">
                <div class="gvp-playlist-sidebar-header">
                    <div class="gvp-playlist-header-title">Video Playlist (${this.playlist.length})</div>
                    <div class="gvp-playlist-sort-controls">
                        <select id="gvp-playlist-sort" class="gvp-playlist-select">
                            <option value="date-desc">Newest First</option>
                            <option value="date-asc">Oldest First</option>
                            <option value="random">Random</option>
                        </select>
                        <button id="gvp-sync-gallery" class="gvp-action-btn" title="Sync gallery data from server">🔄 Sync</button>
                    </div>
                </div>
                <div class="gvp-playlist-filter-banner" style="display:none">
                    <span class="gvp-filter-label"></span>
                    <button class="gvp-filter-clear-btn" id="gvp-filter-clear">Back</button>
                </div>
                <div class="gvp-playlist-items"></div>
            </div>
        `;

        this.shadowRoot.appendChild(modal);
        this.playerModal = modal;
        this.videoElement = modal.querySelector('.gvp-playlist-video');
        this.playlistContainer = modal.querySelector('.gvp-playlist-items');
        this.videoTitle = modal.querySelector('.gvp-playlist-title');

        // Wire up events
        this._setupPlayerEvents();
        if (this.activeSort && modal.querySelector('#gvp-playlist-sort')) {
            modal.querySelector('#gvp-playlist-sort').value = this.activeSort;
        }
    }

    _setupPlayerEvents() {
        const modal = this.playerModal;

        // Close button
        modal.querySelector('.gvp-playlist-close').addEventListener('click', () => {
            this._hidePlayer();
        });

        // Control buttons
        // Control buttons
        this.playPauseBtn = modal.querySelector('#gvp-playlist-play');
        this.prevBtn = modal.querySelector('#gvp-playlist-prev');
        this.nextBtn = modal.querySelector('#gvp-playlist-next');
        this.loopBtn = modal.querySelector('#gvp-playlist-loop');

        const clearFilterBtn = modal.querySelector('#gvp-filter-clear');
        if (clearFilterBtn) {
            clearFilterBtn.addEventListener('click', () => {
                this._clearImageIdFilter();
            });
        }

        this.playPauseBtn.addEventListener('click', () => this._togglePlayPause());
        this.prevBtn.addEventListener('click', () => this._playPrevious());
        this.nextBtn.addEventListener('click', () => this._playNext());
        this.loopBtn.addEventListener('click', () => this._toggleLoop());

        // Sorting controls with default sort (guarded; controls removed in current UI)
        const sortDropdown = modal.querySelector('#gvp-playlist-sort');
        if (sortDropdown) {
            sortDropdown.value = this.activeSort || 'date-desc';
            sortDropdown.addEventListener('change', (e) => {
                this.activeSort = e.target.value;
                this._applySorting(this.activeSort);
            });
        }

        // Gallery Sync button - manual bulk fetch
        const syncBtn = modal.querySelector('#gvp-sync-gallery');
        if (syncBtn) {
            syncBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (syncBtn.disabled) return;

                const accountId = this.stateManager?.getActiveMultiGenAccount?.();
                if (!accountId) {
                    window.Logger.warn('Playlist', 'No account ID for sync');
                    return;
                }

                // Reset sync status to force re-fetch
                this.stateManager?.resetAccountSync?.(accountId);

                const originalText = syncBtn.innerHTML;
                syncBtn.innerHTML = '⏳ Syncing...';
                syncBtn.disabled = true;

                try {
                    // Access NetworkInterceptor through instance property (passed in constructor)
                    const networkInterceptor = this.networkInterceptor;
                    if (networkInterceptor?.triggerBulkGallerySync) {
                        const result = await networkInterceptor.triggerBulkGallerySync(accountId, 'favorites');

                        if (result.success) {
                            syncBtn.innerHTML = `✅ ${result.count} synced`;
                            // Reload unified history from IndexedDB and rebuild playlist
                            await this.stateManager?.loadUnifiedHistory?.(accountId);
                            this.playlist = this.buildPlaylistFromApi({});
                            this.allVideos = [...this.playlist];
                            this._renderPlaylist();

                            setTimeout(() => {
                                syncBtn.innerHTML = originalText;
                                syncBtn.disabled = false;
                            }, 1500);
                        } else {
                            throw new Error(result.error || 'Sync failed');
                        }
                    } else {
                        // Fallback: reload unified history from IndexedDB
                        window.Logger.warn('Playlist', 'NetworkInterceptor not available, refreshing from IndexedDB');
                        await this.stateManager?.loadUnifiedHistory?.(accountId);
                        this.playlist = this.buildPlaylistFromApi({});
                        this.allVideos = [...this.playlist];
                        this._renderPlaylist();

                        syncBtn.innerHTML = '✅ Refreshed';
                        setTimeout(() => {
                            syncBtn.innerHTML = originalText;
                            syncBtn.disabled = false;
                        }, 1500);
                    }
                } catch (error) {
                    window.Logger.error('Playlist', 'Sync error:', error);
                    syncBtn.innerHTML = '❌ Failed';
                    this.uiModalManager?.showError?.('Sync failed: ' + error.message);
                    setTimeout(() => {
                        syncBtn.innerHTML = originalText;
                        syncBtn.disabled = false;
                    }, 2000);
                }
            });
        }

        // Copy current prompt button - stop propagation to prevent accordion toggle
        modal.querySelector('.gvp-copy-current-prompt').addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent accordion from toggling
            this._copyPrompt(this.currentIndex);
        });

        // Open Image Page button - uses God Mode Snap for instant navigation
        const openImageBtn = modal.querySelector('.gvp-open-image-page');
        if (openImageBtn) {
            openImageBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent accordion from toggling

                const video = this.playlist[this.currentIndex];
                if (!video) return;

                const imageId = video.imageId || video.parentImageId;
                if (!imageId) {
                    window.Logger.warn('Playlist', 'No imageId for current video');
                    return;
                }

                // God Mode Snap - instant navigation
                const path = `/imagine/post/${imageId}`;
                try {
                    window.history.pushState({}, '', path);
                    window.dispatchEvent(new PopStateEvent('popstate'));
                    window.Logger.info('Playlist', '⚡ Snap navigation to:', path);

                    // Close player after navigation
                    this._hidePlayer();
                } catch (navError) {
                    // Fallback to full navigation
                    window.Logger.warn('Playlist', 'Snap failed, using location.assign', navError);
                    window.location.assign(`https://grok.com${path}`);
                }
            });
        }

        // Upscale button
        const upscaleBtn = modal.querySelector('.gvp-upscale-video');
        if (upscaleBtn) {
            upscaleBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (upscaleBtn.disabled) return;

                const video = this.playlist[this.currentIndex];
                if (!video) return;

                // Capture state before pausing
                const wasPlaying = !this.videoElement.paused;
                const currentTime = this.videoElement.currentTime;
                // Capture the ID of the video being upscaled to handle concurrency (user navigating away)
                const currentVirtualId = video.virtualId;

                // PAUSE immediately
                this.videoElement.pause();

                // Optimistic UI
                const originalText = upscaleBtn.innerHTML;
                upscaleBtn.innerHTML = '⚡ Upscaling...';
                upscaleBtn.disabled = true;
                upscaleBtn.style.cursor = 'wait';

                try {
                    window.Logger.debug('Playlist', '🔍 Upscale Requested for:', {
                        videoUrl: video.videoUrl,
                        videoId: video.videoId,
                        virtualId: video.virtualId,
                        wasPlaying
                    });

                    // MUST use virtualId (imageId_attemptId) because StateManager.upscaleVideo expects composite ID
                    const upscaledUrl = await this.stateManager.upscaleVideo(video.virtualId);

                    if (upscaledUrl) {
                        upscaleBtn.innerHTML = '✅ HD Ready';
                        upscaleBtn.title = 'Video upscaled successfully';

                        // Update current video object locally to match state
                        // Note: StateManager sets video.upscaledVideoUrl on the shared object reference
                        video.upscaledVideoUrl = upscaledUrl;
                        video.videoUrl = upscaledUrl; // Force switch to upscaled URL preference

                        // Concurrency Check: Is the user still looking at the same video?
                        // We check if the virtualId at currentIndex matches what we started with.
                        const activeVideo = this.playlist[this.currentIndex];

                        if (activeVideo && activeVideo.virtualId === currentVirtualId) {
                            window.Logger.info('Playlist', '🔄 User is still on the same video, hot-swapping to HD...');

                            // Hot-swap the source
                            this.videoElement.src = upscaledUrl;
                            this.videoElement.currentTime = currentTime;

                            if (wasPlaying) {
                                try {
                                    await this.videoElement.play();
                                } catch (err) {
                                    window.Logger.warn('Playlist', 'Resume failed after upscale (likely unrelated):', err);
                                }
                            }

                            // Re-update UI to show HD badge, buttons, etc.
                            this._updatePlayerUI();
                        } else {
                            window.Logger.info('Playlist', '⚠️ User navigated away during upscale. Playlist update only.');
                        }

                        // Always re-render playlist to show "HD" badge in the list
                        this._renderPlaylist({ preserveScroll: true });

                    } else {
                        throw new Error('Upscale returned no URL');
                    }
                } catch (error) {
                    window.Logger.error('Playlist', 'Upscale failed:', error);

                    if (error.message.includes('404') || error.message.includes('not found')) {
                        upscaleBtn.innerHTML = '⏳ Not Ready';
                        upscaleBtn.title = 'Video generation not finalized. Please wait a moment and try again.';
                    } else {
                        upscaleBtn.innerHTML = '❌ Failed';
                        upscaleBtn.title = error.message;
                    }

                    setTimeout(() => {
                        // If we are still on the same video, restore the button text
                        const activeVideo = this.playlist[this.currentIndex];
                        if (activeVideo && activeVideo.virtualId === currentVirtualId) {
                            upscaleBtn.innerHTML = originalText;
                            upscaleBtn.disabled = false;
                            upscaleBtn.style.cursor = 'pointer';
                        }
                    }, 2500);
                }
            });
        }

        // Video events
        this.videoElement.addEventListener('ended', () => {
            if (this.autoAdvance) {
                this._playNext();
            }
        });

        this.videoElement.addEventListener('error', (e) => {
            this._consecutiveErrors++;
            window.Logger.error('Playlist', 'Video error:', e, `(${this._consecutiveErrors}/${this._maxConsecutiveErrors})`);

            // v1.21.23: Error throttling to prevent infinite loop
            if (this._consecutiveErrors >= this._maxConsecutiveErrors) {
                window.Logger.error('Playlist', '❌ Too many consecutive errors, stopping playback');
                this.isPlaying = false;
                this.videoElement.pause();
                this.uiModalManager?.showError?.(`Playback stopped: ${this._consecutiveErrors} videos failed to load. Try syncing your gallery.`);
                return;
            }

            // Auto-advance to next video on error
            setTimeout(() => this._playNext(), 1000);
        });

        this.videoElement.addEventListener('loadeddata', () => {
            modal.querySelector('.gvp-playlist-loading').style.display = 'none';
            // v1.21.23: Reset consecutive error counter on successful load
            this._consecutiveErrors = 0;
        });

        this.videoElement.addEventListener('waiting', () => {
            modal.querySelector('.gvp-playlist-loading').style.display = 'block';
        });
    }

    _loadVideo(index) {
        if (index < 0 || index >= this.playlist.length) {
            window.Logger.info('Playlist', 'End of playlist reached');
            if (this.loop) {
                this.currentIndex = 0;
                this._loadVideo(0);
            } else {
                this._hidePlayer();
            }
            return;
        }

        this.currentIndex = index;
        const video = this.playlist[index];

        window.Logger.debug('Playlist', 'Loading video', index + 1, '/', this.playlist.length, video.videoUrl);

        // Skip entries with no usable URL
        if (!video || !video.videoUrl) {
            this._skipWarnings += 1;
            if (this._skipWarnings <= 5) {
                window.Logger.warn('Playlist', 'Skipping entry with no videoUrl at index', index + 1);
            }
            if (this._skipWarnings === 6) {
                window.Logger.warn('Playlist', 'Further missing-video entries suppressed.');
            }
            this._playNext();
            return;
        }

        // Update video source
        this.videoElement.src = video.videoUrl;
        this.videoElement.load();

        // Update UI (includes _renderPlaylist, no need to call it separately)
        this._updatePlayerUI();

        // Auto-play
        if (this.isPlaying) {
            this.videoElement.play().catch(e => {
                window.Logger.error('Playlist', 'Autoplay failed:', e);
            });
        }
    }

    _updatePlayerUI() {
        const video = this.playlist[this.currentIndex];
        const modal = this.playerModal;
        if (!video || !modal) return;

        // Update counter overlay on video
        let counterText = `${this.currentIndex + 1} / ${this.playlist.length}`;
        if (video.resolution && video.isApiSource) {
            counterText += ` • ${video.resolution.width}×${video.resolution.height}`;
        }
        const counterOverlay = modal.querySelector('.gvp-video-counter-overlay');
        if (counterOverlay) {
            counterOverlay.textContent = counterText;
        }

        // Extract metadata
        const videoModel = video.modelName || 'Unknown';
        const imageModel = video.parentPost?.raw?.modelName || video.parentPost?.modelName || 'N/A';
        const imagePrompt = video.parentPost?.raw?.originalPrompt || video.parentPost?.originalPrompt || '';
        const videoPrompt = video.originalPrompt || video.prompt || '';
        const createTime = video.createTime ? new Date(video.createTime).toLocaleDateString() : 'Unknown';
        const mode = video.mode || 'normal';
        const modeBadge = mode === 'extremely-spicy-or-crazy' ? '🌶️' : mode === 'custom' ? '📝' : '🎬';

        // Update metadata fields in accordion
        modal.querySelector('#gvp-meta-mode').textContent = `${modeBadge} ${mode}`;
        modal.querySelector('#gvp-meta-created').textContent = createTime;
        modal.querySelector('#gvp-meta-video-model').textContent = videoModel;
        modal.querySelector('#gvp-meta-image-model').textContent = imageModel;

        // Update video URL link
        const videoLink = modal.querySelector('.gvp-current-video-link');
        if (videoLink) {
            videoLink.href = video.mediaUrl || video.videoUrl || '#';
        }

        // Update Upscale Button State
        const upscaleBtn = modal.querySelector('.gvp-upscale-video');
        if (upscaleBtn) {
            if (video.upscaledVideoUrl || (video.videoUrl && video.videoUrl.includes('upscaled'))) {
                upscaleBtn.innerHTML = '✅ HD';
                upscaleBtn.title = 'Video is upscaled';
                upscaleBtn.disabled = true;
                upscaleBtn.style.opacity = '0.8';
                upscaleBtn.style.cursor = 'default';
            } else {
                upscaleBtn.innerHTML = '⚡ Upscale';
                upscaleBtn.title = 'Upscale to HD';
                upscaleBtn.disabled = false;
                upscaleBtn.style.opacity = '1';
                upscaleBtn.style.cursor = 'pointer';
            }
        }

        // Show/hide image prompt in accordion
        const imagePromptBlock = modal.querySelector('#gvp-image-prompt-block');
        if (imagePrompt) {
            imagePromptBlock.style.display = 'block';
            modal.querySelector('#gvp-image-prompt-text').textContent = imagePrompt;
        } else {
            imagePromptBlock.style.display = 'none';
        }

        // Show/hide video prompt in accordion
        const videoPromptBlock = modal.querySelector('#gvp-video-prompt-block');
        if (videoPrompt && videoPrompt !== imagePrompt) {
            videoPromptBlock.style.display = 'block';
            modal.querySelector('#gvp-video-prompt-text').textContent = videoPrompt;
        } else {
            videoPromptBlock.style.display = 'none';
        }

        // Update play/pause button
        if (this.playPauseBtn) {
            this.playPauseBtn.textContent = this.isPlaying ? '⏸' : '▶';
        }

        // Update loop button
        if (this.loopBtn) {
            this.loopBtn.style.color = this.loop ? '#4ade80' : '#fff';
            this.loopBtn.style.borderColor = this.loop ? '#4ade80' : '#3a3a3a';
        }

        // Re-render playlist to update active state
        this._renderPlaylist({ preserveScroll: true, scrollActiveIntoView: false });
    }

    /**
     * Render thumbnails in the playlist
     * @param {object} [options]
     * @param {boolean} [options.preserveScroll=true] - Keep the user's scroll position
     * @param {boolean} [options.scrollActiveIntoView=false] - Force the active item into view
     */
    _renderPlaylist(options = {}) {
        const {
            preserveScroll = true,
            scrollActiveIntoView = false
        } = options;

        const headerTitle = this.playerModal?.querySelector('.gvp-playlist-header-title');
        if (headerTitle) {
            headerTitle.textContent = `Video Playlist (${this.playlist.length})`;
        }

        if (!this.playlistContainer) {
            window.Logger.warn('Playlist', 'Playlist container missing; skipping render');
            return;
        }

        const previousScroll = preserveScroll ? this.playlistContainer.scrollTop : 0;

        this.playlistContainer.innerHTML = '';

        window.Logger.debug('Playlist', `Rendering ${this.playlist.length} thumbnails`);

        let missingThumbs = 0;

        const banner = this.playerModal?.querySelector('.gvp-playlist-filter-banner');
        if (banner) {
            if (this.filterImageId) {
                banner.style.display = 'flex';
                const label = banner.querySelector('.gvp-filter-label');
                if (label) {
                    label.textContent = `Focused on image ${this.filterImageId}`;
                }
            } else {
                banner.style.display = 'none';
            }
        }

        // VIRTUALIZATION: Only render a window of thumbnails to prevent lag
        const MAX_RENDER = 100; // Max thumbnails to render at once
        const totalCount = this.playlist.length;

        // Calculate window around current index
        let startIdx = 0;
        let endIdx = Math.min(totalCount, MAX_RENDER);

        if (totalCount > MAX_RENDER) {
            // Center the window around current index
            const halfWindow = Math.floor(MAX_RENDER / 2);
            startIdx = Math.max(0, this.currentIndex - halfWindow);
            endIdx = Math.min(totalCount, startIdx + MAX_RENDER);
            // Adjust start if we hit the end
            if (endIdx === totalCount) {
                startIdx = Math.max(0, totalCount - MAX_RENDER);
            }
        }

        // Show "more before" indicator if needed
        if (startIdx > 0) {
            const moreBeforeBtn = document.createElement('button');
            moreBeforeBtn.className = 'gvp-playlist-more-indicator';
            moreBeforeBtn.textContent = `⬆️ ${startIdx} more videos above`;
            moreBeforeBtn.addEventListener('click', () => {
                this._loadVideo(startIdx - 1);
            });
            this.playlistContainer.appendChild(moreBeforeBtn);
        }

        window.Logger.debug('Playlist', `Rendering ${endIdx - startIdx} of ${totalCount} thumbnails (window: ${startIdx + 1}-${endIdx})`);

        for (let index = startIdx; index < endIdx; index++) {
            const video = this.playlist[index];
            const item = document.createElement('button');
            item.className = 'gvp-playlist-thumb-btn';
            if (index === this.currentIndex) {
                item.classList.add('active');
            }

            const thumb = this._resolveThumbnail(video);

            // Create image element
            const img = document.createElement('img');
            img.className = 'gvp-thumb-image';
            img.alt = `Video ${index + 1}`;

            if (thumb.src) {
                img.src = this._getPlaceholderThumb();
                img.setAttribute('data-src', thumb.src);
                img.classList.add('gvp-thumb-loading'); // v1.21.45: shimmer while loading
                img.onerror = () => {
                    img.style.display = 'none';
                };
            } else {
                missingThumbs += 1;
                img.style.display = 'none';
            }

            // Create number overlay
            const numberDiv = document.createElement('div');
            numberDiv.className = 'gvp-thumb-number';
            numberDiv.textContent = `#${index + 1}`;

            item.appendChild(img);
            item.appendChild(numberDiv);

            // HD Badge
            if (video.upscaledVideoUrl || (video.videoUrl && video.videoUrl.includes('upscaled'))) {
                const hdBadge = document.createElement('div');
                hdBadge.className = 'gvp-thumb-hd-badge';
                hdBadge.textContent = 'HD';
                item.appendChild(hdBadge);
            }

            // Focus-by-image button
            const focusBtn = document.createElement('button');
            focusBtn.className = 'gvp-thumb-focus-btn';
            focusBtn.textContent = 'Focus';
            focusBtn.title = 'Show only this image ID';
            focusBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const imgId = video.parentImageId || video.imageId;
                if (imgId) {
                    // Save current state to restore on back
                    this._preFilterState = {
                        videoId: video.videoId || video.id,
                        sort: this.activeSort,
                        scroll: this.playlistContainer?.scrollTop || 0
                    };
                    this._applyImageIdFilter(imgId, true);
                }
            });
            item.appendChild(focusBtn);

            // Click to play
            item.addEventListener('click', () => {
                this._loadVideo(index);
            });

            this.playlistContainer.appendChild(item);
        }

        // Show "more after" indicator if needed
        if (endIdx < totalCount) {
            const moreAfterBtn = document.createElement('button');
            moreAfterBtn.className = 'gvp-playlist-more-indicator';
            moreAfterBtn.textContent = `⬇️ ${totalCount - endIdx} more videos below`;
            moreAfterBtn.addEventListener('click', () => {
                this._loadVideo(endIdx);
            });
            this.playlistContainer.appendChild(moreAfterBtn);
        }

        if (missingThumbs > 0) {
            this._missingThumbWarnings += missingThumbs;
            if (this._missingThumbWarnings <= 5) {
                window.Logger.warn('Playlist', `Missing thumbnails for ${missingThumbs} videos (total missing so far: ${this._missingThumbWarnings})`);
            } else if (this._missingThumbWarnings === 6) {
                window.Logger.warn('Playlist', 'Additional missing thumbnails suppressed to avoid spam.');
            }
        }

        // Lazy load thumbnails
        this._ensureThumbObserver();
        this.playlistContainer.querySelectorAll('img.gvp-thumb-image[data-src]').forEach(img => {
            this._thumbObserver.observe(img);
        });

        // Restore scroll position (default) to avoid jumping the list when videos start playing
        if (preserveScroll && previousScroll && this.playlistContainer) {
            this.playlistContainer.scrollTop = previousScroll;
        }

        // Scroll active item into view if explicitly requested (e.g. after sort/filter)
        const activeItem = this.playlistContainer.querySelector('.gvp-playlist-thumb-btn.active');
        if (scrollActiveIntoView && activeItem) {
            activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    _resolveThumbnail(video) {
        const candidates = [
            video.thumbnailUrl,
            video.imageUrl,
            video.parentImageUrl,
            video.parentThumbnailUrl,
            video.parentImageThumbnail
        ];

        const src = candidates.find(Boolean);

        if (src) {
            return { src, placeholder: false };
        }

        return { src: this._getPlaceholderThumb(), placeholder: true };
    }

    _getPlaceholderThumb() {
        // Minimal inline SVG placeholder to avoid missing image spam
        return 'data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\"><rect width=\"64\" height=\"64\" fill=\"%23141414\"/><rect x=\"4\" y=\"4\" width=\"56\" height=\"56\" rx=\"6\" ry=\"6\" fill=\"%23212121\" stroke=\"%232f2f2f\" stroke-width=\"2\"/><text x=\"32\" y=\"38\" font-size=\"10\" fill=\"%23666\" text-anchor=\"middle\" font-family=\"Arial, Helvetica, sans-serif\">No img</text></svg>';
    }

    _applyImageIdFilter(imageId, loadFirst = false) {
        if (!imageId) return;
        this.filterImageId = imageId;
        this._applyImageFilter(loadFirst);
    }

    _clearImageIdFilter(loadFirst = false) {
        this.filterImageId = null;
        this._applyImageFilter(loadFirst);
    }

    _applyImageFilter(loadFirst = false) {
        if (!Array.isArray(this.allVideos)) {
            this.allVideos = [];
        }

        if (this.filterImageId) {
            this.playlist = this.allVideos.filter(v => (v.parentImageId || v.imageId) === this.filterImageId);
        } else {
            this.playlist = [...this.allVideos];
        }

        // Reapply active sort while preserving target video position if possible
        let targetVideoId = null;
        if (this._preFilterState?.videoId) {
            targetVideoId = this._preFilterState.videoId;
        }

        this._sortCurrentPlaylist(this.activeSort || 'date-desc');

        if (targetVideoId) {
            const idx = this.playlist.findIndex(v => v.videoId === targetVideoId || v.id === targetVideoId);
            this.currentIndex = idx >= 0 ? idx : 0;
        } else {
            this.currentIndex = 0;
        }

        this._renderPlaylist({ preserveScroll: true });
        if (loadFirst && this.playlist.length > 0) {
            this._loadVideo(this.currentIndex);
        }

        // Restore scroll if we came from a saved state
        if (!this.filterImageId && this._preFilterState?.scroll != null && this.playlistContainer) {
            this.playlistContainer.scrollTop = this._preFilterState.scroll;
        }
    }

    _ensureThumbObserver() {
        if (this._thumbObserver) return;
        this._thumbObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const src = img.getAttribute('data-src');
                    if (src) {
                        img.src = src;
                        img.removeAttribute('data-src');
                        // v1.21.45: Swap shimmer for fade-in
                        img.classList.remove('gvp-thumb-loading');
                        img.classList.add('gvp-thumb-loaded');
                    }
                    this._thumbObserver.unobserve(img);
                }
            });
        }, {
            root: this.playlistContainer,
            rootMargin: '100px',
            threshold: 0.01
        });
    }

    _playNext() {
        const nextIndex = this.currentIndex + 1;
        this._loadVideo(nextIndex);
    }

    _playPrevious() {
        const prevIndex = this.currentIndex - 1;
        if (prevIndex >= 0) {
            this._loadVideo(prevIndex);
        }
    }

    _togglePlayPause() {
        if (this.videoElement.paused) {
            this.videoElement.play();
            this.isPlaying = true;
        } else {
            this.videoElement.pause();
            this.isPlaying = false;
        }
        this._updatePlayerUI();
    }

    _toggleShuffle() {
        this.shuffle = !this.shuffle;
        if (this.shuffle) {
            this._shufflePlaylist();
            this._loadVideo(0);
        }
        this._updatePlayerUI();
    }

    _toggleLoop() {
        this.loop = !this.loop;
        this._updatePlayerUI();
    }

    _shufflePlaylist() {
        // Fisher-Yates shuffle
        for (let i = this.playlist.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
        }
        window.Logger.info('Playlist', 'Shuffled playlist');
    }

    _showPlayer() {
        if (this.playerModal) {
            this.playerModal.classList.add('visible');
        }
    }

    _hidePlayer() {
        if (this.playerModal) {
            this.playerModal.classList.remove('visible');
            this.videoElement.pause();
            this.isPlaying = false;
        }
    }

    /**
     * Copy prompt to clipboard
     */
    _copyPrompt(index) {
        const video = this.playlist[index];
        const videoPrompt = video.originalPrompt || video.prompt || '';
        const imagePrompt = video.parentPost?.raw?.originalPrompt || video.parentPost?.originalPrompt || '';
        const promptToCopy = videoPrompt || imagePrompt || 'No prompt available';

        navigator.clipboard.writeText(promptToCopy).then(() => {
            window.Logger.info('Playlist', 'Copied prompt to clipboard');
            // Visual feedback
            const btn = this.playerModal.querySelector(`[data-index="${index}"] .gvp-copy-prompt-btn`);
            if (btn) {
                const original = btn.textContent;
                btn.textContent = '✅ Copied!';
                setTimeout(() => {
                    btn.textContent = original;
                }, 1500);
            }
        }).catch(err => {
            window.Logger.error('Playlist', 'Failed to copy:', err);
        });
    }

    /**
     * Apply sorting to playlist
     */
    _applySorting(sortMode) {
        const [sortBy, order] = sortMode.split('-');
        this.activeSort = sortMode || this.activeSort || 'date-desc';

        if (sortMode === 'random') {
            this._shufflePlaylist();
        } else if (sortBy === 'date') {
            this.playlist.sort((a, b) => {
                const dateA = new Date(a.createTime || 0).getTime();
                const dateB = new Date(b.createTime || 0).getTime();
                return order === 'desc' ? dateB - dateA : dateA - dateB;
            });
        } else if (sortBy === 'videos') {
            // Count videos per parent image
            const videoCounts = new Map();
            this.playlist.forEach(v => {
                const imgId = v.parentImageId || v.imageId;
                videoCounts.set(imgId, (videoCounts.get(imgId) || 0) + 1);
            });

            this.playlist.sort((a, b) => {
                const countA = videoCounts.get(a.parentImageId || a.imageId) || 0;
                const countB = videoCounts.get(b.parentImageId || b.imageId) || 0;
                return order === 'desc' ? countB - countA : countA - countB;
            });
        }

        window.Logger.info('Playlist', 'Sorted by:', sortMode);
        this.currentIndex = 0;
        this._renderPlaylist({ preserveScroll: true });
        if (this.playlist.length > 0) {
            this._loadVideo(0);
        }
    }

    /**
     * Filter playlist by model
     */
    _filterByModel(model) {
        if (model === 'all') {
            // Rebuild full playlist from StateManager
            this.playlist = this.stateManager.getAllVideosFromGallery().map(video => ({
                videoUrl: video.mediaUrl,
                mediaUrl: video.mediaUrl,
                videoId: video.id,
                imageId: video.parentImageId,
                imageUrl: video.parentImageUrl || video.parentPost?.imageUrl,
                thumbnailUrl: video.parentThumbnailUrl || video.parentPost?.thumbnailUrl || video.parentImageUrl,
                parentImageUrl: video.parentImageUrl,
                parentThumbnailUrl: video.parentThumbnailUrl,
                prompt: video.originalPrompt || video.parentPrompt || 'No prompt',
                originalPrompt: video.originalPrompt,
                timestamp: video.createTime,
                createTime: video.createTime,
                mode: video.mode || 'normal',
                resolution: video.resolution,
                modelName: video.modelName,
                assetId: video.id,
                isApiSource: true,
                liked: video.parentPost?.userInteractionStatus?.likeStatus || false,
                parentPost: video.parentPost
            }));
        } else {
            // Filter by specific model
            const allVideos = this.stateManager.getAllVideosFromGallery();
            this.playlist = allVideos.filter(v => v.modelName === model).map(video => ({
                videoUrl: video.mediaUrl,
                mediaUrl: video.mediaUrl,
                videoId: video.id,
                imageId: video.parentImageId,
                imageUrl: video.parentImageUrl || video.parentPost?.imageUrl,
                thumbnailUrl: video.parentThumbnailUrl || video.parentPost?.thumbnailUrl || video.parentImageUrl,
                parentImageUrl: video.parentImageUrl,
                parentThumbnailUrl: video.parentThumbnailUrl,
                prompt: video.originalPrompt || video.parentPrompt || 'No prompt',
                originalPrompt: video.originalPrompt,
                timestamp: video.createTime,
                createTime: video.createTime,
                mode: video.mode || 'normal',
                resolution: video.resolution,
                modelName: video.modelName,
                assetId: video.id,
                isApiSource: true,
                liked: video.parentPost?.userInteractionStatus?.likeStatus || false,
                parentPost: video.parentPost
            }));
        }

        window.Logger.info('Playlist', 'Filtered by model:', model, '- Videos:', this.playlist.length);
        this.currentIndex = 0;
        this._renderPlaylist({ preserveScroll: false, scrollActiveIntoView: true });
        if (this.playlist.length > 0) {
            this._loadVideo(0);
        }
    }

    /**
     * Trigger generation using current video's prompt
     */
    async _generateFromCurrent(type) {
        const video = this.playlist[this.currentIndex];
        if (!video) return;

        const videoPrompt = video.originalPrompt || video.prompt || '';
        const imagePrompt = video.parentPost?.raw?.originalPrompt || video.parentPost?.originalPrompt || '';
        const promptToUse = videoPrompt || imagePrompt;

        if (!promptToUse) {
            window.Logger.warn('Playlist', 'No prompt available for generation');
            alert('No prompt available for this video!');
            return;
        }

        window.Logger.info('Playlist', 'Triggering', type, 'generation with prompt:', promptToUse);

        // Check if reactAutomation is available
        if (!this.reactAutomation) {
            window.Logger.warn('Playlist', 'ReactAutomation not available, copying to clipboard');
            navigator.clipboard.writeText(promptToUse).then(() => {
                alert(`ReactAutomation unavailable.\n\nPrompt copied to clipboard!\nPaste manually into the generator.`);
            });
            return;
        }

        try {
            // Use reactAutomation to send prompt
            const isRaw = type === 'raw';
            await this.reactAutomation.sendToGenerator(promptToUse, isRaw);
            window.Logger.info('Playlist', '✅ Generation triggered successfully');

            // Show success message
            const genBtn = type === 'json'
                ? this.playerModal.querySelector('#gvp-playlist-gen-json')
                : this.playerModal.querySelector('#gvp-playlist-gen-raw');

            if (genBtn) {
                const originalText = genBtn.textContent;
                genBtn.textContent = type === 'json' ? '✅ Sent!' : '✅ Sent!';
                genBtn.disabled = true;
                setTimeout(() => {
                    genBtn.textContent = originalText;
                    genBtn.disabled = false;
                }, 2000);
            }
        } catch (error) {
            window.Logger.error('Playlist', 'Generation failed:', error);
            alert(`Generation failed: ${error.message}\n\nTry copying manually.`);

            // Fallback to clipboard
            navigator.clipboard.writeText(promptToUse).then(() => {
                window.Logger.info('Playlist', 'Fallback: Prompt copied to clipboard');
            });
        }
    }

    destroy() {
        if (this.playerModal) {
            this.playerModal.remove();
            this.playerModal = null;
        }
        window.removeEventListener('gvp:idb-late-init', this._boundHandleLateInit);
        window.Logger.info('UIPlaylist', 'Destroyed');
    }
};

