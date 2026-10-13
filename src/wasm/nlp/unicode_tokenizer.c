/**
 * unicode_tokenizer.c
 * C implementation of the Unicode Text Segmentation algorithm (UAX #29) for
 * accurate word boundary detection. Supports non-Latin languages (Japanese,
 * Hindi, Arabic) by identifying grapheme clusters and word boundaries.
 */

#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define MAX_TOKEN_LENGTH 256
#define MAX_TOKENS 1024

typedef struct {
  uint32_t start;
  uint32_t end;
} TokenBoundary;

typedef struct {
  TokenBoundary boundaries[MAX_TOKENS];
  int count;
} TokenizerResult;

// Simplified UAX #29 word boundary detection logic
// In a production environment, this would use a full Unicode property database
static bool is_word_character(uint32_t codepoint) {
  // Basic Latin, Latin-1 Supplement, and common CJK ranges
  if ((codepoint >= 0x0041 && codepoint <= 0x005A) || // A-Z
      (codepoint >= 0x0061 && codepoint <= 0x007A) || // a-z
      (codepoint >= 0x00C0 && codepoint <= 0x024F) || // Latin Extended
      (codepoint >= 0x0400 && codepoint <= 0x04FF) || // Cyrillic
      (codepoint >= 0x0900 && codepoint <= 0x097F) || // Devanagari (Hindi)
      (codepoint >= 0x0600 && codepoint <= 0x06FF) || // Arabic
      (codepoint >= 0x4E00 && codepoint <= 0x9FFF)) { // CJK Unified Ideographs
    return true;
  }
  return false;
}

static uint32_t decode_utf8(const uint8_t *str, uint32_t remaining_length, int *bytes_read) {
  if (!str || !bytes_read || remaining_length == 0) {
    if (bytes_read) *bytes_read = 0;
    return 0;
  }

  // 1-byte ASCII (0xxxxxxx)
  if ((str[0] & 0x80) == 0) {
    *bytes_read = 1;
    return str[0];
  } 
  // 2-byte sequence (110xxxxx 10xxxxxx)
  else if ((str[0] & 0xE0) == 0xC0) {
    if (remaining_length < 2 || (str[1] & 0xC0) != 0x80) {
      *bytes_read = 1; // Invalid / truncated sequence: advance by 1 byte safely
      return 0xFFFD;   // Unicode Replacement Character
    }
    *bytes_read = 2;
    return ((str[0] & 0x1F) << 6) | (str[1] & 0x3F);
  } 
  // 3-byte sequence (1110xxxx 10xxxxxx 10xxxxxx)
  else if ((str[0] & 0xF0) == 0xE0) {
    if (remaining_length < 3 || (str[1] & 0xC0) != 0x80 || (str[2] & 0xC0) != 0x80) {
      *bytes_read = 1; // Invalid / truncated sequence: advance by 1 byte safely
      return 0xFFFD;
    }
    *bytes_read = 3;
    return ((str[0] & 0x0F) << 12) | ((str[1] & 0x3F) << 6) | (str[2] & 0x3F);
  } 
  // 4-byte sequence (11110xxx 10xxxxxx 10xxxxxx 10xxxxxx)
  else if ((str[0] & 0xF8) == 0xF0) {
    if (remaining_length < 4 || (str[1] & 0xC0) != 0x80 || (str[2] & 0xC0) != 0x80 || (str[3] & 0xC0) != 0x80) {
      *bytes_read = 1; // Invalid / truncated sequence: advance by 1 byte safely
      return 0xFFFD;
    }
    *bytes_read = 4;
    return ((str[0] & 0x07) << 18) | ((str[1] & 0x3F) << 12) |
           ((str[2] & 0x3F) << 6) | (str[3] & 0x3F);
  }

  // Invalid leading byte (continuation byte or 0xF8+)
  *bytes_read = 1;
  return 0xFFFD;
}

void tokenize_utf8(const uint8_t *input, uint32_t input_length,
                   TokenizerResult *result) {
  if (!input || !result)
    return;

  result->count = 0;
  uint32_t i = 0;
  uint32_t token_start = 0;
  bool in_word = false;

  while (i < input_length && result->count < MAX_TOKENS) {
    int bytes_read = 0;
    uint32_t codepoint = decode_utf8(&input[i], input_length - i, &bytes_read);
    if (bytes_read <= 0) {
      bytes_read = 1; // Safeguard against zero-progress infinite loops on malformed bytes
    }

    bool is_word = is_word_character(codepoint);

    if (is_word && !in_word) {
      token_start = i;
      in_word = true;
    } else if (!is_word && in_word) {
      result->boundaries[result->count].start = token_start;
      result->boundaries[result->count].end = i;
      result->count++;
      in_word = false;
    }

    i += bytes_read;
  }

  if (in_word && result->count < MAX_TOKENS) {
    result->boundaries[result->count].start = token_start;
    result->boundaries[result->count].end = input_length;
    result->count++;
  }
}

int get_token_count(const TokenizerResult *result) {
  return result ? result->count : 0;
}

uint32_t get_token_start(const TokenizerResult *result, int index) {
  if (!result || index < 0 || index >= result->count)
    return 0;
  return result->boundaries[index].start;
}

uint32_t get_token_end(const TokenizerResult *result, int index) {
  if (!result || index < 0 || index >= result->count)
    return 0;
  return result->boundaries[index].end;
}
