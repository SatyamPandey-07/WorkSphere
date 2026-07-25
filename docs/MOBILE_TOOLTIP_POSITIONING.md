# Mobile Responsive Tooltip Positioning

## Overview

Several interactive components in WorkSphere display contextual tooltips to improve usability without cluttering the interface.

Because desktop and mobile devices have different viewport constraints, tooltip positioning must automatically adapt to prevent clipping or overflow outside the visible screen.

This guide explains responsive positioning, viewport boundary handling, accessibility requirements, and implementation examples for components such as `ReadAloudButton`.

---

## Responsive Positioning Strategy

Tooltips should remain fully visible regardless of screen size.

### Desktop Behaviour

On medium and large screens, tooltips are displayed above the triggering element.

Example positioning classes:

```tsx
sm: bottom - full;
sm: mb - 2;
```

This keeps the tooltip close to the trigger while avoiding overlap with surrounding controls.

### Mobile Behaviour

On narrow screens, the tooltip automatically appears below the trigger.

Example positioning classes:

```tsx
top - full;
mt - 2;
```

Displaying the tooltip beneath the trigger provides additional vertical space and reduces the likelihood of clipping near the top edge of the viewport.

---

## Viewport Boundary Calculations

Responsive tooltips should never extend beyond the visible browser viewport.

The current implementation uses responsive Tailwind utility classes to reposition the tooltip according to the available viewport space.

### Horizontal Overflow Prevention

On very small screens, centring a tooltip can cause its edges to extend beyond the viewport.

Instead of remaining centred, the tooltip aligns with the left edge of the trigger.

Example:

```tsx
left-1/2
-translate-x-1/2

max-[380px]:left-0
max-[380px]:translate-x-0
```

This keeps the tooltip fully visible on narrow mobile devices.

### Width Constraints

Tooltip width should adapt to the available viewport width instead of expanding indefinitely.

Example:

```tsx
w-max
max-w-[calc(100vw-1rem)]
break-words
text-center
```

These utilities ensure that:

- Long text wraps correctly.
- The tooltip never exceeds the viewport width.
- Horizontal scrolling is avoided.

### Layering

Tooltips should remain above surrounding interface elements.

Example:

```tsx
z - 50;
```

Using a high stacking order prevents tooltips from being hidden behind cards, dialogs, or other positioned elements.

---

## Automatic Position Flipping

Responsive tooltips should automatically adjust their placement when there is insufficient space in the preferred direction.

### Vertical Flipping

Desktop layouts typically display tooltips above the trigger.

```tsx
sm: bottom - full;
sm: mb - 2;
```

On smaller screens, the tooltip is positioned below the trigger instead.

```tsx
top - full;
mt - 2;
```

This prevents the tooltip from extending beyond the top edge of the viewport.

### Horizontal Repositioning

Tooltips are centred relative to the trigger on larger screens.

```tsx
left - 1 / 2 - translate - x - 1 / 2;
```

On very narrow displays, the tooltip shifts toward the left edge of the trigger.

```tsx
max-[380px]:left-0
max-[380px]:translate-x-0
```

This adjustment reduces the risk of horizontal overflow while maintaining a consistent visual relationship with the triggering element.

The tooltip remains visually connected to its trigger while ensuring the content stays within the viewport boundaries.

### Benefits

Automatic position changes help to:

- Keep tooltip content completely visible.
- Prevent clipping at viewport edges.
- Improve usability on touch devices.
- Reduce the need for horizontal scrolling.

---

## Accessibility

Responsive tooltips should be accessible to both keyboard users and assistive technologies.

### `aria-describedby`

The triggering element should reference the tooltip using the `aria-describedby` attribute.

Example:

```tsx
<button aria-describedby="read-aloud-tooltip">Read Aloud</button>
```

This enables screen readers to announce the tooltip content when the trigger receives keyboard focus.

### `role="tooltip"`

The tooltip container should include the appropriate ARIA role.

Example:

```tsx
<div id="read-aloud-tooltip" role="tooltip">
  Read aloud
</div>
```

Using `role="tooltip"` allows assistive technologies to recognise the element as descriptive content associated with the triggering control.

### Keyboard Accessibility

Tooltips should be available to both mouse and keyboard users.

Typical behaviour includes:

- Displaying on mouse hover.
- Displaying when the trigger receives keyboard focus.
- Hiding when focus leaves the trigger.
- Remaining non-interactive while visible.

This behaviour provides a consistent experience across desktop, mobile, and assistive technologies.

---

## Creating Responsive Tooltips

When adding a new interactive button, wrap it with the tooltip container so the same responsive positioning behaviour is reused.

### Example

```tsx
function Tooltip({
  children,
  text,
}: {
  children: React.ReactNode;
  text: string;
}) {
  return (
    <div className="relative inline-flex items-center group">
      {children}

      <div
        id="read-aloud-tooltip"
        role="tooltip"
        className="
          pointer-events-none
          absolute
          left-1/2
          -translate-x-1/2
          max-[380px]:left-0
          max-[380px]:translate-x-0
          top-full
          mt-2
          sm:top-auto
          sm:bottom-full
          sm:mb-2
          sm:mt-0
          z-50
          w-max
          max-w-[calc(100vw-1rem)]
          break-words
          text-center
          rounded-md
          bg-zinc-900
          px-2
          py-1
          text-xs
          text-white
          opacity-0
          transition-opacity
          duration-150
          group-hover:opacity-100
          group-focus-within:opacity-100
        "
      >
        {text}
      </div>
    </div>
  );
}
```

### Usage

```tsx
<Tooltip text="Read aloud">
  <button type="button" aria-describedby="read-aloud-tooltip">
    <Volume2 />
  </button>
</Tooltip>
```

Following this pattern ensures that newly added buttons receive consistent responsive positioning, accessibility support, and mobile-friendly behaviour.

---

## Checklist

- [x] Documented viewport boundary calculations.
- [x] Explained automatic tooltip position flipping.
- [x] Covered accessibility attributes for screen readers.
- [x] Added responsive implementation examples.
- [x] Included mobile-specific positioning guidance.

---

## Testing

- Documentation only.
- No application code changes.
- No automated tests required.
