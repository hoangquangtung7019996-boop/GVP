/**
 * debounce.js - Utility for debouncing function calls
 * Used to prevent excessive re-renders during rapid user input
 * 
 * @version 1.21.45
 */

/**
 * Creates a debounced version of a function that delays execution
 * until after the specified wait time has elapsed since the last call.
 * 
 * @param {Function} fn - The function to debounce
 * @param {number} delay - Delay in milliseconds (default: 300)
 * @returns {Function} Debounced function
 * 
 * @example
 * const debouncedSearch = gvpDebounce((query) => search(query), 300);
 * input.addEventListener('input', (e) => debouncedSearch(e.target.value));
 */
window.gvpDebounce = function (fn, delay = 300) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
};

/**
 * Creates a throttled version of a function that executes at most once
 * per specified time interval.
 * 
 * @param {Function} fn - The function to throttle
 * @param {number} limit - Minimum time between calls in milliseconds
 * @returns {Function} Throttled function
 */
window.gvpThrottle = function (fn, limit = 100) {
    let inThrottle = false;
    return function (...args) {
        if (!inThrottle) {
            fn.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
};

if (window.Logger) window.Logger.debug('Utils', '🚀 debounce.js loaded (v1.21.45)');
