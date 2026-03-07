// a:/Tools n Programs/SD-GrokScripts/grok-video-prompter-extension/src/content/utils/SentenceFormatter.js
// Provides sentence formatting utilities.
// Dependencies: None

window.SentenceFormatter = class SentenceFormatter {
    static toDisplay(text) {
        if (!text || typeof text !== 'string') return '';
        return text.replace(/\. /g, '.\n\n');
    }

    static toStorage(text) {
        if (!text || typeof text !== 'string') return '';
        return text.replace(/\n\n/g, ' ').replace(/\s+/g, ' ').trim();
    }

    static hasFormatting(text) {
        return text && text.includes('\n\n');
    }
};