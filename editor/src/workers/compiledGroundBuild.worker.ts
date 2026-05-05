/// <reference lib="webworker" />

import type {
  GroundDynamicMesh,
} from '@schema'
import { resolveGroundWorldBounds } from '@schema'
import {
  serializeCompiledGroundCollisionTile,
  serializeCompiledGroundRenderTile,
} from '@schema'
import {
  buildCollisionTileData,
  buildRenderTileGeometry,
} from '@/utils/compiledGroundBuildShared'
import type {
  CompiledGroundBuildWorkerCollisionResult,
  CompiledGroundBuildWorkerRequest,
  CompiledGroundBuildWorkerRenderResult,
  CompiledGroundBuildWorkerResponse,
} from '@/utils/compiledGroundBuildWorkerProtocol'

let workerDefinition: GroundDynamicMesh | null = null
let workerWorldBounds: ReturnType<typeof resolveGroundWorldBounds> | null = null

self.onmessage = (event: MessageEvent<CompiledGroundBuildWorkerRequest>) => {
  const message = event.data
  if (!message) {
    return
  }

  try {
    if (message.kind === 'compiled-ground-init') {
      workerDefinition = message.definition
      workerWorldBounds = message.worldBounds
      const response: CompiledGroundBuildWorkerResponse = {
        kind: 'compiled-ground-init-result',
        requestId: message.requestId,
        ok: true,
      }
      self.postMessage(response)
      return
    }

    if (message.kind !== 'compiled-ground-build-tiles') {
      return
    }

    if (!workerDefinition || !workerWorldBounds) {
      const response: CompiledGroundBuildWorkerResponse = {
        kind: 'compiled-ground-build-tiles-result',
        requestId: message.requestId,
        phase: message.phase,
        error: 'compiled ground worker not initialized',
      }
      self.postMessage(response)
      return
    }

    if (message.phase === 'render') {
      const renderResults: CompiledGroundBuildWorkerRenderResult[] = []
      const transfers: Transferable[] = []
      for (const job of message.jobs) {
        const built = buildRenderTileGeometry(
          workerDefinition,
          workerWorldBounds,
          job.minX,
          job.minZ,
          job.widthMeters,
          job.depthMeters,
        )
        if (!built) {
          continue
        }
        built.header.key = job.key
        built.header.row = job.row
        built.header.column = job.column
        const encodedTile = serializeCompiledGroundRenderTile(built)
        renderResults.push({
          key: job.key,
          row: job.row,
          column: job.column,
          widthMeters: job.widthMeters,
          depthMeters: job.depthMeters,
          bounds: built.header.bounds,
          vertexCount: built.header.vertexCount,
          triangleCount: built.header.triangleCount,
          encodedTile,
        })
        transfers.push(encodedTile)
      }
      const response: CompiledGroundBuildWorkerResponse = {
        kind: 'compiled-ground-build-tiles-result',
        requestId: message.requestId,
        phase: 'render',
        renderResults,
      }
      self.postMessage(response, transfers)
      return
    }

    const collisionResults: CompiledGroundBuildWorkerCollisionResult[] = []
    const transfers: Transferable[] = []
    for (const job of message.jobs) {
      const built = buildCollisionTileData(
        workerDefinition,
        workerWorldBounds,
        job.minX,
        job.minZ,
        job.widthMeters,
        job.depthMeters,
        Math.max(1e-6, message.collisionSampleStepMeters ?? 1),
      )
      built.header.key = job.key
      built.header.row = job.row
      built.header.column = job.column
      const encodedTile = serializeCompiledGroundCollisionTile(built)
      collisionResults.push({
        key: job.key,
        row: job.row,
        column: job.column,
        widthMeters: job.widthMeters,
        depthMeters: job.depthMeters,
        bounds: built.header.bounds,
        rows: built.header.rows,
        columns: built.header.columns,
        elementSize: built.header.elementSize,
        encodedTile,
      })
      transfers.push(encodedTile)
    }
    const response: CompiledGroundBuildWorkerResponse = {
      kind: 'compiled-ground-build-tiles-result',
      requestId: message.requestId,
      phase: 'collision',
      collisionResults,
    }
    self.postMessage(response, transfers)
  } catch (error) {
    const response: CompiledGroundBuildWorkerResponse = message.kind === 'compiled-ground-init'
      ? {
        kind: 'compiled-ground-init-result',
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
      : {
        kind: 'compiled-ground-build-tiles-result',
        requestId: message.requestId,
        phase: message.phase,
        error: error instanceof Error ? error.message : String(error),
      }
    self.postMessage(response)
  }
}
