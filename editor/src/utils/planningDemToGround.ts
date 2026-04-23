import type { GroundRuntimeDynamicMesh } from '@schema'
import { createGroundHeightMap, getGroundVertexIndex, type GroundPlanningMetadata } from '@schema'
import type { PlanningTerrainDemData } from '@/types/planning-scene-data'
import { loadPlanningDemBlobByHash } from '@/utils/planningDemStorage'
import { parsePlanningDemBlob } from '@/utils/planningDemImport'

export interface PlanningDemGroundConversionResult {
  planningHeightMap: Float64Array
  planningMetadata: GroundPlanningMetadata
  textureDataUrl: string | null
  textureName: string | null
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(1, value))
}

function sampleArrayLikeBilinear(values: ArrayLike<number>, width: number, height: number, x: number, y: number): number {
  const clampedX = Math.max(0, Math.min(Math.max(0, width - 1), x))
  const clampedY = Math.max(0, Math.min(Math.max(0, height - 1), y))
  const x0 = Math.floor(clampedX)
  const y0 = Math.floor(clampedY)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = clampedX - x0
  const ty = clampedY - y0

  const v00 = Number(values[y0 * width + x0])
  const v10 = Number(values[y0 * width + x1])
  const v01 = Number(values[y1 * width + x0])
  const v11 = Number(values[y1 * width + x1])

  const a = v00 + (v10 - v00) * tx
  const b = v01 + (v11 - v01) * tx
  return a + (b - a) * ty
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob as data URL'))
    reader.readAsDataURL(blob)
  })
}

export async function buildPlanningDemGroundData(options: {
  definition: GroundRuntimeDynamicMesh
  terrainDem: PlanningTerrainDemData
  applyOrthophoto?: boolean
}): Promise<PlanningDemGroundConversionResult> {
  const { definition, terrainDem } = options
  const demHash = typeof terrainDem.sourceFileHash === 'string' ? terrainDem.sourceFileHash.trim() : ''
  if (!demHash) {
    throw new Error('DEM source hash is missing')
  }
  const blob = await loadPlanningDemBlobByHash(demHash)
  if (!blob) {
    throw new Error('DEM blob is missing from storage')
  }

  const parsed = await parsePlanningDemBlob(blob, terrainDem.filename ?? 'DEM', (terrainDem.mimeType ?? blob.type) || null)
  const rasterData = parsed.rasterData
  if (!rasterData || !parsed.width || !parsed.height) {
    throw new Error('DEM raster is empty')
  }

  const rows = Math.max(1, Math.trunc(definition.rows))
  const columns = Math.max(1, Math.trunc(definition.columns))
  const heightMap = createGroundHeightMap(rows, columns)

  const demWidth = parsed.width
  const demHeight = parsed.height

  for (let row = 0; row <= rows; row += 1) {
    const tz = rows > 0 ? row / rows : 0
    const demY = clamp01(tz) * Math.max(0, demHeight - 1)
    for (let column = 0; column <= columns; column += 1) {
      const tx = columns > 0 ? column / columns : 0
      const demX = clamp01(tx) * Math.max(0, demWidth - 1)
      const sampled = sampleArrayLikeBilinear(rasterData, demWidth, demHeight, demX, demY)
      heightMap[getGroundVertexIndex(columns, row, column)] = Number.isFinite(sampled) ? sampled : 0
    }
  }

  const orthophoto = terrainDem.orthophoto
  let textureDataUrl: string | null = null
  let textureName: string | null = null
  if (options.applyOrthophoto !== false && orthophoto?.sourceFileHash) {
    const orthoBlob = await loadPlanningDemBlobByHash(orthophoto.sourceFileHash)
    if (orthoBlob) {
      textureDataUrl = await blobToDataUrl(orthoBlob)
      textureName = orthophoto.filename ?? terrainDem.filename ?? 'Orthophoto'
    }
  }

  return {
    planningHeightMap: heightMap,
    planningMetadata: {
      contourBounds: null,
      generatedAt: Date.now(),
    },
    textureDataUrl,
    textureName,
  }
}