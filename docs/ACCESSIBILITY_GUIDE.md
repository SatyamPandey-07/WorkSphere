# ♿ WorkSphere Accessibility (a11y) Testing Guide

_This guide provides standardized instructions for contributors to test, audit, and verify accessibility (a11y) across all WorkSphere components using automated tools (axe-core / Axe DevTools), manual keyboard navigation, and screen readers._

---

## 1. Overview & Accessibility Goals

WorkSphere adheres to the **WCAG 2.1 Level AA** standards. All components must ensure:
- **Perceivable**: Text alternatives for non-text content, proper color contrast (minimum $4.5:1$ for normal text, $3:1$ for large text/UI elements), and adaptable layouts.
- **Operable**: Full keyboard accessibility without traps, clear focus indicators, predictable tab orders, and accessible modal dismissal.
- **Understandable**: Clear labels, intuitive error states, and predictable interactive controls.
- **Robust**: Compatible with assistive technologies (screen readers) via valid semantic HTML and ARIA attributes.

---

## 2. Automated Auditing with Axe (axe-core & Browser Extension)

Automated accessibility testing catches 40–50% of common accessibility defects, including color contrast failures, missing ARIA attributes, duplicate IDs, and unassociated form labels.

### 2.1 Installing & Running Axe DevTools Browser Extension
1. Install the **Axe DevTools - Web Accessibility Testing** extension for [Chrome](https://chromewebstore.google.com/detail/axe-devtools-web-accessib/lhdoppojpmngadmnindnejefpokejbdd) or [Firefox](https://addons.mozilla.org/en-US/firefox/addon/axe-devtools/).
2. Start the WorkSphere local development server:
   ```bash
   npm run dev
   ```
3. Open your browser and navigate to the page you modified (e.g., `http://localhost:3000` or `http://localhost:3000/venues/1`).
4. Open Chrome DevTools (`F12` or `Ctrl + Shift + I` / `Cmd + Option + I`).
5. Select the **axe DevTools** tab.
6. Click **"Scan FULL PAGE"** or click **"Scan PART OF MY PAGE"** to target a specific modal, form, or dialog component.
7. Review the findings categorized by severity:
   - **Critical / Serious**: Must be resolved before opening a PR (e.g., missing form labels, non-accessible buttons).
   - **Moderate / Minor**: Should be addressed or documented.

### 2.2 Automated Unit Testing with `jest-axe`
When writing unit tests for custom React components, you can integrate `axe-core` directly:

```tsx
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { AmbientNoiseTrendGraph } from "@/components/noise/AmbientNoiseTrendGraph";

expect.extend(toHaveNoViolations);

describe("AmbientNoiseTrendGraph a11y audit", () => {
  it("should have no automated accessibility violations", async () => {
    const { container } = render(
      <AmbientNoiseTrendGraph venueId="test-venue-id" />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

---

## 3. Manual Keyboard Navigation Checklist

Automated scanners cannot verify tab order sequence, logical focus traps, or keyboard usability. Every interactive component must pass this manual keyboard checklist:

| Check | Key(s) | Expected Behavior |
| :--- | :--- | :--- |
| **Tab Order** | `Tab` | Moves focus forward through interactive elements in logical visual order (top-to-bottom, left-to-right). Never skips essential elements. |
| **Reverse Tab Order** | `Shift + Tab` | Moves focus backward through interactive elements without losing sequence. |
| **Focus Indicator** | Any | All interactive elements display a clear, visible focus ring (e.g., `focus-visible:ring-2 focus-visible:ring-blue-500`). Never remove outline with `outline: none` without providing an accessible alternative. |
| **Activation** | `Enter` / `Space` | Buttons, links, checkboxes, and toggles can be activated via `Enter` or `Space`. |
| **Modal Focus Trap** | `Tab` / `Shift + Tab` | When a modal dialog opens, focus automatically lands inside the modal and **cannot escape** to background page elements while the modal is active. |
| **Escape Key Dismissal** | `Escape` | Pressing `Escape` immediately closes open modals, popovers, dropdown menus, and tooltips, returning focus to the element that triggered it. |
| **Arrow Key Navigation** | `↑` `↓` `←` `→` | For custom tab lists, radio groups, slider handles, and listboxes (`role="tablist"`, `role="radiogroup"`), navigation occurs using arrow keys. |

### Modal Focus Management Pattern
When building custom dialogs:
1. **Initial Focus**: Move focus to the first focusable interactive element or the dialog title when opened.
2. **Inert Background**: Set `aria-hidden="true"` or HTML `inert` on the background container so background elements cannot be focused.
3. **Restoring Focus**: When closed, focus must immediately return to the button that triggered the modal.

---

## 4. Screen Reader Testing Instructions

Screen readers convert visual UI structures into speech or braille. Test critical user journeys (venue search, filter selection, booking flows, and noise reporting) using the built-in screen reader for your operating system.

### 4.1 Testing with VoiceOver (macOS / iOS)

VoiceOver is built into macOS and iOS with zero installation required.

- **Enable VoiceOver**: Press `Cmd + F5` (or click Touch ID three times).
- **VoiceOver Key (VO)**: `Control + Option` (or `Caps Lock`).
- **Core Navigation Shortcuts**:
  - `VO + Right Arrow`: Read next element.
  - `VO + Left Arrow`: Read previous element.
  - `VO + Space`: Activate button, link, or toggle.
  - `VO + U`: Open the **VoiceOver Rotor** (inspect landmarks, headings, links, form controls, and tables).
  - `VO + Shift + Down Arrow`: Interact with a container/group.
  - `VO + Shift + Up Arrow`: Stop interacting with container.

#### VoiceOver Verification Checklist:
- [ ] Are buttons announced with their role (e.g., `"Directions, button"`, not just `"Directions"`)?
- [ ] Are icon-only buttons provided with an `aria-label` (e.g., `"Close dialog, button"`)?
- [ ] Are headings structured in logical hierarchy (`H1` $\to$ `H2` $\to$ `H3`) in the Rotor?
- [ ] Are live status updates announced via `aria-live="polite"` or `role="status"` (e.g., "3 venues found")?

---

### 4.2 Testing with NVDA (Windows)

[NVDA (NonVisual Desktop Access)](https://www.nvaccess.org/download/) is a free, open-source screen reader for Windows.

- **Start NVDA**: Press `Ctrl + Alt + N` (or launch from desktop).
- **Stop NVDA**: Press `NVDA + Q`.
- **NVDA Key**: `Insert` (or `Caps Lock`).
- **Core Navigation Shortcuts**:
  - `NVDA + Down Arrow`: Start reading continuous page content.
  - `Tab` / `Shift + Tab`: Jump through interactive elements.
  - `H`: Jump to next heading (`Shift + H` for previous).
  - `1` through `6`: Jump to heading level 1 through 6.
  - `F`: Jump to next form field.
  - `B`: Jump to next button.
  - `K`: Jump to next link.
  - `NVDA + F7`: Open Elements List (tree list of headings, links, landmarks).

#### NVDA Verification Checklist:
- [ ] Does NVDA announce the state of toggles and expandable sections (`"collapsed"` vs `"expanded"`)?
- [ ] Are form error messages announced immediately when validation fails?
- [ ] Are tables announced with column and row headers?

---

## 5. Pre-Commit a11y Verification Summary

Before submitting any Pull Request:
1. **Automated Axe Scan**: Run Axe DevTools on the affected views—zero critical/serious violations.
2. **Keyboard Traversal**: Unplug/disable your mouse. Perform the complete user flow using only `Tab`, `Shift + Tab`, `Enter`, `Space`, and `Escape`.
3. **Color Contrast Check**: Ensure all badge and text colors meet the $4.5:1$ threshold in both Light and Dark themes.
4. **Touch Target Sizing**: Interactive buttons and links must have a minimum touch target size of at least $44 \times 44\text{ px}$ on mobile screens.
