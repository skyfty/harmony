use wasm_bindgen::prelude::*;

// Small example of a performance-critical function implemented in Rust.
// Replace or extend this with the actual hot path you want to optimize.

#[wasm_bindgen]
pub fn heavy_compute(n: u32) -> u64 {
    let mut s: u64 = 0;
    for i in 0..(n as u64) {
        s = s.wrapping_add(i.wrapping_mul(3).wrapping_add(7));
    }
    s
}

#[wasm_bindgen]
pub fn init_panic_hook() {
    // Enable better panic messages in console (useful during development)
    console_error_panic_hook::set_once();
}

use js_sys::Float64Array;

#[wasm_bindgen]
pub fn compute_bounding_sphere(data: &[f32]) -> Float64Array {
    let len = data.len();
    if len == 0 {
        return Float64Array::new_with_length(4);
    }

    let mut min_x = std::f32::INFINITY;
    let mut min_y = std::f32::INFINITY;
    let mut min_z = std::f32::INFINITY;
    let mut max_x = std::f32::NEG_INFINITY;
    let mut max_y = std::f32::NEG_INFINITY;
    let mut max_z = std::f32::NEG_INFINITY;

    let mut i = 0;
    while i + 2 < len {
        let x = data[i];
        let y = data[i + 1];
        let z = data[i + 2];
        if x < min_x { min_x = x }
        if y < min_y { min_y = y }
        if z < min_z { min_z = z }
        if x > max_x { max_x = x }
        if y > max_y { max_y = y }
        if z > max_z { max_z = z }
        i += 3;
    }

    let cx = (min_x + max_x) as f64 * 0.5;
    let cy = (min_y + max_y) as f64 * 0.5;
    let cz = (min_z + max_z) as f64 * 0.5;

    let mut max_rsq: f64 = 0.0;
    let mut j = 0;
    while j + 2 < len {
        let dx = data[j] as f64 - cx;
        let dy = data[j + 1] as f64 - cy;
        let dz = data[j + 2] as f64 - cz;
        let dsq = dx * dx + dy * dy + dz * dz;
        if dsq > max_rsq { max_rsq = dsq }
        j += 3;
    }

    let radius = max_rsq.sqrt();
    let out = vec![cx, cy, cz, radius];
    Float64Array::from(out.as_slice())
}

#[wasm_bindgen]
pub fn compute_bounding_box(data: &[f32]) -> Float64Array {
    let len = data.len();
    let out = vec![0f64; 6];
    if len == 0 {
        return Float64Array::from(out.as_slice())
    }

    let mut min_x = std::f32::INFINITY;
    let mut min_y = std::f32::INFINITY;
    let mut min_z = std::f32::INFINITY;
    let mut max_x = std::f32::NEG_INFINITY;
    let mut max_y = std::f32::NEG_INFINITY;
    let mut max_z = std::f32::NEG_INFINITY;

    let mut i = 0;
    while i + 2 < len {
        let x = data[i];
        let y = data[i + 1];
        let z = data[i + 2];
        if x < min_x { min_x = x }
        if y < min_y { min_y = y }
        if z < min_z { min_z = z }
        if x > max_x { max_x = x }
        if y > max_y { max_y = y }
        if z > max_z { max_z = z }
        i += 3;
    }

    out[0] = min_x as f64;
    out[1] = min_y as f64;
    out[2] = min_z as f64;
    out[3] = max_x as f64;
    out[4] = max_y as f64;
    out[5] = max_z as f64;
    Float64Array::from(out.as_slice())
}
