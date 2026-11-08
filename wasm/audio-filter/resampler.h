#ifndef RESAMPLER_H
#define RESAMPLER_H

#include <stddef.h>

#define NUM_PHASES 32
#define NUM_TAPS 16
#define MAX_CHANNELS 8
#define MAX_INPUT_FRAMES 4096
#define MAX_OUTPUT_FRAMES 8192

#define EXPORT(name) __attribute__((export_name(#name)))

typedef struct {
    float in_rate;
    float out_rate;
    double ratio;               /* in_rate / out_rate */
    double phase_acc;           /* Current fractional input index */
    float history[MAX_CHANNELS][NUM_TAPS];
    int history_len;
    int channels;
} ResamplerState;

#ifdef __cplusplus
extern "C" {
#endif

EXPORT(resampler_init)
int resampler_init(float in_rate, float out_rate, int channels);

EXPORT(resampler_reset)
void resampler_reset(void);

EXPORT(resampler_set_rates)
void resampler_set_rates(float in_rate, float out_rate);

EXPORT(resampler_process)
int resampler_process(const float* in_buf, int in_frames, float* out_buf, int max_out_frames);

EXPORT(resampler_get_input_buffer)
float* resampler_get_input_buffer(void);

EXPORT(resampler_get_output_buffer)
float* resampler_get_output_buffer(void);

EXPORT(resampler_get_coeffs_table)
const float* resampler_get_coeffs_table(void);

#ifdef __cplusplus
}
#endif

#endif /* RESAMPLER_H */
