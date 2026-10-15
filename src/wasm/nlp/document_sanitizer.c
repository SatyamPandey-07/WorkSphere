#include <emscripten.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

// External detection functions from pii_regex.c
extern int detect_ssn(const char *text, int start_pos, int len);
extern int detect_credit_card(const char *text, int start_pos, int len);
extern int detect_email(const char *text, int start_pos, int len);

/**
 * Manages the memory buffers and string replacement logic to redact
 * matched entities without corrupting document formatting.
 */

EMSCRIPTEN_KEEPALIVE
void *allocate_buffer(int size) { return malloc(size); }

EMSCRIPTEN_KEEPALIVE
void free_buffer(void *ptr) { free(ptr); }

/**
 * Scans the input buffer for PII and replaces matches with a redaction token.
 * Returns the new length of the string.
 *
 * @param input Pointer to the input string
 * @param len Length of the input string
 * @param output Pointer to the pre-allocated output buffer
 * @param token The redaction token to insert (e.g., "[REDACTED]")
 */
EMSCRIPTEN_KEEPALIVE
int sanitize_document(const char *input, int len, char *output,
                      const char *token) {
  int out_pos = 0;
  int token_len = strlen(token);

  for (int i = 0; i < len;) {
    int match_len = 0;

    // Check for SSN
    match_len = detect_ssn(input, i, len);
    if (match_len == 0)
      match_len = detect_credit_card(input, i, len);
    if (match_len == 0)
      match_len = detect_email(input, i, len);

    if (match_len > 0) {
      // PII Found, insert token
      memcpy(output + out_pos, token, token_len);
      out_pos += token_len;
      i += match_len; // Skip the matched PII
    } else {
      // No PII, copy character as-is
      output[out_pos++] = input[i++];
    }
  }

  output[out_pos] = '\0';
  return out_pos;
}
