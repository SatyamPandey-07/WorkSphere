/**
 * beamformer.c
 * C implementation of the delay-and-sum beamforming algorithm to isolate the direction of the primary speaker.
 * Processes multi-channel audio input to estimate the Angle of Arrival (AoA) of human speech.
 */

#include <stdint.h>
#include <math.h>
#include <string.h>

#define MAX_CHANNELS 4
#define SAMPLE_RATE 16000
#define FRAME_SIZE 512
#define SPEED_OF_SOUND 343.0f // m/s
#define MIC_SPACING 0.05f     // 5 cm

// Calculate time delay in samples for a given angle
int calculate_delay(float angle_radians, int mic_index) {
    float distance = mic_index * MIC_SPACING * sinf(angle_radians);
    float time_delay = distance / SPEED_OF_SOUND;
    return (int)roundf(time_delay * SAMPLE_RATE);
}

// Delay-and-sum beamforming
void apply_beamforming(
    const float* input_channels[MAX_CHANNELS],
    float* output_frame,
    int num_channels,
    float target_angle_radians
) {
    if (!output_frame) return;
    memset(output_frame, 0, FRAME_SIZE * sizeof(float));

    for (int ch = 0; ch < num_channels; ch++) {
        int delay = calculate_delay(target_angle_radians, ch);
        
        for (int i = 0; i < FRAME_SIZE; i++) {
            int src_idx = i - delay;
            if (src_idx >= 0 && src_idx < FRAME_SIZE) {
                output_frame[i] += input_channels[ch][src_idx];
            }
        }
    }

    // Normalize by number of channels
    for (int i = 0; i < FRAME_SIZE; i++) {
        output_frame[i] /= (float)num_channels;
    }
}

// Estimate dominant angle of arrival based on cross-correlation (simplified)
float estimate_aoa(const float* ch1, const float* ch2) {
    float max_corr = -1.0f;
    float best_angle = 0.0f;

    // Scan angles from -90 to +90 degrees
    for (int angle_deg = -90; angle_deg <= 90; angle_deg += 5) {
        float angle_rad = angle_deg * (3.14159265f / 180.0f);
        int delay = calculate_delay(angle_rad, 1);
        
        float corr = 0.0f;
        int valid_samples = 0;

        for (int i = 0; i < FRAME_SIZE; i++) {
            int src_idx = i - delay;
            if (src_idx >= 0 && src_idx < FRAME_SIZE) {
                corr += ch1[i] * ch2[src_idx];
                valid_samples++;
            }
        }

        if (valid_samples > 0) {
            corr /= valid_samples;
            if (corr > max_corr) {
                max_corr = corr;
                best_angle = angle_rad;
            }
        }
    }

    return best_angle;
}