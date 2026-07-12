# Localization Guidelines for Custom Validation Messages

This document outlines the standard architecture for translating input validation schemas, managing internationalized schema error states, and verifying localized API validation payloads within the application engine.

---

## 1. Localized Validation Keys Structure

All form-level translation tokens must follow a flat, standardized dot-notation syntax matching their schema property mappings. Translation keys are organized inside the locale directories (e.g., `messages/en.json`, `messages/hi.json`).

### Standard Structure Example (`messages/en.json`)

```json
{
  "validation": {
    "auth": {
      "email_invalid": "Please enter a valid business email address.",
      "password_too_short": "Password must contain a minimum of 8 characters."
    },
    "workspace": {
      "name_required": "Workspace moniker cannot be blank.",
      "radius_exceeded": "Coordinates must fall within verified boundary fences."
    }
  }
}