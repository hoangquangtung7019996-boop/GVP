# GVP Technical Implementation Manual (Master)

This manual serves as the definitive technical reference for the Grok Video Prompter (GVP) extension. It consolidates architectural specifications, implementation patterns, and UI orchestration for all 15+ functional systems.

---

## 🏗️ Functional Systems Registry

### System 1: Prompt Library
- **Orchestrator**: `UIPromptLibraryManager.js`
- **Storage**: IndexedDB (`prompts`, `folders`).
- **Mechanism**: A 3-column UI (Folders -> Prompts -> Editor) with persistent folder expansion state. 
- **Folder Implementation (MVP)**:
  - Renders a **flat tree** in System 1 (flat list iteration in `_renderFolderTree`).
  - Supports batch move operations via `selectedPromptIds`.
  - Folders are UUID-prefixed (`folder_`).
- **Repair Goal (v1.46.12+)**: Ensure 100% isolation in the `folders` store between different account partitions.

### System 2: Prompt Toolkit & UI Automation
- **Orchestrators**: `UIRawInputManager.js` | `ReactAutomation.js`
- **The Nuclear Option**: Bypasses Grok's TipTap/React editor using `NativeEvent` property descriptors.
- **Protocol**: 
    1. Steal native `value` setter via `Object.getOwnPropertyDescriptor`.
    2. Apply value directly to `HTMLTextAreaElement` or `div[contenteditable]`.
    3. Dispatch a bubbling `input` event to trigger React state reconciliation.
- **QuickLaunch Resumption**: `QuickLaunchManager` polls for the generator area to mount before injecting the payload from `sessionStorage`.

### System 3: JSON Architect
- **Orchestrator**: `UIFormManager.js`
- **Mechanism**: Schema-first rendering. Uses the `UIChunkBuilderManager` to transform complex JSON schemas into dynamic forms with real-time validation. 
- **Payload**: Compiles selected chunks into a single JSON prompt string for injection into System 2.

### System 4: Lineage & UUID Resolution (The Heritage Policy)
- **Orchestrators**: `NetworkInterceptor.js` | `IndexedDBManager.js` | `QuickLaunchManager` (in `content.js`)
- **Policy**: Every child artifact carries a `rootImageId` and a `parentId`.
- **Resolution Multi-Tier Strategy (The Stack)**:
    1. **Stage 1: Direct Target Attributes**: Scans `data-id`, `data-media-id`, etc., and the `id` attribute.
    2. **Stage 2: Recursive Child Scan**: Drill-down via `querySelectorAll('img, video')` if a masonry card is hit.
    3. **Stage 3: Data:Image Bypass**: Performance optimization for local/base64 assets.
    4. **Stage 4: Upward Crawl**: 6-level climb checking Stage 1 & 2.
    5. **Stage 5: Blind Execution**: Heuristic scrapers (textarea proximity).
    6. **Stage 6: Composed Path (Shadow DOM)**: Uses `event.composedPath()` to trace through shadow boundaries.
- **Strategy**: **"IDB for Routing, API for Content"**. Local storage tracks lineage, then GVP fetches the definitive sibling set from `/post/get` to guarantee visibility.
- **Reverse-Scan Path Strategy**: Extracts the deepest valid 36-char UUID from a path (Right-to-Left) to distinguish Asset IDs from Account IDs.

### System 5: Automation Modes
- **Orchestrator**: `VideoQueueManager.js`
- **Modes**:
    - **`moderated`**: Resets flagged items (Status: `moderated`) to `pending` for retry. Limited to **3 retries per item** (v1.46.1) to prevent infinite loops. Includes **auto-clearing of successful items** via `_clearByStatus('success')` to prevent clutter.
    - **`full`**: Continuous cycle of all queue items.
    - **Moderation Streak Guard**: Automatically pauses the queue if the `moderationStreak` hits 3 consecutive failures.

### System 6: Navigation & SPA Inspection
- **Orchestrator**: `content.js` | `UIManager.js`
- **_navigateSPA**: Uses `history.pushState` + `PopStateEvent` for routing without hard-refreshes.
- **_simulateEscape**: Dispatches a native `Escape` key event to close Grok overlays after a Quick Action, preserving scroll state.

### System 7: Job Queue (Multi-Generation Orchestrator)
- **Orchestration**: `VideoQueueManager.js` | `UIVideoQueueManager.js` | `MultiVideoManager.js`
- **Logic**: A **Fire-and-Forget** trigger sequence. Schedules the next item immediately after the current trigger pulse, using `gvp:vidgen-beacon` (SSE/NDJSON) for background status tracking.
- **Concurrency (MultiVideoManager)**: Manages concurrent generation slots and monitors for stuck/timeout processes.
- **Smart Edit Scheduling (v1.23.19)**: Restricts image edit processing to one active generation per parent image to prevent backend state conflicts.
- **SPA Navigation Safety**: Uses `history.pushState` + `PopStateEvent` for background routing. Dispatches `gvp:queue-navigation` to signal transitions.
- **Render Optimization (v1.47.2)**: `UIVideoQueueManager.addItemToQueue` now conditionally skips redundant rendering if `_addEditedVersions` has already triggered a grid update, preventing flickering and improving UI performance during bulk additions.

### System 8: Image Upload Automation (Bulk Upload)
- **Orchestrator**: `UploadAutomationManager.js`
- **Iframe Guillotine Sequence**:
    1. **API Pass**: Uses a hidden `<iframe>` to fetch/post to `/rest/app-chat/upload-file`. The iframe is destroyed (Guillotine) after ~245ms.
    2. **Ghost Anchoring**: Performs a background fetch to the post URL (`/imagine/post/{fileId}`) to force SSR indexing, followed by a `/rest/media/post/like` pulse with `credentials: 'include'`.
    3. **Handoff**: Injects the canonical URL into the Video Queue and refreshes the gallery.

### System 9: Gallery & Playback
- **Orchestration**: `UIGalleryManager.js` | `GalleryMiniUIManager.js`
- **Mini-UI**: Provides a dual-rail exploration of generation lineages via 'Z' + Hover.
- **Hover-Priority (v1.46.8)**: Prioritizes the 'Z' shortcut over the active input field if the user is hovering a masonry card, resolving "Sticky Focus".
- **Shadow DOM Isolation**: The Gallery Rail buttons are absolutely positioned; resolution requires `event.composedPath()` (Stage 6 Resolution) to bridge the Shadow boundary.
- **Image Root Stability (v1.47.10 Batch 2)**: To prevent lineage drift and ensure visual consistency, `UIGalleryManager` tracks the `rootId` via `dataset.gvpRootId`. It stores the original image source in `dataset.gvpOriginalSrc` before any variant selection is applied, allowing perfect restoration of the original media when a selection is cleared.

### System 10: State, Telemetry & Account Isolation
- **Orchestrator**: `StateManager.js` | `NetworkInterceptor.js`
- **Account Isolation Strategy**: Scopes all IDB and memory state to `activeAccountId`. (See [IndexedDB Subsystem Manual](indexeddb_subsystem_manual.md#👤-2-account-uuid-isolation-architecture))
- **The "UUID Law" (v1.46.14+)**: Implements a defensive **Defensive Identity Chain** (Startup Check Sequence):
    1. **Immediate Identification**: Extract `x-userid` from `document.cookie` / headers.
    2. **Verification Pulse**: Confirm identity via a `/rest/media/post/list` call (**limit: 10**) if a mismatch is detected.
- **Automated Sync Trigger**: Upon confirmation of an account switch, GVP initiates a mandatory `triggerBulkGallerySync` pulse with a **2500-item** limit to hydrate the new account's IDB partition.
    - **Source Mapping (v1.47.7)**: Correctly maps all gallery sources to `MEDIA_POST_SOURCE_LIKED` (corresponding to the `/imagine/saved` partition).
    - **Event Standard (v1.47.10)**: All custom events used for cross-tab or cross-manager synchronization are standardized to the colon format (e.g., `gvp:unified-history-updated`) for reliable reactivity.
- **Unified Notification**: Displays an **8-second persistent toast** via `UIManager.showAccountSwitchToast(accountId)` to warn the user of metadata context changes.
- **Unified State Management**: Standardized access to the active account ID via the helper `this.stateManager?.getActiveMultiGenAccount?()`. This ensures that even if the `multiGenHistory` object is temporarily uninitialized, components receive a consistent `null` vs. crashing on a deep property access. (v1.47.5 audited)

### System 11: Word Swapper
- **Orchestrator**: `UIWordSwapperManager.js`
- **Mechanism**: Substitutes defined phrases in the prompt string before dispatch.
- **Auto-Cycle Toggle (v1.45.6)**: Allows users to pause automatic phrase replacement on dispatch via a 🟢/🔴 toggle pill.

### System 12: API Schema & Network Interceptor
- **Orchestrator**: `NetworkInterceptor.js` | `gvpFetchInterceptor.js`
- **The Bridge**: Patches `window.fetch` via a page-context injection.
- **Payload Overrides**: "Arms" the interceptor via `GVP_SET_PAYLOAD_OVERRIDE` to ensure prompts persist during asynchronous React mode transitions.
- **Network Guard (Gatekeeper)**: Blocks unwanted Image Edit requests when GVP expects a Video Generation, preventing "Automation Leakage".
- **SSE/NDJSON Decoding**: Decodes fragmented stream chunks into real-time beacons.

### System 13: UI Shell & Entry Points
- **Orchestrator**: `UIManager.js`
- **Shadow DOM**: Encapsulates the entire GVP UI. Orchestrates specialized managers for JSON, RAW, History, Queue, Upload, Settings, and Notifications.
- **Isolation & Mounting (v1.47.10)**: All UI overlays, toasts, and dialogs (e.g., `showConfirm`, `showPrompt`) must be attached specifically to the extension's Shadow Root (`this.shadowRoot`) rather than `document.body`. This ensures they inherit extension styles and remain isolated from Grok's native UI. 
- **Dialog Refinement (v1.47.10 Batch 2)**: Standardized `showConfirm` and `showPrompt` behavior to cancel on backdrop (overlay) click, ensuring user intent is respected during destructive operations.
- **XSS Prevention**: UI components must use `textContent` rather than `innerHTML` when rendering user-supplied or dynamic text (like dialog titles or messages) within the Shadow DOM to prevent injection vulnerabilities.
- **UIModalManager A11y & Promises (v1.47.10 Refresh)**: Modals managed via `UIModalManager` now incorporate ARIA roles (`role="dialog"`, `aria-modal="true"`) and `aria-labelledby` for improved accessibility. Strategic modals (e.g., `showImportJsonModal`) have transitioned to a **Promise-based signature**, allowing for cleaner asynchronous orchestration while maintaining backward compatibility via dual-mode (Promise + Callback) resolution. Resolved promise leaks in `hideImportJsonModal` by ensuring the pending resolve is always called.
- **Resilience (v1.47.1)**: Major UI managers now implement `destroy()` methods to clean up listeners and prevent memory leaks. Managers also handle `gvp:idb-late-init` to hydrate UI state after a delayed database connection.
- **Asynchronous Mutation Handling (v1.47.10 Hardening)**: Callbacks for `MutationObserver` (e.g., in `UIGalleryManager.js`) have been transitioned to `async` functions to correctly handle `await` operations during asset rebinding or variant selection, preventing race conditions during rapid DOM updates.
- **Reactivity & Context (v1.47.2)**: `UIPlaylistManager` now listens for `gvp:vidgen-beacon` events for real-time playlist updates. Its late-init handler (`_boundHandleLateInit`) was also hardened to reset `currentIndex` to 0 when the player modal is closed, or clamp it to the new playlist length if open, preventing context jumps or out-of-bounds errors after a database reconnect.
- **Edit Protection**: `UIPromptLibraryManager` defers automatic UI refreshes if the user is currently editing a prompt, preventing data loss during reactive synchronization.

### System 10: Account Isolation & Identity Flow
- **Orchestrator**: `NetworkInterceptor.js` | `StateManager.js` 
- **Mechanism**: GVP partitions all history and project state by the Grok Account UUID (`active_account_id`).
- **Account Switch Protocol**:
    1.  **Detection**: `NetworkInterceptor` monitors request headers (`x-userid`) and response payloads for identity changes.
    2.  **Activation**: Calls `StateManager.setActiveAccount(newId)`, updating the global state and clearing transient UI caches.
    3.  **Persistence Bridge**: Checks `chrome.storage.local` for the `gvp-bulk-sync-[id]` completion token.
    4.  **Hydration**: Triggers `hydrateMultiGenHistory()` to pull the specific account's dataset from IndexedDB.
    5.  **Opportunistic Sync**: If the account is new or hasn't been synced recently, a background bulk `/list` poll is initiated to populate the local UVH.
- **Isolation Integrity**: Every write to `UNIFIED_VIDEO_HISTORY` or `imageProjects` forces an `accountId` stamp. Retrieval queries always use an index-filtered `IDBKeyRange` bounded to the current account.

### System 14: Core Kernel / StateManager
- **Orchestrator**: `StateManager.js`
- **Role**: The foundational manager controlling memory and cross-component state synchronization via custom dispatchers (`gvp:state-changed`).
- **The "State Sovereignty" Principle**: All persistent extension state MUST be managed via `StateManager.js`. No individual manager should write directly to `chrome.storage` or `IndexedDB` for shared state.
- **Data Life-Cycle (Deletion)**: Implemented `deleteUnifiedEntry(imageId)` to provide a clean, centralized way to remove historical records across both memory and disk.
- **Reactive 403 Scrubbing**: Integrates with the `UIPlaylistManager` to automatically purge "ghost" video records from other accounts that fail CDN authentication checks.
- **Poly-Field Retrieval (v1.47.6)**: Extraction logic (`getAllUnifiedVideos`) and data repair cycles now treat `attempts` (Generative) and `videos` (Gallery Sync) as equally valid sources, ensuring complete hydration of all historical datasets.
- **Concurrency Guard (v1.47.1)**: Utilizes a shared `_settingsLoadPromise` to serialize all `_loadSettings` triggers.
- **Promise Distinction**: `_settingsPromise` represents the cached, ready-to-use settings object, while `_settingsLoadPromise` is exclusively the shared in-flight promise used for deduplication.
- **Delegate Restoration (v1.47.10)**: Fixed "Method Not Found" errors by restoring missing proxy delegations for `getSavedProjects`, `getMultiGenSnapshot`, and `upsertMultiGenEntry`. This ensures the UI layer can reliably communicate with the persistence engine even during phased recovery transitions.
- **Safety Hardening (Wipe-Everything)**: Added a mandatory null-check for `this.indexedDBManager` in the `wipeEverything()` method. This prevents the extension from crashing during a master reset if the database connection has not yet been initialized or is in a failed state.

### System 15: Interaction Recorder & Diagnostics
- **Utility**: Diagnostic tool for mapping Grok UI changes back to the GVP selector registry (`selectors.js`). Facilitates rapid correction of broken selectors (e.g., v1.45.7 Gear vs. Brush SVG path fix).

### System 16: IDB Ecosystem & Native Search
- **Orchestrator**: `IndexedDBManager.js` | `background.js`
- **Mechanism**: Functional extensions providing native browser integration and cross-tab consistency.
- **Omnibox Integration**: Registered `gvp` keyword for address-bar history/prompt querying. Uses message passing between the Service Worker and active tab.
- **Declarative Migrations**: Uses a versioned registry (`MIGRATIONS`) for atomic schema updates (v18+).
- **Deletion Protocol**: Provides `deleteUnifiedEntry(imageId)` for targeted record removal, supporting the automated ghost-scrubbing system.
- **Multi-Tab Sync**: Synchronizes UI state across tabs via `BroadcastChannel`, dispatching `gvp:idb-sync` events on the window.

### System 17: Image Project & Versioning
- **Orchestrator**: `ImageProjectManager.js`
- **Purpose**: Manages image-centric project history with version control.
- **History Sync**: Automatically synchronizes prompt history from gallery meta-data to persistent project storage.
- **Versioning**: Supports marking "Favorite" prompt configurations for specific images.

### System 18: Native Preference Sync
- **Orchestrator**: `GrokSettingsManager.js`
- **Purpose**: Synchronizes GVP preferences with Grok's native `/rest/user-settings` API.
- **Settings**: Manages critical environmental flags like `disableVideoGenerationOnUpload` via a Read-Modify-Write protocol.

- **Optimization (v1.47.3)**: To prevent disk I/O bottlenecks, progress is only persisted to IndexedDB once it reaches a **Terminal State** (100% Complete or Moderated). Intermediate progress updates are held in memory and broadcasted via `gvp:progress-update` for real-time UI updates without persistent storage spam.

### System 20: Rate Limit Management (429 Tracking)
- **Orchestrators**: `NetworkInterceptor.js` | `UploadAutomationManager.js` | `VideoQueueManager.js`
- **Mechanism**: Captures HTTP 429 status codes from bridge responses and propagates them up through the manager hierarchy.
- **Coordination**: `NetworkInterceptor` -> `UploadAutomationManager.notifyUploadFailure(status: 429)` -> `VideoQueueManager.handleRateLimit()`.
- **User Feedback**: Dispatches `gvp:queue-status` with `rate_limited` status and `resumeAt` timestamp, allowing the UI to show accurate countdown timers.

### System 99: Utilities & Resilience
- **Runtime Guard**: All `chrome.storage.local` calls are wrapped in `chrome.runtime?.id` checks to prevent crashes during extension context invalidation (v1.45.5).
- **Logging (GVPLogger)**: Centralized logging with feature-based prefixes, debug level toggles, and "muted modules" list to silence noisy components.
- **Selectors Architecture**: Function-based selector registry in `selectors.js` designed for resilience. Uses multiple strategies (ARIA labels, exact SVG paths, text content) and fallback arrays for each functional target.
- **Backups (v1.46.14+)**: Handles full-DB exports/imports. Support for a **Merge vs Replace** strategy:
    - **Replace**: Clears IDB for 1:1 file consistency.
    - **Merge**: Performs additive `store.put()` to preserve existing local data.
    (See [IndexedDB Subsystem Manual](indexeddb_subsystem_manual.md#📥-3-backup--restore-protocol-safety-first))

---

## 📂 GVP Directory Structure & File Index

### `src/content/managers/` (Core Orchestrators)
- **`StateManager.js`**: Central state storage and account isolation.
- **`IndexedDBManager.js`**: Persistent storage (UVH, lineages, presets).
- **`NetworkInterceptor.js`**: Patches `window.fetch` to intercept/override Grok API traffic.
- **`UIManager.js`**: Shadow DOM orchestrator and sub-manager lifecycle controller.
- **`ReactAutomation.js`**: Controls native React UI (mode switching, input injection).
- **`UploadAutomationManager.js`**: High-fidelity image upload pipeline.
- **`VideoQueueManager.js`**: Backend logic for batch generation queue.

### `src/content/managers/ui/` (UI Sub-Managers)
- **`UIPlaylistManager.js`**: History tab; generation cards and video player.
- **`UIVideoQueueManager.js`**: Queue tab visual grid and stats.
- **`GalleryMiniUIManager.js`**: Dual-rail lineage explorer.
- **`UIGalleryManager.js`**: Masonry card hover tracking and 'Z' shortcut.
- **`UISettingsManager.js`**: Settings panel; Debug and Backup configuration.
- **`UIPromptLibraryManager.js`**: Folder-based prompt storage UI.

---

## 🛠️ Implementation Patterns

### 1. The Element Guard
All DOM crawlers must use `instanceof Element` checks before calling `.matches()` to prevent `TypeError` on Text/Comment nodes.

### 2. Singleton Method Guard (v1.47.10)
To prevent accidental method shadowing in large manager classes (e.g., `IndexedDBManager.js`), always search for existing definitions before appending new recovery methods. Last-in-class definitions shadow previous ones automatically; if the shadowing method invokes non-existent helpers (e.g. `this.upsert`), the entire class will crash.

### 3. The Identity Guard (Async Context)
When performing asynchronous data fetches (IDB or API) that trigger UI updates, managers MUST capture the current view state (e.g., `capturedImageId`, `capturedRootEl`) before the `await`. 
- **Validation**: After the `await`, verify that the active state still matches the captured state before modifying the DOM. This prevents state leakage during rapid view switching.

### 4. Reference Integrity Pattern
To ensure UI components or other managers holding direct references to data arrays (like `this.playlist`) stay in sync, use in-place mutation instead of reassignment.
- **Implementation**: `this.playlist.splice(0, this.playlist.length, ...newItems)`

### 5. Immediate Feedback Pattern (Optimistic UI)
In batch operations or queue additions, render the base item immediately to provide visual acknowledgement to the user. Defer background metadata enrichment (e.g., lineage discovery, thumbnail synthesis) to background async tasks.

### 6. Reverse Scan Strategy
Extracts the deepest valid 36-char UUID from a path (Right-to-Left) to ensure the Asset ID is captured rather than the User/Account ID.

### 7. Stage 6 Target Resolution
When interacting with Shadow DOM elements (like GVP's internal rails), use `event.composedPath()` to find the original target in the light DOM or neighboring Shadow roots.

### 8. Terminal-State-Only Persistence (v1.47.3)
To ensure high performance during bulk operations, avoid writing per-tick progress updates to persistent storage (IndexedDB/Chrome Storage).
- **Pattern**: Store intermediate progress in memory (`Map` or `StateManager` state).
- **Triggers**: Commit to persistent storage ONLY when `progress >= 100` or `moderated === true`. This prevents excessive disk writes during multi-generation bulk jobs.
- **Broadcast**: Use `window.dispatchEvent` or `BroadcastChannel` (`gvp_db_sync`) to keep UIs in sync without disk latency. intermediate states are synchronized via `gvp:progress-update` or `gvp:vidgen-beacon`.

### 9. Technical Logging (v1.47.10)
Logs emitted from network interceptors or error handlers must never include raw user prompt data. 
- **Standard**: Only log `body.length`, `Content-Type`, and the specific Error message/reason.
- **Explicit Visibility**: User preference dictates that technical identifiers like `account_id` and `trace_id` MUST remain unmasked in the logs to facilitate debugging and cross-referencing with Grok's backend systems.
- **Audit Range**: Applies to `NetworkInterceptor.js`, `gvpFetchInterceptor.js`, and `MissionManager.js`.

### 10. The Event Colon Standard (v1.47.10)
All custom events dispatched for cross-component reactivity MUST follow the `gvp:event-name` format with a colon separator. 
- **Rationale**: Replaces inconsistent camelCase or kebab-case names, making events easily identifiable in global event listeners and preventing collisions with third-party or native events.
- **Core Strategy**: All custom events must use the `gvp:name` format. 
- **Key Events**: `gvp:state-updated`, `gvp:unified-history-updated`, `gvp:unified-history-loaded`, `gvp:multi-gen-history-updated`, `gvp:generation-timeout`, `gvp:generation-new-detected`.
- **Enforcement**: Applied during the v1.47.10 state recovery sweep.

---

---

## 📋 Appendix A: Event Standardization Registry

This registry tracks the standardized names for all custom events dispatched within the Grok Video Prompter (GVP) extension.

### 📋 Standardization Mappings

| Old / Non-Standard Name | New Standardized Name | Context / File | Status |
| :--- | :--- | :--- | :--- |
| `gvpPromptUpdated` | `gvp:unified-history-updated` | `UIFormManager.js` | ✅ Fixed |
| `gvp-unified-history-updated` | `gvp:unified-history-updated` | `StateManager.js` | ✅ Fixed |
| `gvp-unified-history-loaded` | `gvp:unified-history-loaded` | `StateManager.js` | ✅ Fixed |
| `gvpPromptHistoryUpdated` | `gvp:unified-history-updated` | Legacy ingestion signals | ✅ Fixed |
| `queue-navigation` | `gvp:queue-navigation` | `VideoQueueManager.js` | ✅ Fixed |
| `queue-status` | `gvp:queue-status` | `VideoQueueManager.js` | ✅ Fixed |
| `gvp:progress-update` | `gvp:generation-new-detected` | `UploadAutomationManager.js` | ✅ Fixed |
| `n/a` | `gvp:upload-queue-updated` | `UIUploadManager.js` | ✅ Fixed |
| `n/a` | `gvp:upload-queue-cleared` | `UIUploadManager.js` | ✅ Fixed |

### 🛠️ Canonical Event List (v1.47.10)

- **State**: `gvp:state-updated`, `gvp:unified-history-updated`, `gvp:unified-history-loaded`.
- **UI**: `gvp:json-presets-updated`, `gvp:raw-templates-updated`, `gvp:saved-prompts-updated`.
- **Network**: `gvp:vidgen-beacon`, `gvp:generation-new-detected`, `gvp:upload-queue-status-changed`.
- **Diagnostics**: `gvp:idb-sync`, `gvp:idb-late-init`.

---

## 📋 Appendix B: Lookup Data Schema

The GVP uses static JSON datasets for form orchestration.

### 1. `gvp_schema_lookups.json`
The primary schema definition file used by `UIFormManager.js` and `UIChunkBuilderManager.js`.
- **Categories**: `scene.description`, `scene.location`, `shot.camera_depth`, `shot.camera_movement`, `tags`, `visual_details.objects`.

### 2. `gvp_parts_lookups.json`
Legacy/Deprecated asset repository referenced for fallback segments.

> [!CAUTION]
> **User Policy**: Per v1.47.10 recovery instructions, these lookup files are **NOT** to be modified or sanitized by automated scripts.

---

## 📎 References
- **Automation Logic**: `automation/automation_master.md`
- **Schema Spec & IDB Subsystem**: `implementation/indexeddb_subsystem_manual.md`
- **Bug Registry**: `research/failure_investigations_and_resolutions.md`

---

## 📋 Appendix C: Stabilization & Log Refinement (v1.47.10)

### 1. Logging Hierarchy & Standardization
GVP enforces a strict logging policy utilizing the `window.Logger` singleton.
- **`Logger.debug`**: High-frequency generation progress; unassociated moderation events; passive background sync.
- **`Logger.info`**: Terminal states; successful prompt/video ID associations; explicit user actions.
- **`Logger.warn`**: Recoverable failures (fallback fetch); API timeouts.
- **`Logger.error`**: Terminal state failures; critical syntax/parsing rejections.

**Traceability**: `account_id` and `trace_id` are preserved in logs (unmasked per user request) to allow expert correlation with backend traffic.

### 2. Network Interceptor Resilience
- **Playlist Sync Return Type**: Standardized `triggerBulkGallerySync` to return `{ success, count, error }` to correctly display synced items in the UI.
- **Moderation Noise Reduction**: Downgraded unassociated moderation detection signals to `Logger.debug` when no GVP-initiated generation is active.

### 3. Native Gallery Integration & Variant Stability
GVP ensures user selections (variants) persist even when interacting with native Grok UI elements.
- **Detection**: Uses a `MutationObserver` on `img[src]` to detect changes.
- **Adoption**: Automatically saves native `src` changes as persistent selections.
- **Clearing**: Identifies native "Original" reverts and clears GVP overrides.

### 4. 429 Rate Limit Handling
Generic "Upload failure" warnings were replaced with status-aware error handling.
- **Detection**: `UploadAutomationManager` detects `status === 429`.
- **Coordination**: Notifies `VideoQueueManager` via `handleRateLimit(60000)` to pause all automated loops.
- **Visuals**: Displays targeted Toast notifications: `"Rate limit / Quota exceeded - Pausing automation"`.

### 5. Media Target Resolution Hardening
- **Composed Path Strategy**: Enhanced `_resolveFavoriteTarget` (content.js) to use `event.composedPath()` for Shadow DOM traversal, recovering context even when the direct target is a non-interactive overlay.
- **Multi-Gen Fallback**: Implemented a tiered fallback chain in `NetworkInterceptor.js` to retrieve `imageId` from `pendingUpload`, account memory, or global safety state if the bridge payload is incomplete.
