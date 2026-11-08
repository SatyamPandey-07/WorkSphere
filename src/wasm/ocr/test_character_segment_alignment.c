/**
 * test_character_segment_alignment.c
 * C test harness checking arbitrary and odd pointer alignments for 64-bit integer
 * memory loads in character_segment Wasm routines (#5608).
 */

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Forward declare character_segment functions & structures */
typedef struct {
  int x_min;
  int y_min;
  int x_max;
  int y_max;
} BoundingBox;

typedef struct {
  BoundingBox *boxes;
  int count;
  int capacity;
} SegmentationResult;

void segment_characters(const uint8_t *binary_image, int width, int height,
                        SegmentationResult *result);
void free_segmentation(SegmentationResult *result);

int main(void) {
  printf("Starting Wasm unaligned 64-bit read test harness...\n");

  /* Test 1: Verify odd pointer byte offsets (1, 3, 5, 7 bytes) */
  uint8_t buffer[64];
  memset(buffer, 0xFF, sizeof(buffer)); // all white

  for (int offset = 0; offset < 8; offset++) {
    uint8_t *ptr = buffer + offset;
    /* Draw a 3x3 black character block */
    /* width = 9, height = 3 -> total 27 bytes */
    int width = 9;
    int height = 3;

    memset(ptr, 0xFF, width * height);

    /* Draw 3x3 box at (1, 0) */
    for (int y = 0; y < 3; y++) {
      for (int x = 1; x <= 3; x++) {
        ptr[y * width + x] = 0; // black pixel
      }
    }

    SegmentationResult res;
    segment_characters(ptr, width, height, &res);

    /* Should find 1 component without bus error or unaligned crash */
    assert(res.count == 1);
    assert(res.boxes[0].x_min == 1);
    assert(res.boxes[0].x_max == 3);
    assert(res.boxes[0].y_min == 0);
    assert(res.boxes[0].y_max == 2);

    free_segmentation(&res);
  }

  printf("All unaligned pointer alignment tests passed successfully!\n");
  return 0;
}
