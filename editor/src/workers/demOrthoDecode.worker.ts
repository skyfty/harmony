/// <reference lib="webworker" />

import type { TerrainDemPackageSidecar } from '@schema/terrainDemPackage'
import { decodeDemOrthoGeoTiff } from '@/utils/demOrthoRaster'

type DecodeRequest = {
  kind: 'decode-dem-ortho'
  requestId: number
  buffer: ArrayBuffer
  sidecar: TerrainDemPackageSidecar
  maxSize: number
}

type DecodeResponse =
  | {
      kind: 'decode-dem-ortho-result'
      requestId: number
      width: number
      height: number
      sourceWidth: number
      sourceHeight: number
      rgb: ArrayBuffer
    }
  | {
      kind: 'decode-dem-ortho-error'
      requestId: number
      message: string
    }

self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const message = event.data
  if (!message || message.kind !== 'decode-dem-ortho') {
    return
  }
  try {
    const decoded = await decodeDemOrthoGeoTiff({
      buffer: message.buffer,
      sidecar: message.sidecar,
      maxSize: message.maxSize,
    })
    const response: DecodeResponse = {
      kind: 'decode-dem-ortho-result',
      requestId: message.requestId,
      width: decoded.width,
      height: decoded.height,
      sourceWidth: decoded.sourceWidth,
      sourceHeight: decoded.sourceHeight,
      rgb: decoded.rgb.buffer as ArrayBuffer,
    }
    self.postMessage(response, [response.rgb])
  } catch (error) {
    const response: DecodeResponse = {
      kind: 'decode-dem-ortho-error',
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(response)
  }
}
