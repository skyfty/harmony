import {
  applyGroundPaintBrushFallback,
  bakeGroundPaintChunkFallback,
  type GroundPaintBakeKernelInput,
  type GroundPaintBakeKernelOutput,
  type GroundPaintBrushKernelInput,
  type GroundPaintBrushKernelOutput,
} from './groundPaintFallback'

export type GroundPaintWasmBindings = {
  kind: 'fallback'
  applyBrush(input: GroundPaintBrushKernelInput): GroundPaintBrushKernelOutput
  bakeChunk(input: GroundPaintBakeKernelInput): GroundPaintBakeKernelOutput
}

let bindingsPromise: Promise<GroundPaintWasmBindings> | null = null

function createFallbackBindings(): GroundPaintWasmBindings {
  return {
    kind: 'fallback',
    applyBrush(input) {
      return applyGroundPaintBrushFallback(input)
    },
    bakeChunk(input) {
      return bakeGroundPaintChunkFallback(input)
    },
  }
}

export async function initGroundPaintWasm(): Promise<GroundPaintWasmBindings> {
  if (!bindingsPromise) {
    bindingsPromise = Promise.resolve(createFallbackBindings())
  }
  return bindingsPromise
}

export type {
  GroundPaintBakeKernelInput,
  GroundPaintBakeKernelOutput,
  GroundPaintBrushKernelInput,
  GroundPaintBrushKernelOutput,
} from './groundPaintFallback'