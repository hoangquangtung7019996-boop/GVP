// a:/Tools n Programs/SD-GrokScripts/grok-video-prompter-extension/src/content/managers/RawInputManager.js
// Manages raw input enhancements with templates and batch processing.
// Dependencies: StateManager

window.RawInputManager = class RawInputManager {
    constructor(stateManager) {
        this.stateManager = stateManager;
        this.templates = new Map();
        this.recentPrompts = [];
        this.maxRecentPrompts = 10;
        this.initializeTemplates();
        this.loadRecentPrompts();
    }

    /**
     * Initialize default templates
     */
    initializeTemplates() {
        this.templates.set('cinematic', {
            name: 'Cinematic Scene',
            category: 'Visual',
            prompt: 'A cinematic movie scene with dramatic lighting, professional cinematography, high production value, detailed environment, realistic textures, and immersive atmosphere.',
            tags: ['cinematic', 'professional', 'dramatic']
        });

        this.templates.set('animation', {
            name: 'Animated Style',
            category: 'Animation',
            prompt: 'A vibrant animated scene with colorful characters, smooth animation, expressive facial features, dynamic camera movements, and engaging storytelling.',
            tags: ['animation', 'colorful', 'expressive']
        });

        this.templates.set('realistic', {
            name: 'Photorealistic',
            category: 'Realistic',
            prompt: 'A photorealistic scene with ultra-detailed textures, realistic lighting, natural colors, precise shadows, and lifelike proportions.',
            tags: ['photorealistic', 'detailed', 'realistic']
        });

        this.templates.set('artistic', {
            name: 'Artistic Style',
            category: 'Creative',
            prompt: 'An artistic interpretation with stylized visuals, creative color palette, expressive composition, and unique aesthetic choices.',
            tags: ['artistic', 'creative', 'stylized']
        });

        this.templates.set('action', {
            name: 'Action Sequence',
            category: 'Motion',
            prompt: 'A dynamic action sequence with fast-paced movement, intense energy, dramatic motion blur, powerful camera work, and exciting composition.',
            tags: ['action', 'dynamic', 'intense']
        });

        window.Logger.info('RawInput', `Initialized ${this.templates.size} templates`);
    }

    /**
     * Process raw input with enhancements
     * @param {string} rawText - Raw prompt text
     * @param {object} options - Processing options
     * @returns {object} Processed result
     */
    processRawInput(rawText, options = {}) {
        let processedPrompt = rawText.trim();

        // Apply quote wrapping if enabled
        if (options.quoteWrapping) {
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

        // Generate preview
        const preview = this.generatePreview(processedPrompt, options);

        return {
            original: rawText,
            processed: processedPrompt,
            preview: preview,
            metadata: {
                wordCount: this.countWords(processedPrompt),
                characterCount: processedPrompt.length,
                hasQuotes: processedPrompt.includes('"'),
                hasSpicyMode: processedPrompt.includes('--mode'),
                templateUsed: options.selectedTemplate || null
            }
        };
    }

    /**
     * Apply smart quote wrapping
     * @param {string} prompt - Prompt text
     * @returns {string} Wrapped prompt
     */
    applyQuoteWrapping(prompt) {
        if (prompt.startsWith('"') && prompt.endsWith('"')) {
            return prompt; // Already wrapped
        }
        return `"${prompt}"`;
    }

    /**
     * Apply spicy mode parameter
     * @param {string} prompt - Prompt text
     * @returns {string} Enhanced prompt
     */
    applySpicyMode(prompt) {
        // Remove existing mode flags
        let cleanPrompt = prompt.replace(/--mode=\S+/g, '').trim();
        return `${cleanPrompt} --mode=extremely-spicy-or-crazy`;
    }

    /**
     * Merge base prompt with template
     * @param {string} basePrompt - Base prompt text
     * @param {string} templateName - Template identifier
     * @returns {string} Merged prompt
     */
    mergeWithTemplate(basePrompt, templateName) {
        const template = this.templates.get(templateName);
        if (!template) return basePrompt;

        // Smart merging based on content
        if (basePrompt.toLowerCase().includes('scene') || basePrompt.toLowerCase().includes('shot')) {
            // Visual/cinematic content - merge with template
            return `${basePrompt}. ${template.prompt}`;
        }

        // Other content - prepend template
        return `${template.prompt}. ${basePrompt}`;
    }

    /**
     * Generate preview with warnings and suggestions
     * @param {string} processedPrompt - Processed prompt
     * @param {object} options - Options
     * @returns {object} Preview data
     */
    generatePreview(processedPrompt, options) {
        const preview = {
            warnings: [],
            suggestions: []
        };

        // Check for mode parameter
        if (!processedPrompt.includes('--mode')) {
            preview.suggestions.push('Consider adding --mode parameter for consistent results');
        }

        // Check prompt length
        if (processedPrompt.length > 500) {
            preview.warnings.push('Prompt is quite long - consider breaking into multiple generations');
        }

        if (processedPrompt.length < 20) {
            preview.warnings.push('Prompt is very short - consider adding more details');
        }

        // Check for quotes if not wrapped
        if (!processedPrompt.includes('"') && options.quoteWrapping) {
            preview.suggestions.push('Quote wrapping enabled - quotes will be added automatically');
        }

        return preview;
    }

    /**
     * Count words in text
     * @param {string} text - Text to count
     * @returns {number} Word count
     */
    countWords(text) {
        return text.split(/\s+/).filter(w => w.length > 0).length;
    }

    /**
     * Add prompt to recent history
     * @param {string} prompt - Prompt text
     */
    addRecentPrompt(prompt) {
        if (!prompt || prompt.trim().length < 10) return;

        // Remove if already exists
        this.recentPrompts = this.recentPrompts.filter(p => p !== prompt);

        // Add to beginning
        this.recentPrompts.unshift(prompt);

        // Maintain max size
        if (this.recentPrompts.length > this.maxRecentPrompts) {
            this.recentPrompts = this.recentPrompts.slice(0, this.maxRecentPrompts);
        }

        this.saveRecentPrompts();
    }

    /**
     * Get all templates
     * @returns {Array} Array of templates
     */
    getAllTemplates() {
        return Array.from(this.templates.entries()).map(([id, template]) => ({
            id,
            ...template
        }));
    }

    /**
     * Parse batch input (multiple prompts separated by newlines or delimiters)
     * @param {string} batchText - Batch text
     * @returns {Array} Array of prompts
     */
    parseBatchInput(batchText) {
        // Split by double newlines, or single newlines if each line is substantial
        const prompts = batchText
            .split(/\n\n+/)
            .map(p => p.trim())
            .filter(p => p.length > 10);

        // If no double newlines, try single newlines for longer lines
        if (prompts.length === 0) {
            return batchText
                .split(/\n/)
                .map(p => p.trim())
                .filter(p => p.length > 20);
        }

        return prompts;
    }

    /**
     * Save recent prompts to Chrome storage
     */
    saveRecentPrompts() {
        try {
            chrome.storage.local.set({ 'gvp_recent_prompts': this.recentPrompts }, () => {
                if (chrome.runtime.lastError) {
                    window.Logger.error('RawInput', 'Failed to save recent prompts', chrome.runtime.lastError);
                }
            });
        } catch (error) {
            window.Logger.error('RawInput', 'Failed to save recent prompts', error);
        }
    }

    /**
     * Load recent prompts from Chrome storage
     */
    loadRecentPrompts() {
        chrome.storage.local.get(['gvp_recent_prompts'], (result) => {
            try {
                const saved = result['gvp_recent_prompts'];
                if (saved && Array.isArray(saved)) {
                    this.recentPrompts = saved;
                    window.Logger.info('RawInput', `Loaded ${this.recentPrompts.length} recent prompts`);
                }
            } catch (error) {
                window.Logger.error('RawInput', 'Failed to load recent prompts', error);
            }
        });
    }

    /**
     * Clear all recent prompts
     */
    clearRecentPrompts() {
        this.recentPrompts = [];
        this.saveRecentPrompts();
        window.Logger.info('RawInput', 'Cleared recent prompts');
    }
};