// a:/Tools n Programs/SD-GrokScripts/grok-video-prompter-extension/src/content/utils/ModerationDetector.js
// Detects moderation events in Grok API responses.
// Dependencies: None

window.ModerationDetector = class ModerationDetector {
    /**
     * Check if response indicates moderated content
     * @param {object} responseData - Parsed API response
     * @returns {boolean} True if content was moderated
     */
    static detectModeratedContent(responseData) {
        if (!responseData || typeof responseData !== 'object') {
            return false;
        }

        // Check for direct moderation flags
        const moderationIndicators = [
            responseData.moderated === true,
            responseData.isRefused === true,
            responseData.content_moderated === true,
            responseData.status === 'moderated', // Added check
            responseData.error?.type === 'content_policy_violation',
            responseData.error?.code === 'moderation_filter_triggered',
            !!responseData.refusalReason, // Added check
            !!responseData.moderationReason // Added check
        ];

        // Check nested response structures
        const nestedCheck =
            responseData.result?.response?.moderated === true ||
            responseData.result?.response?.isRefused === true ||
            responseData.result?.response?.status === 'moderated'; // Added check

        return moderationIndicators.some(indicator => indicator === true) || nestedCheck;
    }

    /**
     * Extract moderation reason from response
     * @param {object} responseData - Parsed API response
     * @returns {string|null} Moderation reason or null
     */
    static extractModerationReason(responseData) {
        if (!responseData) return null;

        // Check various possible locations for moderation reason
        const possibleReasons = [
            responseData.error?.message,
            responseData.moderationReason,
            responseData.result?.response?.moderationReason,
            responseData.refusalReason,
            'Content flagged by moderation system' // Default
        ];

        return possibleReasons.find(reason => reason && typeof reason === 'string') || null;
    }

    /**
     * Check if response indicates video generation completion
     * @param {object} responseData - Parsed API response
     * @returns {boolean} True if generation completed successfully
     */
    static isGenerationComplete(responseData) {
        if (!responseData) return false;

        const videoResponse = responseData.result?.response?.streamingVideoGenerationResponse;
        if (!videoResponse) return false;

        return videoResponse.progress === 100 ||
            (videoResponse.videoUrl && videoResponse.videoUrl.length > 0);
    }
};