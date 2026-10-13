# Component Reference: `NoiseLevelBadge` & Decibel Acoustic Bands

This document provides complete reference documentation for the **`NoiseLevelBadge`** UI component located at [`src/components/ui/NoiseLevelBadge.tsx`](file:///c:/Users/admin/Desktop/workfere/src/components/ui/NoiseLevelBadge.tsx), covering its decibel threshold boundaries, semantic tiers, visual themes, accessibility traits, and JSX integration examples.

---

## 1. Component Overview & Purpose

Acoustic comfort is one of the highest-weighted decision factors when remote knowledge workers choose workspaces, coworking lounges, and library seats.

`NoiseLevelBadge` translates ambient acoustic decibel ($\text{dB}$) readings and sensory noise descriptors into an intuitive, glanceable visual indicator:
1. **Multi-Signal Input Parsing:** Accepts qualitative strings (`"quiet"`, `"moderate"`, `"loud"`, `"lively"`, `"silent"`) and maps them to standard acoustic tiers.
2. **Three-Tier Decibel Bands:** Classifies audio environments into **Quiet Focus** ($< 50\,\text{dB}$), **Moderate Ambience** ($50\text{--}70\,\text{dB}$), and **Lively & Energetic** ($> 70\,\text{dB}$).
3. **Adaptive Visual Styling:** Supports multiple display variants (`default`, `compact`, `subtle`), sizes (`sm`, `md`, `lg`), and dark-mode compatible Tailwind CSS styles.
4. **Accessible Semantics:** Renders with `role="status"` and rich `aria-label` screen reader announcements including exact decibel thresholds and descriptions.

```mermaid
flowchart TD
    Input["noiseLevel prop (string | null | undefined)"] --> Parser["parseNoiseLevel(level)"]
    
    Parser --> Match{"Normalized Tier Match?"}
    
    Match -->|"quiet", "silent", "calm"| Quiet["tier: 'quiet'<br/>Range: < 50 dB<br/>Label: 'Quiet Focus'"]
    Match -->|"moderate", "medium", "average"| Mod["tier: 'moderate'<br/>Range: 50-70 dB<br/>Label: 'Moderate Ambience'"]
    Match -->|"loud", "noisy", "lively", "energetic", "high"| Loud["tier: 'loud'<br/>Range: > 70 dB<br/>Label: 'Lively & Energetic'"]
    Match -->|Unmatched / null| Unmatched{"showUnknown === true?"}
    
    Unmatched -->|Yes| UnknownBadge["Render Neutral 'Unknown Noise' Badge"]
    Unmatched -->|No| ReturnNull["Return null (Render Nothing)"]
    
    Quiet --> ApplyStyles["Apply Tier Styles (Emerald, Amber, Rose)<br/>Apply Variant & Size Classes"]
    Mod --> ApplyStyles
    Loud --> ApplyStyles
    
    ApplyStyles --> Render["Render Accessible <span role='status'> Badge"]
```

---

## 2. Decibel Bands & Tier Mappings

The component maps sensory tiers and decibel thresholds via `NOISE_LEVEL_MAP`:

| Acoustic Tier | Decibel Threshold Range | Display Label | Short Label (Compact) | Acoustic Environment Description | Lucide Icon | Status Dot Indicator |
| :--- | :---: | :--- | :--- | :--- | :---: | :---: |
| **`quiet`** | $< 50\,\text{dB}$ (typically $< 45\text{--}50\,\text{dB}$) | **Quiet Focus** | Quiet | Deep focus, confidential phone calls, silent study | `<Volume1 />` | `bg-emerald-500` (🟢) |
| **`moderate`** | $50\text{--}70\,\text{dB}$ ($45\text{--}65\,\text{dB}$ typical cafe) | **Moderate Ambience** | Moderate | Standard cafe chatter, coworking hum, soft background music | `<Volume2 />` | `bg-amber-500` (🟡) |
| **`loud`** | $> 70\,\text{dB}$ ($> 65\,\text{dB}$ social/crowded) | **Lively & Energetic** | Lively | Bustling social space, bar atmosphere, loud music, events | `<Volume2 />` | `bg-rose-500` (🔴) |

---

## 3. Visual Styling & Color Scheme Specification

### 3.1 Tailwind CSS Palette by Tier

The badge uses dual-theme Tailwind CSS classes optimized for both light mode and dark workspace backgrounds:

| Tier | Default Variant (Light / Dark) | Subtle Variant (Light / Dark) | Dot Color |
| :--- | :--- | :--- | :--- |
| **`quiet`** | `bg-emerald-50 border-emerald-200/80 text-emerald-700`<br>`dark:bg-emerald-950/40 dark:border-emerald-800/60 dark:text-emerald-300` | `bg-transparent text-emerald-700 dark:text-emerald-400` | `bg-emerald-500` |
| **`moderate`** | `bg-amber-50 border-amber-200/80 text-amber-700`<br>`dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-300` | `bg-transparent text-amber-700 dark:text-amber-400` | `bg-amber-500` |
| **`loud`** | `bg-rose-50 border-rose-200/80 text-rose-700`<br>`dark:bg-rose-950/40 dark:border-rose-800/60 dark:text-rose-300` | `bg-transparent text-rose-700 dark:text-rose-400` | `bg-rose-500` |
| **`unknown`** | `bg-zinc-50 border-zinc-200 text-zinc-500`<br>`dark:bg-zinc-900/50 dark:border-zinc-800 dark:text-zinc-400` | N/A | N/A |

### 3.2 Size Variations

| Size (`size`) | Padding & Font Classes | Icon Dimensions |
| :---: | :--- | :---: |
| **`sm`** | `px-2 py-0.5 text-[11px] gap-1` | `h-3 w-3` ($12\text{px}$) |
| **`md`** (default) | `px-2.5 py-0.5 text-xs gap-1.5` | `h-3.5 w-3.5` ($14\text{px}$) |
| **`lg`** | `px-3.5 py-1 text-sm gap-2` | `h-4 w-4` ($16\text{px}$) |

---

## 4. Props Reference (`NoiseLevelBadgeProps`)

| Prop Name | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| `noiseLevel` | `string \| null \| undefined` | `undefined` | Ambient noise level string (e.g., `"quiet"`, `"moderate"`, `"lively"`). Automatically normalized. |
| `showDecibels` | `boolean` | `false` | When `true`, appends the decibel threshold in parentheses (e.g., `Quiet Focus (< 50 dB)`). |
| `variant` | `"default" \| "compact" \| "subtle"` | `"default"` | Visual style mode. `"compact"` uses `shortLabel`; `"subtle"` renders transparent without background/border. |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | Component scale and typography size. |
| `showUnknown` | `boolean` | `false` | When `true`, renders a neutral fallback badge when `noiseLevel` is unrecognized or null; otherwise returns `null`. |
| `className` | `string` | `""` | Additional CSS class overrides appended to the badge wrapper. |

---

## 5. Usage Examples

### 5.1 Venue Search Card Integration

```tsx
import React from "react";
import { NoiseLevelBadge } from "@/components/ui/NoiseLevelBadge";

interface VenueCardProps {
  name: string;
  address: string;
  noiseLevel: string;
}

export function VenueCard({ name, address, noiseLevel }: VenueCardProps) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-zinc-900 dark:text-zinc-100">{name}</h3>
          <p className="text-xs text-zinc-500">{address}</p>
        </div>

        {/* Compact noise badge with decibel band */}
        <NoiseLevelBadge
          noiseLevel={noiseLevel}
          variant="compact"
          size="sm"
          showDecibels
        />
      </div>
    </div>
  );
}
```

### 5.2 Real-Time Acoustic Telemetry & Live Audio Monitoring

```tsx
"use client";

import React from "react";
import { NoiseLevelBadge } from "@/components/ui/NoiseLevelBadge";
import { Activity, Mic } from "lucide-react";

interface LiveAudioMonitorProps {
  currentDb: number;
  liveReadingText: string; // e.g. "quiet", "moderate", or "loud"
}

export function LiveAudioMonitoringPanel({
  currentDb,
  liveReadingText,
}: LiveAudioMonitorProps) {
  return (
    <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 shadow-md space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-500" />
          <h4 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
            Live Ambient Acoustic Monitor
          </h4>
        </div>

        {/* Large badge with complete decibel band information */}
        <NoiseLevelBadge
          noiseLevel={liveReadingText}
          variant="default"
          size="lg"
          showDecibels
        />
      </div>

      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-black font-mono text-zinc-900 dark:text-zinc-50">
          {Math.round(currentDb)} <span className="text-sm font-normal text-zinc-400">dB</span>
        </span>
        <span className="text-xs text-zinc-500">
          Calibrated Real-time Root Mean Square (RMS) Level
        </span>
      </div>
    </div>
  );
}
```

---

## 6. Accessibility (a11y) & SEO Considerations

- **Screen Reader Announcements:** The element features `role="status"` and `aria-label="Ambient noise level: {label} ({decibelRange})"`.
- **Decorative SVGs:** Inner iconography (`<Volume1 />`, `<Volume2 />`) and status dots use `aria-hidden="true"` to prevent redundant screen reader chatter.
- **Tooltip Discovery:** Native `title` attribute communicates the full tier label, threshold range, and practical workspace recommendation on hover.
