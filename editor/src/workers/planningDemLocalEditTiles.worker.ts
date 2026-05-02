/// <reference lib="webworker" />

import type { PlanningDemHeightRegionBuildPlan, PlanningDemLocalEditTileBuildPlan } from '@/utils/planningDemToGround'
import {
  formatGroundLocalEditTileKey,
} from '@schema'
import {
  createPlanningDemRasterSource,
  type PlanningDemRasterSource,
  type PlanningDemTargetWorldBounds,
} from '@/utils/planningDemToGround'
import { samplePlanningDemHeightGridFromWorldBounds } from '@/wasm/planningDemSampling'

type BuildPlanningDemLocalEditTilesRequest = {
  kind: 'build-planning-dem-local-edit-tiles'
  requestId: number
  plan: PlanningDemLocalEditTileBuildPlan
  rasterData: Float64Array
}

type BuildPlanningDemLocalEditTilesResponse = {
  kind: 'build-planning-dem-local-edit-tiles-result'
  requestId: number
  tiles: Array<{
    key: string
    tileRow: number
    tileColumn: number
    tileSizeMeters: number
    resolution: number
    values: number[]
    source: 'dem'
    updatedAt: number
  }>
  error?: string
}

type BuildPlanningDemHeightRegionRequest = {
  kind: 'build-planning-dem-height-region'
  requestId: number
  plan: PlanningDemHeightRegionBuildPlan
  rasterData: Float64Array
}

type BuildPlanningDemHeightRegionResponse = {
  kind: 'build-planning-dem-height-region-result'
  requestId: number
  region: {
    startRow: number
    endRow: number
    startColumn: number
    endColumn: number
    vertexRows: number
    vertexColumns: number
    values: ArrayBuffer
  }
  error?: string
}

function buildSourceFromPlan(plan: PlanningDemLocalEditTileBuildPlan, rasterData: Float64Array): PlanningDemRasterSource {
  const targetWorldBounds: PlanningDemTargetWorldBounds = plan.sourceBounds
  return createPlanningDemRasterSource({
    rasterData,
    width: plan.sourceWidth,
    height: plan.sourceHeight,
    targetWorldBounds,
  })
}

function buildLocalEditTilesInWorker(plan: PlanningDemLocalEditTileBuildPlan, rasterData: Float64Array): BuildPlanningDemLocalEditTilesResponse['tiles'] {
  if (!(plan.totalTiles > 0)) {
    return []
  }

  const source = buildSourceFromPlan(plan, rasterData)
  const tiles: BuildPlanningDemLocalEditTilesResponse['tiles'] = []

  for (let tileRow = plan.startTileRow; tileRow <= plan.endTileRow; tileRow += 1) {
    for (let tileColumn = plan.startTileColumn; tileColumn <= plan.endTileColumn; tileColumn += 1) {
      const tileMinX = plan.originX + tileColumn * plan.tileSizeMeters
      const tileMinZ = plan.originZ + tileRow * plan.tileSizeMeters
      const values = Array.from(samplePlanningDemHeightGridFromWorldBounds({
        source,
        startX: tileMinX,
        startZ: tileMinZ,
        endX: tileMinX + plan.tileSizeMeters,
        endZ: tileMinZ + plan.tileSizeMeters,
        rows: plan.resolution,
        columns: plan.resolution,
      }))
      tiles.push({
        key: formatGroundLocalEditTileKey(tileRow, tileColumn),
        tileRow,
        tileColumn,
        tileSizeMeters: plan.tileSizeMeters,
        resolution: plan.resolution,
        values,
        source: 'dem',
        updatedAt: Date.now(),
      })
    }
  }

  return tiles
}

function buildHeightRegionInWorker(plan: PlanningDemHeightRegionBuildPlan, rasterData: Float64Array): BuildPlanningDemHeightRegionResponse['region'] {
  if (!(plan.vertexRows > 0) || !(plan.vertexColumns > 0)) {
    return {
      startRow: plan.startRow,
      endRow: plan.endRow,
      startColumn: plan.startColumn,
      endColumn: plan.endColumn,
      vertexRows: 0,
      vertexColumns: 0,
      values: new ArrayBuffer(0),
    }
  }
  const source = createPlanningDemRasterSource({
    rasterData,
    width: plan.sourceWidth,
    height: plan.sourceHeight,
    targetWorldBounds: plan.sourceBounds,
  })
  const values = samplePlanningDemHeightGridFromWorldBounds({
    source,
    startX: plan.boundsMinX + plan.startColumn * plan.cellSize,
    startZ: plan.boundsMinZ + plan.startRow * plan.cellSize,
    endX: plan.boundsMinX + plan.endColumn * plan.cellSize,
    endZ: plan.boundsMinZ + plan.endRow * plan.cellSize,
    rows: plan.vertexRows - 1,
    columns: plan.vertexColumns - 1,
  })

  return {
    startRow: plan.startRow,
    endRow: plan.endRow,
    startColumn: plan.startColumn,
    endColumn: plan.endColumn,
    vertexRows: plan.vertexRows,
    vertexColumns: plan.vertexColumns,
    values: values.buffer as ArrayBuffer,
  }
}

self.onmessage = (event: MessageEvent<BuildPlanningDemLocalEditTilesRequest | BuildPlanningDemHeightRegionRequest>) => {
  const message = event.data
  if (!message) {
    return
  }

  try {
    if (message.kind === 'build-planning-dem-local-edit-tiles') {
      const tiles = buildLocalEditTilesInWorker(message.plan, message.rasterData)
      const response: BuildPlanningDemLocalEditTilesResponse = {
        kind: 'build-planning-dem-local-edit-tiles-result',
        requestId: message.requestId,
        tiles,
      }
      self.postMessage(response)
      return
    }

    if (message.kind === 'build-planning-dem-height-region') {
      const region = buildHeightRegionInWorker(message.plan, message.rasterData)
      const response: BuildPlanningDemHeightRegionResponse = {
        kind: 'build-planning-dem-height-region-result',
        requestId: message.requestId,
        region,
      }
      self.postMessage(response, [response.region.values])
      return
    }
  } catch (error) {
    if (message.kind === 'build-planning-dem-height-region') {
      const response: BuildPlanningDemHeightRegionResponse = {
        kind: 'build-planning-dem-height-region-result',
        requestId: message.requestId,
        region: {
          startRow: message.plan.startRow,
          endRow: message.plan.endRow,
          startColumn: message.plan.startColumn,
          endColumn: message.plan.endColumn,
          vertexRows: 0,
          vertexColumns: 0,
          values: new ArrayBuffer(0),
        },
        error: error instanceof Error ? error.message : String(error),
      }
      self.postMessage(response)
      return
    }

    const response: BuildPlanningDemLocalEditTilesResponse = {
      kind: 'build-planning-dem-local-edit-tiles-result',
      requestId: message.requestId,
      tiles: [],
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(response)
  }
}
