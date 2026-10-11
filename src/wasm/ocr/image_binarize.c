/**
 * image_binarize.c
 * C implementation of Otsu's method for adaptive image thresholding and noise reduction.
 * Converts a grayscale image buffer into a strict 1-bit black-and-white representation.
 */

#include <stdint.h>
#include <stdlib.h>
#include <math.h>

void apply_otsu_threshold(const uint8_t* input, uint8_t* output, int width, int height) {
    if (!input || !output) return;

    int histogram[256] = {0};
    int total_pixels = width * height;

    // Build histogram
    for (int i = 0; i < total_pixels; i++) {
        histogram[input[i]]++;
    }

    float sum = 0;
    for (int i = 0; i < 256; i++) {
        sum += i * histogram[i];
    }

    float sumB = 0;
    int wB = 0;
    int wF = 0;
    float varMax = 0;
    int threshold = 0;

    for (int t = 0; t < 256; t++) {
        wB += histogram[t];
        if (wB == 0) continue;

        wF = total_pixels - wB;
        if (wF == 0) break;

        sumB += (float)(t * histogram[t]);

        float mB = sumB / wB;
        float mF = (sum - sumB) / wF;

        float varBetween = (float)wB * (float)wF * (mB - mF) * (mB - mF);

        if (varBetween > varMax) {
            varMax = varBetween;
            threshold = t;
        }
    }

    // Apply threshold
    for (int i = 0; i < total_pixels; i++) {
        output[i] = input[i] > threshold ? 255 : 0;
    }
}

void apply_median_filter(uint8_t* image, int width, int height) {
    if (!image) return;
    
    uint8_t* temp = (uint8_t*)malloc(width * height);
    if (!temp) return;

    for (int y = 1; y < height - 1; y++) {
        for (int x = 1; x < width - 1; x++) {
            int idx = 0;
            uint8_t neighbors[9];
            for (int ky = -1; ky <= 1; ky++) {
                for (int kx = -1; kx <= 1; kx++) {
                    neighbors[idx++] = image[(y + ky) * width + (x + kx)];
                }
            }
            // Simple bubble sort for 9 elements
            for (int i = 0; i < 8; i++) {
                for (int j = 0; j < 8 - i; j++) {
                    if (neighbors[j] > neighbors[j + 1]) {
                        uint8_t tmp = neighbors[j];
                        neighbors[j] = neighbors[j + 1];
                        neighbors[j + 1] = tmp;
                    }
                }
            }
            temp[y * width + x] = neighbors[4];
        }
    }

    for (int i = 0; i < width * height; i++) {
        image[i] = temp[i];
    }
    free(temp);
}
