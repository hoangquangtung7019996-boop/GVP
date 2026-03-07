// UIHelpers.js - Shared utility functions for UI modules
// Dependencies: None

window.UIHelpers = class UIHelpers {
    /**
     * Escape a string for use in a RegExp
     * @param {string} string 
     * @returns {string} Escaped string
     */
    escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    /**
     * Format time difference as human-readable string
     * @param {number} ms - Milliseconds
     * @returns {string} Formatted string
     */
    formatTimeDiff(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ago`;
        if (hours > 0) return `${hours}h ago`;
        if (minutes > 0) return `${minutes}m ago`;
        return 'just now';
    }

    /**
     * Recursive function to convert JSON -> Pretty text list with bullets
     * @param {Object} data 
     * @param {number} depth 
     */
    formatObjectToEnglishList(data, depth = 0) {
        if (!data) return '';
        let output = '';
        const indent = '  '.repeat(depth);

        for (const [key, value] of Object.entries(data)) {
            // Skip noisy keys if needed, or keeping full fidelity
            if (typeof value === 'object' && value !== null) {
                output += `${indent}• ${key}:\n${this.formatObjectToEnglishList(value, depth + 1)}`;
            } else {
                output += `${indent}• ${key}: ${value}\n`;
            }
        }
        return output;
    }

    /**
     * Get status badge content
     * @param {string} status - Status
     * @returns {string} HTML content
     */
    getStatusBadgeContent(status) {
        const statusMap = {
            initializing: '<span>⏳</span><span>Starting</span>',
            generating: '<span>🎬</span><span>Generating</span>',
            moderated: '<span>⚠️</span><span>Moderated</span>',
            retrying: '<span>🔄</span><span>Retrying</span>',
            completed: '<span>✅</span><span>Completed</span>',
            failed: '<span>❌</span><span>Failed</span>'
        };
        return statusMap[status] || '<span>❓</span><span>Unknown</span>';
    }

    /**
     * Create a reusable accordion section with toggle behaviour
     * @param {Object} options - Configuration for the accordion
     * @param {string} [options.id] - Optional ID for the accordion container
     * @param {string} [options.title='Section'] - Visible title for the accordion header
     * @param {string} [options.icon] - Optional emoji/icon displayed next to the title
     * @param {boolean} [options.defaultOpen=false] - Whether the accordion is expanded initially
     * @param {boolean} [options.scrollable=false] - Whether the content area should allow scrolling
     * @param {HTMLElement|DocumentFragment|string|Array} [options.content] - Initial content
     * @param {Function} [options.onToggle] - Callback invoked when accordion toggles (isOpen, root)
     * @returns {{root: HTMLElement, header: HTMLElement, content: HTMLElement, toggle: function(boolean): boolean, setContent: function(*): void, isOpen: function(): boolean}}
     */
    createAccordionSection(options = {}) {
        const {
            id = '',
            title = 'Section',
            icon = '',
            defaultOpen = false,
            scrollable = false,
            content = null,
            onToggle = null,
            grid = { style: {} }
        } = options || {};

        grid.style.gap = '8px 6px';
        grid.style.padding = '10px';

        const accordion = document.createElement('section');
        accordion.className = 'gvp-accordion';
        if (id) {
            accordion.id = id;
        }

        const uniqueBase = id || `gvp-accordion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const headerId = `${uniqueBase}-header`;
        const contentId = `${uniqueBase}-content`;

        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'gvp-accordion-header';
        header.id = headerId;
        header.setAttribute('aria-expanded', defaultOpen ? 'true' : 'false');
        header.setAttribute('aria-controls', contentId);

        const titleWrap = document.createElement('span');
        titleWrap.className = 'gvp-accordion-title-wrap';

        if (icon) {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'gvp-accordion-title-icon';
            iconSpan.textContent = icon;
            titleWrap.appendChild(iconSpan);
        }

        const titleSpan = document.createElement('span');
        titleSpan.className = 'gvp-accordion-title';
        titleSpan.textContent = title;
        titleWrap.appendChild(titleSpan);

        header.appendChild(titleWrap);

        const chevron = document.createElement('span');
        chevron.className = 'gvp-accordion-chevron';
        chevron.innerHTML = '▸';
        header.appendChild(chevron);

        const contentContainer = document.createElement('div');
        contentContainer.className = 'gvp-accordion-content';
        contentContainer.id = contentId;
        contentContainer.setAttribute('role', 'region');
        contentContainer.setAttribute('aria-labelledby', headerId);

        if (scrollable) {
            contentContainer.classList.add('gvp-accordion-content-scrollable');
        }

        const appendValue = (value) => {
            if (value === null || value === undefined) {
                return;
            }

            if (value instanceof Node) {
                contentContainer.appendChild(value);
                return;
            }

            if (typeof value === 'string') {
                const template = document.createElement('template');
                template.innerHTML = value;
                contentContainer.appendChild(template.content);
            }
        };

        const setContent = (value) => {
            contentContainer.innerHTML = '';
            if (Array.isArray(value)) {
                value.forEach(appendValue);
            } else {
                appendValue(value);
            }
        };

        if (content !== null && content !== undefined) {
            setContent(content);
        }

        const updateVisibility = (shouldOpen) => {
            accordion.classList.toggle('open', shouldOpen);
            header.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
            contentContainer.hidden = !shouldOpen;
            contentContainer.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
        };

        const toggle = (forceState, options = {}) => {
            const { silent = false } = options || {};
            const nextState = typeof forceState === 'boolean'
                ? forceState
                : !accordion.classList.contains('open');

            updateVisibility(nextState);

            if (!silent && typeof onToggle === 'function') {
                try {
                    onToggle(nextState, accordion);
                } catch (error) {
                    window.Logger.error('UIHelpers', 'Accordion onToggle failed:', error);
                }
            }

            return nextState;
        };

        header.addEventListener('click', () => toggle());
        accordion.appendChild(header);
        accordion.appendChild(contentContainer);

        if (defaultOpen) {
            updateVisibility(true);
        } else {
            updateVisibility(false);
        }

        return {
            root: accordion,
            header,
            content: contentContainer,
            toggle,
            setContent,
            isOpen: () => accordion.classList.contains('open')
        };
    }

    createDialogueTemplatePanel(options = {}) {
        const {
            onClose = () => { },
            onSave = () => { },
            width = 360
        } = options;

        // Scoped style creation
        const style = document.createElement('style');
        style.setAttribute('data-gvp-dialogue-template-panel', 'true');
        style.textContent = `
                .gvp-dialogue-template-overlay {
                    position: fixed;
                    top: 0;
                    right: 0;
                    bottom: 0;
                    left: 0;
                    background: rgba(0, 0, 0, 0.75);
                    backdrop-filter: blur(6px);
                    z-index: 10005;
                    display: flex;
                    justify-content: flex-end;
                    align-items: stretch;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.2s ease;
                }

                .gvp-dialogue-template-overlay.visible {
                    opacity: 1;
                    pointer-events: auto;
                }

                .gvp-dialogue-template-panel {
                    width: ${width}px;
                    max-width: 520px;
                    height: 100vh;
                    max-height: 100vh;
                    background: var(--gvp-bg-primary);
                    border-left: 2px solid var(--gvp-bg-secondary);
                    box-shadow: -10px 0 30px rgba(0, 0, 0, 0.9);
                    display: flex;
                    flex-direction: column;
                    position: relative;
                    font-family: inherit;
                }

                .gvp-dialogue-template-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 10px 14px;
                    border-bottom: 1px solid var(--gvp-border);
                    background: var(--gvp-bg-secondary);
                }

                    gap: 12px;
                }

                .gvp-dialogue-template-panel .gvp-dialogue-accordion {
                    border-radius: 14px;
                    background: var(--gvp-bg-input);
                    border: 1px solid var(--gvp-border);
                    box-shadow: inset 0 0 0 1px rgba(20, 20, 20, 0.75);
                    overflow: hidden;
                    transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
                }

                .gvp-dialogue-template-panel .gvp-dialogue-accordion.open {
                    background: var(--gvp-bg-secondary);
                    border-color: var(--gvp-border);
                    box-shadow: 0 0 0 1px rgba(72, 73, 75, 0.4), 0 10px 24px rgba(0, 0, 0, 0.7);
                }

                .gvp-dialogue-template-panel .gvp-dialogue-accordion .gvp-accordion-header {
                    padding: 12px 16px;
                    font-size: 11px;
                    letter-spacing: 0.5px;
                    justify-content: space-between;
                    display: flex;
                    align-items: center;
                }

                .gvp-dialogue-template-panel .gvp-dialogue-accordion .gvp-accordion-content {
                    padding: 6px 14px 12px;
                }

                .gvp-dialogue-template-panel .gvp-dialogue-accordion .gvp-accordion-content[hidden] {
                    padding: 0;
                    height: 0;
                    overflow: hidden;
                }
            `;
        const overlay = document.createElement('div');
        overlay.className = 'gvp-dialogue-template-overlay';
        overlay.appendChild(style);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                onClose('overlay');
            }
        });

        const panel = document.createElement('div');
        panel.className = 'gvp-dialogue-template-panel';
        panel.style.width = `${width}px`;
        panel.addEventListener('click', (event) => {
            event.stopPropagation();
        });

        const header = document.createElement('div');
        header.className = 'gvp-dialogue-template-header';

        const title = document.createElement('div');
        title.className = 'gvp-dialogue-template-title';
        title.textContent = 'Dialogue Template';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'gvp-button ghost gvp-dialogue-template-close';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => onClose('close'));

        header.appendChild(title);
        header.appendChild(closeBtn);

        const bottomBar = document.createElement('div');
        bottomBar.id = 'gvp-bottom-bar';
        bottomBar.style.position = 'absolute';
        bottomBar.style.left = '50%';
        bottomBar.style.bottom = '28px';
        bottomBar.style.transform = 'translateX(-50%)';

        const body = document.createElement('div');
        body.className = 'gvp-dialogue-template-body';

        const footer = document.createElement('div');
        footer.className = 'gvp-dialogue-template-footer';

        const saveCloseBtn = document.createElement('button');
        saveCloseBtn.className = 'gvp-button primary gvp-dialogue-template-save';
        saveCloseBtn.textContent = '← Save & Close';
        saveCloseBtn.addEventListener('click', () => onSave());

        footer.style.justifyContent = 'center';
        footer.appendChild(saveCloseBtn);

        panel.appendChild(header);
        panel.appendChild(body);
        panel.appendChild(footer);

        overlay.appendChild(panel);

        return {
            overlay,
            panel,
            body,
            header,
            footer,
            title,
            saveButton: saveCloseBtn,
            closeButton: closeBtn,
            destroy: () => overlay.remove()
        };
    }
};
