# GVP Automation & Resilience Master

This artifact consolidates the technical specifications for GVP's automated workflows and the cross-cutting strategies used to handle environmental failures and moderation.

### 🏛️ System 7: Job Queue & Multi-Generation Orchestrator

The `VideoQueueManager` is the engine for batch video generation.

#### 🔄 Loop Modes (`loopMode`)
- **`off`**: Stops once all items have been attempted.
- **`moderated`**: Resets "moderated" items to `pending` and restarts. **v1.47.3 Implementation**: Automatically clears successful items via `_clearByStatus('success')` to focus exclusively on retries. 
- **`full`**: Resets ALL items to `pending` and restarts.

#### 🧱 Batch Processing Logic (`_processNext`)
The queue uses a **Fire-and-Forget** triggering pattern:
1.  **Selection**: Picks the next `pending` item.
2.  **Smart Edit Scheduling (v1.23.19)**: When processing image edits, the queue ensures that only one edit per parent image is active at a time to prevent state collisions in Grok's backend.
3.  **Navigation**: Performs a clean SPA navigation to the asset's post page (e.g., `/imagine/post/{imageId}`) using `pushState` and `PopStateEvent`.
4.  **Duplicate Prevention**: Maintains a `_recentlyTriggered` internal map to prevent double-firing the same ID within a cooldown window.
5.  **Triggering**: Calls `ReactAutomation.sendToGenerator()` with the calculated prompt.
6.  **Continuation**: Immediately schedules the next item after the trigger, without waiting for the current one to finish (Status: `triggered`).

#### 📡 Real-time Tracking (`_handleRailProgress`)
The manager listens for `gvp:vidgen-beacon` events dispatched by the `NetworkInterceptor`.
- **Beacon Payload**: `{ videoId, imageId, progress, moderated, ... }`
- **Logic**: If the `matchId` (imageId or videoId) matches the active queue item, it updates the status to `success` (if 100%) or `moderated`.
- **Intelligent Resumption**: On terminal state (Success/Moderated), it schedules the next batch item if the queue is running. 
- **v1.47.3 Moderation Guard**: If the `moderated` flag is true, `moderationStreak` is incremented. If it hits `maxModerationStreak` (3), the queue pauses to prevent flagging.
- **SPA Navigation Workflow**: `_navigateToPost` dispatches a `gvp:queue-navigation` event, then uses `history.pushState` and `PopStateEvent` to transition without a hard reload.

#### 🧩 Multi-Video Concurrency (`MultiVideoManager`)
The `MultiVideoManager` extend the queue logic to handle multiple concurrent generations (up to a defined limit).
- **Queue Slots**: Manages available slots and queues generations when the limit is reached.
- **Monitoring**: Actively monitors all concurrent generations for "stuck" or "timeout" scenarios, marking them as failed if they exceed expected duration thresholds.
- **Statistics**: Calculates average generation duration and success rates for performance diagnostics.

#### 🧩 Moderation Loop Resilience (v1.46.1)
An infinite loop vulnerability was identified in `_handleQueueComplete`, where permanently moderated items would be retried indefinitely across cycles.

- **The Issue**: When `loopMode` is set to `moderated`, the manager resets all items with a `moderated` status back to `pending` for the next cycle. Without an intra-item retry cap, the queue cycles forever.
- **The Investigation**: Analysis revealed that `moderationStreak` only tracks consecutive failures in a single pass, not persistent failures across multiple loop cycles.
- **The Resolution**: Implemented a **Per-Item Retry Cap** (Default: 3). 
    - Each queue item now tracks its own `moderatedRetries` counter.
    - `_handleQueueComplete` only resets moderated items to `pending` if their individual retry count is <= 3.
    - Items exceeding the limit are simply not reset (remaining as `moderated`), effectively stopping the infinite loop while maintaining their visibility in the queue for manual intervention.
    - **v1.47.3 Refinement**: In `moderated` loop mode, successful items are purged from the UI grid automatically at the end of the cycle to keep the retry list clean.

---

---

## 🏢 System 10: QuickLaunch Orchestration

The `QuickLaunchManager` (located in `src/content/content.js`) is the primary orchestrator for user-initiated "Quick Actions" (Quick Raw, Quick JSON, Quick Video, Quick Add to Queue). It handles the transition from gallery interactions to generator or queue states without requiring manual user input in the generator interface.

### 🏛️ Core Workflow (The Quick-Launch Sequence)

1.  **Trigger**: User clicks a "Quick Action" button on a gallery card or post page.
2.  **Registration (`handleQuickLaunch`)**: Computes a `payload` containing the `mode`, `targetPath`, and `prompt`.
3.  **Persistence**: Stores the payload in `sessionStorage` to survive navigation or page refreshes.
4.  **Navigation (The Redirect Gate)**:
    *   If the mode requires the generator (`raw`, `json`, `video`) and the user is on a **Post Page** (where these tools are missing), it forces a redirect to `/imagine`.
    *   Uses `_navigateSPA` (v1.38.25) for centralized navigation management.
5.  **Resumption (`_maybeResumePendingLaunch`)**: Polls for the target page to load using `_queueResumeProbes`.
6.  **Automation (`_processPendingPayload`)**: Injects the prompt and triggers submission via `ReactAutomation` or `UIManager`.

### 🏗️ Prompt Building Logic (`_buildPrompt`)

The manager dynamically constructs prompts based on the active mode:

| Mode | Logic / Source | Default Fallback |
| :--- | :--- | :--- |
| **`video`** | `state?.generation?.lastPrompt` | `"Cinematic video"` |
| **`queue`** | Returns `''` (Proceeds without prompt) | N/A |
| **`json`** | Calls `uiManager.uiFormManager.buildJsonPrompt()` | `''` |
| **`raw`** / **`edit`** | Calls `uiManager.uiRawInputManager.buildRawPrompt()` | `''` |

### 📥 Quick Add to Queue: DOM-First ID Strategy

When adding to the queue, GVP prioritizes the active DOM state over URL metadata to ensure accurate identification on Post views.

-   **Robust UUID Extraction (Reverse Scan)**: To handle complex CDN URLs (e.g., `.../users/USER_ID/IMAGE_ID/content`), GVP performs a **Reverse Scan** on URL path segments, identifying the deepest segment matching the v1.46.0 UUID regex.
-   **Main Image Targeting**: Directly targets the primary hero image on post pages: `document.querySelector('.grid > img.col-start-1.row-start-1')`.
-   **Thumbnail Fallback Construction**: If a thumbnail is not provided by history, it is constructed based on URL patterns (`share-images`, `images`, or `assets.grok.com`).

### 🔙 Navigation & Return Strategy

-   **Natural ESC Strategy (`_simulateEscape`)**: To return to the gallery after submission without a full page reload, GVP dispatches a simulated `Escape` key event. This closes Grok's native modal/overlay.
-   **Robust Fallback**: If the URL does not change within 500ms (indicating ESC failed to navigate), a forced SPA navigation to the source URL is triggered.

---

## 🏢 System 8: Image Upload Automation (Bulk Upload)

Handles the automated ingestion and anchoring of local image files.

### 🏗️ The Iframe Guillotine Sequence

GVP processes image uploads through a specialized three-phase "Guillotine" sequence. This is an API-first bypass designed to avoid triggering Grok's heavy SPA navigation or hard refreshes.

#### Phase 1: Upload & Creation (API Pass)
1.  **Ghost Fetch**: Creates a hidden `<iframe>`.
2.  **File Transfer**: Uses `iframe.contentWindow.fetch` to post the image to `/rest/app-chat/upload-file`.
3.  **Creation Signal**: Fires `/rest/media/post/create` via the SAME ghost fetch context.
4.  **TCP Kill (The Guillotine)**: Forcefully destroys the iframe after a configurable delay (`state.settings.guillotineDelay`, default: 245ms).

#### Phase 2: Ghost Anchoring (SSR + Like pulse)
1.  **SSR Trigger**: Performs a native `fetch` (bypassing the interceptor) to the canonical post URL (`/imagine/post/{fileId}`). This forces Grok's server-side renderer to index the orphaned post UUID.
2.  **Anchoring Delay**: Waits for the backend to process the record.
3.  **Like Pulse (v1.45.7 Fix)**: Fires a POST to `/rest/media/post/like` using `credentials: 'include'` and payload `{"id": "fileId"}`.
4.  **Anchoring Speed (v1.45.7 Fix)**: To ensure reliable SSR indexing before the subsequent `/like` call, the internal delays were doubled:
    - **SSR Settle Wait**: Increased from 1000ms to **2000ms**.
    - **Post-Like Pause**: Increased from 500ms to **1000ms**.

#### Phase 3: Queue Handoff & Refresh
1.  **Metadata Injection**: Returns the `fileId` and a **Canonical Post URL**.
2.  **UI Integration**: Injects the item into `UIVideoQueueManager`.
3.  **Gallery Sync**: Fires a `/rest/media/post/list` call via the patched fetch.

| Type | Format / Purpose | Status (v1.45.7) |
| :--- | :--- | :--- |
| **Public Share URL** | `https://imagine-public.x.ai/imagine-public/share-images/{fileId}.jpg?cache=1` | **Legacy**: Used as a fallback for internal thumbnail rendering (`content.js`). |
| **Canonical Post URL** | `https://grok.com/imagine/post/{fileId}` | **Active**: Now the primary `publicUrl` returned by `UploadAutomationManager.js`. |

### 🛡️ "Intent-First" Resilience (v1.45.7)

To resolve the "Cannot enqueue - mode disabled" bug, the manager was refactored with zero-friction activation logic.
- **Auto-Enablement Gate**: `enqueueFiles()` proactively verifies if the manager is active; if not, it auto-enables the mode via `StateManager`.
- **Missing Handler Restoration**: Restored `_handleModeChange`, `_handlePathChange`, and `_handleNewRequest` events to ensure the manager reacts to global session state.

### 🔗 URL Resolution & Regex Transformation

Phase 3 of the `ReactAutomation.js` protocol includes a specialized regex swap for private assets:
- **Target**: `https://assets.grok.com/users/{accountId}/{fileId}/content`
- **Replacement**: `https://grok.com/imagine/post/{fileId}`
- This ensures internal assets are rewritten to their public post counterparts in the video generation prompt string.

### 🛡️ Phase 2 Anchoring & Hard Refresh Investigation (v1.45.8)
A critical issue was identified where the anchoring process (Phase 2) occasionally triggers a full page hard-refresh, particularly when the user is on the `/imagine/favorites` page.

**Anchoring Logic Recap**:
The `_anchorGuillotinePost` method avoids standard SPA navigation (which Grok's Next.js implementation converts to a hard refresh for `/imagine/post/...` routes). Instead, it uses a two-step "ghost anchoring" strategy:
1.  **Background SSR Fetch**: Performs a `nativeFetch` (bypassing the interceptor) to the post URL. This forces the Grok server to render the page and index the record.
2.  **Native /like Pulse**: Fires a direct `/rest/media/post/like` request.

- **[FIXED] fetchWrapper TypeError**: Identified a context loss in `NetworkInterceptor` where `this._pageInterceptorActive` was undefined during background fetches. Fixed by ensuring the interceptor instance is scoped correctly in the closure.
- **[SOLVED] Missing Auth Credentials**: Added `credentials: 'include'` to all background API pulses to ensure valid session cookies are sent.
- **Ongoing Investigation**: See [Upload Hard Refresh Investigation (v1.45.8 Update)](../research/upload_hard_refresh_investigation.md).


---

## 🚫 Moderation & Safety Patterns

### Hybrid Detection
- **Network-Level**: Listening for NDJSON stream events.
- **DOM-Level (The Watcher)**: `MutationObserver` scanning for Grok's "Violation" UI elements and "Remove" buttons. Triggers aggressive cleanup via `_clearModeratedImageCard()`.

### Moderation Streaks
Tracks `moderationStreak`. If consecutive generations are moderated (Limit: 3), the queue automatically pauses and shows a warning toast to prevent potential account flags.

---

## 🧩 Context Invalidation Resilience

Handles the `Extension context invalidated` error occurring when parts of the extension reload.

### 🛡️ The Runtime Guard (v1.45.5)
All `chrome.storage.local` calls must be preceded by an explicit runtime ID check and wrapped in try-catch to prevent a terminal crash during service worker reloads.

```javascript
/* Standard Resilience Pattern */
if (chrome.runtime?.id) {
    try {
        chrome.storage.local.set({ [key]: value }, () => {
             if (chrome.runtime.lastError) { /* Handle error */ }
        });
    } catch (e) {
        window.Logger.warn('Storage Manager', 'Context invalidated, skipping save');
    }
}
```

#### v1.45.5 High-Risk Audit Registry
A systemic sweep was performed to apply this guard to all managers interacting with persistent storage:
1.  **`UIVideoQueueManager.js`**: Essential for saving user queue filters and prompt-packs.
2.  **`StateManager.js`**: Critical for maintaining the Global State across tab switches.
3.  **`RawInputManager.js` & `UIRawInputManager.js`**: Prevents losing recent prompt history.
4.  **`JobQueueManager.js`**: Ensures batch gen status is preserved on page refresh.
5.  **`InspectionManager.js`**: Guards the history of inspected UUIDs.
6.  **`IndexedDBManager.js`**: Applied to legacy-to-IDB migration flags.
7.  **`StorageManager.js` & `StorageHelper.js`**: Core abstractions for local storage.
8.  **Logger.js**: Ensures debug logging toggles don't trigger crashes.

### 🛑 Rate Limit Handling (HTTP 429) - [v1.47.10 Batch 2]
To prevent further account flagging and provide clear user feedback during quota exhaustion, GVP implements a cross-manager "Rate Limit Shutdown".

#### 1. Detection Cycle
- **Interceptor**: The `NetworkInterceptor` captures any non-OK response from the Grok bridge (`/rest/app-chat/conversations/new`).
- **Notification**: It notifies the `UploadAutomationManager` via `notifyUploadFailure(meta)`.
- **Validation**: The manager specifically checks for `meta.status === 429`.

#### 2. The Propagation Chain
When a 429 is confirmed:
1. **User Notification**: Triggers a high-priority toast: "Rate limit / Quota exceeded - Pausing automated tasks".
2. **Queue Shutdown**: Calls `VideoQueueManager.handleRateLimit(retryAfterMs)`.
3. **Loop Termination**: In `loopMode !== 'off'`, the queue engine is instructed to **FORCE STOP** instead of just pausing, as per user requirement to avoid hammering the API while over quota.
4. **Resumption Pause**: For non-looping queues, sets `rateLimitUntil` timestamp to block further `_processNext` attempts until the cooldown expires.

---

## 📂 System 17: Image Project & Versioning

The `ImageProjectManager` provides version control and persistent history for image-specific generations, bridging the gap between ephemeral gallery states and long-term project data.

### 🏗️ Registration & Metadata Schema
- **Unified Entry**: Supports both legacy prompt strings and the new rich metadata schema (v1.38.5+).
- **Indexing**: Projects are keyed by `accountId` and `imageId`.
- **Automatic Sync**: The `syncFromGalleryData` method periodically hydrates the project storage from cached gallery JSONs, ensuring that generations triggered outside of GVP are still captured in the project history.

### 🔄 Version Management
- **JSON Versions**: Tracks all prompt versions (JSON payloads) associated with an image.
- **Favorites**: Allows users to mark a specific JSON configuration as the "Favorite" for a project, facilitating rapid re-use.
- **Stats**: Provides project-level statistics (e.g., number of versions, total generations).

---

## 🎭 System 14: React Mode Automation

`ReactAutomation.js` manages the high-level UI transitions required to move between Grok's generation modes (Image vs. Video).

### 🔄 Force Mode Transition (`forceVideoModeTransition`)
When an automation task (like QuickLaunch) requires Video mode but the UI is currently in Image mode, GVP executes a multi-step transition sequence.

1.  **Safety Gate**: Checks if `isVideoModeActive()` which now employs a precision check for `button[aria-label="Video"][aria-pressed="true"]` and verification of the submit button label.
2.  **Strategy B (Preferred)**: Opens the "Settings" menu and selects "Make Video". This strategy is preferred over direct buttons to ensure React state synchronization.
3.  **Step 1: Open Settings**: Locates and clicks the "Settings" gear button. To avoid clicking gallery card options, it restricts search to the main input area's context (`inputSelector.closest('form')`).
4.  **Step 2: Selection**: Waits for the Radix menu popover (`[data-radix-menu-content]`) and polls for the "Make Video" item via `window.GROK_SELECTORS.MENU_ITEMS.MAKE_VIDEO()`.
5.  **Step 3: Verification**: Employs a retry loop that waits for `this.isVideoModeActive()` to return true, confirming the React mode swap has settled.

### 🛠️ Image Edit Automation (`monitorAndEdit`)
GVP employs a robust State Machine (v3.0) for automating the transition into and interaction with "Image Edit" mode.

#### Linear Sequential Validation (6 Stages)
To ensure reliability against Grok's asynchronous UI loading, `monitorAndEdit` follows a strict pipeline:
1.  **Stabilization (v1.47.3 Integrated)**: 
    - **Combined Polling**: Triggers the Image Toggle and polls simultaneously for the mode toggle AND the direct edit button. 
    - **Fast-Path**: If a "Fresh" image or a Moderated Video page is detected (using the updated `SETTINGS_BTN` SVG paths), it clips the poll early, saving ~1.5s - 3s of fixed timeout delays.
2.  **Context Lock**: Confirms the Presence of the `.grok-edit-modal` or related indicators.
3.  **Input Preparation**: Injects the prompt using the `_setEditableValue` protocol.
4.  **Action Trigger**: Locates and clicks the primary "Edit" or "Make Video" submission button.
5.  **Completion Verification**: Monitors for modal closure or the emergence of a new generation thumbnail.
6.  **Cleanup**: Resumes any paused background watchers (like `gvp-imgedit-autoback`).

### 💉 Payload Override Resilience (v1.46.0)
To prevent prompt loss during mode transitions, `sendToGenerator` implements a "Pre-Transition Arming" protocol.
- **Protocol**: If `isRaw` is true and video mode is not yet active, the system arms the Network Interceptor's payload override **immediately**, before clicking any menu items.
- **Benefit**: Ensures the prompt persists even if the React context for the text area is destroyed/re-created during the transition.

### 🛡️ Syntax & Structure Stability (v1.46.4)
The internal structure of `ReactAutomation.js` was audited and flattened to resolve nesting-related syntax errors.
- **Standalone Methods**: `isVideoModeActive()` and `forceVideoModeTransition()` are now distinct class methods rather than nested closures.
- **Context Guard**: Uses `this.isVideoModeActive()` explicitly to ensure method access within the class scope.
- **Robust Exception Wrapping (v1.46.4)**: `sendToGenerator` now correctly implements method-level `try/catch` wrapping, ensuring the `catch` block is properly syntactically attached to its `try` block.
- **Trailing Syntax Verification**: A class-wide audit resolved critical trailing syntax errors (missing parentheses and closing braces) that previously prevented the class from correctly parsing/instantiating on window load.

### 🔍 Selector Audit Registry (v1.45.7 / v1.45.8)
The following selectors in `selectors.js` are the primary targets for the transition stability audit:

| **Settings Gear** | `button[aria-label="Settings"]` | **CRITICAL BUG**: A hardcoded path `M17.5692` was used in `ReactAutomation.js`—this is actually the **Edit Image (Brush)** icon. All "Make Video" transitions failed because it targeted the wrong button. Fixed in v1.45.7 by adopting a generic `button[aria-label="Settings"]:has(svg)` match. v1.46.0 restricted the parent `rootNode` to the input form to prevent card settings collisions. |
| **Make Video Item** | `div[role="menuitem"]` | Found via `findFirst` or text search. Relies on the Gear button successfully opening the popover first. |
| **Popover Content** | `[data-radix-menu-content]` | Standard Radix/Radix UI container. |
| **Masonry Card** | `[class*="media-post-masonry-card"]` | **v1.45.8 Update**: Updated gallery detectors to include new masonry card class patterns. v1.46.0 added `div.group\/media-post-masonry-card` for enhanced Quick Action resolution. |
| **Video Selector** | `VideoQueueManager._extractImageId` | **v1.46.0 Update**: Synchronized UUID extraction logic to use the unified `edit`/`post` aware regex in `regex.js`. |

### 🛡️ v1.45.7 Stability: Transition Resolution
The "Make Video menu item not found" error was identified as a downstream effect of the **Settings Gear selector mismatch**. Because the automation targeted the "Edit Image" brush instead of the "Settings" gear, the required popover never opened, causing the menu item poll to time out. The fix involved removing the specific SVG path constraint to favor broader aria-label matching.

### 🛡️ v1.45.8 Stability: Strategy B & Quick Video Flow
GVP refined its mode-switching strategy to prioritize **Strategy B** (Settings Gear -> Menu Selection) over direct click buttons to ensure higher prompt reliability and prevent "empty prompt" submissions.

1.  **Quick Video From Edit**: A specialized flow for edited images (detected via `/generated/` URLs).
    - **Trigger**: `content.js` identifies left-click on an edited thumbnail via `_handleEditedImageClick`.
    - **Payload**: Sets `pendingVideoFromEdit: true`.
    - **Submission**: Bypasses standard raw/json handlers to call `reactAutomation.sendToGenerator` directly.
    - **Return**: Uses `_simulateEscape()` to return to the previously active gallery view without triggering a page reload.
    - **State Management (`gvp:quick-video-from-edit-changed`)**: Stability is maintained via the `gvp:quick-video-from-edit-changed` event. Dispatched by `UIManager.js` when the feature is toggled, it allows `content.js` to enable or disable the specific click listener on masonry thumbnails, ensuring the flow is only active when intended.
2.  **Targeting Accuracy**: `forceVideoModeTransition` now employs a strict `rootNode` targeting strategy. It restricts the search for the "Settings" gear to the main chat input form's context (`inputSelector.closest('form')`). This prevents the automation from accidentally clicking "More options" buttons on unrelated gallery cards that populate the DOM. This was identified as a critical regression point for "Quick Video" actions triggered from favorites or post pages.

### 🔍 Moderated Video Landing Page Detection (v1.47.3)

GVP identifies specific "Moderated Video" landing pages that lack standard variant controls but require prompt injection for subsequent edits.
- **Identification Strategy**: `ReactAutomation.js` Stage 1 identifies these pages by locating a "Settings" gear SVG with the unique path `M13.7314`. 
- **Bypass Workflow**: Upon detection, the "Fast-Path" terminates polling and immediately proceeds to Stage 4 (Prompt Injection), treating the current view as an editable image context despite the lack of typical "Image Edit" UI elements.
- **Selector Synchronization**: `selectors.js` was updated to include these specific paths in the `SETTINGS_BTN` fallback array.

### 🖼️ Image Edit Mode Detection: Stage 1 Fast-Path (v1.47.4)

v1.47.4 introduced robust detection for the side-by-side mode toggles directly above the prompt box.
- **Identification**: Grok UI uses specific SVG paths for its "Make Image" (`path[d^="M18.8413"]`) and "Make Video" (`path[d^="M16 8.41421"]`) toggle buttons.
- **Fast-Path**: `ReactAutomation.js` Stage 1 now explicitly checks for the "Make Image" button `[aria-pressed="true"]`. If found, it instantly confirms the UI is in Image Edit mode and bypasses the 2000ms stabilizing delay, significantly speeding up automation for subsequent edits.

### 🖼️ Image Mode Fallback (v1.47.3 Refinement)

A critical automation resilience pattern was introduced for "Fresh" gallery cards (newly uploaded or un-edited).
- **The Protocol**: If `monitorAndEdit` identifies a card with no generation history (no video, no edits), it identifies the state as a "Straight Image" mode.
- **Logic Bypass**: It skips the `forceVideoModeTransition` (Stage 2) and `waitForToggle` (Stage 1) sequences.
- **Execution**: Directly injects the user's prompt into the main input box and proceeds with `sendToGenerator`, effectively treating the lack of a "Video" toggle as a definitive "Image Mode" signal. This removes ~2s of unnecessary polling on fresh assets.

---

---

## 🏛️ Foundational Automation Patterns

These core technical protocols ensure resilient interaction with Grok's DOM and React state across all GVP subsystems.

### 1. The Selector Law
**Standard**: Native DOM selectors must never be hardcoded within logic files. 
- **Centralization**: All selectors reside in `src/content/constants/selectors.js`.
- **Registry Philosophy**: Selectors are grouped by `FEATURE -> FUNCTION_NAME`.
- **v1.45.7 Stability**: Replaced fragile SVG path matching (e.g., `M17.5692` which was incorrectly mapped to the Brush icon) with robust ARIA-label based selectors like `button[aria-label="Settings"]:has(svg)`.

### 2. React State Reconciliation (The TipTap Protocol)
GVP uses a specific protocol to force Grok's TipTap/React engine to recognize programmatic input.
1.  **Injection Strategy**:
    - **Textarea**: (Legacy) Standard `value` property manipulation.
    - **ContentEditable**: (Modern) TipTap requires text to be wrapped in `<p>` tags.
2.  **Event Dispatch**:
    - Dispatches an `InputEvent` with `inputType: 'insertText'`. 
    - **CRITICAL**: Without the explicit `insertText` type, React's ProseMirror listener will ignore the change, leading to empty submissions.
3.  **Validation**: Employs a normalization check (trimming and whitespace collapse) to ensure the injected text matches the desired prompt without being sabotaged by minor formatting differences.

### 3. Interaction Protocols (`aggressiveClick` v4.0)
Standard click events are often insufficient for Radix UI components. GVP employs a multi-stage pointer sequence:
1.  **Pointer Sequence**: Dispatch `pointerdown` and `pointerup`.
2.  **Mouse Sequence**: Dispatch `mousedown` and `mouseup`.
3.  **Synthesis**: Dispatch a final `click` MouseEvent.
4.  **Targeting**: If the element contains an SVG (common for icon buttons), the event is also dispatched to the child icon to ensure hit-box capture even when clicking the stroke of the SVG.

### 4. Waiters & Polling
Automation tasks use `waitForElement` with configurable timeouts and root nodes to ensure elements are mounted before interaction, preventing "undefined" or "null" selector crashes.

### 5. Standardized UUID Extraction (v1.46.0 Alignment)
To prevent navigation failures across different Grok URL structures (public shares vs. private posts), GVP implements a unified extraction regex in `regex.js`:
- **Pattern**: `/(?:share-images|images|post|edit)\/([0-9a-f-]{36})/i` (v1.46.0 includes `edit` and `post` support)
- **Application**: Synchronized across `content.js`, `UIManager.js`, and `NetworkInterceptor.js` for 100% path-to-ID consistency.

---

## 🐞 Critical Infrastructure Fixes (v1.45.8)

### Quick Action `TypeError` (Resolution v1.45.9)
- **Problem**: `TypeError: node.matches is not a function` occurred in `getMediaPathFromNode` when the resolution logic encountered a Text node or non-Element node during a masonry-card crawl. This was triggered during the `_resolveFavoriteTarget` phase of a Quick Action.
- **Fix**: Added an explicit `instanceof Element` check before calling `.matches()`. This ensures the multi-stage resolution (searching for `img` or `video` children within card containers) completes safely even when target nodes include non-element items.

### The "Post Page Trap" & Multi-Stage Click Resolution
- **Problem**: When a user clicks a Quick Action button on a Masonry Card that is *already* on an image post page, the SPA sometimes fails to re-trigger the route or incorrectly identifies the target media. Furthermore, generator-based automations (Raw, JSON, Video) fail on the Post Page because the sidebar UI is unstable or missing.
- **Solution**: `QuickLaunchManager._resolveFavoriteTarget` implements a hierarchical search and a redirection gate (The "Nuclear Option"):
    1.  **Direct Target**: Check if the click target itself is the card.
    2.  **Parent Search**: Crawl up to the nearest Masonry Card or Gallery Container.
    3.  **Recursive Down-Search**: Scan for `img` or `video` tags within the container.
    4.  **Composed Path Fallback (v1.47.10 Batch 2)**: Utilizes `event.composedPath()` to trace back through shadow boundaries and find the nearest interactive post parent if standard DOM crawling fails.
    5.  **The Nuclear Option (v1.46.0)**: If the mode is `raw`, `json`, or `video`, the extension forces `targetPath = '/imagine'`. If currently on a Post Page, it performs an emergency redirect to ensure the generator sidebar is available.
    6.  **Self-Recovery**: If no card is found, it defaults to the URL-based extraction for the current view.

---

## 🏢 System 15: UUID Extraction & Path Resolution

This system provides the core logic for identifying asset identifiers (UUIDs) across complex Grok and CDN URL structures.

### 🔍 The Challenge: Path Ambiguity
Grok URLs often contain multiple 36-character UUIDs (User ID, Conversation ID, Asset ID). Sequential matching (left-to-right) often captures the parent ID instead of the specific generation ID.

### 🛡️ The "Reverse Scan" Strategy (v1.46.0+)
To reliably extract the **Asset ID**, GVP employs a Right-to-Left scanning technique:
1.  **Split**: Path is split by `/`.
2.  **Iterate**: Segments are checked in reverse order.
3.  **Validate**: Matches against `GVP_UUID_REGEX`.
4.  **Halt**: First match is returned.

### 🔗 Unified Regex System (`regex.js`)
Centralizing the pattern ensures consistency across all managers:
```javascript
const GVP_UUID_REGEX = /(?:share-images|images|post|edit|generated)\/([0-9a-f-]{36})/i;
```

### 🐞 v1.45.7 Regression: `imagine-public` Parsing
Parsing errors for `imagine-public/share-images` URLs in `QuickLaunchManager` were resolved by widening the regex support and ensuring protocol hand-off for `https://imagine-public.x.ai` into the reverse scan logic.

---

## 📎 References
- [Quick Action System](../implementation/quick_action_system.md)
- [Failure Investigations & Resolutions](../research/failure_investigations_and_resolutions.md)
- [GVP Master Overview](../overview.md)
- [CONVERSATION: 51b1676a-fd6c-40c7-8d70-47124cacb440](https://grok.com/chat/51b1676a-fd6c-40c7-8d70-47124cacb440)
