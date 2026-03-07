// src/options/options.js
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('settings-form');

    // Load current settings
    chrome.storage.local.get(['gvp-settings'], function(result) {
        const settings = result['gvp-settings'] || {};

        // Populate form
        document.getElementById('default-mode').value = settings.defaultMode || 'normal';
        document.getElementById('auto-retry').checked = settings.autoRetryOnModeration !== false;
        document.getElementById('max-retries').value = settings.maxModerationRetries || 3;
        document.getElementById('sound-enabled').checked = settings.soundEnabled !== false;
        document.getElementById('debug-mode').checked = settings.debugMode || false;
    });

    // Save settings
    form.addEventListener('submit', function(e) {
        e.preventDefault();

        const settings = {
            defaultMode: document.getElementById('default-mode').value,
            autoRetryOnModeration: document.getElementById('auto-retry').checked,
            maxModerationRetries: parseInt(document.getElementById('max-retries').value),
            soundEnabled: document.getElementById('sound-enabled').checked,
            debugMode: document.getElementById('debug-mode').checked
        };

        chrome.storage.local.set({ 'gvp-settings': settings }, function() {
            alert('Settings saved successfully!');
        });
    });
});
