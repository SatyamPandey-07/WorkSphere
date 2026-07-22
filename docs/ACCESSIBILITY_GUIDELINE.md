# Accessibility (a11y) Guidelines for Custom Modal Interfaces & Audio Controls

This document outlines the accessibility standards and best practices required when building custom modal interfaces (dialog boxes), custom selectors, reservation clients, and interactive audio controls within the WorkSphere platform.

Adhering to these guidelines ensures our application is fully usable for individuals relying on screen readers and keyboard navigation.

---

## 1. Screen-Reader Tags & ARIA States

Custom modals must clearly communicate their purpose and state to assistive technologies.

- **Accessible Naming:** A dialog must have an accessible name using either `aria-labelledby` (pointing to a visible title's ID) or an `aria-label` attribute.
- **Roles:** The container element must have `role="dialog"` or `role="alertdialog"`. Use `alertdialog` only when the modal requires immediate user attention. If using `alertdialog`, you **must** also use `aria-describedby` to point to the alert message text.
- **`aria-modal="true"`:** This attribute must be added to genuinely modal dialogs (where background interaction is prevented). It tells assistive technologies to ignore content outside the modal.

---

## 2. Trigger Elements, Tooltips & Custom Selectors

The elements that trigger interfaces or controls have specific accessibility requirements.

- **Dialog Triggers:** The button that opens a standard dialog should generally have `aria-haspopup="dialog"`.
- **Custom Selectors (Comboboxes/Listboxes):** These require a defined widget pattern. The trigger must use `aria-expanded` (toggling between `true` and `false`), `aria-controls`, and the appropriate `combobox` or `listbox` roles. Do not apply `aria-expanded` to standard dialog buttons.
- **Reservation Client Controls (Date Picker & Duration Selectors):**
  - Interactive trigger buttons (such as date pickers and duration selectors in `reservation-client.tsx`) must include explicit, descriptive `aria-label` attributes (e.g., `aria-label="Select reservation date"`, `aria-label="Select duration"`).
  - Triggers controlling dynamic popovers or dropdown menus must dynamically reflect their state using `aria-expanded="true"` when open and `aria-expanded="false"` when collapsed.
  - Interactive elements must support full keyboard navigation and allow users to move smoothly using the `Tab` key.
- **Tooltips & Keyboard Shortcuts (Spatial Audio Controls):**
  - Interactive toggles with custom keyboard shortcuts (such as the Spatial Audio Panner `SpatialAudioRouter` toggle) must display an accessible hover and focus tooltip indicating the key combination (e.g., `Ctrl + M`).
  - Tooltips must trigger on both hover (`mouseenter`) and keyboard focus (`focusin`), and dismiss cleanly on `mouseleave` or `focusout`.
  - Toggles must feature an explicit `aria-label` detailing their purpose (e.g., `aria-label="Toggle Spatial Audio Mute"`).

---

## 3. Keyboard Focus Management (The "Focus Trap")

Modals and controls must strictly manage user focus.

- **Initial Focus:** Focus should move into the modal. While this is often the first focusable element, complex or long dialogs may require focus to land on a static title or paragraph (using `tabindex="-1"`) so screen readers announce the context first.
- **Focus Trapping:** While open, pressing `Tab` must cycle focus forward through the modal's interactive elements, and `Shift + Tab` must cycle backward. Focus **must never** escape the modal container.
- **Closing via Keyboard:** Pressing the `Escape` key must close the modal.
- **Restoring Focus:** When the modal closes, focus must return to the exact element that triggered it. Exception: If the triggering element was removed from the DOM, move focus to the next logical step in the workflow.

---

## 4. Overlays (Backdrops) and Background Inertness

The visual overlay and the background application must be handled safely.

- **Click-to-Close (Optional):** Clicking the overlay backdrop can close the modal, but this should **not** be used for destructive `alertdialog` patterns where explicit user confirmation is required.
- **Background Inertness:** When a modal is open, the underlying application layer must be entirely inert. Applying `aria-hidden="true"` to just the visual overlay is insufficient. Ensure the dialog is not nested inside a hidden ancestor.

---

### Quick Implementation Checklist

- [ ] Dialog has `role="dialog"` (or `alertdialog`) and an accessible name (`aria-labelledby` or `aria-label`).
- [ ] `alertdialog` includes `aria-describedby` pointing to the message.
- [ ] `aria-modal="true"` is applied, and the background application is inert.
- [ ] Custom selectors properly utilize `aria-expanded` and `aria-controls`.
- [ ] Date picker and duration selectors feature descriptive `aria-label` attributes and toggle `aria-expanded` dynamically on popover state.
- [ ] Spatial audio controls wrap in a hover/focus tooltip explicitly displaying keyboard shortcuts (e.g., `Ctrl + M`).
- [ ] `Escape` key closes the modal.
- [ ] `Tab` cycles focus only within the modal (focus trap).
- [ ] Focus returns to the trigger button (or next logical element) upon closing.
