use wasm_bindgen::prelude::*;
use js_sys::Float64Array;

fn clamp(value: f64, min_value: f64, max_value: f64) -> f64 {
    value.max(min_value).min(max_value)
}

fn sample_coordinate(world: f64, min_world: f64, sample_step: f64, max_index: usize) -> f64 {
    if max_index == 0 {
        return 0.0;
    }
    let safe_step = sample_step.max(f64::EPSILON);
    let raw_index = (world - min_world) / safe_step;
    let clamped_index = clamp(raw_index, 0.0, max_index as f64);
    let rounded_index = clamped_index.round();
    if (clamped_index - rounded_index).abs() <= 1e-7 {
        rounded_index
    } else {
        clamped_index
    }
}

fn bilinear_sample(values: &Float64Array, width: usize, height: usize, x: f64, y: f64) -> f64 {
    let clamped_x = clamp(x, 0.0, (width.saturating_sub(1)) as f64);
    let clamped_y = clamp(y, 0.0, (height.saturating_sub(1)) as f64);
    let x0 = clamped_x.floor() as usize;
    let y0 = clamped_y.floor() as usize;
    let x1 = x0.saturating_add(1).min(width.saturating_sub(1));
    let y1 = y0.saturating_add(1).min(height.saturating_sub(1));
    let tx = clamped_x - x0 as f64;
    let ty = clamped_y - y0 as f64;

    let mut weighted_sum = 0.0;
    let mut total_weight = 0.0;

    let weight00 = (1.0 - tx) * (1.0 - ty);
    let value00 = values.get_index((y0 * width + x0) as u32);
    if value00.is_finite() {
        weighted_sum += value00 * weight00;
        total_weight += weight00;
    }

    let weight10 = tx * (1.0 - ty);
    let value10 = values.get_index((y0 * width + x1) as u32);
    if value10.is_finite() {
        weighted_sum += value10 * weight10;
        total_weight += weight10;
    }

    let weight01 = (1.0 - tx) * ty;
    let value01 = values.get_index((y1 * width + x0) as u32);
    if value01.is_finite() {
        weighted_sum += value01 * weight01;
        total_weight += weight01;
    }

    let weight11 = tx * ty;
    let value11 = values.get_index((y1 * width + x1) as u32);
    if value11.is_finite() {
        weighted_sum += value11 * weight11;
        total_weight += weight11;
    }

    if total_weight > 0.0 {
        weighted_sum / total_weight
    } else {
        0.0
    }
}

#[wasm_bindgen]
pub fn version() -> String {
    "0.1.0".to_string()
}

#[wasm_bindgen]
pub fn sample_height_grid(
    raster_data: Float64Array,
    width: usize,
    height: usize,
    target_min_x: f64,
    target_min_z: f64,
    sample_step_x: f64,
    sample_step_z: f64,
    sample_start_x: f64,
    sample_start_z: f64,
    rows: usize,
    columns: usize,
) -> Float64Array {
    let output_len = (rows + 1) * (columns + 1);
    let mut output = vec![0.0_f64; output_len];

    for row in 0..=rows {
        let z = sample_start_z + (row as f64) * sample_step_z;
        let dem_y = sample_coordinate(z, target_min_z, sample_step_z, height.saturating_sub(1));
        let row_offset = row * (columns + 1);
        for column in 0..=columns {
            let x = sample_start_x + (column as f64) * sample_step_x;
            let dem_x = sample_coordinate(x, target_min_x, sample_step_x, width.saturating_sub(1));
            let sampled = bilinear_sample(&raster_data, width, height, dem_x, dem_y);
            output[row_offset + column] = if sampled.is_finite() { sampled } else { 0.0 };
        }
    }

    Float64Array::from(output.as_slice())
}