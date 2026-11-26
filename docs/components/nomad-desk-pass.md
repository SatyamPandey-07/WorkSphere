# NomadDeskPass Component

The `NomadDeskPass` component (`src/components/bookings/NomadDeskPass.tsx`) renders an interactive digital access passcard for coworking spaces, hot desks, and nomad workstations. It displays booking details, generates cryptographically signed offline check-in QR codes via `qrcode.react`, exports high-resolution pass snapshots using `html-to-image` or download handlers with sanitized filenames, and integrates with `offlinePasscardStore` for client-side IndexedDB persistence.

---

## 1. Component Purpose & Usage

When a digital nomad books a workstation or desk pass, `NomadDeskPass` acts as their digital boarding pass. It addresses common connectivity challenges in coworking basements, transit hubs, and offline venues by:
- Presenting a clear visual ticket pass with venue name, booking confirmation ID, seat/desk designation, and date/time metadata.
- Generating a scannable QR code encoding a signed check-in passcard token.
- Allowing instant PNG export so users can save their pass directly to their local photo gallery or offline file storage.
- Reading from and writing to client-side IndexedDB (`offlinePasscardStore`) so the pass remains available and verifiable without an active internet connection.

---

## 2. QR Code Rendering (`qrcode.react`)

The check-in QR code is generated using `QRCodeSVG` from `qrcode.react`:

- **Component:** `<QRCodeSVG value={token} size={192} level="H" includeMargin />`
- **Payload (`value`):** The cryptographically signed offline passcard token issued by `/api/security/qr-passcard/issue` (or loaded from `offlinePasscardStore`).
- **Error Correction Level (`level="H"`):** High error correction (~30% data recovery) guarantees fast optical decoding across cracked smartphone screens, camera glare, reflections, and low-light venue entry turnstiles.
- **Margin (`includeMargin`):** Ensures a safe quiet zone around the QR matrix when rendered on dark card backgrounds or exported to image files.
- **Loading & Fallback States:**
  - Displays `"Loading QR…"` while the passcard token is being retrieved.
  - Displays `"QR unavailable"` if the token could not be loaded or retrieved.

---

## 3. Passcard Rendering & 3D Flip Behavior

The pass features a two-sided card layout:
1. **Front Side (Venue & Workstation Overview):**
   - Workspace venue name (`venueName` or `booking.venue.name`).
   - Physical address (`booking.venue.address`).
   - Booking reference / confirmation code (`confirmationId` or `booking.confirmationId`).
   - Date, time, and workstation label (`seatLabel` / `dateLabel` or `booking.date`, `booking.time`, `booking.seatNumber`).
2. **Back Side (Secure Check-in QR Code):**
   - Header with `"SECURE CHECK-IN"` and instructions (`"Scan this signed QR code at the venue"`).
   - Centered white background container housing the `QRCodeSVG` element.
   - Confirmation code identifier displayed underneath.

The flip interaction toggles the view between front details and the back QR code, maintaining accessibility state through `aria-label` and `aria-pressed`.

---

## 4. PNG Export Mechanics (`html-to-image`)

### 4.1 Export Workflow
Users can export the passcard as a PNG image for offline storage in their camera roll or device files:
1. **Container Reference:** The passcard element is captured via a React `ref` (`cardRef`).
2. **Rasterization:** Rendered to a high-DPI PNG data URL using `toPng(cardRef.current, { cacheBust: true, pixelRatio: 2 })`.
3. **Download Trigger:** Automatically triggers an anchor click download or delegates to a caller-supplied `onDownloadPng(filename, dataUrl)` callback.

### 4.2 Filename Construction & Sanitization Rules

Export filenames are standardized via `buildDeskPassPngFilename`:
```
nomad-desk-pass-{sanitizedVenueName}-{sanitizedConfirmationId}.png
```
Or for modal booking pass exports:
```
NomadDesk-{sanitizedConfirmationId}.png
```

Filename segments are processed through `sanitizeFilenameSegment`:
1. **Unicode Decomposition:** Normalized with `NFKD` and stripped of diacritics / combining marks (`/[\u0300-\u036f]/g`), converting characters like `é` to `e`.
2. **Path & Special Character Stripping:** Invalid filesystem characters across Windows, Linux, and macOS (`[\/\\:*?"<>|]+`) are converted to hyphens (`-`).
3. **Safe Character Whitelist:** Any character outside `[a-zA-Z0-9._-]` is replaced with a hyphen.
4. **Hyphen Deduplication & Trimming:** Consecutive hyphens (`-{2,}`) collapse into a single hyphen, and leading/trailing dots or hyphens are stripped.
5. **Length Clamping:** Truncated to a maximum of 64 characters.
6. **Fallback Defaults:** If the resulting string is empty or invalid, defaults to `"worksphere-venue"` for venue names and `"pass"` for confirmation IDs.

#### Sanitization Examples

| Raw Input (`venueName` / `confirmationId`) | Sanitized Segment Output |
| :--- | :--- |
| `Bandra / West \ Hub: A*B?C` | `Bandra-West-Hub-A-B-C` |
| `Café Powai — Studio` | `Cafe-Powai-Studio` |
| `CONF\2026:01/02` | `CONF-2026-01-02` |
| `   ` (empty / spaces) | Fallback (`fallback-venue` or `fallback-id`) |

---

## 5. Offline Persistence via `offlinePasscardStore`

Client-side offline storage is managed by `src/lib/security/offlinePasscardStore.ts` using browser IndexedDB (`idb`):

- **Database Name:** `worksphere-offline-passcards`
- **Object Store:** `passcards` (keyed by `bookingId`, indexed by `validUntil`).

### 5.1 Storage Record Schema

```typescript
export interface StoredOfflinePasscard {
  bookingId: string;
  venueId: string;
  token: string;
  validFrom: number;   // Unix seconds
  validUntil: number;  // Unix seconds
  storedAt: number;    // Epoch ms
}
```

### 5.2 Storage & Retrieval Flow

1. **Local Lookup First:** When the pass opens, the component checks `getOfflinePasscardRecord(booking.id)`. If a stored token exists, it is loaded immediately without making a network call.
2. **Online Synchronization:** If no local token is found and the client is online, an API request is made to `/api/security/qr-passcard/issue`. Upon receipt, `saveOfflinePasscard(token)` persists the token into IndexedDB for subsequent offline use.
3. **Expiration Pruning:** `getOfflinePasscard(bookingId, now)` checks `now > record.validUntil * 1000`. Expired tokens are purged from the store and return `null`, preventing stale passes from being served.
4. **Bulk Booking Ingestion:** When booking lists or confirmations load, `storeOfflinePasscardsFromBooking(data)` automatically caches returned passcard tokens.

---

## 6. Offline Fallback Behavior

| Scenario | Component Behavior |
| :--- | :--- |
| **Online with network access** | Retrieves a fresh token from `/api/security/qr-passcard/issue` and saves it to IndexedDB. |
| **Offline with cached token** | Loads the token from `offlinePasscardStore` in IndexedDB; renders the QR code normally. |
| **Offline without cached token** | Displays an error state indicating the pass cannot be loaded while offline. |
| **IndexedDB unavailable / Private Mode** | Gracefully handles storage failures; the active token remains in memory for the current session. |
| **PNG export failure** | Catches rendering errors from `toPng` and sets an error message prompting the user to retry. |

---

## 7. Props & Configuration

### Modal / Full Booking Passcard Interface

```typescript
interface NomadDeskBooking {
  id: string;
  confirmationId: string;
  date: string;
  time: string;
  seatNumber?: string | null;
  venue: {
    name: string;
    address?: string | null;
  } | null;
}

interface NomadDeskPassProps {
  booking: NomadDeskBooking;
  isOpen: boolean;
  onClose: () => void;
}
```

### Card View / Direct Export Interface

```typescript
export interface NomadDeskPassProps {
  venueName: string;
  confirmationId: string;
  seatLabel?: string;     // Default: 'Hot Desk'
  dateLabel?: string;     // Default: 'Today'
  onDownloadPng?: (filename: string, dataUrl: string) => void;
}
```

---

## 8. Accessibility Behavior

- **Dialog Semantics:** Renders with `role="dialog"`, `aria-modal="true"`, and `aria-labelledby="nomad-desk-pass-title"`.
- **Keyboard Navigation:** Pressing the `Escape` key automatically invokes `onClose()`.
- **Flip Trigger Button:** Uses `aria-label` (`"Show pass front"` / `"Show QR code back"`) and `aria-pressed={flipped}` to indicate card state to screen readers.
- **Focus Rings:** Explicit `focus-visible:outline` styling ensures visible keyboard focus indicators.

---

## 9. Implementation Limitations

- **No Key Storage on Client:** Private signing keys are never exposed to the client; `offlinePasscardStore` stores only signed bearer tokens.
- **Clock Drift Sensitivity:** Validity windows rely on UTC timestamps. If a client device clock deviates significantly from UTC, client-side expiration checks may evaluate inaccurately.
- **DOM Dependencies for PNG:** PNG export requires a live DOM element and CSS layout support via `html-to-image`; headless or unattached renders cannot produce images.

---

## 10. Practical Usage Example

```tsx
'use client';

import React, { useState } from 'react';
import { NomadDeskPass } from '@/components/bookings/NomadDeskPass';

export function BookingPassSection() {
  const [isOpen, setIsOpen] = useState(false);

  const sampleBooking = {
    id: 'b-98721',
    confirmationId: 'WS-2026-X9',
    date: 'Nov 27, 2026',
    time: '09:00 AM - 06:00 PM',
    seatNumber: '42B',
    venue: {
      name: 'Downtown Nomad Hub',
      address: '100 Cyberpunk Way, Suite 400',
    },
  };

  return (
    <div className="p-4">
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
      >
        View Desk Pass
      </button>

      <NomadDeskPass
        booking={sampleBooking}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </div>
  );
}
```
