// a:/Tools n Programs/SD-GrokScripts/grok-video-prompter-extension/src/content/constants/stylesheet.js
// Contains the CSS styles for the Grok Video Prompter UI.
// Dependencies: None

window.GVP_STYLESHEET = `
        /* :host styles are injected via theme.js */

        #gvp-shell { position: fixed; top: 0; right: -420px; width: 452px; height: 100vh; display: flex; align-items: center; justify-content: flex-end; z-index: 10002; pointer-events: none; transition: right 0.3s ease; }
        #gvp-shell.open { right: 0; }
        #gvp-shell > * { pointer-events: auto; }
        #gvp-launcher-stack-wrapper { position: absolute; top: 0; left: 0; width: 28px; height: 100%; display: flex; flex-direction: column; justify-content: flex-start; pointer-events: none; padding: 12px 0; box-sizing: border-box; }
        #gvp-launcher-stack-wrapper > * { pointer-events: auto; display: flex; flex-direction: column; align-items: center; }
        #gvp-launcher-stack-top,
        #gvp-launcher { width: 28px; }
        #gvp-launcher-stack-top { gap: 4px; }
        #gvp-launcher { position: relative; width: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; margin-top: 0; }
        #gvp-launcher::before { display: none; }
        .gvp-launcher-inner { width: 100%; border-radius: 16px 0 0 16px; border: 1px solid rgba(78, 78, 78, 0.6); background: var(--gvp-bg-secondary, #212121); box-shadow: -3px 0 10px rgba(3,7,18,0.45); display: flex; align-items: center; justify-content: center; padding: 8px 0; }
        .gvp-launcher-btn { width: 100%; border: none; background: transparent; color: var(--gvp-text-primary); font-size: 9px; font-weight: 800; letter-spacing: 0.7px; text-transform: uppercase; writing-mode: vertical-rl; text-orientation: mixed; display: flex; align-items: center; justify-content: center; min-height: 112px; }
        .gvp-launcher-btn:hover { background: var(--gvp-bg-tertiary, #2a2a2a); }
        .gvp-launcher-btn .gvp-launcher-close { display: none; }
        #gvp-shell.open #gvp-launcher .gvp-launcher-btn .gvp-launcher-open { display: none; }
        #gvp-shell.open #gvp-launcher .gvp-launcher-btn .gvp-launcher-close { display: inline; }
        .gvp-launcher-bracket { width: 28px; display: flex; flex-direction: column; align-items: center; gap: 6px; background: transparent; border: none; }
        .gvp-launcher-tab { width: 100%; border-radius: 10px 0 0 10px; background: var(--gvp-bg-secondary, #212121); color: var(--gvp-text-secondary); font-size: 9px; font-weight: 700; text-transform: uppercase; writing-mode: vertical-rl; text-orientation: mixed; padding: 6px 3px; cursor: pointer; pointer-events: auto; transition: background 0.2s ease, color 0.2s ease; display: flex; align-items: center; justify-content: center; min-height: 68px; border: 1px solid rgba(15,23,42,0.6); margin: 0; }
        .gvp-launcher-tab.square { writing-mode: horizontal-tb; text-orientation: initial; font-size: 18px; min-height: 0; width: 24px; height: 24px; padding: 0; border-radius: 8px; pointer-events: auto; }
        .gvp-launcher-tab:hover { background: var(--gvp-bg-tertiary, #2a2a2a); }
        .gvp-launcher-tab.active { background: var(--gvp-btn-secondary-bg); color: var(--gvp-text-primary); border-color: var(--gvp-border); }
        #gvp-backdrop { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: transparent; z-index: 10000; opacity: 0; visibility: hidden; pointer-events: none; }
        #gvp-backdrop.visible { opacity: 0; visibility: hidden; }
        #gvp-drawer {
  position: absolute;
  top: 0;
  left: 28px;
  width: 420px;
  height: 100vh;    
  max-height: 100vh;
  min-height: 100vh;
  background: var(--gvp-bg-primary, #141414);
  border-left: 4px solid var(--gvp-bg-tertiary, #2a2a2a);
  box-shadow: -5px 0 20px rgba(0,0,0,0.9);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
        #gvp-drawer.expanded { width: 525px; }
        #gvp-header {
  height: 40px;
  min-height: 40px;
  max-height: 40px;
  background: var(--gvp-bg-primary, #141414);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  border-bottom: 2px solid var(--gvp-bg-tertiary, #2a2a2a);
  flex-shrink: 0;
  position: relative;
}

        #gvp-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--gvp-text-primary);
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
}

        .gvp-header-right {
  position: absolute;
  right: 12px;
  display: flex;
  gap: 8px;
  align-items: center;
}

        .gvp-header-left {
  position: absolute;
  left: 12px;
  display: flex;
  gap: 6px;
  align-items: center;
}

        .gvp-indicator {
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--gvp-border);
  border-radius: 4px;
  background: var(--gvp-bg-secondary, #212121);
  color: var(--gvp-text-secondary);
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  cursor: default;
  pointer-events: none;
}

        .gvp-indicator.active {
  color: var(--gvp-accent);
  border-color: var(--gvp-border);
  background: rgba(239, 68, 68, 0.1);
}

        #gvp-voice-indicator.active {
  color: var(--gvp-text-secondary);
  border-color: var(--gvp-border);
}

        .gvp-emoji-btn {
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--gvp-border);
  border-radius: 4px;
  background: var(--gvp-bg-secondary, #212121);
  color: var(--gvp-text-secondary);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

        .gvp-emoji-btn:hover {
  background: var(--gvp-bg-secondary, #212121);
  border-color: var(--gvp-border);
}

        .gvp-emoji-btn.active {
  color: var(--gvp-accent);
  border-color: var(--gvp-border);
  background: rgba(239, 68, 68, 0.1);
}

        .gvp-emoji-btn.generating {
  color: var(--gvp-text-secondary);
  border-color: var(--gvp-border);
  background: rgba(163, 163, 163, 0.1);
}

        /* Playlist header button - Standardized to match gvp-emoji-btn */
        /* Removed custom overrides to inherit standard button styles */
  box-shadow: 0 4px 12px rgba(244, 244, 245, 0.6);
}

        #gvp-tabs {
  display: flex;
  height: 40px;
  min-height: 40px;
  max-height: 40px;
  background: var(--gvp-bg-glass);
  border-bottom: 1px solid var(--gvp-border);
  overflow-x: hidden;
  overflow-y: hidden;
  flex-shrink: 0;
  gap: 2px;
  padding: 0 6px;
}
        .gvp-tab { flex: 1; min-width: 88px; padding: 6px 10px; text-align: center; background: transparent; border: none; cursor: pointer; font-size: 10.5px; font-weight: 500; color: var(--gvp-text-secondary); border-bottom: 3px solid transparent; transition: all 0.2s ease; }
        .gvp-tab:hover { background: var(--gvp-bg-tertiary, #2a2a2a); color: var(--gvp-text-muted); }
        .gvp-tab.active { background: var(--gvp-bg-secondary, #212121); color: var(--gvp-text-primary); border-bottom-color: var(--gvp-border); font-weight: 600; }
        #gvp-tab-content {
  flex: 0 0 auto;
  height: calc(100vh - 188px);
  max-height: calc(100vh - 188px);
  min-height: calc(100vh - 188px);
  overflow: hidden;
  background: var(--gvp-bg-primary, #141414);
}
        .gvp-tab-content {
  height: calc(100vh - 188px);
  max-height: calc(100vh - 188px);
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: none;
  padding: 0 12px 12px;
}
        .gvp-tab-content.active { display: block; }
        /* JSON Preset Panel (above grid) */
        .gvp-json-preset-panel { padding: 8px 12px; background: var(--gvp-bg-primary, #141414); border-bottom: 1px solid var(--gvp-border); }
        .gvp-preset-controls-container { display: flex; align-items: center; gap: 6px; }
        .gvp-preset-select-container { width: 95%; position: relative; }
        .gvp-json-preset-select { width: 100%; padding: 6px 8px; font-size: 11px; border-radius: 6px; border: 1px solid var(--gvp-border); background: var(--gvp-bg-secondary, #212121); color: var(--gvp-text-primary); cursor: pointer; }
        .gvp-json-preset-select:focus { outline: none; border-color: var(--gvp-border); box-shadow: 0 0 0 1px rgba(78, 78, 78, 0.35); }
        .gvp-json-preset-custom-input { width: 95%; padding: 6px 8px; font-size: 11px; border-radius: 6px; border: 1px solid var(--gvp-border); background: var(--gvp-bg-secondary, #212121); color: var(--gvp-text-primary); }
        .gvp-json-preset-custom-input:focus { outline: none; border-color: var(--gvp-border); box-shadow: 0 0 0 1px rgba(78, 78, 78, 0.5); }
        .gvp-preset-save-btn, .gvp-preset-view-btn { min-width: 36px; padding: 6px 10px; font-size: 16px; border-radius: 6px; cursor: pointer; }
        .gvp-preset-save-btn { background: var(--gvp-bg-tertiary, #2a2a2a); border: 1px solid var(--gvp-border); color: white; }
        .gvp-preset-save-btn:hover { background: #343434; }
        .gvp-preset-view-btn { background: var(--gvp-bg-secondary, #212121); border: 1px solid var(--gvp-border); color: white; }
        .gvp-preset-view-btn:hover { background: var(--gvp-bg-secondary, #212121); }
        /* Category Grid (shrunk by 10%, added top padding) */
        #gvp-category-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 6px; row-gap: 50px; padding: 8px 4px 6px; overflow-y: auto; align-content: start; grid-auto-rows: min-content; }
        .gvp-category-card { height: 101px; min-height: 101px; background: var(--gvp-bg-secondary, #212121); border: 1px solid var(--gvp-border); border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 11px; font-weight: 600; text-align: center; padding: 10px; color: var(--gvp-text-primary); box-shadow: 0 1px 3px rgba(0,0,0,0.25); transition: all 0.2s ease; }
        .gvp-category-card:hover { background: var(--gvp-bg-tertiary, #2a2a2a); border-color: var(--gvp-border); transform: translateY(-4px); box-shadow: 0 8px 16px rgba(0,0,0,0.5); }
        #gvp-subarray-view { display: none; flex-direction: column; height: 100%; background: var(--gvp-bg-primary, #141414); box-sizing: border-box; overflow-x: hidden; }
        #gvp-subarray-view.visible { display: flex; opacity: 1; }
        #gvp-subarray-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--gvp-border); background: var(--gvp-bg-primary, #141414); min-height: 40px; flex-shrink: 0; }
        #gvp-subarray-title { font-size: 13px; font-weight: 700; flex: 1; color: var(--gvp-border); text-transform: uppercase; letter-spacing: 0.4px; }
        #gvp-subarray-back-btn { padding: 5px 8px; font-size: 9.5px; }
        #gvp-subarray-container { flex: 1; padding: 8px 12px 12px; overflow-y: auto; overflow-x: hidden; background: var(--gvp-bg-primary, #141414); }
        .gvp-form-group { margin-bottom: 12px; }
        .gvp-label { display: block; margin-bottom: 4px; font-weight: 600; font-size: 11px; color: var(--gvp-text-muted); }
        .gvp-form-row { display: flex; gap: 8px; align-items: flex-start; }
        .gvp-input, .gvp-select, .gvp-textarea { flex: 1; padding: 8px 12px; border: 1px solid var(--gvp-border); border-radius: 6px; background-color: var(--gvp-bg-secondary, #212121); color: var(--gvp-text-primary); font-size: 12px; font-family: inherit; box-sizing: border-box; transition: border-color 0.2s ease; }
        .gvp-input:focus, .gvp-select:focus, .gvp-textarea:focus { outline: none; border-color: var(--gvp-border); box-shadow: 0 0 0 2px rgba(78, 78, 78, 0.1); }
        .gvp-textarea {
  /* CRITICAL: Prevent focus interference */
  pointer-events: auto !important;
  user-select: text !important;
  -webkit-user-select: text !important;
  -moz-user-select: text !important;
  isolation: isolate;
  contain: content;
  height: 120px;
  min-height: 120px;
  max-height: 120px;
  resize: none;
  overflow-y: auto;
  box-sizing: border-box;
  font-size: 11px;
  line-height: 1.4;
  padding: 8px;
}

        .gvp-textarea:focus {
            outline: 2px solid var(--gvp-bg-tertiary, #2a2a2a) !important;
            border-color: var(--gvp-bg-tertiary, #2a2a2a) !important;
            z-index: 9999 !important;
        }
        .gvp-button { padding: 8px 12px; border-radius: 6px; font-weight: 600; transition: all 0.2s ease; background-color: var(--gvp-bg-secondary, #212121); color: var(--gvp-text-primary); border: 1px solid var(--gvp-border); cursor: pointer; font-size: 11px; white-space: nowrap; }
        .gvp-button:hover { background-color: var(--gvp-bg-secondary, #212121); }
        .gvp-button.primary { background: var(--gvp-bg-tertiary, #2a2a2a); border-color: var(--gvp-border); color: var(--gvp-text-primary); }
        .gvp-button.primary:hover { background: #343434; border-color: var(--gvp-border); }
        .gvp-spicy-mode-btn.active { background: linear-gradient(135deg, var(--gvp-accent), var(--gvp-accent-hover)); border-color: var(--gvp-border); color: white; font-weight: 700; }
        .gvp-checkbox-container { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
        .gvp-checkbox-container input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; accent-color: var(--gvp-border); }
        .gvp-checkbox-container label { color: var(--gvp-text-primary); font-size: 12px; cursor: pointer; margin: 0; }
        .gvp-array-container { border: 1px solid var(--gvp-border); border-radius: 6px; padding: 12px; background-color: var(--gvp-bg-secondary, #212121); box-shadow: 0 2px 4px rgba(0,0,0,0.3); }
        .gvp-array-item { display: flex; gap: 8px; margin-bottom: 8px; align-items: stretch; padding: 8px; border-radius: 6px; transition: background-color 0.2s ease; }
        .gvp-array-item:hover { background-color: var(--gvp-bg-secondary, #212121); }
        .gvp-array-item textarea { flex: 1; resize: vertical; min-height: 60px; font-family: inherit; }
        .gvp-array-item input[type="text"] { flex: 1; }
        .gvp-dialogue-container { display: flex; flex-direction: column; gap: 12px; }
        .gvp-dialogue-item { flex-direction: column; gap: 12px; align-items: stretch; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); }
        .gvp-dialogue-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; width: 100%; }
        .gvp-dialogue-field { display: flex; flex-direction: column; gap: 4px; }
        .gvp-dialogue-field label { font-size: 11px; font-weight: 600; color: var(--gvp-text-secondary); }
        .gvp-dialogue-field textarea { min-height: 60px; resize: vertical; }
        .gvp-dialogue-custom-character { width: 100%; margin-top: 4px; }
        .gvp-dialogue-checkbox { flex-direction: row; align-items: center; gap: 8px; }
        .gvp-dialogue-checkbox label { margin: 0; }
        .gvp-dialogue-time-pair { display: flex; gap: 8px; }
        .gvp-dialogue-time-input { width: 100%; }
        #gvp-progress-section {
  position: fixed;
  bottom: 110px;
  right: 0;
  width: 420px;
  height: 20px;
  min-height: 20px;
  max-height: 20px;
  background: var(--gvp-bg-primary, #141414);
  border-top: 1px solid var(--gvp-border);
  border-bottom: 1px solid var(--gvp-border);
  display: flex;
  align-items: center;
  padding: 0 12px;
  z-index: 10002;
  transform: translateX(100%);
  transition: transform 0.3s ease, width 0.3s ease;
  flex-shrink: 0;
}

        #gvp-progress-section.visible {
  transform: translateX(0);
}

        #gvp-progress-bar {
  width: 100%;
  height: 6px;
  background: #1a1f2e;
  border-radius: 3px;
  overflow: hidden;
  position: relative;
}

        #gvp-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--gvp-text-primary), #e5e7eb);
  border-radius: 3px;
  width: 0%;
  transition: width 0.3s ease;
}
        #gvp-bottom-bar {
            display: none;
            flex-direction: column;
            align-items: stretch;
            gap: 6px;
            background: var(--gvp-bg-primary, #141414);
            border-top: 1px solid var(--gvp-border);
            position: absolute;
            left: 50%;
            bottom: 0px;
            width: 420px;
            max-width: 420px;
            padding: 8px 14px;
            transform: translateX(-50%);
        }
        #gvp-bottom-bar.visible { display: flex; opacity: 1; pointer-events: auto; }
        #gvp-bottom-bar.expanded { width: 525px; }
        .gvp-bottom-row { display: flex; align-items: center; gap: 8px; width: 100%; }
        .gvp-bottom-row.top { justify-content: space-between; }
        .gvp-bottom-row.bottom { justify-content: space-between; }
        .gvp-bottom-row .gvp-button { flex: 1; text-align: center; min-width: 0; }
        #gvp-bottom-bar .gvp-button { padding: 7px 12px; font-size: 10.5px; }
        #gvp-bottom-bar .gvp-button.primary { padding: 7px 14px; }
        #gvp-bottom-bar .gvp-quick-toggle { min-width: 0; }
        #gvp-bottom-bar .gvp-quick-toggle.active {
            background: var(--gvp-bg-tertiary, #2a2a2a);
            border-color: var(--gvp-border);
            color: #fff;
            font-weight: 700;
        }
        #gvp-bottom-bar .gvp-spicy-mode-btn { max-width: 140px; justify-content: center; }
        /* z-index: 10005 — above manager modals (10004), below import (10006) */
        #gvp-fullscreen-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: var(--gvp-bg-primary, #141414); z-index: 10005; display: none; flex-direction: column; opacity: 0; transform: scale(0.95); transition: all 0.3s ease; }
        #gvp-fullscreen-modal.visible { display: flex; opacity: 1; transform: scale(1); }
        #gvp-fullscreen-header { height: 60px; background: var(--gvp-bg-primary, #141414); color: white; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-bottom: 2px solid var(--gvp-bg-tertiary, #2a2a2a); flex-shrink: 0; }
        #gvp-fullscreen-title { font-weight: 600; font-size: 16px; }
        #gvp-fullscreen-content { flex: 1; padding: 16px; overflow-y: auto; }
        #gvp-fullscreen-textarea { width: calc(100vw - 32px); height: calc(100vh - 180px); border: 1px solid var(--gvp-border); border-radius: 6px; padding: 16px; font-size: 13px; line-height: 1.6; resize: none; background: var(--gvp-bg-secondary, #212121); color: var(--gvp-text-primary); font-family: 'Courier New', monospace; box-sizing: border-box; }
        #gvp-fullscreen-textarea:focus { outline: none; border-color: var(--gvp-border); box-shadow: 0 0 0 2px rgba(78, 78, 78, 0.1); }
        #gvp-fullscreen-footer { height: 60px; background: var(--gvp-bg-secondary, #212121); display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-top: 1px solid var(--gvp-border); flex-shrink: 0; gap: 8px; }
        #gvp-fullscreen-footer span { color: var(--gvp-text-secondary); font-size: 12px; margin-left: auto; }
        #gvp-view-json-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 10003; display: none; align-items: center; justify-content: center; padding: 24px; }
        #gvp-view-json-modal.visible { display: flex; }
        #gvp-view-json-content { background: var(--gvp-bg-primary, #141414); border-radius: 8px; padding: 24px; max-width: 800px; max-height: 80vh; width: 100%; box-shadow: 0 20px 50px rgba(0,0,0,0.9); border: 1px solid var(--gvp-border); display: flex; flex-direction: column; }
        #gvp-view-json-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--gvp-border); }
        #gvp-view-json-title { font-size: 18px; font-weight: 600; color: var(--gvp-text-primary); }
        #gvp-view-json-close { background: var(--gvp-bg-secondary, #212121); border: 1px solid var(--gvp-border); color: var(--gvp-text-secondary); width: 32px; height: 32px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; font-size: 16px; }
        #gvp-view-json-close:hover { background: #b91c1c; border-color: #991b1b; color: white; }
        #gvp-view-json-textarea { width: 100%; height: 300px; border: 1px solid var(--gvp-border); border-radius: 6px; padding: 12px; font-size: 11px; line-height: 1.4; resize: vertical; background: var(--gvp-bg-primary, #141414); color: var(--gvp-text-primary); font-family: 'Courier New', monospace; box-sizing: border-box; }
        #gvp-view-json-footer { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--gvp-border); display: flex; gap: 8px; justify-content: flex-end; }
        /* z-index: 10006 — topmost overlay, always appears above manager per user requirement */
        #gvp-import-json-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); z-index: 10006; display: none; align-items: center; justify-content: center; padding: 24px; }
        #gvp-import-json-modal.visible { display: flex; }
        #gvp-import-json-content { background: var(--gvp-bg-primary, #141414); border-radius: 12px; max-width: 700px; width: 100%; max-height: 85vh; box-shadow: 0 25px 60px rgba(0,0,0,0.95); border: 1px solid var(--gvp-border); display: flex; flex-direction: column; overflow: hidden; }
        #gvp-import-json-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; background: var(--gvp-bg-secondary, #212121); border-bottom: 2px solid var(--gvp-bg-tertiary, #2a2a2a); }
        #gvp-import-json-title { font-size: 18px; font-weight: 600; color: #fcfcfc; display: flex; align-items: center; gap: 8px; }
        #gvp-import-json-close { background: transparent; border: none; color: var(--gvp-text-secondary); width: 32px; height: 32px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; font-size: 24px; font-weight: 300; line-height: 1; }
        #gvp-import-json-close:hover { background: #b91c1c; color: white; transform: rotate(90deg); }
        #gvp-import-json-body { padding: 24px; overflow-y: auto; flex: 1; }
        #gvp-import-json-body label { color: var(--gvp-text-primary); font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        #gvp-import-json-textarea { width: 100%; min-height: 280px; border: 2px solid var(--gvp-border); border-radius: 8px; padding: 14px; font-size: 12px; line-height: 1.5; resize: vertical; background: var(--gvp-bg-primary, #141414); color: var(--gvp-text-primary); font-family: 'Consolas', 'Monaco', 'Courier New', monospace; box-sizing: border-box; transition: all 0.2s ease; }
        #gvp-import-json-textarea:focus { outline: none; border-color: var(--gvp-border); box-shadow: 0 0 0 3px rgba(38,38,38,0.15); background: var(--gvp-bg-secondary, #212121); }
        #gvp-import-json-textarea::placeholder { color: var(--gvp-text-secondary); }
        #gvp-import-json-name { width: 100%; border: 2px solid var(--gvp-border); border-radius: 8px; padding: 12px 14px; font-size: 14px; background: var(--gvp-bg-primary, #141414); color: var(--gvp-text-primary); box-sizing: border-box; transition: all 0.2s ease; }
        #gvp-import-json-name:focus { outline: none; border-color: var(--gvp-border); box-shadow: 0 0 0 3px rgba(38,38,38,0.15); background: var(--gvp-bg-secondary, #212121); }
        #gvp-import-json-name::placeholder { color: var(--gvp-text-secondary); }
        #gvp-import-json-footer { padding: 20px 24px; background: var(--gvp-bg-secondary, #212121); border-top: 1px solid #374151; }
        #gvp-import-json-footer button { min-width: 100px; }
        #gvp-prompt-history-modal {
            position: fixed;
            top: 76px;
            right: 40px;
            width: 360px;
            max-width: calc(100% - 80px);
            background: var(--gvp-bg-primary, #141414);
            border: 1px solid #2a3141;
            border-radius: 8px;
            box-shadow: -12px 18px 34px rgba(0, 0, 0, 0.55);
            display: none;
            flex-direction: column;
            gap: 12px;
            padding: 14px 16px 12px;
            z-index: 10004;
            pointer-events: none;
        }

        #gvp-prompt-history-modal.visible {
            display: flex;
            pointer-events: auto;
        }

        #gvp-prompt-history-content {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        #gvp-prompt-history-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-bottom: 6px;
            border-bottom: 1px solid #1e2433;
        }

        #gvp-prompt-history-title {
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.4px;
            color: var(--gvp-border);
            text-transform: uppercase;
        }

        #gvp-prompt-history-close {
            width: 26px;
            height: 26px;
            border-radius: 4px;
            background: var(--gvp-bg-secondary, #212121);
            border: 1px solid var(--gvp-border);
            color: var(--gvp-text-muted);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
            font-size: 16px;
            line-height: 1;
        }

        #gvp-prompt-history-close:hover {
            background: #b91c1c;
            border-color: #991b1b;
            color: #fff;
        }

        #gvp-prompt-history-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
            max-height: 260px;
            overflow-y: auto;
            padding-right: 4px;
        }

        .gvp-prompt-history-empty {
            font-size: 11px;
            color: var(--gvp-text-secondary);
            text-align: center;
            padding: 12px 8px;
            border: 1px dashed #2f3a4f;
            border-radius: 6px;
        }

        .gvp-prompt-history-item {
            display: flex;
            flex-direction: column;
            gap: 8px;
            border: 1px solid #1f2535;
            border-radius: 6px;
            padding: 10px 12px;
            background: rgba(17, 24, 39, 0.85);
        }

        .gvp-prompt-history-item-header {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            color: var(--gvp-text-secondary);
        }

        .gvp-prompt-history-badge {
            padding: 2px 6px;
            border-radius: 4px;
            background: rgba(38, 38, 38, 0.12);
            border: 1px solid rgba(38, 38, 38, 0.4);
            color: var(--gvp-border);
            font-weight: 600;
        }

        .gvp-prompt-history-moderated {
            padding: 2px 6px;
            border-radius: 4px;
            background: rgba(239, 68, 68, 0.15);
            border: 1px solid rgba(239, 68, 68, 0.4);
            color: #fca5a5;
            font-weight: 600;
        }

        .gvp-prompt-history-source {
            margin-left: auto;
            font-weight: 600;
        }

        .gvp-prompt-history-time {
            font-weight: 600;
        }

        .gvp-prompt-history-preview {
            margin: 0;
            font-size: 11px;
            line-height: 1.4;
            color: var(--gvp-text-primary);
            white-space: pre-wrap;
            max-height: 140px;
            overflow: hidden;
        }

        .gvp-prompt-history-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
        }

        #gvp-prompt-history-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-top: 6px;
            border-top: 1px solid #1e2433;
            font-size: 10px;
            color: var(--gvp-text-secondary);
        }

        #gvp-prompt-history-info {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 70%;
        }

        #gvp-prompt-history-footer .gvp-button {
            padding: 6px 12px;
            font-size: 10.5px;
        }
        #gvp-settings-panel {
            position: absolute;
            inset: 40px 0 24px 0;
            display: none;
            align-items: center;
            justify-content: center;
            background: transparent;
            z-index: 10004;
        }

        #gvp-settings-panel.visible {
            display: flex;
        }

        #gvp-settings-panel .gvp-settings-panel-container {
            width: calc(100% - 32px);
            max-width: 600px;
            background: var(--gvp-bg-primary, #141414);
            border: 1px solid var(--gvp-border);
            border-radius: 8px;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8);
            display: flex;
            flex-direction: column;
            max-height: 100%;
        }

        .gvp-settings-panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            border-bottom: 1px solid #262d40;
            color: var(--gvp-border);
            font-weight: 600;
            font-size: 12px;
            letter-spacing: 0.4px;
        }

        .gvp-settings-panel-body {
            padding: 12px 16px 16px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .gvp-settings-close-btn {
            width: 26px;
            height: 26px;
            padding: 0;
            border-radius: 4px;
            font-size: 13px;
            line-height: 1;
        }

        .gvp-settings-content {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        /* Settings Panel Accordion Styles (scoped to avoid conflicts) */
        .gvp-settings-content .gvp-accordion {
            border: 1px solid var(--gvp-border);
            border-radius: 6px;
            background: var(--gvp-bg-secondary, #212121);
            overflow: hidden;
        }
        .gvp-settings-content .gvp-accordion-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 12px;
            cursor: pointer;
            background: var(--gvp-bg-secondary, #212121);
            border: none;
            width: 100%;
            text-align: left;
            color: var(--gvp-text-primary);
            font-weight: 600;
            font-size: 11px;
            letter-spacing: 0.3px;
            transition: background 0.2s ease;
        }
        .gvp-settings-content .gvp-accordion-header:hover {
            background: var(--gvp-bg-secondary, #212121);
        }
        .gvp-settings-content .gvp-accordion-header.active {
            background: var(--gvp-bg-secondary, #212121);
            border-bottom: 1px solid #4b5563;
        }
        .gvp-settings-content .gvp-accordion-icon {
            font-size: 10px;
            transition: transform 0.2s ease;
            color: var(--gvp-text-secondary);
        }
        .gvp-settings-content .gvp-accordion-header.active .gvp-accordion-icon {
            transform: rotate(180deg);
        }
        .gvp-settings-content .gvp-accordion-content {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.3s ease;
            background: var(--gvp-bg-primary, #141414);
        }
        .gvp-settings-content .gvp-accordion-content.open {
            max-height: 2000px;
            padding: 12px;
        }
        #gvp-debug-log { flex: 1; overflow-y: auto; background: var(--gvp-bg-primary, #141414); color: #0f0; font-family: 'Courier New', monospace; font-size: 11px; padding: 12px; border-radius: 6px; border: 1px solid var(--gvp-border); line-height: 1.4; }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: var(--gvp-bg-primary, #141414); }
        ::-webkit-scrollbar-thumb { background: var(--gvp-border); border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: var(--gvp-border); }

        /* Generation Status Indicators - Stage 4 */
        .gvp-status-container {
            padding: 12px 16px;
            background: var(--gvp-bg-primary, #141414);
            border-bottom: 1px solid var(--gvp-border);
            display: flex;
            flex-direction: column;
            gap: 8px;
            height: 92px;
            min-height: 92px;
            max-height: 92px;
            flex-shrink: 0;
            overflow: hidden;
        }

        .gvp-status-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }

        .gvp-status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            transition: all 0.3s ease;
        }

        .gvp-status-badge.idle {
            background: rgba(107, 114, 128, 0.2);
            color: var(--gvp-text-secondary);
            border: 1px solid #4b5563;
        }

        .gvp-status-badge.generating {
            background: rgba(78, 78, 78, 0.2);
            color: var(--gvp-text-secondary);
            border: 1px solid var(--gvp-border);
            animation: pulse-gray 2s infinite;
        }

        .gvp-status-badge.moderated {
            background: rgba(251, 191, 36, 0.2);
            color: var(--gvp-border);
            border: 1px solid var(--gvp-border);
            animation: pulse-warning 2s infinite;
        }

        .raw-template-grid {
            display: grid;
            grid-template-columns: repeat(2, 24px) minmax(0, 1fr) repeat(2, 24px) 24px;
            align-items: center;
            gap: 6px;
        }

        .raw-template-select {
            width: 100%;
            min-width: 0;
            font-size: 11px;
            padding: 6px 10px;
        }

        .raw-template-trigger {
            width: 24px;
            height: 24px;
            padding: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            border-radius: 6px;
        }

        .raw-template-trigger.has-value {
            border-color: #e5e7eb;
            color: var(--gvp-text-primary);
            background: rgba(52, 52, 52, 0.85);
        }

        .gvp-button.ghost {
            background: rgba(38, 38, 38, 0.6);
            border-color: rgba(72, 73, 75, 0.9);
            color: var(--gvp-text-primary);
        }

        .gvp-button.ghost:hover {
            background: rgba(52, 52, 52, 0.9);
            border-color: rgba(72, 73, 75, 0.8);
            color: var(--gvp-text-primary);
        }

        .gvp-button.ghost.raw-template-trigger.has-value {
            background: rgba(72, 73, 75, 0.95);
            border-color: var(--gvp-text-primary);
            color: var(--gvp-text-primary);
        }

        .gvp-button.gvp-save-btn {
            background: rgba(153, 27, 27, 0.9);
            border-color: rgba(220, 38, 38, 0.9);
            color: #fee2e2;
            width: 36px;
            height: 36px;
            padding: 0;
        }

        .gvp-button.gvp-save-btn:hover {
            background: rgba(185, 28, 28, 1);
            border-color: rgba(248, 113, 113, 0.9);
            color: var(--gvp-text-primary);
        }

        .gvp-button-column {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-left: 8px;
        }

        .gvp-array-controls {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-left: 8px;
            align-items: center;
            justify-content: flex-start;
        }

        .gvp-array-controls .gvp-button {
            width: 32px;
            height: 32px;
            padding: 0;
        }

        .gvp-select-custom {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .gvp-array-input {
            flex: 1;
            display: flex;
        }

        .gvp-array-input textarea,
        .gvp-array-input input {
            flex: 1;
            width: 100%;
        }

        .raw-template-check {
            width: 16px;
            height: 16px;
            margin: 0;
        }

        .raw-template-remove {
            width: 24px;
            height: 24px;
            padding: 0;
            font-size: 12px;
            color: #fca5a5;
            border-color: rgba(127, 29, 29, 0.8);
        }

        .raw-template-remove:hover {
            background: rgba(239, 68, 68, 0.12);
            border-color: rgba(239, 68, 68, 0.6);
            color: #fecaca;
        }

        .raw-template-empty {
            padding: 36px 20px;
            border: 1px dashed rgba(55, 65, 81, 0.8);
            border-radius: 10px;
            text-align: center;
            color: var(--gvp-text-secondary);
            font-size: 12px;
            background: rgba(38, 38, 38, 0.85);
        }

        .raw-template-empty strong {
            display: block;
            margin-bottom: 6px;
            color: var(--gvp-text-primary);
            font-size: 12px;
        }

        /* Raw Input Tab Styles - Stage 8 */
        .raw-input-container {
            display: flex;
            flex-direction: column;
            width: 100%;
            max-width: 380px;
            margin: 12px auto 16px;
            padding: 8px 8px 12px;
            box-sizing: border-box;
            gap: 8px;
            align-items: stretch;
            justify-content: flex-start;
        }

        .raw-input-accordion-stack {
            display: flex;
            flex-direction: column;
            gap: 8px;
            width: 100%;
        }

        .raw-input-body {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .raw-input-body .gvp-label {
            margin-bottom: 2px;
        }

        #gvp-raw-input-textarea {
            min-height: 160px;
        }

        .raw-input-container .gvp-accordion {
            border-radius: 8px;
            border: 1px solid rgba(72, 73, 75, 0.7);
            background: var(--gvp-bg-primary, #141414);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
        }

        .raw-input-container .gvp-accordion-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            padding: 8px 12px;
            background: #181818;
            border: none;
            color: var(--gvp-text-primary);
            font-size: 11px;
            font-weight: 600;
            text-align: left;
        }

        .raw-input-container .gvp-accordion-title-wrap {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .raw-input-container .gvp-accordion-title-icon {
            font-size: 13px;
        }

        .raw-input-container .gvp-accordion-title {
            font-size: 11px;
        }

        .raw-input-container .gvp-accordion-chevron {
            font-size: 10px;
            color: var(--gvp-text-secondary);
        }

        .raw-input-container .gvp-accordion-content {
            padding: 10px 12px 12px;
            border-top: 1px solid rgba(72, 73, 75, 0.6);
            background: var(--gvp-bg-primary, #141414);
        }

        .raw-input-container .gvp-accordion-content[hidden] {
            padding: 0;
            border-top: none;
        }

        .input-section {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 8px;
            width: 100%;
            min-height: 200px;
            align-items: stretch;
        }

        .options-section {
            border-top: 1px solid var(--gvp-border);
            padding-top: 16px;
            padding-bottom: 8px;
            width: 100%;
            flex-shrink: 0;
        }

        .option-group {
            margin-bottom: 16px;
            width: 100%;
        }

        .template-section {
            border-top: 1px solid var(--gvp-border);
            padding-top: 16px;
            padding-bottom: 8px;
            width: 100%;
            flex-shrink: 0;
        }

        .template-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 8px;
            margin-top: 8px;
            width: 100%;
        }

        .template-btn {
            padding: 6px 12px;
            font-size: 11px;
            border-radius: 4px;
            background: var(--gvp-bg-secondary, #212121);
            color: var(--gvp-text-primary);
            border: 1px solid var(--gvp-border);
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .template-btn:hover {
            background: var(--gvp-bg-secondary, #212121);
            border-color: var(--gvp-border);
            color: var(--gvp-border);
        }

        .preview-section {
            border-top: 1px solid var(--gvp-border);
            padding-top: 16px;
        }

        .preview-content {
            background: var(--gvp-bg-primary, #141414);
            border: 1px solid var(--gvp-border);
            border-radius: 6px;
            padding: 12px;
            margin-top: 8px;
            font-size: 12px;
        }

        .preview-item pre {
            background: var(--gvp-bg-secondary, #212121);
            padding: 8px;
            border-radius: 4px;
            margin: 8px 0;
            font-size: 11px;
            white-space: pre-wrap;
            word-break: break-word;
        }

        .preview-metadata {
            display: flex;
            gap: 12px;
            margin: 8px 0;
            font-size: 10px;
            color: var(--gvp-text-secondary);
        }

        .preview-warnings, .preview-suggestions {
            margin: 8px 0;
            padding: 8px;
            background: rgba(38, 38, 38, 0.1);
            border-radius: 4px;
            border-left: 3px solid var(--gvp-bg-tertiary, #2a2a2a);
        }

        .preview-warnings strong, .preview-suggestions strong {
            color: var(--gvp-border);
            font-size: 11px;
        }

        .preview-warnings ul, .preview-suggestions ul {
            margin: 4px 0;
            padding-left: 16px;
        }

        .preview-warnings li, .preview-suggestions li {
            color: var(--gvp-text-primary);
            font-size: 10px;
            margin: 2px 0;
        }

        /* Saved Prompts Section - New Card Layout */
        .saved-prompts-container {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-top: 4px;
        }

        .saved-prompts-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .saved-prompts-controls {
            display: flex;
            justify-content: flex-end;
            margin-top: 6px;
        }

        /* Wrapper: [Number] [Card] */
        .saved-prompt-wrapper {
            display: flex;
            align-items: stretch;
            gap: 8px;
        }

        /* Slot number OUTSIDE the card */
        .saved-prompt-number {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            font-size: 12px;
            font-weight: 600;
            color: var(--gvp-text-secondary);
            flex-shrink: 0;
        }

        /* The card itself */
        .saved-prompt-card {
            flex: 1;
            display: flex;
            gap: 8px;
            padding: 10px 12px;
            background: #1a1a1a;
            border: 1px solid var(--gvp-border);
            border-radius: 6px;
            transition: all 0.2s ease;
            min-height: 60px;
        }

        .saved-prompt-card:hover {
            border-color: #5E5E5E;
            background: var(--gvp-bg-secondary, #212121);
        }

        /* Legacy class support */
        .saved-prompt-slot {
            display: flex;
            gap: 8px;
            align-items: stretch;
        }

        /* Large clickable preview area */
        .saved-prompt-preview {
            flex: 1;
            min-width: 0;
            font-size: 11px;
            line-height: 1.4;
            color: #e5e7eb;
            cursor: pointer;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
            word-break: break-word;
            padding: 2px 0;
        }

        .saved-prompt-preview:hover {
            color: var(--gvp-text-primary);
        }

        .saved-prompt-preview.empty {
            color: #6b7280;
            font-style: italic;
            display: flex;
            align-items: center;
        }

        /* 2x2 Button grid */
        .saved-prompt-buttons {
            display: grid;
            grid-template-columns: repeat(2, 28px);
            grid-template-rows: repeat(2, 28px);
            gap: 4px;
            flex-shrink: 0;
        }

        .saved-prompt-view,
        .saved-prompt-save,
        .saved-prompt-clear,
        .saved-prompt-copy {
            width: 28px;
            height: 28px;
            padding: 0;
            font-size: 13px;
            background: var(--gvp-bg-tertiary, #2a2a2a);
            border: 1px solid var(--gvp-border);
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .saved-prompt-save:hover {
            background: #2d4a2d;
            border-color: #4ade80;
        }

        .saved-prompt-clear:hover {
            background: #4a2d2d;
            border-color: var(--gvp-accent);
        }

        .saved-prompt-copy:hover {
            background: #2d3a4a;
            border-color: #60a5fa;
        }

        .saved-prompt-view:hover {
            background: #3a3a3a;
            border-color: var(--gvp-text-secondary);
        }

        .saved-prompt-add {
            padding: 8px 14px;
            font-size: 11px;
            background: #1a1a1a;
            border: 1px solid var(--gvp-border);
            color: var(--gvp-text-primary);
            border-radius: 6px;
        }

        .saved-prompt-add:hover {
            background: var(--gvp-bg-tertiary, #2a2a2a);
            border-color: #5E5E5E;
        }

        .saved-prompt-add:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        #gvp-saved-prompt-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            z-index: 10003;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 24px;
        }

        #gvp-saved-prompt-modal.visible {
            display: flex;
        }

        #gvp-saved-prompt-content {
            background: var(--gvp-bg-primary, #141414);
            border-radius: 8px;
            padding: 20px;
            max-width: 640px;
            width: 100%;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.85);
            border: 1px solid var(--gvp-border);
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        #gvp-saved-prompt-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        #gvp-saved-prompt-title {
            font-size: 16px;
            font-weight: 600;
            color: var(--gvp-border);
        }

        #gvp-saved-prompt-close {
            background: transparent;
            border: none;
            color: var(--gvp-text-secondary);
            font-size: 20px;
            cursor: pointer;
        }

        #gvp-saved-prompt-close:hover {
            color: var(--gvp-border);
        }

        #gvp-saved-prompt-meta {
            display: flex;
            gap: 12px;
            font-size: 11px;
            color: var(--gvp-text-secondary);
        }

        #gvp-saved-prompt-body {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        #gvp-saved-prompt-textarea {
            width: 100%;
            min-height: 200px;
            background: var(--gvp-bg-primary, #141414);
            border: 1px solid var(--gvp-border);
            color: var(--gvp-text-primary);
            border-radius: 4px;
            padding: 12px;
            font-size: 12px;
            resize: vertical;
            box-sizing: border-box;
        }

        #gvp-saved-prompt-textarea:focus {
            outline: none;
            border-color: var(--gvp-border);
            box-shadow: 0 0 0 2px rgba(251,191,36,0.15);
        }

        #gvp-saved-prompt-footer {
            display: flex;
            justify-content: space-between;
            gap: 8px;
        }

        #gvp-saved-prompt-footer .gvp-button {
            flex: 1;
        }

        /* Settings Tab Styles - Stage 5 */
        .gvp-settings-section {
            margin-bottom: 24px;
            padding-bottom: 16px;
        }

        .gvp-settings-section h3 {
            margin: 0 0 16px 0;
            font-size: 14px;
            font-weight: 700;
            color: var(--gvp-border);
        }

        .gvp-slider {
            -webkit-appearance: none;
            appearance: none;
            width: 100%;
            height: 6px;
            border-radius: 3px;
            background: var(--gvp-bg-secondary, #212121);
            outline: none;
        }

        .gvp-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: #fbbf24;
            cursor: pointer;
            border: 2px solid var(--gvp-bg-tertiary, #2a2a2a);
            transition: all 0.2s ease;
        }

        .gvp-slider::-webkit-slider-thumb:hover {
            background: #f59e0b;
            transform: scale(1.1);
        }

        .gvp-slider::-moz-range-thumb {
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: #fbbf24;
            cursor: pointer;
            border: 2px solid var(--gvp-bg-tertiary, #2a2a2a);
            transition: all 0.2s ease;
        }

        .gvp-slider::-moz-range-thumb:hover {
            background: #f59e0b;
            transform: scale(1.1);
        }

        .gvp-retry-stats {
            padding: 12px;
            background: var(--gvp-bg-primary, #141414);
            border-radius: 6px;
            border: 1px solid var(--gvp-border);
            margin-top: 16px;
        }

        .gvp-retry-stats h3 {
            margin: 0 0 12px 0;
            font-size: 12px;
            color: var(--gvp-border);
        }

        .gvp-mg-root {
            display: flex;
            flex-direction: column;
            gap: 16px;
            height: 100%;
            min-height: 0;
            padding: 4px 12px 0;
            overflow: hidden;
        }

        .gvp-mg-header {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 12px 4px 8px;
            border-bottom: 1px solid var(--gvp-border);
        }

        .gvp-mg-title-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
        }

        .gvp-mg-heading {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .gvp-mg-title {
            margin: 0;
            font-size: 13px;
            color: var(--gvp-border);
            white-space: nowrap;
            flex-shrink: 0;
        }

        .gvp-mg-summary-account {
            font-size: 10px;
            color: rgba(148, 163, 184, 0.75);
            line-height: 1.3;
        }

        .gvp-mg-summary-stats {
            font-size: 10px;
            color: rgba(148, 163, 184, 0.85);
            line-height: 1.3;
            font-weight: 500;
        }

        .gvp-mg-controls {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: nowrap;
            white-space: nowrap;
            flex-shrink: 1;
            min-width: 0;
        }

        .gvp-mg-control {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            color: rgba(148, 163, 184, 0.85);
            white-space: nowrap;
        }

        .gvp-mg-select {
            background: var(--gvp-bg-primary, #141414);
            color: var(--gvp-text-primary);
            border: 1px solid var(--gvp-border);
            border-radius: 4px;
            padding: 3px 5px;
            font-size: 11px;
        }

        .gvp-mg-cards {
            flex: 1 1 auto;
            min-height: 0;
            overflow: auto;
            display: flex;
            flex-direction: column;
            gap: 16px;
            padding: 8px 4px 20px;
        }

        .gvp-mg-cards::-webkit-scrollbar {
            width: 8px;
        }

        .gvp-mg-cards::-webkit-scrollbar-track {
            background: rgba(15, 23, 42, 0.6);
            border-radius: 999px;
        }

        .gvp-mg-cards::-webkit-scrollbar-thumb {
            background: rgba(72, 73, 75, 0.45);
            border-radius: 999px;
        }

        .gvp-mg-card {
            background: var(--gvp-bg-secondary, #212121);
            border: 1px solid var(--gvp-border);
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 8px;
            transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
        }

        .gvp-mg-card:hover {
            border-color: var(--gvp-border);
            transform: translateY(-1px);
        }

        .gvp-mg-card.has-active {
            border-color: var(--gvp-border);
            box-shadow: 0 10px 24px rgba(8, 15, 35, 0.5);
        }

        .gvp-mg-card.expanded {
            border-color: var(--gvp-border);
            box-shadow: 0 16px 28px rgba(8, 15, 35, 0.55);
        }

        .gvp-mg-card-header {
            display: flex;
            gap: 8px;
            align-items: center;
            width: 100%;
            padding: 0;
            background: none;
            border: none;
            text-align: left;
            cursor: pointer;
            color: var(--gvp-text-secondary);
            font: inherit;
            position: relative;
        }

        .gvp-mg-thumb {
            width: 54px;
            height: 54px;
            border-radius: 6px;
            border: 1px solid rgba(72, 73, 75, 0.15);
            background-size: cover;
            background-position: center;
            background-color: rgb(5, 5, 5);
            cursor: pointer;
            flex-shrink: 0;
        }

        .gvp-mg-thumb.placeholder {
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            color: #64748b;
            cursor: default;
        }

        /* v1.21.45: Lazy loading states */
        .gvp-mg-thumb.gvp-thumb-loading {
            background: linear-gradient(90deg, #1a1a1a 0%, var(--gvp-bg-tertiary, #2a2a2a) 50%, #1a1a1a 100%);
            background-size: 200% 100%;
            animation: gvp-shimmer 1.5s infinite;
        }

        .gvp-mg-thumb.gvp-thumb-loaded {
            animation: gvp-fade-in 0.3s ease-out;
        }

        @keyframes gvp-shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }

        @keyframes gvp-fade-in {
            from { opacity: 0.5; }
            to { opacity: 1; }
        }

        /* Card content - horizontal layout */
        .gvp-mg-card-content {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
            min-width: 0;
            position: relative;
        }

        /* Left: Progress text + inline buttons */
        .gvp-mg-left-actions {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 3px;
        }

        .gvp-mg-progress-text-wrapper {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .gvp-mg-inline-actions {
            display: flex;
            gap: 4px;
        }

        .gvp-mg-micro-btn {
            width: 22px;
            height: 22px;
            border-radius: 4px;
            background: var(--gvp-bg-tertiary, #2a2a2a);
            border: 1px solid var(--gvp-border);
            color: var(--gvp-text-primary);
            font-size: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.15s ease;
            padding: 0;
            flex-shrink: 0;
        }

        .gvp-mg-micro-btn:hover {
            background: #343434;
            border-color: #5a5a5a;
            transform: scale(1.05);
        }

        .gvp-mg-micro-btn.disabled,
        .gvp-mg-micro-btn:disabled {
            background: var(--gvp-bg-primary, #141414);
            border-color: var(--gvp-bg-tertiary, #2a2a2a);
            color: #4b5563;
            opacity: 1;
            cursor: not-allowed;
            pointer-events: none;
        }

        .gvp-mg-progress-text {
            font-size: 11px;
            color: var(--gvp-text-secondary);
            font-weight: 500;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .gvp-mg-inline-progress-bar {
            height: 6px;
            background: rgba(52, 52, 52, 0.7);
            border-radius: 3px;
            overflow: hidden;
        }

        .gvp-mg-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, var(--gvp-bg-tertiary, #2a2a2a), #343434);
            transition: width 0.3s ease;
        }

        /* Right: Status lights (vertically stacked) */
        .gvp-mg-status-lights-stack {
            display: flex;
            flex-direction: column;
            gap: 3px;
            margin-right: 24px;
        }

        .gvp-mg-status-light-small {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: 600;
            border: 1.5px solid transparent;
            transition: all 0.2s ease;
        }

        /* Pending (gray) */
        .gvp-mg-status-light-small.pending {
            background: rgba(72, 73, 75, 0.2);
            color: rgba(163, 163, 163, 0.65);
            border-color: rgba(72, 73, 75, 0.25);
        }

        .gvp-mg-status-light-small.pending.active {
            background: rgba(72, 73, 75, 0.35);
            color: var(--gvp-text-secondary);
            border-color: rgba(72, 73, 75, 0.15);
            box-shadow: 0 0 6px rgba(72, 73, 75, 0.4);
        }

        /* Success (brighter gray) */
        .gvp-mg-status-light-small.success {
            background: rgba(163, 163, 163, 0.26);
            color: var(--gvp-text-primary);
            border-color: rgba(212, 212, 216, 0.7);
        }

        .gvp-mg-status-light-small.success.active {
            background: rgba(212, 212, 216, 0.45);
            color: var(--gvp-text-primary);
            border-color: rgba(244, 244, 245, 0.85);
            box-shadow: 0 0 6px rgba(244, 244, 245, 0.6);
        }

        /* Moderated (unsuccessful) - darker text */
        .gvp-mg-status-light-small.moderated {
            background: rgba(55, 56, 60, 0.2);
            color: #4b5563;
            border-color: rgba(55, 56, 60, 0.25);
        }

        .gvp-mg-status-light-small.moderated.active {
            background: rgba(55, 56, 60, 0.35);
            color: #9ca3af;
            border-color: rgba(55, 56, 60, 0.15);
            box-shadow: 0 0 6px rgba(55, 56, 60, 0.4);
        }

        /* Delete button (top-right) */
        .gvp-mg-delete-btn {
            position: absolute;
            top: -4px;
            right: -4px;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: rgba(20, 20, 20, 0.9);
            border: 1px solid rgba(72, 73, 75, 0.35);
            color: var(--gvp-text-primary);
            font-size: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s ease;
            z-index: 10;
            padding: 0;
        }

        .gvp-mg-delete-btn:hover {
            background: rgba(72, 73, 75, 0.3);
            border-color: rgba(72, 73, 75, 0.5);
            transform: scale(1.1);
        }

        .gvp-mg-card-body {
            display: none;
            margin-top: 12px;
            border-top: 1px solid rgba(72, 73, 75, 0.15);
            padding-top: 12px;
            background: rgba(38, 38, 38, 0.78);
            border-radius: 10px;
        }

        .gvp-mg-card.expanded .gvp-mg-card-body {
            display: block;
        }

        /* Compact attempt cards */
        .gvp-mg-attempt-compact {
            border: 1px solid rgba(72, 73, 75, 0.35);
            border-radius: 8px;
            margin-bottom: 10px;
            padding: 10px;
            background: rgba(38, 38, 38, 0.92);
        }

        .gvp-mg-attempt-compact:last-child {
            margin-bottom: 0;
        }

        /* Header: Status + Timestamp + Delete */
        .gvp-mg-attempt-header-compact {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 5px;
        }

        /* Button row (separate from header) */
        .gvp-mg-attempt-button-row {
            display: flex;
            gap: 4px;
            margin-bottom: 5px;
        }

        .gvp-mg-status-badge {
            padding: 3px 8px;
            border-radius: 999px;
            font-size: 10px;
            font-weight: 600;
            letter-spacing: 0.5px;
        }

        .gvp-mg-status-success {
            background: rgba(82, 82, 91, 0.45);
            color: var(--gvp-text-primary);
        }

        .gvp-mg-status-moderated {
            background: rgba(72, 73, 75, 0.25);
            color: var(--gvp-text-secondary);
        }

        .gvp-mg-status-failed {
            background: rgba(239, 68, 68, 0.25);
            color: #fecaca;
        }

        .gvp-mg-status-pending {
            background: rgba(72, 73, 75, 0.25);
            color: var(--gvp-text-secondary);
        }

        .gvp-mg-timestamp {
            flex: 1;
            text-align: right;
            font-size: 11px;
            color: rgba(148, 163, 184, 0.85);
            margin-right: 4px;
        }

        .gvp-mg-attempt-delete {
            width: 20px;
            height: 20px;
            border-radius: 4px;
            background: rgba(20, 20, 20, 0.9);
            border: 1px solid rgba(72, 73, 75, 0.3);
            color: var(--gvp-text-primary);
            font-size: 11px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.15s ease;
            padding: 0;
        }

        .gvp-mg-attempt-delete:hover {
            background: rgba(72, 73, 75, 0.3);
            border-color: rgba(72, 73, 75, 0.5);
            transform: scale(1.05);
        }

        /* Progress bar - FULL WIDTH */
        .gvp-mg-attempt-progress-bar {
            height: 8px;
            background: rgba(38, 38, 38, 0.85);
            border-radius: 4px;
            overflow: hidden;
        }

        .gvp-mg-attempt-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, var(--gvp-text-primary), #e5e7eb);
            transition: width 0.3s ease;
        }

        /* RED bar for moderated */
        .gvp-mg-attempt-progress-bar.moderated .gvp-mg-attempt-progress-fill {
            background: linear-gradient(90deg, var(--gvp-bg-tertiary, #2a2a2a), #343434);
        }

        /* GREEN bar for success */
        .gvp-mg-attempt-progress-bar.success .gvp-mg-attempt-progress-fill {
            background: linear-gradient(90deg, #e5e7eb, #d4d4d8);
        }


        .gvp-mg-progress {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 14px;
        }

        .gvp-mg-progress-bar {
            display: flex;
            width: 100%;
            height: 6px;
            border-radius: 4px;
            overflow: hidden;
            background: rgba(38, 38, 38, 0.95);
        }

        .gvp-mg-progress-segment {
            background: linear-gradient(90deg, #e5e7eb, #d4d4d8);
        }

        .gvp-mg-progress-segment.moderated {
            background: linear-gradient(90deg, #4b5563, #374151);
        }

        .gvp-mg-progress-placeholder {
            width: 100%;
            background: rgba(72, 73, 75, 0.3);
        }

        .gvp-mg-progress-legend {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            font-size: 10px;
            color: rgba(148, 163, 184, 0.8);
        }

        .gvp-mg-meta {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 6px 16px;
            font-size: 11px;
            color: rgba(148, 163, 184, 0.85);
            margin-bottom: 14px;
            line-height: 1.45;
        }

        .gvp-mg-meta dt {
            font-weight: 600;
        }

        .gvp-mg-meta dd {
            margin: 0;
            word-break: break-all;
        }

        .gvp-mg-final-message {
            font-size: 11px;
            line-height: 1.5;
            color: var(--gvp-text-secondary);
            background: rgba(30, 41, 59, 0.55);
            border-radius: 6px;
            padding: 10px 12px;
            margin-top: 6px;
        }

        .gvp-mg-attempt-empty {
            font-size: 12px;
            color: rgba(148, 163, 184, 0.85);
        }

        .gvp-mg-empty {
            text-align: center;
            padding: 60px 20px;
            color: rgba(148, 163, 184, 0.85);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
        }

        .gvp-mg-empty-icon {
            font-size: 48px;
        }

        .gvp-mg-empty-title {
            margin: 0;
            font-size: 15px;
            color: var(--gvp-border);
        }

        .gvp-mg-empty-subtitle {
            margin: 0;
            font-size: 12px;
            max-width: 360px;
            line-height: 1.6;
        }

        .gvp-mg-modal {
            position: fixed;
            inset: 0;
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 999997;
            font-family: 'Segoe UI', system-ui, sans-serif;
        }

        .gvp-mg-modal.visible {
            display: flex;
        }

        .gvp-mg-modal-backdrop {
            position: absolute;
            inset: 0;
            background: rgba(15, 23, 42, 0.7);
            backdrop-filter: blur(4px);
        }

        .gvp-mg-modal-content {
            position: relative;
            width: 640px;
            max-width: 90vw;
            max-height: 90vh;
            background: rgba(15, 23, 42, 0.97);
            border: 1px solid rgba(72, 73, 75, 0.15);
            border-radius: 12px;
            box-shadow: 0 24px 48px rgba(8, 15, 35, 0.55);
            padding: 18px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .gvp-mg-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .gvp-mg-modal-title {
            font-size: 15px;
            font-weight: 600;
            color: var(--gvp-border);
        }

        .gvp-mg-modal-close {
            background: none;
            border: none;
            color: var(--gvp-text-secondary);
            font-size: 22px;
            cursor: pointer;
        }

        .gvp-mg-modal-info {
            font-size: 12px;
            color: rgba(148, 163, 184, 0.85);
        }

        .gvp-mg-modal-textarea {
            flex: 1;
            min-height: 240px;
            resize: none;
            border: 1px solid rgba(72, 73, 75, 0.15);
            border-radius: 8px;
            background: rgba(15, 23, 42, 0.9);
            color: var(--gvp-text-secondary);
            padding: 12px;
            font-family: 'Consolas', 'Menlo', monospace;
            font-size: 12px;
            line-height: 1.6;
        }

        .gvp-mg-modal-footer {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
        }

        .gvp-mg-image-content {
            position: relative;
            max-width: 90vw;
            max-height: 90vh;
            border-radius: 12px;
            overflow: hidden;
            background: rgba(15, 23, 42, 0.96);
            border: 1px solid rgba(72, 73, 75, 0.15);
            box-shadow: 0 24px 48px rgba(8, 15, 35, 0.55);
            display: flex;
            flex-direction: column;
        }

        .gvp-mg-image-content img {
            display: block;
            max-width: 90vw;
            max-height: 80vh;
            object-fit: contain;
            background: var(--gvp-bg-primary, #141414);
        }

        .gvp-mg-image-caption {
            padding: 8px 12px;
            font-size: 12px;
            color: rgba(148, 163, 184, 0.9);
            border-top: 1px solid rgba(72, 73, 75, 0.15);
            background: rgba(15, 23, 42, 0.95);
        }

        .gvp-mg-image-content .gvp-mg-modal-close {
            position: absolute;
            top: 8px;
            right: 8px;
            width: 32px;
            height: 32px;
            border-radius: 999px;
            background: rgba(15, 23, 42, 0.75);
            border: 1px solid rgba(72, 73, 75, 0.15);
            line-height: 28px;
        }

        /* Toast Notification System */
        .gvp-toast-container {
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10003;
            display: flex;
            flex-direction: column-reverse;
            gap: 8px;
            pointer-events: none;
        }

        .gvp-toast {
            background: rgba(15, 23, 42, 0.95);
            border: 1px solid rgba(72, 73, 75, 0.15);
            border-radius: 8px;
            padding: 12px 16px;
            min-width: 280px;
            max-width: 400px;
            font-size: 13px;
            color: var(--gvp-text-secondary);
            box-shadow: 0 8px 24px rgba(8, 15, 35, 0.5);
            backdrop-filter: blur(8px);
            opacity: 0;
            transform: translateY(-20px);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            pointer-events: all;
        }

        .gvp-toast.show {
            opacity: 1;
            transform: translateY(0);
        }

        .gvp-toast-message {
            display: block;
            margin-bottom: 8px;
        }

        /* Toast types */
        .gvp-toast-success {
            border-color: rgba(244, 244, 245, 0.25);
            background: linear-gradient(135deg, rgba(52, 52, 52, 0.85), rgba(82, 82, 91, 0.65));
        }

        .gvp-toast-error {
            border-color: rgba(239, 68, 68, 0.4);
            background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(220, 38, 38, 0.15));
        }

        .gvp-toast-warning {
            border-color: rgba(245, 158, 11, 0.4);
            background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(217, 119, 6, 0.15));
        }

        .gvp-toast-info {
            border-color: rgba(72, 73, 75, 0.4);
            background: linear-gradient(135deg, rgba(72, 73, 75, 0.15), rgba(55, 65, 81, 0.15));
        }

        /* Confirm and undo toasts */
        .gvp-toast-confirm,
        .gvp-toast-undo {
            border-color: rgba(245, 158, 11, 0.4);
            background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(217, 119, 6, 0.15));
        }

        .gvp-toast-confirm .gvp-toast-message,
        .gvp-toast-undo .gvp-toast-message {
            margin-bottom: 10px;
        }

        .gvp-toast-actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
        }

        .gvp-toast-btn {
            padding: 6px 14px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            border: 1px solid transparent;
        }

        .gvp-toast-btn-confirm {
            background: var(--gvp-bg-tertiary, #2a2a2a);
            color: var(--gvp-text-primary);
            border-color: var(--gvp-border);
        }

        .gvp-toast-btn-confirm:hover {
            background: #343434;
            border-color: #5a5a5a;
        }

        .gvp-toast-btn-cancel {
            background: rgba(148, 163, 184, 0.15);
            color: #cbd5e1;
            border-color: rgba(148, 163, 184, 0.25);
        }

        .gvp-toast-btn-cancel:hover {
            background: rgba(148, 163, 184, 0.25);
            border-color: rgba(148, 163, 184, 0.35);
        }

        .gvp-toast-btn-undo {
            background: rgba(38, 38, 38, 0.25);
            color: var(--gvp-text-secondary);
            border-color: rgba(38, 38, 38, 0.3);
            margin-left: auto;
        }

        .gvp-toast-btn-undo:hover {
            background: rgba(38, 38, 38, 0.35);
            border-color: rgba(38, 38, 38, 0.45);
        }

        /* ===== Playlist Player ===== */
        .gvp-playlist-player { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); z-index: 10005; display: none; align-items: center; justify-content: center; }
        .gvp-playlist-player.visible { display: flex; }
        .gvp-playlist-content { position: relative; width: 95%; max-width: 1600px; height: 95vh; display: grid; grid-template-columns: 1fr 240px; grid-template-rows: auto auto auto auto; gap: 12px; padding: 20px; background: var(--gvp-bg-primary, #141414); border-radius: 16px; border: 2px solid var(--gvp-bg-tertiary, #2a2a2a); box-shadow: 0 30px 80px rgba(0,0,0,0.9); }
        .gvp-playlist-close { position: absolute; top: 16px; right: 16px; background: transparent; border: none; color: var(--gvp-text-secondary); font-size: 36px; font-weight: 300; width: 48px; height: 48px; border-radius: 50%; cursor: pointer; transition: all 0.2s ease; z-index: 10; display: flex; align-items: center; justify-content: center; line-height: 1; }
        .gvp-playlist-close:hover { background: #b91c1c; color: white; transform: rotate(90deg); }
        
        /* Video Container */
        .gvp-playlist-video-container { grid-column: 1; grid-row: 1; position: relative; background: #000; border-radius: 12px; overflow: hidden; display: flex; align-items: center; justify-content: center; min-height: 400px; }
        .gvp-playlist-video { width: 100%; height: 100%; object-fit: contain; }
        .gvp-playlist-loading { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: var(--gvp-border); font-size: 18px; font-weight: 600; text-shadow: 0 2px 8px rgba(0,0,0,0.8); }
        
        /* Video Metadata Below Player */
        .gvp-video-metadata { grid-column: 1; grid-row: 2; background: var(--gvp-bg-secondary, #212121); border-radius: 8px; padding: 16px; border: 1px solid var(--gvp-border); }
        .gvp-metadata-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #374151; }
        .gvp-playlist-counter { color: var(--gvp-border); font-size: 16px; font-weight: 600; }
        .gvp-metadata-actions { display: flex; gap: 8px; align-items: center; }
        .gvp-copy-current-prompt { background: var(--gvp-bg-tertiary, #2a2a2a); border: 1px solid var(--gvp-border); color: var(--gvp-text-primary); padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; transition: all 0.15s ease; }
        .gvp-copy-current-prompt:hover { background: #343434; border-color: var(--gvp-border); }
        .gvp-copy-current-prompt:active { background: #111827; border-color: var(--gvp-border); transform: translateY(1px); }
        .gvp-current-video-link { color: var(--gvp-border); font-size: 18px; text-decoration: none; padding: 4px; transition: transform 0.2s; }
        .gvp-current-video-link:hover { transform: scale(1.2); }
        
        .gvp-metadata-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 12px; }
        .gvp-metadata-row { display: flex; gap: 8px; }
        .gvp-metadata-label { color: var(--gvp-text-secondary); font-size: 12px; font-weight: 600; }
        .gvp-metadata-value { color: var(--gvp-text-primary); font-size: 12px; }
        
        .gvp-prompt-display { background: #111827; padding: 12px; border-radius: 6px; margin-top: 8px; border-left: 3px solid var(--gvp-bg-tertiary, #2a2a2a); }
        .gvp-prompt-display-label { color: var(--gvp-border); font-size: 11px; font-weight: 600; text-transform: uppercase; margin-bottom: 6px; }
        .gvp-prompt-display-text { color: var(--gvp-text-primary); font-size: 13px; line-height: 1.5; }
        
        /* Controls Below Metadata */
        .gvp-playlist-controls { grid-column: 1; grid-row: 3; display: flex; gap: 12px; justify-content: center; align-items: center; padding: 12px 0; }
        .gvp-playlist-btn { background: var(--gvp-bg-secondary, #212121); border: 2px solid var(--gvp-border); color: var(--gvp-text-primary); font-size: 20px; width: 56px; height: 56px; border-radius: 50%; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; }
        .gvp-playlist-btn:hover { background: var(--gvp-bg-secondary, #212121); border-color: var(--gvp-border); transform: scale(1.1); }
        .gvp-playlist-btn-play { width: 72px; height: 72px; font-size: 28px; background: var(--gvp-bg-tertiary, #2a2a2a); color: var(--gvp-text-primary); border-color: #343434; }
        .gvp-playlist-btn-play:hover { background: #343434; transform: scale(1.15); }
        
        /* Sidebar with Thumbnails */
        .gvp-playlist-sidebar { grid-column: 2; grid-row: 1 / 4; display: flex; flex-direction: column; background: var(--gvp-bg-secondary, #212121); border-radius: 12px; overflow: hidden; border: 1px solid var(--gvp-border); }
        .gvp-playlist-sidebar-header { padding: 12px; background: #111827; border-bottom: 2px solid var(--gvp-bg-tertiary, #2a2a2a); }
        .gvp-playlist-header-title { color: #fcfcfc; font-size: 14px; font-weight: 600; margin-bottom: 10px; }
        
        /* Sorting Controls */
        .gvp-playlist-sort-controls { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
        .gvp-playlist-select { background: var(--gvp-bg-secondary, #212121); border: 1px solid var(--gvp-border); color: var(--gvp-text-primary); padding: 6px 8px; border-radius: 6px; font-size: 11px; cursor: pointer; width: 100%; }
        .gvp-playlist-select:hover { border-color: var(--gvp-border); }
        .gvp-playlist-select:focus { outline: none; border-color: var(--gvp-border); }
        
        /* Action Buttons */
        .gvp-playlist-actions { display: flex; gap: 6px; }
        .gvp-playlist-gen-btn { flex: 1; background: var(--gvp-bg-tertiary, #2a2a2a); border: 1px solid var(--gvp-border); color: var(--gvp-text-primary); padding: 6px; border-radius: 6px; font-size: 11px; cursor: pointer; transition: all 0.15s ease; }
        .gvp-playlist-gen-btn:hover { background: #343434; border-color: var(--gvp-border); }
        .gvp-playlist-gen-btn:active { background: #111827; border-color: var(--gvp-border); transform: translateY(1px); }
        
        /* Thumbnail Buttons */
        .gvp-playlist-items { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
        .gvp-playlist-thumb-btn { width: 100%; height: 120px; min-height: 120px; position: relative; border-radius: 8px; overflow: hidden; border: 3px solid transparent; background: #111827; cursor: pointer; transition: all 0.2s; padding: 0; display: block; }
        .gvp-playlist-thumb-btn:hover { border-color: var(--gvp-border); transform: scale(1.02); }
        .gvp-playlist-thumb-btn.active { border-color: var(--gvp-border); box-shadow: 0 0 16px rgba(38,38,38,0.5); }
        .gvp-thumb-image { width: 100%; height: 100%; object-fit: cover; display: block; }
        .gvp-thumb-number { position: absolute; bottom: 4px; right: 4px; background: rgba(0,0,0,0.8); color: var(--gvp-border); font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 4px; }
        
        /* Scrollbar Styling */
        .gvp-playlist-items::-webkit-scrollbar { width: 8px; }
        .gvp-playlist-items::-webkit-scrollbar-track { background: #111827; }
        .gvp-playlist-items::-webkit-scrollbar-thumb { background: var(--gvp-bg-secondary, #212121); border-radius: 4px; }
        .gvp-playlist-items::-webkit-scrollbar-thumb:hover { background: #4b5563; }
        
        /* Keyframes for pulse animations */
        @keyframes pulse-gray {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }
        
        @keyframes pulse-warning {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.8; }
        }

        /* Multi-Gen History Title */
        .gvp-mg-title {
            color: var(--gvp-text-primary);
            font-weight: 600;
            font-size: 14px;
        }
        
        /* Playlist virtualization indicator buttons */
        .gvp-playlist-more-indicator {
            width: 100%;
            padding: 8px 12px;
            background: linear-gradient(135deg, #1f2937, #111827);
            border: 1px dashed var(--gvp-border);
            border-radius: 8px;
            color: #9ca3af;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.2s ease;
            text-align: center;
        }
        .gvp-playlist-more-indicator:hover {
            background: #262626;
            border-color: var(--gvp-border);
            color: #f4f4f5;
        }
    `;
