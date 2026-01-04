import * as THREE from 'three'
import type { GroundDynamicMesh } from '@harmony/schema'
import type { TerrainGridVisibleRange } from './TerrainGridHelper'
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

const TERRAIN_GRID_BLOCK_CELLS = 64
const TERRAIN_GRID_BLOCK_PADDING = 1
const TERRAIN_GRID_CAMERA_REFRESH_INTERVAL_MS = 320

function clampInclusive(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

export function useTerrainGridController(options: Options): TerrainGridController {
  const { terrainGridHelper } = options

  const terrainGridFrustum = new THREE.Frustum()
  const terrainGridProjScreenMatrix = new THREE.Matrix4()
  const invProjScreen = new THREE.Matrix4()
  const v4 = new THREE.Vector4()
  const ndcCorners: Array<[number, number, number]> = [
    [-1, -1, -1],
    [1, -1, -1],
    [-1, 1, -1],
    [1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [-1, 1, 1],
    [1, 1, 1],
  ]

  let baseSignature: string | null = null
  let baseDefinition: GroundDynamicMesh | null = null
  let cameraDirty = false
  let lastCameraRefresh = 0

  const computeVisibleRange = (definition: GroundDynamicMesh, currentCamera: THREE.Camera): TerrainGridVisibleRange | null => {
    const columns = Math.max(1, Math.floor(definition.columns))
    const rows = Math.max(1, Math.floor(definition.rows))
    const cellSize = Math.max(1e-4, definition.cellSize)
    const width = Math.max(Math.abs(definition.width), columns * cellSize)
    const depth = Math.max(Math.abs(definition.depth), rows * cellSize)
    const halfWidth = width * 0.5
    const halfDepth = depth * 0.5
    const stepX = columns > 0 ? width / columns : 0
    const stepZ = rows > 0 ? depth / rows : 0
    if (stepX <= 0 || stepZ <= 0) {
      return null
    }

    terrainGridProjScreenMatrix.multiplyMatrices(currentCamera.projectionMatrix, currentCamera.matrixWorldInverse)
    terrainGridFrustum.setFromProjectionMatrix(terrainGridProjScreenMatrix)

    const block = TERRAIN_GRID_BLOCK_CELLS
    const pad = TERRAIN_GRID_BLOCK_PADDING
    const blockCountX = Math.ceil(columns / block)
    const blockCountZ = Math.ceil(rows / block)

    let minVisibleBlockX = 0
    let maxVisibleBlockX = blockCountX - 1
    let minVisibleBlockZ = 0
    let maxVisibleBlockZ = blockCountZ - 1

    try {
      invProjScreen.copy(terrainGridProjScreenMatrix).invert()

      let minX = Infinity
      let maxX = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity

      for (const c of ndcCorners) {
        const [cx, cy, cz] = c
        v4.set(cx, cy, cz, 1)
        v4.applyMatrix4(invProjScreen)
        if (v4.w !== 0) v4.divideScalar(v4.w)
        const wx = v4.x
        const wz = v4.z
        if (Number.isFinite(wx) && Number.isFinite(wz)) {
          minX = Math.min(minX, wx)
          maxX = Math.max(maxX, wx)
          minZ = Math.min(minZ, wz)
          maxZ = Math.max(maxZ, wz)
        }
      }

      if (minX === Infinity || minZ === Infinity) {
        minVisibleBlockX = 0
        maxVisibleBlockX = blockCountX - 1
        minVisibleBlockZ = 0
        maxVisibleBlockZ = blockCountZ - 1
      } else {
        const padWorld = pad * block * Math.max(stepX, stepZ)
        minX -= padWorld
        maxX += padWorld
        minZ -= padWorld
        maxZ += padWorld

        const minColumn = Math.floor((minX + halfWidth) / stepX)
        const maxColumn = Math.ceil((maxX + halfWidth) / stepX)
        const minRow = Math.floor((minZ + halfDepth) / stepZ)
        const maxRow = Math.ceil((maxZ + halfDepth) / stepZ)

        const minChunkX = clampInclusive(Math.floor(minColumn / block), 0, blockCountX - 1)
        const maxChunkX = clampInclusive(Math.floor(Math.max(0, maxColumn - 1) / block), 0, blockCountX - 1)
        const minChunkZ = clampInclusive(Math.floor(minRow / block), 0, blockCountZ - 1)
        const maxChunkZ = clampInclusive(Math.floor(Math.max(0, maxRow - 1) / block), 0, blockCountZ - 1)

        minVisibleBlockX = minChunkX
        maxVisibleBlockX = maxChunkX
        minVisibleBlockZ = minChunkZ
        maxVisibleBlockZ = maxChunkZ
      }
    } catch (_err) {
      minVisibleBlockX = 0
      maxVisibleBlockX = blockCountX - 1
      minVisibleBlockZ = 0
      maxVisibleBlockZ = blockCountZ - 1
    }

    if (!Number.isFinite(minVisibleBlockX) || !Number.isFinite(minVisibleBlockZ)) {
      return null
    }

    const qMinColumn = Math.max(0, (minVisibleBlockX - pad) * block)
    const qMaxColumn = Math.min(columns, (maxVisibleBlockX + pad + 1) * block)
    const qMinRow = Math.max(0, (minVisibleBlockZ - pad) * block)
    const qMaxRow = Math.min(rows, (maxVisibleBlockZ + pad + 1) * block)

    if (qMaxColumn - qMinColumn <= 0 || qMaxRow - qMinRow <= 0) {
      return null
    }

    return { minRow: qMinRow, maxRow: qMaxRow, minColumn: qMinColumn, maxColumn: qMaxColumn }
  }

  const refreshWithCamera = () => {
    const definition = baseDefinition
    if (!definition) {
      terrainGridHelper.update(null, null)
      return
    }

    const camera = options.getCamera()
    const signatureBase = baseSignature ?? options.computeSignature(definition)
    const range = camera ? computeVisibleRange(definition, camera) : null
    const signature = range
      ? `${signatureBase}|view:${range.minRow}-${range.maxRow}:${range.minColumn}-${range.maxColumn}`
      : signatureBase

    terrainGridHelper.update(definition, signature, range)
  }

  const refresh = () => {
    const definition = options.resolveDefinition()
    baseDefinition = definition
    baseSignature = definition ? options.computeSignature(definition) : null
    refreshWithCamera()
  }

  const markCameraDirty = () => {
    cameraDirty = true
  }

  const tick = (nowMs: number) => {
    if (!cameraDirty) {
      return
    }
    const now = Number.isFinite(nowMs) ? nowMs : options.nowMs()
    if (now - lastCameraRefresh < TERRAIN_GRID_CAMERA_REFRESH_INTERVAL_MS) {
      return
    }

    lastCameraRefresh = now
    cameraDirty = false
    refreshWithCamera()
  }

  const dispose = () => {
    baseDefinition = null
    baseSignature = null
    cameraDirty = false
    lastCameraRefresh = 0
    terrainGridHelper.update(null, null)
  }

  return {
    refresh,
    markCameraDirty,
    tick,
    dispose,
  }
}
