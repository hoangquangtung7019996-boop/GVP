/**
 * GVP STANDARDIZED REGEX
 * 
 * Centralized regex patterns to ensure consistency across modules.
 */

try {
    window.GVP_REGEX = {
        // Standardized UUID regex for Grok images/posts
        // Handles: 
        // - /imagine/post/{uuid}
        // - /imagine-public/share-images/{uuid}
        // - /imagine/images/{uuid}
        // - /imagine/edit/{uuid}
        UUID: /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,

        // Pattern for extracting UUID from URL paths
        URL_UUID_PATH: /(?:share-images|images|post|edit)\/([0-9a-f-]{36})/i,

        // Fallback generic UUID pattern
        GENERIC_UUID: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    };

    window.Logger?.info?.('Regex', 'GVP_REGEX initialized successfully');
} catch (e) {
    console.error('CRITICAL: Regex failed to load', e);
}
