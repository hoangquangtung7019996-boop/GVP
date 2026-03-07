// UIWordSwapperManager.js - Word Swapper System
// Manages global word swap rules and provides a preview interface

window.UIWordSwapperManager = class UIWordSwapperManager {
    constructor(stateManager, uiHelpers, uiModalManager) {
        this.stateManager = stateManager;
        this.uiHelpers = uiHelpers || new window.UIHelpers();
        this.uiModalManager = uiModalManager; // To save directly to manager
        this.rules = [];
        this.modalOverlay = null;
        this.modalContent = null;
        this.previewTextarea = null;
        this.loadedPrompt = null;

        // Lightweight fuzzy match port (Levenshtein)
        // Fallback if StringUtils doesn't have it
        this.levenshtein = window.StringUtils?.levenshtein || ((a, b) => {
            if (a.length === 0) return b.length;
            if (b.length === 0) return a.length;
            var matrix = [];
            for (var i = 0; i <= b.length; i++) { matrix[i] = [i]; }
            for (var j = 0; j <= a.length; j++) { matrix[0][j] = j; }
            for (var i = 1; i <= b.length; i++) {
                for (var j = 1; j <= a.length; j++) {
                    if (b.charAt(i - 1) == a.charAt(j - 1)) {
                        matrix[i][j] = matrix[i - 1][j - 1];
                    } else {
                        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
                    }
                }
            }
            return matrix[b.length][a.length];
        });
    }

    async loadRules() {
        try {
            const allRules = await this.stateManager.storageManager.indexedDBManager.getAll('swap_rules');
            this.rules = (allRules || []).filter(r => r.scope === 'global' || !r.scope);
        } catch (error) {
            window.Logger.error('WordSwapper', 'Failed to load rules', error);
            this.rules = [];
        }
    }

    async saveRule(rule) {
        try {
            if (!rule.id) rule.id = this.stateManager._generateGuid('swap');
            rule.scope = 'global'; // Ensure scope is set
            const db = this.stateManager?.storageManager?.indexedDBManager;
            if (!db) {
                throw new Error("IndexedDBManager not available.");
            }
            await db.put('swap_rules', rule);
            await this.loadRules();
            this.renderRuleList();
            this.renderPreview();
            return rule;
        } catch (error) {
            window.Logger.error('WordSwapper', 'Failed to save rule', error);
            throw error;
        }
    }

    async deleteRule(ruleId) {
        try {
            await this.stateManager.storageManager.indexedDBManager.delete('swap_rules', ruleId);
            await this.loadRules();
            this.renderRuleList();
            this.renderPreview();
        } catch (error) {
            window.Logger.error('WordSwapper', 'Failed to delete rule', error);
            throw error;
        }
    }

    showSwapperModal(initialPromptStr = null, onCompleteCallback = null) {
        this.loadedPrompt = typeof initialPromptStr === 'string' ? initialPromptStr : '';
        this.onCompleteCallback = onCompleteCallback;

        if (this.modalOverlay) {
            this.modalOverlay.remove();
        }

        this.modalOverlay = document.createElement('div');
        this.modalOverlay.className = 'gvp-modal-overlay';
        this.modalOverlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center;
            z-index: 1000005; backdrop-filter: blur(4px);
        `;

        this.modalContent = document.createElement('div');
        this.modalContent.style.cssText = `
            width: 1100px; max-width: 95vw; height: 80vh; max-height: 800px;
            background: #141414; border: 1px solid #48494b; border-radius: 12px;
            display: flex; flex-direction: column; overflow: hidden;
            box-shadow: 0 10px 40px rgba(0,0,0,0.8); font-family: inherit;
        `;

        // Load data before rendering
        this.loadRules().then(() => {
            this.renderModal(initialPromptStr);
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
        title.textContent = '🔄 Word Swapper Config';
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

        // Auto-Swap toggle pill
        const autoToggleWrap = document.createElement('div');
        autoToggleWrap.style.cssText = 'display:flex; align-items:center; gap:8px; margin-left:auto; margin-right:12px;';

        const autoLabel = document.createElement('span');
        autoLabel.style.cssText = 'font-size:12px; color:#a3a3a3; white-space:nowrap;';
        autoLabel.textContent = 'Auto-Swap on Dispatch';

        const autoToggle = document.createElement('button');
        const isEnabled = () => this.stateManager?.getState?.()?.settings?.wordSwapAutoEnabled !== false;
        const refreshToggle = () => {
            const on = isEnabled();
            autoToggle.textContent = on ? '🟢 ON' : '🔴 OFF';
            autoToggle.style.cssText = [
                `background: ${on ? '#16a34a22' : '#dc262622'};`,
                `border: 1px solid ${on ? '#16a34a' : '#dc2626'};`,
                `color: ${on ? '#4ade80' : '#f87171'};`,
                'padding: 3px 12px; border-radius: 20px; cursor: pointer;',
                'font-size: 12px; font-weight: bold; transition: all 0.15s ease;'
            ].join(' ');
        };
        autoToggle.onclick = () => {
            const state = this.stateManager?.getState?.();
            if (!state) return;
            state.settings.wordSwapAutoEnabled = !isEnabled();
            if (typeof this.stateManager.saveSettings === 'function') this.stateManager.saveSettings();
            window.Logger.info('WordSwapper', `Auto-cycle toggle → ${state.settings.wordSwapAutoEnabled}`);
            refreshToggle();
        };
        refreshToggle();
        autoToggleWrap.appendChild(autoLabel);
        autoToggleWrap.appendChild(autoToggle);

        header.appendChild(title);
        header.appendChild(autoToggleWrap);
        header.appendChild(closeBtn);

        // Load Header Bar
        const loadBar = document.createElement('div');
        loadBar.style.cssText = 'padding: 12px 20px; border-bottom: 1px solid #333; background: #1a1a1a; display: flex; gap: 12px; align-items: center;';

        const loadLabel = document.createElement('span');
        loadLabel.textContent = 'Load Test Prompt:';
        loadLabel.style.color = '#a3a3a3';
        loadLabel.style.fontSize = '12px';

        const rawBtn = document.createElement('button');
        rawBtn.className = 'gvp-btn';
        rawBtn.textContent = 'From Raw Textarea';
        rawBtn.onclick = () => {
            const val = window.gvpUIManager?.shadowRoot?.getElementById('gvp-raw-input-textarea')?.value;
            if (val) {
                this.loadedPrompt = val;
                this.renderPreview();
            }
        };

        const libraryBtn = document.createElement('button');
        libraryBtn.className = 'gvp-btn';
        libraryBtn.textContent = 'From Library...';
        libraryBtn.onclick = async () => {
            try {
                const allPromptsStr = await this.stateManager.getPrompts();
                let allPrompts = [];
                if (typeof allPromptsStr === 'string') allPrompts = JSON.parse(allPromptsStr);
                else if (Array.isArray(allPromptsStr)) allPrompts = allPromptsStr;

                // Simple modal to pick
                if (allPrompts.length === 0) {
                    alert('Library is empty.');
                    return;
                }
                const promptName = prompt(`Enter name or part of name to load (Available: ${allPrompts.length})`);
                if (promptName) {
                    const found = allPrompts.find(p => p.name.toLowerCase().includes(promptName.toLowerCase()));
                    if (found) {
                        this.loadedPrompt = found.content;
                        this.renderPreview();
                    } else {
                        alert('Not found.');
                    }
                }
            } catch (e) {
                console.error(e);
            }
        };

        loadBar.appendChild(loadLabel);
        loadBar.appendChild(rawBtn);
        loadBar.appendChild(libraryBtn);

        // Main Layout (Split Pane)
        const main = document.createElement('div');
        main.style.cssText = 'display: flex; flex: 1; overflow: hidden;';

        // Left Pane: Rules
        this.rulesContainer = document.createElement('div');
        this.rulesContainer.style.cssText = `
            flex: 1; border-right: 1px solid #48494b; display: flex; flex-direction: column;
            background: #1a1a1a;
        `;

        // Right Pane: Preview Area
        this.previewContainer = document.createElement('div');
        this.previewContainer.style.cssText = `
            flex: 1.5; display: flex; flex-direction: column; background: #141414;
        `;

        this.initRulesPane(this.rulesContainer);
        this.initPreviewPane(this.previewContainer);

        main.appendChild(this.rulesContainer);
        main.appendChild(this.previewContainer);

        this.modalContent.appendChild(header);
        this.modalContent.appendChild(loadBar);
        this.modalContent.appendChild(main);
    }

    // ========== RULES PANE ==========

    initRulesPane(container) {
        // Controls
        const controls = document.createElement('div');
        controls.style.cssText = 'padding: 12px; border-bottom: 1px solid #333; display: flex; justify-content: flex-end;';

        const newBtn = document.createElement('button');
        newBtn.className = 'gvp-btn gvp-btn-primary';
        newBtn.textContent = '+ Add Rule';
        newBtn.onclick = () => this.showRuleEditor();

        controls.appendChild(newBtn);

        // List Area
        this.ruleListArea = document.createElement('div');
        this.ruleListArea.style.cssText = 'flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;';

        container.appendChild(controls);
        container.appendChild(this.ruleListArea);

        this.renderRuleList();
    }

    renderRuleList() {
        if (!this.ruleListArea) return;
        this.ruleListArea.innerHTML = '';

        if (this.rules.length === 0) {
            this.ruleListArea.innerHTML = '<div style="color:#a3a3a3; text-align:center; padding: 20px;">No swap rules defined.</div>';
            return;
        }

        this.rules.forEach(rule => {
            const el = document.createElement('div');
            el.style.cssText = `
                background: #212121; border: 1px solid #48494b; border-radius: 6px; padding: 10px;
                display: flex; flex-direction: column; gap: 8px;
            `;

            // header
            const header = document.createElement('div');
            header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 6px; margin-bottom: 4px;';

            const findText = document.createElement('div');
            findText.style.cssText = 'color: #fff; font-weight: bold; font-size: 14px;';
            findText.textContent = `Find: "${rule.find_string}" ${rule.is_fuzzy ? '(Fuzzy)' : ''}`;

            const actions = document.createElement('div');
            actions.style.cssText = 'display: flex; gap: 4px;';

            const editBtn = document.createElement('button');
            editBtn.innerHTML = '✏️';
            editBtn.style.cssText = 'background: none; border: none; cursor: pointer; color: #a3a3a3;';
            editBtn.onclick = () => this.showRuleEditor(rule);

            const delBtn = document.createElement('button');
            delBtn.innerHTML = '🗑️';
            delBtn.style.cssText = 'background: none; border: none; cursor: pointer; color: #ef4444;';
            delBtn.onclick = () => {
                if (confirm('Delete rule?')) this.deleteRule(rule.id);
            };

            actions.appendChild(editBtn);
            actions.appendChild(delBtn);
            header.appendChild(findText);
            header.appendChild(actions);

            // body
            const body = document.createElement('div');
            body.style.cssText = 'color: #a3a3a3; font-size: 12px; display: flex; flex-direction: column; gap: 4px;';

            const varCount = document.createElement('div');
            varCount.textContent = `Variants: ${rule.variants.length}`;

            const cycle = document.createElement('div');
            cycle.textContent = `Cycle on dispatch: ${rule.cycle_on_dispatch ? 'Yes' : 'No'}`;
            if (rule.cycle_on_dispatch) cycle.style.color = '#3b82f6';

            body.appendChild(varCount);
            if (rule.variants.length > 0) {
                const varList = document.createElement('div');
                varList.textContent = `[ ${rule.variants.slice(0, 3).join(', ')}${rule.variants.length > 3 ? '...' : ''} ]`;
                varList.style.color = '#888';
                body.appendChild(varList);
            }
            body.appendChild(cycle);

            el.appendChild(header);
            el.appendChild(body);
            this.ruleListArea.appendChild(el);
        });
    }

    showRuleEditor(rule = null) {
        // MVP Prompt-based UI until a full complex form is needed
        const findText = prompt('Source word/phrase to find in prompt:', rule ? rule.find_string : '');
        if (!findText) return;

        const isFuzzyStr = prompt('Use Fuzzy Match? (yes/no):', rule ? (rule.is_fuzzy ? 'yes' : 'no') : 'no');
        const isFuzzy = isFuzzyStr && isFuzzyStr.toLowerCase() === 'yes';

        const variantsStr = prompt('Comma separated replacement variants:', rule ? rule.variants.join(', ') : '');
        if (!variantsStr) return;
        const variants = variantsStr.split(',').map(s => s.trim()).filter(Boolean);

        const cycleStr = prompt('Cycle automatically on dispatch? (yes/no):', rule ? (rule.cycle_on_dispatch ? 'yes' : 'no') : 'no');
        const cycle = cycleStr && cycleStr.toLowerCase() === 'yes';

        const newRule = {
            id: rule ? rule.id : undefined,
            find_string: findText,
            is_fuzzy: isFuzzy,
            variants: variants,
            cycle_on_dispatch: cycle,
            currentIndex: rule ? rule.currentIndex : 0 // track state for cycling
        };

        this.saveRule(newRule);
    }

    // ========== PREVIEW PANE ==========

    initPreviewPane(container) {
        // Textarea
        const textWrapper = document.createElement('div');
        textWrapper.style.cssText = 'flex: 1; padding: 16px; display:flex; flex-direction:column; gap:8px; border-bottom: 1px solid #333; position: relative;';

        const label = document.createElement('label');
        label.textContent = 'Interactive Preview';
        label.style.cssText = 'color: #a3a3a3; font-size: 12px; text-transform: uppercase; font-weight:bold;';

        // We use a contenteditable div to allow inline dropdowns (React-like rendering approach)
        this.previewDiv = document.createElement('div');
        this.previewDiv.className = 'gvp-textarea gvp-swapper-preview';
        this.previewDiv.contentEditable = "false"; // Only meant for viewing/interacting with chips
        this.previewDiv.style.cssText = `
            width: 100%; flex: 1; background: #000; border: 1px solid #48494b;
            color: #fff; border-radius: 6px; padding: 16px; overflow-y: auto; font-family: monospace;
            line-height: 1.6; font-size: 14px; position: relative; white-space: pre-wrap;
        `;

        textWrapper.appendChild(label);
        textWrapper.appendChild(this.previewDiv);

        // Footer Actions
        const footer = document.createElement('div');
        footer.style.cssText = 'padding: 16px; display: flex; justify-content: space-between; align-items: center; background: #141414;';

        const resetBtn = document.createElement('button');
        resetBtn.className = 'gvp-btn';
        resetBtn.style.cssText = 'background: #2a2a2a; color: #fff; padding: 8px 16px; border: 1px solid #48494b; border-radius: 4px; cursor: pointer;';
        resetBtn.textContent = 'Reset All';
        resetBtn.onclick = () => this.renderPreview();

        const rightActions = document.createElement('div');
        rightActions.style.cssText = 'display: flex; gap: 12px;';

        if (this.onCompleteCallback) {
            const applyBtn = document.createElement('button');
            applyBtn.className = 'gvp-btn gvp-btn-primary';
            applyBtn.textContent = '✔️ Apply to Editor';
            applyBtn.onclick = () => {
                const text = this._extractPreviewText();
                this.onCompleteCallback(text);
                this.closeModal();
            };
            rightActions.appendChild(applyBtn);
        } else {
            const saveToManagerBtn = document.createElement('button');
            saveToManagerBtn.className = 'gvp-btn gvp-btn-secondary';
            saveToManagerBtn.textContent = '💾 Save as New Version';
            saveToManagerBtn.onclick = () => this.saveToManager();

            const loadRawBtn = document.createElement('button');
            loadRawBtn.className = 'gvp-btn gvp-btn-primary';
            loadRawBtn.textContent = '📤 Load to RAW';
            loadRawBtn.onclick = () => this.loadIntoRaw();

            rightActions.appendChild(saveToManagerBtn);
            rightActions.appendChild(loadRawBtn);
        }

        footer.appendChild(resetBtn);
        footer.appendChild(rightActions);

        container.appendChild(textWrapper);
        container.appendChild(footer);

        this.renderPreview();
    }

    renderPreview() {
        if (!this.previewDiv) return;

        if (!this.loadedPrompt) {
            this.previewDiv.innerHTML = '<div style="color:#737373; text-align:center; padding-top:40px;">Load a prompt from the top bar to preview swaps.</div>';
            return;
        }

        // Tokenize and match
        let htmlNodes = [];
        let remaining = this.loadedPrompt;

        // Very basic MVP tokenizer: we look for exact or fuzzy matches and wrap them.
        // For a full app, building an AST or regex approach is better.
        // We will do a greedy search for phrases.

        let cursor = 0;
        let lastMatchEnd = 0;

        // Sort rules by length of find_string descending so longer phrases match first
        const sortedRules = [...this.rules].sort((a, b) => b.find_string.length - a.find_string.length);

        // A naive scan approach
        while (cursor < remaining.length) {
            let matched = false;

            for (let rule of sortedRules) {
                // If fuzzy, we check word boundaries. For MVP, we do exact substring or basic fuzzy.
                const targetLen = rule.find_string.length;
                if (cursor + targetLen > remaining.length) continue;

                const substr = remaining.substring(cursor, cursor + targetLen);

                let isMatch = false;
                if (!rule.is_fuzzy) {
                    isMatch = substr.toLowerCase() === rule.find_string.toLowerCase();
                } else {
                    // Simple Levenshtein threshold (allow 1 typo per 5 chars)
                    const dist = this.levenshtein(substr.toLowerCase(), rule.find_string.toLowerCase());
                    const threshold = Math.max(1, Math.floor(targetLen / 5));
                    isMatch = dist <= threshold;
                }

                if (isMatch) {
                    // Push preceding text
                    if (cursor > lastMatchEnd) {
                        htmlNodes.push(document.createTextNode(remaining.substring(lastMatchEnd, cursor)));
                    }

                    // Push interactive dropdown 
                    const chip = document.createElement('span');
                    chip.className = 'gvp-swapper-chip';
                    chip.style.cssText = 'display: inline-block; background: #3b82f633; border: 1px solid #3b82f6; border-radius: 4px; padding: 2px 4px; color: #93c5fd; cursor: pointer; position: relative;';
                    chip.textContent = substr;

                    // The dropdown UI
                    const sel = document.createElement('select');
                    sel.style.cssText = 'position: absolute; opacity: 0; left: 0; top: 0; width: 100%; height: 100%; cursor: pointer;';

                    const origOpt = document.createElement('option');
                    origOpt.value = substr;
                    origOpt.textContent = substr + ' (original)';
                    sel.appendChild(origOpt);

                    rule.variants.forEach(v => {
                        const opt = document.createElement('option');
                        opt.value = v;
                        opt.textContent = v;
                        sel.appendChild(opt);
                    });

                    sel.onchange = (e) => {
                        // Just visually change the chip
                        const newText = e.target.value;
                        chip.firstChild.textContent = newText;
                    };

                    chip.appendChild(sel);
                    htmlNodes.push(chip);

                    cursor += targetLen;
                    lastMatchEnd = cursor;
                    matched = true;
                    break;
                }
            }

            if (!matched) {
                cursor++;
            }
        }

        // Push tail
        if (lastMatchEnd < remaining.length) {
            htmlNodes.push(document.createTextNode(remaining.substring(lastMatchEnd)));
        }

        this.previewDiv.innerHTML = '';
        htmlNodes.forEach(node => this.previewDiv.appendChild(node));
    }

    _extractPreviewText() {
        if (!this.previewDiv) return '';
        // Need to extract the CURRENT visible text, taking into account user selections in dropdowns.
        // Because the select overlays the text, chip.firstChild.textContent is updated on change.
        return this.previewDiv.textContent;
    }

    saveToManager() {
        const text = this._extractPreviewText();
        if (!text) {
            alert('Cannot save empty prompt.');
            return;
        }

        const promptLibrary = window.gvpUIManager?.uiModalManager?.promptLibrary;
        if (promptLibrary) {
            const name = prompt('Name for this prompt:', 'Swapped Prompt');
            if (name) {
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

                this.stateManager.savePrompt(newPrompt).then(() => {
                    alert('Saved as new Prompt!');
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
        const text = this._extractPreviewText();
        if (!text) return;

        const rawTextarea = window.gvpUIManager?.shadowRoot?.getElementById('gvp-raw-input-textarea') || document.getElementById('gvp-raw-input-textarea');
        if (rawTextarea) {
            rawTextarea.value = text;

            const event = new Event('input', { bubbles: true });
            rawTextarea.dispatchEvent(event);

            if (window.gvpUIManager && window.gvpUIManager.uiRawInputManager && window.gvpUIManager.uiRawInputManager.updateRawPreview) {
                window.gvpUIManager.uiRawInputManager.updateRawPreview(text);
            }

            this.closeModal();
            if (window.gvpUIManager && window.gvpUIManager.switchTab) {
                window.gvpUIManager.switchTab('Prompt');
            }
        } else {
            alert('Could not find Raw Input textarea.');
        }
    }

    // 📌 PIN — Future Expansion Point: Word Swap Mode
    // Ideas to implement when revisiting this feature:
    //  - Per-session rule sets (swap only this session, not persisted)
    //  - Rule scheduling: count-based triggers (e.g. every N dispatches)
    //  - UI chip to manually cycle a specific rule's currentIndex
    //  - Import / export swap rule packs as JSON
    //  - Rule priority / weight system for randomised variant selection

    // Static util to intercept and cycle variants on raw text dispatch
    static async applyGlobalCycleRules(text, stateManager, uiHelpers) {
        if (!text) return text;

        try {
            const allRules = await stateManager.storageManager.indexedDBManager.getAll('swap_rules');
            if (!allRules) return text;

            const globalRules = allRules.filter(r => (r.scope === 'global' || !r.scope) && r.cycle_on_dispatch && r.variants && r.variants.length > 0);
            if (globalRules.length === 0) return text;

            let modifiedText = text;
            let rulesChanged = false;

            // Sort descending to match longest phrases first
            globalRules.sort((a, b) => b.find_string.length - a.find_string.length);

            for (let rule of globalRules) {
                // Determine next variant
                let idx = rule.currentIndex || 0;
                if (idx >= rule.variants.length) idx = 0;

                const variant = rule.variants[idx];
                const findRegex = new RegExp(uiHelpers.escapeRegExp(rule.find_string), 'gi'); // Exact case-insensitive match for cycle

                if (findRegex.test(modifiedText)) {
                    modifiedText = modifiedText.replace(findRegex, variant);
                    rule.currentIndex = idx + 1; // Increment for next time
                    rulesChanged = true;
                    // Note: We only save back if we actually made a replacement.
                }
            }

            if (rulesChanged) {
                // Update indexes in DB silently
                globalRules.forEach(r => stateManager.storageManager.indexedDBManager.put('swap_rules', r));
            }

            return modifiedText;

        } catch (e) {
            window.Logger.error('WordSwapper', 'applyGlobalCycleRules failed', e);
            return text; // fail safe
        }
    }
};
