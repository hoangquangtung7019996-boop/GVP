// src/utils/storage.js
export async function setData(key, value) {
  return chrome.storage.local.set({[key]: value});
}

export async function getData(key) {
  return chrome.storage.local.get([key]);
}

export async function setSettings(settings) {
  return chrome.storage.local.set({ 'gvp-settings': settings });
}

export async function getSettings() {
  const result = await chrome.storage.local.get(['gvp-settings']);
  return result['gvp-settings'] || {};
}

export async function clearAllData() {
  return chrome.storage.local.clear();
}

export async function getAllData() {
  return chrome.storage.local.get(null);
}
