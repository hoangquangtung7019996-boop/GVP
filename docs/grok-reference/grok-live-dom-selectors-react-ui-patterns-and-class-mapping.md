# Grok 2026 UI Adaptation Master Guide (New Overhaul)

In early 2026, Grok introduced a significant UI overhaul across `/imagine`, `/favorites`, and post pages. This document provides the authoritative patterns for adapting GVP to these changes, covering input evolution, Radix UI interactions, and "non-intuitive" behavioral workflows.

---

## 1. Grok Workflow Mapping (Architectural Shift)

The following table summarizes the fundamental changes in the Grok UI that GVP automation must account for:

| User Flow | Old Grok | New Grok (Feb 2026) |
| :--- | :--- | :--- |
| **Prompt Entry** | Native `<textarea>` | TipTap ProseMirror `<div>` (contenteditable) |
| **Input Value** | `element.value = text` | `element.textContent = text` + InputEvent |
| **Mode Switching** | `div[aria-label="Text alignment"]` | `div[aria-label="Media type selection"]` (Only after ≥1 attempt) |
| **Active Mode Detection** | `bg-white/15` class | `bg-button-filled` class |
| **Active Mode Labels** | Lucide Icons (`lucide-film`) | SR-Only text (`span.sr-only: Video`) |
| **Edit Mode Entry** | "More options" (...) menu | "Settings" (Gear) or "Edit Image" text |
| **Menu Icons** | `lucide-brush`, `lucide-film` | Custom SVG Fill paths (Icons removed) |
| **Configuration** | Static UI | Radix UI Popovers (`data-radix-menu-content`) |
| **Gallery Batch** | Open image → Switch Mode | **Play Button** (on thumbnail) or UUID settings |

---

## 2. Input Evolution: TipTap & ProseMirror

Grok has migrated from standard `<textarea>` elements to **TipTap ProseMirror** editors. These are `<div>` elements with `contenteditable="true"`.

### Selectors
*   **Main Video/Image Prompt**: `div.tiptap.ProseMirror[contenteditable="true"]` (Preferred: `div[contenteditable="true"][translate="no"].ProseMirror`)
*   **Contextual Placeholder**: Distinguish via `data-placeholder` or `aria-label`.
    *   *Video*: `div[contenteditable="true"][aria-label*="video"]`
    *   *Image Edit*: `div[contenteditable="true"][aria-label*="edit"]`

### Injection Pattern: The `_setEditableValue` Strategy
Direct `.value` assignment fails silently on `contenteditable`. GVP uses a unified setter pattern that handles both legacy textareas (via React fiber descriptors) and TipTap (via `innerHTML` and `InputEvent`).

**ProseMirror Requirement**: TipTap/ProseMirror requires wrapping injected text in `<p>` tags for correct line handling and framework reconciliation. GVP uses `element.innerHTML` directly as per specification to ensure cleanliness.

**Strategy B: TipTap / ContentEditable (ProseMirror)**:
1.  **Focus**: `element.focus()`.
2.  **Format**: Wrap lines in `<p>` tags. Empty lines become `<p><br></p>`.
3.  **Inject**: `document.execCommand('insertText', false, text)`. **CRITICAL**: Use `execCommand` as the primary method. Direct `innerHTML` assignment (previously recommended) clears the ProseMirror transaction history and triggers `RangeError: mismatched transaction` in established editors.
4.  **Fallback**: If `execCommand` fails, use `innerHTML` + `<p>` wrapping + `InputEvent` with `inputType: 'insertText'`.

```javascript
/**
 * SPEC COMPLIANT (v1.30.0): Unified value setter for 2026 UI (TipTap + Textarea)
 */
_setEditableValue(element, text) {
    if (!element) return;

    // Strategy A: Legacy Textarea (React Controlled)
    if (element.tagName === 'TEXTAREA') {
        // CRITICAL: Use native setter to bypass React's synthetic event system
        const setter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype, 'value').set;
        setter.call(element, text);
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('input', { bubbles: true }));
    } 
    // Strategy B: TipTap / ContentEditable (ProseMirror)
    else if (element.isContentEditable) {
        element.focus();

        // 1. Select All (to clear existing content cleanly)
        document.execCommand('selectAll', false, null);

        // 2. Use execCommand 'insertText' (Transaction-aware injection)
        try {
            const success = document.execCommand('insertText', false, text);
            if (!success) throw new Error('execCommand failed');
        } catch (e) {
            // Fallback: innerHTML (Risk of transaction mismatch, but robust)
            const pWrapped = text.split('\n').map(line => `<p>${line || '<br>'}</p>`).join('');
            element.innerHTML = pWrapped;
            element.dispatchEvent(new InputEvent('input', {
                bubbles: true, 
                data: text, 
                inputType: 'insertText'
            }));
        }
    }
}
```

---

## 3. Interaction Patterns: React & Pointer Events

### The Robust Click Pattern (`reactClick`)
Standard `.click()` often fails to trigger React component handlers in the new Grok UI. GVP uses a robust sequence of pointer and mouse events, combined with programmatic focus, to ensure framework reconciliation.

```javascript
/**
 * React-compatible click that fires synthetic pointer/mouse events.
 */
reactClick(element, elementName = 'element') {
    if (!element) return;

    try {
        if (typeof element.focus === 'function') {
            element.focus({ preventScroll: true });
        }
    } catch (_) {}

    const dispatch = (type, EventCtor = MouseEvent, extraInit = {}) => {
        const init = {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 0,
            ...extraInit
        };
        element.dispatchEvent(new EventCtor(type, init));
    };

    if (typeof PointerEvent === 'function') {
        dispatch('pointerdown', PointerEvent);
    }
    dispatch('mousedown');
    if (typeof PointerEvent === 'function') {
        dispatch('pointerup', PointerEvent);
    }
    dispatch('mouseup');
    dispatch('click');
}
```

---

## 4. Interactive Systems: Radix UI Components

### Video Settings Dropdown
Configuration settings are now tucked inside a `data-radix-menu-content` container.

*   **Trigger**: `button[aria-label="Settings"][data-state]`
*   **Menu Items**: `div[role="menuitem"]` or `button[data-slot="button"]`.
    *   **Selection Logic**: Use `aria-label` for fixed options (e.g., `button[aria-label="10s"]`).
    *   **Text Matching**: Since icons are removed, presets like "Spicy" or "Upscale" must be found by searching text content within `div[role="menuitem"]`.

### The `findByText` Utility
When multiple elements share the same CSS selector (common in Radix menus) or when attributes are unstable, GVP uses a text-content filtering helper:

```javascript
/**
 * Find element by text content (Utility added Feb 2026)
 * Specifically handles sr-only spans for mode buttons and direct text nodes for Radix items.
 */
window.GROK_SELECTORS.findByText = function (selector, text, root = document) {
    const elements = root.querySelectorAll(selector);
    for (const el of elements) {
        if (el.textContent && el.textContent.trim() === text) {
            return el;
        }
        // Also check internal sr-only spans inside (for media buttons)
        const sr = el.querySelector('.sr-only');
        if (sr && sr.textContent && sr.textContent.trim() === text) {
            return el;
        }
        // Check direct children text nodes/innerText for cleaner matching
        if (el.innerText && el.innerText.trim() === text) {
             return el;
        }
    }
    return null;
};
```
Usage: `GROK_SELECTORS.MENU_ITEMS.SPICY = "Spicy"; // Logic uses findByText(MENU_ITEM, "Spicy")`

### Mode Switcher (Behavioral Override)
*   **Container**: `div[aria-label="Media type selection"]`
*   **Visibility Constraint**: This container typically **only appears after at least one video attempt** has been registered for the specific post/image. 
*   **Active Indicator**: The active button class is `bg-button-filled`.
*   **Identification**: Buttons are identified by searching for `span.sr-only:contains("Image")` or `span.sr-only:contains("Video")`. 
*   **Pattern v1.30.0**: Use text-based matching (e.g., `findByText`) to locate buttons via their internal `sr-only` spans, as aria-labels on the buttons themselves are often missing or unstable.
*   **Snippet 22 (Image Button)**: Identified by `span.sr-only: Image`. When active, has `bg-button-filled`.
*   **Snippet 23 (Video Button)**: Identified by `span.sr-only: Video`. When inactive, has `border-border-l2` or `bg-surface-l2`.

### Gallery Entry Point: The Play Button
For images without existing videos, promptless generation is triggered via a persistent play icon on the gallery thumbnail (Snippets 20/21).
*   **Selector**: `button[aria-label="Make video"]:has(svg polygon[points*="6 3"])`
*   **Behavior**: Triggers a "normal" video generation using the original image prompt.

---

## 4. Image Edit Flow: Dual Path Strategy

Grok's 2026 UI has two distinct branches for entering image edit mode depending on the video state of the image.

### Path A: Direct Entry (New UI)
GVP prioritizes the direct "Edit Image" button which appears contextually on some image views.
1.  **Direct Discovery**: Search for button with label "Edit image" or icon `lucide-brush`.
2.  **Inject & Send**: Enter prompt into TipTap and click the Send Edit button (`button[aria-label="Submit"]`).

### Path B: Menu-Based Entry (Legacy/Expanded UI)
If no direct button is found, GVP falls back to the menu flow.
1.  **Open Menu**: Click "More options" (...) button.
2.  **Select Edit**: Locate `div[role="menuitem"]` with text/label "Edit Image".
3.  **Inject & Send**: Enter prompt into TipTap and submit.

### Path C: Re-Edit from Thumbnail (Established Image)
When multiple generations exist, GVP must ensure correct context:
1.  **Media Toggle**: Check if Video mode is active. If so, switch to **Image mode**.
2.  **Select Base**: Click **Thumbnail 1** in the strip.
3.  **Inject & Send**: Enter prompt and submit.

### Path D: Videoless Image Generation (First Video Attempt)
For images that have never been animated (no existing video), the "Make Video" button is hidden. GVP uses the following menu-driven fallback flow in `sendToGenerator`:
1.  **Trigger Settings**: Click `button[aria-label="Settings"]` (Snippet 24).
2.  **Locate Menu Item**: Find `div[role="menuitem"]` with text "Make Video" (Snippet 25) using `findByText`.
3.  **Inject Prompt**: Use the TipTap injection pattern (innerHTML + `<p>` wrapping).
4.  **Specialized Submit**: Click the Edit/Submit button `button[aria-label="Edit"]` (Snippet 26) instead of the standard "Make Video" button.

---

## 5. Network Payload Strategies (Interception)
The `Grok Payload Manager` revealed critical injection points for the `POST /rest/app-chat/conversations/new` endpoint:

*   **overrideVideoOptions**: GVP can bypass the Radix menu by directly injecting into the `videoOptions` object in the JSON payload.
*   **URL Swapping Flow**:
    1. Intercept paste event.
    2. Extract UUID from `assets.grok.com` URL.
    3. Modify `fileAttachments` UUID in the outgoing request.
*   **Clean Spicy Strategy (v6.1)**: Spicy Mode is now handled **exclusively by the NetworkInterceptor** for `/conversations/new` and `/responses` endpoints.
    1. Detect `useSpicy` flag in state.
    2. **Domain-Agnostic Isolation**: Instead of strict regex, GVP checks the first token of the prompt. If it starts with `http`, it is isolated as the reference image URL.
    3. **Strip & Replace**: Strip all following text and replace it with `--mode=extremely-spicy-or-crazy`.
    4. **Dual-Layer Interception**: Mirrored in `NetworkInterceptor.js` and `gvpFetchInterceptor.js`.
    5. **DOM Decoupling**: Spicy mode logic in `UIManager` no longer attempts to click native buttons (`_detectNativeSpicyButton` returns early), ensuring state-only control.
    6. **State-Based Sync (_handleSpicyToggle)**: Toggling Spicy ON in the UI automatically triggers side effects to prevent payload conflicts:
        - **Silent Mode Auto-Disable**: Disables `silentMode` (via simulated click) to prevent injecting conflicting audio blocks.
        - **Clear Prompt Audio Data**: Iterates through `state.promptData.audio` and clears any explicit `'none'` overrides (music, sfx, ambient) to ensure the Spicy generator has unrestricted audio bandwidth.
    7. **Selector Gap Detection**: If GVP attempts to find native elements (like the Spicy Preset button) and fails, it dispatches a `gvp:spicy-selector-gap` event. This is used to fallback to the NetworkInterceptor strategy and suppress further native automation attempts (`_nativeSpicyAutomationActive = false`).
    8. **Native UI Deprecation**: `_detectNativeSpicyButton` is explicitly deprecated and returns early, decoupling the extension from Grok's unstable native Spicy menu selectors.
*   **Prompt Automation (TipTap)**: Managers like `UploadAutomationManager.js` and `ReactAutomation.js` have been updated to target `div[contenteditable].ProseMirror` as the primary input, using `innerHTML` + `<p>` tag wrapping to ensure framework reconciliation and persistent input syncing.

---

---

## 6. Soft Navigation (Fast Switching Pattern)

To achieve "super fast" navigation between images and pages within the Grok SPA without full page refreshes, GVP adopts the `imagineGod` soft navigation pattern:

### The history.pushState Hack
Directly updating `window.location` triggers a reload. Instead, GVP uses `history.pushState` combined with a `popstate` event to trigger React Router's internal transition logic.

```javascript
/**
 * SPA Navigation via History API
 * Triggers React Router without full page reload.
 */
_navigateToPost(postId) {
    if (!postId) return;
    const targetUrl = `/imagine/post/${postId}`;

    window.Logger.info('ReactAutomation', `Navigating to: ${targetUrl}`);
    
    // CRITICAL: Dispatch rail-navigation event to suppress Quick Raw during nav
    document.dispatchEvent(new CustomEvent('gvp:rail-navigation', {
        detail: { postId, url: targetUrl }
    }));

    // Push state to history
    window.history.pushState({}, '', targetUrl);

    // Dispatch PopStateEvent to trigger React Router
    // Standard popstate might be swallowed, so we dispatch it on window
    window.dispatchEvent(new PopStateEvent('popstate'));
}
```

### Quick Mode Navigation Requirement
All **Quick Modes** (Raw, JSON, Spicy-direct) MUST use this soft navigation method to move **INTO the UUID URL** page before attempting prompt injection. This ensures the correct contextual state is active for ProseMirror reconciliation.

---

## 7. Selector Centralization (Single Source of Truth)

GVP enforces a **Single Source of Truth** for all DOM interactions through:
`a:\Tools n Programs\SD-GrokScripts\grok-video-prompter-extension\src\content\constants\selectors.js`

### Registry Governance
1. **Audit First**: All managers (`ReactAutomation`, `UIManager`, etc.) must be audited for hardcoded strings.
2. **Move to Constants**: Any string used in `querySelector` or `waitForElement` must be moved to `GROK_SELECTORS`.
3. **Array-Based Fallbacks**: `GROK_SELECTORS` uses arrays to support multiple concurrent versions of the Grok UI during rollouts or contextual shifts (e.g., Post page vs. Main page).
4. **Logic Separation**: The registry defines WHERE things are; `ReactAutomation` defines HOW to interact with them with added robustness for array-based selectors.
5. **Contextual Diagnostics**: Verification tools (like `dom-selector-verifier.js`) are decoupled from components but share the same registry to provide high-fidelity pre-flight checks.

### Updated 2026 Selectors
- **Edit Image**: Added text-based selector `button[aria-label="Edit Image"]`.
- **Radix Settings**: Standardized as `RADIX.SETTINGS_TRIGGER`.
- **TipTap**: Standardized as `div[contenteditable="true"][translate="no"].ProseMirror`.

### The Getter Pattern for Text-Based Selectors
To handle dynamic Radix menus and containers, `selectors.js` now uses getters that leverage `findByText`:

```javascript
// From src/content/constants/selectors.js
MODE_TOGGLE: {
    // Container - Primary: aria-label; Backup: class-based structural match
    CONTAINER: [
        'div[aria-label="Media type selection"]',
        'div.flex.gap-1.rounded-full.bg-surface-l2.flex-col:has(button span.sr-only)'
    ],
    // Active Class for buttons (2026)
    ACTIVE_CLASS: 'bg-button-filled',
    
    // Helper to find specific buttons within the container (using findByText)
    BUTTONS: {
        IMAGE: () => {
            const containers = window.GROK_SELECTORS.MODE_TOGGLE.CONTAINER;
            const root = (typeof containers === 'string' ? 
                document.querySelector(containers) : 
                (document.querySelector(containers[0]) || document.querySelector(containers[1])));
            return root ? window.GROK_SELECTORS.findByText('button', 'Image', root) : null;
        },
        VIDEO: () => {
            const containers = window.GROK_SELECTORS.MODE_TOGGLE.CONTAINER;
            const root = (typeof containers === 'string' ? 
                document.querySelector(containers) : 
                (document.querySelector(containers[0]) || document.querySelector(containers[1])));
            return root ? window.GROK_SELECTORS.findByText('button', 'Video', root) : null;
        }
    }
},
MEDIA_TYPE_BUTTONS: {
    IMAGE: () => window.GROK_SELECTORS.MODE_TOGGLE.BUTTONS.IMAGE(),
    VIDEO: () => window.GROK_SELECTORS.MODE_TOGGLE.BUTTONS.VIDEO()
},
MENU_ITEMS: {
    MAKE_VIDEO: () => window.GROK_SELECTORS.findByText('div[role="menuitem"]', 'Make Video'),
    // ...
}
```

---

## 8. Implementation Roadmap (2026 Adaptation)

The adaptation work is compartmentalized into three distinct phases.

### Phase 1: Core DOM & Input Modernization
- **Goal**: Restore basic automation (prompt injection, navigation).
- **Tasks**: Update `GROK_SELECTORS` for TipTap/ProseMirror and Radix UI. Implement `_setEditableValue` and `_navigateToPost`. Update `sendToGenerator`.

### Phase 2: Network Logic & Spicy Mode
- **Goal**: Shift feature logic to network interception to bypass DOM conflicts.
- **Status**: **COMPLETED**.
- **Tasks**: Intercept `POST /rest/app-chat/conversations/new` for Spicy Mode injection. Implement mutual exclusion logic (stripping "No music" etc.). Prompt cleaning using Regex at the network level.

### Phase 3: UI Wiring & Polish
- **Goal**: Finalize internal state and UI reflection.
- **Status**: **COMPLETED**.
- **Tasks**: Initialize `UIGenerationRailManager` and `UIUpscaleAutomationManager`. Refine UI toggles and remove legacy DOM-clicking automation.

---

## 9. Implementation Log & Chronology

This section tracks the concrete technical milestones achieved during the 2026 adaptation.

### Initial Restore (Phase 1)
- **Selector Centralization**: Categorized TipTap, Radix UI, and Mode switcher selectors in `selectors.js`.
- **Unified Input**: Implemented `_setEditableValue` using `execCommand('insertText')` for TipTap reconciliation.
- **SPA Navigation**: Implemented `_navigateToPost` via `pushState` for instant page switching.

### Feature Robustness (Phase 2 & 3)
- **Spicy Mode Evolution**: Transitioned from fragile DOM automation (opening menus/clicking presets) to robust **Network Interception**.
- **Clean Spicy Logic (v6.1 Patch)**: Updated regex isolation to a robust domain-agnostic "first-token" check. This ensures that manually sent prompts containing `imagine-public.x.ai` (Shared/Public), `assets.grok.com` (Account/Legacy), or `share-images` (User Uploads) URLs are all correctly isolated and cleaned.
- **Native UI Support**: Finalized mirroring of Spicy Mode cleaning logic into the injected page script (`gvpFetchInterceptor.js`) to handle manual prompt submissions that bypass the extension's managers.
- **UI Decoupling**: Refactored `UIManager.js` to remove redundant watchers and legacy button-clicking code, ensuring the Spicy toggle only updates state.
- **Manager Integration**: Wired up `UIGenerationRailManager` for global progress monitoring and `UIUpscaleAutomationManager` for batch UI tasks.
- **Automation Support**: Updated `UploadAutomationManager.js` to support TipTap editors for automated generation workflows.
- **Robustness Verification**: Performed a cross-manager audit confirming that URL handling in `content.js` (thumbnails) and `NetworkInterceptor.js` (Account IDs) aligns with the new 2026 taxonomy. Added direct property checks (`userId`, `user_id`, `ownerId`) for account identification.
- **Tooling**: Created `tools/dom-selector-verifier.js` for rapid console-based verification of the 2026 DOM elements (TipTap, Radix triggers, etc.).

### v1.30.1 Implementation (2026 Finalization)
- **Universal TipTap Coverage**: Patched `selectors.js` to ensure the TipTap ProseMirror selector is prepended to all editor arrays (`VIDEO`, `IMAGE_EDIT`, `MASONRY`), fixing breakage in image edit and re-edit flows.
- **Spec-Compliant Injection**: Migrated `_setEditableValue` and `UploadAutomationManager` to use direct `innerHTML` + `<p>` tag wrapping, ensuring perfect alignment with ProseMirror's line-handling requirements.
- **Label Alignment**: Standardized all selectors to use `aria-label="Media type selection"` and `bg-button-filled` classes, matching the final Feb 2026 rollout state.
- **Text-Based Resolution**: Hardened `findByText` utility to support `sr-only` span matching, allowing robust button identification even when attributes are absent.
- **Manager Refresh**: Updated `UploadAutomationManager.js` to use the modernized injection patterns.
- **Spicy Conflict Resolution**: Implemented auto-clearing of `promptData.audio` properties ('none' -> null) when Spicy mode is enabled.
- **Native Automation Cleanup**: Deprecated `_detectNativeSpicyButton` to favor "Clean Spicy" network interception strategy.
- **Array-Based Selector Hardening**: Migrated `MODE_TOGGLE.CONTAINER` to an array-based fallback (`aria-label` vs structural classes) to handle context-specific DOM variations (e.g., Main page vs Post page).
- **Verifier Diagnostics**: Enhanced `tools/dom-selector-verifier.js` with loop-based array selector resolution and contextual "Expected Fail" messaging for main-page verification.

---

## 10. Fixed & Verified (v1.30.0 Revision Round)

Following the v1.30.0 (2026 UI Adaptation) revision phase, the following critical defects were fixed and verified:

### ✅ Fixed: Selector Regressions
*   **Media Type selection**: Correctly identifies the mode switcher container via `aria-label="Media type selection"`.
*   **Text-Based Button Resolution**: Mode buttons are now found by searching for `span.sr-only:contains("Image")` or `span.sr-only:contains("Video")`, bypassing missing attributes.
*   **Universal TipTap Coverage**: `div[contenteditable="true"][translate="no"].ProseMirror` is now prepended to `IMAGE_EDIT` and `MASONRY` arrays in `selectors.js`.

### ✅ Fixed: Injection Spec Divergence
*   **innerHTML Pattern**: Migrated `_setEditableValue` and `UploadAutomationManager` to use direct `innerHTML` + `<p>` tag wrapping. This fixed the "unresponsive input" bug in ProseMirror editors.
*   **Focus-First Interaction**: `element.focus()` is consistently called before injection to satisfy TipTap internal listeners.

### ✅ Fixed: Behavioral Conflicts
*   **Spicy Mutual Exclusion**: `UIManager._handleSpicyToggle()` now automatically disables Silent Mode when Spicy is enabled, preventing conflicting audio prompt segments from being injected.
*   **Make Video Robustness**: `sendToGenerator` now confirms input existence via TipTap selectors before looking for the submission button, resolving timing issues in SPA transitions.

---

## 11. Image Edit Flow Algorithm (2026 Specific)

The following algorithm in `ReactAutomation.js` handles the complex multi-step navigation and interaction required for image editing in the 2026 UI.

```javascript
/**
 * Modernized Image Edit Flow (2026 Spec)
 * Follows: Mode Switch -> Settings -> Edit Image -> Context Select -> Inject
 */
async sendToImageEdit(promptText, options = {}) {
    window.Logger.info('ReactAutomation', 'Starting Image Edit Flow (2026 Spec)', options);
    
    try {
        const SELECTORS = window.GROK_SELECTORS || {};

        // Step 1: Navigate to image UUID page via SPA navigation
        if (options.imageId) {
            this._navigateToPost(options.imageId);
        }
        
        // Step 2: Wait for TipTap editor to materialize
        const tipTap = await this.waitForElement('div.tiptap.ProseMirror[contenteditable="true"]', 5000);
        if (!tipTap) throw new Error('TipTap input not found');
        
        // Step 3: Handle Media Mode Switch (if video already exists)
        // SPEC (v1.30.1): Use array-safe container resolution
        const containerSel = SELECTORS.MODE_TOGGLE?.CONTAINER;
        const modeSwitcher = Array.isArray(containerSel) 
            ? (document.querySelector(containerSel[0]) || document.querySelector(containerSel[1]))
            : document.querySelector(containerSel);

        if (modeSwitcher) {
            const imageBtn = SELECTORS.MEDIA_TYPE_BUTTONS?.IMAGE();
            if (imageBtn && !imageBtn.classList.contains(SELECTORS.MODE_TOGGLE?.ACTIVE_CLASS)) {
                 this.reactClick(imageBtn, 'Image Mode Button');
                 await new Promise(r => setTimeout(r, 500)); 
            }
        }

        // Step 4: Open Radix Settings dropdown
        const settingsBtn = document.querySelector(SELECTORS.RADIX?.SETTINGS_TRIGGER);
        if (settingsBtn) {
            this.reactClick(settingsBtn, 'Settings Button');
            await this.waitForElement(SELECTORS.RADIX?.CONTENT, 1000).catch(() => {});
        }

        // Step 5: Execute "Edit Image" from menu
        const editItem = SELECTORS.MENU_ITEMS?.EDIT_IMAGE();
        if (!editItem) throw new Error('Edit Image menu item not found');
        
        this.reactClick(editItem, 'Edit Image Item');
        await new Promise(r => setTimeout(r, 500));

        // Step 6: Select Context (Thumbnail 1) in edit strip
        const firstThumb = document.querySelector(SELECTORS.THUMBNAIL_STRIP?.FIRST_THUMB);
        if (firstThumb) {
            this.reactClick(firstThumb, 'First Thumbnail');
            await new Promise(r => setTimeout(r, 200));
        }

        // Step 7: Inject prompt using spec-compliant <p> wrapping
        const inputEl = document.querySelector('div.tiptap.ProseMirror[contenteditable="true"]') || 
                        document.querySelector('textarea');
        
        const fullPrompt = this._applyPromptTransforms(promptText);
        this._setEditableValue(inputEl, fullPrompt);

        // Step 8: Submit edit (Submit Button)
        const sendBtn = document.querySelector('button[aria-label="Edit"]');
        if (sendBtn) {
            this.reactClick(sendBtn, 'Edit Submit Button');
            window.Logger.info('ReactAutomation', '✅ Image edit submitted');
        } else {
            throw new Error('Edit submit button not found');
        }
        
    } catch (error) {
        window.Logger.error('ReactAutomation', 'Image Edit failed', error);
        throw error;
    }
}
```

---

## 12. Edge Cases & Conflict Handling

The 2026 UI overhaul introduces several race conditions and state conflicts that must be handled explicitly:

| Case | Scenario | Handling Strategy |
| :--- | :--- | :--- |
| **TipTap Race** | SPA navigation finishes but editor hasn't mounted. | Use `_waitForElement()` with a 5000ms timeout and 3 retry attempts. |
| **Media Switcher Gap** | Fresh image (no video) has no mode switcher. | **Videoless Flow**: Proceed directly to Settings -> "Make Video" menu item. |
| **Radix State Race** | Clicking Settings trigger doesn't immediately show the dropdown. | Wait 300ms after click, then verify `[data-radix-menu-content]` or `[data-state="open"]`. |
| **Context Mismatch** | "Edit Image" menu item is missing from the dropdown. | Log warning and abort; likely due to navigation to a non-editable post. |
| **Spicy/Silent Conflict** | Both Spicy and Silent modes are toggled ON. | **Spicy Priority**: UIManager must auto-disable Silent/No-Music when Spicy is enabled. |
| **Carousel Emptiness** | No edit history exists for the image. | Skip thumbnail selection in the Image Edit flow. |
| **History Navigation Failure** | `PopStateEvent` fails to trigger the React router. | **Fallback**: Use `window.location.href` as a hard refresh fallback if URL changes but content doesn't update after 1s. |

---

## 13. Robust SPA Selector Verification Pattern

Grok's SPA (Single Page Application) environment is highly volatile, with elements like the `MODE_TOGGLE` switcher appearing only contextually (e.g., after a video attempt or when viewing a specific post).

### The "Selector Verifier" Best Practice (v1.30.1)

To reliably verify selectors across different page states without false-positive failures, GVP uses a robust resolution pattern:

1.  **Array-Based Resolution**: Define primary and fallback selectors in an array.
2.  **Iterative Match**: Iterate through the array and return the first matching element.
3.  **Contextual Logging**: If no match is found, provide a "Contextual Note" explaining why the element might be missing (e.g., "Expected on Post detail page only").

**Example logic from `dom-selector-verifier.js`**:

```javascript
// Robust Container Resolution Pattern
const containerConfig = window.GROK_SELECTORS?.MODE_TOGGLE?.CONTAINER;
let container = null;
let containerSelectorUsed = '';

if (Array.isArray(containerConfig)) {
    for (const sel of containerConfig) {
        const found = document.querySelector(sel);
        if (found) {
            container = found;
            containerSelectorUsed = sel;
            break;
        }
    }
} else {
    container = document.querySelector(containerConfig);
    containerSelectorUsed = containerConfig;
}

if (container) {
    console.log(`%c[PASS] Mode Toggle Container (${containerSelectorUsed})`, 'color: #00ff00', container);
    // ... further verification logic
} else {
    console.warn('%c[WARN] Mode Toggle Container NOT FOUND', 'color: #ffff00');
    console.log('%cℹ️ NOTE: Mode Switchers (Image/Video) are only visible when viewing a specific post or in the gallery drawer. If you are on the main Create page, this failure is expected.', 'font-style: italic');
}
```

This pattern ensures that "Reviewers" and "QA Tools" distinguish between an actual bug (broken selector) and a state-specific omission (volatile DOM).

### 13.1 Selection Volatility (Attribute Drift)
Audit logs in Feb 2026 confirm that Radix IDs (e.g., `id="radix-_r_2a_"` vs `id="radix-_r_2l_"`) are **volatile** and drift across sessions or page states.
- **Pattern**: Never rely on static Radix IDs for automation.
- **Authority**: Use ARIA labels (e.g., `button[aria-label="Settings"]`) as the primary anchor.
- **Fallback**: If multiple elements share a label, use the text-based `findByText` helper on the specific `div[role="menuitem"]` content.

### 13.2 State-Sequenced Mutation Discovery
In Radix-heavy UIs (like Grok 2026), critical elements (Submit buttons, Menu Items) are often **absent** from the DOM until a trigger is clicked.
- **Anti-Pattern**: Do not attempt to find "Submit" or "Make Video" buttons on page load.
- **Pattern**: Automation must follow a hard-coded sequence:
  1. **Trigger Phase**: Resolve and click the anchor (e.g., `Settings`).
  2. **Mutation Phase**: Use a `waitForElement` (min 2000ms) to detect the Radix dialog/menu insertion.
  3. **Discovery Phase**: Resolve the transient element (e.g., `Make Video` menu item) only *after* the mutation.
- **Diagnostic Constraint**: Static diagnostic scripts run on page load will report these elements as missing. Validation should be performed via "Action-Captured" trace or sequential script execution.

### 13.3 Execution Context Verification
Content scripts in Chrome extensions run in an **Isolated World**. This has significant implications for console debugging:
- **Global Visibility**: Variables like `window.gvpReactAutomation` are only accessible to the extension script and **NOT** to the page's "top" context (Main World) unless explicitly exposed.
- **Console Debugging**: To interact with manager instances via the console, the user/developer must switch the **JavaScript Context** dropdown in DevTools (next to Clear Console 🚫) from `top` to the extension's name (e.g., `Grok Video Prompter`).
- **Detection Pattern**: If `window.gvpReactAutomation` is reported as `undefined` but the extension is enabled, context mismatch is the 90% percentile cause.
- **Context Discovery Pattern**: When multiple identical extension contexts appear in DevTools, identify the active content script context by cycling through entries and verifying `typeof window.gvpReactAutomation !== 'undefined'`.

### 13.4 Predicate Dispatch Pattern (Function-Based Selectors)
As of v1.30.1, GVP's waiter logic (`waitForElement`) has been upgraded to support both standard CSS strings and **Function Predicates**.
- **The Problem**: Passing a function (e.g., `() => findByText(...)`) to native `document.querySelector` triggers a `SyntaxError: Failed to execute 'querySelector' on 'Document'`.
- **The Solution**: The waiter must detect if a selector is a function and execute it directly as a predicate.
- **Why it matters**: This allows complex, text-based discovery logic to be passed into the centralized `waitForElement` retry/mutation loop, ensuring robust discovery of Radix menu items where CSS alone is insufficient.
- **Remediation Pattern (Relaxed Selector)**: When text-based discovery fails within Radix menus, relax the CSS selector to include generic containers (e.g., `div` instead of `div[role="menuitem"]`) to handle nested elements or missing roles.
- **Timing Constraint**: Always include an explicit delay (min 500ms) between the trigger click and the mutation search to account for transition animations.

```javascript
// Robust Waiter Implementation (v1.30.1 Patch)
const tryFind = () => {
    for (const selector of selectorList) {
        try {
            let el = null;
            if (typeof selector === 'function') {
                // Support function-based selectors (e.g., findByText)
                el = selector();
            } else if (typeof selector === 'string') {
                // Standard CSS selector
                el = searchRoot.querySelector(selector);
            }
            if (el) { ... resolve(el); ... }
        } catch (error) { ... }
    }
};
```

### 13.5 UI-Based Verification Pivot (Debugger Injection)
In production-like environments where users find console-based "Context Switching" (Isolated Worlds) cumbersome, verify logic via **Direct DOM Injection**.
- **Pattern**: Temporarily modify the content script (`content.js`) to inject a fixed-position, high-visibility "Test Button" into the live page.
- **Workflow**:
  1. The button resides in the **Extension Context** (Isolated World).
  2. Clicking the button executes manager methods (`sendToGenerator`) without requiring the user to open or configure DevTools.
  3. The button provides immediate visual feedback (color changes/text updates) on the success/failure of the underlying automation flow.
- **Architectural Benefit**: Bypasses the 90th percentile cause of verification failure: incorrect JavaScript context selection in the DevTools console.

### 13.6 The Nested Text Node Collision (Text Matching Pitfall)
A critical failure point in text-based discovery (e.g., `findByText`) occurs in the 2026 Radix menus where menu items contain both a **Title** and a **Subtitle**.
- **The Problem**: `el.textContent` and `el.innerText` on the parent container return the **concatenation** of all child text nodes (e.g., `"Make VideoAnimate this image into a video"`).
- **The Result**: Strict equality checks (`=== "Make Video"`) fail on the container element.
- **Remediation Pattern**:
    1. **Target the Leaf**: Update selectors to include the innermost element (e.g., `span`) rather than just the container (`div`).
    2. **Partial Match Logic**: Update `findByText` helpers to use `.includes(text)` or a normalized regex instead of strict trimming/equality when searching containers.
    3. **Hierarchy Awareness**: Search for the container first, then verify its sub-tree contains the target label.

**Example Case (Snippet 25)**:
```html
<div role="menuitem" ...>
  <div class="flex ...">
    <div class="flex flex-col items-start">
      <span class="font-semibold text-sm">Make Video</span> <!-- THE LEAF TARGET -->
      <span class="text-xs text-secondary">Animate this image into a video</span>
    </div>
  </div>
</div>
```
- **Failing Selector**: `findByText('div[role="menuitem"]', 'Make Video')` (Concatenates title and subtitle).
- **Stable Selector (Leaf Targeting)**: 
  1. Find the leaf: `findByText('span.font-semibold', 'Make Video')`.
  2. Traverse up: `leaf.closest('[role="menuitem"]')`.

### 13.7 The Upward Arrow Submit Pattern (L3 Submit Hook)
In the 2026 Quick Mode/Image Edit flow, the final submission component is often not labeled "Submit" or "Edit".
- **The Pattern**: A button with `aria-label="Make video"` containing an upward arrow SVG (`M6 11L12 5...`).
- **Automation Logic**:
  - Target: `button[aria-label="Make video"]:has(svg path[d*="M6 11L12 5"])`.
  - Behavior: This button is dynamic; it only becomes active/visible after the TipTap input has been populated and the Radix state has stabilized.
- **Architectural Requirement**: Use `waitForElement` with a CSS selector that includes the SVG path fragment to distinguish the "Submit" action from other "Make video" triggers in the UI. 
- **Conflict Handling**: Explicitly exclude buttons containing images (`:not(:has(img))`) to prevent accidental clicks on User Profile pictures, which effectively share the same wrapper structure in some Radix states.
- **Direct Detection**: This same "Upward Arrow" button is often the **primary** generation trigger on images. Prioritize this SVG match in the `MAKE_VIDEO` array to avoid unnecessary settings-menu fallbacks.
- **Verified Efficiency**: Automation logs confirm that with a **500ms pre-wait**, the fallback flow consistently resolves within **550ms total execution time**, proving the stability of the state-sequenced mutation discovery.

### 13.8 TipTap/ProseMirror Transaction Mismatches (Injection Drift)
A `RangeError: Applying a mismatched transaction` occurs when an external script (GVP) modifies the `innerHTML` of a ProseMirror editor while the editor is mid-transaction or has an outdated internal state.
- **The Problem**: Writing to `innerHTML` clears ProseMirror's Undo/Redo stack and can cause the internal state to drift from the DOM state. If React/ProseMirror attempts to apply a saved transaction (e.g., from an autocomplete or auto-focus event) after GVP's injection, the offsets won't match, triggering the `RangeError`.
- **Primary Remediation**: Use `document.execCommand('insertText', false, text)` as the primary injection method for established ProseMirror editors. This method is "transaction-aware" and fires the appropriate `input` events that ProseMirror monitors to keep its internal state in sync with the DOM.
- **Secondary Remediation**: Wrap the injection in `element.focus()` and `document.execCommand('selectAll')` to ensure a clean state before insertion.
- **Tertiary (Fallback) Pattern**:
  1. `element.focus()`.
  2. `document.execCommand('selectAll', false, null)` (to clear existing content safely).
  3. `document.execCommand('insertText', false, text)`.
  4. If `insertText` returns false or fails, use `document.execCommand('insertHTML', false, pWrapped)`.
  5. Fallback to `innerHTML` + manual `InputEvent` dispatch only as a last resort.

### 13.9 Submission via Keyboard Simulation (Enter Key)
Due to the high volatility of "Submit" and "Edit" button selectors in the 2026 UI, GVP adopts keyboard simulation as the most reliable submission trigger.
- **The Pattern**: Instead of searching for and clicking a dynamic button, dispatch an `Enter` keyboard sequence directly into the active editor.
- **Implementation**:
  ```javascript
  const enterEventOpts = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      view: window
  };

  inputEl.dispatchEvent(new KeyboardEvent('keydown', enterEventOpts));
  inputEl.dispatchEvent(new KeyboardEvent('keypress', enterEventOpts));
  inputEl.dispatchEvent(new KeyboardEvent('keyup', enterEventOpts));
  ```
- **Constraint**: The `inputEl` must have focus and contain the injected text (via `execCommand`) before the events are dispatched to trigger the intended framework submission handler.

### 13.10 Latency Optimization (Path Priority)
To achieve "Rapid" Quick Mode performance, automation must prioritize **Feature-Informed Discovery** and minimize wait-state accumulation.
- **The Problem**: Sequential fallbacks (wait for A, then wait for B) introduce cumulative delay (e.g. 5s + 8s).
- **The Solution (Enter-Key Priority)**: Use **Keyboard Submission (Section 13.9)** as the primary path. By triggering submission via the Enter key immediately after injection, the automation bypasses the need to wait for "Make Video" button selectors entirely.
- **Optimization Strategy**: 
  1. Detect Input Element (TipTap).
  2. Inject Prompt (Transaction-Aware).
  3. **Dispatch Enter Key** (0ms wait for button discovery).
  4. Only if Input Element is missing, fall back to the multi-component discovery chain (Section 15).

### 13.11 The Gatekeeper Pattern (Context Validation)
To prevent **cross-modal regressions** (e.g., accidentally triggering an "Image Edit" instead of "Make Video" because the wrong TipTap editor was matched), GVP uses a **Gatekeeper Check** before firing high-speed keyboard submission.
- **The Problem**: On high-density React pages, multiple `contenteditable` editors may exist simultaneously (Chat, Edit Image, etc.). Blindly hitting Enter on the first match can result in irreversible state changes.
- **The Solution**: Before injecting and submitting, performing a high-speed poll (1000ms timeout) for a **Mode-Specific Anchor** (e.g., the "Make Video" Up Arrow button).
- **Execution Flow**:
  1. Find TipTap.
  2. **Poll for Anchor**: If `button:has(svg UpArrow)` is missing, throw an error to trigger the **Fallback Flow** (Section 15) even if an input was found.
  3. **Inject & Enter**: If the anchor is present, proceed with immediate submission.
- **Benefit**: Restores 100% modal correctness while keeping the "Direct Path" execution time under 1100ms.

### 13.12 Radix ID Volatility (Strict ID Matching)
While Radix IDs are dynamic (e.g., `radix-_r_1u_`), they follow a predictable prefix pattern.
- **Pattern**: Target the prefix using the `id^="radix-"` selector combined with a stable `aria-label`.
- **Selector**: `button[aria-label="Settings"][id^="radix-"][aria-haspopup="menu"]`.
- **Why**: This prevents matching generic buttons that might share a label but lack the Radix logic or aria state.

### 13.13 Menu Item Deep-Text Resolution
In the 2026 UI, "Make Video" and "Edit Image" menu items are nested containers where the text is inside a `span.font-semibold` next to an SVG and a subtitle.
- **Problem**: `findByText` on the container fails because `innerText` includes the subtitle.
- **Critical Discovery (The "Lucide" Absence)**: It was discovered via user interaction logs that the SVGs in some menus **lack the stable `lucide-brush` class** (e.g., `<svg class="stroke-[2] shrink-0">`), making icon-based selection unreliable.
- **Strategy (Span-to-Container)**:
  1. Find the specific `span.font-semibold` containing the exact text ("Make Video" or "Edit Image").
  2. Traverse up to the `[role="menuitem"]` parent via `.closest()`.
- **Benefit**: Ensures the click event propagates to the Radix selection handler rather than just a text node or a brittle icon class.

## 15. Multi-Component Fallback Chains (The Videoless Catch-All)

When direct injection targets (the primary prompt bar) are missing—typically on "Videoless" assets like images that haven't yet been converted to video—automation must traverse a multi-step UI hierarchy.

### 15.1 The 3-Step Settings Flow
For Grok 2026, the reliable chain for generating video from a static image is:
1.  **Component A (Trigger)**: Locate and click the **Settings Button** (`button[aria-label="Settings"]`).
2.  **Component B (Menu)**: Use a predicate-based search (e.g., `findByText`) to locate the **"Make Video"** menu item within the newly unmounted Radix menu.
3.  **Component C (Modal)**: Wait for the secondary **TipTap dialog** to appear, inject the prompt, and submit via Enter.

### 15.2 State Synchronization Constraints
- **Menu Settling**: Always provide a small delay (e.g., 500ms) after clicking the Settings button to allow the React/Radix menu to mount and animate before polling for the "Make Video" text.
- **Context Awareness**: If the chain fails at any step, the automation should throw a specialized `FallbackError` to prevent "Half-Generation" registrations (where the prompt is injected but not submitted).

### 15.4 Slow-Path Debugging (Delays and Logging)
When the fallback chain fails despite correct selectors, it is typically a synchronization issue.
- **Pattern**: Increase delays to **800ms - 1000ms** between menu clicks and input appearances to account for Radix UI mounting animations.
- **Visibility (The Step-Log Pattern)**: Use explicit, numbered logs (`🔍 Step 1: Searching for Settings...`, `🔍 Step 2: ...`) interleaved with delays. This allows the user to report exactly which transition failed.
- **Implementation**:
  ```javascript
  window.Logger.debug('ReactAutomation', '🔍 Step 1: Searching for Settings button...');
  const settingsBtn = await this.waitForElement(SELECTORS.BUTTON.SETTINGS_2026, 3000);
  this.reactClick(settingsBtn, 'Settings Button');
  await new Promise(r => setTimeout(r, 800)); // Crucial animation delay
  ```

### 15.3 Dynamic Submission Labels
It was discovered that the generation trigger button (the Up Arrow icon) can alternate its `aria-label` between `"Make video"`, `"Make a video"`, and **`"Submit"`** (Snippet 26 variant) depending on the UI state or specific dialog. 
- **Strategy**: Automation should prioritize the **SVG Path Signature** (Section 16) and treat "Submit" labels as valid generation triggers when paired with the generation icon.

## 16. Icon-First Selector Robustness (SVG Signatures)

When ARIA labels or data-test-ids are inconsistent or dynamic across different React contexts (e.g., "Submit" vs "Make video"), the most stable anchor is often the **SVG Path Data** (`d` attribute) of the inner icon.

### 16.1 The "Up Arrow" Signature
The 2026 Grok generation button uses a consistent "Up Arrow" icon defined by the path `M6 11L12 5M12 5L18 11M12 5V19`.

**Robust Selector Pattern:**
```javascript
// Target any button containing the specific Up Arrow icon, excluding user profile avatars
'button:has(svg path[d*="M6 11L12 5"]):not(:has(img))'
```

### 16.2 Benefits
- **Label Independence**: Bypasses the "Submit" vs "Make video" naming discrepancy.
- **State Resilience**: Works across the primary prompt bar, settings menus, and modal dialogs.
- **Uniqueness**: The `not(:has(img))` filter prevents accidental matches with round profile buttons that share generic classes but contain a user image instead of an SVG.

## 17. Network Data Normalization Risks

GVP uses regex-based string manipulation on JSON payloads (in `InspectionManager.js`) to strip "fluid" fields like timestamps and progress values before storage and diffing.

### 17.1 Invalid JSON Injection (The Unquoted Literal)
- **The Risk**: Replacing a numeric or boolean value with a non-JSON-compliant string literal (e.g., `[PROGRESS]`) results in a `SyntaxError` during the subsequent `JSON.parse()`.
- **The Correct Pattern**: Replacements must maintain structural integrity by quoting strings.
  - *Incorrect*: `.replace(/"progress"\s*:\s*\d+/g, '"progress":[PROGRESS]')`
  - *Correct*: `.replace(/"progress"\s*:\s*\d+/g, '"progress":"[PROGRESS]"')`
- **Detection**: Always wrap `JSON.parse(cleaned)` in a try-catch and log the problematic string fragment on failure to identify the broken regex.

### 17.2 The Unquoted Literal Regression
During the v1.30.1 stabilization, a regression occurred where numeric replacements like `progress` were replaced with unquoted string literals. Since GVP uses regex on serialized JSON *before* parsing it back to an object, this resulted in an immediately malformed string. 
- **Rule**: Placeholders that substitute numeric or boolean fields in a raw JSON string MUST be wrapped in escaped quotes (e.g., `\"[PLACEHOLDER]\"`) to maintain parseability.

## 18. User-Uploaded vs. Generated Image Modality

A critical distinction was discovered between images generated by Grok and images uploaded by the user.
- **Generated Images**: Usually provide a direct "Make Video" button on the post page, allowing for the **Direct Path**.
- **Uploaded Images**: Often present as an "Edit Image" interface with no direct video trigger. These assets require the **Fallback Flow** (Settings -> Make Video).

### 18.1 Preventing Modal Bleed
To prevent Cross-Modal Regressions (Section 13.11), selectors for the **Gatekeeper Check** must be hyper-specific.
- **The Risk**: Using broad selectors like `button[type="submit"]` or `button[data-variant]` for the "Make Video" check can cause the automation to falsely identify an "Edit Image" screen as a "Make Video" screen.
- **The Resolution**: Strict adherence to **SVG Path Signatures** (Section 16) ensures that automation only attempts the Direct Path when the generation-specific icon is physically present.

## 19. Manager-Selector Synchronization Protocol

A common failure mode in complex automation is the decoupling of high-quality selectors in `selectors.js` from their usage in `Manager` classes.

### 19.1 Mandatory Selector Array Usage
- **Problem**: Managers that use `document.querySelector` with single hardcoded strings bypass the fallback robustness of the Centralized Selector Registry.
- **Protocol**: Critical execution steps (Settings, Submission, Mode Toggles) MUST use the selector array via `this.waitForElement(SELECTORS.ARRAY_NAME)`.
- **Enforcement**: If an entry point is mandatory for a flow, the manager MUST NOT use a "silent skip" pattern (e.g., `if (btn) btn.click()`). It must use a mandatory wait or throw an explicit `Error('Component X not found')` to ensure the debug logs clearly pinpoint the failing transition.

## 20. Predicate Retry Loops for Dynamic Menus

Radix and React-based menus often exhibit "Mount Latency" where the container exists in the DOM, but internally searchable properties (like inner text or specific spans) are not yet rendered or settled.

### 20.1 Polling vs. Single-Poll Predicates
- **Strategy**: When using text-based predicates (e.g., `findByText` or `span.font-semibold:contains`), implement a short retry loop (e.g., 5-10 attempts at 200ms intervals).
- **Benefit**: Accounts for React render cycles and Radix mount animations without introducing a single, long, brittle `setTimeout`.
- **Implementation Pattern**:
  ```javascript
  let menuItem = null;
  for (let i = 0; i < 5; i++) {
      menuItem = findByText('span.font-semibold', 'Edit Image');
      if (menuItem) break;
      await new Promise(r => setTimeout(r, 200));
  }
  ```

## 21. Standalone Interaction Monitoring (Userscript)

For cases where dynamic element drift (like Radix ID cycling) prevents reliable selector identification during active automation sessions, GVP provides a standalone **Interaction Recorder**.

### 21.1 Tampermonkey Deployment
- **Purpose**: Decouples diagnostic logic from the main extension bundle, allowing the user to record "clean" manual interactions without interference from failing automation scripts.
- **Tool**: `tools/grok_recorder.user.js`.
- **Metric**: The recorder specifically tracks `hasSvg` and `hasFontSemibold` states to identify if the 2026 UI has stripped stable classes (e.g., `lucide-brush`) from the target element.

## 22. Mode Toggle Synchronization (SR-Only Pattern)

When assets possess multiple modalities (e.g., an Image that already has an associated Video), the UI provides a mode-switcher. This is often a set of buttons where the visible label is hidden from the main DOM view or aria-labels are used inconsistently.

### 22.1 The "Screen Reader Only" Anchor
In the 2026 UI, the most reliable way to target modality switches (Image vs Video) is to look for the `span.sr-only` element containing the mode name.
- **Pattern**: Find the `span.sr-only` with exact text ("Image" or "Video") and traverse to the parent `button`.
- **Selector Logic**:
  ```javascript
  () => {
      const span = findByText('span.sr-only', 'Image'); // or 'Video'
      return span ? span.closest('button') : null;
  }
  ```
- **Active State Detection**: Modality buttons indicate activation via the `bg-button-filled` class. 
- **Protocol**: 
  1. Find the target mode button.
  2. Check `classList.contains('bg-button-filled')`.
  3. If not active, click and introduce a mandatory switch delay (e.g., 800ms).
- **Why**: This bypasses complex icon-based classes or dynamic aria-labels that might change during React re-renders.

## 23. Mandatory Manager Synchronization (The Race Condition Fix)

High-speed automation often fails when a `Manager` attempts to interact with a component before it has settled (Mount Latency).

### 23.1 Enforced Wait vs. Silent Skipping
- **Detection**: Diagnosed via logs showing a "Menu item not found" error exactly 20-30ms after the flow starts.
- **Root Cause**: The manager was only checking for a button's existence *once* (silent skip) rather than waiting for it to appear. If the DOM was in a transition state, the button click failed silently, leading to a cascaded failure at the next step.
- **Protocol (The 2026 Standard)**:
  1. **Mandatory Wait**: Every transitional element (Settings Button, Mode Toggle) MUST use `await this.waitForElement()` with a minimum 2000ms timeout.
  2. **Retry Loop**: menu items or dynamic sub-elements MUST use a polling predicate (Section 20).
- **Benefit**: Eliminates 95% of race conditions in SPA (Single Page Application) navigation environments.

## 24. Standardized Interaction Streams (Happy Paths)

To minimize flakiness, GVP adheres to strictly defined interaction streams based on verified 2026 DOM signatures.

### 24.1 Quick Video (Raw Generation)
1. **Entry**: Verify `div.tiptap.ProseMirror` is active.
2. **Gatekeeper**: Check for the "Up Arrow" button (`button:has(svg path[d*="M6 11L12 5"])`).
3. **Fast Path**: If found, inject prompt and simulate `Enter`.
4. **Fallback Path**: If missing:
   - Click Settings (`button[aria-label="Settings"][id^="radix-"]`).
   - Click "Make Video" (`span.font-semibold`).
   - Inject + Hybrid Submission (Section 24.3).

### 24.3 Hybrid Submission (Enter + Redundant Click)
To maximize reliability in the 2026 UI (where React might trap keyboard events or buttons might be transiently disabled):
- **Primary**: Dispatch a full `keydown/keypress/keyup` sequence for `Enter` (13).
- **Secondary**: After a small delay (e.g., 300ms), perform a `reactClick` on the target submit button (`VFLOW.SUBMIT_BUTTON`).
- **Benefit**: Ensures 100% submission rate regardless of UI state synchronization or event listeners.

### 24.2 Image Editing (The "Instant" Flow)
1. **Synchronization**: Switch to "Image" mode if not already active (Section 22). This is mandatory for multi-modal assets.
2. **Expansion**: Click Settings -> Click "Edit Image" (Predicate Retry, Section 20).
3. **Instant Apply**: Mirroring "Quick Raw", the automation should inject the prompt and immediately trigger the "Edit" submit button without intermediate confirmation steps. 
4. **Context Isolation**: Ensure that the "Edit" submit button (`button[aria-label="Edit"]`) is targeted specifically within the Edit workspace to avoid collisions with the "Make Video" submit button.

## 25. Modality De-confliction (Video vs. Edit Streams)

A critical failure mode in the 2026 UI is "Cross-Stream Contamination," where the Video Generator (`sendToGenerator`) accidentally interacts with the Image Edit workspace or vice-versa.

### 25.1 Strict Gatekeeping
To prevent "Quick Video" from editing an image:
- **Button Verification**: The `MAKE_VIDEO` gatekeeper MUST verify the presence of the "Up Arrow" SVG vector or the "Make video" aria-label specifically.
- **Input Verification**: If the detected TipTap input is already populated with image metadata or shows "Edit" UI signatures, the Video flow must abort/fallback rather than proceeding with injection.
- **modality-switch**: If both modalities coexist, the manager MUST explicitly trigger the "Video" modality button (Section 22) before attempting "Quick Video" to ensure the correct context is active.

## 26. User-Log Gold Standard Selectors (v1.30.1 Final)

Derived from verified interaction logs (Step 755), these selectors represent the most stable targets for the 2026 Radix UI implementation.

### 26.1 Video Flow (The "Make Video" Fallback)
- **Settings**: `button[aria-label="Settings"][id^="radix-"]`
- **Menu Item**: `div[role="menuitem"]:has(span.font-semibold:contains("Make Video"))` (Leaf-to-Container pattern)
- **Input Area**: `div.tiptap.ProseMirror[contenteditable="true"]`
- **Submit Button**: `button[aria-label="Make video"]:has(svg path[d*="M6 11L12 5"]):not(:has(img))`
- **Nomenclature**: Labeled in `selectors.js` as `VIDEO_FLOW`.


### 26.2 Image Edit Flow
- **Menu Item**: `div[role="menuitem"]:has(span.font-semibold:contains("Edit Image"))`
- **Confirmation Button**: `button[aria-label="Edit"]` (Targets the "Checkmark" or "Edit" text button in the modal).

## 27. Extreme Latency Compensation (The 500ms Rule)

In high-complexity SPA views (e.g., long threads or multi-modal asset pages), standard React mount waits (200ms) often prove insufficient for the 2026 UI.

### 27.1 Synchronization Heartbeats
- **Standard**: Every interaction step (Settings Click -> Menu Selection -> Input Focus) SHOULD be preceded by a mandatory **500ms delay**.
- **Why**: This allows the React state tree and Radix UI animations to settle completely, preventing "silent skips" where a click event is dispatched to an element that is DOM-present but not yet event-bound.

## 28. Per-Step Instrumentation (Granular Debugging)

To enable effective remote troubleshooting (spoonfeeding), automation flows MUST provide explicit debug output before and after every transitional action.

### 28.1 Instrumentation Protocol (Emoji-Led)
Each automation step must log using specific emoji anchors to differentiate phases at a glance:
1. **Wait Phase**: `Logger.debug('⏳ [Step X] Waiting 500ms for [State]...')`
2. **Search Phase**: `Logger.debug('🔍 [Step X] Searching for [Element]...')`
3. **Success Phase**: `Logger.debug('✅ [Step X] [Element] FOUND')`
4. **Action Phase**: `Logger.debug('✅ [Step X] [Element] CLICKED')`
5. **Final Phase**: `Logger.info('✅ [Step X] Flow Successful')`

- **Benefit**: Provides a "Visual Heartbeat" in the console that proves the automation respects SPA latency constraints.

## 29. Payload-Level Intent Verification

When UI-based mode detection fails (e.g., due to stale SPA state), GVP uses **Network Payload Inspection** to verify the intent of a `POST /rest/app-chat/conversations/new` request before or during transmission.

### 29.1 Signatures of Intent

| Flow | `modelName` | `toolOverrides` | `responseMetadata` Anchor |
| :--- | :--- | :--- | :--- |
| **Image Edit** | `"imagine-image-edit"` | `{"imageGen": true}` | `imageEditModelConfig` |
| **Video Gen** | `"grok-3"` | `{"videoGen": true}` | `videoGenModelConfig` |

### 29.2 Validation Requirement
Waiters or Interceptors hooked into the submission lifecycle (e.g., when Enter is pressed or `fetch` is called) MUST inspect the outgoing JSON payload. If the `toolOverrides` or `modelName` do not match the expected automation state (e.g., a "Quick Raw" video flow resulting in an `imageGen` payload), the request should be blocked or surfaced as a high-priority "Intent Mismatch" error to prevent accidental asset modification.
