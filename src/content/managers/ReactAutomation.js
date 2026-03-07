// a:/Tools n Programs/SD-GrokScripts/grok-video-prompter-extension/src/content/managers/ReactAutomation.js
// Handles automation of the React-based UI.
// Dependencies: StateManager

window.ReactAutomation = class ReactAutomation {
    constructor(stateManager) {
        this.stateManager = stateManager;
    }

    /**
     * Initialize ReactAutomation - placeholder for future enhancements
     * Currently a no-op but prevents initialization errors
     */
    init() {
        window.Logger.info('ReactAutomation', 'Initialized');
        // Future: Add any necessary initialization logic here
    }

    async waitForElement(selectors, timeout = 5000, root = document) {
        const selectorList = Array.isArray(selectors)
            ? selectors.flat(Infinity).filter(Boolean)
            : [selectors].filter(Boolean);

        if (!selectorList.length) {
            throw new Error('[GVP Automation] waitForElement called without selectors');
        }

        const searchRoot = root && root.nodeType === Node.ELEMENT_NODE ? root : document;

        return new Promise((resolve, reject) => {
            const tryFind = () => {
                for (const selector of selectorList) {
                    try {
                        let el = null;
                        if (typeof selector === 'function') {
                            // Support function-based selectors (e.g., findByText)
                            el = selector();
                        } else if (typeof selector === 'string') {
                            // Standard CSS selector
                            el = searchRoot.querySelector(selector);
                        }

                        if (el) {
                            cleanup();
                            resolve(el);
                            return;
                        }
                    } catch (error) {
                        window.Logger.warn('ReactAutomation', 'Invalid selector', { selector, error });
                    }
                }
            };

            const cleanup = () => {
                observer.disconnect();
                clearTimeout(timeoutId);
            };

            const observer = new MutationObserver(tryFind);
            observer.observe(searchRoot === document ? document.body : searchRoot, {
                childList: true,
                subtree: true
            });

            const timeoutId = setTimeout(() => {
                cleanup();
                reject(new Error(`Element not found after ${timeout}ms for selectors: ${selectorList.join(' || ')}`));
            }, timeout);

            // Attempt initial lookup before waiting for mutations
            tryFind();
        });
    }

    async _applyPromptTransforms(promptText) {
        let result = typeof promptText === 'string' ? promptText : '';
        try {
            // Lazy load stateManager if it was null at instantiation time
            if (!this.stateManager) {
                this.stateManager = window.gvpStateManager;
            }

            const settings = this.stateManager?.getState?.()?.settings;
            if (settings?.wrapInQuotes) {
                result = this._quoteWrapPrompt(result);
            }

            // Phase 2: Word Swapper (Global Cycle Rules) — gated by Auto-Swap toggle
            if (window.UIWordSwapperManager && window.UIHelpers &&
                settings?.wordSwapAutoEnabled !== false) {
                const uiHelpers = new window.UIHelpers();
                result = await window.UIWordSwapperManager.applyGlobalCycleRules(result, this.stateManager, uiHelpers);
            }

            // Phase 2: SFW Mode
            if (window.UISFWModeManager && window.UIHelpers) {
                const uiHelpers = new window.UIHelpers();
                result = await window.UISFWModeManager.applySFWTransform(result, this.stateManager, uiHelpers);
            }

            // Phase 3: Guillotine URL swap (private → public CDN)
            // When guillotine mode is on, rewrite assets.grok.com user-upload URLs
            // to the public grok.com/imagine/post endpoint
            if (settings?.guillotineEnabled) {
                result = result.replace(
                    /https?:\/\/assets\.grok\.com\/users\/[0-9a-f-]+\/([0-9a-f-]+)\/content/gi,
                    (match, fileId) => `https://grok.com/imagine/post/${fileId}`
                );
            }
        } catch (error) {
            window.Logger.warn('ReactAutomation', 'Prompt transform fallback due to error', error);
        }
        return result;
    }

    _quoteWrapPrompt(basePrompt) {
        const sanitized = typeof basePrompt === 'string' ? basePrompt.trim() : '';
        return `", "${sanitized}", {"mode": "`;
    }

    /**
     * Unified value setter for both legacy Textarea and new TipTap ContentEditable
     * Handles React state reconciliation bypass and ProseMirror input events.
     */
    /**
     * Unified setter for both legacy textarea and TipTap contenteditable elements.
     * 
     * CRITICAL: TipTap ProseMirror requires text wrapped in <p> tags and an InputEvent
     * with inputType='insertText'. Without this, React won't register the input.
     * 
     * @param {HTMLElement} element - The textarea or contenteditable div
     * @param {string} text - The prompt text to inject
     * @returns {void}
     */
    async _setEditableValue(element, text) {
        if (!element) return;

        // Strategy A: Legacy Textarea (React Controlled)
        if (element.tagName === 'TEXTAREA') {
            const setter = Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype, 'value').set;
            setter.call(element, text);
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.dispatchEvent(new Event('input', { bubbles: true }));
        }
        // Strategy B: TipTap / ContentEditable (Active Persistence + Ghost Node Handling)
        else if (element.isContentEditable) {
            let cleanText = typeof text === 'string' ? text : '';
            if (element.isConnected) element.focus();

            // Active Persistence Loop: Fight the Framework for 1000ms
            const endTime = Date.now() + 1000;
            let targetElement = element;

            do {
                // 1. Ghost Node Check: Is our element still in the DOM?
                if (!targetElement.isConnected) {
                    window.Logger.warn('ReactAutomation', '⚠️ Editor element detached! Searching for replacement...');
                    const newEl = document.querySelector('div.tiptap.ProseMirror[contenteditable="true"]');
                    if (newEl) {
                        targetElement = newEl;
                        targetElement.focus();
                        window.Logger.info('ReactAutomation', '✅ Acquired new editor instance');
                    } else {
                        // wait and try next tick
                        await new Promise(r => setTimeout(r, 50));
                        continue;
                    }
                }

                // 2. Reversion Check
                const currentVal = targetElement.innerText || '';
                // Simple inclusion check or length check to avoid fighting minor formatting
                // Normalize whitepsace (trim and collapse multiple spaces) to prevent fighting formatting differences
                const normalize = (str) => (str || '').replace(/\s+/g, ' ').trim();
                if (normalize(currentVal) !== normalize(cleanText)) {
                    window.Logger.debug('ReactAutomation', 'Persistence: Re-injecting', {
                        currentLen: currentVal.length,
                        targetLen: cleanText.length,
                        isGhost: !targetElement.isConnected
                    });

                    targetElement.focus();
                    targetElement.focus();
                    try {
                        // 1. Select All
                        if (document.queryCommandSupported('selectAll')) {
                            document.execCommand('selectAll', false, null);
                        }

                        // 2. Primary Injection
                        if (document.queryCommandSupported('insertText')) {
                            document.execCommand('insertText', false, cleanText);
                        } else {
                            // Fallback if insertText is deprecated/blocked
                            const p = document.createElement('p');
                            p.textContent = cleanText || '';
                            targetElement.innerHTML = '';
                            targetElement.appendChild(p);
                        }

                        // 3. Force React/ProseMirror Sync (The "Dirtying" sequence)
                        targetElement.dispatchEvent(new Event('input', { bubbles: true }));
                        targetElement.dispatchEvent(new Event('change', { bubbles: true }));

                        // Fake typing a space at the end to trigger TipTap's text watcher
                        targetElement.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', charCode: 32, keyCode: 32, bubbles: true }));
                        targetElement.dispatchEvent(new KeyboardEvent('keypress', { key: ' ', code: 'Space', charCode: 32, keyCode: 32, bubbles: true }));
                        targetElement.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: ' ', bubbles: true }));

                        // Give TipTap a micro-tick to process the fake space
                        await new Promise(r => setTimeout(r, 10));

                        // Backspace the fake space
                        targetElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true }));
                        targetElement.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true }));
                        targetElement.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true }));

                        window.Logger.debug('ReactAutomation', 'Dispatched Hardened TipTap Sync Sequence');

                    } catch (e) {
                        window.Logger.warn('ReactAutomation', 'Fallback TipTap injection used', e);
                        targetElement.innerHTML = cleanText.split('\n').map(line => `<p>${line || '<br>'}</p>`).join('');
                        targetElement.dispatchEvent(new InputEvent('input', { bubbles: true, data: cleanText, inputType: 'insertText' }));
                    }
                } else {
                    window.Logger.debug('ReactAutomation', '✅ Prompt visually confirmed in UI. Persistence loop exiting early.');
                    break;
                }

                await new Promise(r => setTimeout(r, 50));

            } while (Date.now() < endTime);

            window.Logger.info('ReactAutomation', 'Persistence Loop Complete');
        }
    }

    /**
     * SPA Navigation via History API
     * Triggers React Router without full page reload.
     */
    /**
     * SPA Navigation via History API
     * Triggers React Router without full page reload.
     * 
     * CRITICAL: Must dispatch PopStateEvent after pushState to trigger
     * Grok's React router — without it, the URL changes but content doesn't update.
     */
    _navigateToPost(postId) {
        if (!postId) return;
        const targetUrl = `/imagine/post/${postId}`;

        window.Logger.info('ReactAutomation', `Navigating to: ${targetUrl}`);

        // CRITICAL: Dispatch rail-navigation event to suppress Quick Raw during nav
        document.dispatchEvent(new CustomEvent('gvp:rail-navigation', {
            detail: { postId, url: targetUrl }
        }));

        // Push state to history
        window.history.pushState({}, '', targetUrl);

        // Dispatch PopStateEvent to trigger React Router
        // Standard popstate might be swallowed, so we dispatch it on window
        window.dispatchEvent(new PopStateEvent('popstate'));
    }




    /**
     * NUCLEAR OPTION: Force transition to Image Mode using Dual-Strategy.
     * Strategy A: Media Toggle (Top-Left) - ALWAYS Attempted.
     * Strategy B: Settings Menu (Bottom-Right) - ALWAYS Attempted.
     * 
     * @returns {Promise<void>}
     */
    async forceImageModeTransition() {
        const SELECTORS = window.GROK_SELECTORS || {};
        window.Logger.info('ReactAutomation', '☢️ Initiating Nuclear Image Mode Transition');

        // === STRATEGY A: MEDIA TOGGLE (User Snippet 1) ===
        try {
            window.Logger.debug('ReactAutomation', '☢️ Strategy A: Attempting Media Toggle...');
            // Use Centralized Selector
            const toggleBtn = SELECTORS.MODE_TOGGLE?.BUTTONS?.IMAGE?.();

            if (toggleBtn) {
                // Click it regardless of state to force focus/wake-up
                this.reactClick(toggleBtn, 'Media Toggle (Strategy A)');
                window.Logger.info('ReactAutomation', '✅ Strategy A: Media Toggle Clicked');
                await new Promise(r => setTimeout(r, 500)); // Stabilization wait
            } else {
                window.Logger.warn('ReactAutomation', '⚠️ Strategy A: Media Toggle NOT FOUND (Might be single image view)');
            }
        } catch (e) {
            window.Logger.warn('ReactAutomation', 'Strategy A Execution Failed', e);
        }

        // === STRATEGY B: SETTINGS MENU (User Snippet 2) ===
        try {
            window.Logger.debug('ReactAutomation', '☢️ Strategy B: Attempting Settings Menu...');

            // 1. Find & Open Settings Button
            const settingsSelector = SELECTORS.FEATURES?.IMAGE_EDIT?.runDiagnostics?.SETTINGS_BTN || 'button[aria-label="Settings"]';
            const settingsBtn = await this.waitForElement(settingsSelector, 2000);

            if (!settingsBtn) throw new Error('Settings button not found');

            this.reactClick(settingsBtn, 'Settings Button (Strategy B)');

            // 2. Wait for Menu Content
            const popoverSelector = SELECTORS.SHARED?.POPOVER || '[data-radix-menu-content]';
            await this.waitForElement(popoverSelector, 1500);

            // 3. Find & Click "Edit Image" Item (User Snippet 3)
            const editItem = SELECTORS.MENU_ITEMS?.EDIT_IMAGE?.();

            if (editItem) {
                this.reactClick(editItem, 'Edit Image Item (Strategy B)');
                window.Logger.info('ReactAutomation', '✅ Strategy B: Edit Image Clicked');
                await new Promise(r => setTimeout(r, 1000)); // Wait for Modal/Editor
            } else {
                // If not found, we might already be in Edit mode? Or it's missing.
                window.Logger.warn('ReactAutomation', '⚠️ Strategy B: "Edit Image" item not found in menu');
            }

        } catch (e) {
            window.Logger.error('ReactAutomation', 'Strategy B Execution Failed', e);
            throw e; // Critical failure if Strategy B fails too
        }
    }

    /**
     * Send prompt to Grok's Imagine Edit interface (NUCLEAR VERSION).
     * Follows strict user directive: Toggle -> Settings -> Enter Key Submit.
     */
    /**
     * Standard "Aggressive Click" pattern from UploadAutomationManager.
     * 1. Standard .click()
     * 2. Dispatches MouseEvent 'click' (bubbles)
     * 3. Dispatches click to child SVG if present (Crucial for icon buttons)
     * 4. (Enhanced) Dispatches PointerEvents for Radix UI compatibility
     * @param {HTMLElement} element 
     */
    async aggressiveClick(element) {
        if (!element) return;

        window.Logger.debug('ReactAutomation', '🖱️ aggressiveClick: Dispatching Precise Pointer Sequence (v3.0)', { tagName: element.tagName });

        const opts = {
            bubbles: true,
            cancelable: true,
            view: window,
            pointerId: 1,
            isPrimary: true,
            buttons: 1
        };

        // 1. Down Sequence (pointerdown -> mousedown)
        element.dispatchEvent(new PointerEvent('pointerdown', opts));
        element.dispatchEvent(new MouseEvent('mousedown', opts));

        // 2. Up Sequence (pointerup -> mouseup)
        element.dispatchEvent(new PointerEvent('pointerup', opts));
        element.dispatchEvent(new MouseEvent('mouseup', opts));

        // 3. Final Click (Synthetic Only - No element.click() to prevent native double-fire)
        element.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
        }));
    }

    /**
     * Helper to check if we are definitively in video mode
     * @returns {boolean}
     */
    isVideoModeActive() {
        // v1.46.0: Check for the specifically highlighted "Video" mode button or input state
        const videoBtn = document.querySelector('button[aria-label="Video"][aria-pressed="true"]');
        if (videoBtn) return true;

        const submitBtn = document.querySelector(window.GROK_SELECTORS?.FEATURES?.GENERATOR?.sendToGenerator?.SUBMIT_BUTTON);
        if (submitBtn && submitBtn.getAttribute('aria-label') === 'Make video') return true;

        return false;
    }

    /**
     * Forces the UI into Video mode using the Settings menu.
     * Strategy B (Settings -> Make Video) is preferred over direct buttons to ensure React state sync.
     */
    async forceVideoModeTransition() {
        const SELECTORS = window.GROK_SELECTORS || {};
        window.Logger.debug('ReactAutomation', '⚡ Force Video Mode Transition: Initiating Strict Transition Sequence (v8)');

        if (this.isVideoModeActive()) {
            window.Logger.debug('ReactAutomation', 'ℹ️ Already in video mode. Skipping force transition.');
            return;
        }

        window.Logger.debug('ReactAutomation', '🔄 In Image mode. Executing strict Settings -> Make Video transition.');

        try {
            // Find Settings Button (Gear)
            // CRITICAL FIX: Restrict the search to the main input area to avoid clicking
            // "More options" on gallery cards which do NOT have a "Make Video" action!
            let rootNode = document;
            const inputSelector = window.GROK_SELECTORS?.FEATURES?.GENERATOR?.sendToGenerator?.MAIN_INPUT;
            if (inputSelector) {
                const inputArea = document.querySelector(inputSelector);
                if (inputArea) {
                    // Try to find a reasonable wrapper (e.g., the chat input container)
                    rootNode = inputArea.closest('form') || inputArea.closest('.group') || inputArea.parentElement || document;
                }
            }

            const settingsSelector = [
                'button[aria-label="Settings"]:has(svg)', // Safe generic match
                'button[aria-label="More options"]:has(svg)', // Fallback UI
                ...(window.GROK_SELECTORS?.FEATURES?.IMAGE_EDIT?.runDiagnostics?.SETTINGS_BTN || [])
            ];
            const settingsBtn = await this.waitForElement(settingsSelector, 2000, rootNode);

            if (!settingsBtn) throw new Error('Settings button not found');

            window.Logger.debug('ReactAutomation', '✅ Found Settings Button. Clicking...');
            await this.aggressiveClick(settingsBtn);

            // Wait for Menu Content & "Make Video" Item
            // The popover attaches to the document body so we use document as root
            const popoverSelector = window.GROK_SELECTORS?.SHARED?.POPOVER || '[data-radix-menu-content]';
            await this.waitForElement(popoverSelector, 2000, document);

            // Poll for Make Video Menu Item
            let makeVideoItem = null;
            for (let i = 0; i < 20; i++) { // 1 second max
                makeVideoItem = window.GROK_SELECTORS?.MENU_ITEMS?.MAKE_VIDEO?.();
                if (makeVideoItem) break;
                await new Promise(r => setTimeout(r, 50));
            }

            if (!makeVideoItem) throw new Error('"Make Video" menu item not found');

            window.Logger.debug('ReactAutomation', '✅ Found "Make Video" Menu Item. Clicking...');
            await this.aggressiveClick(makeVideoItem);

            // --- STEP 3: WAIT FOR VIDEO MODE TO MOUNT ---
            window.Logger.debug('ReactAutomation', '⏳ Transition clicked. Waiting for React mode swap to settle...');

            // Wait for isVideoModeActive to become true
            let attempts = 0;
            while (attempts < 30) {
                if (this.isVideoModeActive()) {
                    window.Logger.info('ReactAutomation', '✅ Video mode fully mounted.');
                    // Extra structural stabilization just in case TipTap is still reacting
                    await new Promise(r => setTimeout(r, 300));
                    return;
                }
                await new Promise(r => setTimeout(r, 100)); // Sleep 100ms
                attempts++;
            }

            throw new Error('Video submit button did not mount after Make Video menu click');

        } catch (e) {
            window.Logger.error('ReactAutomation', 'Transition Sequence Failed', e);
            throw e;
        }
    }


    /**
     * Sends prompt to the video generator textarea.
     * Updated 2026: Click-Based Submission (User Directive).
     * @param {string} promptText
     * @param {Object} options
     */
    async sendToGenerator(promptText, options = {}) {
        try {
            const { autoSubmit = false, isRaw = false, spicy = false, fileAttachments = null, parentPostId = null } = options;

            // v1.46.0: Arm payload override BEFORE transition if we are raw and not in video mode yet
            // This ensures the prompt persists across the potential navigation/mode-switch
            if (isRaw && promptText && !this.isVideoModeActive()) {
                window.Logger.info('ReactAutomation', '🛡️ Arming Payload Override for Mode Transition (v1.46.0)');
                window.postMessage({
                    source: 'gvp-extension',
                    type: 'GVP_SET_PAYLOAD_OVERRIDE',
                    payload: {
                        text: promptText,
                        isRaw: true,
                        autoSubmit: autoSubmit
                    }
                }, '*');
                // Small delay to allow message handling if needed
                await new Promise(r => setTimeout(r, 50));
            }

            await this.forceVideoModeTransition();

            // 3. Locate Input
            const inputSelector = window.GROK_SELECTORS.FEATURES.GENERATOR.sendToGenerator.MAIN_INPUT;
            window.Logger.debug('ReactAutomation', '🔍 Looking for Input Field...');
            await this.waitForElement(inputSelector, 5000);
            const input = document.querySelector(inputSelector);

            if (!input) {
                window.Logger.error('ReactAutomation', '❌ Video Input (TipTap) NOT FOUND after mode transition.');
                throw new Error("Video Input (TipTap) not found after mode transition");
            }
            window.Logger.debug('ReactAutomation', '✅ Input Field Found');

            // CRITICAL FIX: React Stabilization Delay (PoC v7 Parity)
            window.Logger.debug('ReactAutomation', '⏳ Stabilizing for 100ms (PoC v7 Spec)...');
            await new Promise(r => setTimeout(r, 100));

            // 4. Set Value (Using Ported PoC v7 Methods)
            // SKIP textarea injection on /favorites — the video modal opens AFTER our click,
            // so there is no video textarea yet. Injecting here hits the T2I Imagine box instead,
            // leaking the (potentially large JSON) prompt into the wrong field.
            // The payload interceptor (GVP_SET_PAYLOAD_OVERRIDE) handles the prompt correctly.
            const path = window.location.pathname;
            const onFavoritesPage = path.includes('/imagine/saved') || path.includes('/imagine/favorites');
            if (!onFavoritesPage) {
                window.Logger.debug('ReactAutomation', '💉 Injecting video prompt text...');
                // The loop in _setEditableValue does the heavy lifting, but we must AWAIT it
                await this._setEditableValue(input, promptText);

                // EXPLICIT VERIFICATION LOOP: Do not click Make Video until the DOM actually holds the text
                window.Logger.debug('ReactAutomation', '⏳ Verifying prompt injection before submission...');
                let checkCount = 0;
                while (checkCount < 10) {
                    const currentVal = input.innerText || '';
                    if (currentVal.trim().length >= promptText.trim().length - 5) { // Allow slight formatting diffs
                        window.Logger.debug('ReactAutomation', '✅ Prompt visually confirmed in UI');
                        break;
                    }
                    await new Promise(r => setTimeout(r, 100));
                    checkCount++;
                }

                // Add a small breather for React to commit the state to its underlying model
                await new Promise(r => setTimeout(r, 50));

            } else {
                window.Logger.debug('ReactAutomation', '⏭️ Skipping textarea inject on favorites page (interceptor handles prompt)');
            }

            if (autoSubmit) {
                // 5. Submit - CLICK "MAKE VIDEO" BUTTON (User Request)
                window.Logger.info('ReactAutomation', '🚀 Submitting via CLICK Strategy...');
                // NOTE: GVP_SET_PAYLOAD_OVERRIDE is armed AFTER button is found, not here.
                // Arming here would expose the override to the 2000ms button-search timeout,
                // exhausting the TTL before the /conversations/new fetch fires.

                // SET EXPECTATION (Via Message Bridge) - Always needed for Network Guard
                window.postMessage({
                    source: 'gvp-extension',
                    type: 'GVP_SET_EXPECTATION',
                    payload: { expect: 'video' }
                }, '*');

                // FIND THE BUTTON
                // User provided: button[aria-label="Make video"] (with or without text inside)
                // In Feb 2026 UI, the 'bg-button-filled' class is on the inner div, not the button
                window.Logger.debug('ReactAutomation', '🔍 Finding "Make video" button...');

                // We use a flexible selector that targets aria-label AND ensures it's the primary action
                const buttonSelector = window.GROK_SELECTORS.FEATURES.GENERATOR.sendToGenerator.SUBMIT_BUTTON;

                // Try finding the button immediately
                let submitBtn = null;
                let fallbackBtn = null; // Declared here; remains null unless a fallback is found below
                const selectors = Array.isArray(buttonSelector) ? buttonSelector : [buttonSelector];
                for (const sel of selectors) {
                    submitBtn = document.querySelector(sel);
                    if (submitBtn) break;
                }

                // If not found immediately, wait a moment (react render lag)
                if (!submitBtn) {
                    try {
                        submitBtn = await this.waitForElement(buttonSelector, 2000);
                    } catch (e) {
                        window.Logger.warn('ReactAutomation', '⚠️ Primary "Make video" button not found via standard wait.');
                    }
                }

                if (submitBtn || fallbackBtn) {
                    const targetBtn = submitBtn || fallbackBtn;
                    const btnName = submitBtn ? '"Make video" button' : 'Fallback Submit Button';

                    if (spicy || (fileAttachments && fileAttachments.length > 0)) {
                        window.postMessage({
                            source: 'gvp-extension',
                            type: 'GVP_SET_PAYLOAD_OVERRIDE',
                            payload: {
                                text: promptText,
                                fileAttachments: fileAttachments || [],
                                parentPostId: parentPostId || null
                            }
                        }, '*');
                        window.Logger.info('ReactAutomation', `🛡️ Re-Armed Payload Override (pre-click ${btnName})`, { files: fileAttachments });
                        await new Promise(r => setTimeout(r, 100)); // Small yield for message dispatch
                    }

                    window.Logger.info('ReactAutomation', `🖱️ Clicking ${btnName}...`, {
                        tagName: targetBtn.tagName,
                        className: targetBtn.className,
                        ariaLabel: targetBtn.getAttribute('aria-label')
                    });

                    // The standard reactClick method handles the simulated pointer events
                    this.reactClick(targetBtn, btnName);

                    // Brief pause to ensure the click fully bubbles
                    await new Promise(r => setTimeout(r, 50));
                } else {
                    throw new Error('Submit button not found (Click Strategy Failed)');
                }

                // 6. Fire and Forget (Speed Optimization)
                // We no longer wait for the React spinner to appear, as network interception handles the rest.
                window.Logger.info('ReactAutomation', '✅ Submitting Prompt (Fire and Forget)');
            }
        } catch (error) {
            window.Logger.error('ReactAutomation', '❌ Video Generation Failed', error);
            throw error;
        }
    }

    /**
     * UTILITY: Dispatch a clean Enter key sequence (keydown/keypress/keyup)
     * Matches the "Gold Standard" for zero-spam submission.
     * @param {HTMLElement} element - The element to receive the events (usually input)
     */
    async pressEnter(element) {
        if (!element) return;

        window.Logger.info('ReactAutomation', '⌨️ pressEnter: Dispatching Single Enter Sequence');
        element.focus();

        const eventOpts = {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
            bubbles: true, cancelable: true, composed: true, view: window
        };

        element.dispatchEvent(new KeyboardEvent('keydown', eventOpts));
        element.dispatchEvent(new KeyboardEvent('keypress', eventOpts));
        element.dispatchEvent(new KeyboardEvent('keyup', eventOpts));
    }

    // === WATCHER LOGIC ===

    startImageEditWatcher() {
        if (this._imageEditWatcher) return;

        window.Logger.info('ReactAutomation', '👁️ STARTING IMAGE EDIT WATCHER');
        this._watcherStartUrl = window.location.href;
        // Do NOT reset cooldown or history here - preserve across toggle cycles for safety
        if (!this._editCooldownUntil) this._editCooldownUntil = 0;
        if (!this._completedEdits) this._completedEdits = new Set();

        // Initialize Latch (Persistent)
        if (typeof this._autoEditArmed === 'undefined') {
            this._autoEditArmed = false;
        }

        // INITIAL STATE CHECK
        // If starting on a gallery/feed, arm immediately
        const isStartGallery = this._watcherStartUrl.includes('/imagine/saved') ||
            this._watcherStartUrl.includes('/imagine/favorites') ||
            (this._watcherStartUrl.includes('/imagine/') && !this._watcherStartUrl.includes('/post/'));

        if (isStartGallery && !this._autoEditArmed) {
            this._autoEditArmed = true;
            window.Logger.info('ReactAutomation', '🛡️ Watcher Started on Gallery -> Latch ARMED');
        }

        this._imageEditWatcher = setInterval(() => {
            if (this._isEditing) return; // Don't interrupt active edit

            const currentUrl = window.location.href;
            if (currentUrl !== this._watcherStartUrl) {
                this._watcherStartUrl = currentUrl;

                // 1. Gallery Reset Check
                // If we are on a gallery page, ARM the latch
                if (currentUrl.includes('/imagine/saved') || currentUrl.includes('/imagine/favorites') || (currentUrl.includes('/imagine/') && !currentUrl.includes('/post/'))) {
                    if (!this._autoEditArmed) {
                        this._autoEditArmed = true;
                        window.Logger.info('ReactAutomation', '🛡️ Gallery Latch ARMED (Ready for next image)');
                    }
                    return;
                }

                // 2. Post Detection
                // Pattern: /imagine/post/UUID
                const isPost = currentUrl.includes('/post/');

                if (isPost) {
                    window.Logger.info('ReactAutomation', `👁️ Watcher detected nav to post: ${currentUrl}`);

                    if (this._autoEditArmed) {
                        // Latch is OPEN -> Fire Edit and CLOSE Latch
                        window.Logger.info('ReactAutomation', '🛡️ Latch is OPEN -> Triggering Edit');

                        // Consuming latch immediately to prevent double-fire
                        this._autoEditArmed = false;

                        // Trigger Edit with delay to allow React to mount
                        setTimeout(() => {
                            this.monitorAndEdit({ source: 'watcher', singleRun: true });
                        }, 800);
                    } else {
                        // Latch is CLOSED -> Ignore (Result or Next Image)
                        window.Logger.info('ReactAutomation', '🛡️ Latch is CLOSED -> Ignoring navigation (Go back to gallery to reset)');
                    }
                }
            }
        }, 500);
    }

    stopImageEditWatcher() {
        // Do NOT clear _completedEdits or _editCooldownUntil here to allow session persistence
        if (this._imageEditWatcher) {
            clearInterval(this._imageEditWatcher);
            this._imageEditWatcher = null;
            window.Logger.info('ReactAutomation', 'xx STOPPED IMAGE EDIT WATCHER');
        }
    }

    /**
     * WRAPPER: Legacy sendToImageEdit (Required for QuickLaunch/Content.js)
     * Wraps the new monitorAndEdit logic.
     */
    async sendToImageEdit(promptText, options = {}) {
        // Prepare options
        const editOptions = {
            source: 'legacy_api',
            singleRun: true,
            imageId: options.imageId
        };

        // If prompt is provided, we might need to inject it into the UI Manager manually first
        // or ensure monitorAndEdit uses it. 
        // monitorAndEdit pulls from UIRawInputManager. 
        // We should set it there if provided.
        if (promptText && window.gvpUIManager?.uiRawInputManager) {
            window.gvpUIManager.uiRawInputManager.setValue(promptText);
        }

        return this.monitorAndEdit(editOptions);
    }

    /**
     * WRAPPER: sendToLatestImageEdit (Re-Edit Button)
     */
    async sendToLatestImageEdit(promptText) {
        if (promptText && window.gvpUIManager?.uiRawInputManager) {
            window.gvpUIManager.uiRawInputManager.setValue(promptText);
        }
        return this.monitorAndEdit({ source: 're-edit-btn', singleRun: true });
    }

    /**
     * CORE LOGIC: Monitor and Edit (Smart Scan v2.2)
     * Performs strict Linear Sequential Validation to ensure Image Edit mode.
     * 
     * Features:
     * - Phase A: Mode Toggle Check
     * - Phase B: Submit Button Context Check (The definitive source of truth)
     * - Thumbnail: Selects 1st thumbnail (Original)
     * - Submission: Single Enter Key (Gold Standard)
     * - Auto-Back: Return to gallery if enabled
     * 
     * @param {Object} options
     * @param {string} options.source - 'watcher' or 'manual' | 'legacy_api' | 're-edit-btn'
     * @param {boolean} options.singleRun - If true, runs once (e.g. Re-Edit)
     */
    /**
     * CORE LOGIC: Monitor and Edit (Robust State Machine v3.0)
     * Performs strict Linear Sequential Validation (6 Stages) to ensure Image Edit mode.
     * 
     * Pipeline:
     * 1. Stabilization (Image Toggle + First Thumbnail)
     * 2. Navigation (Direct -> Stabilize -> Retry -> Fallback)
     * 3. Context Verification (Image Chip / Ghost Text)
     * 4. Input Injection
     * 5. Secure Submission (Button Click ONLY)
     * 6. Completion (Wait 1.5s -> Auto-Back)
     * 
     * @param {Object} options
     * @param {string} options.source - 'watcher' or 'manual' | 'legacy_api' | 're-edit-btn'
     * @param {boolean} options.singleRun - If true, runs once (e.g. Re-Edit)
     */
    async monitorAndEdit(options = {}) {
        const { source = 'manual', singleRun = false } = options;
        const SELECTORS = window.GROK_SELECTORS || {};

        // 0. Deduping & Locking
        if (!this._completedEdits) this._completedEdits = new Set();
        const currentUrl = window.location.href;
        const urlMatch = currentUrl.match(/\/post\/([a-f0-9-]{36})/i) || currentUrl.match(/\/imagine\/([a-f0-9-]{36})/i);
        const currentId = urlMatch ? urlMatch[1] : null;

        // Diagnostic Helpers
        const logStep = (msg) => window.Logger.info('ReactAutomation', `[ImgEdit] 🟢 ${msg}`);
        const waitStep = async (ms = 500) => await new Promise(r => setTimeout(r, ms));

        if (!SELECTORS.FEATURES) {
            logStep('🛑 CRITICAL: Selectors not loaded. Aborting.');
            return;
        }

        if (this._isEditing) {
            logStep('⚠️ Already running. Skipping.');
            return;
        }

        if (source === 'watcher' && currentId && this._completedEdits.has(currentId)) {
            window.Logger.info('ReactAutomation', `🛡️ Skipping already edited post: ${currentId}`);
            return;
        }

        this._isEditing = true;
        window.Logger.info('ReactAutomation', `🛡️ Starting Robust Pipeline v3.1 (${source})`, options);

        try {
            // === STAGE 1: MODE VALIDATION & DIRECT ENTRY ATTEMPT ===
            logStep('STAGE 1: Mode Validation & Direct Entry...');

            // ATTEMPT 1: Detect if we are already in Image Edit mode ("Add more images" button)
            let addMoreImagesBtn = null;
            if (SELECTORS.FEATURES?.EXTENDED_EDIT?.ADD_MORE_IMAGES_BTN) {
                addMoreImagesBtn = await this.waitForElement(SELECTORS.FEATURES.EXTENDED_EDIT.ADD_MORE_IMAGES_BTN, 1000).catch(() => null);
            } else {
                addMoreImagesBtn = await this.waitForElement('button[aria-label="Add more images"]', 1000).catch(() => null);
            }

            if (addMoreImagesBtn) {
                logStep('✅ Found "Add more images" button. Already in Image edit mode. Proceeding to inject prompt...');
            } else {
                // ATTEMPT 2: Detect if we are in Video mode ("Edit image" button is present)
                let directEditBtn = await this.waitForElement(SELECTORS.FEATURES.IMAGE_EDIT.monitorAndEdit.DIRECT_EDIT_BTN, 1000).catch(() => null);

                if (directEditBtn) {
                    logStep('✅ Found "Edit image" button (Video mode). Clicking to enter image edit mode...');
                    this.reactClick(directEditBtn, 'Edit image Button');
                    await waitStep(800);
                } else {
                    logStep('⚠️ Neither "Add more images" nor "Edit image" button found directly. Proceeding to find fallback input...');
                }
            }

            // === STAGE 2: CONTEXT VERIFICATION ===
            logStep('STAGE 2: Context Verification (Finding Input)...');
            await waitStep(500);

            const inputEl = await this.waitForElement(SELECTORS.FEATURES.IMAGE_EDIT.monitorAndEdit.EDIT_INPUT, 2000).catch(() => null);

            if (!inputEl) {
                throw new Error('Context Verification Failed: No Edit Input found.');
            }
            logStep('✅ Context Verified: Found Edit Input.');


            // === STAGE 3: POST-ENTRY STABILIZATION (Carousel Reset) ===
            logStep('STAGE 3: Post-Entry Stabilization (Noise Guard & Reset)...');

            // A. EXTENDED MODE GUARD (User Report: "Combining/Adding extra images")
            // If we accidentally entered "Extend" mode, we must exit it to ensure single-image edit.
            // CRITICAL FIX: Only exit if we actually see added images (via Remove Button).
            // Just seeing the "Exit" button might be a false positive (it often doubles as the Image Chip).

            const exitExtendBtn = SELECTORS.FEATURES?.IMAGE_EDIT?.EXTENDED_EDIT?.EXIT_EXTEND_MODE_BTN
                ? document.querySelector(SELECTORS.FEATURES.IMAGE_EDIT.EXTENDED_EDIT.EXIT_EXTEND_MODE_BTN)
                : null;

            const hasAddedImages = SELECTORS.FEATURES?.IMAGE_EDIT?.EXTENDED_EDIT?.REMOVE_ADDED_IMAGE_BTN
                ? !!document.querySelector(SELECTORS.FEATURES.IMAGE_EDIT.EXTENDED_EDIT.REMOVE_ADDED_IMAGE_BTN)
                : false;

            if (exitExtendBtn && hasAddedImages) {
                logStep('⚠️ Detected Extended Mode (Added Images Found). Clicking "Exit Extend Mode" to reset...');
                this.reactClick(exitExtendBtn, 'Exit Extend Mode');
                await waitStep(500);
            } else if (exitExtendBtn) {
                logStep('ℹ️ "Exit/Image" button found but NO added images. Assuming Single Edit Mode (Safe).');
            }

            // B. THUMBNAIL RESET
            // NOW we are safe to click thumbnails inside the modal/carousel. We explicitly want
            // the 1st thumbnail in the list (index 0) to ensure we're targeting the original or most recent selected baseline.
            logStep('STAGE 3.5: Thumbnail Reset...');
            // We use standard querySelectorAll because SELECTORS.FEATURES.IMAGE_EDIT.monitorAndEdit.THUMBNAILS[0] is 'div.snap-y.snap-mandatory button.snap-center'
            const thumbSelector = SELECTORS.FEATURES.IMAGE_EDIT.monitorAndEdit.THUMBNAILS[0] || 'div.snap-y.snap-mandatory button.snap-center';

            await waitStep(200); // Wait for carousel to populate
            const allThumbs = document.querySelectorAll(thumbSelector);

            let targetThumb = null;
            if (allThumbs && allThumbs.length > 0) {
                targetThumb = allThumbs[0]; // ALWAYS pick the first thumbnail as requested by user
            }

            if (targetThumb) {
                logStep('Clicking First Valid Thumbnail to ensure state...');
                this.reactClick(targetThumb, 'First Valid Thumbnail (Stabilization)');
                await waitStep(300); // Allow UI to settle (Optimized)
            } else {
                logStep('ℹ️ No valid thumbnails found (Single View or all Noise). Skipping step.');
            }


            // === STAGE 4: INPUT INJECTION ===
            logStep('STAGE 4: Input Injection...');

            let promptText = '';
            if (window.gvpUIManager?.uiRawInputManager) {
                promptText = window.gvpUIManager.uiRawInputManager.getCurrentRawPrompt();
            }

            // Define fullPrompt in main scope
            let fullPrompt = '';

            if (!promptText) {
                logStep('ℹ️ No raw prompt detected. Preserving existing prompt text.');
                if (inputEl) {
                    fullPrompt = inputEl.textContent || '';
                    fullPrompt = await this._applyPromptTransforms(fullPrompt); // Apply transforms even to existing UI text

                    if (fullPrompt !== (inputEl.textContent || '')) {
                        inputEl.innerHTML = '<p><br></p>';
                        await this._setEditableValue(inputEl, fullPrompt);
                        logStep('✅ Existing Prompt Transformed.');
                    }
                }
            } else {
                if (!inputEl) throw new Error('Editor Input not found (verified in Stage 3 but lost?)');

                fullPrompt = await this._applyPromptTransforms(promptText);

                // Clear & Inject
                inputEl.innerHTML = '<p><br></p>';
                await this._setEditableValue(inputEl, fullPrompt);
                logStep('✅ Prompt Injected.');
            }


            // === STAGE 5: SECURE SUBMISSION ===
            logStep('STAGE 5: Secure Submission...');

            // Target the specific Edit Button
            const submitBtn = await this.waitForElement(SELECTORS.FEATURES.IMAGE_EDIT.monitorAndEdit.SUBMIT_EDIT_BTN, 2000);

            if (!submitBtn) throw new Error('Submit Edit Button not found');

            // Payload Interception
            window.postMessage({
                source: 'gvp-extension',
                type: 'GVP_SET_PAYLOAD_OVERRIDE',
                payload: { text: fullPrompt }
            }, '*');
            await waitStep(200);

            // Expectation Set
            window.postMessage({
                source: 'gvp-extension',
                type: 'GVP_SET_EXPECTATION',
                payload: { expect: 'image' }
            }, '*');

            // ACTION: Click
            logStep('🚀 Clicking Submit Button...');
            this.aggressiveClick(submitBtn);
            logStep('✅ Click Dispatched.');


            // === STAGE 6: POST-SUBMIT RESET (User Request v3.2) ===
            // "Click the 1st thumbnail again and THEN exit"
            logStep('STAGE 6: Post-Submit Reset...');

            // Wait brief moment for React to process the submit click
            await waitStep(300);

            // Re-find the thumbnail list
            const postSubmitThumbs = await this.waitForElement(SELECTORS.FEATURES.IMAGE_EDIT.monitorAndEdit.THUMBNAILS, 1000).catch(() => null);
            let validThumb = null;

            if (postSubmitThumbs) {
                const allResetThumbs = document.querySelectorAll(Array.isArray(SELECTORS.FEATURES.IMAGE_EDIT.monitorAndEdit.THUMBNAILS)
                    ? SELECTORS.FEATURES.IMAGE_EDIT.monitorAndEdit.THUMBNAILS[0]
                    : SELECTORS.FEATURES.IMAGE_EDIT.monitorAndEdit.THUMBNAILS);

                for (const thumb of allResetThumbs) {
                    const img = thumb.querySelector('img');
                    if (!img) continue;
                    // RELAXED NOISE GUARD (Reset): Removed 'data:image' ban
                    validThumb = thumb;
                    break;
                }
            }

            if (validThumb) {
                logStep('🔄 Re-clicking First Valid Thumbnail (State Flush)...');
                this.reactClick(validThumb, 'Post-Submit Thumbnail Reset');
                await waitStep(200);
            } else {
                logStep('ℹ️ No valid thumbnail found for reset. Skipping.');
            }


            // === STAGE 7: COMPLETION & AUTO-BACK ===
            logStep('STAGE 7: Completion...');

            // Register Logic
            const stateManager = this.stateManager || window.gvpStateManager;
            if (stateManager?.generateGenerationId) {
                const generationId = stateManager.generateGenerationId();
                stateManager.registerGeneration(generationId, fullPrompt, { mode: 'image-edit' });
                stateManager.setState({
                    generation: { isGenerating: true, currentGenerationId: generationId }
                });
            }

            if (currentId) this._completedEdits.add(currentId);
            this._editCooldownUntil = Date.now() + 5000;

            // Auto-Back Logic
            const shouldAutoBack = !!this.stateManager?.getState?.().settings?.autoNavigateBackAfterImageEdit;

            if (shouldAutoBack) {
                logStep('⏳ Waiting 1000ms for Auto-Back...');
                await waitStep(1000);

                const targetUrl = `${window.location.origin}/imagine/saved`;
                logStep(`🔙 Navigating back to: ${targetUrl}`);
                window.history.pushState({}, '', targetUrl);
                window.dispatchEvent(new PopStateEvent('popstate'));

                // Force UI cleanup
                await waitStep(500);
                const closeBtn = document.querySelector(SELECTORS.FEATURES.IMAGE_EDIT.monitorAndEdit.CLOSE_MODAL_BTN);
                if (closeBtn) closeBtn.click();
            }

        } catch (error) {
            logStep(`❌ MonitorAndEdit Failed: ${error.message}`);
            window.gvpUIManager?.showToast(`Edit failed: ${error.message}`, 'error', 3000);
        } finally {
            logStep('🔒 Pipeline Complete. Releasing Lock.');
            this._isEditing = false;
        }
    }

    /**
     * Quick Video from Edit - Monitor thumbnails and auto-generate video
     * FLOW:
     * Executes the Quick Video generation sequence FROM the Image Edit carousel.
     * Rewritten for v1.38.2x: This is now an "Arming Mode".
     * - Pauses gvp-imgedit-autoback
     * - Waits for the user to manually click a thumbnail in .snap-y
     * - Executes the Settings -> Make Video transition block
     * - Injects the prompt and hits submit.
     * - Resumes gvp-imgedit-autoback
     */
    async monitorAndMakeVideo(timeout = 600000) { // 10 minute wait cap for massive gens
        window.Logger.info('ReactAutomation', '⚡ QUICK VIDEO (ARMED WAIT STATE) - Starting monitor');

        const SELECTORS = window.GROK_SELECTORS || {};
        const startTime = Date.now();

        // 1. Pause AutoBack if active
        // This stops the UI from closing the modal while the user is looking at results
        let wasAutoBackActive = false;
        if (window.gvpUIManager?.stateManager) {
            const state = window.gvpUIManager.stateManager.getState();
            if (state.ui?.imgEditAutoBack) {
                wasAutoBackActive = true;
                window.Logger.info('ReactAutomation', '⏸️ Pausing AutoBack for Quick Video User Selection');
                window.gvpUIManager.stateManager.setState({ ui: { imgEditAutoBack: false } });
            }
        }

        window.gvpUIManager?.showToast('⏱️ Quick Video Armed. Click an edited thumbnail to generate.', 'info', 10000);

        try {
            // === PHASE 1: Wait for User Thumbnail Click ===
            window.Logger.debug('ReactAutomation', 'Phase 1: Waiting for user to click a thumbnail in the carousel...');

            // We need to detect a click specifically within the `.snap-y` container
            const getCarousel = () => document.querySelector('div.snap-y.snap-mandatory');

            let userSelectedThumb = false;
            let lastActiveElement = document.activeElement;

            // Simple polling mechanism to check if activeElement (focus) moved to a thumbnail
            while (Date.now() - startTime < timeout) {
                const carousel = getCarousel();

                if (carousel) {
                    // Method A: Check if a button inside the carousel was focused recently
                    const currentActive = document.activeElement;
                    if (currentActive !== lastActiveElement && carousel.contains(currentActive) && currentActive.tagName === 'BUTTON') {
                        userSelectedThumb = true;
                        window.Logger.debug('ReactAutomation', '✓ User clicked thumbnail via focus detected!');
                        break;
                    }

                    // Method B: The carousel itself might get a 'ring-2' or similar selected class appended dynamically based on the user's HTML
                    // We check if the last active thumbnail visually changed. The user HTML notes: hover:ring-2 ring-2
                    const activeThumb = carousel.querySelector('button.ring-2, button[data-state="active"]');
                    if (activeThumb && activeThumb !== currentActive) { // If an active one emerged that wasn't there initially or changed
                        // Delay just slightly to be safe the user meant to click it
                        await new Promise(r => setTimeout(r, 600));
                        userSelectedThumb = true;
                        window.Logger.debug('ReactAutomation', '✓ User clicked thumbnail via active ring class detected!');
                        break;
                    }

                    lastActiveElement = currentActive;
                }

                await new Promise(r => setTimeout(r, 200));
            }

            if (!userSelectedThumb) {
                window.Logger.warn('ReactAutomation', 'Quick Video Selection timed out or User closed modal.');
                return false;
            }

            window.gvpUIManager?.showToast('🚀 Transitioning to Video Mode...', 'success', 2000);

            // === PHASE 2: Lock UI & Execute strict transition ===
            await new Promise(r => setTimeout(r, 500)); // Buffer wait

            // 2A. Click Settings Gear
            const settingsSelector = SELECTORS.FEATURES?.IMAGE_EDIT?.runDiagnostics?.SETTINGS_BTN || 'button[aria-label="Settings"]';
            const settingsBtn = await this.waitForElement(settingsSelector, 2000);

            if (!settingsBtn) throw new Error('Settings button not found for video transition');

            window.Logger.debug('ReactAutomation', 'Clicking Settings Button...');
            this.aggressiveClick(settingsBtn);

            // 2B. Wait for Menu & Click Make Video
            const popoverSelector = SELECTORS.SHARED?.POPOVER || '[data-radix-menu-content]';
            await this.waitForElement(popoverSelector, 2000);

            let makeVideoItem = null;
            for (let i = 0; i < 20; i++) {
                makeVideoItem = SELECTORS.MENU_ITEMS?.MAKE_VIDEO?.();
                if (makeVideoItem) break;
                await new Promise(r => setTimeout(r, 50));
            }

            if (!makeVideoItem) throw new Error('"Make Video" menu item not found');

            window.Logger.debug('ReactAutomation', 'Clicking "Make Video" Menu Item...');
            this.aggressiveClick(makeVideoItem);

            // === PHASE 3: Context Stabilization & Injection ===
            window.Logger.debug('ReactAutomation', 'Phase 3: Waiting for Video Mode to Mount...');
            await new Promise(r => setTimeout(r, 800)); // Settle time for React TipTap

            const inputSelector = window.GROK_SELECTORS.FEATURES.GENERATOR.sendToGenerator.MAIN_INPUT;
            const inputEl = await this.waitForElement(inputSelector, 5000);
            if (!inputEl) throw new Error('Video Generator Input not found');

            // 3A. Fetch Prompt — always use current JSON (same as "View Current JSON" button)
            let promptText = '';

            // Primary: JSON form (the live prompt the user sees)
            if (window.gvpUIManager?.uiFormManager?.getFormattedPrompt) {
                promptText = window.gvpUIManager.uiFormManager.getFormattedPrompt() || '';
                if (promptText) {
                    window.Logger.debug('ReactAutomation', '📄 Quick Video using current JSON prompt');
                }
            }

            // Fallback: Raw tab
            if (!promptText && window.gvpUIManager?.uiRawInputManager) {
                promptText = window.gvpUIManager.uiRawInputManager.getCurrentRawPrompt();
                if (promptText) {
                    window.Logger.debug('ReactAutomation', '📝 Quick Video falling back to Raw prompt');
                }
            }

            if (!promptText) {
                window.Logger.warn('ReactAutomation', 'No prompt found, using generic text');
                promptText = "Animate this image into a video";
            }
            const fullPrompt = await this._applyPromptTransforms(promptText);

            // 3B. Inject
            inputEl.innerHTML = '<p><br></p>';
            await this._setEditableValue(inputEl, fullPrompt);

            // 3C. Secure Payload Interception Override
            window.postMessage({
                source: 'gvp-extension',
                type: 'GVP_SET_PAYLOAD_OVERRIDE',
                payload: { text: fullPrompt }
            }, '*');

            window.postMessage({
                source: 'gvp-extension',
                type: 'GVP_SET_EXPECTATION',
                payload: { expect: 'video' }
            }, '*');

            // === PHASE 4: Submit ===
            window.Logger.debug('ReactAutomation', 'Phase 4: Executing Final Submission...');
            await new Promise(r => setTimeout(r, 200));

            const submitBtnSelectors = SELECTORS.FEATURES.GENERATOR.sendToGenerator.SUBMIT_BUTTON;
            const submitBtn = await this.waitForElement(submitBtnSelectors, 3000);

            if (!submitBtn) throw new Error('Video Submit button not found');

            this.aggressiveClick(submitBtn);
            window.Logger.info('ReactAutomation', '✅ Video Generation Submitted Successfully');

            // Notify UI to close Quick Video session state (untoggle button)
            if (window.gvpUIManager && typeof window.gvpUIManager.setQuickLaunchMode === 'function') {
                window.gvpUIManager.setQuickLaunchMode('edit'); // Restores normal edit state
            }
            return true;

        } catch (error) {
            window.Logger.error('ReactAutomation', 'Error in Quick Video from Edit', error);
            window.gvpUIManager?.showToast(`Quick video failed: ${error.message}`, 'error', 3000);
            return false;
        }
    }

    /**
     * Identify if a clicked element is a valid Quick Launch target (e.g. Fresh Gen "Make video" button).
     * Centralizes logic for detecting buttons that should trigger immediate execution (blind).
     * 
     * @param {HTMLElement} element - The clicked element
     * @returns {Object|null} - { type: 'blind', element: HTMLElement, ... } or null
     */
    identifyQuickLaunchTarget(element) {
        if (!element) return null;
        const SELECTORS = window.GROK_SELECTORS || {};

        // 1. Fresh Gen / Blind Execution Target (Base64/No ID)
        // Uses centralized selector from selectors.js
        const freshGenSelectors = SELECTORS.FEATURES?.QUICK_LAUNCH?.monitorAndMakeVideo?.FRESH_GEN_BTN;

        if (freshGenSelectors) {
            const btn = element.closest(
                Array.isArray(freshGenSelectors) ? freshGenSelectors.join(', ') : freshGenSelectors
            );

            // Validation: Must be the button itself or inside it, AND match context
            if (btn) {
                return {
                    type: 'favorite-blind',
                    blindExecution: true, // CRITICAL: Bypass ID check
                    element: btn
                };
            }
        }

        return null;
    }

    /**
     * Run safe diagnostics to verify selectors on the current page.
     * @param {string} mode - 'static' (current elements) or 'interactive' (opens menus).
     * @returns {Promise<Object>} Report of found/missing elements.
     */
    async runDiagnostics(mode = 'interactive') {
        window.Logger.info('ReactAutomation', 'Running Diagnostics...', { mode });
        const report = { found: [], missing: [], logs: [] };
        const log = (msg, success = true) => {
            report.logs.push((success ? '✅ ' : '❌ ') + msg);
            window.Logger.info('ReactAutomation', `[Diag] ${msg}`);
        };

        try {
            const SELECTORS = window.GROK_SELECTORS || {};
            const EDIT_FLOW = SELECTORS.EDIT_IMAGE_FLOW || {};

            // 1. Static Checks (Elements that should be visible)
            log('Starting Static Checks...');

            // Check Input
            const input = document.querySelector(SELECTORS.FEATURES.IMAGE_EDIT.monitorAndEdit.EDIT_INPUT) || document.querySelector('div.tiptap');
            if (input) {
                report.found.push('Main Input');
                log('Found Main Input');
            } else {
                report.missing.push('Main Input');
                log('Missing Main Input', false);
            }

            // Check Mode Buttons
            try {
                const imageBtn = SELECTORS.MODE_TOGGLE?.BUTTONS?.IMAGE?.();
                if (imageBtn) {
                    report.found.push('Image Mode Button');
                    log('Found Image Mode Button');
                } else {
                    report.missing.push('Image Mode Button');
                    log('Missing Image Mode Button (Are you on a post page?)', false);
                }
            } catch (e) { log('Mode Check Error: ' + e.message, false); }

            if (mode === 'static') return report;

            // 2. Interactive Checks (Settings Menu)
            log('Starting Interactive Checks (Settings Menu)...');

            const settingsSelectors = [
                SELECTORS.FEATURES.IMAGE_EDIT.runDiagnostics.SETTINGS_BTN,
                'button[aria-label="Settings"]'
            ];

            const settingsBtn = await this.waitForElement(settingsSelectors, 2000).catch(() => null);

            if (settingsBtn) {
                report.found.push('Settings Button');
                log('Found Settings Button - Clicking...');
                this.reactClick(settingsBtn, 'Diag Settings');

                // Wait for menu
                const content = await this.waitForElement('[data-radix-menu-content]', 2000).catch(() => null);
                if (content) {
                    report.found.push('Settings Menu Content');
                    log('Settings Menu Opened');

                    await new Promise(r => setTimeout(r, 500)); // Wait for render

                    // Check for "Edit Image"
                    const editItem = (typeof SELECTORS.MENU_ITEMS.EDIT_IMAGE === 'function')
                        ? SELECTORS.MENU_ITEMS.EDIT_IMAGE()
                        : null;

                    if (editItem) {
                        report.found.push('Edit Image Menu Item');
                        log('Found "Edit Image" Menu Item');
                    } else {
                        // Check for Make Video as fallback proof
                        const makeVideo = SELECTORS.MENU_ITEMS?.MAKE_VIDEO_2026?.();
                        if (makeVideo) {
                            report.found.push('Make Video Menu Item');
                            log('Found "Make Video" (but not Edit Image - wrong mode?)');
                        } else {
                            report.missing.push('Menu Items');
                            log('Missing Edit/Make Video items', false);
                        }
                    }

                    // Cleanup: Close menu (click settings again or body)
                    this.reactClick(settingsBtn, 'Close Settings');
                    log('Closed Settings Menu');
                } else {
                    report.missing.push('Settings Menu Content');
                    log('Settings Menu Content did not appear', false);
                }
            } else {
                report.missing.push('Settings Button');
                log('Settings Button not found', false);
            }

        } catch (error) {
            log('Diagnostics Error: ' + error.message, false);
            report.error = error.message;
        }

        return report;
    }

    reactClick(element, elementName = 'element') {
        // React-compatible click that fires synthetic pointer/mouse events without native .click()
        if (!element) {
            window.Logger.error('ReactAutomation', `Cannot click ${elementName} - element not found`);
            return;
        }

        try {
            if (typeof element.focus === 'function') {
                element.focus({ preventScroll: true });
            }
        } catch (_) {
            // Ignore focus errors (e.g., hidden elements)
        }

        const dispatch = (type, EventCtor = MouseEvent, extraInit = {}) => {
            const init = {
                bubbles: true,
                cancelable: true,
                view: window,
                button: 0,
                ...extraInit
            };
            element.dispatchEvent(new EventCtor(type, init));
        };

        if (typeof PointerEvent === 'function') {
            dispatch('pointerdown', PointerEvent);
        }
        dispatch('mousedown');
        if (typeof PointerEvent === 'function') {
            dispatch('pointerup', PointerEvent);
        }
        dispatch('mouseup');
        dispatch('click');

        window.Logger.debug('ReactAutomation', `Clicked ${elementName}`);
    }

    async waitForAttribute(element, attribute, value, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const checkAttribute = () => {
                if (element.getAttribute(attribute) === value) {
                    resolve(element);
                }
            };

            checkAttribute();
            const observer = new MutationObserver(checkAttribute);
            observer.observe(element, { attributes: true, attributeFilter: [attribute] });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Attribute ${attribute}=${value} not found within ${timeout}ms`));
            }, timeout);
        });
    }

    _findButtonByText(text) {
        if (!text) return null;
        const target = text.trim().toLowerCase();
        return Array.from(document.querySelectorAll('button')).find(btn =>
            btn.textContent && btn.textContent.trim().toLowerCase() === target
        ) || null;
    }

    _findTextareaFallback() {
        const candidates = Array.from(document.querySelectorAll('textarea, div[contenteditable="true"]'));

        // Filter out image gallery textareas
        const filtered = candidates.filter(el => {
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
            const dataPlaceholder = (el.getAttribute('data-placeholder') || '').toLowerCase();

            // Exclude image gallery/generation textareas
            if (aria.includes('image') || aria.includes('gallery') || aria.includes('generate image')) {
                return false;
            }
            if (placeholder.includes('image') || placeholder.includes('gallery') || placeholder.includes('generate image')) {
                return false;
            }
            if (dataPlaceholder.includes('image') || dataPlaceholder.includes('gallery')) {
                return false;
            }

            // Check if it's in the image carousel/gallery container
            const inImageGallery = el.closest('[class*="image"]') || el.closest('[class*="gallery"]');
            if (inImageGallery) {
                return false;
            }

            return true;
        });

        // Find video-specific textarea
        const heuristics = filtered.find(el => {
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
            const dataPlaceholder = (el.getAttribute('data-placeholder') || '').toLowerCase();
            const role = (el.getAttribute('role') || '').toLowerCase();
            return aria.includes('video') ||
                placeholder.includes('video') ||
                dataPlaceholder.includes('video') ||
                (role === 'textbox' && !aria.includes('image'));
        });

        // IMPORTANT: Return null if no video textarea found - never blindly use first textarea
        return heuristics || null;
    }
};

// Auto-instantiate and expose on window for UIManager access
// NOTE: Wait for gvpStateManager to be available (it's set in content.js boot sequence)
if (!window.gvpReactAutomation) {
    // Use gvpStateManager instance if available, fallback gracefully
    const stateManagerInstance = window.gvpStateManager || null;
    window.gvpReactAutomation = new window.ReactAutomation(stateManagerInstance);
    window.Logger.info('ReactAutomation', 'Instance created as window.gvpReactAutomation');
}
