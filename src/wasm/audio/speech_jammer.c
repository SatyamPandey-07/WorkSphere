#include <stdlib.h>
#include <string.h>
#include <math.h>

/**
 * speech_jammer.c
 * C implementation of the Delayed Auditory Feedback (DAF) algorithm.
 * Disrupts speech production by playing back the user's voice with a precise delay,
 * forcing them to lower their voice naturally to maintain acoustic privacy.
 */

typedef struct {
    float* buffer;
    int buffer_size;
    int write_index;
    int delay_samples;
    float feedback_gain;
} DAF_Engine;

DAF_Engine* daf_create(int sample_rate, float delay_ms, float gain) {
    DAF_Engine* engine = (DAF_Engine*)malloc(sizeof(DAF_Engine));
    if (!engine) return NULL;

    int delay_samples = (int)((delay_ms / 1000.0f) * sample_rate);
    int buffer_size = delay_samples + 1024; 

    engine->buffer = (float*)calloc(buffer_size, sizeof(float));
    if (!engine->buffer) {
        free(engine);
        return NULL;
    }

    engine->buffer_size = buffer_size;
    engine->write_index = 0;
    engine->delay_samples = delay_samples;
    engine->feedback_gain = gain;

    return engine;
}

void daf_process(DAF_Engine* engine, float* input, float* output, int num_samples) {
    if (!engine || !input || !output) return;

    for (int i = 0; i < num_samples; i++) {
        engine->buffer[engine->write_index] = input[i];

        int read_index = engine->write_index - engine->delay_samples;
        if (read_index < 0) {
            read_index += engine->buffer_size;
        }

        float delayed_sample = engine->buffer[read_index];
        output[i] = input[i] + (delayed_sample * engine->feedback_gain);

        engine->write_index++;
        if (engine->write_index >= engine->buffer_size) {
            engine->write_index = 0;
        }
    }
}

void daf_destroy(DAF_Engine* engine) {
    if (engine) {
        if (engine->buffer) free(engine->buffer);
        free(engine);
    }
}

void daf_update_delay(DAF_Engine* engine, int sample_rate, float delay_ms) {
    if (!engine) return;
    engine->delay_samples = (int)((delay_ms / 1000.0f) * sample_rate);
    memset(engine->buffer, 0, engine->buffer_size * sizeof(float));
    engine->write_index = 0;
}
