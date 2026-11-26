# Venue Action Glassmorphic Pulse Guide

## A. Introduction and Architecture

Venue action buttons use a short, theme-specific glow pulse to make pointer hover feedback more noticeable. The effect belongs to the buttons, not to the venue card's information or state; it must not communicate information that is otherwise unavailable.

The implementation is split across:

- `src/components/venue/VenueCard.tsx` applies `venue-action-glass-btn` to the bookmark, favorite, and share buttons and supplies their accessible names, state, and focus-ring classes.
- `src/app/globals.css` defines the keyframes, theme-specific hover selectors, blur, transition, and reduced-motion override.
- `src/__tests__/components/VenueCardGlassmorphism.test.tsx` checks that the component uses the class and that the CSS contains the expected animation and reduced-motion rules.

The component owns semantics and button behavior; the global stylesheet owns the reusable visual effect. The keyframes animate glow and scale while a hover selector chooses the animation for Dark or Cyberpunk. Light mode has no pulse selector.

## B. CSS Animation Architecture

Both keyframes alternate between a base and a more pronounced glow. The Dark animation uses blue/indigo and white highlights and scales to `1.03`; Cyberpunk uses cyan and magenta highlights and scales to `1.04`.

The following is a **representative excerpt**, not the complete source:

```css
@keyframes neon-glass-pulse-dark {
  0%,
  100% {
    /* Blue/white shadow layers; scale(1) */
  }
  50% {
    /* Stronger indigo/white shadow layers; scale(1.03) */
  }
}

@keyframes neon-glass-pulse-cyberpunk {
  0%,
  100% {
    /* Cyan/magenta shadow layers; scale(1) */
  }
  50% {
    /* Stronger cyan/magenta shadow layers; scale(1.04) */
  }
}
```

In the source, both animations have endpoint declarations shared by `0%` and `100%`, plus a midpoint declaration at `50%`; they animate `box-shadow` and `transform`. They are infinite and start only while a matching button is hovered and not disabled:

```css
/* Exact selectors and timing declarations from globals.css */
.dark .venue-action-glass-btn:hover:not(:disabled),
:where(.dark, .dark *) .venue-action-glass-btn:hover:not(:disabled) {
  animation: neon-glass-pulse-dark 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

.cyberpunk .venue-action-glass-btn:hover:not(:disabled),
:where(.cyberpunk, .cyberpunk *) .venue-action-glass-btn:hover:not(:disabled) {
  animation: neon-glass-pulse-cyberpunk 1.5s cubic-bezier(0.4, 0, 0.2, 1)
    infinite;
}
```

The duplicated `:where(...)` selectors support the same theme selectors at different nesting depths; they do not represent additional themes. Leaving hover stops the animation. Disabled buttons do not start either pulse. There is no `.light` animation selector: Light mode retains the component's ordinary hover styling but does not run these keyframes.

## C. Glassmorphism and Rendering

The hover rules set both `backdrop-filter: blur(12px)` and its WebKit-prefixed counterpart. This blurs pixels behind the button; it does not blur the button's own content. Backdrop filtering can introduce an additional compositing/rendering boundary and has rendering cost, especially when many elements animate or overlap.

The animation stylesheet does not define a translucent button fill. In the example component, buttons have no base fill; their JSX applies `hover:bg-zinc-800`, which resolves to the opaque Tailwind default `#27272a`. The containing card uses `bg-zinc-900` (`#18181b`). The shadow colors in the keyframes use RGBA alpha values to layer glow over the surrounding pixels. Because the hover fill is opaque, it can largely obscure the backdrop blur; the `backdrop-filter` declaration alone does not make the surface translucent.

The Dark keyframes use blue/indigo and white shadow layers; Cyberpunk uses cyan and magenta layers. Cyberpunk also assigns a cyan `border-color`, but the example buttons do not declare a border width. A color declaration by itself does not ensure a visible border.

The base class transition is `all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`. The same curve is used for the hover pulse timing. This easing shapes the rate of change across each transition/animation cycle, avoiding a constant-speed change and giving the hover response a smooth start and finish.

The prefixed and unprefixed blur declarations cover common modern browser implementations. If a browser does not support backdrop filters, it ignores those declarations; the button, its background, text/icon, focus treatment, and box-shadow animation remain available. No stronger fallback blur or browser-specific rendering guarantee is defined here. Validate the result in the browser versions WorkSphere supports, as backdrop-filter compositing can vary.

## D. Component Integration

The following usage demonstrates the actual `VenueCard` API from `src/components/venue/VenueCard.tsx`. Action callbacks receive the venue ID; the component owns each button's accessible name and active state:

```tsx
import { VenueCard } from "@/components/venue/VenueCard";

const venue = {
  id: "venue-42",
  name: "Northstar Cafe",
  description: "A quiet place to work.",
};

<VenueCard
  venue={venue}
  onBookmark={(id) => saveBookmark(id)}
  onFavorite={(id) => updateFavorite(id)}
  onShare={(id) => shareVenue(id)}
/>;
```

The component's bookmark button uses the shared class alongside its button behavior and focus styling:

```tsx
<button
  type="button"
  onClick={handleBookmark}
  disabled={isBookmarkPending}
  aria-label={`Bookmark ${venue.name}`}
  aria-pressed={isBookmarked}
  className={`venue-action-glass-btn rounded-lg p-2 transition-colors hover:backdrop-blur-md hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 ${
    isBookmarked ? "text-emerald-400" : "text-zinc-400"
  } ${focusRingClasses}`}
>
  <Bookmark className="h-5 w-5" aria-hidden="true" />
</button>
```

This JSX is copied from the component with its surrounding imports omitted. The Favorite and Share buttons follow the same pattern. Theme awareness is provided by the CSS ancestor selectors (`.dark` and `.cyberpunk`), not by a theme prop on `VenueCard`. The `focusRingClasses` constant supplies a `focus-visible` ring; keyboard focus does not trigger the hover-only pulse.

## E. Accessibility and Reduced Motion

The stylesheet includes a targeted `@media (prefers-reduced-motion: reduce)` rule. For this class and both theme hover selectors it disables animation, transform, and transition using `!important`. The selector does not remove the hover background or backdrop filter, so those non-motion hover effects remain. A broader reduced-motion rule earlier in `globals.css` also shortens animations globally, but the targeted rule is the one that disables this pulse.

The component uses native `button` elements with `type="button"`, accessible names through `aria-label`, `aria-pressed` for bookmark/favorite state, and `aria-hidden="true"` on decorative icons. The pending bookmark button is disabled. `focusRingClasses` gives keyboard users a visible `focus-visible` ring. The pulse is not needed to understand an action or its state.

When modifying these controls:

- Keep all actions operable by keyboard and retain a visible focus indicator.
- Keep the reduced-motion override; do not make focus or state feedback depend on animation.
- Preserve accessible names and programmatic pressed/disabled state.
- Verify text and meaningful icon contrast in every rendered state.
- Do not claim a broader accessibility audit from the source-based test; it does not inspect rendered contrast or browser behavior.

## F. WCAG 2.1 AA Contrast Analysis

The table below evaluates the actual utility colors of the `VenueCard` implementation in `src/components/venue/VenueCard.tsx`. That component explicitly uses the same `bg-zinc-900`, `text-zinc-100`, `text-zinc-400`, `text-emerald-400`, and `text-rose-500` utilities regardless of global theme. Therefore Dark, Cyberpunk, and Light have the same component-level color pairs here; the global theme changes which pulse selector runs, not these explicit colors.

The values are Tailwind's default palette values: `zinc-900` `#18181b`, `zinc-800` `#27272a`, `zinc-100` `#f4f4f5`, `zinc-400` `#a1a1aa`, `emerald-400` `#34d399`, and `rose-500` `#f43f5e`. The card's base surface is opaque `#18181b`; the action-button background is transparent at rest and opaque `#27272a` on hover. The ratios below compare foreground colors directly with those declared solid surfaces. They do not treat glow, focus rings, or backdrop pixels as a text/icon background.

| Theme     | Visible text foreground and surface                             |                 Text contrast | Inactive icon and surface                      | Icon contrast (rest / hover) | AA result |
| --------- | --------------------------------------------------------------- | ----------------------------: | ---------------------------------------------- | ---------------------------: | --------- |
| Dark      | Heading `#f4f4f5` / `#18181b`; muted text `#a1a1aa` / `#18181b` | Heading 16.12:1; muted 6.91:1 | `#a1a1aa` / `#18181b`, then `#27272a` on hover |              6.91:1 / 5.81:1 | Pass      |
| Cyberpunk | Heading `#f4f4f5` / `#18181b`; muted text `#a1a1aa` / `#18181b` | Heading 16.12:1; muted 6.91:1 | `#a1a1aa` / `#18181b`, then `#27272a` on hover |              6.91:1 / 5.81:1 | Pass      |
| Light     | Heading `#f4f4f5` / `#18181b`; muted text `#a1a1aa` / `#18181b` | Heading 16.12:1; muted 6.91:1 | `#a1a1aa` / `#18181b`, then `#27272a` on hover |              6.91:1 / 5.81:1 | Pass      |

The source also uses active bookmark icon color `#34d399` and active favorite color `#f43f5e`. Their contrast is 9.22:1 and 4.83:1 against the resting `#18181b` surface, and 7.75:1 and 4.06:1 against the hover `#27272a` surface, respectively; all exceed 3:1.

For these text sizes, WCAG 2.1 AA requires 4.5:1 for normal text. Large text may use 3:1; the 18px venue heading is below the WCAG large-text threshold, so the stricter 4.5:1 threshold applies. Meaningful icons and control graphics are evaluated against the 3:1 non-text contrast requirement where WCAG 1.4.11 applies. All listed pairs meet their applicable thresholds.

**Method:** Convert each sRGB channel to linear light (`c / 12.92` when `c <= 0.04045`; otherwise `((c + 0.055) / 1.055) ^ 2.4`), compute relative luminance as `0.2126 R + 0.7152 G + 0.0722 B`, then calculate `(lighter luminance + 0.05) / (darker luminance + 0.05)`. Ratios are calculated from the opaque utility colors, not estimated from a screenshot.

**Scope limitation:** `src/components/VenueCard.tsx` is a separate, larger card that also uses this global class and includes theme-dependent and accent-based action styling. These figures are not a certification of every use of `.venue-action-glass-btn`; verify that component's actual rendered color pairs and dynamic accent colors separately.

References: [WCAG 2.1 Success Criterion 1.4.3: Contrast (Minimum)](https://www.w3.org/TR/WCAG21/#contrast-minimum), [WCAG 2.1 Success Criterion 1.4.11: Non-text Contrast](https://www.w3.org/TR/WCAG21/#non-text-contrast), and [W3C relative luminance and contrast ratio definition](https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio).

## G. Testing and Maintenance

The focused test is `src/__tests__/components/VenueCardGlassmorphism.test.tsx`. It verifies the action buttons include `venue-action-glass-btn` and `hover:backdrop-blur-md`, and checks that the stylesheet contains both keyframe names, the easing curve, theme hover selectors, blur declaration, and reduced-motion rule. It is a source/class test, not a visual or contrast test.

Run it from the repository root:

```bash
npx jest src/__tests__/components/VenueCardGlassmorphism.test.tsx --runInBand
```

To check reduced-motion behavior in a browser, emulate `prefers-reduced-motion: reduce` in DevTools, hover an enabled action button in Dark and Cyberpunk, and confirm the pulse/scale and transition are absent while the button remains usable and focusable. Also tab to the buttons and confirm the visible focus ring appears without requiring a hover animation.

For future animation changes:

- Keep keyframe names, theme selectors, duration, and test assertions in sync.
- Check hover and disabled states in Dark, Cyberpunk, and Light.
- Recalculate contrast when foreground, surface, opacity, or dynamic accent colors change; include both rest and hover backgrounds.
- Inspect the effect with and without backdrop-filter support and with reduced motion enabled.
- Avoid animating non-composited properties across many controls without measuring the rendering cost.

## H. Troubleshooting

| Symptom                       | Checks                                                                                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backdrop blur is not visible  | Confirm the hovered element is inside a `.dark` or `.cyberpunk` ancestor and inspect computed `backdrop-filter`/`-webkit-backdrop-filter`. The example's opaque `hover:bg-zinc-800` fill can hide much of the blur. Unsupported browsers ignore the filter; the other button styling should remain. |
| Animation does not trigger    | Check that the pointer is over an enabled button with `venue-action-glass-btn`, and that a `.dark` or `.cyberpunk` ancestor is present. Light has no pulse rule. Inspect computed `animation-name` and look for another rule overriding it.                                                         |
| Wrong theme animation appears | Confirm the active theme class on an ancestor. Dark selects `neon-glass-pulse-dark`; Cyberpunk selects `neon-glass-pulse-cyberpunk`. Check for both classes being applied or an application-level theme transition before changing the selectors.                                                   |
| Pulse is absent               | Check the operating system/browser reduced-motion setting and DevTools emulation. The expected reduced-motion result is `animation: none`, `transform: none`, and `transition: none` for the action button.                                                                                         |
| Contrast looks poor           | Inspect computed text/icon and surface colors, including active icon state and hover background. Do not rely on the glow as the only contrast; re-run the WCAG calculation for the actual pair.                                                                                                     |
| Rendering differs by browser  | Check support for `backdrop-filter`, stacking/compositing contexts, ancestor clipping, and both prefixed/unprefixed computed properties. Test at the supported browser/device sizes; do not assume blur is identical across engines.                                                                |
