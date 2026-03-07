// UISettingsManager.js - Settings and configuration UI
// Dependencies: StateManager

window.UISettingsManager = class UISettingsManager {
    constructor(stateManager, shadowRoot, uiManager, networkInterceptor, imageProjectManager) {
        this.stateManager = stateManager;
        this.shadowRoot = shadowRoot;
        this.uiManager = uiManager;
        this.networkInterceptor = networkInterceptor;
        this.imageProjectManager = imageProjectManager;
        this._panelElement = null;
    }

    openSettingsPanel() {
        if (!this.shadowRoot) {
            console.warn('[GVP] Settings panel cannot open: missing shadowRoot');
            return;
        }

        if (!this._panelElement) {
            this._panelElement = this._createSettingsPanel();
            this.shadowRoot.appendChild(this._panelElement);
        }

        requestAnimationFrame(() => {
            this._panelElement?.classList.add('visible');
        });
    }

    closeSettingsPanel() {
        if (this._panelElement) {
            this._panelElement.classList.remove('visible');
        }
    }

    _createSettingsPanel() {
        const panel = document.createElement('div');
        panel.id = 'gvp-settings-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');

        const container = document.createElement('div');
        container.className = 'gvp-settings-panel-container';

        const header = document.createElement('div');
        header.className = 'gvp-settings-panel-header';

        const title = document.createElement('span');
        title.textContent = 'Settings';
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'gvp-button gvp-settings-close-btn';
        closeBtn.innerHTML = '×';
        closeBtn.setAttribute('aria-label', 'Close settings');
        closeBtn.addEventListener('click', () => this.closeSettingsPanel());
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.className = 'gvp-settings-panel-body';
        body.appendChild(this._buildSettingsContent());

        container.appendChild(header);
        container.appendChild(body);
        panel.appendChild(container);

        panel.addEventListener('click', (event) => {
            if (event.target === panel) {
                this.closeSettingsPanel();
            }
        });

        this.shadowRoot.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                this.closeSettingsPanel();
            }
        });

        return panel;
    }

    _buildSettingsContent() {
        const content = document.createElement('div');
        content.className = 'gvp-settings-content';

        const header = document.createElement('h3');
        header.className = 'gvp-label';
        header.textContent = 'General Settings';
        header.style.marginTop = '0';
        content.appendChild(header);

        this.createCheckboxSetting(content, 'gvp-wrap-quotes-checkbox', 'Wrap prompt in quotes',
            this.stateManager.getState().settings.wrapInQuotes, (checked) => {
                if (typeof this.stateManager.setWrapInQuotes === 'function') {
                    this.stateManager.setWrapInQuotes(checked);
                } else {
                    const state = this.stateManager.getState();
                    state.settings.wrapInQuotes = checked;
                    state.ui.wrapInQuotes = checked;
                    this.stateManager.saveSettings();
                }
            });

        this.createCheckboxSetting(content, 'gvp-silent-mode-checkbox', 'Voice-only audio (mute music & ambient)',
            this.stateManager.getState().settings.silentMode, (checked) => {
                this._handleSilentModeToggle(checked);
            });

        const dialogueHeader = document.createElement('h3');
        dialogueHeader.className = 'gvp-label';
        dialogueHeader.textContent = 'Dialogue Presets';
        dialogueHeader.style.marginTop = '16px';
        dialogueHeader.style.borderTop = '1px solid #333';
        dialogueHeader.style.paddingTop = '12px';
        content.appendChild(dialogueHeader);

        const dialogueDesc = document.createElement('p');
        dialogueDesc.style.color = '#888';
        dialogueDesc.style.fontSize = '11px';
        dialogueDesc.style.margin = '8px 0 12px';
        dialogueDesc.textContent = 'Clear saved accent, language, emotion, and type values to restore the default presets.';
        content.appendChild(dialogueDesc);

        const resetDialogueBtn = document.createElement('button');
        resetDialogueBtn.className = 'gvp-button';
        resetDialogueBtn.textContent = '♻️ Reset dialogue dropdowns';
        resetDialogueBtn.addEventListener('click', async () => {
            const confirmed = window.confirm('Reset saved dialogue dropdown values and restore defaults?');
            if (!confirmed) {
                return;
            }

            const originalText = resetDialogueBtn.textContent;
            resetDialogueBtn.disabled = true;
            resetDialogueBtn.textContent = 'Resetting…';

            try {
                if (window.ArrayFieldManager?.resetDialoguePresetDefaults) {
                    window.ArrayFieldManager.resetDialoguePresetDefaults();
                }

                await this.stateManager.clearCustomDropdownValues([
                    'dialogue.accent',
                    'dialogue.language',
                    'dialogue.emotion',
                    'dialogue.type'
                ]);

                if (this.uiManager?.uiFormManager?.refreshCurrentView) {
                    this.uiManager.uiFormManager.refreshCurrentView();
                }

                alert('Dialogue dropdowns restored to default presets.');
            } catch (error) {
                console.error('[GVP] Failed to reset dialogue dropdown presets:', error);
                alert('Failed to reset dialogue dropdowns. Check console for details.');
            } finally {
                resetDialogueBtn.disabled = false;
                resetDialogueBtn.textContent = originalText;
            }
        });
        content.appendChild(resetDialogueBtn);

        // --- Database Backup (v1.46.8) ---
        const backupHeader = document.createElement('h3');
        backupHeader.className = 'gvp-label';
        backupHeader.textContent = 'Database Backup';
        backupHeader.style.marginTop = '16px';
        backupHeader.style.borderTop = '1px solid #333';
        backupHeader.style.paddingTop = '12px';
        content.appendChild(backupHeader);

        const backupDesc = document.createElement('p');
        backupDesc.style.color = '#888';
        backupDesc.style.fontSize = '11px';
        backupDesc.style.margin = '8px 0 12px';
        backupDesc.textContent = 'Back up your entire history and settings to a JSON file. Importing will overwrite all current local data.';
        content.appendChild(backupDesc);

        const backupBtnGroup = document.createElement('div');
        backupBtnGroup.style.display = 'flex';
        backupBtnGroup.style.flexDirection = 'column';
        backupBtnGroup.style.gap = '8px';

        // Merge Toggle (v1.46.13)
        const mergeContainer = document.createElement('div');
        mergeContainer.style.marginBottom = '8px';
        this.createCheckboxSetting(mergeContainer, 'gvp-idb-merge-checkbox', 'Merge with existing data (Skip clear)',
            false, (checked) => {
                this._importMergeEnabled = checked;
            });
        content.appendChild(mergeContainer);

        // Export Button
        const exportBtn = document.createElement('button');
        exportBtn.className = 'gvp-button';
        exportBtn.textContent = '📥 Export IDB Backup';
        exportBtn.addEventListener('click', async () => {
            const originalText = exportBtn.textContent;
            exportBtn.disabled = true;
            exportBtn.textContent = 'Exporting...';

            try {
                const idb = window.idbManager || window.IndexedDBManager?.instance;
                if (!idb) throw new Error('IndexedDBManager not found');

                const data = await idb.exportFullDatabase();
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);

                const link = document.createElement('a');
                link.href = url;
                link.download = `GVP_Backup_${new Date().toISOString().split('T')[0]}.json`;
                link.click();

                URL.revokeObjectURL(url);
                console.log('[GVP] Database backup exported successfully');
            } catch (error) {
                console.error('[GVP] Export failed:', error);
                alert('Export failed. Check console.');
            } finally {
                exportBtn.disabled = false;
                exportBtn.textContent = originalText;
            }
        });

        // Import Button (triggers hidden file input)
        const importBtn = document.createElement('button');
        importBtn.className = 'gvp-button';
        importBtn.textContent = '📤 Import IDB Backup';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const confirmed = window.confirm('WARNING: This will PERMANENTLY OVERWRITE all local data with the content of this backup. Continue?');
            if (!confirmed) {
                fileInput.value = '';
                return;
            }

            const originalText = importBtn.textContent;
            importBtn.disabled = true;
            importBtn.textContent = 'Importing...';

            try {
                const reader = new FileReader();
                const fileData = await new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(reader.error);
                    reader.readAsText(file);
                });

                const backup = JSON.parse(fileData);
                const idb = window.idbManager || window.IndexedDBManager?.instance;
                if (!idb) throw new Error('IndexedDBManager not found');

                await idb.importFullDatabase(backup, { merge: !!this._importMergeEnabled });

                alert('Import successful! The page will now reload to apply changes.');
                window.location.reload();
            } catch (error) {
                console.error('[GVP] Import failed:', error);
                alert('Import failed: ' + error.message);
            } finally {
                importBtn.disabled = false;
                importBtn.textContent = originalText;
                fileInput.value = '';
            }
        });

        importBtn.addEventListener('click', () => fileInput.click());

        backupBtnGroup.appendChild(exportBtn);
        backupBtnGroup.appendChild(importBtn);

        // Diagnostic Report Button (v1.46.15)
        const diagnosticBtn = document.createElement('button');
        diagnosticBtn.className = 'gvp-button';
        diagnosticBtn.style.marginTop = '8px';
        diagnosticBtn.style.backgroundColor = '#2c3e50';
        diagnosticBtn.textContent = '📋 Copy Diagnostic Report';
        diagnosticBtn.addEventListener('click', async () => {
            const originalText = diagnosticBtn.textContent;
            diagnosticBtn.disabled = true;
            diagnosticBtn.textContent = 'Generating...';

            try {
                const idb = window.idbManager || window.IndexedDBManager?.instance;
                if (!idb) throw new Error('IndexedDBManager not found');

                const report = await idb.getDatabaseReport();
                const reportStr = JSON.stringify(report, null, 2);

                await navigator.clipboard.writeText(reportStr);

                diagnosticBtn.textContent = '✅ Copied to Clipboard!';
                setTimeout(() => {
                    diagnosticBtn.textContent = originalText;
                }, 3000);
            } catch (error) {
                console.error('[GVP] Diagnostic report failed:', error);
                alert('Failed to generate report: ' + error.message);
                diagnosticBtn.textContent = originalText;
            } finally {
                diagnosticBtn.disabled = false;
            }
        });
        backupBtnGroup.appendChild(diagnosticBtn);

        content.appendChild(backupBtnGroup);
        content.appendChild(fileInput);

        return content;
    }

    _createDebugTab() {
        const tab = document.createElement('div');
        tab.className = 'gvp-tab-content';
        tab.id = 'gvp-debug';
        tab.style.padding = '16px';
        tab.style.fontFamily = 'Courier New, monospace';
        tab.style.fontSize = '11px';

        const sections = [
            {
                title: '🔧 Application State',
                content: () => {
                    const state = this.stateManager.getState();
                    return `
                        <div style="margin-bottom: 16px;">
                            <strong>Version:</strong> v13.10<br>
                            <strong>Debug Mode:</strong> ${state.debugMode ? 'Enabled' : 'Disabled'}<br>
                            <strong>Active Tab:</strong> ${state.activeTab}<br>
                            <strong>UI Open:</strong> ${state.isOpen}<br>
                        </div>
                    `;
                }
            },
            {
                title: '📊 Generation Stats',
                content: () => {
                    const state = this.stateManager.getState();
                    const gen = state.generation;
                    return `
                        <div style="margin-bottom: 16px;">
                            <strong>Status:</strong> ${gen.status}<br>
                            <strong>Mode:</strong> ${gen.useSpicy ? 'Spicy' : 'Normal'}<br>
                            <strong>Current Generation:</strong> ${gen.currentGenerationId || 'None'}<br>
                            <strong>Retry Count:</strong> ${gen.retryCount}<br>
                        </div>
                    `;
                }
            }
        ];

        let content = '<div style="color: #fbbf24; font-weight: bold; margin-bottom: 16px;">🚀 Grok Video Prompter Debug Panel</div>';

        sections.forEach(section => {
            content += `
                <div style="background: #0f172a; border: 1px solid #333; border-radius: 6px; padding: 12px; margin-bottom: 12px;">
                    <div style="color: #fbbf24; font-weight: bold; margin-bottom: 8px;">${section.title}</div>
                    <div style="color: #ddd;">${section.content()}</div>
                </div>
            `;
        });

        tab.innerHTML = content;
        return tab;
    }

    createCheckboxSetting(container, id, labelText, checked, onChange) {
        const checkboxContainer = document.createElement('div');
        checkboxContainer.className = 'gvp-checkbox-container';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = id;
        checkbox.checked = checked;
        checkbox.addEventListener('change', (e) => onChange(e.target.checked));

        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = labelText;

        checkboxContainer.appendChild(checkbox);
        checkboxContainer.appendChild(label);
        container.appendChild(checkboxContainer);
    }



    _applySilentModeAudioDefaults() {
        if (this.stateManager && typeof this.stateManager.applySilentModeAudioDefaults === 'function') {
            this.stateManager.applySilentModeAudioDefaults();
            return;
        }

        const state = this.stateManager.getState();
        state.promptData.audio = state.promptData.audio || {};
        state.promptData.audio.music = 'none';
        state.promptData.audio.ambient = 'none';
        state.promptData.audio.sound_effect = 'none';
        state.promptData.audio.mix_level = 'No music, no ambient room noise, maximum dialogue audio, medium human sounds.';
    }

    _handleSilentModeToggle(isEnabled) {
        const enabled = !!isEnabled;
        if (this.uiManager && typeof this.uiManager.setSilentMode === 'function') {
            this.uiManager.setSilentMode(enabled, { from: 'settings' });
            return;
        }

        const state = this.stateManager.getState();
        state.settings.silentMode = enabled;
        if (enabled) {
            this._applySilentModeAudioDefaults();
        }
        this.stateManager.saveSettings();
        this._syncAudioFieldsWithState();
        if (this.uiManager && typeof this.uiManager.updateVoiceOnlyIndicator === 'function') {
            this.uiManager.updateVoiceOnlyIndicator(enabled);
        }
        console.log(`[GVP] Silent mode ${enabled ? 'enabled' : 'disabled'}`);
    }

    syncSilentModeUI(isEnabled) {
        const checkbox = this.shadowRoot?.getElementById('gvp-silent-mode-checkbox');
        if (checkbox) {
            checkbox.checked = !!isEnabled;
        }
        this._syncAudioFieldsWithState();
    }

    _syncAudioFieldsWithState() {
        if (!this.shadowRoot) {
            return;
        }

        const audio = this.stateManager.getState().promptData?.audio || {};
        const mapping = {
            'audio.music': audio.music || '',
            'audio.ambient': audio.ambient || '',
            'audio.sound_effect': audio.sound_effect || '',
            'audio.mix_level': audio.mix_level || ''
        };

        Object.entries(mapping).forEach(([fieldKey, value]) => {
            const textarea = this.shadowRoot.querySelector(`textarea[data-field-name="${fieldKey}"]`);
            if (textarea) {
                textarea.value = value;
            }
        });
    }
};
