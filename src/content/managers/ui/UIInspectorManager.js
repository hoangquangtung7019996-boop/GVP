// src/content/managers/ui/UIInspectorManager.js
// Visual Interface for Inspection Suite (Config, Generation, Post)

window.UIInspectorManager = class UIInspectorManager {
    constructor(inspectionManager, shadowRoot, networkInterceptor) {
        this.inspectionManager = inspectionManager;
        this.shadowRoot = shadowRoot;
        // ROBUST FALLBACK: Try constructor arg -> global instance -> global window
        this.networkInterceptor = networkInterceptor ||
            (window.gvpAppInstance && window.gvpAppInstance.networkInterceptor) ||
            (window.gvpNetworkInterceptor);

        this.activeTab = 'config'; // config | generation | post
        this.modal = null;

        // Shift-click comparison: track up to 2 selected entries
        this.selectedForCompare = []; // Array of { index, entry }

        window.Logger.info('UIInspector', 'Manager instantiated', { hasNetworkInterceptor: !!this.networkInterceptor });
    }

    show(defaultTab = 'config', autoFetchPost = false) {
        this.activeTab = defaultTab;
        if (!this.modal) {
            this._createModal();
        }

        this.modal.classList.add('visible');
        this._switchTab(defaultTab);

        if (autoFetchPost && defaultTab === 'post') {
            this._triggerPostFetch();
        }
    }

    hide() {
        if (this.modal) {
            this.modal.classList.remove('visible');
        }
    }

    _createModal() {
        const modal = document.createElement('div');
        modal.id = 'gvp-inspector-modal';
        modal.className = 'gvp-modal'; // Inherit generic modal styles if available

        // Modal Content Container
        const content = document.createElement('div');
        content.id = 'gvp-inspector-content';

        // Header
        const header = document.createElement('div');
        header.className = 'gvp-inspector-header';

        const title = document.createElement('div');
        title.className = 'gvp-inspector-title';
        title.textContent = '🔍 Inspection Suite';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'gvp-inspector-close';
        closeBtn.innerHTML = '×';
        closeBtn.onclick = () => this.hide();

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Tabs
        const tabsRow = document.createElement('div');
        tabsRow.className = 'gvp-inspector-tabs';

        ['config', 'generation', 'post'].forEach(key => {
            const btn = document.createElement('button');
            btn.className = 'gvp-inspector-tab-btn';
            btn.dataset.tab = key;
            btn.textContent = key.charAt(0).toUpperCase() + key.slice(1);
            btn.onclick = () => this._switchTab(key);
            tabsRow.appendChild(btn);
        });

        header.appendChild(tabsRow);
        content.appendChild(header);

        // Main Body (Split View)
        const body = document.createElement('div');
        body.className = 'gvp-inspector-body';

        // Sidebar (History List)
        const sidebar = document.createElement('div');
        sidebar.className = 'gvp-inspector-sidebar';
        sidebar.id = 'gvp-inspector-list';

        // Main View (JSON/Diff)
        const main = document.createElement('div');
        main.className = 'gvp-inspector-main';
        main.id = 'gvp-inspector-detail';

        body.appendChild(sidebar);
        body.appendChild(main);
        content.appendChild(body);

        modal.appendChild(content);

        // Append CSS styles specific to Inspector
        const style = document.createElement('style');
        style.textContent = `
            #gvp-inspector-modal {
                position: fixed;
                top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(0,0,0,0.8);
                z-index: 99999;
                display: none;
                justify-content: center;
                align-items: center;
                backdrop-filter: blur(5px);
            }
            #gvp-inspector-modal.visible {
                display: flex;
            }
            #gvp-inspector-content {
                width: 90vw;
                height: 90vh;
                background: #141414;
                border: 1px solid #333;
                border-radius: 12px;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                box-shadow: 0 0 40px rgba(0,0,0,0.5);
            }
            .gvp-inspector-header {
                padding: 16px;
                border-bottom: 1px solid #333;
                background: #1c1c1c;
            }
            .gvp-inspector-title {
                font-size: 18px;
                font-weight: bold;
                color: #fff;
                margin-bottom: 12px;
            }
            .gvp-inspector-close {
                position: absolute;
                top: 16px; right: 16px;
                background: none; border: none;
                color: #888; font-size: 24px; cursor: pointer;
            }
            .gvp-inspector-tabs {
                display: flex; gap: 8px;
            }
            .gvp-inspector-tab-btn {
                padding: 8px 16px;
                background: transparent;
                border: 1px solid #333;
                color: #888;
                cursor: pointer;
                border-radius: 6px;
                transition: all 0.2s;
            }
            .gvp-inspector-tab-btn.active {
                background: #444;
                color: white;
                border-color: #555;
            }
            .gvp-inspector-body {
                flex: 1;
                display: flex;
                overflow: hidden;
            }
            .gvp-inspector-sidebar {
                width: 250px;
                background: #111;
                border-right: 1px solid #333;
                overflow-y: auto;
                padding: 12px;
            }
            .gvp-inspector-main {
                flex: 1;
                background: #0d0d0d;
                overflow-y: auto;
                padding: 24px;
                font-family: monospace;
            }
            
            /* History Items */
            .gvp-hist-item {
                padding: 10px;
                border-bottom: 1px solid #222;
                cursor: pointer;
                border-radius: 4px;
                margin-bottom: 4px;
            }
            .gvp-hist-item:hover { background: #1f1f1f; }
            .gvp-hist-item.active { background: #2a2a2a; border-left: 3px solid #3b82f6; }
            .gvp-hist-ts { font-size: 11px; color: #666; }
            .gvp-hist-lbl { font-size: 13px; color: #ddd; font-weight: 500; }
            .gvp-hist-badge { 
                font-size: 10px; padding: 2px 6px; border-radius: 4px; 
                margin-top: 4px; display: inline-block;
            }
            .badge-diff { background: rgba(234, 179, 8, 0.2); color: #facc15; }
            
            /* Action Buttons Row */
            .gvp-hist-actions {
                display: flex;
                gap: 6px;
                margin-top: 8px;
                flex-wrap: wrap;
            }
            .gvp-hist-actions button {
                padding: 4px 8px;
                font-size: 10px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-weight: 500;
                transition: opacity 0.2s;
            }
            .gvp-hist-actions button:hover { opacity: 0.85; }
            .gvp-btn-json { background: #3b82f6; color: white; }
            .gvp-btn-diff-prev { background: #10b981; color: white; }
            .gvp-btn-diff-latest { background: #f59e0b; color: black; }
            
            /* Shift-Click Selection for Comparison */
            .gvp-compare-selected {
                border: 2px solid #8b5cf6 !important;
                background: rgba(139, 92, 246, 0.15) !important;
            }
            
            /* Diff Viewer */
            .gvp-diff-container { font-size: 13px; line-height: 1.5; color: #ccc; }
            .gvp-diff-row { padding: 4px 8px; border-bottom: 1px solid #1a1a1a; }
            .diff-removed { background: rgba(239, 68, 68, 0.15); border-left: 3px solid #ef4444; color: #fca5a5; text-decoration: line-through; opacity: 0.8; }
            .diff-added { background: rgba(34, 197, 94, 0.15); border-left: 3px solid #22c55e; color: #86efac; }
            .diff-changed { background: rgba(234, 179, 8, 0.15); border-left: 3px solid #eab308; }
            .diff-key { color: #fff; font-weight: bold; }
            .diff-val { color: #aaa; }
            
            .gvp-json-tree { white-space: pre-wrap; color: #a3a3a3; }
        `;

        modal.appendChild(style);
        this.shadowRoot.appendChild(modal);
        this.modal = modal;
    }

    _switchTab(tabName) {
        this.activeTab = tabName;
        // Update tab styling
        this.modal.querySelectorAll('.gvp-inspector-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        this._renderHistoryList();
    }

    _renderHistoryList() {
        const listContainer = this.modal.querySelector('#gvp-inspector-list');
        listContainer.innerHTML = '';

        const history = this.inspectionManager.getHistory(this.activeTab);

        if (this.activeTab === 'post') {
            // Add "Fetch Current" button for Post
            const fetchBtn = document.createElement('button');
            fetchBtn.className = 'gvp-button';
            fetchBtn.textContent = '⚡ Inspect Current URL';
            fetchBtn.style.marginBottom = '12px';
            fetchBtn.style.width = '100%';
            fetchBtn.onclick = () => this._triggerPostFetch();
            listContainer.appendChild(fetchBtn);
        } else if (this.activeTab === 'config') {
            // Button Row (Import + Export)
            const btnRow = document.createElement('div');
            btnRow.style.display = 'flex';
            btnRow.style.gap = '8px';
            btnRow.style.marginBottom = '8px';

            // Import Button
            const importBtn = document.createElement('button');
            importBtn.className = 'gvp-button secondary';
            importBtn.textContent = '📥 Import';
            importBtn.style.flex = '1';

            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.json,.txt,.html';
            fileInput.style.display = 'none';
            fileInput.onchange = (e) => this._handleImport(e);

            importBtn.onclick = () => fileInput.click();

            // Export Button
            const exportBtn = document.createElement('button');
            exportBtn.className = 'gvp-button secondary';
            exportBtn.textContent = '📤 Export';
            exportBtn.style.flex = '1';
            exportBtn.onclick = () => this.inspectionManager.exportConfigHistory();

            btnRow.appendChild(importBtn);
            btnRow.appendChild(exportBtn);

            listContainer.appendChild(btnRow);
            listContainer.appendChild(fileInput);

            // Compare Selected Button (hidden until 2 items selected)
            const compareBtn = document.createElement('button');
            compareBtn.id = 'gvp-compare-selected-btn';
            compareBtn.className = 'gvp-button';
            compareBtn.textContent = '🔀 Compare Selected (0/2)';
            compareBtn.style.cssText = 'width:100%; margin-bottom:12px; display:none; background:#8b5cf6;';
            compareBtn.onclick = () => this._compareSelected();
            listContainer.appendChild(compareBtn);

            // Clear selection on tab switch
            this.selectedForCompare = [];
        }

        if (history.length === 0) {
            const empty = document.createElement('div');
            empty.style.color = '#555';
            empty.style.padding = '10px';
            empty.style.textAlign = 'center';
            empty.textContent = 'No history yet.';
            listContainer.appendChild(empty);
            this._renderDetail(null);
            return;
        }

        history.forEach((entry, index) => {
            const el = document.createElement('div');
            el.className = 'gvp-hist-item';
            if (index === 0) el.classList.add('active'); // Select first by default

            const date = new Date(entry.timestamp);
            const tsStr = date.toLocaleTimeString() + ' ' + date.toLocaleDateString();

            let label = `entry_${index}`;
            if (this.activeTab === 'config') label = index === 0 ? '🚀 Latest Config' : `Version -${index}`;
            if (this.activeTab === 'post') label = entry.id.substring(0, 8) + '...';
            if (this.activeTab === 'generation') label = entry.mode + ' (' + entry.id.substring(0, 6) + ')';

            let diffBadge = '';
            if (entry.diff && entry.diff.length > 0) {
                const added = entry.diff.filter(d => d.type === 'added').length;
                const removed = entry.diff.filter(d => d.type === 'removed').length;
                const changed = entry.diff.filter(d => d.type === 'changed').length;
                diffBadge = `<div class="gvp-hist-badge badge-diff">Δ ${added + removed + changed} changes</div>`;
            }

            el.innerHTML = `
                <div class="gvp-hist-lbl">${label}</div>
                <div class="gvp-hist-ts">${tsStr}</div>
                ${diffBadge}
                <div class="gvp-hist-actions">
                    <button class="gvp-btn-json" title="View JSON">👁️ JSON</button>
                    ${index < history.length - 1 ? '<button class="gvp-btn-diff-prev" title="Compare with previous version">📊 Diff w/ Prev</button>' : ''}
                    ${index > 0 ? '<button class="gvp-btn-diff-latest" title="Compare with latest version">⚖️ Diff w/ Latest</button>' : ''}
                </div>
            `;

            // Bind action button events
            const jsonBtn = el.querySelector('.gvp-btn-json');
            if (jsonBtn) {
                jsonBtn.onclick = (e) => {
                    e.stopPropagation();
                    this._renderDetail(entry, 'json');
                };
            }

            const diffPrevBtn = el.querySelector('.gvp-btn-diff-prev');
            if (diffPrevBtn && index < history.length - 1) {
                diffPrevBtn.onclick = (e) => {
                    e.stopPropagation();
                    this._renderDiffReport(entry.raw, history[index + 1].raw, 'vs Previous');
                };
            }

            const diffLatestBtn = el.querySelector('.gvp-btn-diff-latest');
            if (diffLatestBtn && index > 0) {
                diffLatestBtn.onclick = (e) => {
                    e.stopPropagation();
                    this._renderDiffReport(history[0].raw, entry.raw, 'vs Latest');
                };
            }

            el.onclick = (e) => {
                if (e.shiftKey) {
                    // SHIFT-CLICK: Toggle selection for comparison
                    this._toggleSelection(index, entry, el);
                } else {
                    // Regular click: just view this entry
                    this.modal.querySelectorAll('.gvp-hist-item').forEach(i => i.classList.remove('active'));
                    el.classList.add('active');
                    this._renderDetail(entry);
                }
            };

            listContainer.appendChild(el);
        });

        // Default render first item
        this._renderDetail(history[0]);
    }

    async _handleImport(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            let json;
            try {
                json = JSON.parse(text);
            } catch (e) {
                alert('Invalid JSON file');
                return;
            }

            const count = await this.inspectionManager.importConfigHistory(json);
            alert(`Imported ${count} entries successfully.`);
            this._renderHistoryList();
        } catch (error) {
            console.error(error);
            alert('Import failed: ' + error.message);
        }
    }

    _renderDetail(entry) {
        const container = this.modal.querySelector('#gvp-inspector-detail');
        container.innerHTML = '';

        if (!entry) {
            container.innerHTML = '<div style="color:#444; padding:20px;">Select an item to view details</div>';
            return;
        }

        // 1. Diff View Section
        if (entry.diff && entry.diff.length > 0) {
            const diffHeader = document.createElement('h3');
            diffHeader.textContent = 'Changes vs Previous';
            diffHeader.style.color = '#fff';
            diffHeader.style.marginTop = '0';
            container.appendChild(diffHeader);

            const diffContainer = document.createElement('div');
            diffContainer.className = 'gvp-diff-container';

            entry.diff.forEach(d => {
                const row = document.createElement('div');
                row.className = `gvp-diff-row diff-${d.type}`;

                let content = '';
                if (d.type === 'added') {
                    content = `<span class="diff-key">+ ${d.key}</span>: <span class="diff-val">${this._valStr(d.val)}</span>`;
                } else if (d.type === 'removed') {
                    content = `<span class="diff-key">- ${d.key}</span>: <span class="diff-val">${this._valStr(d.val)}</span>`;
                } else {
                    content = `<span class="diff-key">~ ${d.key}</span>: <span class="diff-val">${this._valStr(d.oldVal)} ➔ ${this._valStr(d.newVal)}</span>`;
                }

                row.innerHTML = content;
                diffContainer.appendChild(row);
            });

            container.appendChild(diffContainer);
            container.appendChild(document.createElement('hr')); // Separator
        } else if (this.activeTab === 'config') {
            container.innerHTML += '<div style="color: #44aa44; margin-bottom: 20px;">✅ No changes detected vs previous version</div><hr>';
        }

        // 2. Full JSON View (Collapsible Tree)
        const jsonHeader = document.createElement('h3');
        jsonHeader.textContent = 'Full Payload';
        jsonHeader.style.color = '#fff';
        container.appendChild(jsonHeader);

        const treeContainer = document.createElement('div');
        treeContainer.className = 'gvp-json-tree';
        // Use clean config if available, otherwise raw
        const displayData = entry.clean || entry.raw;
        this._renderJsonTree(displayData, treeContainer, 0, true);
        container.appendChild(treeContainer);
    }

    _valStr(val) {
        if (typeof val === 'object') return JSON.stringify(val).substring(0, 50) + (JSON.stringify(val).length > 50 ? '...' : '');
        return String(val);
    }

    /**
     * Render a collapsible JSON tree recursively
     * @param {any} data - The data to render
     * @param {HTMLElement} container - Container to append to
     * @param {number} depth - Current depth (for indentation and collapse state)
     * @param {boolean} expanded - Whether this level starts expanded
     * @param {string} key - Optional key name (for object properties)
     */
    _renderJsonTree(data, container, depth = 0, expanded = false, key = null) {
        const indent = depth * 16;

        if (data === null) {
            this._renderPrimitive(container, key, 'null', '#888', indent);
            return;
        }

        if (Array.isArray(data)) {
            this._renderCollapsible(container, key, data, 'array', depth, expanded, indent);
        } else if (typeof data === 'object') {
            this._renderCollapsible(container, key, data, 'object', depth, expanded, indent);
        } else {
            // Primitive value
            let color = '#a3a3a3';
            let displayVal = String(data);

            if (typeof data === 'string') {
                color = '#a5d6a7'; // Green for strings
                displayVal = `"${data}"`;
            } else if (typeof data === 'number') {
                color = '#90caf9'; // Blue for numbers
            } else if (typeof data === 'boolean') {
                color = '#ffcc80'; // Orange for booleans
            }

            this._renderPrimitive(container, key, displayVal, color, indent);
        }
    }

    _renderPrimitive(container, key, value, color, indent) {
        const line = document.createElement('div');
        line.style.cssText = `padding-left:${indent}px; font-family:monospace; font-size:12px; line-height:1.6;`;

        if (key !== null) {
            line.innerHTML = `<span style="color:#82b1ff;">"${key}"</span>: <span style="color:${color};">${this._escapeHtml(value)}</span>`;
        } else {
            line.innerHTML = `<span style="color:${color};">${this._escapeHtml(value)}</span>`;
        }
        container.appendChild(line);
    }

    _renderCollapsible(container, key, data, type, depth, expanded, indent) {
        const isArray = type === 'array';
        const entries = isArray ? data : Object.entries(data);
        const count = isArray ? data.length : Object.keys(data).length;
        const openBracket = isArray ? '[' : '{';
        const closeBracket = isArray ? ']' : '}';

        // Header line with toggle
        const header = document.createElement('div');
        header.style.cssText = `padding-left:${indent}px; font-family:monospace; font-size:12px; line-height:1.6; cursor:pointer; user-select:none;`;

        const arrow = expanded ? '▼' : '▶';
        const keyPart = key !== null ? `<span style="color:#82b1ff;">"${key}"</span>: ` : '';
        const preview = expanded ? '' : ` <span style="color:#666;">// ${count} items</span>`;
        header.innerHTML = `<span class="gvp-tree-toggle" style="color:#888;">${arrow}</span> ${keyPart}<span style="color:#fff;">${openBracket}</span>${preview}`;

        // Child container
        const childContainer = document.createElement('div');
        childContainer.style.display = expanded ? 'block' : 'none';

        // Closing bracket
        const footer = document.createElement('div');
        footer.style.cssText = `padding-left:${indent}px; font-family:monospace; font-size:12px; line-height:1.6;`;
        footer.innerHTML = `<span style="color:#fff;">${closeBracket}</span>`;
        footer.style.display = expanded ? 'block' : 'none';

        // Toggle handler
        header.onclick = () => {
            const isExpanded = childContainer.style.display !== 'none';
            childContainer.style.display = isExpanded ? 'none' : 'block';
            footer.style.display = isExpanded ? 'none' : 'block';
            header.querySelector('.gvp-tree-toggle').textContent = isExpanded ? '▶' : '▼';

            // Update preview
            if (isExpanded) {
                header.innerHTML = `<span class="gvp-tree-toggle" style="color:#888;">▶</span> ${keyPart}<span style="color:#fff;">${openBracket}</span> <span style="color:#666;">// ${count} items</span>`;
            } else {
                header.innerHTML = `<span class="gvp-tree-toggle" style="color:#888;">▼</span> ${keyPart}<span style="color:#fff;">${openBracket}</span>`;
            }
        };

        container.appendChild(header);

        // Render children (start collapsed at depth > 0)
        const childExpanded = depth < 1;
        if (isArray) {
            data.forEach((item, i) => {
                this._renderJsonTree(item, childContainer, depth + 1, childExpanded, null);
            });
        } else {
            for (const [k, v] of Object.entries(data)) {
                this._renderJsonTree(v, childContainer, depth + 1, childExpanded, k);
            }
        }

        container.appendChild(childContainer);
        container.appendChild(footer);
    }

    _escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async _triggerPostFetch() {
        let uuid = null;

        // Try current URL first
        const match = window.location.href.match(/\/post\/([a-f0-9-]{36})/);
        if (match) {
            uuid = match[1];
        } else {
            // Fallback: use last resolved image ID from UIManager
            uuid = window.gvpUIManager?._lastResolvedImageId || null;
            if (uuid) {
                window.Logger.info('UIInspector', 'Using fallback UUID from _lastResolvedImageId:', uuid.slice(0, 8));
            }
        }

        if (!uuid) {
            alert('No post UUID available.\nNavigate to a post first, or click on an image in your gallery.');
            return;
        }

        try {
            if (this.networkInterceptor && this.networkInterceptor.fetchPostDetails) {
                const data = await this.networkInterceptor.fetchPostDetails(uuid);
                if (data) {
                    await this.inspectionManager.capturePost(data);
                    this._renderHistoryList(); // Refresh UI
                    window.Logger.info('UIInspector', 'Post captured:', uuid.slice(0, 8));
                } else {
                    alert('Fetch returned empty data');
                }
            } else {
                alert('NetworkInterceptor not ready');
            }
        } catch (e) {
            alert('Error fetching post: ' + e.message);
        }
    }

    /**
     * Render a semantic diff report in the detail pane
     * @param {Object} newObj - The newer object
     * @param {Object} oldObj - The older object
     * @param {string} title - Title for the diff report
     */
    _renderDiffReport(newObj, oldObj, title = 'Diff Report') {
        const detailContainer = this.modal.querySelector('#gvp-inspector-detail');
        if (!detailContainer) return;

        detailContainer.innerHTML = '';

        // Title
        const header = document.createElement('div');
        header.innerHTML = `<h3 style="margin:0 0 12px 0; color:#fff;">📊 ${title}</h3>`;
        detailContainer.appendChild(header);

        // Calculate diff
        const diffs = this.inspectionManager.getDiff(oldObj, newObj);

        if (!diffs || diffs.length === 0) {
            const noDiff = document.createElement('div');
            noDiff.style.cssText = 'color:#4ade80; padding:12px; background:#1a2e1a; border-radius:4px;';
            noDiff.innerHTML = '✅ No changes detected vs previous version';
            detailContainer.appendChild(noDiff);
            return;
        }

        // Group by type
        const added = diffs.filter(d => d.type === 'added');
        const removed = diffs.filter(d => d.type === 'removed');
        const changed = diffs.filter(d => d.type === 'changed');

        const renderGroup = (items, label, color, bgColor, prefix) => {
            if (items.length === 0) return;

            const section = document.createElement('div');
            section.style.marginBottom = '16px';

            const sectionHeader = document.createElement('div');
            sectionHeader.style.cssText = `color:${color}; font-weight:bold; margin-bottom:8px;`;
            sectionHeader.textContent = `${label} (${items.length})`;
            section.appendChild(sectionHeader);

            items.forEach(d => {
                const line = document.createElement('div');
                line.style.cssText = `padding:6px 10px; margin:2px 0; font-size:11px; font-family:monospace; 
                                      word-break:break-all; background:${bgColor}; border-left:3px solid ${color}; color:#e0e0e0;`;

                if (d.type === 'changed') {
                    line.innerHTML = `<span style="color:${color}">[~]</span> ${d.key}<br>
                        <span style="color:#888;">FROM:</span> ${this._valStr(d.oldVal)}<br>
                        <span style="color:#888;">TO:</span> ${this._valStr(d.newVal)}`;
                } else {
                    line.innerHTML = `<span style="color:${color}">${prefix}</span> ${d.key}: ${this._valStr(d.val)}`;
                }
                section.appendChild(line);
            });

            detailContainer.appendChild(section);
        };

        renderGroup(removed, '❌ Removed', '#f87171', 'rgba(248, 113, 113, 0.1)', '[-]');
        renderGroup(added, '✅ Added', '#4ade80', 'rgba(74, 222, 128, 0.1)', '[+]');
        renderGroup(changed, '⚠️ Changed', '#fbbf24', 'rgba(251, 191, 36, 0.1)', '[~]');
    }

    /**
     * Toggle selection of an entry for comparison (shift-click)
     */
    _toggleSelection(index, entry, element) {
        // Check if already selected
        const existingIdx = this.selectedForCompare.findIndex(s => s.index === index);

        if (existingIdx !== -1) {
            // Deselect
            this.selectedForCompare.splice(existingIdx, 1);
            element.classList.remove('gvp-compare-selected');
        } else {
            // Select (max 2)
            if (this.selectedForCompare.length >= 2) {
                // Remove oldest selection
                const oldest = this.selectedForCompare.shift();
                this.modal.querySelectorAll('.gvp-hist-item')[oldest.index]?.classList.remove('gvp-compare-selected');
            }
            this.selectedForCompare.push({ index, entry });
            element.classList.add('gvp-compare-selected');
        }

        this._updateCompareButton();
    }

    /**
     * Update Compare Selected button visibility and text
     */
    _updateCompareButton() {
        const btn = this.modal?.querySelector('#gvp-compare-selected-btn');
        if (!btn) return;

        const count = this.selectedForCompare.length;
        btn.textContent = `🔀 Compare Selected (${count}/2)`;

        if (count === 2) {
            btn.style.display = 'block';
            btn.style.background = '#8b5cf6'; // Purple when ready
        } else if (count === 1) {
            btn.style.display = 'block';
            btn.style.background = '#6b7280'; // Gray when 1 selected
        } else {
            btn.style.display = 'none';
        }
    }

    /**
     * Compare the two selected entries
     */
    _compareSelected() {
        if (this.selectedForCompare.length !== 2) {
            alert('Please shift-click exactly 2 entries to compare');
            return;
        }

        const [first, second] = this.selectedForCompare.sort((a, b) => a.index - b.index);
        const title = `Entry #${second.index + 1} vs Entry #${first.index + 1}`;

        // Use normalized versions for meaningful diff
        const normalized1 = this.inspectionManager._normalizeConfig(first.entry.raw);
        const normalized2 = this.inspectionManager._normalizeConfig(second.entry.raw);

        this._renderDiffReport(normalized2, normalized1, title);
    }
};
