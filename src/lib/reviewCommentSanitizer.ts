/**
 * Cleans a user-written review comment for display. Markdown and HTML syntax
 * is removed while the readable text is kept, so a stray code fence, link or
 * tag can never disturb a card that is (or later becomes) rendered as
 * markdown. Ordinary punctuation, apostrophes and line breaks are untouched.
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

/** Drops control characters but keeps tabs and line breaks. */
const stripControlCharacters = (value: string): string =>
  Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 9 || code === 10 || (code >= 32 && code !== 127);
    })
    .join("");

export function sanitizeReviewComment(
  comment: string | null | undefined,
): string {
  if (!comment) return "";

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
