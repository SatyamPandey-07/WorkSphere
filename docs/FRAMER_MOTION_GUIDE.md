# Framer Motion Guide

## Overview

This guide documents the standard Framer Motion patterns used throughout the application. It explains the existing implementation for page transitions and establishes recommended animation patterns for reusable components, modals, and list animations.

Following these standards helps maintain consistent animations, improve user experience, and simplify future development.

---

# Current Page Transition Implementation

The application implements page transitions in `app/template.tsx`.

Current implementation:

- Uses `AnimatePresence` to animate route changes.
- Uses `mode="wait"` so exit animations finish before the next page enters.
- Keys the animated container using the current pathname.
- Wraps page content with `FrozenRouter` to preserve the router context during exit animations.
- Uses a fade and vertical slide animation.

Example:

```tsx
<AnimatePresence mode="wait">
  <motion.div
    key={pathname}
    initial={{
      opacity: 0,
      y: 12,
    }}
    animate={{
      opacity: 1,
      y: 0,
    }}
    exit={{
      opacity: 0,
      y: -12,
    }}
    transition={{
      duration: 0.22,
      ease: "easeInOut",
    }}
  >
    <FrozenRouter>{children}</FrozenRouter>
  </motion.div>
</AnimatePresence>
```

---

# FrozenRouter

Page transitions use a custom `FrozenRouter` wrapper.

Purpose:

- Preserves the current router context during exit animations.
- Prevents premature unmounting while a transition is still running.
- Produces smoother navigation with the Next.js App Router.

This wrapper should remain around animated page content unless the routing strategy changes.

---

# AnimatePresence for Next.js Route Changes

Use `AnimatePresence` whenever components require exit animations.

Recommended pattern:

```tsx
<AnimatePresence mode="wait">{children}</AnimatePresence>
```

Using `mode="wait"` ensures:

1. The current page finishes its exit animation.
2. The next page begins its entrance animation.
3. Animations do not overlap.

---

# Reusable Animation Variants

Store commonly used animation variants in a shared location to promote consistency and reduce duplication.

---

## Fade Variant

```tsx
export const fadeVariant = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
  },
};
```

Suitable for:

- Text
- Sections
- Small UI components

---

## Slide Up Variant

```tsx
export const slideUpVariant = {
  hidden: {
    opacity: 0,
    y: 20,
  },
  visible: {
    opacity: 1,
    y: 0,
  },
};
```

Recommended for:

- Cards
- Forms
- Dashboard widgets
- Content sections

---

## Scale Variant

```tsx
export const scaleVariant = {
  hidden: {
    opacity: 0,
    scale: 0.95,
  },
  visible: {
    opacity: 1,
    scale: 1,
  },
};
```

Recommended for:

- Dialogs
- Popovers
- Notifications
- Menus

---

# Modal Animations

Animate the backdrop and dialog independently.

Example:

```tsx
<AnimatePresence>
  {open && (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />

      <motion.div
        initial={{
          opacity: 0,
          scale: 0.95,
        }}
        animate={{
          opacity: 1,
          scale: 1,
        }}
        exit={{
          opacity: 0,
          scale: 0.95,
        }}
      >
        Modal Content
      </motion.div>
    </>
  )}
</AnimatePresence>
```

Recommendations:

- Animate the backdrop separately.
- Keep modal animations under 300 ms.
- Avoid excessive movement.
- Ensure the animation does not delay interaction.

---

# List Item Entrance Animations

Animate collections using staggered children.

Container:

```tsx
const container = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
    },
  },
};
```

Item:

```tsx
const item = {
  hidden: {
    opacity: 0,
    y: 12,
  },
  visible: {
    opacity: 1,
    y: 0,
  },
};
```

Usage:

```tsx
<motion.ul variants={container} initial="hidden" animate="visible">
  {items.map((itemData) => (
    <motion.li key={itemData.id} variants={item}>
      {itemData.name}
    </motion.li>
  ))}
</motion.ul>
```

Recommended for:

- Search results
- Venue listings
- Dashboard cards
- Notifications
- Activity feeds

---

# Hover Animations

Keep hover animations subtle.

Example:

```tsx
<motion.button
  whileHover={{
    scale: 1.03,
  }}
  whileTap={{
    scale: 0.97,
  }}
>
  Button
</motion.button>
```

Avoid aggressive scaling or long hover transitions.

---

# Layout Animations

Use the `layout` prop when components change position or size dynamically.

Example:

```tsx
<motion.div layout>{children}</motion.div>
```

Useful for:

- Reordering lists
- Expanding sections
- Dynamic dashboards
- Responsive layouts

---

# Transition Guidelines

Recommended durations:

| Animation       | Duration   |
| --------------- | ---------- |
| Hover           | 100–200 ms |
| Button Press    | 100–150 ms |
| Modal           | 200–300 ms |
| Page Transition | ~220 ms    |
| List Item       | 150–250 ms |

Use `easeInOut` for page transitions to maintain a smooth and consistent navigation experience.

---

# Accessibility

When implementing animations:

- Respect reduced motion preferences.
- Avoid rapid flashing effects.
- Keep keyboard navigation functional.
- Do not rely solely on animation to communicate important information.
- Ensure animations do not block user interaction.

---

# Best Practices

- Use `AnimatePresence` for components entering and leaving the DOM.
- Reuse shared animation variants whenever possible.
- Keep transition durations consistent throughout the application.
- Prefer subtle animations over distracting effects.
- Avoid unnecessary layout animations.
- Test animations on different screen sizes and devices.
- Keep animations lightweight to maintain good performance.

---

# Summary

The application uses Framer Motion for smooth page-level transitions with `AnimatePresence`, pathname-based animation keys, and a `FrozenRouter` wrapper to preserve routing context during navigation. Reusable animation variants, consistent modal animations, and staggered list entrance effects provide a scalable and maintainable animation system while ensuring a polished user experience.
