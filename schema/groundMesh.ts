import * as THREE from 'three'
import { type GroundDynamicMesh, type GroundGenerationSettings, type GroundHeightMap, type GroundSculptOperation } from './index'

import { ensureTerrainPaintPreviewInstalled } from './terrainPaintPreview'
import { computeGroundBaseHeightAtVertex, normalizeGroundGenerationSettings } from './groundGeneration'

const textureLoader = new THREE.TextureLoader()

const DEFAULT_GROUND_CHUNK_CELLS = 100
const DEFAULT_GROUND_CHUNK_RADIUS_METERS = 200

type GroundChunkKey = string

type GroundChunkSpec = {
  startRow: number
  startColumn: number
  rows: number
  columns: number
}

type GroundChunkRuntime = {
  key: GroundChunkKey
  chunkRow: number
  chunkColumn: number
  spec: GroundChunkSpec
  mesh: THREE.Mesh
}

type GroundRuntimeState = {
  definitionSignature: string
  chunkCells: number
  castShadow: boolean
  chunks: Map<GroundChunkKey, GroundChunkRuntime>
  lastChunkUpdateAt: number

  desiredSignature: string
  lastCameraLocalX: number
  lastCameraLocalZ: number

  pendingCreates: Array<{ key: GroundChunkKey; chunkRow: number; chunkColumn: number; priority: number; distSq: number }>
  pendingDestroys: Array<{ key: GroundChunkKey; distSq: number }>

  meshPool: Map<string, THREE.Mesh[]>
  poolMaxPerSize: number
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

export function resolveGroundChunkCells(definition: GroundDynamicMesh): number {
  return resolveChunkCells(definition)
}

export function resolveGroundChunkRadiusMeters(definition: GroundDynamicMesh): number {
  return resolveGroundChunkRadius(definition)
}

function resolveGroundChunkRadius(definition: GroundDynamicMesh): number {
  // Default to a moderate radius; keep streaming window smaller by default.
  const width = Number.isFinite(definition.width) ? definition.width : 0
  const depth = Number.isFinite(definition.depth) ? definition.depth : 0
  const halfDiagonal = Math.sqrt(Math.max(0, width) ** 2 + Math.max(0, depth) ** 2) * 0.5
  // Bound the streaming radius so we don't accidentally load the entire ground for mid-sized scenes.
  // Keep a small minimum to avoid thrashing when the camera jitters.
  return Math.max(80, Math.min(2000, Math.min(DEFAULT_GROUND_CHUNK_RADIUS_METERS, halfDiagonal)))
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

function getManualVertexHeight(definition: GroundDynamicMesh, row: number, column: number): number {
  const key = groundVertexKey(row, column)
  const raw = definition.manualHeightMap[key]
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw
  }
  return computeGroundBaseHeightAtVertex(definition, row, column)
}

function getPlanningVertexHeight(definition: GroundDynamicMesh, row: number, column: number): number {
  const key = groundVertexKey(row, column)
  const raw = definition.planningHeightMap[key]
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw
  }
  return computeGroundBaseHeightAtVertex(definition, row, column)
}

export function resolveGroundEffectiveHeightAtVertex(definition: GroundDynamicMesh, row: number, column: number): number {
  const base = computeGroundBaseHeightAtVertex(definition, row, column)
  const manual = getManualVertexHeight(definition, row, column)
  const planning = getPlanningVertexHeight(definition, row, column)
  return planning + (manual - base)
}

function setHeightOverrideValue(definition: GroundDynamicMesh, map: GroundHeightMap, row: number, column: number, value: number): void {
  const key = groundVertexKey(row, column)
  const baseHeight = computeGroundBaseHeightAtVertex(definition, row, column)
  let rounded = Math.round(value * 100) / 100
  let baseRounded = Math.round(baseHeight * 100) / 100
  if (Object.is(rounded, -0)) rounded = 0
  if (Object.is(baseRounded, -0)) baseRounded = 0
  if (rounded === baseRounded) {
    delete map[key]
    return
  }
  map[key] = rounded
}

export function setManualHeightOverrideValue(definition: GroundDynamicMesh, map: GroundHeightMap, row: number, column: number, value: number): void {
  setHeightOverrideValue(definition, map, row, column, value)
}

export function setPlanningHeightOverrideValue(definition: GroundDynamicMesh, map: GroundHeightMap, row: number, column: number, value: number): void {
  setHeightOverrideValue(definition, map, row, column, value)
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
      sum += resolveGroundEffectiveHeightAtVertex(definition, r, c)
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
  return resolveGroundEffectiveHeightAtVertex(definition, localRow, localColumn)
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
      const height = resolveGroundEffectiveHeightAtVertex(definition, row, column)

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
      const height = resolveGroundEffectiveHeightAtVertex(definition, row, column)

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
  const desiredCastShadow = definition.castShadow === true
  if (existing && existing.definitionSignature === signature && existing.chunkCells === chunkCells) {
    if (existing.castShadow !== desiredCastShadow) {
      existing.castShadow = desiredCastShadow
      for (const runtime of existing.chunks.values()) {
        runtime.mesh.castShadow = desiredCastShadow
      }
    }
    return existing
  }

  if (existing) {
    existing.chunks.forEach((entry) => {
      entry.mesh.geometry?.dispose?.()
      // Materials are managed externally (SceneGraph/editor), do not dispose here.
      entry.mesh.removeFromParent()
    })

    existing.meshPool.forEach((entries) => {
      entries.forEach((mesh) => {
        try {
          ;(mesh.geometry as any)?.dispose?.()
        } catch (_error) {
          /* noop */
        }
      })
    })
    existing.meshPool.clear()
    existing.pendingCreates = []
    existing.pendingDestroys = []
  }

  const next: GroundRuntimeState = {
    definitionSignature: signature,
    chunkCells,
    castShadow: desiredCastShadow,
    chunks: new Map(),
    lastChunkUpdateAt: 0,

    desiredSignature: '',
    lastCameraLocalX: 0,
    lastCameraLocalZ: 0,

    pendingCreates: [],
    pendingDestroys: [],

    meshPool: new Map(),
    poolMaxPerSize: 8,
  }
  groundRuntimeStateMap.set(root, next)
  return next
}

function chunkPoolKey(spec: GroundChunkSpec): string {
  const rows = Math.max(1, Math.trunc(spec.rows))
  const columns = Math.max(1, Math.trunc(spec.columns))
  return `${rows}x${columns}`
}

function releaseChunkToPool(state: GroundRuntimeState, runtime: GroundChunkRuntime): void {
  const geometry = runtime.mesh.geometry
  if (!(geometry instanceof THREE.BufferGeometry)) {
    disposeChunk(runtime)
    return
  }

  const key = chunkPoolKey(runtime.spec)
  const bucket = state.meshPool.get(key) ?? []
  if (bucket.length >= Math.max(0, Math.trunc(state.poolMaxPerSize))) {
    disposeChunk(runtime)
    return
  }

  runtime.mesh.removeFromParent()
  runtime.mesh.visible = false
  bucket.push(runtime.mesh)
  state.meshPool.set(key, bucket)
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
  const cachedMaterialValue = (root.userData as Record<string, unknown> | undefined)?.groundMaterial
  const cachedMaterial = Array.isArray(cachedMaterialValue)
    ? (cachedMaterialValue[0] as THREE.Material | undefined)
    : (cachedMaterialValue as THREE.Material | undefined)

  let material: THREE.Material | undefined = cachedMaterial
  if (!material) {
    const firstExistingChunk = state.chunks.values().next().value as GroundChunkRuntime | undefined
    const existingMaterial = firstExistingChunk?.mesh?.material
    material = Array.isArray(existingMaterial) ? (existingMaterial[0] as THREE.Material | undefined) : (existingMaterial as THREE.Material | undefined)
  }

  if (!material && cachedPrototypeMesh) {
    const prototypeMaterial = cachedPrototypeMesh.material
    material = Array.isArray(prototypeMaterial)
      ? (prototypeMaterial[0] as THREE.Material | undefined)
      : (prototypeMaterial as THREE.Material | undefined)
  }

  // Fallback placeholder (shared material should be set/cached by SceneGraph/editor).
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color: '#707070',
      roughness: 1.0,
      metalness: 0.1,
    })
  }

  const poolKey = chunkPoolKey(spec)
  const pool = state.meshPool.get(poolKey)
  const pooledMesh = pool && pool.length ? pool.pop() : undefined
  if (pool && pool.length === 0) {
    state.meshPool.delete(poolKey)
  }

  const mesh = pooledMesh ?? new THREE.Mesh(buildGroundChunkGeometry(definition, spec), material)
  if (mesh.material !== material) {
    mesh.material = material
  }

  // If we reused a pooled mesh, refresh its geometry for the new chunk spec.
  if (pooledMesh) {
    const bufferGeometry = mesh.geometry
    if (bufferGeometry instanceof THREE.BufferGeometry) {
      const ok = updateChunkGeometry(bufferGeometry, definition, spec)
      if (!ok) {
        bufferGeometry.dispose()
        mesh.geometry = buildGroundChunkGeometry(definition, spec)
      }
    } else {
      mesh.geometry = buildGroundChunkGeometry(definition, spec)
    }
  }

  mesh.name = `GroundChunk:${chunkRow},${chunkColumn}`
  mesh.receiveShadow = true
  mesh.castShadow = state.castShadow
  mesh.userData.dynamicMeshType = 'Ground'
  mesh.userData.groundChunk = { ...spec, chunkRow, chunkColumn }
  mesh.visible = true
  root.add(mesh)
  const runtime: GroundChunkRuntime = { key, chunkRow, chunkColumn, spec, mesh }
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

type GroundChunkBudget = {
  maxCreatePerUpdate?: number
  maxDestroyPerUpdate?: number
  maxMs?: number
}

export function applyGroundGeneration(
  definition: GroundDynamicMesh,
  settings: GroundGenerationSettings,
): GroundGenerationSettings {
  const normalized = normalizeGroundGenerationSettings(settings)
  definition.generation = normalized
  // Generation is evaluated on demand; keep explicit edits as sparse absolute overrides.
  definition.planningHeightMap = {}
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
  let heightMap = definition.manualHeightMap

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

            const currentHeight = resolveGroundEffectiveHeightAtVertex(definition, row, col)
            let nextHeight = currentHeight

            if (operation === 'smooth') {
              const average = sampleNeighborAverage(definition, row, col, rows, columns)
              const smoothingFactor = Math.min(1, strength * 0.25)
              nextHeight = currentHeight + (average - currentHeight) * smoothingFactor * influence
            } else if (operation === 'flatten') {
              const reference = targetHeight ?? currentHeight
              const flattenFactor = Math.min(1, strength * 0.4)
              nextHeight = currentHeight + (reference - currentHeight) * flattenFactor * influence
            } else if (operation === 'flatten-zero') {
              const reference = targetHeight ?? 0
              const flattenFactor = Math.min(1, 0.2 + strength * 0.3)
              nextHeight = currentHeight + (reference - currentHeight) * flattenFactor * influence
            } else {
              const direction = operation === 'depress' ? -1 : 1
              const offset = direction * strength * influence * 0.3
              nextHeight = currentHeight + offset
            }

            setHeightOverrideValue(definition, heightMap, row, col, nextHeight)
            modified = true
          }
      }
  }
  if (operation === 'flatten-zero') {
    const smoothingBand = Math.max(cellSize * 1.5, radius * 0.35)
    if (smoothingBand > 0) {
      const bandRows = Math.ceil(smoothingBand / cellSize)
      const smoothingRadius = radius + smoothingBand
      const smoothingStrengthBase = Math.min(1, 0.2 + strength * 0.15)
      const smoothingMinRow = Math.max(0, minRow - bandRows)
      const smoothingMaxRow = Math.min(rows, maxRow + bandRows)
      const smoothingMinCol = Math.max(0, minCol - bandRows)
      const smoothingMaxCol = Math.min(columns, maxCol + bandRows)
      for (let row = smoothingMinRow; row <= smoothingMaxRow; row++) {
        for (let col = smoothingMinCol; col <= smoothingMaxCol; col++) {
          const x = -halfWidth + col * cellSize
          const z = -halfDepth + row * cellSize
          const dx = x - localX
          const dz = z - localZ
          const dist = Math.sqrt(dx * dx + dz * dz)
          if (dist <= radius || dist > smoothingRadius) {
            continue
          }
          const taper = 1 - (dist - radius) / smoothingBand
          const smoothingFactor = smoothingStrengthBase * taper
          if (smoothingFactor <= 0) {
            continue
          }
          const currentHeight = resolveGroundEffectiveHeightAtVertex(definition, row, col)
          const average = sampleNeighborAverage(definition, row, col, rows, columns)
          const smoothedHeight = currentHeight + (average - currentHeight) * smoothingFactor
          setHeightOverrideValue(definition, heightMap, row, col, smoothedHeight)
          modified = true
        }
      }
    }
  }
  if (modified) {
    definition.manualHeightMap = heightMap
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
      const height = resolveGroundEffectiveHeightAtVertex(definition, row, column)

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
      const height = resolveGroundEffectiveHeightAtVertex(definition, row, column)
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
  options: { computeNormals?: boolean } = {},
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
      const height = resolveGroundEffectiveHeightAtVertex(definition, row, column)
      positionAttr.setXYZ(vertexIndex, x, height, z)
    }
  }
  positionAttr.needsUpdate = true
  if (options.computeNormals !== false) {
    geometry.computeVertexNormals()
  }
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
  // Avoid using the default chunk radius here; that can load too many chunks on creation.
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  const seedRadius = Math.max(50, resolveChunkCells(definition) * cellSize * 1.5)
  updateGroundChunks(group, definition, null, { radius: seedRadius })
  applyGroundTextureToObject(group, definition)
  return group
}

export function setGroundMaterial(target: THREE.Object3D, material: THREE.Material | THREE.Material[]): void {
  const resolvedMaterial = Array.isArray(material) ? material[0] : material
  if (!resolvedMaterial) {
    return
  }

  const userData = (target.userData ??= {}) as Record<string, unknown>
  userData.groundMaterial = resolvedMaterial

  target.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      mesh.material = resolvedMaterial
    }
  })
}

export function updateGroundChunks(
  target: THREE.Object3D,
  definition: GroundDynamicMesh,
  camera: THREE.Camera | null,
  options: {
    radius?: number
    budget?: GroundChunkBudget | null
    force?: boolean
    minIntervalMs?: number
    minCameraMoveMeters?: number
  } = {},
): void {  
  const root = resolveGroundRuntimeGroup(target)
  if (!root) {
    return
  }

  const terrainPaintSettings = (root.userData as any)?.__terrainPaintSettings ?? undefined
  const state = ensureGroundRuntimeState(root, definition)
  const now = Date.now()
  const force = options.force === true
  const minIntervalMs = Math.max(0, Math.trunc(Number.isFinite(options.minIntervalMs as number) ? (options.minIntervalMs as number) : 120))

  const chunkCells = state.chunkCells
  const rows = Math.max(1, Math.trunc(definition.rows))
  const columns = Math.max(1, Math.trunc(definition.columns))
  const maxChunkRowIndex = Math.max(0, Math.floor((rows - 1) / chunkCells))
  const maxChunkColumnIndex = Math.max(0, Math.floor((columns - 1) / chunkCells))

  let localX = 0
  let localZ = 0
  const loadRadius = typeof options.radius === 'number' && Number.isFinite(options.radius) && options.radius > 0
    ? options.radius
    : resolveGroundChunkRadius(definition)

  // Retain chunks slightly beyond the load radius to reduce popping/churn when the camera
  // hovers near a chunk boundary.
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  const unloadRadius = loadRadius + Math.max(1, chunkCells) * cellSize

  if (camera) {
    root.updateMatrixWorld(true)
    const cameraWorld = new THREE.Vector3()
    camera.getWorldPosition(cameraWorld)
    const cameraLocal = root.worldToLocal(cameraWorld)
    localX = cameraLocal.x
    localZ = cameraLocal.z
  }

  const dxMoved = localX - (state.lastCameraLocalX ?? 0)
  const dzMoved = localZ - (state.lastCameraLocalZ ?? 0)
  const movedSq = dxMoved * dxMoved + dzMoved * dzMoved
  const chunkWorldSize = Math.max(1, chunkCells) * cellSize
  const moveThreshold = Number.isFinite(options.minCameraMoveMeters as number)
    ? Math.max(0, Number(options.minCameraMoveMeters))
    : Math.max(cellSize * 2, chunkWorldSize * 0.25)
  const moveThresholdSq = moveThreshold * moveThreshold

  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const minLoadColumn = clampInclusive(Math.floor((localX - loadRadius + halfWidth) / cellSize), 0, columns)
  const maxLoadColumn = clampInclusive(Math.ceil((localX + loadRadius + halfWidth) / cellSize), 0, columns)
  const minLoadRow = clampInclusive(Math.floor((localZ - loadRadius + halfDepth) / cellSize), 0, rows)
  const maxLoadRow = clampInclusive(Math.ceil((localZ + loadRadius + halfDepth) / cellSize), 0, rows)

  const minUnloadColumn = clampInclusive(Math.floor((localX - unloadRadius + halfWidth) / cellSize), 0, columns)
  const maxUnloadColumn = clampInclusive(Math.ceil((localX + unloadRadius + halfWidth) / cellSize), 0, columns)
  const minUnloadRow = clampInclusive(Math.floor((localZ - unloadRadius + halfDepth) / cellSize), 0, rows)
  const maxUnloadRow = clampInclusive(Math.ceil((localZ + unloadRadius + halfDepth) / cellSize), 0, rows)

  const minLoadChunkColumn = clampInclusive(Math.floor(minLoadColumn / chunkCells), 0, maxChunkColumnIndex)
  const maxLoadChunkColumn = clampInclusive(Math.floor(maxLoadColumn / chunkCells), 0, maxChunkColumnIndex)
  const minLoadChunkRow = clampInclusive(Math.floor(minLoadRow / chunkCells), 0, maxChunkRowIndex)
  const maxLoadChunkRow = clampInclusive(Math.floor(maxLoadRow / chunkCells), 0, maxChunkRowIndex)

  const minUnloadChunkColumn = clampInclusive(Math.floor(minUnloadColumn / chunkCells), 0, maxChunkColumnIndex)
  const maxUnloadChunkColumn = clampInclusive(Math.floor(maxUnloadColumn / chunkCells), 0, maxChunkColumnIndex)
  const minUnloadChunkRow = clampInclusive(Math.floor(minUnloadRow / chunkCells), 0, maxChunkRowIndex)
  const maxUnloadChunkRow = clampInclusive(Math.floor(maxUnloadRow / chunkCells), 0, maxChunkRowIndex)

  const nextDesiredSignature = [
    chunkCells,
    minLoadChunkRow,
    maxLoadChunkRow,
    minLoadChunkColumn,
    maxLoadChunkColumn,
    minUnloadChunkRow,
    maxUnloadChunkRow,
    minUnloadChunkColumn,
    maxUnloadChunkColumn,
    Math.round(loadRadius * 1000),
  ].join('|')
  const desiredWindowChanged = nextDesiredSignature !== state.desiredSignature
  const hasPendingWork = state.pendingCreates.length > 0 || state.pendingDestroys.length > 0

  // Force mode should at least guarantee the camera's core chunk exists.
  let allowBypassInterval = false
  if (force && camera) {
    const cameraColumn = clampInclusive(Math.floor((localX + halfWidth) / cellSize), 0, columns)
    const cameraRow = clampInclusive(Math.floor((localZ + halfDepth) / cellSize), 0, rows)
    const cameraChunkColumn = clampInclusive(Math.floor(cameraColumn / chunkCells), 0, maxChunkColumnIndex)
    const cameraChunkRow = clampInclusive(Math.floor(cameraRow / chunkCells), 0, maxChunkRowIndex)
    const coreKey = groundChunkKey(cameraChunkRow, cameraChunkColumn)
    if (!state.chunks.has(coreKey)) {
      allowBypassInterval = true
    }
  }

  if (!allowBypassInterval && now - state.lastChunkUpdateAt < minIntervalMs) {
    return
  }

  if (!force) {
    // Only update when the camera moved enough (or when we have pending work).
    if (!hasPendingWork && !desiredWindowChanged && movedSq < moveThresholdSq) {
      return
    }
  }

  state.lastChunkUpdateAt = now
  state.lastCameraLocalX = localX
  state.lastCameraLocalZ = localZ

  // Rebuild pending queues when the desired window changes.
  if (nextDesiredSignature !== state.desiredSignature) {
    state.desiredSignature = nextDesiredSignature

    // Create queue (nearest-first).
    const creates: Array<{ key: GroundChunkKey; chunkRow: number; chunkColumn: number; priority: number; distSq: number }> = []

    // Prefer a 3x3 core around the camera chunk in force mode.
    let forceCore: Set<string> | null = null
    if (force && camera) {
      const cameraColumn = clampInclusive(Math.floor((localX + halfWidth) / cellSize), 0, columns)
      const cameraRow = clampInclusive(Math.floor((localZ + halfDepth) / cellSize), 0, rows)
      const cameraChunkColumn = clampInclusive(Math.floor(cameraColumn / chunkCells), 0, maxChunkColumnIndex)
      const cameraChunkRow = clampInclusive(Math.floor(cameraRow / chunkCells), 0, maxChunkRowIndex)
      forceCore = new Set<string>()
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const cr = cameraChunkRow + dr
          const cc = cameraChunkColumn + dc
          if (cr < minLoadChunkRow || cr > maxLoadChunkRow || cc < minLoadChunkColumn || cc > maxLoadChunkColumn) {
            continue
          }
          forceCore.add(groundChunkKey(cr, cc))
        }
      }
    }

    for (let cr = minLoadChunkRow; cr <= maxLoadChunkRow; cr += 1) {
      for (let cc = minLoadChunkColumn; cc <= maxLoadChunkColumn; cc += 1) {
        const key = groundChunkKey(cr, cc)
        if (state.chunks.has(key)) {
          continue
        }

        const spec = computeChunkSpec(definition, cr, cc, chunkCells)
        const centerX = -halfWidth + (spec.startColumn + spec.columns * 0.5) * cellSize
        const centerZ = -halfDepth + (spec.startRow + spec.rows * 0.5) * cellSize
        const dx = centerX - localX
        const dz = centerZ - localZ
        const priority = forceCore && forceCore.has(key) ? -1 : 0
        creates.push({ key, chunkRow: cr, chunkColumn: cc, priority, distSq: dx * dx + dz * dz })
      }
    }

    creates.sort((a, b) => (a.priority - b.priority) || (a.distSq - b.distSq))
    state.pendingCreates = creates

    // Destroy queue (farthest-first outside unload radius).
    const destroys: Array<{ key: GroundChunkKey; distSq: number }> = []
    state.chunks.forEach((entry, key) => {
      if (
        entry.chunkRow >= minUnloadChunkRow &&
        entry.chunkRow <= maxUnloadChunkRow &&
        entry.chunkColumn >= minUnloadChunkColumn &&
        entry.chunkColumn <= maxUnloadChunkColumn
      ) {
        return
      }
      const spec = entry.spec
      const centerX = -halfWidth + (spec.startColumn + spec.columns * 0.5) * cellSize
      const centerZ = -halfDepth + (spec.startRow + spec.rows * 0.5) * cellSize
      const dx = centerX - localX
      const dz = centerZ - localZ
      destroys.push({ key, distSq: dx * dx + dz * dz })
    })
    destroys.sort((a, b) => b.distSq - a.distSq)
    state.pendingDestroys = destroys
  } else {
    // Drop stale pending work.
    if (state.pendingCreates.length) {
      state.pendingCreates = state.pendingCreates.filter((entry) => !state.chunks.has(entry.key))
    }
    if (state.pendingDestroys.length) {
      state.pendingDestroys = state.pendingDestroys.filter((entry) => state.chunks.has(entry.key))
    }
  }

  const defaultBudget: GroundChunkBudget | null = camera
    ? ({ maxCreatePerUpdate: 6, maxDestroyPerUpdate: 8 } satisfies GroundChunkBudget)
    : null
  const effectiveBudget: GroundChunkBudget | null = options.budget === undefined ? defaultBudget : (options.budget as GroundChunkBudget | null)
  const maxCreate = effectiveBudget ? (Number.isFinite(effectiveBudget.maxCreatePerUpdate as number) ? Math.max(0, Math.trunc(effectiveBudget.maxCreatePerUpdate as number)) : Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY
  const maxDestroy = effectiveBudget ? (Number.isFinite(effectiveBudget.maxDestroyPerUpdate as number) ? Math.max(0, Math.trunc(effectiveBudget.maxDestroyPerUpdate as number)) : Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY
  const maxMs = effectiveBudget ? (Number.isFinite(effectiveBudget.maxMs as number) ? Math.max(0, Number(effectiveBudget.maxMs)) : Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY
  const budgetStart = Date.now()

  const withinTimeBudget = () => (Date.now() - budgetStart) <= maxMs

  // Load chunks within the tighter load radius (nearest-first).
  let stitchRegion: GroundGeometryUpdateRegion | null = null
  let needsTerrainPaintRebind = false
  const mergeRegion = (current: GroundGeometryUpdateRegion | null, next: GroundGeometryUpdateRegion): GroundGeometryUpdateRegion => {
    if (!current) {
      return { ...next }
    }
    return {
      minRow: Math.min(current.minRow, next.minRow),
      maxRow: Math.max(current.maxRow, next.maxRow),
      minColumn: Math.min(current.minColumn, next.minColumn),
      maxColumn: Math.max(current.maxColumn, next.maxColumn),
    }
  }

  let createdCount = 0
  if (state.pendingCreates.length && maxCreate > 0) {
    const pending = state.pendingCreates
    let processed = 0
    for (processed = 0; processed < pending.length; processed += 1) {
      if (createdCount >= maxCreate || !withinTimeBudget()) {
        break
      }
      const entry = pending[processed]!
      if (state.chunks.has(entry.key)) {
        continue
      }
      const runtime = ensureChunkMesh(root, state, definition, entry.chunkRow, entry.chunkColumn)
      createdCount += 1

      stitchRegion = mergeRegion(stitchRegion, {
        minRow: runtime.spec.startRow,
        maxRow: runtime.spec.startRow + Math.max(1, runtime.spec.rows),
        minColumn: runtime.spec.startColumn,
        maxColumn: runtime.spec.startColumn + Math.max(1, runtime.spec.columns),
      })

      if (terrainPaintSettings) {
        needsTerrainPaintRebind = true
      }
    }

    // Keep remaining items (and drop any that got created).
    state.pendingCreates = pending
      .slice(processed)
      .filter((entry) => !state.chunks.has(entry.key))
  }

  if (needsTerrainPaintRebind) {
    ensureTerrainPaintPreviewInstalled(root, definition, terrainPaintSettings)
  }

  // Unload chunks outside the unload radius with a budget.
  let destroyedCount = 0
  if (state.pendingDestroys.length && maxDestroy > 0) {
    const pending = state.pendingDestroys
    let processed = 0
    for (processed = 0; processed < pending.length; processed += 1) {
      if (destroyedCount >= maxDestroy || !withinTimeBudget()) {
        break
      }
      const entry = pending[processed]!
      const runtime = state.chunks.get(entry.key)
      if (!runtime) {
        continue
      }
      releaseChunkToPool(state, runtime)
      state.chunks.delete(entry.key)
      destroyedCount += 1
    }
    state.pendingDestroys = pending
      .slice(processed)
      .filter((entry) => state.chunks.has(entry.key))
  }

  // Newly created chunks compute normals in isolation; stitch boundaries to avoid visible seams.
  if (stitchRegion) {
    stitchGroundChunkNormals(root, definition, stitchRegion)
  }
}

export function ensureAllGroundChunks(target: THREE.Object3D, definition: GroundDynamicMesh): void {
  const root = resolveGroundRuntimeGroup(target)
  if (!root) {
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

  const group = resolveGroundRuntimeGroup(target)
  if (!group) {
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

function resolveGroundRuntimeGroup(target: THREE.Object3D): THREE.Group | null {
  if (!target) {
    return null
  }

  const userData = (target as any).userData as Record<string, unknown> | undefined

  const fromUserData = (userData as any)?.groundMesh as THREE.Object3D | undefined
  if (fromUserData && (fromUserData as any).isGroup && groundRuntimeStateMap.get(fromUserData)) {
    // If a caller mistakenly created chunk runtime state on the container (instead of the
    // canonical groundMesh group), purge it to avoid duplicate overlapping meshes.
    if (fromUserData !== target) {
      const orphanState = groundRuntimeStateMap.get(target)
      if (orphanState) {
        orphanState.chunks.forEach((entry) => disposeChunk(entry))
        orphanState.chunks.clear()
        groundRuntimeStateMap.delete(target)
      }
    }
    if (userData) {
      ;(userData as any).__harmonyGroundRuntimeGroup = fromUserData
    }
    return fromUserData as THREE.Group
  }

  const cached = userData?.__harmonyGroundRuntimeGroup as THREE.Object3D | undefined
  if (cached && (cached as any).isGroup && groundRuntimeStateMap.get(cached)) {
    return cached as THREE.Group
  }

  if ((target as any).isGroup && groundRuntimeStateMap.get(target)) {
    if (userData) {
      ;(userData as any).__harmonyGroundRuntimeGroup = target
    }
    return target as THREE.Group
  }

  let found: THREE.Group | null = null
  target.traverse((child) => {
    if (found) {
      return
    }
    if ((child as any).isGroup && groundRuntimeStateMap.get(child)) {
      found = child as THREE.Group
    }
  })

  if (found && userData) {
    ;(userData as any).__harmonyGroundRuntimeGroup = found
  }
  return found
}

export function updateGroundMeshRegion(
  target: THREE.Object3D,
  definition: GroundDynamicMesh,
  region: GroundGeometryUpdateRegion,
  options: { computeNormals?: boolean } = {},
): boolean {
  const group = resolveGroundRuntimeGroup(target)
  if (!group) {
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
    const ok = updateChunkGeometryRegion(geometry, definition, entry.spec, region, options)
    updated = updated || ok
  })
  return updated
}

function averageNormalsOnEdge(params: {
  geometryA: THREE.BufferGeometry
  specA: GroundChunkSpec
  geometryB: THREE.BufferGeometry
  specB: GroundChunkSpec
  mode: 'right' | 'down'
}): boolean {
  const { geometryA, specA, geometryB, specB, mode } = params
  const normalAttrA = geometryA.getAttribute('normal') as THREE.BufferAttribute | undefined
  const normalAttrB = geometryB.getAttribute('normal') as THREE.BufferAttribute | undefined
  if (!normalAttrA || !normalAttrB) {
    return false
  }
  const normalsA = normalAttrA.array as Float32Array
  const normalsB = normalAttrB.array as Float32Array
  if (!(normalsA instanceof Float32Array) || !(normalsB instanceof Float32Array)) {
    return false
  }

  const colsA = Math.max(1, Math.trunc(specA.columns))
  const rowsA = Math.max(1, Math.trunc(specA.rows))
  const colsB = Math.max(1, Math.trunc(specB.columns))
  const rowsB = Math.max(1, Math.trunc(specB.rows))
  const vertexColumnsA = colsA + 1
  const vertexColumnsB = colsB + 1

  let touched = false
  if (mode === 'right') {
    const edgeColumnA = specA.startColumn + colsA
    if (edgeColumnA !== specB.startColumn) {
      return false
    }
    const rowStart = Math.max(specA.startRow, specB.startRow)
    const rowEnd = Math.min(specA.startRow + rowsA, specB.startRow + rowsB)
    for (let row = rowStart; row <= rowEnd; row += 1) {
      const localRowA = row - specA.startRow
      const localRowB = row - specB.startRow
      const idxA = localRowA * vertexColumnsA + colsA
      const idxB = localRowB * vertexColumnsB + 0
      const a3 = idxA * 3
      const b3 = idxB * 3
      if (a3 + 2 >= normalsA.length || b3 + 2 >= normalsB.length) {
        continue
      }
      const ax = normalsA[a3] ?? 0
      const ay = normalsA[a3 + 1] ?? 0
      const az = normalsA[a3 + 2] ?? 0
      const bx = normalsB[b3] ?? 0
      const by = normalsB[b3 + 1] ?? 0
      const bz = normalsB[b3 + 2] ?? 0
      let nx = ax + bx
      let ny = ay + by
      let nz = az + bz
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len
      ny /= len
      nz /= len
      normalsA[a3] = nx
      normalsA[a3 + 1] = ny
      normalsA[a3 + 2] = nz
      normalsB[b3] = nx
      normalsB[b3 + 1] = ny
      normalsB[b3 + 2] = nz
      touched = true
    }
  } else {
    const edgeRowA = specA.startRow + rowsA
    if (edgeRowA !== specB.startRow) {
      return false
    }
    const colStart = Math.max(specA.startColumn, specB.startColumn)
    const colEnd = Math.min(specA.startColumn + colsA, specB.startColumn + colsB)
    for (let col = colStart; col <= colEnd; col += 1) {
      const localColA = col - specA.startColumn
      const localColB = col - specB.startColumn
      const idxA = rowsA * vertexColumnsA + localColA
      const idxB = 0 * vertexColumnsB + localColB
      const a3 = idxA * 3
      const b3 = idxB * 3
      if (a3 + 2 >= normalsA.length || b3 + 2 >= normalsB.length) {
        continue
      }
      const ax = normalsA[a3] ?? 0
      const ay = normalsA[a3 + 1] ?? 0
      const az = normalsA[a3 + 2] ?? 0
      const bx = normalsB[b3] ?? 0
      const by = normalsB[b3 + 1] ?? 0
      const bz = normalsB[b3 + 2] ?? 0
      let nx = ax + bx
      let ny = ay + by
      let nz = az + bz
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len
      ny /= len
      nz /= len
      normalsA[a3] = nx
      normalsA[a3 + 1] = ny
      normalsA[a3 + 2] = nz
      normalsB[b3] = nx
      normalsB[b3 + 1] = ny
      normalsB[b3 + 2] = nz
      touched = true
    }
  }

  if (touched) {
    normalAttrA.needsUpdate = true
    normalAttrB.needsUpdate = true
  }
  return touched
}

export function stitchGroundChunkNormals(
  target: THREE.Object3D,
  definition: GroundDynamicMesh,
  region: GroundGeometryUpdateRegion | null = null,
): boolean {
  const group = resolveGroundRuntimeGroup(target)
  if (!group) {
    return false
  }
  const state = groundRuntimeStateMap.get(group)
  if (!state) {
    return false
  }
  const chunkCells = state.chunkCells
  const rows = Math.max(1, Math.trunc(definition.rows))
  const columns = Math.max(1, Math.trunc(definition.columns))
  const maxChunkRowIndex = Math.max(0, Math.floor((rows - 1) / chunkCells))
  const maxChunkColumnIndex = Math.max(0, Math.floor((columns - 1) / chunkCells))

  let minChunkRow = 0
  let maxChunkRow = maxChunkRowIndex
  let minChunkColumn = 0
  let maxChunkColumn = maxChunkColumnIndex
  if (region) {
    minChunkRow = clampInclusive(Math.floor(region.minRow / chunkCells) - 1, 0, maxChunkRowIndex)
    maxChunkRow = clampInclusive(Math.floor(region.maxRow / chunkCells) + 1, 0, maxChunkRowIndex)
    minChunkColumn = clampInclusive(Math.floor(region.minColumn / chunkCells) - 1, 0, maxChunkColumnIndex)
    maxChunkColumn = clampInclusive(Math.floor(region.maxColumn / chunkCells) + 1, 0, maxChunkColumnIndex)
  }

  let stitched = false
  for (let r = minChunkRow; r <= maxChunkRow; r += 1) {
    for (let c = minChunkColumn; c <= maxChunkColumn; c += 1) {
      const current = state.chunks.get(groundChunkKey(r, c))
      if (!current) {
        continue
      }
      const geometryA = current.mesh.geometry
      if (!(geometryA instanceof THREE.BufferGeometry)) {
        continue
      }
      // Stitch with right neighbor.
      const right = state.chunks.get(groundChunkKey(r, c + 1))
      if (right && right.mesh.geometry instanceof THREE.BufferGeometry) {
        stitched = averageNormalsOnEdge({
          geometryA,
          specA: current.spec,
          geometryB: right.mesh.geometry,
          specB: right.spec,
          mode: 'right',
        }) || stitched
      }
      // Stitch with down neighbor.
      const down = state.chunks.get(groundChunkKey(r + 1, c))
      if (down && down.mesh.geometry instanceof THREE.BufferGeometry) {
        stitched = averageNormalsOnEdge({
          geometryA,
          specA: current.spec,
          geometryB: down.mesh.geometry,
          specB: down.spec,
          mode: 'down',
        }) || stitched
      }
    }
  }
  return stitched
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
