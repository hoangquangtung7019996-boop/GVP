// src/content/managers/InspectionManager.js
// Config Watcher, Generation Inspector, and Post Data Inspector logic
// Handles storage, normalization, and deep diffing.

window.InspectionManager = class InspectionManager {
    constructor(stateManager) {
        this.stateManager = stateManager;
        this.storageKey = 'gvp_inspection_history';
        this.history = {
            config: [],
            generation: [],
            post: []
        };
        // Limits to prevent storage explosion
        this.LIMITS = {
            config: 50,
            generation: 50,
            post: 50
        };
        this._initialized = false;
        window.Logger.info('InspectionManager', 'Manager instantiated');
    }

    async initialize() {
        if (this._initialized) return;

        await this._loadHistory();
        this._initialized = true;
        window.Logger.info('InspectionManager', 'Initialized with history counts:', {
            config: this.history.config.length,
            generation: this.history.generation.length,
            post: this.history.post.length
        });
    }

    async _loadHistory() {
        try {
            const data = await new Promise(resolve => {
                chrome.storage.local.get([this.storageKey], (result) => {
                    resolve(result[this.storageKey]);
                });
            });

            if (data) {
                this.history.config = Array.isArray(data.config) ? data.config : [];
                this.history.generation = Array.isArray(data.generation) ? data.generation : [];
                this.history.post = Array.isArray(data.post) ? data.post : [];
            }

            // Auto-Seed if empty (Parity with User Script)
            if (this.history.config.length === 0) {
                this._seedData();
            }
        } catch (error) {
            window.Logger.error('InspectionManager', 'Failed to load history', error);
        }
    }

    async _saveHistory() {
        try {
            // Trim to limits
            if (this.history.config.length > this.LIMITS.config) {
                this.history.config = this.history.config.slice(0, this.LIMITS.config);
            }
            if (this.history.generation.length > this.LIMITS.generation) {
                this.history.generation = this.history.generation.slice(0, this.LIMITS.generation);
            }
            if (this.history.post.length > this.LIMITS.post) {
                this.history.post = this.history.post.slice(0, this.LIMITS.post);
            }

            await new Promise(resolve => {
                chrome.storage.local.set({ [this.storageKey]: this.history }, resolve);
            });
        } catch (error) {
            window.Logger.error('InspectionManager', 'Failed to save history', error);
        }
    }

    // ==========================================
    // 1. Config Watcher
    // ==========================================

    async captureConfig(rawConfig, url) {
        if (!rawConfig) {
            window.Logger.warn('InspectionManager', 'Empty config passed to captureConfig');
            return null;
        }

        const cleanConfig = this._normalizeConfig(rawConfig);
        const latestEntry = this.history.config[0];

        // Compare with latest clean version to avoid duplicates
        if (latestEntry) {
            const latestClean = latestEntry.clean;
            const isDifferent = JSON.stringify(cleanConfig) !== JSON.stringify(latestClean);

            if (!isDifferent) {
                window.Logger.debug('InspectionManager', 'Config matches latest version, simple duplicate ignored');
                return null; // No change
            }
        }

        // It's different or first run
        const entry = {
            id: `cfg_${Date.now()}`,
            timestamp: Date.now(),
            url: url || window.location.href,
            raw: rawConfig,
            clean: cleanConfig,
            diff: latestEntry ? this.getDiff(latestEntry.clean, cleanConfig) : null
        };

        this.history.config.unshift(entry);
        await this._saveHistory();

        window.Logger.info('InspectionManager', '🆕 New Config Version Captured', {
            id: entry.id,
            keysRemoved: entry.diff ? entry.diff.filter(d => d.type === 'removed').length : 0,
            keysAdded: entry.diff ? entry.diff.filter(d => d.type === 'added').length : 0,
            keysChanged: entry.diff ? entry.diff.filter(d => d.type === 'changed').length : 0
        });

        return entry;
    }

    /**
     * Normalize config/generation data by replacing fluid fields with placeholders.
     * This prevents false diffs from timestamps, UUIDs, progress values, etc.
     * 
     * FLUID fields (ignored in diff):
     *   - UUIDs: userId, sessionId, conversationId, responseId, videoId, parentPostId, assetId, workspaceId
     *   - Timestamps: createTime, updateTime, modifyTime, timestamp, sentAt
     *   - Per-generation: progress, videoUrl, thumbnailImageUrl, imageReference, request_trace_id
     *   - Build artifacts: _next/static/chunks/*.css
     *   - Telemetry: nonce, sentry-trace, baggage
     * 
     * STABLE fields (should trigger diff):
     *   - Boolean flags (enable_*, show_*, disable_*)
     *   - Model configurations, personas, presets
     *   - Feature settings, mode names
     */
    _normalizeConfig(raw) {
        if (!raw) return null;
        try {
            const str = JSON.stringify(raw);
            const cleaned = str
                // === TELEMETRY & SESSION ===
                .replace(/"nonce"\s*:\s*"[^"]+"/g, '"nonce":"[NONCE]"')
                .replace(/"sentry-trace"\s*:\s*"[^"]+"/g, '"sentry-trace":"[TRACE_ID]"')
                .replace(/"baggage"\s*:\s*"[^"]+"/g, '"baggage":"[BAGGAGE]"')

                // === UUIDs (36-char format) ===
                .replace(/"userId"\s*:\s*"[a-f0-9-]{36}"/gi, '"userId":"[USER_ID]"')
                .replace(/"sessionId"\s*:\s*"[a-f0-9-]{36}"/gi, '"sessionId":"[SESSION_ID]"')
                .replace(/"conversationId"\s*:\s*"[a-f0-9-]{36}"/gi, '"conversationId":"[CONVERSATION_ID]"')
                .replace(/"responseId"\s*:\s*"[a-f0-9-]{36}"/gi, '"responseId":"[RESPONSE_ID]"')
                .replace(/"parentResponseId"\s*:\s*"[a-f0-9-]{36}"/gi, '"parentResponseId":"[PARENT_RESPONSE_ID]"')
                .replace(/"videoId"\s*:\s*"[a-f0-9-]{36}"/gi, '"videoId":"[VIDEO_ID]"')
                .replace(/"videoPostId"\s*:\s*"[a-f0-9-]{36}"/gi, '"videoPostId":"[VIDEO_POST_ID]"')
                .replace(/"assetId"\s*:\s*"[a-f0-9-]{36}"/gi, '"assetId":"[ASSET_ID]"')
                .replace(/"parentPostId"\s*:\s*"[a-f0-9-]{36}"/gi, '"parentPostId":"[PARENT_POST_ID]"')
                .replace(/"workspaceId"\s*:\s*"[a-f0-9-]{36}"/gi, '"workspaceId":"[WORKSPACE_ID]"')
                .replace(/"requestId"\s*:\s*"[a-f0-9-]{36}"/gi, '"requestId":"[REQUEST_ID]"')

                // === TIMESTAMPS ===
                .replace(/"(create|update|modify)Time"\s*:\s*"[^"]+"/gi, '"$1Time":"[TIMESTAMP]"')
                .replace(/"timestamp"\s*:\s*"[^"]+"/gi, '"timestamp":"[TIMESTAMP]"')
                .replace(/"sentAt"\s*:\s*"[^"]+"/gi, '"sentAt":"[TIMESTAMP]"')

                // === GENERATION-SPECIFIC FLUID FIELDS ===
                .replace(/"progress"\s*:\s*\d+/g, '"progress":"[PROGRESS]"')
                .replace(/"videoUrl"\s*:\s*"[^"]+"/g, '"videoUrl":"[VIDEO_URL]"')
                .replace(/"thumbnailImageUrl"\s*:\s*"[^"]+"/g, '"thumbnailImageUrl":"[THUMBNAIL_URL]"')
                .replace(/"imageReference"\s*:\s*"[^"]+"/g, '"imageReference":"[IMAGE_REF]"')
                .replace(/"request_trace_id"\s*:\s*"[a-f0-9]+"/gi, '"request_trace_id":"[TRACE_ID]"')
                .replace(/"token"\s*:\s*"[^"]*"/g, '"token":"[TOKEN]"')

                // === FILE ATTACHMENTS (arrays of UUIDs) ===
                .replace(/"fileAttachments"\s*:\s*\[[^\]]*\]/g, '"fileAttachments":["[FILE_ATTACHMENTS]"]')

                // === BUILD ARTIFACTS ===
                .replace(/_next\/static\/chunks\/[^"]+\.(css|js)/g, '_next/static/chunks/[BUILD_HASH].$1');

            return JSON.parse(cleaned);
        } catch (error) {
            window.Logger.error('InspectionManager', 'Normalization failed', error);
            return raw;
        }
    }

    // ==========================================
    // 2. Generation Inspector
    // ==========================================

    async captureGeneration(payload) {
        if (!payload || !payload.videoId) return;

        const rawData = payload.rawJson || payload;

        // NORMALIZE the raw data to strip fluid fields before comparison
        const normalizedRaw = this._normalizeConfig(rawData);

        const entry = {
            id: payload.videoId,
            timestamp: Date.now(),
            model: payload.modelName,
            mode: payload.mode,
            prompt: payload.videoPrompt,
            raw: rawData,                    // Store original for display
            normalizedRaw: normalizedRaw     // Used for comparison
        };

        // Compare NORMALIZED versions to ignore fluid fields
        const prevGen = this.history.generation[0];
        if (prevGen) {
            const prevNormalized = prevGen.normalizedRaw || this._normalizeConfig(prevGen.raw);

            // Check for exact duplicate (after normalization)
            if (JSON.stringify(prevNormalized) === JSON.stringify(normalizedRaw)) {
                window.Logger.debug('InspectionManager', 'Duplicate generation ignored (normalized)', entry.id);
                return;
            }
            // Diff the NORMALIZED structures
            entry.diff = this.getDiff(prevNormalized, normalizedRaw);
        }

        this.history.generation.unshift(entry);
        await this._saveHistory();
        window.Logger.info('InspectionManager', 'Captured generation', entry.id);
    }

    // ==========================================
    // 3. Post Inspector
    // ==========================================

    async capturePost(postData) {
        if (!postData) return;

        // Extract nested post entity from /get API response
        // Response structure: { result: { post: { id: ... } } }
        const post = postData?.result?.data?.post
            || postData?.result?.post
            || postData?.data?.post
            || postData?.post
            || postData;

        const postId = post?.id || post?.postId || post?.assetId;
        if (!postId) {
            window.Logger.warn('InspectionManager', 'Could not extract post ID from response', postData);
            return;
        }

        // Normalize and detect video content
        const { cleaned: normalizedRaw, hasVideo } = this._normalizePost(post);

        const entry = {
            id: postId,
            timestamp: Date.now(),
            url: window.location.href,
            raw: post, // Store just the post entity, not the wrapper
            normalizedRaw,
            hasVideo
        };

        // Diff against previous post viewed
        const prevPost = this.history.post[0];
        if (prevPost) {
            // Don't diff if it's the exact same post ID (e.g. clicked inspect twice)
            if (prevPost.id === entry.id) {
                // Return existing entry but update timestamp
                prevPost.timestamp = Date.now();
                await this._saveHistory();
                return prevPost;
            }

            // SMART DIFF LOGIC:
            // If comparing [Image Only] vs [Video Post], strip video fields from comparison
            // to avoid 70+ changes showing up.
            let obj1 = prevPost.normalizedRaw || this._normalizePost(prevPost.raw).cleaned;
            let obj2 = normalizedRaw;

            const isMixedType = (prevPost.hasVideo !== hasVideo);

            if (isMixedType) {
                // Create copies to strip fields without affecting storage
                obj1 = JSON.parse(JSON.stringify(obj1));
                obj2 = JSON.parse(JSON.stringify(obj2));

                const videoFields = ['videos', 'childPosts', 'videoUrl', 'videoPrompts', 'streamingVideoGenerationResponse'];

                if (prevPost.hasVideo) {
                    videoFields.forEach(f => delete obj1[f]);
                }
                if (hasVideo) {
                    videoFields.forEach(f => delete obj2[f]);
                }
                window.Logger.info('InspectionManager', 'Smart Diff: Stripped video fields for mixed-type comparison');
            }

            entry.diff = this.getDiff(obj1, obj2);
        }

        this.history.post.unshift(entry);
        await this._saveHistory();
        window.Logger.info('InspectionManager', 'Captured post inspection', entry.id);
        return entry;
    }

    /**
     * Specialized normalizer for Posts
     * Returns { cleaned, hasVideo }
     */
    _normalizePost(raw) {
        if (!raw) return { cleaned: {}, hasVideo: false };

        // 1. Standard normalization (UUIDs, timestamps, etc.)
        const cleaned = this._normalizeConfig(raw);

        // 2. Detect video content
        // hasVideo is true if videos array exists/populated OR childPosts has video types
        const hasVideosArray = Array.isArray(cleaned.videos) && cleaned.videos.length > 0;
        const hasVideoUrl = !!cleaned.videoUrl;

        // Check childPosts for video types (recursive check might be too heavy, just check top-level types)
        // Usually video posts have a 'videos' array or videoUrl
        const hasVideo = hasVideosArray || hasVideoUrl;

        // 3. If HAS video, maybe summarize arrays to avoid noise if not stripped? 
        // (User asked to keep them visible, but we strip them only during Mixed-Type Diff)

        return { cleaned, hasVideo };
    }

    // ==========================================
    // 4. Diff Engine
    // ==========================================

    /**
     * Flatten an object into dot-notation keys
     * e.g. { a: { b: 1 } } -> { "a.b": 1 }
     */
    _flatten(obj, prefix = '', res = {}) {
        if (obj === null || obj === undefined) {
            res[prefix] = obj;
            return res;
        }

        if (typeof obj === 'object' && !Array.isArray(obj)) {
            for (const key in obj) {
                const newPrefix = prefix ? `${prefix}.${key}` : key;
                this._flatten(obj[key], newPrefix, res);
            }
        }
        else if (Array.isArray(obj)) {
            // For arrays, treat index as key
            obj.forEach((item, index) => {
                const newPrefix = prefix ? `${prefix}[${index}]` : `[${index}]`;
                this._flatten(item, newPrefix, res);
            });
            if (obj.length === 0) {
                res[prefix] = [];
            }
        }
        else {
            res[prefix] = obj;
        }
        return res;
    }

    getDiff(oldObj, newObj) {
        // Safe check
        if (!oldObj) oldObj = {};
        if (!newObj) newObj = {};

        const diffs = [];
        const flatOld = this._flatten(oldObj);
        const flatNew = this._flatten(newObj);

        const allKeys = new Set([...Object.keys(flatOld), ...Object.keys(flatNew)]);

        allKeys.forEach(key => {
            const valOld = flatOld[key];
            const valNew = flatNew[key];

            if (valOld === undefined) {
                diffs.push({ type: 'added', key, val: valNew });
            } else if (valNew === undefined) {
                diffs.push({ type: 'removed', key, val: valOld });
            } else if (JSON.stringify(valOld) !== JSON.stringify(valNew)) {
                diffs.push({ type: 'changed', key, oldVal: valOld, newVal: valNew });
            }
        });

        // Sort by key for readability
        return diffs.sort((a, b) => a.key.localeCompare(b.key));
    }

    getHistory(type) {
        return this.history[type] || [];
    }

    clearHistory(type) {
        if (this.history[type]) {
            this.history[type] = [];
            this._saveHistory();
        }
    }

    // ==========================================
    // 5. Import / Export / Seed
    // ==========================================

    async exportConfigHistory() {
        const history = this.getHistory('config');
        const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `grok_config_history_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        window.Logger.info('InspectionManager', 'Exported config history');
    }

    async importConfigHistory(content, filename = 'Imported File') {
        try {
            // Logic ported from User Script "parseAndImportContent"
            let rawJson = null;
            let count = 0;

            // 1. Try Bulk Import (Array of History items)
            try {
                const possibleArray = typeof content === 'string' ? JSON.parse(content) : content;
                if (Array.isArray(possibleArray) && possibleArray.length > 0 && possibleArray[0].config) {
                    for (const item of possibleArray) {
                        const added = await this.captureConfig(item.config, item.url || filename); // Use captureConfig to dedupe/clean
                        if (added) count++;
                    }
                    await this._saveHistory();
                    return count;
                }
            } catch (e) { /* Not a JSON array */ }

            // 2. Try Standard Script Tag (HTML)
            const scriptMatch = content.match(/<script id="server-client-data-experimentation"[^>]*>([\s\S]*?)<\/script>/);
            if (scriptMatch && scriptMatch[1]) {
                try { rawJson = JSON.parse(scriptMatch[1]); } catch (e) { }
            }

            // 3. Try Hydration Stream
            if (!rawJson) {
                const hydrationMatch = content.match(/self\.__next_f\.push\(\[\d+,\s*"(\{\\\"status\\\":\\\"ready\\\"[\s\S]*?\})"/);
                if (hydrationMatch && hydrationMatch[1]) {
                    try {
                        const unescaped = hydrationMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                        rawJson = JSON.parse(unescaped);
                    } catch (e) { }
                }
            }

            // 4. Try Direct JSON Block
            if (!rawJson) {
                // Look for "status": "ready"
                const jsonStart = content.indexOf('{\n    "status": "ready",');
                if (jsonStart === -1) content.indexOf('{"status":"ready",');

                if (jsonStart !== -1) {
                    const potentialJson = content.substring(jsonStart);
                    try {
                        // Naive attempt to find end - tricky with nested braces. 
                        // User script logic:
                        const lastBrace = potentialJson.lastIndexOf('}');
                        if (lastBrace !== -1) rawJson = JSON.parse(potentialJson.substring(0, lastBrace + 1));
                    } catch (e) { }
                }
            }

            // 5. Try Direct Parse (Raw Config Object)
            if (!rawJson) {
                try {
                    const obj = JSON.parse(content);
                    if (obj.serverConfig || obj.status === 'ready') rawJson = obj;
                } catch (e) { }
            }

            if (rawJson) {
                const added = await this.captureConfig(rawJson, `File: ${filename}`);
                return added ? 1 : 0;
            }

            return 0; // Failed
        } catch (e) {
            window.Logger.error('InspectionManager', 'Import failed', e);
            throw e;
        }
    }

    async _seedData() {
        // "Hardcoded Base (ChromeVideo2)" from User Script (Full Payload)
        const seed = {
            "status": "ready",
            "serverConfig": {
                "customer_support_enabled": false,
                "enable_memory_toggle": true,
                "media_gen_video_config": {
                    "media_gen_video_available_models": [],
                    "media_gen_audio_available_models": [],
                    "media_gen_video_prompt_available_modes": [
                        { "display_name": "Custom", "mode_name": "custom", "custom_mode": true },
                        { "display_name": "Spicy", "mode_name": "extremely-spicy-or-crazy", "is_mature": true, "model_generated_only": true },
                        { "display_name": "Fun", "mode_name": "extremely-crazy" },
                        { "display_name": "Normal", "mode_name": "normal" }
                    ]
                },
                "short_id_to_model_id_map": {
                    "7": "grok-4-mini-thinking-tahoe",
                    "grok-4-1-non-thinking-w-tool": "grok-4-1-non-thinking-w-tool",
                    "grok-4-1-non-thinking-no-tool-1111b": "grok-4-1-non-thinking-no-tool-1111b"
                },
                "hide_models": { "hideModels": ["grok-latest", "grok-4-auto", "grok-3-mini-companion"] },
                "authless_grok_models": {
                    "models": [{ "id": "grok_3_1", "isDefault": true, "isOfficialModel": true, "badgeText": "", "title": "Grok 3", "description": "Our Newest Model", "visionModelIdentifier": "grok-3", "normalModelIdentifier": "grok-3", "reasoningModelIdentifier": "grok-3-reasoning", "maxImageUploads": 4, "deepSearchSupportsTrace": false }]
                },
                "authed_grok_models": {
                    "models": [{ "id": "grok_3_1", "isDefault": true, "isOfficialModel": true, "badgeText": "", "title": "Grok 3", "superTitle": "Grok 3", "description": "Our Newest Model", "visionModelIdentifier": "grok-3", "normalModelIdentifier": "grok-3", "reasoningModelIdentifier": "grok-3-reasoning", "maxImageUploads": 4, "deepSearchSupportsTrace": false }]
                },
                "grok35_flexible_input": {},
                "personality_presets": {
                    "personalityPresets": [
                        { "personalityId": "concise", "name": "Concise" },
                        { "personalityId": "formal", "name": "Formal" },
                        { "personalityId": "socratic", "name": "Socratic" },
                        { "personalityId": "comprehensive", "name": "Comprehensive" }
                    ]
                },
                "voice_mode_config": {},
                "max_files": { "max_files": 100 },
                "is_xai_employee": false,
                "is_x_employee": false,
                "new_voice_mode_1.0.36": false,
                "voice_mode_camera_rollout": false,
                "gork_voice_rollout": false,
                "allow_custom_prompts": false,
                "grok_4_mini_enable_inline_charts": true,
                "grok_4_mini_thinking_use_js": false,
                "fast_followup_config": { "enabled": false },
                "tool_composer_additional_tools": {},
                "tool_composer_config": { "max_qps_per_tool": 100, "server_rate_limit_config": { "default": 100 }, "client_rate_limit_config": { "default": { "default": 100 } } },
                "satisfaction_score": 3,
                "mixpanel_server_url": "",
                "try_projects_name": "pick-personas",
                "grok_code_install_command": "npm install -g @xai-official/grok",
                "grok_mode_extras": { "extra_modes": ["grok-4-1-thinking"] },
                "enable_memory_v2_explicit_tools": false,
                "bustin-test": [],
                "boyan-test-feature": { "a": "test" },
                "dm_test_flag": true,
                "test-initial-load": {},
                "enable_compact_query_bar": true,
                "enable_unselected_log": false,
                "enable_inline_text_followups": true,
                "show_nonmode_modes": true,
                "enable_unknown_tag_processing": true,
                "enable_templates": true,
                "enable_xai_logging": false,
                "enable_answer_suggestions": false,
                "enable_move_citation_cards_to_end": true,
                "enable_text_to_speech": true,
                "merge_model_mode_select": true,
                "enable_llm_suggestions": true,
                "enable_imagine_ws_logging": false,
                "enable_add_to_chat": true,
                "new_chat_always_auto": false,
                "show_citation_count": true,
                "show_surveys": true,
                "enable_imagine_model_override": false,
                "show_fast_tool": false,
                "show_imagine": true,
                "stock_suggestion_click_to_finance_page": false,
                "use_permissions": true,
                "show_deepsearch_suggestion_pill": true,
                "subscriptions_page_animate": false,
                "pdf-reader": true,
                "enable_shiki_code_highlighting": false,
                "use_user_settings_prefetch": true,
                "enable_single_thinking_different_summary_ui": false,
                "use_new_process_message_copy": true,
                "use_preloaded_avatar": false,
                "enable_notifications_decider": true,
                "show_financial_page": false,
                "use_separate_pinned_section_in_sidebar": true,
                "show_private_chat_error": true,
                "show_finance_suggestions": true,
                "show_model_mode_selector": true,
                "model_slider_experiment": false,
                "enable_grok_task_tools": false,
                "enable_heavy_subscription": true,
                "use_update_subscription_flow": true,
                "show_tool_image": false,
                "show-grok-4-home-promotion": false,
                "render_citation_as_pill": true,
                "enable_screen_sharing": false,
                "enable_notion_integration": false,
                "hide_model_select_upsell": false,
                "enable_markdown_breakout": false,
                "filter_out_step_bullets": false,
                "show_show_thoughts": false,
                "replace_home_pills_with_tasks": false,
                "enable_conversation_page_actions": true,
                "enable_grok_task_model_name_override": false,
                "disable_early_prefer_for_sbs": true,
                "hide_tool_json_args": true,
                "enable_virtual_cursor_in_rich_text_editor": false,
                "enable_chat_selection": true,
                "disable_edu_discount": true,
                "enable_grok_task_decider_ui": true,
                "enable_gcal_integration": false,
                "enable_data_grid_markdown_table": false,
                "enable_file_sharing": true,
                "enable_slack_integration": false,
                "enable_tiptap_editor": true,
                "enable_xlsx_editing": false,
                "files_show_extension": false,
                "show_sidebar_task_chats": true,
                "enable_xlsx_rendering": true,
                "enable_image_tab": false,
                "enable_image_editor_in_files": true,
                "disable_python_artifacts": false,
                "enable_data_grid_csv_component": true,
                "show_starry_idle": true,
                "default_use_tool_composer2": false,
                "enable_file_upload_in_markdown_editor": false,
                "grok_web_get_artifact_by_version_id": true,
                "enable_tool_composer": false,
                "workspace_sharing": true,
                "enable_mermaid_diagrams": true,
                "enable_voice_mode": true,
                "use_dynamic_suggested_mode_text": true,
                "enable_conversation_starters": false,
                "enable_sketchpad": true,
                "show_reddit_embeds": false,
                "show_x_inline": false,
                "enable_grok_tasks": true,
                "show_images_cards": true,
                "show_model_config_override": false,
                "enable_in_app_reporting": true,
                "only_use_single_youtube": true,
                "show_youtube_embeds": true,
                "workspace_agent": false,
                "show_artifact_to_workspace_button": false,
                "enable_microsoft_onedrive": true,
                "show_orb_icon_memory": false,
                "enable_csv_rendering": true,
                "show_followups": false,
                "show_sports_cards": true,
                "show_favorite_button": false,
                "show_artifacts_ask_grok_button": false,
                "suggestions_use_cache": false,
                "thinking_auto_open": false,
                "show_response_load_timer": true,
                "show_finance_cards": true,
                "enable_browser_notifications": true,
                "show_anon_help_link": false,
                "enable_auto_stream_retry": true,
                "show_artifacts_share_button": false,
                "show_open_in_app_dialog": true,
                "show_artifacts_explain_button": false,
                "enable_anon_users": false,
                "enable_conversation_tabs": false,
                "show_open_in_app_dialog_every_time": true,
                "show_open_in_app_dialog_download_default": true,
                "show_x_badge": true,
                "toggle_search_only": true,
                "enable_code_execution": true,
                "model_config": { "grok-4-1-non-thinking-w-tool": { "hidden": true } },
                "timeline_navigator": { "enabled": true, "maxResponses": 50, "minResponses": 3, "minScreenWidth": 800, "highlightOnScroll": true },
                "suggestions_config_llm_override": { "enabled": true, "useGrokTypeahead": true, "maxChars": 75, "throttleTimeMs": 250, "minChars": 4 },
                "code_config": {},
                "force_sign_in_models": {},
                "banner": {},
                "extra_suggestions": { "extraSuggestions": [] },
                "grok_analyze_url_prompt": { "message": "Explain this to me in three bullet points." },
                "enable_async_chat": false,
                "enable_unit_conversion": false,
                "enable_github_integration": false,
                "show_project_new_convo_input_guide": true,
                "example_projects_suggestion_pill": true,
                "enable_new_colors": false,
                "enable_imagine_video_button_v2": true,
                "show_imagine_dev_info": false,
                "model_address_override_options": {},
                "SHOW_GROKIPEDIA": true,
                "disable_self_harm_short_circuit": false,
                "enable_upscale_video": true,
                "enable_temporary_chat_leave_confirmation": false,
                "enable_voice_mode_pill": true,
                "enable_image_card_model_caption": false,
                "enable_imagine_extend_video_mode": false,
                "enable_imagine_text_to_video": true,
                "grok_code_local_server_enabled": false,
                "enable_performance_observer_logs": false,
                "enable_imagine_video_feed": true,
                "web_first_visit_server_side_render": false,
                "shallow_search_redesign": false,
                "enable_imagine_aspect_ratio": true,
                "show_open_in_app_splash_page": true,
                "enable_open_in_app_deep_link": true,
                "thinking_notes_redesign": false,
                "allow-highlights-access-web": false,
                "suggestions_show_dev_icon": false,
                "streaming_markdown_config": { "cutLength": 30, "maxHoldTimeMs": 300, "isEnabled": false },
                "suggestion_config_2": { "enabled": true, "grokEnabled": true, "maxChars": 70 },
                "suggestion_bing_worker": true,
                "enable_multiturn_suggestions": false,
                "log_suggestion_usage_data": true,
                "use_new_og_image_method": true,
                "show_grok_home_promotion_dialog": false,
                "enable_grok_4_1_upsells": true,
                "show_quick_answer_thumbs_up": true,
                "suggestion_qa_msg_template": "",
                "enable_imagine_video_length": false,
                "quick_answer_rating": "down",
                "enable_stream_close_error_throw": true,
                "enable_notifications": true,
                "notifications_fetch_interval_ms": 0,
                "enable_temp_always_request_share_link": true,
                "enable_imagine_delete_button": true,
                "enable_imagine_image_edit": true,
                "enable_highlights_dismiss_button": true,
                "redirect_request_convo_fetch_interval_ms": 5000,
                "enable_enterprise_teams_connectors_and_collections": true,
                "show_auto_share_settings": true,
                "enable_upgrade_button_in_chat_new_top_nav": false,
                "enable_upgrade_button_in_sidebar": false,
                "supergrok_paywall_annual_pricing_monthly_equivalent_enabled": false,
                "supergrok_paywall_annual_selected_default_enabled": false,
                "supergrok_paywall_interval_selector_at_top_enabled": false,
                "supergrok_paywall_hide_free_plan_card_enabled": false,
                "enable_upgrade_button_in_imagine_page": false,
                "enable_global_image_editor": true,
                "inline-rate-limit-banner": true,
                "show_memory_tool_usage": true,
                "disable_imagine_rabbit_hole": false,
                "enable_katex_scroll_feathering": false,
                "show_memory_tool_card_only_in_arena": true,
                "no_imagine_banner": false,
                "enable_code_parallel_agents": false,
                "enable_imagine_more_button": true,
                "show_streaming_response_pivot_button": false,
                "enable_imagine_query_bar_v2": false,
                "show_model_submenu": false,
                "enable_memory_v2_management": false,
                "show_model_hash_debug": false,
                "imagine_enable_child_post_ids": true,
                "enable_memory_editing": true,
                "enable_share_to_x_button": false,
                "enable_drawing_background_image": true,
                "hide_map_during_tiles_load": false,
                "enable_query_bar_v2": false,
                "forward_headers_imagine_og_route": false,
                "use_open_in_app_banner": true,
                "extra-config": {}
            }
        };
        await this.captureConfig(seed, "Hardcoded Base (Seed)");
    }
};
