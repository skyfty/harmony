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
