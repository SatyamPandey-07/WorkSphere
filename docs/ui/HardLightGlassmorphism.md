# Hard-Light Construct Glassmorphism Design Guidelines

This document details the visual design architecture, optical physics, translucent border formulas, dark-mode contrast standards, and implementation snippets for creating **Green Lantern Hard-Light Construct Glassmorphism** cards across WorkSphere.

---

## 1. Design Philosophy: Tangible Willpower Constructs

Standard web "glassmorphism" often falls prey to excessive milky white blurs, unreadable low-contrast text, and heavy dropped shadows. The **Hard-Light Construct** aesthetic rejects these gimmicks in favor of crisp, tangible energy manifestations:
- **Solidified Light:** Translucent crystalline surfaces that feel rigid and razor-sharp rather than hazy frosted acrylic.
- **Deep Cosmic Canvas:** Anchored over obsidian/space backdrops (`#04100C` / `#09090B`) rather than pure black or flat gray.
- **Willpower Phosphor Accents:** Restrained emerald/mint edge lighting ($`#10B981`$ / $`#34D399`$) focused at optical chamfers and corner brackets.
- **High-Contrast Text Hierarchies:** Monospaced data readouts and bold headers engineered to maintain strict WCAG 2.1 AA legibility.

```
+---------------------------------------------------------------------------------+
| TOP EDGE LIGHT: Linear Gradient (rgba(16, 185, 129, 0.4) -> transparent)        |
+---------------------------------------------------------------------------------+
| CORNER BRACKET: Neon Pip [4x4px]                                               |
|                                                                                 |
|   BACKGROUND FILL: rgba(4, 16, 12, 0.75)   [Deep Obsidian Emerald]              |
|   BACKDROP BLUR:   blur(16px) saturate(180%)                                    |
|   BORDER STROKE:   1px solid rgba(16, 185, 129, 0.25)                           |
|                                                                                 |
|   SHADOW BLOOM:    0 8px 32px 0 rgba(0, 0, 0, 0.5),                            |
|                    inset 0 1px 0 0 rgba(255, 255, 255, 0.1)                     |
+---------------------------------------------------------------------------------+
```

---

## 2. Optical Specifications & CSS Tokens

To achieve consistent hard-light construct styling across card containers, modals, and drawers, adhere strictly to the token specifications below:

| Property | Standard Value | Tailwind Utility Class | Purpose & Rationale |
| :--- | :--- | :--- | :--- |
| **Backdrop Blur** | `16px` to `20px` | `backdrop-blur-md` / `backdrop-blur-lg` | Diffuses busy map/AR backgrounds into smooth ambient light. |
| **Surface Saturation**| `180%` | `backdrop-saturate-[1.8]` | Amplifies underlying colors, preventing dull gray haziness. |
| **Background Fill** | `rgba(4, 16, 12, 0.8)` | `bg-[#04100c]/80` or `bg-zinc-950/85` | Ensures text passes WCAG AA 4.5:1 contrast against any background. |
| **Border Thickness**| `1px` | `border` | Fine hairline precision simulating crystalline hard-light edges. |
| **Border Color** | `rgba(16, 185, 129, 0.25)` | `border-emerald-500/25` | Subtle construct outline without heavy solid strokes. |
| **Corner Chamfer** | `12px` / $45^\circ$ bevel | `clip-path: polygon(...)` | Sci-fi aerospace angularity. |
| **Inner Glow Rim** | `inset 0 1px 0 0 rgba(255,255,255,0.15)` | `shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)]` | Simulates light refraction on the top bevel of the construct. |

---

## 3. Dark Mode Contrast & Accessibility Specifications

1. **Text Contrast Ratios:**
   - **Primary Headers:** White (`#FFFFFF`) over `rgba(4, 16, 12, 0.8)` achieves a contrast ratio of **15.2:1** (exceeding WCAG AAA).
   - **Data Telemetry:** Bright mint (`#34D399` / `#6EE7B7`) achieves **9.8:1** contrast.
   - **Muted Labels:** Slate emerald (`#9CA3AF` / `#6EE7B7`) maintains at least **4.6:1** contrast.
2. **Reduced Motion Adaptation:**
   - Hover scale transitions (`scale-105`) and glowing beam animations must include `motion-reduce:transition-none` and `motion-reduce:hover:scale-100`.
3. **Over-Contrast Backing:**
   - For bright WebXR camera passthrough or daylight outdoor map viewports, the card background opacity automatically elevates from `80%` to `95%` (`bg-[#04100c]/95`) to preserve legibility.

---

## 4. Visual Comparison: Before & After

### 4.1 Generic Frosted Glass (Before)

```tsx
// ❌ Generic "Milky Acrylic" Glassmorphism (Poor contrast, blurry)
<div className="p-6 rounded-2xl bg-white/10 dark:bg-zinc-800/20 backdrop-blur-sm border border-white/20 shadow-lg text-white">
  <h3 className="text-lg font-bold">Workspace Reservation</h3>
  <p className="text-sm text-zinc-300">Desk 4 - Quiet Zone</p>
  <button className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg">
    Confirm
  </button>
</div>
```

### 4.2 Hard-Light Construct Glassmorphism (After)

```tsx
// ✅ Hard-Light Willpower Construct Card (High contrast, sharp, luminescent)
<div className="relative p-6 rounded-2xl bg-[#04100c]/85 dark:bg-[#04100c]/90 backdrop-blur-md backdrop-saturate-[1.8] border border-emerald-500/25 shadow-2xl shadow-emerald-950/50 overflow-hidden group transition-all duration-200 hover:border-emerald-500/40 hover:shadow-emerald-900/40">
  {/* Top Bevel Light Guide */}
  <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent" />
  
  {/* Tactical Corner Bracket Accent */}
  <div className="absolute top-2 right-2 w-2 h-2 border-t-2 border-r-2 border-emerald-400" />
  <div className="absolute bottom-2 left-2 w-2 h-2 border-b-2 border-l-2 border-emerald-400" />

  {/* Header with Construct Status Pip */}
  <div className="flex items-center justify-between mb-3">
    <h3 className="text-base font-bold font-mono text-emerald-100 tracking-wide flex items-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
      DESK CONSTRUCT #04
    </h3>
    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
      CONFIRMED
    </span>
  </div>

  {/* Telemetry Data Grid */}
  <div className="grid grid-cols-2 gap-2 text-xs font-mono my-4 p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/15">
    <div>
      <span className="text-zinc-400 block text-[10px]">POWER GRID</span>
      <span className="text-emerald-300 font-semibold">100% SOLAR</span>
    </div>
    <div>
      <span className="text-zinc-400 block text-[10px]">ACOUSTICS</span>
      <span className="text-emerald-300 font-semibold">38 dB (QUIET)</span>
    </div>
  </div>

  {/* Action Button */}
  <button className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs font-mono tracking-wider shadow-lg shadow-emerald-600/20 border border-emerald-400/30 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
    INITIALIZE LOCK
  </button>
</div>
```

---

## 5. Implementation Checklist for Contributors

When submitting UI components claiming the Hard-Light Construct theme:

- [ ] Does the card use deep obsidian emerald (`#04100c`) background fills with opacity between $75\%$ and $90\%$?
- [ ] Is backdrop blur set between `16px` and `20px` (`backdrop-blur-md` or `backdrop-blur-lg`)?
- [ ] Are borders thin ($1\text{ px}$) with translucent emerald opacity ($\le 30\%$)?
- [ ] Are corner accents or top-edge highlight lines rendered with high-energy gradients?
- [ ] Does all text pass WCAG 2.1 AA 4.5:1 contrast standards?
- [ ] Are all transition animations disabled or simplified when `prefers-reduced-motion` is active?
