# Date, Time, and Currency Localization Standards

This guide establishes the standards for handling **Internationalization (i18n)** in WorkSphere, specifically focusing on date formatting, time zone management, and currency display. Following these patterns ensures a consistent experience for users across all supported locales.

---

## 1. Core Principles

WorkSphere follows three foundational rules for localization:
1. **Internal Standardization**: All timestamps are stored in **UTC** within the database.
2. **UI-Level Formatting**: Formatting happens only at the presentation layer (frontend), never in the backend.
3. **Locale-Aware APIs**: Use native browser/Node.js APIs (`Intl`) for formatting rather than hardcoded string manipulation.

---

## 2. Date and Time Formatting

Avoid hardcoding date strings (e.g., `DD/MM/YYYY`). Instead, use the `Intl.DateTimeFormat` API which automatically adapts to the user's active locale.

### Recommended Usage
```tsx
const locale = i18n.language; // Current active language
const date = new Date('2026-07-13T15:45:00Z');

const formatter = new Intl.DateTimeFormat(locale, {
  dateStyle: "medium",
  timeStyle: "short",
});

console.log(formatter.format(date));
```

### Formatting Standards by Locale
| Locale | Date Example | Time Example | Context |
| :--- | :--- | :--- | :--- |
| **en-US** | Jul 13, 2026 | 3:45 PM | 12-hour clock, Month-Day-Year |
| **en-GB** | 13 Jul 2026 | 15:45 | 24-hour clock, Day-Month-Year |
| **de-DE** | 13.07.2026 | 15:45 | Dot separators, 24-hour clock |
| **hi-IN** | 13 जुल॰ 2026 | 3:45 pm | Hindi month names, 12-hour clock |

---

## 3. Time Zone Management

To prevent synchronization issues between users in different regions, always store time in UTC and convert to the local time zone only when rendering.

### Implementation Pattern
```tsx
// Stored value: 2026-07-13T14:00:00Z
const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const localTime = new Intl.DateTimeFormat(locale, {
  timeZone: userTimeZone,
  hour: '2-digit',
  minute: '2-digit',
}).format(date);
```

> [!WARNING]
> Do not use `.toLocaleTimeString()` without arguments in server-side logic (like Cron jobs or API routes), as it will use the server's local time instead of the user's. Always specify the target locale or use UTC.

---

## 4. Currency and Number Formatting

Currencies must specify both the locale and the currency code to ensure symbols and separators are placed correctly.

### Standard Currency Formatter
```tsx
const currencyFormatter = new Intl.NumberFormat(locale, {
  style: "currency",
  currency: "USD", // Should be dynamic based on venue/user setting
});

// Output for 250.50:
// en-US: $250.50
// de-DE: 250,50 €
// fr-FR: 250,50 $US
```

### Number Separators
| Locale | Example Value | Separator Style |
| :--- | :--- | :--- |
| **en-US** | 1,234.56 | Comma for thousands, dot for decimal |
| **de-DE** | 1.234,56 | Dot for thousands, comma for decimal |
| **fr-FR** | 1 234,56 | Space for thousands, comma for decimal |

---

## 5. i18next Integration

WorkSphere uses `i18next` for managing translation strings. For complex localization patterns like pluralization or gender, use the built-in interpolation features.

### Parameterized Translations
In `locales/en.json`:
```json
{
  "venue": {
    "bookingCount": "You have {{count}} active booking",
    "bookingCount_plural": "You have {{count}} active bookings"
  }
}
```

In your component:
```tsx
const { t } = useTranslation();
return <p>{t('venue.bookingCount', { count: 5 })}</p>;
```

---

## 6. Best Practices for Contributors

1. **Never Concatenate**: Avoid `t('hello') + ' ' + name`. Use `t('welcome', { name })` to allow for different word orders.
2. **Relative Time**: Use `Intl.RelativeTimeFormat` for "5 minutes ago" or "Yesterday" to ensure the text is correctly translated.
3. **RTL Support**: When adding translations for RTL languages (like Arabic or Hebrew), ensure that layout-sensitive values (like directional arrows) are mirrored.
4. **Test Long Strings**: German and Hindi strings are often significantly longer than English. Always test your UI with these languages to ensure no layout breakage occurs.

---

## Summary

By adhering to these standards, we ensure that WorkSphere remains accessible and intuitive for a global audience. Centralizing formatting logic through native `Intl` APIs reduces maintenance overhead and prevents regional bugs.
