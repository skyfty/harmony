import * as THREE from 'three'

import type {
  CompiledGroundCollisionTileData,
  CompiledGroundCollisionTileRecord,
  CompiledGroundManifest,
  CompiledGroundRenderTileData,
  CompiledGroundRenderTileRecord,
  GroundDynamicMesh,
  SceneJsonExportDocument,
  SceneNode,
} from '@schema'
import {
  COMPILED_GROUND_MANIFEST_VERSION,
  computeCompiledGroundManifestRevision,
  computeCompiledGroundBoundsFromPositions,
  formatCompiledGroundTileKey,
  resolveGroundChunkBounds,
  resolveGroundChunkOrigin,
  resolveGroundWorldBounds,
  serializeCompiledGroundCollisionTile,
  serializeCompiledGroundRenderTile,
} from '@schema'
import { sampleGroundHeight } from '@schema/groundMesh'
import { isGroundDynamicMesh } from '@schema/groundHeightfield'

type CompiledGroundExportResult = {
  manifestPath: string
  renderRootPath: string
  collisionRootPath: string
  manifest: CompiledGroundManifest
  files: Record<string, Uint8Array>
}

const DEFAULT_RENDER_CHUNKS_PER_TILE = 4
const DEFAULT_COLLISION_CHUNKS_PER_TILE = 1
const DEFAULT_COLLISION_SAMPLE_STEP_METERS = 2

function findGroundNode(nodes: SceneNode[]): SceneNode | null {
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (isGroundDynamicMesh(node.dynamicMesh)) {
      return node
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      stack.push(...node.children)
    }
  }
  return null
}

function sampleCompiledGroundHeight(
  definition: GroundDynamicMesh,
  worldBounds: ReturnType<typeof resolveGroundWorldBounds>,
  x: number,
  z: number,
): number {
  if (x >= worldBounds.minX && x <= worldBounds.maxX && z >= worldBounds.minZ && z <= worldBounds.maxZ) {
    const sampled = sampleGroundHeight(definition as any, x, z)
    return Number.isFinite(sampled) ? sampled : 0
  }
  if (definition.terrainMode === 'infinite' && Number.isFinite(definition.baseHeight)) {
    return Number(definition.baseHeight)
  }
  const clampedX = THREE.MathUtils.clamp(x, worldBounds.minX, worldBounds.maxX)
  const clampedZ = THREE.MathUtils.clamp(z, worldBounds.minZ, worldBounds.maxZ)
  const sampled = sampleGroundHeight(definition as any, clampedX, clampedZ)
  return Number.isFinite(sampled)
    ? sampled
    : (Number.isFinite(definition.baseHeight) ? Number(definition.baseHeight) : 0)
}

function buildRenderTileGeometry(
  definition: GroundDynamicMesh,
  worldBounds: ReturnType<typeof resolveGroundWorldBounds>,
  minX: number,
  minZ: number,
  widthMeters: number,
  depthMeters: number,
): CompiledGroundRenderTileData | null {
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 1e-6 ? definition.cellSize : 1
  const columns = Math.max(1, Math.round(widthMeters / cellSize))
  const rows = Math.max(1, Math.round(depthMeters / cellSize))
  const stepX = widthMeters / columns
  const stepZ = depthMeters / rows
  const vertexCount = (columns + 1) * (rows + 1)
  const positions = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array(rows * columns * 6)

  let vertexIndex = 0
  for (let row = 0; row <= rows; row += 1) {
    const z = minZ + row * stepZ
    for (let column = 0; column <= columns; column += 1) {
      const x = minX + column * stepX
      const height = sampleCompiledGroundHeight(definition, worldBounds, x, z)
      positions[vertexIndex * 3 + 0] = x
      positions[vertexIndex * 3 + 1] = Number.isFinite(height) ? height : 0
      positions[vertexIndex * 3 + 2] = z
      uvs[vertexIndex * 2 + 0] = column / columns
      uvs[vertexIndex * 2 + 1] = 1 - (row / rows)
      vertexIndex += 1
    }
  }

  let indexOffset = 0
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * (columns + 1) + column
      const b = a + 1
      const c = (row + 1) * (columns + 1) + column
      const d = c + 1
      indices[indexOffset + 0] = a
      indices[indexOffset + 1] = c
      indices[indexOffset + 2] = b
      indices[indexOffset + 3] = b
      indices[indexOffset + 4] = c
      indices[indexOffset + 5] = d
      indexOffset += 6
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  const normals = new Float32Array(((geometry.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array))
  geometry.dispose()

  return {
    header: {
      version: 1,
      key: '',
      row: 0,
      column: 0,
      bounds: computeCompiledGroundBoundsFromPositions(positions),
      vertexCount,
      triangleCount: indices.length / 3,
      indexCount: indices.length,
    },
    positions,
    normals,
    uvs,
    indices,
  }
}

function buildCollisionTileData(
  definition: GroundDynamicMesh,
  worldBounds: ReturnType<typeof resolveGroundWorldBounds>,
  minX: number,
  minZ: number,
  widthMeters: number,
  depthMeters: number,
  sampleStepMeters: number,
): CompiledGroundCollisionTileData {
  const step = Math.max(1e-6, sampleStepMeters)
  const columns = Math.max(1, Math.round(widthMeters / step))
  const rows = Math.max(1, Math.round(depthMeters / step))
  const stepX = widthMeters / columns
  const stepZ = depthMeters / rows
  const elementSize = Math.max(stepX, stepZ)
  const heights = new Float32Array((rows + 1) * (columns + 1))
  let minHeight = Number.POSITIVE_INFINITY
  let maxHeight = Number.NEGATIVE_INFINITY

  let offset = 0
  for (let row = 0; row <= rows; row += 1) {
    const z = minZ + row * stepZ
    for (let column = 0; column <= columns; column += 1) {
      const x = minX + column * stepX
      const height = sampleCompiledGroundHeight(definition, worldBounds, x, z)
      const safeHeight = Number.isFinite(height) ? height : 0
      heights[offset] = safeHeight
      minHeight = Math.min(minHeight, safeHeight)
      maxHeight = Math.max(maxHeight, safeHeight)
      offset += 1
    }
  }

  return {
    header: {
      version: 1,
      key: '',
      row: 0,
      column: 0,
      bounds: {
        minX,
        minY: Number.isFinite(minHeight) ? minHeight : 0,
        minZ,
        maxX: minX + widthMeters,
        maxY: Number.isFinite(maxHeight) ? maxHeight : 0,
        maxZ: minZ + depthMeters,
      },
      rows,
      columns,
      elementSize,
      minHeight: Number.isFinite(minHeight) ? minHeight : 0,
      maxHeight: Number.isFinite(maxHeight) ? maxHeight : 0,
    },
    heights,
  }
}

export function buildCompiledGroundPackageFiles(document: SceneJsonExportDocument): CompiledGroundExportResult | null {
  const groundNode = findGroundNode(document.nodes)
  if (!groundNode || !isGroundDynamicMesh(groundNode.dynamicMesh)) {
    return null
  }
  const definition = groundNode.dynamicMesh as GroundDynamicMesh
  const sceneRoot = `scenes/${encodeURIComponent(document.id)}/compiled-ground`
  const manifestPath = `${sceneRoot}/manifest.json`
  const renderRootPath = `${sceneRoot}/render`
  const collisionRootPath = `${sceneRoot}/collision`
  const worldBounds = resolveGroundWorldBounds(definition)
  const coveredChunkBounds = resolveGroundChunkBounds(definition)
  const chunkSizeMeters = Number.isFinite(definition.chunkSizeMeters) && definition.chunkSizeMeters! > 0
    ? Number(definition.chunkSizeMeters)
    : 100
  const coveredChunkOrigin = resolveGroundChunkOrigin({
    chunkX: coveredChunkBounds.minChunkX,
    chunkZ: coveredChunkBounds.minChunkZ,
  }, chunkSizeMeters)
  const coveredChunkMaxOrigin = resolveGroundChunkOrigin({
    chunkX: coveredChunkBounds.maxChunkX,
    chunkZ: coveredChunkBounds.maxChunkZ,
  }, chunkSizeMeters)
  const coverageBounds = {
    minX: coveredChunkOrigin.x,
    minZ: coveredChunkOrigin.z,
    maxX: coveredChunkMaxOrigin.x + chunkSizeMeters,
    maxZ: coveredChunkMaxOrigin.z + chunkSizeMeters,
  }
  const renderTileSizeMeters = chunkSizeMeters * DEFAULT_RENDER_CHUNKS_PER_TILE
  const collisionTileSizeMeters = chunkSizeMeters * DEFAULT_COLLISION_CHUNKS_PER_TILE
  const collisionSampleStepMeters = Math.max(
    Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1,
    DEFAULT_COLLISION_SAMPLE_STEP_METERS,
  )
  const renderColumns = Math.max(1, Math.ceil((coverageBounds.maxX - coverageBounds.minX) / renderTileSizeMeters))
  const renderRows = Math.max(1, Math.ceil((coverageBounds.maxZ - coverageBounds.minZ) / renderTileSizeMeters))
  const collisionColumns = Math.max(1, Math.ceil((coverageBounds.maxX - coverageBounds.minX) / collisionTileSizeMeters))
  const collisionRows = Math.max(1, Math.ceil((coverageBounds.maxZ - coverageBounds.minZ) / collisionTileSizeMeters))
  const files: Record<string, Uint8Array> = {}
  const renderTiles: CompiledGroundRenderTileRecord[] = []
  const collisionTiles: CompiledGroundCollisionTileRecord[] = []

  for (let row = 0; row < renderRows; row += 1) {
    for (let column = 0; column < renderColumns; column += 1) {
      const key = formatCompiledGroundTileKey(row, column)
      const minX = coverageBounds.minX + column * renderTileSizeMeters
      const minZ = coverageBounds.minZ + row * renderTileSizeMeters
      const widthMeters = Math.min(renderTileSizeMeters, coverageBounds.maxX - minX)
      const depthMeters = Math.min(renderTileSizeMeters, coverageBounds.maxZ - minZ)
      const built = buildRenderTileGeometry(definition, worldBounds, minX, minZ, widthMeters, depthMeters)
      if (!built) {
        continue
      }
      built.header.key = key
      built.header.row = row
      built.header.column = column
      const path = `${renderRootPath}/tile_r${row}_c${column}.gmesh`
      const encoded = serializeCompiledGroundRenderTile(built)
      files[path] = new Uint8Array(encoded)
      renderTiles.push({
        key,
        row,
        column,
        centerX: minX + widthMeters * 0.5,
        centerZ: minZ + depthMeters * 0.5,
        sizeMeters: renderTileSizeMeters,
        widthMeters,
        depthMeters,
        path,
        bounds: built.header.bounds,
        vertexCount: built.header.vertexCount,
        triangleCount: built.header.triangleCount,
      })
    }
  }

  for (let row = 0; row < collisionRows; row += 1) {
    for (let column = 0; column < collisionColumns; column += 1) {
      const key = formatCompiledGroundTileKey(row, column)
      const minX = coverageBounds.minX + column * collisionTileSizeMeters
      const minZ = coverageBounds.minZ + row * collisionTileSizeMeters
      const widthMeters = Math.min(collisionTileSizeMeters, coverageBounds.maxX - minX)
      const depthMeters = Math.min(collisionTileSizeMeters, coverageBounds.maxZ - minZ)
      const built = buildCollisionTileData(definition, worldBounds, minX, minZ, widthMeters, depthMeters, collisionSampleStepMeters)
      built.header.key = key
      built.header.row = row
      built.header.column = column
      const path = `${collisionRootPath}/tile_r${row}_c${column}.hfield`
      const encoded = serializeCompiledGroundCollisionTile(built)
      files[path] = new Uint8Array(encoded)
      collisionTiles.push({
        key,
        row,
        column,
        centerX: minX + widthMeters * 0.5,
        centerZ: minZ + depthMeters * 0.5,
        sizeMeters: collisionTileSizeMeters,
        widthMeters,
        depthMeters,
        path,
        bounds: built.header.bounds,
        rows: built.header.rows,
        columns: built.header.columns,
        elementSize: built.header.elementSize,
      })
    }
  }

  const minHeight = renderTiles.length > 0
    ? Math.min(...renderTiles.map((tile) => tile.bounds.minY))
    : (Number.isFinite(definition.baseHeight) ? Number(definition.baseHeight) : 0)
  const maxHeight = renderTiles.length > 0
    ? Math.max(...renderTiles.map((tile) => tile.bounds.maxY))
    : (Number.isFinite(definition.baseHeight) ? Number(definition.baseHeight) : 0)
  const manifestWithoutRevision: Omit<CompiledGroundManifest, 'revision'> = {
    version: COMPILED_GROUND_MANIFEST_VERSION,
    sceneId: document.id,
    groundNodeId: groundNode.id,
    chunkSizeMeters,
    baseHeight: Number.isFinite(definition.baseHeight) ? Number(definition.baseHeight) : 0,
    renderTileSizeMeters,
    collisionTileSizeMeters,
    coveredChunkBounds,
    bounds: {
      minX: coverageBounds.minX,
      minY: minHeight,
      minZ: coverageBounds.minZ,
      maxX: coverageBounds.maxX,
      maxY: maxHeight,
      maxZ: coverageBounds.maxZ,
    },
    renderTiles,
    collisionTiles,
  }

  return {
    manifestPath,
    renderRootPath,
    collisionRootPath,
    manifest: {
      ...manifestWithoutRevision,
      revision: computeCompiledGroundManifestRevision(manifestWithoutRevision),
    },
    files,
  }
}
