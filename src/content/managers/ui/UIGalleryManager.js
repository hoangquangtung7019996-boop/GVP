// src/content/managers/ui/UIGalleryManager.js
// v1.44.5 — Hover tracker + Z-key trigger for GalleryMiniUIManager.
// Tracks the hovered gallery card and dispatches open/close to GalleryMiniUIManager
// when the user presses Z (not while typing).

window.UIGalleryManager = class UIGalleryManager {

    /**
     * @param {object} stateManager
     * @param {object} uiManager — must expose .galleryMiniUI (GalleryMiniUIManager instance)
     */
    constructor(stateManager, uiManager) {
        this.stateManager = stateManager;
        this.uiManager = uiManager;

        /** @type {string|null} Last UUID extracted from hovered card's img.src */
        this.hoveredImageId = null;
        /** @type {Element|null} The hovered card element */
        this.hoveredCardEl = null;

        // Bound handlers for clean teardown
        this._onMouseOver = this._handleMouseOver.bind(this);
        this._onKeyDown = this._handleKeyDown.bind(this);

        console.log('[GVP UIGalleryManager] ✅ Constructor called — uiManager:', uiManager);
        window.Logger.info('UIGalleryManager', 'Initialized');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────────────────────────

    /** Attach event listeners. Called once from UIManager.init(). */
    init() {
        document.addEventListener('mouseover', this._onMouseOver, { passive: true });
        document.addEventListener('keydown', this._onKeyDown);
        console.log('[GVP UIGalleryManager] ✅ Hover + Z-key listeners attached to document');
        window.Logger.info('UIGalleryManager', '✅ Hover + Z-key listeners attached');
    }

    /** Remove all listeners (called on extension teardown). */
    destroy() {
        document.removeEventListener('mouseover', this._onMouseOver);
        document.removeEventListener('keydown', this._onKeyDown);
        window.Logger.info('UIGalleryManager', 'Destroyed');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE — HOVER TRACKING
    // ─────────────────────────────────────────────────────────────────────────

    _handleMouseOver(e) {
        // QUICK GUARD (v1.46.6): If mouse is over GVP Rails, do NOT clear or update hover state.
        // This prevents the "Z toggle" from failing when the mouse is over the Mini UI buttons.
        const composedPath = typeof e.composedPath === 'function' ? e.composedPath() : [];
        const isRailHit = composedPath.some(node => node.id === 'gvp-gallery-rails' || (node.classList && node.classList.contains('gvp-rail')));
        if (isRailHit) return;

        // Grok gallery uses role="listitem" inside a virtualised role="list"
        const card = e.target.closest('[role="listitem"], [role="article"], .masonry-item, [class*="media-post-masonry-card"], div.group\\/media-post-masonry-card');
        if (!card) {
            if (this.hoveredImageId) {
                console.log('[GVP UIGalleryManager] Mouse left card — clearing hover state');
            }
            this.hoveredImageId = null;
            this.hoveredCardEl = null;
            return;
        }

        // Get the main image inside the card
        const img = card.querySelector('img[src]');
        if (!img?.src) {
            console.log('[GVP UIGalleryManager] Card found but no img[src] inside it:', card);
            return;
        }

        const uuid = this._extractLastUuid(img.src);
        if (uuid) {
            if (uuid !== this.hoveredImageId) {
                console.log(`[GVP UIGalleryManager] 🖼️ Hovering card — imageId: ${uuid} | src: ${img.src.substring(0, 80)}`);
            }
            this.hoveredImageId = uuid;
            this.hoveredCardEl = card;
        } else {
            console.log('[GVP UIGalleryManager] ⚠️ Could not extract UUID from src:', img.src);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE — Z-KEY HANDLER
    // ─────────────────────────────────────────────────────────────────────────

    _handleKeyDown(e) {
        if (e.key.toLowerCase() !== 'z') return;

        console.log('[GVP UIGalleryManager] Z pressed — typing?', this._isTypingContext(e), '| hoveredImageId:', this.hoveredImageId);

        // v1.46.6: If we have a hovered card, we OVERRIDE typing context.
        // This ensures 'Z' opens GVP even if the prompt box is focused.
        if (this._isTypingContext(e) && !this.hoveredImageId) return;

        if (!this.hoveredImageId) {
            console.log('[GVP UIGalleryManager] Z pressed but no hovered card — hover a card first');
            return;
        }

        const miniUI = this.uiManager?.galleryMiniUI;
        if (!miniUI) {
            console.log('[GVP UIGalleryManager] ❌ galleryMiniUI is null on uiManager:', this.uiManager);
            window.Logger.warn('UIGalleryManager', '⚠️ galleryMiniUI not available on uiManager');
            return;
        }

        // Toggle: pressing Z on the same card that is already open → close
        if (miniUI.isOpen && miniUI.currentImageId === this.hoveredImageId) {
            console.log('[GVP UIGalleryManager] Z — closing (toggle)');
            // Prevent 'z' from being typed if we're in an input
            e.preventDefault();
            e.stopImmediatePropagation();
            miniUI.close();
        } else {
            console.log(`[GVP UIGalleryManager] Z — opening miniUI for ${this.hoveredImageId.substring(0, 8)}…`);
            // Prevent 'z' from being typed
            e.preventDefault();
            e.stopImmediatePropagation();
            miniUI.open(this.hoveredImageId, this.hoveredCardEl);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UTILITIES
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Golden Rule: The relevant UUID is the LAST UUID in the URL.
     * Handles both /images/.../UUID and /media/.../ROOT_UUID/CHILD_UUID patterns.
     * @param {string} url
     * @returns {string|null}
     */
    _extractLastUuid(url) {
        if (!url) return null;
        const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
        const matches = url.match(UUID_RE);
        return matches ? matches[matches.length - 1] : null;
    }

    /**
     * Returns true if the keydown originated from an input/textarea/contenteditable.
     * Prevents the Z shortcut from firing while the user is typing a prompt.
     */
    _isTypingContext(e) {
        const tag = e.target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
        if (e.target?.isContentEditable) return true;
        return false;
    }
};
