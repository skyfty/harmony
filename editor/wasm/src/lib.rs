use wasm_bindgen::prelude::*;
use js_sys::Float64Array;

#[wasm_bindgen]
pub fn sum_array(arr: &Float64Array) -> f64 {
    let mut sum = 0.0;
    let len = arr.length();
    for i in 0..len {
        sum += arr.get_index(i);
    }
    sum
}

#[wasm_bindgen]
pub fn heavy_compute(iter: u32) -> f64 {
    let mut s = 0.0;
    for i in 0..iter {
        let x = ((i as f64) * 0.61803398875).sin();
        s += x * x;
    }
    s
}
