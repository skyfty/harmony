export type HarmonyCanvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | any

export type HarmonyCanvas =
  | HTMLCanvasElement
  | OffscreenCanvas
  | {
      width: number
      height: number
      getContext: (type: '2d') => HarmonyCanvas2DContext
    }

export function createCanvas(width: number, height: number): HarmonyCanvas {
  const globalObject = globalThis as typeof globalThis & {
    OffscreenCanvas?: new (width: number, height: number) => OffscreenCanvas
    uni?: { createOffscreenCanvas?: (options: { type?: '2d'; width: number; height: number }) => HarmonyCanvas }
    wx?: { createOffscreenCanvas?: (options: { type?: '2d'; width: number; height: number }) => HarmonyCanvas }
  }

  if (typeof globalObject.OffscreenCanvas === 'function') {
    return new globalObject.OffscreenCanvas(width, height)
  }
  if (typeof globalObject.uni?.createOffscreenCanvas === 'function') {
    return globalObject.uni.createOffscreenCanvas({ type: '2d', width, height })
  }
  if (typeof globalObject.wx?.createOffscreenCanvas === 'function') {
    return globalObject.wx.createOffscreenCanvas({ type: '2d', width, height })
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  }

  throw new Error('Unable to create a canvas')
}
