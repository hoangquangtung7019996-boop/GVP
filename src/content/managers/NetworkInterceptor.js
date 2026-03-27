
// a:/Tools n Programs/SD-GrokScripts/grok-video-prompter-extension/src/content/managers/NetworkInterceptor.js
// Intercepts network requests to inject data and monitor responses.
// Dependencies: StateManager, ReactAutomation, ModerationDetector

window.NetworkInterceptor = class NetworkInterceptor {
    constructor(stateManager, reactAutomation, uploadAutomationManager) {
        // GVP MODIFICATION: Enhanced lifecycle logging
        window.Logger?.debug('NetworkInterceptor', '🚀 Constructor fired');

        this.stateManager = stateManager;
        this.reactAutomation = reactAutomation;
        this.uploadAutomationManager = uploadAutomationManager || null;
        this.originalFetch = null;
        this.commonHeaders = {}; // Track headers for uploads
        this._hasLoggedGallerySchema = false;
        this._pageInterceptorActive = false;
        this._bridgeMetadataByVideoId = new Map();
        this._bridgeRequestsById = new Map();
        this._pendingUpload = null;

        // GVP MODIFICATION: Track initialization state
        this._isInitialized = false;
        this._multiGenHistoryEnabled = typeof this.stateManager?.createMultiGenAttempt === 'function';
        this._multiGenRequestSequence = 0;
        this._fetchWrapper = null;
        this._fetchOverrideInstalled = false;
        window.Logger?.debug('NetworkInterceptor', '✅ Constructor completed');
    }

    // GVP MODIFICATION: Explicit initialize method with verification
    initialize() {
        window.Logger?.info('NetworkInterceptor', '🔧 Starting initialization...');

        // Enhanced fetch override installation
        this._installFetchOverride();
        this._isInitialized = true;

        window.Logger?.info('NetworkInterceptor', '✅ Initialization complete - fetch override installed');
        return true;
    }

    _extractUuid(value) {
        if (!value || typeof value !== 'string') {
            return null;
        }
        const match = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        return match ? match[0] : null;
    }

    _getNested(obj, path = []) {
        let current = obj;
        for (const key of path) {
            if (!current || typeof current !== 'object') {
                return null;
            }
            current = current[key];
        }
        return current;
    }

    _extractUrlFromString(str) {
        if (!str || typeof str !== 'string') {
            return null;
        }
        const matches = str.match(/https?:\/\/[^\s"'<>]+/gi);
        if (!matches || !matches.length) {
            return null;
        }
        const preferred = matches.find(url => /\/content\b/i.test(url)) ||
            matches.find(url => /assets\.grok\.com/i.test(url)) ||
            matches.find(url => /imagine-public\./i.test(url));
        return preferred || matches[0];
    }

    _extractThumbnailUrl(payload) {
        if (!payload) {
            return null;
        }

        if (typeof payload === 'string') {
            return this._extractUrlFromString(payload);
        }

        const candidates = new Set();
        const consider = (value) => {
            if (!value) return;
            if (typeof value === 'string') {
                const extracted = this._extractUrlFromString(value);
                if (extracted) {
                    candidates.add(extracted.trim());
                } else {
                    const trimmed = value.trim();
                    if (trimmed.startsWith('/') || trimmed.startsWith('http') || trimmed.startsWith('data:image')) {
                        candidates.add(trimmed);
                    }
                }
            }
        };

        consider(payload.thumbnailUrl);
        consider(payload.imageUrl);
        consider(payload.mediaUrl);
        consider(payload.previewUrl);
        consider(payload.contentUrl);
        consider(payload.url);
        consider(payload.referenceUrl);

        if (typeof payload.message === 'string') {
            consider(payload.message);
        }
        if (typeof payload.prompt === 'string') {
            consider(payload.prompt);
        }

        consider(this._getNested(payload, [
            'responseMetadata',
            'modelConfigOverride',
            'modelMap',
            'videoGenModelConfig',
            'imageReference'
        ]));

        const arraySources = [
            payload.imageUrls,
            payload.mediaUrls,
            payload.previewUrls,
            payload.fileAttachments,
            payload.fileUris,
            payload.attachments
        ];

        arraySources.forEach((collection) => {
            if (!Array.isArray(collection)) {
                return;
            }
            collection.forEach((item) => {
                if (typeof item === 'string') {
                    consider(item);
                } else if (item && typeof item === 'object') {
                    consider(item.url || item.uri || item.href || '');
                }
            });
        });

        if (!candidates.size) {
            return null;
        }

        const ordered = Array.from(candidates);
        const preferred = ordered.find(url => /\/content\b/i.test(url)) ||
            ordered.find(url => /assets\.grok\.com/i.test(url)) ||
            ordered.find(url => /imagine-public\./i.test(url));
        return preferred || ordered[0] || null;
    }

    _extractImageIdFromPayload(payload) {
        if (!payload) {
            return null;
        }

        if (typeof payload === 'string') {
            const uuidRegex = window.GVP_REGEX?.UUID || /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
            const match = payload.match(uuidRegex);
            return match ? match[1] : null;
        }

        const candidatePaths = [
            ['responseMetadata', 'modelConfigOverride', 'modelMap', 'videoGenModelConfig', 'parentPostId'],
            ['responseMetadata', 'modelConfigOverride', 'modelMap', 'videoGenModelConfig', 'inputImagePostId'],
            ['responseMetadata', 'modelConfigOverride', 'modelMap', 'videoGenModelConfig', 'imagePostId'],
            ['responseMetadata', 'modelConfigOverride', 'modelMap', 'videoGenModelConfig', 'assetId'],
            ['responseMetadata', 'modelConfigOverride', 'modelMap', 'videoGenModelConfig', 'sourcePostId'],
            ['responseMetadata', 'modelConfigOverride', 'imagePostId'],
            ['responseMetadata', 'parentPostId'],
            ['modelConfigOverride', 'modelMap', 'videoGenModelConfig', 'parentPostId'],
            ['modelConfigOverride', 'videoGenModelConfig', 'parentPostId'],
            ['modelConfigOverride', 'videoGenModelConfig', 'imagePostId'],
            ['modelConfigOverride', 'parentPostId'],
            ['parentPostId'],
            ['imageId'],
            ['assetId'],
            ['originalPostId'],
            ['postId'],
            ['selectedImageId']
        ];

        for (const path of candidatePaths) {
            const value = this._getNested(payload, path);
            const uuid = this._extractUuid(value);
            if (uuid) {
                return uuid;
            }
        }

        const attachments = [
            payload.fileAttachments,
            payload.fileAttachmentsMetadata,
            payload.imageReferences,
            payload.attachments
        ];

        for (const list of attachments) {
            if (!Array.isArray(list)) continue;
            for (const entry of list) {
                if (typeof entry === 'string') {
                    const uuid = this._extractUuid(entry);
                    if (uuid) return uuid;
                } else if (entry && typeof entry === 'object') {
                    const uuid = this._extractUuid(entry.id) ||
                        this._extractUuid(entry.postId) ||
                        this._extractUuid(entry.assetId) ||
                        this._extractUuid(entry.imageId) ||
                        this._extractUuid(entry.url) ||
                        this._extractUuid(entry.uri);
                    if (uuid) return uuid;
                }
            }
        }

        const textFields = [
            payload.message,
            payload.prompt,
            payload.input,
            payload.body,
            payload.query
        ];

        for (const field of textFields) {
            const uuid = this._extractUuid(field);
            if (uuid) {
                return uuid;
            }
        }

        return null;
    }

    _cleanupPromptText(raw) {
        if (!raw || typeof raw !== 'string') {
            return '';
        }
        let text = raw.trim();
        if (!text) {
            return '';
        }
        const urls = text.match(/https?:\/\/[^\s"'<>]+/gi);
        if (urls) {
            urls.forEach((url) => {
                text = text.replace(url, ' ');
            });
        }
        return text.replace(/\s{2,}/g, ' ').trim();
    }

    _extractPromptText(payload, fallback = '') {
        if (!payload) {
            return fallback;
        }

        if (typeof payload === 'string') {
            const cleaned = this._cleanupPromptText(payload);
            return cleaned || fallback;
        }

        if (typeof payload.message === 'string') {
            const cleaned = this._cleanupPromptText(payload.message);
            if (cleaned) return cleaned;
        }

        if (Array.isArray(payload.messages)) {
            for (let index = payload.messages.length - 1; index >= 0; index -= 1) {
                const message = payload.messages[index];
                if (typeof message === 'string') {
                    const cleaned = this._cleanupPromptText(message);
                    if (cleaned) return cleaned;
                } else if (message && typeof message === 'object' && typeof message.content === 'string') {
                    const cleaned = this._cleanupPromptText(message.content);
                    if (cleaned) return cleaned;
                }
            }
        }

        if (typeof payload.prompt === 'string') {
            const cleaned = this._cleanupPromptText(payload.prompt);
            if (cleaned) return cleaned;
        }

        if (typeof payload.input === 'string') {
            const cleaned = this._cleanupPromptText(payload.input);
            if (cleaned) return cleaned;
        }

        return fallback;
    }

    _normalizeAssetUrl(url) {
        if (!url || typeof url !== 'string') {
            return null;
        }
        const trimmed = url.trim();
        if (!trimmed) {
            return null;
        }
        if (/^https?:\/\//i.test(trimmed)) {
            return trimmed;
        }
        return `https://assets.grok.com/${trimmed.replace(/^\/+/, '')}`;
    }

    _coerceProgressValue(rawValue) {
        if (rawValue === null || rawValue === undefined) {
            return null;
        }

        if (typeof rawValue === 'number') {
            return Number.isFinite(rawValue) ? Math.max(0, Math.min(100, rawValue)) : null;
        }

        if (typeof rawValue === 'string') {
            const trimmed = rawValue.trim();
            if (!trimmed) {
                return null;
            }
            const withoutPercent = trimmed.endsWith('%') ? trimmed.slice(0, -1) : trimmed;
            const normalized = withoutPercent.replace(/[^0-9.+-]/g, '');
            if (!normalized) {
                return null;
            }
            const parsed = parseFloat(normalized);
            if (!Number.isFinite(parsed)) {
                return null;
            }
            return Math.max(0, Math.min(100, parsed));
        }

        if (typeof rawValue === 'object' && rawValue !== null) {
            if (typeof rawValue.progress === 'number' || typeof rawValue.value === 'number') {
                return this._coerceProgressValue(rawValue.progress ?? rawValue.value);
            }
            if (typeof rawValue.progress === 'string' || typeof rawValue.value === 'string') {
                return this._coerceProgressValue(rawValue.progress ?? rawValue.value);
            }
        }

        return null;
    }

    _generateRequestId(prefix = 'req') {
        this._multiGenRequestSequence += 1;
        return `${prefix}_${Date.now()}_${this._multiGenRequestSequence.toString(16)}`;
    }

    _handleImageContentRequest(requestUrl) {
        if (!this._multiGenHistoryEnabled || !requestUrl || typeof requestUrl !== 'string') {
            return;
        }

        const match = requestUrl.match(/\/users\/([0-9a-f-]+)\/([0-9a-f-]+)\/content/i);
        if (!match) {
            return;
        }

        const [, accountId, imageId] = match;
        const thumbnailUrl = requestUrl.split('?')[0];

        try {
            if (accountId) {
                this._setActiveAccount(accountId, 'image-content');
            }
            this.stateManager.ensureMultiGenImageEntry(accountId, imageId, thumbnailUrl);
            this.stateManager.setLastMultiGenImage(accountId, imageId);
        } catch (error) {
            console.error('[GVP][Interceptor] Failed to track image content request', {
                accountId,
                imageId,
                error
            });
        }
    }

    _safeParseJson(text) {
        if (!text || typeof text !== 'string') {
            return null;
        }
        try {
            return JSON.parse(text);
        } catch (error) {
            console.debug('[GVP][Interceptor] Failed to parse JSON text', error);
            return null;
        }
    }

    _safeStringify(data) {
        if (!data) {
            return null;
        }
        try {
            return JSON.stringify(data);
        } catch (error) {
            console.debug('[GVP][Interceptor] Failed to stringify snapshot', error);
            return null;
        }
    }

    async _readRequestPayload(requestInfo, requestInit = {}) {
        const result = {
            rawText: null,
            json: null
        };

        try {
            if (typeof requestInit.body === 'string') {
                result.rawText = requestInit.body;
            } else if (requestInit.body instanceof URLSearchParams) {
                result.rawText = requestInit.body.toString();
            } else if (requestInit.body && typeof requestInit.body === 'object' && typeof requestInit.body.text === 'function') {
                result.rawText = await requestInit.body.text();
            } else if (requestInfo instanceof Request) {
                try {
                    const clone = requestInfo.clone();
                    result.rawText = await clone.text();
                } catch (cloneError) {
                    console.debug('[GVP][Interceptor] Unable to clone request for payload extraction', cloneError);
                }
            }
        } catch (error) {
            console.warn('[GVP][Interceptor] Failed reading request payload', error);
        }

        if (result.rawText && result.rawText.trim()) {
            const parsed = this._safeParseJson(result.rawText.trim());
            if (parsed && typeof parsed === 'object') {
                result.json = parsed;
            }
        }

        return result;
    }

    _captureMultiGenRequestContext({ requestUrl, method, payloadInfo, headers, requestId: requestIdOverride }) {
        if (!this._multiGenHistoryEnabled) {
            return null;
        }
        if (method !== 'POST' || !requestUrl || typeof requestUrl !== 'string') {
            return null;
        }
        if (!requestUrl.includes('/rest/app-chat/conversations/new')) {
            return null;
        }

        const payload = payloadInfo?.json || this._safeParseJson(payloadInfo?.rawText || '') || null;
        if (!payload) {
            console.warn('[GVP][Interceptor] Multi-gen capture proceeding without parsed payload');
        }

        let accountId = this._extractAccountIdFromPayload(payload);
        if (!accountId && typeof payloadInfo?.rawText === 'string') {
            accountId = this._extractAccountIdFromString(payloadInfo.rawText);
        }
        let thumbnailUrl = this._extractThumbnailUrl(payload);
        if (!accountId && thumbnailUrl) {
            accountId = this._extractAccountIdFromString(thumbnailUrl);
        }
        const pendingUpload = this._pendingUpload || null;
        if (pendingUpload) {
            this._pendingUpload = null;
        }
        if (!accountId && pendingUpload?.accountId) {
            accountId = pendingUpload.accountId;
        }
        if (!thumbnailUrl && pendingUpload?.fileUri) {
            thumbnailUrl = this._normalizeAssetUrl(pendingUpload.fileUri);
        }
        if (!accountId) {
            const state = this.stateManager?.getState?.();
            if (state?.multiGenHistory?.activeAccountId) {
                accountId = state.multiGenHistory.activeAccountId;
                console.log('[GVP][Interceptor] 🔄 Falling back to stateManager activeAccountId:', accountId);
            } else {
                console.warn('[GVP][Interceptor] Multi-gen capture skipped: unable to resolve account id', {
                    requestUrl,
                    hasPayload: !!payload,
                    hasThumbnail: !!thumbnailUrl
                });
                return null;
            }
        }
        this._setActiveAccount(accountId, 'conversation-request');

        let imageId = this._extractImageIdFromPayload(payload);
        if (!imageId && pendingUpload?.imageId) {
            imageId = pendingUpload.imageId;
        }
        if (!imageId) {
            imageId = this.stateManager.getLastMultiGenImage(accountId);
        }
        if (!imageId) {
            const state = this.stateManager?.getState?.();
            const lastImageId = state?.generation?.lastImageId;
            if (lastImageId) {
                imageId = lastImageId;
                console.log('[GVP][Interceptor] 🔄 Falling back to stateManager generation.lastImageId:', imageId);
            }
        }

        if (!imageId) {
            console.warn('[GVP][Interceptor] Multi-gen capture skipped: unable to resolve image id', {
                accountId,
                hasPayload: !!payload,
                pendingUploadId: pendingUpload?.imageId
            });
            return null;
        }

        const requestId = requestIdOverride || this._generateRequestId('multigen');
        const prompt = this._extractPromptText(payload, '');
        const payloadSnapshot = payloadInfo?.rawText || this._safeStringify(payload) || null;

        const originalPostId = this.stateManager.getParentImageId(imageId);
        try {
            this.stateManager.ensureMultiGenImageEntry(accountId, imageId, thumbnailUrl || undefined, originalPostId);
            this.stateManager.setLastMultiGenImage(accountId, imageId);
        } catch (error) {
            console.error('[GVP][Interceptor] Failed ensuring multi-gen image entry', error);
        }

        let attempt = null;
        try {
            attempt = this.stateManager.createMultiGenAttempt(accountId, imageId, {
                prompt: prompt || null,
                thumbnailUrl: thumbnailUrl || undefined,
                payloadSnapshot,
                responseId: requestId,
                originalPostId
            });
            if (attempt) {
                console.log('[GVP][Interceptor] Multi-gen attempt created', {
                    requestId,
                    imageId,
                    attemptId: attempt.id,
                    accountId
                });
            }
        } catch (error) {
            console.error('[GVP][Interceptor] Failed creating multi-gen attempt', error);
        }

        if (!attempt) {
            this.stateManager.disarmMultiGenRequest(requestId);
            return null;
        }

        try {
            this.stateManager.armMultiGenRequest(requestId, {
                accountId,
                imageId,
                attemptId: attempt.id,
                requestUrl,
                headers: { ...(headers || {}) },
                createdAt: new Date().toISOString()
            });
        } catch (error) {
            console.error('[GVP][Interceptor] Failed arming multi-gen request', error);
        }

        const imageReference = thumbnailUrl || this._extractUrlFromString(payload?.message || '') || null;

        const context = {
            requestId,
            accountId,
            imageId,
            attemptId: attempt.id,
            prompt: attempt.prompt || prompt || null,
            thumbnailUrl: thumbnailUrl || null,
            payloadSnapshot,
            imageReference: imageReference || null,
            lastProgress: 0,
            moderated: false,
            moderationReason: null, // DEPRECATED: Do not use for storage
            videoUrl: null,
            videoId: null,
            videoPrompt: null,
            finalMessage: null, // DEPRECATED: Do not use for storage
            rawChunks: [], // DEPRECATED: Do not use for storage

            timeoutId: null,
            lastEventAt: new Date().toISOString(),
            completed: false
        };
        this._scheduleMultiGenGuard(context, 60000);
        return context;
    }

    handleBridgeContentRequest(payload = {}) {
        if (!this._multiGenHistoryEnabled) {
            return;
        }
        try {
            const url = typeof payload?.url === 'string' ? payload.url : '';
            if (!url || !url.includes('/content')) {
                return;
            }
            this._handleImageContentRequest(url);
        } catch (error) {
            console.warn('[GVP][Interceptor] Failed handling bridge content request', error, payload);
        }
    }

    handleBridgeConversationRequest(payload = {}) {
        if (!this._multiGenHistoryEnabled) {
            return;
        }

        try {
            const requestId = typeof payload?.id === 'string' ? payload.id : null;
            if (requestId && this._bridgeRequestsById.has(requestId)) {
                return;
            }

            const requestUrl = typeof payload?.url === 'string' ? payload.url : '';
            if (!requestUrl || !requestUrl.includes('/rest/app-chat/conversations/new')) {
                return;
            }

            const method = (payload?.method || 'POST').toUpperCase();
            const bodyString = typeof payload?.body === 'string' ? payload.body : null;
            const payloadInfo = bodyString ? {
                rawText: bodyString,
                json: this._safeParseJson(bodyString)
            } : { rawText: null, json: null };

            const context = this._captureMultiGenRequestContext({
                requestUrl,
                method,
                payloadInfo,
                headers: payload?.headers || {},
                requestId: requestId || undefined
            });

            if (!context) {
                return;
            }

            this._bridgeRequestsById.set(context.requestId, context);
            console.log('[GVP][Interceptor] Bridge conversation captured', {
                requestId: context.requestId,
                imageId: context.imageId
            });

            if (this.uploadAutomationManager &&
                typeof this.uploadAutomationManager.notifyGenerationStarted === 'function') {
                try {
                    this.uploadAutomationManager.notifyGenerationStarted({
                        stage: 'bridge-request',
                        requestId: context.requestId,
                        imageId: context.imageId,
                        accountId: context.accountId || null,
                        url: requestUrl
                    });
                } catch (notifyError) {
                    console.warn('[GVP Upload] notifyGenerationStarted (bridge-request) failed', notifyError);
                }
            }
        } catch (error) {
            console.error('[GVP][Interceptor] Failed handling bridge conversation request', error, payload);
        }
    }

    handleBridgeConversationResponse(payload = {}) {
        try {
            const requestId = typeof payload?.id === 'string' ? payload.id : null;
            if (requestId) {
                const context = this._bridgeRequestsById.get(requestId) || null;
                if (context) {
                    if (this.uploadAutomationManager &&
                        typeof this.uploadAutomationManager.notifyGenerationStarted === 'function') {
                        try {
                            this.uploadAutomationManager.notifyGenerationStarted({
                                stage: 'bridge-response',
                                requestId,
                                imageId: context.imageId || null,
                                accountId: context.accountId || null,
                                status: payload?.status ?? null
                            });
                        } catch (notifyError) {
                            console.warn('[GVP Upload] notifyGenerationStarted (bridge-response) failed', notifyError);
                        }
                    }
                    if (this.uploadAutomationManager &&
                        typeof this.uploadAutomationManager.notifyUploadFailure === 'function' &&
                        payload?.ok === false) {
                        try {
                            this.uploadAutomationManager.notifyUploadFailure({
                                stage: 'bridge-response',
                                requestId,
                                status: payload?.status ?? null,
                                ok: false,
                                url: context.requestUrl || null
                            });
                        } catch (failureError) {
                            console.warn('[GVP Upload] notifyUploadFailure (bridge-response) failed', failureError);
                        }
                    }
                }
            }
        } catch (error) {
            console.warn('[GVP][Interceptor] Failed handling bridge conversation response', error, payload);
        }
    }

    /**
     * Handle multi-gen bridge progress event
     * @param {Object} payload 
     */
    handleBridgeProgress(payload) {
        if (!payload || !this.stateManager) return;
        const { imageId, progress, moderated } = payload;
        if (!imageId) return;

        // Multi-tab stability: use global sync check before updating local progress
        this.stateManager.appendMultiGenProgress(imageId, progress, { moderated });
    }

    /**
     * Handle multi-gen bridge video prompt completion
     * @param {Object} payload 
     */
    handleBridgeVideoPrompt(payload) {
        if (!payload || !this.stateManager) return;
        const { imageId, videoUrl, videoPrompt, moderated } = payload;
        if (!imageId) return;

        // Finalize 100% progress state
        this.stateManager.appendMultiGenProgress(imageId, 100, { videoUrl, videoPrompt, moderated });

        if (videoPrompt) {
            this._parseAndSetPromptData(videoPrompt);
        }
    }


    _scheduleMultiGenGuard(context, delayMs = 60000) {
        if (!context || typeof window === 'undefined' || typeof window.setTimeout !== 'function') {
            return;
        }
        if (context.timeoutId) {
            window.clearTimeout(context.timeoutId);
        }
        context.timeoutId = window.setTimeout(() => {
            context.timeoutId = null;
            if (context.completed) {
                return;
            }
            const reason = 'No progress updates received within timeout window';
            console.warn('[GVP][Interceptor] Multi-gen attempt timed out', {
                requestId: context.requestId,
                imageId: context.imageId,
                attemptId: context.attemptId
            });
            const shouldForceSuccess = (context.lastProgress ?? 0) >= 99 || !!context.videoUrl;
            const meta = shouldForceSuccess
                ? { status: 'success' }
                : context.moderated
                    ? { moderated: true, status: 'failed', error: reason }
                    : { status: 'failed', error: reason };
            this._finalizeMultiGenStream({ multiGen: context }, meta);
            if (context.requestId) {
                this._bridgeRequestsById.delete(context.requestId);
            }
        }, Math.max(15000, delayMs));
    }

    _handlePostGenerationAutomation(context, attempt) {
        if (!context || !attempt) {
            return;
        }
        if (attempt.status !== 'success') {
            return;
        }
        if (!this.uploadAutomationManager || !this.uploadAutomationManager.isEnabled()) {
            return;
        }
        Promise.resolve(this.uploadAutomationManager.handleGenerationSuccess({
            accountId: context.accountId || null,
            imageId: context.imageId || null,
            requestId: context.requestId || null
        })).catch((error) => {
            console.error('[GVP Upload] Generation automation failed', error);
        });
    }


    _handleMultiGenStreamPayload(payload, requestMetadata) {
        if (!this._multiGenHistoryEnabled || !payload) {
            return;
        }

        const meta = requestMetadata || {};
        const multiGen = meta.multiGen;
        if (!multiGen || !multiGen.imageId || !multiGen.attemptId) {
            return;
        }

        const imageId = multiGen.imageId;
        const attemptId = multiGen.attemptId;

        if (multiGen.accountId) {
            this._setActiveAccount(multiGen.accountId, 'stream-context');
        }

        const isImageEdit = !!(
            payload?.result?.response?.streamingImageGenerationResponse ||
            payload?.streamingImageGenerationResponse ||
            payload?.result?.streamingImageGenerationResponse
        );

        const streaming = 
            payload?.result?.response?.streamingVideoGenerationResponse ||
            payload?.streamingVideoGenerationResponse ||
            payload?.result?.streamingVideoGenerationResponse ||
            payload?.result?.response?.streamingImageGenerationResponse ||
            payload?.streamingImageGenerationResponse ||
            payload?.result?.streamingImageGenerationResponse;

        if (streaming) {
            multiGen.entryType = isImageEdit ? 'image-edit' : 'video';
            const progressRaw = streaming.progress ??
                streaming.progressValue ??
                streaming.progressPercent ??
                streaming.progress_percentage ??
                streaming.percentage ??
                streaming.percent ??
                (typeof streaming.status === 'object' ? streaming.status?.progress : null);
            const progressValue = this._coerceProgressValue(progressRaw);
            const moderated = streaming.moderated === true;
            const normalizedUrl = this._normalizeAssetUrl(streaming.videoUrl || streaming.imageUrl);

            if (progressValue !== null) {
                // GVP (v1.60.9): Track last non-moderated progress for moderation snapshots
                if (!moderated && progressValue < 100) {
                    multiGen.lastNonModeratedProgress = progressValue;
                }

                // GVP (v1.60.9): Beacon fires ONLY at terminal state (progress >= 100)
                // UI managers receive exactly one event per generation — no incremental updates
                if (progressValue >= 100) {
                    window.Logger?.info?.('Diagnostics', '[DIAG-V1.60.9] Terminal State Beacon Fired', { imageId, progressValue, moderated });
                    window.dispatchEvent(new CustomEvent('gvp:vidgen-beacon', {
                        detail: {
                            imageId,
                            progress: progressValue,
                            moderated,
                            videoUrl: normalizedUrl || undefined,
                            thumbnailUrl: streaming.thumbnailUrl || streaming.thumbnail_url || undefined,
                            lastProgress: moderated ? (multiGen.lastNonModeratedProgress ?? 0) : 100
                        }
                    }));
                }

                if (multiGen.lastProgress !== progressValue || moderated) {
                    this.stateManager.appendMultiGenProgress(imageId, attemptId, progressValue, {
                        moderated,
                        videoUrl: normalizedUrl || undefined,
                        videoId: streaming.videoId || streaming.imageId || undefined,
                        videoPrompt: streaming.videoPrompt || streaming.prompt || streaming.imagePrompt,
                        timestamp: new Date().toISOString(),
                        moderationReason: streaming.moderationReason || null
                    });
                    multiGen.lastProgress = progressValue;
                }
                multiGen.lastEventAt = new Date().toISOString();
                const guardDelay = progressValue >= 95 ? 150000 : progressValue >= 75 ? 120000 : 90000;
                this._scheduleMultiGenGuard(multiGen, guardDelay);

                // Set moderated state BEFORE finalizing the stream
                if (moderated) {
                    multiGen.moderated = true;
                }

                if (!multiGen.completed && progressValue >= 100) {
                    const finalizeMeta = moderated
                        ? { moderated: true }
                        : { status: 'success' };
                    this._finalizeMultiGenStream({ multiGen }, finalizeMeta);
                    if (multiGen.requestId) {
                        this._bridgeRequestsById.delete(multiGen.requestId);
                    }
                }
            }


            if (normalizedUrl) {
                multiGen.videoUrl = normalizedUrl;
                this.stateManager.updateMultiGenAttempt(imageId, attemptId, { videoUrl: normalizedUrl });
                const accountFromUrl = this._extractAccountIdFromVideoUrl(normalizedUrl);
                if (accountFromUrl) {
                    this._setActiveAccount(accountFromUrl, 'stream-video-url');
                }
            }

            if (streaming.videoId) {
                multiGen.videoId = streaming.videoId;
            }

            if (streaming.videoPrompt !== undefined) {
                multiGen.videoPrompt = streaming.videoPrompt;
                this.stateManager.updateMultiGenAttempt(imageId, attemptId, { videoPrompt: streaming.videoPrompt });
            }
        }

        const userResponse = payload?.result?.response?.userResponse;
        if (userResponse && typeof userResponse.message === 'string') {
            const cleanedPrompt = this._cleanupPromptText(userResponse.message);
            if (cleanedPrompt && cleanedPrompt !== multiGen.prompt) {
                multiGen.prompt = cleanedPrompt;
                this.stateManager.updateMultiGenAttempt(imageId, attemptId, { prompt: cleanedPrompt });
            }
        }

        const modelResponse = payload?.result?.response?.modelResponse;
        if (modelResponse && typeof modelResponse.message === 'string') {
            // multiGen.finalMessage = modelResponse.message; // PURGED AGAIN
        }

    }

    async _finalizeMultiGenStream(requestMetadata, { error } = {}) {
        if (!this._multiGenHistoryEnabled || !requestMetadata || !requestMetadata.multiGen) {
            return;
        }

        const data = requestMetadata.multiGen;
        if (data.completed) {
            return;
        }
        data.completed = true;
        
        if (data.timeoutId) {
            window.clearTimeout(data.timeoutId);
            data.timeoutId = null;
        }

        // Nuclear Strategy: Minimalist update -> upgraded to UVH Lean Scoreboard
        if (data.videoId || data.imageId) {
            // Reconstruct full attempt state from metadata map
            const meta = (data.videoId && this._bridgeMetadataByVideoId.get(data.videoId)) || {};
            
            const isModerated = !!data.moderated;
            const attemptData = {
                id: data.videoId || (`mod-attempt-${Date.now()}`),
                timestamp: Date.now(),
                status: isModerated ? 'moderated' : 'success',
                prompt: data.videoPrompt || data.prompt || null,
                parentPostId: data.imageId || meta.imageReference || null,
                mode: data.mode || meta.mode || null,
                modelName: data.modelName || meta.modelName || null,
                imageReference: data.imageReference || meta.imageReference || null
            };

            // Add branch-specific fields
            if (isModerated) {
                attemptData.lastProgress = data.lastNonModeratedProgress ?? meta.progress ?? 0;
                
                window._gvpModeratedUrls = window._gvpModeratedUrls || new Map();
                if (attemptData.parentPostId) {
                    window._gvpModeratedUrls.set(attemptData.parentPostId, {
                        moderatedAt: new Date(attemptData.timestamp).toISOString(),
                        lastProgress: attemptData.lastProgress,
                        moderatedPostId: attemptData.id,
                        sourceImageUrl: attemptData.imageReference
                    });
                }
            } else {
                attemptData.videoUrl = data.videoUrl || meta.url || null;
                // Note: thumbnailUrl and other /list specific fields will be merged in by Task C
            }

            // Determine generation type (video vs image-edit) directly from the stream inference
            const entryType = data.entryType || 'video';

            // Push lean scoreboard to UVH IndexedDB
            if (this.stateManager?.indexedDBManager?.appendAttemptToUnifiedEntry) {
                this.stateManager.indexedDBManager.appendAttemptToUnifiedEntry(data.imageId, entryType, attemptData)
                    .catch(err => window.Logger?.error('Interceptor', 'Failed UVH scoreboard append:', err));
            }

            // Keep legacy UI notification alive
            if (this.stateManager?.recordVideoGeneration && data.videoId) {
                this.stateManager.recordVideoGeneration(data.imageId, {
                    id: data.videoId,
                    url: attemptData.videoUrl,
                    prompt: attemptData.prompt,
                    timestamp: attemptData.timestamp,
                    moderated: isModerated
                });
            }

            // Terminal beacon — notify all live-update listeners (VideoPlayer, History, GalleryMini)
            // _dispatchVidGenBeacon guards on !videoId && !assetId; use attemptData.id which is always set.
            this._dispatchVidGenBeacon({
                videoId: attemptData.id,
                imageId: data.imageId,
                parentPostId: data.imageId,
                progress: isModerated ? (data.lastNonModeratedProgress ?? 0) : 100,
                moderated: isModerated,
                videoUrl: isModerated ? null : (data.videoUrl || null),
                thumbnailUrl: data.thumbnailUrl || null
            });
        }

        if (data.requestId) {
            this._bridgeRequestsById.delete(data.requestId);
            if (this.stateManager?.disarmMultiGenRequest) {
                this.stateManager.disarmMultiGenRequest(data.requestId);
            }
        }

        if (error) {
            console.error('[GVP][Interceptor] Multi-gen stream encountered error', error);
        }
    }

    _handleUploadFileResponse(responseJson) {
        if (!responseJson || typeof responseJson.fileUri !== 'string') {
            return;
        }
        const match = responseJson.fileUri.match(/users\/([0-9a-f-]{36})\/([0-9a-f-]{36})/i);
        if (!match) {
            console.warn('[GVP Upload] Unable to extract account/image from fileUri', responseJson.fileUri);
            return;
        }
        const [, accountId, imageId] = match;
        this._pendingUpload = {
            accountId,
            imageId,
            fileMetadataId: responseJson.fileMetadataId || null,
            fileUri: responseJson.fileUri,
            savedAt: new Date().toISOString(),
            fileName: responseJson.fileName || null
        };
        console.log('[GVP Upload] Pending upload registered', {
            accountId,
            imageId,
            fileMetadataId: responseJson.fileMetadataId || null,
            fileName: responseJson.fileName || null
        });

        if (this.uploadAutomationManager) {
            this.uploadAutomationManager.handleUploadResponse({
                accountId,
                imageId,
                fileUri: responseJson.fileUri || null,
                fileName: responseJson.fileName || null,
                fileMetadataId: responseJson.fileMetadataId || null
            });
        }
    }

    setPageInterceptorActive(isActive = true, context = {}) {
        const nextState = !!isActive;
        const previousState = this._pageInterceptorActive;
        this._pageInterceptorActive = nextState;

        console.log(`[GVP][Interceptor] Page interceptor ${nextState ? 'enabled' : 'disabled'}`, context);

        if (!nextState) {
            return;
        }

        try {
            const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            if (!w || typeof w.fetch !== 'function') {
                return;
            }

            const fetchMatchesWrapper = this._fetchWrapper && w.fetch === this._fetchWrapper;
            if (fetchMatchesWrapper && previousState === nextState) {
                return;
            }

            const reason = context?.source ? `page-bridge:${context.source}` : 'page-bridge';
            this._overrideFetch(w, {
                force: true,
                useCurrentAsOriginal: true,
                reason
            });
        } catch (error) {
            console.warn('[GVP][Interceptor] Failed to refresh fetch override after page interceptor activation:', error);
        }
    }

    // GVP MODIFICATION: Enhanced fetch override with lifecycle tracking
    _installFetchOverride() {
        window.Logger?.info('NetworkInterceptor', '🔧 Installing enhanced fetch override...');

        if (this.originalFetch) {
            console.log('[NetworkInterceptor] ⚠️ Fetch override already exists, skipping re-installation');
            return;
        }

        this.originalFetch = window.fetch;
        console.log('[NetworkInterceptor] 🔄 Storing original fetch reference');

        // Install enhanced interceptor
        window.fetch = async (...args) => {
            return await this._enhancedFetchInterceptor(...args);
        };

        console.log('[NetworkInterceptor] ✅ Enhanced fetch override installed and live');
    }

    _extractAccountIdFromString(value) {
        if (!value || typeof value !== 'string') {
            return null;
        }
        const match = value.match(/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        return match ? match[1] : null;
    }

    _extractAccountIdFromPayload(payload, depth = 0) {
        if (!payload || depth > 4) {
            return null;
        }

        if (typeof payload === 'string') {
            return this._extractAccountIdFromString(payload);
        }

        if (Array.isArray(payload)) {
            for (const entry of payload) {
                const candidate = this._extractAccountIdFromPayload(entry, depth + 1);
                if (candidate) {
                    return candidate;
                }
            }
            return null;
        }

        if (typeof payload === 'object') {
            const directId = payload.userId || payload.accountId || payload.creatorId;
            if (directId && typeof directId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(directId)) {
                return directId;
            }

            for (const value of Object.values(payload)) {
                const candidate = this._extractAccountIdFromPayload(value, depth + 1);
                if (candidate) {
                    return candidate;
                }
            }
        }

        return null;
    }

    /**
     * Extracts the x-userid from document.cookie safely.
     * @returns {string|null} The user ID or null if not found.
     */
    _extractUserIdFromCookie() {
        try {
            const match = document.cookie.match(/(?:^|; )x-userid=([^;]*)/);
            const userId = match ? decodeURIComponent(match[1]) : null;
            if (userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
                return userId;
            }
        } catch (e) {
            console.warn('[GVP][Interceptor] Error extracting x-userid from cookie:', e);
        }
        return null;
    }

    /**
     * Performs a prioritized startup account check.
     * 1. Checks x-userid cookie.
     * 2. If mismatch with state, or if triggered, performs a pulse sync (limit 10).
     * 3. Confirms account ID and triggers full sync if mismatch persists.
     */
    async performStartupAccountCheck(force = false) {
        // BUDGETED TIMEOUT (v1.46.13)
        // Ensure startup check doesn't block extension init forever if Grok's API is slow
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.warn('[GVP][Interceptor] ⏱️ Startup account check timed out (10s), continuing initialization...');
                resolve(false); 
            }, 10000);

            this._performStartupAccountCheckInternal(force)
                .then(result => {
                    clearTimeout(timeout);
                    resolve(result);
                })
                .catch(err => {
                    clearTimeout(timeout);
                    console.error('[GVP][Interceptor] ❌ Startup account check error:', err);
                    resolve(false);
                });
        });
    }

    async _performStartupAccountCheckInternal(force = false) {
        console.log('[GVP][Interceptor] 🔍 Starting internal startup account check...');
        const storedAccountId = this.stateManager?.state?.multiGenHistory?.activeAccountId;
        const cookieUserId = this._extractUserIdFromCookie();

        console.log('[GVP][Interceptor] 🍪 Cookie x-userid:', cookieUserId);
        console.log('[GVP][Interceptor] 💾 Stored accountId:', storedAccountId);

        // If we have a cookie ID and it matches stored, we are likely fine unless force sync
        if (!force && cookieUserId && storedAccountId === cookieUserId) {
            console.log('[GVP][Interceptor] ✅ Startup check: Account match via cookie. No pulse sync needed.');
            return true;
        }

        // If force or mismatch or no cookie, perform pulse sync (limit 10)
        console.log('[GVP][Interceptor] ⚡ Performing pulse sync (limit 10) to verify account...');
        const candidateId = cookieUserId || storedAccountId;

        if (!candidateId) {
            console.log('[GVP][Interceptor] 👤 No account detected yet, skipping startup sync');
            return false;
        }

        try {
            // Trigger a small sync just to get a fresh payload and confirm account ID
            console.log(`[GVP][Interceptor] 📡 Triggering startup-pulse for ${candidateId.slice(0, 8)}...`);
            const result = await this.triggerBulkGallerySync(candidateId, 'startup-pulse', 10);

            if (result && result.success) {
                console.log('[GVP][Interceptor] ✅ Startup pulse check completed.');
                return true;
            } else {
                console.warn('[GVP][Interceptor] ⚠️ Startup pulse check failed or returned no data.');
                return false;
            }
        } catch (error) {
            console.error('[GVP][Interceptor] ❌ Error during startup account check:', error);
            return false;
        }
    }

    _setActiveAccount(accountId, source = 'unknown') {
        if (!this._multiGenHistoryEnabled || !accountId) {
            return;
        }

        const changed = this.stateManager.setActiveMultiGenAccount(accountId);
        if (changed) {
            console.log(`[GVP][Interceptor] 🔄 Active account changed to: ${accountId} (Source: ${source})`);

            // Notify user via Toast (8s duration)
            if (window.UIManager?.instance) {
                window.UIManager.instance.showAccountSwitchToast(accountId, 8000);
            } else if (this.uiManager) {
                this.uiManager.showAccountSwitchToast(accountId, 8000);
            }

            // Trigger an automated bulk sync on account switch to ensure the IDB 
            // is populated for the new account immediately.
            // Using the new 2500 limit for account switches
            this.triggerBulkGallerySync(accountId, 'account-switch', 2500);
        }
    }

    async _processGalleryResponse(response, context = {}) {
        console.log('[GVP][Interceptor] 🗂️ Processing gallery response');
        if (!response) {
            console.warn('[GVP][Interceptor] ⚠️ No response provided for gallery processing');
            return;
        }

        try {
            const encoding = response.headers?.get?.('content-encoding') || '';
            let payloadText = '';
            // v1.21.43: Fix ReferenceError with localized localTopId check
            let localTopId = null;
            try {
                const idb = this.stateManager.indexedDBManager;
                const localTop = await idb.getAllUnifiedEntries(accountId, 1);
                localTopId = localTop?.[0]?.imageId || null;
                
                if (localTopId) {
                    window.Logger?.debug('NetworkInterceptor', 'Sentinel check synced', { top: localTopId });
                }
            } catch (_sentinelLocalErr) { /* non-fatal */ }

            if (encoding.includes('gzip')) {
                console.log('[GVP][Interceptor] 🗜️ Detected gzip encoded gallery response');
                if (typeof DecompressionStream === 'function' && response.body) {
                    const decompressedStream = response.body.pipeThrough(new DecompressionStream('gzip'));
                    payloadText = await new Response(decompressedStream).text();
                } else {
                    console.warn('[GVP][Interceptor] ⚠️ DecompressionStream unavailable; attempting Blob-based decode');
                    const buffer = await response.arrayBuffer();
                    payloadText = await this._gunzipArrayBuffer(buffer);
                }
            } else {
                payloadText = await response.text();
            }

            if (!payloadText) {
                console.warn('[GVP][Interceptor] ⚠️ Gallery payload empty after decoding');
                return;
            }

            let payload;
            try {
                payload = JSON.parse(payloadText);
            } catch (parseErr) {
                console.error('[GVP][Interceptor] ❌ Failed to parse gallery JSON:', parseErr);
                console.error('[GVP][Interceptor] ❌ Payload preview:', payloadText.substring(0, 200));
                return;
            }

            this._logGallerySchema(payload);
            this._ingestGalleryPayload(payload, { source: 'content-fetch', context });
        } catch (error) {
            console.error('[GVP][Interceptor] ❌ Failed handling gallery response:', error);
        }
    }

    ingestGalleryPayloadFromPage(payload, meta = {}) {
        console.log('[GVP][Interceptor] 📨 Gallery payload received from page context');
        if (!payload) {
            console.warn('[GVP][Interceptor] ⚠️ Empty gallery payload from page');
            return;
        }
        try {
            this._ingestGalleryPayload(payload, { source: 'page-bridge', ...meta });
        } catch (error) {
            console.error('[GVP][Interceptor] ❌ Failed ingesting gallery payload from page:', error);
        }
    }

    async fetchPostDetails(postId) {
        if (!postId) {
            console.error('[GVP][Interceptor] ❌ Cannot fetch post details - no ID provided');
            return null;
        }

        console.log(`[GVP][Interceptor] 🔄 Fetching details for post: ${postId}`);
        try {
            const fetchFn = this.originalFetch || window.fetch;
            const requestUrl = `https://grok.com/rest/media/post/get`;
            const payload = { id: postId };

            const response = await fetchFn(requestUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                console.error(`[GVP][Interceptor] ❌ /post/get failed with status ${response.status}`);
                return null;
            }

            const data = await response.json();
            console.log(`[GVP][Interceptor] ✅ Successfully fetched post details for ${postId}`);

            // Re-ingest this response down the normal pipeline so UI state stays sync'd
            try {
                this._processPostGetResponse(new Response(JSON.stringify(data)), { source: 'fetchPostDetails' });
            } catch (err) {
                console.warn('[GVP][Interceptor] ⚠️ Could not re-ingest fetchPostDetails payload:', err);
            }

            return data;
        } catch (error) {
            console.error('[GVP][Interceptor] ❌ Error in fetchPostDetails:', error);
            return null;
        }
    }

    async _gunzipArrayBuffer(buffer) {
        if (!(buffer instanceof ArrayBuffer)) {
            return '';
        }
        if (typeof DecompressionStream !== 'function') {
            console.warn('[GVP][Interceptor] ⚠️ DecompressionStream unsupported; returning binary placeholder');
            return new TextDecoder().decode(buffer);
        }
        try {
            const ds = new DecompressionStream('gzip');
            const decompressedStream = new Response(new Blob([buffer]).stream().pipeThrough(ds));
            return await decompressedStream.text();
        } catch (error) {
            console.error('[GVP][Interceptor] ❌ ArrayBuffer gunzip failed:', error);
            return '';
        }
    }

    _ingestGalleryPayload(payload, meta = {}) {
        if (!payload) return;
        // ─── ACCOUNT ID EXTRACTION (URL UUID Law) ────────────────────────────
        // The /list API is the most reliable source for the account UUID.
        const accountId = this._extractAccountIdFromPayload(payload);
        if (accountId) {
            this._setActiveAccount(accountId, 'list-payload');
        }
        // ─────────────────────────────────────────────────────────────────────

        const activeAccountId = accountId || this.stateManager?.state?.multiGenHistory?.activeAccountId;
        const posts = this._extractGalleryPosts(payload, activeAccountId);

        if (!Array.isArray(posts) || !posts.length) {
            console.log('[GVP][Interceptor] ℹ️ Gallery payload produced no posts');
            return;
        }

        this._applyGalleryDataset(posts, meta);
    }

    _applyGalleryDataset(posts, meta = {}) {
        if (!Array.isArray(posts) || !posts.length) return;

        window.Logger.info('NetworkInterceptor', '📋 Gallery dataset committed to state', {
            count: posts.length,
            source: meta?.source || 'unknown'
        });

        // ── 1. In-memory state write (synchronous, instant) ──────────────────
        // UIGalleryManager._identifyAndInject reads this on hover for the fast-path.
        if (this.stateManager) {
            try {
                const currentState = this.stateManager?.getState?.();
                if (!currentState) return;
                const galleryData = currentState.galleryData || {};
                const existingPosts = Array.isArray(galleryData.posts) ? galleryData.posts : [];

                // Merge: update existing entries by imageId, append new ones
                const postMap = new Map();
                existingPosts.forEach(p => { if (p?.imageId) postMap.set(p.imageId, p); });
                posts.forEach(p => { if (p?.imageId) postMap.set(p.imageId, p); });

                this.stateManager.setState({
                    galleryData: {
                        ...galleryData,
                        posts: Array.from(postMap.values()),
                        lastFetched: Date.now()
                    }
                });
            } catch (stateErr) {
                window.Logger.warn('NetworkInterceptor', '⚠️ Failed writing gallery posts to state', stateErr);
            }
        }

        // ── 2. IDB write (async, non-blocking) ───────────────────────────────
        // Backfills each /list post into the unified video history store.
        // v1.60.3: BULK OPTIMIZED to prevent IDB origin deadlock.
        const idb = this.stateManager?.indexedDBManager;
        if (idb) {
            (async () => {
                if (this._isIngestingUnified) {
                    window.Logger?.debug('NetworkInterceptor', '⏳ Already ingesting unified history. Skipping concurrent run.');
                    return;
                }

                try {
                    this._isIngestingUnified = true;

                    // v1.60.5: Proactive initialization with Fail-Fast check
                    if (!idb.initialized && !idb._initPromise) {
                        const ready = await idb.initialize();
                        if (!ready) return;
                    }


                    // Extract active account for mapping
                    const activeAccountId = this.stateManager?.state?.multiGenHistory?.activeAccountId;

                    const parentPairs = [];
                    for (const post of posts) {
                        if (!post?.imageId) continue;

                        if (post.originalPostId) {
                            let rootId = post.originalPostId;
                            const seen = new Set([post.imageId]);
                            for (let depth = 0; depth < 5; depth++) {
                                const parentPost = posts.find(p => p.imageId === rootId);
                                if (!parentPost || !parentPost.originalPostId) break;
                                if (seen.has(parentPost.imageId)) break;
                                seen.add(parentPost.imageId);
                                rootId = parentPost.originalPostId;
                            }
                            parentPairs.push({ childId: post.imageId, rootId });
                        }

                        if (!post.originalPostId) {
                            const rootId = post.imageId;
                            for (const edit of (post.editedImages || [])) {
                                const childId = edit?.imageId || edit?.id;
                                if (childId) parentPairs.push({ childId, rootId });
                            }
                            for (const vid of (post.videos || [])) {
                                const childId = vid?.videoId || vid?.id;
                                if (childId) parentPairs.push({ childId, rootId });
                            }
                        }
                    }

                    // 1. Batch-flush all parentIndex pairs
                    if (parentPairs.length > 0 && idb.setParentLinks) {
                        console.log(`[GVP][parentIndex] 📊 Writing ${parentPairs.length} links...`);
                        await idb.setParentLinks(parentPairs).catch(e => console.error('[GVP] setParentLinks failed', e));
                    }

                    // 2. BULK UVH PROCESSING (Single-Transaction optimized)
                    if (posts.length > 0) {
                        window.Logger.info('[GVP][Interceptor] 💾 Sending to IndexedDB bulk save (UVH_unifiedVideoHistory)', { count: posts.length, accountId: activeAccountId });
                        const stats = await idb.saveUnifiedEntriesBulk(posts, activeAccountId);
                        window.Logger.info('[GVP][Interceptor] ✅ Bulk save complete', stats);
                        
                        if (this.stateManager?.upsertUnifiedEntries && stats?.success > 0) {
                            this.stateManager.upsertUnifiedEntries(posts);
                        }
                        window.Logger.debug('NetworkInterceptor', `✅ IDB UVH backfill complete: ${stats.success}/${stats.total} saved`);
                    }
                } catch (err) {
                    window.Logger?.error('NetworkInterceptor', 'Fail during gallery backfill:', err);
                } finally {
                    this._isIngestingUnified = false;
                }
            })();
        }
    }

    async _processPostGetResponse(response, context = {}) {
        if (!response) {
            console.warn('[GVP][Interceptor] ⚠️ No response provided for post/get processing');
            return;
        }

        try {
            const payload = await response.json();
            const posts = this._collectPostCandidates(payload);

            if (!posts.length) {
                console.log('[GVP][Interceptor] ℹ️ No post entities discovered in /post/get payload');
                return;
            }

            posts.forEach(post => {
                const postId = post?.id || post?.postId || post?.assetId || null;
                if (!postId) {
                    return;
                }

                const selection = this._selectLastSuccessfulPrompt(post);
                if (!selection || !selection.prompt) {
                    console.log(`[GVP][Interceptor] ℹ️ No prompt candidate found for post ${postId}`);
                    return;
                }

                const metadata = {
                    timestamp: selection.timestamp || Date.now(),
                    videoUrl: selection.videoUrl || post?.videoUrl || null,
                    assetId: selection.assetId || post?.assetId || null,
                    rawPost: post,
                    moderated: selection.moderated,
                    context
                };

                this._applyPromptDataForPost(postId, selection.prompt, metadata);
            });
        } catch (error) {
            console.error('[GVP][Interceptor] ❌ Failed handling /post/get response:', error);
        }
    }

    /**
     * Ingest a batch of posts from /list API into the unified history.
     * This is used by triggerBulkGallerySync for clean startup synchronization.
     * 
     * @param {Array} rawPosts - Raw post items from the API
     * @returns {Promise<void>}
     */
    async _ingestListToUnified(rawPosts, explicitAccountId = null) {
        if (!Array.isArray(rawPosts) || !rawPosts.length) return;

        // 1. Extraction of Account ID (if not already set)
        // Often the first batch of /list contains the userId we need
        const candidatePost = rawPosts.find(p => p.userId || p.accountId);
        if (candidatePost) {
            const extractedId = candidatePost.userId || candidatePost.accountId;
            if (extractedId) {
                this._setActiveAccount(extractedId, 'bulk-sync-discovery');
            }
        }

        // v1.47.6 Isolation Pattern: Use explicit accountId if provided, fallback to state
        const activeAccountId = explicitAccountId || this.stateManager?.state?.multiGenHistory?.activeAccountId;
        window.Logger.info('NetworkInterceptor', `📥 Ingesting ${rawPosts.length} posts to unified history (Account: ${activeAccountId || 'global'})`);

        try {
            // 2. Normalize all posts
            const normalizedPosts = rawPosts
                .map(p => this._normalizeGalleryPost(p, activeAccountId))
                .filter(p => !!p?.imageId);

            if (!normalizedPosts.length) {
                window.Logger.warn('NetworkInterceptor', '⚠️ No valid posts found during batch normalization');
                return;
            }

            // 3. Commit to in-memory state (StateManager)
            this._applyGalleryDataset(normalizedPosts, { source: 'bulk-sync' });

            window.Logger.debug('NetworkInterceptor', `✅ Bulk sync normalization/state-update complete for ${normalizedPosts.length} posts`);
        } catch (error) {
            window.Logger.debug('NetworkInterceptor', '❌ Failed batch ingestion of /list posts', error);
        }
    }

    _collectPostCandidates(payload) {
        if (!payload || typeof payload !== 'object') {
            return [];
        }

        const candidates = [];
        const pushCandidate = (candidate) => {
            if (candidate && typeof candidate === 'object') {
                candidates.push(candidate);
            }
        };

        const direct = this._extractPostEntity(payload);
        pushCandidate(direct);

        const arrays = [
            payload?.result?.data?.posts,
            payload?.result?.posts,
            payload?.data?.posts,
            payload?.posts,
            payload?.mediaPosts
        ];

        arrays.forEach(collection => {
            if (Array.isArray(collection)) {
                collection.forEach(pushCandidate);
            }
        });

        const seen = new Set();
        const unique = [];

        candidates.forEach(candidate => {
            const key = candidate?.id || candidate?.postId || candidate?.assetId || null;
            if (key && seen.has(key)) {
                return;
            }
            if (key) {
                seen.add(key);
            }
            unique.push(candidate);
        });

        return unique.filter(Boolean);
    }

    _extractPostEntity(payload) {
        if (!payload || typeof payload !== 'object') {
            return null;
        }

        return payload?.result?.data?.post
            || payload?.result?.post
            || payload?.data?.post
            || payload?.post
            || null;
    }

    _selectLastSuccessfulPrompt(post) {
        if (!post || typeof post !== 'object') {
            return null;
        }

        const childPosts = Array.isArray(post.childPosts) ? post.childPosts : [];
        const candidates = [];

        childPosts.forEach(child => {
            const prompt = this._extractPromptString(child);
            if (!prompt) {
                return;
            }

            const timestamp = this._normalizeTimestamp(
                child.completedAt
                || child.updatedAt
                || child.lastUpdated
                || child.finishedAt
                || child.createdAt
                || child.timestamp
            ) || Date.now();

            candidates.push({
                prompt,
                timestamp,
                success: this._isSuccessfulChild(child),
                moderated: Boolean(child.moderated || child.isModerated),
                videoUrl: child.videoUrl || child.mediaUrl || child.resultVideoUrl || null,
                assetId: child.assetId || child.mediaAssetId || child.resultAssetId || child.id || null,
                child
            });
        });

        if (!candidates.length) {
            const fallbackPrompt = this._extractPromptString(post);
            if (!fallbackPrompt) {
                return null;
            }

            const fallbackTimestamp = this._normalizeTimestamp(
                post.updatedAt
                || post.lastUpdated
                || post.completedAt
                || post.createdAt
                || post.timestamp
            ) || Date.now();

            return {
                prompt: fallbackPrompt,
                timestamp: fallbackTimestamp,
                success: !Boolean(post.moderated || post.isModerated),
                moderated: Boolean(post.moderated || post.isModerated),
                videoUrl: post.videoUrl || post.mediaUrl || null,
                assetId: post.assetId || null,
                child: null
            };
        }

        const successful = candidates.filter(candidate => candidate.success);
        if (successful.length) {
            const sortedSuccessful = [...successful].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            return sortedSuccessful[0];
        }

        const sortedAll = [...candidates].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return sortedAll[0] || null;
    }

    _extractPromptString(node) {
        if (!node || typeof node !== 'object') {
            return '';
        }

        const promptFields = ['originalPrompt', 'videoPrompt', 'prompt', 'jsonPrompt'];

        for (const field of promptFields) {
            if (!Object.prototype.hasOwnProperty.call(node, field)) {
                continue;
            }

            const value = node[field];

            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }

            if (value && typeof value === 'object') {
                try {
                    return JSON.stringify(value);
                } catch (error) {
                    console.warn('[GVP][Interceptor] ⚠️ Failed stringifying prompt object field:', field, error);
                }
            }
        }

        return '';
    }

    _isSuccessfulChild(child) {
        if (!child || typeof child !== 'object') {
            return false;
        }

        if (child.moderated || child.isModerated) {
            return false;
        }

        if (typeof child.success === 'boolean') {
            return child.success;
        }

        if (typeof child.wasSuccessful === 'boolean') {
            return child.wasSuccessful;
        }

        if (typeof child.isSuccess === 'boolean') {
            return child.isSuccess;
        }

        const statusFields = [
            child.status,
            child.generationStatus,
            child.progressStatus,
            child.stage,
            child.state
        ];

        const status = statusFields
            .map(value => (typeof value === 'string' ? value : ''))
            .find(value => value.trim().length);

        if (status) {
            const lowered = status.toLowerCase();
            if (['success', 'successful', 'completed', 'complete', 'finished', 'ready'].some(token => lowered.includes(token))) {
                return true;
            }
            if (['moderated', 'failed', 'error', 'refused', 'rejected', 'cancelled', 'canceled'].some(token => lowered.includes(token))) {
                return false;
            }
        }

        const normalizedProgress = this._coerceProgressValue(child.progress);
        if (normalizedProgress !== null && normalizedProgress >= 100) {
            return true;
        }

        return false;
    }

    _applyPromptDataForPost(postId, prompt, metadata = {}) {
        if (!prompt || typeof prompt !== 'string') {
            return;
        }

        const trimmedPrompt = prompt.trim();
        if (!trimmedPrompt) {
            return;
        }

        this._parseAndSetPromptData(trimmedPrompt);

        if (postId) {
            console.log(`[GVP][Interceptor] ✅ Applied originalPrompt for post ${postId}`);
        } else {
            console.log('[GVP][Interceptor] ✅ Applied originalPrompt without post identifier');
        }
    }

    _extractGalleryPosts(payload, accountId = null) {
        if (!payload) return [];

        const candidateArrays = [];

        if (Array.isArray(payload)) candidateArrays.push(payload);

        const result = payload.result || payload.data || {};
        if (Array.isArray(result)) candidateArrays.push(result);
        if (result?.posts) candidateArrays.push(result.posts);
        if (result?.data?.posts) candidateArrays.push(result.data.posts);
        if (payload?.posts) candidateArrays.push(payload.posts);
        if (payload?.data?.posts) candidateArrays.push(payload.data.posts);
        if (payload?.mediaPosts) candidateArrays.push(payload.mediaPosts);

        const posts = candidateArrays.find(Array.isArray) || [];
        if (!posts.length) return [];

        return posts
            .map(post => this._normalizeGalleryPost(post, accountId))
            .filter(Boolean);
    }

    _logGallerySchema(payload) {
        if (this._hasLoggedGallerySchema) {
            return;
        }

        try {
            const posts = this._extractGalleryPosts(payload);
            if (!Array.isArray(posts) || !posts.length) {
                return;
            }

            const samplePost = posts[0]?.raw || posts[0];
            if (!samplePost || typeof samplePost !== 'object') {
                return;
            }

            const promptCandidates = [];
            const visited = new WeakSet();

            const recordCandidate = (path, value) => {
                const preview = Array.isArray(value)
                    ? value.slice(0, 3)
                    : value;
                promptCandidates.push({ path, type: Array.isArray(value) ? 'array' : typeof value, preview });
            };

            const explore = (node, path = '', depth = 0) => {
                if (!node || typeof node !== 'object' || visited.has(node) || depth > 4) {
                    return;
                }
                visited.add(node);

                if (Array.isArray(node)) {
                    node.forEach((entry, index) => {
                        const nextPath = path ? `${path}[${index}]` : `[${index}]`;
                        if (typeof entry === 'string' && entry.trim()) {
                            recordCandidate(nextPath, entry);
                        } else if (entry && typeof entry === 'object') {
                            explore(entry, nextPath, depth + 1);
                        }
                    });
                    return;
                }

                Object.entries(node).forEach(([key, value]) => {
                    const lowered = key.toLowerCase();
                    const nextPath = path ? `${path}.${key}` : key;

                    if (lowered.includes('prompt')) {
                        recordCandidate(nextPath, value);
                    }

                    if (value && typeof value === 'object') {
                        explore(value, nextPath, depth + 1);
                    }
                });
            };

            explore(samplePost, 'root', 0);

            console.log('[GVP][Interceptor] 🔍 Gallery sample keys:', Object.keys(samplePost).slice(0, 25));
            console.log('[GVP][Interceptor] 🔍 Gallery prompt candidates:', promptCandidates.slice(0, 10));
        } catch (error) {
            console.warn('[GVP][Interceptor] ⚠️ Failed logging gallery schema', error);
        } finally {
            this._hasLoggedGallerySchema = true;
        }
    }

    _normalizeGalleryPost(post, accountId = null) {
        if (!post || typeof post !== 'object') return null;

        const imageId = post.id || post.postId || post.assetId || null;
        if (!imageId) return null;

        const activeAccountId = accountId || post.userId || post.accountId || this.stateManager?.state?.multiGenHistory?.activeAccountId || null;

        const createdAt = this._normalizeTimestamp(post.createdAt || post.createdDate || post.createTime || post.timestamp);
        const updatedAt = this._normalizeTimestamp(post.updatedAt || post.lastUpdated || post.lastAccessed);
        const childCount = typeof post.childPostsCount === 'number'
            ? post.childPostsCount
            : (Array.isArray(post.childPosts) ? post.childPosts.length : (post.childCount || 0));

        const previewUrl = this._resolveImageUrl(post);
        const fullUrl = this._resolveImageUrl(post, { preferFull: true }) || previewUrl;

        // ─── Extract edited images and videos from the /list payload. ───
        // The user confirmed: lump `post.images[]` and `post.childPosts[]` together for edited images.
        // `post.videos[]` and video entries in `post.childPosts[]` go into the `videos` array.
        const editedImagesMap = new Map();
        const videosMap = new Map();

        const processImage = (img) => {
            if (!img?.id) return;
            // Allow the root self-entry (images[0] where id === post id, no originalPostId).
            // Block only true circular duplicates: same ID AND it's actually an edit (has originalPostId).
            const isSelfEntry = img.id === imageId;
            const isRootSelfEntry = isSelfEntry && !img.originalPostId && !img.parentId;
            if (isSelfEntry && !isRootSelfEntry) return; // Block non-root self-duplicates

            const url = img.mediaUrl || img.imageUrl || img.url || null;
            if (!url) return;
            if (!editedImagesMap.has(img.id)) {
                editedImagesMap.set(img.id, {
                    id: img.id,
                    url,
                    thumbnailUrl: img.thumbnailImageUrl || img.thumbnailUrl || null,
                    prompt: img.originalPrompt || img.prompt || '',
                    createdAt: this._normalizeTimestamp(img.createTime || img.createdAt) || Date.now(),
                    originalPostId: img.originalPostId || img.parentId || null, // null for root
                    isRoot: isRootSelfEntry  // flag for Mini-UI badge rendering
                });
            }
        };

        const processVideo = (vid) => {
            if (!vid?.id) return;
            const url = vid.mediaUrl || vid.videoUrl || null;
            if (!url) return;
            if (!videosMap.has(vid.id)) {
                videosMap.set(vid.id, {
                    id: vid.id,
                    url,
                    thumbnailUrl: vid.thumbnailImageUrl || vid.thumbnailUrl || null,
                    prompt: vid.originalPrompt || vid.prompt || '',
                    duration: vid.videoDuration || null,
                    resolution: vid.resolutionName || null,
                    createdAt: this._normalizeTimestamp(vid.createTime || vid.createdAt) || Date.now(),
                    originalPostId: vid.originalPostId || vid.parentId || post.id || null
                });
            }
        };

        // 1. Process post.images (usually contains edited image variants)
        if (Array.isArray(post.images)) {
            post.images.forEach(processImage);
        }

        // 2. Process post.videos (usually contains video variants)
        if (Array.isArray(post.videos)) {
            post.videos.forEach(processVideo);
        }

        // 3. Process post.childPosts (legacy/compat layer that often contains both)
        if (Array.isArray(post.childPosts)) {
            post.childPosts.forEach(child => {
                if (!child?.id || child.id === imageId) return;

                // Identify if it's a video
                const isVideo = child.mediaType === 'MEDIA_POST_TYPE_VIDEO' || !!child.videoUrl || !!child.videoDuration;

                if (isVideo) {
                    processVideo(child);
                } else {
                    processImage(child);
                }
            });
        }

        const editedImages = Array.from(editedImagesMap.values());
        const videos = Array.from(videosMap.values());

        return {
            imageId,
            imageUrl: fullUrl || null,
            thumbnailUrl: previewUrl || fullUrl || null,
            jsonCount: childCount,
            lastAccessed: updatedAt || createdAt || Date.now(),
            createdAt: createdAt || Date.now(),
            moderated: Boolean(post.moderated || post.isModerated),
            likeStatus: Boolean(
                post.likeStatus || post.isLiked || post.liked
                || post.userInteractionStatus?.likeStatus
            ),
            title: post.title || post.caption || post.originalPrompt || post.prompt || '',
            modes: this._extractModes(post),
            tags: post.tags || [],
            originalPostId: post.originalPostId || post.parentId || null,
            accountId: activeAccountId, // Critical for account isolation
            editedImages,   // Array of { id, url, prompt, createdAt } — image edits from /list
            videos          // Array of { id, url, thumbnailUrl, prompt, duration } — videos from /list
        };
    }

    _resolveImageUrl(post, options = {}, visited = new WeakSet()) {
        if (!post || typeof post !== 'object') return null;
        if (visited.has(post)) return null;
        visited.add(post);

        const preferFull = Boolean(options.preferFull);

        const coerceString = (value) => {
            if (typeof value === 'string') {
                const trimmed = value.trim();
                return trimmed ? trimmed : null;
            }
            return null;
        };

        const tryValue = (value) => {
            if (!value) return null;
            if (typeof value === 'string') {
                return coerceString(value);
            }
            if (Array.isArray(value)) {
                for (const entry of value) {
                    const candidate = tryValue(entry);
                    if (candidate) return candidate;
                }
                return null;
            }
            if (typeof value === 'object') {
                // common nested url fields
                const directNested = coerceString(value.url)
                    || coerceString(value.src)
                    || coerceString(value.href)
                    || coerceString(value.cdnUrl)
                    || coerceString(value.cdnUri)
                    || coerceString(value.downloadUrl)
                    || coerceString(value.signedUrl)
                    || coerceString(value.sourceUrl)
                    || coerceString(value.originalUrl);
                if (directNested) return directNested;
                return this._resolveImageUrl(value, options, visited);
            }
            return null;
        };

        const previewKeys = [
            'thumbnailUrl', 'previewUrl', 'previewImageUrl', 'previewImage',
            'coverImageUrl', 'coverUrl', 'cardImageUrl', 'thumbUrl', 'thumb',
            'primaryThumbnailUrl', 'smallImageUrl'
        ];
        const fullKeys = [
            'imageUrl', 'mediaUrl', 'url', 'sourceUrl', 'publicUrl',
            'signedUrl', 'downloadUrl', 'assetUrl', 'cdnUrl', 'cdnUri',
            'originalUrl', 'fullImageUrl', 'largeImageUrl'
        ];

        const keyOrder = preferFull ? [...fullKeys, ...previewKeys] : [...previewKeys, ...fullKeys];

        for (const key of keyOrder) {
            if (!Object.prototype.hasOwnProperty.call(post, key)) continue;
            const candidate = tryValue(post[key]);
            if (candidate) return candidate;
        }

        const objectKeys = [
            'thumbnail', 'preview', 'previewImage', 'coverImage', 'image',
            'mediaFile', 'mediaAsset', 'asset', 'primaryImage', 'featuredImage'
        ];
        for (const key of objectKeys) {
            if (!post[key]) continue;
            const candidate = tryValue(post[key]);
            if (candidate) return candidate;
        }

        const arrayKeys = [
            'thumbnails', 'previewImages', 'images', 'media', 'mediaItems',
            'assets', 'files', 'resources', 'previews', 'galleryItems',
            'mediaList', 'mediaFiles', 'attachments'
        ];
        for (const key of arrayKeys) {
            if (!post[key]) continue;
            const candidate = tryValue(post[key]);
            if (candidate) return candidate;
        }

        const graphCollections = [
            post.media?.edges,
            post.media?.nodes,
            post.assets?.edges,
            post.assets?.nodes
        ];
        for (const collection of graphCollections) {
            const candidate = tryValue(collection);
            if (candidate) return candidate;
        }

        if (Array.isArray(post.childPosts) && post.childPosts.length) {
            for (const child of post.childPosts) {
                const candidate = this._resolveImageUrl(child, options, visited);
                if (candidate) return candidate;
            }
        }

        if (Array.isArray(post.children) && post.children.length) {
            for (const child of post.children) {
                const candidate = this._resolveImageUrl(child, options, visited);
                if (candidate) return candidate;
            }
        }

        if (post.parent && typeof post.parent === 'object') {
            const candidate = this._resolveImageUrl(post.parent, options, visited);
            if (candidate) return candidate;
        }

        return null;
    }

    _normalizeTimestamp(value) {
        if (!value) return null;
        try {
            const date = new Date(value);
            return isNaN(date.getTime()) ? null : date.getTime();
        } catch (e) {
            return null;
        }
    }

    _extractModes(post) {
        if (!post) return [];
        if (Array.isArray(post.childModes)) return post.childModes;
        if (Array.isArray(post.modes)) return post.modes;
        if (post.childPosts && Array.isArray(post.childPosts)) {
            const nestedModes = new Set();
            post.childPosts.forEach(child => {
                if (Array.isArray(child.modes)) {
                    child.modes.forEach(mode => nestedModes.add(mode));
                }
                if (Array.isArray(child.childModes)) {
                    child.childModes.forEach(mode => nestedModes.add(mode));
                }
            });
            return Array.from(nestedModes);
        }
        return [];
    }

    start() {
        try {
            const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            window.Logger?.debug('NetworkInterceptor', '[GVP][Interceptor] 🔁 start() called - preparing fetch override');
            if (!w || !w.fetch) {
                window.Logger?.warn('NetworkInterceptor', '[GVP][Interceptor] ⚠️ Window context missing fetch!');
            } else {
                window.Logger?.debug('NetworkInterceptor', '[GVP][Interceptor] ✅ Window fetch detected:', typeof w.fetch);
            }
            this._overrideFetch(w, {
                force: true,
                useCurrentAsOriginal: true,
                reason: 'start'
            });
            if (this.uploadAutomationManager) {
                this.uploadAutomationManager.start();
            }
        } catch (error) {
            console.error('[GVP] Network interceptor start failed:', error);
        }
    }

    _overrideFetch(w, options = {}) {
        const {
            force = false,
            useCurrentAsOriginal = false,
            reason = 'unspecified'
        } = options || {};

        try {
            const targetWindow = w || (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
            if (!targetWindow || typeof targetWindow.fetch !== 'function') {
                console.warn('[GVP][Interceptor] ⚠️ Unable to install fetch override - fetch missing on target window');
                return;
            }

            const currentFetchFn = targetWindow.fetch;
            const isCurrentWrapper = this._fetchWrapper && currentFetchFn === this._fetchWrapper;

            if (!force && isCurrentWrapper) {
                console.log('[GVP][Interceptor] ⚙️ Fetch override already active; skipping reinstall');
                return;
            }

            if (isCurrentWrapper && force) {
                console.log('[GVP][Interceptor] ⚙️ Fetch wrapper already applied; no reinstall needed');
                return;
            }

            const boundFetch = currentFetchFn.bind(targetWindow);

            if (useCurrentAsOriginal || !this.originalFetch || !this._fetchOverrideInstalled) {
                this.originalFetch = boundFetch;
            }

            console.log('[GVP][Interceptor] 🔧 _overrideFetch invoked', { reason, originalType: typeof this.originalFetch });
            console.log('[GVP][Interceptor] 📄 File context:', 'src/content/managers/NetworkInterceptor.js');

            const interceptor = this;

            const fetchWrapper = async function (...args) {
                console.log('[GVP][Interceptor] 🚨 fetch wrapper triggered');
                const requestInfo = args[0];
                const requestInit = args[1] || {};

                let requestUrl = '';
                if (typeof requestInfo === 'string') {
                    requestUrl = requestInfo;
                } else if (requestInfo && typeof requestInfo.url === 'string') {
                    requestUrl = requestInfo.url;
                }

                const options = requestInit;
                const method = (options.method || (requestInfo && requestInfo.method) || 'GET').toUpperCase();
                const pageInterceptorActive = interceptor._pageInterceptorActive === true;

                // Account ID is captured via two reliable hooks:
                // 1. _handleImageContentRequest() fires below for /content URLs (extracts /users/<acct>/<uuid>/content)
                // 2. _ingestGalleryPayload() fires later for /list responses (extracts payload[].userId)
                // _syncActiveAccountFromCookies() was a hallucinated method — removed.

                try {
                    console.log('[GVP][Interceptor] 🔍 Request details:', {
                        url: requestUrl || requestInfo,
                        method,
                        hasBody: !!options.body || (requestInfo && typeof requestInfo.text === 'function'),
                        callerStack: new Error().stack?.split('\n').slice(1, 4)
                    });
                } catch (logErr) {
                    console.warn('[GVP][Interceptor] ⚠️ Failed to log request details:', logErr);
                }

                if (requestUrl) {
                    console.log('[GVP][Interceptor] 🌐 FETCH URL:', requestUrl.substring(0, 150));
                }

                if (options && options.headers) {
                    Object.assign(interceptor.commonHeaders, options.headers);
                    console.log('[GVP][Interceptor] 🧾 Headers captured keys:', Object.keys(options.headers));
                }

                console.log('[GVP][Interceptor] 🛠 Method normalized:', method);

                if (interceptor._multiGenHistoryEnabled &&
                    method === 'GET' &&
                    typeof requestUrl === 'string' &&
                    requestUrl.includes('/content')) {
                    interceptor._handleImageContentRequest(requestUrl);
                }

                let payloadInfo = null;
                if (interceptor._multiGenHistoryEnabled &&
                    method === 'POST' &&
                    typeof requestUrl === 'string' &&
                    requestUrl.includes('/rest/app-chat/conversations/new')) {
                    payloadInfo = await interceptor._readRequestPayload(
                        requestInfo instanceof Request ? requestInfo : null,
                        options
                    );
                }

                // GVP MODIFICATION: Enhanced request logging
                if (options && options.body) {
                    try {
                        const bodyStr = options.body.toString();
                        console.log(`[NetworkInterceptor] Request body preview:`, bodyStr.substring(0, 200));

                        // Look for fileAttachments in body
                        if (bodyStr.includes('fileAttachments')) {
                            console.log(`[NetworkInterceptor] Found fileAttachments in request body`);
                            try {
                                const bodyJson = JSON.parse(bodyStr);
                                if (bodyJson.fileAttachments && bodyJson.fileAttachments.length > 0) {
                                    console.log(`[NetworkInterceptor] File attachments:`, bodyJson.fileAttachments);
                                }
                            } catch (e) {
                                console.log(`[NetworkInterceptor] Could not parse request body as JSON:`, e);
                            }
                        }
                    } catch (e) {
                        console.log(`[NetworkInterceptor] Could not read request body:`, e);
                    }
                }

                // ENHANCED: Capture request metadata for generation tracking
                let requestMetadata = {};

                const headerSnapshot = {};
                const collectHeaders = (source) => {
                    if (!source) return;
                    if (typeof Headers !== 'undefined' && source instanceof Headers) {
                        source.forEach((value, key) => {
                            headerSnapshot[key.toLowerCase()] = value;
                        });
                        return;
                    }
                    if (Array.isArray(source)) {
                        source.forEach(entry => {
                            if (Array.isArray(entry) && entry.length >= 2) {
                                headerSnapshot[String(entry[0]).toLowerCase()] = entry[1];
                            }
                        });
                        return;
                    }
                    if (typeof source === 'object') {
                        Object.entries(source).forEach(([key, value]) => {
                            headerSnapshot[String(key).toLowerCase()] = value;
                        });
                    }
                };

                collectHeaders(options?.headers);
                if (requestInfo instanceof Request && requestInfo.headers) {
                    collectHeaders(requestInfo.headers);
                }

                if (Object.keys(headerSnapshot).length) {
                    requestMetadata.headers = headerSnapshot;
                }

                const isGenerationRequest = method === 'POST' &&
                    typeof requestUrl === 'string' &&
                    requestUrl.includes('/rest/app-chat/conversations/new');

                if (interceptor._multiGenHistoryEnabled && isGenerationRequest) {
                    const multiGenContext = interceptor._captureMultiGenRequestContext({
                        requestUrl,
                        method,
                        payloadInfo,
                        headers: headerSnapshot
                    });
                    if (multiGenContext) {
                        requestMetadata.multiGen = multiGenContext;
                    }
                }

                if (isGenerationRequest &&
                    interceptor.uploadAutomationManager &&
                    typeof interceptor.uploadAutomationManager.notifyGenerationStarted === 'function') {
                    try {
                        interceptor.uploadAutomationManager.notifyGenerationStarted({
                            stage: 'request',
                            url: requestUrl,
                            headers: headerSnapshot,
                            requestId: requestMetadata?.multiGen?.requestId ||
                                requestMetadata?.requestId || null
                        });
                    } catch (notifyError) {
                        console.warn('[GVP Upload] notifyGenerationStarted (request) failed', notifyError);
                    }
                }

                // Inject spicy mode into request
                if (options && typeof options.body === 'string' &&
                    method === 'POST' &&
                    typeof requestUrl === 'string' &&
                    (requestUrl.includes('/conversations/new') || requestUrl.includes('/responses'))) {
                    try {
                        let body = JSON.parse(options.body);
                        const state = interceptor.stateManager?.getState?.();
                        if (!state) {
                            console.warn('[GVP][Interceptor] ⚠️ State missing in fetch wrapper, forwarding to original call.');
                            return interceptor.originalFetch(...args);
                        }

                        // ENHANCED: Capture imageId from fileAttachments
                        if (body.fileAttachments && body.fileAttachments.length > 0) {
                            requestMetadata.imageId = body.fileAttachments[0];
                            requestMetadata.imageReference = body.message?.match(/https:\/\/assets\.grok\.com[^\s]+/)?.[0];
                            console.log('[GVP] 📸 Captured imageId from request:', requestMetadata.imageId);
                        }

                        // Capture request ID from headers
                        if (options.headers && options.headers['x-xai-request-id']) {
                            requestMetadata.requestId = options.headers['x-xai-request-id'];
                        }

                        if (!pageInterceptorActive && body.message && typeof body.message === 'string') {
                            const MODE_TOKEN_REGEX = /--mode=\S+/gi;
                            const existingModes = body.message.match(MODE_TOKEN_REGEX) || [];
                            const cleanedMessage = body.message.replace(MODE_TOKEN_REGEX, ' ')
                                .replace(/\s{2,}/g, ' ')
                                .trim();

                            if (state.generation.useSpicy) {
                                body.message = `${cleanedMessage} --mode=extremely-spicy-or-crazy`.trim();
                                console.log('[GVP Spicy] ??? Injected spicy mode into message');
                            } else if (existingModes.length > 0) {
                                body.message = `${cleanedMessage} ${existingModes[0]}`.trim();
                                console.log('[GVP Spicy] Normal mode - preserved existing mode', existingModes[0]);
                            } else {
                                body.message = `${cleanedMessage} --mode=normal`.trim();
                                console.log('[GVP Spicy] Set default mode to normal');
                            }
                        } else if (!pageInterceptorActive) {
                            console.warn('[GVP Spicy] No message field found in request body');
                        }

                        if (!pageInterceptorActive) {
                            options.body = JSON.stringify(body);
                            args[1] = options;

                            const MODE_TOKEN_REGEX = /--mode=\S+/gi;
                            const finalModes = body.message.match(MODE_TOKEN_REGEX) || [];
                            console.log('[GVP Spicy] Final mode tokens:', finalModes);
                        }
                    } catch (error) {
                        console.error('[GVP] Body modification error:', error);
                    }
                }

                // Call original fetch
                let response;
                try {
                    // Propagate abort signal if present in the input Request or options
                    const signal = options.signal || (requestInfo instanceof Request ? requestInfo.signal : undefined);

                    // Inject signal into args if not already explicitly handled by bound originalFetch
                    if (signal && !options.signal) {
                        options.signal = signal;
                    }

                    response = await interceptor.originalFetch(...args);
                } catch (fetchError) {
                    if (fetchError.name === 'AbortError') {
                        console.log('[GVP][Interceptor] 🛑 Fetch aborted by user/system');
                    } else {
                        console.error('[GVP][Interceptor] ❌ Original fetch threw error', fetchError);
                    }

                    if (typeof requestUrl === 'string' &&
                        requestUrl.includes('/rest/app-chat/upload-file') &&
                        method === 'POST' &&
                        interceptor.uploadAutomationManager &&
                        typeof interceptor.uploadAutomationManager.handleUploadFailure === 'function') {
                        interceptor.uploadAutomationManager.handleUploadFailure({
                            error: fetchError,
                            ok: false,
                            status: null
                        });
                    }
                    throw fetchError;
                }
                console.log('[GVP][Interceptor] 📥 Original fetch resolved - status:', response?.status, 'url:', requestUrl || requestInfo);

                let handledTarget = false;

                if (typeof requestUrl === 'string' &&
                    requestUrl.includes('/rest/app-chat/upload-file') &&
                    method === 'POST') {
                    handledTarget = true;
                    try {
                        const uploadClone = response.clone();
                        let uploadJson = null;
                        let parseError = null;
                        try {
                            uploadJson = await uploadClone.json();
                        } catch (error) {
                            parseError = error;
                        }

                        if (response?.ok) {
                            if (uploadJson) {
                                interceptor._handleUploadFileResponse(uploadJson);
                            } else {
                                console.warn('[GVP Upload] Upload response OK but parse failed', parseError);
                                if (interceptor.uploadAutomationManager) {
                                    interceptor.uploadAutomationManager.handleUploadResponse({
                                        ok: true,
                                        status: response?.status ?? null
                                    });
                                }
                            }
                        } else if (interceptor.uploadAutomationManager &&
                            typeof interceptor.uploadAutomationManager.handleUploadFailure === 'function') {
                            interceptor.uploadAutomationManager.handleUploadFailure({
                                status: response?.status ?? null,
                                ok: response?.ok ?? false,
                                response: uploadJson,
                                error: parseError
                            });
                        }
                    } catch (error) {
                        console.warn('[GVP Upload] Failed processing upload-file response', error);
                        if (interceptor.uploadAutomationManager &&
                            typeof interceptor.uploadAutomationManager.handleUploadFailure === 'function') {
                            interceptor.uploadAutomationManager.handleUploadFailure({
                                status: response?.status ?? null,
                                ok: response?.ok ?? false,
                                error
                            });
                        }
                    }
                }

                // Intercept /conversations/new response
                if (typeof requestUrl === 'string' &&
                    requestUrl.includes('/rest/app-chat/conversations/new') &&
                    method === 'POST') {
                    handledTarget = true;
                    console.log('[GVP][Interceptor] 🎯 Matched target endpoint /rest/app-chat/conversations/new');
                    console.log('[GVP][Interceptor] 📊 Response meta:', {
                        status: response?.status,
                        ok: response?.ok,
                        type: response?.type,
                        redirected: response?.redirected
                    });

                    if (!response?.ok && interceptor.uploadAutomationManager &&
                        typeof interceptor.uploadAutomationManager.notifyUploadFailure === 'function') {
                        interceptor.uploadAutomationManager.notifyUploadFailure({
                            status: response?.status ?? null,
                            ok: response?.ok ?? false,
                            url: requestUrl,
                            stage: 'conversation',
                            requestId: requestMetadata?.multiGen?.requestId ||
                                requestMetadata?.requestId || null,
                            imageId: requestMetadata?.multiGen?.imageId || null
                        });
                    }

                    // Clone response so we can read it without consuming the original
                    if (!pageInterceptorActive && response && typeof response.clone === 'function') {
                        try {
                            const clonedResponse = response.clone();
                            console.log('[GVP][Interceptor] 🧬 Response cloned successfully');
                            // Process stream in background (async, doesn't block) - ENHANCED: pass request metadata
                            interceptor._processStream(clonedResponse, requestMetadata).catch(err =>
                                console.error('[GVP] ❌ Stream processing error:', err)
                            );
                        } catch (err) {
                            console.error('[GVP] ❌ Error cloning response:', err);
                            interceptor._finalizeMultiGenStream(requestMetadata, { error: err });
                        }
                    } else {
                        console.warn('[GVP] ❌ Response cannot be cloned');
                        interceptor._finalizeMultiGenStream(requestMetadata, { error: new Error('Response clone unavailable') });
                    }
                }

                // Intercept gallery list for batch planner
                if (typeof requestUrl === 'string' &&
                    requestUrl.includes('/rest/media/post/list') &&
                    method === 'POST') {
                    handledTarget = true;
                    console.log('[GVP][Interceptor] 🎯 Matched gallery endpoint /rest/media/post/list');
                    try {
                        const galleryClone = response.clone();
                        interceptor._processGalleryResponse(galleryClone, { url: requestUrl, options }).catch(err => {
                            console.error('[GVP] ❌ Gallery processing error:', err);
                        });
                    } catch (err) {
                        console.error('[GVP] ❌ Unable to clone gallery response:', err);
                    }
                }

                if (typeof requestUrl === 'string' &&
                    requestUrl.includes('/rest/media/post/get') &&
                    method === 'POST') {
                    handledTarget = true;
                    console.log('[GVP][Interceptor] 🎯 Matched post endpoint /rest/media/post/get');
                    try {
                        const postGetClone = response.clone();
                        interceptor._processPostGetResponse(postGetClone, {
                            url: requestUrl,
                            options,
                            source: 'post-get'
                        }).catch(err => {
                            console.error('[GVP] ❌ Post/get processing error:', err);
                        });
                    } catch (err) {
                        console.error('[GVP] ❌ Unable to clone post/get response:', err);
                    }
                }

                if (!handledTarget) {
                    console.log('[GVP][Interceptor] ⏭ Non-target request completed');
                }
                return response;
            };

            this._fetchWrapper = fetchWrapper;
            targetWindow.fetch = fetchWrapper;
            this._fetchOverrideInstalled = true;

            console.log('[GVP][Interceptor] ✅ Fetch override installed successfully', { reason });
        } catch (error) {
            console.error('[GVP] ❌ Fetch override failed:', error);
        }
    }

    async _processStream(response, requestMetadata = {}) {
        console.log('[GVP][Interceptor] 📡 _processStream invoked with metadata:', requestMetadata);
        if (!response) {
            console.warn('[GVP][Interceptor] ⚠️ No response provided to _processStream');
            return;
        }
        if (!response.body) {
            console.warn('[GVP][Interceptor] ⚠️ Response has no body - cannot read stream');
            return;
        }
        const meta = requestMetadata || {};
        if (meta.multiGen && !Array.isArray(meta.multiGen.rawChunks)) {
            meta.multiGen.rawChunks = [];
        }
        let streamError = null;

        try {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let chunkCount = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                chunkCount += 1;
                const decodedChunk = decoder.decode(value, { stream: true });
                buffer += decodedChunk;
                if (meta.multiGen) {
                    meta.multiGen.rawChunks.push(decodedChunk);
                }
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (line.trim()) {
                        console.log('[GVP][Interceptor] 📨 Processing line chunk - length:', line.length);
                        this._processLine(line, meta);
                    }
                }
            }

            const tail = decoder.decode();
            if (tail) {
                buffer += tail;
                if (meta.multiGen) {
                    meta.multiGen.rawChunks.push(tail);
                }
            }

            if (buffer.trim()) {
                console.log('[GVP][Interceptor] 📨 Processing trailing buffer - length:', buffer.length);
                this._processLine(buffer, meta);
            }

            console.log('[GVP][Interceptor] ✅ Stream processing completed - chunks read:', chunkCount);
        } catch (error) {
            console.error('[GVP] ❌ Stream reading error:', error);
            streamError = error;
        } finally {
            this._finalizeMultiGenStream(meta, { error: streamError });
        }
    }

    _processLine(line, requestMetadata = null) {
        try {
            window.Logger?.debug('NetworkInterceptor', '🧾 _processLine received line prefix', { line: line.substring(0, 80) });

            // Enhanced JSON parsing with detailed logging
            const lineStr = line.trim();
            if (!lineStr) {
                return;
            }

            // Handle SSE format: "data: {...}" or plain NDJSON: "{...}"
            let jsonString = lineStr;
            if (lineStr.startsWith('data: ')) {
                jsonString = lineStr.substring(6);
            }

            // Enhanced JSON parsing with error handling
            let obj;
            try {
                obj = JSON.parse(jsonString);

                // Enhanced logging for debugging JSON issues (only if needed via debug)
                if (obj?.result?.response?.streamingVideoGenerationResponse) {
                    const vr = obj.result.response.streamingVideoGenerationResponse;
                    window.Logger?.debug('NetworkInterceptor', 'Parsed progress chunk', {
                        videoId: vr.videoId,
                        progress: vr.progress,
                        moderated: vr.moderated
                    });
                }

            } catch (e) {
                // Silently ignore parse errors for non-JSON lines or log specifically
                if (!jsonString.trim().startsWith('{') && !jsonString.trim().startsWith('[')) {
                    return;
                }
                window.Logger?.debug('NetworkInterceptor', 'Failed to parse JSON line', { error: e.message, preview: jsonString.substring(0, 100) });
                return;
            }

            const meta = requestMetadata || {};
            const videoData = obj?.result?.response?.streamingVideoGenerationResponse;

            this._handleMultiGenStreamPayload(obj, meta);
            if (!videoData) return;

            // ENHANCED: Correlate response with request using imageId or videoId
            if (videoData.videoId && meta && (meta.imageId || meta.multiGen)) {
                const imageId = meta.imageId || meta.multiGen?.imageId || null;
                const imageReference = videoData.imageReference || meta.imageReference || meta.multiGen?.imageReference;

                // Try to find existing generation by imageId
                let generation = this.stateManager.findGenerationByImageId(imageId);

                // If not found by imageId, try by videoId
                if (!generation) {
                    generation = this.stateManager.findGenerationByVideoId(videoData.videoId);
                }

                // If still not found and we have imageId, this is the first response - associate videoId
                if (!generation && imageId) {
                    generation = this.stateManager.findGenerationByImageId(imageId);
                    if (generation) {
                        this.stateManager.updateGeneration(generation.id, {
                            videoId: videoData.videoId,
                            imageReference: imageReference
                        });
                        window.Logger?.info('NetworkInterceptor', `🔗 Associated videoId ${videoData.videoId} with imageId ${imageId}`);
                    }
                }

                // Update generation with progress
                if (generation) {
                    const normalizedProgress = this._coerceProgressValue(
                        videoData.progress ?? videoData.progressValue ?? videoData.percent
                    );

                    const updates = {
                        moderated: videoData.moderated || generation.moderated,
                        status: videoData.moderated ? 'moderated' : 'generating'
                    };

                    if (normalizedProgress !== null) {
                        updates.progress = normalizedProgress;
                    }

                    if (videoData.moderated && !generation.moderated) {
                        updates.moderationTimestamp = Date.now();
                        window.Logger?.warn('NetworkInterceptor', `⚠️ Generation ${generation.id} was moderated`);
                    }

                    this.stateManager.updateGeneration(generation.id, updates);
                }
            }

            // Define chunkProgress before using it
            const chunkProgress = this._coerceProgressValue(
                videoData.progress ?? videoData.progressValue ?? videoData.percent
            );

            // CRITICAL: Only dispatch beacon and extract at terminal state (progress >= 100 or moderated)
            if (chunkProgress !== null && (chunkProgress >= 100 || !!videoData.moderated)) {
                window.Logger?.info('NetworkInterceptor', '🎉 Progress reached 100!', {
                    videoId: videoData.videoId,
                    videoUrl: videoData.videoUrl,
                    assetId: videoData.assetId
                });

                // Dispatch terminal beacon
                this._dispatchVidGenBeacon({
                    videoId: videoData.videoId,
                    imageId: meta.imageId || meta.multiGen?.imageId,
                    parentPostId: videoData.parentPostId || meta.parentPostId,
                    progress: 100,
                    moderated: !!videoData.moderated,
                    videoUrl: videoData.videoUrl,
                    thumbnailUrl: videoData.thumbnailUrl
                });

                if (videoData.videoPrompt && videoData.videoPrompt.trim()) {
                    window.Logger?.info('NetworkInterceptor', '📝 videoPrompt captured', { length: videoData.videoPrompt.length });
                    this._parseAndSetPromptData(videoData.videoPrompt);
                }
            }
        } catch (error) {
            window.Logger?.debug('NetworkInterceptor', '❌ Line processing error', { error: error.message, preview: line.substring(0, 200) });
        }
    }



    _parseStreamLine(line) {
        if (!line) return null;

        let trimmed = line.trim();
        if (!trimmed) return null;

        if (trimmed.startsWith('event:') || trimmed.startsWith('id:') || trimmed === '[DONE]') {
            return null;
        }

        if (trimmed.startsWith('data:')) {
            trimmed = trimmed.substring(5).trim();
        }

        const firstBrace = trimmed.indexOf('{');
        if (firstBrace > 0) {
            trimmed = trimmed.substring(firstBrace);
        }

        if (!trimmed.startsWith('{')) {
            return null;
        }

        try {
            return JSON.parse(trimmed);
        } catch (error) {
            console.warn('[GVP] Failed to parse stream line as JSON:', trimmed.substring(0, 200));
            return null;
        }
    }

    _extractJsonObjects(rawStream) {
        if (!rawStream) {
            return [];
        }

        const sanitized = rawStream
            .replace(/^data:\s*/gm, '')
            .replace(/\r/g, '');

        const results = [];
        const seen = new Set();
        let depth = 0;
        let startIndex = -1;
        let inString = false;
        let isEscaped = false;

        for (let i = 0; i < sanitized.length; i++) {
            const char = sanitized[i];

            if (inString) {
                if (isEscaped) {
                    isEscaped = false;
                    continue;
                }
                if (char === '\\') {
                    isEscaped = true;
                    continue;
                }
                if (char === '"') {
                    inString = false;
                }
                continue;
            }

            if (char === '"') {
                inString = !inString;
                continue;
            }


            if (char === '{') {
                if (depth === 0) {
                    startIndex = i;
                }
                depth++;
            } else if (char === '}') {
                if (depth > 0) {
                    depth--;
                    if (depth === 0 && startIndex !== -1) {
                        const candidate = sanitized.slice(startIndex, i + 1);
                        startIndex = -1;
                        try {
                            const parsed = JSON.parse(candidate);
                            const dedupeKey = JSON.stringify(parsed);
                            if (!seen.has(dedupeKey)) {
                                seen.add(dedupeKey);
                                results.push(parsed);
                            }
                        } catch (parseError) {
                            console.warn('[GVP] Failed to parse candidate JSON chunk:', candidate.substring(0, 200));
                        }
                    }
                }
            }
        }

        return results;
    }

    async _processPayloadEvents(payloads, context = {}) {
        const { source = 'stream' } = context;
        console.log(`[GVP] Processing payload events from ${source} (count=${payloads.length})`);

        let finalVideoPrompt = null;
        let videoUrl = null;
        let assetId = null;
        let wasModerated = false;
        let moderationReason = null;
        let progressReached100 = false;

        const progressValues = [];
        let modelName = null;
        let mode = null;
        let imageReference = null;
        let userMessageUrl = null;
        let parentPostId = null;
        let videoId = null;
        let accountId = null;

        for (const payload of payloads) {
            if (!payload || typeof payload !== 'object') continue;

            if (ModerationDetector.detectModeratedContent(payload)) {
                wasModerated = true;
                moderationReason = moderationReason || ModerationDetector.extractModerationReason(payload);
            }

            const userResponse = payload?.result?.response?.userResponse;
            if (userResponse) {
                if (!userMessageUrl && typeof userResponse.message === 'string') {
                    userMessageUrl = this._extractImageUrlFromMessage(userResponse.message) || userMessageUrl;
                }

                const parentId = userResponse?.metadata?.modelConfigOverride?.modelMap?.videoGenModelConfig?.parentPostId;
                if (parentId) {
                    parentPostId = parentId;
                }
            }

            const videoResponse = payload?.result?.response?.streamingVideoGenerationResponse ||
                payload?.streamingVideoGenerationResponse ||
                payload?.result?.streamingVideoGenerationResponse;

            const imageResponse = payload?.result?.response?.streamingImageGenerationResponse ||
                payload?.streamingImageGenerationResponse ||
                payload?.result?.streamingImageGenerationResponse;

            const titleResponse = payload?.result?.title;
            if (titleResponse && titleResponse.newTitle) {
                // If title comes back, we can capture it
                if (!context.newTitle) context.newTitle = titleResponse.newTitle;
            }

            const modelResponse = payload?.result?.response?.modelResponse;
            if (modelResponse && modelResponse.fileAttachments) {
                // For either image or video, extract the final UUID payload if available
                if (!context.fileAttachments) context.fileAttachments = modelResponse.fileAttachments;
                if (!context.generatedImageUrls && modelResponse.generatedImageUrls) {
                    context.generatedImageUrls = modelResponse.generatedImageUrls;
                }
            }

            const activeGenResponse = videoResponse || imageResponse;
            if (!activeGenResponse) continue;

            if (imageResponse && !context.attemptType) {
                context.attemptType = 'image_edit';
            }

            if (!modelName && activeGenResponse.modelName) {
                modelName = activeGenResponse.modelName;
            }

            if (activeGenResponse.mode) {
                mode = activeGenResponse.mode;
            }

            if (activeGenResponse.imageReference) {
                imageReference = activeGenResponse.imageReference;
            }

            if (videoResponse?.videoId) {
                videoId = videoResponse.videoId;
            }

            // NEW METADATA EXTRACTION (GVP v1.61)
            if (activeGenResponse.isRootCelebrity !== undefined) context.isRootCelebrity = activeGenResponse.isRootCelebrity;
            if (activeGenResponse.isRootChild !== undefined) context.isRootChild = activeGenResponse.isRootChild;
            if (activeGenResponse.isRootRRated !== undefined) context.isRootRRated = activeGenResponse.isRootRRated;
            if (activeGenResponse.isRootUserUploaded !== undefined) context.isRootUserUploaded = activeGenResponse.isRootUserUploaded;
            if (activeGenResponse.isVideoExtension !== undefined) context.isVideoExtension = activeGenResponse.isVideoExtension;
            if (activeGenResponse.rRated !== undefined) context.rRated = activeGenResponse.rRated;
            if (activeGenResponse.imageModel) context.imageModel = activeGenResponse.imageModel;
            if (activeGenResponse.imageReferences) context.imageReferences = activeGenResponse.imageReferences;
            if (activeGenResponse.resolvedImageReferences) context.imageReferences = activeGenResponse.resolvedImageReferences;
            if (activeGenResponse.fileAttachments) context.fileAttachments = activeGenResponse.fileAttachments;
            if (activeGenResponse.generatedImageUrls) context.generatedImageUrls = activeGenResponse.generatedImageUrls;

            const progressRaw = activeGenResponse.progress ??
                activeGenResponse.progressValue ??
                activeGenResponse.progressPercent ??
                activeGenResponse.progress_percentage ??
                activeGenResponse.percentage ??
                activeGenResponse.percent ??
                (typeof activeGenResponse.status === 'object' ? activeGenResponse.status?.progress : null);
            const normalizedProgress = this._coerceProgressValue(progressRaw);

            if (normalizedProgress !== null) {
                progressValues.push(normalizedProgress);
                window.Logger?.debug('NetworkInterceptor', `📊 Progress: ${normalizedProgress}%`);

                const isTerminal = normalizedProgress >= 100 || wasModerated || !!activeGenResponse.moderated;

                if (isTerminal) {
                    // ENHANCED: Resolve image ID early for beacon
                    const currentResolvedImageId = this._resolveImageId({
                        parentPostId: parentPostId || activeGenResponse.parentPostId,
                        imageReference: imageReference || activeGenResponse.imageReference,
                        messageUrl: userMessageUrl
                    });

                    // Dispatch terminal beacon (Bridge context)
                    this._dispatchVidGenBeacon({
                    videoId: videoId || videoResponse?.videoId || assetId,
                    imageId: currentResolvedImageId || parentPostId,
                    parentPostId: parentPostId || activeGenResponse.parentPostId,
                    progress: normalizedProgress,
                    moderated: wasModerated || !!activeGenResponse.moderated,
                    thumbnailUrl: activeGenResponse.thumbnailUrl || imageResponse?.imageUrl,
                    videoUrl: videoResponse?.videoUrl || null,
                    fileAttachments: context.fileAttachments || null,
                    generatedImageUrls: context.generatedImageUrls || null,
                    newTitle: context.newTitle || null,
                    attemptType: context.attemptType || 'video',
                    isRootCelebrity: context.isRootCelebrity,
                    isRootChild: context.isRootChild,
                    isRootRRated: context.isRootRRated,
                    isRootUserUploaded: context.isRootUserUploaded,
                    isVideoExtension: context.isVideoExtension,
                    rRated: context.rRated,
                    imageModel: context.imageModel,
                    imageReferences: context.imageReferences || null,
                    imageReference: imageReference || activeGenResponse.imageReference || null
                });
                }
            }

            const videoPrompt = activeGenResponse.videoPrompt || activeGenResponse.prompt;

            if (activeGenResponse.moderated === true) {
                wasModerated = true;
                if (!moderationReason) {
                    moderationReason = 'Content flagged by moderation system';
                }
            }

            if (normalizedProgress !== null && normalizedProgress >= 100) {
                progressReached100 = true;
                window.Logger?.info('NetworkInterceptor', '✅ Progress 100 reached!');

                if (activeGenResponse.videoUrl || imageResponse?.imageUrl) {
                    videoUrl = videoResponse?.videoUrl || imageResponse?.imageUrl;
                    window.Logger?.info('NetworkInterceptor', '🎬 Found media URL:', { url: videoUrl.substring(0, 50) + '...' });
                    if (!accountId) {
                        accountId = this._extractAccountIdFromVideoUrl(videoUrl);
                    }
                }
                
                if (activeGenResponse.assetId || imageResponse?.imageId) {
                    assetId = activeGenResponse.assetId || imageResponse?.imageId;
                }

                if (typeof finalVideoPrompt === 'string' && finalVideoPrompt.trim()) {
                    window.Logger?.info('NetworkInterceptor', '📝 Found videoPrompt!', { length: finalVideoPrompt.length });
                }
            }
        }

        if (wasModerated) {
            await this._handleModerationEvent(moderationReason);
        }

        if (!accountId && videoUrl) {
            accountId = this._extractAccountIdFromVideoUrl(videoUrl);
        }

        let resolvedImageId = this._resolveImageId({
            parentPostId,
            imageReference,
            messageUrl: userMessageUrl
        });

        if (!resolvedImageId && window.gvpUIManager) {
            try {
                if (typeof window.gvpUIManager._resolveActiveImageId === 'function') {
                    resolvedImageId = window.gvpUIManager._resolveActiveImageId();
                }
                if (!resolvedImageId && typeof window.gvpUIManager._lastResolvedImageId === 'string') {
                    resolvedImageId = window.gvpUIManager._lastResolvedImageId;
                }
            } catch (uiResolveError) {
                console.warn('[GVP] ⚠️ Failed resolving image id via UI manager:', uiResolveError);
            }
        }

        if (!resolvedImageId && window.gvpImageProjectManager && typeof window.gvpImageProjectManager.ensureActiveContext === 'function') {
            const ctx = window.gvpImageProjectManager.ensureActiveContext();
            if (ctx?.imageId) {
                resolvedImageId = ctx.imageId;
                if (!accountId && ctx.accountId) {
                    accountId = ctx.accountId;
                }
            }
        }

        // Hallucinated prompt fallback mechanism removed

        if (finalVideoPrompt) {
            window.Logger?.info('NetworkInterceptor', '📝 capturing videoPrompt from response', { length: finalVideoPrompt.length });

            const trimmedFinal = typeof finalVideoPrompt === 'string' ? finalVideoPrompt.trim() : '';
            const looksLikeJson = trimmedFinal.startsWith('{') || trimmedFinal.startsWith('[');
            await this._parseAndSetPromptData(finalVideoPrompt);

            // Use the standard account extractor to guarantee isolation
            const activeAccountId = this.stateManager?.getActiveMultiGenAccount?.() || null;
            const historyManager = window.gvpImageProjectManager;

            if (historyManager) {
                // Determine the correct account partition for this generation
                let historyAccountId = accountId || activeAccountId || null;

                // Fallback to ImageProjectManager's own context if totally lost
                if (!historyAccountId && typeof historyManager.ensureActiveContext === 'function') {
                    const ctx = historyManager.ensureActiveContext();
                    if (ctx?.accountId) {
                        historyAccountId = ctx.accountId;
                    }
                }

                const activeHistoryAccount = historyAccountId || 'account:unknown';

                if (resolvedImageId) {
                    try {
                        // Crucial: Set the active partition before recording to prevent leaks
                        historyManager.setActiveAccount(activeHistoryAccount);

                        historyManager.registerImageProject(
                            activeHistoryAccount,
                            resolvedImageId,
                            {
                                type: looksLikeJson ? 'json' : 'raw',
                                prompt: trimmedFinal,
                                modelName: modelName || null,
                                mode: mode || null,
                                moderated: wasModerated,
                                timestamp: Date.now(),
                                source: 'generation',
                                videoId: videoId || null,
                                videoUrl: videoUrl || null,
                                assetId: assetId || null,
                                imageReference: imageReference || userMessageUrl || null
                            },
                            {
                                id: videoId || assetId || `gen_${Date.now()}`,
                                timestamp: Date.now(),
                                injectedMode: mode || null,
                                originalMode: mode || null,
                                modelName: modelName || null,
                                mediaUrl: videoUrl || null,
                                isRefused: wasModerated,
                                metadata: {
                                    parentPostId: parentPostId || null
                                }
                            }
                        );

                        // Dispatch beacon for gallery backfill if generation was successful and has a video
                        if (!wasModerated && videoUrl && resolvedImageId) {
                            window.dispatchEvent(new CustomEvent('gvp:vidgen-beacon', {
                                detail: {
                                    imageId: resolvedImageId,
                                    videoUrl: videoUrl,
                                    status: 'COMPLETED',
                                    progress: 100,
                                    source: 'gallery-backfill'
                                }
                            }));
                        }
                    } catch (historyError) {
                        console.error('[GVP] ❌ Failed to record prompt history:', historyError);
                    }
                } else {
                    console.warn('[GVP] ⚠️ Skipped prompt history logging - unresolved imageId', {
                        accountId: activeHistoryAccount,
                        parentPostId,
                        imageReference,
                        userMessageUrl
                    });
                }
            }
            // }

        } else if (!progressValues.length) {
            console.log('[GVP] No streaming video responses found in payloads');
        }

        const state = this.stateManager?.getState?.();
        if (!state) return;
        // Fallback to singleton currentGenerationId if no specific requestId is provided by bridge
        const currentGenId = context.requestId || state.generation.currentGenerationId;

        // v1.60.1: Implicit moderation detection — if progress reached 100 but BOTH
        // videoPrompt and videoUrl are missing, the generation was silently moderated.
        // Grok's API often removes content without setting moderated=true explicitly.
        // v1.60.2 Regression Fix: Bridge payloads often have partial data; avoid false triggers.
        const isBridgeSource = context.source === 'bridge-progress' || 
                             context.source === 'bridge-video-prompt' || 
                             context.source === 'bridge-progress-synthetic';

        if (progressReached100 && !finalVideoPrompt && !videoUrl && !wasModerated && !isBridgeSource) {
            wasModerated = true;
            moderationReason = moderationReason || 'Implicit moderation: progress 100 with no prompt or video URL';
            window.Logger?.warn('NetworkInterceptor', '🚫 Implicit moderation detected: progress=100, no prompt, no videoUrl');
            // Fire the moderation event that was missed above
            await this._handleModerationEvent(moderationReason);
        }

        if (currentGenId) {
            const newStatus = wasModerated ? 'moderated'
                : finalVideoPrompt ? 'completed'
                    : state.generation.status;

            this.stateManager.updateGeneration(currentGenId, {
                videoUrl: videoUrl || null,
                assetId: assetId || null,
                finalPrompt: finalVideoPrompt || null,
                status: newStatus,
                modelName: modelName || null,
                mode: mode || null,
                imageId: resolvedImageId || null,
                accountId: accountId || null,
                videoId: videoId || null,
                progress: progressValues.length ? progressValues[progressValues.length - 1] : undefined
            });

            if (!wasModerated && (finalVideoPrompt || context.attemptType === 'image_edit') && videoUrl) {
                this.stateManager.completeGeneration(currentGenId, {
                    videoUrl, // serves as imageUrl for image_edit due to mapping at 3081
                    assetId
                });

                if (window.gvpUIManager) {
                    window.gvpUIManager.updateGenerationStatus('completed', { generationId: currentGenId });
                    window.gvpUIManager.updateProgressBar(100);
                }
            }
        }

        if (progressValues.length) {
            console.log('[GVP] Stream progress values:', progressValues.join(', '));
            if (!progressReached100) {
                console.debug('[GVP] Stream ended before progress reached 100. Last progress:', progressValues[progressValues.length - 1]);
            }
        }

        if (accountId) {
            this._setActiveAccount(accountId, 'stream-summary');
        }
    }

    _extractAccountIdFromVideoUrl(videoUrl) {
        if (!videoUrl || typeof videoUrl !== 'string') {
            return null;
        }

        const match = videoUrl.match(/users\/([^\/]+)/i);
        return match ? match[1] : null;
    }

    _extractImageUrlFromMessage(message) {
        if (!message || typeof message !== 'string') {
            return null;
        }

        const match = message.match(/https?:\/\/[^\s]+/i);
        return match ? match[0] : null;
    }

    _extractImageIdFromUrl(url) {
        if (!url || typeof url !== 'string') return null;

        const cleanUrl = url.split(/[?#]/)[0].replace(/\.[a-z0-9]+$/i, '');
        const segments = cleanUrl.split('/');
        const uuidRegex = window.GVP_REGEX?.UUID || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        for (let i = segments.length - 1; i >= 0; i--) {
            const segment = segments[i];
            if (segment && segment.length === 36 && uuidRegex.test(segment)) {
                return segment;
            }
        }
        return null;
    }

    _resolveImageId({ parentPostId, imageReference, messageUrl }) {
        if (parentPostId) {
            return parentPostId;
        }

        const fromReference = this._extractImageIdFromUrl(imageReference);
        if (fromReference) {
            return fromReference;
        }

        const fromMessage = this._extractImageIdFromUrl(messageUrl);
        if (fromMessage) {
            return fromMessage;
        }

        return null;
    }

    async _handleModerationEvent(reason) {
        const state = this.stateManager?.getState?.();
        if (!state) return;
        const currentGenId = state.generation.currentGenerationId;

        if (!currentGenId) {
            // Downgrade to debug: This usually happens for native Grok generations not triggered by GVP
            window.Logger?.debug('NetworkInterceptor', '[GVP] Moderation detected but no active GVP generation');
            return;
        }

        const moderationData = state.generation.moderationData || {
            retryCount: 0,
            retryHistory: []
        };
        state.generation.moderationData = moderationData;
        const settings = state.settings;

        moderationData.isModerated = true;
        moderationData.moderationReason = reason;
        moderationData.retryCount++;
        moderationData.lastRetryTime = Date.now();

        moderationData.retryHistory.push({
            attemptNumber: moderationData.retryCount,
            timestamp: Date.now(),
            reason: reason,
            generationId: currentGenId,
            success: false
        });

        window.Logger?.info('NetworkInterceptor', `[GVP] Moderation event recorded (attempt ${moderationData.retryCount})`, { reason });

        if (window.gvpUIManager) {
            if (typeof window.gvpUIManager.updateRetryStatistics === 'function') {
                window.gvpUIManager.updateRetryStatistics();
            } else {
                console.debug('[GVP][Interceptor] updateRetryStatistics hook missing on UIManager');
            }
            window.gvpUIManager.updateGenerationStatus('moderated', {
                reason: moderationData.moderationReason,
                retryCount: moderationData.retryCount,
                maxRetries: settings.maxModerationRetries || 3,
                generationId: currentGenId
            });
        }

        this.stateManager.updateGeneration(currentGenId, {
            isRefused: true,
            moderationRetryCount: moderationData.retryCount,
            status: 'moderated'
        });

        if (settings.autoRetryOnModeration) {
            console.log('[GVP] 🔁 Auto-retry is deprecated and removed.');
        }
    }

    async handleBridgeError(payload = {}) {
        if (!payload.status || !payload.url) return;
        const state = this.stateManager?.getState?.();
        if (!state) return;

        window.Logger?.error('NetworkInterceptor', `[GVP] Bridge reported HTTP error ${payload.status} for ${payload.url}`);

        if (payload.status === 429) {
            const currentGenId = state.generation.currentGenerationId;
            if (currentGenId) {
                window.Logger?.warn('NetworkInterceptor', '🚨 Quota Exhausted! Received 429 from Grok backend.');

                // Immediately stop the VideoQueueManager
                if (window.gvpUIManager && window.gvpUIManager.multiVideoManager) {
                    window.gvpUIManager.multiVideoManager.stopQueue();
                }

                this.stateManager.updateGeneration(currentGenId, {
                    status: 'failed',
                    isRefused: true,
                    moderationReason: 'Quota Exhausted (429)'
                });

                if (window.gvpUIManager) {
                    window.gvpUIManager.updateGenerationStatus('failed', {
                        reason: 'Quota Exhausted (429)',
                        generationId: currentGenId
                    });
                }
            } else {
                 window.Logger?.warn('NetworkInterceptor', '429 Quota Error received but no active generation found.');
            }
        }
    }

    async handleBridgeProgress(payload = {}) {
        const progressValue = this._coerceProgressValue(
            payload?.progress ?? payload?.progressValue ?? payload?.percent ?? payload?.progressPercent
        );
        if (progressValue === null) {
            return;
        }

        console.log('[GVP][Interceptor] Bridge progress payload received:', {
            progress: progressValue,
            videoId: payload?.videoId || null,
            hasRaw: typeof payload?.raw === 'string',
            mode: payload?.mode || null
        });

        const requestId = typeof payload?.requestId === 'string' ? payload.requestId : null;

        let requestContext = null;
        if (requestId) {
            requestContext = this._bridgeRequestsById.get(requestId) || null;
        }

        const multiGenMeta = requestContext ? { multiGen: requestContext } : null;

        if (requestContext && Array.isArray(requestContext.rawChunks) && typeof payload?.raw === 'string') {
            requestContext.rawChunks.push(payload.raw);
        }

        if (payload?.videoId) {
            const existing = this._bridgeMetadataByVideoId.get(payload.videoId) || {};
            this._bridgeMetadataByVideoId.set(payload.videoId, {
                ...existing,
                progress: progressValue,
                moderated: payload?.moderated === true,
                imageReference: payload?.imageReference || existing.imageReference || null,
                mode: payload?.mode || existing.mode || null,
                modelName: payload?.modelName || existing.modelName || null,
                url: payload?.url || existing.url || null,
                requestId: requestId || existing.requestId || null
            });
        }

        let processed = false;

        if (typeof payload?.raw === 'string') {
            const rawText = payload.raw.trim();
            const looksJson = rawText.startsWith('{') || rawText.startsWith('[');
            if (looksJson) {
                try {
                    const parsed = JSON.parse(rawText);
                    if (multiGenMeta) {
                        this._handleMultiGenStreamPayload(parsed, multiGenMeta);
                    }
                    await this._processPayloadEvents([parsed], { source: 'bridge-progress', requestId });
                    processed = true;
                } catch (error) {
                    console.debug('[GVP][Interceptor] Failed to parse bridge progress payload raw JSON:', error);
                }
            }
        }

        if (!processed && payload?.videoId) {
            const meta = this._bridgeMetadataByVideoId.get(payload.videoId) || {};
            const syntheticPayload = {
                result: {
                    response: {
                        streamingVideoGenerationResponse: {
                            progress: progressValue,
                            videoId: payload.videoId,
                            imageId: payload?.imageId || payload?.parentPostId || meta.imageReference || null,
                            moderated: payload?.moderated === true,
                            mode: payload?.mode || meta.mode || null,
                            modelName: payload?.modelName || meta.modelName || null,
                            imageReference: payload?.imageReference || meta.imageReference || null
                        }
                    }
                }
            };

            try {
                if (multiGenMeta) {
                    this._handleMultiGenStreamPayload(syntheticPayload, multiGenMeta);
                }
                await this._processPayloadEvents([syntheticPayload], { source: 'bridge-progress-synthetic', requestId });
                processed = true;
            } catch (error) {
                console.debug('[GVP][Interceptor] Failed to process synthetic bridge progress payload:', error, syntheticPayload);
            }
        }

        try {
            if (window.gvpUIManager && typeof window.gvpUIManager.updateProgressBar === 'function') {
                const clamped = Math.max(0, Math.min(100, progressValue));
                window.gvpUIManager.updateProgressBar(clamped);
            }
        } catch (uiError) {
            console.warn('[GVP][Interceptor] Failed to update progress bar from bridge:', uiError);
        }
    }

    async handleBridgeVideoPrompt(payload = {}) {
        const requestId = typeof payload?.requestId === 'string' ? payload.requestId : null;
        const requestContext = requestId ? this._bridgeRequestsById.get(requestId) || null : null;
        const multiGenMeta = requestContext ? { multiGen: requestContext } : null;

        if (payload?.videoId) {
            const existing = this._bridgeMetadataByVideoId.get(payload.videoId) || {};
            this._bridgeMetadataByVideoId.set(payload.videoId, {
                ...existing,
                videoUrl: payload?.videoUrl || existing.videoUrl || null,
                assetId: payload?.assetId || existing.assetId || null,
                moderated: payload?.moderated === true,
                videoPrompt: payload?.videoPrompt || existing.videoPrompt || '',
                imageReference: payload?.imageReference || existing.imageReference || null,
                mode: payload?.mode || existing.mode || null,
                modelName: payload?.modelName || existing.modelName || null
            });
        }

        console.log('[GVP][Interceptor] Bridge video prompt payload received:', {
            videoId: payload?.videoId || null,
            hasRaw: typeof payload?.raw === 'string',
            promptLength: typeof payload?.videoPrompt === 'string' ? payload.videoPrompt.length : 0,
            mode: payload?.mode || null
        });

        let processed = false;

        if (typeof payload?.raw === 'string') {
            const rawText = payload.raw.trim();
            const looksJson = rawText.startsWith('{') || rawText.startsWith('[');
            if (looksJson) {
                try {
                    const parsed = JSON.parse(rawText);
                    if (multiGenMeta) {
                        await this._handleMultiGenStreamPayload(parsed, multiGenMeta);
                    }
                    await this._processPayloadEvents([parsed], { source: 'bridge-video-prompt', requestId });
                    processed = true;
                } catch (error) {
                    console.debug('[GVP][Interceptor] Failed to parse bridge video prompt raw JSON:', error);
                }
            }
        }

        if (!processed && payload?.videoId) {
            const meta = this._bridgeMetadataByVideoId.get(payload.videoId) || {};
            const syntheticProgress = this._coerceProgressValue(
                payload?.progress ??
                payload?.progressValue ??
                payload?.percent ??
                payload?.progressPercent ??
                meta.progress ??
                100
            ) ?? 100;
            const syntheticPayload = {
                result: {
                    response: {
                        streamingVideoGenerationResponse: {
                            progress: syntheticProgress,
                            videoPrompt: typeof payload?.videoPrompt === 'string' ? payload.videoPrompt : (meta.videoPrompt || ''),
                            videoUrl: payload?.videoUrl || meta.videoUrl || null,
                            assetId: payload?.assetId || meta.assetId || null,
                            moderated: payload?.moderated === true,
                            videoId: payload.videoId,
                            imageId: payload?.imageId || payload?.parentPostId || meta.imageReference || null,
                            mode: payload?.mode || meta.mode || null,
                            modelName: payload?.modelName || meta.modelName || null,
                            imageReference: payload?.imageReference || meta.imageReference || null
                        }
                    }
                }
            };

            try {
                if (multiGenMeta) {
                    this._handleMultiGenStreamPayload(syntheticPayload, multiGenMeta);
                }
                await this._processPayloadEvents([syntheticPayload], { source: 'bridge-video-prompt-synthetic', requestId });
                processed = true;
            } catch (error) {
                console.debug('[GVP][Interceptor] Failed to process synthetic bridge video prompt payload:', error, syntheticPayload);
            }
        }

        if (!processed) {
            try {
                const videoPrompt = typeof payload?.videoPrompt === 'string' ? payload.videoPrompt : '';
                if (videoPrompt) {
                    await this._parseAndSetPromptData(videoPrompt);
                } else if (payload?.videoId) {
                    const meta = this._bridgeMetadataByVideoId.get(payload.videoId);
                    if (meta && typeof meta.videoPrompt === 'string' && meta.videoPrompt.trim()) {
                        await this._parseAndSetPromptData(meta.videoPrompt);
                    }
                }
            } catch (error) {
                console.error('[GVP][Interceptor] Failed to handle bridge video prompt payload:', error, payload);
            }
        }

        try {
            if (window.gvpUIManager && typeof window.gvpUIManager.updateProgressBar === 'function') {
                window.gvpUIManager.updateProgressBar(100);
            }
        } catch (uiError) {
            console.warn('[GVP][Interceptor] Failed to finalize progress bar from bridge:', uiError);
        }

        if (requestContext && !requestContext.completed) {
            this._finalizeMultiGenStream({ multiGen: requestContext });
        }

        if (payload?.videoId) {
            this._bridgeMetadataByVideoId.delete(payload.videoId);
        }
    }

    async _handleBridgeStreamPayload(parsedPayload, requestContext) {
        if (!parsedPayload || !requestContext) {
            return;
        }

        const meta = { multiGen: requestContext };
        this._handleMultiGenStreamPayload(parsedPayload, meta);
    }

    _parseAndSetPromptData(videoPromptString) {
        if (!videoPromptString || typeof videoPromptString !== 'string') {
            return;
        }

        const trimmed = videoPromptString.trim();
        // Robust check for JSON-like structure
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            // Probably just a plain string/Image ID, ignore
            return;
        }

        try {
            // Guard against large or invalid strings that might still fail
            const parsed = JSON.parse(trimmed);
            if (!parsed || typeof parsed !== 'object') return;

            if (window.stateManager) {
                window.stateManager.updatePromptDataFromVideoPrompt(trimmed);
            }

            if (window.gvpUIManager) {
                window.gvpUIManager.updatePromptFromVideoPrompt(trimmed);
            }

            console.log('[GVP] ✅ Parsed and set prompt data');

        } catch (error) {
            // Suppress error logs for non-JSON strings to keep console clean
            if (trimmed.length < 50) {
                // Short non-JSON strings are common (IDs, links)
                return;
            }
            console.error('[GVP] Failed to parse videoPrompt JSON (length:', trimmed.length, '):', error.message);
        }
    }

    async _processJsonResponse(response, source = 'json') {
        try {
            window.Logger?.info('NetworkInterceptor', '[GVP] _processJsonResponse called');
            const jsonData = await response.json();
            await this._processPayloadEvents([jsonData], { source });
        } catch (error) {
            window.Logger?.debug('NetworkInterceptor', '[GVP] Error processing JSON response:', error);
        }
    }

    /**
     * Trigger a manual fetch of the gallery to synchronize the unified history.
     * Uses this.originalFetch to avoid interceptor recursion.
     * 
     * @param {string} accountId The active account ID
     * @param {string} source The source type, defaults to 'gallery'
     * @param {number} limit The maximum number of items to fetch, defaults to 40
     * @returns {Promise<boolean>} Success status
     */
    /**
     * Dispatch a vidgen-beacon event for real-time progress tracking
     * v1.47: Restored missing dispatch logic
     * @param {Object} data - { videoId, imageId, parentPostId, progress, moderated, videoUrl, thumbnailUrl }
     */
    _dispatchVidGenBeacon(data) {
        if (!data || (!data.videoId && !data.assetId)) return;

        const detail = {
            videoId: data.videoId || data.assetId,
            imageId: data.imageId || data.parentPostId || null,
            parentPostId: data.parentPostId || data.imageId || null,
            progress: data.progress ?? 0,
            moderated: !!data.moderated,
            thumbnailUrl: data.thumbnailUrl || null,
            videoUrl: data.videoUrl || null,
            
            // v1.61.0 Adv Metadata 
            fileAttachments: data.fileAttachments || null,
            generatedImageUrls: data.generatedImageUrls || null,
            newTitle: data.newTitle || null,
            attemptType: data.attemptType || 'video'
        };

        if (window.Logger) {
            window.Logger.debug('NetworkInterceptor', '📡 Dispatching gvp:vidgen-beacon', detail);
        } else {
            console.debug('[GVP] 📡 Dispatching gvp:vidgen-beacon', detail);
        }

        window.dispatchEvent(new CustomEvent('gvp:vidgen-beacon', { detail }));
    }

    async triggerBulkGallerySync(accountId, source = 'gallery', limit = 40) {
        if (!accountId) {
            console.error('[GVP][Interceptor] Cannot trigger bulk sync without an accountId.');
            return false;
        }

        const sentinelEnabled = this.stateManager?.state?.settings?.sentinelSyncEnabled !== false;
        const apiBatchSize = this.stateManager?.state?.settings?.galleryBatchSize || limit;

        console.log(`[GVP][Interceptor] 🔄 Triggering Bulk Sync for account: ${accountId} (Sentinel: ${sentinelEnabled})`);

        try {
            const fetchFn = this.originalFetch || window.fetch;
            let sourceEnum = 'MEDIA_POST_SOURCE_LIKED';

            if (source === 'favorites' || source === 'liked' || source === 'saved' || source === 'gallery' || source === 'all' || source === 'account-switch' || source === 'startup-pulse') {
                sourceEnum = 'MEDIA_POST_SOURCE_LIKED';
            }

            // --- PLAN B: SENTINEL CHECK ---
            if (sentinelEnabled && (source === 'startup-pulse' || source === 'account-switch')) {
                try {
                    // Ensure we have the latest IndexedDBManager reference
                    const idb = this.stateManager?.indexedDBManager || window.gvpIDB;
                    const lastSyncAt = await idb?.getSyncStatus(accountId);

                    if (lastSyncAt) {
                        console.log(`[GVP][Interceptor] 🔎 Sentinel Check: Last sync was ${new Date(lastSyncAt).toISOString()}. Checking Grok API...`);

                        const localTopId = await idb?.getLatestUnifiedId();

                        // GVP (v1.46.13): Add abort controller for reliability
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 15000);

                        const pulseResponse = await fetchFn('https://grok.com/rest/media/post/list', {
                            method: 'POST',
                            signal: controller.signal,
                            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ limit: 1, filter: { source: sourceEnum } })
                        });

                        clearTimeout(timeoutId);

                        if (pulseResponse.ok) {
                            const pulseData = await pulseResponse.json();
                            const apiTopId = pulseData.items?.[0]?.id || pulseData.posts?.[0]?.id;

                            if (apiTopId === localTopId) {
                                console.log('[GVP][Interceptor] ✨ SENTINEL MATCH! Local history is up-to-date. Bypassing bulk sync.');

                                // Trigger lazy hydration of local history for UI components
                                if (this.stateManager?.loadUnifiedHistoryPaged) {
                                    this.stateManager.loadUnifiedHistoryPaged(25, 0).catch(console.error);
                                }

                                return true;
                            }
                            console.log(`[GVP][Interceptor] 🔄 Sentinel mismatch (${apiTopId} vs ${localTopId}). Proceeding with sync.`);
                        }
                    } else {
                        console.log('[GVP][Interceptor] 🔄 No local history found. Proceeding with full sync.');
                    }
                } catch (sentinelError) {
                    if (sentinelError.name === 'AbortError') {
                        console.warn('[GVP][Interceptor] ⏱️ Sentinel check timed out.');
                    } else {
                        console.warn('[GVP][Interceptor] ⚠️ Sentinel check failed:', sentinelError);
                    }
                }
            }

            let currentCursor = null;
            let hasMore = true;
            let totalFetched = 0;
            let pageCount = 0;
            const MAX_PAGES = 100; // Safety limit: up to 10,000 items

            const globalSyncStartTime = Date.now();
            const SYNC_BUDGET_MS = 30000; // 30s total budget

            while (hasMore && pageCount < MAX_PAGES) {
                // v1.47.7: Global budget check
                if (Date.now() - globalSyncStartTime > SYNC_BUDGET_MS) {
                    window.Logger.warn('NetworkInterceptor', `⏱️ Bulk sync reached 30s budget at page ${pageCount}. Terminating.`);
                    break;
                }

                pageCount++;
                const requestBody = {
                    limit: apiBatchSize,
                    filter: {
                        source: sourceEnum
                    }
                };

                if (currentCursor) {
                    requestBody.cursor = currentCursor;
                }

                try {
                    // GVP (v1.46.13): Add abort controller for each batch
                    const batchController = new AbortController();
                    const batchTimeoutId = setTimeout(() => batchController.abort(), 15000);

                    const response = await fetchFn('https://grok.com/rest/media/post/list', {
                        method: 'POST',
                        signal: batchController.signal,
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        credentials: 'include',
                        body: JSON.stringify(requestBody)
                    });

                    clearTimeout(batchTimeoutId);

                    if (!response.ok) {
                        throw new Error(`Bulk sync API HTTP Error at page ${pageCount}: ${response.status}`);
                    }

                    const data = await response.json();
                    const posts = data.items || data.posts || [];

                    // Get next cursor
                    currentCursor = data.cursor || data.nextCursor || null;
                    hasMore = !!currentCursor && posts.length > 0;

                    if (posts.length > 0) {
                        totalFetched += posts.length;
                        console.log(`[GVP][Interceptor] 📥 Page ${pageCount}: Fetched ${posts.length} items (Total: ${totalFetched})`);
                        await this._ingestListToUnified(posts, accountId);
                    } else {
                        hasMore = false;
                    }

                    if (hasMore) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                } catch (batchError) {
                    if (batchError.name === 'AbortError') {
                        console.error(`[GVP][Interceptor] ❌ Bulk sync timed out at page ${pageCount}`);
                    } else {
                        console.error(`[GVP][Interceptor] ❌ Bulk sync error at page ${pageCount}:`, batchError);
                    }
                    // Terminate loop on fatal/timeout to avoid hanging the init process
                    break;
                }
            }

            console.log(`[GVP][Interceptor] ✅ Exhaustive Bulk Sync completed. Total items: ${totalFetched}`);
            return { success: true, count: totalFetched };

        } catch (error) {
            console.error('[GVP][Interceptor] ❌ Bulk Sync failed:', error);
            return { success: false, error: error.message };
        }

    }
};

