#include <emscripten.h>
#include <stdlib.h>
#include <string.h>

// Mocking Brotli encoder state and dictionary initialization
// In production, this would link against the actual brotli C library

#define MAX_BUFFER_SIZE (1024 * 1024 * 5) // 5MB max payload

typedef struct {
  unsigned char *input_buffer;
  unsigned char *output_buffer;
  size_t input_size;
  size_t output_size;
  int quality; // 0-11
  int is_initialized;
} BrotliState;

BrotliState state;

EMSCRIPTEN_KEEPALIVE
void init_brotli(int quality) {
  if (state.input_buffer)
    free(state.input_buffer);
  if (state.output_buffer)
    free(state.output_buffer);

  state.input_buffer = (unsigned char *)malloc(MAX_BUFFER_SIZE);
  state.output_buffer = (unsigned char *)malloc(MAX_BUFFER_SIZE);
  state.quality = quality;
  state.is_initialized = 1;
  state.input_size = 0;
  state.output_size = 0;
}

EMSCRIPTEN_KEEPALIVE
int load_data(unsigned char *data, size_t size) {
  if (!state.is_initialized || size > MAX_BUFFER_SIZE)
    return -1;

  memcpy(state.input_buffer, data, size);
  state.input_size = size;
  return 0;
}

EMSCRIPTEN_KEEPALIVE
size_t compress_data() {
  if (!state.is_initialized || state.input_size == 0)
    return 0;

  // Mock compression logic: Run-Length Encoding (RLE) for demonstration
  // Real implementation would call BrotliEncoderCompress()

  size_t out_idx = 0;
  size_t i = 0;

  while (i < state.input_size && out_idx < MAX_BUFFER_SIZE - 2) {
    unsigned char current = state.input_buffer[i];
    size_t count = 1;

    while (i + count < state.input_size &&
           state.input_buffer[i + count] == current && count < 255) {
      count++;
    }

    if (count > 3) {
      state.output_buffer[out_idx++] = 0xFF; // Escape byte
      state.output_buffer[out_idx++] = (unsigned char)count;
      state.output_buffer[out_idx++] = current;
      i += count;
    } else {
      if (current == 0xFF) {
        state.output_buffer[out_idx++] = 0xFF;
        state.output_buffer[out_idx++] = 1;
        state.output_buffer[out_idx++] = 0xFF;
      } else {
        state.output_buffer[out_idx++] = current;
      }
      i++;
    }
  }

  state.output_size = out_idx;
  return state.output_size;
}

EMSCRIPTEN_KEEPALIVE
unsigned char *get_output_buffer() { return state.output_buffer; }

EMSCRIPTEN_KEEPALIVE
void cleanup_brotli() {
  if (state.input_buffer)
    free(state.input_buffer);
  if (state.output_buffer)
    free(state.output_buffer);
  state.input_buffer = NULL;
  state.output_buffer = NULL;
  state.is_initialized = 0;
}
