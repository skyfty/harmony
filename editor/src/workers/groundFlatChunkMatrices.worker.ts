/// <reference lib="webworker" />

import {
  buildGroundFlatChunkInstanceMatrices,
} from '@schema/groundMesh'
import type { GroundRuntimeDynamicMesh } from '@schema/core'
import type {
  GroundFlatChunkMatrixWorkerRequest,
  GroundFlatChunkMatrixWorkerResponse,
} from '@/utils/groundFlatChunkMatrixWorker'

const groundFlatChunkDefinitionCache = new Map<string, GroundRuntimeDynamicMesh>()

self.onmessage = (event: MessageEvent<GroundFlatChunkMatrixWorkerRequest>) => {
  const message = event.data
  if (!message) {
    return
  }
  if (message.kind === 'sync-ground-flat-chunk-definition') {
    groundFlatChunkDefinitionCache.set(message.definitionSignature, message.definition)
    return
  }
  if (message.kind !== 'build-ground-flat-chunk-matrices') {
    return
  }

  try {
    const definition = groundFlatChunkDefinitionCache.get(message.definitionSignature)
    if (!definition) {
      throw new Error(`Ground flat chunk definition not found for signature "${message.definitionSignature}"`)
    }
    const result = buildGroundFlatChunkInstanceMatrices(definition, message.chunkKeys)
    const response: GroundFlatChunkMatrixWorkerResponse = {
      kind: 'build-ground-flat-chunk-matrices-result',
      requestId: message.requestId,
      result,
    }
    const transferables: Transferable[] = result.matrices.buffer instanceof ArrayBuffer
      ? [result.matrices.buffer]
      : []
    self.postMessage(response, transferables)
  } catch (error) {
    const response: GroundFlatChunkMatrixWorkerResponse = {
      kind: 'build-ground-flat-chunk-matrices-result',
      requestId: message.requestId,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(response)
  }
}
