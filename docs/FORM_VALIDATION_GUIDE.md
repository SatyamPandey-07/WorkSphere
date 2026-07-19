# Form Validation Guide

This document outlines the standard approach for handling form validation, managing error states, and ensuring accessible user feedback across all UI components.

## 1. Core Validation Approach: Controlled Inputs

All forms should utilize **controlled inputs**. This means React state serves as the "single source of truth" for the input's value.

- By controlling inputs, we can seamlessly intercept values for real-time masking, formatting, and validation.
- For complex forms, integrate a schema validation library (like Zod) alongside state management (like React Hook Form).

## 2. Validation Timing Strategies

### Field-Level Validation (On Blur)

- **Strategy:** Validate individual inputs when the user navigates away from the field.
- **When to use:** Use for fields requiring immediate, distinct feedback (e.g., username availability, password strength, complex formatting).
- **Avoid:** Do not validate aggressively `onChange` (while the user is actively typing), as this triggers premature errors and creates a frustrating user experience.

### Form-Level Validation (On Submit)

- **Strategy:** Validate the entire form state simultaneously when the user attempts to submit.
- **When to use:** Use to ensure all required fields are filled and interconnected data is valid before processing the API payload.

## 3. Error Message Tone

Error messages must be helpful, clear, actionable, and non-judgmental.

- **Do:** "Please enter a valid email address (e.g., name@example.com)."
- **Don't:** "Invalid email!" or "You typed the email wrong."
- Always inform the user specifically _what_ went wrong and exactly _how_ they can fix it.

## 4. Accessible Error Message Patterns

Accessibility (a11y) is a strict requirement for all form validation states.

- **`aria-invalid`**: Always apply `aria-invalid="true"` to the input element when it is in an error state.
- **`aria-describedby`**: Link the input field to its corresponding text error message using the `aria-describedby` attribute so screen readers announce the error context.
- **Focus Management**: Upon a failed `onSubmit` form-level validation, automatically shift focus to the very first invalid input field on the screen.
