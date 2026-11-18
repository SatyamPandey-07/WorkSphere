/**
 * Profile display name & username sanitizer & validator (#4370).
 * Ensures display names and usernames are properly trimmed, validated for minimum length,
 * and client-side validation errors returned before submitting profile updates.
 */

export const MIN_DISPLAY_NAME_LENGTH = 2;
export const MAX_DISPLAY_NAME_LENGTH = 50;
export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 30;

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

  if (sanitized.length < MIN_DISPLAY_NAME_LENGTH) {
    return {
      isValid: false,
      sanitized,
      error: `Display name must be at least ${MIN_DISPLAY_NAME_LENGTH} characters long.`,
    };
  }

  if (sanitized.length > MAX_DISPLAY_NAME_LENGTH) {
    return {
      isValid: false,
      sanitized,
      error: `Display name cannot exceed ${MAX_DISPLAY_NAME_LENGTH} characters.`,
    };
  }

  return {
    isValid: true,
    sanitized,
  };
}

export function sanitizeUsername(username: string | null | undefined): string {
  if (!username) return "";
  return username
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9_.-]/g, "");
}

export interface UsernameValidationResult {
  isValid: boolean;
  sanitized: string;
  error?: string;
}

export function validateUsername(username: string | null | undefined): UsernameValidationResult {
  const sanitized = sanitizeUsername(username);

  if (!sanitized || sanitized.length === 0) {
    return {
      isValid: false,
      sanitized: "",
      error: "Username cannot be empty.",
    };
  }

  if (sanitized.length < MIN_USERNAME_LENGTH) {
    return {
      isValid: false,
      sanitized,
      error: `Username must be at least ${MIN_USERNAME_LENGTH} characters long.`,
    };
  }

  if (sanitized.length > MAX_USERNAME_LENGTH) {
    return {
      isValid: false,
      sanitized,
      error: `Username cannot exceed ${MAX_USERNAME_LENGTH} characters.`,
    };
  }

  if (!/^[a-z0-9][a-z0-9_.-]*[a-z0-9]$|^[a-z0-9]$/.test(sanitized)) {
    return {
      isValid: false,
      sanitized,
      error: "Username must start and end with an alphanumeric character.",
    };
  }

  return {
    isValid: true,
    sanitized,
  };
}

// =========================================================================
// TEST PILOT FLIGHT CALLSIGN (#6172)
// =========================================================================

export const MAX_CALLSIGN_LENGTH = 20;

/**
 * Sanitizes an aviation callsign by trimming whitespace and stripping non-printable characters.
 */
export function sanitizeCallsign(callsign: string | null | undefined): string {
  if (!callsign) return "";
  return callsign
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, "");
}

export interface CallsignValidationResult {
  isValid: boolean;
  sanitized: string;
  error?: string;
}

/**
 * Validates an optional aviation callsign.
 * Accepts alphanumeric characters and hyphens, up to 20 characters.
 */
export function validateCallsign(callsign: string | null | undefined): CallsignValidationResult {
  const sanitized = sanitizeCallsign(callsign);

  if (!sanitized) {
    return {
      isValid: true,
      sanitized: "",
    };
  }

  if (sanitized.length > MAX_CALLSIGN_LENGTH) {
    return {
      isValid: false,
      sanitized,
      error: `Callsign cannot exceed ${MAX_CALLSIGN_LENGTH} characters.`,
    };
  }

  if (!/^[a-zA-Z0-9-]+$/.test(sanitized)) {
    return {
      isValid: false,
      sanitized,
      error: "Callsign can only contain alphanumeric characters and hyphens.",
    };
  }

  return {
    isValid: true,
    sanitized,
  };
}

/**
 * Preview-formats a user's display name with their optional aviation callsign
 * rendered in quotes between their first and last name (e.g. Hal "Highball" Jordan).
 * If display name has only one word, renders as: First "Callsign"
 * If display name is empty, renders as: "Callsign"
 */
export function formatDisplayNameWithCallsign(
  displayName: string | null | undefined,
  callsign?: string | null | undefined,
): string {
  const trimmedName = displayName ? displayName.trim().replace(/\s+/g, " ") : "";
  const sanitizedCallsign = sanitizeCallsign(callsign);

  if (!sanitizedCallsign) {
    return trimmedName;
  }

  if (!trimmedName) {
    return `"${sanitizedCallsign}"`;
  }

  const spaceIndex = trimmedName.indexOf(" ");
  if (spaceIndex === -1) {
    return `${trimmedName} "${sanitizedCallsign}"`;
  }

  const firstName = trimmedName.slice(0, spaceIndex);
  const rest = trimmedName.slice(spaceIndex + 1);
  return `${firstName} "${sanitizedCallsign}" ${rest}`;
}

