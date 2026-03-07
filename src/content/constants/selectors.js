/**
 * GROK SELECTORS (FUNCTION-BASED ARCHITECTURE)
 * 
 * Structure: FEATURE -> FUNCTION_NAME -> SELECTORS
 * Goal: The structure mirrors the codebase. If you are debugging `ReactAutomation.sendToGenerator`, 
 *       you look under `FEATURES.GENERATOR.sendToGenerator`.
 */

window.Logger?.info?.('Selectors', '🚀 INITIALIZING GROK_SELECTORS...');

try {
    window.GROK_SELECTORS = {

        // =========================================================================
        // 1. FEATURES & FUNCTIONS
        // =========================================================================
        FEATURES: {

            // --- Feature: Main Video Generator (Tab 1) ---
            GENERATOR: {

                // Function: ReactAutomation.sendToGenerator()
                sendToGenerator: {
                    MAIN_INPUT: [
                        'textarea[placeholder="Type to customize video..."]', // Image-to-Video / Redo Input
                        'div.tiptap.ProseMirror[contenteditable="true"]',
                        'div[contenteditable="true"][translate="no"].tiptap.ProseMirror',
                        'textarea[aria-label="Make a video"]',
                        'textarea[aria-label="Make video"]',
                        'textarea[aria-label="Create a video"]',
                        'textarea[placeholder="Describe the video you want to create"]',
                        'textarea[placeholder*="video"]',
                        'textarea[data-testid="video-generator-textarea"]',
                        'div[contenteditable="true"][role="textbox"]',
                        'textarea' // Generic fallback LAST
                    ],
                    // Mode switching uses shared logic but specific triggers here
                    MODE_TOGGLE_VIDEO: () => window.GROK_SELECTORS.MODE_TOGGLE.BUTTONS.VIDEO(),
                    MODE_TOGGLE_IMAGE: () => window.GROK_SELECTORS.MODE_TOGGLE.BUTTONS.IMAGE(),

                    SUBMIT_BUTTON: [
                        'button[aria-label="Make video"]:has(svg path[d="M6 11L12 5M12 5L18 11M12 5V19"])', // Primary New Up-Arrow Video Submit (Exact)
                        'button[aria-label="Make video"]:has(svg path[d*="M6 11L12 5"])', // Primary New Up-Arrow Video Submit (Partial)
                        'button[aria-label="Make video"]:has(.bg-button-filled)', // Modern Primary Action
                        'button[aria-label="Make video"]:not(:has(svg path[d^="M12 4C"]))', // Fallback, avoiding the promptless pill
                        'button[aria-label="Make a video"]:has(svg path[d*="M6 11L12 5"])',
                        'button[data-testid="make-video-button"]'
                    ]
                },

                // Function: ReactAutomation.pressEnter()
                pressEnter: {
                    TARGET: 'textarea, .ProseMirror'
                },

                // Function: Internal logic for mode detection
                detectMode: {
                    VIDEO_ACTIVE_BTN: () => window.GROK_SELECTORS.MODE_TOGGLE.BUTTONS.VIDEO_ACTIVE()
                }
            },

            // --- Feature: Quick Launch / Raw Input (Tab 2) ---
            QUICK_LAUNCH: {

                // Function: UIRawInputManager.setValue() (Planned)
                setValue: {
                    // Alias to Main Generator Input for consistency
                    get TARGET_INPUT() { return window.GROK_SELECTORS.FEATURES.GENERATOR.sendToGenerator.MAIN_INPUT; }
                },

                // Function: ReactAutomation.monitorAndMakeVideo()
                monitorAndMakeVideo: {
                    ARMING_THUMBNAIL: 'button:has(img[src^="data:image"])', // Base64
                    RESULT_THUMBNAIL: 'button:has(img[alt^="Thumbnail"])', // Resolved
                    MAKE_VIDEO_BTN: [
                        'button[aria-label="Make video"]:has(svg path[d="M6 11L12 5M12 5L18 11M12 5V19"])', // New Up Arrow UI (Exact)
                        'button[aria-label="Make video"]:has(svg path[d*="M6 11L12 5"])', // New Up Arrow UI (Partial)
                        // LEGACY / HISTORIC
                        'button[aria-label="Make video"]:has(svg.lucide-play)'
                    ],
                    // Post-Edit Landing "Make Video" promptless short-cut button
                    PROMPTLESS_DIRECT_VIDEO_BTN: [
                        'button[aria-label="Make video"]:has(svg path[d^="M12 4C14.48"])',
                        'button:has(svg path[d^="M12 4C14.48"])',
                        'button:has(svg path[d^="M22.5 19.0811"])'
                    ],
                    // Fresh Gen / Blind Execution Target
                    // Targets the "Make video" button, including those without specific icons or IDs
                    FRESH_GEN_BTN: [
                        'button[aria-label*="Make video"]',
                        'button[aria-label*="Make a video"]',
                        'button[data-testid*="make-video"]',
                        'div[aria-label*="Make video"]', // Some buttons are divs
                        'div[aria-label*="Make a video"]'
                    ]
                }
            },

            // --- Feature: Image Editing (Gallery Latch) ---
            IMAGE_EDIT: {

                // Function: ReactAutomation.monitorAndEdit()
                monitorAndEdit: {
                    EDIT_INPUT: [
                        'div.tiptap.ProseMirror[contenteditable="true"]',
                        'textarea[aria-label="Make a video"]',
                        'textarea[placeholder="Type to customize video..."]',
                        'textarea[aria-label="Type to edit image..."]',
                        'textarea'
                    ],
                    SUBMIT_EDIT_BTN: [
                        'button[aria-label="Edit"]:has(svg path[d="M6 11L12 5M12 5L18 11M12 5V19"])', // New Up Arrow UI (Exact)
                        'button[aria-label="Edit"]:has(svg path[d^="M6 11L12 5"])',
                        'button:has(svg path[d="M6 11L12 5M12 5L18 11M12 5V19"])',
                        'button[aria-label="Make video"]:has(svg path[d="M6 11L12 5M12 5L18 11M12 5V19"])',
                        'button[aria-label="Make video"]:has(svg path[d^="M12 4C"])', // Pill Button
                        () => {
                            const btn = window.GROK_SELECTORS.findByText('button[aria-label="Make video"] span', 'Edit');
                            return btn ? btn.closest('button') : null;
                        },
                        () => window.GROK_SELECTORS.findByText('button', 'Edit'),
                        'button[aria-label="Edit"]'
                    ],
                    CLOSE_MODAL_BTN: 'button[aria-label="Close"]',

                    // --- Navigation & Context Indicators ---
                    DIRECT_EDIT_BTN: [
                        'button[aria-label="Edit image"]:has(svg path[d^="M17.5692"])', // Exact SVG match from user
                        () => window.GROK_SELECTORS.findByText('button', 'Edit image'),
                        'button[aria-label="Edit image"]'
                    ],
                    THREE_DOT_MENU: [
                        'button[aria-label="More options"]',
                        'button:has(svg.lucide-ellipsis)'
                    ],
                    // Prioritize exact user-provided Gear/Settings SVG path
                    SETTINGS_BTN: [
                        'button[aria-label="Settings"]:has(svg path[d^="M17.5692"])', // Modern Gear/Pen UI
                        'button[aria-label="Settings"]',
                        'button[aria-label="More options"]',
                        'button:has(svg.lucide-settings)'
                    ],
                    MENU_CONTAINER: [
                        'div[role="menu"][data-radix-menu-content]',
                        '[data-radix-popper-content-wrapper]'
                    ],
                    BACKUP_EDIT_BTN: [
                        'div[role="menuitem"]:has(svg path[d^="M17.5692"])', // New precise brush
                        'div[role="menuitem"]:has(svg.lucide-brush)',
                        () => window.GROK_SELECTORS.findByText('div[role="menuitem"]', 'Edit image')
                    ],
                    UPSCALE_BTN: [
                        'div[role="menuitem"]:has(svg.lucide-expand)',
                        () => window.GROK_SELECTORS.findByText('div[role="menuitem"]', 'Upscale')
                    ],
                    IMAGE_CHIP_INDICATOR: [
                        'button[aria-label="Exit extend mode"]:has(svg.lucide-brush)',
                        () => window.GROK_SELECTORS.findByText('button[aria-label="Exit extend mode"]', 'Image'),
                        () => window.GROK_SELECTORS.findByText('button', 'Image', document.querySelector('.grok-edit-modal') || document.body)
                    ],

                    // Function: UIManager.imgEditReEditBtn.onClick
                    // Logic to extract existing prompts from the page for re-editing
                    PROMPT_EXTRACTION: [
                        // Extracted from UIManager.js (lines 1779-1808)
                        'div.bg-surface-l1.truncate.rounded-full span', // Collapsed prompt pill
                        'textarea[aria-label="Image prompt"]',          // Open edit modal
                        'textarea[aria-label="Type to edit image..."]', // Alternatve edit modal
                        'div[contenteditable="true"]:has(p[data-placeholder="Type to edit image..."])', // New Video-less fresh image mode edit TiapTap
                        'div.bg-surface-l1'                             // Fallback generic container
                    ],
                    THUMBNAILS: [
                        'div.snap-y.snap-mandatory button.snap-center', // Explicit User SVG Path
                        'button:has(img[src^="data:image"])',

                        // Fallback for Single Post View (no carousel)
                        'div.flex:not(.snap-y) > button:has(img)',
                        'button:has(img):not([aria-label])'
                    ]
                },

                // Function: ReactAutomation.startImageEditWatcher()
                startImageEditWatcher: {
                    // We watch these containers to know we are in edit mode
                    MODAL_CONTAINER: '.grok-edit-modal', // Wrapper class if we add one, or generic
                    OVERLAY: '.gvp-edit-overlay'
                },

                // --- Feature: Extended Image Editing (Multi-Image / Merge) ---
                EXTENDED_EDIT: {
                    // Toggles & Actions
                    EXIT_EXTEND_MODE_BTN: 'button[aria-label="Exit extend mode"]',
                    MERGE_IMAGES_BTN: 'button[aria-label="Merge with other images"]',
                    ADD_MORE_IMAGES_BTN: 'button[aria-label="Add more images"]',

                    // Added Image Thumbnails (Top Row)
                    ADDED_IMAGE_CONTAINER: 'div.relative.group:has(img)',
                    REMOVE_ADDED_IMAGE_BTN: 'div.relative.group button[aria-label="Remove image"]',

                    // Carousels (Left Side)
                    CAROUSEL_CONTAINER: 'div.snap-y.snap-mandatory',
                    CAROUSEL_THUMBNAIL: 'button.snap-center:has(img)',
                    CAROUSEL_THUMBNAIL_ACTIVE: 'button.snap-center.ring-2',

                    // Video Specifics in Carousel
                    VIDEO_PREVIEW_THUMBNAIL: 'button.snap-center:has(img):has(svg)' // SVGs indicate play button or status
                },

                // Function: ReactAutomation.runDiagnostics()
                runDiagnostics: {
                    SETTINGS_BTN: [
                        'button[aria-label="Settings"]', // Primary
                        'button[aria-label="More options"]', // Primary (Rolled-back UI)
                        'button[data-testid="settings-button"]'
                    ],
                    // Post-Video Direct Edit Button (Pill shaped)
                    DIRECT_EDIT_POST_BTN: [
                        'button[aria-label="Edit image"]:has(svg path[d^="M17.5692"])'
                    ],
                    // Updated to match forensic data: div[role="menuitem"] which contains specific SVG or text
                    MENU_ITEM_EDIT: () => {
                        // Strategy 1: Find by exact SVG brush icon path
                        const bySvg = window.GROK_SELECTORS.findFirst([
                            'div[role="menuitem"]:has(svg path[d^="M17.5692"])' // New precise brush
                        ]);
                        if (bySvg) return bySvg;

                        // Strategy 2: Find by text content "Edit image"
                        const byText = window.GROK_SELECTORS.findByText('div[role="menuitem"]', 'Edit image');
                        if (byText) return byText;

                        // Strategy 3: Find by legacy SVG brush icon
                        return window.GROK_SELECTORS.findFirst([
                            'div[role="menuitem"]:has(svg.lucide-brush)',
                            'div[role="menuitem"]:has(svg path[d^="m9.06 11.9"])'
                        ]);
                    }
                }
            },

            // --- Feature: Upload Automation (Tab 3) ---
            UPLOAD: {

                // Function: UploadAutomationManager.handleModerationDetected()
                handleModerationDetected: {
                    ERROR_ICON: [
                        'svg[aria-label="Error"]',
                        'svg.lucide-triangle-alert',
                        'svg[role="alert"]',
                        '.bg-chip svg[class*="text-red"]'
                    ],
                    REMOVE_BUTTON: [
                        'button[aria-label="Remove"]'
                    ]
                },

                // Function: UploadAutomationManager._navigateToGallery()
                _navigateToGallery: {
                    // Navigation often happens via URL change, but if UI click needed:
                    GALLERY_LINK: 'a[href="/imagine/saved"], a[href="/imagine/favorites"]',
                    FAVORITES_BTN: 'button[aria-label="Saved"], button[aria-label="Favorites"]'
                },

                // Function: UploadAutomationManager._startModerationWatcher()
                _startModerationWatcher: {
                    PREVIEW_CONTAINER: [
                        'form > div > div > div.w-full.ps-4.pe-2 > div',
                        'form div[class*="ps-4"][class*="pe-2"]',
                        'div[data-testid="chat-input-attachments"]'
                    ]
                },

                // Function: UploadAutomationManager._injectFileIntoInput()
                _injectFileIntoInput: {
                    INPUT_FILE: 'input[type="file"][accept="image/*"][name="files"]'
                }
            },

            // --- Feature: Video Queue (Tab 4) ---
            VIDEO_QUEUE: {
                // Function: UIVideoQueueManager._createHeaderBar (Quick Add Toggle)
                // Function: UIManager._initGalleryWatcher (The actual listener)
                QUICK_ADD: {
                    // Selectors to identify valid gallery cards
                    CARD_CONTAINERS: [
                        '[data-testid="media-card"]',
                        '[data-testid="image-card"]',
                        '[class*="media-post-masonry-card"]',
                        'div.group\\/media-post-masonry-card',
                        'a[href*="/imagine/post/"]',
                        'a[href*="/imagine-public/share-images/"]',
                        '.gallery-image',
                        'div[class*="relative"]:has(video)',
                        'a:has(img[src*="imagine-public"])'
                    ],
                    // Elements to IGNORE clicks on (Navigation)
                    IGNORE_CLICKS: [
                        'button[aria-label="Saved"]',
                        'button[aria-label="Favorites"]',
                        'button[aria-label="Back"]',
                        'nav',
                        'header'
                    ]
                },
                INDICATORS: {
                    MODERATED: '.bg-accent:has(svg.lucide-eye-off)'
                }
            },

            // --- Feature: Gallery Card Controls (UIGalleryManager) ---
            GALLERY: {
                CARD: {
                    // Masonry card container in /favorites grid
                    CONTAINER: [
                        '[class*="media-post-masonry-card"]',
                        'div.group\\/media-post-masonry-card',
                        '[data-testid="media-card"]'
                    ],
                    // Image element inside card (primary thumb)
                    IMAGE: 'img[alt="Generated image"]',
                    // Video element inside card
                    VIDEO: 'video'
                },
                CONTROLS: {
                    // GVP-injected controls overlay
                    CONTAINER: '.gvp-gallery-controls'
                }
            },

            // --- Feature: Side Launchers (Optimization) ---
            // These are internal IDs but keeping them central helps if we ever change ID naming schemes
            LAUNCHER: {
                BUTTONS: {
                    SILENT: '#gvp-launcher-silent-btn',
                    SPICY: '#gvp-launcher-spicy-btn',
                    RAIL: '#gvp-launcher-rail-btn',
                    UPSCALE: '#gvp-launcher-upscale-btn',
                    UPLOAD_MODE: '#gvp-launcher-upload-mode',
                    QUICK_EDIT: '#gvp-launcher-quick-edit',
                    QUICK_JSON: '#gvp-launcher-quick-json',
                    QUICK_RAW: '#gvp-launcher-quick-raw'
                },
                IMAGE_EDIT_ACTIONS: {
                    RE_EDIT: '#gvp-imgedit-reedit',
                    AUTO_BACK: '#gvp-imgedit-autoback',
                    QUICK_VIDEO: '#gvp-imgedit-quickvideo'
                }
            },
        },

        // =========================================================================
        // 2. SHARED COMPONENTS (The "Building Blocks")
        // =========================================================================
        // These are referenced by the high-level features above, or used directly by utils.
        MODE_TOGGLE: {
            CONTAINER: [
                'div[aria-label="Media type selection"]',
                'div.flex.gap-1.rounded-full.bg-surface-l2.flex-col:has(button span.sr-only)'
            ],
            BUTTONS: {
                IMAGE: () => {
                    // Try finding by aria-label container first
                    const container = document.querySelector('div[aria-label="Media type selection"]');
                    if (container) return container.querySelector('button:first-child'); // Usually Image is first

                    // Fallback to finding by icon path (Image icon) or class
                    const btn = window.GROK_SELECTORS.findFirst([
                        'button[aria-label="Image"]',
                        'button:has(svg.lucide-image)', // Generic Lucide class
                        'button:has(svg path[d^="M11.7503"])', // Specific path from DOM map
                        'button:has(svg path[d^="M21 19V5"])', // Common Lucide Image icon path start
                        'button:has(svg rect[x="3"][y="3"])'   // Generic Image icon structure
                    ]);
                    return btn;
                },
                VIDEO: () => {
                    const container = document.querySelector('div[aria-label="Media type selection"]');
                    if (container) return container.querySelector('button:last-child'); // Usually Video is last

                    // Fallback to finding by icon path (Video/Play icon)
                    const btn = window.GROK_SELECTORS.findFirst([
                        'button[aria-label="Video"]',
                        () => window.GROK_SELECTORS.findByText('button:has(.sr-only)', 'Video'), // Safe JS text match
                        'button:has(svg path[d^="M12 4C"])', // Specific path from User HTML
                        'button:has(svg.lucide-film)',  // Generic Lucide class
                        'button:has(svg.lucide-video)' // Generic Lucide class
                    ]);
                    return btn;
                },
                VIDEO_ACTIVE: () => {
                    // Active state is usually indicated by background color class
                    const container = document.querySelector('div[aria-label="Media type selection"]');
                    if (container) {
                        const bySvg = container.querySelector('button.bg-button-filled:has(svg path[d^="M12 4C"])');
                        if (bySvg) return bySvg;

                        const byText = window.GROK_SELECTORS.findByText('button.bg-button-filled', 'Video', container);
                        if (byText) return byText;
                    }

                    // Fallback: check if the "video" button has the active class
                    const videoBtn = window.GROK_SELECTORS.MODE_TOGGLE.BUTTONS.VIDEO();
                    if (videoBtn && (videoBtn.classList.contains('bg-button-filled') || videoBtn.classList.contains('bg-primary'))) return videoBtn;

                    // The active video toggle is uniquely identified by its icon path and hidden screen-reader text
                    return window.GROK_SELECTORS.findFirst([
                        'button.bg-button-filled:has(svg path[d^="M12 4C"]):has(span.sr-only)',
                        () => window.GROK_SELECTORS.findByText('button.bg-button-filled span.sr-only', 'Video')?.closest('button')
                    ]);
                }
            }
        },

        MENU_ITEMS: {
            MAKE_VIDEO: () => {
                // Prioritize exact user-provided SVG path for Make Video dropdown item
                return window.GROK_SELECTORS.findFirst([
                    'div[role="menuitem"]:has(svg path[d^="M6 15.5H9V17.5H6V20.5H4V17.5H1V15.5H4V12.5H6V15.5"])', // Exact Video Icon
                    'div[role="menuitem"]:has(svg path[d^="M6 15.5H9V17"])', // Partial Video Icon
                    () => window.GROK_SELECTORS.findByText('div[role="menuitem"]', 'Make Video'),
                    () => window.GROK_SELECTORS.findByText('div[role="menuitem"]', 'Make video'),
                    () => window.GROK_SELECTORS.findByText('button', 'Make video'),
                    () => window.GROK_SELECTORS.findByText('div[role="menuitem"]', 'Video'), // Fallback if it just says Video
                    // LEGACY / HISTORICAL FALLBACKS
                    'div[role="menuitem"]:has(svg.lucide-play)',
                    'div[role="menuitem"]:has(svg path[d^="M12 4C"])' // Standard play pill icon
                ]);
            },
            EDIT_IMAGE: () => {
                // New precise brush SVG path in menu
                return window.GROK_SELECTORS.findFirst([
                    'div[role="menuitem"]:has(svg path[d^="M17.5692 12.3085C18.7566 11.1842 20.6229 11.2098 21.7792 12.3661"])', // Exact Brush Icon
                    'div[role="menuitem"]:has(svg path[d^="M17.5692"])', // Partial Brush Icon
                    () => window.GROK_SELECTORS.findByText('div[role="menuitem"]', 'Edit Image'), // New capitalization
                    () => window.GROK_SELECTORS.findByText('div[role="menuitem"]', 'Edit image'),
                    // LEGACY / HISTORICAL FALLBACKS
                    'div[role="menuitem"]:has(svg.lucide-brush)',
                    'div[role="menuitem"]:has(svg path[d^="m9.06 11.9"])'
                ]);
            },
            REDO: () => {
                // Image Mode & Video Mode SVG paths
                return window.GROK_SELECTORS.findFirst([
                    'div[role="menuitem"]:has(svg path[d^="M54.0485 9.58"])', // Redo Image
                    'div[role="menuitem"]:has(svg path[d^="M12 19H16C18.20"])', // Redo Video
                    () => window.GROK_SELECTORS.findByText('div[role="menuitem"]', 'Redo')
                ]);
            },
            UPSCALE: () => {
                return window.GROK_SELECTORS.findFirst([
                    'div[role="menuitem"]:has(svg path[d^="M11.7503 2.0835"])', // Upscale Video SVG
                    () => window.GROK_SELECTORS.findByText('div[role="menuitem"]', 'Upscale')
                ]);
            },
            SPICY: () => window.GROK_SELECTORS.findByText('div[role="menuitem"]', 'Spicy'),
            NORMAL: () => window.GROK_SELECTORS.findByText('div[role="menuitem"]', 'Normal')
        },

        SHARED: {
            POPOVER: '[data-radix-menu-content]',
            BACK_BTN: '[data-testid="modal-close-button"], button[aria-label="Close"], button[aria-label="Back"]',
            ACTIVE_POST: '[data-post-id].is-active, [data-post-id][aria-current="page"]',
            FILM_ICON_SELECTOR: 'svg[class*="lucide-film"]'
        },

        // =========================================================================
        // 3. UTILITIES
        // =========================================================================
        // Utility functions to find elements dynamically
        findFirst: function (selectorArray, root = document) {
            if (!Array.isArray(selectorArray)) {
                if (typeof selectorArray === 'function') {
                    try { return selectorArray() || null; } catch (e) { return null; }
                }
                return root.querySelector(selectorArray);
            }
            for (const selector of selectorArray) {
                try {
                    if (typeof selector === 'function') {
                        const el = selector();
                        if (el) return el;
                    } else {
                        const el = root.querySelector(selector);
                        if (el) return el;
                    }
                } catch (e) { /* Ignore */ }
            }
            return null;
        },

        findByText: function (selector, text, root = document) {
            const elements = root.querySelectorAll(selector);
            for (const el of elements) {
                if (el.textContent && el.textContent.trim() === text) return el;
                const sr = el.querySelector('.sr-only');
                if (sr && sr.textContent && sr.textContent.trim() === text) return el;
                if (el.innerText && el.innerText.trim() === text) return el;
            }
            return null;
        },

        exists: function (selectorArray, root = document) {
            return !!this.findFirst(selectorArray, root);
        },

        // =========================================================================
        // 4. LEGACY ALIASES (Backwards Compatibility)
        // =========================================================================
        get TEXTAREA() {
            return {
                get VIDEO() { return window.GROK_SELECTORS.FEATURES.GENERATOR.sendToGenerator.MAIN_INPUT; },
                get IMAGE_EDIT() { return window.GROK_SELECTORS.FEATURES.IMAGE_EDIT.monitorAndEdit.EDIT_INPUT; },
                get MASONRY() { return window.GROK_SELECTORS.FEATURES.IMAGE_EDIT.monitorAndEdit.EDIT_INPUT; } // Shared
            };
        },

        get BUTTON() {
            return {
                get MAKE_VIDEO() { return window.GROK_SELECTORS.FEATURES.GENERATOR.sendToGenerator.SUBMIT_BUTTON; },
                get SUBMIT() { return window.GROK_SELECTORS.FEATURES.GENERATOR.sendToGenerator.SUBMIT_BUTTON; }, // Shared
                get EDIT_IMAGE() { return window.GROK_SELECTORS.FEATURES.IMAGE_EDIT.monitorAndEdit.SUBMIT_EDIT_BTN; },
                get FAVORITES() { return window.GROK_SELECTORS.FEATURES.UPLOAD._navigateToGallery.FAVORITES_BTN; },
                get SAVED() { return window.GROK_SELECTORS.FEATURES.UPLOAD._navigateToGallery.FAVORITES_BTN; },
                get SETTINGS_2026() { return window.GROK_SELECTORS.FEATURES.IMAGE_EDIT.runDiagnostics.SETTINGS_BTN; },
                get REMOVE_IMAGE() { return window.GROK_SELECTORS.FEATURES.UPLOAD.handleModerationDetected.REMOVE_BUTTON; },
                get SUBMIT_VIDEO_2026() { return window.GROK_SELECTORS.FEATURES.GENERATOR.sendToGenerator.SUBMIT_BUTTON; }
            };
        },

        get INDICATORS() {
            return {
                get MODERATION() { return window.GROK_SELECTORS.FEATURES.UPLOAD.handleModerationDetected.ERROR_ICON; }
            };
        },

        // Legacy Flow Objects (Heavily used in ReactAutomation.js)
        get VIDEO_FLOW() {
            return {
                get INPUT() { return window.GROK_SELECTORS.FEATURES.GENERATOR.sendToGenerator.MAIN_INPUT; },
                get SETTINGS_BUTTON() { return window.GROK_SELECTORS.FEATURES.IMAGE_EDIT.runDiagnostics.SETTINGS_BTN; }
            };
        },

        get EDIT_IMAGE_FLOW() {
            return {
                get INPUT() { return window.GROK_SELECTORS.FEATURES.IMAGE_EDIT.monitorAndEdit.EDIT_INPUT; },
                get SUBMIT_BUTTON() { return window.GROK_SELECTORS.FEATURES.IMAGE_EDIT.monitorAndEdit.SUBMIT_EDIT_BTN; },
                get SETTINGS_BUTTON() { return window.GROK_SELECTORS.FEATURES.IMAGE_EDIT.runDiagnostics.SETTINGS_BTN; },
                get FIRST_THUMBNAIL() {
                    // Legacy Hardcode + New Fallbacks from DOM Map
                    return window.GROK_SELECTORS.findFirst([
                        'div.snap-y.snap-mandatory button:first-of-type', // Legacy
                        'button:has(img[alt^="Thumbnail"])', // Generic alt match
                        'button:has(img[src^="data:image"])', // Data URI match

                        // Fallback for Single Post View (no carousel)
                        'div.flex:not(.snap-y) > button:has(img)',
                        'button:has(img):not([aria-label])',
                        'div.flex.gap-2.overflow-x-auto button:first-child'
                    ]);
                },
                get EDIT_IMAGE_MENU_ITEM() { return window.GROK_SELECTORS.MENU_ITEMS.EDIT_IMAGE; },
                get STRICT_VALIDATION() {
                    return {
                        get INVALID_SUBMIT() { return window.GROK_SELECTORS.FEATURES.GENERATOR.sendToGenerator.SUBMIT_BUTTON; }
                    };
                }
            };
        },

        get CONTAINERS() {
            return {
                get UPLOAD_PREVIEW() { return window.GROK_SELECTORS.FEATURES.UPLOAD._startModerationWatcher.PREVIEW_CONTAINER; }
            };
        },

        // Static Paths (Keep these top level or aliased)
        PATHS: {
            GALLERY: ['/imagine/saved', '/imagine/favorites', '/imagine'],
            POST_PATTERN: /^\/imagine\/post\/([a-z0-9-]+)$/i,
            EDIT_PATTERN: /^\/imagine\/edit\//i
        }
    };

    window.Logger?.info?.('Selectors', 'GROK_SELECTORS initialized successfully');

} catch (e) {
    console.error('CRITICAL: Selectors failed to load', e);
    window.Logger?.error?.('Selectors', 'CRITICAL FAILURE', e);
}
