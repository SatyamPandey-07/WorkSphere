# Accessibility (a11y) Guidelines for Custom Modal Interfaces

This document outlines the accessibility standards and best practices required when building custom modal interfaces (dialog boxes) and custom selectors within the WorkSphere platform.

Adhering to these guidelines ensures our application is fully usable for individuals relying on screen readers and keyboard navigation.

---

## 1. Screen-Reader Tags & ARIA States

Custom modals must clearly communicate their purpose and state to assistive technologies.

- **Accessible Naming:** A dialog must have an accessible name using either `aria-labelledby` (pointing to a visible title's ID) or an `aria-label` attribute.
- **Roles:** The container element must have `role="dialog"` or `role="alertdialog"`. Use `alertdialog` only when the modal requires immediate user attention. If using `alertdialog`, you **must** also use `aria-describedby` to point to the alert message text.
- **`aria-modal="true"`:** This attribute must be added to genuinely modal dialogs (where background interaction is prevented). It tells assistive technologies to ignore content outside the modal.

## 2. Trigger Elements and Custom Selectors

The elements that trigger these interfaces have specific requirements depending on their type.

- **Dialog Triggers:** The button that opens a standard dialog should generally have `aria-haspopup="dialog"`.
- **Custom Selectors (Comboboxes/Listboxes):** These require a defined widget pattern. The trigger must use `aria-expanded` (toggling between `true` and `false`), `aria-controls`, and the appropriate `combobox` or `listbox` roles. Do not apply `aria-expanded` to standard dialog buttons.

## 3. Keyboard Focus Management (The "Focus Trap")

Modals must strictly manage user focus.

- **Initial Focus:** Focus should move into the modal. While this is often the first focusable element, complex or long dialogs may require focus to land on a static title or paragraph (using `tabindex="-1"`) so screen readers announce the context first.
- **Focus Trapping:** While open, pressing `Tab` must cycle focus forward through the modal's interactive elements, and `Shift + Tab` must cycle backward. Focus **must never** escape the modal container.
- **Closing via Keyboard:** Pressing the `Escape` key must close the modal.
- **Restoring Focus:** When the modal closes, focus must return to the exact element that triggered it. Exception: If the triggering element was removed from the DOM, move focus to the next logical step in the workflow.

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
- [ ] `Escape` key closes the modal.
- [ ] `Tab` cycles focus only within the modal (focus trap).
- [ ] Focus returns to the trigger button (or next logical element) upon closing.
