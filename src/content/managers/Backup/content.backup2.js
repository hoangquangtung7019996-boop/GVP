// src/content/content.js - Grok Video Prompter Extension
// Main entry point - initializes the application


(function() {
    'use strict';

    const APP_VERSION = (chrome?.runtime?.getManifest?.()?.version) || '1.15.66';
    window.GVP_APP_VERSION = APP_VERSION;

    // Storage helper for Chrome extension
    const StorageHelper = {
        async setData(key, value) {
            return new Promise((resolve) => {
                chrome.storage.local.set({[key]: value}, resolve);
            });
        },
        async getData(key) {
            return new Promise((resolve) => {
                chrome.storage.local.get([key], (result) => {
                    resolve(result[key]);
                });
            });
        },
        async setSettings(settings) {
            return new Promise((resolve) => {
                chrome.storage.local.set({'gvp-settings': settings}, resolve);
            });
        },
        async getSettings() {
            return new Promise((resolve) => {
                chrome.storage.local.get(['gvp-settings'], (result) => {
                    resolve(result['gvp-settings'] || {});
                });
            });
        }
    };

    class QuickLaunchManager {
        constructor(stateManager, uiManager, reactAutomation) {
            this.stateManager = stateManager;
            this.uiManager = uiManager;
            this.reactAutomation = reactAutomation;
            this.storageKey = 'gvp-quick-launch-request';
            this._favoritesListenerAttached = false;
            this._isProcessing = false;
            this._initialized = false;
            this._navObserverInstalled = false;
            this._navMonitorTimer = null;
            this._resumeTimers = [];
            this._favoritesClickHandler = this._handleFavoritesClick.bind(this);
            this._modeChangeHandler = this._handleQuickModeChange.bind(this);
            this._suppressionHandler = (event) => {
                const active = !!event?.detail?.active;
                this._quickLaunchSuppressed = active;
                if (active) {
                    if (this._debugQuickLaunch) {
                        console.debug('[GVP Quick] Suppressed via event -> clearing payload');
                    }
                    this._clearPendingPayload('suppressed-event');
                }
            };
            const debugFlag = window.__GVP_DEBUG_QUICK__;
            this._debugQuickLaunch = typeof debugFlag === 'boolean' ? debugFlag : false;
            window.__GVP_DEBUG_QUICK__ = this._debugQuickLaunch;
        }

        setUIManager(uiManager) {
            this.uiManager = uiManager;
        }

        initialize() {
            console.log('[GVP Quick] initialize() called');
            if (this._initialized) {
                console.log('[GVP Quick] Already initialized, re-attaching listeners');
                this._attachFavoritesListener();
                this._ensureQuickControls();
                this._maybeResumePendingLaunch();
                this._installNavigationObserver();
                return;
            }
            this._initialized = true;
            console.log('[GVP Quick] Performing first-time initialization');
            document.addEventListener('gvp:quick-launch-mode-changed', this._modeChangeHandler);
            document.addEventListener('gvp:quick-launch-suppressed', this._suppressionHandler);
            this._attachFavoritesListener();
            this._ensureQuickControls();
            this._maybeResumePendingLaunch();
            this._installNavigationObserver();
        }

        _handleQuickModeChange() {
            this._attachFavoritesListener();
            if (!this._getActiveMode()) {
                if (this._debugQuickLaunch) {
                    console.debug('[GVP Quick] Mode switched off → clearing pending payload');
                }
                this._clearPendingPayload();
            }
            this._ensureQuickControls();
            this._syncQuickButtons();
            if (this._debugQuickLaunch) {
                console.debug('[GVP Quick] Mode change handled; current mode =', this._getActiveMode() ?? 'off');
            }
        }

        _installNavigationObserver() {
            if (this._navObserverInstalled) {
                return;
            }

            const notify = (trigger = 'unknown') => {
                if (this._debugQuickLaunch) {
                    console.debug('[GVP Quick] Navigation observer notified via', trigger, '→', window.location.pathname);
                }
                this._attachFavoritesListener();
                window.requestAnimationFrame(() => this._maybeResumePendingLaunch());
            };

            try {
                const originalPushState = window.history.pushState;
                window.history.pushState = function pushStateWrapper(...args) {
                    const result = originalPushState.apply(this, args);
                    notify('pushState');
                    return result;
                };

                const originalReplaceState = window.history.replaceState;
                window.history.replaceState = function replaceStateWrapper(...args) {
                    const result = originalReplaceState.apply(this, args);
                    notify('replaceState');
                    return result;
                };

                window.addEventListener('popstate', () => notify('popstate'), true);
                this._navObserverInstalled = true;
                console.log('[GVP Quick] Navigation observer installed');
            } catch (error) {
                console.error('[GVP Quick] Failed to install navigation observer:', error);
            }
            this._startNavigationMonitor();
        }

        _startNavigationMonitor() {
            if (this._navMonitorTimer) {
                return;
            }

            let lastPath = window.location.pathname;
            this._navMonitorTimer = window.setInterval(() => {
                const currentPath = window.location.pathname;
                if (currentPath !== lastPath) {
                    lastPath = currentPath;
                    if (this._debugQuickLaunch) {
                        console.debug('[GVP Quick] Navigation monitor detected new path', currentPath);
                    }
                    this._attachFavoritesListener();
                    window.requestAnimationFrame(() => this._maybeResumePendingLaunch());
                }
            }, 150);

            if (this._debugQuickLaunch) {
                console.debug('[GVP Quick] Navigation monitor started (150ms interval)');
            }
        }

        _stopNavigationMonitor() {
            if (this._navMonitorTimer) {
                window.clearInterval(this._navMonitorTimer);
                this._navMonitorTimer = null;
                if (this._debugQuickLaunch) {
                    console.debug('[GVP Quick] Navigation monitor stopped');
                }
            }
        }

        _scheduleNavigationFallback(favoriteTarget) {
            if (!favoriteTarget) {
                return;
            }

            const startHref = window.location.href;
            if (this._debugQuickLaunch) {
                console.debug('[GVP Quick] Scheduling navigation fallback', {
                    from: startHref,
                    favoriteHref: favoriteTarget.href,
                    favoritePath: favoriteTarget.path
                });
            }
            window.setTimeout(() => {
                if (window.location.href !== startHref) {
                    if (this._debugQuickLaunch) {
                        console.debug('[GVP Quick] Navigation fallback skipped; page already navigated', {
                            from: startHref,
                            to: window.location.href
                        });
                    }
                    window.requestAnimationFrame(() => this._maybeResumePendingLaunch());
                    return;
                }

                if (this._debugQuickLaunch) {
                    console.debug('[GVP Quick] Navigation fallback engaged — forcing route to favorite target', {
                        href: favoriteTarget.href,
                        path: favoriteTarget.path
                    });
                }
                const navigated = this._navigateToFavoriteTarget(favoriteTarget);
                if (!navigated && this._debugQuickLaunch) {
                    console.warn('[GVP Quick] Unable to auto-navigate to favorite target; manual action may be required', favoriteTarget);
                }
            }, 80);
        }

        _navigateToFavoriteTarget(favoriteTarget) {
            const attempt = (value) => {
                if (!value) {
                    return false;
                }
                try {
                    const url = value.includes('://')
                        ? value
                        : new URL(value, window.location.origin).href;
                    if (window.location.href === url) {
                        if (this._debugQuickLaunch) {
                            console.debug('[GVP Quick] Navigation fallback found target already active', url);
                        }
                        return true;
                    }
                    window.location.assign(url);
                    if (this._debugQuickLaunch) {
                        console.debug('[GVP Quick] Navigation fallback navigating to', url);
                    }
                    return true;
                } catch (_) {
                    return false;
                }
            };

            if (attempt(favoriteTarget.href)) {
                return true;
            }
            if (attempt(favoriteTarget.path)) {
                return true;
            }

            if (favoriteTarget.element && typeof favoriteTarget.element.closest === 'function') {
                const anchor = favoriteTarget.element.closest('a[href], button[data-navigation-target], button[data-href]');
                if (anchor) {
                    if (attempt(anchor.getAttribute('href') || anchor.getAttribute('data-href') || anchor.getAttribute('data-navigation-target'))) {
                        return true;
                    }
                }
            }

            return false;
        }

        _isFavoritesPage() {
            try {
                return window.location.pathname.startsWith('/imagine/favorites');
            } catch (error) {
                console.error('[GVP Quick] Failed to determine favorites page:', error);
                return false;
            }
        }

        _attachFavoritesListener() {
            if (!this._isFavoritesPage()) {
                if (this._favoritesListenerAttached) {
                    document.removeEventListener('click', this._favoritesClickHandler, true);
                    this._favoritesListenerAttached = false;
                    if (this._debugQuickLaunch) {
                        console.debug('[GVP Quick] Favorites listener removed (left favorites page)');
                    }
                }
                return;
            }
            if (!this._favoritesListenerAttached) {
                document.addEventListener('click', this._favoritesClickHandler, true);
                this._favoritesListenerAttached = true;
                console.log('[GVP Quick] Favorites listener attached for gallery automation');
            }
        }

    _handleFavoritesClick(event) {
        if (!event || event.defaultPrevented) {
            return;
            }
            if (event.button !== 0) {
                return;
            }
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                return;
            }

            const composedPath = typeof event.composedPath === 'function' ? event.composedPath() : null;

            const root = this.uiManager?.shadowRoot;
            if (root) {
                if (Array.isArray(composedPath) && composedPath.includes(root)) {
                    if (this._debugQuickLaunch) {
                        console.debug('[GVP Quick] Click ignored - originated inside GVP UI');
                    }
                    return;
                }
                if (root.contains(event.target)) {
                    if (this._debugQuickLaunch) {
                        console.debug('[GVP Quick] Click ignored - target within GVP UI');
                    }
                    return;
                }
            }

            if (!this._isFavoritesPage()) {
                if (this._debugQuickLaunch) {
                    console.debug('[GVP Quick] Click ignored - not on favorites gallery');
                }
                return;
            }

            if (Array.isArray(composedPath)) {
                const radixMenuHit = composedPath.some(node => {
                    if (!node || typeof node !== 'object') {
                        return false;
                    }
                    const id = node.id || '';
                    if (typeof id === 'string' && id.startsWith('radix-')) {
                        return true;
                    }
                    if (node.getAttribute && typeof node.getAttribute === 'function') {
                        const radixAttr = node.getAttribute('data-radix-popper-content')
                            || node.getAttribute('data-radix-menu');
                        if (radixAttr !== null) {
                            return true;
                        }
                    }
                    return false;
                });
                if (radixMenuHit) {
                    if (this._debugQuickLaunch) {
                        console.debug('[GVP Quick] Click ignored - inside Radix dropdown');
                    }
                    return;
                }
            }

            const makeVideoButton = event.target.closest('button[aria-label="Make video"], button[aria-label="Make a video"], button[data-testid*="make-video"], button[data-testid*="video-generator-submit"], div[data-testid*="quick-launch-overlay"] button');
            if (makeVideoButton) {
                if (this._debugQuickLaunch) {
                    console.debug('[GVP Quick] Click ignored - detected favorites overlay Make Video button');
                }
                return;
            }

        const favoriteTarget = this._resolveFavoriteTarget(event, composedPath);

        if (!favoriteTarget) {
            if (this._debugQuickLaunch) {
                console.debug('[GVP Quick] Click ignored - no favorite target detected', {
                    target: event.target,
                    path: typeof event.composedPath === 'function' ? event.composedPath() : 'no-path'
                });
            }
            return;
        }

        const mode = this._getActiveMode();
        if (!mode) {
            if (this._debugQuickLaunch) {
                console.debug('[GVP Quick] Click on favorite ignored because quick mode is off');
            }
            return;
        }

        if (this._isSuppressed()) {
            if (this._debugQuickLaunch) {
                console.debug('[GVP Quick] Click ignored - quick launch currently suppressed');
            }
            return;
        }

            if (this._isSuppressed()) {
                if (this._debugQuickLaunch) {
                    console.debug('[GVP Quick] Click ignored - quick launch currently suppressed');
                }
                return;
            }

            if (this._debugQuickLaunch) {
                console.debug('[GVP Quick] Favorite clicked → preparing payload for mode', mode, {
                    href: favoriteTarget.href,
                    path: favoriteTarget.path
                });
            }

            const prompt = this._buildPrompt(mode);

            if (this._debugQuickLaunch) {
                console.debug('[GVP Quick] Built prompt for mode', mode, 'length:', typeof prompt === 'string' ? prompt.length : 'n/a');
            }

            const state = this.stateManager?.getState?.();
            const targetHref = favoriteTarget.href;
            const target = targetHref ? new URL(targetHref, window.location.href) : null;
            const fallbackPath = favoriteTarget.path || null;
            const payload = {
                id: `quick-${Date.now()}`,
                mode,
                isRaw: mode === 'raw',
                prompt: typeof prompt === 'string' ? prompt : '',
                spicy: !!(state?.generation?.useSpicy),
                sourceUrl: window.location.href,
                targetPath: target?.pathname || fallbackPath,
                imageId: this._extractImageId(targetHref || fallbackPath),
                timestamp: Date.now()
            };

            try {
                window.sessionStorage.setItem(this.storageKey, JSON.stringify(payload));
                console.log('[GVP Quick] Queued quick-launch payload for', payload.imageId || payload.targetPath || '[unknown-target]');
            } catch (error) {
                console.error('[GVP Quick] Failed to persist quick-launch payload:', error);
            }

            if (this._debugQuickLaunch) {
                console.debug('[GVP Quick] Payload stored, scheduling navigation fallback', payload);
            }
            this._scheduleNavigationFallback(favoriteTarget);
            this._queueResumeProbes();
        }

        _resolveFavoriteTarget(event) {
            const log = (level, ...args) => {
                if (!this._debugQuickLaunch) {
                    return;
                }
                try {
                    console[level]('[GVP Quick] Target scan:', ...args);
                } catch (_) {
                    console.log('[GVP Quick] Target scan:', level, ...args);
                }
            };

            const candidateAttributes = ['href', 'data-href', 'data-navigation-target'];
            const idAttributes = [
                'data-id',
                'data-media-id',
                'data-media-post-id',
                'data-post-id',
                'data-asset-id',
                'data-item-id',
                'data-guid',
                'data-uuid'
            ];
            const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const embeddedUuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

            const ensurePostPath = (value) => {
                if (!value) {
                    return null;
                }
                const trimmed = `${value}`.trim();
                if (!trimmed) {
                    return null;
                }
                if (trimmed.includes('/imagine/post/')) {
                    const match = trimmed.match(/\/imagine\/post\/[0-9a-z\-]+/i);
                    if (match && !trimmed.startsWith('/imagine/post/')) {
                        return match[0];
                    }
                    return trimmed;
                }
                const match = trimmed.match(embeddedUuidPattern);
                if (match) {
                    return `/imagine/post/${match[0]}`;
                }
                return null;
            };

            const extractIdPath = (node) => {
                if (!node || typeof node.getAttribute !== 'function') {
                    return null;
                }

                for (const attr of idAttributes) {
                    const raw = node.getAttribute(attr);
                    const path = ensurePostPath(raw);
                    if (path) {
                        return path;
                    }
                }

                if (node.dataset) {
                    for (const [key, value] of Object.entries(node.dataset)) {
                        if (!value) {
                            continue;
                        }
                        const keyLower = key.toLowerCase();
                        if (keyLower.includes('id') || keyLower.includes('post') || keyLower.includes('media')) {
                            const path = ensurePostPath(value);
                            if (path) {
                                return path;
                            }
                        }
                    }
                }

                const elementId = node.getAttribute('id');
                if (elementId) {
                    const match = elementId.match(embeddedUuidPattern);
                    if (match) {
                        return `/imagine/post/${match[0]}`;
                    }
                }

                return null;
            };

            const extractUrlFromStyle = (styleValue = '') => {
                if (typeof styleValue !== 'string' || !styleValue) {
                    return null;
                }
                const match = styleValue.match(/url\((?:"|')?(.*?)(?:"|')?\)/i);
                return match ? match[1] : null;
            };

            const collectMediaCandidates = (node) => {
                if (!node) {
                    return [];
                }
                const values = new Set();

                const mediaAttributes = [
                    'src',
                    'data-src',
                    'data-source',
                    'data-url',
                    'data-image',
                    'data-preview',
                    'data-thumb',
                    'data-thumbnail',
                    'data-media',
                    'data-media-url',
                    'data-asset-url',
                    'data-asset',
                    'data-content-url',
                    'data-large-image',
                    'data-original'
                ];

                if (typeof node.getAttribute === 'function') {
                    for (const attr of mediaAttributes) {
                        const val = node.getAttribute(attr);
                        if (val) {
                            values.add(val);
                        }
                    }
                }

                if (typeof node.src === 'string' && node.src) {
                    values.add(node.src);
                }
                if (typeof node.currentSrc === 'string' && node.currentSrc) {
                    values.add(node.currentSrc);
                }
                if (typeof node.poster === 'string' && node.poster) {
                    values.add(node.poster);
                }

                if (node.dataset) {
                    for (const value of Object.values(node.dataset)) {
                        if (value) {
                            values.add(value);
                        }
                    }
                }

                try {
                    if (node.style && typeof node.style.backgroundImage === 'string' && node.style.backgroundImage) {
                        const bg = extractUrlFromStyle(node.style.backgroundImage);
                        if (bg) {
                            values.add(bg);
                        }
                    } else if (window.getComputedStyle) {
                        const computed = window.getComputedStyle(node);
                        const bg = extractUrlFromStyle(computed?.backgroundImage || '');
                        if (bg) {
                            values.add(bg);
                        }
                    }
                } catch (_) {
                    // Ignore style access errors (e.g., detached nodes)
                }

                return Array.from(values).filter(Boolean);
            };

            const getMediaPathFromNode = (node) => {
                const candidates = collectMediaCandidates(node);
                for (const candidate of candidates) {
                    const path = ensurePostPath(candidate);
                    if (path) {
                        return path;
                    }
                }
                return null;
            };

            const climbForIdPath = (node, maxDepth = 6) => {
                let current = node;
                let depth = 0;
                while (current && depth < maxDepth) {
                    const path = extractIdPath(current) || getMediaPathFromNode(current);
                    if (path) {
                        return path;
                    }
                    current = current.parentElement || current.host || null;
                    depth += 1;
                }
                return null;
            };

            const extractHref = (node) => {
                if (!node) {
                    return null;
                }
                if (node instanceof window.DocumentFragment) {
                    return null;
                }
                if (node && typeof node.matches === 'function') {
                    if (node.matches('button[data-navigation-target], button[data-href]')) {
                        const attrVal = node.getAttribute('data-navigation-target') || node.getAttribute('data-href');
                        if (attrVal && attrVal.includes('/imagine/post/')) {
                            return attrVal;
                        }
                    }
                }
                if (typeof node.getAttribute === 'function') {
                    for (const attr of candidateAttributes) {
                        const raw = node.getAttribute(attr);
                        if (raw && raw.includes('/imagine/post/')) {
                            return raw;
                        }
                    }
                }
                const dataset = node.dataset;
                if (dataset) {
                    const potentials = [dataset.href, dataset.navigationTarget, dataset.link];
                    for (const potential of potentials) {
                        if (potential && potential.includes('/imagine/post/')) {
                            return potential;
                        }
                    }
                }
                const navTarget = node?.ariaLabel || node?.getAttribute?.('aria-label') || '';
                if (navTarget && navTarget.includes('/imagine/post/')) {
                    return navTarget;
                }
                return null;
            };

            const getPath = (node) => {
                if (!node) {
                    return null;
                }
                const hrefPath = ensurePostPath(extractHref(node));
                if (hrefPath) {
                    return hrefPath;
                }
                const localIdPath = extractIdPath(node);
                if (localIdPath) {
                    return localIdPath;
                }
                const mediaPath = getMediaPathFromNode(node);
                if (mediaPath) {
                    return mediaPath;
                }
                return climbForIdPath(node);
            };

            const buildResult = (node, from) => {
                const href = extractHref(node);
                const path = getPath(node);
                if (href || path) {
                    log('debug', `resolved via ${from}`, { node, href, path });
                    return {
                        element: node,
                        href,
                        path
                    };
                }
                if (node && node.matches?.('button[aria-label], button[aria-labelledby], button[data-testid]')) {
                    const ariaLabel = node.getAttribute('aria-label') || '';
                    const labelledBy = node.getAttribute('aria-labelledby') || '';
                    const dataTestId = node.getAttribute('data-testid') || '';
                    const combined = `${ariaLabel} ${labelledBy} ${dataTestId}`.toLowerCase();
                    if (combined.includes('make video')) {
                        const fallbackPath = climbForIdPath(node, 8);
                        if (fallbackPath) {
                            log('debug', `button fallback (${from})`, { node, fallbackPath });
                            return {
                                element: node,
                                href: null,
                                path: fallbackPath
                            };
                        }
                    }
                }
                return null;
            };

            const direct = buildResult(event.target, 'event.target');
            if (direct) {
                return direct;
            }

            if (typeof event.target?.closest === 'function') {
                const closestSelector = [
                    'a[href*="/imagine/post/"]',
                    '[data-href*="/imagine/post/"]',
                    '[data-navigation-target*="/imagine/post/"]',
                    'button[data-navigation-target*="/imagine/post/"]',
                    'button[data-href*="/imagine/post/"]',
                    'button[aria-label*="make video" i]',
                    'button[data-testid*="make-video" i]',
                    'div[data-id]',
                    'div[data-media-id]',
                    'div[data-media-post-id]',
                    'div[data-post-id]'
                ].join(', ');

                const closest = event.target.closest(closestSelector);
                if (closest) {
                    const resolved = buildResult(closest, 'closest');
                    if (resolved) {
                        return resolved;
                    }
                }
            }

            if (typeof event.composedPath === 'function') {
                const path = event.composedPath();
                for (const node of path) {
                    const resolved = buildResult(node, 'composedPath');
                    if (resolved) {
                        return resolved;
                    }
                }
            }

            if (event.target && typeof event.target.querySelector === 'function') {
                const nested = event.target.querySelector('a[href*="/imagine/post/"]');
                if (nested) {
                    const resolved = buildResult(nested, 'nested');
                    if (resolved) {
                        return resolved;
                    }
                }
            }

            if (this._debugQuickLaunch && typeof event.composedPath === 'function') {
                const summary = event.composedPath()
                    .map((node) => {
                        if (!node) {
                            return '[null]';
                        }
                        if (node === window) {
                            return '[window]';
                        }
                        if (node === document) {
                            return '[document]';
                        }
                        const tag = node.tagName ? node.tagName.toLowerCase() : (node.nodeName || '[unknown]').toLowerCase();
                        const id = node.id ? `#${node.id}` : '';
                        const classList = node.classList ? `.${Array.from(node.classList).join('.')}` : '';
                        const attrs = [];
                        if (typeof node.getAttribute === 'function') {
                            ['data-id', 'data-media-id', 'data-post-id', 'aria-label', 'href'].forEach((attr) => {
                                const val = node.getAttribute(attr);
                                if (val) {
                                    attrs.push(`${attr}=${val}`);
                                }
                            });
                        }
                        return `${tag}${id}${classList}${attrs.length ? ` (${attrs.join(', ')})` : ''}`;
                    })
                    .slice(0, 14);
                log('warn', 'composedPath summary', summary);
            }

            log('warn', 'unable to resolve favorite target', { target: event.target });
            return null;
        }

        _getActiveMode() {
            try {
                const state = this.stateManager?.getState();
                const mode = state?.ui?.quickLaunchMode;
                return mode === 'json' || mode === 'raw' ? mode : null;
            } catch (error) {
                console.error('[GVP Quick] Unable to read quick-launch mode:', error);
                return null;
            }
        }

        _isSuppressed() {
            try {
                const state = this.stateManager?.getState();
                return !!state?.ui?.quickLaunchSuppressed;
            } catch (error) {
                return false;
            }
        }

        _buildPrompt(mode) {
            if (!this.uiManager) {
                return null;
            }
            try {
                if (this._debugQuickLaunch) {
                    console.debug('[GVP Quick] Building prompt for mode', mode);
                }
                if (mode === 'json' && this.uiManager.uiFormManager?.buildJsonPrompt) {
                    const prompt = this.uiManager.uiFormManager.buildJsonPrompt();
                    return typeof prompt === 'string' ? prompt : '';
                }
                if (mode === 'raw' && this.uiManager.uiRawInputManager?.buildRawPrompt) {
                    const prompt = this.uiManager.uiRawInputManager.buildRawPrompt();
                    return typeof prompt === 'string' ? prompt : '';
                }
            } catch (error) {
                console.error('[GVP Quick] Prompt builder failed:', error);
            }
            return null;
        }

        _extractImageId(pathnameOrHref) {
            if (!pathnameOrHref) {
                return null;
            }
            try {
                const path = pathnameOrHref.includes('://')
                    ? new URL(pathnameOrHref, window.location.href).pathname
                    : pathnameOrHref;
                const parts = path.split('/').filter(Boolean);
                return parts.length ? parts[parts.length - 1] : null;
            } catch (error) {
                return null;
            }
        }

        _maybeResumePendingLaunch() {
            let rawPayload = null;
            try {
                rawPayload = window.sessionStorage.getItem(this.storageKey);
            } catch (error) {
                console.error('[GVP Quick] Unable to access sessionStorage:', error);
                return;
            }

            if (!rawPayload) {
                if (this._debugQuickLaunch) {
                    console.debug('[GVP Quick] Resume check: no pending payload found');
                }
                return;
            }

            let payload;
            try {
                payload = JSON.parse(rawPayload);
                if (this._debugQuickLaunch) {
                    console.debug('[GVP Quick] Pending payload restored', payload);
                }
            } catch (error) {
                console.error('[GVP Quick] Stored quick-launch payload is malformed:', error);
                this._clearPendingPayload();
                return;
            }

            if (this._isSuppressed()) {
                console.log('[GVP Quick] Pending payload discarded due to suppression');
                this._clearPendingPayload('suppressed');
                return;
            }

            if (!payload || typeof payload.prompt !== 'string') {
                if (this._debugQuickLaunch) {
                    console.debug('[GVP Quick] Resume check: payload missing prompt', payload);
                }
                this._clearPendingPayload();
                return;
            }

            if (typeof payload.timestamp === 'number' && Date.now() - payload.timestamp > 120000) {
                console.warn('[GVP Quick] Discarding stale quick-launch payload');
                this._clearPendingPayload();
                return;
            }

            const currentPath = window.location.pathname;
            const matchesPath = !payload.targetPath
                || currentPath === payload.targetPath
                || currentPath.startsWith(payload.targetPath);
            const matchesImage = payload.imageId && currentPath.includes(payload.imageId);
            const isImagePage = currentPath.startsWith('/imagine/post/');
            const shouldForceResume = isImagePage && !matchesPath && !matchesImage;

            if (this._debugQuickLaunch) {
                console.debug('[GVP Quick] Resume check payload', {
                    currentPath,
                    targetPath: payload.targetPath,
                    imageId: payload.imageId,
                    matchesPath,
                    matchesImage,
                    isImagePage,
                    shouldForceResume
                });
            }

            if (!matchesPath && !matchesImage && !shouldForceResume) {
                if (this._debugQuickLaunch) {
                    console.debug('[GVP Quick] Resume check: navigation not yet at target path', {
                        currentPath,
                        targetPath: payload.targetPath,
                        imageId: payload.imageId
                    });
                }
                return;
            }

            if (shouldForceResume) {
                if (this._debugQuickLaunch) {
                    console.debug('[GVP Quick] Forcing resume on active image page despite payload mismatch');
                }
                payload.targetPath = currentPath;
                payload.imageId = this._extractImageId(currentPath) || payload.imageId || null;
                try {
                    window.sessionStorage.setItem(this.storageKey, JSON.stringify(payload));
                } catch (persistError) {
                    console.warn('[GVP Quick] Unable to update payload targetPath during forced resume:', persistError);
                }
            }

            if (this._debugQuickLaunch) {
                console.debug('[GVP Quick] Target image detected - beginning prompt automation', {
                    currentPath,
                    payloadId: payload.id,
                    mode: payload.mode,
                    promptLength: typeof payload.prompt === 'string' ? payload.prompt.length : 'n/a'
                });
            }
            console.log('[GVP Quick] Resuming queued quick-launch payload for path', currentPath);
            this._processPendingPayload(payload);
        }

        async _processPendingPayload(payload) {
            if (this._isProcessing) {
                console.debug('[GVP Quick] Ignoring payload resume; already processing another payload');
                return;
            }
            this._clearResumeProbes();
            if (this._isSuppressed()) {
                console.log('[GVP Quick] Payload processing skipped due to suppression');
                this._clearPendingPayload('suppressed');
                return;
            }
            this._isProcessing = true;
            try {
                const normalizedPrompt = typeof payload.prompt === 'string' ? payload.prompt : '';

                console.log('[GVP Quick] Processing payload', {
                    id: payload.id,
                    mode: payload.mode,
                    isRaw: payload.isRaw,
                    spicy: payload.spicy,
                    promptLength: normalizedPrompt.length,
                    imageId: payload.imageId,
                    sourceUrl: payload.sourceUrl
                });

                if (typeof payload.spicy === 'boolean' && this.uiManager?.setSpicyMode) {
                    console.debug('[GVP Quick] Syncing spicy mode to', payload.spicy);
                    this.uiManager.setSpicyMode(payload.spicy);
                }

                if (this.uiManager?.stateManager?.setLastPrompt) {
                    try {
                        this.uiManager.stateManager.setLastPrompt(normalizedPrompt);
                        console.debug('[GVP Quick] Recorded last prompt for resume');
                    } catch (promptError) {
                        console.warn('[GVP Quick] Unable to record last prompt:', promptError);
                    }
                }

                let sendPromise = null;

                console.debug('[GVP Quick] Building send plan', {
                    hasJsonHandler: !!this.uiManager?.uiFormManager?.handleGenerateJson,
                    hasRawHandler: !!this.uiManager?.uiRawInputManager?.handleGenerateRaw,
                    hasAutomation: !!this.reactAutomation,
                    mode: payload.mode,
                    promptLength: normalizedPrompt.length
                });

                if (!payload.isRaw && this.uiManager?.uiFormManager?.handleGenerateJson) {
                    console.debug('[GVP Quick] Delegating to handleGenerateJson (allowEmpty=true)');
                    sendPromise = this.uiManager.uiFormManager.handleGenerateJson({
                        allowEmpty: true,
                        promptOverride: normalizedPrompt,
                        source: 'quick'
                    });
                } else if (payload.isRaw && this.uiManager?.uiRawInputManager?.handleGenerateRaw) {
                    console.debug('[GVP Quick] Delegating to handleGenerateRaw (allowEmpty=true)');
                    sendPromise = this.uiManager.uiRawInputManager.handleGenerateRaw({
                        allowEmpty: true,
                        promptOverride: normalizedPrompt,
                        source: 'quick'
                    });
                }

                if (!sendPromise && this.reactAutomation) {
                    console.debug('[GVP Quick] Falling back to direct ReactAutomation send');
                    sendPromise = this.reactAutomation.sendToGenerator(normalizedPrompt, !!payload.isRaw);
                }

                if (!sendPromise) {
                    throw new Error('No automation path available for quick-launch submission');
                }

                console.debug('[GVP Quick] Awaiting send promise resolution');
                await sendPromise;

                console.debug('[GVP Quick] Submission promise resolved');

                if (payload.imageId && this.stateManager?.updateGeneration) {
                    try {
                        const state = this.stateManager.getState?.();
                        const currentGen = state?.generation?.currentGenerationId;
                        if (currentGen) {
                            this.stateManager.updateGeneration(currentGen, { imageId: payload.imageId });
                        }
                        if (this.uiManager) {
                            this.uiManager._lastResolvedImageId = payload.imageId;
                        }
                    } catch (updateError) {
                        console.warn('[GVP Quick] Unable to record imageId for generation:', updateError);
                    }
                }

                console.log('[GVP Quick] Quick-launch prompt submitted');
                this._clearPendingPayload();
                console.debug('[GVP Quick] Scheduling navigation back to favorites');
                setTimeout(() => this._returnToFavorites(payload), 120);
            } catch (error) {
                console.error('[GVP Quick] Failed to process quick-launch payload:', error);
                this._clearPendingPayload();
            } finally {
                console.debug('[GVP Quick] Resetting processing state');
                this._isProcessing = false;
            }
        }

        _computeFavoritesHref(payload) {
            if (payload?.sourceUrl) {
                console.debug('[GVP Quick] Returning to source URL', payload.sourceUrl);
                return payload.sourceUrl;
            }
            if (payload?.targetPath) {
                try {
                    console.debug('[GVP Quick] Reconstructing URL from targetPath', payload.targetPath);
                    return new URL(payload.targetPath, window.location.origin).href;
                } catch (_) {
                    return `${window.location.origin}/imagine/favorites`;
                }
            }
            return `${window.location.origin}/imagine/favorites`;
        }

        _returnToFavorites(payload) {
            const href = this._computeFavoritesHref(payload);
            if (!href) {
                console.warn('[GVP Quick] No favorites URL computed; skipping navigation');
                return;
            }

            try {
                const targetUrl = new URL(href, window.location.origin);
                if (window.location.href === targetUrl.href) {
                    if (this._debugQuickLaunch) {
                        console.debug('[GVP Quick] Already on favorites; no navigation needed');
                    }
                    return;
                }

                if (this._debugQuickLaunch) {
                    console.debug('[GVP Quick] Returning to favorites', targetUrl.href);
                }

                window.history.replaceState(null, '', targetUrl.href);
                window.dispatchEvent(new PopStateEvent('popstate'));

                setTimeout(() => {
                    if (window.location.href !== targetUrl.href) {
                        console.debug('[GVP Quick] Popstate did not navigate, forcing location.assign');
                        try {
                            window.location.assign(targetUrl.href);
                        } catch (navError) {
                            console.error('[GVP Quick] Fallback navigation to favorites failed:', navError);
                        }
                    }
                }, 150);
            } catch (error) {
                console.error('[GVP Quick] Failed to compute favorites navigation target:', error);
                try {
                    window.location.assign('/imagine/favorites');
                } catch (fallbackError) {
                    console.error('[GVP Quick] Secondary fallback navigation failed:', fallbackError);
                }
            }
        }

        _ensureQuickControls(attempt = 0) {
            const MAX_ATTEMPTS = 20;
            if (!this.uiManager || !this.uiManager.shadowRoot) {
                if (attempt < MAX_ATTEMPTS) {
                    setTimeout(() => this._ensureQuickControls(attempt + 1), 200);
                }
                return;
            }

            const root = this.uiManager.shadowRoot;
            const bottomBar = root.querySelector('#gvp-bottom-bar');
            if (!bottomBar) {
                if (attempt < MAX_ATTEMPTS) {
                    setTimeout(() => this._ensureQuickControls(attempt + 1), 200);
                }
                return;
            }

            const topRow = bottomBar.querySelector('.gvp-bottom-row.top');
            if (!topRow) {
                if (attempt < MAX_ATTEMPTS) {
                    setTimeout(() => this._ensureQuickControls(attempt + 1), 200);
                }
                return;
            }

            let jsonBtn = topRow.querySelector('.gvp-quick-json-btn');
            let rawBtn = topRow.querySelector('.gvp-quick-raw-btn');
            const viewBtn = topRow.querySelector('.gvp-button:not(.gvp-quick-toggle)');

            if (!jsonBtn) {
                jsonBtn = this._createQuickButton('json', '⏩ Quick JSON');
                if (jsonBtn) {
                    topRow.insertBefore(jsonBtn, viewBtn || topRow.firstChild);
                }
            }

            if (!rawBtn) {
                rawBtn = this._createQuickButton('raw', '⏩ Quick Raw');
                if (rawBtn) {
                    if (viewBtn && viewBtn.nextSibling) {
                        topRow.insertBefore(rawBtn, viewBtn.nextSibling);
                    } else {
                        topRow.appendChild(rawBtn);
                    }
                }
            }

            this._syncQuickButtons();
        }

        _createQuickButton(mode, label) {
            if (!this.uiManager || !this.uiManager.shadowRoot) {
                return null;
            }

            const button = this.uiManager.shadowRoot.ownerDocument.createElement('button');
            button.type = 'button';
            button.className = `gvp-button gvp-quick-toggle gvp-quick-${mode}-btn`;
            button.innerHTML = label;
            button.dataset.quickMode = mode;
            button.addEventListener('click', () => {
                const currentMode = this._getActiveMode();
                const nextMode = currentMode === mode ? null : mode;
                if (typeof this.uiManager?.setQuickLaunchMode === 'function') {
                    this.uiManager.setQuickLaunchMode(nextMode);
                }
                this._syncQuickButtons();
            });
            return button;
        }

        _syncQuickButtons() {
            if (!this.uiManager || !this.uiManager.shadowRoot) {
                return;
            }

            const mode = this._getActiveMode();
            const root = this.uiManager.shadowRoot;
            const jsonBtn = root.querySelector('.gvp-quick-json-btn');
            const rawBtn = root.querySelector('.gvp-quick-raw-btn');

            if (jsonBtn) {
                const isJson = mode === 'json';
                jsonBtn.classList.toggle('active', isJson);
                jsonBtn.setAttribute('aria-pressed', isJson ? 'true' : 'false');
            }

            if (rawBtn) {
                const isRaw = mode === 'raw';
                rawBtn.classList.toggle('active', isRaw);
                rawBtn.setAttribute('aria-pressed', isRaw ? 'true' : 'false');
            }
        }

        _clearPendingPayload(reason) {
            if (this._debugQuickLaunch && reason) {
                console.debug('[GVP Quick] Clearing pending payload', reason);
            }
            try {
                window.sessionStorage.removeItem(this.storageKey);
            } catch (error) {
                console.error('[GVP Quick] Unable to clear quick-launch payload:', error);
            }
            this._clearResumeProbes();
        }

        _queueResumeProbes() {
            if (this._isSuppressed()) {
                if (this._debugQuickLaunch) {
                    console.debug('[GVP Quick] Suppressed - skipping resume probes');
                }
                return;
            }
            this._clearResumeProbes();
            const delays = [120, 280, 480, 800, 1500];
            if (this._debugQuickLaunch) {
                console.debug('[GVP Quick] Queueing resume probes', delays);
            }
            delays.forEach((delay, index) => {
                const timerId = window.setTimeout(() => {
                    if (this._debugQuickLaunch) {
                        console.debug(`[GVP Quick] Resume probe #${index + 1} at ${delay}ms`);
                    }
                    this._maybeResumePendingLaunch();
                }, delay);
                this._resumeTimers.push(timerId);
            });
        }

        _clearResumeProbes() {
            if (!Array.isArray(this._resumeTimers) || !this._resumeTimers.length) {
                return;
            }
            this._resumeTimers.forEach(timerId => window.clearTimeout(timerId));
            this._resumeTimers = [];
        }
    }
    // Main application class
    class GrokVideoPrompterApp {
        constructor() {
            // Guard against legacy bridge instances that might still be present
            if (window.gvpBridge) {
                console.log('[GVP] Legacy bridge found, disabling...');
                window.gvpBridge = null;
            }
            
            // Restore clean fetch
            if (window.fetch && window.fetch.toString().includes('[original]')) {
                delete window.fetch;
                console.log('[GVP] Restored native fetch');
            }

            this.stateManager = window.StateManager ? new window.StateManager() : null;
            if (window.UploadAutomationManager) {
                try {
                    this.uploadAutomationManager = new window.UploadAutomationManager(this.stateManager);
                    console.log('[GVP] ✅ UploadAutomationManager initialized');
                } catch (error) {
                    console.error('[GVP] UploadAutomationManager failed to initialize:', error);
                    this.uploadAutomationManager = null;
                }
            } else {
                this.uploadAutomationManager = null;
                console.warn('[GVP] UploadAutomationManager unavailable on window');
            }
            this.reactAutomation = window.ReactAutomation ? new window.ReactAutomation(this.stateManager) : null;
            this.networkInterceptor = window.NetworkInterceptor
                ? new window.NetworkInterceptor(this.stateManager, this.reactAutomation, this.uploadAutomationManager)
                : null;
            this.advancedRawInputManager = window.AdvancedRawInputManager ? new window.AdvancedRawInputManager(this.stateManager) : null;
            this.rawInputManager = window.RawInputManager ? new window.RawInputManager(this.stateManager) : null;
            const multiVideoEnabled = window.__GVP_ENABLE_MULTI_VIDEO__ === true;
            this._multiVideoEnabled = multiVideoEnabled;
            this.multiVideoManager = (multiVideoEnabled && window.MultiVideoManager)
                ? new window.MultiVideoManager(this.stateManager, this.reactAutomation)
                : null;
            if (!this.multiVideoManager) {
                console.log('[GVP] Multi-video manager disabled (feature flag)');
            }
            this.imageProjectManager = window.ImageProjectManager ? new window.ImageProjectManager(this.stateManager) : null;
            this.progressMonitor = window.UIProgressMonitor ? new window.UIProgressMonitor(this.stateManager, null) : null;
            this.progressAPI = window.UIProgressAPI ? new window.UIProgressAPI(this.stateManager, null) : null;
            this.quickLaunchManager = null;
            this._lastSpicyStateSent = null;
            this._bridgeListener = null;
            this._bridgeListenerInstalled = false;

            // Explicit manager boot order with logging
            console.log('[GVP] Manager boot sequence started...');
            window.gvpStorageManager = window.StorageManager ? new window.StorageManager() : null;
            if (window.gvpStorageManager) {
                console.log('[GVP] ✅ StorageManager initialized');
            }
            
            if (this.stateManager) {
                console.log('[GVP] ✅ StateManager initialized');
            }

            window.gvpAppInstance = this;
            this._installBridgeListener();
            window.gvpStateManager = this.stateManager;
            window.gvpUIGenerationsManager = null; // Will be set when UI initializes
            if (this.uploadAutomationManager) {
                window.gvpUploadAutomationManager = this.uploadAutomationManager;
            }

            // Initialize UIManager with all dependencies
            if (window.UIManager) {
                this.uiManager = new window.UIManager(
                    this.stateManager, 
                    this.reactAutomation, 
                    this.advancedRawInputManager
                );
                this.uiManager.multiVideoManager = this.multiVideoManager;
                this.uiManager.imageProjectManager = this.imageProjectManager;
                this.uiManager.networkInterceptor = this.networkInterceptor;
                this.uiManager.uploadAutomationManager = this.uploadAutomationManager;
                
                // Set UIManager reference back to UploadAutomationManager for checkbox access
                if (this.uploadAutomationManager) {
                    this.uploadAutomationManager.uiManager = this.uiManager;
                }

                // Expose globally
                window.gvpUIManager = this.uiManager;
            }
            
            if (this.imageProjectManager) {
                window.gvpImageProjectManager = this.imageProjectManager;
            }
        }

        async initialize() {
            try {
                console.log('[GVP] Initializing application...');
                
                // Initialize state manager
                if (this.stateManager && typeof this.stateManager.initialize === 'function') {
                    await this.stateManager.initialize();
                    console.log('[GVP] StateManager initialized');
                }
                
                // ENHANCED: Initialize persistent storage
                if (this.stateManager && typeof this.stateManager.initializeStorage === 'function') {
                    await this.stateManager.initializeStorage();
                    console.log(`[GVP] Grok Video Prompter loaded (v${APP_VERSION})`);
                }

                // Load recent prompts
                if (this.advancedRawInputManager) {
                    this.advancedRawInputManager.loadRecentPrompts();
                    this.advancedRawInputManager.startAutoSave();
                }
                if (this.rawInputManager) {
                    this.rawInputManager.loadRecentPrompts();
                }

                // Initialize UI managers (generation tracker disabled during merge)
                window.gvpUIGenerationsManager = null;
                console.log('[GVP] UIGenerationsManager disabled while merged history tab is rebuilt.');

                // Create UI
                if (this.uiManager && typeof this.uiManager.createUI === 'function') {
                    this.uiManager.createUI();
                    if (typeof this.uiManager.openDrawer === 'function') {
                        this.uiManager.openDrawer();
                    }
                    console.log('[GVP] UI created successfully');
                    
                }

                if (!this.quickLaunchManager && this.reactAutomation) {
                    this.quickLaunchManager = new QuickLaunchManager(this.stateManager, this.uiManager, this.reactAutomation);
                    window.gvpQuickLaunchManager = this.quickLaunchManager;
                } else if (this.quickLaunchManager) {
                    this.quickLaunchManager.setUIManager(this.uiManager);
                }

                this._injectPageInterceptor();
                this._broadcastSpicyState('post-injection', true);
                this.broadcastAuroraState();

                // Setup toolbar icon listener
                this._setupToolbarIconListener();

                // Start network interceptor
                if (this.networkInterceptor && typeof this.networkInterceptor.start === 'function') {
                    this.networkInterceptor.start();
                    console.log('[GVP] Network interceptor started');
                }

                // Initialize React automation
                if (this.reactAutomation && typeof this.reactAutomation.init === 'function') {
                    this.reactAutomation.init();
                    console.log('[GVP] React automation initialized');
                }

                // Start monitoring multi-video generations
                if (this.multiVideoManager && typeof this.multiVideoManager.monitorActiveGenerations === 'function') {
                    this.multiVideoManager.monitorActiveGenerations();
                    console.log('[GVP] Generation monitoring started');
                } else {
                    console.log('[GVP] Generation monitoring skipped (multi-video disabled)');
                }

                // Load image projects
                if (this.imageProjectManager && typeof this.imageProjectManager.initialize === 'function') {
                    this.imageProjectManager.initialize();
                    console.log('[GVP] Image project manager initialized');
                }

                // Start DOM progress monitoring
                if (this.progressMonitor && typeof this.progressMonitor.startMonitoring === 'function') {
                    // Set UIManager reference if available
                    if (this.uiManager && typeof this.progressMonitor.setUIManager === 'function') {
                        this.progressMonitor.setUIManager(this.uiManager);
                    }
                    this.progressMonitor.startMonitoring();
                    console.log('[GVP] DOM progress monitoring started');
                    window.gvpProgressMonitor = this.progressMonitor;
                }

                // Start API progress monitoring
                if (this.progressAPI && typeof this.progressAPI.startMonitoring === 'function') {
                    // Set UIManager reference if available
                    if (this.uiManager && typeof this.progressAPI.setUIManager === 'function') {
                        this.progressAPI.setUIManager(this.uiManager);
                    }
                    this.progressAPI.startMonitoring();
                    console.log('[GVP] API progress monitoring started');
                    window.gvpProgressAPI = this.progressAPI;
                    window.gvpUIProgressAPI = this.progressAPI;
                }

                if (this.quickLaunchManager) {
                    this.quickLaunchManager.initialize();
                }

                // Listen for Aurora state changes
                window.addEventListener('gvp:aurora-mode-changed', () => {
                    console.log('[GVP] Aurora mode changed, broadcasting to page');
                    this.broadcastAuroraState();
                });

                console.log('[GVP] ✅ Application initialized successfully (v1.15.40)');
                this._broadcastSpicyState('post-initialize', true);
                this.broadcastAuroraState();
            } catch (error) {
                console.error('[GVP] Initialization failed:', error);
                console.error('[GVP] Stack trace:', error.stack);
            }
        }

        _setupToolbarIconListener() {
            try {
                chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
                    if (!this.uiManager) {
                        sendResponse?.({ success: false, error: 'UIManager not available' });
                        return;
                    }

                    if (request.action === 'openGVPUI') {
                        if (typeof this.uiManager.openDrawer === 'function') {
                            this.uiManager.openDrawer();
                            sendResponse?.({ success: true, status: 'UI opened' });
                        } else {
                            sendResponse?.({ success: false, error: 'openDrawer not available' });
                        }
                    } else if (request.action === 'toggleDrawer') {
                        if (typeof this.uiManager.toggleDrawer === 'function') {
                            this.uiManager.toggleDrawer();
                            sendResponse?.({ success: true, status: 'UI toggled' });
                        } else {
                            sendResponse?.({ success: false, error: 'toggleDrawer not available' });
                        }
                    }
                });
                console.log('[GVP] Toolbar icon listener setup complete');
            } catch (error) {
                console.error('[GVP] Failed to setup toolbar icon listener:', error);
            }
        }

        _injectPageInterceptor() {
            try {
                const existing = document.querySelector('script[data-gvp-fetch-interceptor]');
                if (existing) {
                    const existingVersion = existing.dataset.gvpFetchInterceptorVersion || 'unknown';
                    if (existingVersion === APP_VERSION) {
                        console.log('[GVP] Page fetch interceptor already present (up-to-date)');
                        return;
                    }
                    console.log('[GVP] Replacing outdated fetch interceptor', { existingVersion, targetVersion: APP_VERSION });
                    existing.remove();
                }

                const scriptUrl = chrome.runtime.getURL('public/injected/gvpFetchInterceptor.js');
                if (!scriptUrl) {
                    console.warn('[GVP] Unable to resolve fetch interceptor URL');
                    return;
                }

                const scriptEl = document.createElement('script');
                scriptEl.src = scriptUrl;
                scriptEl.async = false;
                scriptEl.type = 'text/javascript';
                scriptEl.dataset.gvpFetchInterceptor = 'true';
                scriptEl.dataset.gvpFetchInterceptorVersion = APP_VERSION;

                scriptEl.onload = () => {
                    console.log('[GVP] Page fetch interceptor injected successfully');
                    scriptEl.remove();
                };
                scriptEl.onerror = (event) => {
                    console.error('[GVP] Page fetch interceptor failed to load:', event?.message || event);
                    scriptEl.remove();
                };

                const parent = document.documentElement || document.head;
                if (!parent) {
                    console.warn('[GVP] Unable to inject fetch interceptor - no document root');
                    return;
                }
                parent.appendChild(scriptEl);
            } catch (error) {
                console.error('[GVP] Failed to inject page interceptor:', error);
            }
        }

        _installBridgeListener() {
            if (this._bridgeListenerInstalled) {
                return;
            }

            try {
                const handler = (event) => {
                    if (!event || event.source !== window || !event.data) {
                        return;
                    }

                    const { source, type, payload } = event.data;
                    if (source !== 'gvp-fetch-interceptor' || !type) {
                        return;
                    }

                    switch (type) {
                        case 'GVP_FETCH_READY':
                            console.log('[GVP] Page fetch interceptor reported ready');
                            if (this.networkInterceptor && typeof this.networkInterceptor.setPageInterceptorActive === 'function') {
                                this.networkInterceptor.setPageInterceptorActive(true, { source: 'bridge-ready' });
                            }
                            this._broadcastSpicyState('bridge-ready', true);
                            this.broadcastAuroraState();
                            break;
                        case 'GVP_FETCH_STATE_REQUEST':
                            this._broadcastSpicyState(payload?.reason || 'bridge-request', true);
                            this.broadcastAuroraState();
                            break;
                        case 'GVP_FETCH_CONTENT_REQUEST':
                            if (this.networkInterceptor && typeof this.networkInterceptor.setPageInterceptorActive === 'function') {
                                this.networkInterceptor.setPageInterceptorActive(true, { source: 'bridge-content' });
                            }
                            if (this.networkInterceptor && typeof this.networkInterceptor.handleBridgeContentRequest === 'function') {
                                try {
                                    this.networkInterceptor.handleBridgeContentRequest(payload || {});
                                } catch (contentError) {
                                    console.error('[GVP] Failed handling bridge content request event:', contentError);
                                }
                            }
                            break;
                        case 'GVP_FETCH_CONVERSATION_REQUEST':
                            if (this.networkInterceptor && typeof this.networkInterceptor.setPageInterceptorActive === 'function') {
                                this.networkInterceptor.setPageInterceptorActive(true, { source: 'bridge-conversation' });
                            }
                            if (this.networkInterceptor && typeof this.networkInterceptor.handleBridgeConversationRequest === 'function') {
                                Promise.resolve(this.networkInterceptor.handleBridgeConversationRequest(payload || {}))
                                    .catch(error => console.error('[GVP] Failed handling bridge conversation request event:', error));
                            }
                            break;
                        case 'GVP_FETCH_CONVERSATION_RESPONSE':
                            if (this.networkInterceptor && typeof this.networkInterceptor.setPageInterceptorActive === 'function') {
                                this.networkInterceptor.setPageInterceptorActive(true, { source: 'bridge-conversation-response' });
                            }
                            if (this.networkInterceptor && typeof this.networkInterceptor.handleBridgeConversationResponse === 'function') {
                                Promise.resolve(this.networkInterceptor.handleBridgeConversationResponse(payload || {}))
                                    .catch(error => console.error('[GVP] Failed handling bridge conversation response event:', error));
                            }
                            break;
                        case 'GVP_FETCH_PROGRESS':
                            if (this.networkInterceptor && typeof this.networkInterceptor.setPageInterceptorActive === 'function') {
                                this.networkInterceptor.setPageInterceptorActive(true, { source: 'bridge-progress' });
                            }
                            if (this.networkInterceptor && typeof this.networkInterceptor.handleBridgeProgress === 'function') {
                                Promise.resolve(this.networkInterceptor.handleBridgeProgress(payload || {}))
                                    .catch(error => console.error('[GVP] Failed handling bridge progress event:', error));
                            }
                            break;
                        case 'GVP_FETCH_VIDEO_PROMPT':
                            if (this.networkInterceptor && typeof this.networkInterceptor.setPageInterceptorActive === 'function') {
                                this.networkInterceptor.setPageInterceptorActive(true, { source: 'bridge-video-prompt' });
                            }
                            if (this.networkInterceptor && typeof this.networkInterceptor.handleBridgeVideoPrompt === 'function') {
                                Promise.resolve(this.networkInterceptor.handleBridgeVideoPrompt(payload || {}))
                                    .catch(error => console.error('[GVP] Failed handling bridge video prompt event:', error));
                            }
                            break;
                        case 'GVP_FETCH_GALLERY_DATA':
                            if (this.networkInterceptor && typeof this.networkInterceptor.ingestGalleryPayloadFromPage === 'function') {
                                try {
                                    const galleryPayload = payload?.payload;
                                    if (galleryPayload) {
                                        this.networkInterceptor.ingestGalleryPayloadFromPage(galleryPayload, {
                                            url: payload?.url || null,
                                            method: payload?.method || null,
                                            length: payload?.length || 0,
                                            source: 'bridge'
                                        });
                                    }
                                } catch (galleryError) {
                                    console.error('[GVP] Failed ingesting gallery payload from bridge:', galleryError);
                                }
                            }
                            break;
                        case 'GVP_FETCH_REQUEST_MODIFIED':
                            console.log('[GVP] Page interceptor modified request mode:', payload?.mode || 'unknown', payload);
                            break;
                        case 'GVP_FETCH_LOG': {
                            const level = typeof payload?.level === 'string' ? payload.level.toLowerCase() : 'log';
                            const logger = console[level] ? console[level] : console.log;
                            logger('[GVP][Bridge]', payload?.message || '', payload?.extras || {});
                            break;
                        }
                        default:
                            console.debug('[GVP] Unhandled bridge message:', type, payload);
                    }
                };

                window.addEventListener('message', handler, false);
                this._bridgeListener = handler;
                this._bridgeListenerInstalled = true;
                console.log('[GVP] Bridge listener installed');
            } catch (error) {
                console.error('[GVP] Failed to install bridge listener:', error);
            }
        }

        _getSpicyState() {
            try {
                const state = this.stateManager && typeof this.stateManager.getState === 'function'
                    ? this.stateManager.getState()
                    : null;
                return !!(state && state.generation && state.generation.useSpicy);
            } catch (error) {
                console.error('[GVP] Failed to read spicy state:', error);
                return false;
            }
        }

        _postStateToPage(type, reason = 'unspecified', force = false) {
            if (typeof window === 'undefined' || typeof window.postMessage !== 'function') {
                return;
            }

            const useSpicy = this._getSpicyState();
            if (!force && type === 'GVP_STATE_UPDATE' && this._lastSpicyStateSent === useSpicy) {
                return;
            }

            try {
                window.postMessage({
                    source: 'gvp-extension',
                    type,
                    payload: {
                        useSpicy,
                        reason,
                        timestamp: Date.now()
                    }
                }, '*');
                this._lastSpicyStateSent = useSpicy;
                console.log(`[GVP] Sent spicy state to page (${type}) →`, useSpicy);
            } catch (error) {
                console.error('[GVP] Failed to post spicy state to page:', error);
            }
        }

        _broadcastSpicyState(reason = 'broadcast', force = false) {
            this._postStateToPage('GVP_STATE_BROADCAST', reason, force);
        }

        notifySpicyState(reason = 'update', force = false) {
            this._postStateToPage('GVP_STATE_UPDATE', reason, force);
        }

        _postAuroraStateToPage() {
            if (typeof window === 'undefined' || typeof window.postMessage !== 'function') {
                return;
            }

            try {
                const settings = this.stateManager?.getState?.().settings || {};
                const payload = {
                    enabled: Boolean(settings.auroraEnabled),
                    aspectRatio: settings.auroraAspectRatio || 'square',
                    imageMode: settings.auroraImageMode || 'blank',
                    blankPngs: {
                        portrait: settings.auroraBlankPngPortrait || '',
                        landscape: settings.auroraBlankPngLandscape || '',
                        square: settings.auroraBlankPngSquare || ''
                    },
                    customImages: {
                        portrait: settings.auroraCustomImagePortrait || '',
                        landscape: settings.auroraCustomImageLandscape || '',
                        square: settings.auroraCustomImageSquare || ''
                    }
                };
                window.postMessage({
                    source: 'gvp-extension',
                    type: 'GVP_AURORA_STATE',
                    payload
                }, '*');
                console.log('[GVP] 📡 Broadcasting Aurora state to page:', { 
                    enabled: payload.enabled, 
                    aspectRatio: payload.aspectRatio,
                    imageMode: payload.imageMode,
                    hasBlankSquare: !!payload.blankPngs.square,
                    hasBlankPortrait: !!payload.blankPngs.portrait,
                    hasBlankLandscape: !!payload.blankPngs.landscape,
                    hasCustomSquare: !!payload.customImages.square,
                    hasCustomPortrait: !!payload.customImages.portrait,
                    hasCustomLandscape: !!payload.customImages.landscape
                });
            } catch (error) {
                console.error('[GVP] Failed to post Aurora state to page:', error);
            }
        }

        broadcastAuroraState() {
            this._postAuroraStateToPage();
        }
    }

    // Global fullscreen editor function
    window.gvpOpenFullscreen = function(label, value, category, field, options = {}) {
        const uiManager = window.gvpUIManager;
        if (!uiManager || !uiManager.shadowRoot) {
            console.error('[GVP] UIManager not available for fullscreen');
            return;
        }

        try {
            const modal = uiManager.shadowRoot.getElementById('gvp-fullscreen-modal');
            const title = uiManager.shadowRoot.getElementById('gvp-fullscreen-title');
            const textarea = uiManager.shadowRoot.getElementById('gvp-fullscreen-textarea');
            const state = uiManager.stateManager.getState();

            if (!modal || !title || !textarea) {
                console.error('[GVP] Fullscreen modal elements not found');
                return;
            }

            // Store fullscreen context
            state.fullscreenContent = {
                category: category,
                subArray: field,
                value: value || '',
                formattedValue: window.SentenceFormatter ? window.SentenceFormatter.toDisplay(value || '') : value || '',
                ...options
            };

            title.textContent = `${category} → ${label} - Full Screen Editor`;
            textarea.value = state.fullscreenContent.formattedValue;
            modal.classList.add('visible');
            textarea.focus();
            
            if (typeof uiManager.updateWordCount === 'function') {
                uiManager.updateWordCount(textarea.value);
            }
        } catch (error) {
            console.error('[GVP] Error opening fullscreen editor:', error);
        }
    };

    // Wait for DOM and initialize
    const cleanupLegacyArtifacts = () => {
        try {
            const legacyHost = document.getElementById('gvp-shadow-host');
            if (legacyHost) {
                legacyHost.remove();
                console.log('[GVP] Removed legacy shadow host prior to re-init');
            }

            const orphanBottomBar = document.getElementById('gvp-bottom-bar');
            if (orphanBottomBar && !orphanBottomBar.closest('#gvp-shadow-host')) {
                orphanBottomBar.remove();
                console.log('[GVP] Removed orphaned bottom bar prior to re-init');
            }
        } catch (error) {
            console.warn('[GVP] Cleanup step failed:', error);
        }
    };

    const waitForDOM = () => {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                console.log('[GVP] DOM ready, initializing app...');
                cleanupLegacyArtifacts();
                const app = new GrokVideoPrompterApp();
                app.initialize();
            });
        } else {
            console.log('[GVP] DOM already ready, initializing app...');
            cleanupLegacyArtifacts();
            const app = new GrokVideoPrompterApp();
            app.initialize();
        }
    };

    // Start initialization
    waitForDOM();

})();
