// UIChunkBuilderManager.js - Chunk / Prompt Builder Modal
// Manages the chunk palette, prompt building area, and saving to Manager

window.UIChunkBuilderManager = class UIChunkBuilderManager {
    constructor(stateManager, uiHelpers, uiModalManager) {
        this.stateManager = stateManager;
        this.uiHelpers = uiHelpers || new window.UIHelpers();
        this.uiModalManager = uiModalManager;
        this.chunks = [];
        this.activeCategory = 'all';
        this.appliedChunks = []; // Ordered array of applied chunk metadata
        this.modalOverlay = null;
        this.modalContent = null;
        this.categories = ['subject', 'action', 'setting', 'style', 'quality', 'safety', 'custom'];
    }

    async loadChunks() {
        try {
            const result = await this.stateManager.storageManager.indexedDBManager.getAll('chunks');
            this.chunks = result || [];
        } catch (error) {
            window.Logger.error('ChunkBuilder', 'Failed to load chunks', error);
            this.chunks = [];
        }
    }

    async saveChunk(chunk) {
        try {
            if (!chunk.id) chunk.id = this.stateManager._generateGuid('chunk');
            chunk.updatedAt = Date.now();
            if (!chunk.createdAt) chunk.createdAt = Date.now();

            await this.stateManager.storageManager.indexedDBManager.put('chunks', chunk);
            await this.loadChunks();
            this.renderPalette();
            return chunk;
        } catch (error) {
            window.Logger.error('ChunkBuilder', 'Failed to save chunk', error);
            throw error;
        }
    }

    async deleteChunk(chunkId) {
        try {
            await this.stateManager.storageManager.indexedDBManager.delete('chunks', chunkId);
            await this.loadChunks();
            this.renderPalette();
        } catch (error) {
            window.Logger.error('ChunkBuilder', 'Failed to delete chunk', error);
            throw error;
        }
    }

    showBuilderModal(initialText = '', onCompleteCallback = null) {
        if (this.modalOverlay) {
            this.modalOverlay.remove();
        }

        this.onCompleteCallback = onCompleteCallback;

        // Initialize empty build state
        this.appliedChunks = [];

        this.modalOverlay = document.createElement('div');
        this.modalOverlay.className = 'gvp-modal-overlay';
        this.modalOverlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center;
            z-index: 1000005; backdrop-filter: blur(4px);
        `;

        this.modalContent = document.createElement('div');
        this.modalContent.style.cssText = `
            width: 95vw; max-width: 1200px; height: 90vh; max-height: 800px;
            background: #141414; border: 1px solid #48494b; border-radius: 12px;
            display: flex; flex-direction: column; overflow: hidden;
            box-shadow: 0 10px 40px rgba(0,0,0,0.8); font-family: inherit;
        `;

        // Load data before rendering
        this.loadChunks().then(() => {
            this.renderModal(initialText);
        });

        this.modalOverlay.appendChild(this.modalContent);

        // Close on background click
        this.modalOverlay.addEventListener('click', (e) => {
            if (e.target === this.modalOverlay) {
                this.closeModal();
            }
        });

        // Append to UIManager's shadow DOM if available, else body
        const container = window.gvpUIManager?.shadowRoot || document.body;
        container.appendChild(this.modalOverlay);
    }

    closeModal() {
        if (this.modalOverlay) {
            this.modalOverlay.remove();
            this.modalOverlay = null;
            this.modalContent = null;
        }
    }

    renderModal(initialText = '') {
        if (!this.modalContent) return;
        this.modalContent.innerHTML = '';

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 16px 20px; border-bottom: 1px solid #48494b;
            display: flex; justify-content: space-between; align-items: center;
        `;

        const title = document.createElement('h2');
        title.textContent = '🧩 Prompt Builder';
        title.style.cssText = 'margin: 0; font-size: 18px; color: #fff; display: flex; align-items: center; gap: 8px;';

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '✕';
        closeBtn.style.cssText = `
            background: none; border: none; color: #a3a3a3; font-size: 18px;
            cursor: pointer; padding: 4px; border-radius: 4px;
        `;
        closeBtn.onclick = () => this.closeModal();
        closeBtn.onmouseenter = () => closeBtn.style.color = '#fff';
        closeBtn.onmouseleave = () => closeBtn.style.color = '#a3a3a3';

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Main Layout (Split Pane)
        const main = document.createElement('div');
        main.style.cssText = 'display: flex; flex: 1; overflow: hidden;';

        // Left Pane: Chunk Palette
        this.paletteContainer = document.createElement('div');
        this.paletteContainer.style.cssText = `
            flex: 1; border-right: 1px solid #48494b; display: flex; flex-direction: column;
            background: #1a1a1a;
        `;

        // Right Pane: Build Area
        this.buildContainer = document.createElement('div');
        this.buildContainer.style.cssText = `
            flex: 1.2; display: flex; flex-direction: column; background: #141414;
        `;

        this.initPalettePane(this.paletteContainer);
        this.initBuildPane(this.buildContainer, initialText);

        main.appendChild(this.paletteContainer);
        main.appendChild(this.buildContainer);

        this.modalContent.appendChild(header);
        this.modalContent.appendChild(main);
    }

    initPalettePane(container) {
        // Controls / Filters
        const controls = document.createElement('div');
        controls.style.cssText = 'padding: 12px; border-bottom: 1px solid #333; display: flex; gap: 8px; align-items: center; justify-content: space-between;';

        const filterSelect = document.createElement('select');
        filterSelect.className = 'gvp-select';
        filterSelect.style.cssText = 'background: #212121; color: #fff; border: 1px solid #48494b; padding: 4px 8px; border-radius: 4px;';

        const allOpt = document.createElement('option');
        allOpt.value = 'all';
        allOpt.textContent = 'All Categories';
        filterSelect.appendChild(allOpt);

        this.categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
            filterSelect.appendChild(opt);
        });

        filterSelect.value = this.activeCategory;
        filterSelect.onchange = (e) => {
            this.activeCategory = e.target.value;
            this.renderPalette();
        };

        const newBtn = document.createElement('button');
        newBtn.className = 'gvp-btn gvp-btn-primary';
        newBtn.textContent = '+ New Chunk';
        newBtn.style.padding = '4px 12px';
        newBtn.onclick = () => this.showChunkEditor();

        controls.appendChild(filterSelect);
        controls.appendChild(newBtn);

        // List Area
        this.chunkListArea = document.createElement('div');
        this.chunkListArea.style.cssText = 'flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;';

        container.appendChild(controls);
        container.appendChild(this.chunkListArea);

        this.renderPalette();
    }

    renderPalette() {
        if (!this.chunkListArea) return;
        this.chunkListArea.innerHTML = '';

        const filtered = this.activeCategory === 'all'
            ? this.chunks
            : this.chunks.filter(c => c.category === this.activeCategory);

        if (filtered.length === 0) {
            this.chunkListArea.innerHTML = '<div style="color:#a3a3a3; text-align:center; padding: 20px;">No chunks found in this category.</div>';
            return;
        }

        filtered.forEach(chunk => {
            const el = document.createElement('div');
            el.style.cssText = `
                background: #212121; border: 1px solid #48494b; border-radius: 6px; padding: 8px 12px;
                cursor: pointer; display: flex; flex-direction: column; gap: 4px; transition: background 0.2s;
            `;
            el.onmouseenter = () => el.style.background = '#2a2a2a';
            el.onmouseleave = () => el.style.background = '#212121';

            const header = document.createElement('div');
            header.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

            const name = document.createElement('span');
            name.textContent = chunk.name;
            name.style.cssText = 'color: #fff; font-size: 13px; font-weight: bold;';

            const actions = document.createElement('div');
            actions.style.cssText = 'display: flex; gap: 4px;';

            const editBtn = document.createElement('button');
            editBtn.innerHTML = '✏️';
            editBtn.style.cssText = 'background: none; border: none; cursor: pointer; opacity: 0.6; padding: 2px;';
            editBtn.onclick = (e) => { e.stopPropagation(); this.showChunkEditor(chunk); };
            editBtn.onmouseenter = () => editBtn.style.opacity = '1';
            editBtn.onmouseleave = () => editBtn.style.opacity = '0.6';

            actions.appendChild(editBtn);
            header.appendChild(name);
            header.appendChild(actions);

            const preview = document.createElement('div');
            preview.textContent = chunk.content;
            preview.style.cssText = 'color: #a3a3a3; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';

            el.appendChild(header);
            el.appendChild(preview);

            // Add to build on click
            el.onclick = () => {
                this.appliedChunks.push({ ...chunk, instanceId: this.stateManager._generateGuid('chunk_inst') });
                this.renderBuildArea();
            };

            this.chunkListArea.appendChild(el);
        });
    }

    showChunkEditor(chunk = null) {
        // Basic prompt-based editor for now. MVP UI.
        const name = prompt('Chunk Name:', chunk ? chunk.name : '');
        if (!name) return;

        const cat = prompt('Category (subject, action, setting, style, quality, safety, custom):', chunk ? chunk.category : 'custom');
        if (!cat) return;

        const content = prompt('Chunk Content:', chunk ? chunk.content : '');
        if (!content) return;

        const newChunk = {
            id: chunk ? chunk.id : undefined,
            name: name,
            category: cat,
            content: content
        };

        this.saveChunk(newChunk);
    }

    initBuildPane(container, initialText = '') {
        const header = document.createElement('div');
        header.style.cssText = 'padding: 16px; border-bottom: 1px solid #333; background: #1f1f1f;';
        const title = document.createElement('h3');
        title.style.cssText = 'margin: 0; font-size: 15px; color: #fff;';
        title.textContent = 'Build Area';
        header.appendChild(title);

        const textWrapper = document.createElement('div');
        textWrapper.style.cssText = 'padding: 16px; display: flex; flex-direction: column; gap: 8px; flex: 1;';

        const label = document.createElement('label');
        label.textContent = 'Final Prompt';
        label.style.cssText = 'color: #a3a3a3; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em;';

        this.buildTextarea = document.createElement('textarea');
        this.buildTextarea.className = 'gvp-textarea';
        this.buildTextarea.style.cssText = 'flex: 1; min-height: 150px; font-family: monospace; padding: 12px; font-size: 13px; border-radius: 6px;';
        this.buildTextarea.placeholder = 'Select chunks from the left or type directly...';
        this.buildTextarea.value = initialText;

        this.buildTextarea.addEventListener('input', () => this.updateTokenCount());
        // Isolation
        this.buildTextarea.addEventListener('keydown', e => e.stopPropagation());
        this.buildTextarea.addEventListener('keyup', e => e.stopPropagation());
        this.buildTextarea.addEventListener('keypress', e => e.stopPropagation());

        this.tokenCountLabel = document.createElement('div');
        this.tokenCountLabel.style.cssText = 'color: #888; font-size: 11px; text-align: right;';
        this.tokenCountLabel.textContent = `Length: ${initialText.length} chars | ${initialText.split(/\s+/).filter(Boolean).length} words`;

        textWrapper.appendChild(label);
        textWrapper.appendChild(this.buildTextarea);
        textWrapper.appendChild(this.tokenCountLabel);

        this.chipsArea = document.createElement('div');
        this.chipsArea.style.cssText = 'padding: 16px; border-top: 1px solid #333; background: #1a1a1a; min-height: 100px; display: flex; flex-direction: column;';

        const footer = document.createElement('div');
        footer.style.cssText = 'padding: 16px; border-top: 1px solid #333; background: #141414; display: flex; justify-content: space-between; align-items: center;';

        const clearBtn = document.createElement('button');
        clearBtn.className = 'gvp-btn gvp-btn-secondary';
        clearBtn.textContent = 'Clear All';
        clearBtn.onclick = () => {
            this.appliedChunks = [];
            this.buildTextarea.value = '';
            this.renderBuildArea();
        };

        const rightActions = document.createElement('div');
        rightActions.style.cssText = 'display: flex; gap: 12px;';

        if (this.onCompleteCallback) {
            const applyBtn = document.createElement('button');
            applyBtn.className = 'gvp-btn gvp-btn-primary';
            applyBtn.textContent = '✔️ Apply to Editor';
            applyBtn.onclick = () => {
                this.onCompleteCallback(this.buildTextarea.value);
                this.closeModal();
            };
            rightActions.appendChild(applyBtn);
        } else {
            const saveBtn = document.createElement('button');
            saveBtn.className = 'gvp-btn gvp-btn-secondary';
            saveBtn.textContent = '💾 Save to Library';
            saveBtn.onclick = () => this.saveToManager();

            const loadBtn = document.createElement('button');
            loadBtn.className = 'gvp-btn gvp-btn-primary';
            loadBtn.textContent = '📤 Load to RAW';
            loadBtn.onclick = () => this.loadIntoRaw();

            rightActions.appendChild(saveBtn);
            rightActions.appendChild(loadBtn);
        }

        footer.appendChild(clearBtn);
        footer.appendChild(rightActions);

        container.appendChild(header);
        container.appendChild(textWrapper);
        container.appendChild(this.chipsArea);
        container.appendChild(footer);

        this.renderBuildArea();
    }

    renderBuildArea() {
        if (!this.chipsArea) return;

        // 1. Update Chips
        this.chipsArea.innerHTML = '';

        if (this.appliedChunks.length === 0) {
            this.chipsArea.innerHTML = '<div style="color:#737373; text-align:center; padding-top:40px; font-size: 13px;">Click chunks on the left to add them here.<br><br>(Drag functionality to be implemented)</div>';
        } else {
            const container = document.createElement('div');
            container.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px;';

            this.appliedChunks.forEach((chunk, index) => {
                const chip = document.createElement('div');
                chip.style.cssText = `
                    background: #2d88ff33; border: 1px solid #2d88ff; color: #a1c6ff;
                    padding: 4px 10px; border-radius: 16px; font-size: 12px; display: flex; align-items: center; gap: 6px;
                `;

                const label = document.createElement('span');
                label.textContent = chunk.name;

                const remove = document.createElement('button');
                remove.innerHTML = '✕';
                remove.style.cssText = 'background: none; border: none; color: inherit; cursor: pointer; padding: 0; font-size: 10px; opacity: 0.7;';
                remove.onclick = () => {
                    this.appliedChunks.splice(index, 1);
                    this.renderBuildArea();
                };
                remove.onmouseenter = () => remove.style.opacity = '1';
                remove.onmouseleave = () => remove.style.opacity = '0.7';

                chip.appendChild(label);
                chip.appendChild(remove);
                container.appendChild(chip);
            });
            this.chipsArea.appendChild(container);

            // Add instructions
            const inst = document.createElement('div');
            inst.style.cssText = 'color:#737373; font-size: 11px; margin-top: 16px;';
            inst.textContent = 'Chunks are appended in order. Edit the text above to finish.';
            this.chipsArea.appendChild(inst);
        }

        // Combine existing text with applied chunks if any
        if (this.appliedChunks.length > 0) {
            const addedText = this.appliedChunks.map(c => c.content).join(', ');
            const current = this.buildTextarea.value.trim();
            this.buildTextarea.value = current ? `${current}, ${addedText}` : addedText;
        }

        this.updateTokenCount();
    }

    updateTokenCount() {
        if (!this.buildTextarea || !this.tokenCountLabel) return;
        const text = this.buildTextarea.value;
        this.tokenCountLabel.textContent = `Length: ${text.length} chars | ${text.split(/\s+/).filter(Boolean).length} words`;
    }

    saveToManager() {
        const text = this.buildTextarea.value.trim();
        if (!text) {
            alert('Cannot save empty prompt.');
            return;
        }

        const promptLibrary = window.gvpUIManager?.uiModalManager?.promptLibrary;
        if (promptLibrary) {
            // Assume promptLibraryManager has a method to open the creator with pre-filled text
            // Or just create it directly via state manager
            const name = prompt('Name for this prompt:', 'Built Prompt');
            if (name) {
                const newPrompt = {
                    id: this.stateManager._generateGuid('chunk_prompt'),
                    name: name,
                    type: 'video',
                    folder_id: null,
                    prompt: text,
                    isPinned: false,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };

                this.stateManager.savePrompt(newPrompt).then(() => {
                    alert('Saved to Prompt Manager!');
                    // Refresh manager if open
                    if (promptLibrary.refreshPromptList) {
                        promptLibrary.refreshPromptList();
                    }
                }).catch(e => {
                    alert('Error saving to Manager.');
                    console.error(e);
                });
            }
        } else {
            alert('Prompt Library Manager not connected. Please open the library once to initialize it.');
        }
    }

    loadIntoRaw() {
        const text = this.buildTextarea.value.trim();
        if (!text) return;

        const rawTextarea = window.gvpUIManager?.shadowRoot?.getElementById('gvp-raw-input-textarea') || document.getElementById('gvp-raw-input-textarea');
        if (rawTextarea) {
            rawTextarea.value = text;

            // Dispatch input event for React 
            const event = new Event('input', { bubbles: true });
            rawTextarea.dispatchEvent(event);

            // Sync specific method if it exists
            if (window.gvpUIManager && window.gvpUIManager.uiRawInputManager && window.gvpUIManager.uiRawInputManager.updateRawPreview) {
                window.gvpUIManager.uiRawInputManager.updateRawPreview(text);
            }

            this.closeModal();
            // Switch tab to Raw Input
            if (window.gvpUIManager && window.gvpUIManager.switchTab) {
                window.gvpUIManager.switchTab('Prompt');
            }
        } else {
            alert('Could not find Raw Input textarea.');
        }
    }
};

window.Logger.info('UIChunkBuilder', '🧩 UIChunkBuilderManager.js file loaded');
