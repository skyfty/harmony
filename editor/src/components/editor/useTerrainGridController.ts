import * as THREE from 'three'
import type { GroundDynamicMesh } from '@schema'
import { TerrainGridHelper } from './TerrainGridHelper'

export type TerrainGridController = {
  refresh: () => void
  markCameraDirty: () => void
  tick: (nowMs: number) => void
  dispose: () => void
}

type Options = {
  terrainGridHelper: TerrainGridHelper
  getCamera: () => THREE.Camera | null
  resolveDefinition: () => GroundDynamicMesh | null
  computeSignature: (definition: GroundDynamicMesh) => string
  nowMs: () => number
}

const TERRAIN_GRID_CAMERA_SETTLE_DELAY_MS = 180
const TERRAIN_GRID_CAMERA_MIN_REFRESH_INTERVAL_MS = 120
const TERRAIN_GRID_CAMERA_MAX_MOVING_REFRESH_INTERVAL_MS = 1200

export function useTerrainGridController(options: Options): TerrainGridController {
  const { terrainGridHelper } = options

  let baseSignature: string | null = null
  let baseDefinition: GroundDynamicMesh | null = null
  let cameraDirty = false
  let lastCameraRefresh = 0
  let lastCameraDirtyAt = 0

  const refreshWithCamera = () => {
    const definition = baseDefinition
    if (!definition) {
      terrainGridHelper.update(null, null)
      return
    }
    const signatureBase = baseSignature ?? options.computeSignature(definition)
    terrainGridHelper.update(definition, signatureBase)
  }

  const refresh = () => {
    const definition = options.resolveDefinition()
    baseDefinition = definition
    baseSignature = definition ? options.computeSignature(definition) : null
    refreshWithCamera()
  }

  const markCameraDirty = () => {
    void options.getCamera()
    lastCameraDirtyAt = options.nowMs()
    cameraDirty = true
  }

  const tick = (nowMs: number) => {
    if (!cameraDirty) {
      return
    }

    const now = Number.isFinite(nowMs) ? nowMs : options.nowMs()
    const sinceLastRefresh = now - lastCameraRefresh
    const sinceLastDirty = now - lastCameraDirtyAt
    const settled = sinceLastDirty >= TERRAIN_GRID_CAMERA_SETTLE_DELAY_MS
    const maxMovingIntervalReached = sinceLastRefresh >= TERRAIN_GRID_CAMERA_MAX_MOVING_REFRESH_INTERVAL_MS

    if (sinceLastRefresh < TERRAIN_GRID_CAMERA_MIN_REFRESH_INTERVAL_MS) {
      return
    }
    if (!settled && !maxMovingIntervalReached) {
      return
    }

    lastCameraRefresh = now
    cameraDirty = !settled
    refreshWithCamera()
  }

  const dispose = () => {
    baseDefinition = null
    baseSignature = null
    cameraDirty = false
    lastCameraRefresh = 0
    lastCameraDirtyAt = 0
    terrainGridHelper.update(null, null)
  }

  return {
    refresh,
    markCameraDirty,
    tick,
    dispose,
  }
}