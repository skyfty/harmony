// Simple wasm loader wrapper used by the editor.
// - initWasm(): initialize the wasm module (calls wasm-bindgen init if present)
// - computeBoundingSphere(data): returns Float64Array or null
// - computeBoundingBox(data): returns Float64Array or null

export let wasmReady = false
let _computeBoundingSphere: ((data: Float32Array) => Float64Array) | null = null
let _computeBoundingBox: ((data: Float32Array) => Float64Array) | null = null

export async function initWasm(): Promise<void> {
  if (wasmReady) return
  try {
    // wasm-pack with --target web outputs a JS wrapper at /wasm/pkg/<crate>.js
    // Vite serves project root so we can import from '/wasm/pkg/editor_wasm.js'
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const mod = await import('/wasm/pkg/editor_wasm.js')
    if (typeof mod.default === 'function') {
      await mod.default()
    }
    // call init_panic_hook if present to get better panic messages
    if (typeof mod.init_panic_hook === 'function') {
      try {
        mod.init_panic_hook()
      } catch (e) {
        // ignore
      }
    }
    if (typeof mod.compute_bounding_sphere === 'function') {
      // @ts-ignore
      _computeBoundingSphere = (data: Float32Array) => mod.compute_bounding_sphere(data)
    }
    if (typeof mod.compute_bounding_box === 'function') {
      // @ts-ignore
      _computeBoundingBox = (data: Float32Array) => mod.compute_bounding_box(data)
    }
    wasmReady = true
  } catch (e) {
    // leave functions null to indicate missing wasm
    _computeBoundingSphere = null
    _computeBoundingBox = null
    wasmReady = false
  }
}

export function computeBoundingSphere(data: Float32Array): Float64Array | null {
  if (_computeBoundingSphere) {
    try {
      return _computeBoundingSphere(data)
    } catch (e) {
      return null
    }
  }
  return null
}

export function computeBoundingBox(data: Float32Array): Float64Array | null {
  if (_computeBoundingBox) {
    try {
      return _computeBoundingBox(data)
    } catch (e) {
      return null
    }
  }
  return null
}

