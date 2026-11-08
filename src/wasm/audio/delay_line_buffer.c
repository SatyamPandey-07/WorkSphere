#include <stdlib.h>
#include <string.h>

/**
 * delay_line_buffer.c
 * High-fidelity circular ring buffer for audio DSP.
 * Prevents digital artifacts and ensures phase alignment during audio mixing.
 */

typedef struct {
  float *data;
  int capacity;
  int head;
  int tail;
  int count;
} RingBuffer;

RingBuffer *ring_buffer_create(int capacity) {
  RingBuffer *rb = (RingBuffer *)malloc(sizeof(RingBuffer));
  if (!rb)
    return NULL;

  rb->data = (float *)calloc(capacity, sizeof(float));
  if (!rb->data) {
    free(rb);
    return NULL;
  }

  rb->capacity = capacity;
  rb->head = 0;
  rb->tail = 0;
  rb->count = 0;

  return rb;
}

int ring_buffer_write(RingBuffer *rb, float sample) {
  if (!rb || rb->count == rb->capacity)
    return -1;

  rb->data[rb->head] = sample;
  rb->head = (rb->head + 1) % rb->capacity;
  rb->count++;
  return 0;
}

int ring_buffer_write_block(RingBuffer *rb, float *samples, int num_samples) {
  if (!rb || rb->count + num_samples > rb->capacity)
    return -1;

  for (int i = 0; i < num_samples; i++) {
    rb->data[rb->head] = samples[i];
    rb->head = (rb->head + 1) % rb->capacity;
  }
  rb->count += num_samples;
  return 0;
}

float ring_buffer_read(RingBuffer *rb) {
  if (!rb || rb->count == 0)
    return 0.0f;

  float sample = rb->data[rb->tail];
  rb->tail = (rb->tail + 1) % rb->capacity;
  rb->count--;
  return sample;
}

int ring_buffer_read_block(RingBuffer *rb, float *output, int num_samples) {
  if (!rb || rb->count < num_samples)
    return -1;

  for (int i = 0; i < num_samples; i++) {
    output[i] = rb->data[rb->tail];
    rb->tail = (rb->tail + 1) % rb->capacity;
  }
  rb->count -= num_samples;
  return 0;
}

void ring_buffer_clear(RingBuffer *rb) {
  if (!rb)
    return;
  memset(rb->data, 0, rb->capacity * sizeof(float));
  rb->head = 0;
  rb->tail = 0;
  rb->count = 0;
}

void ring_buffer_destroy(RingBuffer *rb) {
  if (rb) {
    if (rb->data)
      free(rb->data);
    free(rb);
  }
}
