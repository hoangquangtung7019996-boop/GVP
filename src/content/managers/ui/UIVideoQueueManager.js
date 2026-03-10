// UIVideoQueueManager.js - Queue Tab UI Manager
// Dependencies: StateManager, UIManager, IndexedDBManager
// Listens to same gvp:vidgen-beacon events as Rail, but renders in tab format

/**
 * UIVideoQueueManager (v1.22.3)
 * 
 * Manages the "Queue" tab (Tab 4) displaying real-time video generation progress.
 * Shows a grid of thumbnails with colored borders (like Rail but bigger).
 * Items added IMMEDIATELY on generation start (grey), updated to green/red on terminal.
 */
window.UIVideoQueueManager = class UIVideoQueueManager {
    constructor(uiManager, shadowRoot) {
        this.uiManager = uiManager;
        this.shadowRoot = shadowRoot;
        this.stateManager = uiManager?.stateManager || window.gvpStateManager;
        // Access IndexedDBManager from global (set as window.gvpIndexedDB by content.js)
        this.indexedDBManager = window.gvpIndexedDB ||
            uiManager?.indexedDBManager;

        /** @type {Map<string, Object>} videoId -> queue item data */
        this.queueItems = new Map();

        /** @type {string} Sort mode: 'newest', 'oldest', 'status' */
        this.sortMode = 'newest';

        /** @type {boolean} Drag mode enabled for manual reordering */
        this.dragMode = false;

        /** @type {Array<string>} Manual sort order (videoId list) */
        this.manualOrder = [];

        /** @type {number} How many recent images to load */
        this.recentLoadCount = 20;

        /** @type {HTMLElement|null} */
        this.container = null;
        this.gridContainer = null;
        this.statsBar = null;
        this.dragToggleBtn = null;
        this.quickAddBtn = null;

        /** @type {boolean} Quick Add mode - adds gallery clicks to queue instead of generating */
        this.quickAddMode = false;

        /** @type {boolean} v1.23.18: Include Edits mode - also adds edited versions when Quick Adding */
        this.includeEditsMode = false;
        this.includeEditsBtn = null;

        /** @type {string} v1.23.12: Load filter type: 'generated' | 'successful' | 'moderated' | 'all' */
        this.loadFilter = 'all';

        this._boundHandleRailProgress = this._handleRailProgress.bind(this);
        this._boundHandleLateInit = async () => {
            window.Logger.info('Queue', '📥 Late IDB init detected, refreshing queue...');
            try {
                await this._loadRecentImages();
            } catch (err) {
                window.Logger.error('Queue', '❌ Error loading recent images on late-init', err);
            }
        };
    }

    /**
     * Initialize the queue manager
     */
    init() {
        this._attachEventListeners();
        this._restoreSettings(); // v1.23.12: Restore queue settings
        this._restorePromptPack(); // v1.23.12: Restore saved prompt pack
        window.Logger.info('Queue', 'UIVideoQueueManager initialized');
    }

    /**
     * Create the queue tab content
     * @returns {HTMLElement}
     */
    createTabContent() {
        this.container = document.createElement('div');
        this.container.className = 'gvp-queue-container';
        this.container.style.cssText = `
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow: hidden;
        `;

        // Header bar with stats and actions
        const header = this._createHeaderBar();
        this.container.appendChild(header);

        // Grid container for thumbnails
        this.gridContainer = document.createElement('div');
        this.gridContainer.className = 'gvp-queue-grid';
        this.gridContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 8px;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
            gap: 8px;
            align-content: start;
        `;

        // Empty state
        this._renderEmptyState();

        this.container.appendChild(this.gridContainer);

        return this.container;
    }

    _createHeaderBar() {
        const header = document.createElement('div');
        header.className = 'gvp-queue-header';
        header.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 6px 8px;
            background: #0d0d0d;
            border-bottom: 1px solid #2a2a2a;
            flex-shrink: 0;
        `;

        // Common button style
        const btnStyle = `
            width: 32px; height: 32px; border-radius: 6px;
            background: #1a1a1a; border: 1px solid #333; color: #fff;
            font-size: 14px; cursor: pointer; display: flex;
            align-items: center; justify-content: center; transition: background 0.15s;
            flex-shrink: 0;
        `;
        const btnActiveStyle = 'background: #2a4a6a; border-color: #3a6a9a;';
        const separatorStyle = `width: 1px; height: 24px; background: #333; margin: 0 4px; flex-shrink: 0;`;

        // ═══════════════════════════════════════════════════════════════════
        // ROW 1: [Prompt▼] | [20] [🔄] [🕹️] [👆] | [Newest▼] [⚙️] | [✅ 0]
        // ═══════════════════════════════════════════════════════════════════
        const row1 = document.createElement('div');
        row1.style.cssText = `display: flex; align-items: center; gap: 4px; width: 100%;`;

        // Col 1: Prompt Mode cycling button
        const promptModes = [
            { value: 'json', icon: '📋', label: 'JSON Prompt' },
            { value: 'raw', icon: '📝', label: 'Raw Text' },
            { value: 'sequential', icon: '📦', label: 'Sequential Pack' },
            { value: 'random', icon: '🎲', label: 'Random Pack' }
        ];
        const engine = this._getQueueEngine();
        let promptModeIndex = promptModes.findIndex(m => m.value === (engine?.promptMode || 'json'));
        if (promptModeIndex < 0) promptModeIndex = 0;

        this.promptModeBtn = document.createElement('button');
        this.promptModeBtn.style.cssText = btnStyle;
        this.promptModeBtn.innerHTML = promptModes[promptModeIndex].icon;
        this.promptModeBtn.title = `Prompt: ${promptModes[promptModeIndex].label}`;
        this.promptModeBtn.addEventListener('click', () => {
            promptModeIndex = (promptModeIndex + 1) % promptModes.length;
            const mode = promptModes[promptModeIndex];
            this.promptModeBtn.innerHTML = mode.icon;
            this.promptModeBtn.title = `Prompt: ${mode.label}`;
            const eng = this._getQueueEngine();
            if (eng) eng.setPromptMode(mode.value);
            this.uiManager?.showToast?.(`${mode.icon} ${mode.label}`, 'info');
        });
        this.promptModeBtn.addEventListener('mouseenter', () => this.promptModeBtn.style.background = '#2a2a2a');
        this.promptModeBtn.addEventListener('mouseleave', () => this.promptModeBtn.style.background = '#1a1a1a');
        row1.appendChild(this.promptModeBtn);

        // Separator
        const sep1 = document.createElement('span');
        sep1.style.cssText = separatorStyle;
        row1.appendChild(sep1);

        // Col 2: [🧹 Clean] [🔄 Load] [🕹️ Quick Add]
        const col2Row1 = document.createElement('div');
        col2Row1.style.cssText = `display: flex; align-items: center; gap: 4px; flex: 1;`;

        // Clean Up Queue button (🧹)
        const cleanBtn = document.createElement('button');
        cleanBtn.style.cssText = btnStyle;
        cleanBtn.innerHTML = '🧹';
        cleanBtn.title = 'Clean up queue (clear completed/moderated)';
        cleanBtn.addEventListener('click', () => this._showCleanupMenu(cleanBtn));
        cleanBtn.addEventListener('mouseenter', () => cleanBtn.style.background = '#2a2a2a');
        cleanBtn.addEventListener('mouseleave', () => cleanBtn.style.background = '#1a1a1a');
        col2Row1.appendChild(cleanBtn);

        // Load button
        const loadBtn = document.createElement('button');
        loadBtn.style.cssText = btnStyle;
        loadBtn.innerHTML = '🔄';
        loadBtn.title = `Load ${this.recentLoadCount} recent items from history`;
        loadBtn.addEventListener('click', () => this._loadRecentImages());
        loadBtn.addEventListener('mouseenter', () => loadBtn.style.background = '#2a2a2a');
        loadBtn.addEventListener('mouseleave', () => loadBtn.style.background = '#1a1a1a');
        col2Row1.appendChild(loadBtn);

        // Quick Add toggle (🕹️)
        this.quickAddBtn = document.createElement('button');
        this.quickAddBtn.style.cssText = btnStyle;
        this.quickAddBtn.innerHTML = '🕹️';
        this.quickAddBtn.title = 'Quick Add: Click gallery images to add to queue';
        this.quickAddBtn.addEventListener('click', () => {
            const currentMode = this.uiManager?.getQuickLaunchMode?.();
            const newMode = currentMode === 'queue' ? null : 'queue';
            if (this.uiManager?.setQuickLaunchMode) this.uiManager.setQuickLaunchMode(newMode);
            this.quickAddBtn.style.cssText = btnStyle + (newMode === 'queue' ? btnActiveStyle : '');
            this.uiManager?.showToast?.(newMode === 'queue' ? '🕹️ Quick Add ON' : '🕹️ Quick Add OFF', 'info');
        });
        col2Row1.appendChild(this.quickAddBtn);

        row1.appendChild(col2Row1);

        // Separator
        const sep2 = document.createElement('span');
        sep2.style.cssText = separatorStyle;
        row1.appendChild(sep2);

        // Col 3: [Newest▼] [⚙️]
        const col3Row1 = document.createElement('div');
        col3Row1.style.cssText = `display: flex; align-items: center; gap: 4px;`;

        // Sort cycling button
        const sortModes = [
            { value: 'newest', icon: '↓', label: 'Newest First' },
            { value: 'oldest', icon: '↑', label: 'Oldest First' },
            { value: 'status', icon: '◐', label: 'By Status' }
        ];
        let sortModeIndex = sortModes.findIndex(m => m.value === this.sortMode);
        if (sortModeIndex < 0) sortModeIndex = 0;

        this.sortModeBtn = document.createElement('button');
        this.sortModeBtn.style.cssText = btnStyle;
        this.sortModeBtn.innerHTML = sortModes[sortModeIndex].icon;
        this.sortModeBtn.title = `Sort: ${sortModes[sortModeIndex].label}`;
        this.sortModeBtn.addEventListener('click', () => {
            sortModeIndex = (sortModeIndex + 1) % sortModes.length;
            const mode = sortModes[sortModeIndex];
            this.sortModeBtn.innerHTML = mode.icon;
            this.sortModeBtn.title = `Sort: ${mode.label}`;
            this.sortMode = mode.value;
            this._renderGrid();
            this.uiManager?.showToast?.(`${mode.icon} ${mode.label}`, 'info');
        });
        this.sortModeBtn.addEventListener('mouseenter', () => this.sortModeBtn.style.background = '#2a2a2a');
        this.sortModeBtn.addEventListener('mouseleave', () => this.sortModeBtn.style.background = '#1a1a1a');
        col3Row1.appendChild(this.sortModeBtn);

        // v1.23.18: Include Edits toggle (🖼️) - between sort and settings
        this.includeEditsBtn = document.createElement('button');
        this.includeEditsBtn.style.cssText = btnStyle + (this.includeEditsMode ? btnActiveStyle : '');
        this.includeEditsBtn.innerHTML = '🖼️';
        this.includeEditsBtn.title = 'Include Edits: Also add edited versions when Quick Adding';
        this.includeEditsBtn.addEventListener('click', () => {
            this.includeEditsMode = !this.includeEditsMode;
            this.includeEditsBtn.style.cssText = btnStyle + (this.includeEditsMode ? btnActiveStyle : '');
            this.uiManager?.showToast?.(this.includeEditsMode ? '🖼️ Include Edits ON' : '🖼️ Include Edits OFF', 'info');
        });
        this.includeEditsBtn.addEventListener('mouseenter', () => this.includeEditsBtn.style.background = '#2a2a2a');
        this.includeEditsBtn.addEventListener('mouseleave', () => {
            this.includeEditsBtn.style.background = this.includeEditsMode ? '#2a3a2a' : '#1a1a1a';
        });
        col3Row1.appendChild(this.includeEditsBtn);

        // Settings button
        const settingsBtn = document.createElement('button');
        settingsBtn.style.cssText = btnStyle;
        settingsBtn.innerHTML = '⚙️';
        settingsBtn.title = 'Queue settings';
        settingsBtn.addEventListener('click', () => this._showSettingsPopup());
        settingsBtn.addEventListener('mouseenter', () => settingsBtn.style.background = '#2a2a2a');
        settingsBtn.addEventListener('mouseleave', () => settingsBtn.style.background = '#1a1a1a');
        col3Row1.appendChild(settingsBtn);

        row1.appendChild(col3Row1);

        // Separator
        const sep3 = document.createElement('span');
        sep3.style.cssText = separatorStyle;
        row1.appendChild(sep3);

        // Col 4: Success count (just green number)
        this.successCountEl = document.createElement('span');
        this.successCountEl.className = 'gvp-success-count';
        this.successCountEl.style.cssText = `
            font-size: 13px; color: #4ade80; font-weight: 700; min-width: 16px; text-align: center;
        `;
        this.successCountEl.textContent = '0';
        row1.appendChild(this.successCountEl);

        header.appendChild(row1);

        // ═══════════════════════════════════════════════════════════════════
        // ROW 2: [Loop▼] | [▶] [⏹] [✏️] | [🗑️] [⬆️] [⬇️] | [❌ 0]
        // ═══════════════════════════════════════════════════════════════════
        const row2 = document.createElement('div');
        row2.style.cssText = `display: flex; align-items: center; gap: 4px; width: 100%;`;

        // Col 1: Loop Mode cycling button
        const loopModes = [
            { value: 'off', icon: '🚫', label: 'No Loop' },
            { value: 'moderated', icon: '🔁', label: 'Retry Moderated' },
            { value: 'full', icon: '🔄', label: 'Full Loop' }
        ];
        let loopModeIndex = loopModes.findIndex(m => m.value === (engine?.loopMode || 'off'));
        if (loopModeIndex < 0) loopModeIndex = 0;

        this.loopModeBtn = document.createElement('button');
        this.loopModeBtn.style.cssText = btnStyle;
        this.loopModeBtn.innerHTML = loopModes[loopModeIndex].icon;
        this.loopModeBtn.title = `Loop: ${loopModes[loopModeIndex].label}`;
        this.loopModeBtn.addEventListener('click', () => {
            loopModeIndex = (loopModeIndex + 1) % loopModes.length;
            const mode = loopModes[loopModeIndex];
            this.loopModeBtn.innerHTML = mode.icon;
            this.loopModeBtn.title = `Loop: ${mode.label}`;
            const eng = this._getQueueEngine();
            if (eng) eng.setLoopMode(mode.value);
            this.uiManager?.showToast?.(`${mode.icon} ${mode.label}`, 'info');
        });
        this.loopModeBtn.addEventListener('mouseenter', () => this.loopModeBtn.style.background = '#2a2a2a');
        this.loopModeBtn.addEventListener('mouseleave', () => this.loopModeBtn.style.background = '#1a1a1a');
        row2.appendChild(this.loopModeBtn);

        // Separator
        const sep4 = document.createElement('span');
        sep4.style.cssText = separatorStyle;
        row2.appendChild(sep4);

        // Col 2: [▶] [⏹] [✏️]
        const col2Row2 = document.createElement('div');
        col2Row2.style.cssText = `display: flex; align-items: center; gap: 4px; flex: 1;`;

        // Play button
        this.playBtn = document.createElement('button');
        this.playBtn.style.cssText = btnStyle;
        this.playBtn.innerHTML = '▶️';
        this.playBtn.title = 'Start queue processing';
        this.playBtn.addEventListener('click', () => this._togglePlayPause());
        this.playBtn.addEventListener('mouseenter', () => this.playBtn.style.background = '#2a2a2a');
        this.playBtn.addEventListener('mouseleave', () => this.playBtn.style.background = '#1a1a1a');
        col2Row2.appendChild(this.playBtn);

        // Stop button
        const stopBtn = document.createElement('button');
        stopBtn.style.cssText = btnStyle;
        stopBtn.innerHTML = '⏹️';
        stopBtn.title = 'Stop queue processing';
        stopBtn.addEventListener('click', () => this._stopQueue());
        stopBtn.addEventListener('mouseenter', () => stopBtn.style.background = '#2a2a2a');
        stopBtn.addEventListener('mouseleave', () => stopBtn.style.background = '#1a1a1a');
        col2Row2.appendChild(stopBtn);

        // Drag mode toggle
        this.dragToggleBtn = document.createElement('button');
        this.dragToggleBtn.style.cssText = btnStyle;
        this.dragToggleBtn.innerHTML = '✏️';
        this.dragToggleBtn.title = 'Toggle drag mode (manual reorder)';
        this.dragToggleBtn.addEventListener('click', () => {
            this.dragMode = !this.dragMode;
            this.dragToggleBtn.style.cssText = btnStyle + (this.dragMode ? btnActiveStyle : '');
            this._renderGrid();
        });
        col2Row2.appendChild(this.dragToggleBtn);

        row2.appendChild(col2Row2);

        // Separator
        const sep5 = document.createElement('span');
        sep5.style.cssText = separatorStyle;
        row2.appendChild(sep5);

        // Col 3: [🗑️] [⬆️] [⬇️] - Batch actions
        const col3Row2 = document.createElement('div');
        col3Row2.style.cssText = `display: flex; align-items: center; gap: 4px;`;

        // Delete All from Gallery
        const deleteAllBtn = document.createElement('button');
        deleteAllBtn.style.cssText = btnStyle;
        deleteAllBtn.innerHTML = '🗑️';
        deleteAllBtn.title = 'Delete all items from Grok gallery';
        deleteAllBtn.addEventListener('click', () => this._deleteAllFromGallery());
        deleteAllBtn.addEventListener('mouseenter', () => deleteAllBtn.style.background = '#4a2a2a');
        deleteAllBtn.addEventListener('mouseleave', () => deleteAllBtn.style.background = '#1a1a1a');
        col3Row2.appendChild(deleteAllBtn);

        // Upscale All
        const upscaleAllBtn = document.createElement('button');
        upscaleAllBtn.style.cssText = btnStyle;
        upscaleAllBtn.innerHTML = '⬆️';
        upscaleAllBtn.title = 'Upscale all videos in queue';
        upscaleAllBtn.addEventListener('click', () => this._upscaleAllItems());
        upscaleAllBtn.addEventListener('mouseenter', () => upscaleAllBtn.style.background = '#2a2a2a');
        upscaleAllBtn.addEventListener('mouseleave', () => upscaleAllBtn.style.background = '#1a1a1a');
        col3Row2.appendChild(upscaleAllBtn);

        // Download All
        const downloadAllBtn = document.createElement('button');
        downloadAllBtn.style.cssText = btnStyle;
        downloadAllBtn.innerHTML = '⬇️';
        downloadAllBtn.title = 'Download all videos in queue';
        downloadAllBtn.addEventListener('click', () => this._downloadAllItems());
        downloadAllBtn.addEventListener('mouseenter', () => downloadAllBtn.style.background = '#2a2a2a');
        downloadAllBtn.addEventListener('mouseleave', () => downloadAllBtn.style.background = '#1a1a1a');
        col3Row2.appendChild(downloadAllBtn);

        row2.appendChild(col3Row2);

        // Separator
        const sep6 = document.createElement('span');
        sep6.style.cssText = separatorStyle;
        row2.appendChild(sep6);

        // Col 4: Moderated count (just red number)
        this.moderatedCountEl = document.createElement('span');
        this.moderatedCountEl.className = 'gvp-moderated-count';
        this.moderatedCountEl.style.cssText = `
            font-size: 13px; color: #f87171; font-weight: 700; min-width: 16px; text-align: center;
        `;
        this.moderatedCountEl.textContent = '0';
        row2.appendChild(this.moderatedCountEl);

        header.appendChild(row2);

        // Update counts on init
        this._updateHeaderCounts();

        return header;
    }

    _attachEventListeners() {
        window.addEventListener('gvp:vidgen-beacon', this._boundHandleRailProgress);
        this._boundHandleTerminalState = this._handleTerminalState.bind(this);
        window.addEventListener('gvp:progress-update', this._boundHandleTerminalState);
        this._boundHandleQueueStatus = this._handleQueueStatus.bind(this);
        window.addEventListener('gvp:queue-status', this._boundHandleQueueStatus);
        window.addEventListener('gvp:idb-late-init', this._boundHandleLateInit);
    }

    // ═══════════════════════════════════════════════════════════════════
    // HEADER HELPER METHODS (v1.23.12)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Update success/moderated counts in header
     */
    _updateHeaderCounts() {
        let successCount = 0;
        let moderatedCount = 0;

        for (const item of this.queueItems.values()) {
            if (item.status === 'success') successCount++;
            else if (item.status === 'moderated') moderatedCount++;
        }

        if (this.successCountEl) {
            this.successCountEl.textContent = successCount;
        }
        if (this.moderatedCountEl) {
            this.moderatedCountEl.textContent = moderatedCount;
        }
    }

    /**
     * Save queue settings to Chrome storage
     */
    _saveSettings() {
        try {
            if (!chrome.runtime?.id) return; // Guard: extension context may be invalidated
            chrome.storage.local.set({
                gvp_queue_settings: JSON.stringify({
                    loadFilter: this.loadFilter,
                    recentLoadCount: this.recentLoadCount,
                    sortMode: this.sortMode
                })
            });
            window.Logger.debug('Queue', '💾 Settings saved');
        } catch (error) {
            window.Logger.warn('Queue', 'Failed to save settings:', error);
        }
    }

    /**
     * Restore queue settings from Chrome storage
     */
    async _restoreSettings() {
        try {
            if (!chrome.runtime?.id) return; // Guard: extension context may be invalidated
            const result = await chrome.storage.local.get('gvp_queue_settings');
            if (result?.gvp_queue_settings) {
                const settings = JSON.parse(result.gvp_queue_settings);
                this.loadFilter = settings.loadFilter || 'all';
                this.recentLoadCount = settings.recentLoadCount || 20;
                this.sortMode = settings.sortMode || 'newest';
                window.Logger.debug('Queue', '📂 Settings restored');
            }
        } catch (error) {
            window.Logger.warn('Queue', 'Failed to restore settings:', error);
        }
    }

    /**
     * Toggle play/pause queue processing
     */
    _togglePlayPause() {
        const engine = this._getQueueEngine();
        if (!engine) return;

        if (engine.isRunning) {
            if (engine.isPaused) {
                engine.resume();
                this.playBtn.innerHTML = '⏸️';
            } else {
                engine.pause();
                this.playBtn.innerHTML = '▶️';
            }
        } else {
            engine.start();
            this.playBtn.innerHTML = '⏸️';
        }
    }

    /**
     * Stop queue processing
     */
    _stopQueue() {
        const engine = this._getQueueEngine();
        if (engine) {
            engine.stop();
            this.playBtn.innerHTML = '▶️';
        }
    }

    /**
     * Clear all items from queue (local only)
     */
    _clearAll() {
        this.queueItems.clear();
        this.manualOrder = [];
        this._renderGrid();
        this._updateHeaderCounts();
        this.uiManager?.showToast?.('🗑️ Queue cleared', 'info');
    }

    /**
     * Clear items by status
     * @param {string} status - 'moderated' | 'success' | 'pending'
     */
    _clearByStatus(status) {
        let count = 0;
        for (const [id, item] of this.queueItems.entries()) {
            if (item.status === status) {
                this.queueItems.delete(id);
                this.manualOrder = this.manualOrder.filter(i => i !== id);
                count++;
            }
        }
        this._renderGrid();
        this._updateHeaderCounts();
        this.uiManager?.showToast?.(`🗑️ Cleared ${count} ${status} items`, 'info');
    }

    /**
     * Show cleanup menu popup with options
     * @param {HTMLElement} anchor - Button to anchor menu to
     */
    _showCleanupMenu(anchor) {
        // Remove existing menu
        const existing = this.container?.querySelector('.gvp-cleanup-menu');
        if (existing) {
            existing.remove();
            return;
        }

        const menu = document.createElement('div');
        menu.className = 'gvp-cleanup-menu';
        menu.style.cssText = `
            position: absolute; top: 100%; left: 0; margin-top: 4px;
            background: #1a1a1a; border: 1px solid #333; border-radius: 6px;
            padding: 4px 0; z-index: 1000; min-width: 140px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        `;

        const options = [
            { label: '🗑️ Clear All', action: () => this._clearAll() },
            { label: '✅ Clear Successful', action: () => this._clearByStatus('success') },
            { label: '❌ Clear Moderated', action: () => this._clearByStatus('moderated') },
            { label: '⏳ Clear Pending', action: () => this._clearByStatus('pending') }
        ];

        options.forEach(opt => {
            const item = document.createElement('div');
            item.style.cssText = `
                padding: 6px 12px; font-size: 11px; color: #ccc; cursor: pointer;
                white-space: nowrap;
            `;
            item.textContent = opt.label;
            item.addEventListener('mouseenter', () => item.style.background = '#2a2a2a');
            item.addEventListener('mouseleave', () => item.style.background = 'transparent');
            item.addEventListener('click', () => {
                opt.action();
                menu.remove();
            });
            menu.appendChild(item);
        });

        // Position relative to anchor
        const rect = anchor.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        menu.style.left = `${rect.left - containerRect.left}px`;
        menu.style.top = `${rect.bottom - containerRect.top + 4}px`;

        this.container.style.position = 'relative';
        this.container.appendChild(menu);

        // Close on outside click
        const closeHandler = (e) => {
            if (!menu.contains(e.target) && e.target !== anchor) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }

    // ═══════════════════════════════════════════════════════════════════
    // BATCH ACTIONS (v1.23.12)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Delete all queue items from Grok gallery (with confirmation)
     * Uses POST /rest/media/post/delete endpoint
     */
    async _deleteAllFromGallery() {
        const items = Array.from(this.queueItems.values());
        const count = items.length;

        if (count === 0) {
            this.uiManager?.showToast?.('Queue is empty', 'info');
            return;
        }

        // Show confirmation dialog
        const confirmed = confirm(`⚠️ DELETE FROM GALLERY\n\nThis will permanently delete ${count} items from your Grok gallery.\n\nThis action cannot be undone.\n\nContinue?`);

        if (!confirmed) return;

        this.uiManager?.showToast?.(`🗑️ Deleting ${count} items from gallery...`, 'info');
        window.Logger.info('Queue', `Starting gallery deletion of ${count} items`);

        let deleted = 0;
        let failed = 0;

        for (const item of items) {
            try {
                // Get the post/image ID to delete
                const postId = item.imageId || item.videoId || item.id;
                if (!postId) {
                    window.Logger.warn('Queue', 'No ID found for item:', item);
                    failed++;
                    continue;
                }

                // Call Grok's delete API
                const response = await fetch('/rest/media/post/delete', {
                    method: 'POST',
                    headers: {
                        'accept': '*/*',
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({ id: postId }),
                    credentials: 'include'
                });

                if (response.ok) {
                    deleted++;
                    window.Logger.debug('Queue', `Deleted: ${postId}`);
                } else {
                    const errorText = await response.text();
                    window.Logger.warn('Queue', `Delete failed for ${postId}: ${response.status} ${errorText}`);
                    failed++;
                }

                // Rate limit: 500ms between deletions
                await new Promise(r => setTimeout(r, 500));

            } catch (error) {
                window.Logger.error('Queue', 'Delete error:', error);
                failed++;
            }
        }

        // Clear local queue after deletion
        this._clearAll();

        if (failed === 0) {
            this.uiManager?.showToast?.(`🗑️ Deleted ${deleted} items from gallery`, 'success');
        } else {
            this.uiManager?.showToast?.(`🗑️ Deleted ${deleted}, failed ${failed}`, 'warning');
        }
        window.Logger.info('Queue', `Gallery deletion complete: ${deleted} deleted, ${failed} failed`);
    }

    /**
     * Resolve video data from Unified Video History
     * Fetches entry by imageId and returns latest successful video info
     * @param {string} imageId - The parent image ID
     * @returns {Promise<{videoId: string, videoUrl: string, upscaledUrl: string}|null>}
     */
    async _resolveVideoFromHistory(imageId) {
        if (!imageId) return null;

        const indexedDB = this.indexedDBManager || window.gvpIndexedDB;
        if (!indexedDB?.getUnifiedEntry) {
            window.Logger.warn('Queue', 'IndexedDB getUnifiedEntry not available');
            return null;
        }

        try {
            const entry = await indexedDB.getUnifiedEntry(imageId);
            if (!entry || !Array.isArray(entry.attempts) || entry.attempts.length === 0) {
                window.Logger.debug('Queue', `No attempts found for imageId: ${imageId}`);
                return null;
            }

            // Find latest successful video (with videoUrl)
            const successfulAttempts = entry.attempts
                .filter(a => a.status === 'success' && a.videoUrl)
                .sort((a, b) => {
                    const timeA = new Date(a.finishedAt || a.timestamp || 0).getTime();
                    const timeB = new Date(b.finishedAt || b.timestamp || 0).getTime();
                    return timeB - timeA; // Newest first
                });

            if (successfulAttempts.length === 0) {
                window.Logger.debug('Queue', `No successful videos for imageId: ${imageId}`);
                return null;
            }

            const latestVideo = successfulAttempts[0];
            return {
                videoId: latestVideo.videoId || latestVideo.id,
                videoUrl: latestVideo.videoUrl,
                upscaledUrl: latestVideo.upscaledVideoUrl || null,
                thumbnailUrl: latestVideo.thumbnailUrl || entry.imageThumbnailUrl
            };
        } catch (error) {
            window.Logger.error('Queue', 'Failed to resolve video from history:', error);
            return null;
        }
    }

    /**
     * Upscale all videos in queue
     * Uses JobQueue if available, otherwise directly calls POST /rest/media/video/upscale
     */
    async _upscaleAllItems() {
        // Filter for items that have a video (success status with videoId or imageId)
        const items = Array.from(this.queueItems.values()).filter(
            item => item.status === 'success' && (item.videoId || item.imageId)
        );

        if (items.length === 0) {
            this.uiManager?.showToast?.('No successful videos to upscale', 'info');
            return;
        }

        window.Logger.info('Queue', `Starting upscale of ${items.length} videos`);
        this.uiManager?.showToast?.(`⬆️ Upscaling ${items.length} videos...`, 'info');

        // Try JobQueue first
        const jobQueue = window.gvpJobQueue;
        if (jobQueue) {
            let queued = 0;
            for (const item of items) {
                try {
                    // Resolve actual videoId from UVH
                    let videoId = item.videoId;
                    if (!videoId && item.imageId) {
                        const resolved = await this._resolveVideoFromHistory(item.imageId);
                        videoId = resolved?.videoId;
                    }

                    if (videoId) {
                        await jobQueue.addJob({
                            type: 'upscale',
                            videoId: videoId,
                            imageId: item.imageId
                        });
                        queued++;
                    } else {
                        window.Logger.warn('Queue', `No videoId for upscale: ${item.imageId}`);
                    }
                } catch (error) {
                    window.Logger.warn('Queue', 'Failed to queue upscale:', error);
                }
            }
            this.uiManager?.showToast?.(`⬆️ Queued ${queued} videos for upscale`, 'success');
            return;
        }

        // Fallback: Direct API calls with rate limiting
        window.Logger.info('Queue', 'JobQueue unavailable, using direct API');
        let upscaled = 0;
        let failed = 0;

        for (const item of items) {
            try {
                // Resolve actual videoId from UVH
                let videoId = item.videoId;
                if (!videoId && item.imageId) {
                    const resolved = await this._resolveVideoFromHistory(item.imageId);
                    videoId = resolved?.videoId;
                }

                if (!videoId) {
                    window.Logger.warn('Queue', `No videoId found for: ${item.imageId}`);
                    failed++;
                    continue;
                }

                const response = await fetch('/rest/media/video/upscale', {
                    method: 'POST',
                    headers: {
                        'accept': '*/*',
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({ videoId }),
                    credentials: 'include'
                });

                if (response.ok) {
                    upscaled++;
                    window.Logger.debug('Queue', `Upscale started: ${videoId}`);
                } else {
                    const errorText = await response.text();
                    window.Logger.warn('Queue', `Upscale failed for ${videoId}: ${response.status} ${errorText}`);
                    failed++;
                }

                // Rate limit: 1-2s between upscale requests (randomized)
                const delay = 1000 + Math.random() * 1000;
                await new Promise(r => setTimeout(r, delay));

            } catch (error) {
                window.Logger.error('Queue', 'Upscale error:', error);
                failed++;
            }
        }

        if (failed === 0) {
            this.uiManager?.showToast?.(`⬆️ Upscaled ${upscaled} videos`, 'success');
        } else {
            this.uiManager?.showToast?.(`⬆️ Upscaled ${upscaled}, failed ${failed}`, 'warning');
        }
        window.Logger.info('Queue', `Upscale complete: ${upscaled} done, ${failed} failed`);
    }

    /**
     * Download all videos in queue
     * Tries multiple URL patterns and uses blob download for reliability
     */
    async _downloadAllItems() {
        const items = Array.from(this.queueItems.values()).filter(
            item => item.status === 'success'
        );

        if (items.length === 0) {
            this.uiManager?.showToast?.('No successful videos to download', 'info');
            return;
        }

        window.Logger.info('Queue', `Starting download of ${items.length} videos`);
        this.uiManager?.showToast?.(`⬇️ Downloading ${items.length} videos...`, 'info');

        const indexedDB = this.indexedDBManager || window.gvpIndexedDB;
        const state = this.stateManager?.getState?.();
        const userId = state?.multiGenHistory?.activeAccountId;

        let downloaded = 0;
        let failed = 0;

        for (const item of items) {
            try {
                const contentId = item.imageId || item.videoId || item.id;
                let videoUrl = null;
                let videoId = null;

                // Strategy 1: Resolve from Unified Video History (primary source)
                const resolved = await this._resolveVideoFromHistory(contentId);
                if (resolved) {
                    videoUrl = resolved.upscaledUrl || resolved.videoUrl;
                    videoId = resolved.videoId;
                }

                // Strategy 2: Construct URL from item thumbnail (if it's a video URL)
                if (!videoUrl && item.thumbnailUrl?.includes('/generated/')) {
                    // Extract path and modify for video
                    const match = item.thumbnailUrl.match(/(users\/[^/]+\/generated\/[^/]+)/);
                    if (match) {
                        videoUrl = `https://assets.grok.com/${match[1]}/generated_video.mp4`;
                    }
                }

                // Strategy 3: Construct from known pattern
                if (!videoUrl && userId && contentId) {
                    videoUrl = `https://assets.grok.com/users/${userId}/generated/${contentId}/generated_video.mp4`;
                }

                if (!videoUrl) {
                    window.Logger.warn('Queue', `No video URL for: ${contentId}`);
                    failed++;
                    continue;
                }

                // Try direct link download first
                const filename = `grok_video_${contentId}.mp4`;

                try {
                    // Try blob download for better reliability
                    const response = await fetch(videoUrl, { credentials: 'include' });
                    if (response.ok) {
                        const blob = await response.blob();
                        const blobUrl = URL.createObjectURL(blob);

                        const link = document.createElement('a');
                        link.href = blobUrl;
                        link.download = filename;
                        link.style.display = 'none';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);

                        // Clean up blob URL after a delay
                        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);

                        downloaded++;
                        window.Logger.debug('Queue', `Downloaded: ${filename}`);
                    } else {
                        throw new Error(`HTTP ${response.status}`);
                    }
                } catch (fetchError) {
                    // Fallback: Direct link (may open in new tab)
                    window.Logger.debug('Queue', `Blob download failed, using direct link: ${fetchError.message}`);

                    const link = document.createElement('a');
                    link.href = videoUrl;
                    link.download = filename;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.style.display = 'none';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);

                    downloaded++;
                }

                // Rate limit: 500ms between downloads
                await new Promise(r => setTimeout(r, 500));

            } catch (error) {
                window.Logger.error('Queue', 'Download error:', error);
                failed++;
            }
        }

        if (failed === 0) {
            this.uiManager?.showToast?.(`⬇️ Downloaded ${downloaded} videos`, 'success');
        } else {
            this.uiManager?.showToast?.(`⬇️ Downloaded ${downloaded}, failed ${failed}`, 'warning');
        }
        window.Logger.info('Queue', `Download complete: ${downloaded} done, ${failed} failed`);
    }


    /**
     * Show settings popup with export/import and config options
     */
    _showSettingsPopup() {
        const existing = this.shadowRoot?.querySelector('.gvp-queue-settings-popup') || this.container?.querySelector('.gvp-queue-settings-popup');
        if (existing) existing.remove();

        const popup = document.createElement('div');
        popup.className = 'gvp-queue-settings-popup';
        popup.style.cssText = `
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px;
            min-width: 260px; z-index: 1000; box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        `;

        const engine = this._getQueueEngine();

        popup.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <span style="font-size: 13px; font-weight: 600; color: #fff;">⚙️ Queue Settings</span>
                <button class="gvp-settings-close" style="background: none; border: none; color: #888; font-size: 16px; cursor: pointer;">×</button>
            </div>
            
            <div style="margin-bottom: 12px; padding: 10px; background: #0d0d0d; border-radius: 6px; border: 1px solid #333;">
                <label style="font-size: 11px; color: #888; display: block; margin-bottom: 6px;">📝 Prompt Mode:</label>
                <select class="gvp-prompt-mode-select" style="width: 100%; padding: 6px 8px; background: #1a1a1a; border: 1px solid #444; border-radius: 4px; color: #fff; font-size: 12px; margin-bottom: 8px;">
                    <option value="raw">📝 Use Raw Text Prompt</option>
                    <option value="json">📋 Use JSON Prompt</option>
                    <option value="sequential">📦 Sequential (from pack)</option>
                    <option value="random">🎲 Random (from pack)</option>
                </select>
                <button class="gvp-button gvp-load-pack-btn" style="width: 100%; padding: 6px; background: linear-gradient(135deg, #2a4a7c, #1a3a5c); border: 1px solid #3a5a8c; color: #fff; cursor: pointer; border-radius: 4px; font-size: 11px;">📦 Load Prompt Pack (.json)</button>
                <div class="gvp-pack-status" style="font-size: 10px; color: #666; margin-top: 6px; text-align: center;">No pack loaded</div>
            </div>

            <div style="margin-bottom: 12px; padding: 10px; background: #1e1e1e; border-radius: 6px; border: 1px solid #3a3a3a;">
                <label style="font-size: 11px; color: #ccc; display: block; margin-bottom: 8px; font-weight: 600;">🔄 Automation & Looping</label>
                
                <div class="gvp-loop-setting" style="margin-bottom: 8px;">
                    <label style="font-size: 12px; color: #eee; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="radio" name="gvp-loop-mode" value="moderated" ${engine?.moderatedRetryMode ? 'checked' : ''}>
                        🔁 Moderated Retry Mode
                    </label>
                    <div style="font-size: 10px; color: #888; margin-left: 20px; margin-top: 2px;">Only retry moderated items in next cycle</div>
                </div>

                <div class="gvp-loop-setting" style="margin-bottom: 8px;">
                    <label style="font-size: 12px; color: #eee; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="radio" name="gvp-loop-mode" value="full" ${engine?.fullRepeatMode ? 'checked' : ''}>
                        🔄 Full Repeat Mode
                    </label>
                    <div style="font-size: 10px; color: #888; margin-left: 20px; margin-top: 2px;">Repeat entire queue until stopped</div>
                </div>

                <div class="gvp-loop-setting" style="margin-bottom: 8px;">
                    <label style="font-size: 12px; color: #eee; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="radio" name="gvp-loop-mode" value="off" ${!engine?.moderatedRetryMode && !engine?.fullRepeatMode ? 'checked' : ''}>
                        🚫 No Loop (Run Once)
                    </label>
                </div>

                <div style="margin-top: 10px; border-top: 1px solid #333; padding-top: 8px;">
                    <label style="font-size: 11px; color: #aaa; display: flex; justify-content: space-between; align-items: center;">
                        <span>Max Cycles (0 = unlimited):</span>
                        <input type="number" class="gvp-cycle-limit" value="${engine?.maxCycles || 0}" min="0" max="1000" style="width: 50px; background: #0d0d0d; border: 1px solid #333; color: #fff; padding: 2px 4px; border-radius: 4px;">
                    </label>
                </div>
            </div>

            <div style="margin-bottom: 12px;">
                <label style="font-size: 11px; color: #888; display: block; margin-bottom: 4px;">Limit Load Count:</label>
                <input type="number" class="gvp-load-count-input" value="${this.recentLoadCount}" min="5" max="100" style="width: 100%; padding: 4px 8px; background: #0d0d0d; border: 1px solid #333; border-radius: 4px; color: #fff; font-size: 12px;">
            </div>
            
            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                <button class="gvp-button gvp-export-btn" style="flex: 1; padding: 6px; background: #1a1a1a; border: 1px solid #333; color: #fff; cursor: pointer; border-radius: 4px; font-size: 11px;">📤 Export</button>
                <button class="gvp-button gvp-import-btn" style="flex: 1; padding: 6px; background: #1a1a1a; border: 1px solid #333; color: #fff; cursor: pointer; border-radius: 4px; font-size: 11px;">📥 Import</button>
            </div>
        `;

        // Event Listeners (Close, Load Count, Export, Import same as before)
        popup.querySelector('.gvp-settings-close').addEventListener('click', () => popup.remove());
        popup.querySelector('.gvp-load-count-input').addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            if (val >= 5 && val <= 100) {
                this.recentLoadCount = val;
                this._saveSettings();
            }
        });
        popup.querySelector('.gvp-export-btn').addEventListener('click', () => { this._exportQueue(); popup.remove(); });
        popup.querySelector('.gvp-import-btn').addEventListener('click', () => { this._importQueue(); popup.remove(); });

        // Click outside
        const overlay = document.createElement('div');
        overlay.style.cssText = `position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.4); z-index: 999;`;
        overlay.addEventListener('click', () => { overlay.remove(); popup.remove(); });
        this.container.appendChild(overlay);
        this.container.appendChild(popup);

        // Prompt Mode
        const modeSelect = popup.querySelector('.gvp-prompt-mode-select');
        const packStatus = popup.querySelector('.gvp-pack-status');
        if (engine?.promptMode) modeSelect.value = engine.promptMode;
        if (engine?.promptPack?.packName) {
            packStatus.textContent = `✅ ${engine.promptPack.packName} (${engine.promptPack.prompts?.length || 0} prompts)`;
            packStatus.style.color = '#4ade80';
        }
        modeSelect.addEventListener('change', (e) => {
            if (engine) engine.setPromptMode(e.target.value);
        });

        // Loop Modes (Radio)
        popup.querySelectorAll('input[name="gvp-loop-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (!engine) return;
                const mode = e.target.value;
                if (mode === 'moderated') {
                    engine.setLoopMode('moderated');
                    window.Logger.info('Queue', 'Loop Mode: Moderated Retry');
                } else if (mode === 'full') {
                    engine.setLoopMode('full');
                    window.Logger.info('Queue', 'Loop Mode: Full Repeat');
                } else {
                    engine.setLoopMode('off');
                    window.Logger.info('Queue', 'Loop Mode: OFF');
                }
            });
        });

        // Cycle Limit
        popup.querySelector('.gvp-cycle-limit').addEventListener('change', (e) => {
            if (engine) {
                const val = parseInt(e.target.value) || 0;
                engine.maxCycles = val;
                window.Logger.info('Queue', 'Max cycles set to:', val);
            }
        });

        // Load Pack
        popup.querySelector('.gvp-load-pack-btn').addEventListener('click', () => {
            this._loadPromptPack(packStatus);
        });
    }


    /**
     * Handle queue status changes (from VideoQueueManager)
     */
    _handleQueueStatus(event) {
        const { status } = event.detail || {};
        window.Logger.debug('Queue', 'Status event:', status);

        if (status === 'stopped' || status === 'complete') {
            this._updatePlayButton(false, false);
        } else if (status === 'running') {
            this._updatePlayButton(true, false);
        } else if (status === 'paused') {
            this._updatePlayButton(false, true);
        }
    }

    /**
     * Handle generation progress event from gvp:vidgen-beacon
     * Queue items are keyed by imageId. Event provides parentPostId which equals imageId.
     * @param {CustomEvent} event
     */
    _handleRailProgress(event) {
        const { videoId, imageId, parentPostId, progress, moderated, thumbnailUrl } = event.detail || {};

        if (!videoId) return;

        // Queue items are keyed by imageId. The NDJSON stream provides parentPostId = imageId.
        // Lookup priority: parentPostId (most reliable) > imageId > videoId
        const lookupKey = parentPostId || imageId;
        let item = lookupKey ? this.queueItems.get(lookupKey) : null;

        // Fallback: try videoId if no match by imageId
        if (!item) {
            item = this.queueItems.get(videoId);
        }

        // Skip if no matching queue item - this event isn't for a queued item
        if (!item) {
            return; // Not in queue, ignore
        }

        // Link videoId to item for future reference
        if (!item.videoId || item.videoId === lookupKey) {
            item.videoId = videoId;
            window.Logger.debug('Queue', '🔗 Linked videoId to queue item:', { videoId, key: lookupKey });
        }

        // Update thumbnail if provided
        if (thumbnailUrl && !item.thumbnailUrl) {
            item.thumbnailUrl = thumbnailUrl;
        }

        // Update status based on terminal states
        const wasTriggered = item.status === 'triggered';
        if (moderated === true) {
            item.status = 'moderated';
            item.completedAt = Date.now();
            window.Logger.info('Queue', '❌ Item moderated:', lookupKey);
        } else if (progress >= 100) {
            item.status = 'success';
            item.completedAt = Date.now();
            window.Logger.info('Queue', '✅ Item success:', lookupKey);
        } else if (item.status === 'pending' || item.status === 'triggered') {
            // In-progress: switch to generating (removes yellow)
            item.status = 'generating';
        }
        item.progress = progress || 0;

        // ONLY re-render on terminal state (optimization from Rail)
        const isTerminal = item.status === 'success' || item.status === 'moderated';
        if (isTerminal || wasTriggered) {
            this._renderGrid();
            this._updateStats();
        }
    }

    /**
     * Handle terminal state from UIProgressAPI (gvp:progress-update)
     * This ONLY fires when progress >= 100 or moderated = true
     * Single source of truth for terminal states
     * @param {CustomEvent} event
     */
    _handleTerminalState(event) {
        const { key: videoId, progress, context } = event.detail || {};
        const imageId = context?.imageId;

        if (!videoId || !imageId) return;

        // Lookup by imageId (queue key)
        const item = this.queueItems.get(imageId);
        if (!item) return; // Not in queue

        // Link videoId
        item.videoId = videoId;

        // Determine terminal status
        // progress >= 100 = success, otherwise if this event fired it must be moderated
        if (progress >= 100) {
            item.status = 'success';
            item.completedAt = Date.now();
            window.Logger.info('Queue', '✅ Terminal: success for', imageId);
        } else {
            // If UIProgressAPI emitted this at < 100, it's moderated
            item.status = 'moderated';
            item.completedAt = Date.now();
            window.Logger.info('Queue', '❌ Terminal: moderated for', imageId);
        }

        item.progress = progress || 0;
        this._renderGrid();
        this._updateStats();
    }

    _renderEmptyState() {
        this.gridContainer.innerHTML = `
            <div style="
                grid-column: 1 / -1;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 32px;
                color: var(--gvp-text-muted);
                text-align: center;
            ">
                <div style="font-size: 32px; margin-bottom: 8px;">📋</div>
                <div style="font-size: 12px;">Queue is empty</div>
                <div style="font-size: 10px; opacity: 0.7; margin-top: 4px;">Generate videos to populate</div>
            </div>
        `;
    }

    /**
     * Add an item to the queue (e.g. from gallery click or manual add)
     * @param {Object} item - { id, imageId, thumbnailUrl, status }
     */
    addToQueue(item) {
        if (!item || !item.id) {
            window.Logger.warn('Queue', 'Cannot add invalid item to queue:', item);
            return;
        }

        if (this.queueItems.has(item.id)) {
            window.Logger.debug('Queue', 'Item already in queue:', item.id);
            return;
        }

        // Add the main item to map
        this._addSingleItem(item);

        // v1.23.18: If includeEditsMode is ON, also add edited versions
        window.Logger.debug('Queue', '🖼️ includeEditsMode check:', { mode: this.includeEditsMode, itemId: item.id });
        if (this.includeEditsMode) {
            this._addEditedVersions(item.id);
        }

        this._renderGrid();
        this._updateStats();

        // If sorting by newest, scroll to top
        if (this.sortMode === 'newest' && this.gridContainer) {
            this.gridContainer.scrollTop = 0;
        }
    }

    /**
     * v1.23.18: Add a single item to the queue (internal helper)
     * @param {Object} item 
     */
    _addSingleItem(item) {
        if (this.queueItems.has(item.id)) return;

        this.queueItems.set(item.id, {
            id: item.id,
            videoId: item.id,
            imageId: item.imageId || item.id,
            parentImageId: item.parentImageId || null, // v1.23.18: Track parent for edits
            thumbnailUrl: item.thumbnailUrl,
            status: item.status || 'pending',
            progress: 0,
            addedAt: Date.now(),
            isEdit: item.isEdit || false // v1.23.18: Flag for edited images
        });

        // Add to manual order
        this.manualOrder.unshift(item.id);
    }

    /**
     * v1.23.18: Add all edited versions of an image to the queue
     * v1.23.24: Enhanced to fetch post details from Grok API when UVH doesn't have editedImages
     * @param {string} parentImageId - The parent image ID
     */
    async _addEditedVersions(parentImageId) {
        window.Logger.info('Queue', `🖼️ _addEditedVersions called for:`, parentImageId);
        try {
            const idb = this.stateManager?.storageManager?.indexedDBManager || this.indexedDBManager || window.gvpIndexedDB;

            // First try to get from UVH (IndexedDB)
            let editedImages = [];
            if (idb) {
                const entry = await idb.getUnifiedEntry(parentImageId);
                window.Logger.info('Queue', '🖼️ UVH lookup result:', {
                    found: !!entry,
                    hasEdits: !!(entry?.editedImages?.length),
                    editCount: entry?.editedImages?.length || 0
                });

                if (entry?.editedImages?.length > 0) {
                    editedImages = entry.editedImages;
                }
            }

            // v1.23.24: If no edits in UVH, fetch post detail from Grok API directly
            if (editedImages.length === 0) {
                window.Logger.info('Queue', '🔄 Fetching post detail from Grok API for:', parentImageId);
                try {
                    const response = await fetch('/rest/media/post/get', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        body: JSON.stringify({ id: parentImageId })
                    });

                    if (response.ok) {
                        const rawData = await response.json();

                        // v1.23.25: Extract actual post from nested response structure
                        // API returns nested: { result: { data: { post: {...} } } } or similar
                        let post = rawData?.result?.data?.post
                            || rawData?.result?.post
                            || rawData?.data?.post
                            || rawData?.post
                            || rawData;

                        window.Logger.info('Queue', '📦 Post data received:', {
                            id: post?.id,
                            hasChildPosts: Array.isArray(post?.childPosts),
                            childPostsCount: post?.childPosts?.length || 0,
                            originalPostId: post?.originalPostId || null,
                            originalRefType: post?.originalRefType || null,
                            rawKeys: Object.keys(rawData || {})
                        });

                        // v1.23.26: Check if this is an EDITED image (has originalPostId linking to parent)
                        // If so, fetch the PARENT's post to get all sibling edits
                        if (post?.originalPostId && (!Array.isArray(post?.childPosts) || post.childPosts.length === 0)) {
                            window.Logger.info('Queue', '🔍 Detected edited image! Fetching PARENT:', post.originalPostId);

                            try {
                                const parentResponse = await fetch('/rest/media/post/get', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Accept': 'application/json'
                                    },
                                    body: JSON.stringify({ id: post.originalPostId })
                                });

                                if (parentResponse.ok) {
                                    const parentRawData = await parentResponse.json();
                                    const parentPost = parentRawData?.result?.data?.post
                                        || parentRawData?.result?.post
                                        || parentRawData?.data?.post
                                        || parentRawData?.post
                                        || parentRawData;

                                    window.Logger.info('Queue', '📦 PARENT post received:', {
                                        id: parentPost?.id,
                                        hasChildPosts: Array.isArray(parentPost?.childPosts),
                                        childPostsCount: parentPost?.childPosts?.length || 0
                                    });

                                    // Use parent's childPosts instead
                                    if (Array.isArray(parentPost?.childPosts) && parentPost.childPosts.length > 0) {
                                        post = parentPost;
                                    }
                                }
                            } catch (parentFetchError) {
                                window.Logger.warn('Queue', '⚠️ Failed to fetch parent post:', parentFetchError);
                            }
                        }

                        // Extract edited images from childPosts
                        if (Array.isArray(post?.childPosts)) {
                            editedImages = post.childPosts
                                .filter(cp => cp.originalRefType === 'ORIGINAL_REF_TYPE_IMAGE_EDIT')
                                .map(cp => ({
                                    id: cp.id,
                                    thumbnailUrl: cp.thumbnailImageUrl || (cp.mediaUrl ? cp.mediaUrl.split('?')[0] : null),
                                    prompt: cp.prompt || cp.originalPrompt || '',
                                    createTime: cp.createTime,
                                    modelName: cp.modelName,
                                    resolution: cp.resolution,
                                    rRated: cp.rRated || false
                                }));

                            window.Logger.info('Queue', `🖼️ Found ${editedImages.length} edited images from API`);
                        }
                    } else {
                        window.Logger.warn('Queue', `⚠️ Post fetch failed with status ${response.status}`);
                    }
                } catch (fetchError) {
                    window.Logger.error('Queue', '❌ Failed to fetch post from API:', fetchError);
                }
            }

            if (editedImages.length === 0) {
                window.Logger.info('Queue', '❌ No edits found for:', parentImageId);
                return false;
            }

            let addedCount = 0;
            for (const edit of editedImages) {
                if (!edit.id || this.queueItems.has(edit.id)) continue;

                this._addSingleItem({
                    id: edit.id,
                    imageId: edit.id,
                    parentImageId: parentImageId,
                    thumbnailUrl: edit.thumbnailUrl,
                    status: 'pending',
                    isEdit: true
                });
                addedCount++;
            }

            if (addedCount > 0) {
                window.Logger.info('Queue', `🖼️ Added ${addedCount} edited versions for:`, parentImageId);
                this._renderGrid();
                this._updateStats();
                return true;
            }
            return false;
        } catch (error) {
            window.Logger.error('Queue', 'Failed to add edited versions:', error);
            return false;
        }
    }

    _renderGrid() {
        if (this.queueItems.size === 0) {
            this._renderEmptyState();
            return;
        }

        this.gridContainer.innerHTML = '';

        // Sort based on current mode (or manual order if dragMode enabled)
        const items = Array.from(this.queueItems.values());
        let sorted;

        // If dragMode is ON and we have a manual order, use it
        if (this.dragMode && this.manualOrder.length > 0) {
            const orderMap = new Map(this.manualOrder.map((id, idx) => [id, idx]));
            sorted = items.sort((a, b) => {
                const ia = orderMap.get(a.videoId) ?? 9999;
                const ib = orderMap.get(b.videoId) ?? 9999;
                return ia - ib;
            });
        } else {
            switch (this.sortMode) {
                case 'oldest':
                    sorted = items.sort((a, b) => a.addedAt - b.addedAt);
                    break;
                case 'status':
                    // Order: generating (first), pending, success, moderated
                    const statusOrder = { generating: 0, pending: 1, success: 2, moderated: 3 };
                    sorted = items.sort((a, b) => {
                        const oa = statusOrder[a.status] ?? 9;
                        const ob = statusOrder[b.status] ?? 9;
                        return oa - ob || b.addedAt - a.addedAt;
                    });
                    break;
                case 'newest':
                default:
                    sorted = items.sort((a, b) => b.addedAt - a.addedAt);
            }
        }

        sorted.forEach(item => {
            const tile = this._createGridTile(item);
            this.gridContainer.appendChild(tile);
        });
    }

    _createGridTile(item) {
        const tile = document.createElement('div');
        tile.className = 'gvp-queue-tile';
        tile.dataset.videoId = item.videoId;
        tile.draggable = this.dragMode;
        // Use thinner border for 'success' (existing videos) vs thicker for active states
        const borderWidth = item.status === 'success' ? '2px' : '3px';
        tile.style.cssText = `
            width: 72px;
            height: 72px;
            border-radius: 6px;
            border: ${borderWidth} solid ${this._getStatusBorderColor(item.status)};
            overflow: hidden;
            cursor: ${this.dragMode ? 'move' : 'pointer'};
            transition: transform 0.15s ease, border-color 0.3s ease;
            background: #1a1a1a;
            position: relative;
        `;

        // Drag-and-drop when dragMode ON
        if (this.dragMode) {
            tile.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', item.videoId);
                tile.style.opacity = '0.5';
            });
            tile.addEventListener('dragend', () => {
                tile.style.opacity = '1';
            });
            tile.addEventListener('dragover', (e) => {
                e.preventDefault();
                tile.style.boxShadow = '0 0 8px #fff';
            });
            tile.addEventListener('dragleave', () => {
                tile.style.boxShadow = 'none';
            });
            tile.addEventListener('drop', (e) => {
                e.preventDefault();
                tile.style.boxShadow = 'none';
                const draggedId = e.dataTransfer.getData('text/plain');
                this._handleDrop(draggedId, item.videoId);
            });
        }

        // Hover effect (only when not dragging)
        tile.addEventListener('mouseenter', () => {
            if (!this.dragMode) tile.style.transform = 'scale(1.08)';
        });
        tile.addEventListener('mouseleave', () => {
            tile.style.transform = 'scale(1)';
        });

        // Click to navigate (only when dragMode OFF)
        tile.addEventListener('click', (e) => {
            // Ignore if clicking remove button
            if (e.target.classList.contains('gvp-queue-remove')) return;
            if (!this.dragMode) {
                this._navigateToPost(item.parentPostId || item.imageId || item.videoId);
            }
        });

        // Thumbnail image
        if (item.thumbnailUrl) {
            const img = document.createElement('img');
            img.src = item.thumbnailUrl;
            img.style.cssText = `
                width: 100%;
                height: 100%;
                object-fit: cover;
                pointer-events: none;
            `;
            img.onerror = () => {
                img.remove();
                tile.style.background = 'var(--gvp-bg-tertiary)';
            };
            tile.appendChild(img);
        } else {
            // Placeholder with spinner for generating items
            const placeholder = document.createElement('div');
            placeholder.style.cssText = `
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 20px;
                color: var(--gvp-text-muted);
            `;
            placeholder.textContent = item.status === 'generating' ? '⏳' : '📷';
            tile.appendChild(placeholder);
        }

        // Status overlay icon (small badge in corner)
        const statusBadge = document.createElement('div');
        statusBadge.style.cssText = `
            position: absolute;
            top: 2px;
            left: 2px;
            font-size: 12px;
            text-shadow: 0 1px 2px rgba(0,0,0,0.8);
        `;
        statusBadge.textContent = this._getStatusEmoji(item.status);
        tile.appendChild(statusBadge);

        // Remove button (X in top-right corner)
        const removeBtn = document.createElement('button');
        removeBtn.className = 'gvp-queue-remove';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove from queue';
        removeBtn.style.cssText = `
            position: absolute;
            top: 0;
            right: 0;
            width: 18px;
            height: 18px;
            background: rgba(0,0,0,0.6);
            color: #fff;
            border: none;
            border-radius: 0 4px 0 4px;
            font-size: 14px;
            cursor: pointer;
            opacity: 0;
            transition: opacity 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
        `;
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.queueItems.delete(item.videoId);
            this._renderGrid();
            this._updateStats();
        });
        tile.addEventListener('mouseenter', () => { removeBtn.style.opacity = '1'; });
        tile.addEventListener('mouseleave', () => { removeBtn.style.opacity = '0'; });
        tile.appendChild(removeBtn);

        return tile;
    }

    /**
     * Handle drag-and-drop reordering
     */
    _handleDrop(draggedId, targetId) {
        if (draggedId === targetId) return;

        // Build current order from items
        const items = Array.from(this.queueItems.values());
        let order = items.map(i => i.videoId);

        // Find indices
        const fromIdx = order.indexOf(draggedId);
        const toIdx = order.indexOf(targetId);

        if (fromIdx === -1 || toIdx === -1) return;

        // Remove dragged item and insert at target position
        order.splice(fromIdx, 1);
        order.splice(toIdx, 0, draggedId);

        this.manualOrder = order;
        this._renderGrid();

        window.Logger.debug('Queue', 'Manual order updated:', order.length, 'items');
    }

    _getStatusBorderColor(status) {
        switch (status) {
            case 'success': return '#888888';        // Subtle grey - has videos (ready for download/upscale)
            case 'moderated': return '#dc2626';      // Deep red - blocked
            case 'triggered': return '#facc15';      // Yellow - API sent, waiting for result
            case 'generating': return '#48494b';     // Grey - actively generating
            case 'pending':
            default: return 'transparent';           // No border - fresh, never processed
        }
    }

    _getStatusEmoji(status) {
        switch (status) {
            case 'success': return '✅';
            case 'moderated': return '❌';
            case 'triggered': return '🚀';
            case 'generating': return '⏳';
            case 'pending':
            default: return '';
        }
    }

    _updateStats() {
        if (!this.statsBar) return;

        const items = Array.from(this.queueItems.values());
        const success = items.filter(i => i.status === 'success').length;
        const moderated = items.filter(i => i.status === 'moderated').length;
        const triggered = items.filter(i => i.status === 'triggered').length;
        const pending = items.filter(i => i.status === 'pending').length;

        // Compact format: green success | red moderated | yellow triggered | gray pending
        this.statsBar.innerHTML = `
            <span style="color: #4ade80; font-weight: 600;">${success}</span>
            <span style="color: #444;">|</span>
            <span style="color: #f87171; font-weight: 600;">${moderated}</span>
            <span style="color: #444;">|</span>
            <span style="color: #facc15; font-weight: 600;">${triggered}</span>
            <span style="color: #444;">|</span>
            <span style="color: #888;">${pending}</span>
        `;
    }

    _navigateToPost(postId) {
        if (!postId) return;

        const targetUrl = `/imagine/post/${postId}`;
        window.Logger.info('Queue', 'Navigating to:', targetUrl);

        // SPA navigation
        window.history.pushState({}, '', targetUrl);
        window.dispatchEvent(new PopStateEvent('popstate'));
    }

    async _loadRecentImages() {
        window.Logger.info('Queue', 'Loading recent images...');

        try {
            // Access IndexedDBManager - prefer global window.gvpIndexedDB (set by content.js)
            const idbManager = window.gvpIndexedDB ||
                this.indexedDBManager ||
                this.uiManager?.indexedDBManager;

            if (!idbManager) {
                window.Logger.error('Queue', 'IndexedDBManager not found (window.gvpIndexedDB is undefined)');
                this.uiManager?.showToast?.('IndexedDB not available', 'error');
                return;
            }

            // Get account ID
            const accountId = this.stateManager?.getActiveMultiGenAccount?.() ||
                this.stateManager?.state?.multiGenHistory?.activeAccountId;

            if (!accountId) {
                window.Logger.warn('Queue', 'No account ID detected');
                this.uiManager?.showToast?.('No account detected', 'error');
                return;
            }

            window.Logger.debug('Queue', 'Loading for account:', accountId);

            // Use getAllUnifiedEntries(accountId, limit) - the correct method per IndexedDBManager.js
            if (typeof idbManager.getAllUnifiedEntries !== 'function') {
                window.Logger.error('Queue', 'getAllUnifiedEntries method not found on IndexedDBManager');
                this.uiManager?.showToast?.('IndexedDB method not available', 'error');
                return;
            }

            // Load entries for this account
            const entries = await idbManager.getAllUnifiedEntries(accountId, this.recentLoadCount);

            if (!entries || entries.length === 0) {
                this.uiManager?.showToast?.('No images in history', 'info');
                return;
            }

            // Sort by createdAt descending and take first N
            const sorted = entries
                .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
                .slice(0, this.recentLoadCount);

            // Add to queue as pending items
            let added = 0;
            sorted.forEach(entry => {
                // IMPORTANT: Use imageId first (the correct primary key), fall back to id
                // Filter out entries where the ID equals the accountId (contaminated data)
                const imageId = entry.imageId || entry.id;

                // Skip if ID is missing or equals the accountId (invalid entry)
                if (!imageId || imageId === accountId) {
                    window.Logger.debug('Queue', 'Skipping invalid entry (missing imageId or matches accountId):', imageId);
                    return;
                }

                if (!this.queueItems.has(imageId)) {
                    this.queueItems.set(imageId, {
                        id: imageId,
                        videoId: imageId,
                        imageId: imageId,
                        parentPostId: entry.parentPostId || imageId,
                        thumbnailUrl: entry.thumbnailUrl || entry.mediaUrl,
                        status: 'pending',
                        progress: 0,
                        addedAt: new Date(entry.createdAt || entry.addedAt || Date.now()).getTime(),
                        completedAt: null
                    });
                    added++;
                }
            });

            this._renderGrid();
            this._updateStats();

            if (added > 0) {
                this.uiManager?.showToast?.(`📥 Added ${added} images`, 'success');
            } else {
                this.uiManager?.showToast?.('All images already in queue', 'info');
            }

        } catch (error) {
            window.Logger.error('Queue', 'Failed to load recent images:', error);
            this.uiManager?.showToast?.('Failed to load: ' + error.message, 'error');
        }
    }

    /**
     * Show settings popup with export/import and config options
     */
    _showSettingsPopup() {
        // Remove existing popup if any
        const existing = this.shadowRoot?.querySelector('.gvp-queue-settings-popup') ||
            this.container?.querySelector('.gvp-queue-settings-popup');
        if (existing) existing.remove();

        const engine = this._getQueueEngine();

        const popup = document.createElement('div');
        popup.className = 'gvp-queue-settings-popup';
        popup.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #1a1a1a;
            border: 1px solid #333;
            border-radius: 8px;
            padding: 16px;
            min-width: 240px;
            z-index: 1000;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        `;

        const currentPromptMode = engine?.promptMode || 'json';
        const currentLoopMode = engine?.loopMode || 'off'; // 'off' | 'moderated' | 'full'

        popup.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <span style="font-size: 13px; font-weight: 600; color: #fff;">⚙️ Queue Settings</span>
                <button class="gvp-settings-close" style="background: none; border: none; color: #888; font-size: 16px; cursor: pointer;">×</button>
            </div>
            
            <div style="margin-bottom: 12px;">
                <label style="font-size: 11px; color: #888; display: block; margin-bottom: 4px;">Recent images to load:</label>
                <input type="number" class="gvp-load-count-input" value="${this.recentLoadCount}" min="5" max="100" 
                    style="width: 100%; padding: 4px 8px; background: #0d0d0d; border: 1px solid #333; border-radius: 4px; color: #fff; font-size: 12px;">
            </div>

            <div style="margin-bottom: 12px;">
                <label style="font-size: 11px; color: #888; display: block; margin-bottom: 4px;">⏱️ Delay between items (ms):</label>
                <input type="number" class="gvp-delay-input" value="${engine?.delayBetweenItems || 3000}" min="500" max="60000" step="500"
                    style="width: 100%; padding: 4px 8px; background: #0d0d0d; border: 1px solid #333; border-radius: 4px; color: #fff; font-size: 12px;">
            </div>

            <div style="margin-bottom: 12px;">
                <label style="font-size: 11px; color: #888; display: block; margin-bottom: 4px;">🔒 Cooldown per image (ms):</label>
                <input type="number" class="gvp-cooldown-input" value="${engine?.cooldownDelay || 1000}" min="100" max="10000" step="100"
                    style="width: 100%; padding: 4px 8px; background: #0d0d0d; border: 1px solid #333; border-radius: 4px; color: #fff; font-size: 12px;">
                <div style="font-size: 9px; color: #555; margin-top: 2px;">Prevents duplicate requests</div>
            </div>

            <div style="margin-bottom: 12px; padding: 10px; background: #0d0d0d; border-radius: 6px; border: 1px solid #333;">
                <label style="font-size: 11px; color: #888; display: block; margin-bottom: 6px;">📝 Prompt Mode:</label>
                <select class="gvp-prompt-mode-select" style="width: 100%; padding: 6px 8px; background: #1a1a1a; border: 1px solid #444; border-radius: 4px; color: #fff; font-size: 12px; margin-bottom: 8px;">
                    <option value="raw" ${currentPromptMode === 'raw' ? 'selected' : ''}>📝 Use Raw Text Prompt</option>
                    <option value="json" ${currentPromptMode === 'json' ? 'selected' : ''}>📋 Use JSON Prompt</option>
                    <option value="sequential" ${currentPromptMode === 'sequential' ? 'selected' : ''}>📦 Sequential (pack)</option>
                    <option value="random" ${currentPromptMode === 'random' ? 'selected' : ''}>🎲 Random (pack)</option>
                </select>
                <button class="gvp-button gvp-load-pack-btn" style="width: 100%; padding: 8px; background: linear-gradient(135deg, #2a4a7c, #1a3a5c); border: 1px solid #3a5a8c; color: #fff; cursor: pointer; border-radius: 4px; font-weight: 500;">📦 Load Prompt Pack (.json)</button>
                <div class="gvp-pack-status" style="font-size: 10px; color: #666; margin-top: 6px; text-align: center;">No pack loaded</div>
            </div>

            <!-- Automation Section -->
            <div style="margin-bottom: 12px; padding: 10px; background: #151515; border-radius: 6px; border: 1px solid #333;">
                <label style="font-size: 11px; color: #ccc; display: block; margin-bottom: 8px; font-weight: 600;">🔄 Automation & Looping</label>
                
                <div class="gvp-loop-setting" style="margin-bottom: 8px;">
                    <label style="font-size: 12px; color: #eee; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="radio" name="gvp-loop-mode" value="moderated" ${currentLoopMode === 'moderated' ? 'checked' : ''}>
                        🔁 Moderated Retry Mode
                    </label>
                    <div style="font-size: 10px; color: #888; margin-left: 20px; margin-top: 2px;">Only retry moderated items in next cycle</div>
                </div>

                <div class="gvp-loop-setting" style="margin-bottom: 8px;">
                    <label style="font-size: 12px; color: #eee; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="radio" name="gvp-loop-mode" value="full" ${currentLoopMode === 'full' ? 'checked' : ''}>
                        🔄 Full Repeat Mode
                    </label>
                    <div style="font-size: 10px; color: #888; margin-left: 20px; margin-top: 2px;">Repeat entire queue until stopped</div>
                </div>

                <div class="gvp-loop-setting" style="margin-bottom: 8px;">
                    <label style="font-size: 12px; color: #eee; display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="radio" name="gvp-loop-mode" value="off" ${currentLoopMode === 'off' ? 'checked' : ''}>
                        🚫 No Loop (Run Once)
                    </label>
                </div>

                <div style="margin-top: 10px; border-top: 1px solid #333; padding-top: 8px;">
                    <label style="font-size: 11px; color: #aaa; display: flex; justify-content: space-between; align-items: center;">
                        <span>Max Cycles (0 = unlimited):</span>
                        <input type="number" class="gvp-cycle-limit" value="${engine?.maxCycles || 0}" min="0" max="1000" style="width: 50px; background: #0d0d0d; border: 1px solid #333; color: #fff; padding: 2px 4px; border-radius: 4px;">
                    </label>
                </div>
            </div>
            
            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                <button class="gvp-button gvp-export-btn" style="flex: 1; padding: 8px; background: #1a1a1a; border: 1px solid #333; color: #fff; cursor: pointer; border-radius: 4px;">📤 Export Queue</button>
                <button class="gvp-button gvp-import-btn" style="flex: 1; padding: 8px; background: #1a1a1a; border: 1px solid #333; color: #fff; cursor: pointer; border-radius: 4px;">📥 Import Queue</button>
            </div>
            
            <button class="gvp-button gvp-debug-edits-btn" style="width: 100%; padding: 8px; background: #2a2a2a; border: 1px solid #444; color: #aaa; cursor: pointer; border-radius: 4px; margin-bottom: 8px; font-size: 11px;">🔍 Debug Edit Schema</button>
            
            <div style="font-size: 10px; color: #666; margin-top: 8px;">
                Tip: Toggle ✋ to enable drag reorder
            </div>
        `;

        // Close button
        popup.querySelector('.gvp-settings-close').addEventListener('click', () => popup.remove());

        // Load count input
        popup.querySelector('.gvp-load-count-input').addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            if (val >= 5 && val <= 100) {
                this.recentLoadCount = val;
                window.Logger.info('Queue', 'Load count set to:', val);
            }
        });

        // Export button
        popup.querySelector('.gvp-export-btn').addEventListener('click', () => {
            this._exportQueue();
            popup.remove();
        });

        // Import button
        popup.querySelector('.gvp-import-btn').addEventListener('click', () => {
            this._importQueue();
            popup.remove();
        });

        // Debug Edit Schema button
        popup.querySelector('.gvp-debug-edits-btn').addEventListener('click', async () => {
            window.Logger.info('Queue', '🔍 Debug Edit Schema - Starting...');

            try {
                const idb = this.stateManager?.storageManager?.indexedDBManager || this.indexedDBManager || window.gvpIndexedDB;
                const accountId = this.stateManager?.state?.multiGenHistory?.activeAccountId;

                if (!idb || !accountId) {
                    window.Logger.error('Queue', 'IDB or accountId not available', { idb: !!idb, accountId });
                    this.uiManager?.showToast?.('Debug failed: IDB/account not ready', 'error');
                    return;
                }

                const entries = await idb.getAllUnifiedEntries(accountId, 0);
                const withEdits = entries.filter(e => e.editedImages?.length > 0);
                const withEditAttempts = withEdits.filter(e =>
                    e.editedImages.some(edit => edit.attempts?.length > 0)
                );
                const videosWithSourceEdit = entries.flatMap(e =>
                    (e.attempts || []).filter(a => a.sourceEditId)
                );

                const report = {
                    totalEntries: entries.length,
                    entriesWithEdits: withEdits.length,
                    entriesWithEditAttempts: withEditAttempts.length,
                    videosWithSourceEditId: videosWithSourceEdit.length,
                    sampleWithEdits: withEdits[0] || null,
                    sampleVideoWithSourceEdit: videosWithSourceEdit[0] || null
                };

                console.log('=== 🔍 DEBUG EDIT SCHEMA REPORT ===');
                console.log('Summary:', report);
                if (withEdits[0]) {
                    console.log('Sample entry with edits:', withEdits[0].imageId);
                    console.log('  - editedImages:', withEdits[0].editedImages);
                    console.log('  - attempts:', withEdits[0].attempts?.length, 'videos');
                }
                console.log('=====================================');

                window.Logger.info('Queue', '🔍 Debug complete', report);
                this.uiManager?.showToast?.(`Found ${withEdits.length} with edits, ${videosWithSourceEdit.length} linked videos - see console`, 'info');
            } catch (error) {
                window.Logger.error('Queue', 'Debug failed:', error);
                this.uiManager?.showToast?.('Debug failed: ' + error.message, 'error');
            }
        });

        // Prompt mode selector
        const modeSelect = popup.querySelector('.gvp-prompt-mode-select');
        const packStatus = popup.querySelector('.gvp-pack-status');

        // Update pack status display
        if (engine?.promptPack?.packName) {
            packStatus.textContent = `✅ ${engine.promptPack.packName} (${engine.promptPack.prompts?.length || 0} prompts)`;
            packStatus.style.color = '#4ade80';
        }

        modeSelect.addEventListener('change', (e) => {
            if (engine) {
                engine.setPromptMode(e.target.value);
                window.Logger.info('Queue', 'Prompt mode changed to:', e.target.value);
            }
        });

        // Loop Mode Radio Buttons
        popup.querySelectorAll('input[name="gvp-loop-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const mode = e.target.value;
                if (engine) {
                    if (mode === 'moderated') {
                        engine.setLoopMode('moderated');
                        window.Logger.info('Queue', 'Loop Mode: Moderated Retry');
                    } else if (mode === 'full') {
                        engine.setLoopMode('full');
                        window.Logger.info('Queue', 'Loop Mode: Full Repeat');
                    } else {
                        engine.setLoopMode('off');
                        window.Logger.info('Queue', 'Loop Mode: OFF');
                    }
                }
            });
        });

        // Cycle Limit
        popup.querySelector('.gvp-cycle-limit').addEventListener('change', (e) => {
            if (engine) {
                const val = parseInt(e.target.value) || 0;
                engine.maxCycles = val;
                window.Logger.info('Queue', 'Max cycles set to:', val);
            }
        });

        // Delay between items input
        popup.querySelector('.gvp-delay-input').addEventListener('change', (e) => {
            const value = parseInt(e.target.value, 10);
            if (value >= 500 && value <= 60000 && engine) {
                engine.delayBetweenItems = value;
                window.Logger.info('Queue', 'Delay between items set to:', value, 'ms');
            }
        });

        // Cooldown delay input
        popup.querySelector('.gvp-cooldown-input').addEventListener('change', (e) => {
            const value = parseInt(e.target.value, 10);
            if (value >= 100 && value <= 10000 && engine) {
                engine.cooldownDelay = value;
                window.Logger.info('Queue', 'Cooldown delay set to:', value, 'ms');
            }
        });

        // Load prompt pack button
        popup.querySelector('.gvp-load-pack-btn').addEventListener('click', () => {
            this._loadPromptPack(packStatus);
        });

        // Click outside to close (Overlay)
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.4);
            z-index: 999;
        `;
        overlay.addEventListener('click', () => {
            overlay.remove();
            popup.remove();
        });

        this.container.appendChild(overlay);
        this.container.appendChild(popup);
    }

    _clearCompleted() {
        const before = this.queueItems.size;

        this.queueItems.forEach((item, key) => {
            if (item.status === 'success' || item.status === 'moderated') {
                this.queueItems.delete(key);
            }
        });

        const removed = before - this.queueItems.size;
        this._renderGrid();
        this._updateStats();

        if (removed > 0) {
            this.uiManager?.showToast?.(`🧹 Removed ${removed} items`, 'success');
        }
    }

    /**
     * Clear ALL items from queue
     */
    _clearAll() {
        const count = this.queueItems.size;
        if (count === 0) {
            this.uiManager?.showToast?.('Queue is already empty', 'info');
            return;
        }

        this.queueItems.clear();
        this._renderGrid();
        this._updateStats();
        this.uiManager?.showToast?.(`🗑️ Cleared all ${count} items`, 'success');
    }

    /**
     * Clear items by specific status
     * @param {string} status - 'moderated' or 'success'
     */
    _clearByStatus(status) {
        const before = this.queueItems.size;

        this.queueItems.forEach((item, key) => {
            if (item.status === status) {
                this.queueItems.delete(key);
            }
        });

        const removed = before - this.queueItems.size;
        this._renderGrid();
        this._updateStats();

        const emoji = status === 'moderated' ? '❌' : '✅';
        const label = status === 'moderated' ? 'moderated' : 'successful';

        if (removed > 0) {
            this.uiManager?.showToast?.(`${emoji} Removed ${removed} ${label} items`, 'success');
        } else {
            this.uiManager?.showToast?.(`No ${label} items to clear`, 'info');
        }
    }

    /**
     * Export queue to JSON file
     */
    _exportQueue() {
        const items = this.getQueueItems();

        if (items.length === 0) {
            this.uiManager?.showToast?.('Queue is empty', 'info');
            return;
        }

        // Get current account ID
        const accountId = this.stateManager?.getActiveMultiGenAccount?.() ||
            this.stateManager?.state?.multiGenHistory?.activeAccountId ||
            'unknown';

        const exportData = {
            version: '1.1',
            exportDate: new Date().toISOString(),
            accountId: accountId,  // Account ownership
            sortMode: this.sortMode,
            manualOrder: this.manualOrder,
            items: items.map(item => ({
                id: item.id,
                imageId: item.imageId,
                videoId: item.videoId,
                parentPostId: item.parentPostId,
                thumbnailUrl: item.thumbnailUrl,
                status: item.status,
                addedAt: item.addedAt
            }))
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gvp-queue-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.uiManager?.showToast?.(`📤 Exported ${items.length} items`, 'success');
        window.Logger.info('Queue', 'Exported queue:', items.length, 'items');
    }

    /**
     * Import queue from JSON file
     */
    _importQueue() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            try {
                const text = await file.text();
                const data = JSON.parse(text);

                if (!data.items || !Array.isArray(data.items)) {
                    throw new Error('Invalid queue JSON format');
                }

                // Account ID validation (v1.1+)
                if (data.accountId && data.accountId !== 'unknown') {
                    const currentAccountId = this.stateManager?.getActiveMultiGenAccount?.() ||
                        this.stateManager?.state?.multiGenHistory?.activeAccountId;

                    if (currentAccountId && data.accountId !== currentAccountId) {
                        throw new Error(`Queue belongs to a different account`);
                    }
                }

                let added = 0;
                data.items.forEach(item => {
                    const id = item.id || item.imageId;
                    if (id && !this.queueItems.has(id)) {
                        this.queueItems.set(id, {
                            id: id,
                            videoId: item.videoId || id,
                            imageId: item.imageId || id,
                            parentPostId: item.parentPostId || id,
                            thumbnailUrl: item.thumbnailUrl || null,
                            status: item.status || 'pending',
                            progress: 0,
                            addedAt: item.addedAt || Date.now(),
                            completedAt: null
                        });
                        added++;
                    }
                });

                // Restore manual order if present
                if (data.manualOrder && Array.isArray(data.manualOrder)) {
                    this.manualOrder = data.manualOrder;
                }

                // Restore sort mode if present
                if (data.sortMode && this.sortSelect) {
                    this.sortMode = data.sortMode;
                    this.sortSelect.value = data.sortMode;
                }

                this._renderGrid();
                this._updateStats();

                this.uiManager?.showToast?.(`📥 Imported ${added} items`, 'success');
                window.Logger.info('Queue', 'Imported queue:', added, 'items');

            } catch (error) {
                window.Logger.error('Queue', 'Import failed:', error);
                this.uiManager?.showToast?.('Import failed: ' + error.message, 'error');
            }
        });

        input.click();
    }

    /**
     * Load a prompt pack JSON file
     * @param {HTMLElement} statusEl - Element to update with pack status
     */
    _loadPromptPack(statusEl) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            try {
                const text = await file.text();
                const pack = JSON.parse(text);

                // Validate pack structure
                if (!pack.prompts || !Array.isArray(pack.prompts)) {
                    throw new Error('Invalid prompt pack: missing "prompts" array');
                }

                if (pack.prompts.length === 0) {
                    throw new Error('Prompt pack is empty');
                }

                // Ensure pack has a name
                if (!pack.packName) {
                    pack.packName = file.name.replace('.json', '');
                }

                // Load into queue engine
                const engine = this._getQueueEngine();
                if (engine) {
                    const loaded = engine.loadPromptPack(pack);
                    if (loaded) {
                        // v1.23.12: Persist to Chrome storage
                        this._savePromptPack(pack);

                        // Update status display
                        if (statusEl) {
                            statusEl.textContent = `✅ ${pack.packName} (${pack.prompts.length} prompts)`;
                            statusEl.style.color = '#4ade80';
                        }
                        this.uiManager?.showToast?.(`📦 Loaded ${pack.prompts.length} prompts from ${pack.packName}`, 'success');
                    } else {
                        throw new Error('Engine failed to load pack');
                    }
                } else {
                    throw new Error('Queue engine not available');
                }

            } catch (error) {
                window.Logger.error('Queue', 'Failed to load prompt pack:', error);
                this.uiManager?.showToast?.('Load failed: ' + error.message, 'error');
                if (statusEl) {
                    statusEl.textContent = `❌ ${error.message}`;
                    statusEl.style.color = '#f87171';
                }
            }
        });

        input.click();
    }

    /**
     * v1.23.12: Save prompt pack to Chrome storage for persistence
     * @param {Object} pack - Prompt pack object
     */
    _savePromptPack(pack) {
        if (!pack) return;

        try {
            if (!chrome.runtime?.id) return; // Guard: extension context may be invalidated
            chrome.storage.local.set({
                gvp_queue_prompt_pack: JSON.stringify(pack)
            }, () => {
                window.Logger.info('Queue', '💾 Prompt pack saved:', pack.packName);
            });
        } catch (error) {
            window.Logger.warn('Queue', 'Failed to save prompt pack:', error);
        }
    }

    /**
     * v1.23.12: Restore prompt pack from Chrome storage on init
     */
    async _restorePromptPack() {
        try {
            if (!chrome.runtime?.id) return; // Guard: extension context may be invalidated
            const result = await chrome.storage.local.get('gvp_queue_prompt_pack');
            const packJson = result?.gvp_queue_prompt_pack;

            if (!packJson) {
                window.Logger.debug('Queue', 'No saved prompt pack found');
                return;
            }

            const pack = JSON.parse(packJson);
            if (!pack?.prompts?.length) {
                window.Logger.debug('Queue', 'Saved pack is empty or invalid');
                return;
            }

            // Load into engine
            const engine = this._getQueueEngine();
            if (engine && engine.loadPromptPack(pack)) {
                window.Logger.info('Queue', '📦 Restored prompt pack:', pack.packName, 'with', pack.prompts.length, 'prompts');
            }
        } catch (error) {
            window.Logger.warn('Queue', 'Failed to restore prompt pack:', error);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // QUEUE ENGINE CONTROLS
    // ═══════════════════════════════════════════════════════════════════


    /**
     * Get or create queue engine instance
     */
    _getQueueEngine() {
        if (!this.queueEngine) {
            if (window.VideoQueueManager) {
                this.queueEngine = new window.VideoQueueManager(this.stateManager, this);
                window.Logger.info('Queue', 'VideoQueueManager instantiated');
            } else {
                window.Logger.error('Queue', 'VideoQueueManager class not found');
                return null;
            }
        }
        return this.queueEngine;
    }

    /**
     * Toggle play/pause
     */
    _togglePlayPause() {
        const engine = this._getQueueEngine();
        if (!engine) {
            this.uiManager?.showToast?.('Queue engine not available', 'error');
            return;
        }

        if (engine.isRunning && !engine.isPaused) {
            // Currently running → pause
            engine.pause();
            this._updatePlayButton(false, true);
            this.uiManager?.showToast?.('⏸️ Queue paused', 'info');
        } else if (engine.isRunning && engine.isPaused) {
            // Currently paused → resume
            engine.resume();
            this._updatePlayButton(true, false);
            this.uiManager?.showToast?.('▶️ Queue resumed', 'info');
        } else {
            // Not running → start
            if (this.queueItems.size === 0) {
                this.uiManager?.showToast?.('Queue is empty', 'warning');
                return;
            }
            engine.start();
            this._updatePlayButton(true, false);
            this.uiManager?.showToast?.('▶️ Queue started', 'success');
        }
    }

    /**
     * Stop queue processing
     */
    _stopQueue() {
        const engine = this._getQueueEngine();
        if (!engine) return;

        engine.stop();
        this._updatePlayButton(false, false);
        this.uiManager?.showToast?.('⏹️ Queue stopped', 'info');
    }

    /**
     * Update play button appearance
     */
    _updatePlayButton(isRunning, isPaused) {
        if (!this.playPauseBtn) return;

        if (isRunning && !isPaused) {
            this.playPauseBtn.textContent = '⏸️';
            this.playPauseBtn.title = 'Pause queue processing';
            this.playPauseBtn.style.background = '#2a5a2a'; // Green when running
        } else if (isPaused) {
            this.playPauseBtn.textContent = '▶️';
            this.playPauseBtn.title = 'Resume queue processing';
            this.playPauseBtn.style.background = '#5a5a2a'; // Yellow when paused
        } else {
            this.playPauseBtn.textContent = '▶️';
            this.playPauseBtn.title = 'Start queue processing';
            this.playPauseBtn.style.background = '#1a1a1a';
        }
    }

    /**
     * Add an item to the queue programmatically (for Quick Add mode)
     * v1.23.2: Now async to support IndexedDB lookup for authoritative thumbnails
     * @param {string} imageId - The image ID to queue
     * @param {string} thumbnailUrl - Optional thumbnail URL (fallback)
     * @returns {Promise<boolean>} true if added, false if already exists
     */
    async addItemToQueue(imageId, thumbnailUrl = null) {
        if (!imageId || this.queueItems.has(imageId)) {
            return false;
        }

        // v1.23.2: Use IndexedDB for authoritative thumbnail (async lookup)
        // Priority: thumbnailImageUrl (CDN-optimized) > imageThumbnailUrl > thumbnailUrl > passed value
        let finalThumbnail = thumbnailUrl;
        let hasExistingVideos = false;
        let resolvedVideoId = null;

        try {
            const idb = this.stateManager?.storageManager?.indexedDBManager || window.gvpIndexedDB;
            if (idb?.initialized) {
                const entry = await idb.getUnifiedEntry(imageId);
                if (entry) {
                    // Priority chain for best thumbnail
                    if (entry.thumbnailImageUrl) {
                        finalThumbnail = entry.thumbnailImageUrl;
                        window.Logger.debug('Queue', '🖼️ Using thumbnailImageUrl from IndexedDB:', imageId);
                    } else if (entry.imageThumbnailUrl) {
                        finalThumbnail = entry.imageThumbnailUrl;
                        window.Logger.debug('Queue', '🖼️ Using imageThumbnailUrl from IndexedDB:', imageId);
                    } else if (entry.thumbnailUrl) {
                        finalThumbnail = entry.thumbnailUrl;
                        window.Logger.debug('Queue', '🖼️ Using thumbnailUrl from IndexedDB:', imageId);
                    }

                    // v1.23.15: Check if this image already has successful videos
                    if (Array.isArray(entry.attempts) && entry.attempts.length > 0) {
                        const successfulVideo = entry.attempts.find(a => a.status === 'success' && a.videoUrl);
                        if (successfulVideo) {
                            hasExistingVideos = true;
                            resolvedVideoId = successfulVideo.videoId || successfulVideo.id;
                            window.Logger.debug('Queue', '🎬 Found existing video:', resolvedVideoId);
                        }
                    }
                }
            } else if (this.stateManager?.state?.unifiedHistory) {
                // Fallback: check in-memory history if IDB not available
                const historyEntry = this.stateManager.state.unifiedHistory.find(x => x.imageId === imageId);
                if (historyEntry) {
                    finalThumbnail = historyEntry.thumbnailImageUrl || historyEntry.imageThumbnailUrl || historyEntry.thumbnailUrl || finalThumbnail;

                    // Check for existing videos in memory history
                    if (Array.isArray(historyEntry.attempts) && historyEntry.attempts.length > 0) {
                        const successfulVideo = historyEntry.attempts.find(a => a.status === 'success' && a.videoUrl);
                        if (successfulVideo) {
                            hasExistingVideos = true;
                            resolvedVideoId = successfulVideo.videoId || successfulVideo.id;
                        }
                    }
                }
            }
        } catch (e) {
            window.Logger.warn('Queue', 'Thumbnail lookup failed, using fallback:', e.message);
        }

        // v1.23.15: Set status based on whether videos already exist
        // 'success' = has videos (ready for download/upscale)
        // 'pending' = no videos yet (needs queue processing to generate)
        this.queueItems.set(imageId, {
            id: imageId,
            videoId: resolvedVideoId || imageId,
            imageId: imageId,
            parentPostId: imageId,
            thumbnailUrl: finalThumbnail,
            status: hasExistingVideos ? 'success' : 'pending',
            progress: hasExistingVideos ? 100 : 0,
            addedAt: Date.now(),
            completedAt: hasExistingVideos ? Date.now() : null
        });

        // v1.23.21: If includeEditsMode is ON, also add edited versions
        let editsAdded = false;
        if (this.includeEditsMode) {
            window.Logger.info('Queue', `🖼️ Include Edits ON - looking for edits of:`, imageId);
            editsAdded = await this._addEditedVersions(imageId);
        }

        if (!editsAdded) {
            this._renderGrid();
            this._updateStats();
        }
        window.Logger.info('Queue', `📥 Item added via Quick Add: ${imageId} (${hasExistingVideos ? 'has videos' : 'pending'})`);
        return true;
    }

    /**
     * Get all queue items (for export)
     * @returns {Array}
     */
    getQueueItems() {
        return Array.from(this.queueItems.values());
    }

    /**
     * Cleanup
     */
    destroy() {
        window.removeEventListener('gvp:vidgen-beacon', this._boundHandleRailProgress);
        window.removeEventListener('gvp:queue-status', this._boundHandleQueueStatus);
        window.removeEventListener('gvp:progress-update', this._boundHandleTerminalState);
        window.removeEventListener('gvp:idb-late-init', this._boundHandleLateInit);
        this.queueItems.clear();
        window.Logger.info('Queue', 'UIVideoQueueManager destroyed');
    }
};
