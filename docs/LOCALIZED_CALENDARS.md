# Localized Calendars

## Overview

WorkSphere is designed for users from different regions, languages, and time zones. While the application stores dates in a consistent internal format, users naturally expect to see dates and times in the format they are familiar with.

For example, a user in the United States typically reads **07/13/2026**, while someone in Germany expects **13.07.2026**. Similarly, users may prefer either a 12-hour or a 24-hour clock depending on their locale.

This document explains the recommended approach for handling localized calendars across WorkSphere. It covers formatting, translation values, calendar components, testing strategies, accessibility, and implementation recommendations so that every feature behaves consistently regardless of language or region.

The goal is not only to display dates correctly, but also to make the entire experience feel natural to users around the world.

---

# Goals

The localization system should help developers build calendar-related features without introducing inconsistent formatting or region-specific bugs.

The primary goals are:

- Display dates in formats familiar to the current user.
- Store all timestamps in a consistent format internally.
- Keep backend APIs independent of presentation formatting.
- Make localization predictable across every screen.
- Support future language additions with minimal code changes.
- Keep date formatting centralized instead of scattered throughout the application.

---

# Why Localization Matters

Date formatting is one of the easiest places where users notice an application that is not built for their region.

Consider the following date:

```
03/04/2026
```

Depending on the user's locale, this could mean:

| Locale | Interpretation |
|---------|----------------|
| en-US | March 4, 2026 |
| en-GB | 3 April 2026 |
| fr-FR | 3 April 2026 |

Displaying dates without considering locale can confuse users and increase the likelihood of mistakes, especially when scheduling meetings, bookings, or coworking sessions.

Localization ensures that information is presented in a way users already understand.

---

# Scope

These recommendations apply to every feature that displays or processes dates, including:

- Venue booking calendars
- Reservation history
- Chat timestamps
- Notifications
- Event schedules
- Session reminders
- Analytics dashboards
- Admin panels
- Reports
- Activity feeds

Any new feature involving dates should follow the same principles described in this guide.

---

# Core Principles

WorkSphere follows a few simple principles for handling dates consistently.

## 1. Store Dates in UTC

Every timestamp stored in the database should use UTC.

This avoids inconsistencies caused by daylight saving changes or users working from different countries.

Example:

```text
2026-07-13T15:45:00Z
```

---

## 2. Format Dates Only in the UI

Backend services should never return locale-formatted strings.

Instead, APIs should return standard timestamps, allowing the frontend to format them according to the user's locale.

Preferred API response:

```json
{
  "createdAt": "2026-07-13T15:45:00Z"
}
```

Avoid responses such as:

```json
{
  "createdAt": "13 July 2026"
}
```

because this format cannot be reliably parsed across every locale.

---

## 3. Separate Data from Presentation

The database should care about storing correct timestamps.

The frontend should care about displaying them.

Keeping these responsibilities separate makes the application easier to maintain and simplifies future localization work.

---

# Supported Locales

The application should be designed so additional locales can be introduced without changing business logic.

Examples of commonly supported locales include:

| Locale | Language | Example Date |
|---------|----------|--------------|
| en-US | English (US) | July 13, 2026 |
| en-GB | English (UK) | 13 July 2026 |
| fr-FR | French | 13 juillet 2026 |
| de-DE | German | 13. Juli 2026 |
| es-ES | Spanish | 13 de julio de 2026 |
| it-IT | Italian | 13 luglio 2026 |
| ja-JP | Japanese | 2026年7月13日 |
| ko-KR | Korean | 2026년 7월 13일 |

Developers should avoid hardcoding locale-specific formats directly into components.

---

# Locale Selection

The active locale should be determined using a predictable priority order.

Recommended priority:

1. User account preference.
2. Browser language.
3. Organization or workspace preference.
4. Application default locale.

This approach ensures users see familiar formatting without requiring manual configuration every time they sign in.

---

# Translation Values

Localization files should contain formatting preferences alongside translated strings.

Example:

```json
{
  "dateFormat": "DD/MM/YYYY",
  "timeFormat": "24h",
  "firstDayOfWeek": "Monday",
  "shortMonths": true
}
```

Keeping formatting rules inside localization resources makes it much easier to support new languages without changing application logic.

---

# General Recommendations

When working with localized calendars:

- Never assume every user prefers the same date format.
- Avoid manually concatenating date strings.
- Prefer built-in internationalization APIs.
- Keep formatting logic reusable.
- Document locale-specific behavior when introducing new calendar features.

Following these recommendations helps ensure WorkSphere provides a consistent experience for users across different languages and regions.

---

# Date Formatting Standards

Every date shown to the user should respect the currently selected locale.

Developers should avoid creating custom formatting logic for individual pages. Instead, formatting should be centralized so that every screen displays dates consistently.

For example, the following date:

```
2026-07-13
```

may appear differently depending on the active locale.

| Locale | Display Format |
|---------|----------------|
| en-US | July 13, 2026 |
| en-GB | 13 July 2026 |
| fr-FR | 13 juillet 2026 |
| de-DE | 13. Juli 2026 |
| ja-JP | 2026年7月13日 |

The underlying value remains exactly the same. Only the presentation changes.

---

# Time Formatting

Time formatting should also follow the user's locale.

Some regions commonly use a 12-hour clock, while others prefer a 24-hour clock.

Examples:

| Locale | Example |
|---------|----------|
| en-US | 2:45 PM |
| en-GB | 14:45 |
| de-DE | 14:45 |
| fr-FR | 14:45 |

Avoid forcing one format globally.

Instead, use locale-aware formatting so users immediately recognize the displayed time.

---

# Time Zone Handling

Time zones should always be considered when displaying timestamps.

Internally, WorkSphere should continue storing all timestamps in UTC.

Example:

```
2026-07-13T14:00:00Z
```

When displayed:

| User Time Zone | Display |
|----------------|----------|
| UTC | 14:00 |
| Asia/Kolkata | 19:30 |
| Europe/London | 15:00 |
| America/New_York | 10:00 |

The stored value never changes.

Only the rendered value changes.

This approach prevents synchronization issues between users in different countries.

---

# Calendar Layout

Calendar components should automatically adapt to the selected locale.

Recommended behavior includes:

- Localized month names
- Localized weekday names
- Locale-aware date ordering
- Correct first day of the week
- Consistent navigation controls
- Responsive layouts for desktop and mobile devices

The overall interaction should feel familiar to users regardless of their language.

---

# First Day of the Week

Different countries begin the week on different days.

For example:

| Locale | First Day |
|---------|------------|
| en-US | Sunday |
| en-GB | Monday |
| fr-FR | Monday |
| de-DE | Monday |

Calendar components should not assume Monday or Sunday universally.

The first day should come from localization settings whenever possible.

---

# Month Names

Month names should always come from localization resources rather than hardcoded English values.

Preferred:

```
January
February
March
```

Localized automatically to:

```
Janvier
Février
Mars
```

or

```
Januar
Februar
März
```

depending on the active locale.

---

# Weekday Labels

Weekday labels should also be localized.

Examples include:

English:

```
Mon
Tue
Wed
Thu
Fri
Sat
Sun
```

French:

```
Lun
Mar
Mer
Jeu
Ven
Sam
Dim
```

German:

```
Mo
Di
Mi
Do
Fr
Sa
So
```

Keeping weekday labels localized improves readability and reduces confusion.

---

# Date Picker Guidelines

All date picker components should follow the application's active locale automatically.

A date picker should:

- Open using the current month.
- Highlight today's date.
- Clearly distinguish selected dates.
- Display localized month names.
- Respect localized weekday ordering.
- Support keyboard navigation.
- Work correctly on touch devices.

Developers should avoid creating custom date pickers unless absolutely necessary.

Using a shared calendar component helps maintain a consistent experience throughout the application.

---

# Date Selection

Selecting a date should never depend on locale-specific parsing.

Instead:

- Store the selected value as an ISO timestamp.
- Display it using locale formatting.
- Pass standardized values to APIs.

This keeps frontend and backend behavior predictable.

---

# Accessibility

Calendar components should remain fully accessible.

Recommended practices include:

- Keyboard navigation support.
- Visible focus indicators.
- Screen reader labels.
- Proper ARIA attributes.
- Sufficient color contrast.
- Large click targets for mobile users.

Accessibility improvements benefit every user, not only those using assistive technologies.

---

# Right-to-Left (RTL) Languages

Some languages are displayed from right to left.

Examples include:

- Arabic
- Hebrew
- Persian

Calendar layouts should correctly mirror navigation controls when RTL mode is active.

Items that typically require adjustment include:

- Previous and next month buttons.
- Calendar alignment.
- Navigation arrows.
- Weekday headers.
- Popup positioning.

Supporting RTL layouts early makes future international expansion significantly easier.

---

# Translation File Organization

Localization files should contain both translated strings and locale-specific formatting preferences.

A recommended structure is shown below.

```json
{
  "locale": "en-US",
  "dateFormat": "MM/DD/YYYY",
  "timeFormat": "12h",
  "firstDayOfWeek": "Sunday",
  "months": {
    "january": "January",
    "february": "February"
  },
  "weekdays": {
    "monday": "Monday",
    "tuesday": "Tuesday"
  }
}
```

This approach keeps all locale-specific configuration together, making it easier to maintain and extend.

---

# Keeping Translation Files Consistent

Every locale should expose the same keys.

For example:

```
en-US.json
fr-FR.json
de-DE.json
ja-JP.json
```

Each file should contain identical property names, with only the translated values changing.

Avoid situations where one locale contains keys that do not exist in another locale.

Consistent translation structures simplify maintenance and reduce runtime errors.

---

# Backend Recommendations

The backend should never generate localized date strings.

Instead, APIs should always return standard timestamps.

Recommended response:

```json
{
  "createdAt": "2026-07-13T14:30:00Z"
}
```

Avoid responses such as:

```json
{
  "createdAt": "13 July 2026"
}
```

because this format may not be interpreted consistently across every locale.

Localization belongs in the presentation layer rather than the API.

---

# API Design

API contracts should remain stable regardless of language.

Changing the application's language should not affect:

- API response structure
- Timestamp format
- Database values
- Sorting behavior

Only the frontend presentation should change.

This separation keeps integrations predictable and easier to test.

---

# Frontend Responsibilities

The frontend is responsible for converting timestamps into user-friendly values.

Typical responsibilities include:

- Formatting dates.
- Formatting times.
- Displaying localized month names.
- Showing localized weekday names.
- Respecting user locale preferences.

Keeping all formatting inside reusable utilities helps avoid duplicated logic across the application.

---

# Common Formatting Examples

Example timestamp:

```
2026-07-13T15:45:00Z
```

Possible localized outputs:

| Locale | Display |
|---------|----------|
| en-US | Jul 13, 2026 |
| en-GB | 13 Jul 2026 |
| fr-FR | 13 juil. 2026 |
| de-DE | 13. Juli 2026 |
| ja-JP | 2026年7月13日 |

The timestamp itself remains unchanged.

Only its presentation differs.

---

# Testing Localization

Localization should be verified during development instead of relying solely on manual testing.

Testing multiple locales early helps identify formatting issues before release.

Recommended locales include:

- en-US
- en-GB
- fr-FR
- de-DE
- ja-JP

Additional locales can be added as the application expands.

---

# Unit Tests

Unit tests should verify that formatting utilities produce consistent results.

Typical checks include:

- Correct month names.
- Correct weekday names.
- Correct date order.
- Correct time format.
- Proper handling of invalid dates.

Testing formatting utilities independently makes debugging much easier.

---

# Integration Tests

Integration tests should verify that localized dates appear correctly inside UI components.

Examples include:

- Booking forms
- Reservation pages
- Chat timestamps
- Notifications
- Calendar widgets

The goal is to ensure that formatting utilities integrate correctly with the user interface.

---

# End-to-End Testing

End-to-end tests should simulate real user interactions.

Recommended scenarios include:

- Opening the calendar.
- Selecting a date.
- Changing the application language.
- Refreshing the page.
- Verifying that the selected date remains correct.

These tests help confirm that localization behaves correctly across the complete user flow.

---

# Time Zone Testing

Localization testing should also cover multiple time zones.

Useful examples include:

- UTC
- Asia/Kolkata
- Europe/London
- America/New_York
- Australia/Sydney

This helps identify issues caused by timezone conversions or daylight saving changes.

---

# Regression Testing

Whenever calendar-related code changes, developers should verify that:

- Existing locales still render correctly.
- Date parsing remains stable.
- Time formatting has not changed unexpectedly.
- Previously fixed localization bugs have not returned.

Regression testing reduces the risk of introducing subtle localization issues in future updates.

---

# Conclusion

Following these guidelines ensures that calendar-related features behave consistently across different languages, regions, and time zones.

By storing timestamps in a standard format, formatting them only at the presentation layer, and validating localization through automated tests, WorkSphere can provide a predictable and user-friendly experience for a global audience.

Future calendar-related features should follow the same conventions described in this document to maintain consistency throughout the application.