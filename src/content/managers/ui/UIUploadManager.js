// UIUploadManager.js - Upload queue UI with per-image prompt configuration
// Dependencies: StateManager, UploadAutomationManager

window.UIUploadManager = class UIUploadManager {
    constructor(stateManager, shadowRoot, uploadAutomationManager, uiManager) {
        this.stateManager = stateManager;
        this.shadowRoot = shadowRoot;
        this.uploadAutomationManager = uploadAutomationManager;
        this.uiManager = uiManager;
        this._uploadPanelElement = null;
        this._updateInterval = null;
        this._thumbnailModal = null;
        this._queueItemCheckboxes = new Map(); // imageId -> {json, raw, toggles}
        this._lastQueueHash = null; // Track queue changes to prevent unnecessary rebuilds
    }

    createUploadPanel() {
        // Create backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'gvp-upload-backdrop';
        backdrop.style.cssText = `
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 999997;
            pointer-events: auto;
        `;

        // Create panel container
        const panel = document.createElement('div');
        panel.id = 'gvp-upload-queue-panel';
        panel.className = 'gvp-upload-queue-panel';
        panel.style.cssText = `
            display: none;
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 90%;
            max-width: 500px;
            max-height: 85vh;
            background: #141414;
            border: 2px solid #262626;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.8);
            z-index: 999998;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            overflow-y: auto;
            pointer-events: auto;
        `;

        // Store backdrop reference
        this.uploadBackdrop = backdrop;

        // Header with close button
        const header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #333;';

        const title = document.createElement('h3');
        title.textContent = '🖼️ Upload Queue';
        title.style.cssText = 'margin: 0; font-size: 16px; color: #fff; font-weight: 600;';

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '✖️';
        closeBtn.title = 'Close Upload Queue';
        closeBtn.style.cssText = 'background: none; border: none; color: #fff; font-size: 20px; cursor: pointer; padding: 4px 8px; opacity: 0.7; transition: opacity 0.2s;';
        closeBtn.addEventListener('mouseenter', () => closeBtn.style.opacity = '1');
        closeBtn.addEventListener('mouseleave', () => closeBtn.style.opacity = '0.7');
        closeBtn.addEventListener('click', () => this.hideUploadPanel());

        header.appendChild(title);
        header.appendChild(closeBtn);
        panel.appendChild(header);

        // Actions row (4 buttons in a row)
        const actionsRow = document.createElement('div');
        actionsRow.style.cssText = 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px;';

        // Start button (always visible)
        const startBtn = document.createElement('button');
        startBtn.className = 'gvp-button';
        startBtn.id = 'gvp-upload-start';
        startBtn.textContent = '▶️ Start';
        startBtn.style.cssText = 'padding: 8px; cursor: pointer; background: #262626; border: 1px solid #48494b; color: #fff; border-radius: 4px; font-size: 11px; font-weight: 500;';
        // Add hover effects
        startBtn.addEventListener('mouseenter', () => {
            startBtn.style.background = 'var(--gvp-bg-secondary)';
        });
        startBtn.addEventListener('mouseleave', () => {
            startBtn.style.background = 'var(--gvp-bg-tertiary)';
        });
        startBtn.addEventListener('click', () => {
            if (this.uploadAutomationManager._queue.length === 0) {
                window.Logger.debug('Upload', 'No files in queue to process');
            } else {
                startBtn.style.background = 'var(--gvp-bg-primary)'; // Active state
                this.uploadAutomationManager._processQueue('manual-start');
                window.Logger.info('Upload', 'Processing started');
                setTimeout(() => this.updateQueueDisplay(), 50);
            }
        });

        // Pause button (visible only when processing)
        const pauseBtn = document.createElement('button');
        pauseBtn.className = 'gvp-button';
        pauseBtn.id = 'gvp-upload-pause';
        pauseBtn.textContent = '⏸️ Pause';
        pauseBtn.style.cssText = 'padding: 8px; cursor: pointer; background: #262626; border: 1px solid #48494b; color: #fff; border-radius: 4px; font-size: 11px; font-weight: 500; display: none;';
        pauseBtn.addEventListener('click', () => {
            this.uploadAutomationManager.cancelProcessing();
            window.Logger.info('Upload', 'Processing paused');
            this.updateQueueDisplay();
        });

        // Clear Queue button
        const clearBtn = document.createElement('button');
        clearBtn.className = 'gvp-button';
        clearBtn.textContent = '🗑️ Clear';
        clearBtn.style.cssText = 'padding: 8px; cursor: pointer; background: #262626; border: 1px solid #48494b; color: #fff; border-radius: 4px; font-size: 11px; font-weight: 500;';
        clearBtn.addEventListener('click', () => {
            if (confirm('Clear all queued items?')) {
                const count = this.uploadAutomationManager.clearQueue();
                this.updateQueueDisplay();
                window.Logger.info('Upload', `Cleared ${count} items from queue`);
            }
        });

        // Cancel button (killswitch - stop + clear + close + disable)
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'gvp-button';
        cancelBtn.textContent = '❌ Cancel';
        cancelBtn.style.cssText = 'padding: 8px; cursor: pointer; background: #262626; border: 1px solid #48494b; color: #fff; border-radius: 4px; font-size: 11px; font-weight: 500;';
        cancelBtn.addEventListener('click', () => {
            if (confirm('Cancel upload mode and close panel?')) {
                // Killswitch: stop processing, clear queue, close panel, disable mode
                this.uploadAutomationManager.cancelProcessing();
                this.uploadAutomationManager.clearQueue();
                this.hideUploadPanel();
                if (this.stateManager && this.stateManager.setUploadAutomationEnabled) {
                    this.stateManager.setUploadAutomationEnabled(false);
                }
                window.Logger.warn('Upload', '🛑 KILLSWITCH: Upload mode cancelled');
            }
        });

        actionsRow.appendChild(startBtn);
        actionsRow.appendChild(pauseBtn);
        actionsRow.appendChild(clearBtn);
        actionsRow.appendChild(cancelBtn);
        panel.appendChild(actionsRow);

        // File input (hidden)
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        fileInput.accept = 'image/*';
        fileInput.style.cssText = 'display: none;';
        fileInput.id = 'gvp-upload-file-input';

        fileInput.addEventListener('change', (e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
                // Get checkbox states for each file
                const filesWithOptions = Array.from(files).map(file => ({
                    file: file,
                    options: {
                        useJson: false,  // Will be set per-image in queue
                        useRaw: false,
                        useToggles: false
                    }
                }));

                const added = this.uploadAutomationManager.enqueueFiles(filesWithOptions);
                this.updateQueueDisplay();
                window.Logger.info('Upload', `Added ${added} files to queue`);
            }
            fileInput.value = ''; // Reset for next selection
        });

        panel.appendChild(fileInput);

        // Select button
        const selectBtn = document.createElement('button');
        selectBtn.className = 'gvp-button';
        selectBtn.textContent = '📁 Select Images';
        selectBtn.style.cssText = 'width: 100%; margin-bottom: 12px; padding: 10px; cursor: pointer; background: #262626; border: 1px solid #48494b; color: #fff; border-radius: 4px; font-weight: 500;';
        selectBtn.addEventListener('click', () => {
            fileInput.click();
        });
        selectBtn.addEventListener('mouseenter', () => {
            selectBtn.style.background = 'var(--gvp-bg-secondary)';
        });
        selectBtn.addEventListener('mouseleave', () => {
            selectBtn.style.background = 'var(--gvp-bg-tertiary)';
        });
        panel.appendChild(selectBtn);

        // Queue status row
        const statusRow = document.createElement('div');
        statusRow.id = 'gvp-upload-status';
        statusRow.style.cssText = 'display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 12px; color: #888;';
        statusRow.innerHTML = `
            <span>Queue: <strong id="gvp-upload-queue-count" style="color: #fff;">0</strong></span>
            <span>Processed: <strong id="gvp-upload-processed-count" style="color: #4ade80;">0</strong></span>
        `;
        panel.appendChild(statusRow);

        // Bulk toggle buttons row
        const bulkTogglesRow = document.createElement('div');
        bulkTogglesRow.style.cssText = 'display: flex; gap: 8px; margin-bottom: 12px; align-items: stretch;';

        // JSON bulk toggle (red)
        const jsonBulkBtn = document.createElement('button');
        jsonBulkBtn.id = 'gvp-upload-bulk-json';
        jsonBulkBtn.innerHTML = '<div style="font-size: 16px; margin-bottom: 2px;">⚪</div><div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;">JSON</div>';
        jsonBulkBtn.title = 'Toggle JSON for all images';
        jsonBulkBtn.style.cssText = 'flex: 1; padding: 8px 4px; cursor: pointer; background: #262626; border: 1px solid #48494b; color: #fff; border-radius: 4px; font-weight: 600; display: flex; flex-direction: column; align-items: center; justify-content: center;';
        // Add hover and active states
        jsonBulkBtn.addEventListener('mouseenter', () => {
            jsonBulkBtn.style.background = 'var(--gvp-bg-secondary)';
        });
        jsonBulkBtn.addEventListener('mouseleave', () => {
            jsonBulkBtn.style.background = 'var(--gvp-bg-tertiary)';
        });
        jsonBulkBtn.addEventListener('click', () => {
            jsonBulkBtn.style.background = 'var(--gvp-bg-primary)'; // Active state
            this._toggleBulkCheckboxes('json');
            setTimeout(() => {
                jsonBulkBtn.style.background = 'var(--gvp-bg-tertiary)';
            }, 150);
        });

        // Raw bulk toggle (blue)
        const rawBulkBtn = document.createElement('button');
        rawBulkBtn.id = 'gvp-upload-bulk-raw';
        rawBulkBtn.innerHTML = '<div style="font-size: 16px; margin-bottom: 2px;">⚪</div><div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;">RAW</div>';
        rawBulkBtn.title = 'Toggle Raw for all images';
        rawBulkBtn.style.cssText = 'flex: 1; padding: 8px 4px; cursor: pointer; background: #262626; border: 1px solid #48494b; color: #fff; border-radius: 4px; font-weight: 600; display: flex; flex-direction: column; align-items: center; justify-content: center;';
        // Add hover and active states
        rawBulkBtn.addEventListener('mouseenter', () => {
            rawBulkBtn.style.background = 'var(--gvp-bg-secondary)';
        });
        rawBulkBtn.addEventListener('mouseleave', () => {
            rawBulkBtn.style.background = 'var(--gvp-bg-tertiary)';
        });
        rawBulkBtn.addEventListener('click', () => {
            rawBulkBtn.style.background = 'var(--gvp-bg-primary)'; // Active state
            this._toggleBulkCheckboxes('raw');
            setTimeout(() => {
                rawBulkBtn.style.background = 'var(--gvp-bg-tertiary)';
            }, 150);
        });

        // Toggles bulk toggle (yellow)
        const togglesBulkBtn = document.createElement('button');
        togglesBulkBtn.id = 'gvp-upload-bulk-toggles';
        togglesBulkBtn.innerHTML = '<div style="font-size: 16px; margin-bottom: 2px;">⚪</div><div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;">TOGGLE</div>';
        togglesBulkBtn.title = 'Toggle settings for all images';
        togglesBulkBtn.style.cssText = 'flex: 1; padding: 8px 4px; cursor: pointer; background: #262626; border: 1px solid #48494b; color: #fff; border-radius: 4px; font-weight: 600; display: flex; flex-direction: column; align-items: center; justify-content: center;';
        // Add hover and active states
        togglesBulkBtn.addEventListener('mouseenter', () => {
            togglesBulkBtn.style.background = 'var(--gvp-bg-secondary)';
        });
        togglesBulkBtn.addEventListener('mouseleave', () => {
            togglesBulkBtn.style.background = 'var(--gvp-bg-tertiary)';
        });
        togglesBulkBtn.addEventListener('click', () => {
            togglesBulkBtn.style.background = 'var(--gvp-bg-primary)'; // Active state
            this._toggleBulkCheckboxes('toggles');
            setTimeout(() => {
                togglesBulkBtn.style.background = 'var(--gvp-bg-tertiary)';
            }, 150);
        });

        bulkTogglesRow.appendChild(jsonBulkBtn);
        bulkTogglesRow.appendChild(rawBulkBtn);
        bulkTogglesRow.appendChild(togglesBulkBtn);
        panel.appendChild(bulkTogglesRow);

        // Queue list with thumbnails and checkboxes
        const queueList = document.createElement('div');
        queueList.id = 'gvp-upload-queue-list';
        queueList.style.cssText = 'display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 400px); overflow-y: auto; padding: 4px;';
        panel.appendChild(queueList);

        // Create thumbnail modal
        this._thumbnailModal = this._createThumbnailModal();
        panel.appendChild(this._thumbnailModal);

        // Store references
        this.uploadPanel = panel;
        this.uploadBackdrop = backdrop;

        // Click backdrop to close
        backdrop.addEventListener('click', () => this.hideUploadPanel());

        // Create container to hold both
        const container = document.createElement('div');
        container.appendChild(backdrop);
        container.appendChild(panel);

        return container;
    }

    toggleUploadPanel() {
        const panel = this.uploadPanel || this.shadowRoot?.getElementById('gvp-upload-queue-panel');
        if (!panel) {
            window.Logger.error('Upload', 'Panel not found');
            return;
        }

        const isVisible = panel.style.display === 'block';
        if (isVisible) {
            this.hideUploadPanel();
        } else {
            this.showUploadPanel();
        }
    }

    showUploadPanel() {
        const panel = this.uploadPanel || this.shadowRoot?.getElementById('gvp-upload-queue-panel');
        const backdrop = this.uploadBackdrop || this.shadowRoot?.getElementById('gvp-upload-backdrop');

        if (panel) {
            panel.style.display = 'block';
            this.isOpen = true;
            window.Logger.info('Upload', 'Upload panel shown');

            // Update queue display
            this.updateQueueDisplay();

            // Start auto-update interval
            if (!this._updateInterval) {
                this._updateInterval = setInterval(() => {
                    this.updateQueueDisplay();
                }, 1000);
            }
        }
        if (backdrop) {
            backdrop.style.display = 'block';
        }
    }

    hideUploadPanel() {
        const panel = this.uploadPanel || this.shadowRoot?.getElementById('gvp-upload-queue-panel');
        const backdrop = this.uploadBackdrop || this.shadowRoot?.getElementById('gvp-upload-backdrop');

        if (panel) {
            panel.style.display = 'none';
            this.isOpen = false;
            window.Logger.info('Upload', 'Upload panel hidden');
        }
        if (backdrop) {
            backdrop.style.display = 'none';
        }

        // Stop auto-update interval
        if (this._updateInterval) {
            clearInterval(this._updateInterval);
            this._updateInterval = null;
        }
    }

    /**
     * Creates inline tab content for the Multi-Upload tab.
     * Why: The original createUploadPanel() returns a position:fixed modal, which stays
     * hidden when appended to a tab div. This method builds equivalent UI as flow-content.
     * @returns {HTMLElement}
     */
    createInlineUploadContent() {
        const container = document.createElement('div');
        container.id = 'gvp-upload-inline-panel';
        container.style.cssText = 'padding: 12px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; height: 100%; box-sizing: border-box;';

        // ── Actions row (Start / Pause / Clear / Cancel) ────────────────
        const actionsRow = document.createElement('div');
        actionsRow.style.cssText = 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;';

        const startBtn = document.createElement('button');
        startBtn.id = 'gvp-ul-inline-start';
        startBtn.className = 'gvp-button';
        startBtn.textContent = '▶️ Start';
        startBtn.style.cssText = 'padding: 7px; cursor: pointer; background: #262626; border: 1px solid #48494b; color: #fff; border-radius: 4px; font-size: 11px; font-weight: 500;';
        startBtn.addEventListener('click', () => {
            if (!this.uploadAutomationManager?._queue?.length) return;
            this.uploadAutomationManager._processQueue('manual-start');
            setTimeout(() => this.updateQueueDisplay(), 50);
        });

        const pauseBtn = document.createElement('button');
        pauseBtn.id = 'gvp-ul-inline-pause';
        pauseBtn.className = 'gvp-button';
        pauseBtn.textContent = '⏸️ Pause';
        pauseBtn.style.cssText = 'padding: 7px; cursor: pointer; background: #262626; border: 1px solid #48494b; color: #fff; border-radius: 4px; font-size: 11px; font-weight: 500; display: none;';
        pauseBtn.addEventListener('click', () => {
            this.uploadAutomationManager?.cancelProcessing();
            this.updateQueueDisplay();
        });

        const clearBtn = document.createElement('button');
        clearBtn.className = 'gvp-button';
        clearBtn.textContent = '🗑️ Clear';
        clearBtn.style.cssText = 'padding: 7px; cursor: pointer; background: #262626; border: 1px solid #48494b; color: #fff; border-radius: 4px; font-size: 11px; font-weight: 500;';
        clearBtn.addEventListener('click', () => {
            if (confirm('Clear all queued items?')) {
                this.uploadAutomationManager?.clearQueue();
                this.updateQueueDisplay();
            }
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'gvp-button';
        cancelBtn.textContent = '❌ Cancel';
        cancelBtn.style.cssText = 'padding: 7px; cursor: pointer; background: #262626; border: 1px solid #48494b; color: #fff; border-radius: 4px; font-size: 11px; font-weight: 500;';
        cancelBtn.addEventListener('click', () => {
            if (confirm('Cancel upload mode?')) {
                this.uploadAutomationManager?.cancelProcessing();
                this.uploadAutomationManager?.clearQueue();
                this.stateManager?.setUploadAutomationEnabled?.(false);
                this.updateQueueDisplay();
            }
        });

        actionsRow.appendChild(startBtn);
        actionsRow.appendChild(pauseBtn);
        actionsRow.appendChild(clearBtn);
        actionsRow.appendChild(cancelBtn);
        container.appendChild(actionsRow);

        // ── Hidden file input + Select button ───────────────────────────
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        fileInput.accept = 'image/*';
        fileInput.style.cssText = 'display: none;';
        fileInput.addEventListener('change', (e) => {
            const files = e.target.files;
            if (!files?.length) return;
            const filesWithOptions = Array.from(files).map(f => ({ file: f, options: { useJson: false, useRaw: false, useToggles: false } }));
            this.uploadAutomationManager?.enqueueFiles(filesWithOptions);
            this.updateQueueDisplay();
            fileInput.value = '';
        });
        container.appendChild(fileInput);

        const selectBtn = document.createElement('button');
        selectBtn.className = 'gvp-button';
        selectBtn.textContent = '📁 Select Images';
        selectBtn.style.cssText = 'width: 100%; padding: 9px; cursor: pointer; background: #262626; border: 1px solid #48494b; color: #fff; border-radius: 4px; font-weight: 500; font-size: 12px;';
        selectBtn.addEventListener('click', () => fileInput.click());
        container.appendChild(selectBtn);

        // ── Status row ──────────────────────────────────────────────────
        const statusRow = document.createElement('div');
        statusRow.id = 'gvp-ul-inline-status';
        statusRow.style.cssText = 'display: flex; justify-content: space-between; font-size: 12px; color: #888;';
        statusRow.innerHTML = `<span>Queue: <strong id="gvp-ul-inline-queue-count" style="color:#fff">0</strong></span><span>Processed: <strong id="gvp-ul-inline-processed-count" style="color:#4ade80">0</strong></span>`;
        container.appendChild(statusRow);

        // ── Bulk toggle buttons ─────────────────────────────────────────
        const bulkRow = document.createElement('div');
        bulkRow.style.cssText = 'display: flex; gap: 6px;';

        ['json', 'raw', 'toggles'].forEach(type => {
            const label = type.toUpperCase();
            const btn = document.createElement('button');
            btn.className = 'gvp-button';
            btn.style.cssText = 'flex: 1; padding: 6px 2px; cursor: pointer; background: #262626; border: 1px solid #48494b; color: #fff; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;';
            btn.textContent = label;
            btn.addEventListener('click', () => this._toggleBulkCheckboxes(type));
            bulkRow.appendChild(btn);
        });
        container.appendChild(bulkRow);

        // ── Queue list ──────────────────────────────────────────────────
        const queueList = document.createElement('div');
        queueList.id = 'gvp-ul-inline-queue-list';
        queueList.style.cssText = 'display: flex; flex-direction: column; gap: 6px; overflow-y: auto; flex: 1; padding: 2px;';
        container.appendChild(queueList);

        // Store reference so updateQueueDisplay() can find it
        this._inlinePanel = container;
        return container;
    }

    /**
     * Called by UITabManager.switchTab when the Multi-Upload tab becomes active.
     * Why: Replaces the fragile state-event chain for activating the inline panel.
     */
    onTabActivated() {
        this.updateQueueDisplay();
        if (!this._updateInterval) {
            this._updateInterval = setInterval(() => this.updateQueueDisplay(), 1000);
        }
        window.Logger.info('Upload', 'Multi-Upload tab activated — display updated');

        // Auto-enable upload mode when tab is opened
        if (this.stateManager?.setUploadAutomationEnabled) {
            this.stateManager.setUploadAutomationEnabled(true);
        }
    }

    /**
     * Called by UITabManager.switchTab when the Multi-Upload tab becomes inactive.
     * Why: Stops unnecessary polling when the tab is not visible.
     */
    onTabDeactivated() {
        if (this._updateInterval) {
            clearInterval(this._updateInterval);
            this._updateInterval = null;
        }
    }

    updateQueueDisplay() {
        // Support both the floating modal panel and the new inline tab panel
        const panel = this._inlinePanel || this.uploadPanel || this.shadowRoot?.getElementById('gvp-upload-queue-panel');
        if (!panel) return;

        // Resolve element IDs based on which panel we're working with
        const isInline = panel === this._inlinePanel;

        if (!this.uploadAutomationManager) return;
        const status = this.uploadAutomationManager.getStatus();

        const queueCountId = isInline ? '#gvp-ul-inline-queue-count' : '#gvp-upload-queue-count';
        const processedId = isInline ? '#gvp-ul-inline-processed-count' : '#gvp-upload-processed-count';
        const queueListId = isInline ? '#gvp-ul-inline-queue-list' : '#gvp-upload-queue-list';
        const startBtnId = isInline ? '#gvp-ul-inline-start' : '#gvp-upload-start';
        const pauseBtnId = isInline ? '#gvp-ul-inline-pause' : '#gvp-upload-pause';

        const queueCountEl = panel.querySelector(queueCountId);
        const processedCountEl = panel.querySelector(processedId);
        const queueList = panel.querySelector(queueListId);

        // Update counts
        if (queueCountEl) queueCountEl.textContent = status.queueLength;
        if (processedCountEl) processedCountEl.textContent = status.processedCount;

        // Update start/pause button visibility
        const startBtn = panel.querySelector(startBtnId);
        const pauseBtn = panel.querySelector(pauseBtnId);

        if (startBtn && pauseBtn) {
            if (status.isProcessing) {
                // Hide Start, show Pause
                startBtn.style.display = 'none';
                pauseBtn.style.display = 'block';
            } else {
                // Show Start, hide Pause
                startBtn.style.display = 'block';
                pauseBtn.style.display = 'none';
            }
        }

        // Update queue list with thumbnails and checkboxes
        if (queueList) {
            const queue = this.uploadAutomationManager._queue || [];

            // Check if queue structure has changed (to avoid unnecessary rebuilds)
            // Include checkbox states in hash to detect bulk toggle changes
            const currentQueueHash = queue.map(item => {
                const checkboxes = item.checkboxes || { json: false, raw: false, toggles: false };
                return `${item.id}-${item.status}-${checkboxes.json}-${checkboxes.raw}-${checkboxes.toggles}`;
            }).join(',');
            if (this._lastQueueHash !== currentQueueHash) {
                this._lastQueueHash = currentQueueHash;

                if (queue.length === 0) {
                    queueList.innerHTML = '<div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">No files in queue</div>';
                } else {
                    queueList.innerHTML = '';
                    queue.forEach((item, index) => {
                        // Load checkbox states from queue item if available
                        if (item.checkboxes && !this._queueItemCheckboxes.has(item.id)) {
                            this._queueItemCheckboxes.set(item.id, item.checkboxes);
                        }
                        const queueItem = this._createQueueItem(item, index);
                        queueList.appendChild(queueItem);
                    });
                }
            }
        }
    }

    _truncateName(name, maxLength) {
        if (name.length <= maxLength) return name;
        const ext = name.split('.').pop();
        const nameWithoutExt = name.substring(0, name.lastIndexOf('.'));
        const truncated = nameWithoutExt.substring(0, maxLength - ext.length - 4) + '...';
        return truncated + '.' + ext;
    }

    _getStatusColor(status) {
        switch (status) {
            case 'pending': return 'var(--gvp-text-muted)';
            case 'processing': return 'var(--gvp-status-processing)';
            case 'completed': return 'var(--gvp-status-success)';
            case 'failed': return 'var(--gvp-accent)';
            default: return 'var(--gvp-text-muted)';
        }
    }

    _getStatusIcon(status) {
        switch (status) {
            case 'pending': return '⏸️';
            case 'processing': return '⏳';
            case 'completed': return '✅';
            case 'failed': return '❌';
            default: return '•';
        }
    }

    _createQueueItem(item, index) {
        const row = document.createElement('div');
        row.style.cssText = 'display: grid; grid-template-columns: 60px 1fr auto; gap: 8px; padding: 8px; background: #222; border-radius: 4px; border: 1px solid #333; align-items: center;';

        // Thumbnail (clickable)
        const thumbnail = document.createElement('div');
        thumbnail.style.cssText = 'width: 60px; height: 60px; background: #333; border-radius: 4px; cursor: pointer; overflow: hidden; display: flex; align-items: center; justify-content: center;';

        const img = document.createElement('img');
        img.src = URL.createObjectURL(item.file);
        img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
        img.title = 'Click to view full size';
        thumbnail.appendChild(img);

        thumbnail.addEventListener('click', () => {
            this._showThumbnailModal(item.file);
        });

        row.appendChild(thumbnail);

        // Info + Status column
        const infoCol = document.createElement('div');
        infoCol.style.cssText = 'display: flex; flex-direction: column; gap: 2px; min-width: 0;';

        const nameRow = document.createElement('div');
        nameRow.style.cssText = 'font-size: 11px; color: #fff; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
        nameRow.textContent = this._truncateName(item.name, 20);

        const statusRow = document.createElement('div');
        statusRow.style.cssText = `font-size: 10px; color: ${this._getStatusColor(item.status)};`;
        statusRow.textContent = `${this._getStatusIcon(item.status)} ${item.status}`;

        infoCol.appendChild(nameRow);
        infoCol.appendChild(statusRow);
        row.appendChild(infoCol);

        // Right column: Checkboxes + Size
        const rightCol = document.createElement('div');
        rightCol.style.cssText = 'display: flex; align-items: center; gap: 8px;';

        // Checkboxes - aligned to match bulk buttons width
        const checkboxCol = document.createElement('div');
        checkboxCol.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; width: 280px;';

        // Get or initialize checkbox states
        if (!this._queueItemCheckboxes.has(item.id)) {
            this._queueItemCheckboxes.set(item.id, { json: false, raw: false, toggles: false });
        }
        const checkboxStates = this._queueItemCheckboxes.get(item.id);

        // JSON checkbox (red) - centered
        const jsonCheckboxContainer = document.createElement('div');
        jsonCheckboxContainer.style.cssText = 'display: flex; justify-content: center;';
        const jsonCheckbox = this._createCheckbox('⚪', checkboxStates.json, (checked) => {
            checkboxStates.json = checked;
            if (checked && checkboxStates.raw) {
                checkboxStates.raw = false;
                this.updateQueueDisplay();
            }
            // Sync to queue item
            this._syncCheckboxesToQueue(item.id, checkboxStates);
        });
        jsonCheckboxContainer.appendChild(jsonCheckbox);

        // Raw checkbox (blue) - centered
        const rawCheckboxContainer = document.createElement('div');
        rawCheckboxContainer.style.cssText = 'display: flex; justify-content: center;';
        const rawCheckbox = this._createCheckbox('⚪', checkboxStates.raw, (checked) => {
            checkboxStates.raw = checked;
            if (checked && checkboxStates.json) {
                checkboxStates.json = false;
                this.updateQueueDisplay();
            }
            // Sync to queue item
            this._syncCheckboxesToQueue(item.id, checkboxStates);
        });
        rawCheckboxContainer.appendChild(rawCheckbox);

        // Toggles checkbox (yellow) - centered
        const togglesCheckboxContainer = document.createElement('div');
        togglesCheckboxContainer.style.cssText = 'display: flex; justify-content: center;';
        const togglesCheckbox = this._createCheckbox('⚪', checkboxStates.toggles, (checked) => {
            checkboxStates.toggles = checked;
            // Sync to queue item
            this._syncCheckboxesToQueue(item.id, checkboxStates);
        });
        togglesCheckboxContainer.appendChild(togglesCheckbox);

        checkboxCol.appendChild(jsonCheckboxContainer);
        checkboxCol.appendChild(rawCheckboxContainer);
        checkboxCol.appendChild(togglesCheckboxContainer);
        rightCol.appendChild(checkboxCol);

        // Size
        const sizeSpan = document.createElement('span');
        sizeSpan.style.cssText = 'font-size: 10px; color: #666; width: 50px; text-align: right;';
        sizeSpan.textContent = `${(item.size / 1024).toFixed(0)}KB`;
        rightCol.appendChild(sizeSpan);

        row.appendChild(rightCol);

        return row;
    }

    _createCheckbox(emoji, checked, onChange) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = checked;
        checkbox.style.cssText = 'width: 16px; height: 16px; cursor: pointer;';
        checkbox.title = emoji;

        checkbox.addEventListener('change', (e) => {
            onChange(e.target.checked);
        });

        return checkbox;
    }

    _toggleBulkCheckboxes(type) {
        const queue = this.uploadAutomationManager._queue || [];
        if (queue.length === 0) return;

        // Count how many are currently checked
        let checkedCount = 0;
        queue.forEach(item => {
            const state = this._queueItemCheckboxes.get(item.id);
            if (state && state[type]) checkedCount++;
        });

        // If all or more than half are checked, uncheck all. Otherwise, check all.
        const shouldCheck = checkedCount < queue.length / 2;

        queue.forEach(item => {
            if (!this._queueItemCheckboxes.has(item.id)) {
                this._queueItemCheckboxes.set(item.id, { json: false, raw: false, toggles: false });
            }
            const state = this._queueItemCheckboxes.get(item.id);

            if (type === 'json' || type === 'raw') {
                // Mutual exclusion
                if (shouldCheck) {
                    state[type] = true;
                    // Uncheck the other
                    const otherType = type === 'json' ? 'raw' : 'json';
                    state[otherType] = false;
                } else {
                    state[type] = false;
                }
            } else {
                // Toggles can be freely toggled
                state[type] = shouldCheck;
            }

            // Sync to queue item
            this._syncCheckboxesToQueue(item.id, state);
        });

        this.updateQueueDisplay();
        window.Logger.debug('Upload', `Bulk toggled ${type}: ${shouldCheck ? 'ON' : 'OFF'}`);
    }

    _syncCheckboxesToQueue(itemId, checkboxStates) {
        // Sync checkbox states to the queue item in UploadAutomationManager
        const queue = this.uploadAutomationManager?._queue || [];
        const queueItem = queue.find(item => item.id === itemId);
        if (queueItem) {
            queueItem.checkboxes = { ...checkboxStates };
            window.Logger.debug('Upload', `Synced checkboxes for ${queueItem.name}:`, checkboxStates);
        }
    }

    _createThumbnailModal() {
        const modal = document.createElement('div');
        modal.id = 'gvp-upload-thumbnail-modal';
        modal.style.cssText = `
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0,0,0,0.95);
            z-index: 2147483647;
            justify-content: center;
            align-items: center;
            cursor: pointer;
        `;

        const img = document.createElement('img');
        img.id = 'gvp-upload-thumbnail-modal-img';
        img.style.cssText = 'max-width: 90%; max-height: 90%; object-fit: contain; box-shadow: 0 0 40px rgba(0,0,0,0.8);';

        modal.appendChild(img);

        modal.addEventListener('click', () => {
            this._hideThumbnailModal();
        });

        // Close on ESC key
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this._hideThumbnailModal();
            }
        });

        return modal;
    }

    _showThumbnailModal(file) {
        if (!this._thumbnailModal) return;

        const img = this._thumbnailModal.querySelector('#gvp-upload-thumbnail-modal-img');
        if (img) {
            img.src = URL.createObjectURL(file);
        }

        this._thumbnailModal.style.display = 'flex';
    }

    _hideThumbnailModal() {
        if (!this._thumbnailModal) return;
        this._thumbnailModal.style.display = 'none';
    }

    destroy() {
        if (this._updateInterval) {
            clearInterval(this._updateInterval);
            this._updateInterval = null;
        }

        if (this._uploadPanelElement) {
            this._uploadPanelElement.remove();
            this._uploadPanelElement = null;
        }
    }
};
