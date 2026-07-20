# Animation Standards

This document defines the standard animation timing, easing curves, and performance guidelines used throughout the application. Following these standards ensures consistent user experience and smooth UI interactions.

---

## Preferred Animation Durations

Use the following duration values consistently across the application.

| Duration | Recommended Usage                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| `150ms`  | Hover states, button presses, icon feedback, and subtle UI changes.                                         |
| `300ms`  | Default duration for modals, dropdowns, sidebars, tooltips, and most UI transitions.                        |
| `500ms`  | Larger page transitions, expandable panels, and complex animations that require additional visual emphasis. |

---

## Preferred Easing Functions

Choose easing functions based on the interaction type.

| Easing Function | Usage                                                              |
| --------------- | ------------------------------------------------------------------ |
| `ease`          | General-purpose UI transitions.                                    |
| `ease-in`       | Elements entering with gradual acceleration.                       |
| `ease-out`      | Elements exiting or interactive feedback.                          |
| `ease-in-out`   | Smooth animations that require both acceleration and deceleration. |
| `linear`        | Continuous animations such as loading indicators or progress bars. |

---

## Using `will-change`

The `will-change` property allows browsers to optimize rendering before an animation begins.

### Recommended

Use `will-change` only for elements that are expected to animate soon.

```css
.card {
  will-change: transform;
}
```

### Avoid

Do not apply `will-change` to many elements or leave it enabled permanently, as it may increase memory usage and reduce overall performance.

---

## Best Practices

- Keep animations short and purposeful.
- Prefer `transform` and `opacity` for smoother animations.
- Avoid animating layout-related properties such as `width`, `height`, `top`, and `left` whenever possible.
- Maintain consistent timing across similar UI components.
- Test animations on both desktop and mobile devices to ensure smooth performance.

---

## Summary

Use the standardized duration values (`150ms`, `300ms`, and `500ms`), select easing functions based on the interaction type, and use `will-change` only when necessary to improve rendering performance while maintaining consistency throughout the application.
