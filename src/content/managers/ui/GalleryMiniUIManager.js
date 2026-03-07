// src/content/managers/ui/GalleryMiniUIManager.js
// v1.44.5 — Dual vertical carousel strips anchored to hovered gallery card.
// Left rail = Image Edits (editedImages[]).  Right rail = Generated Videos (videos[]).
// Triggered by UIGalleryManager Z-key press; renders inside GVP Shadow DOM.

window.GalleryMiniUIManager = class GalleryMiniUIManager {

    /**
     * @param {object} stateManager
     * @param {object} uiManager  — provides .shadowRoot
     * @param {object} networkInterceptor — provides .fetchPostDetails(id)
     */
    constructor(stateManager, uiManager, networkInterceptor) {
        this.stateManager = stateManager;
        this.uiManager = uiManager;
        this.networkInterceptor = networkInterceptor;

        /** @type {Element|null} The root overlay injected into shadow DOM */
        this._rootEl = null;
        /** @type {Element|null} Large preview overlay element */
        this._previewEl = null;
        /** @type {string|null} */
        this.currentImageId = null;
        this.isOpen = false;

        this._onKeyDown = this._handleKeyDown.bind(this);
        this._onOutsideClick = this._handleOutsideClick.bind(this);
        this._onIdbSync = this._onIdbSync.bind(this);

        window.addEventListener('gvp:idb-sync', this._onIdbSync);

        console.log('[GVP GalleryMiniUIManager] ✅ Constructor — shadowRoot via uiManager:', uiManager?.shadowRoot ? '✅ present' : '❌ MISSING');
        window.Logger.info('GalleryMiniUIManager', 'Initialized');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Open the dual-rail UI anchored to the hovered gallery card.
     * @param {string} imageId  — UUID extracted from card image src (Last UUID rule)
     * @param {Element} cardEl  — The gallery card element
     */
    async open(imageId, cardEl) {
        if (!imageId || !cardEl) return;

        if (this.isOpen) this.close();

        this.currentImageId = imageId;
        this._cardEl = cardEl;
        this.isOpen = true;

        console.log(`[GVP GalleryMiniUIManager] 🚀 open() imageId=${imageId}`);
        window.Logger.info('GalleryMiniUIManager', `Opening for imageId=${imageId.substring(0, 8)}…`);

        const shadow = this._getShadow();
        console.log('[GVP GalleryMiniUIManager] shadow target:', shadow?.nodeName, shadow);
        this._ensureStyles(shadow);

        // Build skeleton immediately so Z-press feels instant
        const root = this._buildSkeleton(cardEl);
        shadow.appendChild(root);
        this._rootEl = root;
        console.log('[GVP GalleryMiniUIManager] Skeleton appended to shadow');

        this._attachGlobalListeners();

        // Resolve real data async
        try {
            const data = await this._resolveData(imageId);
            console.log('[GVP GalleryMiniUIManager] _resolveData result:', data);
            if (!this._rootEl) return;   // closed while awaiting
            this._populateRails(root, data);
        } catch (err) {
            console.error('[GVP GalleryMiniUIManager] Data resolution error:', err);
            window.Logger.error('GalleryMiniUIManager', 'Data resolution error', err);
            this._populateRails(root, null);
        }
    }

    close() {
        if (!this._rootEl) return;
        this._rootEl.classList.add('gvp-rails--closing');
        const el = this._rootEl;
        setTimeout(() => el?.remove(), 220);
        this._rootEl = null;
        this._previewEl?.remove();
        this._previewEl = null;
        this.currentImageId = null;
        this.isOpen = false;
        this._detachGlobalListeners();
        window.Logger.debug('GalleryMiniUIManager', 'Closed');
    }

    destroy() {
        this.close();
        window.removeEventListener('gvp:idb-sync', this._onIdbSync);
        window.Logger.info('GalleryMiniUIManager', 'Destroyed');
    }

    /**
     * React to IDB changes broadcast from other tabs.
     */
    async _onIdbSync(e) {
        if (!this.isOpen || !this.currentImageId) return;

        const { storeName, type, data } = e.detail || {};

        // If the unified history was updated, we might need to refresh
        if (storeName === 'unifiedVideoHistory') {
            const affectedId = data?.imageId || data?.id;
            if (!affectedId) return;

            // PERFORMANCE: Only refresh if affectedId is our current ID, OR shares our root lineage.
            // This prevents background tabs doing unrelated generations from constantly refreshing this tab.
            const idb = this.stateManager?.storageManager?.indexedDBManager;
            const affectedRootId = idb?.initialized ? await idb.resolveRoot(affectedId) : null;
            const isRelevant = affectedId === this.currentImageId || (affectedRootId && affectedRootId === this._currentAbsoluteRootId);

            if (!isRelevant) {
                window.Logger.debug('GalleryMiniUIManager', `Ignored sync update for ${affectedId} (not in current lineage)`);
                return;
            }

            window.Logger.debug('GalleryMiniUIManager', `Targeted sync refresh (${type}) for ${affectedId}…`);

            try {
                const refreshed = await this._resolveData(this.currentImageId);
                if (this._rootEl && this.isOpen) {
                    this._populateRails(this._rootEl, refreshed);
                }
            } catch (err) {
                window.Logger.error('GalleryMiniUIManager', 'Sync refresh failed', err);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DATA RESOLUTION — IDB → parentIndex → /get fallback
    // ─────────────────────────────────────────────────────────────────────────
    async _getAbsoluteRootId(imageId, idb) {
        if (!idb?.initialized || !imageId) return imageId;

        let currentId = imageId;
        let chaseDepth = 0;
        const maxDepth = 5;
        const seen = new Set([currentId]);

        while (chaseDepth < maxDepth) {
            let nextId = null;

            // Strategy A: UVH originalPostId (most reliable)
            const entry = await idb.getUnifiedEntry(currentId);
            if (entry?.originalPostId) {
                nextId = entry.originalPostId;
            }
            // Strategy B: parentIndex (catches grandchildren without UVH entries)
            else {
                const rootId = await idb.resolveRoot(currentId);
                if (rootId && rootId !== currentId) {
                    nextId = rootId;
                }
            }

            // If we found a parent, traverse up
            if (nextId) {
                if (seen.has(nextId)) {
                    console.warn(`[GVP GalleryMiniUIManager] Circular lineage detected for ${currentId.substring(0, 8)}… aborting chase.`);
                    break;
                }
                seen.add(nextId);
                console.log(`[GVP GalleryMiniUIManager] _getAbsoluteRootId depth ${chaseDepth + 1}: ${currentId.substring(0, 8)}… -> ${nextId.substring(0, 8)}…`);
                currentId = nextId;
                chaseDepth++;
            } else {
                // No more parents found, currentId is the absolute root
                break;
            }
        }

        if (chaseDepth > 0) {
            window.Logger.debug('GalleryMiniUIManager', `Absolute root chase: ${imageId.substring(0, 8)}… → ${currentId.substring(0, 8)}… (depth ${chaseDepth})`);
        }
        return currentId;
    }

    async _resolveData(imageId) {
        const idb = this.stateManager?.storageManager?.indexedDBManager;
        console.log(`[GVP GalleryMiniUIManager] _resolveData — idb:`, idb ? `✅ initialized=${idb.initialized}` : '❌ NULL');

        // Step 1: Find the absolute root ID via IDB chain-chasing only.
        const absoluteRootId = await this._getAbsoluteRootId(imageId, idb);
        this._currentAbsoluteRootId = absoluteRootId; // Cache for lineage-targeted sync checks

        // Step 2: Always call the API for the root post to get the FULL sibling set.
        // /post/get returns images[] including ALL edit generations (root + direct
        // children + grandchildren), making it the only reliable source of truth.
        console.log(`[GVP GalleryMiniUIManager] Strategy 2 (/get API for root ${absoluteRootId.substring(0, 8)}…) — networkInterceptor:`, this.networkInterceptor);
        window.Logger.debug('GalleryMiniUIManager', `Strategy 2 — /get API for root ${absoluteRootId.substring(0, 8)}…`);

        const fetched = await this._fetchFromApi(absoluteRootId);
        console.log(`[GVP GalleryMiniUIManager] Strategy 2 fetched:`, fetched);

        if (fetched) {
            // ── Write-back: populate parentIndex for ALL children found ──
            this._writeBackParentPairs(idb, fetched);
            console.log(`[GVP GalleryMiniUIManager] _resolveData final entry (API):`, fetched);
            return fetched;
        }

        // Step 3: API failed — fall back to whatever IDB had (partial but better than nothing)
        const entry = idb?.initialized ? await idb.getUnifiedEntry(absoluteRootId) : null;
        if (entry) {
            const cachedImages = entry.editedImages || entry.images || [];
            // Backfill isRoot on old cached entries that predate the isRoot flag
            const rootId = absoluteRootId;
            const missingIsRoot = cachedImages.length > 0 && !cachedImages.some(img => img?.isRoot);
            if (missingIsRoot) {
                const patched = cachedImages.map(img => {
                    const isRootEntry = img?.id === rootId && !img?.originalPostId && !img?.parentId;
                    return isRootEntry ? { ...img, isRoot: true } : img;
                });
                console.log(`[GVP GalleryMiniUIManager] _resolveData final entry (IDB fallback):`, entry);
                return {
                    ...entry,
                    ...(entry.editedImages ? { editedImages: patched } : { images: patched }),
                };
            }
            console.log(`[GVP GalleryMiniUIManager] _resolveData final entry (IDB fallback):`, entry);
            return entry;
        }

        console.log(`[GVP GalleryMiniUIManager] _resolveData: no data found for root=${absoluteRootId.substring(0, 8)}…`);
        return null;
    }

    async _fetchFromApi(imageId) {
        try {
            const fetchFn = this.networkInterceptor?.fetchPostDetails
                || this.networkInterceptor?.fetchPostGet;
            if (!fetchFn) return null;

            let result = await fetchFn.call(this.networkInterceptor, imageId);
            let post = result?.post || result;
            if (!post) return null;

            console.log(`[GVP GalleryMiniUIManager] _fetchFromApi first /get for ${imageId.substring(0, 8)}…: originalPostId=${post.originalPostId}, images=${post.images?.length}, videos=${post.videos?.length}, childPosts=${post.childPosts?.length}`);

            // ── Chase to root (Recursive via API) ──────────────────────
            // If this is a CHILD post, its images[]/videos[] only list its
            // own descendants. We need the absolute root to get the FULL lineage.
            let currentRootId = post.originalPostId;
            let apiDepth = 0;
            const maxApiDepth = 5;

            while (currentRootId && apiDepth < maxApiDepth) {
                console.log(`[GVP GalleryMiniUIManager] _fetchFromApi chasing root depth ${apiDepth + 1}: ${currentRootId.substring(0, 8)}…`);
                const rootResult = await fetchFn.call(this.networkInterceptor, currentRootId);
                const rootPost = rootResult?.post || rootResult;

                if (rootPost) {
                    console.log(`[GVP GalleryMiniUIManager] _fetchFromApi ROOT /get: images=${rootPost.images?.length}, videos=${rootPost.videos?.length}, childPosts=${rootPost.childPosts?.length}`);
                    post = rootPost;           // use found root
                    currentRootId = rootPost.originalPostId; // is the root itself a child?
                    apiDepth++;
                } else {
                    break; // Request failed, break loop
                }
            }

            // ── Extract images & videos ────────────────────────────────
            // The root /get response provides pre-split images[] and videos[].
            // Fall back to childPosts parsing only if those arrays are empty.
            const children = post.childPosts || [];
            const childImages = children.filter(c =>
                c.mediaType === 'MEDIA_POST_TYPE_IMAGE' || c.mimeType?.startsWith('image/')
            );
            const childVideos = children.filter(c =>
                c.mediaType === 'MEDIA_POST_TYPE_VIDEO' || c.mimeType?.startsWith('video/')
            );

            const postId = post.id || post.postId || imageId;

            // ── Stamp isRoot on the self-entry in post.images[] ──────────────
            // The /get response includes the root post itself as images[0] with
            // the same id as the post and no originalPostId.  NetworkInterceptor
            // stamps isRoot during intercept but _fetchFromApi works on raw API
            // objects, so we must annotate here too.
            const annotatedImages = (post.images?.length ? post.images
                : childImages.map(c => ({
                    id: c.id,
                    url: c.mediaUrl || null,
                    thumbnailUrl: c.thumbnailImageUrl || c.mediaUrl,
                    thumbnailImageUrl: c.thumbnailImageUrl || null,
                    mediaUrl: c.mediaUrl || null,
                    imageUrl: c.mediaUrl || null,
                    promptText: c.prompt,
                }))).map(img => {
                    const isRootEntry = img.id === postId && !img.originalPostId && !img.parentId;
                    return isRootEntry ? { ...img, isRoot: true } : img;
                });

            return {
                imageId: postId,
                images: annotatedImages,
                videos: post.videos?.length ? post.videos
                    : childVideos.map(c => ({
                        id: c.id,
                        url: c.mediaUrl || null,
                        thumbnailUrl: c.thumbnailImageUrl || null,
                        thumbnailImageUrl: c.thumbnailImageUrl || null,
                        mediaUrl: c.mediaUrl || null,
                        videoDuration: c.videoDuration,
                    })),
                originalPostId: post.originalPostId || null,
            };
        } catch (e) {
            window.Logger.warn('GalleryMiniUIManager', '/get fallback failed', e);
            console.error(`[GVP GalleryMiniUIManager] _fetchFromApi error:`, e);
            return null;
        }
    }

    /**
     * Fire-and-forget write-back of child→root pairs to parentIndex.
     * Called after a successful /get fallback so sibling cards get O(1) lookups.
     * @param {object} idb - IndexedDBManager instance
     * @param {object} fetched - The resolved post data from _fetchFromApi
     */
    _writeBackParentPairs(idb, fetched) {
        if (!idb?.initialized || !idb.setParentLinks) return;

        const rootId = fetched.imageId;
        if (!rootId) return;

        const pairs = [];

        // Images: each child image maps to the root
        if (Array.isArray(fetched.images)) {
            for (const img of fetched.images) {
                const childId = img?.id || img?.imageId;
                if (childId && childId !== rootId) {
                    pairs.push({ childId, rootId });
                }
            }
        }

        // Videos: each child video maps to the root
        if (Array.isArray(fetched.videos)) {
            for (const vid of fetched.videos) {
                const childId = vid?.id || vid?.videoId;
                if (childId && childId !== rootId) {
                    pairs.push({ childId, rootId });
                }
            }
        }

        if (pairs.length === 0) {
            console.log(`[GVP GalleryMiniUIManager] _writeBackParentPairs: 0 pairs for root ${rootId.substring(0, 8)}…`);
            return;
        }

        console.log(`[GVP GalleryMiniUIManager] _writeBackParentPairs: writing ${pairs.length} pairs for root ${rootId.substring(0, 8)}…`);
        idb.setParentLinks(pairs).then(() => {
            console.log(`[GVP GalleryMiniUIManager] _writeBackParentPairs: ✅ ${pairs.length} pairs persisted`);
        }).catch(e => {
            console.warn(`[GVP GalleryMiniUIManager] _writeBackParentPairs: ❌ failed`, e);
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DOM CONSTRUCTION
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Builds the positioning wrapper and empty rail containers anchored to the card.
     * Uses getBoundingClientRect so the rails sit flush against the card's edges.
     */
    _buildSkeleton(cardEl) {
        const rect = cardEl.getBoundingClientRect();
        const scrollX = window.scrollX || 0;
        const scrollY = window.scrollY || 0;

        const root = document.createElement('div');
        root.id = 'gvp-gallery-rails';
        root.className = 'gvp-rails';
        root.style.cssText = `
            position: absolute;
            top:  ${rect.top + scrollY}px;
            left: ${rect.left + scrollX}px;
            width: ${rect.width}px;
            height: ${rect.height}px;
            pointer-events: none;
            z-index: 1000000;
        `;

        root.innerHTML = `
            <!-- Left rail: Image Edits -->
            <div class="gvp-rail gvp-rail--left" data-rail="images">
                <div class="gvp-rail-label">Image Edits</div>
                <div class="gvp-rail-scroll">
                    <div class="gvp-rail-spinner"></div>
                </div>
            </div>
            <!-- Right rail: Generated Videos -->
            <div class="gvp-rail gvp-rail--right" data-rail="videos">
                <div class="gvp-rail-label">Generated Videos</div>
                <div class="gvp-rail-scroll">
                    <div class="gvp-rail-spinner"></div>
                </div>
            </div>
        `;

        return root;
    }

    /** Fill both rails with thumbnail buttons (or empty state) after data resolves. */
    _populateRails(rootEl, data) {
        // UVH uses `images[]` for edits; /get also uses `images[]`.
        // Accept editedImages as legacy alias just in case.
        const rawImages = data?.images || data?.editedImages || [];

        // ── Synthetic root stub for video-root cards ──────────────────────────
        // When the gallery card is a VIDEO post (e.g. image→video), post.images[]
        // is empty so no isRoot entry flows through from NetworkInterceptor.
        // In that case we synthesize a root stub from the card's <img> src
        // (always the preview_image.jpg poster Grok renders on the card).
        const hasExplicitRoot = rawImages.some(img => img?.isRoot);
        let images = rawImages;
        if (!hasExplicitRoot && this._cardEl) {
            const cardImg = this._cardEl.querySelector('img');
            const posterSrc = cardImg?.src || cardImg?.currentSrc || null;
            if (posterSrc) {
                const syntheticRoot = {
                    id: this.currentImageId,
                    url: posterSrc,
                    thumbnailUrl: posterSrc,
                    isRoot: true,
                    isSyntheticStub: true,  // so we know this is a placeholder
                    prompt: data?.title || '',
                    createdAt: data?.createdAt || 0,
                };
                images = [syntheticRoot, ...rawImages];
                console.log(`[GVP GalleryMiniUIManager] _populateRails — injected synthetic root stub from card poster: ${posterSrc.substring(0, 60)}…`);
            }
        }
        const videos = data?.videos || [];

        console.log(`[GVP GalleryMiniUIManager] _populateRails — images:${images.length} videos:${videos.length}`, { images, videos });

        const leftScroll = rootEl.querySelector('[data-rail="images"] .gvp-rail-scroll');
        const rightScroll = rootEl.querySelector('[data-rail="videos"] .gvp-rail-scroll');

        leftScroll.innerHTML = '';
        rightScroll.innerHTML = '';

        if (!images.length) {
            leftScroll.innerHTML = `<div class="gvp-rail-empty">No edits found</div>`;
        } else {
            // Sort: root image (isRoot:true) always appears first, then edits by createdAt ascending
            const sorted = [...images].sort((a, b) => {
                if (a.isRoot && !b.isRoot) return -1;
                if (!a.isRoot && b.isRoot) return 1;
                return (a.createdAt || 0) - (b.createdAt || 0);
            });
            sorted.forEach(img => {
                // UVH thumbnailUrl | UVH url | /get thumbnailImageUrl | mediaUrl fallback
                const thumb = img?.thumbnailUrl || img?.url || img?.thumbnailImageUrl || img?.imageUrl || img?.mediaUrl;
                // High-res fallback chain
                const highRes = img?.url || img?.imageUrl || img?.mediaUrl || thumb;
                const postId = img?.id || img?.imageId || img?.postId;
                const isRoot = !!img?.isRoot;
                const btn = this._makeThumbBtn(thumb, postId, 'image', null, highRes, isRoot);
                leftScroll.appendChild(btn);
            });
        }

        if (!videos.length) {
            rightScroll.innerHTML = `<div class="gvp-rail-empty">No videos found</div>`;
        } else {
            videos.forEach(vid => {
                // UVH thumbnailUrl | /get thumbnailImageUrl | mediaUrl fallback
                let thumb = vid?.thumbnailUrl || vid?.thumbnailImageUrl || vid?.imageUrl || vid?.mediaUrl;

                // If we still don't have a thumb but we have the video url (from UVH), synthesize the poster URL
                if (!thumb && vid?.url) {
                    if (typeof vid.url === 'string' && vid.url.match(/\.(mp4|webm)$/i)) {
                        if (vid.url.includes('generated_video.mp4')) {
                            thumb = vid.url.replace('generated_video.mp4', 'preview_image.jpg');
                        } else {
                            thumb = vid.url.replace(/\.(mp4|webm)$/i, '.jpg');
                        }
                    } else {
                        thumb = vid.url;
                    }
                }
                // High-res for videos isn't an image usually, but user might want to swap poster 
                // We shouldn't swap a video into an img tag, but if they click it, maybe we just use the thumb
                const postId = vid?.id || vid?.videoId || vid?.postId;
                const duration = vid?.videoDuration;
                // Pass true video URL as highResUrl for videos
                const videoUrl = vid?.url || vid?.mediaUrl || thumb;
                const btn = this._makeThumbBtn(thumb, postId, 'video', duration, videoUrl);
                rightScroll.appendChild(btn);
            });
        }
    }

    /**
     * Creates a snap-scroll thumbnail button.
     * - hover   → show large preview overlay
     * - mouseout → hide preview
     * - click   → update gallery card image to 'highResUrl'
     */
    _makeThumbBtn(thumbnailUrl, postId, type, duration, highResUrl, isRoot = false) {
        const btn = document.createElement('button');
        btn.className = isRoot ? 'gvp-thumb gvp-thumb--root' : 'gvp-thumb';
        btn.setAttribute('aria-label', isRoot ? 'Original image' : (type === 'video' ? 'Generated video' : 'Image edit'));

        const img = document.createElement('img');
        img.src = thumbnailUrl || '';
        img.alt = '';
        img.loading = 'lazy';
        img.className = 'gvp-thumb__img';
        img.onerror = () => {
            // Replace broken image with a placeholder icon
            img.style.display = 'none';
            const placeholder = document.createElement('div');
            placeholder.className = 'gvp-thumb__img';
            placeholder.style.cssText = 'display:flex;align-items:center;justify-content:center;background:#212121;width:100%;height:100%;border-radius:6px;';
            placeholder.innerHTML = type === 'video'
                ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="#666"><path d="M8 5v14l11-7z"/></svg>'
                : '<svg width="24" height="24" viewBox="0 0 24 24" fill="#666"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>';
            btn.insertBefore(placeholder, btn.firstChild);
        };
        btn.appendChild(img);

        // Root image badge
        if (isRoot) {
            const badge = document.createElement('span');
            badge.className = 'gvp-thumb__root-badge';
            badge.textContent = '⭐ Original';
            btn.appendChild(badge);
        }

        // Video badge
        if (type === 'video') {
            btn.appendChild(this._makeVideoBadge(duration));
        }

        // Hover preview
        btn.addEventListener('mouseenter', () => this._showPreview(thumbnailUrl, btn));
        btn.addEventListener('mouseleave', () => this._hidePreview());

        // Navigation / Image Swap
        if (postId) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();

                // Swap the media on the main gallery card
                if (this._cardEl) {
                    const cardImg = this._cardEl.querySelector('img');
                    const cardVid = this._cardEl.querySelector('video');

                    if (type === 'image') {
                        // Hide video if present to show the image
                        if (cardVid) cardVid.style.display = 'none';
                        if (cardImg) {
                            cardImg.src = highResUrl || thumbnailUrl || '';
                            cardImg.removeAttribute('srcset');
                            cardImg.style.display = 'block';
                            window.Logger.info('GalleryMiniUIManager', `Swapped card to image`, { postId, url: cardImg.src });
                        }
                    } else if (type === 'video') {
                        // Show video and update src
                        if (cardVid) {
                            cardVid.src = highResUrl || '';
                            if (thumbnailUrl) cardVid.poster = thumbnailUrl;
                            cardVid.style.display = 'block';
                            cardVid.load();
                            // Attempt to play if it was already playing or just for active feedback
                            cardVid.play().catch(() => { });
                            window.Logger.info('GalleryMiniUIManager', `Swapped card to video`, { postId, url: cardVid.src });
                        }
                        // Update poster img underneath as well
                        if (cardImg && thumbnailUrl) {
                            cardImg.src = thumbnailUrl;
                            cardImg.removeAttribute('srcset');
                        }
                    }
                }
            });
        }

        return btn;
    }

    _makeVideoBadge(duration) {
        const badge = document.createElement('div');
        badge.className = 'gvp-thumb__badge';
        badge.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 5v14l11-7L8 5z"/>
            </svg>
            ${duration ? `<span>${Math.round(duration)}s</span>` : ''}
        `;
        return badge;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HOVER PREVIEW OVERLAY
    // ─────────────────────────────────────────────────────────────────────────

    _showPreview(thumbnailUrl, anchorBtn) {
        if (!thumbnailUrl) return;
        this._hidePreview();

        const shadow = this._getShadow();
        const rect = anchorBtn.getBoundingClientRect();

        const preview = document.createElement('div');
        preview.className = 'gvp-preview';
        preview.style.cssText = `
            position: fixed;
            top: ${rect.top}px;
            left: ${rect.right + 12}px;
            z-index: 1000001;
        `;
        preview.innerHTML = `<img src="${thumbnailUrl}" class="gvp-preview__img" alt="Preview">`;
        shadow.appendChild(preview);
        this._previewEl = preview;
    }

    _hidePreview() {
        this._previewEl?.remove();
        this._previewEl = null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POSITIONING / SHADOW DOM
    // ─────────────────────────────────────────────────────────────────────────

    _getShadow() {
        return this.uiManager?.shadowRoot || document.body;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GLOBAL LISTENERS
    // ─────────────────────────────────────────────────────────────────────────

    _attachGlobalListeners() {
        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('click', this._onOutsideClick, { capture: true });
        // Close on any scroll — rails are position:absolute and won't follow the card
        this._onScroll = () => this.close();
        window.addEventListener('scroll', this._onScroll, { passive: true, capture: true });
    }

    _detachGlobalListeners() {
        document.removeEventListener('keydown', this._onKeyDown);
        document.removeEventListener('click', this._onOutsideClick, { capture: true });
        if (this._onScroll) {
            window.removeEventListener('scroll', this._onScroll, { capture: true });
            this._onScroll = null;
        }
    }

    _handleKeyDown(e) {
        if (e.key === 'Escape' || e.key.toLowerCase() === 'z') {
            this.close();
        }
    }

    _handleOutsideClick(e) {
        if (!this._rootEl) return;
        // Check against shadow-host element, not the shadow root internals
        const host = this._getShadow()?.host || null;
        if (host && (host.contains(e.target) || e.composedPath().includes(host))) return;
        // Click is outside GVP shadow host — close
        this.close();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STYLES (injected once into shadow DOM)
    // ─────────────────────────────────────────────────────────────────────────

    _ensureStyles(shadow) {
        if (shadow.getElementById?.('gvp-rails-style') || shadow.querySelector?.('#gvp-rails-style')) return;

        const style = document.createElement('style');
        style.id = 'gvp-rails-style';
        style.textContent = `
            /* ──────────────────────────────────── GVP Gallery Rails ─────────── */

            #gvp-gallery-rails {
                font-family: -apple-system, 'Inter', sans-serif;
            }

            .gvp-rails {
                pointer-events: none;
            }

            .gvp-rails--closing .gvp-rail {
                opacity: 0;
                transform: scaleX(0.85);
                transition: opacity 0.18s ease, transform 0.18s ease;
            }

            /* ── Rail containers ─────────────────────────────────────────────── */
            .gvp-rail {
                position: absolute;
                top: 0;
                height: 100%;
                display: flex;
                flex-direction: column;
                gap: 6px;
                pointer-events: auto;
                opacity: 1;
                transition: opacity 0.18s ease;
                /* Glassmorphism backing */
                background: rgba(20, 20, 20, 0.72);
                backdrop-filter: blur(12px);
                border: 1px solid #48494b;
                border-radius: 10px;
                padding: 8px 6px;
                min-width: 72px;
                max-width: 80px;
                z-index: 1000000;
            }

            .gvp-rail--left {
                right: calc(100% + 10px);
            }

            .gvp-rail--right {
                left: calc(100% + 10px);
            }

            .gvp-rail-label {
                font-size: 10px;
                font-weight: 600;
                color: #a3a3a3;
                text-align: center;
                letter-spacing: 0.02em;
                text-transform: uppercase;
                padding-bottom: 4px;
                border-bottom: 1px solid #48494b;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .gvp-rail-scroll {
                display: flex;
                flex-direction: column;
                gap: 6px;
                overflow-y: auto;
                overflow-x: hidden;
                flex: 1;
                scrollbar-width: thin;
                scrollbar-color: #48494b transparent;
                scroll-snap-type: y mandatory;
            }

            .gvp-rail-scroll::-webkit-scrollbar { width: 3px; }
            .gvp-rail-scroll::-webkit-scrollbar-thumb { background: #48494b; border-radius: 3px; }

            .gvp-rail-empty {
                font-size: 10px;
                color: #a3a3a3;
                text-align: center;
                padding: 8px 0;
            }

            /* ── Spinner ─────────────────────────────────────────────────────── */
            .gvp-rail-spinner {
                width: 20px;
                height: 20px;
                border: 2px solid #48494b;
                border-top-color: #f4f4f5;
                border-radius: 50%;
                animation: gvp-spin 0.75s linear infinite;
                margin: 12px auto;
            }

            @keyframes gvp-spin { to { transform: rotate(360deg); } }

            /* ── Thumbnail buttons ───────────────────────────────────────────── */
            .gvp-thumb {
                position: relative;
                width: 60px;
                height: 60px;
                border-radius: 7px;
                overflow: hidden;
                flex-shrink: 0;
                cursor: pointer;
                background: #212121;
                border: 1.5px solid #48494b;
                padding: 0;
                transition: border-color 0.15s, box-shadow 0.15s;
                scroll-snap-align: start;
                display: block;
            }

            .gvp-thumb:hover {
                border-color: #f4f4f5;
                box-shadow: 0 0 0 2px rgba(244,244,245,0.25);
            }

            .gvp-thumb__img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            }

            /* ── Video badge ─────────────────────────────────────────────────── */
            .gvp-thumb__badge {
                position: absolute;
                bottom: 3px;
                right: 3px;
                display: flex;
                align-items: center;
                gap: 2px;
                background: rgba(0,0,0,0.65);
                border-radius: 4px;
                padding: 1px 3px;
                font-size: 9px;
                color: #fff;
                pointer-events: none;
            }

            /* ── Root / Original image badge ─────────────────────────────────── */
            .gvp-thumb--root {
                border-color: #f5c518;
                box-shadow: 0 0 0 1px #f5c51844;
            }

            .gvp-thumb--root:hover {
                border-color: #f5c518;
                box-shadow: 0 0 0 3px rgba(245,197,24,0.35);
            }

            .gvp-thumb__root-badge {
                position: absolute;
                bottom: 3px;
                left: 3px;
                background: rgba(245,197,24,0.9);
                color: #141414;
                border-radius: 4px;
                padding: 1px 4px;
                font-size: 8px;
                font-weight: 700;
                letter-spacing: 0.02em;
                pointer-events: none;
                white-space: nowrap;
            }

            /* ── Large preview overlay ───────────────────────────────────────── */
            .gvp-preview {
                pointer-events: none;
                border-radius: 10px;
                overflow: hidden;
                box-shadow: 0 8px 32px rgba(0,0,0,0.7);
                border: 1px solid #48494b;
                animation: gvp-preview-in 0.1s ease;
            }

            @keyframes gvp-preview-in {
                from { opacity: 0; transform: scale(0.94); }
                to   { opacity: 1; transform: scale(1);    }
            }

            .gvp-preview__img {
                display: block;
                max-width: 320px;
                max-height: 320px;
                object-fit: contain;
                background: #141414;
            }
        `;
        shadow.appendChild(style);
    }
};
