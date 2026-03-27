# UI Style Guide: Grok Video Prompter Extension

**Last Updated**: 2025-12-04 (v1.20)  
**Target Files**: `src/content/constants/stylesheet.js`  
**Associated KI**: grok_video_prompter  
**Purpose**: Comprehensive color palette and component styling reference extracted from Grok.com's design system.

---

## 1. High-Level Intent

Defines the comprehensive visual language, color palette, and component styling for the extension. This ensures a consistent "native" feel within the Grok web interface using pure CSS injected via Shadow DOM.

## 2. Technical Architecture

* **Implementation:** Styles are defined as a template string in `GVP_STYLESHEET` within `stylesheet.js`.  
* **Injection:** Injected into the Shadow Root by `UIManager` during initialization.  
* **Isolation:** All styles are scoped to `#gvp-shadow-host` to prevent bleeding.

## 3. Critical Constraints (The "Do Not Touch" List)

🔴 **WARNING:**

* **No External CSS:** Do NOT use Tailwind, Bootstrap, or external stylesheets. All styles must be raw CSS in `stylesheet.js`.  
* **Dark Theme Only:** The UI is strictly Dark Mode to match Grok. Do not implement light mode overrides.  
* **Tight Spacing:** Adhere to the ≤8px vertical gap rule.  
* **Font:** Use system fonts (-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto) to match the host OS.

---

## Core Color Palette

### Background Colors (Dark Theme)
| Color Name | Hex Code | Usage |
|------------|----------|-------|
| **Primary Background** | `#141414` | Main drawer, modals, containers |
| **Secondary Background** | `#212121` | Buttons, cards, inputs (default state) |
| **Tertiary Background** | `#181818` | Accordion headers, slight elevation |
| **Hover Background** | `#262626` | Interactive element hover states |
| **Active Background** | `#343434` | Active/pressed state for buttons |
| **Deep Black** | `#050505` | Placeholder backgrounds |

### Border Colors
| Color Name | Hex Code | Usage |
|------------|----------|-------|
| **Primary Border** | `#48494b` | Standard borders for all elements |
| **Hover Border** | `#4E4E4E` | Hover/focus state borders |
| **Dim Border** | `rgba(72, 73, 75, 0.6-0.9)` | Subtle borders, overlays |

### Text Colors
| Color Name | Hex Code | Usage |
|------------|----------|-------|
| **Pure White** | `#ffffff` | Active tabs, primary headings, selected items |
| **Primary Text** | `#f4f4f5` | Main content text, labels |
| **Secondary Text** | `#e5e7eb` | Accent text, hover states |
| **Muted Text** | `#a3a3a3` | Labels, placeholders, hints |
| **Disabled Text** | `#64748b` - `#4b5563` | Disabled/inactive text |
| **Section Headers** | `#4E4E4E` | Section titles (uppercase) |

### Accent Colors
| Color Name | Hex Code | Usage |
|------------|----------|-------|
| **Active Indicator (Red)** | `#ef4444` | Active states, spicy mode |
| **Danger/Delete (Red)** | `#b91c1c` - `#dc2626` | Destructive actions |
| **Warning (Amber)** | `#fbbf24` - `#f59e0b` | Sliders, warning states |
| **Progress Gradient** | `linear-gradient(90deg, #f4f4f5, #e5e7eb)` | Progress bars |

---

## Component Styles

### Buttons

#### Standard Button (`.gvp-button`)
```css
background: #212121;
color: #f4f4f5;
border: 1px solid #48494b;
border-radius: 6px;
padding: 8px 12px;
font-size: 11px;
font-weight: 600;
```
**Hover**: `background: #262626`

#### Primary Button (`.gvp-button.primary`)
```css
background: #262626;
border: 1px solid #48494b;
color: #f4f4f5;
```
**Hover**: `background: #343434`

#### Emoji Button (`.gvp-emoji-btn`)
```css
width: 32px;
height: 32px;
background: #212121;
color: #a3a3a3;
border: 1px solid #48494b;
border-radius: 4px;
font-size: 16px;
```
**Active State**: `background: rgba(239, 68, 68, 0.1);` `color: #ef4444;`

#### Ghost Button (`.gvp-button.ghost`)
```css
background: rgba(38, 38, 38, 0.6);
border: 1px solid rgba(72, 73, 75, 0.9);
color: #f4f4f5;
```
**Hover**: `background: rgba(52, 52, 52, 0.9)`

#### Micro Button (`.gvp-mg-micro-btn`)
```css
width: 22px;
height: 22px;
background: #262626;
border: 1px solid #48494b;
color: #f4f4f5;
border-radius: 4px;
font-size: 12px;
```
**Hover**: `background: #343434;` `border-color: #5a5a5a;` `transform: scale(1.05);`

---

### Inputs & Textareas

#### Standard Input (`.gvp-input`, `.gvp-select`)
```css
background: #212121;
color: #ffffff;
border: 1px solid #48494b;
border-radius: 6px;
padding: 8px 12px;
font-size: 12px;
```
**Focus**: `border-color: #4E4E4E;` `box-shadow: 0 0 0 2px rgba(78, 78, 78, 0.1);`

#### Textarea (`.gvp-textarea`)
```css
background: #212121;
color: #ffffff;
border: 1px solid #48494b;
border-radius: 6px;
padding: 8px;
font-size: 11px;
line-height: 1.4;
min-height: 120px;
resize: none;
```
**Focus**: `outline: 2px solid #262626;` `border-color: #262626;`

---

### Tabs

#### Tab Container (`#gvp-tabs`)
```css
background: rgba(20, 20, 20, 0.5);
border-bottom: 1px solid #48494b;
height: 40px;
gap: 2px;
padding: 0 6px;
```

#### Tab (`.gvp-tab`)
```css
background: transparent;
color: #a3a3a3;
border: none;
border-bottom: 3px solid transparent;
padding: 6px 10px;
font-size: 10.5px;
font-weight: 500;
flex: 1;
```
**Hover**: `background: #262626;` `color: #9e9e9e;`  
**Active**: `background: #212121;` `color: #ffffff;` `border-bottom-color: #48494b;` `font-weight: 600;`

---

### Accordions

#### Accordion Container (`.gvp-accordion`)
```css
background: #212121;
border: 1px solid #48494b;
border-radius: 6px;
overflow: hidden;
```

#### Accordion Header (`.gvp-accordion-header`)
```css
background: #212121;
color: #f4f4f5;
padding: 10px 12px;
font-size: 11px;
font-weight: 600;
letter-spacing: 0.3px;
cursor: pointer;
```
**Hover**: `background: #212121`  
**Active**: `background: #212121;` `border-bottom: 1px solid #4b5563;`

#### Accordion Content (`.gvp-accordion-content`)
```css
background: #141414;
max-height: 0;
overflow: hidden;
transition: max-height 0.3s ease;
```
**Open**: `max-height: 2000px;` `padding: 12px;`

---

### Cards

#### Standard Card (`.gvp-category-card`)
```css
background: #212121;
border: 1px solid #48494b;
border-radius: 6px;
padding: 10px;
color: #f4f4f5;
font-size: 11px;
font-weight: 600;
box-shadow: 0 1px 3px rgba(0,0,0,0.25);
```
**Hover**: `background: #262626;` `transform: translateY(-4px);` `box-shadow: 0 8px 16px rgba(0,0,0,0.5);`

#### Multi-Gen History Card (`.gvp-mg-card`)
```css
background: #212121;
border: 1px solid #48494b;
border-radius: 8px;
padding: 12px;
transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
```
**Hover**: `border-color: #48494b;` `transform: translateY(-1px);`  
**Expanded**: `border-color: #48494b;` `box-shadow: 0 16px 28px rgba(8, 15, 35, 0.55);`

---

### Modals

#### Full Modal Background
```css
background: rgba(0, 0, 0, 0.8-0.85);
z-index: 10003-10004;
```

#### Modal Container
```css
background: #141414;
border: 1px solid #48494b;
border-radius: 8-12px;
box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8-0.95);
```

#### Modal Header
```css
background: #212121;
border-bottom: 2px solid #262626;
padding: 12-20px 16-24px;
color: #fcfcfc;
font-size: 18px;
font-weight: 600;
```

#### Modal Close Button
```css
background: transparent;
border: none;
color: #a3a3a3;
width: 32px;
height: 32px;
border-radius: 50%;
```
**Hover**: `background: #b91c1c;` `color: white;`

---

### Launcher (Sidebar)

#### Launcher Button (`.gvp-launcher-btn`)
```css
background: transparent;
color: #f4f4f5;
border: none;
font-size: 9px;
font-weight: 800;
letter-spacing: 0.7px;
text-transform: uppercase;
writing-mode: vertical-rl;
```

#### Launcher Tab (`.gvp-launcher-tab`)
```css
background: #212121;
color: #e2e8f0;
border: 1px solid rgba(15,23,42,0.6);
border-radius: 10px 0 0 10px;
font-size: 9px;
font-weight: 700;
text-transform: uppercase;
writing-mode: vertical-rl;
padding: 6px 3px;
min-height: 68px;
```
**Hover**: `background: #262626`  
**Active**: `background: #404040;` `color: #ffffff;` `border-color: #4E4E4E;`

---

### Progress Bars

#### Standard Progress Bar
```css
background: #1a1f2e;
height: 6px;
border-radius: 3px;
overflow: hidden;
```

#### Progress Fill
```css
background: linear-gradient(90deg, #f4f4f5, #e5e7eb);
height: 100%;
border-radius: 3px;
transition: width 0.3s ease;
```

#### Multi-Gen Progress Fill (Inline)
```css
background: linear-gradient(90deg, #262626, #343434);
height: 6px;
border-radius: 3px;
transition: width 0.3s ease;
```

---

### Status Indicators

#### Idle Status Badge
```css
background: rgba(107, 114, 128, 0.2);
color: #a3a3a3;
border: 1px solid #4b5563;
```

#### Generating Status Badge
```css
background: rgba(78, 78, 78, 0.2);
color: #a3a3a3;
border: 1px solid #4E4E4E;
animation: pulse-gray 2s infinite;
```

#### Warning/Moderated Status Badge
```css
background: rgba(251, 191, 36, 0.2);
color: #4E4E4E;
border: 1px solid #4E4E4E;
animation: pulse-warning 2s infinite;
```

---

### Checkboxes

#### Standard Checkbox
```css
width: 18px;
height: 18px;
cursor: pointer;
accent-color: #4E4E4E;
```

---

### Scrollbars (WebKit)

```css
::-webkit-scrollbar {
    width: 8px;
}

::-webkit-scrollbar-track {
    background: #141414;
}

::-webkit-scrollbar-thumb {
    background: #48494b;
    border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
    background: #48494b;
}
```

---

## Layout Spacing Rules

### Mandatory Spacing Limits
- **Vertical gaps**: ≤8px between elements
- **Horizontal gaps**: ≤10px between elements
- **Labels to inputs**: 0-4px gap
- **Container padding**: 4-8px minimum (only what preserves clarity)
- **Tab gap**: 2px
- **Button gaps**: 6-8px
- **Accordion gaps**: 8px
- **Card gaps**: 12-16px

### Common Gap Values
- **Tight**: `gap: 4px` (launcher stacks, tight rows)
- **Standard**: `gap: 6-8px` (most use cases)
- **Sections**: `gap: 12-16px` (section separation)

### Visual Layout Patterns (Official)

#### The "Grid Dashboard" Pattern
(As seen in visual references)

* **Structure:** Two-column grid layout (`display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));`).  
* **Item Sizing:** Large, square-ish touch targets for main categories (approx 100-120px height).  
* **Gap:** 6px column gap, 50px row gap (or adjust to fit density).  
* **Text Alignment:** Center-aligned, bold, white text.  
* **Usage:** Use this pattern for the main navigation or category selection screens (e.g., JSON Editor Tab).

#### The "Sidebar Launcher" Pattern

* **Position:** Fixed to the left edge of the drawer.  
* **Style:** Vertical stack of icon-only buttons (width: 28px).  
* **State:** Active state indicated by border-left or background highlight.

---

## Mandatory Design Rules

1. **Color Consistency**: Use ONLY colors from the Core Color Palette
2. **Background**: Default to `#141414` (primary) or `#212121` (secondary)
3. **Borders**: Always use `#48494b` for standard borders
4. **Text**: Default to `#ffffff` for active/important text, `#f4f4f5` for body, `#a3a3a3` for muted
5. **Hover States**: Use `#262626` backgrounds and `#4E4E4E` borders
6. **Active States**: Use `#343434` backgrounds and `#48494b` borders
7. **Button Radius**: `border-radius: 4-6px` (4px for emoji buttons, 6px for standard)
8. **Card Radius**: `border-radius: 6-8px`
9. **Modal Radius**: `border-radius: 8-12px`
10. **Font Sizes**: 
    - Body: 11-12px
    - Labels: 11px uppercase
    - Headers: 13-18px
    - Micro buttons: 12px
11. **Shadows**: Use subtle shadows: `0 1px 3px rgba(0,0,0,0.25)` to `0 20px 50px rgba(0,0,0,0.8)`
12. **Transitions**: `transition: all 0.2s ease` for most interactive elements
13. **No Blue**: Never use blue for UI elements (removed in standardization)
14. **Red Accents**: Use `#ef4444` sparingly for active indicators only
15. **Tight Spacing**: Follow Layout Spacing Rules strictly

---

## Quick Reference: Common Patterns

### Button Pattern
```css
background: #212121;
border: 1px solid #48494b;
color: #f4f4f5;
border-radius: 6px;
padding: 8px 12px;
font-size: 11px;
font-weight: 600;
transition: all 0.2s ease;

&:hover {
    background: #262626;
}

&.active {
    background: #343434;
}
```

### Input Pattern
```css
background: #212121;
border: 1px solid #48494b;
color: #ffffff;
border-radius: 6px;
padding: 8px 12px;
font-size: 12px;

&:focus {
    outline: none;
    border-color: #4E4E4E;
    box-shadow: 0 0 0 2px rgba(78, 78, 78, 0.1);
}
```

### Card Pattern
```css
background: #212121;
border: 1px solid #48494b;
border-radius: 6px;
padding: 12px;
box-shadow: 0 1px 3px rgba(0,0,0,0.25);

&:hover {
    background: #262626;
    transform: translateY(-2px);
    box-shadow: 0 8px 16px rgba(0,0,0,0.5);
}
```

---

## Testing Checklist

When creating new UI elements, verify:
- [ ] All colors are from the Core Color Palette
- [ ] Spacing follows mandatory limits (≤8px vertical, ≤10px horizontal)
- [ ] Hover states use `#262626` background
- [ ] Active states use `#343434` background
- [ ] Borders use `#48494b` (standard) or `#4E4E4E` (hover/focus)
- [ ] Text uses appropriate color (`#ffffff`, `#f4f4f5`, or `#a3a3a3`)
- [ ] Border radius is consistent (4-6px buttons, 6-8px cards)
- [ ] Transitions are smooth (`0.2s ease`)
- [ ] No blue colors present
- [ ] Shadows are subtle (if used)
- [ ] Font sizes are appropriate (11-12px body, 11px labels)

---

## Version History

| Date | Version | Agent Action | Technical Change |
| :---- | :---- | :---- | :---- |
| 2025-11-26 | 1.18.13 | Merge | Merged 8_UI_Style_Guide.md with 5_UI_Style_Guide.md - Combined comprehensive styling details with standardized structure. |
| 2025-11-26 | 1.18.12 | Update | Added "Grid Dashboard" layout pattern based on visual reference. |
| 2025-11-26 | 1.18.11 | Create | Initial codified style guide based on stylesheet.js. |
