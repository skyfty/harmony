import {
  buildGroundFlatChunkInstanceMatrices,
  resolveGroundDefinitionStructureSignature,
  type GroundFlatChunkInstanceMatrixBuildResult,
} from '@schema/groundMesh'
import type { GroundRuntimeDynamicMesh } from '@schema/core'

export type GroundFlatChunkMatrixWorkerSyncDefinitionRequest = {
  kind: 'sync-ground-flat-chunk-definition'
  definitionSignature: string
  definition: GroundRuntimeDynamicMesh
}

export type GroundFlatChunkMatrixWorkerBuildRequest = {
  kind: 'build-ground-flat-chunk-matrices'
  requestId: number
  definitionSignature: string
  chunkKeys: string[]
}

export type GroundFlatChunkMatrixWorkerRequest =
  | GroundFlatChunkMatrixWorkerSyncDefinitionRequest
  | GroundFlatChunkMatrixWorkerBuildRequest

export type GroundFlatChunkMatrixWorkerResponse = {
  kind: 'build-ground-flat-chunk-matrices-result'
  requestId: number
  result: GroundFlatChunkInstanceMatrixBuildResult | null
  error?: string
}

const syncedDefinitionSignatures = new Set<string>()
const pendingGroundFlatChunkMatrixRequests = new Map<
  number,
  {
    resolve: (response: GroundFlatChunkMatrixWorkerResponse) => void
    reject: (error: Error) => void
  }
>()

let groundFlatChunkMatrixWorker: Worker | null = null
let groundFlatChunkMatrixRequestId = 0

function cloneGroundFlatChunkWorkerValue(value: unknown): unknown {
  if (value == null) {
    return value
  }
  const valueType = typeof value
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return value
  }
  if (valueType === 'bigint' || valueType === 'function' || valueType === 'symbol') {
    return undefined
  }
  if (value instanceof ArrayBuffer) {
    return value.slice(0)
  }
  if (ArrayBuffer.isView(value)) {
    return (value as { slice?: () => unknown }).slice?.()
  }
  if (Array.isArray(value)) {
    const result: unknown[] = []
    value.forEach((entry) => {
      const clonedEntry = cloneGroundFlatChunkWorkerValue(entry)
      if (clonedEntry !== undefined) {
        result.push(clonedEntry)
      }
    })
    return result
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      const clonedEntry = cloneGroundFlatChunkWorkerValue(entry)
      if (clonedEntry !== undefined) {
        result[key] = clonedEntry
      }
    })
    return result
  }
  return undefined
}

function cloneGroundFlatChunkDefinitionForWorker(definition: GroundRuntimeDynamicMesh): GroundRuntimeDynamicMesh {
  const source = definition as unknown as Record<string, unknown>
  const clone: Record<string, unknown> = {}
  Object.entries(source).forEach(([key, value]) => {
    if (typeof value === 'function') {
      return
    }
    if (key === 'runtimeTerrainHeightSampler' || key === 'localEditTiles') {
      return
    }
    if (key.startsWith('runtime') && key !== 'runtimeHydratedHeightState' && key !== 'runtimeDisableOptimizedChunks' && key !== 'runtimeLoadedTileKeys') {
      return
    }
    const clonedValue = cloneGroundFlatChunkWorkerValue(value)
    if (clonedValue !== undefined) {
      clone[key] = clonedValue
    }
  })
  return clone as unknown as GroundRuntimeDynamicMesh
}

function buildGroundFlatChunkMatricesLocally(definition: GroundRuntimeDynamicMesh, chunkKeys: string[]): GroundFlatChunkInstanceMatrixBuildResult {
  return buildGroundFlatChunkInstanceMatrices(definition, chunkKeys)
}

function getGroundFlatChunkMatrixWorker(): Worker | null {
  if (typeof Worker === 'undefined') {
    return null
  }
  if (groundFlatChunkMatrixWorker) {
    return groundFlatChunkMatrixWorker
  }
  try {
    groundFlatChunkMatrixWorker = new Worker(new URL('@/workers/groundFlatChunkMatrices.worker.ts', import.meta.url), {
      type: 'module',
    })
    groundFlatChunkMatrixWorker.onmessage = (event: MessageEvent<GroundFlatChunkMatrixWorkerResponse>) => {
      const data = event.data
      if (!data || data.kind !== 'build-ground-flat-chunk-matrices-result') {
        return
      }
      const pending = pendingGroundFlatChunkMatrixRequests.get(data.requestId)
      if (!pending) {
        return
      }
      pendingGroundFlatChunkMatrixRequests.delete(data.requestId)
      pending.resolve(data)
    }
    groundFlatChunkMatrixWorker.onerror = (event) => {
      console.warn('[GroundFlatChunk] Matrix worker failed', event)
      const pendingRequests = Array.from(pendingGroundFlatChunkMatrixRequests.values())
      pendingGroundFlatChunkMatrixRequests.clear()
      syncedDefinitionSignatures.clear()
      pendingRequests.forEach((pending) => {
        pending.reject(new Error('Ground flat chunk matrix worker failed'))
      })
      groundFlatChunkMatrixWorker?.terminate()
      groundFlatChunkMatrixWorker = null
    }
    return groundFlatChunkMatrixWorker
  } catch (error) {
    console.warn('[GroundFlatChunk] Unable to initialize matrix worker; falling back to main thread', error)
    groundFlatChunkMatrixWorker = null
    return null
  }
}

export async function buildGroundFlatChunkInstanceMatricesInWorker(params: {
  definition: GroundRuntimeDynamicMesh
  definitionSignature?: string
  chunkKeys: string[]
}): Promise<GroundFlatChunkInstanceMatrixBuildResult> {
  const { definition, chunkKeys } = params
  if (chunkKeys.length === 0) {
    return {
      chunkKeys: [],
      matrices: new Float32Array(0),
    }
  }
  if (definition.runtimeTerrainHeightSampler) {
    return buildGroundFlatChunkMatricesLocally(definition, chunkKeys)
  }
  const worker = getGroundFlatChunkMatrixWorker()
  if (!worker) {
    return buildGroundFlatChunkMatricesLocally(definition, chunkKeys)
  }

  const definitionSignature = params.definitionSignature ?? resolveGroundDefinitionStructureSignature(definition)
  const requestId = ++groundFlatChunkMatrixRequestId
  try {
    if (!syncedDefinitionSignatures.has(definitionSignature)) {
      const syncRequest: GroundFlatChunkMatrixWorkerSyncDefinitionRequest = {
        kind: 'sync-ground-flat-chunk-definition',
        definitionSignature,
        definition: cloneGroundFlatChunkDefinitionForWorker(definition),
      }
      worker.postMessage(syncRequest)
      syncedDefinitionSignatures.add(definitionSignature)
    }
    const response = await new Promise<GroundFlatChunkMatrixWorkerResponse>((resolve, reject) => {
      pendingGroundFlatChunkMatrixRequests.set(requestId, { resolve, reject })
      const buildRequest: GroundFlatChunkMatrixWorkerBuildRequest = {
        kind: 'build-ground-flat-chunk-matrices',
        requestId,
        definitionSignature,
        chunkKeys: [...chunkKeys],
      }
      worker.postMessage(buildRequest)
    })
    if (response.error || !response.result) {
      syncedDefinitionSignatures.delete(definitionSignature)
      return buildGroundFlatChunkMatricesLocally(definition, chunkKeys)
    }
    return response.result
  } catch {
    pendingGroundFlatChunkMatrixRequests.delete(requestId)
    syncedDefinitionSignatures.delete(definitionSignature)
    return buildGroundFlatChunkMatricesLocally(definition, chunkKeys)
  }
}
