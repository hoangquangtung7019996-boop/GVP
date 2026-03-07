// src/background/background.js
chrome.runtime.onInstalled.addListener(function () {
    console.log('Grok Video Prompter Extension installed');

    // Set default settings
    chrome.storage.local.get(['gvp-settings'], function (result) {
        if (!result['gvp-settings']) {
            const defaultSettings = {
                defaultMode: 'normal',
                autoRetryOnModeration: true,
                maxModerationRetries: 3,
                soundEnabled: true,
                debugMode: false
            };
            chrome.storage.local.set({ 'gvp-settings': defaultSettings });
        }
    });
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === 'getSettings') {
        chrome.storage.local.get(['gvp-settings'], function (result) {
            sendResponse({ settings: result['gvp-settings'] || {} });
        });
        return true; // Keep message channel open for async response
    }
});

// Handle extension icon click to toggle drawer
chrome.action.onClicked.addListener(function (tab) {
    // Send message to content script to toggle drawer; fallback to open
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleDrawer' }, function (response) {
                if (chrome.runtime.lastError) {
                    console.log('[GVP] Content script not ready:', chrome.runtime.lastError.message);
                    return;
                }

                if (!response || response.success !== true) {
                    // Fallback: ensure drawer can still be opened
                    chrome.tabs.sendMessage(tabs[0].id, { action: 'openGVPUI' }, function (fallbackResponse) {
                        if (chrome.runtime.lastError) {
                            console.log('[GVP] Failed to open UI after toggle attempt:', chrome.runtime.lastError.message);
                        } else if (!fallbackResponse || fallbackResponse.success !== true) {
                            console.log('[GVP] UI did not confirm open/toggle action');
                        }
                    });
                }
            });
        }
    });
});

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener(function (command) {
    if (command === 'reload-extension') {
        console.log('[GVP] Reload command triggered');

        // Get the active tab
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0] && tabs[0].url && tabs[0].url.includes('grok.com')) {
                const tabId = tabs[0].id;

                // Step 1: Reload the active tab (refreshes page and will re-inject content scripts after extension reload)
                chrome.tabs.reload(tabId)
                    .then(() => {
                        // Step 2: Fully reload the extension (restarts service worker, resets state, reinitializes everything)
                        chrome.runtime.reload();
                    })
                    .catch((error) => {
                        console.error('[GVP] Error reloading tab:', error);
                        // Still attempt extension reload even if tab reload fails
                        chrome.runtime.reload();
                    });
            } else {
                console.log('[GVP] Not on grok.com - performing extension reload only');
                chrome.runtime.reload();
            }
        });
    }
});
