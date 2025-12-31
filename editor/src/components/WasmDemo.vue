<script setup lang="ts">
import { ref } from 'vue'
import { initWasm } from '@/wasm_loader'

const result = ref<number | null>(null)
const initialized = ref(false)
let pkg: any = null

async function init() {
  try {
    pkg = await initWasm()
    initialized.value = true
  } catch (e) {
    console.error('wasm init failed', e)
  }
}

async function callMul() {
  if (!initialized.value) {
    await init()
  }
  try {
    // set a breakpoint on the next line to inspect inputs/outputs
    const r = pkg.mul(6, 7)
    result.value = r
    console.log('wasm mul result', r)
  } catch (e) {
    console.error('wasm call failed', e)
  }
}
</script>

<template>
  <div style="padding: 12px; border: 1px solid #ddd; border-radius: 6px; margin: 12px 0;">
    <h3>WASM Demo</h3>
    <p>Initialized: {{ initialized }}</p>
    <button @click="callMul">Call wasm.mul(6,7)</button>
    <div v-if="result !== null">Result: {{ result }}</div>
  </div>
</template>
