// StringUtils.js — Shared string utilities for the GVP Prompt System
// Used by: UIPromptLibraryManager, UIWordSwapperManager (future), UIRawInputManager

window.GVPStringUtils = {
    /**
     * Compute the Levenshtein edit distance between two strings.
     * Used by Word Swapper (System 5) for fuzzy rule matching.
     * @param {string} a
     * @param {string} b
     * @returns {number}
     */
    levenshtein(a, b) {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, (_, i) =>
            Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
        );
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                dp[i][j] = a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1]
                    : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
        return dp[m][n];
    },

    /**
     * Truncate a string to a max length, appending an ellipsis if cut.
     * @param {string} str
     * @param {number} [maxLen=80]
     * @returns {string}
     */
    truncate(str, maxLen = 80) {
        if (typeof str !== 'string') return '';
        return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
    },

    /**
     * Parse all {{token}} placeholders from a prompt body string.
     * Returns a deduplicated array of token names.
     * @param {string} body
     * @returns {string[]}
     */
    parsePlaceholders(body) {
        if (typeof body !== 'string') return [];
        const matches = body.match(/\{\{([^}]+)\}\}/g) || [];
        const tokens = matches.map(m => m.slice(2, -2).trim());
        return [...new Set(tokens)];
    },

    /**
     * Check whether two prompt strings are considered unique.
     * Per spec §1.2: differs by ≥1 character (simple inequality).
     * @param {string} a
     * @param {string} b
     * @returns {boolean}
     */
    promptsAreDifferent(a, b) {
        return (a || '').trim() !== (b || '').trim();
    }
};
