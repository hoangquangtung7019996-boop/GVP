# 🟢 HANDOVER PROTOCOL
> **Date:** 2026-03-08
> **Version:** v1.46.14
> **Status:** 🟢 STABLE

---

## ✅ SESSION COMPLETED: v1.37.0 → v1.46.8

### Key Fixes & Migrations in v1.46.8

#### 1. Quick Action Gallery Card Recognition
- **Problem**: Quick Actions (Z/X/C/V) failed to detect media on the masonry gallery cards because overlays blocked direct pointer events, and Shadow DOM boundaries prevented simple `.parentElement` traversal.
- **Resolution**: Refactored `content.js:_resolveFavoriteTarget` to use `event.composedPath()`. Implemented a `closest()` crawler for `.group/media-post-masonry-card` and a recursive `getMediaPathFromNode` scanner to extract `img`/`video` source URLs from within the card container.
- **Files**: `content.js`, `selectors.js`

#### 2. "Sticky Focus" & Hover-Priority
- **Problem**: The 'Z' (Make Video) shortcut failed when the Grok prompt input had focus, requiring users to manually click away.
- **Resolution**: Refactored `UIGalleryManager.js:_isTypingContext` to prioritize user hover intent. If a gallery card is hovered (`hoveredImageId` exists), the shortcut fires regardless of input focus. Added `e.preventDefault()` and `e.stopImmediatePropagation()` to ensure the 'z' character isn't typed into the prompt box.
- **Files**: `UIGalleryManager.js`

#### 3. Favorites URL Migration (/imagine/saved)
- **Problem**: Grok changed the path for favorited images from `/imagine/favorites` to `/imagine/saved`, breaking navigation and state detection.
- **Resolution**: Updated all path constants and detection logic across the extension.
- **Files**: `selectors.js`, `content.js`, `UIManager.js`, `UploadAutomationManager.js`, `UIPlaylistManager.js`, `ReactAutomation.js`.

---

## ✅ SESSION COMPLETED: v1.45.6 → v1.45.7

### Bug Fix: Upload Mode & Make Video Button

## Make Video Button Missing
- **Fix:** ReactAutomation.js `forceVideoModeTransition` was using the SVG path for the "Brush" (Edit) icon instead of the generic "Settings" (Gear) button to open the video creation menu. 
- **Change:** Changed selector to `button[aria-label="Settings"]:has(svg)` for the trigger method.

## Upload Mode Automation Bug
- **Fix:** `UploadAutomationManager.js` missing event handlers (`_handleModeChange`, `_handlePathChange`, `_handleNewRequest`) were injected to properly synchronize the upload mode toggle state.
- **Fix:** `StateManager.isUploadAutomationEnabled()` method was properly checked in `enqueueFiles`.
- **Fix:** Modified `UIUploadManager.js` `onTabActivated` and `UploadAutomationManager.js` `enqueueFiles` to automatically force `StateManager` to `setUploadAutomationEnabled(true)` when interacting with the Multi-Upload tab to ensure the state isn't permanently disabled by default.

### Bug Fix: Prompt Library Folder System

**Problem:** Folders did not appear after JSON import; `StateManager` had no prompt library proxy methods, causing all `UIPromptLibraryManager` calls to throw at runtime.

**Files changed:**
| File | Change |
|------|--------|
| `manifest.json` | Bumped to v1.45.7 |
| `StateManager.js` | Added 7 proxy methods: `getPrompts`, `getFolders`, `getPromptTags`, `savePrompt`, `saveFolder`, `savePromptVersion`, `getPromptUsageStats` |
| `UIPromptLibraryManager.js` | Fixed wrong IDB store `'prompt_folders'` → `'folders'` in `_importData` and `_exportData`; removed erroneous `JSON.parse` wrapper in `loadData` |

**Behaviour:** Prompt Library folders now persist correctly on import. Saving/loading prompts works end-to-end. GalleryMiniUIManager was already log-clean (no stale console.logs found). Upload Mode queues correctly and the "Make Video" transition is stable.

---

## ✅ SESSION COMPLETED: v1.45.5 → v1.45.6

### Feature: Word Swap Auto-Cycle Toggle

**Files changed:**
| File | Change |
|------|--------|
| `manifest.json` | Bumped to v1.45.6 |
| `StateManager.js` | Added `wordSwapAutoEnabled: true` to `state.settings` defaults |
| `ReactAutomation.js` | Gated `applyGlobalCycleRules` call behind `settings?.wordSwapAutoEnabled !== false` |
| `UIWordSwapperManager.js` | Added 🟢/🔴 toggle pill in modal header; added `📌 PIN` future-expansion stub above `applyGlobalCycleRules` |

**Behaviour:** Defaults to ON — no change for existing users. Toggle persists via `saveSettings()`. When OFF, words are **not** auto-swapped on dispatch.

---

## ✅ SESSION COMPLETED: v1.45.4 → v1.45.5

### Bug A — `Cannot enqueue - mode disabled` (Upload Automation never enabled)

**Root Cause:** v1.21.40 naming migration renamed `_syncEnabledState` → `_handleModeChange` in constructor bindings but omitted the method bodies. `gvp:upload-mode-changed` fired into a void; `_enabled` never synced.

**Fix Location:** `UploadAutomationManager.js`

**Fix:**
- Added `_handleModeChange()` — re-implements old `_syncEnabledState` logic; toggles `_enabled`, wires/unwires listeners, resumes queue
- Added `_handlePathChange()` — resolves `_pathChangeResolve` promise used by queue navigation flow
- Added `_handleNewRequest()` — resolves `_generationStartResolve` promise
- `start()` now wires `gvp:path-changed` + `gvp:new-request` listeners
- `destroy()` now removes all three listeners + resolves pending promises

### Bug B — `InspectionManager` context invalidation crashes

**Root Cause:** Four `chrome.storage.local` call sites in `UIVideoQueueManager` (`_saveSettings`, `_restoreSettings`, `_savePromptPack`, `_restorePromptPack`) had no `chrome.runtime?.id` guard, throwing "Extension context invalidated" when service worker reloads.

**Fix Location:** `UIVideoQueueManager.js` (all four methods)

**Fix:** Added `if (!chrome.runtime?.id) return;` as the first line inside each `try` block.

### Bug C — Moderated video endless cycle / queue stall

**Root Cause:** `VideoQueueManager._handleRailProgress` destructured `status` from `event.detail` and ran `switch(status) { case 'moderated': ... }`. The `gvp:vidgen-beacon` payload does NOT have a `status` field — it has `moderated: boolean` and `progress: number`. Both branches never fired.

**Fix Location:** `VideoQueueManager.js` `_handleRailProgress()`

**Fix:** Replaced switch-on-status with `if (moderated === true) { ... } else if (progress >= 100) { ... }`.

### Files Modified
| File | Change |
|------|--------|
| `manifest.json` | Bumped to v1.45.5 |
| `UploadAutomationManager.js` | Restored 3 missing event handlers, wired path/request listeners |
| `UIVideoQueueManager.js` | Added `chrome.runtime?.id` guard to 4 storage call-sites |
| `VideoQueueManager.js` | Fixed `_handleRailProgress` to use beacon `moderated` boolean |

---

## ✅ SESSION COMPLETED: v1.46.8 → v1.46.12

### Key Fixes & Features in v1.46.12

#### 1. IndexedDB Backup & Restore (Export/Import)
- **Problem**: Users lacked a way to safely export their data (prompts, history, usage) or migrate between accounts/architectures.
- **Resolution**: Implemented `exportFullDatabase` and `importFullDatabase` in `IndexedDBManager.js`. Added "Export Database" and "Import Database" buttons to the Settings UI (`UISettingsManager.js`).
- **Verification**: Audited `GVP_Backup_2026-03-06.json` (60MB) to confirm successful serialization of all IDB stores (`unifiedVideoHistory`, `prompts`, `chunks`, `usageLog`).

#### 2. Account UUID Isolation & Auto-Sync
- **Problem**: Multi-account users had overlapping history; `accountId` was not consistently stamped or utilized for separation.
- **Resolution**: Enforced the "UUID Law" across all IDB stores. `NetworkInterceptor.js` now monitors `/list` for account changes and triggers `triggerBulkGallerySync` automatically on account switch. Verified that the export dump contains multiple distinct `accountId` strings.

#### 3. Singleton Re-Architecture (IndexedDBManager)
- **Problem**: `UISettingsManager.js` threw `IndexedDBManager not found` errors due to inconsistent global reference naming.
- **Resolution**: Implemented a robust singleton pattern in `IndexedDBManager.js` (`static instance`). Standardized `window.idbManager` as the global access point.

---

## ✅ SESSION COMPLETED: v1.46.12 → v1.46.14

### Features/Fixes
| Item | Files | Details |
|------|-------|---------|
| **Account Identity Shield** | `NetworkInterceptor.js`, `content.js` | Implemented multi-stage startup identity verification using `x-userid` cookies and a 10-item API pulse sync to prevent data bleed between accounts. |
| **8s Persistent Toast** | `UIManager.js` | Added a long-lived toast notification that appears on account switches to provide visual confirmation of the sync event. |
| **IDB Merge Import** | `IndexedDBManager.js`, `UISettingsManager.js` | Added a "Merge vs Replace" toggle to the database import utility, allowing upsert (`store.put`) behavior to preserve local data. |
| **GitHub Migration** | `GH CLI` | Successfully migrated the IDE environment and global Git identity to the new GitHub account `hoangquangtung7019996-boop`. |

### Bug Details
- **Root Cause:** Transitioning accounts on the same page load previously relied on stale IDB state or late API detection.
- **Fix:** Introduced the mandatory startup identity chain in `NetworkInterceptor.performStartupAccountCheck`.
- **Files:** `NetworkInterceptor.js`, `StateManager.js`

### Files Modified
| File | Change |
|------|--------|
| `NetworkInterceptor.js` | Added identity chain and toast triggers. |
| `StateManager.js` | Unified storage keys to `gvp-active-account`. |
| `UIManager.js` | Added `showAccountSwitchToast`. |
| `IndexedDBManager.js` | Added optional merge support to `importFullDatabase`. |
| `UISettingsManager.js` | Added Merge toggle UI. |

---

---

## ✅ SESSION COMPLETED: v1.46.14 → v1.46.16

### Key Fixes & Optimizations in v1.46.16

#### 1. IndexedDB Search Optimization (v19 Migration)
- **Problem**: Omnibox and history searches relied on full-store scans, causing lag and high CPU usage during rapid typing.
- **Resolution**: Implemented a v19 migration adding lowercase indexes (`prompt_lc`, `customName_lc`, `imageId_lc`). Refactored `searchUnifiedHistory` to use `IDBKeyRange.bound` with prefix matching and a 10-item result cap.
- **Files**: `IndexedDBManager.js`

#### 2. Targeted Gallery Sync (O(1) Check)
- **Problem**: Background tab generations caused all open gallery rails to refresh, leading to UI jitter and unnecessary API/IDB traffic.
- **Resolution**: Updated `GalleryMiniUIManager.js` to cache `_currentAbsoluteRootId`. Cross-tab sync messages (`gvp:idb-sync`) are now filtered by comparing the `affectedId`'s root against the cached lineage token.
- **Files**: `GalleryMiniUIManager.js`, `IndexedDBManager.js`

#### 3. Omnibox Deep-Link Correctness
- **Problem**: Suggestions pointed to `/chat/` routes instead of the extension's canonical `/imagine/post/{id}` surface.
- **Resolution**: Updated `background.js` suggestion URL construction to use the `/imagine/post/` route with proper ID mapping.
- **Files**: `background.js`

#### 4. IDB Diagnostic Engine
- **Problem**: Debugging state/account isolation issues in the field was difficult.
- **Resolution**: Added a health-check utility that generates a comprehensive JSON report of store counts, account distribution, and storage estimates.
- **Files**: `IndexedDBManager.js`, `UISettingsManager.js`

#### 5. Lean Repository & Code Cleaning
- **Problem**: Repository contained unnecessary IDE files and legacy bloat.
- **Resolution**: Established the `hoangquangtung7019996-boop/GVP` repository with a strict lean-hosting strategy. Corrected the IDB upper-bound suffix (`\uffff`) and synchronized `UIGalleryManager` log-stripping.
- **Files**: `.gitignore`, `UIGalleryManager.js`

---

## ✅ SESSION COMPLETED: v1.46.16 → v1.47.0

### Features/Fixes
| Item | Files | Details |
|------|-------|---------|
| **VidGen Beacon System** | `NetworkInterceptor.js`, `GalleryMiniUIManager.js` | Restored the `gvp:vidgen-beacon` event bus as the single source of truth for video generation progress. |
| **Gallery Auto-Update** | `GalleryMiniUIManager.js` | Implemented real-time UI refresh in the mini-gallery rail when a generation completes. |
| **IDB Enhancements Merge**| `IndexedDBManager.js`, `main` | Merged and pushed the v19 migration (O(1) search) and account isolation logic to `main`. |

### Bug Details
- **Root Cause:** Documentation referenced a beacon system that was inconsistent or missing in the v1.46 line.
- **Fix:** Implemented a new internal dispatch mechanism in `NetworkInterceptor` and wired it to `GalleryMiniUIManager`.
- **Files:** `NetworkInterceptor.js` (L3589+), `GalleryMiniUIManager.js` (L102+)

### Files Modified
| File | Change |
|------|--------|
| `manifest.json` | Bumped to v1.47.0 |
| `NetworkInterceptor.js` | Added `_dispatchVidGenBeacon` and integrated streaming/payload triggers. |
| `GalleryMiniUIManager.js` | Added beacon listener and `_handleVidGenBeacon` for auto-refresh. |
| `IndexedDBManager.js` | Merged v19 migration and O(1) search optimizations. |

---

## 🛠️ NEXT SESSION
- Priority 1: Verify CodeRabbit output on the new GitHub push.
- Priority 2: Standardize Mermaid diagrams across all Knowledge Items.
- Priority 3: Fix Item 6g (Prompt Library Folder System expansion).

---

## 📦 BACKUP & SESSION INFO
- **Release**: v1.47.0
- **KB Version**: 1.47.0
- **Brain IDs Referenced**: `f9f75c0c-3977-44f0-8aa2-a68e17263859`
