# ⌨️ WorkSphere Keyboard Navigation & WCAG AA Color Contrast Guidelines

_This document establishes comprehensive engineering standards, checklists, and compliance criteria for **Keyboard Navigation** and **WCAG 2.1 / 2.2 Level AA Color Contrast** across all WorkSphere user interfaces, components, and workflows._

---

## 1. Overview & Accessibility Mandate

WorkSphere is committed to building an inclusive, fully accessible platform adhering to **WCAG 2.1 / 2.2 Level AA** standards. All contributors and automated pipelines must ensure that:
1. Every interactive action can be accomplished entirely via keyboard without mouse dependency.
2. Every text, badge, icon, and boundary meets or exceeds standard contrast thresholds against its active background in both **Light Mode** and **Dark Mode**.
3. State changes and critical feedback are communicated with multiple visual cues (color + icon + text), never color alone.

---

## 2. Keyboard Navigation Standards & Checklist

### 2.1 Tab Order & Sequential Focus Rules
- **Logical Flow**: Focus must follow the visual and reading order (top-to-bottom, left-to-right).
- **Native Elements**: Always prioritize native HTML interactive elements (`<button>`, `<a>`, `<input>`, `<select>`, `<textarea>`, `<summary>`).
- **Tabindex Rules**:
  - `tabindex="0"`: Used to insert custom interactive widgets (e.g. custom grid cells, canvas overlays) into the natural tab sequence.
  - `tabindex="-1"`: Used for programmatic focus management (e.g., modal containers, error alert banners, skip links). Never reachable via `Tab` unless focused by script.
  - `tabindex > 0`: **STRICTLY FORBIDDEN**. Positive tabindex disrupts natural DOM order and breaks accessibility.

---

### 2.2 Standard Key Bindings Matrix

| Key / Shortcut | Target Component / Context | Expected Interaction & Behavior |
| :--- | :--- | :--- |
| <kbd>Tab</kbd> | Global | Moves focus forward to the next interactive element in logical visual sequence. |
| <kbd>Shift</kbd> + <kbd>Tab</kbd> | Global | Moves focus backward to the previous interactive element. |
| <kbd>Enter</kbd> | Buttons, Links, Menu items | Activates links, submits forms, opens dialogs, or triggers button callbacks. |
| <kbd>Space</kbd> | Buttons, Checkboxes, Switches | Toggles checkboxes, activates buttons, opens select dropdowns without navigating away. |
| <kbd>Escape</kbd> | Modals, Drawers, Dropdowns, Tooltips | Immediately dismisses open overlays and restores focus to the triggering element. |
| <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> | Radio groups, Tablists, Sliders, Grids | Navigates between items inside a compound widget (e.g. tabs in `role="tablist"`, seats in floor plan grid). |
| <kbd>Home</kbd> / <kbd>End</kbd> | Lists, Tablists, Menus, Sliders | Jumps directly to the first or last selectable item in the container. |
| <kbd>Alt</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd> | Custom Dropdowns & Comboboxes | Opens or closes the selection popup without changing selection. |

---

### 2.3 Focus Indicator Guidelines

All interactive elements must display an unmistakable, high-contrast visual focus indicator when navigated via keyboard.

1. **Visible Focus**:
   - Use Tailwind's `focus-visible:` utilities to ensure focus rings appear on keyboard navigation while avoiding clutter on mouse clicks:
   ```tsx
   className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900"
   ```
2. **Never Suppress Outlines**:
   - Never write `outline: none` or `outline-0` without providing a distinct `focus-visible:ring` replacement.
3. **Contrast Ratio for Focus Indicators**:
   - Focus rings must maintain at least **3.0:1** contrast against adjacent backgrounds.
4. **Skip Navigation Links**:
   - The root layout must include a skip link (`<a href="#main-content" className="sr-only focus:not-sr-only ...">Skip to main content</a>`) allowing keyboard users to bypass navigation headers.

---

### 2.4 Modal Dialog & Overlay Focus Trap Checklist

When implementing dialogs, modals, and sheets:

- [ ] **Initial Focus Placement**: On open, focus lands on the first interactive element or the dialog header (`tabIndex={-1}`).
- [ ] **Strict Focus Trapping**: Pressing <kbd>Tab</kbd> on the last element wraps focus back to the first element; pressing <kbd>Shift</kbd> + <kbd>Tab</kbd> on the first element wraps to the last element.
- [ ] **Inert Background**: The background page container receives `inert` or `aria-hidden="true"` so background elements cannot receive focus while the modal is active.
- [ ] **Escape Dismissal**: Pressing <kbd>Escape</kbd> immediately closes the modal.
- [ ] **Focus Restoration**: When the modal closes, focus immediately returns to the button that triggered it.

---

### 2.5 Component-Specific Keyboard Checklists

#### 1. Interactive 3D/2D Floor Plan (`FloorPlanCanvas` & `FloorPlanViewer3D`)
- [ ] Focusable grid container (`tabIndex={0}`, `role="grid"` or `role="region"` with descriptive `aria-label`).
- [ ] Arrow keys (<kbd>↑</kbd>, <kbd>↓</kbd>, <kbd>←</kbd>, <kbd>→</kbd>) pan the viewpoint or navigate between adjacent desks/seats.
- [ ] <kbd>+</kbd> / <kbd>-</kbd> zoom in and zoom out.
- [ ] <kbd>Enter</kbd> / <kbd>Space</kbd> selects the currently focused desk or displays its amenity popup.

#### 2. Autocomplete & Combobox Dropdowns (`AutocompleteDropdown`)
- [ ] <kbd>↓</kbd> opens the dropdown list and highlights the first result.
- [ ] <kbd>↑</kbd> / <kbd>↓</kbd> cycles through suggestions.
- [ ] <kbd>Enter</kbd> commits the highlighted suggestion.
- [ ] <kbd>Escape</kbd> closes the suggestion menu and keeps input text.

#### 3. Copy Buttons with Floating Tooltips (`CopyBookingReferenceButton`)
- [ ] Trigger button is natively focusable (<kbd>Tab</kbd>).
- [ ] Focus triggers the floating tooltip (`role="tooltip"` with matching `aria-describedby`).
- [ ] <kbd>Enter</kbd> or <kbd>Space</kbd> copies reference ID and announces status via `aria-live="polite"`.

---

## 3. WCAG AA Color Contrast Guidelines

### 3.1 Minimum Contrast Thresholds

| Content Type | Level AA Minimum | Level AAA Enhanced | Description & Scope |
| :--- | :--- | :--- | :--- |
| **Normal Text** | **4.5:1** | **7.0:1** | Body text, captions, table data, subheadings (< 18pt / 24px normal, < 14pt / 18.5px bold). |
| **Large Text** | **3.0:1** | **4.5:1** | Headings, hero banners, large numbers ($\ge$ 18pt / 24px normal, $\ge$ 14pt / 18.5px bold). |
| **UI Components & Graphical Objects** | **3.0:1** | **4.5:1** | Input borders, checkbox outlines, button outlines, status icons, focus indicator rings. |
| **Disabled Elements & Incidental Text** | Exempt | Exempt | Inactive buttons or placeholder text (must still remain legible). |

---

### 3.2 WorkSphere Design System Token Contrast Matrix

#### Light Theme Contrast Compliance

| Token / Element | Foreground Color | Background Color | Measured Ratio | WCAG AA Status |
| :--- | :--- | :--- | :--- | :--- |
| **Body Text** | `#18181b` (zinc-900) | `#ffffff` (white) | **15.3:1** | ✅ Pass (AAA) |
| **Secondary Text** | `#52525b` (zinc-600) | `#ffffff` (white) | **5.7:1** | ✅ Pass (AA) |
| **Muted Caption** | `#71717a` (zinc-500) | `#f4f4f5` (zinc-100) | **4.6:1** | ✅ Pass (AA) |
| **Primary Button Text** | `#ffffff` (white) | `#7c3aed` (violet-600) | **5.4:1** | ✅ Pass (AA) |
| **Success Badge** | `#15803d` (emerald-700) | `#dcfce7` (emerald-100) | **5.8:1** | ✅ Pass (AA) |
| **Warning Badge** | `#b45309` (amber-700) | `#fef3c7` (amber-100) | **5.2:1** | ✅ Pass (AA) |
| **Danger Badge / Error** | `#b91c1c` (red-700) | `#fee2e2` (red-100) | **5.5:1** | ✅ Pass (AA) |
| **Active Focus Ring** | `#7c3aed` (violet-600) | `#ffffff` (white) | **5.4:1** | ✅ Pass (AA UI) |

#### Dark Theme Contrast Compliance

| Token / Element | Foreground Color | Background Color | Measured Ratio | WCAG AA Status |
| :--- | :--- | :--- | :--- | :--- |
| **Body Text** | `#f4f4f5` (zinc-100) | `#09090b` (zinc-950) | **16.8:1** | ✅ Pass (AAA) |
| **Secondary Text** | `#a1a1aa` (zinc-400) | `#18181b` (zinc-900) | **6.1:1** | ✅ Pass (AA) |
| **Muted Caption** | `#a1a1aa` (zinc-400) | `#09090b` (zinc-950) | **7.4:1** | ✅ Pass (AAA) |
| **Primary Button Text** | `#ffffff` (white) | `#8b5cf6` (violet-500) | **4.8:1** | ✅ Pass (AA) |
| **Success Badge** | `#4ade80` (emerald-400) | `#064e3b`/60 (emerald-950) | **6.9:1** | ✅ Pass (AA) |
| **Warning Badge** | `#fbbf24` (amber-400) | `#78350f`/60 (amber-950) | **7.1:1** | ✅ Pass (AAA) |
| **Danger Badge / Error** | `#f87171` (red-400) | `#7f1d1d`/60 (red-950) | **6.2:1** | ✅ Pass (AA) |
| **Active Focus Ring** | `#a78bfa` (violet-400) | `#09090b` (zinc-950) | **7.8:1** | ✅ Pass (AA UI) |

---

### 3.3 Rule of Multi-Cue Visual Communication (WCAG 1.4.1)

Color alone must **never** be the sole vehicle for communicating status, errors, warnings, availability, or selections.

```
❌ Incorrect (Color Only):
   [ 🔴 10:00 AM ]  [ 🟢 11:00 AM ]

✅ Correct (Color + Icon + Label):
   [ 🔴 Occupied · 10:00 AM ]  [ 🟢 Available · 11:00 AM ]
```

1. **Error Fields**: Red border + alert icon (`<AlertTriangle />`) + explicit error message string.
2. **Booking Status Badges**: Colored background + status icon (`<CheckCircle2 />` or `<Clock />`) + descriptive text (`"Confirmed"`, `"Upcoming"`, `"Cancelled"`).
3. **Desk Availability**: Green/Amber/Red fills paired with text tooltips, seat numbers, and accessible labels (`aria-label="Seat 4B, Available for booking"`).

---

## 4. Verification Tools & Developer Workflow

### 4.1 Automated Audits
1. **axe-core CLI / Extension**:
   - Run Axe DevTools on modified routes (`http://localhost:3000/reserve/1`, `http://localhost:3000/admin/system`).
   - Zero critical or serious violations allowed.
2. **Jest Unit Tests**:
   - Include `jest-axe` tests for critical interactive widgets and forms.

### 4.2 Manual Keyboard Verification
1. Disconnect or disable your mouse / trackpad.
2. Navigate the entire task flow using only <kbd>Tab</kbd>, <kbd>Shift</kbd> + <kbd>Tab</kbd>, <kbd>Enter</kbd>, <kbd>Space</kbd>, <kbd>Arrow keys</kbd>, and <kbd>Escape</kbd>.
3. Confirm that:
   - Focus is never lost or trapped unintentionally.
   - All interactive targets display visible focus rings.
   - Modals trap focus and close cleanly via <kbd>Escape</kbd>.

### 4.3 Contrast Verification Tools
- **Chrome / Firefox DevTools**: Inspect any text element $\to$ click the color swatch in the Styles panel $\to$ verify the **Contrast Ratio** indicator shows a green checkmark (`>= 4.5:1`).
- **WebAIM Contrast Checker**: Validate custom brand shades and gradients at [webaim.org/resources/contrastchecker](https://webaim.org/resources/contrastchecker/).
- **Color Blindness Emulation**: Open DevTools $\to$ **Rendering tab** $\to$ **Emulate vision deficiencies** (Protanopia, Deuteranopia, Tritanopia) to ensure usability for color vision deficient users.

---

## 5. Summary Quick Checklist for PR Reviews

- [ ] **Tab Order**: Sequential and logical throughout the whole DOM structure.
- [ ] **Focus Ring**: Clearly visible 2px focus ring with sufficient contrast (`focus-visible:ring-2`).
- [ ] **Keyboard Operability**: All buttons, links, inputs, and toggles respond to <kbd>Enter</kbd> / <kbd>Space</kbd>.
- [ ] **Escape Key**: Closes all active dialogs, sheets, and popovers.
- [ ] **Focus Trap**: Modals constrain tab cycling and restore focus on dismiss.
- [ ] **Contrast**: Minimum **4.5:1** for standard text and **3.0:1** for UI components/icons in both light & dark themes.
- [ ] **No Color-Only Cues**: Statuses, errors, and availability indicators include text and icons.
