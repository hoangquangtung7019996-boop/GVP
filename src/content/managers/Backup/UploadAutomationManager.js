// A:/Tools n Programs/SD-GrokScripts/grok-video-prompter-extension/src/content/managers/UploadAutomationManager.js
// Rebuilt upload automation to run a deterministic queue and avoid full page refreshes.

const COMPOSER_SELECTORS = [
    'div.tiptap.ProseMirror[contenteditable="true"]',
    'div[data-testid="prompt-input"] div[contenteditable="true"]',
    '[data-testid="composer"] div[contenteditable="true"]'
];

const CLOSE_BUTTON_SELECTORS = [
    '[data-testid="modal-close-button"]',
    'button[data-testid="close-button"]',
    'button[aria-label="Close"]',
    'button[aria-label="Back"]'
];

const GALLERY_ROOT = '/imagine';
const GENERATION_START_TIMEOUT = 15000;
const GENERATION_SETTLE_DELAY = 350;
const COMPOSER_WAIT_TIMEOUT = 8000;
const COMPOSER_RETRY_DELAY = 120;
const CLOSE_WAIT_TIMEOUT = 5000;
const CLOSE_RETRY_DELAY = 140;
const MAX_RETRIES = 2;

function createQueueItem(file, source = 'unknown') {
    const signature = typeof file === 'object' && file
        ? [
            file.name || 'unnamed',
            typeof file.size === 'number' ? file.size : 'size?',
            typeof file.lastModified === 'number' ? file.lastModified : 'modified?'
        ].join('|')
        : null;

    return {
        id: typeof crypto?.randomUUID === 'function'
            ? crypto.randomUUID()
            : `file_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
        file,
        name: file?.name || 'unnamed',
        source,
        signature,
        status: 'pending',
        queuedAt: Date.now(),
        attempts: 0,
        pasteFailures: 0,
        timeoutFailures: 0,
        maxAttempts: MAX_RETRIES + 1,
        lastTrigger: 'initial'
    };
}

function normalizePath(pathname) {
    if (!pathname || typeof pathname !== 'string') {
        return '/';
    }
    return pathname.replace(/\/+$/, '') || '/';
}

function isGalleryPath(pathname) {
    if (!pathname) {
        return false;
    }
    const normalized = normalizePath(pathname);
    if (!normalized.startsWith(GALLERY_ROOT)) {
        return false;
    }
    return !normalized.startsWith('/imagine/post') &&
        !normalized.startsWith('/imagine/new') &&
        !normalized.startsWith('/imagine/create');
}

window.UploadAutomationManager = class UploadAutomationManager {
    constructor(stateManager) {
        this.stateManager = stateManager;
        this._enabled = !!stateManager?.isUploadAutomationEnabled?.();

        this._queue = [];
        this._activeItem = null;
        this._failedItems = [];
        this._signatureRegistry = new Set();
        this._inFlightByRequestId = new Map();
        this._listenersAttached = false;
        this._generationTimer = null;
        this._pendingClose = null;
        this._galleryHomePath = GALLERY_ROOT;
        this._mutationObserver = null;
        this._multiInputs = new WeakSet();

        this._boundFileChange = this._handleFileInputChange.bind(this);
        this._boundPointerDown = () => this._markFileInputsMulti();
        this._boundUploadModeChange = (event) => this._syncEnabledState(event);

        window.addEventListener('gvp:upload-mode-changed', this._boundUploadModeChange);
    }

    // ---------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------

    start() {
        if (typeof document === 'undefined' || this._listenersAttached) {
            return;
        }

        this._listenersAttached = true;
        this._rememberGalleryHome();

        document.addEventListener('change', this._boundFileChange, true);
        document.addEventListener('pointerdown', this._boundPointerDown, true);
        this._markFileInputsMulti(true);

        this._mutationObserver = new MutationObserver((records) => {
            if (!records || !records.length) {
                return;
            }
            let shouldRefresh = false;
            records.forEach((record) => {
                if ((record.addedNodes && record.addedNodes.length) ||
                    (record.removedNodes && record.removedNodes.length)) {
                    shouldRefresh = true;
                }
            });
            if (shouldRefresh) {
                this._markFileInputsMulti();
            }
        });

        if (document.body) {
            this._mutationObserver.observe(document.body, { childList: true, subtree: true });
        }

        console.log('[GVP Upload] Upload automation ready');
    }

    destroy() {
        window.removeEventListener('gvp:upload-mode-changed', this._boundUploadModeChange);

        if (!this._listenersAttached || typeof document === 'undefined') {
            return;
        }

        document.removeEventListener('change', this._boundFileChange, true);
        document.removeEventListener('pointerdown', this._boundPointerDown, true);

        if (this._mutationObserver) {
            this._mutationObserver.disconnect();
            this._mutationObserver = null;
        }

        this._listenersAttached = false;
        this._clearGenerationTimer();
        this._queue.length = 0;
        this._activeItem = null;
        this._pendingClose = null;
        this._inFlightByRequestId.clear();
        this._signatureRegistry.clear();
        this._failedItems.length = 0;

        console.log('[GVP Upload] Upload automation destroyed');
    }

    isEnabled() {
        return this._enabled;
    }

    getCurrentSignature() {
        return this._activeItem?.signature || null;
    }

    enqueueFiles(fileList, source = 'unknown') {
        if (!fileList) {
            return;
        }

        const files = Array.isArray(fileList)
            ? fileList
            : (typeof FileList !== 'undefined' && fileList instanceof FileList)
                ? Array.from(fileList)
                : Array.from(fileList || []);

        if (!files.length) {
            return;
        }

        const appended = [];
        files.forEach((file) => {
            if (!(file instanceof File)) {
                return;
            }
            const item = createQueueItem(file, source);
            if (!item.signature) {
                console.warn('[GVP Upload] Skipping file without signature', { name: item.name, source });
                return;
            }
            if (this._signatureRegistry.has(item.signature)) {
                console.log('[GVP Upload] Skipping duplicate selection', { name: item.name, source });
                return;
            }
            this._signatureRegistry.add(item.signature);
            this._queue.push(item);
            appended.push(item);
        });

        if (!appended.length) {
            return;
        }

        console.log('[GVP Upload] Queued files', {
            appended: appended.length,
            total: this._queue.length,
            names: appended.map(item => item.name),
            source
        });

        if (this._enabled && !this._activeItem && !this._pendingClose) {
            this._processQueue('enqueue');
        }
    }

    notifyGenerationStarted(meta = {}) {
        if (!this._activeItem) {
            const orphan = this._resolveInFlight(meta);
            if (!orphan) {
                console.debug('[GVP Upload] Generation started event without active item', meta);
            }
            return;
        }

        if (this._activeItem.status !== 'waiting-generation') {
            console.debug('[GVP Upload] Generation event ignored (unexpected state)', {
                meta,
                status: this._activeItem.status
            });
            return;
        }

        this._clearGenerationTimer();
        const item = this._activeItem;
        this._activeItem = null;

        const requestId = meta?.requestId || meta?.id || `${item.id}__${Date.now()}`;
        item.status = 'in-flight';
        item.startedAt = Date.now();
        item.startMeta = meta;
        item.requestId = requestId;

        this._inFlightByRequestId.set(requestId, item);

        console.log('[GVP Upload] Generation detected', {
            fileName: item.name,
            requestId,
            stage: meta?.stage || 'unknown',
            queueRemaining: this._queue.length
        });

        if (this._pendingClose) {
            return;
        }
    }

    handleGenerationSuccess(meta = {}) {
        const item = this._resolveInFlight(meta);
        if (!item) {
            console.debug('[GVP Upload] Generation success with no tracked request', meta);
            return;
        }

        this._finalizeInFlight(item, 'completed', meta);
        console.log('[GVP Upload] Generation completed', {
            fileName: item.name,
            requestId: item.requestId || null,
            queueRemaining: this._queue.length
        });

        this._pendingClose = this._exitGenerationView('generation-success', meta)
            .catch((error) => console.warn('[GVP Upload] Failed to exit generation view', error))
            .finally(() => {
                this._pendingClose = null;
                this._processQueue('generation-success');
            });
    }

    notifyUploadFailure(meta = {}) {
        if (this._activeItem && this._activeItem.status === 'waiting-generation') {
            console.warn('[GVP Upload] Server refused upload', {
                fileName: this._activeItem.name,
                meta
            });
            this._dropActive('upload-failure', meta, { retryable: false });
            return;
        }

        const item = this._resolveInFlight(meta);
        if (!item) {
            console.debug('[GVP Upload] Upload failure without matching request', meta);
            return;
        }

        this._finalizeInFlight(item, 'failed', meta);
        console.warn('[GVP Upload] Generation failed after submission', {
            fileName: item.name,
            requestId: item.requestId || null,
            meta
        });

        this._pendingClose = this._exitGenerationView('upload-failure', meta)
            .catch((error) => console.warn('[GVP Upload] Failed to exit generation view', error))
            .finally(() => {
                this._pendingClose = null;
                this._processQueue('upload-failure');
            });
    }

    // ---------------------------------------------------------------------
    // Internal orchestration
    // ---------------------------------------------------------------------

    _processQueue(trigger = 'unknown') {
        if (!this._enabled) {
            return;
        }
        if (this._activeItem || this._pendingClose) {
            return;
        }
        if (this._inFlightByRequestId.size > 0) {
            return;
        }
        if (!this._queue.length) {
            console.log('[GVP Upload] Queue idle');
            return;
        }

        const nextItem = this._queue.shift();
        this._activeItem = nextItem;
        nextItem.lastTrigger = trigger;
        nextItem.attempts += 1;
        nextItem.status = 'preparing';

        console.log('[GVP Upload] Submitting file', {
            fileName: nextItem.name,
            attempt: nextItem.attempts,
            trigger,
            pending: this._queue.length
        });

        Promise.resolve(this._submitActiveItem(nextItem))
            .catch((error) => {
                console.error('[GVP Upload] Submission pipeline failed', error);
                this._dropActive('submission-error', { error });
            });
    }

    async _submitActiveItem(item) {
        if (this._activeItem !== item) {
            return;
        }

        const composer = await this._ensureComposerContext(item);
        if (!composer) {
            this._dropActive('composer-missing');
            return;
        }

        if (this._activeItem !== item) {
            return;
        }

        const dispatched = await this._dispatchFile(composer, item);
        if (!dispatched?.success) {
            this._handleDispatchFailure(item, dispatched?.reason || 'file-input-dispatch-failed');
            return;
        }

        item.status = 'waiting-generation';
        this._scheduleGenerationTimer(item);
    }

    async _ensureComposerContext(item) {
        const deadline = Date.now() + COMPOSER_WAIT_TIMEOUT;
        while (Date.now() < deadline) {
            const composer = this._resolveComposer();
            if (composer) {
                return composer;
            }
            this._tryOpenComposer();
            await this._delay(COMPOSER_RETRY_DELAY);
        }
        const composer = this._resolveComposer();
        if (!composer) {
            console.warn('[GVP Upload] Composer unavailable', { fileName: item?.name });
        }
        return composer || null;
    }

    _resolveComposer() {
        if (typeof document === 'undefined') {
            return null;
        }
        for (const selector of COMPOSER_SELECTORS) {
            const node = document.querySelector(selector);
            if (node) {
                return node;
            }
        }
        return null;
    }

    _tryOpenComposer() {
        if (typeof document === 'undefined') {
            return;
        }

        const openers = [
            '[data-testid="mini-create-button"]',
            'button[data-testid="create-button"]',
            'a[href="/imagine/new"]',
            'button[data-testid="video-gen-create"]'
        ];

        for (const selector of openers) {
            const node = document.querySelector(selector);
            if (node) {
                node.click();
                return;
            }
        }
    }

    async _dispatchFile(composer, item) {
        const input = this._resolveUploadInput();
        if (!input) {
            console.warn('[GVP Upload] File input unavailable for dispatch', { fileName: item.name });
            return { success: false, reason: 'file-input-missing' };
        }

        let dataTransfer;
        try {
            dataTransfer = new DataTransfer();
            dataTransfer.items.add(item.file);
        } catch (error) {
            console.error('[GVP Upload] Unable to construct DataTransfer', error);
            return { success: false, reason: 'data-transfer' };
        }

        try {
            if (typeof composer.focus === 'function') {
                composer.focus({ preventScroll: true });
            }
        } catch (error) {
            console.debug('[GVP Upload] Focus warning', error);
        }

        const prototypeDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'files');
        if (!prototypeDescriptor || typeof prototypeDescriptor.get !== 'function') {
            console.warn('[GVP Upload] File input did not expose files descriptor');
            return { success: false, reason: 'file-input-unsupported' };
        }

        let overrideApplied = false;
        this._suppressInputHandling += 1;
        try {
            Object.defineProperty(input, 'files', {
                configurable: true,
                enumerable: true,
                get: () => dataTransfer.files
            });
            overrideApplied = true;

            const changeEvent = new Event('change', { bubbles: true, cancelable: true });
            changeEvent.gvpSynthetic = true;
            const dispatched = input.dispatchEvent(changeEvent);
            if (!dispatched) {
                console.warn('[GVP Upload] File input change cancelled by page', { fileName: item.name });
                return { success: false, reason: 'change-cancelled' };
            }
        } catch (error) {
            console.error('[GVP Upload] File input dispatch failed', error);
            return { success: false, reason: 'file-input-dispatch-failed', error };
        } finally {
            this._suppressInputHandling = Math.max(0, this._suppressInputHandling - 1);
            if (overrideApplied) {
                try {
                    delete input.files;
                } catch (cleanupError) {
                    console.debug('[GVP Upload] File input cleanup warning', cleanupError);
                }
            }
        }

        console.log('[GVP Upload] 📋 Injected file', {
            fileName: item.name,
            via: 'file-input',
            remaining: this._queue.length
        });
        return { success: true, via: 'file-input' };
    }

    _resolveUploadInput() {
        if (typeof document === 'undefined') {
            return null;
        }
        const candidates = Array.from(document.querySelectorAll('input[type="file"][name="files"]'));
        if (!candidates.length) {
            return null;
        }
        const preferred = candidates.find(input => input.isConnected && !input.disabled) || candidates[0];
        return preferred || null;
    }

    _handleDispatchFailure(item, reason) {
        item.pasteFailures += 1;
        this._dropActive(reason, { reason }, { retryable: item.pasteFailures <= MAX_RETRIES });
    }

    _scheduleGenerationTimer(item) {
        this._clearGenerationTimer();
        this._generationTimer = window.setTimeout(() => {
            if (!this._activeItem || this._activeItem !== item) {
                return;
            }
            this._handleGenerationTimeout(item);
        }, GENERATION_START_TIMEOUT);
    }

    _handleGenerationTimeout(item) {
        item.timeoutFailures += 1;
        console.warn('[GVP Upload] Generation start timeout', { fileName: item?.name });
        this._dropActive('generation-timeout', null, { retryable: item.timeoutFailures <= MAX_RETRIES });
    }

    _dropActive(reason, meta = null, options = {}) {
        if (!this._activeItem) {
            return;
        }

        const item = this._activeItem;
        this._activeItem = null;
        this._clearGenerationTimer();

        const retryable = options?.retryable !== false &&
            item.attempts < item.maxAttempts &&
            [
                'file-input-missing',
                'file-input-unsupported',
                'file-input-dispatch-failed',
                'change-cancelled',
                'data-transfer',
                'generation-timeout',
                'composer-missing',
                'submission-error'
            ].includes(reason);

        if (retryable) {
            console.warn('[GVP Upload] Retrying file', {
                fileName: item.name,
                reason,
                attempts: item.attempts,
                pasteFailures: item.pasteFailures,
                timeoutFailures: item.timeoutFailures
            });
            item.status = 'retrying';
            item.retryReason = reason;
            this._queue.unshift(item);
        } else {
            item.status = 'dropped';
            item.dropReason = reason;
            item.dropMeta = meta || null;
            this._failedItems.push({ ...item });
            this._signatureRegistry.delete(item.signature);
            console.warn('[GVP Upload] Dropping file from automation', {
                fileName: item.name,
                reason,
                attempts: item.attempts,
                pasteFailures: item.pasteFailures,
                timeoutFailures: item.timeoutFailures
            });
        }

        window.setTimeout(() => this._processQueue(reason), 200);
    }

    _finalizeInFlight(item, terminalStatus, meta = {}) {
        if (!item) {
            return;
        }

        if (item.requestId) {
            this._inFlightByRequestId.delete(item.requestId);
        }
        this._signatureRegistry.delete(item.signature);

        item.status = terminalStatus;
        item.finishedAt = Date.now();
        item.finishMeta = meta || null;
    }

    _resolveInFlight(meta = {}) {
        const requestId = meta?.requestId || meta?.id || meta?.headers?.['x-xai-request-id'];
        if (requestId && this._inFlightByRequestId.has(requestId)) {
            return this._inFlightByRequestId.get(requestId);
        }

        if (meta?.imageId) {
            for (const item of this._inFlightByRequestId.values()) {
                if (item?.startMeta?.imageId === meta.imageId) {
                    return item;
                }
            }
        }

        if (meta?.signature && this._signatureRegistry.has(meta.signature)) {
            for (const item of this._inFlightByRequestId.values()) {
                if (item.signature === meta.signature) {
                    return item;
                }
            }
        }
        return null;
    }

    // ---------------------------------------------------------------------
    // Navigational helpers
    // ---------------------------------------------------------------------

    async _exitGenerationView(trigger = 'unknown', meta = {}) {
        await this._delay(GENERATION_SETTLE_DELAY);
        const rawPath = window.location?.pathname || '/';
        const normalized = normalizePath(rawPath);
        if (isGalleryPath(normalized)) {
            this._rememberGalleryHome();
            return;
        }

        const strategies = [
            async () => this._clickCloseButton(),
            async () => this._sendEscapeKey(),
            async () => this._navigateBack()
        ];

        for (const strategy of strategies) {
            try {
                const handled = await strategy();
                if (!handled) {
                    continue;
                }
                const reachedGallery = await this._waitForGalleryContext(trigger);
                if (reachedGallery) {
                    return;
                }
            } catch (error) {
                console.debug('[GVP Upload] Exit strategy failed', error);
            }
        }

        if (!isGalleryPath(normalizePath(window.location?.pathname || '/'))) {
            const target = this._galleryHomePath || GALLERY_ROOT;
            console.warn('[GVP Upload] Forcing gallery navigation', {
                current: window.location?.pathname,
                target,
                trigger,
                meta
            });
            window.history?.pushState?.({}, '', target);
            window.dispatchEvent?.(new PopStateEvent('popstate'));
            await this._waitForGalleryContext(trigger);
        }
    }

    async _clickCloseButton() {
        if (typeof document === 'undefined') {
            return false;
        }
        for (const selector of CLOSE_BUTTON_SELECTORS) {
            const button = document.querySelector(selector);
            if (button) {
                button.click();
                return true;
            }
        }
        return false;
    }

    async _sendEscapeKey() {
        if (typeof document === 'undefined') {
            return false;
        }
        const escEvent = new KeyboardEvent('keydown', {
            key: 'Escape',
            keyCode: 27,
            which: 27,
            bubbles: true,
            cancelable: true
        });
        document.dispatchEvent(escEvent);
        return true;
    }

    async _navigateBack() {
        if (window.history && window.history.length > 1) {
            window.history.back();
            return true;
        }
        return false;
    }

    async _waitForGalleryContext(trigger = 'unknown') {
        const targetDeadline = Date.now() + CLOSE_WAIT_TIMEOUT;
        while (Date.now() < targetDeadline) {
            const currentPath = normalizePath(window.location?.pathname || '/');
            if (isGalleryPath(currentPath)) {
                this._rememberGalleryHome();
                return true;
            }
            await this._delay(CLOSE_RETRY_DELAY);
        }
        return isGalleryPath(normalizePath(window.location?.pathname || '/'));
    }

    _rememberGalleryHome() {
        const current = normalizePath(window.location?.pathname || '/');
        if (isGalleryPath(current)) {
            this._galleryHomePath = current || GALLERY_ROOT;
        }
    }

    // ---------------------------------------------------------------------
    // Event handlers & utilities
    // ---------------------------------------------------------------------

    _handleFileInputChange(event) {
        if (!this._enabled) {
            return;
        }
        const target = event?.target;
        const suppressed = this._suppressInputHandling > 0;
        if (!target || !(target instanceof Element)) {
            return;
        }
        if ((target.getAttribute('type') || '').toLowerCase() !== 'file') {
            return;
        }

        if (suppressed) {
            return;
        }

        if (typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
        }
        if (typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }

        const files = target.files ? Array.from(target.files) : [];
        if (!files.length) {
            return;
        }

        try {
            target.value = '';
        } catch (error) {
            console.debug('[GVP Upload] Unable to reset file input value', error);
        }

        this._rememberGalleryHome();
        console.log('[GVP Upload] File selection captured', {
            count: files.length,
            input: this._describeInput(target)
        });

        this.enqueueFiles(files, 'file-input');
    }

    _syncEnabledState(event) {
        const enabled = typeof event?.detail?.enabled === 'boolean'
            ? event.detail.enabled
            : !!this.stateManager?.isUploadAutomationEnabled?.();
        this._enabled = enabled;

        if (!enabled) {
            this._clearGenerationTimer();
            this._activeItem = null;
        } else {
            this._rememberGalleryHome();
            if (!this._listenersAttached) {
                this.start();
            }
            if (this._queue.length && !this._activeItem) {
                this._processQueue('mode-enabled');
            }
        }
    }

    _markFileInputsMulti(force = false) {
        if (typeof document === 'undefined') {
            return;
        }
        const inputs = document.querySelectorAll('input[type="file"]');
        inputs.forEach((input) => {
            if (!force && this._multiInputs.has(input)) {
                return;
            }
            input.multiple = true;
            input.setAttribute('multiple', '');
            input.setAttribute('data-gvp-multi', 'true');
            this._multiInputs.add(input);
            console.log('[GVP Upload] Enabled multi-select on file input', {
                selector: this._describeInput(input)
            });
        });
    }

    _clearGenerationTimer() {
        if (this._generationTimer) {
            window.clearTimeout(this._generationTimer);
            this._generationTimer = null;
        }
    }

    _delay(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    _describeInput(input) {
        if (!input || typeof input !== 'object') {
            return '';
        }
        const parts = [];
        if (input.id) {
            parts.push(`#${input.id}`);
        }
        if (input.className) {
            const cls = String(input.className).trim().replace(/\s+/g, '.');
            if (cls) {
                parts.push(`.${cls}`);
            }
        }
        if (typeof input.getAttribute === 'function') {
            const nameAttr = input.getAttribute('name');
            if (nameAttr) {
                parts.push(`[name="${nameAttr}"]`);
            }
            const dataTestId = input.getAttribute('data-testid');
            if (dataTestId) {
                parts.push(`[data-testid="${dataTestId}"]`);
            }
        }
        return parts.join('');
    }
};
