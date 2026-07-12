\# Localization Guidelines for International Translation Contributions



This document outlines the recommended approach for adding internationalization (i18n) support to WorkSphere, and provides guidelines for contributors who want to help translate the app into other languages.



\## Current State



WorkSphere does not currently have a dedicated internationalization (i18n) system implemented. All user-facing text is currently hardcoded in English directly within components. The `dayjs` library used for date formatting includes its own locale files (`node\_modules/dayjs/locale/`), but these are not yet connected to any application-level language switching.



This guide serves as a starting point for contributors who want to propose or implement a localization system, and for translators who want to prepare content ahead of that implementation.



\## Recommended i18n Library



For a Next.js (App Router) project like WorkSphere, \*\*\[next-intl](https://next-intl-docs.vercel.app/)\*\* is the recommended library because it:

\- Has first-class support for the Next.js App Router

\- Supports both static and dynamic routing with locale prefixes (e.g. `/en/venues`, `/ur/venues`)

\- Handles pluralization, date/number formatting, and RTL languages

\- Integrates cleanly with Server Components



Alternative: `react-i18next` is also widely used, but has more friction with Server Components in the App Router.



\## Proposed File Structure



Once implemented, translation files should follow this structure:
Each file contains nested JSON keys grouped by feature/page:



```json

{

&#x20; "common": {

&#x20;   "search": "Search",

&#x20;   "loading": "Loading..."

&#x20; },

&#x20; "venueCard": {

&#x20;   "bookNow": "Book Now",

&#x20;   "viewDetails": "View Details"

&#x20; },

&#x20; "navigation": {

&#x20;   "home": "Home",

&#x20;   "map": "Map",

&#x20;   "profile": "Profile"

&#x20; }

}

```



\## Translation Key Naming Convention



\- Use `camelCase` for keys.

\- Group keys by the component or page they belong to (e.g. `venueCard.bookNow`, not a flat `bookNow`).

\- Keep keys descriptive but short — the key name should hint at the string's purpose, not repeat the whole sentence.

\- Avoid concatenating translated strings in code (e.g. `t("hello") + " " + name`) since word order varies by language. Prefer parameterized strings:

```json

&#x20; { "welcomeMessage": "Welcome, {name}!" }

```



\## Adding a New Language (Once i18n Is Implemented)



1\. Copy `messages/en.json` to a new file named with the \[ISO 639-1](https://en.wikipedia.org/wiki/List\_of\_ISO\_639\_language\_codes) language code (e.g. `ur.json` for Urdu, `es.json` for Spanish).

2\. Translate every value in the file — do \*\*not\*\* change the keys.

3\. Do not leave partially translated files; if a full translation isn't ready, open a draft PR and note which sections are incomplete.

4\. Test the translation in context (not just reading the JSON) to catch text that overflows UI containers or breaks layout.

5\. Submit a PR with the new locale file, following the standard \[Contributing Guidelines](../CONTRIBUTING.md).



\## Right-to-Left (RTL) Language Support



Languages such as \*\*Urdu, Arabic, and Hebrew\*\* are written right-to-left, which requires additional handling beyond just translating text:



\- Set the `dir="rtl"` attribute on the `<html>` tag when an RTL locale is active.

\- Use Tailwind's logical properties instead of directional ones where possible (e.g. `ms-4` / `me-4` for margin-start/end instead of `ml-4` / `mr-4`), so spacing automatically flips for RTL layouts.

\- Icons that imply direction (e.g. arrows, "back" buttons) should be mirrored in RTL mode.

\- Test RTL layouts specifically — text alignment, flexbox ordering, and icon placement often break silently when a layout wasn't built with RTL in mind from the start.



Given WorkSphere's contributor base includes Urdu speakers, Urdu should be treated as a first-priority language once i18n is implemented, not an afterthought — this ensures RTL support is built correctly from day one rather than retrofitted later.



\## Translation Quality Guidelines



\- Prefer natural, conversational translations over literal word-for-word translation.

\- Keep tone consistent with the English original (WorkSphere's copy is casual/friendly, not formal).

\- Avoid machine-translating without review — automated translations often miss context (e.g. "Book Now" as a verb vs. a noun).

\- For technical terms (e.g. "PWA", "API") that don't have a natural translation, it's acceptable to keep them in English within translated text.



\## Testing a New Locale



Once i18n is implemented, contributors should verify:

\- All strings render correctly with no missing translation keys (fallback to English should not silently occur without notice).

\- Layout doesn't break with longer translated strings (German and Urdu text, for example, are often longer than English).

\- Date, time, and number formatting respect the selected locale.

\- RTL languages render with correct text direction and mirrored UI elements.



\## Summary



WorkSphere does not yet have i18n implemented, but this guide establishes the recommended approach (`next-intl`), file structure, and contribution process for when it is. Urdu and other RTL languages should be prioritized from the start of implementation to ensure the architecture supports right-to-left layouts natively rather than as a later fix.

