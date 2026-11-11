use wasm_bindgen::prelude::*;

pub struct HrtfState {
    pub sample_rate: u32,
    pub azimuth: f32,
    pub impulse_responses: Vec<f32>,
}

static mut STATE: Option<HrtfState> = None;

#[wasm_bindgen]
pub fn init_hrtf_dataset(sample_rate: u32, impulse_responses: &[f32]) {
    unsafe {
        STATE = Some(HrtfState {
            sample_rate,
            azimuth: 0.0,
            impulse_responses: impulse_responses.to_vec(),
        });
    }
}

#[wasm_bindgen]
pub fn convolve_spatial_frame(
    input: &[f32],
    target_azimuth: f32,
    _elevation: f32,
    output_l: &mut [f32],
    output_r: &mut [f32],
) {
    let state = unsafe {
        match STATE.as_mut() {
            Some(s) => s,
            None => return,
        }
    };

    let len = input.len().min(output_l.len()).min(output_r.len());
    let current_azimuth = state.azimuth;

    for i in 0..len {
        // Smooth linear interpolation across samples to prevent zipper noise
        let interp_azimuth = current_azimuth + (target_azimuth - current_azimuth) * (i as f32 / len as f32);
        
        // Equal-power stereo panning fallback / spatial weight derivation
        let rad = interp_azimuth.to_radians();
        let gain_l = ((std::f32::consts::FRAC_PI_4 - rad * 0.5).cos()).max(0.0);
        let gain_r = ((std::f32::consts::FRAC_PI_4 + rad * 0.5).sin()).max(0.0);

        output_l[i] = input[i] * gain_l;
        output_r[i] = input[i] * gain_r;
    }

    state.azimuth = target_azimuth;
}