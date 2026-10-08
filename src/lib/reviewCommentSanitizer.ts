/**
 * Venue Review Comment Sanitization & Moderation Engine.
 *
 * Provides dual capabilities:
 * 1. Safe display sanitization (`sanitizeReviewComment`): Strips markdown syntax,
 *    dangerous tags, and control characters for rendering inside venue cards.
 * 2. Moderation and ingestion pipeline (`filterAllowedHtml`, `stripScriptAndEventHandlers`,
 *    `maskProfanity`, `validateReviewComment`, and `sanitizeReviewComment(..., { allowFormatting: true })`):
 *    Enforces character length limits, safe HTML tag allowlisting (<b>, <i>, <a>),
 *    script & inline event handler stripping, and automated profanity masking
 *    for user-submitted venue reviews and coworking feedback.
 */

const FENCE_LINE = /^[ \t]*(?:`{3,}|~{3,})[^\n]*(?:\n|$)/gm;
const IMAGE = /!\[([^\]\n]*)\]\([^)\n]*\)/g;
const LINK = /\[([^\]\n]*)\]\([^)\n]*\)/g;
const HTML_TAG = /<\/?[a-z][^>\n]*>/gi;
const HEADING = /^[ \t]{0,3}#{1,6}[ \t]+/gm;
const BLOCKQUOTE = /^[ \t]{0,3}>+[ \t]?/gm;
const EMPHASIS_RUNS = /\*{2,}|_{2,}|~{2,}/g;
const BACKTICKS = /`+/g;
const TRAILING_SPACES = /[ \t]+$/gm;
const BLANK_LINES = /\n{3,}/g;

/** Control character regex matching /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g */
export const CONTROL_CHARACTERS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** Drops non-printable ASCII control characters while keeping tabs (\t) and line breaks (\n). */
export const stripControlCharacters = (value: string): string => {
  if (!value) return "";
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
};

export const MIN_COMMENT_LENGTH = 3;
export const MAX_COMMENT_LENGTH = 1000;

export const ALLOWED_HTML_TAGS = ["b", "i", "a"] as const;
export type AllowedHtmlTag = (typeof ALLOWED_HTML_TAGS)[number];

export const DEFAULT_PROFANITY_WORDS = [
  "abuse",
  "asshole",
  "bastard",
  "bitch",
  "bullshit",
  "crap",
  "cunt",
  "damn",
  "dick",
  "douche",
  "fuck",
  "motherfucker",
  "nigger",
  "piss",
  "prick",
  "pussy",
  "shit",
  "slut",
  "twat",
  "wanker",
  "whore",
] as const;

/**
 * Escapes characters for safe regular expression inclusion.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strips script tags, style tags, frames, and dangerous inline event handlers
 * (e.g. onload, onerror, onclick, onmouseover).
 */
export function stripScriptAndEventHandlers(input: string): string {
  if (!input) return "";

  let cleaned = input;

  // 1. Strip script tags and their inner content
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

  // 2. Strip style, iframe, object, embed, form, and applet blocks
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
  cleaned = cleaned.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "");
  cleaned = cleaned.replace(/<embed\b[^>]*>/gi, "");
  cleaned = cleaned.replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, "");

  // 3. Strip all inline DOM event handlers (on\w+="..." or on\w+='...')
  cleaned = cleaned.replace(/\son[a-z]+\s*=\s*(['"][^'"]*['"]|[^\s>]+)/gi, "");

  // 4. Strip dangerous URI schemes like javascript:, vbscript:, data:
  cleaned = cleaned.replace(/(href|src)\s*=\s*(['"])\s*(javascript|vbscript|data):[^'"]*\2/gi, "");
  cleaned = cleaned.replace(/(href|src)\s*=\s*(javascript|vbscript|data):[^\s>]*/gi, "");

  return cleaned;
}

/**
 * Sanitizes an anchor (<a>) tag, ensuring only http/https URLs are permitted,
 * and automatically enforcing rel="noopener noreferrer" and target="_blank".
 */
function sanitizeAnchorTag(fullTag: string, attributes: string): string {
  const hrefMatch = attributes.match(/href\s*=\s*(['"])(.*?)\1/i) || attributes.match(/href\s*=\s*([^\s>]+)/i);
  if (!hrefMatch) {
    return ""; // Strip links without valid href
  }

  const rawUrl = (hrefMatch[2] || hrefMatch[1] || "").trim();

  // Validate protocol: allow only http, https, and mailto
  if (!/^(https?:\/\/|mailto:)/i.test(rawUrl)) {
    return ""; // Drop malicious or relative javascript/file links
  }

  // Sanitize raw URL quotes
  const safeUrl = rawUrl.replace(/"/g, "&quot;");

  return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">`;
}

/**
 * Filters HTML tags to an allowlist consisting strictly of <b>, <i>, and <a>.
 * All other HTML tags (<p>, <div>, <span>, <img>, etc.) are stripped while preserving text.
 */
export function filterAllowedHtml(input: string): string {
  if (!input) return "";

  // First, strip executable scripts and event handlers
  const scriptFree = stripScriptAndEventHandlers(input);

  // Regex matching HTML tags: <(/?)(\w+)([^>]*)>
  return scriptFree.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (match, tagName: string, attrs: string) => {
    const lowerTag = tagName.toLowerCase();

    if (lowerTag === "b") {
      return match.startsWith("</") ? "</b>" : "<b>";
    }

    if (lowerTag === "i") {
      return match.startsWith("</") ? "</i>" : "<i>";
    }

    if (lowerTag === "a") {
      if (match.startsWith("</")) {
        return "</a>";
      }
      return sanitizeAnchorTag(match, attrs);
    }

    // Disallow all other tags: drop the tag, keep outer text
    return "";
  });
}

/**
 * Replaces recognized profanity words with asterisk masks (*).
 * Uses whole-word boundary matching to avoid false positives (e.g., "scunthorpe" or "classic").
 */
export function maskProfanity(
  text: string,
  profanityList: readonly string[] = DEFAULT_PROFANITY_WORDS,
): { maskedText: string; flaggedWords: string[] } {
  if (!text) return { maskedText: "", flaggedWords: [] };

  let maskedText = text;
  const flaggedWords: string[] = [];

  for (const word of profanityList) {
    const escaped = escapeRegex(word);
    const regex = new RegExp(`\\b${escaped}\\b`, "gi");

    if (regex.test(maskedText)) {
      flaggedWords.push(word);
      maskedText = maskedText.replace(regex, "*".repeat(word.length));
    }
  }

  return {
    maskedText,
    flaggedWords: Array.from(new Set(flaggedWords)),
  };
}

/**
 * Removes non-printable control characters, null bytes, and normalizes excess whitespace.
 */
export function cleanControlCharacters(text: string): string {
  if (!text) return "";
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[ \t]+/g, " ");
}

export interface ReviewCommentValidationResult {
  isValid: boolean;
  sanitized: string;
  errors: string[];
  flaggedWords: string[];
}

export interface SanitizeReviewCommentOptions {
  allowFormatting?: boolean;
}

/**
 * Cleans a user-written review comment.
 *
 * When `allowFormatting` is false (default):
 * Removes Markdown and HTML syntax while keeping readable text,
 * suitable for plain text card displays.
 *
 * When `allowFormatting` is true:
 * Runs the security moderation pipeline preserving allowlisted tags (<b>, <i>, <a>),
 * stripping dangerous tags & event handlers, and masking profanity.
 */
export function sanitizeReviewComment(
  comment: string | null | undefined,
  options?: SanitizeReviewCommentOptions,
): string {
  if (!comment) return "";

  if (options?.allowFormatting) {
    let output = cleanControlCharacters(String(comment).trim());
    output = filterAllowedHtml(output);
    const { maskedText } = maskProfanity(output);
    output = maskedText;

    if (output.length > MAX_COMMENT_LENGTH) {
      output = output.slice(0, MAX_COMMENT_LENGTH);
    }
    return output;
  }

  let text = String(comment).replace(/\r\n?/g, "\n");
  text = stripControlCharacters(text);

  text = text
    .replace(FENCE_LINE, "")
    .replace(IMAGE, "$1")
    .replace(LINK, "$1")
    .replace(HTML_TAG, "")
    .replace(HEADING, "")
    .replace(BLOCKQUOTE, "")
    .replace(EMPHASIS_RUNS, "")
    .replace(BACKTICKS, "")
    .replace(TRAILING_SPACES, "")
    .replace(BLANK_LINES, "\n\n");

  return text.trim();
}

/**
 * Validates a review comment, returning detailed validation status,
 * error messages, and detected flagged terms.
 */
export function validateReviewComment(
  comment: string | null | undefined,
): ReviewCommentValidationResult {
  const errors: string[] = [];

  if (!comment || typeof comment !== "string" || comment.trim().length === 0) {
    return {
      isValid: false,
      sanitized: "",
      errors: ["Review comment cannot be empty."],
      flaggedWords: [],
    };
  }

  const rawTrimmed = comment.trim();

  if (rawTrimmed.length < MIN_COMMENT_LENGTH) {
    errors.push(`Review comment must be at least ${MIN_COMMENT_LENGTH} characters.`);
  }

  if (rawTrimmed.length > MAX_COMMENT_LENGTH) {
    errors.push(`Review comment cannot exceed ${MAX_COMMENT_LENGTH} characters.`);
  }

  const sanitized = sanitizeReviewComment(rawTrimmed, { allowFormatting: true });
  const { flaggedWords } = maskProfanity(rawTrimmed);

  if (sanitized.length === 0 && rawTrimmed.length >= MIN_COMMENT_LENGTH) {
    errors.push("Review comment contained only disallowed markup or unprintable characters.");
  }

  return {
    isValid: errors.length === 0,
    sanitized,
    errors,
    flaggedWords,
  };
}
