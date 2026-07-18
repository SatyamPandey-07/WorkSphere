\# Internationalization (i18n) Readiness Checklist



This document tracks what is already in place and what remains to make WorkSphere fully ready to support multiple languages, including right-to-left (RTL) locales.



\## 1. Current State



WorkSphere already has foundational i18n tooling installed:

\- `i18next`, `react-i18next`, `i18next-browser-languagedetector`

\- An `I18nProvider` component (`src/components/I18nProvider.tsx`) that wraps the app



This checklist identifies the remaining work to make full use of that foundation across the codebase.



\## 2. Hardcoded Strings Audit



\*\*Goal:\*\* No user-facing text should be hardcoded directly in JSX — all strings should be routed through the translation function (`t()`).



\### Checklist

\- \[ ] Audit all files under `src/components/` and `src/app/` for hardcoded English strings in JSX (e.g. `<h3>Directions</h3>`, button labels, placeholder text, alt text, aria-labels, toast/error messages).

\- \[ ] Extract found strings into locale JSON files, e.g.:

&#x20; ```

&#x20; /public/locales/en/common.json

&#x20; /public/locales/es/common.json

&#x20; /public/locales/ar/common.json

&#x20; ```

\- \[ ] Replace hardcoded strings with `t("key.name")` calls using the `useTranslation` hook from `react-i18next`.

\- \[ ] Include strings embedded in:

&#x20; - Button/link labels (e.g. "Directions", "Rate", "Reserve desk")

&#x20; - Empty states and error messages (e.g. "Address not available", "Failed to send message")

&#x20; - Form placeholders and validation messages

&#x20; - Toast/notification text

&#x20; - Email/notification templates (server-side strings too, not just client UI)

\- \[ ] Add an ESLint rule or lint script (e.g. `eslint-plugin-i18next`) to catch newly introduced hardcoded strings in PRs going forward.



\### Known hotspots to check first

\- `VenueCard.tsx` and related venue components (many inline labels: "WiFi", "Outlets", "Noise Level", etc.)

\- Dashboard and admin pages (`src/app/dashboard`, `src/app/admin/\*`)

\- Chatbot component (`EnhancedChatbot.tsx`) — dynamic AI-facing strings need special handling since some content is generated, not static UI copy.



\## 3. Date, Number, and Currency Formatting



\*\*Goal:\*\* All dates, numbers, and currency values must render according to the active locale, not a hardcoded format.



\### Checklist

\- \[ ] Replace any manual date formatting (e.g. `toLocaleDateString()` without a locale argument, or manual string concatenation) with locale-aware formatting via `Intl.DateTimeFormat` or an i18n-aware date library (e.g. `date-fns` with locale imports, or `dayjs` with locale plugins).

\- \[ ] Ensure relative time strings (e.g. "3h ago", "1d ago" style timestamps) use `Intl.RelativeTimeFormat` or an equivalent i18n-aware helper rather than hardcoded English suffixes.

\- \[ ] Numbers (ratings, distances, percentages such as WiFi confidence scores) should use `Intl.NumberFormat` so thousands separators and decimal marks adapt per locale (e.g. `1,234.5` vs `1.234,5`).

\- \[ ] If any pricing/currency values are introduced, use `Intl.NumberFormat` with `style: "currency"` rather than hardcoded `$` symbols.

\- \[ ] Distance units (e.g. `venue.distance`) should account for locale-driven unit preference (miles vs. kilometers) where feasible.



\## 4. RTL Layout Support



\*\*Goal:\*\* The app should render correctly for RTL languages (e.g. Arabic, Hebrew, Urdu) without broken layouts.



\### Checklist

\- \[ ] Set `dir="rtl"` / `dir="ltr"` dynamically on the root `<html>` element based on the active locale, rather than assuming LTR globally.

\- \[ ] Audit Tailwind classes for directional assumptions:

&#x20; - Replace physical direction utilities (`ml-\*`, `mr-\*`, `pl-\*`, `pr-\*`, `left-\*`, `right-\*`) with logical direction utilities (`ms-\*`, `me-\*`, `ps-\*`, `pe-\*`, `start-\*`, `end-\*`) where Tailwind v4 supports them, so spacing/positioning flips automatically in RTL.

&#x20; - Watch for icons and directional indicators (arrows, chevrons) that need to be mirrored in RTL mode.

\- \[ ] Test flex/grid layouts that assume a fixed left-to-right visual order (e.g. image-then-text card layouts, action button rows) under `dir="rtl"` to confirm they read naturally.

\- \[ ] Verify third-party components (maps, charts, modals) render acceptably in RTL — some libraries (e.g. Leaflet map controls, Recharts) may need manual RTL overrides or are LTR-only by design and should be flagged as known limitations.

\- \[ ] Add at least one RTL locale (e.g. Arabic) to local dev/test locales so RTL issues surface during development rather than only in production.



\## 5. Library \& Tooling Recommendations



| Concern | Recommended approach |

|---|---|

| Translation management | Continue with `react-i18next` (already installed) using namespaced JSON files per locale |

| Language detection | `i18next-browser-languagedetector` (already installed) — configure detection order (querystring → cookie → navigator) |

| Date/time formatting | `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat` (native, zero-dependency) or `date-fns` with per-locale imports if more complex formatting is needed |

| Number/currency formatting | `Intl.NumberFormat` (native, zero-dependency) |

| RTL utility support | Tailwind CSS v4 logical properties (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`) instead of a separate RTL plugin |

| Translation string linting | `eslint-plugin-i18next` or a custom lint script to flag new hardcoded strings in CI |

| Pluralization | `i18next` built-in plural handling (`t("key", { count })`) instead of manual `count === 1 ? "item" : "items"` logic |



\## 6. Suggested Rollout Order



1\. Finish the hardcoded strings audit and wire up `t()` calls for the highest-traffic components first (venue cards, navigation, core actions).

2\. Add date/number formatting via `Intl` APIs alongside the string work, since these are usually in the same components.

3\. Introduce one additional LTR locale end-to-end (e.g. Spanish) to validate the translation pipeline works correctly.

4\. Introduce one RTL locale (e.g. Arabic) to surface and fix layout issues using the logical-property Tailwind classes.

5\. Add CI lint checks to prevent regression (new hardcoded strings slipping back in).

