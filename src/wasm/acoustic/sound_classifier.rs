//! sound_classifier — on-device acoustic feature extractor for WorkSphere (#7277).
//!
//! Computes, for one 1024-sample mono buffer:
//!   * 13 mel-frequency cepstral coefficients (26-band mel filterbank, DCT-II)
//!   * spectral centroid (Hz)
//!   * RMS level (dBFS), spectral flatness, and the share of energy in the
//!     300-3400 Hz speech band
//!   * a coarse rule-based label: silence / chatter / grinder / other
//!
//! Privacy: the module is `std`-only with **no imports**. It cannot open sockets,
//! read files or call back into JavaScript; audio samples live only in this
//! module's linear memory and are overwritten by the next frame.
//!
//! Speed: the radix-2 FFT butterflies, windowing-free power spectrum, mel
//! filterbank, DCT, and the centroid/RMS reductions use `core::arch::wasm32`
//! 128-bit SIMD (`f32x4`) when built with `+simd128`; otherwise the identical
//! scalar kernels are used (the loader ships both binaries).
//!
//! The label is a transparent heuristic over those features, not a trained
//! model; its thresholds are the `LABEL_*` constants below.
//!
//! Exports (C ABI, byte offsets into the exported `memory`):
//!   sc_init(sample_rate) -> status      sc_input_ptr() / sc_output_ptr()
//!   sc_process() -> label | error       sc_frame_len() / sc_output_len() / sc_simd_enabled()

#![allow(clippy::missing_safety_doc)]

pub const FRAME_LEN: usize = 1024;
const BINS: usize = FRAME_LEN / 2 + 1; // 513
const BINS_PAD: usize = 516; // multiple of 4 so SIMD never needs a remainder loop
const N_MELS: usize = 26;
const MELS_PAD: usize = 28;
pub const N_MFCC: usize = 13;

/// Output layout: [0..13) MFCC, then these indices.
pub const OUT_CENTROID_HZ: usize = 13;
pub const OUT_RMS_DBFS: usize = 14;
pub const OUT_FLATNESS: usize = 15;
pub const OUT_SPEECH_RATIO: usize = 16;
pub const OUT_LABEL: usize = 17;
pub const OUTPUT_LEN: usize = 18;

pub const LABEL_SILENCE: u32 = 0;
pub const LABEL_CHATTER: u32 = 1;
pub const LABEL_GRINDER: u32 = 2;
pub const LABEL_OTHER: u32 = 3;

pub const STATUS_OK: u32 = 0;
pub const ERR_BAD_SAMPLE_RATE: u32 = 253;
pub const ERR_NON_FINITE: u32 = 254;
pub const ERR_NOT_INITIALISED: u32 = 255;

// Heuristic label thresholds.
const LABEL_SILENCE_DBFS: f32 = -55.0;
const LABEL_GRINDER_MIN_CENTROID_HZ: f32 = 2500.0;
const LABEL_GRINDER_MIN_FLATNESS: f32 = 0.30;
const LABEL_CHATTER_MIN_SPEECH_RATIO: f32 = 0.60;
const LABEL_CHATTER_MAX_FLATNESS: f32 = 0.30;
const SPEECH_LO_HZ: f32 = 300.0;
const SPEECH_HI_HZ: f32 = 3400.0;
const EPS: f32 = 1e-12;

/* ------------------------------------------------------------------ */
/* Kernels: SIMD when compiled with +simd128, scalar otherwise          */
/* ------------------------------------------------------------------ */

#[cfg(target_feature = "simd128")]
mod kernels {
    use core::arch::wasm32::*;

    #[inline(always)]
    unsafe fn hsum(v: v128) -> f32 {
        f32x4_extract_lane::<0>(v)
            + f32x4_extract_lane::<1>(v)
            + f32x4_extract_lane::<2>(v)
            + f32x4_extract_lane::<3>(v)
    }

    /// Radix-2 butterflies for `h` consecutive pairs starting at `a` (partner at `a + h`).
    #[inline(always)]
    pub unsafe fn butterflies(re: *mut f32, im: *mut f32, wr: *const f32, wi: *const f32, a: usize, h: usize) {
        if h >= 4 {
            let mut j = 0;
            while j < h {
                let (pa, pb) = (a + j, a + j + h);
                let ar = v128_load(re.add(pa) as *const v128);
                let ai = v128_load(im.add(pa) as *const v128);
                let br = v128_load(re.add(pb) as *const v128);
                let bi = v128_load(im.add(pb) as *const v128);
                let cr = v128_load(wr.add(j) as *const v128);
                let ci = v128_load(wi.add(j) as *const v128);
                let tr = f32x4_sub(f32x4_mul(cr, br), f32x4_mul(ci, bi));
                let ti = f32x4_add(f32x4_mul(cr, bi), f32x4_mul(ci, br));
                v128_store(re.add(pa) as *mut v128, f32x4_add(ar, tr));
                v128_store(im.add(pa) as *mut v128, f32x4_add(ai, ti));
                v128_store(re.add(pb) as *mut v128, f32x4_sub(ar, tr));
                v128_store(im.add(pb) as *mut v128, f32x4_sub(ai, ti));
                j += 4;
            }
        } else {
            super::scalar_butterflies(re, im, wr, wi, a, h);
        }
    }

    /// out[i] = re[i]^2 + im[i]^2 for i in 0..n (n % 4 == 0).
    #[inline(always)]
    pub unsafe fn power(out: *mut f32, re: *const f32, im: *const f32, n: usize) {
        let mut i = 0;
        while i < n {
            let r = v128_load(re.add(i) as *const v128);
            let m = v128_load(im.add(i) as *const v128);
            v128_store(out.add(i) as *mut v128, f32x4_add(f32x4_mul(r, r), f32x4_mul(m, m)));
            i += 4;
        }
    }

    /// Dot product of two length-n slices (n % 4 == 0).
    #[inline(always)]
    pub unsafe fn dot(a: *const f32, b: *const f32, n: usize) -> f32 {
        let mut acc = f32x4_splat(0.0);
        let mut i = 0;
        while i < n {
            let x = v128_load(a.add(i) as *const v128);
            let y = v128_load(b.add(i) as *const v128);
            acc = f32x4_add(acc, f32x4_mul(x, y));
            i += 4;
        }
        hsum(acc)
    }

    /// Sum of a length-n slice (n % 4 == 0).
    #[inline(always)]
    pub unsafe fn sum(a: *const f32, n: usize) -> f32 {
        let mut acc = f32x4_splat(0.0);
        let mut i = 0;
        while i < n {
            acc = f32x4_add(acc, v128_load(a.add(i) as *const v128));
            i += 4;
        }
        hsum(acc)
    }

    pub const SIMD: bool = true;
}

#[cfg(not(target_feature = "simd128"))]
mod kernels {
    #[inline(always)]
    pub unsafe fn butterflies(re: *mut f32, im: *mut f32, wr: *const f32, wi: *const f32, a: usize, h: usize) {
        super::scalar_butterflies(re, im, wr, wi, a, h);
    }

    #[inline(always)]
    pub unsafe fn power(out: *mut f32, re: *const f32, im: *const f32, n: usize) {
        for i in 0..n {
            *out.add(i) = *re.add(i) * *re.add(i) + *im.add(i) * *im.add(i);
        }
    }

    #[inline(always)]
    pub unsafe fn dot(a: *const f32, b: *const f32, n: usize) -> f32 {
        // Four partial sums mirror the SIMD lane order so both builds agree closely.
        let mut acc = [0.0f32; 4];
        let mut i = 0;
        while i < n {
            for l in 0..4 {
                acc[l] += *a.add(i + l) * *b.add(i + l);
            }
            i += 4;
        }
        (acc[0] + acc[1]) + (acc[2] + acc[3])
    }

    #[inline(always)]
    pub unsafe fn sum(a: *const f32, n: usize) -> f32 {
        let mut acc = [0.0f32; 4];
        let mut i = 0;
        while i < n {
            for l in 0..4 {
                acc[l] += *a.add(i + l);
            }
            i += 4;
        }
        (acc[0] + acc[1]) + (acc[2] + acc[3])
    }

    pub const SIMD: bool = false;
}

#[inline(always)]
unsafe fn scalar_butterflies(re: *mut f32, im: *mut f32, wr: *const f32, wi: *const f32, a: usize, h: usize) {
    for j in 0..h {
        let (pa, pb) = (a + j, a + j + h);
        let (br, bi) = (*re.add(pb), *im.add(pb));
        let (cr, ci) = (*wr.add(j), *wi.add(j));
        let tr = cr * br - ci * bi;
        let ti = cr * bi + ci * br;
        let (ar, ai) = (*re.add(pa), *im.add(pa));
        *re.add(pa) = ar + tr;
        *im.add(pa) = ai + ti;
        *re.add(pb) = ar - tr;
        *im.add(pb) = ai - ti;
    }
}

/* ------------------------------------------------------------------ */
/* Classifier state                                                    */
/* ------------------------------------------------------------------ */

#[repr(C, align(16))]
pub struct Classifier {
    input: [f32; FRAME_LEN],
    window: [f32; FRAME_LEN],
    re: [f32; FRAME_LEN],
    im: [f32; FRAME_LEN],
    /// Per-stage contiguous twiddles: stage with half-size `h` starts at `h - 1`.
    tw_re: [f32; FRAME_LEN],
    tw_im: [f32; FRAME_LEN],
    rev: [u16; FRAME_LEN],
    power: [f32; BINS_PAD],
    freqs: [f32; BINS_PAD],
    mel_fb: [[f32; BINS_PAD]; N_MELS],
    dct: [[f32; MELS_PAD]; N_MFCC],
    log_mel: [f32; MELS_PAD],
    output: [f32; OUTPUT_LEN],
    sample_rate: f32,
    speech_lo_bin: usize,
    speech_hi_bin: usize,
    ready: bool,
}

fn hz_to_mel(hz: f32) -> f32 {
    2595.0 * (1.0 + hz / 700.0).log10()
}

fn mel_to_hz(mel: f32) -> f32 {
    700.0 * (10f32.powf(mel / 2595.0) - 1.0)
}

impl Classifier {
    pub const fn zeroed() -> Self {
        Classifier {
            input: [0.0; FRAME_LEN],
            window: [0.0; FRAME_LEN],
            re: [0.0; FRAME_LEN],
            im: [0.0; FRAME_LEN],
            tw_re: [0.0; FRAME_LEN],
            tw_im: [0.0; FRAME_LEN],
            rev: [0; FRAME_LEN],
            power: [0.0; BINS_PAD],
            freqs: [0.0; BINS_PAD],
            mel_fb: [[0.0; BINS_PAD]; N_MELS],
            dct: [[0.0; MELS_PAD]; N_MFCC],
            log_mel: [0.0; MELS_PAD],
            output: [0.0; OUTPUT_LEN],
            sample_rate: 0.0,
            speech_lo_bin: 0,
            speech_hi_bin: 0,
            ready: false,
        }
    }

    /// Builds every lookup table for `sample_rate` (Hz). Call once per rate.
    pub fn init(&mut self, sample_rate: f32) -> u32 {
        if !(sample_rate.is_finite() && (4000.0..=192_000.0).contains(&sample_rate)) {
            return ERR_BAD_SAMPLE_RATE;
        }
        let tau = core::f32::consts::PI * 2.0;
        let n = FRAME_LEN;

        for i in 0..n {
            // Periodic Hann window.
            self.window[i] = 0.5 - 0.5 * (tau * i as f32 / n as f32).cos();
        }

        let bits = n.trailing_zeros();
        for i in 0..n {
            self.rev[i] = (i.reverse_bits() >> (usize::BITS - bits)) as u16;
        }

        let mut h = 1;
        while h < n {
            for j in 0..h {
                let ang = core::f32::consts::PI * j as f32 / h as f32;
                self.tw_re[h - 1 + j] = ang.cos();
                self.tw_im[h - 1 + j] = -ang.sin();
            }
            h *= 2;
        }

        let bin_hz = sample_rate / n as f32;
        for k in 0..BINS_PAD {
            self.freqs[k] = if k < BINS { k as f32 * bin_hz } else { 0.0 };
        }
        self.speech_lo_bin = (SPEECH_LO_HZ / bin_hz).ceil() as usize;
        self.speech_hi_bin = ((SPEECH_HI_HZ / bin_hz).floor() as usize).min(BINS - 1);

        // Triangular mel filters between 0 Hz and Nyquist, peak-normalised to 1.
        let mel_hi = hz_to_mel(sample_rate / 2.0);
        let mut points = [0.0f32; N_MELS + 2];
        for (i, p) in points.iter_mut().enumerate() {
            *p = mel_to_hz(mel_hi * i as f32 / (N_MELS + 1) as f32);
        }
        for m in 0..N_MELS {
            let (lo, mid, hi) = (points[m], points[m + 1], points[m + 2]);
            for k in 0..BINS {
                let f = self.freqs[k];
                self.mel_fb[m][k] = if f > lo && f <= mid {
                    (f - lo) / (mid - lo)
                } else if f > mid && f < hi {
                    (hi - f) / (hi - mid)
                } else {
                    0.0
                };
            }
        }

        // Orthonormal DCT-II over the log-mel energies.
        for c in 0..N_MFCC {
            let scale = if c == 0 {
                (1.0 / N_MELS as f32).sqrt()
            } else {
                (2.0 / N_MELS as f32).sqrt()
            };
            for m in 0..N_MELS {
                self.dct[c][m] =
                    scale * (core::f32::consts::PI * c as f32 * (m as f32 + 0.5) / N_MELS as f32).cos();
            }
        }

        self.sample_rate = sample_rate;
        self.ready = true;
        STATUS_OK
    }

    pub fn input_mut(&mut self) -> &mut [f32; FRAME_LEN] {
        &mut self.input
    }

    pub fn output(&self) -> &[f32; OUTPUT_LEN] {
        &self.output
    }

    /// Analyses the current contents of the input buffer. Returns a label code, or an error code >= 253.
    pub fn process(&mut self) -> u32 {
        if !self.ready {
            return ERR_NOT_INITIALISED;
        }
        unsafe {
            let n = FRAME_LEN;
            let sum_sq = kernels::dot(self.input.as_ptr(), self.input.as_ptr(), n);
            if !sum_sq.is_finite() {
                return ERR_NON_FINITE;
            }
            let rms = (sum_sq / n as f32).sqrt();
            let rms_dbfs = 20.0 * (rms + 1e-9).log10();

            // Window + bit-reversal permutation (real input => imaginary part is zero).
            for i in 0..n {
                let r = self.rev[i] as usize;
                self.re[r] = self.input[i] * self.window[i];
                self.im[r] = 0.0;
            }

            // Iterative radix-2 decimation-in-time FFT; SIMD butterflies for half-size >= 4.
            let (re, im) = (self.re.as_mut_ptr(), self.im.as_mut_ptr());
            let mut h = 1;
            while h < n {
                let (wr, wi) = (self.tw_re.as_ptr().add(h - 1), self.tw_im.as_ptr().add(h - 1));
                let mut base = 0;
                while base < n {
                    kernels::butterflies(re, im, wr, wi, base, h);
                    base += 2 * h;
                }
                h *= 2;
            }

            // Power spectrum for bins 0..=512 (bins 0..511 via SIMD, Nyquist scalar, padding zero).
            kernels::power(self.power.as_mut_ptr(), re, im, BINS - 1);
            self.power[BINS - 1] = self.re[BINS - 1] * self.re[BINS - 1] + self.im[BINS - 1] * self.im[BINS - 1];
            for k in BINS..BINS_PAD {
                self.power[k] = 0.0;
            }

            let total = kernels::sum(self.power.as_ptr(), BINS_PAD);
            let centroid = if total > EPS {
                kernels::dot(self.freqs.as_ptr(), self.power.as_ptr(), BINS_PAD) / total
            } else {
                0.0
            };

            // Spectral flatness: geometric mean / arithmetic mean of the power spectrum.
            let mut ln_sum = 0.0f32;
            for k in 1..BINS {
                ln_sum += (self.power[k] + EPS).ln();
            }
            let geo = (ln_sum / (BINS - 1) as f32).exp();
            let arith = (total / BINS as f32) + EPS;
            let flatness = (geo / arith).min(1.0);

            let mut speech = 0.0f32;
            for k in self.speech_lo_bin..=self.speech_hi_bin {
                speech += self.power[k];
            }
            let speech_ratio = if total > EPS { (speech / total).min(1.0) } else { 0.0 };

            // Mel energies -> log -> DCT-II.
            for m in 0..N_MELS {
                let e = kernels::dot(self.mel_fb[m].as_ptr(), self.power.as_ptr(), BINS_PAD);
                self.log_mel[m] = (e + 1e-10).ln();
            }
            for c in 0..N_MFCC {
                self.output[c] = kernels::dot(self.dct[c].as_ptr(), self.log_mel.as_ptr(), MELS_PAD);
            }

            let label = if rms_dbfs < LABEL_SILENCE_DBFS {
                LABEL_SILENCE
            } else if flatness >= LABEL_GRINDER_MIN_FLATNESS && centroid >= LABEL_GRINDER_MIN_CENTROID_HZ {
                LABEL_GRINDER
            } else if speech_ratio >= LABEL_CHATTER_MIN_SPEECH_RATIO && flatness < LABEL_CHATTER_MAX_FLATNESS {
                LABEL_CHATTER
            } else {
                LABEL_OTHER
            };

            self.output[OUT_CENTROID_HZ] = centroid;
            self.output[OUT_RMS_DBFS] = rms_dbfs;
            self.output[OUT_FLATNESS] = flatness;
            self.output[OUT_SPEECH_RATIO] = speech_ratio;
            self.output[OUT_LABEL] = label as f32;
            label
        }
    }
}

/* ------------------------------------------------------------------ */
/* C ABI for the JavaScript wrapper (src/core/audio/WasmSoundClassifier.ts) */
/* ------------------------------------------------------------------ */

static mut CLASSIFIER: Classifier = Classifier::zeroed();

#[inline(always)]
fn global() -> &'static mut Classifier {
    // Wasm modules are single-threaded here; the JS wrapper never re-enters.
    unsafe { &mut *core::ptr::addr_of_mut!(CLASSIFIER) }
}

#[no_mangle]
pub extern "C" fn sc_init(sample_rate: f32) -> u32 {
    global().init(sample_rate)
}

/// Byte offset of the 1024-float input buffer inside linear memory.
#[no_mangle]
pub extern "C" fn sc_input_ptr() -> u32 {
    global().input_mut().as_mut_ptr() as usize as u32
}

/// Byte offset of the `OUTPUT_LEN`-float result buffer.
#[no_mangle]
pub extern "C" fn sc_output_ptr() -> u32 {
    global().output().as_ptr() as usize as u32
}

#[no_mangle]
pub extern "C" fn sc_process() -> u32 {
    global().process()
}

#[no_mangle]
pub extern "C" fn sc_frame_len() -> u32 {
    FRAME_LEN as u32
}

#[no_mangle]
pub extern "C" fn sc_output_len() -> u32 {
    OUTPUT_LEN as u32
}

#[no_mangle]
pub extern "C" fn sc_simd_enabled() -> u32 {
    kernels::SIMD as u32
}

/* ------------------------------------------------------------------ */
/* Host-side unit tests (scalar path): `cargo test --release`           */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh(sr: f32) -> Box<Classifier> {
        let mut c = Box::new(Classifier::zeroed());
        assert_eq!(c.init(sr), STATUS_OK);
        c
    }

    fn fill_sine(c: &mut Classifier, sr: f32, hz: f32, amp: f32) {
        for (i, s) in c.input_mut().iter_mut().enumerate() {
            *s = amp * (core::f32::consts::PI * 2.0 * hz * i as f32 / sr).sin();
        }
    }

    #[test]
    fn fft_matches_naive_dft() {
        let mut c = fresh(16000.0);
        let mut seed = 12345u32;
        for s in c.input_mut().iter_mut() {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            *s = (seed >> 8) as f32 / 8388608.0 - 1.0;
        }
        let input = *c.input_mut();
        c.process();
        for &k in &[0usize, 1, 7, 100, 255, 511, 512] {
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (i, &x) in input.iter().enumerate() {
                let w = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / FRAME_LEN as f64).cos();
                let a = -std::f64::consts::TAU * (k * i % FRAME_LEN) as f64 / FRAME_LEN as f64;
                re += x as f64 * w * a.cos();
                im += x as f64 * w * a.sin();
            }
            let want = re * re + im * im;
            let got = c.power[k] as f64;
            assert!((got - want).abs() <= 1e-3 * want.max(1.0), "bin {k}: {got} vs {want}");
        }
    }

    #[test]
    fn sine_centroid_is_near_tone() {
        let mut c = fresh(16000.0);
        fill_sine(&mut c, 16000.0, 1000.0, 0.5);
        c.process();
        let centroid = c.output()[OUT_CENTROID_HZ];
        assert!((centroid - 1000.0).abs() < 30.0, "centroid {centroid}");
    }

    #[test]
    fn mfcc_are_finite_and_label_codes_valid() {
        let mut c = fresh(44100.0);
        fill_sine(&mut c, 44100.0, 440.0, 0.3);
        let label = c.process();
        assert!(label <= LABEL_OTHER);
        assert!(c.output()[..OUTPUT_LEN].iter().all(|v| v.is_finite()));
    }

    #[test]
    fn silence_and_bad_input_are_handled() {
        let mut c = fresh(16000.0);
        assert_eq!(c.process(), LABEL_SILENCE);
        c.input_mut()[3] = f32::NAN;
        assert_eq!(c.process(), ERR_NON_FINITE);
        let mut raw = Box::new(Classifier::zeroed());
        assert_eq!(raw.process(), ERR_NOT_INITIALISED);
        assert_eq!(raw.init(10.0), ERR_BAD_SAMPLE_RATE);
    }
}
