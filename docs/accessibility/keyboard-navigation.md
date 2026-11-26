# Keyboard Navigation & Landmarks Architecture

This document describes the implementation, structure, and verification guidelines for keyboard navigation and landmark accessibility within **WorkSphere**, focusing on the `SkipToContent` link and landmark structure.

---

## 1. SkipToContent Anchor Link to `#main-content`

The `SkipToContent` component provides keyboard and screen-reader users with a direct bypass mechanism to jump over repetitive header and navigation links straight to the primary view.

### Anchor Pairing Architecture
- The skip component renders an anchor element pointing to `#main-content`:
  ```tsx
  <a
    href="#main-content"
    className="skip-to-content"
    data-testid="skip-to-content"
  >
    Skip to main content
  </a>
  ```
- The primary layout container defines the matching `id="main-content"` target:
  ```tsx
  <main
    id="main-content"
    tabIndex={-1}
    data-testid="main-content"
    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-offset-slate-950"
  >
    {children}
  </main>
  ```
- `tabIndex={-1}` enables programmatic focus shifting to `<main>` when the link is activated without placing the container into the regular <kbd>Tab</kbd> sequence.

---

## 2. Visually Hidden by Default & `:focus` Visibility

To prevent visual clutter for mouse users while ensuring immediate discoverability for keyboard navigation:

### Off-Screen Positioning (Default State)
By default, the skip link is clipped or shifted entirely off-screen using standard accessible utility styles (e.g. Tailwind `sr-only` or negative offsets):
```css
.skip-to-content {
  position: absolute;
  top: -9999px;
  left: -9999px;
  z-index: 100;
  padding: 0.75rem 1.25rem;
  font-weight: 600;
  border-radius: 0.375rem;
  background-color: var(--primary-bg, #0f172a);
  color: var(--primary-fg, #ffffff);
  transition: top 0.2s ease-in-out;
}
```

### Revealing on `:focus` / `:focus-visible`
When a keyboard user presses <kbd>Tab</kbd> upon initial page load:
1. The skip link receives keyboard focus first.
2. The CSS `:focus` / `:focus-visible` pseudoclass overrides off-screen positioning and animates the banner into view at the top of the viewport.
```css
.skip-to-content:focus,
.skip-to-content:focus-visible {
  top: 1rem;
  left: 1rem;
  outline: 2px solid #22d3ee;
  outline-offset: 2px;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
}
```

---

## 3. Keyboard Navigation & Focus Behavior

### Traversal Sequence
1. **Initial Tab Press**: Moves focus directly to `SkipToContent`.
2. **Pressing <kbd>Enter</kbd> on Skip Link**:
   - Skips navigation menus.
   - Places browser focus directly onto `<main id="main-content">`.
   - The subsequent <kbd>Tab</kbd> press begins inside the first interactive element within `<main>` (e.g., search input, filter pills, or venue cards).
3. **Pressing <kbd>Tab</kbd> Without Activating**:
   - Moves focus sequentially into global header elements: Logo &rarr; Navigation Links &rarr; Search Button (<kbd>⌘K</kbd>) &rarr; User Profile &rarr; Page Body.

---

## 4. Semantic Landmark Structure

WorkSphere structures pages with standard HTML5 semantic elements paired with ARIA landmark roles so assistive technologies (screen readers) can jump between high-level page regions:

```
┌─────────────────────────────────────────────────────────────┐
│ <header role="banner">                                      │
│   ├── Logo / Home Link                                      │
│   └── <nav role="navigation" aria-label="Main Navigation">  │
│         └── Workspace / Explore / Bookings Links            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ <main id="main-content" role="main" tabIndex={-1}>          │
│   ├── Page Title (<h1>)                                     │
│   ├── Search & Filter Controls                              │
│   └── Venue Cards / Interactive Data Panels                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ <footer role="contentinfo">                                 │
│   └── Legal, Language Switcher, and Support Links           │
└─────────────────────────────────────────────────────────────┘
```

### Landmark Definitions & Roles

| HTML5 Element | Landmark Role | Purpose | ARIA Annotation |
| :--- | :--- | :--- | :--- |
| `<header>` | `banner` | Site branding, global actions, user session info. | Primary top-level header |
| `<nav>` | `navigation` | Primary and secondary site navigation links. | `aria-label="Main Navigation"` |
| `<main>` | `main` | Unique, primary content of the document. | `id="main-content" tabIndex={-1}` |
| `<aside>` | `complementary` | Contextual tools (e.g. ambient noise sliders, map drawer). | `aria-label="Venue Controls"` |
| `<footer>` | `contentinfo` | Copyright, terms, privacy, platform credits. | Page footer |

---

## 5. How Users Navigate WorkSphere Pages Using Keyboard Only

| Key Combination | Action | Scope |
| :--- | :--- | :--- |
| <kbd>Tab</kbd> | Move focus forward to next interactive element | Global |
| <kbd>Shift</kbd> + <kbd>Tab</kbd> | Move focus backward to previous interactive element | Global |
| <kbd>Enter</kbd> | Activate link, primary button, or toggle expanders | Focused control |
| <kbd>Space</kbd> | Toggle checkbox, radio button, or button trigger | Focused control |
| <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> | Open global venue search drawer from anywhere | Global shortcut |
| <kbd>Escape</kbd> | Close active modal, dropdown menu, or drawer and return focus | Active overlay |
| <kbd>&uarr;</kbd> / <kbd>&darr;</kbd> | Navigate inside dropdowns, listboxes, and menu items | Focused widget |

---

## 6. Practical Keyboard Accessibility Verification Steps

Follow this checklist to verify compliance with WCAG 2.1 / 2.2 Level AA requirements (SC 2.4.1 Bypass Blocks, SC 2.4.7 Focus Visible, SC 2.1.1 Keyboard):

1. **Test Skip Link Visibility**:
   - Reload any WorkSphere page in a clean browser window.
   - Press <kbd>Tab</kbd> once.
   - Verify that the **"Skip to main content"** banner appears prominently at the top-left with high contrast.
2. **Verify Focus Transfer**:
   - Press <kbd>Enter</kbd> while the skip link is focused.
   - Press <kbd>Tab</kbd> again.
   - Verify focus lands directly on the first focusable control inside `<main>` (e.g. search input or filter pill), completely bypassing navigation links.
3. **Check Focus Outline Contrast**:
   - Navigate through controls via <kbd>Tab</kbd>.
   - Ensure every element displays a visible focus indicator (e.g., `ring-2 ring-indigo-500` or `ring-cyan-400`).
4. **Inspect Landmark Tree in Assistive Tools**:
   - In Chrome DevTools, open **Accessibility Tree View** or run NVDA / VoiceOver (<kbd>VO</kbd> + <kbd>U</kbd> &rarr; Landmarks).
   - Ensure `banner`, `navigation`, `main`, and `contentinfo` landmarks appear in logical order without duplicates.
5. **Verify No Keyboard Traps**:
   - Ensure modals, slide-overs, and popovers trap focus while open and release/restore focus cleanly upon <kbd>Escape</kbd>.
