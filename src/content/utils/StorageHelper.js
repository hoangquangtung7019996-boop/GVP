// a:/Tools n Programs/SD-GrokScripts/grok-video-prompter-extension/src/content/utils/StorageHelper.js
// Storage helper functions for Chrome extension
// Dependencies: None

window.StorageHelper = {
    async setData(key, value) {
        return new Promise((resolve) => {
            chrome.storage.local.set({[key]: value}, resolve);
        });
    },
    async getData(key) {
        return new Promise((resolve) => {
            chrome.storage.local.get([key], (result) => {
                resolve(result[key]);
            });
        });
    },
    async setSettings(settings) {
        return new Promise((resolve) => {
            chrome.storage.local.set({'gvp-settings': settings}, resolve);
        });
    },
    async getSettings() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['gvp-settings'], (result) => {
                resolve(result['gvp-settings'] || {});
            });
        });
    }
};