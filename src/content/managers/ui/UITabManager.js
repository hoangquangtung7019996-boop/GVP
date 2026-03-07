// UITabManager.js - Tab management and switching
// Dependencies: None

window.UITabManager = class UITabManager {
    constructor(shadowRoot, uiManager) {
        this.shadowRoot = shadowRoot;
        this.uiManager = uiManager;

        // Why: Backward-compat aliases so old callers using legacy tab names still work
        this._tabAliases = {
            'raw-input': 'Prompt',
            'Raw': 'Prompt',
            'JSON': 'Prompt'  // JSON editor is now a popout, but old calls should land on Prompt
        };
    }

    _createTabs() {
        const tabs = document.createElement('div');
        tabs.id = 'gvp-tabs';
        const tabNames = window.uiConstants.TAB_NAMES;
        tabNames.forEach((name, idx) => {
            const tab = document.createElement('button');
            tab.className = `gvp-tab ${idx === 0 ? 'active' : ''}`;
            tab.textContent = name;
            tab.addEventListener('click', (e) => this.switchTab(e.target.textContent));
            tabs.appendChild(tab);
        });
        return tabs;
    }

    _createTabContent() {
        const tabContent = document.createElement('div');
        tabContent.id = 'gvp-tab-content';

        try {
            // 1. Prompt tab (formerly Raw) — default/first tab
            if (this.uiManager && this.uiManager.uiRawInputManager) {
                const promptTab = this.uiManager.uiRawInputManager._createRawInputTab();
                if (promptTab) {
                    promptTab.id = 'gvp-tab-Prompt';
                    promptTab.className = 'gvp-tab-content active';
                    promptTab.style.display = 'block';
                    tabContent.appendChild(promptTab);
                    window.Logger.debug('Tab', 'Prompt tab created (formerly Raw)');
                }
            }

            // 2. History tab
            const mergedHistoryTab = this._createMergedHistoryTab();
            if (mergedHistoryTab) {
                tabContent.appendChild(mergedHistoryTab);
                window.Logger.debug('Tab', 'Merged History tab created');
            }

            // 3. Queue tab
            const queueTab = this._createQueueTab();
            if (queueTab) {
                tabContent.appendChild(queueTab);
                window.Logger.debug('Tab', 'Queue tab created');
            }

            // 4. Multi-Upload tab
            const multiUploadTab = this._createMultiUploadTab();
            if (multiUploadTab) {
                tabContent.appendChild(multiUploadTab);
                window.Logger.debug('Tab', 'Multi-Upload tab created');
            }
        } catch (error) {
            window.Logger.error('Tab', 'Error creating tab content:', error);
        }

        return tabContent;
    }

    _createQueueTab() {
        const tab = document.createElement('div');
        tab.id = 'gvp-tab-Queue';
        tab.className = 'gvp-tab-content';
        tab.style.display = 'none';

        // Initialize UIVideoQueueManager if available
        if (window.UIVideoQueueManager && this.uiManager) {
            try {
                this.uiManager.uiVideoQueueManager = new window.UIVideoQueueManager(
                    this.uiManager,
                    this.shadowRoot
                );
                this.uiManager.uiVideoQueueManager.init();
                const content = this.uiManager.uiVideoQueueManager.createTabContent();
                if (content) {
                    tab.appendChild(content);
                }
            } catch (error) {
                window.Logger.error('Tab', 'Failed to create Queue tab:', error);
            }
        } else {
            // Placeholder if manager not loaded
            tab.innerHTML = `
                <div style="padding: 32px; text-align: center; color: var(--gvp-text-muted);">
                    <div style="font-size: 48px; margin-bottom: 16px;">📋</div>
                    <div>Queue Manager loading...</div>
                </div>
            `;
        }

        return tab;
    }

    /**
     * Create the Multi-Upload tab content
     * Why: Migrates upload mode from side-rail toggle to a dedicated tab
     * @returns {HTMLElement}
     */
    _createMultiUploadTab() {
        const tab = document.createElement('div');
        tab.id = 'gvp-tab-Multi-Upload';
        tab.className = 'gvp-tab-content';
        tab.style.display = 'none';

        // Why: UIManager._initializeSubManagers() already creates a fully-wired
        // UIUploadManager with the correct (stateManager, shadowRoot, uploadAutomationManager, uiManager)
        // args. We MUST reuse that instance — never re-instantiate here.
        const mgr = this.uiManager?.uiUploadManager;
        if (mgr) {
            try {
                // createInlineUploadContent() returns static flow-content (no position:fixed),
                // so it renders correctly when the tab div becomes visible.
                const content = mgr.createInlineUploadContent();
                if (content) tab.appendChild(content);
                window.Logger.debug('Tab', 'Multi-Upload inline panel appended');
            } catch (error) {
                window.Logger.error('Tab', 'Failed to create Multi-Upload tab:', error);
                tab.appendChild(this._createPlaceholderTab('Multi-Upload'));
            }
        } else {
            // UIUploadManager not yet ready (e.g. uploadAutomationManager missing)
            window.Logger.warn('Tab', 'UIUploadManager not available — showing placeholder');
            tab.appendChild(this._createPlaceholderTab('Multi-Upload'));
        }

        return tab;
    }

    _createMergedHistoryTab() {
        const tab = document.createElement('div');
        tab.id = 'gvp-tab-History';
        tab.className = 'gvp-tab-content';
        tab.style.display = 'none';

        if (this.uiManager && typeof this.uiManager._createHistoryTab === 'function') {
            const content = this.uiManager._createHistoryTab();
            if (content) {
                tab.appendChild(content);
            }
        }
        return tab;
    }

    /**
     * Switch to a tab by name. Supports legacy aliases for backward compatibility.
     * @param {string} tabName - Tab name or legacy alias (e.g. 'raw-input', 'Raw', 'JSON')
     */
    switchTab(tabName) {
        // Why: Resolve legacy tab names so old callers don't break
        const resolved = this._tabAliases[tabName] || tabName;

        // Update tab button states
        const tabButtons = Array.from(this.shadowRoot.querySelectorAll('#gvp-tabs .gvp-tab'));
        tabButtons.forEach(btn => {
            if (btn.textContent === resolved) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Hide all tab content
        const tabContainers = Array.from(this.shadowRoot.querySelectorAll('.gvp-tab-content'));
        tabContainers.forEach(tab => {
            tab.classList.remove('active');
            tab.style.display = 'none';
        });

        // Show selected tab
        const targetTab = this.shadowRoot.getElementById(`gvp-tab-${resolved}`);
        if (targetTab) {
            targetTab.classList.add('active');
            targetTab.style.display = 'block';

            if (resolved === 'History' && this.uiManager && typeof this.uiManager.refreshHistoryTab === 'function') {
                this.uiManager.refreshHistoryTab(true);
            }

            // Why: Directly activate the inline panel — avoids the fragile
            // setUploadAutomationEnabled → gvp:upload-mode-changed → showUploadPanel() chain
            // which targeted the broken second UIUploadManager instance.
            if (resolved === 'Multi-Upload') {
                this.uiManager?.uiUploadManager?.onTabActivated?.();
            }
        } else {
            window.Logger.warn('Tab', 'Attempted to switch to missing tab:', resolved, '(original:', tabName, ')');
        }
    }

    _createPlaceholderTab(featureName) {
        const tab = document.createElement('div');
        tab.className = 'gvp-tab-content';
        tab.style.padding = '32px 16px';
        tab.style.textAlign = 'center';
        tab.style.color = 'var(--gvp-text-muted)';

        tab.innerHTML = `
            <div style="font-size: 64px; margin-bottom: 16px;">🚧</div>
            <h3 style="margin: 0 0 16px 0; color: var(--gvp-text-highlight);">${featureName} Coming Soon</h3>
            <p style="font-size: 14px; line-height: 1.6;">
                This feature is currently under development and will be available in a future update.
            </p>
            <p style="font-size: 12px; color: var(--gvp-text-muted); margin-top: 16px;">
                Stay tuned for more awesome features!
            </p>
        `;

        return tab;
    }
};
