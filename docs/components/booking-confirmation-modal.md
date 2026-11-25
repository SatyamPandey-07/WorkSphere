# BookingConfirmationModal Component

The `BookingConfirmationModal` component provides an accessible, print-optimized confirmation interface presented to users upon completing a workspace, desk, or meeting room reservation. It displays key booking details, passcard information, and provides seamless export and print receipt workflows.

---

## 1. Component Purpose & Confirmation Flow

### Purpose
The modal acts as the final confirmation surface within the booking journey:
- Confirms successful reservation processing.
- Summarizes booking metadata: Booking ID, venue name, room/desk details, reserved date/time window, attendee count, total paid amount, and payment status.
- Integrates the digital boarding pass / access passcard with entry instructions or QR credentials.
- Offers direct actions: **Print Receipt**, **Download Passcard**, and **Close / Return to Dashboard**.

### Booking Confirmation Lifecycle
1. **Trigger**: After successful booking API settlement, the parent container mounts or toggles `isOpen={true}` on `BookingConfirmationModal`.
2. **Mount & Initial Focus**: The modal establishes an accessible dialog overlay, disables body scrolling, caches the pre-dialog active element, and moves focus into the primary action or close button.
3. **Review & Passcard Delivery**: The user reviews booking credentials and venue access codes or passcard QR markers.
4. **Receipt Generation & Print**: User can invoke `window.print()` directly via the print action, executing dedicated print CSS styles.
5. **Dismissal**: Modal closes via Escape key, close button click, or backdrop dismissal, returning keyboard focus to the launching trigger.

---

## 2. Focus Trapping & Focus Restoration

To comply with WCAG 2.1 Level AA requirements (SC 2.4.3 Focus Order & SC 2.1.2 No Keyboard Trap), `BookingConfirmationModal` strictly regulates focus:

### Focus Trapping
- When open, focus is constrained within the modal container.
- Key listener captures <kbd>Tab</kbd> and <kbd>Shift</kbd> + <kbd>Tab</kbd>:
  - If focus is on the last focusable element and the user presses <kbd>Tab</kbd>, focus wraps around to the first focusable element.
  - If focus is on the first focusable element and the user presses <kbd>Shift</kbd> + <kbd>Tab</kbd>, focus wraps backward to the last focusable element.
- Non-modal DOM siblings can be marked `inert` or `aria-hidden="true"` while the confirmation dialog is active.

### Focus Restoration
- Upon mounting or opening, the component caches `document.activeElement` into a reference (`triggerRef` or `previousActiveElementRef`).
- When the modal unmounts or `onClose` is triggered, focus is programmatically restored to `previousActiveElementRef.current.focus()`, ensuring non-visual and keyboard users do not lose their place in the parent page.

---

## 3. Escape-Key Handling & Keyboard Interactions

The modal listens for document-level keyboard events when open:

| Key Interaction | Scope | Behavior |
| :--- | :--- | :--- |
| <kbd>Escape</kbd> | Document-wide | Closes the modal immediately and restores focus to previous element. |
| <kbd>Tab</kbd> | Within modal | Advances focus forward through interactive controls (Close, Passcard actions, Print, Done). Wraps at the end. |
| <kbd>Shift</kbd> + <kbd>Tab</kbd> | Within modal | Advances focus backwards through interactive controls. Wraps at the start. |
| <kbd>Enter</kbd> / <kbd>Space</kbd> | On buttons / links | Activates the focused button (e.g. trigger Print, Download Passcard, or Dismiss). |

---

## 4. Accessibility Features & Screen-Reader Support

`BookingConfirmationModal` implements standard WAI-ARIA Dialog (Modal) design patterns:

- **Modal Semantics**:
  - `role="dialog"` or `role="alertdialog"`
  - `aria-modal="true"` prevents assistive technologies from navigating into background content.
- **Accessible Labelling**:
  - `aria-labelledby="booking-confirmation-title"` points to the modal heading (e.g., *"Booking Confirmed!"*).
  - `aria-describedby="booking-confirmation-desc"` points to the summary section containing booking reference and venue details.
- **Button Labels**:
  - Dismiss / icon buttons use explicit `aria-label="Close booking confirmation"` to give screen readers unambiguous context.
- **Status Announcements**:
  - An internal polite live region (`aria-live="polite"` or `role="status"`) announces background receipt generation or print initialization.
- **Reduced Motion**:
  - Transitions honor `prefers-reduced-motion: reduce`, skipping animated entrances.

---

## 5. Passcard Integration & Receipt Generation

### Passcard Integration
The confirmation view embeds the digital access passcard:
- Displays reservation reference code and alphanumeric confirmation token.
- Renders high-contrast QR/barcode for turnstile/desk check-in.
- Presents venue access window (e.g., *Check-in: 09:00 AM &bull; Check-out: 06:00 PM*).
- Allows saving passcard to Apple Wallet / Google Wallet or downloading as an image/PDF.

### Receipt Data Structuring
The receipt section consolidates financial and operational records:
- **Header**: Organization branding, tax registration number, and receipt issuance timestamp.
- **Line Items**: Base reservation charge, add-ons (monitors, meeting room equipment, coffee service), taxes, and applied platform credits/discounts.
- **Payment Method**: Masked card information (e.g. `•••• 4242`) or credit balance deduction with transaction ID.

---

## 6. Print Receipt Workflow & Expected Behavior

The modal includes a dedicated **Print Receipt** button that triggers a styled browser print dialog.

### Workflow
1. User clicks **Print Receipt** (or presses <kbd>Enter</kbd> while focused).
2. The component ensures print stylesheets (`@media print`) are applied.
3. `window.print()` is called.
4. During print preview:
   - Modals backdrops, shadow overlays, navigation bars, and irrelevant interactive buttons (e.g. Close, Download, Print) are hidden via `print:hidden` or `@media print { display: none !important; }`.
   - The receipt container expands to `100%` width with white background, black text, and standard print margins.
   - Page breaks are avoided inside critical receipt sections using `break-inside: avoid` / `page-break-inside: avoid`.
5. Once the print dialogue is closed (completed or cancelled), modal state remains intact and accessible.

---

## 7. Relevant User Interactions & Error / Edge Cases

| Scenario / Edge Case | Behavior & Fallback |
| :--- | :--- |
| **Missing / Delayed Passcard Generation** | If QR generation fails or passcard service times out, an accessible fallback message displays with the plain-text reservation code and a manual reload button. |
| **Print Cancelled / Blocked by Browser** | If `window.print()` throws or is blocked by browser policies, a secondary "Download Receipt PDF" fallback link is made available. |
| **Rapid Double-Clicks on Print** | Print trigger is debounced and disabled while the native print dialog is queued to prevent duplicate print requests. |
| **Backdrop Click Dismissal** | Optional backdrop click can dismiss the modal, but clicks inside the modal card are stopped (`e.stopPropagation()`). |
| **Small Screens / Mobile Viewports** | Modal scrolls vertically (`overflow-y: auto`) without cutting off print actions; sticky footer provides quick access to dismissal and print buttons. |

---

## 8. Practical Usage Example

```tsx
import React, { useState } from "react";
import { BookingConfirmationModal } from "@/components/booking/BookingConfirmationModal";
import type { BookingReceiptData } from "@/types/booking";

export const BookingFlowContainer: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<BookingReceiptData | null>(null);

  const handleBookingSuccess = (receipt: BookingReceiptData) => {
    setConfirmedBooking(receipt);
    setIsModalOpen(true);
  };

  return (
    <div>
      {/* Triggering booking form */}
      <button
        onClick={() =>
          handleBookingSuccess({
            id: "BK-2026-9041",
            venueName: "Second Home Coworking",
            spaceTitle: "Dedicated Hot Desk - Pod B",
            date: "2026-12-01",
            startTime: "09:00",
            endTime: "18:00",
            totalAmount: 35.0,
            currency: "EUR",
            paymentMethod: "Visa ending in 4242",
            passcode: "SH-9041-PASS",
            issuedAt: "2026-11-25T15:13:00Z",
          })
        }
      >
        Complete Reservation
      </button>

      {/* Confirmation Modal */}
      {confirmedBooking && (
        <BookingConfirmationModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          booking={confirmedBooking}
        />
      )}
    </div>
  );
};
```
