import * as THREE from 'three'
import { type GroundDynamicMesh, type GroundGenerationSettings, type GroundHeightMap, type GroundSculptOperation } from '@harmony/schema'

const textureLoader = new THREE.TextureLoader()

const DEFAULT_GROUND_CHUNK_CELLS = 100
const DEFAULT_GROUND_CHUNK_RADIUS_METERS = 350

type GroundChunkKey = string

type GroundChunkSpec = {
  startRow: number
  startColumn: number
  rows: number
  columns: number
}

type GroundChunkRuntime = {
  key: GroundChunkKey
  spec: GroundChunkSpec
  mesh: THREE.Mesh
}

type GroundRuntimeState = {
  definitionSignature: string
  chunkCells: number
  chunks: Map<GroundChunkKey, GroundChunkRuntime>
  lastChunkUpdateAt: number
}

const groundRuntimeStateMap = new WeakMap<THREE.Object3D, GroundRuntimeState>()
let cachedPrototypeMesh: THREE.Mesh | null = null

function createSeededRandom(seed: number): () => number {
  let value = seed % 2147483647
  if (value <= 0) {
    value += 2147483646
  }
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

function buildPermutationTable(random: () => number): number[] {
  const permutation = new Array(256).fill(0).map((_, index) => index)
  for (let i = permutation.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(random() * (i + 1))
    const temp = permutation[i]!
    permutation[i] = permutation[swapIndex]!
    permutation[swapIndex] = temp
  }
  const table = new Array(512)
  for (let i = 0; i < 512; i += 1) {
    table[i] = permutation[i & 255]!
  }
  return table
}

function createPerlinNoise(seed?: number) {
  const random = seed === undefined ? Math.random : createSeededRandom(Math.floor(seed))
  const P = buildPermutationTable(random)

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  const lerp = (t: number, a: number, b: number) => a + t * (b - a)
  const grad = (hash: number, x: number, y: number, z: number) => {
    const h = hash & 15
    const u = h < 8 ? x : y
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z
    const first = (h & 1) === 0 ? u : -u
    const second = (h & 2) === 0 ? v : -v
    return first + second
  }

  return (x: number, y: number, z: number) => {
    let X = Math.floor(x) & 255
    let Y = Math.floor(y) & 255
    let Z = Math.floor(z) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const zf = z - Math.floor(z)
    const u = fade(xf)
    const v = fade(yf)
    const w = fade(zf)

    const A = P[X]! + Y
    const AA = P[A]! + Z
    const AB = P[A + 1]! + Z
    const B = P[X + 1]! + Y
    const BA = P[B]! + Z
    const BB = P[B + 1]! + Z

    return lerp(
      w,
      lerp(
        v,
        lerp(u, grad(P[AA]!, xf, yf, zf), grad(P[BA]!, xf - 1, yf, zf)),
        lerp(u, grad(P[AB]!, xf, yf - 1, zf), grad(P[BB]!, xf - 1, yf - 1, zf)),
      ),
      lerp(
        v,
        lerp(u, grad(P[AA + 1]!, xf, yf, zf - 1), grad(P[BA + 1]!, xf - 1, yf, zf - 1)),
        lerp(u, grad(P[AB + 1]!, xf, yf - 1, zf - 1), grad(P[BB + 1]!, xf - 1, yf - 1, zf - 1)),
      ),
    )
  }
}

type VoronoiPoint = { x: number; z: number }

function createVoronoiNoise(seed?: number) {
  const random = seed === undefined ? Math.random : createSeededRandom(Math.floor(seed))
  const cache = new Map<string, VoronoiPoint>()
  const getPoint = (cellX: number, cellZ: number): VoronoiPoint => {
    const key = `${cellX}:${cellZ}`
    let point = cache.get(key)
    if (!point) {
      point = {
        x: cellX + random(),
        z: cellZ + random(),
      }
      cache.set(key, point)
    }
    return point
  }

  return (x: number, z: number) => {
    const cellX = Math.floor(x)
    const cellZ = Math.floor(z)
    let minDistance = Number.POSITIVE_INFINITY
    for (let ix = cellX - 1; ix <= cellX + 1; ix += 1) {
      for (let iz = cellZ - 1; iz <= cellZ + 1; iz += 1) {
        const feature = getPoint(ix, iz)
        const dx = feature.x - x
        const dz = feature.z - z
        const distance = Math.sqrt(dx * dx + dz * dz)
        if (distance < minDistance) {
          minDistance = distance
        }
      }
    }
    if (!Number.isFinite(minDistance)) {
      return 0
    }
    const normalized = Math.max(0, Math.min(1, minDistance))
    return 1 - normalized
  }
}

function groundVertexKey(row: number, column: number): string {
  return `${row}:${column}`
}

function groundChunkKey(chunkRow: number, chunkColumn: number): GroundChunkKey {
  return `${chunkRow}:${chunkColumn}`
}

function definitionStructureSignature(definition: GroundDynamicMesh): string {
  const columns = Math.max(1, Math.trunc(definition.columns))
  const rows = Math.max(1, Math.trunc(definition.rows))
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  const width = Number.isFinite(definition.width) && definition.width > 0 ? definition.width : columns * cellSize
  const depth = Number.isFinite(definition.depth) && definition.depth > 0 ? definition.depth : rows * cellSize
  return `${columns}|${rows}|${cellSize.toFixed(6)}|${width.toFixed(6)}|${depth.toFixed(6)}`
}

function clampInclusive(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

function resolveChunkCells(definition: GroundDynamicMesh): number {
  // Keep chunk size reasonable even when cellSize is not 1.
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  const targetMeters = DEFAULT_GROUND_CHUNK_CELLS
  const candidate = Math.max(4, Math.round(targetMeters / Math.max(1e-6, cellSize)))
  return Math.max(4, Math.min(512, Math.trunc(candidate)))
}

function resolveGroundChunkRadius(definition: GroundDynamicMesh): number {
  // Default to ~350m radius; scale a bit with terrain size so small grounds load fully.
  const width = Number.isFinite(definition.width) ? definition.width : 0
  const depth = Number.isFinite(definition.depth) ? definition.depth : 0
  const halfDiagonal = Math.sqrt(Math.max(0, width) ** 2 + Math.max(0, depth) ** 2) * 0.5
  return Math.max(150, Math.min(2000, Math.max(DEFAULT_GROUND_CHUNK_RADIUS_METERS, halfDiagonal)))
}

function setHeightMapValue(map: GroundHeightMap, key: string, value: number): void {
  // Keep the height map sparse by skipping zero-height entries.
  let rounded = Math.round(value * 100) / 100
  if (Object.is(rounded, -0)) {
    rounded = 0
  }
  if (rounded === 0) {
    delete map[key]
    return
  }
  map[key] = rounded
}

function clampVertexIndex(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  if (value < 0) {
    return 0
  }
  if (value > max) {
    return max
  }
  return value
}

function getVertexHeight(definition: GroundDynamicMesh, row: number, column: number): number {
  const key = groundVertexKey(row, column)
  return definition.heightMap[key] ?? 0
}

function sampleNeighborAverage(
  definition: GroundDynamicMesh,
  row: number,
  column: number,
  maxRow: number,
  maxColumn: number,
): number {
  let sum = 0
  let count = 0
  for (let r = Math.max(0, row - 1); r <= Math.min(maxRow, row + 1); r += 1) {
    for (let c = Math.max(0, column - 1); c <= Math.min(maxColumn, column + 1); c += 1) {
      sum += getVertexHeight(definition, r, c)
      count += 1
    }
  }
  return count > 0 ? sum / count : 0
}

export function sampleGroundHeight(definition: GroundDynamicMesh, x: number, z: number): number {
  const columns = Math.max(1, definition.columns)
  const rows = Math.max(1, definition.rows)
  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const localColumn = clampVertexIndex(Math.round((x + halfWidth) / definition.cellSize), columns)
  const localRow = clampVertexIndex(Math.round((z + halfDepth) / definition.cellSize), rows)
  return getVertexHeight(definition, localRow, localColumn)
}

export function sampleGroundNormal(
  definition: GroundDynamicMesh,
  x: number,
  z: number,
  target?: THREE.Vector3,
): THREE.Vector3 {
  const result = target ?? new THREE.Vector3()
  const delta = Math.max(0.01, definition.cellSize * 0.5)
  const heightL = sampleGroundHeight(definition, x - delta, z)
  const heightR = sampleGroundHeight(definition, x + delta, z)
  const heightF = sampleGroundHeight(definition, x, z + delta)
  const heightB = sampleGroundHeight(definition, x, z - delta)
  const dx = heightL - heightR
  const dz = heightB - heightF
  result.set(dx, delta * 2, dz)
  if (result.lengthSq() === 0) {
    result.set(0, 1, 0)
  } else {
    result.normalize()
  }
  return result
}

function buildGroundGeometry(definition: GroundDynamicMesh): THREE.BufferGeometry {
  const columns = Math.max(1, definition.columns)
  const rows = Math.max(1, definition.rows)
  const vertexColumns = columns + 1
  const vertexRows = rows + 1
  const vertexCount = vertexColumns * vertexRows
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array(columns * rows * 6)

  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const cellSize = definition.cellSize

  let vertexIndex = 0
  for (let row = 0; row <= rows; row += 1) {
    const z = -halfDepth + row * cellSize
    for (let column = 0; column <= columns; column += 1) {
      const x = -halfWidth + column * cellSize
      const key = groundVertexKey(row, column)
      const height = definition.heightMap[key] ?? 0

      positions[vertexIndex * 3 + 0] = x
      positions[vertexIndex * 3 + 1] = height
      positions[vertexIndex * 3 + 2] = z

      normals[vertexIndex * 3 + 0] = 0
      normals[vertexIndex * 3 + 1] = 1
      normals[vertexIndex * 3 + 2] = 0

      uvs[vertexIndex * 2 + 0] = columns === 0 ? 0 : column / columns
      uvs[vertexIndex * 2 + 1] = rows === 0 ? 0 : 1 - row / rows

      vertexIndex += 1
    }
  }

  let indexPointer = 0
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * vertexColumns + column
      const b = a + 1
      const c = (row + 1) * vertexColumns + column
      const d = c + 1

      indices[indexPointer + 0] = a
      indices[indexPointer + 1] = c
      indices[indexPointer + 2] = b
      indices[indexPointer + 3] = b
      indices[indexPointer + 4] = c
      indices[indexPointer + 5] = d
      indexPointer += 6
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function buildGroundChunkGeometry(definition: GroundDynamicMesh, spec: GroundChunkSpec): THREE.BufferGeometry {
  const columns = Math.max(1, definition.columns)
  const rows = Math.max(1, definition.rows)
  const chunkColumns = Math.max(1, spec.columns)
  const chunkRows = Math.max(1, spec.rows)
  const vertexColumns = chunkColumns + 1
  const vertexRows = chunkRows + 1
  const vertexCount = vertexColumns * vertexRows
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array(chunkColumns * chunkRows * 6)

  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const cellSize = definition.cellSize

  let vertexIndex = 0
  for (let localRow = 0; localRow <= chunkRows; localRow += 1) {
    const row = spec.startRow + localRow
    const z = -halfDepth + row * cellSize
    for (let localColumn = 0; localColumn <= chunkColumns; localColumn += 1) {
      const column = spec.startColumn + localColumn
      const x = -halfWidth + column * cellSize
      const key = groundVertexKey(row, column)
      const height = definition.heightMap[key] ?? 0

      positions[vertexIndex * 3 + 0] = x
      positions[vertexIndex * 3 + 1] = height
      positions[vertexIndex * 3 + 2] = z

      normals[vertexIndex * 3 + 0] = 0
      normals[vertexIndex * 3 + 1] = 1
      normals[vertexIndex * 3 + 2] = 0

      uvs[vertexIndex * 2 + 0] = columns === 0 ? 0 : column / columns
      uvs[vertexIndex * 2 + 1] = rows === 0 ? 0 : 1 - row / rows

      vertexIndex += 1
    }
  }

  let indexPointer = 0
  for (let row = 0; row < chunkRows; row += 1) {
    for (let column = 0; column < chunkColumns; column += 1) {
      const a = row * vertexColumns + column
      const b = a + 1
      const c = (row + 1) * vertexColumns + column
      const d = c + 1

      indices[indexPointer + 0] = a
      indices[indexPointer + 1] = c
      indices[indexPointer + 2] = b
      indices[indexPointer + 3] = b
      indices[indexPointer + 4] = c
      indices[indexPointer + 5] = d
      indexPointer += 6
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function computeChunkSpec(definition: GroundDynamicMesh, chunkRow: number, chunkColumn: number, chunkCells: number): GroundChunkSpec {
  const rows = Math.max(1, Math.trunc(definition.rows))
  const columns = Math.max(1, Math.trunc(definition.columns))
  const startRow = chunkRow * chunkCells
  const startColumn = chunkColumn * chunkCells
  const rowsRemaining = rows - startRow
  const columnsRemaining = columns - startColumn
  const chunkRows = Math.max(1, Math.min(chunkCells, rowsRemaining))
  const chunkColumns = Math.max(1, Math.min(chunkCells, columnsRemaining))
  return {
    startRow,
    startColumn,
    rows: chunkRows,
    columns: chunkColumns,
  }
}

function ensureGroundRuntimeState(root: THREE.Object3D, definition: GroundDynamicMesh): GroundRuntimeState {
  const signature = definitionStructureSignature(definition)
  const existing = groundRuntimeStateMap.get(root)
  const chunkCells = resolveChunkCells(definition)
  if (existing && existing.definitionSignature === signature && existing.chunkCells === chunkCells) {
    return existing
  }

  if (existing) {
    existing.chunks.forEach((entry) => {
      entry.mesh.geometry?.dispose?.()
      // Materials are managed externally (SceneGraph/editor), do not dispose here.
      entry.mesh.removeFromParent()
    })
  }

  const next: GroundRuntimeState = {
    definitionSignature: signature,
    chunkCells,
    chunks: new Map(),
    lastChunkUpdateAt: 0,
  }
  groundRuntimeStateMap.set(root, next)
  return next
}

function ensureChunkMesh(
  root: THREE.Group,
  state: GroundRuntimeState,
  definition: GroundDynamicMesh,
  chunkRow: number,
  chunkColumn: number,
): GroundChunkRuntime {
  const key = groundChunkKey(chunkRow, chunkColumn)
  const existing = state.chunks.get(key)
  if (existing) {
    return existing
  }
  const spec = computeChunkSpec(definition, chunkRow, chunkColumn, state.chunkCells)
  const geometry = buildGroundChunkGeometry(definition, spec)
  // Material gets assigned by caller; default to a placeholder MeshStandardMaterial.
  const material = new THREE.MeshStandardMaterial({
    color: '#707070',
    roughness: 0.85,
    metalness: 0.05,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = `GroundChunk:${chunkRow},${chunkColumn}`
  mesh.receiveShadow = true
  mesh.castShadow = false
  mesh.userData.dynamicMeshType = 'Ground'
  mesh.userData.groundChunk = { ...spec, chunkRow, chunkColumn }
  root.add(mesh)
  const runtime: GroundChunkRuntime = { key, spec, mesh }
  state.chunks.set(key, runtime)
  return runtime
}

function disposeChunk(runtime: GroundChunkRuntime): void {
  try {
    runtime.mesh.geometry?.dispose?.()
  } catch (_error) {
    /* noop */
  }
  runtime.mesh.removeFromParent()
}

const sculptNoise = createPerlinNoise(911)

function normalizeGroundGenerationSettings(settings: GroundGenerationSettings): GroundGenerationSettings {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
  const normalizedScale = clamp(Math.abs(settings.noiseScale ?? 40), 1, 10000)
  const normalizedAmplitude = clamp(Math.abs(settings.noiseAmplitude ?? 0), 0, 500)
  const normalizedStrength = clamp(Number.isFinite(settings.noiseStrength ?? 1) ? Math.abs(settings.noiseStrength ?? 1) : 1, 0, 10)
  const detailScale = settings.detailScale && settings.detailScale > 0 ? settings.detailScale : undefined
  const detailAmplitude = settings.detailAmplitude && settings.detailAmplitude > 0 ? settings.detailAmplitude : undefined
  const edgeFalloff = typeof settings.edgeFalloff === 'number' && Number.isFinite(settings.edgeFalloff)
    ? Math.max(0, settings.edgeFalloff)
    : undefined
  const normalized: GroundGenerationSettings = {
    seed: typeof settings.seed === 'number' && Number.isFinite(settings.seed)
      ? Math.floor(settings.seed)
      : undefined,
    noiseScale: normalizedScale,
    noiseAmplitude: normalizedAmplitude,
    noiseStrength: normalizedStrength,
    detailScale,
    detailAmplitude,
    chunkSize: settings.chunkSize,
    chunkResolution: settings.chunkResolution,
    worldWidth: settings.worldWidth,
    worldDepth: settings.worldDepth,
    edgeFalloff,
    mode: settings.mode ?? 'perlin',
  }
  return normalized
}

export function applyGroundGeneration(
  definition: GroundDynamicMesh,
  settings: GroundGenerationSettings,
): GroundGenerationSettings {
  const normalized = normalizeGroundGenerationSettings(settings)
  const columns = Math.max(1, definition.columns)
  const rows = Math.max(1, definition.rows)
  const cellSize = definition.cellSize
  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const heightMap: GroundHeightMap = {}
  const strength = normalized.noiseStrength ?? 1

  if (normalized.mode === 'flat' || normalized.noiseAmplitude === 0 || strength === 0) {
    definition.heightMap = heightMap
    definition.generation = normalized
    return normalized
  }

  const baseNoise = createPerlinNoise(normalized.seed ?? 1337)
  const useDetail = Boolean(normalized.detailAmplitude && normalized.detailScale)
  const detailNoise = useDetail ? createPerlinNoise((normalized.seed ?? 1337) + 97) : null
  const mainScale = Math.max(0.001, normalized.noiseScale)
  const detailScale = Math.max(0.001, normalized.detailScale ?? normalized.noiseScale * 0.5)
  const detailAmplitude = normalized.detailAmplitude ?? 0
  const voronoiNoise = normalized.mode === 'voronoi' ? createVoronoiNoise((normalized.seed ?? 1337) + 211) : null
  const simplePhase = (normalized.seed ?? 0) * 0.137

  const sampleBaseValue = (x: number, z: number): number => {
    const u = x / mainScale
    const v = z / mainScale
    switch (normalized.mode) {
      case 'simple': {
        const wave = Math.sin(u * 0.6 + simplePhase) * 0.65 + Math.cos(v * 0.35 + simplePhase) * 0.45
        return Math.max(-1, Math.min(1, wave))
      }
      case 'ridge': {
        const raw = baseNoise(u, v, 0.5)
        const ridged = 1 - Math.abs(raw)
        const shaped = ridged * ridged
        return shaped * 2 - 1
      }
      case 'voronoi': {
        const worley = voronoiNoise ? voronoiNoise(u, v) : 0
        return worley * 2 - 1
      }
      case 'flat':
        return 0
      case 'perlin':
      default:
        return baseNoise(u, v, 0.5)
    }
  }

  for (let row = 0; row <= rows; row += 1) {
    const z = -halfDepth + row * cellSize
    for (let column = 0; column <= columns; column += 1) {
      const x = -halfWidth + column * cellSize
      const key = groundVertexKey(row, column)
      let height = sampleBaseValue(x, z) * normalized.noiseAmplitude
      if (useDetail && detailNoise) {
        height += detailNoise(x / detailScale, z / detailScale, 0.5) * detailAmplitude
      }
      height *= strength
      if (normalized.edgeFalloff && normalized.edgeFalloff > 0) {
        const nx = (column / columns) * 2 - 1
        const nz = (row / rows) * 2 - 1
        const edge = Math.max(Math.abs(nx), Math.abs(nz))
        const falloff = Math.pow(1 - Math.min(1, edge), normalized.edgeFalloff)
        height *= falloff
      }
      setHeightMapValue(heightMap, key, height)
    }
  }

  definition.heightMap = heightMap
  definition.generation = normalized
  definition.hasManualEdits = false
  return normalized
}

export interface SculptParams {
  point: THREE.Vector3
  radius: number
  strength: number
  shape: 'circle' | 'square' | 'star'
  operation: GroundSculptOperation
  targetHeight?: number
}

export function sculptGround(definition: GroundDynamicMesh, params: SculptParams): boolean {
  const { point, radius, strength, shape, operation, targetHeight } = params
  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const cellSize = definition.cellSize
  const columns = definition.columns
  const rows = definition.rows

  // Point is in local coordinates
  const localX = point.x
  const localZ = point.z

  const minCol = Math.floor((localX - radius + halfWidth) / cellSize)
  const maxCol = Math.ceil((localX + radius + halfWidth) / cellSize)
  const minRow = Math.floor((localZ - radius + halfDepth) / cellSize)
  const maxRow = Math.ceil((localZ + radius + halfDepth) / cellSize)

  let modified = false
  let heightMap = definition.heightMap

  for (let row = Math.max(0, minRow); row <= Math.min(rows, maxRow); row++) {
      for (let col = Math.max(0, minCol); col <= Math.min(columns, maxCol); col++) {
          const x = -halfWidth + col * cellSize
          const z = -halfDepth + row * cellSize
          
          const dx = x - localX
          const dz = z - localZ
          
          let dist = 0
          let isInside = false

          if (shape === 'square') {
              const maxDist = Math.max(Math.abs(dx), Math.abs(dz))
              if (maxDist <= radius) {
                  dist = maxDist
                  isInside = true
              }
          } else if (shape === 'star') {
               const r = Math.sqrt(dx * dx + dz * dz);
               const angle = Math.atan2(dz, dx);
               const n = 5;
               const step = Math.PI * 2 / n;
               let localAngle = (angle % step);
               if (localAngle < 0) localAngle += step;
               if (localAngle > step / 2) localAngle = step - localAngle;
               const alpha = localAngle;
               const R_out = radius;
               const R_in = R_out * 0.5;
               const gamma = step / 2;
               const m = (R_in * Math.sin(gamma)) / (R_in * Math.cos(gamma) - R_out);
               const maxR = (-m * R_out) / (Math.sin(alpha) - m * Math.cos(alpha));
               if (r < maxR) {
                   dist = (r / maxR) * radius;
                   isInside = true;
               }
          } else {
              // Circle
              const distSq = dx * dx + dz * dz
              if (distSq < radius * radius) {
                  dist = Math.sqrt(distSq)
                  isInside = true
              }
          }

          if (isInside) {
            let influence = Math.cos((dist / radius) * (Math.PI / 2))
            const noiseVal = sculptNoise(x * 0.05, z * 0.05, 0)
            influence *= 1.0 + noiseVal * 0.1

            const key = groundVertexKey(row, col)
            const currentHeight = heightMap[key] ?? 0
            let nextHeight = currentHeight

            if (operation === 'smooth') {
              const average = sampleNeighborAverage(definition, row, col, rows, columns)
              const smoothingFactor = Math.min(1, strength * 0.25)
              nextHeight = currentHeight + (average - currentHeight) * smoothingFactor * influence
            } else if (operation === 'flatten') {
              const reference = targetHeight ?? currentHeight
              const flattenFactor = Math.min(1, strength * 0.4)
              nextHeight = currentHeight + (reference - currentHeight) * flattenFactor * influence
            } else {
              const direction = operation === 'depress' ? -1 : 1
              const offset = direction * strength * influence * 0.3
              nextHeight = currentHeight + offset
            }

            setHeightMapValue(heightMap, key, nextHeight)
            modified = true
          }
      }
  }
  if (modified) {
    definition.heightMap = heightMap
    definition.hasManualEdits = true
  }
  return modified
}

export function updateGroundGeometry(geometry: THREE.BufferGeometry, definition: GroundDynamicMesh): boolean {
  const columns = Math.max(1, definition.columns)
  const rows = Math.max(1, definition.rows)
  const vertexColumns = columns + 1
  const vertexRows = rows + 1
  const expectedVertexCount = vertexColumns * vertexRows

  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined

  if (!positionAttr || positionAttr.count !== expectedVertexCount || !uvAttr || uvAttr.count !== expectedVertexCount) {
    return false
  }

  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const cellSize = definition.cellSize

  let vertexIndex = 0
  for (let row = 0; row <= rows; row += 1) {
    const z = -halfDepth + row * cellSize
    for (let column = 0; column <= columns; column += 1) {
      const x = -halfWidth + column * cellSize
      const key = groundVertexKey(row, column)
      const height = definition.heightMap[key] ?? 0

      positionAttr.setXYZ(vertexIndex, x, height, z)
      uvAttr.setXY(vertexIndex, columns === 0 ? 0 : column / columns, rows === 0 ? 0 : 1 - row / rows)
      vertexIndex += 1
    }
  }

  positionAttr.needsUpdate = true
  uvAttr.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return true
}

type GroundTextureMetadata = { groundDynamic?: boolean }

function isDynamicGroundTexture(texture: THREE.Texture | null | undefined): boolean {
  if (!texture) {
    return false
  }
  const userData = texture.userData as GroundTextureMetadata | undefined
  return Boolean(userData?.groundDynamic)
}

function markDynamicGroundTexture(texture: THREE.Texture): void {
  const userData = (texture.userData ??= {}) as GroundTextureMetadata
  userData.groundDynamic = true
}

function clearDynamicGroundFlag(texture: THREE.Texture | null | undefined): void {
  if (!texture) {
    return
  }
  const userData = texture.userData as GroundTextureMetadata | undefined
  if (userData && 'groundDynamic' in userData) {
    delete userData.groundDynamic
  }
}

function disposeGroundTexture(texture: THREE.Texture | null | undefined) {
  if (!texture) {
    return
  }
  texture.dispose()
  clearDynamicGroundFlag(texture)
}

function applyGroundTextureToMaterial(material: THREE.Material, definition: GroundDynamicMesh): void {
  const typed = material as THREE.MeshStandardMaterial & { map?: THREE.Texture | null; needsUpdate?: boolean }
  if (!('map' in typed)) {
    return
  }

  const previousTexture = typed.map ?? null
  const wasDynamicTextureApplied = isDynamicGroundTexture(previousTexture)
  if (definition.textureDataUrl && wasDynamicTextureApplied) {
    disposeGroundTexture(previousTexture)
  }

  if (!definition.textureDataUrl) {
    if (wasDynamicTextureApplied) {
      disposeGroundTexture(previousTexture)
      typed.map = null
      typed.needsUpdate = true
    }
    return
  }

  const texture = textureLoader.load(definition.textureDataUrl, () => {
    typed.needsUpdate = true
  })
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = Math.min(16, texture.anisotropy || 8)
  texture.name = definition.textureName ?? 'GroundTexture'
  markDynamicGroundTexture(texture)
  typed.map = texture
  typed.needsUpdate = true
}

function applyGroundTextureToObject(object: THREE.Object3D, definition: GroundDynamicMesh): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    const material = mesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry && applyGroundTextureToMaterial(entry, definition))
    } else if (material) {
      applyGroundTextureToMaterial(material, definition)
    }
  })
}

export type GroundGeometryUpdateRegion = {
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
}

function updateChunkGeometry(geometry: THREE.BufferGeometry, definition: GroundDynamicMesh, spec: GroundChunkSpec): boolean {
  const columns = Math.max(1, Math.trunc(definition.columns))
  const rows = Math.max(1, Math.trunc(definition.rows))
  const chunkColumns = Math.max(1, Math.trunc(spec.columns))
  const chunkRows = Math.max(1, Math.trunc(spec.rows))
  const expectedVertexCount = (chunkColumns + 1) * (chunkRows + 1)
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!positionAttr || !uvAttr || positionAttr.count !== expectedVertexCount || uvAttr.count !== expectedVertexCount) {
    return false
  }
  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const cellSize = definition.cellSize

  let vertexIndex = 0
  for (let localRow = 0; localRow <= chunkRows; localRow += 1) {
    const row = spec.startRow + localRow
    const z = -halfDepth + row * cellSize
    for (let localColumn = 0; localColumn <= chunkColumns; localColumn += 1) {
      const column = spec.startColumn + localColumn
      const x = -halfWidth + column * cellSize
      const key = groundVertexKey(row, column)
      const height = definition.heightMap[key] ?? 0
      positionAttr.setXYZ(vertexIndex, x, height, z)
      uvAttr.setXY(vertexIndex, columns === 0 ? 0 : column / columns, rows === 0 ? 0 : 1 - row / rows)
      vertexIndex += 1
    }
  }
  positionAttr.needsUpdate = true
  uvAttr.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return true
}

function updateChunkGeometryRegion(
  geometry: THREE.BufferGeometry,
  definition: GroundDynamicMesh,
  spec: GroundChunkSpec,
  region: GroundGeometryUpdateRegion,
): boolean {
  const chunkColumns = Math.max(1, Math.trunc(spec.columns))
  const chunkRows = Math.max(1, Math.trunc(spec.rows))
  const vertexColumns = chunkColumns + 1
  const expectedVertexCount = (chunkColumns + 1) * (chunkRows + 1)
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!positionAttr || positionAttr.count !== expectedVertexCount) {
    return false
  }

  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const cellSize = definition.cellSize

  const startRow = clampInclusive(region.minRow, spec.startRow, spec.startRow + chunkRows)
  const endRow = clampInclusive(region.maxRow, spec.startRow, spec.startRow + chunkRows)
  const startColumn = clampInclusive(region.minColumn, spec.startColumn, spec.startColumn + chunkColumns)
  const endColumn = clampInclusive(region.maxColumn, spec.startColumn, spec.startColumn + chunkColumns)

  for (let row = startRow; row <= endRow; row += 1) {
    const z = -halfDepth + row * cellSize
    const localRow = row - spec.startRow
    for (let column = startColumn; column <= endColumn; column += 1) {
      const x = -halfWidth + column * cellSize
      const localColumn = column - spec.startColumn
      const vertexIndex = localRow * vertexColumns + localColumn
      const key = groundVertexKey(row, column)
      const height = definition.heightMap[key] ?? 0
      positionAttr.setXYZ(vertexIndex, x, height, z)
    }
  }
  positionAttr.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return true
}

export function createGroundMesh(definition: GroundDynamicMesh): THREE.Object3D {
  // Prototype mesh retained for material/metadata defaults.
  if (!cachedPrototypeMesh) {
    const geometry = buildGroundChunkGeometry(definition, { startRow: 0, startColumn: 0, rows: 1, columns: 1 })
    const material = new THREE.MeshStandardMaterial({
      color: '#707070',
      roughness: 0.85,
      metalness: 0.05,
    })
    cachedPrototypeMesh = new THREE.Mesh(geometry, material)
    cachedPrototypeMesh.name = 'GroundPrototype'
    cachedPrototypeMesh.receiveShadow = true
    cachedPrototypeMesh.castShadow = false
    cachedPrototypeMesh.userData.dynamicMeshType = 'Ground'
  }

  const group = new THREE.Group()
  group.name = 'Ground'
  group.userData.dynamicMeshType = 'Ground'
  group.userData.groundChunked = true
  ensureGroundRuntimeState(group, definition)
  // Seed a small neighborhood around origin so it shows up immediately.
  updateGroundChunks(group, definition, null)
  applyGroundTextureToObject(group, definition)
  return group
}

export function setGroundMaterial(target: THREE.Object3D, material: THREE.Material | THREE.Material[]): void {
  target.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      mesh.material = material
    }
  })
}

export function updateGroundChunks(
  target: THREE.Object3D,
  definition: GroundDynamicMesh,
  camera: THREE.Camera | null,
  options: { radius?: number } = {},
): void {
  const root = (target as THREE.Group)
  if (!root || !(root as any).isGroup) {
    return
  }
  const state = ensureGroundRuntimeState(root, definition)
  const now = performance.now ? performance.now() : Date.now()
  // Throttle chunk churn a bit.
  if (now - state.lastChunkUpdateAt < 120) {
    return
  }
  state.lastChunkUpdateAt = now

  const chunkCells = state.chunkCells
  const rows = Math.max(1, Math.trunc(definition.rows))
  const columns = Math.max(1, Math.trunc(definition.columns))
  const maxChunkRowIndex = Math.max(0, Math.floor((rows - 1) / chunkCells))
  const maxChunkColumnIndex = Math.max(0, Math.floor((columns - 1) / chunkCells))

  let localX = 0
  let localZ = 0
  let radius = typeof options.radius === 'number' && Number.isFinite(options.radius) && options.radius > 0
    ? options.radius
    : resolveGroundChunkRadius(definition)

  if (camera) {
    root.updateMatrixWorld(true)
    const cameraWorld = new THREE.Vector3()
    camera.getWorldPosition(cameraWorld)
    const cameraLocal = root.worldToLocal(cameraWorld)
    localX = cameraLocal.x
    localZ = cameraLocal.z
  }

  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const cellSize = definition.cellSize
  const minColumn = clampInclusive(Math.floor((localX - radius + halfWidth) / cellSize), 0, columns)
  const maxColumn = clampInclusive(Math.ceil((localX + radius + halfWidth) / cellSize), 0, columns)
  const minRow = clampInclusive(Math.floor((localZ - radius + halfDepth) / cellSize), 0, rows)
  const maxRow = clampInclusive(Math.ceil((localZ + radius + halfDepth) / cellSize), 0, rows)
  const minChunkColumn = clampInclusive(Math.floor(minColumn / chunkCells), 0, maxChunkColumnIndex)
  const maxChunkColumn = clampInclusive(Math.floor(maxColumn / chunkCells), 0, maxChunkColumnIndex)
  const minChunkRow = clampInclusive(Math.floor(minRow / chunkCells), 0, maxChunkRowIndex)
  const maxChunkRow = clampInclusive(Math.floor(maxRow / chunkCells), 0, maxChunkRowIndex)

  const keep = new Set<GroundChunkKey>()
  for (let cr = minChunkRow; cr <= maxChunkRow; cr += 1) {
    for (let cc = minChunkColumn; cc <= maxChunkColumn; cc += 1) {
      const runtime = ensureChunkMesh(root, state, definition, cr, cc)
      keep.add(runtime.key)
    }
  }

  state.chunks.forEach((chunk, key) => {
    if (keep.has(key)) {
      return
    }
    disposeChunk(chunk)
    state.chunks.delete(key)
  })
}

export function ensureAllGroundChunks(target: THREE.Object3D, definition: GroundDynamicMesh): void {
  const root = (target as THREE.Group)
  if (!root || !(root as any).isGroup) {
    return
  }
  const state = ensureGroundRuntimeState(root, definition)
  const chunkCells = state.chunkCells
  const rows = Math.max(1, Math.trunc(definition.rows))
  const columns = Math.max(1, Math.trunc(definition.columns))
  const maxChunkRowIndex = Math.max(0, Math.floor((rows - 1) / chunkCells))
  const maxChunkColumnIndex = Math.max(0, Math.floor((columns - 1) / chunkCells))

  for (let cr = 0; cr <= maxChunkRowIndex; cr += 1) {
    for (let cc = 0; cc <= maxChunkColumnIndex; cc += 1) {
      ensureChunkMesh(root, state, definition, cr, cc)
    }
  }
}

export function updateGroundMesh(target: THREE.Object3D, definition: GroundDynamicMesh) {
  if ((target as any)?.isMesh) {
    const mesh = target as THREE.Mesh
    if (!(mesh.geometry instanceof THREE.BufferGeometry)) {
      mesh.geometry = buildGroundGeometry(definition)
    }
    const bufferGeometry = mesh.geometry as THREE.BufferGeometry
    const updated = updateGroundGeometry(bufferGeometry, definition)
    if (!updated) {
      bufferGeometry.dispose()
      mesh.geometry = buildGroundGeometry(definition)
    }
    applyGroundTextureToObject(mesh, definition)
    return
  }

  const group = target as THREE.Group
  if (!(group as any)?.isGroup) {
    return
  }
  ensureGroundRuntimeState(group, definition)
  // Chunks are created on demand via updateGroundChunks(camera).
  // If we already have chunks, refresh their geometry.
  const state = groundRuntimeStateMap.get(group)
  if (state) {
    state.chunks.forEach((entry) => {
      if (entry.mesh.geometry instanceof THREE.BufferGeometry) {
        const ok = updateChunkGeometry(entry.mesh.geometry as THREE.BufferGeometry, definition, entry.spec)
        if (!ok) {
          entry.mesh.geometry.dispose()
          entry.mesh.geometry = buildGroundChunkGeometry(definition, entry.spec)
        }
      }
    })
  }
  applyGroundTextureToObject(group, definition)
}

export function updateGroundMeshRegion(target: THREE.Object3D, definition: GroundDynamicMesh, region: GroundGeometryUpdateRegion): boolean {
  const group = target as THREE.Group
  if (!(group as any)?.isGroup) {
    return false
  }
  const state = groundRuntimeStateMap.get(group)
  if (!state) {
    return false
  }
  let updated = false
  state.chunks.forEach((entry) => {
    const overlaps = !(
      region.maxRow < entry.spec.startRow ||
      region.minRow > entry.spec.startRow + entry.spec.rows ||
      region.maxColumn < entry.spec.startColumn ||
      region.minColumn > entry.spec.startColumn + entry.spec.columns
    )
    if (!overlaps) {
      return
    }
    const geometry = entry.mesh.geometry
    if (!(geometry instanceof THREE.BufferGeometry)) {
      return
    }
    const ok = updateChunkGeometryRegion(geometry, definition, entry.spec, region)
    updated = updated || ok
  })
  return updated
}

export function releaseGroundMeshCache(disposeResources = true) {
  if (!cachedPrototypeMesh) {
    return
  }
  cachedPrototypeMesh.removeFromParent()
  if (disposeResources) {
    cachedPrototypeMesh.geometry?.dispose?.()
    const material = cachedPrototypeMesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose?.())
    } else {
      material?.dispose?.()
    }
  }
  cachedPrototypeMesh = null
}
