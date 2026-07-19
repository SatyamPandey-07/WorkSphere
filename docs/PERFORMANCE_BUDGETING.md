# Performance Budgeting & Optimization Guide
This document outlines our Core Web Vitals targets and standard practices for bundle optimization to ensure a fast, responsive user experience.
## 1. Core Web Vitals Targets
We aim for "Good" scores across all Core Web Vitals metrics as defined by Google:
* **LCP (Largest Contentful Paint):** Under **2.5 seconds**. (Measures loading performance).
* **INP (Interaction to Next Paint):** Under **200 milliseconds**. (Replaces FID, measures responsiveness).
* **CLS (Cumulative Layout Shift):** **0.1 or less**. (Measures visual stability).
## 2. Bundle Optimization Guidelines
### Dynamic Imports (Code Splitting)
Reduce the initial bundle size by lazy-loading components and libraries that are not required for the initial render.
* Use Next.js `next/dynamic` or React's `lazy()` with `Suspense` for heavy UI components (e.g., modals, charts, complex forms, and off-screen elements).
### Font Loading
Prevent layout shifts and invisible text flashes during font loading.
* Use `next/font` for automatic self-hosting and optimal loading.
* If using a custom `@font-face` setup, always include `font-display: swap` to ensure text remains visible while the web font downloads.
### Script Deferral
Keep the main thread clear by deferring non-critical third-party scripts.
* Use the Next.js `<Script>` component with `strategy="lazyOnload"` or `strategy="worker"` for analytics, chatbots, and non-essential widgets.
* Only use `strategy="beforeInteractive"` for critical polyfills or strict bot detection scripts.
### Bundle Analyzer Usage
Regularly audit the application bundle to identify bloat.
* Run `@next/bundle-analyzer` locally before submitting large feature PRs.
* **Command:** `ANALYZE=true npm run build` (or the equivalent script in `package.json`).
* Review the generated HTML dependency maps to identify unexpectedly large packages and swap them for lighter alternatives where possible.