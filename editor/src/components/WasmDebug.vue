<script setup lang="ts">
import { ref } from 'vue'
import { loadWasm } from '@/wasm/loader'

const pkg = ref<any | null>(null)
const result = ref<number | string>('')
const busy = ref(false)

async function ensureLoaded() {
  if (pkg.value) return pkg.value
  busy.value = true
  try {
    const m = await loadWasm()
    pkg.value = m
    // If wasm exports an init hook, call it (e.g. to enable panic hook)
    if (typeof m.init_panic_hook === 'function') m.init_panic_hook()
    return m
  } finally {
    busy.value = false
  }
}

// Call heavy_compute with a big number to allow stepping in
async function runHeavy() {
  const m = await ensureLoaded()
  busy.value = true
  try {
    // Place a breakpoint on the next line (in JS) or inside Rust `heavy_compute`
    const r = m.heavy_compute(1000000)
    result.value = String(r)
  } catch (e) {
    result.value = `error: ${e}`
  } finally {
    busy.value = false
  }
}

// Allow calling multiple small steps so you can set breakpoints in Rust
async function runStepLoop() {
  const m = await ensureLoaded()
  busy.value = true
  try {
    let s = 0
    for (let i = 0; i < 10; i++) {
      // set breakpoint here to step through repeated calls
      s += Number(m.heavy_compute(100000))
    }
    result.value = String(s)
  } catch (e) {
    result.value = `error: ${e}`
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div style="padding: 12px; border: 1px dashed #ccc; margin: 12px; background: #fafafa;">
    <h3>WASM Debug Test</h3>
    <div style="display:flex; gap:8px; align-items:center;">
      <button @click="ensureLoaded" :disabled="busy">Load WASM</button>
      <button @click="runHeavy" :disabled="busy">Run heavy_compute(1_000_000)</button>
      <button @click="runStepLoop" :disabled="busy">Run looped small calls</button>
      <span v-if="busy">Working…</span>
    </div>
    <div style="margin-top:8px">
      <b>Result:</b> {{ result }}
    </div>
    <div style="margin-top:8px; font-size:12px; color:#666">
      - Use the VSCode launch config "Attach to Chrome (Editor dev)" to attach.
      <br />- Set breakpoints either in `editor/wasm/src/lib.rs` (if DWARF/maps exist)
      or in the generated JS wrapper at `editor/wasm/pkg/editor_wasm.js`.
    </div>
  </div>
</template>
