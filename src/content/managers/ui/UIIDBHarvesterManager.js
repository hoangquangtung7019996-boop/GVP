// UIIDBHarvesterManager.js - IDB Harvester Window
// Scans the unifiedHistory IndexedDB store to extract prompts and save them to the Prompt Library

window.UIIDBHarvesterManager = class UIIDBHarvesterManager {
    constructor(stateManager, uiHelpers, uiModalManager) {
        this.stateManager = stateManager;
        this.uiHelpers = uiHelpers || window.UIHelpers ? new window.UIHelpers() : null;
        this.uiModalManager = uiModalManager;
        this.modalOverlay = null;
        this.modalContent = null;

        this.historyEntries = []; // Fetched from unifiedHistory
        this.filteredEntries = [];
        this.page = 1;
        this.pageSize = 50;
        this.activeFilter = 'all'; // all, with_prompt, image_prompts, text_prompts
        this.selectedEntries = new Set(); // Set of history entry IDs
    }

    async loadHistory() {
        try {
            // Fetch everything from unifiedHistory. In a real environment, 
            // we'd probably want to paginate the IDB request itself if it's huge,
            // but for MVP we fetch all and paginate in memory.
            const accountId = this.stateManager.state?.multiGenHistory?.activeAccountId;
            if (!accountId) {
                window.Logger.warn('IDBHarvester', 'No active account ID found, cannot load history');
                this.historyEntries = [];
                this.filteredEntries = [];
                this.applyFilters();
                return;
            }
            const result = await this.stateManager.storageManager.indexedDBManager.getAllUnifiedEntries(accountId);

            const flattened = [];

            // Helper to extract attempts from any node
            const parseNode = (node, defaultSource = 'Video') => {
                if (node.attempts && Array.isArray(node.attempts)) {
                    for (const att of node.attempts) {
                        const promptText = att.prompt || att.videoPrompt || att.imagePrompt || node.prompt || '';
                        // Determine source type loosely based on attributes
                        let sourceType = defaultSource;
                        if (att.modelName && att.modelName.includes('imagine')) sourceType = 'Image';
                        else if (att.videoId || node.videoId) sourceType = 'Video';
                        else if (att.imagePrompt) sourceType = 'Image';

                        flattened.push({
                            id: att.id || this.stateManager._generateGuid('harv_att'),
                            createdAt: att.startedAt || node.createdAt || node.createTime,
                            prompt: promptText,
                            parentImageId: node.imageId,
                            sourceType: sourceType
                        });
                    }
                } else if (node.prompt || node.imagePrompt || node.videoPrompt) {
                    // fallback if no attempts array but text exists
                    let sourceType = defaultSource;
                    if (node.modelName && node.modelName.includes('imagine')) sourceType = 'Image';
                    else if (node.imagePrompt) sourceType = 'Image';

                    flattened.push({
                        id: node.id || node.imageId || this.stateManager._generateGuid('harv_parent'),
                        createdAt: node.createdAt || node.createTime,
                        prompt: node.prompt || node.imagePrompt || node.videoPrompt || '',
                        parentImageId: node.imageId,
                        sourceType: sourceType
                    });
                }
            };

            for (const parent of (result || [])) {
                // Parse top-level item (almost always video attempt historically)
                parseNode(parent, 'Video');

                // Also parse standard image edits if present
                if (parent.editedImages && Array.isArray(parent.editedImages)) {
                    for (const editedImg of parent.editedImages) {
                        parseNode(editedImg, 'Edited Image');
                    }
                }
            }

            // Filter out entries that don't have text
            this.historyEntries = flattened.filter(e => this._extractTextFromEntry(e).length > 0);

            // Deduplicate by text content, but keeping case-sensitivity
            // We'll also only drop it if it's the exact same prompt AND source type.
            const uniqueEntries = [];
            const seenKeys = new Set();
            for (const entry of this.historyEntries) {
                const text = this._extractTextFromEntry(entry);
                const key = `${entry.sourceType}::${text}`;
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    uniqueEntries.push(entry);
                }
            }
            this.historyEntries = uniqueEntries;

            // Sort by createdAt desc
            this.historyEntries.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

            window.Logger.info('UIIDBHarvester', 'Harvest completed', {
                rawExtracted: flattened.length,
                deduplicatedAndFiltered: this.historyEntries.length
            });

            this.applyFilters();
        } catch (error) {
            window.Logger.error('IDBHarvester', 'Failed to load history', error);
            this.historyEntries = [];
            this.filteredEntries = [];
        }
    }

    applyFilters() {
        if (this.activeFilter === 'all') {
            this.filteredEntries = [...this.historyEntries];
        } else if (this.activeFilter === 'with_prompt') {
            this.filteredEntries = this.historyEntries.filter(e => {
                const text = this._extractTextFromEntry(e);

                // Real prompt check: must have > 5 chars and NOT just be starting with `--` parameters
                // Some prompts might be "--mode=normal", we want to exclude those if they lack real text.
                if (!text || text.trim().length <= 5) return false;

                const trimmed = text.trim();

                // Exclude if it ONLY contains parameters (e.g. "--mode=extremely-spicy-or-crazy")
                // Check if removing all parameters leaves us with nothing but whitespace
                const strippedOfTags = trimmed.replace(/--[a-zA-Z0-9-]+\s*=?\s*[^\s]*/g, '').trim();

                if (strippedOfTags.length === 0) {
                    return false;
                }

                return true;
            });
        }
        this.page = 1;
        this.renderList();
    }

    _extractTextFromEntry(entry) {
        if (!entry) return '';
        // In v13 schema, text is directly on the entry as .prompt or .imagePrompt
        let text = entry.prompt || entry.imagePrompt || entry.videoPrompt || '';

        // Strip trailing parameter tags like --mode=custom
        text = text.replace(/(?:\s*--[a-zA-Z0-9-]+\s*(?:=\s*[^\s]+)?)*\s*$/g, '').trim();
        return text;
    }

    showHarvesterModal(onCompleteCallback = null) {
        if (this.modalOverlay) {
            this.modalOverlay.remove();
        }

        this.onCompleteCallback = onCompleteCallback;
        this.selectedEntries.clear();

        this.modalOverlay = document.createElement('div');
        this.modalOverlay.className = 'gvp-modal-overlay';
        this.modalOverlay.style.cssText = `
position: fixed; top: 0; left: 0; right: 0; bottom: 0;
background: rgba(0, 0, 0, 0.85); display: flex; align-items: center; justify-content: center;
z-index: 1000005; backdrop-filter: blur(4px);
`;

        this.modalContent = document.createElement('div');
        this.modalContent.style.cssText = `
            width: 1000px; max-width: 90vw; height: 80vh; max-height: 800px;
            background: #141414; border: 1px solid #48494b; border-radius: 12px;
            display: flex; flex-direction: column; overflow: hidden;
            box-shadow: 0 10px 40px rgba(0,0,0,0.8); font-family: inherit;
        `;

        // Load data before rendering main list
        this.loadHistory().then(() => {
            this.renderModal();
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

    renderModal() {
        if (!this.modalContent) return;
        this.modalContent.innerHTML = '';

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
padding: 16px 20px; border-bottom: 1px solid #48494b;
display: flex; justify-content: space-between; align-items: center;
`;

        const title = document.createElement('h2');
        title.textContent = '📦 IDB Harvester';
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

        // Toolbar
        const toolbar = document.createElement('div');
        toolbar.style.cssText = 'padding: 12px 20px; border-bottom: 1px solid #333; background: #1a1a1a; display: flex; justify-content: space-between; align-items: center;';

        const filterSelect = document.createElement('select');
        filterSelect.className = 'gvp-select';
        filterSelect.style.cssText = 'background: #212121; color: #fff; border: 1px solid #48494b; padding: 4px 8px; border-radius: 4px;';

        filterSelect.innerHTML = `
    <option value="all">All Generations</option>
        <option value="with_prompt">Valid Text Prompts</option>
`;
        filterSelect.value = this.activeFilter;
        filterSelect.onchange = (e) => {
            this.activeFilter = e.target.value;
            this.applyFilters();
        };

        const batchImportBtn = document.createElement('button');
        batchImportBtn.className = 'gvp-btn gvp-btn-primary';
        batchImportBtn.textContent = 'Import Selected';
        batchImportBtn.onclick = () => this.importSelected();

        toolbar.appendChild(filterSelect);
        if (!this.onCompleteCallback) {
            toolbar.appendChild(batchImportBtn);
        }

        // List Area
        this.listArea = document.createElement('div');
        this.listArea.style.cssText = 'flex: 1; overflow-y: auto; padding: 16px; background: #141414; display: flex; flex-direction: column; gap: 12px;';

        // Pagination Footer
        this.footer = document.createElement('div');
        this.footer.style.cssText = 'padding: 12px 20px; border-top: 1px solid #333; display: flex; justify-content: space-between; align-items: center; background: #1a1a1a;';

        this.modalContent.appendChild(header);
        this.modalContent.appendChild(toolbar);
        this.modalContent.appendChild(this.listArea);
        this.modalContent.appendChild(this.footer);

        this.renderList();
    }

    renderList() {
        if (!this.listArea) return;
        this.listArea.innerHTML = '';

        const total = this.filteredEntries.length;
        const totalPages = Math.ceil(total / this.pageSize) || 1;
        const startIndex = (this.page - 1) * this.pageSize;
        const endIndex = Math.min(startIndex + this.pageSize, total);
        const pageItems = this.filteredEntries.slice(startIndex, endIndex);

        if (total === 0) {
            this.listArea.innerHTML = '<div style="color:#a3a3a3; text-align:center; padding-top:40px;">No generation history found matching filters.</div>';
        } else {
            // Select All Row
            if (!this.onCompleteCallback) {
                const selAllRow = document.createElement('div');
                selAllRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding-left: 8px;';
                const selAllCb = document.createElement('input');
                selAllCb.type = 'checkbox';
                selAllCb.style.cursor = 'pointer';

                // Check if all current page items are selected
                const allPageSelected = pageItems.length > 0 && pageItems.every(item => this.selectedEntries.has(item.id));
                selAllCb.checked = allPageSelected;

                selAllCb.onchange = (e) => {
                    if (e.target.checked) {
                        pageItems.forEach(item => this.selectedEntries.add(item.id));
                    } else {
                        pageItems.forEach(item => this.selectedEntries.delete(item.id));
                    }
                    this.renderList(); // Re-render to update individual checkboxes
                };

                const selAllLabel = document.createElement('span');
                selAllLabel.textContent = 'Select All on Page';
                selAllLabel.style.cssText = 'color: #a3a3a3; font-size: 13px; cursor: pointer;';
                selAllLabel.onclick = () => selAllCb.click();

                selAllRow.appendChild(selAllCb);
                selAllRow.appendChild(selAllLabel);
                this.listArea.appendChild(selAllRow);
            }

            pageItems.forEach(entry => {
                const text = this._extractTextFromEntry(entry);
                if (!text) return; // skip items with no text

                const el = document.createElement('div');
                const isSelected = this.selectedEntries.has(entry.id);
                el.style.cssText = `
background: ${isSelected ? '#1f2937' : '#212121'};
border: 1px solid ${isSelected ? '#3b82f6' : '#48494b'};
border-radius: 6px; padding: 12px; display: flex; gap: 12px;
transition: border-color 0.2s, background-color 0.2s;
cursor: pointer;
`;

                // Checkbox
                const cbContainer = document.createElement('div');
                cbContainer.style.cssText = 'padding-top: 2px;';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = isSelected;
                cb.style.cursor = 'pointer';
                // Prevent event bubbling when clicking directly on checkbox
                cb.onclick = (e) => e.stopPropagation();
                cb.onchange = (e) => this.toggleSelection(entry.id, e.target.checked);
                if (!this.onCompleteCallback) cbContainer.appendChild(cb);

                // Content
                const contentDiv = document.createElement('div');
                contentDiv.style.cssText = 'flex: 1; min-width: 0;';

                const metaRow = document.createElement('div');
                metaRow.style.cssText = 'color: #737373; font-size: 11px; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;';
                const dateStr = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Unknown Date';

                let sourceTypeBadge = '';
                if (entry.sourceType === 'Image') {
                    sourceTypeBadge = `<span style="background: #27272a; border: 1px solid #52525b; color: #a1a1aa; padding: 1px 6px; border-radius: 12px; margin-right: 6px; font-weight: 500;">🖼️ Image</span>`;
                } else if (entry.sourceType === 'Edited Image') {
                    sourceTypeBadge = `<span style="background: #4a044e; border: 1px solid #d946ef; color: #f0abfc; padding: 1px 6px; border-radius: 12px; margin-right: 6px; font-weight: 500;">🎨 Edited Image</span>`;
                } else {
                    sourceTypeBadge = `<span style="background: #14532d; border: 1px solid #22c55e; color: #86efac; padding: 1px 6px; border-radius: 12px; margin-right: 6px; font-weight: 500;">🎬 Video</span>`;
                }

                metaRow.innerHTML = `<div>${sourceTypeBadge} <span> ID: ${String(entry.id).substring(0, 8)}...</span></div> <span>${dateStr}</span>`;

                const textPreview = document.createElement('div');
                textPreview.className = 'gvp-history-prompt-text';
                textPreview.textContent = text;
                textPreview.style.cssText = 'color: #e5e5e5; font-size: 13px; font-family: monospace; white-space: pre-wrap; word-break: break-word; line-height: 1.4; max-height: 80px; overflow-y: hidden; position: relative;';

                // Add fade out at bottom if long
                if (text.length > 200) {
                    const fade = document.createElement('div');
                    fade.style.cssText = 'position: absolute; bottom: 0; left: 0; right: 0; height: 20px; background: linear-gradient(transparent, #212121);';
                    // adjust fade color if selected
                    if (isSelected) fade.style.background = 'linear-gradient(transparent, #1f2937)';
                    textPreview.appendChild(fade);
                }

                contentDiv.appendChild(metaRow);
                contentDiv.appendChild(textPreview);

                // Actions
                const actionsDiv = document.createElement('div');
                actionsDiv.style.cssText = 'display: flex; flex-direction: column; gap: 8px; justify-content: center;';

                if (this.onCompleteCallback) {
                    const applyBtn = document.createElement('button');
                    applyBtn.className = 'gvp-btn gvp-btn-primary';
                    applyBtn.style.padding = '4px 8px';
                    applyBtn.textContent = '✔️ Editor';
                    applyBtn.onclick = (e) => {
                        e.stopPropagation();
                        this.onCompleteCallback(text);
                        this.closeModal();
                    };
                    actionsDiv.appendChild(applyBtn);
                } else {
                    const importSingleBtn = document.createElement('button');
                    importSingleBtn.className = 'gvp-btn';
                    importSingleBtn.style.padding = '4px 8px';
                    importSingleBtn.textContent = 'Import';
                    importSingleBtn.onclick = (e) => {
                        e.stopPropagation();
                        this.importPrompt(text, `Harvester: ${dateStr}`);
                    };
                    actionsDiv.appendChild(importSingleBtn);
                }

                el.appendChild(cbContainer);
                el.appendChild(contentDiv);
                el.appendChild(actionsDiv);

                // Make whole row clickable for selection
                if (!this.onCompleteCallback) {
                    el.onclick = () => {
                        cb.checked = !cb.checked;
                        this.toggleSelection(entry.id, cb.checked);
                    };
                }

                this.listArea.appendChild(el);
            });
        }

        // Render Footer Pagination
        if (!this.footer) return;
        this.footer.innerHTML = '';

        const selectionInfo = document.createElement('div');
        selectionInfo.style.cssText = 'color: #3b82f6; font-size: 13px; font-weight: bold;';
        if (!this.onCompleteCallback) {
            selectionInfo.textContent = `${this.selectedEntries.size} Selected`;
        }

        const pagination = document.createElement('div');
        pagination.style.cssText = 'display: flex; gap: 8px; align-items: center; color: #a3a3a3; font-size: 13px;';

        const prevBtn = document.createElement('button');
        prevBtn.textContent = '◀ Prev';
        prevBtn.className = 'gvp-btn';
        prevBtn.disabled = this.page <= 1;
        prevBtn.onclick = () => { if (this.page > 1) { this.page--; this.renderList(); } };

        const pageInfo = document.createElement('span');
        pageInfo.textContent = `Page ${this.page} of ${totalPages} (${total} total)`;

        const nextBtn = document.createElement('button');
        nextBtn.textContent = 'Next ▶';
        nextBtn.className = 'gvp-btn';
        nextBtn.disabled = this.page >= totalPages;
        nextBtn.onclick = () => { if (this.page < totalPages) { this.page++; this.renderList(); } };

        pagination.appendChild(prevBtn);
        pagination.appendChild(pageInfo);
        pagination.appendChild(nextBtn);

        this.footer.appendChild(selectionInfo);
        this.footer.appendChild(pagination);
    }

    toggleSelection(id, isSelected) {
        if (isSelected) {
            this.selectedEntries.add(id);
        } else {
            this.selectedEntries.delete(id);
        }
        // Partial re-render (just update footer and row styling if we wanted to be efficient,
        // but re-rendering list is fine for MVP)
        this.renderList();
    }

    async importPrompt(text, suggestedName) {
        const name = prompt('Name for imported prompt:', suggestedName);
        if (!name) return;

        const newPrompt = {
            id: this.stateManager._generateGuid('prompt'),
            name: name,
            type: 'video',
            folder_id: null,
            prompt: text,
            isPinned: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        try {
            await this.stateManager.savePrompt(newPrompt);
            alert('Imported!');
            const promptLibrary = window.gvpUIManager?.uiModalManager?.promptLibrary;
            if (promptLibrary && promptLibrary.refreshPromptList) {
                promptLibrary.refreshPromptList();
            }
        } catch (e) {
            console.error('Import failed', e);
            alert('Import failed.');
        }
    }

    async importSelected() {
        if (this.selectedEntries.size === 0) {
            alert('No entries selected.');
            return;
        }

        if (!confirm(`Import ${this.selectedEntries.size} prompts into the "Harvested" category?`)) {
            return;
        }

        try {
            let savedCount = 0;
            for (const id of this.selectedEntries) {
                const entry = this.historyEntries.find(e => e.id === id);
                if (!entry) continue;

                const text = this._extractTextFromEntry(entry);
                if (!text) continue;

                const dateStr = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Unknown';
                const newPrompt = {
                    id: this.stateManager._generateGuid('prompt'),
                    name: `Harvested: ${dateStr}`,
                    type: 'video',
                    folder_id: null,
                    prompt: text,
                    isPinned: false,
                    created_at: entry.createdAt ? new Date(entry.createdAt).toISOString() : new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };

                await this.stateManager.savePrompt(newPrompt);
                savedCount++;
            }

            alert(`Successfully saved ${savedCount} prompts to Library!`);

            this.selectedEntries.clear();
            this.renderList();

            const promptLibrary = window.gvpUIManager?.uiModalManager?.promptLibrary;
            if (promptLibrary && promptLibrary.refreshPromptList) {
                promptLibrary.refreshPromptList();
            }
        } catch (e) {
            console.error('Batch import failed', e);
            alert('Batch import encountered errors. Check console.');
        }
    }
};

