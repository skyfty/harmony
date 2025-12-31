let wasmModule: Promise<any> | null = null;

export function initWasm() {
  if (!wasmModule) {
    wasmModule = import('./pkg/editor_wasm.js').then((m) => m);
  }
  return wasmModule;
}

export async function sumArray(arr: Float64Array) {
  const mod = await initWasm();
  return mod.sum_array(arr);
}

export async function heavyCompute(n: number) {
  const mod = await initWasm();
  return mod.heavy_compute(n);
}
