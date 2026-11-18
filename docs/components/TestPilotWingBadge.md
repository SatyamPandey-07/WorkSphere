# `TestPilotWingBadge`: Aviator Insignia Component Reference Guide

This document details the software architecture, TypeScript props, tier variations, SVG construct asset guidelines, and profile header integration patterns for the **`TestPilotWingBadge`** component (`src/components/badges/TestPilotWingBadge.tsx`).

---

## 1. Executive Summary & Aviator Insignia Lore

Inspired by military test pilot flight qualifications and Green Lantern aerospace lore, the `TestPilotWingBadge` awards prestigious visual insignia to nomadic remote workers based on verified venue check-in milestones, multi-city coworking streaks, and beta exploration telemetry:

- **Bronze Wings (Cadet Aviator):** Unlocked after 3 verified coworking venue check-ins.
- **Gold Flight Wings (Senior Test Pilot):** Unlocked after 10 verified check-ins and 3 distinct city bookings.
- **Emerald Corps Insignia (Master Flight Officer):** Unlocked after 25+ verified check-ins, high-speed WiFi bench-tests, and active community consensus voting.

```
                  BRONZE WINGS                   GOLD FLIGHT WINGS                 EMERALD CORPS INSIGNIA
               /\               /\              /\               /\                   /\                 /\
              /  \---[ ★ ]---/  \            /  \---[ ★★ ]---/  \                 /  \---[ ⬢ OA ⬢ ]---/  \
             /____________________\          /____________________\               /_________________________\
               Bronze Metallic Tint            Polished Dual-Gold Aura              Willpower Phosphor Halos
```

---

## 2. Component Props Specification

### 2.1 TypeScript Interface

```typescript
export type TestPilotTier = "bronze" | "gold" | "emerald";
export type BadgeSize = "sm" | "md" | "lg";

export interface TestPilotWingBadgeProps {
  /** Qualification tier */
  tier: TestPilotTier;
  /** Sizing variant */
  size?: BadgeSize;
  /** Number of verified check-ins earned */
  checkInCount?: number;
  /** Custom callsign / nomad handle */
  callsign?: string;
  /** Interactive tooltip placement */
  tooltipPosition?: "top" | "bottom" | "left" | "right";
  /** Optional click callback for modal drilldown */
  onClick?: () => void;
  /** Custom container styling */
  className?: string;
}
```

### 2.2 Props Details Table

| Prop | Type | Default | Operational Context |
| :--- | :--- | :--- | :--- |
| `tier` | `"bronze" \| "gold" \| "emerald"` | **Required** | Determines insignia material palette, SVG star glyphs, and glow filters. |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | Controls badge dimensions (`sm`: 20px height, `md`: 28px, `lg`: 40px). |
| `checkInCount` | `number` | `0` | Rendered inside interactive tooltip progress telemetry. |
| `callsign` | `string` | `undefined` | Optional military aviator moniker (e.g., "Maverick", "Lantern-01"). |
| `tooltipPosition` | `"top" \| "bottom" \| "left" \| "right"` | `"top"` | Anchors accessible floating tooltip container. |
| `onClick` | `() => void` | `undefined` | Triggers pilot achievements drawer or passport gallery view. |
| `className` | `string` | `""` | Additional Tailwind utility classes. |

---

## 3. Tier Variations & Material Styling

| Tier | Aesthetic Finish | Primary Fill / Stroke | Glow & Bloom Effect | Qualification Criteria |
| :--- | :--- | :--- | :--- | :--- |
| **Bronze Wings** | Matte Brushed Bronze | `#b45309` / `#d97706` | None / subtle shadow | 3+ Verified Venue Check-ins |
| **Gold Flight Wings** | Polished Dual-Gold | `#eab308` / `#fef08a` | `drop-shadow(0 0 6px #facc15)` | 10+ Check-ins & 3 Distinct Cities |
| **Emerald Corps Insignia** | Willpower Construct Crystal | `#10b981` / `#34d399` | `drop-shadow(0 0 10px #10b981)` | 25+ Check-ins & Top 5% Contributor |

---

## 4. SVG Vector Construct Optimization Guidelines

Aviator wings use sharp, vector-optimized geometry crafted to prevent sub-pixel blurring at micro scales:

```tsx
export function FlightWingSVG({ tier, size = "md" }: { tier: TestPilotTier; size: BadgeSize }) {
  const dimensions = {
    sm: "w-6 h-3",
    md: "w-10 h-5",
    lg: "w-16 h-8",
  }[size];

  const strokeColor = {
    bronze: "#d97706",
    gold: "#facc15",
    emerald: "#34d399",
  }[tier];

  return (
    <svg viewBox="0 0 64 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={dimensions}>
      {/* Left Wing Feathers */}
      <path d="M 2 12 L 18 4 L 28 8 L 26 18 L 14 16 Z" stroke={strokeColor} strokeWidth="1.5" fill="currentColor" fillOpacity="0.15" />
      <path d="M 6 15 L 20 8 L 28 11" stroke={strokeColor} strokeWidth="1" />
      
      {/* Right Wing Feathers */}
      <path d="M 62 12 L 46 4 L 36 8 L 38 18 L 50 16 Z" stroke={strokeColor} strokeWidth="1.5" fill="currentColor" fillOpacity="0.15" />
      <path d="M 58 15 L 44 8 L 36 11" stroke={strokeColor} strokeWidth="1" />

      {/* Center Shield Core */}
      <polygon points="32,3 38,10 32,21 26,10" stroke={strokeColor} strokeWidth="2" fill="currentColor" fillOpacity="0.3" />
      
      {/* Tier Emblems */}
      {tier === "emerald" && <circle cx="32" cy="11" r="2.5" fill="#10b981" />}
      {tier === "gold" && <polygon points="32,7 33.5,10.5 37,11 34.5,13.5 35,17 32,15 29,17 29.5,13.5 27,11 30.5,10.5" fill="#facc15" />}
    </svg>
  );
}
```

---

## 5. Sample Integration: User Profile Header

The following example demonstrates embedding `TestPilotWingBadge` alongside user profile credentials:

```tsx
"use client";

import React from "react";
import { TestPilotWingBadge } from "@/components/badges/TestPilotWingBadge";

export function NomadProfileHeader({
  nomad = {
    name: "Hal Jordan",
    callsign: "Green-Lantern-01",
    verifiedCheckIns: 28,
    homeCity: "Coast City // Nomad Sector 2814",
  },
}) {
  return (
    <div className="relative p-6 rounded-2xl bg-zinc-950/90 border border-zinc-800 shadow-xl flex items-center justify-between">
      <div className="flex items-center gap-4">
        {/* User Avatar */}
        <div className="relative w-14 h-14 rounded-2xl bg-emerald-950 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-xl">
          HJ
        </div>

        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-white">{nomad.name}</h1>
            
            {/* Aviator Test Pilot Wing Badge */}
            <TestPilotWingBadge
              tier="emerald"
              size="md"
              checkInCount={nomad.verifiedCheckIns}
              callsign={nomad.callsign}
              tooltipPosition="top"
            />
          </div>
          <p className="text-xs text-zinc-400 font-mono mt-0.5">{nomad.homeCity}</p>
        </div>
      </div>

      <div className="text-right font-mono text-xs">
        <span className="text-zinc-500 block text-[10px]">FLIGHT HOURS</span>
        <span className="text-emerald-400 font-bold">142.5 HRS</span>
      </div>
    </div>
  );
}
```

---

## 6. Accessibility & Screen Reader Standards

1. **Semantic Role:** Badges render with `role="img"` or interactive `role="button"`.
2. **Accessible Labels:** Uses informative `aria-label` formatted as:  
   `aria-label="Emerald Corps Insignia - 28 verified coworking check-ins"`.
3. **Keyboard Focus:** Supports <kbd>Tab</kbd> navigation with standard focus rings (`focus:ring-2 focus:ring-emerald-400`).
