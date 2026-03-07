// a:/Tools n Programs/SD-GrokScripts/grok-video-prompter-extension/src/content/utils/ArrayFieldManager.js
// Manages creation and value retrieval for dynamic array fields in the UI.
// Dependencies: SentenceFormatter

window.ArrayFieldManager = class ArrayFieldManager {
    static _dialoguePresetDefaults = null;

    static resetDialoguePresetDefaults() {
        this._dialoguePresetDefaults = null;
    }

    static createDialogueList(options = {}) {
        const {
            shadowRoot,
            initialValues = [],
            dialogueConfig = {},
            dialogueItemOptions = {}
        } = options;

        if (!shadowRoot) {
            window.Logger.error('UI', 'ArrayFieldManager.createDialogueList: shadowRoot is required');
            return document.createElement('div'); // Return empty div to prevent crash
        }

        return this.createArrayField(
            shadowRoot,
            'dialogue',
            initialValues,
            'Enter dialogue...',
            false, // withFullscreen
            {
                dialogueConfig,
                dialogueItemOptions,
                customArrayId: 'dialogue-list-container'
            }
        );
    }

    static createArrayField(shadowRoot, fieldName, values, placeholder, withFullscreen = true, options = {}) {
        const {
            parentCategory = null,
            dialogueConfig = {},
            dialogueItemOptions = {}
        } = options;

        const isDialogueField = fieldName === 'dialogue';
        const resolvedWithFullscreen = isDialogueField ? false : withFullscreen;
        const container = document.createElement('div');
        container.className = 'gvp-array-container';

        const itemsContainer = document.createElement('div');
        itemsContainer.id = options.customArrayId || `array-${fieldName}`;
        if (parentCategory) {
            itemsContainer.dataset.parentCategory = parentCategory;
        }
        itemsContainer.dataset.arrayField = fieldName;

        if (isDialogueField) {
            const maxDuration = typeof dialogueConfig.maxDuration === 'number' ? dialogueConfig.maxDuration : 6;
            const objectOptions = Array.isArray(dialogueConfig.objectOptions) ? dialogueConfig.objectOptions : [];
            itemsContainer.classList.add('gvp-dialogue-container');
            itemsContainer._dialogueConfig = {
                maxDuration,
                objectOptions
            };
        }

        if (values && values.length > 0) {
            values.forEach((value, index) => {
                const item = isDialogueField
                    ? this._createDialogueAccordionItem(
                        shadowRoot,
                        fieldName,
                        value,
                        index,
                        itemsContainer,
                        this._buildDialogueItemOptions(dialogueConfig, dialogueItemOptions)
                    )
                    : this.createArrayItem(shadowRoot, fieldName, value, index, placeholder, resolvedWithFullscreen, itemsContainer);
                itemsContainer.appendChild(item);
            });
        }

        const addBtn = document.createElement('button');
        addBtn.className = 'gvp-button';
        addBtn.textContent = '+ Add Item';
        addBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const newIndex = isDialogueField
                ? itemsContainer.querySelectorAll('.gvp-dialogue-accordion, .gvp-dialogue-item').length
                : itemsContainer.children.length;
            const newItem = isDialogueField
                ? this._createDialogueAccordionItem(
                    shadowRoot,
                    fieldName,
                    null,
                    newIndex,
                    itemsContainer,
                    this._buildDialogueItemOptions(dialogueConfig, dialogueItemOptions)
                )
                : this.createArrayItem(shadowRoot, fieldName, '', newIndex, placeholder, resolvedWithFullscreen, itemsContainer);
            itemsContainer.appendChild(newItem);
            this._updateArrayItemIndexes(itemsContainer);
            if (isDialogueField && typeof dialogueItemOptions.onChange === 'function') {
                dialogueItemOptions.onChange(itemsContainer);
            }
        });



        container.appendChild(itemsContainer);
        container.appendChild(addBtn);
        this._updateArrayItemIndexes(itemsContainer);
        return container;
    }

    static _buildDialogueItemOptions(dialogueConfig = {}, dialogueItemOptions = {}) {
        const configOverrides = {
            maxDuration: typeof dialogueConfig.maxDuration === 'number' ? dialogueConfig.maxDuration : undefined,
            objectOptions: Array.isArray(dialogueConfig.objectOptions) ? dialogueConfig.objectOptions : undefined
        };

        return {
            includeSaveButton: dialogueItemOptions.includeSaveButton !== false,
            dialogueConfig: {
                ...configOverrides,
                ...(dialogueItemOptions.dialogueConfig || {})
            },
            onRemove: dialogueItemOptions.onRemove,
            onChange: dialogueItemOptions.onChange
        };
    }

    static createArrayItem(shadowRoot, fieldName, value, index, placeholder, withFullscreen = true, parentContainer = null) {
        const item = document.createElement('div');
        item.className = 'gvp-array-item';

        const effectiveField = parentContainer?.dataset?.arrayField || fieldName;
        const parentCategory = parentContainer?.dataset?.parentCategory || null;

        let input;
        if (effectiveField === 'tags') {
            input = document.createElement('input');
            input.type = 'text';
            input.className = 'gvp-input';
            input.value = value || '';
            input.placeholder = placeholder;
        } else {
            input = document.createElement('textarea');
            input.className = 'gvp-textarea';
            input.value = SentenceFormatter.toDisplay(value || '');
            input.placeholder = placeholder;
            input.rows = 2;
        }

        input.dataset.fieldName = effectiveField;
        input.dataset.index = index;
        input.dataset.arrayIndex = index;
        input.dataset.arrayFieldInput = 'true';
        input.dataset.syncAttached = 'false';

        input.addEventListener('input', (e) => {
            e.stopPropagation();
        });

        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
        }, { passive: true });

        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'gvp-array-input';
        inputWrapper.appendChild(input);

        const controls = document.createElement('div');
        controls.className = 'gvp-array-controls';

        if (withFullscreen) {
            const fullscreenBtn = document.createElement('button');
            fullscreenBtn.type = 'button';
            fullscreenBtn.className = 'gvp-button';
            fullscreenBtn.textContent = '⛶';
            fullscreenBtn.dataset.role = 'fullscreen';
            fullscreenBtn.dataset.arrayIndex = index;
            fullscreenBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const arrayIndex = Number(fullscreenBtn.dataset.arrayIndex);
                const labelPrefix = effectiveField.charAt(0).toUpperCase() + effectiveField.slice(1).replace(/_/g, ' ');
                const displayLabel = `${labelPrefix} Item ${arrayIndex + 1}`;
                window.gvpOpenFullscreen(displayLabel, input.value, parentCategory || effectiveField, `${effectiveField}[${arrayIndex}]`, {
                    arrayField: effectiveField,
                    arrayIndex,
                    parentCategory,
                    isArray: true
                });
            });
            controls.appendChild(fullscreenBtn);
        }

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'gvp-button gvp-save-btn';
        saveBtn.innerHTML = '&#x1F4BE;';
        saveBtn.title = 'Save as Custom Object';
        saveBtn.dataset.arrayIndex = index;
        saveBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            let val = input.value.trim();
            if (!val) return;

            if (effectiveField === 'objects') {
                const hasColon = val.includes(':');
                if (!hasColon) {
                    val = `${val}:`;
                }
                val = val.replace(/:+\s*$/, ':'); // collapse trailing colons
                // Ensure a single space after the first colon for readability
                val = val.replace(/:\s*/, ': ').replace(/\s+$/, ' ');
                // Guarantee trailing space for downstream insertions
                if (!val.endsWith(' ')) {
                    val = `${val} `;
                }
            }

            if (window.gvpStateManager && typeof window.gvpStateManager.saveCustomObject === 'function') {
                try {
                    await window.gvpStateManager.saveCustomObject(val);
                    const originalHTML = saveBtn.innerHTML;
                    saveBtn.textContent = '✓';
                    setTimeout(() => { saveBtn.innerHTML = originalHTML; }, 1000);
                } catch (err) {
                    window.Logger.error('UI', 'Failed to save custom object:', err);
                    alert('Failed to save: ' + err.message);
                }
            } else {
                window.Logger.warn('UI', 'StateManager not available');
            }
        });
        controls.appendChild(saveBtn);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'gvp-button';
        removeBtn.textContent = '×';
        removeBtn.dataset.parentCategory = parentCategory;
        removeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const accordionRoot = item.closest('.gvp-dialogue-accordion');
            if (accordionRoot && accordionRoot.parentNode) {
                accordionRoot.remove();
            } else {
                item.remove();
            }
            if (parentContainer) {
                window.ArrayFieldManager._updateArrayItemIndexes(parentContainer);
            }
            // Auto-save removed - use "Go Back & Save" instead
            if (typeof onRemove === 'function') {
                onRemove(parentContainer);
            }
        });
        controls.appendChild(removeBtn);

        item.appendChild(inputWrapper);
        item.appendChild(controls);
        return item;
    }

    static _createDialogueAccordionItem(shadowRoot, fieldName, value, index, parentContainer, options = {}) {
        const helpers = window.UIHelpers ? new window.UIHelpers() : null;
        if (!helpers || typeof helpers.createAccordionSection !== 'function') {
            return this.createDialogueItem(shadowRoot, fieldName, value, index, parentContainer, options);
        }

        const dialogueItem = this.createDialogueItem(shadowRoot, fieldName, value, index, parentContainer, options);

        const accordion = helpers.createAccordionSection({
            title: `Dialogue Line ${index + 1}`,
            defaultOpen: value == null,
            content: dialogueItem
        });

        accordion.root.classList.add('gvp-dialogue-accordion');

        const removeBtn = accordion.root.querySelector('.gvp-array-item .gvp-button:last-child');
        if (removeBtn) {
            removeBtn.classList.add('gvp-dialogue-remove-btn');
        }

        parentContainer._dialogueAccordions = parentContainer._dialogueAccordions || [];
        parentContainer._dialogueAccordions.push(accordion);

        return accordion.root;
    }

    static getArrayValues(shadowRoot, fieldName) {
        const container = shadowRoot.getElementById(`array-${fieldName}`);
        if (!container) return [];
        if (fieldName === 'dialogue') {
            const config = container._dialogueConfig || {};
            const maxDuration = typeof config.maxDuration === 'number' ? config.maxDuration : 6;
            const items = container.querySelectorAll('.gvp-dialogue-item');
            return Array.from(items).map(item => this._collectDialogueItemValue(item, maxDuration));
        }
        const inputs = container.querySelectorAll('input, textarea');
        return Array.from(inputs).map(inp => {
            const val = inp.value.trim();
            return fieldName === 'tags' ? val : SentenceFormatter.toStorage(val);
        }).filter(v => v.length > 0);
    }

    static _updateArrayItemIndexes(container) {
        if (!container) {
            return;
        }

        const items = container.querySelectorAll('.gvp-array-item');
        items.forEach((item, idx) => {
            item.dataset.arrayIndex = idx;

            const controls = item.querySelectorAll('[data-array-field-input="true"]');
            controls.forEach(control => {
                control.dataset.index = idx;
                control.dataset.arrayIndex = idx;
            });

            const fullscreenBtn = item.querySelector('[data-role="fullscreen"]');
            if (fullscreenBtn) {
                fullscreenBtn.dataset.arrayIndex = idx;
            }

            const saveBtn = item.querySelector('.gvp-save-btn');
            if (saveBtn) {
                saveBtn.dataset.arrayIndex = idx;
            }
        });

        const accordions = container.querySelectorAll('.gvp-dialogue-accordion');
        accordions.forEach((accordion, idx) => {
            const titleNode = accordion.querySelector('.gvp-accordion-title');
            if (titleNode) {
                titleNode.textContent = `Dialogue Line ${idx + 1}`;
            }

            const arrayItem = accordion.querySelector('.gvp-array-item');
            if (arrayItem) {
                arrayItem.dataset.arrayIndex = idx;
                const controls = arrayItem.querySelectorAll('[data-array-field-input="true"]');
                controls.forEach(control => {
                    control.dataset.index = idx;
                    control.dataset.arrayIndex = idx;
                });

                const fullscreenBtn = arrayItem.querySelector('[data-role="fullscreen"]');
                if (fullscreenBtn) {
                    fullscreenBtn.dataset.arrayIndex = idx;
                }

                const saveBtn = arrayItem.querySelector('.gvp-save-btn');
                if (saveBtn) {
                    saveBtn.dataset.arrayIndex = idx;
                }
            }
        });

        if (container) {
            container._dialogueAccordions = Array.from(accordions);
        }
    }

    static createDialogueItem(shadowRoot, fieldName, value, index, parentContainer, options = {}) {
        const item = document.createElement('div');
        item.className = 'gvp-array-item gvp-dialogue-item';
        item.dataset.arrayIndex = index;

        const logDialogueDebug = (message, payload = {}) => {
            try {
                window.Logger.debug('Dialogue', message, { index, ...payload });
            } catch (err) {
                // no-op safeguard for logging failures
            }
        };

        const config = parentContainer?._dialogueConfig || {};
        const maxDuration = typeof config.maxDuration === 'number' ? config.maxDuration : 6;
        const dialogueValue = this._normalizeDialogueValue(value);

        if (!this._dialoguePresetDefaults) {
            const presets = (window.uiConstants && window.uiConstants.DIALOGUE_PRESETS) || {};
            this._dialoguePresetDefaults = {
                accent: Array.isArray(presets.accent) ? [...presets.accent] : [],
                language: Array.isArray(presets.language) ? [...presets.language] : [],
                emotion: Array.isArray(presets.emotion) ? [...presets.emotion] : [],
                type: Array.isArray(presets.type) ? [...presets.type] : []
            };
        }

        const sharedCustoms = (window.gvpStateManager && typeof window.gvpStateManager.getCustomDropdownOptions === 'function')
            ? window.gvpStateManager.getCustomDropdownOptions()
            : (window.gvpUIManager?.stateManager?.getCustomDropdownOptions?.() || null);

        const mergeCustoms = (field) => {
            const key = `dialogue.${field}`;
            const existing = this._dialoguePresetDefaults[field] || [];
            const customValues = Array.isArray(sharedCustoms?.[key]) ? sharedCustoms[key] : [];
            const merged = Array.from(new Set([...existing, ...customValues.filter(val => typeof val === 'string')]));
            this._dialoguePresetDefaults[field] = merged;
            return merged;
        };

        const accentPreset = mergeCustoms('accent');
        const languagePreset = mergeCustoms('language');
        const emotionPreset = mergeCustoms('emotion');
        const typePreset = mergeCustoms('type');

        const effectiveConfig = {
            ...config,
            ...(options.dialogueConfig || {}),
            accentOptions: Array.isArray((options.dialogueConfig || {}).accentOptions)
                ? Array.from(new Set([...(options.dialogueConfig.accentOptions || []), ...accentPreset]))
                : accentPreset,
            languageOptions: Array.isArray((options.dialogueConfig || {}).languageOptions)
                ? Array.from(new Set([...(options.dialogueConfig.languageOptions || []), ...languagePreset]))
                : languagePreset,
            emotionOptions: Array.isArray((options.dialogueConfig || {}).emotionOptions)
                ? Array.from(new Set([...(options.dialogueConfig.emotionOptions || []), ...emotionPreset]))
                : emotionPreset,
            typeOptions: Array.isArray((options.dialogueConfig || {}).typeOptions)
                ? Array.from(new Set([...(options.dialogueConfig.typeOptions || []), ...typePreset]))
                : typePreset
        };

        const includeSaveButton = options.includeSaveButton !== false;
        const onRemove = typeof options.onRemove === 'function' ? options.onRemove : null;
        const onChange = typeof options.onChange === 'function' ? options.onChange : null;

        const grid = document.createElement('div');
        grid.className = 'gvp-dialogue-grid';

        const guardInteractiveElement = (el) => {
            if (!el) {
                return;
            }
            const stop = (e) => {
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') {
                    e.stopImmediatePropagation();
                }
            };
            el.addEventListener('keydown', stop, { capture: true });
            el.addEventListener('keyup', stop, { capture: true });
            el.addEventListener('keypress', stop, { capture: true });
            el.addEventListener('click', stop, { capture: true });
        };

        const attachChangeListener = (el) => {
            if (!el || !onChange) {
                if (el) {
                    el.addEventListener('change', (event) => {
                        logDialogueDebug('Field change (no onChange handler)', {
                            role: event.target.dataset.role,
                            value: event.target.value
                        });
                    });
                    el.addEventListener('input', (event) => {
                        logDialogueDebug('Field input (no onChange handler)', {
                            role: event.target.dataset.role,
                            value: event.target.value
                        });
                    });
                }
                return;
            }
            const handler = (event) => onChange(parentContainer, event);
            el.addEventListener('input', handler, { capture: true });
            el.addEventListener('change', handler, { capture: true });
        };

        const bindCustomToggle = (selectEl, customEl) => {
            if (!selectEl || !customEl) {
                return;
            }
            const syncVisibility = () => {
                logDialogueDebug('Custom toggle sync', {
                    role: selectEl.dataset.role,
                    selectValue: selectEl.value
                });
                if (selectEl.value === '__custom') {
                    customEl.style.display = '';
                    customEl.required = false;
                } else {
                    customEl.style.display = 'none';
                    customEl.required = false;
                    customEl.value = '';
                }
            };
            selectEl.addEventListener('change', syncVisibility);
            syncVisibility();
        };

        const createField = (labelText, element, modifier) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'gvp-dialogue-field';
            if (modifier) {
                wrapper.classList.add(`gvp-dialogue-field--${modifier}`);
            }
            const label = document.createElement('label');
            label.textContent = labelText;
            wrapper.appendChild(label);
            wrapper.appendChild(element);
            return wrapper;
        };

        // Characters dropdown + custom input
        const characterWrapper = document.createElement('div');
        characterWrapper.className = 'gvp-dialogue-field gvp-dialogue-field--character';
        characterWrapper.dataset.dialogueField = 'characters';
        const characterLabel = document.createElement('label');
        characterLabel.textContent = 'Character';
        characterWrapper.appendChild(characterLabel);

        const characterSelect = document.createElement('select');
        characterSelect.dataset.role = 'character-select';
        characterSelect.dataset.arrayFieldInput = 'true';
        characterSelect.dataset.arrayIndex = index;
        characterSelect.dataset.syncAttached = 'false';
        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = 'Select character';
        characterSelect.appendChild(placeholderOption);

        const characterOptions = Array.isArray(config.objectOptions) ? config.objectOptions : [];
        characterOptions.forEach(opt => {
            const optionEl = document.createElement('option');
            optionEl.value = opt;
            optionEl.textContent = opt;
            characterSelect.appendChild(optionEl);
        });

        const customOption = document.createElement('option');
        customOption.value = '__custom';
        customOption.textContent = 'Custom…';
        characterSelect.appendChild(customOption);
        characterSelect.addEventListener('change', (event) => {
            logDialogueDebug('Character select changed', { value: event.target.value });
        });
        guardInteractiveElement(characterSelect);
        attachChangeListener(characterSelect);

        const characterInputs = document.createElement('div');
        characterInputs.className = 'gvp-dialogue-character-inputs';
        characterInputs.appendChild(characterSelect);

        const characterCustom = document.createElement('input');
        characterCustom.type = 'text';
        characterCustom.className = 'gvp-input gvp-dialogue-custom-character';
        characterCustom.placeholder = 'Enter character name';
        characterCustom.dataset.role = 'character-custom';
        characterCustom.dataset.arrayFieldInput = 'true';
        characterCustom.dataset.arrayIndex = index;
        characterCustom.dataset.syncAttached = 'false';
        characterCustom.style.display = 'none';
        guardInteractiveElement(characterCustom);
        attachChangeListener(characterCustom);
        characterCustom.addEventListener('input', (event) => {
            logDialogueDebug('Character custom input', { value: event.target.value });
        });

        characterInputs.appendChild(characterCustom);
        characterWrapper.appendChild(characterInputs);
        grid.appendChild(characterWrapper);

        // Content textarea (spans grid)
        const contentTextarea = document.createElement('textarea');
        contentTextarea.className = 'gvp-textarea';
        contentTextarea.rows = 2;
        contentTextarea.placeholder = 'Dialogue line';
        contentTextarea.dataset.role = 'content';
        contentTextarea.dataset.arrayFieldInput = 'true';
        contentTextarea.dataset.arrayIndex = index;
        contentTextarea.dataset.syncAttached = 'false';
        guardInteractiveElement(contentTextarea);
        attachChangeListener(contentTextarea);
        const contentField = createField('Content', contentTextarea, 'content');
        contentField.dataset.dialogueField = 'content';
        grid.appendChild(contentField);

        const accentSelect = document.createElement('select');
        accentSelect.className = 'gvp-select';
        accentSelect.dataset.role = 'accent';
        accentSelect.dataset.arrayFieldInput = 'true';
        accentSelect.dataset.arrayIndex = index;
        accentSelect.dataset.syncAttached = 'false';
        const accentPlaceholder = document.createElement('option');
        accentPlaceholder.value = '';
        accentPlaceholder.textContent = 'Select accent';
        accentSelect.appendChild(accentPlaceholder);
        const accentOptions = Array.isArray(effectiveConfig.accentOptions)
            ? effectiveConfig.accentOptions
            : ArrayFieldManager._dialoguePresetDefaults.accent;
        accentOptions.forEach(opt => {
            const optionEl = document.createElement('option');
            optionEl.value = opt;
            optionEl.textContent = opt;
            accentSelect.appendChild(optionEl);
        });
        const accentCustomOption = document.createElement('option');
        accentCustomOption.value = '__custom';
        accentCustomOption.textContent = 'Custom…';
        accentSelect.appendChild(accentCustomOption);
        accentSelect.addEventListener('change', (event) => {
            logDialogueDebug('Accent select changed', { value: event.target.value });
        });
        grid.appendChild(createField('Accent', accentSelect, 'accent'));
        guardInteractiveElement(accentSelect);
        attachChangeListener(accentSelect);

        const accentCustomInput = document.createElement('input');
        accentCustomInput.type = 'text';
        accentCustomInput.className = 'gvp-input gvp-dialogue-custom-accent';
        accentCustomInput.placeholder = 'Enter accent';
        accentCustomInput.dataset.role = 'accent-custom';
        accentCustomInput.dataset.arrayFieldInput = 'true';
        accentCustomInput.dataset.arrayIndex = index;
        accentCustomInput.dataset.syncAttached = 'false';
        accentCustomInput.style.display = 'none';
        guardInteractiveElement(accentCustomInput);
        attachChangeListener(accentCustomInput);
        const accentField = grid.querySelector('.gvp-dialogue-field--accent');
        if (accentField) {
            accentField.appendChild(accentCustomInput);
        }
        bindCustomToggle(accentSelect, accentCustomInput);
        accentCustomInput.addEventListener('input', (event) => {
            logDialogueDebug('Accent custom input', { value: event.target.value });
        });

        const languageSelect = document.createElement('select');
        languageSelect.className = 'gvp-select';
        languageSelect.dataset.role = 'language';
        languageSelect.dataset.arrayFieldInput = 'true';
        languageSelect.dataset.arrayIndex = index;
        languageSelect.dataset.syncAttached = 'false';
        const languagePlaceholder = document.createElement('option');
        languagePlaceholder.value = '';
        languagePlaceholder.textContent = 'Select language';
        languageSelect.appendChild(languagePlaceholder);
        const languageOptions = Array.isArray(effectiveConfig.languageOptions)
            ? effectiveConfig.languageOptions
            : ArrayFieldManager._dialoguePresetDefaults.language;
        languageOptions.forEach(opt => {
            const optionEl = document.createElement('option');
            optionEl.value = opt;
            optionEl.textContent = opt;
            languageSelect.appendChild(optionEl);
        });
        const languageCustomOption = document.createElement('option');
        languageCustomOption.value = '__custom';
        languageCustomOption.textContent = 'Custom…';
        languageSelect.appendChild(languageCustomOption);
        languageSelect.addEventListener('change', (event) => {
            logDialogueDebug('Language select changed', { value: event.target.value });
        });
        grid.appendChild(createField('Language', languageSelect, 'language'));
        guardInteractiveElement(languageSelect);
        attachChangeListener(languageSelect);

        const languageCustomInput = document.createElement('input');
        languageCustomInput.type = 'text';
        languageCustomInput.className = 'gvp-input gvp-dialogue-custom-language';
        languageCustomInput.placeholder = 'Enter language';
        languageCustomInput.dataset.role = 'language-custom';
        languageCustomInput.dataset.arrayFieldInput = 'true';
        languageCustomInput.dataset.arrayIndex = index;
        languageCustomInput.dataset.syncAttached = 'false';
        languageCustomInput.style.display = 'none';
        guardInteractiveElement(languageCustomInput);
        attachChangeListener(languageCustomInput);
        const languageField = grid.querySelector('.gvp-dialogue-field--language');
        if (languageField) {
            languageField.appendChild(languageCustomInput);
        }
        bindCustomToggle(languageSelect, languageCustomInput);
        languageCustomInput.addEventListener('input', (event) => {
            logDialogueDebug('Language custom input', { value: event.target.value });
        });

        const emotionSelect = document.createElement('select');
        emotionSelect.className = 'gvp-select';
        emotionSelect.dataset.role = 'emotion';
        emotionSelect.dataset.arrayFieldInput = 'true';
        emotionSelect.dataset.arrayIndex = index;
        emotionSelect.dataset.syncAttached = 'false';
        const emotionPlaceholder = document.createElement('option');
        emotionPlaceholder.value = '';
        emotionPlaceholder.textContent = 'Select emotion';
        emotionSelect.appendChild(emotionPlaceholder);
        const emotionOptions = Array.isArray(effectiveConfig.emotionOptions)
            ? effectiveConfig.emotionOptions
            : ArrayFieldManager._dialoguePresetDefaults.emotion;
        emotionOptions.forEach(opt => {
            const optionEl = document.createElement('option');
            optionEl.value = opt;
            optionEl.textContent = opt;
            emotionSelect.appendChild(optionEl);
        });
        const emotionCustomOption = document.createElement('option');
        emotionCustomOption.value = '__custom';
        emotionCustomOption.textContent = 'Custom…';
        emotionSelect.appendChild(emotionCustomOption);
        emotionSelect.addEventListener('change', (event) => {
            logDialogueDebug('Emotion select changed', { value: event.target.value });
        });
        grid.appendChild(createField('Emotion', emotionSelect, 'emotion'));
        guardInteractiveElement(emotionSelect);
        attachChangeListener(emotionSelect);

        const emotionCustomInput = document.createElement('input');
        emotionCustomInput.type = 'text';
        emotionCustomInput.className = 'gvp-input gvp-dialogue-custom-emotion';
        emotionCustomInput.placeholder = 'Enter emotion';
        emotionCustomInput.dataset.role = 'emotion-custom';
        emotionCustomInput.dataset.arrayFieldInput = 'true';
        emotionCustomInput.dataset.arrayIndex = index;
        emotionCustomInput.dataset.syncAttached = 'false';
        emotionCustomInput.style.display = 'none';
        guardInteractiveElement(emotionCustomInput);
        attachChangeListener(emotionCustomInput);
        const emotionField = grid.querySelector('.gvp-dialogue-field--emotion');
        if (emotionField) {
            emotionField.appendChild(emotionCustomInput);
        }
        bindCustomToggle(emotionSelect, emotionCustomInput);
        emotionCustomInput.addEventListener('input', (event) => {
            logDialogueDebug('Emotion custom input', { value: event.target.value });
        });

        const typeSelect = document.createElement('select');
        typeSelect.className = 'gvp-select';
        typeSelect.dataset.role = 'type';
        typeSelect.dataset.arrayFieldInput = 'true';
        typeSelect.dataset.arrayIndex = index;
        typeSelect.dataset.syncAttached = 'false';
        const typePlaceholder = document.createElement('option');
        typePlaceholder.value = '';
        typePlaceholder.textContent = 'Select type';
        typeSelect.appendChild(typePlaceholder);
        const typeOptions = Array.isArray(effectiveConfig.typeOptions)
            ? effectiveConfig.typeOptions
            : ArrayFieldManager._dialoguePresetDefaults.type;
        typeOptions.forEach(opt => {
            const optionEl = document.createElement('option');
            optionEl.value = opt;
            optionEl.textContent = opt;
            typeSelect.appendChild(optionEl);
        });
        const typeCustomOption = document.createElement('option');
        typeCustomOption.value = '__custom';
        typeCustomOption.textContent = 'Custom…';
        typeSelect.appendChild(typeCustomOption);
        typeSelect.addEventListener('change', (event) => {
            logDialogueDebug('Type select changed', { value: event.target.value });
        });
        grid.appendChild(createField('Type', typeSelect, 'type'));
        guardInteractiveElement(typeSelect);
        attachChangeListener(typeSelect);

        const typeCustomInput = document.createElement('input');
        typeCustomInput.type = 'text';
        typeCustomInput.className = 'gvp-input gvp-dialogue-custom-type';
        typeCustomInput.placeholder = 'Enter type';
        typeCustomInput.dataset.role = 'type-custom';
        typeCustomInput.dataset.arrayFieldInput = 'true';
        typeCustomInput.dataset.arrayIndex = index;
        typeCustomInput.dataset.syncAttached = 'false';
        typeCustomInput.style.display = 'none';
        guardInteractiveElement(typeCustomInput);
        attachChangeListener(typeCustomInput);
        const typeField = grid.querySelector('.gvp-dialogue-field--type');
        if (typeField) {
            typeField.appendChild(typeCustomInput);
        }
        bindCustomToggle(typeSelect, typeCustomInput);
        typeCustomInput.addEventListener('input', (event) => {
            logDialogueDebug('Type custom input', { value: event.target.value });
        });

        const subtitlesWrapper = document.createElement('div');
        subtitlesWrapper.className = 'gvp-dialogue-field gvp-dialogue-checkbox gvp-dialogue-field--subtitles';
        const subtitlesLabel = document.createElement('label');
        subtitlesLabel.textContent = 'Subtitles';
        const subtitlesInput = document.createElement('input');
        subtitlesInput.type = 'checkbox';
        subtitlesInput.dataset.role = 'subtitles';
        subtitlesInput.dataset.arrayFieldInput = 'true';
        subtitlesInput.dataset.arrayIndex = index;
        subtitlesInput.dataset.syncAttached = 'false';
        subtitlesWrapper.appendChild(subtitlesLabel);
        subtitlesWrapper.appendChild(subtitlesInput);
        guardInteractiveElement(subtitlesInput);
        attachChangeListener(subtitlesInput);
        subtitlesInput.addEventListener('change', (event) => {
            logDialogueDebug('Subtitles toggled', { checked: event.target.checked });
        });

        const timesWrapper = document.createElement('div');
        timesWrapper.className = 'gvp-dialogue-field gvp-dialogue-times gvp-dialogue-field--timing';
        const timesLabel = document.createElement('label');
        timesLabel.textContent = 'Timing (seconds)';
        timesWrapper.appendChild(timesLabel);

        const startInput = document.createElement('input');
        startInput.type = 'number';
        startInput.className = 'gvp-input gvp-dialogue-time-input';
        startInput.min = '0';
        startInput.max = String(maxDuration);
        startInput.step = '1';
        startInput.dataset.role = 'start-seconds';
        startInput.dataset.arrayFieldInput = 'true';
        startInput.dataset.arrayIndex = index;
        startInput.dataset.syncAttached = 'false';
        startInput.placeholder = 'Start';
        guardInteractiveElement(startInput);
        attachChangeListener(startInput);
        startInput.addEventListener('input', (event) => {
            logDialogueDebug('Start time input', { value: event.target.value });
        });

        const endInput = document.createElement('input');
        endInput.type = 'number';
        endInput.className = 'gvp-input gvp-dialogue-time-input';
        endInput.min = '0';
        endInput.max = String(maxDuration);
        endInput.step = '1';
        endInput.dataset.role = 'end-seconds';
        endInput.dataset.arrayFieldInput = 'true';
        endInput.dataset.arrayIndex = index;
        endInput.dataset.syncAttached = 'false';
        endInput.placeholder = 'End';
        guardInteractiveElement(endInput);
        attachChangeListener(endInput);
        endInput.addEventListener('input', (event) => {
            logDialogueDebug('End time input', { value: event.target.value });
        });

        const timeInputsWrapper = document.createElement('div');
        timeInputsWrapper.className = 'gvp-dialogue-time-pair';
        timeInputsWrapper.appendChild(startInput);
        timeInputsWrapper.appendChild(endInput);
        timesWrapper.appendChild(timeInputsWrapper);
        grid.appendChild(timesWrapper);

        const controls = document.createElement('div');
        controls.className = 'gvp-array-controls';

        if (includeSaveButton) {
            const saveBtn = document.createElement('button');
            saveBtn.type = 'button';
            saveBtn.className = 'gvp-button gvp-save-btn';
            saveBtn.innerHTML = '&#x1F4BE;';
            saveBtn.title = 'Save as Custom Dialogue';
            saveBtn.dataset.arrayIndex = index;
            saveBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                const dialogueObj = this._collectDialogueItemValue(item, maxDuration);

                if (window.gvpStateManager && typeof window.gvpStateManager.saveCustomDialogue === 'function') {
                    try {
                        await window.gvpStateManager.saveCustomDialogue(dialogueObj);
                        const originalHTML = saveBtn.innerHTML;
                        saveBtn.textContent = '✓';
                        setTimeout(() => { saveBtn.innerHTML = originalHTML; }, 1000);
                    } catch (err) {
                        window.Logger.error('UI', 'Failed to save custom dialogue:', err);
                        alert('Failed to save: ' + err.message);
                    }
                } else {
                    window.Logger.warn('UI', 'StateManager not available');
                }
            });
            controls.appendChild(saveBtn);
        }

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'gvp-button';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const accordionRoot = item.closest('.gvp-dialogue-accordion');
            if (accordionRoot && accordionRoot.parentNode) {
                accordionRoot.remove();
            } else {
                item.remove();
            }
            if (parentContainer) {
                window.ArrayFieldManager._updateArrayItemIndexes(parentContainer);
            }
            if (typeof onRemove === 'function') {
                onRemove(parentContainer);
            }
        });
        controls.appendChild(removeBtn);

        const actionsField = document.createElement('div');
        actionsField.className = 'gvp-dialogue-field gvp-dialogue-field--actions';
        actionsField.appendChild(subtitlesWrapper);
        actionsField.appendChild(controls);
        grid.appendChild(actionsField);

        item.appendChild(grid);

        this._fillDialogueItem(item, dialogueValue, effectiveConfig);

        const toggleCustomVisibility = () => {
            if (characterSelect.value === '__custom') {
                characterCustom.style.display = '';
                characterCustom.required = true;
            } else {
                characterCustom.style.display = 'none';
                characterCustom.required = false;
            }
        };

        characterSelect.addEventListener('change', () => {
            toggleCustomVisibility();
        });

        toggleCustomVisibility();

        const enforceTimeBounds = () => {
            const startSeconds = parseFloat(startInput.value);
            const endSeconds = parseFloat(endInput.value);

            if (!Number.isNaN(startSeconds)) {
                const clampedStart = Math.max(0, Math.min(startSeconds, maxDuration));
                startInput.value = clampedStart.toFixed(3).replace(/0+$/, '').replace(/[.]$/, '');
            }
            if (!Number.isNaN(endSeconds)) {
                endInput.value = endSeconds.toFixed(3).replace(/0+$/, '').replace(/[.]$/, '');
            }
        };

        startInput.addEventListener('change', enforceTimeBounds);
        endInput.addEventListener('change', enforceTimeBounds);

        if (onChange) {
            startInput.addEventListener('blur', () => onChange(parentContainer));
            endInput.addEventListener('blur', () => onChange(parentContainer));
        }

        return item;
    }

    static collectDialogueValues(container) {
        if (!container) {
            return [];
        }

        const config = container._dialogueConfig || {};
        const maxDuration = typeof config.maxDuration === 'number' ? config.maxDuration : 6;
        const items = container.querySelectorAll('.gvp-dialogue-item');
        return Array.from(items).map(item => this._collectDialogueItemValue(item, maxDuration));
    }

    static updateDialogueCharacterOptions(container, options = []) {
        if (!container) return;
        if (!Array.isArray(options)) return;
        const config = container._dialogueConfig || {};
        config.objectOptions = options;
        container._dialogueConfig = config;

        const selects = container.querySelectorAll('select[data-role="character-select"]');
        selects.forEach(select => {
            const currentValue = select.value;
            const customInput = select.parentElement?.querySelector('[data-role="character-custom"]');

            // Remove existing dynamic options (excluding placeholder and custom)
            while (select.options.length > 0) {
                const opt = select.options[0];
                if (opt.value === '' || opt.value === '__custom') {
                    select.removeChild(opt);
                    select.appendChild(opt);
                    break;
                }
                select.removeChild(opt);
            }

            // Reset options: ensure placeholder and custom exist once
            select.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Select character';
            select.appendChild(placeholder);

            options.forEach(opt => {
                const optionEl = document.createElement('option');
                optionEl.value = opt;
                optionEl.textContent = opt;
                select.appendChild(optionEl);
            });

            const customOption = document.createElement('option');
            customOption.value = '__custom';
            customOption.textContent = 'Custom…';
            select.appendChild(customOption);

            if (options.includes(currentValue)) {
                select.value = currentValue;
                if (customInput) {
                    customInput.style.display = 'none';
                }
            } else if (currentValue === '__custom' && customInput) {
                select.value = '__custom';
                customInput.style.display = '';
            } else if (customInput && customInput.value) {
                select.value = '__custom';
                customInput.style.display = '';
            } else {
                select.value = '';
                if (customInput) {
                    customInput.style.display = 'none';
                }
            }
        });
    }

    static _normalizeDialogueValue(value) {
        const defaults = {
            characters: '',
            content: '',
            accent: 'neutral',
            language: 'English',
            emotion: '',
            type: 'spoken',
            subtitles: false,
            start_time: '00:00:00.000',
            end_time: '00:00:01.000'
        };

        if (typeof value === 'string' && value.trim().length > 0) {
            return {
                ...defaults,
                content: value.trim()
            };
        }

        if (!value || typeof value !== 'object') {
            return { ...defaults };
        }

        return {
            ...defaults,
            ...value
        };
    }

    static _fillDialogueItem(item, dialogue, config = {}) {
        if (!item || !dialogue) return;
        const maxDuration = typeof config.maxDuration === 'number' ? config.maxDuration : 6;
        const options = Array.isArray(config.objectOptions) ? config.objectOptions : [];

        const select = item.querySelector('select[data-role="character-select"]');
        const customInput = item.querySelector('[data-role="character-custom"]');
        if (select) {
            if (!options.includes(dialogue.characters) && dialogue.characters) {
                select.value = '__custom';
                if (customInput) {
                    customInput.value = dialogue.characters;
                    customInput.style.display = '';
                }
            } else {
                select.value = dialogue.characters || '';
                if (customInput) {
                    customInput.value = '';
                    customInput.style.display = 'none';
                }
            }
        }

        if (customInput && select && select.value === '__custom') {
            customInput.value = customInput.value || dialogue.characters || '';
            customInput.style.display = '';
        }

        const ensureOption = (selectEl, value) => {
            if (!selectEl || !value) {
                return;
            }

            const exists = Array.from(selectEl.options || []).some(opt => opt.value === value);
            if (exists) {
                return;
            }

            const optionEl = document.createElement('option');
            optionEl.value = value;
            optionEl.textContent = value;

            const customOpt = Array.from(selectEl.options || []).find(opt => opt.value === '__custom');
            if (customOpt) {
                selectEl.insertBefore(optionEl, customOpt);
            } else {
                selectEl.appendChild(optionEl);
            }
        };

        const setSelectOrInput = (selector, value, fallback = '', customSelector = null) => {
            const el = item.querySelector(selector);
            const custom = customSelector ? item.querySelector(customSelector) : null;
            if (!el) {
                if (custom) {
                    custom.value = value ?? fallback;
                    custom.style.display = custom.value ? '' : 'none';
                }
                return;
            }

            const normalized = typeof value === 'string' ? value.trim() : '';
            const actual = normalized || fallback;
            if (actual) {
                ensureOption(el, actual);
                el.value = actual;
                if (custom) {
                    custom.value = '';
                    custom.style.display = 'none';
                }
            } else if (custom) {
                el.value = '__custom';
                custom.value = '';
                custom.style.display = 'none';
            } else {
                el.value = '';
            }
        };

        const setInputValue = (selector, value) => {
            const el = item.querySelector(selector);
            if (el) {
                el.value = value ?? '';
            }
        };

        setInputValue('[data-role="content"]', dialogue.content ?? '');
        setSelectOrInput('[data-role="accent"]', dialogue.accent ?? 'neutral', 'neutral', '[data-role="accent-custom"]');
        setSelectOrInput('[data-role="language"]', dialogue.language ?? 'English', 'English', '[data-role="language-custom"]');
        setSelectOrInput('[data-role="emotion"]', dialogue.emotion ?? '', '', '[data-role="emotion-custom"]');
        setSelectOrInput('[data-role="type"]', dialogue.type ?? 'spoken', 'spoken', '[data-role="type-custom"]');

        const subtitlesInput = item.querySelector('[data-role="subtitles"]');
        if (subtitlesInput) {
            subtitlesInput.checked = Boolean(dialogue.subtitles);
        }

        const startInput = item.querySelector('[data-role="start-seconds"]');
        const endInput = item.querySelector('[data-role="end-seconds"]');
        const startSeconds = this._parseTimestampToSeconds(dialogue.start_time);
        const endSeconds = this._parseTimestampToSeconds(dialogue.end_time);

        if (startInput) {
            const clampedStart = this._clampTime(startSeconds, maxDuration);
            startInput.value = Number.isFinite(clampedStart) ? clampedStart : 0;
        }
        if (endInput) {
            let clampedEnd = this._clampTime(endSeconds, maxDuration);
            if (Number.isFinite(startSeconds) && clampedEnd < startSeconds) {
                clampedEnd = startSeconds;
            }
            endInput.value = Number.isFinite(clampedEnd) ? clampedEnd : 0;
        }
    }

    static _collectDialogueItemValue(item, maxDuration) {
        const select = item.querySelector('select[data-role="character-select"]');
        const customInput = item.querySelector('[data-role="character-custom"]');
        let characters = '';
        if (select) {
            if (select.value === '__custom') {
                characters = (customInput?.value || '').trim();
            } else {
                characters = (select.value || '').trim();
            }
        }

        const readValue = (selector) => {
            const el = item.querySelector(selector);
            if (!el) return '';
            return (el.value || '').trim();
        };

        const readSelectOrCustom = (role, fallback = '') => {
            const select = item.querySelector(`select[data-role="${role}"]`);
            if (!select) {
                return fallback;
            }

            const rawValue = (select.value || '').trim();
            if (rawValue === '__custom') {
                const customEl = item.querySelector(`[data-role="${role}-custom"]`);
                const customValue = (customEl?.value || '').trim();
                return customValue || fallback;
            }

            return rawValue || fallback;
        };

        const content = readValue('[data-role="content"]');
        const accent = readSelectOrCustom('accent', 'neutral');
        const language = readSelectOrCustom('language', 'English');
        const emotion = readSelectOrCustom('emotion');
        const type = readSelectOrCustom('type', 'spoken');

        const subtitlesInput = item.querySelector('[data-role="subtitles"]');
        const subtitles = subtitlesInput ? Boolean(subtitlesInput.checked) : false;

        const startInput = item.querySelector('[data-role="start-seconds"]');
        const endInput = item.querySelector('[data-role="end-seconds"]');

        let startSeconds = startInput ? parseFloat(startInput.value) : 0;
        let endSeconds = endInput ? parseFloat(endInput.value) : startSeconds;

        startSeconds = this._clampTime(startSeconds, maxDuration);
        endSeconds = this._clampTime(endSeconds, maxDuration);

        if (!Number.isFinite(startSeconds)) startSeconds = 0;
        if (!Number.isFinite(endSeconds) || endSeconds < startSeconds) {
            endSeconds = startSeconds;
        }

        return {
            characters,
            content,
            accent,
            language,
            emotion,
            type,
            subtitles,
            start_time: this._formatSecondsToTimestamp(startSeconds),
            end_time: this._formatSecondsToTimestamp(endSeconds)
        };
    }

    static _clampTime(value, maxDuration) {
        if (!Number.isFinite(value)) {
            return 0;
        }
        const max = Number.isFinite(maxDuration) ? maxDuration : 6;
        return Math.min(Math.max(value, 0), max);
    }

    static _parseTimestampToSeconds(timestamp) {
        if (typeof timestamp === 'number') {
            return timestamp;
        }
        if (typeof timestamp !== 'string') {
            return 0;
        }
        const trimmed = timestamp.trim();
        if (!trimmed) {
            return 0;
        }
        if (!trimmed.includes(':')) {
            const numeric = parseFloat(trimmed);
            return Number.isFinite(numeric) ? numeric : 0;
        }

        const [hoursStr = '0', minutesStr = '0', secondsPart = '0'] = trimmed.split(':');
        const [secondsStr = '0', millisStr = '0'] = secondsPart.split('.');

        const hours = parseInt(hoursStr, 10) || 0;
        const minutes = parseInt(minutesStr, 10) || 0;
        const seconds = parseInt(secondsStr, 10) || 0;
        const millis = parseInt(millisStr.padEnd(3, '0'), 10) || 0;

        return hours * 3600 + minutes * 60 + seconds + millis / 1000;
    }

    static _formatSecondsToTimestamp(seconds) {
        const totalMillis = Math.round((Number.isFinite(seconds) ? seconds : 0) * 1000);
        const clampedMillis = Math.max(totalMillis, 0);
        const millis = clampedMillis % 1000;
        const totalSeconds = Math.floor(clampedMillis / 1000);
        const secs = totalSeconds % 60;
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const hours = Math.floor(totalSeconds / 3600);

        const pad = (num, size = 2) => String(num).padStart(size, '0');
        return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(millis, 3)}`;
    }
}
    ;
