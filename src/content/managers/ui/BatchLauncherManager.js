window.BatchLauncherManager = class BatchLauncherManager {
    constructor(stateManager, shadowRoot, uiHelpers) {
        this.stateManager = stateManager;
        this.shadowRoot = shadowRoot;
        this.uiHelpers = uiHelpers || new window.UIHelpers();
        this.storageKey = 'gvp-batch-gallery-cache';
        this.root = null;
        this.listContainer = null;
        this.dataset = [];
        this.selection = new Set();
        this.statusLabel = null;
        this.modeSelect = null;
        this.includeModeratedToggle = null;
    }

    createBatchTab() {
        const tab = document.createElement('div');
        tab.className = 'gvp-tab-content';
        tab.id = 'gvp-batch-planner';

        const wrapper = document.createElement('div');
        wrapper.className = 'gvp-batch-wrapper';

        const header = document.createElement('div');
        header.className = 'gvp-batch-header-row';
        header.innerHTML = `
            <div class="gvp-batch-headline">Batch Planner</div>
            <div class="gvp-batch-controls">
                <button class="gvp-button ghost" id="gvp-batch-refresh">🔄 Refresh</button>
                <button class="gvp-button primary" id="gvp-batch-run">▶ Run Selection</button>
            </div>
        `;

        const filterBar = document.createElement('div');
        filterBar.className = 'gvp-batch-filter-bar';
        filterBar.innerHTML = `
            <label class="gvp-inline-label">Mode
                <select id="gvp-batch-mode" class="gvp-select">
                    <option value="normal">Normal</option>
                    <option value="extremely-spicy-or-crazy">Spicy</option>
                </select>
            </label>
            <label class="gvp-inline-toggle">
                <input type="checkbox" id="gvp-batch-include-moderated" checked>
                <span>Include moderated</span>
            </label>
            <div class="gvp-inline-status" id="gvp-batch-status">0 selected</div>
        `;

        const list = document.createElement('div');
        list.className = 'gvp-batch-list';
        this.listContainer = list;

        wrapper.appendChild(header);
        wrapper.appendChild(filterBar);
        wrapper.appendChild(list);
        tab.appendChild(wrapper);

        this.root = tab;
        this.statusLabel = filterBar.querySelector('#gvp-batch-status');
        this.modeSelect = filterBar.querySelector('#gvp-batch-mode');
        this.includeModeratedToggle = filterBar.querySelector('#gvp-batch-include-moderated');

        this._attachEvents();
        this._hydrateFromCache();
        this.renderDataset();
        return tab;
    }

    _attachEvents() {
        if (!this.root) return;
        const refreshBtn = this.root.querySelector('#gvp-batch-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshDataset());
        }
        const runBtn = this.root.querySelector('#gvp-batch-run');
        if (runBtn) {
            runBtn.addEventListener('click', () => this.runSelection());
        }
        if (this.includeModeratedToggle) {
            this.includeModeratedToggle.addEventListener('change', () => this.applyFilters());
        }
    }

    refreshDataset(data = [], options = {}) {
        window.Logger.info('BatchLauncher', 'Batch dataset refresh requested', data.length || 'auto');
        if (Array.isArray(data) && data.length) {
            const merged = this._mergeExistingData(data);
            this.dataset = merged;
        } else {
            const projects = window.gvpImageProjectManager?.getAllProjects?.() || [];
            if (projects.length) {
                this.dataset = projects.map(project => ({
                    imageId: project.imageId,
                    imageUrl: project.imageUrl,
                    jsonCount: project.jsonCount,
                    lastAccessed: project.lastAccessed,
                    createdAt: project.createdAt,
                    moderated: project.metadata?.moderated ?? false,
                    pendingPrompt: project.metadata?.pendingPrompt || null,
                    pendingPromptUpdatedAt: project.metadata?.pendingPromptUpdatedAt || null,
                    lastSuccessfulPrompt: project.metadata?.lastSuccessfulPrompt || null,
                    lastSuccessfulAt: project.metadata?.lastSuccessfulAt || null,
                    lastSuccessfulVideoUrl: project.metadata?.lastSuccessfulVideoUrl || null,
                    lastSuccessfulAssetId: project.metadata?.lastSuccessfulAssetId || null,
                    lastBatchRunStatus: project.metadata?.lastBatchRunStatus || null
                }));
            } else {
                this.dataset = this._loadPersistedCache();
                if (!this.dataset.length) {
                    this._hydrateFromCache();
                }
            }
        }
        this.selection.clear();
        this.renderDataset();
        this._updateStatus();
        this._persistCache();
        this._hydrateInitialPrompt();
    }

    applyFilters() {
        this.renderDataset();
        this._updateStatus();
    }

    toggleSelect(itemId) {
        if (this.selection.has(itemId)) {
            this.selection.delete(itemId);
            const fallbackId = this.selection.size ? this.selection.values().next().value : null;
            if (fallbackId) {
                this._applyPromptFromImage(fallbackId, { force: true });
            }
        } else {
            this.selection.add(itemId);
            this._applyPromptFromImage(itemId, { force: true });
        }
        this._updateStatus();
    }

    runSelection() {
        if (!this.selection.size) {
            window.Logger.info('BatchLauncher', 'Batch run requested with empty selection');
            return;
        }
        const uiManager = window.gvpUIManager;
        const multiManager = uiManager?.multiVideoManager;
        const interceptor = uiManager?.networkInterceptor;
        if (!multiManager || typeof multiManager.initiateMultipleGenerations !== 'function') {
            window.Logger.warn('BatchLauncher', 'Multi-video manager unavailable; cannot run batch');
            return;
        }

        const selectedPosts = this.dataset.filter(item => this.selection.has(item.imageId));
        if (!selectedPosts.length) {
            window.Logger.info('BatchLauncher', 'Batch run selection yielded no dataset entries');
            return;
        }

        const configs = selectedPosts.map((item, index) => {
            const prompt = this._buildPromptFromPost(item);
            if (!prompt) {
                window.Logger.warn('BatchLauncher', 'Skipping batch item without prompt', item.imageId);
                return null;
            }
            this._assignPendingPrompt(item, prompt);
            return {
                prompt,
                mode: this.modeSelect?.value || 'normal',
                imageUrl: item.imageUrl || item.thumbnailUrl || null,
                metadata: {
                    batchIndex: index,
                    imageId: item.imageId,
                    modes: item.modes || [],
                    tags: item.tags || [],
                    moderated: item.moderated || false,
                    likeStatus: item.likeStatus || false,
                    source: 'batch-run'
                }
            };
        }).filter(Boolean);

        if (!configs.length) {
            window.Logger.warn('BatchLauncher', 'No valid prompts produced from batch selection');
            return;
        }

        this._persistCache();

        const state = this.stateManager.getState();
        if (!state.multiGeneration) {
            state.multiGeneration = {
                activeGenerations: new Map(),
                completedGenerations: new Map(),
                queuedGenerations: []
            };
        }

        window.Logger.info('BatchLauncher', `Batch run initiating ${configs.length} jobs`);

        multiManager.initiateMultipleGenerations(configs).then(results => {
            window.Logger.info('BatchLauncher', 'Batch run completion results:', results);
            this._markPostsAsInFlight(selectedPosts);
            this._updateStatus();
            if (interceptor && typeof interceptor._applyBatchRunMetadata === 'function') {
                interceptor._applyBatchRunMetadata(selectedPosts);
            }
        }).catch(error => {
            window.Logger.error('BatchLauncher', 'Batch run failed:', error);
        });
    }

    renderDataset() {
        if (!this.listContainer) return;

        const data = Array.isArray(this.dataset) ? this.dataset : [];
        const includeModerated = this.includeModeratedToggle?.checked;
        const filtered = includeModerated
            ? data
            : data.filter(item => !item.moderated);

        this._visibleCount = filtered.length;

        const validIds = new Set(filtered.map(item => item.imageId));
        for (const id of Array.from(this.selection)) {
            if (!validIds.has(id)) {
                this.selection.delete(id);
            }
        }

        if (!filtered.length) {
            const hasCache = (this.dataset?.length || 0) > 0;
            this.listContainer.innerHTML = `
                <div class="gvp-batch-empty">
                    <strong>${hasCache ? 'All entries filtered out' : 'No gallery data yet'}</strong>
                    <p>${hasCache ? 'Adjust filters or refresh to see more results.' : 'Click "Refresh Gallery Data" or paste a gallery export JSON to begin.'}</p>
                </div>
            `;
            this._updateStatus();
            return;
        }

        const fragment = document.createDocumentFragment();

        filtered.forEach(item => {
            const card = document.createElement('div');
            card.className = 'gvp-batch-card';
            card.dataset.imageId = item.imageId;
            if (this.selection.has(item.imageId)) {
                card.classList.add('selected');
            }
            if (item.moderated) {
                card.classList.add('is-moderated');
            }

            const header = document.createElement('div');
            header.className = 'gvp-batch-card-header';

            const idEl = document.createElement('div');
            idEl.className = 'gvp-batch-card-id';
            idEl.textContent = this._shortenId(item.imageId);

            const checkboxLabel = document.createElement('label');
            checkboxLabel.className = 'gvp-batch-card-checkbox';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = this.selection.has(item.imageId);
            const checkboxText = document.createElement('span');
            checkboxText.textContent = 'Select';
            checkboxLabel.appendChild(checkbox);
            checkboxLabel.appendChild(checkboxText);

            header.appendChild(idEl);
            header.appendChild(checkboxLabel);
            card.appendChild(header);

            const badgeBar = document.createElement('div');
            badgeBar.className = 'gvp-batch-card-badges';
            if (item.moderated) {
                const badge = document.createElement('span');
                badge.className = 'gvp-batch-card-badge moderated';
                badge.textContent = 'Moderated';
                badgeBar.appendChild(badge);
            }
            if (item.likeStatus) {
                const badge = document.createElement('span');
                badge.className = 'gvp-batch-card-badge liked';
                badge.textContent = 'Liked';
                badgeBar.appendChild(badge);
            }
            const primaryMode = this._primaryMode(item);
            if (primaryMode) {
                const badge = document.createElement('span');
                badge.className = 'gvp-batch-card-badge';
                badge.textContent = primaryMode;
                badgeBar.appendChild(badge);
            }
            if (badgeBar.children.length) {
                card.appendChild(badgeBar);
            }

            const body = document.createElement('div');
            body.className = 'gvp-batch-card-body';

            const thumb = this._createThumbnail(item);
            body.appendChild(thumb);

            const meta = document.createElement('div');
            meta.className = 'gvp-batch-card-meta';

            const title = document.createElement('div');
            title.className = 'gvp-batch-card-title';
            title.textContent = (item.title && item.title.trim()) || 'Untitled post';
            meta.appendChild(title);

            const metaRows = [
                { label: 'JSON', value: (item.jsonCount ?? 0).toString() },
                { label: 'Modes', value: this._formatModes(item.modes) },
                { label: 'Tags', value: this._formatTags(item.tags) }
            ];

            metaRows.forEach(({ label, value }) => {
                if (!value) return;
                const row = document.createElement('div');
                row.className = 'gvp-batch-card-meta-row';
                const labelEl = document.createElement('span');
                labelEl.className = 'label';
                labelEl.textContent = label;
                const valueEl = document.createElement('span');
                valueEl.className = 'value';
                valueEl.textContent = value;
                row.append(labelEl, valueEl);
                meta.appendChild(row);
            });

            body.appendChild(meta);
            card.appendChild(body);

            const footer = document.createElement('div');
            footer.className = 'gvp-batch-card-footer';
            footer.innerHTML = `
                <span>Updated: ${this._formatTimestamp(item.lastAccessed)}</span>
                <span>Created: ${this._formatTimestamp(item.createdAt)}</span>
            `;
            card.appendChild(footer);

            const syncSelectionState = (checked) => {
                card.classList.toggle('selected', checked);
                checkbox.checked = checked;
            };

            checkbox.addEventListener('change', (event) => {
                this.toggleSelect(item.imageId);
                syncSelectionState(event.target.checked);
            });
            checkboxLabel.addEventListener('click', (event) => event.stopPropagation());

            card.addEventListener('click', (event) => {
                if (event.target.closest('input, label, button, a')) return;
                this.toggleSelect(item.imageId);
                syncSelectionState(this.selection.has(item.imageId));
            });

            fragment.appendChild(card);
        });

        this.listContainer.innerHTML = '';
        this.listContainer.appendChild(fragment);
        this._updateStatus();
    }

    _updateStatus() {
        if (!this.statusLabel) return;
        const total = Array.isArray(this.dataset) ? this.dataset.length : 0;
        const visible = typeof this._visibleCount === 'number' ? this._visibleCount : total;
        const moderatedHidden = this.includeModeratedToggle && !this.includeModeratedToggle.checked;
        const moderatedCount = moderatedHidden ? Math.max(total - visible, 0) : 0;

        let summary = `${this.selection.size} selected · ${visible}/${total} visible`;
        if (moderatedCount > 0) {
            summary += ` · ${moderatedCount} moderated hidden`;
        }
        this.statusLabel.textContent = summary;
    }

    _formatTimestamp(timestamp) {
        if (!timestamp) return '—';
        try {
            const date = new Date(timestamp);
            return date.toLocaleString();
        } catch (error) {
            return '—';
        }
    }

    _formatModes(modes) {
        if (!Array.isArray(modes) || modes.length === 0) {
            return '—';
        }
        const unique = Array.from(new Set(modes.filter(Boolean)));
        return unique.length ? unique.slice(0, 3).join(', ') : '—';
    }

    _formatTags(tags) {
        if (!Array.isArray(tags) || !tags.length) {
            return '';
        }
        const unique = Array.from(new Set(tags.filter(Boolean)));
        if (!unique.length) return '';
        const trimmed = unique.slice(0, 3)
            .map(tag => tag.length > 24 ? `${tag.slice(0, 21)}…` : tag);
        return trimmed.join(', ');
    }

    _primaryMode(item) {
        if (!item) return null;
        const modes = Array.isArray(item.modes) ? item.modes.filter(Boolean) : [];
        return modes.length ? modes[0] : null;
    }

    _createThumbnail(item) {
        const wrapper = document.createElement('div');
        wrapper.className = 'gvp-batch-card-thumb';

        const url = this._selectMediaUrl(item);
        if (!url) {
            wrapper.classList.add('is-placeholder');
            return wrapper;
        }

        const img = document.createElement('img');
        img.loading = 'lazy';
        img.decoding = 'async';
        img.alt = (item.title && item.title.trim()) || item.imageId || 'Gallery preview';
        img.referrerPolicy = 'no-referrer';
        img.src = this._sanitizeUrl(url);

        const markPlaceholder = () => {
            wrapper.classList.add('is-placeholder');
        };

        img.addEventListener('error', () => {
            markPlaceholder();
            img.remove();
        });

        img.addEventListener('load', () => {
            wrapper.classList.remove('is-placeholder');
        });

        wrapper.appendChild(img);
        return wrapper;
    }

    _selectMediaUrl(item) {
        if (!item) return '';
        if (item.thumbnailUrl) return item.thumbnailUrl;
        if (item.imageUrl) return item.imageUrl;
        if (item.raw && typeof item.raw === 'object') {
            const nested = this._extractRawMediaUrl(item.raw);
            if (nested) return nested;
        }
        return '';
    }

    _extractRawMediaUrl(raw) {
        if (!raw || typeof raw !== 'object') return '';
        const candidates = [
            raw.thumbnailUrl,
            raw.previewUrl,
            raw.coverImageUrl,
            raw.imageUrl,
            raw.image?.url,
            raw.media?.[0]?.url,
            raw.mediaFile?.url
        ];
        const found = candidates.find(url => typeof url === 'string' && url.trim().length);
        if (found) return found;
        if (Array.isArray(raw.childPosts) && raw.childPosts.length) {
            for (const child of raw.childPosts) {
                const nested = this._extractRawMediaUrl(child);
                if (nested) return nested;
            }
        }
        return '';
    }

    _sanitizeUrl(url) {
        if (!url || typeof url !== 'string') return '';
        try {
            const parsed = new URL(url, window.location.origin);
            return parsed.toString();
        } catch (error) {
            return url.replace(/"/g, '%22');
        }
    }

    _shortenId(value) {
        if (!value || typeof value !== 'string') return '—';
        if (value.length <= 10) return value;
        return `${value.slice(0, 4)}…${value.slice(-3)}`;
    }

    _buildPromptFromPost(post) {
        if (!post) return '';

        const prioritySources = [
            post.pendingPrompt,
            post.lastSuccessfulPrompt,
            post.raw?.videoPrompt,
            post.raw?.prompt,
            post.title
        ];

        for (const candidate of prioritySources) {
            const normalized = this._normalizePromptPayload(candidate);
            if (normalized) {
                return normalized;
            }
        }

        if (post.modes && post.modes.length) {
            return `--mode=${post.modes[0]}`;
        }

        return '';
    }

    _markPostsAsInFlight(posts) {
        const timestamp = Date.now();
        posts.forEach(post => {
            post.lastBatchRunAt = timestamp;
            post.lastBatchRunStatus = 'queued';
        });
        this._persistCache();
    }

    _persistCache() {
        if (!Array.isArray(this.dataset) || !this.dataset.length) {
            chrome.storage.local.remove(this.storageKey, () => {
                if (chrome.runtime.lastError) {
                    window.Logger.warn('BatchLauncher', 'Failed clearing batch cache', chrome.runtime.lastError);
                }
            });
            return;
        }
        window.gvpBatchCache = this.dataset;
        chrome.storage.local.set({ [this.storageKey]: this.dataset }, () => {
            if (chrome.runtime.lastError) {
                window.Logger.warn('BatchLauncher', 'Failed persisting batch cache', chrome.runtime.lastError);
            }
        });
        this._hydrateInitialPrompt();
    }

    _loadPersistedCache() {
        try {
            const cached = window.gvpBatchCache || null;
            return Array.isArray(cached) ? cached : [];
        } catch (error) {
            window.Logger.warn('BatchLauncher', 'Failed loading in-memory batch cache', error);
            return [];
        }
    }

    _hydrateFromCache() {
        try {
            chrome.storage.local.get([this.storageKey], (result) => {
                if (chrome.runtime.lastError) {
                    window.Logger.warn('BatchLauncher', 'Failed reading batch cache', chrome.runtime.lastError);
                    return;
                }
                const cached = result?.[this.storageKey];
                if (Array.isArray(cached) && cached.length) {
                    window.gvpBatchCache = cached;
                    this.dataset = cached;
                    this.renderDataset();
                    this._updateStatus();
                }
            });
        } catch (error) {
            window.Logger.warn('BatchLauncher', 'Exception hydrating batch cache', error);
        }
    }

    _mergeExistingData(posts) {
        if (!Array.isArray(posts)) return [];
        const existingSources = [];
        if (Array.isArray(this.dataset) && this.dataset.length) existingSources.push(this.dataset);
        const cached = this._loadPersistedCache();
        if (Array.isArray(cached) && cached.length) existingSources.push(cached);

        const existingMap = new Map();
        existingSources.forEach(source => {
            source.forEach(item => {
                if (item?.imageId && !existingMap.has(item.imageId)) {
                    existingMap.set(item.imageId, item);
                }
            });
        });

        return posts.map(post => {
            const existing = existingMap.get(post.imageId);
            if (!existing) return post;
            return {
                ...post,
                pendingPrompt: existing.pendingPrompt ?? post.pendingPrompt ?? null,
                pendingPromptUpdatedAt: existing.pendingPromptUpdatedAt ?? post.pendingPromptUpdatedAt ?? null,
                lastSuccessfulPrompt: existing.lastSuccessfulPrompt ?? post.lastSuccessfulPrompt ?? null,
                lastSuccessfulAt: existing.lastSuccessfulAt ?? post.lastSuccessfulAt ?? null,
                lastSuccessfulVideoUrl: existing.lastSuccessfulVideoUrl ?? post.lastSuccessfulVideoUrl ?? null,
                lastSuccessfulAssetId: existing.lastSuccessfulAssetId ?? post.lastSuccessfulAssetId ?? null,
                lastBatchRunAt: existing.lastBatchRunAt ?? post.lastBatchRunAt ?? null,
                lastBatchRunStatus: existing.lastBatchRunStatus ?? post.lastBatchRunStatus ?? null
            };
        });
    }

    _assignPendingPrompt(post, prompt) {
        if (!post || !prompt) return;
        post.pendingPrompt = prompt;
        post.pendingPromptUpdatedAt = Date.now();
        post.lastBatchRunStatus = 'pending';
    }

    _applyPromptFromImage(imageId, { force = false } = {}) {
        if (!imageId) return false;

        const promptSource = this.getHighestPriorityPrompt(imageId);
        if (!promptSource) {
            return false;
        }

        let parsed;
        if (typeof promptSource === 'string') {
            const trimmed = promptSource.trim();
            if (!trimmed) {
                return false;
            }

            const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[');
            if (!looksJson) {
                const state = this.stateManager.getState();
                if (state) {
                    state.rawInput = trimmed;
                    if (state.generation) {
                        state.generation.lastPrompt = trimmed;
                        state.generation.lastVideoPromptRaw = trimmed;
                    }
                }
                return true;
            }

            try {
                parsed = JSON.parse(trimmed);
            } catch (error) {
                window.Logger.warn('BatchLauncher', 'Failed to parse prompt JSON for image', imageId, error);
                return false;
            }
        } else if (typeof promptSource === 'object') {
            parsed = JSON.parse(JSON.stringify(promptSource));
        } else {
            return false;
        }

        if (!parsed || typeof parsed !== 'object') {
            return false;
        }

        const state = this.stateManager.getState();
        if (!force && !this._promptDataLooksDefault(state?.promptData)) {
            return false;
        }

        const base = typeof this.stateManager._getEmptyPromptData === 'function'
            ? this.stateManager._getEmptyPromptData()
            : {};
        const merged = { ...base };

        const mergeObject = (target, source) => {
            if (!source || typeof source !== 'object' || Array.isArray(source)) {
                return source;
            }
            const next = { ...target };
            Object.entries(source).forEach(([key, value]) => {
                if (value && typeof value === 'object' && !Array.isArray(value) && target && typeof target[key] === 'object' && !Array.isArray(target[key])) {
                    next[key] = mergeObject(target[key], value);
                } else {
                    next[key] = value;
                }
            });
            return next;
        };

        Object.entries(parsed).forEach(([key, value]) => {
            if (value && typeof value === 'object' && !Array.isArray(value) && merged[key] && typeof merged[key] === 'object' && !Array.isArray(merged[key])) {
                merged[key] = mergeObject(merged[key], value);
            } else {
                merged[key] = value;
            }
        });

        state.promptData = merged;
        if (state.generation) {
            state.generation.lastPrompt = JSON.stringify(merged);
            state.generation.lastVideoPromptRaw = typeof promptSource === 'string' ? promptSource : JSON.stringify(promptSource);
        }

        if (state.settings?.silentMode && typeof this.stateManager.applySilentModeAudioDefaults === 'function') {
            this.stateManager.applySilentModeAudioDefaults();
        }

        if (window.gvpUIManager?.uiFormManager?.refreshCurrentView) {
            window.gvpUIManager.uiFormManager.refreshCurrentView();
        }
        if (window.gvpUIManager?.uiModalManager?.updateJsonPreview) {
            window.gvpUIManager.uiModalManager.updateJsonPreview();
        }

        return true;
    }

    _hydrateInitialPrompt() {
        try {
            const state = this.stateManager.getState();
            if (!this._promptDataLooksDefault(state?.promptData)) {
                return;
            }

            const candidate = Array.isArray(this.dataset)
                ? this.dataset.find(item => {
                    const pending = item?.pendingPrompt;
                    const successful = item?.lastSuccessfulPrompt;
                    const hasPending = (typeof pending === 'string' && pending.trim()) || (pending && typeof pending === 'object');
                    const hasSuccessful = (typeof successful === 'string' && successful.trim()) || (successful && typeof successful === 'object');
                    return hasPending || hasSuccessful;
                })
                : null;

            if (!candidate || !candidate.imageId) {
                return;
            }

            this._applyPromptFromImage(candidate.imageId, { force: true });
        } catch (error) {
            window.Logger.warn('BatchLauncher', 'Failed hydrating initial prompt from batch dataset', error);
        }
    }

    _promptDataLooksDefault(promptData) {
        if (!promptData || typeof promptData !== 'object') {
            return true;
        }

        const categories = ['shot', 'scene', 'cinematography', 'visual_details', 'audio'];
        for (const category of categories) {
            const bucket = promptData[category];
            if (!bucket) continue;
            if (Array.isArray(bucket)) {
                if (bucket.length) return false;
                continue;
            }
            if (typeof bucket === 'object') {
                const hasValue = Object.values(bucket).some(value => {
                    if (Array.isArray(value)) return value.length > 0;
                    return typeof value === 'string' ? value.trim().length > 0 : !!value;
                });
                if (hasValue) return false;
            } else if (typeof bucket === 'string' && bucket.trim().length) {
                return false;
            }
        }

        if (typeof promptData.motion === 'string' && promptData.motion.trim().length) {
            return false;
        }

        if (Array.isArray(promptData.dialogue) && promptData.dialogue.length) {
            return false;
        }

        if (Array.isArray(promptData.tags) && promptData.tags.length) {
            return false;
        }

        return true;
    }

    getHighestPriorityPrompt(imageId) {
        if (!imageId || !Array.isArray(this.dataset)) return null;
        const post = this.dataset.find(item => item.imageId === imageId);
        if (!post) return null;

        const { pendingPrompt, lastSuccessfulPrompt, raw, title } = post;
        if (pendingPrompt && typeof pendingPrompt === 'string' && pendingPrompt.trim()) {
            return pendingPrompt;
        }

        if (lastSuccessfulPrompt && typeof lastSuccessfulPrompt === 'string' && lastSuccessfulPrompt.trim()) {
            return lastSuccessfulPrompt;
        }

        if (lastSuccessfulPrompt && typeof lastSuccessfulPrompt === 'object') {
            return JSON.parse(JSON.stringify(lastSuccessfulPrompt));
        }

        const fallback = raw?.videoPrompt || raw?.prompt || title || null;
        if (typeof fallback === 'string' && fallback.trim()) {
            return fallback.trim();
        }

        if (fallback && typeof fallback === 'object') {
            try {
                return JSON.parse(JSON.stringify(fallback));
            } catch (error) {
                window.Logger.warn('BatchLauncher', 'Failed to stringify fallback prompt for', imageId, error);
            }
        }

        return null;
    }

    _normalizePromptPayload(value) {
        if (value === null || value === undefined) {
            return '';
        }

        if (typeof value === 'string') {
            return value.trim();
        }

        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch (error) {
                window.Logger.warn('BatchLauncher', 'Failed to stringify prompt payload', error);
                return '';
            }
        }

        return '';
    }

    updatePostPrompt(imageId, updates = {}) {
        if (!imageId || typeof updates !== 'object') return;
        const post = this.dataset.find(item => item.imageId === imageId);
        if (!post) {
            window.Logger.warn('BatchLauncher', 'Unable to update batch prompt; post not found', imageId);
            return;
        }
        Object.assign(post, updates);
        this._persistCache();
        this._updateStatus();
    }

    onGenerationResult(imageId, result = {}) {
        if (!imageId) return;
        const post = this.dataset.find(item => item.imageId === imageId);
        if (!post) {
            window.Logger.warn('BatchLauncher', 'Generation result received for unknown post', imageId);
            return;
        }

        const now = Date.now();
        const { finalPrompt, wasModerated, videoUrl, assetId } = result;

        if (finalPrompt && !wasModerated) {
            post.lastSuccessfulPrompt = finalPrompt;
            post.lastSuccessfulAt = now;
            post.lastSuccessfulVideoUrl = videoUrl || post.lastSuccessfulVideoUrl || null;
            post.lastSuccessfulAssetId = assetId || post.lastSuccessfulAssetId || null;
            post.pendingPrompt = null;
            post.pendingPromptUpdatedAt = null;
        }

        if (wasModerated) {
            post.lastBatchRunStatus = 'moderated';
        } else {
            post.lastBatchRunStatus = finalPrompt ? 'completed' : 'unknown';
        }
        post.lastBatchRunAt = now;

        this._persistCache();
        this.renderDataset();
    }
};
