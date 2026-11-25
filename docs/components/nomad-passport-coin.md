# NomadPassportCoin Component Guide

## 1. Overview & Purpose

`NomadPassportCoin` is an interactive React component located at `src/components/profile/NomadPassportCoin.tsx`. It provides a gamified, physical-coin-inspired 3D badge visualization representing digital nomad passport status, verified travels, and earned country/city stamps in WorkSphere profiles.

The component renders a two-sided commemorative coin with realistic lighting and metallic gradients:
- **Obverse (Front Face):** Displays the primary nomad passport insignia, tier ranking (e.g., Explorer, Global Citizen), and avatar/emblem.
- **Reverse (Back Face):** Displays collected passport stamps, issue dates, and holographic cryptographic verification markings.

Users can interact with the coin via mouse hover, pointer drag, touch gestures, or keyboard focus and activation to flip between faces and inspect passport details.

---

## 2. 3D Interaction & CSS Transform Perspective

The 3D flipping and tilt effects rely on CSS 3D transforms configured on a multi-layer container hierarchy:

### 2.1 CSS Perspective & Transform Properties
1. **Perspective Container:**
   - The outer wrapper establishes depth with `perspective: 1000px` (or `perspective: 1200px`), creating an authentic focal depth for 3D rotation.
2. **Inner Rotating Card / Coin Core:**
   - Utilizes `transform-style: preserve-3d` to ensure child faces maintain their 3D positioning relative to one another.
   - Applies dynamic CSS transformations based on active interaction states:
     ```css
     transform: rotateY(var(--coin-rotation-y, 0deg)) rotateX(var(--coin-rotation-x, 0deg));
     transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);
     ```
3. **Face Orientation & Backface Visibility:**
   - Both front and back coin faces use `backface-visibility: hidden` (and `-webkit-backface-visibility: hidden`).
   - The back face is initialized with `transform: rotateY(180deg)` so that rotating the container by $180^\circ$ smoothly reveals the stamp details while hiding the front face.

---

## 3. Passport Stamp Display & Rendering

The reverse side of `NomadPassportCoin` renders verified destination stamps collected during user travels:
- **Stamp Grid / Concentric Ring Layout:** Stamps are positioned either in a circular radial layout around the coin rim or within a structured badge cluster.
- **Stamp Representation:** Each stamp includes:
  - Country or City ISO code / emblem.
  - Verification date / season timestamp.
  - WorkSphere cryptographic verification seal indicator (e.g., ZKP-verified travel proof).
- **Interactive Stamp Details:** Hovering or focusing on an individual stamp surfaces an accessible tooltip or summary pill showing the check-in venue and verification status.

---

## 4. Reduced-Motion Support & Accessibility

### 4.1 Reduced-Motion Fallbacks
For users with vestibular disorders or those who have enabled `prefers-reduced-motion: reduce`:
- **Disabling Continuous Tilt:** Gyroscopic mouse-tracking tilt effects are disabled.
- **Instant or Cross-Fade Transition:** Instead of a full 3D spatial rotation, face switching transitions instantly or uses a subtle opacity cross-fade:
  ```css
  @media (prefers-reduced-motion: reduce) {
    .coin-inner {
      transition: none !important;
      transform: none !important;
    }
    .coin-face-back.active {
      opacity: 1;
    }
  }
  ```
- A manual toggle button or accessible flip control allows users to switch between faces without motion sickness.

### 4.2 ARIA Attributes & Keyboard Interactions
- **Role & Semantics:**
  - The coin container exposes `role="button"` (or `<button>` element) with `tabIndex={0}` to be fully focusable.
  - It includes an explicit `aria-label` detailing the nomad tier and current visible face (e.g., `"Nomad Passport Coin, Gold Tier. Currently showing front. Press Enter or Space to flip."`).
  - Utilizes `aria-expanded` or `aria-pressed` to indicate whether the coin is flipped to the back side.
- **Keyboard Controls:**
  - `Enter` or `Space`: Toggles the $180^\circ$ flip between front and back faces.
  - `ArrowLeft` / `ArrowRight` (when focused): In proposed keyboard accessibility extensions, nudges rotation for 3D inspection.
  - `Escape`: Resets the coin to its default front-facing orientation.
- **Screen Reader Announcements:**
  - Changes in flipped state trigger an `aria-live="polite"` region informing assistive technology users: *"Showing passport stamps on reverse face."*

---

## 5. Component Props Interface

```typescript
export interface PassportStamp {
  id: string;
  countryCode: string;
  cityName?: string;
  verifiedAt: string | Date;
  zkProofVerified?: boolean;
  iconUrl?: string;
}

export interface NomadPassportCoinProps {
  /**
   * The nomad level or tier achieved by the user.
   * Determines coin material rendering (e.g., bronze, silver, gold, platinum).
   */
  tier?: 'bronze' | 'silver' | 'gold' | 'platinum';

  /**
   * List of verified destination stamps to render on the reverse face.
   */
  stamps?: PassportStamp[];

  /**
   * Size dimension of the coin in pixels or CSS units.
   * @default 240
   */
  size?: number | string;

  /**
   * Optional user avatar or insignia image URL to display on the front face.
   */
  insigniaUrl?: string;

  /**
   * Whether the coin is initially flipped to the reverse side.
   * @default false
   */
  initialFlipped?: boolean;

  /**
   * Callback fired whenever the coin face flip state changes.
   */
  onFlip?: (isFlipped: boolean) => void;

  /**
   * Optional custom class name for the wrapper element.
   */
  className?: string;

  /**
   * Explicit accessible label overriding default description.
   */
  ariaLabel?: string;
}
```

### Prop Breakdown

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `tier` | `'bronze' \| 'silver' \| 'gold' \| 'platinum'` | `'bronze'` | Governs the metallic shader gradient and border trim. |
| `stamps` | `PassportStamp[]` | `[]` | Array of stamp objects displayed on the coin reverse. |
| `size` | `number \| string` | `240` | Width and height bounding box of the circular coin. |
| `insigniaUrl` | `string` | `undefined` | URL for the custom user insignia or nomad avatar. |
| `initialFlipped` | `boolean` | `false` | Sets initial orientation to reverse stamp face if `true`. |
| `onFlip` | `(isFlipped: boolean) => void` | `undefined` | Callback invoked upon user flip interaction. |
| `className` | `string` | `""` | Additional CSS class for container layout integration. |
| `ariaLabel` | `string` | `undefined` | Custom accessible label for screen readers. |

---

## 6. Practical Usage Examples

### 6.1 Basic Profile Badge Integration
```tsx
import React from 'react';
import { NomadPassportCoin } from '@/components/profile/NomadPassportCoin';

export const ProfileHeaderBadge: React.FC = () => {
  return (
    <div className="flex justify-center p-6">
      <NomadPassportCoin
        tier="gold"
        size={280}
        ariaLabel="Gold Nomad Passport Coin. Click or press Enter to flip."
      />
    </div>
  );
};
```

### 6.2 Displaying Verified Travel Stamps with Flip Callback
```tsx
import React, { useState } from 'react';
import { NomadPassportCoin, PassportStamp } from '@/components/profile/NomadPassportCoin';

const sampleStamps: PassportStamp[] = [
  { id: '1', countryCode: 'JP', cityName: 'Tokyo', verifiedAt: '2026-04-12', zkProofVerified: true },
  { id: '2', countryCode: 'PT', cityName: 'Lisbon', verifiedAt: '2026-08-20', zkProofVerified: true },
  { id: '3', countryCode: 'TH', cityName: 'Chiang Mai', verifiedAt: '2026-11-05', zkProofVerified: true },
];

export const NomadPassportShowcase: React.FC = () => {
  const [flipped, setFlipped] = useState(false);

  return (
    <div className="flex flex-col items-center gap-4">
      <NomadPassportCoin
        tier="platinum"
        stamps={sampleStamps}
        size={320}
        onFlip={(isFlipped) => setFlipped(isFlipped)}
      />
      <p className="text-sm text-gray-500">
        {flipped ? 'Inspecting travel stamps' : 'Nomad status badge'}
      </p>
    </div>
  );
};
```

---

## 7. Interaction Limitations & Implemented vs. Proposed Behavior

### 7.1 Existing Implemented Behavior
- CSS 3D transform container setup with perspective and 180-degree flip mechanics.
- Render logic for front crest/tier and reverse stamp badge display.
- Standard keyboard activation via `Enter` / `Space` and focus management.
- Media query integration respecting `prefers-reduced-motion`.

### 7.2 Proposed & Recommended Improvements
- **Continuous Pointer Physics:** Realistic inertia/momentum dampening when dragging and flicking the coin on mobile touchscreens.
- **Dynamic Specular Lighting / Gyroscope:** Utilizing device orientation sensors (`DeviceOrientationEvent`) on mobile browsers to adjust the reflective metallic shine dynamically with physical phone tilt.
- **Audio Haptic Feedback:** Subtle mechanical coin-flip sound effect and web vibration API (`navigator.vibrate`) integration upon snap-to-face.
