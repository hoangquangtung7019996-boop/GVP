// UISFWModeManager.js - SFW Mode Popup Config
// Manages SFW prefix, suffix, and word replacements.
// Note: SFW changes only apply at the dispatch point, leaving the actual prompt intact.

window.UISFWModeManager = class UISFWModeManager {
    constructor(stateManager, uiHelpers, uiModalManager) {
        this.stateManager = stateManager;
        this.uiHelpers = uiHelpers || new window.UIHelpers();
        this.uiModalManager = uiModalManager;

        this.modalOverlay = null;
        this.modalContent = null;

        this.sfwConfig = {
            enabled: false,
            prefix: '',
            suffix: '',
            rules: [] // scoped "sfw" word swap rules
        };
    }

    async loadConfig() {
        try {
            const settingsArray = await this.stateManager.storageManager.indexedDBManager.getAll('settingsBackup');
            const settings = settingsArray.find(s => s.id === 'sfw_settings');
            if (settings) {
                this.sfwConfig.enabled = !!settings.enabled;
                this.sfwConfig.prefix = settings.prefix || '';
                this.sfwConfig.suffix = settings.suffix || '';
            }

            const allRules = await this.stateManager.storageManager.indexedDBManager.getAll('swap_rules');
            this.sfwConfig.rules = (allRules || []).filter(r => r.scope === 'sfw');

        } catch (error) {
            window.Logger.error('SFWMode', 'Failed to load config', error);
        }
    }

    async saveConfig() {
        try {
            await this.stateManager.storageManager.indexedDBManager.put('settingsBackup', {
                id: 'sfw_settings',
                enabled: this.sfwConfig.enabled,
                prefix: this.sfwConfig.prefix,
                suffix: this.sfwConfig.suffix
            });

            // Refresh UI if needed
            this.renderModal();

        } catch (error) {
            window.Logger.error('SFWMode', 'Failed to save basic config', error);
        }
    }

    async saveRule(rule) {
        try {
            if (!rule.id) rule.id = this.stateManager._generateGuid('sfw');
            rule.scope = 'sfw';
            await this.stateManager.storageManager.indexedDBManager.put('swap_rules', rule);
            await this.loadConfig();
            this.renderModal(); // re-render lists
        } catch (error) {
            window.Logger.error('SFWMode', 'Failed to save sfw rule', error);
        }
    }

    async deleteRule(ruleId) {
        try {
            await this.stateManager.storageManager.indexedDBManager.delete('swap_rules', ruleId);
            await this.loadConfig();
            this.renderModal();
        } catch (error) {
            window.Logger.error('SFWMode', 'Failed to delete sfw rule', error);
        }
    }

    showSfwModal() {
        if (this.modalOverlay) {
            this.modalOverlay.remove();
        }

        this.modalOverlay = document.createElement('div');
        this.modalOverlay.className = 'gvp-modal-overlay';
        this.modalOverlay.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center;
            z-index: 10000; backdrop-filter: blur(4px);
        `;

        this.modalContent = document.createElement('div');
        this.modalContent.className = 'gvp-modal-content';
        this.modalContent.style.cssText = `
            background: #141414; border: 1px solid #48494b; border-radius: 12px;
            width: 500px; max-width: 95vw; max-height: 90vh;
            display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            overflow: hidden;
        `;

        // Load data before rendering
        this.loadConfig().then(() => {
            this.renderModal();
        });

        this.modalOverlay.appendChild(this.modalContent);

        // Close on background click
        this.modalOverlay.addEventListener('click', (e) => {
            if (e.target === this.modalOverlay) {
                this.closeModal();
            }
        });

        // Append
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
            background: ${this.sfwConfig.enabled ? '#064e3b' : '#1a1a1a'}; /* Green tint if enabled */
            transition: background 0.3s;
        `;

        const title = document.createElement('h2');
        title.textContent = '🛡️ SFW Mode Config';
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

        // Main Body
        const body = document.createElement('div');
        body.style.cssText = 'padding: 20px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 20px;';

        // 1. Toggle
        const toggleRow = document.createElement('div');
        toggleRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; border-bottom: 1px solid #333;';

        const toggleLabel = document.createElement('div');
        toggleLabel.innerHTML = '<strong style="color:#fff; font-size:16px;">Enable SFW Mode</strong><div style="color:#a3a3a3; font-size:12px; margin-top:4px;">Applies transformations automatically on dispatch without modifying the original prompt.</div>';

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'gvp-btn';
        toggleBtn.style.cssText = `
            border-radius: 20px; padding: 6px 16px; font-weight: bold; border: none; cursor:pointer;
            background: ${this.sfwConfig.enabled ? '#10b981' : '#4b5563'};
            color: #fff;
        `;
        toggleBtn.textContent = this.sfwConfig.enabled ? 'ON' : 'OFF';
        toggleBtn.onclick = () => {
            this.sfwConfig.enabled = !this.sfwConfig.enabled;
            this.saveConfig();
        };

        toggleRow.appendChild(toggleLabel);
        toggleRow.appendChild(toggleBtn);

        // 2. Prefix / Suffix Definitions
        const affixRow = document.createElement('div');
        affixRow.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';

        const prefixLabel = document.createElement('label');
        prefixLabel.textContent = 'Enforced Prefix:';
        prefixLabel.style.cssText = 'color: #a3a3a3; font-size: 13px; font-weight: bold;';

        const prefixInput = document.createElement('input');
        prefixInput.type = 'text';
        prefixInput.className = 'gvp-input';
        prefixInput.style.cssText = 'width: 100%; background: #000; border: 1px solid #48494b; color: #fff; border-radius: 4px; padding: 8px; box-sizing: border-box;';
        prefixInput.value = this.sfwConfig.prefix;
        prefixInput.placeholder = 'e.g., Safe, family friendly, highly censored';
        prefixInput.onchange = (e) => {
            this.sfwConfig.prefix = e.target.value;
            this.saveConfig();
        };

        const suffixLabel = document.createElement('label');
        suffixLabel.textContent = 'Enforced Suffix (Negative/Prevention):';
        suffixLabel.style.cssText = 'color: #a3a3a3; font-size: 13px; font-weight: bold; margin-top: 8px;';

        const suffixInput = document.createElement('input');
        suffixInput.type = 'text';
        suffixInput.className = 'gvp-input';
        suffixInput.style.cssText = 'width: 100%; background: #000; border: 1px solid #48494b; color: #fff; border-radius: 4px; padding: 8px; box-sizing: border-box;';
        suffixInput.value = this.sfwConfig.suffix;
        suffixInput.placeholder = 'e.g., no nudity, safe for work';
        suffixInput.onchange = (e) => {
            this.sfwConfig.suffix = e.target.value;
            this.saveConfig();
        };

        affixRow.appendChild(prefixLabel);
        affixRow.appendChild(prefixInput);
        affixRow.appendChild(suffixLabel);
        affixRow.appendChild(suffixInput);


        // 3. SFW Specific Word Replacements
        const rulesRow = document.createElement('div');
        rulesRow.style.cssText = 'display: flex; flex-direction: column; gap: 12px; margin-top: 10px;';

        const rulesHeader = document.createElement('div');
        rulesHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 8px;';

        const rt = document.createElement('span');
        rt.textContent = 'SFW Replacements (Run before dispatch)';
        rt.style.cssText = 'color: #fff; font-size: 13px; font-weight: bold;';

        const addRuleBtn = document.createElement('button');
        addRuleBtn.textContent = '+ Add Word';
        addRuleBtn.className = 'gvp-btn gvp-btn-primary';
        addRuleBtn.style.padding = '4px 8px';
        addRuleBtn.onclick = () => this.showRuleEditor();

        rulesHeader.appendChild(rt);
        rulesHeader.appendChild(addRuleBtn);
        rulesRow.appendChild(rulesHeader);

        const rulesList = document.createElement('div');
        rulesList.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';

        if (this.sfwConfig.rules.length === 0) {
            rulesList.innerHTML = '<div style="color:#737373; font-size: 12px; text-align: center; padding: 10px;">No specific SFW replacements.</div>';
        } else {
            this.sfwConfig.rules.forEach(rule => {
                const el = document.createElement('div');
                el.style.cssText = 'background: #212121; border: 1px solid #48494b; border-radius: 4px; padding: 8px; display: flex; justify-content: space-between; align-items: center;';

                const txt = document.createElement('div');
                txt.style.cssText = 'color: #fff; font-size: 13px;';
                // For SFW rules we usually just want one variant (the static replacement)
                const rep = rule.variants[0] || '[remove]';
                txt.innerHTML = `<span style="color:#ef4444">"${rule.find_string}"</span> → <span style="color:#10b981">"${rep}"</span>`;

                const del = document.createElement('button');
                del.innerHTML = '✕';
                del.style.cssText = 'background: none; border: none; color: #a3a3a3; cursor: pointer;';
                del.onclick = () => this.deleteRule(rule.id);

                el.appendChild(txt);
                el.appendChild(del);
                rulesList.appendChild(el);
            });
        }

        rulesRow.appendChild(rulesList);

        body.appendChild(toggleRow);
        body.appendChild(affixRow);
        body.appendChild(rulesRow);

        this.modalContent.appendChild(header);
        this.modalContent.appendChild(body);
    }

    showRuleEditor() {
        const findText = prompt('NSFW Word to find:');
        if (!findText) return;

        const repText = prompt(`Replace "${findText}" with (leave empty to just remove):`, '');
        const variants = repText ? [repText] : [''];

        const newRule = {
            find_string: findText,
            is_fuzzy: false, // keep it strict for SFW usually, or add UI later
            variants: variants,
            cycle_on_dispatch: false
        };

        this.saveRule(newRule);
    }

    // Static util to intercept and apply SFW rules on dispatch
    static async applySFWTransform(text, stateManager, uiHelpers) {
        if (!text) return text;

        try {
            const settingsArray = await stateManager.storageManager.indexedDBManager.getAll('settingsBackup');
            const settings = settingsArray.find(s => s.id === 'sfw_settings');
            if (!settings || !settings.enabled) return text;

            let modifiedText = text;

            // Apply word swaps first
            const allRules = await stateManager.storageManager.indexedDBManager.getAll('swap_rules');
            if (allRules) {
                const sfwRules = allRules.filter(r => r.scope === 'sfw');
                sfwRules.sort((a, b) => b.find_string.length - a.find_string.length);

                for (let rule of sfwRules) {
                    const variant = rule.variants[0] || '';
                    const findRegex = new RegExp(uiHelpers.escapeRegExp(rule.find_string), 'gi');
                    modifiedText = modifiedText.replace(findRegex, variant);
                }
            }

            // Cleanup multiple spaces from blank replacements
            modifiedText = modifiedText.replace(/\s{2,}/g, ' ').trim();

            // Apply Prefix
            if (settings.prefix && settings.prefix.trim()) {
                modifiedText = `${settings.prefix.trim()} ${modifiedText}`;
            }

            // Apply Suffix
            if (settings.suffix && settings.suffix.trim()) {
                modifiedText = `${modifiedText} ${settings.suffix.trim()}`;
            }

            return modifiedText;

        } catch (e) {
            window.Logger.error('SFWMode', 'applySFWTransform failed', e);
            return text; // fail safe
        }
    }
};
