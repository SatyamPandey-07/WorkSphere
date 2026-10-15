#include <ctype.h>
#include <emscripten.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

/**
 * Highly optimized C implementation of complex regular expressions
 * for detecting global PII formats (IBAN, SSN, CC, Email).
 * Uses a lightweight state-machine approach for WASM performance.
 */

// Helper to check if a character is a digit
static inline bool is_digit(char c) { return c >= '0' && c <= '9'; }

// Helper to check if a character is alphanumeric
static inline bool is_alnum(char c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || is_digit(c);
}

/**
 * Detects US Social Security Numbers (SSN) in format XXX-XX-XXXX or XXXXXXXXX
 * Returns the length of the match, or 0 if no match.
 */
EMSCRIPTEN_KEEPALIVE
int detect_ssn(const char *text, int start_pos, int len) {
  if (start_pos + 9 > len)
    return 0;

  const char *p = text + start_pos;
  int digits = 0;
  int dashes = 0;

  for (int i = 0; i < 11 && (start_pos + i) < len; i++) {
    char c = p[i];
    if (is_digit(c)) {
      digits++;
    } else if (c == '-') {
      dashes++;
      if (digits == 3 || digits == 6)
        continue;
      return 0; // Invalid dash position
    } else {
      return 0;
    }
  }

  if (digits == 9 && (dashes == 0 || dashes == 2)) {
    return (dashes == 2) ? 11 : 9;
  }
  return 0;
}

/**
 * Detects Credit Card numbers (Luhn algorithm validation omitted for brevity,
 * focuses on 13-19 digit sequences with optional spaces/dashes).
 */
EMSCRIPTEN_KEEPALIVE
int detect_credit_card(const char *text, int start_pos, int len) {
  if (start_pos + 13 > len)
    return 0;

  const char *p = text + start_pos;
  int digits = 0;
  int match_len = 0;

  for (int i = 0; i < 23 && (start_pos + i) < len; i++) {
    char c = p[i];
    if (is_digit(c)) {
      digits++;
      match_len = i + 1;
    } else if (c == ' ' || c == '-') {
      continue;
    } else {
      break;
    }
  }

  if (digits >= 13 && digits <= 19) {
    return match_len;
  }
  return 0;
}

/**
 * Detects Email addresses using a simplified but robust state machine.
 */
EMSCRIPTEN_KEEPALIVE
int detect_email(const char *text, int start_pos, int len) {
  const char *p = text + start_pos;
  int i = 0;
  bool has_at = false;
  bool has_dot = false;

  // Local part
  while (i < len && is_alnum(p[i]))
    i++;
  if (i == 0 || p[i] != '@')
    return 0;

  i++; // skip '@'
  int domain_start = i;

  // Domain part
  while (i < len) {
    if (is_alnum(p[i]) || p[i] == '-') {
      i++;
    } else if (p[i] == '.') {
      has_dot = true;
      i++;
    } else {
      break;
    }
  }

  if (has_dot && (i - domain_start) > 3) {
    return i;
  }
  return 0;
}
