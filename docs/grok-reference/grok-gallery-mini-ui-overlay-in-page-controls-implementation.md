# Implementation: Gallery & Playback Systems (System 9)

This artifact consolidates the technical specifications for GVP's gallery grid management, masonry card injection, and the high-performance dual-rail Mini-UI.

---

## 🏛️ System Architecture

System 9 governs the presentation and interaction of the Grok video and image history in a virtualized grid. It identifies native masonry cards and injects custom GVP controls and state.

- **Orchestration**: `UIGalleryManager.js` (Lightweight hover tracker)
- **High-Performance UI**: `GalleryMiniUIManager.js` (Shadow DOM dual-rail panel)
- **Data Resolution**: Recursive "Absolute Root First" lineage chasing.

---

## 🖼️ Gallery Masonry Cards

### Selector Registry
- `GROK_SELECTORS.FEATURES.GALLERY.CARD.CONTAINER`: Primary masonry card element.
- `.group\/media-post-masonry-card`: Scoped Tailwind group for card hover states.
- `[role="listitem"]`: Container for individual masonry cards in the grid.
- `data-gvp-parent-id`: Linkage attribute for GVP heritage (legacy/transition).
- `data-gvp-root-id`: Resolved absolute root ID stored on the card for instant mini-UI triggering.
- `#gvp-launcher-stack-top`: Container for top-aligned quick action buttons on cards.
- `.gvp-launcher-group`: Grouping class for GVP UI extensions on gallery nodes.
- `.gvp-launcher-tab`: Base class for custom button overlays (Silent, Spicy, Upscale tokens).

### Pre-Injection & Scanning (v1.44.8+)
To avoid hover delays and provide instant feedback:
- **`IntersectionObserver` scanner**: Calls `_identifyAndInject(card)` the moment a card enters the viewport.
- **Memory-first lookup**: Checks `stateManager.state.unifiedHistory` (cached in-memory) *before* falling back to IndexedDB.
- **Live Update**: When `gvp:multi-gen-history-update` fires, visible cards that have new edit data are automatically updated with carousel arrows.

### 🧩 DOM Reference: Masonry Card 구조 (Structure)
```html
<div role="listitem" style="width: 450px; ...">
  <div class="relative group/media-post-masonry-card cursor-pointer ...">
    <div class="">
      <img src=".../preview_image.jpg" class="rounded-2xl" ...>
      <!-- Optional Video Overlay -->
      <video src=".../generated_video.mp4" class="absolute object-cover rounded-2xl ..." ...>
    </div>
    <div class="absolute top-2 right-2 ...">
      <!-- Native and GVP buttons are injected here -->
    </div>
  </div>
</div>
```

---

## 🛠️ Gallery Card Mini-UI Editor (System 10 Integration)

The Mini-UI provides a dual-rail exploration of generation lineages via 'Z' + Hover.

### Key Features (v1.45.4)
1. **Dual Vertical Rails**: Left rail for Image Edits (`entry.images[]`), Right rail for Generated Videos (`entry.videos[]`).
2. **Absolute Root Resolution**: Recursively chases parent IDs to ensure 100% visibility of sibling assets.
3. **Active Image Swap (Click)**: Clicking a thumbnail swaps the main gallery card's image in-place, clearing `srcset` to ensure manual override.
4. **Media Robustness**: Employs a property waterfall and video thumbnail synthesis to handle sparse or inconsistent API data.
5. **Graceful Error Handling**: Broken thumbnail URLs (403/404) are automatically replaced with type-specific SVG placeholders (Photo vs Play button) to maintain UI integrity.
6. **Root Visualization**: Root images are identified, sorted to the front of the image rail, and marked with a "⭐ Original" pill badge.
7. **Synthetic Image Injection**: For cards where the root is a Video, the UI synthesizes a root image thumb from the card's `<img poster>` src.
8. **Bug 8 & 9 Fixes (v1.45.4)**: Corrects field mismatches and prevents "false satisfaction" early-returns for partial IDB caches using **'IDB for Routing, API for Content'**.

### 🎨 Interaction Rules
- **Snap-Scrolling**: Rails use `scroll-snap-type: y mandatory` for fluid vertical navigation.
- **Glassmorphism**: Backgrounds use `rgba(20, 20, 20, 0.72)` with `backdrop-filter: blur(12px)`.
- **Anchoring**: Elements are positioned using `getBoundingClientRect()` of the target card plus `window.scroll` offsets.
- **Auto-Close**: Closes on `Escape`, outside-click, or viewport scroll.
- **Active Variant Selection (Research Phase)**: Clicking a thumbnail in the rail triggers an in-place swap of the gallery card's `img.src` or `video.src`. 
    - **Native Persistence**: When a user selects a variant via Grok's native post carousel, the selection is persistent across page refreshes.
    - **Goal**: Implement similar persistence for Mini-UI selections by storing the "Active Child ID" in IndexedDB linked to the parent/root ID.

---

## 💾 Persistent Variant Selection (v1.47.4 Implementation)

The Gallery system has been evolved to mirror the native persistence of Grok's media selection, moving from ephemeral DOM swaps to a persistent state model that survives page refreshes.

### 🏛️ Persistence Strategy
Selections made via the Gallery Mini-UI are captured and persisted using a **Linkage Chain** in IndexedDB:
- **Storage Target**: The `selectedVariantId` is stored within the `STORES.UNIFIED_VIDEO_HISTORY` entry for the associated `rootImageId`.
- **Native Context**: Research into Grok's network traffic identified the `selectedImageId` field in generation payloads. GVP mimics this by associating the user's preferred child ID with the generation family.
- **Persistence Store**: `IndexedDBManager.js` (Store: `unifiedVideoHistory`).

### 🛠️ Captured Interaction: `_makeThumbBtn` (GalleryMiniUIManager.js)
When the user clicks a thumbnail in the Mini-UI rails:
1.  **Immediate UI Swap**: Executes a DOM swap on the main gallery card (updating `src` for `<img>` or `video.src` for `<video>`, and clearing `srcset`).
2.  **State Save**: Calls `stateManager.savePersistentVariantSelection(rootId, variantId)`. This updates the `UNIFIED_VIDEO_HISTORY` entry for the root post.
3.  **Broadcast**: The change is broadcast via `gvp:idb-sync`, allowing other tabs to stay in sync.

### 🔍 Automated Restoration & Native Integration: `UIGalleryManager`
GVP ensures consistency across page refreshes and native Grok interactions through a **Reactive Restoration & Adoption** pattern:
1.  **DOM Monitoring**: A `MutationObserver` watches the gallery container (`role="list"`).
2.  **Card Identification**: As new cards (masonry items) land in the DOM, the observer extracts their UUID and resolves the `rootId`.
3.  **Silent Application**: If a persistent selection exists in IndexedDB/StateManager for that `rootId`, GVP immediately performs a "Silent Swap" of the card's media (Image or Video) before the user interacts with it.
4.  **Native Variant Tracking (v1.47.10)**:
    - **Adoption**: If the user selects a variant natively (via Grok's buttons), GVP's `MutationObserver` detects the `src` change, extracts the new variant ID, and automatically saves it as the new persistent selection.
    - **Revert-to-Original**: If GVP detects the user has natively reverted to the "Original" image, it calls `StateManager.clearPersistentVariantSelection(rootId)` to remove the override from the database.
5.  **UI Feedback**: When the Mini-UI is opened for a card with a saved preference, the corresponding thumbnail is automatically highlighted.



---

## 🌊 Lineage Resolution: "Absolute Root First"

The system ensures 100% lineage visibility by resolving the **Absolute Root ID** before performing UI population.

### Data Resolution Strategy 2 (Revised v1.45.4)
- **Principle**: In v1.45.4, Strategy 2 no longer performs an "Early Return" from IDB alone.
- **Rationale (Bug 9)**: IDB entries (populated via `/list`) are often partial snapshots. Relying on IDB alone leads to truncated lineages.
- **The Rule**: IDB is used for **Routing** (finding `absoluteRootId`). Once resolved, the system **always** invokes Strategy 3 (API Fallback) to fetch the definitive set from the root's `/post/get` response.

---

## 📺 Video Playback

### Player Integration
- **Fullscreen Media Player**: Custom playback modal for viewing generated videos.
- **Playlist Logic**: Integrated with UVH to suggest subsequent videos in a thread or folder.

### Autoplay Configuration
- **Autoplay Toggle**: Option to suppress noisy video autoplay in the gallery grid via CSS/`video.pause()` to avoid React DOM conflicts.
- **Hover-to-Play**: Optional behavior for video preview in the grid.

---

## 🔍 Media Identification: Recursive Node Resolution (v1.46.0)

To ensure "Quick Actions" and "Hover Mini-UI" work reliably across Grok's complex masonry layout, `content.js` employs a recursive identification strategy in `getMediaPathFromNode`.

### 1. The 'Element' Guard
Traversing the DOM from a click event or hover target frequently encounters **Text Nodes** or **Shadow Roots**.
- **Fix**: All traversals now use `instanceof Element` checks before calling `.matches()` or `.querySelector()`. This resolved recurring `TypeError: node.matches is not a function` bugs.

### 2. Recursive Search Strategy
If the target node is a masonry card container but not the direct `img`/`video` tag:
- **Descendant Scan**: The system performs a recursive search within the container to find the primary media element.
- **Overlay Support**: This allows Quick Actions to trigger even if the user clicks a transparent "Folder" overlay, a "Regenerate" button label, or whitespace within the card margin.

---

## 🐞 Critical Bug Resolutions

### Bug 8: Field Mismatch (v1.45.3)
- **Problem**: `hasLineage` checked `entry.images` but IDB stores `entry.editedImages`.
- **Fix**: Standardized to `entry.editedImages || entry.images`.

### Bug 9: Partial IDB Snapshots (v1.45.4)
- **Problem**: IDB early-return if siblings found.
- **Fix**: Use **'IDB for Routing, API for Content'**. IDB finds the root; API finds the truth.

---

## 🛡️ v1.45.7 Sanitization
In v1.45.7, a comprehensive sweep was performed on `GalleryMiniUIManager.js` to strip legacy debug logs (`console.log`) related to rail population and scroll calculations, moving strictly to `window.Logger`.

---

## 🏛️ Absolute Root Lineage Strategy (System 14 Integration)

The system ensures 100% lineage visibility by resolving the **Absolute Root ID** before performing UI population.

### Data Flow Pattern: "IDB for Routing, API for Content" (v1.45.4)
In v1.45.4, the system shifted from trusting IDB snapshots to a "Hybrid Verification" model.

1.  **IDB used for Routing**: Fast local lookup (via `_getAbsoluteRootId`) identifies the candidate `absoluteRootId`.
2.  **API used for Content**: The system **always** invokes Strategy 3 (API Fallback) to fetch the definitive and complete sibling set from the root's `/post/get` response.
3.  **Rationale (Bug 9)**: IDB is populated from `/list` batches, which are often partial snapshots. Relying on IDB alone often leads to truncated lineages (missing cousins from different batches).

### 🌊 Recursive Root Chase Algorithm (`_getAbsoluteRootId`)
Calling the `/get` API on a child post (edit or video) returns a `post` object that **only** contains its own direct descendants, missing its ancestors and siblings. The `_getAbsoluteRootId` method bridges this gap using an interleaved recursive chase.

#### Phase A: UVH Check
Interrogates the `UnifiedHistory` in memory for `originalPostId`.

#### Phase B: parentIndex match
Check `parentIndex` via `idb.resolveRoot`. This serves as the fallback/bridge for grandchildren where the intermediate parent entry might be missing from UVH.

#### 🧬 Sibling Saliency Propagation: `_writeBackParentPairs`
After a successful API fetch, the `_writeBackParentPairs` method maps **all** members of the generation family tree (siblings and ancestors) to the absolute root in the `parentIndex`. This transforms $O(N)$ recursive chase into an $O(1)$ direct lookup for **every** member of the family tree once a single member has successfully resolved.

---

## 🔍 Media & Target Identification: Recursive Node Resolution (v1.46.5)

To ensure "Quick Actions" and "Hover Mini-UI" work reliably across Grok's complex masonry layout, GVP employs an aggressive recursive identification strategy.

### 1. The 'Element' Guard
Traversing the DOM from a click event or hover target frequently encounters **Text Nodes** or **Shadow Roots**.
- **Fix**: All traversals now use `instanceof Element` checks before calling `.matches()` or `.querySelector()`. This resolved recurring `TypeError: node.matches is not a function` bugs in `getMediaPathFromNode`.

### 2. Recursive Search Strategy (Aggressive)
If the target node is a masonry card container but not the direct `img`/`video` tag:
- **Descendant Scan**: If `candidates.length === 0` but the node matches a known card container, the system performs a `querySelectorAll('img, video')` scan.
- **Overlay Support**: This allows Quick Actions and Mini-UI triggers to work even if the user clicks a transparent glass-morphic overlay, a "Folders" icon, or a native Grok button margin.

### 3. 'data:image' Gallery Bypass
For Quick Raw/JSON actions on gallery pages, the resolver accepts base64 `data:image` URLs directly as the asset "path." Since these modes do not require a canonical server-side ID to initiate the generation process, this bypass ensures instant responsiveness for local/unsaved thumbnails.

---

## ⌨️ Activation & Input Guards

### 1. The Mini-UI Shortcut ('Z' Key)
- **Toggle Mode**: Sequential 'Z' presses on the same card will open, then close the UI.
- **Root ID Check**: Triggers using the `data-gvp-root-id` attribute injected by the `IntersectionObserver` scanner for O(1) activation.

### 2. Typing Context Protection (`_isTypingContext`)
A critical bug (v1.46.5) caused the shortcut to fail after the first activation, with later presses typing "zzzz" into the prompt box.
- **Root Cause**: The typing guard detected `document.activeElement` as a layout container or accessibility node during SPA navigation, classifying it as an "input context."
- **Refinement (v1.46.6)**: Identified "Sticky Focus" where focus remains on the generator prompt box after an interaction, blocking the shortcut.
- **Hover-Priority Logic (v1.46.8)**: Refined `_isTypingContext` to return `false` if `hoveredImageId` is active. This ensures the 'Z' shortcut takes precedence over the active input field when the user's mouse confirms their intent is gallery exploration, even if "Sticky Focus" (from a previous interaction with the prompt box) is present.
- **Event Propagation**: Added `e.preventDefault()` and `e.stopImmediatePropagation()` to the 'Z' keydown handler when a card is hovered to prevent the 'z' character from leaking into the prompt box.
- **Mini-UI Rail Interaction**: To prevent the hover state from being cleared when the mouse moves from a card onto the Mini-UI buttons (the Rail), a guard was added to `_handleMouseOver`. This guard returns early if the event target is within `#gvp-gallery-rails`, preserving the `hoveredImageId` and ensuring the 'Z' shortcut remains functional for closing the UI.
- **Specific Checks**:
    - Standard input tags: `input`, `textarea`, `select`.
    - `contenteditable="true"` (ProseMirror/TipTap).
    - `isContentEditable` property.
    - **Exclusion**: Generic focus on the body or masonry containers no longer blocks the shortcut.

---

## 🔄 Multi-Tab Synchronization (v1.46.16 Fixes)
The Gallery system is integrated with the `BroadcastChannel` sync engine to maintain real-time UI consistency across tabs.
- **Event Bus**: Subscribes to the global `gvp:idb-sync` `CustomEvent` (emitted by `IndexedDBManager` via `BroadcastChannel`).
- **Trigger**: When `gvp:idb-sync` is received, `GalleryMiniUIManager` (and `UIGalleryManager`) inspects the event payload.
- **Payload Mapping**: Reads `event.detail` which contains `{ type, storeName, data }`.
- **Action**: If the `storeName` matches `unifiedVideoHistory`, the manager performs a **Targeted Refresh**:
    - **Relevance Check**: Extracts the `affectedId` (the image updated in another tab) and resolves its absolute root via `idb.resolveRoot(affectedId)`.
    - **Lineage Verification**: Compares the `affectedRootId` against the **`this._currentAbsoluteRootId`** (cached during the last `_resolveData` call). This property acts as a "lineage token," allowing for $O(1)$ relevance evaluation without re-triggering recursive lineage chases in the synchronization hot-path.
    - **Execution**: A re-fetch/re-render is **only** triggered if `affectedId === this.currentImageId` OR the root IDs match. This prevents background generations from causing jittery UI refreshes in unrelated open gallery panels.
- **View Identity Guard (v1.47.2)**: To prevent state leakage during rapid image switching, three identity markers are captured before linege refreshes: `capturedRootId`, `capturedImageId`, and `capturedRootEl`. After the asynchronous data fetch, all three must still match the active UI state for the refresh to proceed.
- **Benefit**: Ensures that editing a video name or prompt in Tab A is immediately reflected in the open Rail of Tab B, without taxing the system for unrelated updates.


---

## 🔬 March 2026 UI Forensics
The March 2026 update introduced the `group/media-post-masonry-card` pattern and glass-morphic overlays.
- **Selector Shift**: `media-post-masonry-card` -> `group/media-post-masonry-card`
- **Pointer Events**: Card uses `pointer-events-auto`, children often use `pointer-events-none`.
- **Z-Index Layering**: Native Grok buttons are layered inside the card, requiring the recursive crawler to reach the container boundary.

---

## References
- Implementation: `src/content/managers/ui/UIGalleryManager.js`, `src/content/managers/ui/GalleryMiniUIManager.js`
- Architecture: `architecture/lineage_resolution_architecture.md` (Consolidated)
- Research: `research/grok_ui_forensics_march2026.md` (Consolidated)
- Conversation ID: `51b1676a-fd6c-40c7-8d70-47124cacb440`
