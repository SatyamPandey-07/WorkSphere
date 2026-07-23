use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct HvacSensor {
    pub x: u32,
    pub y: u32,
    pub temperature: f32,
}

#[wasm_bindgen]
pub fn calculate_heat_diffusion(
    input: &mut [f32],
    output: &mut [f32],
    width: u32,
    height: u32,
    alpha: f32,
    dt: f32,
    ambient: f32,
    sensors_flat: &[f32], // [x, y, temp, x, y, temp, ...]
) {
    let w = width as usize;
    let h = height as usize;

    for y in 0..h {
        for x in 0..w {
            let idx = y * w + x;
            
            let xl = if x == 0 { x } else { x - 1 };
            let xr = if x + 1 >= w { x } else { x + 1 };
            let yd = if y == 0 { y } else { y - 1 };
            let yu = if y + 1 >= h { y } else { y + 1 };

            let c = input[idx];
            let lap = input[y * w + xl]
                + input[y * w + xr]
                + input[yd * w + x]
                + input[yu * w + x]
                - 4.0 * c;

            let mut next = c + alpha * dt * lap;
            next = next + (ambient - next) * 0.002;
            output[idx] = next;
        }
    }

    // Apply sensors
    let mut i = 0;
    while i + 2 < sensors_flat.len() {
        let sx = sensors_flat[i] as usize;
        let sy = sensors_flat[i + 1] as usize;
        let temp = sensors_flat[i + 2];
        
        if sx < w && sy < h {
            output[sy * w + sx] = temp;
        }
        
        i += 3;
    }
}
