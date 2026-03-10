// UIPromptLibraryManager.js - Advanced Prompt Library Modal (V1.38.0 MVP)

window.UIPromptLibraryManager = class UIPromptLibraryManager {
    constructor(stateManager, shadowRoot, callbacks = {}) {
        this.stateManager = stateManager;
        this.shadowRoot = shadowRoot;
        this.callbacks = callbacks;

        this.state = {
            activeTab: 'video', // 'video' | 'image'
            searchQuery: '',
            sortOrder: 'newest',
            selectedPromptIds: new Set(),
            lastSelectedId: null,
            expandedFolders: new Set(),
            selectedFolderId: 'root', // 'root' = All
            isEditing: false
        };

        this.data = {
            prompts: [],
            folders: [],
            tags: [],
            versions: [],
            stats: null
        };

        this.dom = {};

        // Late-init reactivity: Refresh data if IDB becomes ready while modal is open
        this._boundHandleLateInit = async () => {
            if (this.state.isEditing) {
                window.Logger.info('PromptLibrary', '⚠️ Late IDB init detected, but user is editing. Skipping refresh to preserve draft.');
                return;
            }
            window.Logger.info('PromptLibrary', '📥 Late IDB init detected, refreshing data...');
            await this.loadData();
            if (this.dom.modal && this.dom.modal.parentElement) {
                this._renderAll();
            }
        };
        window.addEventListener('gvp:idb-late-init', this._boundHandleLateInit);
    }

    async render() {
        await this.loadData();
        this._buildDOM();
        this._renderAll();
    }

    async loadData() {
        this.data.prompts = await this.stateManager.getPrompts();
        this.data.folders = await this.stateManager.getFolders();
        this.data.tags = await this.stateManager.getPromptTags();
    }

    _buildDOM() {
        const modal = document.createElement('div');
        modal.id = 'gvp-prompt-library-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.85);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 999999;
            backdrop-filter: blur(4px);
        `;

        const panel = document.createElement('div');
        panel.id = 'gvp-prompt-library-panel';
        panel.style.cssText = `
            width: 1100px;
            max-width: 95vw;
            height: 800px;
            max-height: 95vh;
            background: #141414;
            border: 1px solid #48494b;
            border-radius: 12px;
            display: flex;
            flex-direction: column;
            box-shadow: 0 10px 40px rgba(0,0,0,0.8);
            overflow: hidden;
            font-family: inherit;
        `;

        // 1. Header & Tabs
        const header = document.createElement('div');
        header.style.cssText = `
            height: 60px;
            border-bottom: 1px solid #262626;
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0 24px;
            background: linear-gradient(180deg, #1f1f1f 0%, #141414 100%);
            flex-shrink: 0;
        `;

        const titleGroup = document.createElement('div');
        titleGroup.style.cssText = 'display: flex; gap: 24px; align-items: center;';

        const title = document.createElement('h2');
        title.textContent = '📚 Prompt Library';
        title.style.cssText = 'margin: 0; color: #fff; font-size: 18px; font-weight: 600;';

        const tabs = document.createElement('div');
        tabs.style.cssText = 'display: flex; gap: 16px; margin-top: 4px;';

        this.dom.tabVideo = this._createTab('🎬 Video', 'video');
        this.dom.tabImage = this._createTab('🖼️ Image', 'image');
        tabs.appendChild(this.dom.tabVideo);
        tabs.appendChild(this.dom.tabImage);

        // Backup & Restore Area
        const backupGroup = document.createElement('div');
        backupGroup.style.cssText = 'display: flex; gap: 8px; margin-left: auto; align-items: center; border-left: 1px solid #333; padding-left: 16px;';

        const exportBtn = document.createElement('button');
        exportBtn.innerHTML = '📤 Export Data';
        exportBtn.className = 'gvp-btn gvp-btn-secondary gvp-tooltip';
        exportBtn.title = 'Export Prompts, Chunks, and Swaps';
        exportBtn.style.cssText = 'padding: 4px 10px; font-size: 12px; background: #212121; border: 1px solid #48494b; color: #a3a3a3; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 4px;';
        exportBtn.onmouseover = () => { exportBtn.style.color = '#fff'; exportBtn.style.background = '#374151'; };
        exportBtn.onmouseout = () => { exportBtn.style.color = '#a3a3a3'; exportBtn.style.background = '#212121'; };
        exportBtn.onclick = () => this._exportData();

        const importBtn = document.createElement('button');
        importBtn.innerHTML = '📥 Import Data';
        importBtn.className = 'gvp-btn gvp-btn-secondary gvp-tooltip';
        importBtn.title = 'Import JSON data for Prompts, Chunks, or Swaps';
        importBtn.style.cssText = 'padding: 4px 10px; font-size: 12px; background: #212121; border: 1px solid #48494b; color: #a3a3a3; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 4px;';
        importBtn.onmouseover = () => { importBtn.style.color = '#fff'; importBtn.style.background = '#374151'; };
        importBtn.onmouseout = () => { importBtn.style.color = '#a3a3a3'; importBtn.style.background = '#212121'; };
        importBtn.onclick = () => this._importData();

        backupGroup.appendChild(exportBtn);
        backupGroup.appendChild(importBtn);

        titleGroup.appendChild(title);
        titleGroup.appendChild(tabs);
        titleGroup.appendChild(backupGroup);

        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '✕';
        closeBtn.style.cssText = 'background: transparent; border: none; color: #888; font-size: 20px; cursor: pointer; padding: 4px; border-radius: 4px;';
        closeBtn.onmouseover = () => { closeBtn.style.color = '#fff'; closeBtn.style.background = '#333'; }
        closeBtn.onmouseout = () => { closeBtn.style.color = '#888'; closeBtn.style.background = 'transparent'; }
        closeBtn.onclick = () => this.close();

        header.appendChild(titleGroup);
        header.appendChild(closeBtn);

        // 2. Main Layout (3 columns: Folders, List, Editor)
        const main = document.createElement('div');
        main.style.cssText = 'display: flex; flex: 1; min-height: 0;';

        // Col 1: Sidebar (Folders)
        const sidebar = document.createElement('div');
        sidebar.style.cssText = 'width: 220px; border-right: 1px solid #262626; display: flex; flex-direction: column; background: #1a1a1a; flex-shrink: 0; padding: 16px; overflow-y: auto;';
        this.dom.folderTree = document.createElement('div');
        sidebar.appendChild(this._createSidebarHeader());
        sidebar.appendChild(this.dom.folderTree);

        // Col 2: List
        const middleCol = document.createElement('div');
        middleCol.style.cssText = 'width: 320px; border-right: 1px solid #262626; display: flex; flex-direction: column; background: #141414; flex-shrink: 0;';

        const searchBarContainer = document.createElement('div');
        searchBarContainer.style.cssText = 'padding: 16px; border-bottom: 1px solid #262626;';
        this.dom.searchInput = document.createElement('input');
        this.dom.searchInput.type = 'text';
        this.dom.searchInput.placeholder = 'Search prompts...';
        this.dom.searchInput.style.cssText = 'width: 100%; padding: 8px 12px; background: #262626; border: 1px solid #404040; border-radius: 6px; color: #fff; font-size: 13px; outline: none; box-sizing: border-box;';
        this.dom.searchInput.addEventListener('input', (e) => {
            this.state.searchQuery = e.target.value.toLowerCase();
            this._renderList();
        });
        // Prevent key bubbling to main app
        this.dom.searchInput.addEventListener('keydown', e => e.stopPropagation());
        searchBarContainer.appendChild(this.dom.searchInput);

        this.dom.listContainer = document.createElement('div');
        this.dom.listContainer.style.cssText = 'flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;';

        const listFooter = document.createElement('div');
        listFooter.style.cssText = 'padding: 12px; border-top: 1px solid #262626; display: flex; justify-content: center; background: #1a1a1a;';
        const newBtn = document.createElement('button');
        newBtn.textContent = '➕ New Prompt';
        newBtn.className = 'gvp-button primary';
        newBtn.style.width = '100%';
        newBtn.onclick = () => this._createNewPrompt();
        listFooter.appendChild(newBtn);

        middleCol.appendChild(searchBarContainer);
        middleCol.appendChild(this.dom.listContainer);
        middleCol.appendChild(listFooter);

        // Col 3: Editor
        const rightCol = document.createElement('div');
        rightCol.style.cssText = 'flex: 1; display: flex; flex-direction: column; background: #1a1a1a; position: relative;';
        this.dom.editorContainer = document.createElement('div');
        this.dom.editorContainer.style.cssText = 'flex: 1; display: flex; flex-direction: column; padding: 24px; overflow-y: auto;';
        rightCol.appendChild(this.dom.editorContainer);

        main.appendChild(sidebar);
        main.appendChild(middleCol);
        main.appendChild(rightCol);

        panel.appendChild(header);
        panel.appendChild(main);
        modal.appendChild(panel);

        this.dom.modal = modal;
        this.dom.panel = panel;
        this.shadowRoot.appendChild(modal);
    }

    _createTab(label, type) {
        const tab = document.createElement('button');
        tab.textContent = label;
        tab.style.cssText = `
            background: transparent;
            border: none;
            color: ${this.state.activeTab === type ? '#4ade80' : '#888'};
            border-bottom: 2px solid ${this.state.activeTab === type ? '#4ade80' : 'transparent'};
            padding: 8px 4px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        `;
        tab.onclick = () => {
            if (this.state.activeTab !== type) {
                this.dom.tabVideo.style.color = '#888';
                this.dom.tabVideo.style.borderBottomColor = 'transparent';
                this.dom.tabImage.style.color = '#888';
                this.dom.tabImage.style.borderBottomColor = 'transparent';

                tab.style.color = '#4ade80';
                tab.style.borderBottomColor = '#4ade80';
                this.state.activeTab = type;
                this.state.selectedPromptIds.clear();
                this._renderAll();
            }
        };
        return tab;
    }

    _createSidebarHeader() {
        const hdr = document.createElement('div');
        hdr.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; color: #a3a3a3; font-size: 11px; text-transform: uppercase; font-weight: bold; letter-spacing: 0.05em;';
        hdr.textContent = 'Collections';

        const addFolderBtn = document.createElement('button');
        addFolderBtn.innerHTML = '➕';
        addFolderBtn.title = 'Add Folder';
        addFolderBtn.style.cssText = 'background: transparent; border: none; font-size: 12px; cursor: pointer; color: #888; padding: 4px; border-radius: 4px;';
        addFolderBtn.onmouseover = () => addFolderBtn.style.color = '#fff';
        addFolderBtn.onmouseout = () => addFolderBtn.style.color = '#888';
        addFolderBtn.onclick = () => this._createNewFolder();

        hdr.appendChild(addFolderBtn);
        return hdr;
    }

    _renderAll() {
        this._renderFolderTree();
        this._renderList();
        this._renderEditor();
    }

    _renderFolderTree() {
        this.dom.folderTree.innerHTML = '';

        // "All Prompts" root node
        const rootNode = this._buildFolderNode({ id: 'root', name: 'All Prompts', icon: '📁' }, true);
        this.dom.folderTree.appendChild(rootNode);

        // Build actual tree logic here (Phase 2).
        // For MVP, just list folders flatly
        this.data.folders.forEach(f => {
            const node = this._buildFolderNode(f);
            this.dom.folderTree.appendChild(node);
        });
    }

    _buildFolderNode(folder, isRoot = false) {
        const item = document.createElement('div');
        const isSelected = this.state.selectedFolderId === folder.id;

        item.style.cssText = `
            padding: 8px 12px;
            margin-bottom: 4px;
            border-radius: 6px;
            cursor: pointer;
            color: ${isSelected ? '#fff' : '#ccc'};
            background: ${isSelected ? '#262626' : 'transparent'};
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: background 0.2s;
        `;

        if (!isSelected) {
            item.onmouseover = () => item.style.background = '#212121';
            item.onmouseout = () => item.style.background = 'transparent';
        }

        item.onclick = () => {
            this.state.selectedFolderId = folder.id;
            this.state.selectedPromptIds.clear();
            this._renderAll();
        };

        const icon = document.createElement('span');
        icon.textContent = folder.icon || (isRoot ? '📚' : '📂');

        const label = document.createElement('span');
        label.textContent = folder.name;
        label.style.flex = '1';

        item.appendChild(icon);
        item.appendChild(label);

        // Count badge
        const count = isRoot ?
            this.data.prompts.filter(p => p.type === this.state.activeTab).length :
            this.data.prompts.filter(p => p.type === this.state.activeTab && p.folder_id === folder.id).length;

        if (count > 0) {
            const badge = document.createElement('span');
            badge.textContent = count;
            badge.style.cssText = 'background: #333; color: #888; font-size: 10px; padding: 2px 6px; border-radius: 10px;';
            item.appendChild(badge);
        }

        return item;
    }

    _renderList() {
        this.dom.listContainer.innerHTML = '';

        let filtered = this.data.prompts.filter(p => p.type === this.state.activeTab);

        if (this.state.selectedFolderId !== 'root') {
            filtered = filtered.filter(p => p.folder_id === this.state.selectedFolderId);
        }

        if (this.state.searchQuery) {
            filtered = filtered.filter(p =>
                (p.name && p.name.toLowerCase().includes(this.state.searchQuery)) ||
                (p.prompt && p.prompt.toLowerCase().includes(this.state.searchQuery))
            );
        }

        // Sort by newest
        filtered.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

        if (filtered.length === 0) {
            this.dom.listContainer.innerHTML = '<div style="color: #666; font-size: 13px; text-align: center; margin-top: 20px;">No prompts found</div>';
            return;
        }

        filtered.forEach(p => {
            this.dom.listContainer.appendChild(this._buildPromptListItem(p));
        });
    }

    _buildPromptListItem(prompt) {
        const item = document.createElement('div');
        item.dataset.promptId = prompt.id;
        const isSelected = this.state.selectedPromptIds.has(prompt.id);

        item.style.cssText = `
            padding: 12px;
            border-radius: 8px;
            cursor: pointer;
            background: ${isSelected ? '#262626' : '#1a1a1a'};
            border: 1px solid ${isSelected ? '#555' : '#262626'};
            transition: all 0.2s;
            display: flex;
            flex-direction: column;
            gap: 6px;
            user-select: none;
        `;

        if (!isSelected) {
            item.onmouseover = () => { item.style.border = '1px solid #444'; item.style.background = '#212121'; };
            item.onmouseout = () => { item.style.border = '1px solid #262626'; item.style.background = '#1a1a1a'; };
        }

        item.onclick = async (e) => {
            this.state.isEditing = false;

            const ids = Array.from(this.dom.listContainer.children).map(node => node.dataset.promptId);

            if (e.shiftKey && this.state.lastSelectedId) {
                const startIdx = ids.indexOf(this.state.lastSelectedId);
                const endIdx = ids.indexOf(prompt.id);
                if (startIdx !== -1 && endIdx !== -1) {
                    const min = Math.min(startIdx, endIdx);
                    const max = Math.max(startIdx, endIdx);
                    if (!e.ctrlKey && !e.metaKey) this.state.selectedPromptIds.clear();
                    for (let i = min; i <= max; i++) {
                        this.state.selectedPromptIds.add(ids[i]);
                    }
                }
            } else if (e.ctrlKey || e.metaKey) {
                if (this.state.selectedPromptIds.has(prompt.id)) {
                    this.state.selectedPromptIds.delete(prompt.id);
                } else {
                    this.state.selectedPromptIds.add(prompt.id);
                }
                this.state.lastSelectedId = prompt.id;
            } else {
                this.state.selectedPromptIds.clear();
                this.state.selectedPromptIds.add(prompt.id);
                this.state.lastSelectedId = prompt.id;
            }

            if (this.state.selectedPromptIds.size === 1) {
                const singleId = Array.from(this.state.selectedPromptIds)[0];
                this.data.stats = await this.stateManager.getPromptUsageStats(singleId);
            }

            this._renderList();
            this._renderEditor();
        };

        const headerRow = document.createElement('div');
        headerRow.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-start;';

        const title = document.createElement('div');
        title.style.cssText = `color: ${isSelected ? '#fff' : '#ccc'}; font-size: 14px; font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;`;
        title.textContent = prompt.name || 'Untitled Prompt';

        const pinBtn = document.createElement('button');
        pinBtn.innerHTML = prompt.isPinned ? '📌' : '📍';
        pinBtn.title = prompt.isPinned ? 'Unpin' : 'Pin to Tab';
        pinBtn.style.cssText = `background: transparent; border: none; cursor: pointer; padding: 2px; opacity: ${prompt.isPinned ? '1' : '0.3'}; transition: opacity 0.2s;`;
        if (isSelected) pinBtn.style.opacity = prompt.isPinned ? '1' : '0.6';
        pinBtn.onmouseover = () => { pinBtn.style.opacity = '1'; };
        pinBtn.onmouseout = () => { pinBtn.style.opacity = prompt.isPinned ? '1' : (isSelected ? '0.6' : '0.3'); };

        pinBtn.onclick = async (e) => {
            e.stopPropagation();
            prompt.isPinned = !prompt.isPinned;
            prompt.updated_at = new Date().toISOString();
            await this.stateManager.savePrompt(prompt);
            this._renderList();
        };

        headerRow.appendChild(title);
        headerRow.appendChild(pinBtn);

        const preview = document.createElement('div');
        preview.style.cssText = 'color: #888; font-size: 11px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;';
        preview.textContent = prompt.prompt || '';

        item.appendChild(headerRow);
        item.appendChild(preview);

        return item;
    }

    _renderEditor() {
        this.dom.editorContainer.innerHTML = '';

        if (this.state.selectedPromptIds.size === 0) {
            this.dom.editorContainer.innerHTML = '<div style="flex: 1; display: flex; align-items: center; justify-content: center; color: #555; font-size: 14px;">Select a prompt to view details</div>';
            return;
        }

        if (this.state.selectedPromptIds.size > 1) {
            const msg = document.createElement('div');
            msg.style.cssText = 'flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #fff; font-size: 18px;';
            msg.innerHTML = `<div style="margin-bottom: 20px;">${this.state.selectedPromptIds.size} Prompts Selected</div>`;

            const controlsRow = document.createElement('div');
            controlsRow.style.cssText = 'display: flex; gap: 16px; align-items: center; margin-top: 20px;';

            const folderSelect = this._createFolderMoveSelect(this.state.selectedPromptIds);

            const delBtn = document.createElement('button');
            delBtn.innerHTML = '🗑️ Delete Selected Prompts';
            delBtn.style.cssText = 'background: #3a1c1c; border: 1px solid #ef4444; color: #ef4444; border-radius: 4px; padding: 6px 12px; font-size: 14px; cursor: pointer; transition: all 0.2s;';
            delBtn.onmouseover = () => { delBtn.style.background = '#ef4444'; delBtn.style.color = '#fff'; };
            delBtn.onmouseout = () => { delBtn.style.background = '#3a1c1c'; delBtn.style.color = '#ef4444'; };

            delBtn.onclick = async () => {
                if (confirm(`Delete ${this.state.selectedPromptIds.size} prompts forever?`)) {
                    for (const id of this.state.selectedPromptIds) {
                        await this.stateManager.deletePrompt(id);
                    }
                    this.state.selectedPromptIds.clear();
                    await this.loadData();
                    this._renderAll();
                }
            };

            controlsRow.appendChild(folderSelect);
            controlsRow.appendChild(delBtn);
            msg.appendChild(controlsRow);

            this.dom.editorContainer.appendChild(msg);
            return;
        }

        const singleId = Array.from(this.state.selectedPromptIds)[0];
        const prompt = this.data.prompts.find(p => p.id === singleId);

        if (!prompt) {
            this.dom.editorContainer.innerHTML = '<div style="flex: 1; display: flex; align-items: center; justify-content: center; color: #555; font-size: 14px;">Select a prompt to view details</div>';
            return;
        }

        const hdr = document.createElement('div');
        hdr.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = prompt.name || '';
        nameInput.placeholder = 'Prompt Name';
        nameInput.style.cssText = 'background: transparent; border: none; border-bottom: 1px solid transparent; color: #fff; font-size: 20px; font-weight: bold; width: 100%; font-family: inherit; outline: none; padding-bottom: 4px;';
        nameInput.onfocus = () => { nameInput.style.borderBottomColor = '#4ade80'; this.state.isEditing = true; };
        nameInput.onblur = () => { nameInput.style.borderBottomColor = 'transparent'; };
        // Isolation
        nameInput.addEventListener('keydown', e => e.stopPropagation());

        const actionGroup = document.createElement('div');
        actionGroup.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end;';

        const createSysBtn = (icon, title, onClick) => {
            const btn = document.createElement('button');
            btn.className = 'gvp-btn gvp-btn-secondary gvp-tooltip';
            btn.style.cssText = 'padding: 6px 12px; font-size: 13px; display: flex; align-items: center; gap: 4px; border: 1px solid #48494b; background: #212121; border-radius: 4px; cursor: pointer; color: #e5e5e5;';
            btn.innerHTML = `${icon}`;
            btn.title = title;
            btn.onclick = onClick;
            btn.onmouseenter = () => { btn.style.backgroundColor = '#374151'; btn.style.borderColor = '#6b7280'; };
            btn.onmouseleave = () => { btn.style.backgroundColor = '#212121'; btn.style.borderColor = '#48494b'; };
            return btn;
        };

        const chunkBtn = createSysBtn('🧩', 'Chunk Builder', () => {
            if (window.gvpUIManager && window.gvpUIManager.uiChunkBuilderManager) {
                window.gvpUIManager.uiChunkBuilderManager.showBuilderModal(bodyText.value);
            } else {
                window.Logger.warn('PromptLibrary', 'Chunk Builder not available');
            }
        });

        const swapperBtn = createSysBtn('🔄', 'Word Swapper', () => {
            if (window.gvpUIManager && window.gvpUIManager.uiWordSwapperManager) {
                window.gvpUIManager.uiWordSwapperManager.showSwapperModal(bodyText.value);
            } else {
                window.Logger.warn('PromptLibrary', 'Word Swapper not available');
            }
        });

        const harvesterBtn = createSysBtn('📦', 'IDB Harvester', () => {
            if (window.gvpUIManager && window.gvpUIManager.uiIdbHarvesterManager) {
                window.gvpUIManager.uiIdbHarvesterManager.showHarvesterModal();
            } else {
                window.Logger.warn('PromptLibrary', 'IDB Harvester not available');
            }
        });

        const saveBtn = document.createElement('button');
        saveBtn.className = 'gvp-button primary';
        saveBtn.textContent = '💾 Save Changes';
        saveBtn.onclick = async () => {
            prompt.name = nameInput.value.trim();
            prompt.prompt = bodyText.value.trim();
            prompt.updated_at = new Date().toISOString();

            await this.stateManager.savePrompt(prompt);

            // Log version
            await this.stateManager.savePromptVersion({
                id: `v_${Date.now()}_${prompt.id}`,
                prompt_id: prompt.id,
                prompt_body: prompt.prompt,
                created_at: prompt.updated_at
            });

            this.state.isEditing = false;
            this._renderList();
            if (window.gvpUIManager && window.gvpUIManager.showToast) window.gvpUIManager.showToast('Prompt saved', 'success');
        };

        const loadBtn = document.createElement('button');
        loadBtn.className = 'gvp-button';
        loadBtn.innerHTML = '📤 Load to RAW';
        loadBtn.onclick = () => {
            if (this.callbacks && this.callbacks.onLoad) {
                this.callbacks.onLoad(prompt);
            } else {
                // Fallback direct load
                let textarea = document.getElementById('gvp-raw-input-textarea');
                if (!textarea && window.gvpUIManager?.shadowRoot) {
                    textarea = window.gvpUIManager.shadowRoot.getElementById('gvp-raw-input-textarea');
                }

                if (textarea) {
                    textarea.value = prompt.prompt;

                    // Dispatch input event for React
                    const event = new Event('input', { bubbles: true });
                    textarea.dispatchEvent(event);

                    if (window.gvpUIManager?.uiRawInputManager?.updateRawPreview) {
                        window.gvpUIManager.uiRawInputManager.updateRawPreview(prompt.prompt);
                    }
                    if (window.gvpUIManager?.showToast) window.gvpUIManager.showToast('Loaded to Editor', 'success');
                } else {
                    window.Logger.warn('PromptLibrary', 'Could not find RAW textarea for fallback load');
                }
            }
            this.close();
        };

        const delBtn = document.createElement('button');
        delBtn.innerHTML = '🗑️';
        delBtn.title = 'Delete';
        delBtn.style.cssText = 'background: #3a1c1c; border: 1px solid #ef4444; color: #ef4444; border-radius: 4px; padding: 6px 12px; cursor: pointer;';
        delBtn.onclick = async () => {
            if (confirm(`Delete "${prompt.name}" forever?`)) {
                await this.stateManager.deletePrompt(prompt.id);
                this.state.selectedPromptIds.delete(prompt.id);
                await this.loadData();
                this._renderAll();
            }
        };

        actionGroup.appendChild(chunkBtn);
        actionGroup.appendChild(swapperBtn);
        actionGroup.appendChild(harvesterBtn);
        actionGroup.appendChild(delBtn);
        actionGroup.appendChild(saveBtn);
        actionGroup.appendChild(loadBtn);

        hdr.appendChild(nameInput);

        const bodyLabel = document.createElement('div');
        bodyLabel.textContent = 'Prompt Content';
        bodyLabel.style.cssText = 'color: #888; font-size: 12px; margin-bottom: 8px; font-weight: bold;';

        const bodyText = document.createElement('textarea');
        bodyText.value = prompt.prompt || '';
        bodyText.style.cssText = 'width: 100%; height: 300px; resize: vertical; background: #111; border: 1px solid #333; border-radius: 8px; color: #e1e1e1; font-family: monospace; font-size: 13px; padding: 16px; box-sizing: border-box; outline: none; transition: border 0.2s;';
        bodyText.onfocus = () => { bodyText.style.border = '1px solid #4ade80'; this.state.isEditing = true; };
        bodyText.onblur = () => { bodyText.style.border = '1px solid #333'; };
        bodyText.addEventListener('keydown', e => e.stopPropagation());
        bodyText.addEventListener('keyup', e => e.stopPropagation());
        bodyText.addEventListener('keypress', e => e.stopPropagation());

        const statsRow = document.createElement('div');
        statsRow.style.cssText = 'display: flex; gap: 24px; margin-top: 24px; padding: 16px; background: #212121; border-radius: 8px; border: 1px solid #333;';

        const stats = this.data.stats || { useCount: 0, lastUsedAt: null };
        const uses = document.createElement('div');
        uses.innerHTML = `<div style="color: #888; font-size: 11px;">Total Uses</div><div style="color: #fff; font-size: 16px; font-weight: bold; margin-top: 4px;">${stats.useCount}</div>`;
        const lastUsed = document.createElement('div');
        const dt = stats.lastUsedAt ? new Date(stats.lastUsedAt).toLocaleString() : 'Never';
        lastUsed.innerHTML = `<div style="color: #888; font-size: 11px;">Last Used</div><div style="color: #fff; font-size: 14px; margin-top: 4px;">${dt}</div>`;

        statsRow.appendChild(uses);
        statsRow.appendChild(lastUsed);

        this.dom.editorContainer.appendChild(hdr);
        this.dom.editorContainer.appendChild(bodyLabel);
        this.dom.editorContainer.appendChild(bodyText);
        this.dom.editorContainer.appendChild(statsRow);

        // Footer: Contains Folder Mover and Actions
        const footerRow = document.createElement('div');
        footerRow.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-end; margin-top: 16px; padding-top: 16px; border-top: 1px solid #333; gap: 16px;';

        const folderSelect = this._createFolderMoveSelect(this.state.selectedPromptIds);

        footerRow.appendChild(folderSelect);
        footerRow.appendChild(actionGroup);

        this.dom.editorContainer.appendChild(footerRow);
    }

    _createFolderMoveSelect(promptIds) {
        const container = document.createElement('div');
        container.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-shrink: 0;';

        const label = document.createElement('span');
        label.textContent = 'Move to Folder:';
        label.style.cssText = 'color: #a3a3a3; font-size: 12px; font-weight: bold;';

        const select = document.createElement('select');
        select.className = 'gvp-select';
        select.style.cssText = 'background: #111; color: #fff; border: 1px solid #48494b; padding: 6px 10px; border-radius: 4px; font-size: 13px; outline: none; cursor: pointer; min-width: 150px;';

        const rootOpt = document.createElement('option');
        rootOpt.value = 'root';
        rootOpt.textContent = '📁 No Folder (Root)';
        select.appendChild(rootOpt);

        this.data.folders.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.id;
            opt.textContent = `📁 ${f.name}`;
            select.appendChild(opt);
        });

        // If single prompt selected, set initial value to its folder
        if (promptIds.size === 1) {
            const id = Array.from(promptIds)[0];
            const p = this.data.prompts.find(x => x.id === id);
            if (p && p.folder_id) {
                select.value = p.folder_id;
            }
        } else {
            select.value = 'root'; // default for batch
        }

        select.onchange = async (e) => {
            const targetFolder = e.target.value === 'root' ? null : e.target.value;
            let movedCount = 0;
            for (const id of promptIds) {
                const p = this.data.prompts.find(x => x.id === id);
                if (p && p.folder_id !== targetFolder) {
                    p.folder_id = targetFolder;
                    p.updated_at = new Date().toISOString();
                    await this.stateManager.savePrompt(p);
                    movedCount++;
                }
            }
            if (movedCount > 0) {
                if (window.gvpUIManager?.showToast) window.gvpUIManager.showToast(`Moved ${movedCount} prompt(s)`, 'success');
                await this.loadData();
                this._renderAll();
            }
        };

        container.appendChild(label);
        container.appendChild(select);
        return container;
    }

    async _createNewPrompt() {
        const newPrompt = {
            id: `prompt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            type: this.state.activeTab,
            folder_id: this.state.selectedFolderId === 'root' ? null : this.state.selectedFolderId,
            name: 'New Prompt',
            prompt: '',
            isPinned: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        await this.stateManager.savePrompt(newPrompt);
        await this.loadData();
        this.state.selectedPromptIds.clear();
        this.state.selectedPromptIds.add(newPrompt.id);
        this.state.lastSelectedId = newPrompt.id;
        this._renderAll();
    }

    async _createNewFolder() {
        const title = prompt("Enter folder name:");
        if (!title) return;

        const newFolder = {
            id: `folder_${Date.now()}`,
            name: title.trim(),
            created_at: new Date().toISOString()
        };
        await this.stateManager.saveFolder(newFolder);
        await this.loadData();
        this._renderFolderTree();
    }

    async _exportData() {
        try {
            // Get data fresh from DB
            const promptsRaw = await this.stateManager.storageManager.indexedDBManager.getAll('prompts');
            const chunksRaw = await this.stateManager.storageManager.indexedDBManager.getAll('chunks');
            const swapsRaw = await this.stateManager.storageManager.indexedDBManager.getAll('swap_rules');
            const foldersRaw = await this.stateManager.storageManager.indexedDBManager.getAll('folders');

            // Formulate schemas
            const promptData = {
                type: 'gvp_prompts',
                version: 1,
                exported_at: new Date().toISOString(),
                prompts: promptsRaw || [],
                folders: foldersRaw || []
            };

            const chunkData = {
                type: 'gvp_chunks',
                version: 1,
                exported_at: new Date().toISOString(),
                chunks: chunksRaw || []
            };

            const swapData = {
                type: 'gvp_swap_rules',
                version: 1,
                exported_at: new Date().toISOString(),
                swap_rules: swapsRaw || []
            };

            const dateStr = new Date().toISOString().split('T')[0];

            this._downloadJson(promptData, `gvp_prompts_${dateStr}.json`);
            this._downloadJson(chunkData, `gvp_chunks_${dateStr}.json`);
            this._downloadJson(swapData, `gvp_word_swaps_${dateStr}.json`);

            if (window.gvpUIManager?.showToast) window.gvpUIManager.showToast('Exported 3 files', 'success');
        } catch (e) {
            window.Logger.error('PromptLibrary', 'Export failed', e);
            if (window.gvpUIManager?.showToast) window.gvpUIManager.showToast('Export failed', 'error');
        }
    }

    _downloadJson(data, filename) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    _importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.multiple = true;

        input.onchange = async (e) => {
            const files = Array.from(e.target.files);
            if (!files.length) return;

            let promptsAdded = 0;
            let chunksAdded = 0;
            let swapsAdded = 0;

            for (const file of files) {
                try {
                    const text = await file.text();
                    const json = JSON.parse(text);

                    // Auto-detect format based on schema
                    if (json.type === 'gvp_prompts' && Array.isArray(json.prompts)) {
                        for (const p of json.prompts) await this.stateManager.storageManager.indexedDBManager.put('prompts', p);
                        if (Array.isArray(json.folders)) {
                            for (const f of json.folders) await this.stateManager.storageManager.indexedDBManager.put('folders', f);
                        }
                        promptsAdded += json.prompts.length;
                    }
                    else if (json.type === 'gvp_chunks' && Array.isArray(json.chunks)) {
                        for (const c of json.chunks) await this.stateManager.storageManager.indexedDBManager.put('chunks', c);
                        chunksAdded += json.chunks.length;
                    }
                    else if (json.type === 'gvp_swap_rules' && Array.isArray(json.swap_rules)) {
                        for (const s of json.swap_rules) await this.stateManager.storageManager.indexedDBManager.put('swap_rules', s);
                        swapsAdded += json.swap_rules.length;
                    }
                    // Support legacy flat-array fallbacks if LLM generates raw arrays
                    else if (Array.isArray(json) && json.length > 0) {
                        const first = json[0];
                        if (first.prompt && first.folder_id !== undefined) {
                            for (const p of json) await this.stateManager.storageManager.indexedDBManager.put('prompts', p);
                            promptsAdded += json.length;
                        } else if (first.text && first.category) {
                            for (const c of json) await this.stateManager.storageManager.indexedDBManager.put('chunks', c);
                            chunksAdded += json.length;
                        } else if (first.swap_orig !== undefined) {
                            for (const s of json) await this.stateManager.storageManager.indexedDBManager.put('swap_rules', s);
                            swapsAdded += json.length;
                        } else {
                            alert(`Could not auto-detect schema for array in ${file.name}`);
                        }
                    } else {
                        alert(`Unrecognized format in ${file.name}`);
                    }
                } catch (err) {
                    window.Logger.error('PromptLibrary', `Failed parsing ${file.name}`, err);
                    alert(`Error reading ${file.name} - see console.`);
                }
            }

            // Sync and refresh
            let msg = 'Import complete:';
            if (promptsAdded) msg += ` ${promptsAdded} prompts`;
            if (chunksAdded) msg += ` ${chunksAdded} chunks`;
            if (swapsAdded) msg += ` ${swapsAdded} swaps`;

            alert(msg);

            await this.loadData();
            this._renderAll();
        };

        input.click();
    }

    close() {
        if (this.dom.modal) {
            this.dom.modal.remove();
        }
        // Force refresh raw tab accordion if available
        if (window.gvpUIManager && window.gvpUIManager.uiRawInputManager) {
            window.gvpUIManager.uiRawInputManager.refreshSavedPromptStates();
        }
    }

    destroy() {
        this.close();
        window.removeEventListener('gvp:idb-late-init', this._boundHandleLateInit);
        window.Logger.info('PromptLibrary', 'Destroyed');
    }
}
