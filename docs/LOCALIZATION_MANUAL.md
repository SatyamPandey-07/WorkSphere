# Localization Manual

This document explains how UI text is translated in WorkSphere, how the
`src/locales/` translation files are structured, and how to add a new
language.

---

## ⚡ Quickstart Checklist: Adding a New Locale

Follow this 5-step checklist to add a new language translation to WorkSphere:

1. **Copy the English Template**:
   Create a new locale file in `src/locales/<lang-code>.json` by duplicating `src/locales/en.json` (e.g., `src/locales/it.json` for Italian or `src/locales/ja.json` for Japanese).
   ```bash
   cp src/locales/en.json src/locales/<lang-code>.json
   ```

2. **Translate Keys**:
   Translate every string value while preserving all JSON keys, nesting, and interpolation tokens (e.g., `{{count}}`, `{{username}}`). Do not alter or translate the key names.

3. **Register the Locale**:
   Import your locale file in `src/components/I18nProvider.tsx` (and `src/locales/index.ts` if exporting a centralized resource bundle) and register it in the `resources` map passed to `i18n.init(...)`:
   ```tsx
   import it from "../locales/it.json";

   // Inside i18n.init resources:
   resources: {
     en: { translation: en },
     es: { translation: es },
     fr: { translation: fr },
     de: { translation: de },
     hi: { translation: hi },
     pt: { translation: pt },
     it: { translation: it }, // <-- add your new locale here
   }
   ```

4. **Validate Translations**:
   Run the translation key parity and JSON syntax validation script:
   ```bash
   node -e '
     const fs = require("fs");
     const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
     const targetLang = process.argv[1] || "it";
     const targetPath = `src/locales/${targetLang}.json`;
     if (!fs.existsSync(targetPath)) { console.error(`Missing ${targetPath}`); process.exit(1); }
     const target = JSON.parse(fs.readFileSync(targetPath, "utf8"));
     function checkKeys(base, check, path = "") {
       for (const key of Object.keys(base)) {
         const fullKey = path ? `${path}.${key}` : key;
         if (!(key in check)) console.error(`Missing key: ${fullKey}`);
         else if (typeof base[key] === "object" && base[key] !== null) checkKeys(base[key], check[key], fullKey);
       }
     }
     checkKeys(en, target);
     console.log(`Validation completed for ${targetLang}.json`);
   ' it
   ```
   Or verify your JSON formatting with:
   ```bash
   npm run lint
   ```

5. **Test Locally**:
   Start your development server (`npm run dev`) and test the UI by setting the language in your browser DevTools console:
   ```js
   localStorage.setItem("i18nextLng", "<lang-code>");
   location.reload();
   ```
   Verify that all translated strings render correctly without falling back to English or displaying raw keys.

### Pluralization Formatting Guidelines

When adding strings that vary depending on numerical quantity, use i18next's standard plural suffix convention:

- **Singular and Plural suffixes**:
  - `key` or `key_one`: used when the count is 1.
  - `key_other`: used when the count is plural (0, 2, 3, ...).
  - In i18next v21+, `key_one` and `key_other` are preferred for multi-category plurals.
- **Interpolation Variable**: Always use `{{count}}` inside the message template.
  ```json
  {
    "venue": {
      "reviewsCount_one": "{{count}} review",
      "reviewsCount_other": "{{count}} reviews"
    }
  }
  ```
- **Usage in Components**:
  ```tsx
  t("venue.reviewsCount", { count: reviews.length })
  ```
- **Language-Specific Rules**: Note that languages like Russian, Polish, or Arabic have additional plural forms (`_few`, `_many`, `_zero`). Refer to the [i18next pluralization documentation](https://www.i18next.com/translation-function/plurals) for locale-specific suffixes.

---

## 1. Overview

WorkSphere uses [`i18next`](https://www.i18next.com/) together with
[`react-i18next`](https://react.i18next.com/) and
[`i18next-browser-languagedetector`](https://github.com/i18next/i18next-browser-languageDetector)
for client-side UI string translation.

Packages in use (see `package.json`):

- `i18next`
- `react-i18next`
- `i18next-browser-languagedetector`

There are two, separate translation-related systems in this codebase and
it's important not to confuse them:

1. **Static UI translation (i18next)** – translates fixed interface strings
   (buttons, labels, empty states) using the JSON files in `src/locales/`.
   This is what the rest of this document covers.
2. **On-demand review translation (`/api/translate`)** – a Groq LLM-backed
   API route that translates *user-generated content* (venue review
   comments) at request time. It is triggered from
   `src/components/chat/VenueDetailDialog.tsx` via the "Translate" /
   "Translating..." button, which itself uses i18next only for the button's
   *label* (`venue.translate` / `venue.translating`), not for the translated
   review text. See [Section 5](#5-on-demand-content-translation-apitranslate).

## 2. Translation Flow

### 2.1 Initialization

i18next is initialized once, outside of the React component tree, in
`src/components/I18nProvider.tsx`:

```tsx
import i18n from "i18next";
import { initReactI18next, I18nextProvider } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "../locales/en.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";
import de from "../locales/de.json";
import hi from "../locales/hi.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      fr: { translation: fr },
      de: { translation: de },
      hi: { translation: hi },
    },
    fallbackLng: "en",
    interpolation: {
      escapeValue: false, // React already escapes output, so no double-escaping
    },
  });
```

Key points:

- All locale JSON files are imported **statically** and bundled into the
  app — there is no lazy-loading / async backend configured. Adding a
  locale means adding an import here (see [Section 4](#4-adding-a-new-locale)).
- `LanguageDetector` automatically picks the active language from the
  browser (e.g. `navigator.language`, cookies, `localStorage`) — there is no
  manual language switcher UI yet.
- `fallbackLng: "en"` means any missing key, or an unsupported detected
  language, falls back to English.
- `escapeValue: false` is safe here because React escapes interpolated
  values by default; i18next does not need to do it a second time.

### 2.2 Mounting the provider

`I18nProvider` wraps the app in `src/app/layout.tsx`:

```tsx
<I18nProvider>
  {children}
</I18nProvider>
```

`I18nProvider` also guards against hydration mismatches: on first render
(before the client has mounted) it renders `children` directly without the
`I18nextProvider` context, then swaps in the real provider after mount.

### 2.3 Using translations in a component

Components consume strings with the `useTranslation` hook from
`react-i18next`:

```tsx
import { useTranslation } from "react-i18next";

const { t } = useTranslation();

t("venue.reviews");       // "Reviews"
t("venue.noReviewsYet");  // "No Reviews Yet"
```

Currently `src/components/chat/VenueDetailDialog.tsx` is the only component
wired up to `useTranslation`. If you add UI text elsewhere in the app, follow
the same pattern: import `useTranslation`, destructure `t`, and reference a
namespaced key rather than hardcoding copy.

## 3. Key / Namespace Format

Translation files live in `src/locales/<lang-code>.json`, one file per
locale, and all keys are nested under a top-level **namespace object** that
groups related strings. Today there is a single namespace, `venue`:

```json
{
  "venue": {
    "reviews": "Reviews",
    "noReviewsYet": "No Reviews Yet",
    "beTheFirst": "Be the first to share your workspace rating.",
    "wifi": "WiFi",
    "power": "Power",
    "noise": "Noise",
    "yes": "Yes",
    "no": "No",
    "viewSpeedtest": "View Speedtest Screenshot",
    "translate": "Translate",
    "translating": "Translating..."
  }
}
```

Conventions to follow when adding keys:

- **Namespace by feature area**, not by page — e.g. `venue.*` for
  venue/review UI. If you add strings for a new feature (say, the
  dashboard), introduce a new top-level object, e.g. `dashboard.*`, rather
  than dumping unrelated keys into `venue`.
- **Key names are camelCase** and describe the string's purpose, not its
  content (`noReviewsYet`, not `noReviewsYetText`).
- **Every locale file must declare the same set of keys** as `en.json`.
  `en` is the fallback language (`fallbackLng: "en"`), so a missing key in
  another locale silently falls back to the English string — it won't
  break the build, but it will produce inconsistent UI language. Keep all
  five files in sync when you add, rename, or remove a key.
- Reference keys in code with dot notation matching the JSON nesting:
  `t("venue.wifi")`, `t("venue.translate")`, etc.

## 4. Adding a New Locale

To add support for a new language (e.g. Portuguese, `pt`):

1. **Create the locale file**: `src/locales/pt.json`, copying the full key
   structure from `src/locales/en.json` and translating each value.

   ```json
   {
     "venue": {
       "reviews": "Avaliações",
       "noReviewsYet": "Ainda sem avaliações",
       "beTheFirst": "Seja o primeiro a avaliar seu espaço de trabalho.",
       "wifi": "WiFi",
       "power": "Tomadas",
       "noise": "Ruído",
       "yes": "Sim",
       "no": "Não",
       "viewSpeedtest": "Ver Captura do Speedtest",
       "translate": "Traduzir",
       "translating": "Traduzindo..."
     }
   }
   ```

2. **Register it in `I18nProvider.tsx`**: import the new file and add it to
   the `resources` map passed to `i18n.init(...)`.

   ```tsx
   import pt from "../locales/pt.json";

   // ...
   resources: {
     en: { translation: en },
     es: { translation: es },
     fr: { translation: fr },
     de: { translation: de },
     hi: { translation: hi },
     pt: { translation: pt }, // new
   },
   ```

3. **No routing changes needed.** Because `LanguageDetector` reads the
   browser/OS language automatically, a user whose browser reports `pt`
   will now get the new file without any additional configuration.

4. **Verify** by changing your browser's language preference to the new
   locale (or overriding the detector, e.g. via a `?lng=pt` query param or
   `localStorage.setItem("i18nextLng", "pt")` in dev tools) and confirming
   the `venue.*` strings render translated on a venue detail dialog.

5. **Keep parity**: run a diff between your new file and `en.json` to
   confirm no keys are missing before opening a PR.

## 5. On-Demand Content Translation (`/api/translate`)

Unlike the static UI strings above, **user-submitted review comments** are
translated on demand rather than being part of the i18next resource
bundles, since their content isn't known ahead of time.

- Triggered by the "Translate" button in `VenueDetailDialog.tsx`
  (`handleTranslate`), which is itself labeled using the static
  `venue.translate` / `venue.translating` i18next keys.
- The client detects the target language from `navigator.language` and
  resolves a human-readable language name via `Intl.DisplayNames`.
- It calls `POST /api/translate` (`src/app/api/translate/route.ts`) with
  `{ text, targetLanguage }`.
- The route requires an authenticated Clerk session and forwards the
  request to Groq (`llama-3.1-8b-instant`) with a system prompt instructing
  it to return only the translated text.
- The translated string is cached client-side per review id in component
  state (`translatedReviews`) for the lifetime of that page view; it is not
  persisted to the database or added to any locale file.

This flow is intentionally separate from the static i18next
resources — do not add review content to `src/locales/*.json`.

## 6. Localized Input Validation

Form/API input validation in this codebase is handled by
[Zod](https://zod.dev/) schemas in `src/lib/validations.ts` (e.g.
`venueSearchSchema`, `venueCreateSchema`, `venueRatingSchema`,
`chatRequestSchema`).

**Current state:** these schemas are not currently bound to i18next — Zod's
default error messages are English-only, and there is no locale-aware error
map wired into `useTranslation` or the i18next resource bundles.

If you need locale-aware validation messages, the recommended pattern going
forward is:

1. Add a `validation.*` namespace to each locale file, e.g.:

   ```json
   {
     "validation": {
       "required": "This field is required",
       "invalidCoordinates": "Coordinates must be within valid ranges"
     }
   }
   ```

2. Bind messages at the point of use with `t()` rather than through Zod's
   global `z.setErrorMap`, since Zod schemas in `src/lib/validations.ts` are
   shared by both client components and server-only API routes (which don't
   have access to the React i18next context). For example, in a client
   component:

   ```tsx
   const { t } = useTranslation();
   const result = venueCreateSchema.safeParse(formValues);
   if (!result.success) {
     showError(t("validation.required"));
   }
   ```

3. For server-side validation errors returned from API routes, prefer
   returning a stable error **code** (not a hardcoded English string) and
   let the client map that code to a localized message with `t()`.

This section will need updating once a concrete localized-validation
implementation lands; treat it as guidance rather than a description of
existing, wired-up behavior.

## 7. Quick Reference

| Task | File(s) |
| --- | --- |
| Add/edit a static UI string | `src/locales/<lang>.json` (all locales) |
| Register a new locale | `src/components/I18nProvider.tsx` |
| Use a string in a component | `useTranslation()` + `t("namespace.key")` from `react-i18next` |
| On-demand review translation | `src/app/api/translate/route.ts`, `VenueDetailDialog.tsx` |
| Input validation schemas | `src/lib/validations.ts` |

