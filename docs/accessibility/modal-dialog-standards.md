# Accessibility Standards: Modal Dialog Focus Management & ARIA Roles

## 1. Executive Summary & Compliance Scope

WorkSphere modal dialogs provide focused user workflows—such as desk check-ins, offline cache inspection, reservation confirmation, wallet pass generation, and venue submissions—without navigating away from the current workspace canvas. Because modals interrupt the primary visual hierarchy, they present high-risk interaction barriers for keyboard-only navigators, switch device users, screen reader users, and people utilizing screen magnification tools.

This standard establishes mandatory accessibility requirements across all modal and dialog components in WorkSphere, enforcing compliance with **W3C WAI-ARIA 1.2 Authoring Practices Guide (APG)** and **WCAG 2.1 Level AA Success Criteria**:

*   **WCAG 2.1.1 Keyboard (Level A):** All modal functionality must be operable through a keyboard interface without requiring specific timings for individual keystrokes.
*   **WCAG 2.1.2 No Keyboard Trap (Level A):** Keyboard focus must never become permanently trapped within any sub-component. While a modal intentionally *constrains* focus to its content, standard escape keys (`Escape`) or dismissal triggers must reliably return the user to the underlying page.
*   **WCAG 2.4.3 Focus Order (Level A):** If a Web page can be navigated sequentially and the navigation sequences affect meaning or operation, focusable components receive focus in an order that preserves meaning and operability.
*   **WCAG 2.4.7 Focus Visible (Level AA):** Any keyboard-operable user interface must have a visible keyboard focus indicator when receiving focus.
*   **WCAG 1.3.1 Info and Relationships (Level A):** Information, structure, and relationships conveyed through presentation can be programmatically determined or are available in text (e.g., dialog roles and title associations).
*   **WCAG 4.1.2 Name, Role, Value (Level A):** For all user interface components, the `role`, `name`, and state must be programmatically determinable by assistive technologies (AT).

---

## 2. Comprehensive Modal Accessibility Checklist

Every modal dialog implemented in `src/components/` must pass the following verification checklist before merge approval:

| Category | Requirement | Verification Method | Severity |
| :--- | :--- | :--- | :--- |
| **ARIA Semantics** | Root container declares `role="dialog"` (or `role="alertdialog"` for urgent confirmations). | DOM inspection / Accessibility Tree | Blocker |
| **Modal Flag** | Root container declares `aria-modal="true"`. | DOM inspection | Blocker |
| **Accessible Name** | Root container points `aria-labelledby` to a unique heading element (`<h2 id="...">`). | Inspect AT Name calculation | Blocker |
| **Accessible Description** | Subtext or instructions linked via `aria-describedby` when context is necessary. | Inspect AT Description | Medium |
| **Trigger Capture** | `document.activeElement` is saved to a ref immediately before modal mounts. | React hook lifecycle check | Blocker |
| **Initial Focus** | Focus automatically moves inside the dialog (first interactive control or explicit input). | Keypress test on open | Blocker |
| **Focus Trapping** | `Tab` wraps from last focusable element to first; `Shift+Tab` wraps from first to last. | Keyboard traversal test | Blocker |
| **Escape Dismiss** | Pressing `Escape` invokes `onClose()` and dismisses the dialog immediately. | Keypress `Escape` test | Blocker |
| **Focus Restoration** | On dismissal, keyboard focus is restored to the initiating trigger button. | Focus assertion post-close | Blocker |
| **Background Inertness** | Background DOM siblings marked `aria-hidden="true"` or `inert` while dialog is mounted. | Accessibility Tree audit | High |
| **Scroll Lock** | Background document body scroll is locked (`overflow: hidden`) to prevent background drift. | Mousewheel / PageUp inspection | Medium |
| **Click Outside Guard** | Backdrop dismiss verifies `e.target === e.currentTarget` preventing accidental dismissal. | Drag/Select text click test | High |
| **Close Button Label** | Close button (`<X />`) features explicit `aria-label="Close dialog"`. | Screen reader readout | Blocker |
| **Visual Focus Rings** | Interactive elements within modal display distinct focus rings (min 2px contrast). | CSS focus-visible inspection | High |

---

## 3. Required ARIA Roles and Attributes

### 3.1 `role="dialog"` vs `role="alertdialog"`

Modals in WorkSphere fall into two architectural categories based on their semantic purpose:

```tsx
// 1. Standard Interactive Dialog (Default)
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="dialog-title-id"
  aria-describedby="dialog-desc-id"
  className="fixed inset-0 z-50 flex items-center justify-center ..."
>
```

```tsx
// 2. Urgent / Destructive Confirmation (Alert Dialog)
<div
  role="alertdialog"
  aria-modal="true"
  aria-labelledby="alert-title-id"
  aria-describedby="alert-desc-id"
  className="fixed inset-0 z-50 flex items-center justify-center ..."
>
```

#### Rule for Choosing Role:
*   Use `role="dialog"` for standard task flows: desk check-ins (`CheckInModal`), QR code display, booking wizards (`BookingModal`), filters, settings, and forms.
*   Use `role="alertdialog"` exclusively for disruptive, unrecoverable actions or session timeouts: clearing offline storage database (`OfflineCacheModal` clear confirmation), canceling an active non-refundable reservation, or idle session logout warnings (`IdleWarningModal`).
*   **Behavioral Difference:** Screen readers announce `alertdialog` with higher urgency and will immediately read both the `aria-labelledby` title and the full `aria-describedby` description text upon appearance.

### 3.2 `aria-modal="true"`

The `aria-modal="true"` attribute informs assistive technologies that windows and elements behind this container are inactive and inert.
*   Without `aria-modal="true"`, screen readers (notably VoiceOver on macOS/iOS and TalkBack on Android) allow users to swipe or read through the backdrop into background page elements, causing extreme confusion.
*   Setting `aria-modal="true"` instructs screen readers to bound their virtual cursor within the modal container.

### 3.3 Accessible Labeling (`aria-labelledby` and `aria-describedby`)

Every dialog container must have a clear programmatic label:
1.  **Mandatory Title (`aria-labelledby`):** Points to the visible header element.
    ```tsx
    <div role="dialog" aria-modal="true" aria-labelledby="checkin-modal-title">
      <h2 id="checkin-modal-title" className="text-lg font-bold">
        Venue Check-In
      </h2>
    </div>
    ```
2.  **Optional Description (`aria-describedby`):** Points to secondary instructions or modal explanations.
    ```tsx
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkin-modal-title"
      aria-describedby="checkin-modal-instructions"
    >
      <h2 id="checkin-modal-title">Venue Check-In</h2>
      <p id="checkin-modal-instructions" className="text-sm text-zinc-500">
        Enter the 6-digit confirmation code sent to your email to unlock your desk.
      </p>
    </div>
    ```
3.  **Fallback Name (`aria-label`):** If a visual heading is absent (strongly discouraged), provide `aria-label="Modal title description"`.

---

## 4. Modal Interaction State Machine & Keyboard Lifecycle

The lifecycle of an accessible modal follows a strict state transition sequence:

```mermaid
stateDiagram-v2
    [*] --> Closed: Application Idle
    Closed --> TriggerActivated: User clicks trigger button (Enter / Space / Click)
    
    state Opening {
        TriggerActivated --> SnapshotFocus: Capture document.activeElement into Ref
        SnapshotFocus --> MountDOM: Render Modal DOM Container
        MountDOM --> LockBodyScroll: Set document.body.style.overflow = "hidden"
        LockBodyScroll --> InertSiblings: Set aria-hidden="true" on root siblings
        InertSiblings --> SetInitialFocus: Focus first interactive control or input
    }
    
    SetInitialFocus --> ActiveModal: Dialog in Focus Trap Loop
    
    state ActiveModal {
        ActiveModal --> TabForward: Press Tab
        TabForward --> ActiveModal: Wrap from Last -> First element
        
        ActiveModal --> TabBackward: Press Shift + Tab
        TabBackward --> ActiveModal: Wrap from First -> Last element
        
        ActiveModal --> BackdropClick: Pointer Down + Up on Backdrop
        BackdropClick --> TriggerClose: Verified via isModalBackdropClick()
    }
    
    ActiveModal --> EscapePressed: User presses Escape key
    EscapePressed --> TriggerClose: Call onClose()
    
    state Closing {
        TriggerClose --> UnlockBodyScroll: Restore body overflow
        UnlockBodyScroll --> UninertSiblings: Remove aria-hidden from siblings
        UninertSiblings --> UnmountDOM: Remove dialog from DOM
        UnmountDOM --> RestoreFocus: triggerRef.current.focus()
    }
    
    RestoreFocus --> Closed: Focus successfully restored
```

---

## 5. Keyboard Focus Trapping Pattern Using `useRef`

### 5.1 Focusable Element Selector String

When trapping focus, the trap must discover all interactive elements within the dialog subtree while ignoring disabled elements, hidden elements, and elements explicitly removed from tab order (`tabIndex="-1"`):

```typescript
export const FOCUSABLE_ELEMENTS_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'area[href]:not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'iframe:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
  '[contentEditable=true]:not([tabindex="-1"])',
].join(", ");
```

### 5.2 The Production-Ready `useFocusTrap` Hook

The following hook implementation encapsulates trigger storage, initial focus delegation, cycling focus trap, `Escape` key dismissal, and trigger focus restoration:

```tsx
"use client";

import { useEffect, useRef, RefObject } from "react";

export interface UseFocusTrapOptions {
  isOpen: boolean;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  disableRestoreFocus?: boolean;
}

export function useFocusTrap<T extends HTMLElement = HTMLDivElement>({
  isOpen,
  onClose,
  initialFocusRef,
  returnFocusRef,
  disableRestoreFocus = false,
}: UseFocusTrapOptions): RefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  const triggerElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // 1. Snapshot the initiating trigger element
    if (typeof document !== "undefined") {
      triggerElementRef.current = document.activeElement as HTMLElement | null;
    }

    const container = containerRef.current;
    if (!container) return;

    // 2. Discover all currently focusable interactive elements
    const getFocusableElements = (): HTMLElement[] => {
      const candidates = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENTS_SELECTOR)
      );
      // Filter out elements hidden via CSS display or zero dimensions
      return candidates.filter(
        (el) => el.offsetParent !== null && !el.hasAttribute("disabled")
      );
    };

    // 3. Set Initial Focus inside modal
    const focusTimer = requestAnimationFrame(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
      } else {
        const focusable = getFocusableElements();
        if (focusable.length > 0) {
          focusable[0].focus();
        } else {
          // If modal contains no interactive buttons, focus container itself
          container.setAttribute("tabindex", "-1");
          container.focus();
        }
      }
    });

    // 4. Keyboard Trapping & Escape Handler
    const handleKeyDown = (event: KeyboardEvent) => {
      // Handle Escape dismiss
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      // Handle Tab navigation
      if (event.key === "Tab") {
        const focusable = getFocusableElements();
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];
        const activeEl = document.activeElement;

        if (event.shiftKey) {
          // Shift + Tab: wrapping backward from first to last
          if (activeEl === firstElement || activeEl === container) {
            event.preventDefault();
            lastElement.focus();
          }
        } else {
          // Tab: wrapping forward from last to first
          if (activeEl === lastElement) {
            event.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    // 5. Lock Body Scroll & Sibling ARIA Tree
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      cancelAnimationFrame(focusTimer);
      window.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = originalOverflow;

      // 6. Return focus to trigger upon dismissal
      if (!disableRestoreFocus) {
        const targetToFocus = returnFocusRef?.current || triggerElementRef.current;
        if (targetToFocus && typeof targetToFocus.focus === "function") {
          // Defer restoration to allow DOM unmount animations to complete
          requestAnimationFrame(() => {
            targetToFocus.focus();
          });
        }
      }
    };
  }, [isOpen, onClose, initialFocusRef, returnFocusRef, disableRestoreFocus]);

  return containerRef;
}
```

---

## 6. Focus Restoration Architecture (Return Focus to Trigger)

Focus restoration is a foundational requirement of **WCAG 2.4.3 (Focus Order)**. When a modal closes without restoring focus, keyboard focus collapses to the top of the `<body>` element. This forces keyboard users to re-traverse the entire header, navigation menu, and content area to locate where they were previously working.

### 6.1 The Three Focus Restoration Rules:
1.  **Dynamic Trigger Stash:** Always capture `document.activeElement` during the opening tick *before* any child elements inside the dialog receive focus.
2.  **Graceful Fallback:** If the original trigger button was unmounted while the modal was open (e.g., "Delete Workspace" removed the card containing the trigger button), fall back gracefully:
    *   Target the parent container (`[data-section="workspaces"]`).
    *   Or focus the primary page heading (`<main>` or `<h1>`).
    *   Never allow focus to be lost into the ether.
3.  **Animation-Safe Restoration:** Modern CSS transitions (fade-out, slide-down) take 150ms–300ms. Restoring focus immediately while the modal still intercepts pointer/keyboard events can cause focus rejection. Use `requestAnimationFrame` or `setTimeout(() => trigger.focus(), 0)` after unmounting.

```typescript
// Pattern: Safe Restoration with Component Unmount Guard
export function restoreFocusSafely(
  element: HTMLElement | null,
  fallbackSelector: string = "main"
) {
  if (element && document.body.contains(element)) {
    element.focus();
  } else {
    const fallback = document.querySelector<HTMLElement>(fallbackSelector);
    if (fallback) {
      fallback.setAttribute("tabindex", "-1");
      fallback.focus();
    }
  }
}
```

---

## 7. Backdrop Click Dismissal & Pointer Guards

When users click the dark overlay behind a modal, they expect it to close. However, naive `onClick={onClose}` handlers create a severe bug: when a user clicks inside the dialog, drags their mouse to select text, and releases the cursor outside on the backdrop, the modal abruptly closes, destroying unsaved user input.

WorkSphere provides standard helpers in [`src/lib/modal-interactions.ts`](file:///c:/Users/admin/Desktop/workfere/src/lib/modal-interactions.ts):

```typescript
import {
  isModalBackdropClick,
  shouldCloseFromBackdrop,
  handleModalBackdropClick
} from "@/lib/modal-interactions";
```

### Verified Backdrop Implementation in React:

```tsx
export function AccessibleModalBackdrop({
  isOpen,
  onClose,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const pointerDownOnBackdropRef = useRef(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointerDownOnBackdropRef.current = e.target === e.currentTarget;
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const clickEndedOnBackdrop = e.target === e.currentTarget;
    if (
      shouldCloseFromBackdrop(
        pointerDownOnBackdropRef.current,
        clickEndedOnBackdrop
      )
    ) {
      onClose();
    }
    pointerDownOnBackdropRef.current = false;
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      role="dialog"
      aria-modal="true"
    >
      {children}
    </div>
  );
}
```

---

## 8. Complete Reference Implementation: `StandardAccessibleModal.tsx`

The following component serves as the golden standard for all modal dialogs in WorkSphere:

```tsx
"use client";

import React, { useId, useRef } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { isModalBackdropClick } from "@/lib/modal-interactions";

export interface StandardModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  isAlert?: boolean;
  children: React.ReactNode;
  footerActions?: React.ReactNode;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

export function StandardAccessibleModal({
  isOpen,
  onClose,
  title,
  description,
  isAlert = false,
  children,
  footerActions,
  initialFocusRef,
}: StandardModalProps) {
  const titleId = useId();
  const descriptionId = useId();

  // Focus trap hook handles: Escape key, Tab cycle, and return focus
  const modalContainerRef = useFocusTrap<HTMLDivElement>({
    isOpen,
    onClose,
    initialFocusRef,
  });

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (isModalBackdropClick({ target: e.target, currentTarget: e.currentTarget })) {
          onClose();
        }
      }}
      // Core ARIA bindings on backdrop container
      role={isAlert ? "alertdialog" : "dialog"}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
    >
      <div
        ref={modalContainerRef}
        className="relative w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden focus:outline-none"
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between p-6 border-b border-zinc-100 dark:border-zinc-800/80">
          <div>
            <h2
              id={titleId}
              className="text-lg font-bold text-zinc-900 dark:text-zinc-50 tracking-tight"
            >
              {title}
            </h2>
            {description && (
              <p
                id={descriptionId}
                className="text-xs text-zinc-500 dark:text-zinc-400 mt-1"
              >
                {description}
              </p>
            )}
          </div>

          {/* Dismiss Button with Explicit Accessible Name */}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus:ring-2 focus:ring-blue-500 focus:outline-none"
            aria-label="Close dialog"
            title="Close dialog (Escape)"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 max-h-[calc(85vh-140px)] overflow-y-auto">
          {children}
        </div>

        {/* Modal Footer */}
        {footerActions && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-100 dark:border-zinc-800">
            {footerActions}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## 9. Specific Modals in WorkSphere: Audit & Compliance Guide

| Component File | Role | Title Attribute | Focus Trap Status | Action Required |
| :--- | :--- | :--- | :--- | :--- |
| `src/components/CheckInModal.tsx` | Needs `role="dialog"` | Needs `aria-labelledby` | Add `useFocusTrap` | Attach hook; link title ID; verify code input receives initial focus. |
| `src/components/OfflineCacheModal.tsx` | Has `role="dialog"` | Has `aria-labelledby` | Add `useFocusTrap` | Already has ARIA attributes; integrate Tab wrap and return focus. |
| `src/components/auth/IdleWarningModal.tsx` | Needs `role="alertdialog"` | Needs `aria-labelledby` | Add `useFocusTrap` | Mark as `alertdialog`; set initial focus to "Keep Working" button. |
| `src/components/bookings/BookingModal.tsx` | Needs `role="dialog"` | Needs `aria-labelledby` | Add `useFocusTrap` | Trap tab navigation inside booking wizard steps. |
| `src/components/bookings/RescheduleModal.tsx` | Needs `role="dialog"` | Needs `aria-labelledby` | Add `useFocusTrap` | Ensure calendar date grid focus does not escape into main body. |
| `src/components/bookings/SplitBillModal.tsx` | Needs `role="dialog"` | Needs `aria-labelledby` | Add `useFocusTrap` | Trap focus across dynamic list of guest email inputs. |
| `src/components/KeyboardShortcutsModal.tsx` | Needs `role="dialog"` | Needs `aria-labelledby` | Add `useFocusTrap` | Ensure shortcut cheat sheet closes on Escape and restores focus. |
| `src/components/receipt/ReceiptVerificationModal.tsx` | Needs `role="dialog"` | Needs `aria-labelledby` | Add `useFocusTrap` | Restore focus to receipt card trigger after verification completes. |

---

## 10. Automated Testing Recipes & Assertions

Automated accessibility tests verify that regression bugs are caught in continuous integration before reaching staging.

### 10.1 React Testing Library Unit Tests

```tsx
import React, { useRef, useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StandardAccessibleModal } from "./StandardAccessibleModal";

function TestModalHarness() {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div>
      <button
        ref={triggerRef}
        data-testid="open-modal-btn"
        onClick={() => setIsOpen(true)}
      >
        Open Settings
      </button>

      <StandardAccessibleModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Workspace Settings"
        description="Configure your offline workspace preferences."
      >
        <label htmlFor="workspace-name">Workspace Name</label>
        <input id="workspace-name" data-testid="workspace-input" type="text" />
        <button data-testid="save-btn" onClick={() => setIsOpen(false)}>
          Save Preferences
        </button>
      </StandardAccessibleModal>
    </div>
  );
}

describe("StandardAccessibleModal Accessibility", () => {
  it("renders with correct ARIA roles and labels", () => {
    render(<TestModalHarness />);
    fireEvent.click(screen.getByTestId("open-modal-btn"));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Workspace Settings");
    expect(dialog).toHaveAccessibleDescription("Configure your offline workspace preferences.");
  });

  it("traps keyboard focus sequentially within modal boundaries", async () => {
    const user = userEvent.setup();
    render(<TestModalHarness />);
    
    const trigger = screen.getByTestId("open-modal-btn");
    await user.click(trigger);

    const closeBtn = screen.getByRole("button", { name: /close dialog/i });
    const input = screen.getByTestId("workspace-input");
    const saveBtn = screen.getByTestId("save-btn");

    // Close button receives initial focus
    expect(closeBtn).toHaveFocus();

    // Tab forward
    await user.tab();
    expect(input).toHaveFocus();

    await user.tab();
    expect(saveBtn).toHaveFocus();

    // Tab wraps around from last to first
    await user.tab();
    expect(closeBtn).toHaveFocus();

    // Shift + Tab wraps backward from first to last
    await user.tab({ shift: true });
    expect(saveBtn).toHaveFocus();
  });

  it("dismisses modal on Escape key and restores focus to trigger button", async () => {
    const user = userEvent.setup();
    render(<TestModalHarness />);

    const trigger = screen.getByTestId("open-modal-btn");
    await user.click(trigger);

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Press Escape
    await user.keyboard("{Escape}");

    // Modal unmounts
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // Trigger button regains focus
    expect(trigger).toHaveFocus();
  });
});
```

### 10.2 Playwright E2E Keyboard Navigation Test

```typescript
import { test, expect } from "@playwright/test";

test.describe("Modal Dialog Keyboard Navigation E2E", () => {
  test("end-to-end focus trap and escape restoration flow", async ({ page }) => {
    await page.goto("/venues/tech-hub-central");

    const checkInTrigger = page.getByRole("button", { name: /venue check-in/i });
    await checkInTrigger.focus();
    await page.keyboard.press("Enter");

    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();

    // Assert focus is inside the modal
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(["BUTTON", "INPUT"]).toContain(focusedTag);

    // Press Escape
    await page.keyboard.press("Escape");

    // Verify modal dismissed and trigger focused
    await expect(modal).toBeHidden();
    await expect(checkInTrigger).toBeFocused();
  });
});
```

---

## 11. Developer Runbook & Common Anti-Patterns

### Anti-Pattern 1: Hardcoded Positive Tabindexes (`tabIndex > 0`)
*   **Problem:** Using `<button tabIndex={1}>` disrupts the natural DOM tree tab navigation order and causes the focus trap calculation to misalign.
*   **Resolution:** Always use standard DOM source ordering and `tabIndex={0}` for interactive elements or `tabIndex={-1}` for programmatically focusable containers.

### Anti-Pattern 2: Missing Accessible Name on Icon Buttons
*   **Problem:** Rendering `<button onClick={onClose}><X /></button>` creates an empty announcement in VoiceOver: *"Button"*.
*   **Resolution:** Provide `aria-label="Close dialog"` or wrap the icon with `<span className="sr-only">Close dialog</span>`.

### Anti-Pattern 3: Clobbering Global Keydown Handlers
*   **Problem:** Adding unconditioned `window.addEventListener("keydown")` without checking `event.key === "Escape"` intercepts all keystrokes, breaking typing inside text inputs.
*   **Resolution:** Specifically check `if (event.key === "Escape")` and call `event.stopPropagation()` to prevent parent components or nested dialogs from prematurely closing.

### Anti-Pattern 4: Losing Focus on Async Action Submit
*   **Problem:** Submitting a form closes the modal while an asynchronous network call finishes. Because the modal component unmounted immediately, the return focus reference is nullified.
*   **Resolution:** Persist the trigger element in an unmount-resilient reference or pass `returnFocusRef` explicitly to the modal component.

---

## 12. Verification & Audit Tools

Developers should validate all modal interfaces using the following tools before submitting PRs:

1.  **Chrome DevTools Accessibility Pane:** Verify `role="dialog"`, `aria-modal="true"`, and computed accessible name.
2.  **macOS VoiceOver (`Cmd + F5`) / Windows NVDA (`Insert + Space`):** Navigate using `Control + Option + Arrow Keys` or `Down Arrow` and ensure reading is constrained strictly within the modal perimeter.
3.  **Keyboard-Only Pass:** Unplug the mouse or disable trackpad; perform open $\rightarrow$ tab cycle $\rightarrow$ escape dismiss $\rightarrow$ trigger verify cycle.
