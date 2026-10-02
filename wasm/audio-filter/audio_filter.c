/**
 * WebAssembly SIMD multi-channel audio filter pipeline (#1998).
 *
 * Runs a cascade of up to MAX_STAGES biquad filters (Transposed Direct
 * Form II) over up to MAX_CHANNELS planar audio channels, followed by an
 * output gain stage.
 *
 * Biquads are recursive in time, so samples within a channel cannot be
 * vectorised. Instead the SIMD path processes FOUR CHANNELS PER v128:
 * each 4x4 block (4 channels x 4 frames) is transposed so every vector
 * holds one frame across 4 channels, filtered, and transposed back.
 *
 * Built freestanding with clang (no libc / Emscripten runtime):
 *   - SIMD build:   -msimd128  -> public/audio-filter-simd.wasm
 *   - scalar build: no SIMD    -> public/audio-filter-scalar.wasm
 * Filter coefficients are designed in TypeScript and passed in via
 * setStage(), keeping libm out of the module.
 */

#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif

#define MAX_CHANNELS 8
#define MAX_FRAMES 4096
#define MAX_STAGES 8
#define LANES 4

#define EXPORT(name) __attribute__((export_name(#name)))

/* Planar I/O buffer: channel c occupies [c * MAX_FRAMES, (c + 1) * MAX_FRAMES). */
_Alignas(16) static float io_buffer[MAX_CHANNELS * MAX_FRAMES];

/* Normalised biquad coefficients per stage (a0 == 1). */
static float coef_b0[MAX_STAGES];
static float coef_b1[MAX_STAGES];
static float coef_b2[MAX_STAGES];
static float coef_a1[MAX_STAGES];
static float coef_a2[MAX_STAGES];

/* TDF-II delay state, laid out so 4 consecutive channels form one v128. */
_Alignas(16) static float state_z1[MAX_STAGES][MAX_CHANNELS];
_Alignas(16) static float state_z2[MAX_STAGES][MAX_CHANNELS];

static int num_stages = 0;
static float output_gain = 1.0f;
static int simd_enabled = 1;

static void zero_floats(float* dst, int count) {
    for (int i = 0; i < count; i++) dst[i] = 0.0f;
}

/* Flush denormal-range state to zero so decaying filters stay fast. */
static void flush_denormals(int num_channels) {
    for (int s = 0; s < num_stages; s++) {
        for (int c = 0; c < num_channels; c++) {
            float z1 = state_z1[s][c];
            float z2 = state_z2[s][c];
            if (z1 > -1e-15f && z1 < 1e-15f) state_z1[s][c] = 0.0f;
            if (z2 > -1e-15f && z2 < 1e-15f) state_z2[s][c] = 0.0f;
        }
    }
}

/* ─── Scalar path ────────────────────────────────────────────────────────── */

static void process_channel_scalar(int channel, int num_frames) {
    float* samples = io_buffer + channel * MAX_FRAMES;
    for (int s = 0; s < num_stages; s++) {
        const float b0 = coef_b0[s], b1 = coef_b1[s], b2 = coef_b2[s];
        const float a1 = coef_a1[s], a2 = coef_a2[s];
        float z1 = state_z1[s][channel];
        float z2 = state_z2[s][channel];
        for (int t = 0; t < num_frames; t++) {
            const float x = samples[t];
            const float y = b0 * x + z1;
            z1 = b1 * x - a1 * y + z2;
            z2 = b2 * x - a2 * y;
            samples[t] = y;
        }
        state_z1[s][channel] = z1;
        state_z2[s][channel] = z2;
    }
}

static void apply_gain_scalar(int num_channels, int num_frames) {
    for (int c = 0; c < num_channels; c++) {
        float* samples = io_buffer + c * MAX_FRAMES;
        for (int t = 0; t < num_frames; t++) samples[t] *= output_gain;
    }
}

/* ─── SIMD path (4 channels per vector) ──────────────────────────────────── */

#ifdef __wasm_simd128__

/* Unused lanes of a partial group read from / write to this scratch row. */
_Alignas(16) static float scratch_channel[MAX_FRAMES];

static inline void transpose4(v128_t* r0, v128_t* r1, v128_t* r2, v128_t* r3) {
    const v128_t t0 = wasm_i32x4_shuffle(*r0, *r1, 0, 4, 1, 5);
    const v128_t t1 = wasm_i32x4_shuffle(*r0, *r1, 2, 6, 3, 7);
    const v128_t t2 = wasm_i32x4_shuffle(*r2, *r3, 0, 4, 1, 5);
    const v128_t t3 = wasm_i32x4_shuffle(*r2, *r3, 2, 6, 3, 7);
    *r0 = wasm_i32x4_shuffle(t0, t2, 0, 1, 4, 5);
    *r1 = wasm_i32x4_shuffle(t0, t2, 2, 3, 6, 7);
    *r2 = wasm_i32x4_shuffle(t1, t3, 0, 1, 4, 5);
    *r3 = wasm_i32x4_shuffle(t1, t3, 2, 3, 6, 7);
}

/* Run every stage on one frame vector (one sample from each of 4 channels). */
static inline v128_t biquad_cascade_frame(v128_t x, v128_t* z1, v128_t* z2) {
    for (int s = 0; s < num_stages; s++) {
        const v128_t y = wasm_f32x4_add(wasm_f32x4_mul(wasm_f32x4_splat(coef_b0[s]), x), z1[s]);
        z1[s] = wasm_f32x4_add(
            wasm_f32x4_sub(wasm_f32x4_mul(wasm_f32x4_splat(coef_b1[s]), x),
                           wasm_f32x4_mul(wasm_f32x4_splat(coef_a1[s]), y)),
            z2[s]);
        z2[s] = wasm_f32x4_sub(wasm_f32x4_mul(wasm_f32x4_splat(coef_b2[s]), x),
                               wasm_f32x4_mul(wasm_f32x4_splat(coef_a2[s]), y));
        x = y;
    }
    return x;
}

static void process_group_simd(int first_channel, int num_channels, int num_frames) {
    float* rows[LANES];
    for (int lane = 0; lane < LANES; lane++) {
        const int c = first_channel + lane;
        rows[lane] = c < num_channels ? io_buffer + c * MAX_FRAMES : scratch_channel;
    }
    if (first_channel + LANES > num_channels) zero_floats(scratch_channel, num_frames);

    v128_t z1[MAX_STAGES];
    v128_t z2[MAX_STAGES];
    for (int s = 0; s < num_stages; s++) {
        z1[s] = wasm_v128_load(&state_z1[s][first_channel]);
        z2[s] = wasm_v128_load(&state_z2[s][first_channel]);
    }

    int t = 0;
    const int block_end = num_frames & ~3;
    for (; t < block_end; t += 4) {
        v128_t f0 = wasm_v128_load(rows[0] + t);
        v128_t f1 = wasm_v128_load(rows[1] + t);
        v128_t f2 = wasm_v128_load(rows[2] + t);
        v128_t f3 = wasm_v128_load(rows[3] + t);
        transpose4(&f0, &f1, &f2, &f3);   /* rows -> frames */
        f0 = biquad_cascade_frame(f0, z1, z2);
        f1 = biquad_cascade_frame(f1, z1, z2);
        f2 = biquad_cascade_frame(f2, z1, z2);
        f3 = biquad_cascade_frame(f3, z1, z2);
        transpose4(&f0, &f1, &f2, &f3);   /* frames -> rows */
        wasm_v128_store(rows[0] + t, f0);
        wasm_v128_store(rows[1] + t, f1);
        wasm_v128_store(rows[2] + t, f2);
        wasm_v128_store(rows[3] + t, f3);
    }

    /* Tail frames (num_frames % 4): gather / scatter one frame at a time. */
    for (; t < num_frames; t++) {
        v128_t x = wasm_f32x4_make(rows[0][t], rows[1][t], rows[2][t], rows[3][t]);
        x = biquad_cascade_frame(x, z1, z2);
        rows[0][t] = wasm_f32x4_extract_lane(x, 0);
        rows[1][t] = wasm_f32x4_extract_lane(x, 1);
        rows[2][t] = wasm_f32x4_extract_lane(x, 2);
        rows[3][t] = wasm_f32x4_extract_lane(x, 3);
    }

    for (int s = 0; s < num_stages; s++) {
        wasm_v128_store(&state_z1[s][first_channel], z1[s]);
        wasm_v128_store(&state_z2[s][first_channel], z2[s]);
    }
}

static void apply_gain_simd(int num_channels, int num_frames) {
    const v128_t gain = wasm_f32x4_splat(output_gain);
    for (int c = 0; c < num_channels; c++) {
        float* samples = io_buffer + c * MAX_FRAMES;
        int t = 0;
        const int vec_end = num_frames & ~3;
        for (; t < vec_end; t += 4) {
            wasm_v128_store(samples + t, wasm_f32x4_mul(wasm_v128_load(samples + t), gain));
        }
        for (; t < num_frames; t++) samples[t] *= output_gain;
    }
}

#endif /* __wasm_simd128__ */

/* ─── Exports ────────────────────────────────────────────────────────────── */

EXPORT(getBufferPtr) float* getBufferPtr(void) { return io_buffer; }
EXPORT(getMaxChannels) int getMaxChannels(void) { return MAX_CHANNELS; }
EXPORT(getMaxFrames) int getMaxFrames(void) { return MAX_FRAMES; }
EXPORT(getMaxStages) int getMaxStages(void) { return MAX_STAGES; }

EXPORT(isSIMDBuild) int isSIMDBuild(void) {
#ifdef __wasm_simd128__
    return 1;
#else
    return 0;
#endif
}

/* Lets tests and buggy devices force the scalar path inside a SIMD build. */
EXPORT(setSIMDEnabled) void setSIMDEnabled(int enabled) { simd_enabled = enabled ? 1 : 0; }

EXPORT(reset) void reset(void) {
    zero_floats(&state_z1[0][0], MAX_STAGES * MAX_CHANNELS);
    zero_floats(&state_z2[0][0], MAX_STAGES * MAX_CHANNELS);
}

/* Returns 0 on success, -1 if count is out of range. Resets filter state. */
EXPORT(setStageCount) int setStageCount(int count) {
    if (count < 0 || count > MAX_STAGES) return -1;
    num_stages = count;
    reset();
    return 0;
}

/* Coefficients must already be normalised by a0. Returns -1 on bad index. */
EXPORT(setStage) int setStage(int index, float b0, float b1, float b2, float a1, float a2) {
    if (index < 0 || index >= MAX_STAGES) return -1;
    coef_b0[index] = b0;
    coef_b1[index] = b1;
    coef_b2[index] = b2;
    coef_a1[index] = a1;
    coef_a2[index] = a2;
    return 0;
}

EXPORT(setOutputGain) void setOutputGain(float gain) { output_gain = gain; }

/**
 * Filter `num_frames` samples of `num_channels` planar channels in place
 * inside io_buffer. Returns 0 on success, -1 on invalid dimensions.
 */
EXPORT(process) int process(int num_channels, int num_frames) {
    if (num_channels < 1 || num_channels > MAX_CHANNELS) return -1;
    if (num_frames < 0 || num_frames > MAX_FRAMES) return -1;

#ifdef __wasm_simd128__
    if (simd_enabled) {
        if (num_stages > 0) {
            for (int c = 0; c < num_channels; c += LANES) {
                process_group_simd(c, num_channels, num_frames);
            }
        }
        if (output_gain != 1.0f) apply_gain_simd(num_channels, num_frames);
        flush_denormals(num_channels);
        return 0;
    }
#endif

    for (int c = 0; c < num_channels; c++) process_channel_scalar(c, num_frames);
    if (output_gain != 1.0f) apply_gain_scalar(num_channels, num_frames);
    flush_denormals(num_channels);
    return 0;
}
