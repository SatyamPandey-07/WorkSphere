# Onboarding Tour Styling Configuration Guide

This guide details the design decisions and theme parameters chosen for the WorkSphere interactive walkthrough tour.

---

## Design Systems Mapping

We override default `react-joyride` tooltip styles to match the WorkSphere aesthetic (vibrant blue actions, rounded card layouts, and premium typography):

- **Font Family**: Standard `system-ui, sans-serif` for clean readability.
- **Overlay Color**: `rgba(0, 0, 0, 0.4)` to emphasize target sections with a balanced backdrop blur where supported.
- **Primary Action Buttons**: Background color `#2563eb` with a uppercase tracking pattern (`font-weight: 700`, `font-size: 11px`, `letter-spacing: 0.05em`) mimicking workspace console actions.
- **Border Radius**: Set to `1.5rem` on tooltips to mimic the platform's glassmorphic and card container style.

---

## Target Anchors

The tour guides users through the core workspace flow:
1. `.joyride-map`: Interactive Map Section
2. `.joyride-chat`: AI Chat Companion
3. `.joyride-booking`: Chat confirmation/Reserve seat widgets
