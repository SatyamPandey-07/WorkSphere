/**
 * Receipt Parser (WASM)
 * C implementation of a specialized layout analysis algorithm to isolate tabular data, 
 * totals, and tax lines from noisy thermal receipt images.
 */

#include <emscripten.h>
#include <stdint.h>
#include <stdlib.h>
#include <math.h>

#define MAX_COMPONENTS 2048
#define THRESHOLD 128

typedef struct {
    int x, y, w, h;
    int type; // 0: text, 1: line, 2: total
} Component;

Component components[MAX_COMPONENTS];
int componentCount = 0;

// Simple Otsu's method for adaptive thresholding
EMSCRIPTEN_KEEPALIVE
int calculate_otsu_threshold(uint8_t* imageData, int width, int height) {
    int histogram[256] = {0};
    int totalPixels = width * height;

    for (int i = 0; i < totalPixels; i++) {
        histogram[imageData[i]]++;
    }

    float sum = 0;
    for (int i = 0; i < 256; i++) {
        sum += i * histogram[i];
    }

    float sumB = 0;
    int wB = 0;
    float maxVariance = 0;
    int threshold = 128;

    for (int t = 0; t < 256; t++) {
        wB += histogram[t];
        if (wB == 0) continue;

        int wF = totalPixels - wB;
        if (wF == 0) break;

        sumB += (float)(t * histogram[t]);

        float mB = sumB / wB;
        float mF = (sum - sumB) / wF;

        float variance = (float)wB * (float)wF * (mB - mF) * (mB - mF);

        if (variance > maxVariance) {
            maxVariance = variance;
            threshold = t;
        }
    }

    return threshold;
}

// Binarize image using the calculated threshold
EMSCRIPTEN_KEEPALIVE
void binarize_image(uint8_t* imageData, int width, int height, int threshold) {
    int totalPixels = width * height;
    for (int i = 0; i < totalPixels; i++) {
        imageData[i] = (imageData[i] < threshold) ? 0 : 255;
    }
}

// Simplified Connected Component Labeling (CCL) for horizontal text lines
EMSCRIPTEN_KEEPALIVE
int find_text_lines(uint8_t* imageData, int width, int height) {
    componentCount = 0;
    
    // Scan rows to find horizontal bands of black pixels (text lines)
    int inLine = 0;
    int lineStart = 0;

    for (int y = 0; y < height; y++) {
        int blackCount = 0;
        for (int x = 0; x < width; x++) {
            if (imageData[y * width + x] == 0) {
                blackCount++;
            }
        }

        // If > 5% of the row is black, it's likely part of a text line
        if (blackCount > (width * 0.05)) {
            if (!inLine) {
                inLine = 1;
                lineStart = y;
            }
        } else {
            if (inLine) {
                inLine = 0;
                if (componentCount < MAX_COMPONENTS) {
                    components[componentCount].x = 0;
                    components[componentCount].y = lineStart;
                    components[componentCount].w = width;
                    components[componentCount].h = y - lineStart;
                    components[componentCount].type = 0; // Text line
                    componentCount++;
                }
            }
        }
    }

    return componentCount;
}

// Get component data
EMSCRIPTEN_KEEPALIVE
int get_component_y(int index) {
    if (index < 0 || index >= componentCount) return -1;
    return components[index].y;
}

EMSCRIPTEN_KEEPALIVE
int get_component_h(int index) {
    if (index < 0 || index >= componentCount) return -1;
    return components[index].h;
}

// Detect total/tax lines based on position (usually bottom 20% of receipt)
EMSCRIPTEN_KEEPALIVE
void classify_totals(int imageHeight) {
    int bottomZone = imageHeight * 0.8;
    for (int i = 0; i < componentCount; i++) {
        if (components[i].y > bottomZone) {
            components[i].type = 2; // Total/Tax zone
        }
    }
}
