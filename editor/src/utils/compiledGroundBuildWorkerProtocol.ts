import type {
  CompiledGroundBounds,
  GroundDynamicMesh,
} from '@schema'
import { resolveGroundWorldBounds } from '@schema'

export type CompiledGroundTileJob = {
  key: string
  row: number
  column: number
  minX: number
  minZ: number
  widthMeters: number
  depthMeters: number
}

export type CompiledGroundBuildWorkerInitRequest = {
  kind: 'compiled-ground-init'
  requestId: number
  definition: GroundDynamicMesh
  worldBounds: ReturnType<typeof resolveGroundWorldBounds>
}

export type CompiledGroundBuildWorkerTilesRequest = {
  kind: 'compiled-ground-build-tiles'
  requestId: number
  phase: 'render' | 'collision'
  collisionSampleStepMeters?: number
  jobs: CompiledGroundTileJob[]
}

export type CompiledGroundBuildWorkerRequest =
  | CompiledGroundBuildWorkerInitRequest
  | CompiledGroundBuildWorkerTilesRequest

export type CompiledGroundBuildWorkerRenderResult = {
  key: string
  row: number
  column: number
  widthMeters: number
  depthMeters: number
  bounds: CompiledGroundBounds
  vertexCount: number
  triangleCount: number
  encodedTile: ArrayBuffer
}

export type CompiledGroundBuildWorkerCollisionResult = {
  key: string
  row: number
  column: number
  widthMeters: number
  depthMeters: number
  bounds: CompiledGroundBounds
  rows: number
  columns: number
  elementSize: number
  encodedTile: ArrayBuffer
}

export type CompiledGroundBuildWorkerInitResponse = {
  kind: 'compiled-ground-init-result'
  requestId: number
  ok: boolean
  error?: string
}

export type CompiledGroundBuildWorkerTilesResponse = {
  kind: 'compiled-ground-build-tiles-result'
  requestId: number
  phase: 'render' | 'collision'
  renderResults?: CompiledGroundBuildWorkerRenderResult[]
  collisionResults?: CompiledGroundBuildWorkerCollisionResult[]
  error?: string
}

export type CompiledGroundBuildWorkerResponse =
  | CompiledGroundBuildWorkerInitResponse
  | CompiledGroundBuildWorkerTilesResponse
