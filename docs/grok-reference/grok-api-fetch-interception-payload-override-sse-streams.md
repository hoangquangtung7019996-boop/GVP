# Implementation: Network Interceptor Master Guide

The **Fetch Interceptor** is a critical subsystem of Grok Video Prompter (GVP) that operates within the page context to modify outgoing network requests and decode incoming stream responses before they reach the main extension managers.

---

## 🏗️ Architecture & Orchestration

The subsystem is split across two execution contexts:
1.  **Extension Context (`NetworkInterceptor.js`)**: Orchestrates higher-level logic, builds prompts, and processes decoded stream data for the `StateManager` and `IndexedDB`.
2.  **Page Context (`gvpFetchInterceptor.js`)**: A script injected via `manifest.json`. It patches `window.fetch` to maintain internal state for payload overrides and real-time event broadcasting (`gvp:vidgen-beacon`).

### 🌉 Communication Bridge
Communication is achieved via `window.postMessage`.
- **Source**: `gvp-extension` (Extension Context)
- **Target**: `gvp-fetch-interceptor` (Page Context)
- **Primary Signal**: `GVP_SET_PAYLOAD_OVERRIDE` (Arms the interceptor for the next request).

---

## 🛡️ Request Modification (Payload Overrides)

This mechanism ensures prompt persistence during asynchronous transitions.
1.  **Arming**: Extension sends a `GVP_SET_PAYLOAD_OVERRIDE` message with the target `text`, `fileAttachments`, and `parentPostId`.
2.  **TTL**: The override has an **8000ms TTL** to survive UI mode transitions.
3.  **Consumption**: On the next relevant `POST`, the interceptor clears the override and applies the JSON patch to the request body.

### 🚧 Network Guard (Gatekeeper)
Prevents accidental "Image Edits" when GVP expects a "Video Generation".
- **expect: 'video'**: If set, the interceptor **BLOCKS** any request where `modelName` corresponds to image editing, preventing automation leakage.

---

## 📊 Stream Decoding & Result Ingestion

GVP employs a robust stream decoder within `NetworkInterceptor.js` to handle Grok's real-time video generation feedback.

### 1. The Stream Decoder (`_processStream`)
- **Buffering**: Maintains a local buffer to handle fragmented SSE/NDJSON lines.
- **Decoding**: Uses `TextDecoder` to convert binary chunks into readable JSON lines.

### 2. Line Processing (`_processLine`)
- **SSE/NDJSON Support**: Parses `data: {...}` fragments or raw NDJSON.
- **Moderation Detection**: Uses `ModerDetector.detectModeratedContent(payload)` to flag content.

### 3. Result Ingestion & History Gates (`_processPayloadEvents`)
- **Progress Tracking**: Extracts percentage progress and dispatches `gvp:vidgen-beacon`.
- **Media Capture**: Captures `videoUrl` and `videoId`.
- **History Resilience [RESOLVED v1.47.5]**: History recording via `registerImageProject` has been hardened to prevent account crosstalk. It now utilizes the `getActiveMultiGenAccount()` helper to ensure all captured generations and prompts are associated with the correct partition. This resolves cases where prompts were lost or misallocated during rapid account switching. (Reference: Item 19 "Prompt Harvesting Leak").
- **Internal Beacon Dispatch**: `_dispatchVidGenBeacon(data)` is the source of truth for all downstream UI managers. It ensures `videoId`, `imageId`, `progress`, and `moderated` status are broadcast uniformly.
- **Unified Event Dispatch (v1.47.10 Batch 2)**: Ensure `gvp:vidgen-beacon` always carries `imageId` (fallback to `parentPostId`) to maintain UI continuity during rapid generation cycles.
- **Beacon Dispatch Simplification (v1.47.10 Refresh)**: Removed redundant `JSON.parse(JSON.stringify())` calls during beacon dispatch, transitioning to direct object passing for improved performance and clarity.
- **Gallery Backfill Beacons**: The system now explicitly dispatches `gvp:vidgen-beacon` during the gallery backfill process if a successful video generation is discovered, ensuring the UI (e.g., Progress Rails) reflects the correct state after a sync.

---

## 🛠️ Stability Patterns & Lifecycle (v1.47.10)

### Pattern 13: Fetch Abortion & Integrity
A critical edge case was identified where Grok's native UI aborts requests (e.g., when a user navigates away or cancels a generation). If the GVP `fetchWrapper` does not propagate the `AbortSignal`, the `originalFetch` continue indefinitely, leading to orphaned requests, memory leaks, and "zombie" beacons.
- **Implementation**: The `fetchWrapper` must extract the `signal` from `args[1]` (options) or `args[0]` (if it's a `Request` object) and ensure it is explicitly passed to `interceptor.originalFetch(...args)`. 
- **Impact**: Properly cancels the underlying network request when the caller aborts, maintaining consistency between the browser's network stack and GVP's state.

### Fetch Override Reinstall Rules
The `_overrideFetch` method implements a defensive "skip-if-active" logic:
- **Force**: If `force: true` is passed, it reapplies the wrapper.
- **Idempotency**: By default, it detects if the current `window.fetch` is already the GVP wrapper and skips reinstalling to prevent recursive wrapping loops.
- **Reference Persistence**: The `originalFetch` is captured only once (the first time the extension boots or when `useCurrentAsOriginal` is set) to ensure that even if other extensions patch fetch later, GVP can still access the "most-native" implementation.

### Standardized parseInt Radix
To prevent potential octal-parsing bugs in environments with older JS engines (or when dealing with leading-zero strings), all `parseInt` calls in the interceptor and associated logic (e.g., in `extractPostEntity`, `VideoQueueManager`, and `UIGalleryManager`) have been updated to include the explicit **radix 10**.

### 🛡️ Pattern 14: Logging Policy & Noise Reduction (v1.47.10 Refresh)
High-frequency background events (like progress bars and moderation polling) can flood the browser's console and persistent log files. GVP implements a strict hierarchical logging policy:
- **Centralized Logger**: All standard `console.log/warn/error` calls must be refactored to use `window.Logger`. This allows for unified filtering and log file steering.
- **Log Levels**:
    - **`debug`**: Used for high-frequency progress polling (e.g., `Parsed progress chunk: 45%`) and unassociated moderation events (native Grok noise). These are suppressed in production logs unless "Debug Mode" is active. Modified `_handleModerationEvent` to use debug level for unassociated (non-GVP) generations.
    - **`info`**: Used for significant lifecycle transitions (e.g., `🎉 Progress reached 100!`, `Associated videoId...`) and recorded GVP moderation events.
    - **`warn`**: Reserved for unexpected but recoverable events (e.g., `Fallback fetch triggered`).
    - **`error`**: Used for terminal failures that require immediate dev attention.
- **Diagnostic Transparency**: `account_id` and `trace_id` remain unmasked to facilitate triage.

### 🛡️ Pattern 15: Structural Integrity in Stream Processing
The `_processLine` function is the most performance-critical and fragile entry point in the interceptor. To ensure stability:
- **Unified Method Wrapper**: The entire logic must be wrapped in a single `try-catch` to prevent stream-decoding errors from crashing the manager.
- **JSON Isolation**: JSON parsing of chunk data must occur within a nested `try-catch` to silently handle non-JSON SSE noise (`data: OK`, etc.) without interrupting the main loop.
- **Contiguous Updates**: Avoid partial code replacements for this method; always replace the entire function body to maintain brace alignment and variable scoping (v1.47.10 Refresh resolution).

- **Standard**: All GVP managers must return a standardized result object `{ success, ... }` for cross-boundary API calls to ensure consistent boolean evaluation and error propagation. Refixed `triggerBulkGallerySync` to return `{ success: true, count: totalFetched }` to resolve "Sync failed" UI bugs.

### 🛡️ Pattern 17: Status-Aware Failure Propagation (429 handling)
The interceptor now ensures that the original HTTP status code from bridge-response and conversation-new failures (e.g. `/rest/app-chat/conversations/new`) is preserved and passed to the `UploadAutomationManager`.
- **Implementation**: `handleBridgeConversationResponse` captures `response.status` from the bridge and includes it in the `meta` object passed to `notifyUploadFailure`.
- **Downstream Logic**: This enables managers to distinguish between generic errors and **Rate Limits (429)**, facilitating the automatic pausing of the `VideoQueueManager` and clearer user-facing feedback.

### 🛡️ Pattern 18: Tiered Asset ID Resolution (v1.47.10 Batch 2)
To eliminate `Multi-gen capture skipped: unable to resolve image id` warnings during rapid generation cycles, `NetworkInterceptor.js` employes a tiered fallback strategy in `_captureMultiGenRequestContext`:
1.  **Payload Extraction**: Primary attempt to extract `imageId` from the bridge request JSON payload.
2.  **Pending Upload Reference**: Checks `this._pendingUpload` if a manual image upload was just performed.
3.  **Account-Specific Last Image**: Queries `stateManager.getLastMultiGenImage(accountId)` for the most recent asset synced for the current account.
4.  **Global State Fallback**: As a final measure, retrieves `stateManager.getState().generation.lastImageId`.
- **Outcome**: Ensures that generation context is never lost, even if network triggers occur before the local state is fully hydrated.

## 🔄 Synchronization & Lineage Logic

### 1. Account-Aware Bulk Gallery Synchronization
The sync system ensures UVH (Unified Video History) hydration and account consistency across refreshes.

#### Startup Identity Check Sequence [IMPLEMENTED]
1.  **Immediate Extraction**: `initialize()` triggers `performStartupAccountCheck()`, which extracts `x-userid` from `document.cookie` via `_extractUserIdFromCookie()`.
2.  **Verification Pulse**: If a cookie mismatch is detected, or if no cookie is found, GVP executes a "Pulse Sync" call to `/rest/media/post/list` with **`limit: 10`**.
3.  **Mismatch Action**: If the pulse sync confirms a different identity, the system updates state and triggers a full bulk sync for the new account.

#### Bulk Sync Execution
- **Bulk Sync Execution**: Pass an explicit `accountId` through the entire normalization and ingestion pipeline (v1.47.6+). This prevents race conditions where bulk-synced data is mis-stamped with stale account IDs from the global state.
- **Accurate Limit Logic (v1.47.10-Refinement)**: The loop in `triggerBulkGallerySync` has been corrected to ensure the number of synced items does not exceed the specified `limit`. It now calculates the `actualLimit` for each page fetch correctly, preventing over-fetching.
- **Clean Payload Architecture**: Synchronization requests to `/rest/media/post/list` must match native Grok traffic precisely. Supplemental filters (like `safeForWork: false`) that are not used by the native UI have been identified as potential sources of API rejections or inconsistent results and are omitted.
- **Normalization Stamp**: `_normalizeGalleryPost` prioritizes the explicitly passed `accountId` parameter over any global state fallback.
- **Ingestion Context**: `_ingestListToUnified` requires the `accountId` as a mandatory parameter to ensure correct partitioning during high-volume writes.
- **Lineage strategy**: Maps Grok's `/media/post/list` results to local `parentId` / `rootImageId` lineage via `_ingestListToUnified`.
- **Gallery Null Guards (v1.47.10 Refresh)**: Added comprehensive null guards in `_applyGalleryDataset`, `_ingestGalleryPayload`, and `_extractPostEntity` to handle transient null states during network stream interception and rapid SPA transitions, preventing extension crashes.
- **In-Memory State Merge**: The `_applyGalleryDataset` method safely merges new posts into the `galleryData` state by using a `Map` keyed by `imageId`, ensuring duplicates are avoided and existing data is enriched.
- **API Enumeration**: GVP uses the following mapping for the `/list` endpoint (v1.47.7+):
    - `"favorites"` / `"liked"` / `"saved"` -> `MEDIA_POST_SOURCE_LIKED`.
    - `"all"` / `"gallery"` / `"startup-pulse"` -> `MEDIA_POST_SOURCE_LIKED`. 
    - **Rationale**: User clarification confirms that "Favorites" (now "Saved" at `/imagine/saved`) is the comprehensive repository for all generations, uploads, and interactions. Mapping all common gallery sources to `MEDIA_POST_SOURCE_LIKED` ensures maximum historical visibility within the IndexedDB partition.


### 2. Lineage Strategy: "IDB for Routing, API for Content"
- Local storage tracks the lineage chain (`parentIndex` store).
- GVP fetches sibling sets from the API to guarantee visibility, especially for legacy items or items that missed local registration.

---

## 🛡️ Account State Integrity

To prevent cross-account history recording failures and ensure data isolation:
- **Deprecated Reference**: Do NOT use `this.stateManager.state.account.id` directly. This field may be unpopulated or stale during rapid account switches or before the full user object is hydrated.
- **Canonical Helper**: Always use `this.stateManager.getActiveMultiGenAccount()`. This helper accurately reflects the most recent UUID detected and stored in the `multiGenHistory` state.
- **Explicit Context Pattern (v1.47.6)**: For all normalization and ingestion tasks, avoid falling back to the helper inside the normalizer. Instead, capture the ID at the entry point (e.g., `triggerBulkGallerySync`) and pass it as a parameter through to `_normalizeGalleryPost`. This ensures that even if a rapid account switch occurs during the sync, the data is stamped with the identity that triggered the sync, preventing "poisoned" records in IndexedDB.
- **Debug Transparency**: Per user preference, `account_id` and `trace_id` remain unmasked in logs to facilitate expert-level triage and correlation with server logs.

---

## 🔗 References
- [GVP Technical Manual](gvp_technical_manual.md)
- [Vidgen Beacon Origins](../research/vidgen_beacon_event_origins.md)
- [Automation & Resilience Master](../automation/automation_master.md)
- Conversation ID: `f66acf6c-2cc1-452b-80e0-844dff4e5716`
