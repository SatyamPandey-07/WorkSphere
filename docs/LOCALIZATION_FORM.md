# Localization Guidelines: Form Labels, Placeholders & Validation Errors

This guide explains how to add localized labels, placeholders, and validation error messages to WorkSphere forms, and how Zod schemas should surface translation keys instead of hardcoded English strings.

> **Note on other localization docs:** `docs/LOCALIZATION_GUIDE.md` currently states WorkSphere has no i18n system implemented, and `docs/LOCALIZED_VALIDATION.md` describes a `messages/*.json` + `next-intl`-based setup. Neither matches the current codebase — WorkSphere already ships a working `i18next` + `react-i18next` setup (see below). Treat this document as the source of truth for forms/validation; those two likely need a follow-up correction.

---

# Current State

- **Library:** `i18next` + `react-i18next`, initialized in `src/components/I18nProvider.tsx`, wrapping the app client-side.
- **Locale files:** `src/locales/{en,es,fr,de,hi}.json`. Today they only contain a `venue.*` namespace (used by `VenueDetailDialog.tsx` via `useTranslation()`), for example:
  ```json
  { "venue": { "reviews": "Reviews", "wifi": "WiFi" } }
  ```
- **Detection:** `i18next-browser-languagedetector`, using its default order (`querystring → cookie → localStorage → sessionStorage → navigator → htmlTag`). It does **not** read the `Accept-Language` HTTP header — detection happens client-side, in the browser, not on the server. This matters for the testing section below.
- **Forms today:** components like `VenueSubmissionModal.tsx`, `VenueRatingDialog.tsx`, and `WebhookForm.tsx` have hardcoded English `<label>` text and `placeholder="..."` strings — none call `t()`.
- **Validation errors today:** Zod schemas live in `src/lib/validations.ts` and `src/lib/events/schemas.ts`. `validateRequest()` runs `schema.safeParse()` and returns a single concatenated English string (`"field: message, field: message"`) built from Zod's default issue messages. There is no error map and no translation hook anywhere in this path.

---

# 1. Validation Keys — Structuring Localized JSON Files

Add a `validation` namespace to each locale file, keyed by schema name → field → rule, in dot notation. This mirrors the existing `venue.*` namespace style already in `src/locales/*.json`.

**`src/locales/en.json`** (additive — don't touch the existing `venue` block):
```json
{
  "venue": { "...": "..." },
  "validation": {
    "venueRating": {
      "wifiQuality": {
        "required": "Please rate the WiFi quality.",
        "range": "WiFi quality must be between 1 and 5."
      },
      "comment": {
        "tooLong": "Comment must be 1000 characters or fewer."
      }
    },
    "venueCreate": {
      "name": {
        "required": "Venue name is required.",
        "tooLong": "Venue name must be 200 characters or fewer."
      },
      "latitude": {
        "range": "Latitude must be between -90 and 90."
      }
    }
  }
}
```

**`src/locales/es.json`, `fr.json`, `de.json`, `hi.json`** — mirror the exact same key paths with translated values. Missing keys in a non-`en` file silently fall back to `en` because `I18nProvider.tsx` sets `fallbackLng: "en"`, so partial translation coverage during a rollout is safe — you won't get raw keys rendered to users.

**Naming convention:**
- Top-level key = the exported schema name from `validations.ts` / `schemas.ts` (e.g. `venueRatingSchema` → `validation.venueRating`).
- Second level = the field name, matching the Zod object key exactly.
- Third level = a short rule identifier (`required`, `tooLong`, `tooShort`, `range`, `invalid`) rather than reusing Zod's internal issue codes verbatim — this keeps keys stable if the underlying Zod validator changes.

---

# 2. Zod Integration

WorkSphere doesn't currently run Zod validation on the client (no `react-hook-form` + `zodResolver` anywhere in `src/`) — all schemas in `validations.ts` run server-side, inside API routes. `I18nProvider` is a `"use client"` component, so the `i18next` instance it initializes **isn't available inside API routes** without extra setup. Because of that, don't try to translate messages inside `z.setErrorMap()` on the server — instead, have the server return a stable, structured **key**, and let the client (which already knows the active locale via `useTranslation()`) resolve it to text.

**Step 1 — return structured issues instead of a flattened string.** Update `validateRequest()` in `src/lib/validations.ts`:

```ts
export function validateRequest<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
):
  | { success: true; data: T }
  | { success: false; error: string; issues: { field: string; rule: string; key: string }[] } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issues = result.error.issues.map((e) => {
    const field = e.path.join(".");
    const rule = zodCodeToRule(e.code, e); // maps ZodIssueCode -> "required" | "tooLong" | "range" | ...
    return { field, rule, key: `validation.${schema._def.description ?? "form"}.${field}.${rule}` };
  });
  return {
    success: false,
    error: result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "), // kept for logs/back-compat
    issues,
  };
}
```

Give each schema a `.describe("venueRating")` (matching the locale namespace) so `schema._def.description` resolves correctly, e.g.:
```ts
export const venueRatingSchema = z.object({ /* ... */ }).describe("venueRating");
```

**Step 2 — resolve keys on the client.** Wherever a form currently does `setError(data.error)` after a failed fetch (e.g. `VenueSubmissionModal.tsx`), switch to reading `data.issues` and translating each key:

```tsx
const { t } = useTranslation();
// ...
if (!res.ok) {
  const data = await res.json();
  const messages = (data.issues ?? []).map((i: { key: string }) => t(i.key));
  setError(messages.join(" "));
}
```

This keeps `i18next` entirely client-side (no server bundle changes, no locale cookie plumbing needed) while still letting the server own validation logic and rule naming.

---

# 3. Testing Locales

Because locale detection is client-side and not header-based (see [Current State](#current-state)), "changing the locale" in tests means changing what the language detector sees, not the `Accept-Language` request header:

### Jest / React Testing Library

Don't use a full `jest.mock("i18next", ...)` like `src/__tests__/lib/useCsrfToken.test.tsx` does — that replaces the whole module with a stub and won't actually translate anything. Instead, initialize a real `i18next` instance with your test locale before rendering:

```tsx
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import es from "@/locales/es.json";

beforeAll(() => {
  i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, es: { translation: es } },
    lng: "es", // force the locale under test
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
});

// then render the component under test with <I18nextProvider i18n={i18n}> or
// via I18nProvider if the component tree expects it
```

Switch locales mid-test with `await i18n.changeLanguage("fr")` before re-rendering, and assert on the translated string (e.g. `screen.getByText(es.validation.venueRating.comment.tooLong)`) rather than a hardcoded literal, so the test stays correct if copy changes.

### Playwright (e2e)

Playwright's built-in `locale` context option changes `navigator.language`, which `i18next-browser-languagedetector` reads by default — no header manipulation needed:

```ts
test.use({ locale: "es-ES" });

test("shows localized validation error", async ({ page }) => {
  await page.goto("/submit-venue");
  // ...trigger a validation error...
  await expect(page.getByText(/campo obligatorio/i)).toBeVisible();
});
```

If a specific test needs to bypass browser-language detection entirely (e.g. to test the `localStorage` detection path, which takes priority over `navigator`), seed it directly before navigation:

```ts
await page.addInitScript(() => localStorage.setItem("i18nextLng", "de"));
await page.goto("/submit-venue");
```

---

# Related Files

- `src/components/I18nProvider.tsx` — i18next initialization.
- `src/locales/*.json` — translation resources.
- `src/lib/validations.ts`, `src/lib/events/schemas.ts` — Zod schemas.
- `src/__tests__/lib/useCsrfToken.test.tsx` — existing (module-mock) i18next test pattern; use the real-instance pattern above instead for locale-sensitive tests.
