// src/popup/popup.js
document.addEventListener('DOMContentLoaded', function () {
    const openUiBtn = document.getElementById('open-ui');
    const versionLabel = document.getElementById('gvp-version-label');

    if (versionLabel && chrome?.runtime?.getManifest) {
        try {
            const manifestVersion = chrome.runtime.getManifest().version;
            if (manifestVersion) {
                versionLabel.textContent = `v${manifestVersion}`;
            }
        } catch (error) {
            window.Logger.warn('Popup', 'Unable to read manifest version:', error);
        }
    }

    if (!openUiBtn) {
        window.Logger.error('Popup', 'Open UI button not found');
        return;
    }

    openUiBtn.addEventListener('click', function () {
        // Send message to content script to open the UI
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (!tabs || !tabs[0]) {
                window.Logger.error('Popup', 'No active tab found');
                alert('No active tab found. Please make sure you have a tab open on grok.com');
                return;
            }

            const tabUrl = tabs[0].url || '';
            if (!tabUrl.includes('grok.com')) {
                window.Logger.warn('Popup', 'Active tab is not on grok.com:', tabUrl);
                alert('Please navigate to grok.com first, then click the extension button.');
                return;
            }

            // Retry logic for content script initialization
            let retryCount = 0;
            const maxRetries = 3;
            const retryDelay = 500; // ms

            function attemptConnection() {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'openGVPUI' }, function (response) {
                    if (chrome.runtime.lastError) {
                        const errorMsg = chrome.runtime.lastError.message || 'Connection failed';

                        // If "Receiving end does not exist", content script not ready - retry
                        if (errorMsg.includes('Receiving end does not exist')) {
                            retryCount++;
                            if (retryCount < maxRetries) {
                                window.Logger.debug('Popup', `Content script not ready, retrying... (${retryCount}/${maxRetries})`);
                                setTimeout(attemptConnection, retryDelay);
                                return;
                            } else {
                                window.Logger.error('Popup', 'Content script failed to load after retries');
                                alert('Extension not ready. Please refresh the page and try again.');
                                return;
                            }
                        }

                        // Other errors - show to user
                        window.Logger.error('Popup', 'Chrome runtime error:', errorMsg);
                        alert('Failed to open GVP UI: ' + errorMsg);
                        return;
                    }

                    if (response && response.success) {
                        window.Logger.info('Popup', 'UI opened successfully');
                        window.close();
                    } else {
                        const errorMsg = response?.error || 'Unknown error';
                        window.Logger.error('Popup', 'Failed to open GVP UI:', errorMsg);
                        alert('Failed to open GVP UI: ' + errorMsg);
                    }
                });
            }

            attemptConnection();
        });
    });
});
