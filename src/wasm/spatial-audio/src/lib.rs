//! spatial-audio — WebAssembly SIMD DSP kernels for WorkSphere spatial audio.
//!
//! Fixes #7490: `v128`-based SIMD kernels crashed on ARM64 mobile browsers
//! with `RuntimeError: memory access out of bounds or unaligned SIMD load`
//! because the JavaScript AudioWorklet wrapper handed them linear-memory
//! byte offsets that were not 16-byte aligned.
//!
//! Strategy (per issue #7490):
//!
//! 1. Rust data structures crossing the WASM boundary use
//!    `#[repr(align(16))]`, so a 4-lane `f32x4` frame can never straddle a
//!    16-byte SIMD line.
//! 2. The exported kernel *verifies* 16-byte alignment of every pointer
//!    before entering the SIMD loop.
//! 3. Unaligned pointers fall back to scalar math instead of trapping, so
//!    audio keeps flowing even when alignment cannot be guaranteed.
//!
//! Exports use the plain C ABI (`#[no_mangle] extern "C"`), matching the
//! repo's emscripten-style C modules (`src/wasm/audio/spatial_masking.c`);
//! the JavaScript wrapper in `src/lib/audio/SpatialAudioWorkletProcessor.ts`
//! passes byte offsets into the shared linear memory.

#![allow(clippy::missing_safety_doc)]

/// Byte width of a `v128` SIMD register. `v128.load` traps on ARM64 unless
/// the operand is aligned to this boundary (#7490).
pub const SIMD_ALIGNMENT_BYTES: u32 = 16;

/// Kernel ran the aligned SIMD path.
pub const SPATIAL_DSP_OK: u32 = 0;
/// Kernel ran the scalar fallback (at least one pointer was unaligned).
pub const SPATIAL_DSP_FALLBACK_SCALAR: u32 = 1;
/// Kernel rejected invalid arguments without touching memory.
pub const SPATIAL_DSP_ERR_INVALID: u32 = 2;

/// A 4-lane audio frame aligned to the SIMD vector width.
///
/// `#[repr(C, align(16))]` guarantees that any pointer to this type is
/// 16-byte aligned, which is exactly what `v128.load` requires on ARM64.
#[derive(Clone, Copy)]
#[repr(C, align(16))]
pub struct AlignedFrame16 {
    pub lanes: [f32; 4],
}

impl AlignedFrame16 {
    #[inline]
    pub fn splat(coeff: f32) -> Self {
        Self { lanes: [coeff; 4] }
    }
}

/// True when `byte_offset` is safe for `v128.load`.
#[inline]
pub fn is_aligned_16(byte_offset: u32) -> bool {
    byte_offset % SIMD_ALIGNMENT_BYTES == 0
}

/// Round `byte_offset` up to the next 16-byte SIMD boundary.
#[inline]
pub fn align_offset_16(byte_offset: u32) -> u32 {
    (byte_offset + SIMD_ALIGNMENT_BYTES - 1) & !(SIMD_ALIGNMENT_BYTES - 1)
}

/// Constant-power panning. `-1.0` is hard left, `0.0` is centre, `+1.0` is
/// hard right; the two gains always keep unity power in L²+R².
fn constant_power_gains(pan: f32) -> (f32, f32) {
    let clamped = pan.clamp(-1.0, 1.0);
    let angle = (clamped + 1.0) * 0.5 * core::f32::consts::FRAC_PI_2;
    (angle.cos(), angle.sin())
}

/// Scalar fallback kernel: bit-compatible with the SIMD path, just slower.
///
/// # Safety
/// All three pointers must be valid for `num_samples` `f32` elements.
pub unsafe fn pan_scalar(
    in_ptr: *const f32,
    out_l_ptr: *mut f32,
    out_r_ptr: *mut f32,
    num_samples: usize,
    gain_l: f32,
    gain_r: f32,
) {
    for i in 0..num_samples {
        let sample = *in_ptr.add(i);
        *out_l_ptr.add(i) = sample * gain_l;
        *out_r_ptr.add(i) = sample * gain_r;
    }
}

/// SIMD pan kernel used when every pointer is 16-byte aligned (#7490).
///
/// Reads and writes go through [`AlignedFrame16`], so every `v128.load` /
/// `v128.store` the compiler emits is alignment-guaranteed. A sample tail
/// that does not fill a whole frame is handled scalar, which is alignment
/// agnostic.
///
/// # Safety
/// All three pointers must be 16-byte aligned and valid for `num_samples`
/// `f32` elements.
#[cfg(target_arch = "wasm32")]
pub unsafe fn pan_simd(
    in_ptr: *const AlignedFrame16,
    out_l_ptr: *mut AlignedFrame16,
    out_r_ptr: *mut AlignedFrame16,
    num_samples: usize,
    gain_l: f32,
    gain_r: f32,
) {
    use core::arch::wasm32::{f32x4_mul, f32x4_splat, v128};

    let whole_frames = num_samples / 4;
    let tail = num_samples - whole_frames * 4;

    let lanes_l = f32x4_splat(gain_l);
    let lanes_r = f32x4_splat(gain_r);

    for frame in 0..whole_frames {
        // Reading/writing through `*AlignedFrame16` keeps the 16-byte
        // contract; both transmutes below are 16 bytes for 16 bytes.
        let src: v128 = core::mem::transmute(*in_ptr.add(frame));
        *out_l_ptr.add(frame) = core::mem::transmute(f32x4_mul(src, lanes_l));
        *out_r_ptr.add(frame) = core::mem::transmute(f32x4_mul(src, lanes_r));
    }

    if tail > 0 {
        let base = whole_frames * 4;
        pan_scalar(
            (in_ptr as *const f32).add(base),
            (out_l_ptr as *mut f32).add(base),
            (out_r_ptr as *mut f32).add(base),
            tail,
            gain_l,
            gain_r,
        );
    }
}

/// Native fallback so the crate builds (and `cargo test` runs) on host
/// targets; the wasm SIMD intrinsics only exist on `wasm32`.
#[cfg(not(target_arch = "wasm32"))]
pub unsafe fn pan_simd(
    in_ptr: *const AlignedFrame16,
    out_l_ptr: *mut AlignedFrame16,
    out_r_ptr: *mut AlignedFrame16,
    num_samples: usize,
    gain_l: f32,
    gain_r: f32,
) {
    pan_scalar(
        in_ptr as *const f32,
        out_l_ptr as *mut f32,
        out_r_ptr as *mut f32,
        num_samples,
        gain_l,
        gain_r,
    );
}

/// Spatial DSP kernel dispatch shared by the C export and the unit tests.
///
/// Returns [`SPATIAL_DSP_OK`] when the aligned SIMD path ran, or
/// [`SPATIAL_DSP_FALLBACK_SCALAR`] when alignment could not be guaranteed
/// and the scalar fallback processed the block. It never traps on
/// alignment (#7490).
///
/// # Safety
/// All three pointers must be byte offsets into the WASM linear memory
/// that are valid for `num_samples` `f32` elements.
pub unsafe fn spatial_dsp_process_impl(
    in_ptr: usize,
    out_l_ptr: usize,
    out_r_ptr: usize,
    num_samples: usize,
    pan: f32,
    gain: f32,
) -> u32 {
    if num_samples == 0 || in_ptr == 0 || out_l_ptr == 0 || out_r_ptr == 0 {
        return SPATIAL_DSP_ERR_INVALID;
    }

    let (pan_l, pan_r) = constant_power_gains(pan);
    let gain_l = gain * pan_l;
    let gain_r = gain * pan_r;

    // Only enter the SIMD loop when *every* pointer satisfies v128
    // alignment; otherwise degrade instead of trapping on ARM64. Alignment
    // only depends on the low address bits, so the `u32` narrowing below is
    // safe on every target.
    if is_aligned_16(in_ptr as u32)
        && is_aligned_16(out_l_ptr as u32)
        && is_aligned_16(out_r_ptr as u32)
    {
        pan_simd(
            in_ptr as *const AlignedFrame16,
            out_l_ptr as *mut AlignedFrame16,
            out_r_ptr as *mut AlignedFrame16,
            num_samples,
            gain_l,
            gain_r,
        );
        SPATIAL_DSP_OK
    } else {
        pan_scalar(
            in_ptr as *const f32,
            out_l_ptr as *mut f32,
            out_r_ptr as *mut f32,
            num_samples,
            gain_l,
            gain_r,
        );
        SPATIAL_DSP_FALLBACK_SCALAR
    }
}

/// Spatial-audio pan kernel. See [`spatial_dsp_process_impl`].
///
/// `in_ptr` / `out_l_ptr` / `out_r_ptr` are byte offsets into the WASM
/// linear memory, allocated by the JavaScript wrapper with
/// `SIMD_ALIGNMENT_BYTES`-padded offsets (#7490).
#[no_mangle]
pub unsafe extern "C" fn spatial_dsp_process(
    in_ptr: u32,
    out_l_ptr: u32,
    out_r_ptr: u32,
    num_samples: u32,
    pan: f32,
    gain: f32,
) -> u32 {
    spatial_dsp_process_impl(
        in_ptr as usize,
        out_l_ptr as usize,
        out_r_ptr as usize,
        num_samples as usize,
        pan,
        gain,
    )
}

/// Alignment contract of this kernel, so the JavaScript allocator can
/// assert it pads to the same boundary the Rust side enforces.
#[no_mangle]
pub extern "C" fn spatial_dsp_alignment_bytes() -> u32 {
    SIMD_ALIGNMENT_BYTES
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 16-byte-aligned scratch buffer for exercising the kernels on any
    /// host target (`#[repr(align(16))]` in test code mirrors the struct the
    /// SIMD path reads through).
    #[repr(align(16))]
    struct AlignedBuffer([f32; 512]);

    impl AlignedBuffer {
        fn ptr(&self) -> usize {
            self.0.as_ptr() as usize
        }
        fn mut_ptr(&mut self) -> usize {
            self.0.as_mut_ptr() as usize
        }
    }

    #[test]
    fn alignment_helpers_round_up_to_the_simd_boundary() {
        assert!(is_aligned_16(0));
        assert!(is_aligned_16(16));
        assert!(is_aligned_16(4096));
        assert!(!is_aligned_16(1));
        assert!(!is_aligned_16(15));
        assert!(!is_aligned_16(17));

        assert_eq!(align_offset_16(0), 0);
        assert_eq!(align_offset_16(1), 16);
        assert_eq!(align_offset_16(15), 16);
        assert_eq!(align_offset_16(16), 16);
        assert_eq!(align_offset_16(17), 32);
    }

    #[test]
    fn aligned_frame_is_exactly_one_simd_register_wide() {
        assert_eq!(
            core::mem::size_of::<AlignedFrame16>(),
            SIMD_ALIGNMENT_BYTES as usize
        );
        assert_eq!(
            core::mem::align_of::<AlignedFrame16>(),
            SIMD_ALIGNMENT_BYTES as usize
        );
    }

    #[test]
    fn constant_power_gains_hit_endpoints_and_center() {
        let (left, right) = constant_power_gains(-1.0);
        assert!((left - 1.0).abs() < 1e-6 && right.abs() < 1e-6);

        let (left, right) = constant_power_gains(1.0);
        assert!(left.abs() < 1e-6 && (right - 1.0).abs() < 1e-6);

        let (left, right) = constant_power_gains(0.0);
        assert!((left - core::f32::consts::FRAC_1_SQRT_2).abs() < 1e-6);
        assert!((right - core::f32::consts::FRAC_1_SQRT_2).abs() < 1e-6);

        // Out-of-range pans are clamped, never explode.
        let (left, _) = constant_power_gains(-9.0);
        assert!((left - 1.0).abs() < 1e-6);
    }

    #[test]
    fn simd_and_scalar_paths_agree_on_aligned_input() {
        let mut input = AlignedBuffer([0.0; 512]);
        let mut out_l = AlignedBuffer([0.0; 512]);
        let mut out_r = AlignedBuffer([0.0; 512]);
        let mut out_l_scalar = AlignedBuffer([0.0; 512]);
        let mut out_r_scalar = AlignedBuffer([0.0; 512]);

        for (i, slot) in input.0.iter_mut().enumerate() {
            *slot = (i as f32) * 0.25 - 8.0;
        }

        let num_samples = 130; // 32 whole frames + a 2-sample tail
        let in_ptr = input.ptr();
        let status = unsafe {
            spatial_dsp_process_impl(
                in_ptr,
                out_l.mut_ptr(),
                out_r.mut_ptr(),
                num_samples,
                0.25,
                0.8,
            )
        };
        assert_eq!(status, SPATIAL_DSP_OK); // aligned → SIMD path

        // Same block, deliberately unaligned (+4 byte) out pointers.
        let status = unsafe {
            spatial_dsp_process_impl(
                in_ptr,
                out_l_scalar.mut_ptr() + 4,
                out_r_scalar.mut_ptr() + 4,
                num_samples,
                0.25,
                0.8,
            )
        };
        assert_eq!(status, SPATIAL_DSP_FALLBACK_SCALAR);

        // Both paths produce identical audio, tail included.
        assert_eq!(&out_l.0[..num_samples], &out_l_scalar.0[..num_samples]);
        assert_eq!(&out_r.0[..num_samples], &out_r_scalar.0[..num_samples]);
    }

    #[test]
    fn rejects_null_pointers_and_empty_blocks() {
        let mut input = AlignedBuffer([0.0; 512]);
        let mut out_l = AlignedBuffer([0.0; 512]);
        let mut out_r = AlignedBuffer([0.0; 512]);
        let in_ptr = input.ptr();

        unsafe {
            assert_eq!(
                spatial_dsp_process_impl(0, out_l.mut_ptr(), out_r.mut_ptr(), 8, 0.0, 1.0),
                SPATIAL_DSP_ERR_INVALID
            );
            assert_eq!(
                spatial_dsp_process_impl(in_ptr, 0, out_r.mut_ptr(), 8, 0.0, 1.0),
                SPATIAL_DSP_ERR_INVALID
            );
            assert_eq!(
                spatial_dsp_process_impl(in_ptr, out_l.mut_ptr(), out_r.mut_ptr(), 0, 0.0, 1.0),
                SPATIAL_DSP_ERR_INVALID
            );
        }
    }

    #[test]
    fn c_abi_reports_the_alignment_contract() {
        assert_eq!(spatial_dsp_alignment_bytes(), SIMD_ALIGNMENT_BYTES);
    }

    /// The C export takes `u32` offsets, which only make sense on the
    /// wasm32 target (usize == u32 there); native hosts exercise
    /// `spatial_dsp_process_impl` directly instead.
    #[cfg(target_arch = "wasm32")]
    #[test]
    fn c_abi_export_dispatches_on_wasm32() {
        let mut input = AlignedBuffer([0.5; 512]);
        let mut out_l = AlignedBuffer([0.0; 512]);
        let mut out_r = AlignedBuffer([0.0; 512]);
        let status = unsafe {
            spatial_dsp_process(
                input.ptr() as u32,
                out_l.mut_ptr() as u32,
                out_r.mut_ptr() as u32,
                128,
                0.0,
                2.0,
            )
        };
        assert_eq!(status, SPATIAL_DSP_OK);
        assert!((out_l.0[0] - 0.5 * core::f32::consts::FRAC_1_SQRT_2 * 2.0).abs() < 1e-6);
    }
}
