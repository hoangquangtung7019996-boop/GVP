// a:/Tools n Programs/SD-GrokScripts/grok-video-prompter-extension/src/content/managers/AdvancedRawInputManager.js
// Advanced Raw Input Manager with template integration and batch processing.
// Dependencies: StateManager

window.AdvancedRawInputManager = class AdvancedRawInputManager {
    constructor(stateManager) {
        this.stateManager = stateManager;
        this.templates = new Map();
        this.recentPrompts = new Set();
        this.maxRecentPrompts = 10;
        this.autoSaveInterval = 30000;
        this.autoSaveIntervalId = null;
        this.previewEnabled = true;
        this.quoteWrapping = false;
        this.onRecentPromptsChanged = null;
    }

    /**
     * Initialize with default templates
     */
    initializeTemplates() {
        this.templates.set('cinematic', {
            name: 'Cinematic Scene',
            category: 'Visual',
            prompt: 'A cinematic movie scene with dramatic lighting, professional cinematography, high production value, detailed environment, realistic textures, and immersive atmosphere.',
            tags: ['cinematic', 'movie', 'professional', 'detailed']
        });

        this.templates.set('animation', {
            name: 'Animated Style',
            category: 'Animation',
            prompt: 'A vibrant animated scene with colorful characters, smooth animation, expressive facial features, dynamic camera movements, and engaging storytelling.',
            tags: ['animation', 'colorful', 'expressive', 'dynamic']
        });

        this.templates.set('realistic', {
            name: 'Photorealistic',
            category: 'Realistic',
            prompt: 'A photorealistic scene with ultra-detailed textures, realistic lighting, natural colors, precise shadows, and lifelike proportions.',
            tags: ['photorealistic', 'detailed', 'realistic', 'natural']
        });

        this.templates.set('spicy', {
            name: 'Spicy Content',
            category: 'Enhanced',
            prompt: 'An intense and provocative scene with mature themes, bold artistic choices, sophisticated visual storytelling, and compelling emotional depth.',
            tags: ['intense', 'provocative', 'mature', 'artistic']
        });
    }

    /**
     * Process raw input with enhanced formatting and template integration
     * @param {string} rawText - Raw user input
     * @param {object} options - Processing options
     * @returns {object} Processed prompt data
     */
    processRawInput(rawText, options = {}) {
        let processedPrompt = rawText.trim();

        // Apply quote wrapping if enabled
        if (options.quoteWrapping || this.quoteWrapping) {
            processedPrompt = this.applyQuoteWrapping(processedPrompt);
        }

        // Apply spicy mode if enabled
        if (options.spicyMode) {
            processedPrompt = this.applySpicyMode(processedPrompt);
        }

        // Apply template merging if template selected
        if (options.selectedTemplate) {
            processedPrompt = this.mergeWithTemplate(processedPrompt, options.selectedTemplate);
        }

        // Generate preview and metadata
        const preview = this.generatePreview(processedPrompt, options);

        return {
            original: rawText,
            processed: processedPrompt,
            preview: preview,
            metadata: {
                wordCount: this.countWords(processedPrompt),
                characterCount: processedPrompt.length,
                hasQuotes: processedPrompt.includes('"'),
                hasSpicyMode: processedPrompt.includes('--mode='),
                templateUsed: options.selectedTemplate || null
            }
        };
    }

    /**
     * Apply quote wrapping based on content analysis
     * @param {string} prompt - Prompt to wrap
     * @returns {string} Wrapped prompt
     */
    applyQuoteWrapping(prompt) {
        if (prompt.startsWith('"') && prompt.endsWith('"')) {
            return prompt; // Already wrapped
        }

        return `Create a video of: "${prompt}"`;
    }

    /**
     * Apply spicy mode transformation
     * @param {string} prompt - Original prompt
     * @returns {string} Spicy mode prompt
     */
    applySpicyMode(prompt) {
        // Remove existing mode flags
        let cleanPrompt = prompt.replace(/--mode=[\w-]+/g, '').trim();

        // Add spicy mode
        return `${cleanPrompt} --mode=extremely-spicy-or-crazy`;
    }

    /**
     * Merge with template based on content analysis
     * @param {string} basePrompt - Base prompt
     * @param {string} templateName - Template to merge
     * @returns {string} Merged prompt
     */
    mergeWithTemplate(basePrompt, templateName) {
        const template = this.templates.get(templateName);
        if (!template) return basePrompt;

        // Smart template merging based on content analysis
        if (basePrompt.toLowerCase().includes('scene') ||
            basePrompt.toLowerCase().includes('shot')) {
            // Visual/cinematic content - merge with template
            return `${basePrompt}. ${template.prompt}`;
        }

        // Other content - prepend template
        return `${template.prompt}. ${basePrompt}`;
    }

    /**
     * Generate preview of processed prompt
     * @param {string} processedPrompt - Processed prompt
     * @param {object} options - Processing options
     * @returns {object} Preview data
     */
    generatePreview(processedPrompt, options) {
        const preview = {
            sections: [],
            warnings: [],
            suggestions: []
        };

        // Analyze prompt structure
        if (!processedPrompt.includes('--mode=')) {
            preview.suggestions.push('Consider adding --mode= parameter for consistent results');
        }

        if (processedPrompt.length > 500) {
            preview.warnings.push('Prompt is quite long - consider breaking into multiple generations');
        }

        if (!processedPrompt.includes('"')) {
            preview.suggestions.push('Consider adding quotes around descriptive elements');
        }

        if (options.selectedTemplate) {
            preview.sections.push({
                type: 'template',
                content: `Using template: ${options.selectedTemplate}`,
                style: 'info'
            });
        }

        return preview;
    }

    /**
     * Count words in text
     * @param {string} text - Text to count
     * @returns {number} Word count
     */
    countWords(text) {
        return text.split(/\s+/).filter(word => word.length > 0).length;
    }

    /**
     * Auto-save functionality
     */
    startAutoSave() {
        this.autoSaveIntervalId = setInterval(() => {
            // Check if extension context is still valid before saving
            if (chrome.runtime && chrome.runtime.id) {
                this.saveRecentPrompts();
            } else {
                // Stop interval if context is invalidated
                if (this.autoSaveIntervalId) {
                    clearInterval(this.autoSaveIntervalId);
                }
            }
        }, this.autoSaveInterval);
    }

    /**
     * Stop auto-save functionality
     */
    stopAutoSave() {
        if (this.autoSaveIntervalId) {
            clearInterval(this.autoSaveIntervalId);
            this.autoSaveIntervalId = null;
        }
    }

    /**
     * Add recent prompt to history
     * @param {string} prompt - Prompt to add
     */
    addRecentPrompt(prompt) {
        if (!prompt || typeof prompt !== 'string') {
            return;
        }

        const trimmed = prompt.trim();
        if (!trimmed) {
            return;
        }

        const entries = Array.from(this.recentPrompts);
        const existingIndex = entries.findIndex((value) => value === trimmed);
        if (existingIndex !== -1) {
            entries.splice(existingIndex, 1);
        }

        entries.push(trimmed);

        if (entries.length > this.maxRecentPrompts) {
            entries.splice(0, entries.length - this.maxRecentPrompts);
        }

        this.recentPrompts = new Set(entries);

        this.saveRecentPrompts();
        this._emitRecentPromptsChanged(entries);
    }

    /**
     * Save recent prompts to Chrome storage
     */
    saveRecentPrompts() {
        try {
            // Verify extension context is still valid
            if (!chrome.runtime || !chrome.runtime.id) {
                window.Logger.warn('AdvancedRawInput', 'Extension context invalidated, skipping save');
                return;
            }

            chrome.storage.local.set({ 'gvp-recent-prompts': Array.from(this.recentPrompts) }, () => {
                if (chrome.runtime.lastError) {
                    // Only log if it's not a context invalidation error
                    if (!chrome.runtime.lastError.message.includes('context')) {
                        window.Logger.error('AdvancedRawInput', 'Failed to save recent prompts', chrome.runtime.lastError);
                    }
                }
            });
        } catch (error) {
            // Silently ignore context invalidation errors
            if (!error.message.includes('context')) {
                window.Logger.error('AdvancedRawInput', 'Failed to save recent prompts', error);
            }
        }
    }

    /**
     * Load recent prompts from Chrome storage
     */
    loadRecentPrompts() {
        // Use Chrome storage instead of localStorage
        chrome.storage.local.get(['gvp-recent-prompts'], (result) => {
            try {
                const saved = result['gvp-recent-prompts'];
                if (saved) {
                    this.recentPrompts = new Set(saved);
                }
                this._emitRecentPromptsChanged();
            } catch (error) {
                window.Logger.error('AdvancedRawInput', 'Failed to load recent prompts', error);
            }
        });
    }

    /**
     * Get recent prompts for UI display
     * @returns {Array} Array of recent prompts
     */
    getRecentPrompts(limit = 5) {
        const entries = Array.from(this.recentPrompts);
        return limit > 0 ? entries.slice(-limit) : entries;
    }

    /**
     * Set recent prompts change handler
     * @param {function} handler - Handler function
     */
    setRecentPromptsChangeHandler(handler) {
        this.onRecentPromptsChanged = (typeof handler === 'function') ? handler : null;
    }

    /**
     * Emit recent prompts changed event
     */
    _emitRecentPromptsChanged(entries = null) {
        if (typeof this.onRecentPromptsChanged !== 'function') {
            return;
        }

        try {
            const list = Array.isArray(entries) ? entries : Array.from(this.recentPrompts);
            this.onRecentPromptsChanged(list);
        } catch (error) {
            window.Logger.error('AdvancedRawInput', 'Failed to notify recent prompt listeners', error);
        }
    }
};