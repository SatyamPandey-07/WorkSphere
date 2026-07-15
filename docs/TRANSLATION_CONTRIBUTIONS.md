# Internationalization (i18n) Contribution Guide

## Overview

> **Note**
>
> At the time of writing, WorkSphere does not include a production internationalization (i18n) implementation. This document defines the recommended contribution standards for future localization efforts and should evolve alongside the project's architecture as multilingual support is introduced.

Internationalization enables applications to support multiple languages, regional preferences, and locale-specific formatting without requiring changes to core business logic. Establishing clear contribution guidelines before implementing localization helps maintain consistency across the codebase and reduces future maintenance effort.

This guide documents the recommended conventions contributors should follow when adding localization support to WorkSphere. It covers translation resource organization, translation key design, locale management, formatting standards, contributor workflows, and review practices. The recommendations are based on modern Next.js development practices and assume a future integration using **next-intl** for message management and locale-aware formatting.

Rather than documenting an implementation that does not yet exist, this guide establishes a consistent foundation for future localization contributions. As WorkSphere's internationalization architecture evolves, these recommendations should evolve alongside it.

---

# Objectives

The primary objective of this guide is to establish a shared set of conventions that make localization contributions predictable, maintainable, and easy to review.

Specifically, this document aims to help contributors:

- Organize translation resources using a scalable directory structure.
- Design consistent and reusable translation keys.
- Introduce additional languages without affecting existing locales.
- Maintain synchronization across all translation resources.
- Format locale-sensitive values correctly.
- Reduce duplicate translations and inconsistent terminology.
- Improve collaboration by following a common localization workflow.

Following these recommendations helps ensure that future localization work remains organized as WorkSphere continues to expand.

---

# Scope

The recommendations described in this document apply to future contributions involving localization, including:

- Translation resource files
- Locale configuration
- Language additions
- Translation key design
- User-facing interface text
- Locale-aware formatting
- Localization documentation
- Translation reviews

This guide intentionally focuses on contribution standards rather than documenting an existing implementation. As WorkSphere adopts internationalization, these recommendations can be updated to reflect the project's production architecture.

---

# Guiding Principles

Every localization contribution should aim to satisfy the following principles:

- **Consistency** — Similar content should follow the same translation patterns across the application.
- **Maintainability** — Translation resources should remain easy to understand and update.
- **Scalability** — Adding new languages should require minimal structural changes.
- **Readability** — Translation files should be easy for contributors to navigate.
- **Reusability** — Existing translation keys should be reused whenever appropriate.
- **Predictability** — Contributors should be able to understand where new translations belong without additional guidance.

Keeping these principles in mind helps maintain a clean and sustainable localization workflow.

---


# Recommended Project Structure

Separating localization resources from application logic improves maintainability and simplifies future language additions.

The directory structure below illustrates one possible organization for a future internationalization implementation.

```text
src/
├── app/
├── components/
├── i18n/
│   ├── config.ts
│   ├── request.ts
│   └── routing.ts
│
├── messages/
│   ├── en.json
│   ├── hi.json
│   ├── fr.json
│   ├── es.json
│   └── de.json
│
├── lib/
└── middleware.ts
```

## Directory Responsibilities

| Directory | Responsibility |
|------------|----------------|
| `messages/` | Stores locale-specific translation resources. |
| `i18n/` | Contains localization configuration, routing, and request handling. |
| `components/` | Consumes translated messages instead of hardcoded strings. |
| `app/` | Provides locale-aware routing and rendering. |
| `middleware.ts` | Handles locale detection and request redirection when localization is introduced. |

Separating translation resources from application logic keeps localization changes isolated, improves code review quality, and makes future maintenance significantly easier.

---

# Translation Resource Organization

Each supported language should have its own dedicated translation resource.

Example:

```text
messages/
├── en.json
├── hi.json
├── fr.json
├── es.json
└── de.json
```

Every locale should contain the **same set of translation keys**, with only the translated values differing between languages.

For example:

**en.json**

```json
{
  "navigation.home": "Home",
  "navigation.search": "Search",
  "booking.confirm": "Confirm Booking"
}
```

**hi.json**

```json
{
  "navigation.home": "होम",
  "navigation.search": "खोजें",
  "booking.confirm": "बुकिंग की पुष्टि करें"
}
```

Maintaining identical translation structures across every locale helps prevent missing translations, simplifies automated validation, and ensures a consistent experience regardless of the selected language.

Whenever a new translation key is introduced, contributors should add that key to every supported locale, even if some translations temporarily reuse the default language until proper localization becomes available.

---

# Translation Key Design

Translation keys are long-lived identifiers that represent user-facing text throughout the application. Unlike the displayed text itself, translation keys should remain stable even when wording changes over time.

Contributors should treat translation keys as part of the application's internal interface rather than temporary labels. Renaming existing keys unnecessarily increases maintenance effort, introduces avoidable merge conflicts, and requires updates across every supported locale.

A well-designed key structure makes translation resources easier to navigate, simplifies reviews, and encourages reuse instead of duplication.

---

## Naming Principles

When introducing new translation keys, contributors should follow these general principles:

- Use descriptive, human-readable names.
- Keep keys concise while remaining meaningful.
- Group related translations under the same namespace.
- Prefer consistency over personal preference.
- Avoid abbreviations unless they are widely understood.
- Never use spaces or special characters.
- Use lowercase characters throughout the project.

Translation keys should describe **what the text represents**, not where it appears in the interface.

For example:

**Preferred**

```text
booking.confirm
booking.cancel
profile.settings
navigation.home
chat.placeholder
```

**Avoid**

```text
button1
homeButton
textLabel
message01
tempValue
```

Meaningful identifiers remain understandable even when components or layouts change.

---

## Namespace Strategy

Translation keys should be organized by **feature or domain**, not by individual pages.

Recommended structure:

```text
feature.section.element
```

Examples:

```text
navigation.home
navigation.search
navigation.profile

chat.placeholder
chat.send
chat.typing

booking.confirm
booking.cancel
booking.success

venue.address
venue.distance
venue.rating

profile.settings
profile.logout
```

Organizing translations by feature keeps related strings together, improves discoverability, and scales naturally as new functionality is added.

---

## Grouping Related Translations

Large translation files become easier to maintain when related entries are grouped together.

Example:

```json
{
  "navigation": {
    "home": "Home",
    "search": "Search",
    "profile": "Profile"
  },
  "booking": {
    "confirm": "Confirm Booking",
    "cancel": "Cancel",
    "success": "Booking Successful"
  },
  "chat": {
    "placeholder": "Type your message...",
    "send": "Send"
  }
}
```

Whether the project adopts nested objects or flat dot-separated keys in the future, contributors should remain consistent throughout the codebase and avoid mixing multiple styles within the same locale file.

---

## Placeholder Variables

Many translations contain values that are provided dynamically at runtime.

Examples include:

- User names
- Workspace names
- Dates
- Distances
- Counts
- Prices

These values should be represented using placeholders rather than hardcoded strings.

Example:

```json
{
  "booking.confirmation": "Booking confirmed for {name}",
  "venue.distance": "{distance} km away",
  "notifications.count": "{count} new notifications"
}
```

When translating:

- Translate only the surrounding sentence.
- Preserve placeholder names exactly as written.
- Do not rename variables.
- Do not remove braces.
- Do not translate placeholder identifiers.

Correct:

```text
{name} के लिए बुकिंग सफल रही।
```

Incorrect:

```text
{नाम} के लिए बुकिंग सफल रही।
```

Changing placeholder names may prevent runtime values from being inserted correctly.

---

## Pluralization

Many languages require different wording depending on quantity.

Instead of creating unrelated translation keys for singular and plural text, contributors should rely on the pluralization capabilities provided by the localization framework once it is integrated.

Example:

```json
{
  "messages": {
    "zero": "No messages",
    "one": "1 message",
    "other": "{count} messages"
  }
}
```

Using locale-aware plural rules produces more natural translations and avoids manual conditional logic inside application components.

---

## Reusing Existing Translation Keys

Before introducing a new translation key, contributors should verify whether an equivalent key already exists.

For example, avoid creating:

```text
booking.ok
booking.accept
booking.submit
```

when the existing project already uses:

```text
booking.confirm
```

Reusing established translation keys improves consistency across the interface and reduces duplicate content inside locale files.

---

## What Should Not Be Translated

Only user-visible content should be localized.

The following should remain unchanged:

- Database identifiers
- API response fields
- Internal enum values
- Route names
- File names
- Environment variable names
- CSS class names
- Programming keywords
- Placeholder identifiers

Keeping implementation-specific values unchanged prevents unnecessary complexity and reduces the risk of introducing application errors.

---

## Translation Review Checklist

Before submitting localization changes, contributors should verify that:

- Translation keys follow the established naming convention.
- Related keys are grouped within the correct namespace.
- No duplicate translation keys have been introduced.
- Placeholder variables remain unchanged.
- JSON syntax is valid.
- Every locale contains the same translation structure.
- New wording accurately reflects the original meaning.
- Existing translation keys have been reused whenever possible.

Following these review steps helps maintain consistency across the project and simplifies future localization efforts.

---

# Adding a New Locale

When multilingual support is introduced, adding a new language should follow a predictable workflow so that every locale remains complete, consistent, and easy to maintain.

A new locale is more than a translation file—it should be integrated into routing, locale configuration, language selection, formatting utilities, and application testing.

Following a standardized process reduces maintenance overhead and minimizes the risk of incomplete translations.

---

## Step 1 — Create a Translation Resource

Create a new locale file inside the `messages/` directory using an existing language as the reference.

Example:

```text
messages/
├── en.json
├── hi.json
├── fr.json
├── es.json
└── de.json
```

Using an existing locale as the template ensures that every required translation key is available from the beginning.

Avoid creating translation resources from scratch whenever possible.

---

## Step 2 — Preserve Translation Keys

Every locale should expose an identical translation structure.

Only the translated values should change.

Correct:

```json
// en.json
{
  "navigation.home": "Home",
  "booking.confirm": "Confirm Booking"
}
```

```json
// hi.json
{
  "navigation.home": "होम",
  "booking.confirm": "बुकिंग की पुष्टि करें"
}
```

Incorrect:

```json
{
  "navigation.home": "होम"
}
```

Removing or renaming translation keys introduces inconsistencies between locales and may result in missing interface text during runtime.

---

## Step 3 — Register the Locale

After creating a translation resource, register the locale within the application's internationalization configuration.

A typical configuration includes:

- Supported locales
- Default locale
- Locale routing
- Locale detection
- Fallback locale

Maintaining these settings in a centralized configuration makes future language additions easier and keeps routing behavior consistent.

---

## Step 4 — Update the Language Selector

Every supported language should be accessible through the application's language selector.

Recommended information includes:

| Language | Locale Code |
|-----------|-------------|
| English | en |
| हिन्दी | hi |
| Français | fr |
| Español | es |
| Deutsch | de |

Displaying the language name in its native script improves usability for multilingual users.

---

## Step 5 — Verify Translation Coverage

Before considering a locale complete, contributors should verify that all user-facing interfaces have been translated.

Areas to review include:

- Navigation menus
- Authentication pages
- AI chat interface
- Workspace search
- Booking flow
- User profile
- Settings
- Forms
- Dialogs
- Notifications
- Validation messages
- Empty states
- Error pages

Incomplete translations create an inconsistent user experience and reduce the overall quality of localization.

---

# Locale Synchronization

Maintaining synchronized translation resources across all supported locales is essential for long-term maintainability.

Whenever a new translation key is introduced:

1. Add the key to the default locale.
2. Copy the same key to every supported locale.
3. Translate only the localized value.
4. Validate the JSON structure.
5. Review the affected user interface.

Keeping locale files synchronized reduces missing translations, simplifies reviews, and makes future language additions significantly easier.

---

# Fallback Strategy

During active development, some translations may not yet be available.

The recommended fallback order is:

1. Requested locale
2. Default project locale (typically English)

For example:

```
Requested Locale
        │
        ▼
Translation Exists?
      │
  Yes ▼        No
 Display     English
 Translation  Fallback
```

Using a predictable fallback strategy ensures that users always see meaningful interface text instead of missing translation keys or empty values.

---

# Translation Validation

Before opening a Pull Request, contributors should validate translation resources.

Recommended validation includes:

- Valid JSON syntax
- No duplicate translation keys
- Consistent indentation
- UTF-8 file encoding
- Matching key structure across every locale
- No renamed placeholders
- No missing required keys

Automated validation can later be integrated into the project's CI pipeline once localization becomes part of the production workflow.

---

# Testing Localization Changes

Translation resources should always be verified within the running application instead of reviewing JSON files alone.

Contributors should confirm that:

- Language switching behaves correctly.
- All translated content is displayed.
- No untranslated strings remain.
- Buttons and navigation labels fit available space.
- Long translations do not break layouts.
- Placeholder values render correctly.
- Locale-specific formatting is applied consistently.
- Responsive layouts remain readable across different screen sizes.

Testing the interface is particularly important because translated text often varies significantly in length between languages.

---

# Recommended Contributor Workflow

Localization contributions should follow a consistent review process:

1. Sync with the latest project changes.
2. Create a dedicated feature branch.
3. Add or update translation resources.
4. Validate JSON formatting.
5. Review translation consistency.
6. Test affected user interfaces.
7. Submit a Pull Request summarizing the localization changes.

Following the same workflow for every contribution improves review quality and keeps translation updates organized.

---

# Locale-Aware Formatting

Localization extends beyond translating interface text. Applications should also present dates, times, numbers, currencies, and percentages in formats that are familiar to users based on their selected locale.

When internationalization is introduced, formatting logic should remain centralized rather than manually formatting values throughout the codebase.

Using locale-aware APIs ensures consistency, improves readability, and reduces formatting-related bugs.

---

## Date Formatting

Dates should always be formatted using locale-aware utilities instead of hardcoded patterns.

Example:

```tsx
const formatter = new Intl.DateTimeFormat(locale, {
  dateStyle: "medium",
});

formatter.format(new Date());
```

Example output:

| Locale | Example |
|----------|----------------|
| en-US | Jul 11, 2026 |
| en-GB | 11 Jul 2026 |
| hi-IN | 11 जुल॰ 2026 |
| fr-FR | 11 juil. 2026 |

Avoid hardcoded formats such as:

```text
11/07/2026
```

Numeric date formats are interpreted differently across regions and can easily create ambiguity.

---

## Number Formatting

Numeric values should respect regional grouping and decimal separators.

Example:

```tsx
const formatter = new Intl.NumberFormat(locale);

formatter.format(12345.67);
```

Example output:

| Locale | Example |
|----------|-------------|
| en-US | 12,345.67 |
| en-IN | 12,345.67 |
| de-DE | 12.345,67 |
| fr-FR | 12 345,67 |

Using locale-aware formatting improves readability without requiring locale-specific application logic.

---

## Currency Formatting

Currencies should always specify both the locale and currency code.

Example:

```tsx
const formatter = new Intl.NumberFormat(locale, {
  style: "currency",
  currency: "USD",
});

formatter.format(250);
```

Instead of manually writing:

```text
$250
```

allow the formatting API to determine:

- Currency symbol
- Symbol placement
- Thousands separator
- Decimal separator
- Locale-specific spacing

---

## Relative Time

Future localization support may also include relative timestamps.

Examples:

- 5 minutes ago
- Yesterday
- Tomorrow
- Last week

Relative time formatting should be generated using locale-aware utilities instead of manually concatenating strings.

---

# Accessibility Considerations

Localization should improve usability without reducing accessibility.

When contributing translations, consider the following recommendations:

- Keep button labels concise and descriptive.
- Preserve heading hierarchy.
- Translate accessibility labels where appropriate.
- Avoid replacing meaningful text with icons.
- Ensure translated text remains understandable when read by assistive technologies.

Accessibility should be reviewed alongside localization changes rather than as a separate task.

---

# Right-to-Left (RTL) Readiness

Although WorkSphere currently targets left-to-right languages, future localization efforts may include right-to-left locales.

Contributors should design interfaces that can accommodate RTL layouts when required.

Areas to review include:

- Layout direction
- Navigation alignment
- Text alignment
- Icon orientation
- Spacing and margins
- Component positioning

Considering RTL compatibility early reduces future migration effort.

---

# Performance Considerations

Localization resources should remain efficient as the number of supported languages grows.

Recommended practices include:

- Load only the active locale.
- Avoid importing all translation resources during application startup.
- Organize translation files by locale.
- Remove unused translation keys.
- Keep translation resources focused on user-facing content.

Efficient loading strategies help reduce bundle size and improve application startup performance.

---

# Common Mistakes

The following practices should be avoided when contributing localization updates:

- Hardcoding user-facing strings inside components.
- Renaming existing translation keys without necessity.
- Creating duplicate translations for identical text.
- Translating placeholder variable names.
- Leaving locale files out of sync.
- Mixing multiple translation key styles.
- Introducing invalid JSON syntax.
- Copying automated translations without review.

Avoiding these issues improves consistency and simplifies future maintenance.

---

# Pull Request Checklist

Before submitting a localization-related Pull Request, contributors should verify that:

- Translation resources contain valid JSON.
- Every supported locale exposes the same translation keys.
- Placeholder variables remain unchanged.
- New keys follow the established naming conventions.
- Existing keys have been reused where appropriate.
- Formatting remains consistent across locale files.
- Documentation has been updated when necessary.
- Localization changes have been reviewed within the application.

Completing these checks helps reviewers focus on translation quality instead of structural issues.

---

# Future Considerations

As WorkSphere's localization support evolves, contributors are encouraged to extend this guide alongside the implementation.

Potential enhancements may include:

- Integration with **next-intl** for message management and locale routing
- Automatic locale detection
- Dynamic language switching
- Lazy-loaded translation resources
- Locale-specific metadata and SEO support
- Region-aware formatting preferences
- Automated translation validation within CI workflows

Any future localization architecture should remain consistent with the contribution principles described throughout this guide.

---

# Conclusion

A well-defined internationalization strategy helps keep localization efforts consistent, maintainable, and scalable as a project grows.

Although WorkSphere does not currently include a production internationalization implementation, establishing clear contribution standards early provides a solid foundation for future multilingual support. By following the conventions outlined in this guide, contributors can organize translation resources consistently, reduce duplication, and simplify future localization efforts.

This document should be treated as a living guide and updated alongside the project's internationalization architecture as new localization capabilities are introduced.