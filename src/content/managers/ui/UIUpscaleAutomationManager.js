// UIUpscaleAutomationManager.js - UI Automation for Upscaling (Toggle Mode)
// Mimics Tampermonkey script logic for gallery click -> upscale
// Dependencies: StateManager, ReactAutomation

window.UIUpscaleAutomationManager = class UIUpscaleAutomationManager {
    constructor(stateManager) {
        this.stateManager = stateManager;
        this.isActive = sessionStorage.getItem('gvp_ui_upscale_active') === 'true';
        this.automationState = { step: 0, attempts: 0, pageId: null, timer: 0 };
        this.observer = null;

        // Bind methods
        this._handleClick = this._handleClick.bind(this);
        this._runAutomationLoop = this._runAutomationLoop.bind(this);

        // Start loop if active
        if (this.isActive) {
            this.start();
        }

        // Listen for navigation to resume automation if needed
        window.addEventListener('popstate', () => { if (this.isActive) this._runAutomationLoop(); });
        // Also a periodic check similar to the script is useful as SPA navigation might not trigger popstate reliably for all cases or timing
        setInterval(() => {
            if (this.isActive) this._runAutomationLoop();
        }, 500);

        window.Logger.info('Upscale', 'UIUpscaleAutomationManager initialized', { active: this.isActive });
    }

    toggle(force) {
        this.isActive = typeof force === 'boolean' ? force : !this.isActive;
        sessionStorage.setItem('gvp_ui_upscale_active', this.isActive);

        if (this.isActive) {
            this.start();
            this._showToast('🤖 UI Upscale Mode Enabled');
        } else {
            this.stop();
            this._showToast('UI Upscale Mode Disabled');
        }
        return this.isActive;
    }

    start() {
        this._attachGalleryListeners();
        // Set up an observer to handle new items appearing in infinite scroll
        if (!this.observer) {
            this.observer = new MutationObserver((mutations) => {
                let shouldAttach = false;
                for (const m of mutations) {
                    if (m.addedNodes.length) shouldAttach = true;
                }
                if (shouldAttach) this._attachGalleryListeners();
            });
            this.observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    stop() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        // cleanup listeners? strictly hard to remove anonymous wrappers but the flag check in handler handles it.
    }

    _attachGalleryListeners() {
        // Matches logic from prototype script
        const mediaElements = document.querySelectorAll('img[src*="poster.jpg"], video, img[src*="generated_video"]');

        mediaElements.forEach(el => {
            if (el.dataset.gvpAutoAttach) return;

            // Validate it looks like a generative video content
            const src = el.src || el.currentSrc || el.dataset.src;
            if (!src || (!src.includes('/generated/') && !src.includes('poster.jpg'))) return;

            el.dataset.gvpAutoAttach = 'true';

            // Use capturing to intercept before other handlers
            el.addEventListener('click', this._handleClick, true);
        });
    }

    _handleClick(e) {
        if (!this.isActive) return;

        // Find the video ID or Post ID context
        const el = e.target;
        // In the script, we clicked and let logic handle it, but script had:
        // el.addEventListener('click', (e) => { ... logic ... });
        // The script click handler in API mode did fetch. 
        // In UI mode (from script):
        // "UI Automation Mode" logic was looping in `handleUiMode` based on URL.
        // It didn't seemingly strictly hijack the click in the PROTOTYPE for UI mode, 
        // it relied on the USER clicking the post to go to the post page?
        // Wait, looking at prototype V4:
        // UI Mode logic (lines 103+) only runs if URL includes '/imagine/post/'.
        // So the user manualy clicks the video, goes to post page, then automation kicks in.
        // BUT the user request says: "modifying gallery click behavior to: Navigate to the image's post page."

        // So we need to ensure the click takes them to the post page.
        // Usually clicking the video in Grok gallery DOES open the post page (or modal).
        // If it opens a modal, we might need to handle that.
        // Current Grok behavior: Clicking a video often plays it or opens a post view.
        // Let's assume default behavior navigates or we force it.

        // If the element is wrapped in a link:
        const link = el.closest('a');
        if (link && link.href && link.href.includes('/imagine/post/')) {
            // Let default happen, it will go to post page.
            return;
        }

        // If it's not a link (e.g. just a playing video element), we might need to find the post ID.
        // The script didn't strictly force navigation in the `handleUiMode` section, it just waited for the URL to change.
        // "When enabled, modifying gallery click behavior to: Navigate to the image's post page."

        // Let's try to find the link if it exists nearby.
        // If we can't find a link, we let it be.
        const parentCard = el.closest('article') || el.closest('[data-testid="grid-item"]'); // Heuristic
        if (parentCard) {
            const cardLink = parentCard.querySelector('a[href*="/imagine/post/"]');
            if (cardLink) {
                e.preventDefault();
                e.stopPropagation();

                // Fast SPA Navigation
                const targetPath = new URL(cardLink.href).pathname;
                window.history.pushState({}, '', targetPath);
                window.dispatchEvent(new PopStateEvent('popstate'));
            }
        }
    }

    _runAutomationLoop() {
        if (!window.location.href.includes('/imagine/post/')) {
            this.automationState.step = 0;
            return;
        }

        const currentPageId = window.location.pathname;
        if (this.automationState.pageId !== currentPageId) {
            this.automationState.pageId = currentPageId;
            this.automationState.step = 0;
            this.automationState.attempts = 0;
            window.Logger.info('Upscale', "New Post Page detected.");
        }

        // Mapping steps from prototype
        // Step 0: Click "More options"
        if (this.automationState.step === 0) {
            // Find ALL "More options" buttons
            const candidates = Array.from(document.querySelectorAll('button[aria-label="More options"]'));

            // Heuristic: The one in the <article> or just the last one/visible one.
            let targetBtn = candidates.find(btn => btn.closest('article'));
            if (!targetBtn && candidates.length > 0) targetBtn = candidates[0];

            if (targetBtn) {
                this._showToast("🤖 Opening Menu...");
                this._reactClick(targetBtn, "More Options Button");
                this.automationState.step = 1;
                this.automationState.attempts = 0;
            } else {
                this.automationState.attempts++;
                if (this.automationState.attempts % 10 === 0) window.Logger.debug('Upscale', "Waiting for More options btn...");
            }
        }
        // Step 1: Click "Upscale video"
        else if (this.automationState.step === 1) {
            const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"]'));
            const upscaleItem = menuItems.find(el => el.textContent.includes('Upscale video'));

            if (upscaleItem) {
                this._showToast("🤖 Clicking Upscale...");
                this._reactClick(upscaleItem, "Upscale Item");
                this.automationState.step = 2;
                this.automationState.timer = Date.now();
            } else {
                this.automationState.attempts++;
                if (this.automationState.attempts > 20) {
                    // Try to recover if menu didn't open?
                    // For now, simple abort logic from script
                    this._showToast("⚠️ Upscale item not found. Retrying menu...");
                    this.automationState.step = 0; // Go back to try opening menu again
                    this.automationState.attempts = 0;
                }
            }
        }
        // Step 2: Wait & Escape (Close menu/modal)
        else if (this.automationState.step === 2) {
            if (Date.now() - this.automationState.timer > 1000) {
                this._showToast("🤖 Returning...");

                // Press Escape to close any hanging menus
                const escapeEvent = new KeyboardEvent('keydown', {
                    key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
                    bubbles: true, cancelable: true, composed: true
                });
                document.body.dispatchEvent(escapeEvent);

                this.automationState.step = 3;
                this.automationState.timer = Date.now();
            }
        }
        // Step 3: Go Back
        else if (this.automationState.step === 3) {
            if (Date.now() - this.automationState.timer > 500) {
                window.history.back();
                this.automationState.step = 4; // Done for this cycle
            }
        }
    }

    _reactClick(element, elementName = 'element') {
        if (!element) return;

        // Use ReactAutomation helper if available/instantiated, else fallback to internal logic
        if (window.gvpReactAutomation) {
            window.gvpReactAutomation.reactClick(element, elementName);
        } else {
            // Fallback (copied from script)
            try { if (typeof element.focus === 'function') element.focus({ preventScroll: true }); } catch (_) { }

            const dispatch = (type, EventCtor = MouseEvent, extraInit = {}) => {
                const init = { bubbles: true, cancelable: true, view: window, button: 0, ...extraInit };
                element.dispatchEvent(new EventCtor(type, init));
            };

            if (typeof PointerEvent === 'function') dispatch('pointerdown', PointerEvent);
            dispatch('mousedown');
            if (typeof PointerEvent === 'function') dispatch('pointerup', PointerEvent);
            dispatch('mouseup');
            dispatch('click');
        }
    }

    _showToast(msg) {
        if (window.gvpUIManager) {
            window.gvpUIManager.showToast(msg);
        } else {
            window.Logger.info('Toast', msg);
        }
    }
};
