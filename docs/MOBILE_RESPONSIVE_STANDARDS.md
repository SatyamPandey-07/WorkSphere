# Mobile Responsive Standards

## Overview

This document outlines responsive design practices for maintaining the 70/30 map/chat layout across compact mobile viewports while ensuring usability, accessibility, and consistency.

## 70/30 Layout

- Desktop: Map (70%) and Chat (30%) displayed side by side.
- Tablet: Reduce spacing while preserving layout proportions.
- Mobile: Display one panel at a time using a toggle.

## Responsive Breakpoints
| Device | Width |
|---------|-------|
| Desktop | >1024px |
| Tablet | 769px–1024px |
| Mobile | <=768px |

Example:

```css
@media (max-width: 768px) {
  .container {
    flex-direction: column;
  }
}
```

## Panel Toggles

- Display a toggle to switch between Map and Chat.
- Preserve the current state while switching.
- Use smooth transitions.
- Ensure controls remain accessible.

## Tap Target Guidelines

- Minimum touch target size: **44 × 44 px**.
- Maintain sufficient spacing between controls.
- Avoid placing interactive elements too close together.

## Mobile Styling

- Use responsive typography.
- Avoid horizontal scrolling.
- Maintain consistent padding and margins.
- Optimize images and icons.

## Booking Date & Time Guidelines

- Display booking dates and times using the user's local timezone.
- Ensure live timezone clocks update consistently across all devices.
- Align date and time information consistently within booking cards for better readability.
- Prevent text wrapping or overlapping of date/time fields on smaller screens.
- Use responsive formatting to keep booking information clear and accessible on mobile viewports.

## Accessibility

- Ensure sufficient color contrast.
- Support screen readers.
- Keep navigation intuitive.
- Verify keyboard accessibility where applicable.

## Best Practices

- Test layouts on different screen sizes.
- Use CSS media queries for responsiveness.
- Optimize performance for mobile devices.
- Maintain a consistent user experience.

## Summary

Following these standards helps maintain a responsive, accessible, and user-friendly interface while preserving the intended 70/30 map/chat experience across devices.