import { type GroundDynamicMesh, type GroundGenerationSettings } from '@harmony/schema'

type PerlinNoise3D = (x: number, y: number, z: number) => number
type VoronoiNoise2D = (x: number, z: number) => number

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

function createPerlinNoise(seed?: number): PerlinNoise3D {
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
    const floorX = Math.floor(x)
    const floorY = Math.floor(y)
    const floorZ = Math.floor(z)

    const X = floorX & 255
    const Y = floorY & 255
    const Z = floorZ & 255

    const xf = x - floorX
    const yf = y - floorY
    const zf = z - floorZ

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

function createVoronoiNoise(seed?: number): VoronoiNoise2D {
  const random = seed === undefined ? Math.random : createSeededRandom(Math.floor(seed))
  const cache = new Map<string, VoronoiPoint>()
  const getPoint = (cellX: number, cellZ: number): VoronoiPoint => {
    const key = `${cellX}:${cellZ}`
    let point = cache.get(key)
    if (!point) {
      point = { x: cellX + random(), z: cellZ + random() }
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

export function normalizeGroundGenerationSettings(settings: GroundGenerationSettings): GroundGenerationSettings {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
  const normalizedScale = clamp(Math.abs(settings.noiseScale ?? 40), 1, 10000)
  const normalizedAmplitude = clamp(Math.abs(settings.noiseAmplitude ?? 0), 0, 500)
  const normalizedStrength = clamp(Number.isFinite(settings.noiseStrength ?? 1) ? Math.abs(settings.noiseStrength ?? 1) : 1, 0, 10)
  const detailScale = settings.detailScale && settings.detailScale > 0 ? settings.detailScale : undefined
  const detailAmplitude = settings.detailAmplitude && settings.detailAmplitude > 0 ? settings.detailAmplitude : undefined
  const edgeFalloff = typeof settings.edgeFalloff === 'number' && Number.isFinite(settings.edgeFalloff)
    ? Math.max(0, settings.edgeFalloff)
    : undefined

  return {
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
}

type GenerationRuntime = {
  signature: string
  settings: GroundGenerationSettings
  baseNoise: PerlinNoise3D
  detailNoise: PerlinNoise3D | null
  voronoiNoise: VoronoiNoise2D | null
  useDetail: boolean
  mainScale: number
  detailScale: number
  detailAmplitude: number
  strength: number
  simplePhase: number
}

const generationRuntimeCache = new Map<string, GenerationRuntime>()

function buildGenerationSignature(settings: GroundGenerationSettings): string {
  const seed = settings.seed ?? ''
  const mode = settings.mode ?? 'perlin'
  const noiseScale = settings.noiseScale ?? ''
  const noiseAmplitude = settings.noiseAmplitude ?? ''
  const noiseStrength = settings.noiseStrength ?? ''
  const detailScale = settings.detailScale ?? ''
  const detailAmplitude = settings.detailAmplitude ?? ''
  const edgeFalloff = settings.edgeFalloff ?? ''
  return `${mode}|${seed}|${noiseScale}|${noiseAmplitude}|${noiseStrength}|${detailScale}|${detailAmplitude}|${edgeFalloff}`
}

function getGenerationRuntime(settings: GroundGenerationSettings): GenerationRuntime {
  const signature = buildGenerationSignature(settings)
  const cached = generationRuntimeCache.get(signature)
  if (cached) {
    return cached
  }
  const seed = settings.seed ?? 1337
  const baseNoise = createPerlinNoise(seed)
  const useDetail = Boolean(settings.detailAmplitude && settings.detailScale)
  const detailNoise = useDetail ? createPerlinNoise(seed + 97) : null
  const voronoiNoise = settings.mode === 'voronoi' ? createVoronoiNoise(seed + 211) : null
  const runtime: GenerationRuntime = {
    signature,
    settings,
    baseNoise,
    detailNoise,
    voronoiNoise,
    useDetail,
    mainScale: Math.max(0.001, settings.noiseScale ?? 40),
    detailScale: Math.max(0.001, settings.detailScale ?? (settings.noiseScale ?? 40) * 0.5),
    detailAmplitude: settings.detailAmplitude ?? 0,
    strength: settings.noiseStrength ?? 1,
    simplePhase: (seed ?? 0) * 0.137,
  }
  generationRuntimeCache.set(signature, runtime)
  return runtime
}

function sampleBaseValue(runtime: GenerationRuntime, x: number, z: number): number {
  const u = x / runtime.mainScale
  const v = z / runtime.mainScale
  switch (runtime.settings.mode) {
    case 'simple': {
      const wave = Math.sin(u * 0.6 + runtime.simplePhase) * 0.65 + Math.cos(v * 0.35 + runtime.simplePhase) * 0.45
      return Math.max(-1, Math.min(1, wave))
    }
    case 'ridge': {
      const raw = runtime.baseNoise(u, v, 0.5)
      const ridged = 1 - Math.abs(raw)
      const shaped = ridged * ridged
      return shaped * 2 - 1
    }
    case 'voronoi': {
      const worley = runtime.voronoiNoise ? runtime.voronoiNoise(u, v) : 0
      return worley * 2 - 1
    }
    case 'flat':
      return 0
    case 'perlin':
    default:
      return runtime.baseNoise(u, v, 0.5)
  }
}

export function computeGroundBaseHeightAtVertex(
  mesh: Pick<GroundDynamicMesh, 'columns' | 'rows' | 'cellSize' | 'width' | 'depth' | 'generation'>,
  row: number,
  column: number,
): number {
  const generation = mesh.generation
  if (!generation) {
    return 0
  }
  const normalized = normalizeGroundGenerationSettings(generation)
  const strength = normalized.noiseStrength ?? 1
  if (normalized.mode === 'flat' || normalized.noiseAmplitude === 0 || strength === 0) {
    return 0
  }

  const runtime = getGenerationRuntime(normalized)

  const columns = Math.max(1, Math.trunc(mesh.columns))
  const rows = Math.max(1, Math.trunc(mesh.rows))
  const cellSize = Number.isFinite(mesh.cellSize) && mesh.cellSize > 0 ? mesh.cellSize : 1
  const width = Number.isFinite(mesh.width) && mesh.width > 0 ? mesh.width : columns * cellSize
  const depth = Number.isFinite(mesh.depth) && mesh.depth > 0 ? mesh.depth : rows * cellSize
  const halfWidth = width * 0.5
  const halfDepth = depth * 0.5

  const x = -halfWidth + column * cellSize
  const z = -halfDepth + row * cellSize

  let height = sampleBaseValue(runtime, x, z) * (normalized.noiseAmplitude ?? 0)
  if (runtime.useDetail && runtime.detailNoise) {
    height += runtime.detailNoise(x / runtime.detailScale, z / runtime.detailScale, 0.5) * runtime.detailAmplitude
  }
  height *= runtime.strength

  if (normalized.edgeFalloff && normalized.edgeFalloff > 0) {
    const nx = (column / columns) * 2 - 1
    const nz = (row / rows) * 2 - 1
    const edge = Math.max(Math.abs(nx), Math.abs(nz))
    const falloff = Math.pow(1 - Math.min(1, edge), normalized.edgeFalloff)
    height *= falloff
  }

  return height
}
