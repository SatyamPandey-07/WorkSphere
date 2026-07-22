# Client-Side Framer Motion Animation Guidelines

This document establishes the official client-side animation standards and implementation guidelines for WorkSphere using Framer Motion. Adhering to these practices ensures a consistent, high-performance, and accessible user experience across all devices.

---

## 1. Introduction

WorkSphere uses **Framer Motion** as its primary client-side animation library to create fluid, interactive, and modern user interfaces. Animations are powerful tools for providing feedback, indicating state changes, and guiding user attention.

### Performance-First Animation Philosophy
Our core philosophy is that **animations must enhance usability without degrading performance**. 
- **Purposeful**: Every animation must serve a clear user experience goal (e.g., indicating success, revealing hidden menus, smoothing page changes).
- **Lightweight**: Animations must maintain a target of 60fps (or 120fps on supporting hardware) without causing CPU/GPU spikes.
- **Additive**: The interface must remain fully functional and performant even if animations are disabled or delayed.

---

## 2. Installation & Setup

Framer Motion is already integrated into the WorkSphere dependency stack. 

### Existing Dependency
Framer Motion is declared in the root `package.json` and is available throughout the workspace. No additional installation is required.

### Import Examples
To maintain consistency and optimize bundle size, import Framer Motion APIs as shown below:

```tsx
// Core components and hooks
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

// Lazy loading features
import { LazyMotion, domAnimation, m } from 'framer-motion';
```

---

## 3. Core Animation Principles

To design high-quality animations, adhere to these fundamental principles:

### Keep Animations Subtle
Avoid large movements and over-exaggerated transitions. Keep translate distances small (e.g., `y: 8` or `y: 12`) and scales close to `1` (e.g., `scale: 0.98` to `scale: 1.02`).

### Avoid Layout Thrashing
Animations that alter layout properties force the browser to recalculate the document layout (reflow) and repaint the page, leading to stuttering (jank).
- **Never animate**: `width`, `height`, `margin`, `padding`, `top`, `left`, `right`, `bottom`, `flex-basis`, or font sizes.

### Prefer Transform and Opacity
Only animate properties that can be offloaded to the GPU compositor thread:
- Use `opacity` for transparency transitions.
- Use `x`, `y`, `z`, `scale`, and `rotate` (which translate to CSS `transform`) for position and scale changes.

### Accessibility Considerations
Not all users prefer or can tolerate motion. Animations can cause motion sickness, distraction, or confusion.
- Always check and respect system-level motion preferences using media queries or native hooks.
- See the [Accessibility](#9-accessibility) section below for detailed instructions.

---

## 4. Standard Animation Patterns

Use these pre-approved patterns for common UI components to maintain consistency.

### Fade In
Ideal for revealing new content, static cards, or text components.
```tsx
export const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2, ease: "easeOut" } },
};
```

### Slide Up
Recommended for list entries, page content loading, and forms.
```tsx
export const slideUp = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
};
```

### Scale
Best suited for tooltips, modals, popovers, and menu cards.
```tsx
export const scaleIn = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.2, ease: "easeOut" } },
};
```

### Hover Animations
Hover animations should be snappy and subtle. Provide instant physical feedback.
```tsx
<motion.button
  whileHover={{ scale: 1.02, y: -1 }}
  transition={{ duration: 0.15, ease: "easeOut" }}
>
  Hover Me
</motion.button>
```

### Tap Animations
Provide clear feedback on user interaction (press state).
```tsx
<motion.button
  whileTap={{ scale: 0.97 }}
  transition={{ duration: 0.1, ease: "easeInOut" }}
>
  Click Me
</motion.button>
```

### Page Transitions
Implement page transitions at the router template level using `AnimatePresence` with `mode="wait"` and the `FrozenRouter` pattern to avoid blank pages and premature unmounting.
```tsx
// Rendered in next.js template.tsx
<AnimatePresence mode="wait">
  <motion.div
    key={pathname}
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -12 }}
    transition={{ duration: 0.22, ease: "easeInOut" }}
  >
    <FrozenRouter>{children}</FrozenRouter>
  </motion.div>
</AnimatePresence>
```

### Modal Animations
Separate backdrop transitions from modal card scale transitions to ensure they do not clip or conflict.
```tsx
// Backdrop
<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  exit={{ opacity: 0 }}
  className="modal-backdrop"
/>

// Content Modal
<motion.div
  initial={{ opacity: 0, scale: 0.95, y: 10 }}
  animate={{ opacity: 1, scale: 1, y: 0 }}
  exit={{ opacity: 0, scale: 0.95, y: 10 }}
  transition={{ duration: 0.25, ease: "easeOut" }}
  className="modal-content"
/>
```

### Drawer/Sidebar Animations
Translate drawers along their active axis (e.g., `x` for horizontal slide-in, `y` for bottom drawer).
```tsx
export const sidebarVariants = {
  hidden: { x: "-100%" },
  visible: { x: 0, transition: { duration: 0.3, ease: "easeOut" } },
  exit: { x: "-100%", transition: { duration: 0.25, ease: "easeIn" } },
};
```

---

## 5. AnimatePresence Usage

`AnimatePresence` allows components to animate out when they are removed from the React component tree.

### Entry and Exit Animations
Direct children of `AnimatePresence` must be `motion` components and must specify `initial`, `animate`, and `exit` props.
```tsx
<AnimatePresence>
  {isVisible && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      Dynamic Alert
    </motion.div>
  )}
</AnimatePresence>
```

### Conditional Rendering
Ensure that `AnimatePresence` is always rendered on the page, and only wrap the components that are being dynamically mounted or unmounted inside it.

### Key Usage
Framer Motion uses React keys to track which component is leaving and which is entering.
- **Always provide a unique `key`** to direct children of `AnimatePresence`. 
- Without a key, exit animations will not trigger, and components will immediately disappear.

---

## 6. Performance Best Practices

To keep WorkSphere responsive and lag-free, apply these performance optimization practices.

### LazyMotion
Instead of importing the full `motion` component, use `<LazyMotion>` at the root or page level. This allows bundling only a subset of Framer Motion (e.g., `domAnimation`), saving ~10-15KB of initial JavaScript.
```tsx
import { LazyMotion, domAnimation, m } from "framer-motion";

function App({ children }) {
  return (
    <LazyMotion features={domAnimation}>
      {/* Use m.div instead of motion.div */}
      <m.div animate={{ opacity: 1 }}>{children}</m.div>
    </LazyMotion>
  );
}
```

### Avoid Animating Expensive CSS Properties
Animating CSS properties that trigger paint or layout changes blocks the main thread.
- Avoid animating: `box-shadow`, `filter`, `background-color` (use opacity overlays or hardware-accelerated transforms instead).
- Never animate: `height`, `width`, `top`, `left`, `right`, `bottom`, `margin`, `padding`.

### Memoization
If variants or transitions depend on component props or state, memoize them using `useMemo` to prevent recreation on every render cycle.
```tsx
const variants = useMemo(() => ({
  hidden: { opacity: 0, x: customOffset },
  visible: { opacity: 1, x: 0 },
}), [customOffset]);
```

### Keep Animation Durations Consistent
Do not use arbitrary durations. Keep them consistent throughout the app to reduce complexity and rendering overhead.

### Mobile Performance Recommendations
- Reduce or completely disable complex animations on viewports below `768px` (mobile).
- Avoid `layout` animations on large grids or lists containing more than 30 items on mobile.
- Use `layout="position"` instead of `layout` if you only want to animate translation without resizing elements.

---

## 7. Layout Animations

Framer Motion can automatically animate changes in size and position caused by layout changes.

### The `layout` Prop
Adding the `layout` prop to a component tells Framer Motion to watch its box dimensions and animate shifts automatically.
```tsx
<motion.div layout className="card">
  {expanded ? <ExpandedContent /> : <CollapsedContent />}
</motion.div>
```

### The `layoutId` Prop
Use `layoutId` to animate a shared element moving from one component instance to another. Perfect for tabs or active selectors.
```tsx
{tabs.map((tab) => (
  <button key={tab.id} onClick={() => setActiveTab(tab.id)}>
    {tab.label}
    {activeTab === tab.id && (
      <motion.div
        layoutId="active-indicator"
        className="absolute bottom-0 left-0 right-0 h-1 bg-primary"
      />
    )}
  </button>
))}
```

### Shared Element Transitions
When transitioning between pages or modal views, use the same `layoutId` for matching items (like an image on a card expanding into a full-page modal) to morph them seamlessly.

### Reordering Lists
Use Framer Motion's `<Reorder.Group>` and `<Reorder.Item>` for list reordering. Make sure to apply `layout` to all sibling items so they shift smoothly.

---

## 8. Transition Standards

To ensure a unified user experience, use standard values for duration and easing.

### Standard Durations

| Standard Speed | Duration | Recommended Usage |
| :--- | :--- | :--- |
| **Fast** | `0.15s` (150ms) | Hover transitions, tooltips, button taps, switches, and small icons. |
| **Normal** | `0.25s` (250ms) | Dialogs, modals, card reveal animations, collapsibles, and page loads. |
| **Slow** | `0.40s` (400ms) | Sidebars, drawers, complex layout transitions, and shared element morphing. |

### Standard Easing Functions

- **Ease Out** (`"easeOut"` or `cubic-bezier(0.16, 1, 0.3, 1)`): Use for entrance animations. Snappy start, gentle deceleration.
- **Ease In** (`"easeIn"` or `cubic-bezier(0.7, 0, 0.84, 0)`): Use for exit/dismissal animations. Slow start, accelerates out.
- **Ease In Out** (`"easeInOut"` or `cubic-bezier(0.87, 0, 0.13, 1)`): Use for layout-driven animations where items change size or position.

---

## 9. Accessibility

Accessibility is not optional in WorkSphere. Animations must respect system settings and physical limitations.

### Respect `prefers-reduced-motion`
Users who have enabled "Reduce Motion" in their operating systems should not be subjected to heavy, scrolling, scaling, or slide animations.
- Use the `useReducedMotion` hook to conditionally replace motion paths with simple fades or completely disable animations.

```tsx
import { motion, useReducedMotion } from "framer-motion";

function AccessibleComponent() {
  const shouldReduceMotion = useReducedMotion();

  const variants = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 20 },
    visible: { opacity: 1, y: 0 }
  };

  return <motion.div variants={variants} initial="hidden" animate="visible" />;
}
```

### Avoid Flashing Effects
- Do not design animations that oscillate, pulse, or flash rapidly (more than 3 times per second), as this can trigger photosensitive seizures.
- Keep looping animations extremely slow and subtle (e.g., pulse duration > 2s).

### Keyboard Accessibility
- Animations must not trap or hide keyboard focus.
- Ensure focus outline styles remain visible during and after transitions.
- Interactive elements inside exit transitions (like unmounting forms) must immediately have their focus shifted or disabled so keyboard-only users do not end up in a focus vacuum.

---

## 10. Common Mistakes

Avoid these pitfalls when implementing Framer Motion in WorkSphere:

1. **Animating width/height instead of scale**:
   Animating `width` and `height` causes layout calculations for the entire DOM tree on every frame. Use `scaleX` and `scaleY` (or `scale`) instead.
2. **Nesting too many motion components**:
   Avoid placing `motion` inside `motion` unless necessary. Propagate variants down using Framer Motion's parent-child orchestration instead.
3. **Missing `AnimatePresence`**:
   Trying to trigger exit animations on a component that conditionally mounts (e.g. `{open && <motion.div exit={...} />}`) without wrapping it in `<AnimatePresence>`.
4. **Missing unique keys**:
   Failing to add a `key` prop to immediate children of `AnimatePresence` or using indices as keys. Always use static, unique IDs.

---

## 11. Example Components

Below are production-ready code snippets demonstrating standard animation implementations in WorkSphere.

### Animated Button
```tsx
import { motion } from "framer-motion";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export const AnimatedButton: React.FC<ButtonProps> = ({ children, ...props }) => {
  return (
    <motion.button
      whileHover={{ scale: 1.02, y: -1 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="px-4 py-2 bg-primary text-white rounded-md shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500"
      {...props}
    >
      {children}
    </motion.button>
  );
};
```

### Fade-in Card
```tsx
import { motion } from "framer-motion";

export const FadeInCard = ({ title, content }: { title: string; content: string }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="p-6 bg-card border rounded-lg shadow-sm"
    >
      <h3 className="text-lg font-bold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{content}</p>
    </motion.div>
  );
};
```

### Modal
```tsx
import { motion, AnimatePresence } from "framer-motion";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="relative w-full max-w-lg p-6 bg-background border rounded-lg shadow-xl z-10"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <h2 id="modal-title" className="text-xl font-semibold mb-4">{title}</h2>
            <div className="mb-6">{children}</div>
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
              aria-label="Close modal"
            >
              &times;
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
```

### Sidebar
```tsx
import { motion, AnimatePresence } from "framer-motion";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, children }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40"
          />

          {/* Sidebar Drawer */}
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-80 max-w-[85vw] h-full bg-background border-r p-6 shadow-xl z-10"
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold">Navigation</h2>
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close sidebar"
              >
                &times;
              </button>
            </div>
            <nav className="space-y-4">{children}</nav>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
```

---

## 12. Troubleshooting

### Exit Animations Are Not Triggering
- **Check Parents**: Is the animated component wrapped inside `<AnimatePresence>`?
- **Verify Direct Child**: The component immediately nested inside `AnimatePresence` must be a `motion` component or standard component wrapping one. It cannot be nested inside another conditional wrapper.
- **Missing Keys**: Confirm that the direct children have static, unique `key` props.
- **Mode wait**: Check if `mode="wait"` is used. In some router contexts, next.js pages require a preservation context wrapper (like `FrozenRouter`) to complete animations before unmounting.

### Layout Distortions / Squeezing
- **Scale Correction**: Scaling an element also scales its borders, box shadows, and nested text. To prevent this, apply the `layout` prop to parent containers, and avoid setting layout animations on nested text tags, or use `layout="position"` to prevent size transitions.
- **Flexbox conflicts**: Ensure the parent has defined dimensions or appropriate layout properties (`flex-shrink: 0`, etc.) to prevent layout shifts.

### Animation lag / dropped frames
- **Inspect performance panel**: Open Chrome DevTools Performance tab and verify if Layout or Paint events are repeating during transitions.
- **GPU Profiling**: Ensure all animations target `x`, `y`, `scale`, and `opacity`.
- **Remove non-gpu properties**: Ensure no components are animating properties like `border-radius`, `box-shadow`, `width`, or `height`.

---

## 13. References

- [Official Framer Motion Documentation](https://www.framer.com/motion/)
- [Next.js App Router Template Transitions](https://nextjs.org/docs/app/building-your-application/routing/pages-and-layouts#templates)
- [WorkSphere Design System Guidelines](file:///c:/Users/HP/Downloads/WorkSphere-main%20%283%29/WorkSphere-main/docs/DESIGN_SYSTEM_GUIDE.md)
- [WorkSphere Animation Standards](file:///c:/Users/HP/Downloads/WorkSphere-main%20%283%29/WorkSphere-main/docs/ANIMATION_STANDARDS.md)
- [WorkSphere Framer Motion Guide](file:///c:/Users/HP/Downloads/WorkSphere-main%20%283%29/WorkSphere-main/docs/FRAMER_MOTION_GUIDE.md)
