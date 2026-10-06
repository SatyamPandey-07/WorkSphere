/**
 * Profile display name sanitizer & validator (#4370).
 * Ensures display names are properly trimmed, internal consecutive whitespace collapsed,
 * and client-side validation errors returned for empty or invalid inputs.
 */

export function sanitizeDisplayName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, "");
}

export interface DisplayNameValidationResult {
  isValid: boolean;
  sanitized: string;
  error?: string;
}

export function validateDisplayName(name: string | null | undefined): DisplayNameValidationResult {
  const sanitized = sanitizeDisplayName(name);

  if (!sanitized || sanitized.length === 0) {
    return {
      isValid: false,
      sanitized: "",
      error: "Display name cannot be empty or contain only whitespace.",
    };
  }

  if (sanitized.length < 2) {
    return {
      isValid: false,
      sanitized,
      error: "Display name must be at least 2 characters long.",
    };
  }

  if (sanitized.length > 50) {
    return {
      isValid: false,
      sanitized,
      error: "Display name cannot exceed 50 characters.",
    };
  }

  return {
    isValid: true,
    sanitized,
  };
}
