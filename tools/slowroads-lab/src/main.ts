import * as THREE from 'three'
import './style.css'
import assetsCatalog from './core/assets-catalog.json'
import { computeBarrierSegments } from './core/barrier'
import { createHeightfield, type Heightfield } from './core/heightfield'
import { degreesToRadians } from './core/noise'
import {
  computePlacements,
  createTreeDensityField,
  type LabPlacements,
  type TreeDensityField,
  type TreePlacement,
} from './core/placement'
import { createRoadProfile, type RoadProfile } from './core/roadProfile'
import { resolveSeedHeadingRad, traceRoadPath } from './core/roadTrace'
import {
  runEnvironmentChecks,
  runMaterialUniformCoverageChecks,
  runSeasonCatalogChecks,
  runSelfChecks,
  runTreeDiscolourationShaderChecks,
  type AssetsCatalogLike,
  type MaterialUniformCheckInput,
  type SelfCheckResult,
} from './core/selfCheck'
import {
  installSlowroadsFog,
  slowroadsFogUniforms,
  slowroadsSkyFogUniforms,
  updateHazeForCamera,
} from './lab/fogPatch'
import { createSky } from './lab/sky'
import { createClouds } from './lab/clouds'
import { createStars } from './lab/stars'
import { createSnow } from './lab/snow'
import { createEnvironmentController, type EnvironmentController } from './lab/environmentController'
import {
  SEASON_CATALOG,
  SEASON_LABELS,
  SHARED_TEXTURES,
  collectSeasonTextureRefs,
  type SeasonId,
  type SeasonTextureRef,
} from './core/seasonCatalog'
import {
  ENVIRONMENT_SKY_DISTANCE,
  ENVIRONMENT_VIEW_DISTANCE,
  TIME_OF_DAY_LABELS,
  WEATHER_LABELS,
  resolveEnvironmentPreset,
  resolveFogDepthBlend,
  resolveSkyFogParams,
  type EnvironmentState,
} from './core/environment'
import { SEASON_PARAMS } from './core/seasonParams'
import {
  BARRIER_RAIL_REGIONS,
  BROADLEAF_CARD_REGIONS,
  bushVariantEntries,
  getConiferCardRegions,
  getGrassEntries,
  gridRegions,
  type SpriteAtlasSpec,
  type SpriteCellRegion,
  type SpriteRegion,
} from './core/spriteRegions'
import { LabAssetStore, type AssetSourceMode } from './lab/assetSource'
import { createCruiseController, createFreeFlyControls, type CruiseController, type FreeFlyControls } from './lab/cruiseCamera'
import {
  createFoliageMesh,
  createFoliageSharedUniforms,
  disposeFoliageMesh,
  setFoliageWindStrength,
  type SpriteInstance,
} from './lab/foliage'
import { createRoadMesh, type RoadMeshHandle } from './lab/roadMesh'
import { createTerrainMaterial, type TerrainMaterialHandle, type TerrainTextureSet } from './lab/terrainMaterial'
import { createTerrainMeshBuilder, type TerrainMeshBuilder } from './lab/terrainMesh'
import { createTreeMeshManager, type TreeMeshManager, type TreeMeshTextures } from './lab/treeMeshes'
import { createWater, type WaterHandle } from './lab/water'
import {
  createLabUi,
  DEFAULT_LAB_SETTINGS,
  type LabChangeKind,
  type LabSettings,
  type LabUiHandle,
} from './ui'

// 必须在任何材质创建之前替换 three 的 fog chunk 并扩展 UniformsLib.fog。
installSlowroadsFog()

const WORLD_SIZE = 1600
const TERRAIN_SEGMENTS = 1024
const SKY_COLOR = 0xc9dcee
const ROAD_SHOULDER_WIDTH = 2.5
const WIND_FACTOR = { grass: 0.1, bush: 0.06, tree: 0.03, barrier: 0 } as const

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) {
    throw new Error(`slowroads-lab: ${selector} is missing`)
  }
  return element
}

const canvas = requireElement<HTMLCanvasElement>('#viewport')
const panel = requireElement<HTMLElement>('#panel')
const statsElement = requireElement<HTMLElement>('#stats')
const overlay = requireElement<HTMLElement>('#overlay')
const overlayProgress = requireElement<HTMLElement>('#overlay-progress')
const overlayDetail = requireElement<HTMLElement>('#overlay-detail')

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setClearColor(SKY_COLOR, 1)
// 官方 slowroads.io 使用 Cineon 色调映射（曝光 1）。
renderer.toneMapping = THREE.CineonToneMapping
renderer.toneMappingExposure = 1

const scene = new THREE.Scene()
scene.background = new THREE.Color(SKY_COLOR)
scene.fog = new THREE.FogExp2(SKY_COLOR, 0.0013)

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 3000)
camera.position.set(30, 40, 90)
camera.lookAt(0, 0, 0)

const settings: LabSettings = { ...DEFAULT_LAB_SETTINGS }
const foliageUniforms = createFoliageSharedUniforms()

interface SeasonRuntimeAssets {
  terrain: TerrainTextureSet
  bushes: { texture: THREE.Texture; entries: SpriteCellRegion[] }
  grassSprites: { texture: THREE.Texture; entries: SpriteCellRegion[] }
  broadleaf: { texture: THREE.Texture; normalTexture: THREE.Texture; regions: SpriteRegion[] }
  conifer: { texture: THREE.Texture; alphaTexture: THREE.Texture; regions: SpriteRegion[] }
  imposterBroadleaf: { texture: THREE.Texture; normalTexture: THREE.Texture }
  imposterConifer: { texture: THREE.Texture; normalTexture: THREE.Texture }
  road: { base: THREE.Texture; overlay: THREE.Texture | null }
  treeMeshes: TreeMeshTextures
}

interface SharedRuntimeAssets {
  noise: THREE.Texture
  bushNoise: THREE.Texture
  grassVariation: THREE.Texture
  rockBump: THREE.Texture
  seaWaves: THREE.Texture
  clouds: THREE.Texture
  barrier: THREE.Texture
}

let assetStore: LabAssetStore | null = null
let sharedAssets: SharedRuntimeAssets | null = null
let seasonAssets: SeasonRuntimeAssets | null = null
let seasonLoadToken = 0

let field: Heightfield | null = null
let profile: RoadProfile | null = null
let densityField: TreeDensityField | null = null
let terrainBuilder: TerrainMeshBuilder | null = null
let terrainMesh: THREE.Mesh | null = null
let terrainMaterialHandle: TerrainMaterialHandle | null = null
let roadHandle: RoadMeshHandle | null = null
let treeMeshManager: TreeMeshManager | null = null
let water: WaterHandle | null = null
let environmentHandles: {
  sky: ReturnType<typeof createSky>
  clouds: ReturnType<typeof createClouds>
  stars: ReturnType<typeof createStars>
  snow: ReturnType<typeof createSnow>
} | null = null
let environmentController: EnvironmentController | null = null
let placements: LabPlacements | null = null

let grassMesh: THREE.InstancedMesh | null = null
let bushMesh: THREE.InstancedMesh | null = null
let broadleafNearMesh: THREE.InstancedMesh | null = null
let broadleafFarMesh: THREE.InstancedMesh | null = null
let coniferNearMesh: THREE.InstancedMesh | null = null
let coniferFarMesh: THREE.InstancedMesh | null = null
let barrierMesh: THREE.InstancedMesh | null = null
let barrierSegmentCount = 0

let cruise: CruiseController | null = null
let freeFly: FreeFlyControls | null = null
let ui: LabUiHandle | null = null
let cameraInitialized = false
let worldBuildStartedAt = 0
let lastWorldBuildMs = 0
let lastSeasonSwitchMs = 0
let cruiseActive = false
let activeSeason: SeasonId = settings.season

const catalogForChecks = assetsCatalog as unknown as AssetsCatalogLike

// ---------------------------------------------------------------------------
// Asset loading
// ---------------------------------------------------------------------------

function requireStore(): LabAssetStore {
  if (!assetStore) {
    throw new Error('slowroads-lab: asset store not ready')
  }
  return assetStore
}

async function loadSharedAssets(onProgress?: (loaded: number, total: number) => void): Promise<SharedRuntimeAssets> {
  const requests: Array<{ id: string; options: { colorSpace: 'srgb' | 'linear'; tiling: boolean } }> = [
    // 色彩空间全部来自季节目录（与官方 U(url, aniso, wrap, colorSpace) 调用点一致）：
    // noise/rockBump/grassVariation/seaWaves/clouds = srgb-linear；barrier = srgb。
    { id: SHARED_TEXTURES.noise.id, options: { colorSpace: SHARED_TEXTURES.noise.colorSpace, tiling: true } },
    { id: SHARED_TEXTURES.bushNoise.id, options: { colorSpace: SHARED_TEXTURES.bushNoise.colorSpace, tiling: true } },
    { id: SHARED_TEXTURES.grassVariation.id, options: { colorSpace: SHARED_TEXTURES.grassVariation.colorSpace, tiling: true } },
    { id: SHARED_TEXTURES.rockBump.id, options: { colorSpace: SHARED_TEXTURES.rockBump.colorSpace, tiling: true } },
    { id: SHARED_TEXTURES.seaWaves.id, options: { colorSpace: SHARED_TEXTURES.seaWaves.colorSpace, tiling: true } },
    { id: SHARED_TEXTURES.clouds.id, options: { colorSpace: SHARED_TEXTURES.clouds.colorSpace, tiling: true } },
    { id: SHARED_TEXTURES.barrier.id, options: { colorSpace: SHARED_TEXTURES.barrier.colorSpace, tiling: false } },
  ]
  const textures = await requireStore().textureSet(requests, onProgress)
  return {
    noise: textures.get(SHARED_TEXTURES.noise.id)!,
    bushNoise: textures.get(SHARED_TEXTURES.bushNoise.id)!,
    grassVariation: textures.get(SHARED_TEXTURES.grassVariation.id)!,
    rockBump: textures.get(SHARED_TEXTURES.rockBump.id)!,
    seaWaves: textures.get(SHARED_TEXTURES.seaWaves.id)!,
    clouds: textures.get(SHARED_TEXTURES.clouds.id)!,
    barrier: textures.get(SHARED_TEXTURES.barrier.id)!,
  }
}

async function loadSeasonAssets(
  season: SeasonId,
  shared: SharedRuntimeAssets,
  onProgress?: (loaded: number, total: number) => void,
): Promise<SeasonRuntimeAssets> {
  const entry = SEASON_CATALOG[season]
  const requests: Array<{ id: string; options: { colorSpace: 'srgb' | 'linear'; tiling: boolean } }> = [
    { id: entry.surface.grass.id, options: { colorSpace: entry.surface.grass.colorSpace, tiling: true } },
    { id: entry.surface.forest.id, options: { colorSpace: entry.surface.forest.colorSpace, tiling: true } },
    { id: entry.surface.heather.id, options: { colorSpace: entry.surface.heather.colorSpace, tiling: true } },
    { id: entry.surface.gravel.id, options: { colorSpace: entry.surface.gravel.colorSpace, tiling: true } },
    { id: entry.surface.rock.id, options: { colorSpace: entry.surface.rock.colorSpace, tiling: true } },
    { id: entry.surface.sand.id, options: { colorSpace: entry.surface.sand.colorSpace, tiling: true } },
    { id: entry.surface.detailNear.id, options: { colorSpace: entry.surface.detailNear.colorSpace, tiling: true } },
    { id: entry.surface.detailFar.id, options: { colorSpace: entry.surface.detailFar.colorSpace, tiling: true } },
    { id: entry.sprites.bushes.id, options: { colorSpace: entry.sprites.bushes.colorSpace, tiling: false } },
    { id: entry.sprites.grassSprites.id, options: { colorSpace: entry.sprites.grassSprites.colorSpace, tiling: false } },
    { id: entry.trees.broadleafD.id, options: { colorSpace: entry.trees.broadleafD.colorSpace, tiling: false } },
    { id: entry.trees.broadleafN.id, options: { colorSpace: entry.trees.broadleafN.colorSpace, tiling: false } },
    // 官方 trees[1]（针叶）diffuse 与 alpha 都用 RepeatWrapping：OBJ 的 V 会绕回
    // （tree_05 v 到 ~4.9），clamp 会在 v>1 后取到错误的行。
    { id: entry.trees.coniferM.id, options: { colorSpace: entry.trees.coniferM.colorSpace, tiling: true } },
    { id: entry.trees.coniferA.id, options: { colorSpace: entry.trees.coniferA.colorSpace, tiling: true } },
    { id: entry.imposters.mapA.id, options: { colorSpace: entry.imposters.mapA.colorSpace, tiling: false } },
    { id: entry.imposters.normA.id, options: { colorSpace: entry.imposters.normA.colorSpace, tiling: false } },
    { id: entry.imposters.mapB.id, options: { colorSpace: entry.imposters.mapB.colorSpace, tiling: false } },
    { id: entry.imposters.normB.id, options: { colorSpace: entry.imposters.normB.colorSpace, tiling: false } },
    { id: entry.road.base.id, options: { colorSpace: entry.road.base.colorSpace, tiling: true } },
  ]
  if (entry.road.overlay) {
    requests.push({ id: entry.road.overlay.id, options: { colorSpace: entry.road.overlay.colorSpace, tiling: true } })
  }
  const textures = await requireStore().textureSet(requests, onProgress)
  const get = (ref: SeasonTextureRef): THREE.Texture => textures.get(ref.id)!
  return {
    terrain: {
      grass: get(entry.surface.grass),
      forest: get(entry.surface.forest),
      heather: get(entry.surface.heather),
      gravel: get(entry.surface.gravel),
      rock: get(entry.surface.rock),
      sand: get(entry.surface.sand),
      detailNear: get(entry.surface.detailNear),
      detailFar: get(entry.surface.detailFar),
      rockBump: shared.rockBump,
      grassVariation: shared.grassVariation,
      fadeNoise: shared.noise,
    },
    bushes: { texture: get(entry.sprites.bushes), entries: bushVariantEntries(season) },
    grassSprites: { texture: get(entry.sprites.grassSprites), entries: getGrassEntries(season) },
    broadleaf: { texture: get(entry.trees.broadleafD), normalTexture: get(entry.trees.broadleafN), regions: BROADLEAF_CARD_REGIONS },
    conifer: { texture: get(entry.trees.coniferM), alphaTexture: get(entry.trees.coniferA), regions: getConiferCardRegions(season) },
    imposterBroadleaf: { texture: get(entry.imposters.mapA), normalTexture: get(entry.imposters.normA) },
    imposterConifer: { texture: get(entry.imposters.mapB), normalTexture: get(entry.imposters.normB) },
    road: {
      base: get(entry.road.base),
      overlay: entry.road.overlay ? get(entry.road.overlay) : null,
    },
    treeMeshes: {
      broadleafD: get(entry.trees.broadleafD),
      broadleafN: get(entry.trees.broadleafN),
      coniferM: get(entry.trees.coniferM),
      coniferA: get(entry.trees.coniferA),
    },
  }
}

function seasonRetainIds(season: SeasonId): Set<string> {
  const ids = new Set<string>()
  for (const ref of collectSeasonTextureRefs(season)) {
    ids.add(ref.id)
  }
  for (const ref of Object.values(SHARED_TEXTURES)) {
    ids.add(ref.id)
  }
  return ids
}

// ---------------------------------------------------------------------------
// Environment (season x time x weather)
// ---------------------------------------------------------------------------

function currentEnvironmentState(): EnvironmentState {
  return { season: activeSeason, timeOfDay: settings.timeOfDay, weather: settings.weather }
}

/** 创建/更新天空、云层、星空、降雪，并把环境控制器接到场景上。 */
function ensureEnvironment(): void {
  if (!sharedAssets) {
    return
  }
  if (!environmentController) {
    const skyHandle = createSky()
    const clouds = createClouds(sharedAssets.clouds)
    const stars = createStars()
    const snow = createSnow(sharedAssets.noise)
    scene.add(camera)
    camera.add(skyHandle.mesh)
    scene.add(clouds.mesh, stars.container, snow.container)
    environmentHandles = { sky: skyHandle, clouds, stars, snow }
    environmentController = createEnvironmentController({
      scene,
      camera,
      renderer,
      sky: skyHandle,
      clouds,
      stars,
      snow,
      getWater: () => water,
    })
  } else {
    environmentHandles?.clouds.setTexture(sharedAssets.clouds)
    environmentHandles?.snow.setNoiseTexture(sharedAssets.noise)
  }
}

function applyEnvironmentState(): void {
  environmentController?.applyState(currentEnvironmentState())
  applyToggles()
}

// ---------------------------------------------------------------------------
// Foliage / world assembly
// ---------------------------------------------------------------------------

function clearFoliage(): void {
  disposeFoliageMesh(grassMesh)
  disposeFoliageMesh(bushMesh)
  disposeFoliageMesh(broadleafNearMesh)
  disposeFoliageMesh(broadleafFarMesh)
  disposeFoliageMesh(coniferNearMesh)
  disposeFoliageMesh(coniferFarMesh)
  disposeFoliageMesh(barrierMesh)
  grassMesh = null
  bushMesh = null
  broadleafNearMesh = null
  broadleafFarMesh = null
  coniferNearMesh = null
  coniferFarMesh = null
  barrierMesh = null
  barrierSegmentCount = 0
}

function clearTerrain(): void {
  if (terrainMesh) {
    scene.remove(terrainMesh)
    terrainMesh.geometry.dispose()
    terrainMesh = null
  }
  terrainMaterialHandle?.dispose()
  terrainMaterialHandle = null
  terrainBuilder = null
  roadHandle?.dispose()
  roadHandle = null
  water?.dispose()
  water = null
}

function clearWorldStructure(): void {
  clearFoliage()
  clearTerrain()
  placements = null
  field = null
  profile = null
  densityField = null
}

/**
 * 景观材质 uniform 覆盖审计：着色器声明的每个 uniform 都必须在 JS uniform 表里
 * （否则 three 不上传、运行时恒为 0——「地面过暗」正是这类静默故障）。
 * 场景里所有 `slowroads-*` 的 ShaderMaterial（地形/道路/水面/植被/近树）都检查。
 */
let lastUniformCheck: SelfCheckResult[] = []

function auditLandscapeMaterialUniforms(): void {
  const materials: MaterialUniformCheckInput[] = []
  const landscapeMaterials: THREE.ShaderMaterial[] = []
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !mesh.material) {
      return
    }
    const entries = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const entry of entries) {
      const shader = entry as THREE.ShaderMaterial
      if (!shader.isShaderMaterial || !shader.uniforms || !shader.name.startsWith('slowroads-')) {
        continue
      }
      landscapeMaterials.push(shader)
      materials.push({
        name: shader.name,
        vertexShader: shader.vertexShader,
        fragmentShader: shader.fragmentShader,
        uniformKeys: Object.keys(shader.uniforms),
      })
    }
  })
  lastUniformCheck = runMaterialUniformCoverageChecks(materials)
  // 树卡变色语义（官方 effects.treeDiscolouration 是噪声幅度）：因子只允许出现在顶点噪声
  // 公式里，片元消费 varying —— 把因子直接当乘数就是冬季树冠发紫那个缺陷。
  lastUniformCheck.push(...runTreeDiscolourationShaderChecks(materials))
  // 值断言：凡声明 uAmbientColor 的景观材质，官方三灯/半球 uniform 必须已按预设下发
  // （全 0 = 环境控制器没写进来——修复前地形就是这个状态）。
  const zeroed = new Set<string>()
  for (const shader of landscapeMaterials) {
    const uniforms = shader.uniforms
    if (!uniforms.uAmbientColor) {
      continue
    }
    const sun = uniforms.uSunColor?.value as THREE.Color | undefined
    const ambient = uniforms.uAmbientColor.value as THREE.Color
    const hemi = uniforms.uHemiColor?.value as THREE.Color | undefined
    const sum = (color: THREE.Color | undefined): number => (color ? color.r + color.g + color.b : 0)
    if (sum(sun) <= 0 || sum(ambient) <= 0 || sum(hemi) <= 0) {
      zeroed.add(shader.name)
    }
  }
  const boundOk = zeroed.size === 0
  if (boundOk) {
    console.info(`[slowroads-lab] landscape lighting uniforms bound (materials=${landscapeMaterials.length})`)
  } else {
    console.warn(`[slowroads-lab] landscape lighting uniforms zeroed: ${[...zeroed].join(', ')}`)
  }
  lastUniformCheck.push({
    name: 'landscape lighting uniforms bound',
    ok: boundOk,
    detail: boundOk ? `materials=${landscapeMaterials.length}` : `zeroed: ${[...zeroed].slice(0, 6).join(', ')}`,
  })
}

/**
 * 雾色色彩空间回归检查（官方 `refreshFogUniforms` 等价物）。
 *
 * slowroads 的 fog chunk 被 three 排在 `tonemapping_fragment → colorspace_fragment →
 * fog_fragment` 之后，混色发生在显示空间，因此 `fogColorA/B/C` 必须是**输出色空间**
 * 分量（渲染到画布 = 预设 hex 的 sRGB 分量），而不是工作色空间的线性分量。
 * 修复前 lab 推的正是线性值 —— 春季早晨/傍晚天空因此偏暗偏红，这条断言当场就能抓到。
 */
const FOG_COLOR_SPACE_REFERENCE = {
  hex: '#E496AD',
  /** 春/晨/晴 fog.colA：输出色空间分量 = hex 原值。 */
  srgb: [228 / 255, 150 / 255, 173 / 255] as const,
  /** 同一颜色的线性工作空间分量 —— 正是修复前误推的那组值。 */
  linear: [0.7758, 0.305, 0.4179] as const,
}

let lastFogColorCheck: SelfCheckResult[] = []

function srgbComponentsFromHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

function colorMatches(color: THREE.Color, expected: readonly [number, number, number] | readonly number[], tolerance = 1e-3): boolean {
  return Math.abs(color.r - expected[0]) < tolerance
    && Math.abs(color.g - expected[1]) < tolerance
    && Math.abs(color.b - expected[2]) < tolerance
}

function colorTriplet(color: THREE.Color): string {
  return `(${color.r.toFixed(4)}, ${color.g.toFixed(4)}, ${color.b.toFixed(4)})`
}

function checkFogUniformColorSpace(): void {
  const results: SelfCheckResult[] = []
  const record = (name: string, ok: boolean, detail = ''): void => {
    results.push({ name, ok, detail })
    console.assert(ok, `[slowroads-lab fog-color-check] ${name}${detail ? ` — ${detail}` : ''}`)
  }

  // 1) 换算依赖：ColorManagement 开启时 getRGB(..., SRGBColorSpace) 还原成 hex 分量，
  //    且与线性分量明显不同（关掉色彩管理 / 直接推线性值都会在这里失败）。
  const converted = new THREE.Color().set(FOG_COLOR_SPACE_REFERENCE.hex)
  converted.getRGB(converted, THREE.SRGBColorSpace)
  record(
    `fog color space: ${FOG_COLOR_SPACE_REFERENCE.hex} -> output(sRGB)`,
    colorMatches(converted, FOG_COLOR_SPACE_REFERENCE.srgb),
    `got ${colorTriplet(converted)} want (${FOG_COLOR_SPACE_REFERENCE.srgb.join(', ')})`,
  )
  const linearReference = new THREE.Color().set(FOG_COLOR_SPACE_REFERENCE.hex)
  record(
    'fog color space: reference linear components',
    colorMatches(linearReference, FOG_COLOR_SPACE_REFERENCE.linear, 1e-4),
    `linear ${colorTriplet(linearReference)}`,
  )
  record(
    'fog color space: linear components differ from output space',
    !colorMatches(linearReference, FOG_COLOR_SPACE_REFERENCE.srgb, 0.02),
    `linear ${colorTriplet(linearReference)}`,
  )

  // 2) 实际下发值：当前环境预设的 fogColorA/B/C 必须是输出色空间分量。
  const state = environmentController?.state
  if (!state) {
    record('fog uniform colors applied', false, 'environment state missing')
  } else {
    const preset = resolveEnvironmentPreset(state)
    const entries: Array<[string, string]> = [
      ['fogColorA', preset.fog.colA],
      ['fogColorB', preset.fog.colB],
      ['fogColorC', preset.fog.colC ?? preset.fog.colB],
    ]
    let ok = true
    let detail = `${state.season}/${state.timeOfDay}/${state.weather}`
    for (const [key, hex] of entries) {
      const uniform = slowroadsFogUniforms[key].value as THREE.Color
      const want = srgbComponentsFromHex(hex)
      if (!colorMatches(uniform, want, 2e-3)) {
        ok = false
        detail += ` ${key}=${colorTriplet(uniform)} want ${hex}(${want.map((v) => v.toFixed(4)).join(', ')})`
      }
    }
    record('fog uniform colors in output color space', ok, ok ? `${detail} (${entries.map(([key]) => key).join(', ')})` : detail)
    console.info(`[slowroads-lab] fog uniform colors: ${entries.map(([key, hex]) => `${key}=${hex}`).join(', ')} (${detail})`)
  }

  lastFogColorCheck = results
}

let lastSkyFogCheck: SelfCheckResult[] = []

/**
 * 天空/云层雾尺度回归检查（第五批）。
 *
 * 官方 `updateSky()` 用 `n1 = tileSize × 2`(= `ENVIRONMENT_SKY_DISTANCE`) 推
 * fogNear/fogFar 与天空平面 `z = -n1 + 0.1`；lab 的地形雾仍用 1000 尺度（避免露出
 * 1600m 世界边缘）。这条断言把三件事钉死：
 *   1) 天空组 uniform（天空/云层/星空共享）确实按**天空尺度**参数的 haze 插值结果下发；
 *   2) 由它推出的 `vFogBlend` 等于官方值（春·晨·晴 = 1，而场景尺度只有 0.722）；
 *   3) 天空平面挂在 n1 距离、天空组与场景组雾色一致。
 * 把天空误绑回场景组、或把尺度改回 1000，都会在这里当场失败（README「第五批」）。
 */
function checkSkyFogScale(): void {
  const results: SelfCheckResult[] = []
  const record = (name: string, ok: boolean, detail = ''): void => {
    results.push({ name, ok, detail })
    console.assert(ok, `[slowroads-lab sky-fog-check] ${name}${detail ? ` — ${detail}` : ''}`)
  }

  record(
    'sky fog distance = 2 x view distance (official n1)',
    ENVIRONMENT_SKY_DISTANCE === ENVIRONMENT_VIEW_DISTANCE * 2,
    `sky=${ENVIRONMENT_SKY_DISTANCE} view=${ENVIRONMENT_VIEW_DISTANCE}`,
  )

  const state = environmentController?.state
  const skyMesh = environmentHandles?.sky.mesh
  if (!state || !skyMesh) {
    record('sky fog scale applied', false, 'environment state or sky mesh missing')
    lastSkyFogCheck = results
    return
  }

  const preset = resolveEnvironmentPreset(state)
  // applyState 写基准参数、每帧 update() 写 haze 插值后的参数；本检查在 world 重建末尾
  // 运行，两者都可能是在最后一次写入，因此接受「基准」或「当前相机高度的 haze 插值」两种取值。
  const skyBase = resolveSkyFogParams(preset)
  const skyAdjusted = updateHazeForCamera(skyBase, camera.position.y, { inHaze: false })
  const matches = (got: number, want: number): boolean => Math.abs(got - want) < 1e-6
  const numbers: Array<[string, number, number, number]> = [
    ['fogNear', slowroadsSkyFogUniforms.fogNear.value as number, skyBase.near, skyAdjusted.near],
    ['fogFar', slowroadsSkyFogUniforms.fogFar.value as number, skyBase.far, skyAdjusted.far],
    ['hazeHeight', slowroadsSkyFogUniforms.hazeHeight.value as number, skyBase.hazeHeight, skyAdjusted.hazeHeight],
    ['hazeIntensity', slowroadsSkyFogUniforms.hazeIntensity.value as number, skyBase.hazeIntensity, skyAdjusted.hazeIntensity],
  ]
  let paramsOk = true
  let detail = `${state.season}/${state.timeOfDay}/${state.weather} camY=${camera.position.y.toFixed(1)}`
  for (const [key, got, wantBase, wantAdjusted] of numbers) {
    if (!matches(got, wantBase) && !matches(got, wantAdjusted)) {
      paramsOk = false
      detail += ` ${key}=${got.toFixed(4)} want ${wantBase.toFixed(4)}|${wantAdjusted.toFixed(4)}`
    }
  }
  record('sky fog uniforms use official sky scale (haze-adjusted)', paramsOk, detail)

  const blend = resolveFogDepthBlend(
    slowroadsSkyFogUniforms.fogNear.value as number,
    slowroadsSkyFogUniforms.fogFar.value as number,
  )
  // 尺度不变式：天空 far 恒为场景 far 的 2 倍（基准与 haze 插值后都成立），
  // 因此「天空误绑回场景组」或「尺度被改回 1000」都会在这里失败。
  const sceneFar = slowroadsFogUniforms.fogFar.value as number
  const skyFar = slowroadsSkyFogUniforms.fogFar.value as number
  record(
    'sky fog far = 2 x scene fog far',
    Math.abs(skyFar - sceneFar * 2) < 1e-3,
    `sky=${skyFar.toFixed(4)} scene=${sceneFar.toFixed(4)}`,
  )
  const wantBlend = resolveFogDepthBlend(skyBase.near, skyBase.far)
  record(
    'sky vFogBlend matches official sky scale',
    Math.abs(blend - wantBlend) < 1e-6,
    `vFogBlend=${blend.toFixed(4)} want ${wantBlend.toFixed(4)}`,
  )

  const sceneBlend = resolveFogDepthBlend(slowroadsFogUniforms.fogNear.value as number, sceneFar)
  console.info(
    `[slowroads-lab] sky fog scale: sky vFogBlend=${blend.toFixed(4)} scene vFogBlend=${sceneBlend.toFixed(4)} ` +
    `(${state.season}/${state.timeOfDay}/${state.weather}, skyFar=${skyFar.toFixed(1)}, sceneFar=${sceneFar.toFixed(1)}, camY=${camera.position.y.toFixed(1)})`,
  )

  const skyZ = skyMesh.position.z
  const wantSkyZ = -(ENVIRONMENT_SKY_DISTANCE - 0.1)
  record(
    'sky plane hangs at official n1 distance',
    Math.abs(skyZ - wantSkyZ) < 1e-3,
    `z=${skyZ} want ${wantSkyZ}`,
  )

  let colorsOk = true
  let colorsDetail = 'ok'
  for (const key of ['fogColorA', 'fogColorB', 'fogColorC'] as const) {
    const skyColor = slowroadsSkyFogUniforms[key].value as THREE.Color
    const sceneColor = slowroadsFogUniforms[key].value as THREE.Color
    if (!colorMatches(skyColor, [sceneColor.r, sceneColor.g, sceneColor.b])) {
      colorsOk = false
      colorsDetail = `${key} sky=${colorTriplet(skyColor)} scene=${colorTriplet(sceneColor)}`
    }
  }
  record('sky fog colors equal scene fog colors (same preset)', colorsOk, colorsDetail)

  lastSkyFogCheck = results
}

function applyToggles(): void {
  terrainMaterialHandle?.setToggles({
    surface: settings.showSurface,
    road: settings.showRoad,
    canopy: settings.showCanopy,
    textures: settings.showTextures,
  })
  if (grassMesh) grassMesh.visible = settings.showGrass
  if (bushMesh) bushMesh.visible = settings.showBushes
  if (broadleafNearMesh) broadleafNearMesh.visible = settings.showTrees
  if (broadleafFarMesh) broadleafFarMesh.visible = settings.showTrees
  if (coniferNearMesh) coniferNearMesh.visible = settings.showTrees
  if (coniferFarMesh) coniferFarMesh.visible = settings.showTrees
  if (barrierMesh) barrierMesh.visible = settings.showBarrier
  if (roadHandle) roadHandle.mesh.visible = settings.showRoad
  if (water) water.mesh.visible = settings.showWater
  environmentController?.setToggles({
    sky: settings.showSky,
    clouds: settings.showClouds,
    stars: settings.showStars,
    snow: settings.showSnow,
  })
  if (treeMeshManager) {
    treeMeshManager.setVisible(settings.showNearTreeMeshes)
  }
  foliageUniforms.meshRadius.value = settings.showNearTreeMeshes ? settings.nearTreeRadius : 0
}

function applyWind(): void {
  const strength = settings.windEnabled ? settings.windStrength : 0
  if (grassMesh) setFoliageWindStrength(grassMesh, strength * WIND_FACTOR.grass)
  if (bushMesh) setFoliageWindStrength(bushMesh, strength * WIND_FACTOR.bush)
  if (broadleafNearMesh) setFoliageWindStrength(broadleafNearMesh, strength * WIND_FACTOR.tree)
  if (coniferNearMesh) setFoliageWindStrength(coniferNearMesh, strength * WIND_FACTOR.tree)
  if (broadleafFarMesh) setFoliageWindStrength(broadleafFarMesh, 0)
  if (coniferFarMesh) setFoliageWindStrength(coniferFarMesh, 0)
  if (barrierMesh) setFoliageWindStrength(barrierMesh, 0)
}

function toSprite(
  instance: { x: number; z: number; y: number; rotation: number; scale: number; variantUnit: number; roadProx: number },
  entries: SpriteCellRegion[],
  field: Heightfield,
): SpriteInstance {
  const index = Math.min(entries.length - 1, Math.max(0, Math.floor(instance.variantUnit * entries.length)))
  const entry = entries[index]!
  // 官方草丛/灌木用 per-instance groundNormal 受光并驱动 fresnel；lab 从高度场采样。
  const normal = field.sampleNormal(instance.x, instance.z, normalScratch)
  return {
    x: instance.x,
    z: instance.z,
    y: instance.y,
    rotation: instance.rotation,
    scale: instance.scale,
    variant: index,
    cell: entry.cell,
    roadProx: instance.roadProx,
    nx: normal.x,
    ny: normal.y,
    nz: normal.z,
  }
}

function toTreeSprite(instance: TreePlacement, variant: number, cell?: number): SpriteInstance {
  return {
    x: instance.x,
    z: instance.z,
    y: instance.y,
    rotation: instance.rotation,
    scale: instance.scale,
    variant,
    cell,
  }
}

const normalScratch = new THREE.Vector3()

/**
 * 树密度图（256²，世界 XZ 映射）：与地形材质的密度图同源，供植被层的
 * 官方 per-instance shadow / density 近似（uUseDensityShadow、近树材质
 * vLeafBrightness）使用。先创建（供 init 阶段的近树材质引用）后填充。
 */
const FOLIAGE_DENSITY_SIZE = 256
let foliageDensityTexture: THREE.DataTexture | null = null

function getFoliageDensityTexture(): THREE.DataTexture {
  if (!foliageDensityTexture) {
    foliageDensityTexture = new THREE.DataTexture(
      new Uint8Array(FOLIAGE_DENSITY_SIZE * FOLIAGE_DENSITY_SIZE * 4),
      FOLIAGE_DENSITY_SIZE,
      FOLIAGE_DENSITY_SIZE,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    )
    foliageDensityTexture.minFilter = THREE.LinearFilter
    foliageDensityTexture.magFilter = THREE.LinearFilter
    foliageDensityTexture.wrapS = THREE.ClampToEdgeWrapping
    foliageDensityTexture.wrapT = THREE.ClampToEdgeWrapping
    foliageDensityTexture.generateMipmaps = false
  }
  return foliageDensityTexture
}

/** 按当前树密度场刷新密度图内容（世界重建时调用）。 */
function updateFoliageDensityTexture(density: TreeDensityField): void {
  const texture = getFoliageDensityTexture()
  const size = FOLIAGE_DENSITY_SIZE
  const data = texture.image.data as Uint8Array
  const half = WORLD_SIZE * 0.5
  for (let y = 0; y < size; y += 1) {
    const z = -half + (y / (size - 1)) * WORLD_SIZE
    for (let x = 0; x < size; x += 1) {
      const px = -half + (x / (size - 1)) * WORLD_SIZE
      const byte = Math.round((density.classAt(px, z) / 3) * 255)
      const index = (y * size + x) * 4
      data[index] = byte
      data[index + 1] = byte
      data[index + 2] = byte
      data[index + 3] = 255
    }
  }
  texture.needsUpdate = true
}

function buildFoliageFromPlacements(): void {
  if (!field || !profile || !placements || !seasonAssets || !sharedAssets) {
    return
  }
  clearFoliage()
  const assets = seasonAssets
  const season = activeSeason
  const params = SEASON_PARAMS[season]
  const heightfield = field
  const grassEntries = assets.grassSprites.entries
  const bushEntries = assets.bushes.entries
  // 官方 LOD dissolve 区间（cf(l)：lod1Horizon = 近树卡距离/10）：
  // 近树卡在 [near, far] 淡出，远景树在 [near2, far2] 淡入，两段有 0.6 间隔离散衔接。
  const cardDissolveFar = Math.max(40, settings.nearDistance)
  const cardDissolveInterval = Math.max(1, Math.floor(cardDissolveFar * 0.3))
  const cardDissolveNear = cardDissolveFar - cardDissolveInterval
  const imposterDissolveFar = cardDissolveNear + cardDissolveInterval * 0.6
  const imposterDissolveNear = Math.max(1, imposterDissolveFar - cardDissolveInterval)
  const cardNoise = sharedAssets.noise
  const foliageDensity = densityField ? getFoliageDensityTexture() : undefined

  grassMesh = createFoliageMesh(
    placements.grass.map((placement) => toSprite(placement, grassEntries, heightfield)),
    {
      atlas: { texture: assets.grassSprites.texture, regions: grassEntries.map((entry) => entry.region) },
      tint: 0xffffff,
      alphaTest: params.grassAlphaTest,
      unitSize: 1.6,
      shared: foliageUniforms,
      densityMap: foliageDensity,
      worldSize: WORLD_SIZE,
      palette: {
        mode: 'grass',
        season,
        noiseMap: sharedAssets.noise,
        grassVariation: sharedAssets.grassVariation,
        detailFar: assets.terrain.detailFar,
      },
    },
  )
  bushMesh = createFoliageMesh(
    placements.bushes.map((placement) => toSprite(placement, bushEntries, heightfield)),
    {
      atlas: { texture: assets.bushes.texture, regions: bushEntries.map((entry) => entry.region) },
      tint: 0xffffff,
      alphaTest: params.bushAlphaTest,
      distanceAlpha: true,
      unitSize: 2,
      shared: foliageUniforms,
      densityMap: foliageDensity,
      worldSize: WORLD_SIZE,
      palette: {
        mode: 'bush',
        season,
        noiseMap: sharedAssets.bushNoise,
        grassVariation: sharedAssets.grassVariation,
        detailFar: assets.terrain.detailFar,
      },
    },
  )

  const broadleaf = placements.trees.filter((tree) => tree.species === 0)
  const conifer = placements.trees.filter((tree) => tree.species === 1)
  // 官方 effects.treeDiscolouration 是变色噪声的**幅度**（着色器换算成 ≈1±factor/2 的乘数）。
  const treeOptions = { discolouration: params.treeDiscolouration, hasSnow: params.hasSnow }
  broadleafNearMesh = createFoliageMesh(broadleaf.map((tree) => toTreeSprite(tree, tree.variantNear)), {
    atlas: { texture: assets.broadleaf.texture, normalTexture: assets.broadleaf.normalTexture, regions: assets.broadleaf.regions },
    tint: 0xffffff,
    alphaTest: 0.5,
    unitSize: 8,
    shared: foliageUniforms,
    card: { kind: 'near', dissolveNear: cardDissolveNear, dissolveFar: cardDissolveFar, dissolveInterval: cardDissolveInterval },
    noiseMap: cardNoise,
    densityMap: foliageDensity,
    worldSize: WORLD_SIZE,
    tree: { ...treeOptions, species: 0 },
  })
  // 远景树：aCell 携带图集行（变体 % 4），朝向列在着色器里按视角选取。
  broadleafFarMesh = createFoliageMesh(broadleaf.map((tree) => toTreeSprite(tree, tree.variantFar, tree.variantFar % 4)), {
    atlas: { texture: assets.imposterBroadleaf.texture, normalTexture: assets.imposterBroadleaf.normalTexture, regions: gridRegions(16, 4, 4096, 1024) },
    tint: 0xffffff,
    alphaTest: params.imposterAlphaTest,
    unitSize: 8,
    shared: foliageUniforms,
    singlePlane: true,
    card: { kind: 'far', dissolveNear: imposterDissolveNear, dissolveFar: imposterDissolveFar, dissolveInterval: cardDissolveInterval },
    noiseMap: cardNoise,
    tree: { ...treeOptions, species: 0 },
  })
  coniferNearMesh = createFoliageMesh(conifer.map((tree) => toTreeSprite(tree, tree.variantNear)), {
    atlas: { texture: assets.conifer.texture, alphaTexture: assets.conifer.alphaTexture, regions: assets.conifer.regions },
    tint: 0xffffff,
    alphaTest: 0.4,
    unitSize: 8,
    shared: foliageUniforms,
    card: { kind: 'near', dissolveNear: cardDissolveNear, dissolveFar: cardDissolveFar, dissolveInterval: cardDissolveInterval },
    noiseMap: cardNoise,
    densityMap: foliageDensity,
    worldSize: WORLD_SIZE,
    tree: { ...treeOptions, species: 1 },
  })
  coniferFarMesh = createFoliageMesh(conifer.map((tree) => toTreeSprite(tree, tree.variantFar, tree.variantFar % 4)), {
    atlas: { texture: assets.imposterConifer.texture, normalTexture: assets.imposterConifer.normalTexture, regions: gridRegions(16, 4, 4096, 1024) },
    tint: 0xffffff,
    alphaTest: params.imposterAlphaTest,
    unitSize: 8,
    shared: foliageUniforms,
    singlePlane: true,
    card: { kind: 'far', dissolveNear: imposterDissolveNear, dissolveFar: imposterDissolveFar, dissolveInterval: cardDissolveInterval },
    noiseMap: cardNoise,
    tree: { ...treeOptions, species: 1 },
  })

  const barrierAtlas: SpriteAtlasSpec = { texture: sharedAssets.barrier, regions: BARRIER_RAIL_REGIONS }
  const barrierSegments = computeBarrierSegments(field, profile, {
    seed: settings.seed >>> 0,
    density: settings.barrierDensity,
  })
  barrierSegmentCount = barrierSegments.length
  barrierMesh = createFoliageMesh(barrierSegments.map((segment) => ({
    x: segment.x,
    z: segment.z,
    y: segment.y,
    rotation: segment.rotation,
    scale: segment.scale,
    variant: segment.variant,
  })), {
    atlas: barrierAtlas,
    tint: 0xffffff,
    alphaTest: 0.35,
    unitSize: 0.35,
    shared: foliageUniforms,
    singlePlane: true,
  })

  scene.add(
    grassMesh,
    bushMesh,
    broadleafNearMesh,
    broadleafFarMesh,
    coniferNearMesh,
    coniferFarMesh,
    barrierMesh,
  )
  applyWind()
  applyToggles()
  // 新材质（雾/光照 uniform 是每材质克隆的）需要重新下发环境参数。
  environmentController?.applyState(currentEnvironmentState())
}

function rebuildPlacements(): void {
  if (!field || !profile || !densityField) {
    return
  }
  placements = computePlacements(field, profile, densityField, {
    seed: settings.seed >>> 0,
    worldSize: WORLD_SIZE,
    treeDensity: settings.treeDensity,
    treeSize: settings.treeSize,
    grassCorridor: settings.grassCorridor,
    grassDensity: settings.grassDensity,
    bushDensity: settings.bushDensity,
    flowerDensity: settings.flowerDensity,
    tallGrassDensity: settings.tallGrassDensity,
  })
  buildFoliageFromPlacements()
  if (treeMeshManager && placements) {
    treeMeshManager.update(camera.position, placements.trees, foliageUniforms.meshRadius.value, true)
  }
}

function rebuildWorld(): void {
  if (!sharedAssets) {
    return
  }
  clearWorldStructure()
  const seed = settings.seed >>> 0
  field = createHeightfield({ seed, worldSize: WORLD_SIZE })
  const trace = traceRoadPath(field, {
    startX: 0,
    startZ: 0,
    headingRad: resolveSeedHeadingRad(seed),
    stepLength: 8,
    feelDistance: 24,
    feelAngleRad: degreesToRadians(32),
    slopeLimit: 0.55,
    maxTurnRad: degreesToRadians(4),
    maxLength: null,
    margin: 24,
  })
  profile = createRoadProfile(trace.nodes, {
    halfWidth: settings.roadWidth * 0.5,
    shoulderWidth: ROAD_SHOULDER_WIDTH,
    flattenBand: settings.flattenBand,
  })
  densityField = createTreeDensityField(seed, WORLD_SIZE)
  // 密度图纹理在近树材质创建时就已引用，这里按新世界刷新内容。
  updateFoliageDensityTexture(densityField)
  terrainBuilder = createTerrainMeshBuilder(field, profile, { segments: TERRAIN_SEGMENTS })
  worldBuildStartedAt = performance.now()
  overlay.hidden = false
  overlayProgress.style.width = '0%'
  overlayDetail.textContent = `种子 ${seed} · 道路 ${Math.round(profile.length)}m · 顶点 ${(terrainBuilder.vertexCount / 1e6).toFixed(2)}M`
}

function finalizeTerrain(): void {
  if (!terrainBuilder || !terrainBuilder.geometry || !field || !densityField || !profile || !seasonAssets) {
    return
  }
  terrainMaterialHandle = createTerrainMaterial({
    seed: settings.seed >>> 0,
    worldSize: WORLD_SIZE,
    waterLevel: field.waterLevel,
    density: densityField,
    textures: seasonAssets.terrain,
    season: activeSeason,
    reduced: settings.compatMode,
  })
  terrainMesh = new THREE.Mesh(terrainBuilder.geometry, terrainMaterialHandle.material)
  terrainMesh.name = 'slowroads-terrain'
  scene.add(terrainMesh)

  roadHandle = createRoadMesh({
    profile,
    density: densityField,
    sunDir: foliageUniforms.sunDir.value,
    sunColor: foliageUniforms.sunColor.value,
  })
  const params = SEASON_PARAMS[activeSeason]
  roadHandle.setSeason({ base: seasonAssets.road.base, overlay: seasonAssets.road.overlay }, params.shadowFactor)
  scene.add(roadHandle.mesh)

  terrainBuilder = null
  overlay.hidden = true
  lastWorldBuildMs = performance.now() - worldBuildStartedAt
  if (sharedAssets) {
    water = createWater({
      worldSize: WORLD_SIZE,
      waterLevel: field.waterLevel,
      waves: sharedAssets.seaWaves,
      skyColor: SKY_COLOR,
      sunDir: foliageUniforms.sunDir.value,
      sunColor: foliageUniforms.sunColor.value,
    })
    water.setFrozen(params.frozenWater)
    scene.add(water.mesh)
  }
  rebuildPlacements()
  if (!cameraInitialized) {
    resetCameraView()
  }
  // 世界与植被材质都已就位：跑一次 uniform 覆盖审计，防止着色器/JS 表再次脱节；
  // 再校验雾色确实按输出色空间下发（雾 chunk 在 colorspace 之后混色）；
  // 最后校验天空/云层用的是官方 n1 尺度而不是场景的 1000 尺度。
  auditLandscapeMaterialUniforms()
  checkFogUniformColorSpace()
  checkSkyFogScale()
}

// ---------------------------------------------------------------------------
// Season switching
// ---------------------------------------------------------------------------

async function applySeason(season: SeasonId, options: { silent?: boolean } = {}): Promise<void> {
  if (!assetStore || !sharedAssets) {
    return
  }
  const token = ++seasonLoadToken
  activeSeason = season
  const startedAt = performance.now()
  ui?.setSeasonLoading(season)
  if (!options.silent) {
    overlay.hidden = false
    overlayProgress.style.width = '0%'
    overlayDetail.textContent = `正在加载 ${season} 素材…`
  }
  try {
    const assets = await loadSeasonAssets(season, sharedAssets, (loaded, total) => {
      if (token === seasonLoadToken && !options.silent) {
        overlayProgress.style.width = `${Math.round((loaded / Math.max(1, total)) * 100)}%`
      }
    })
    if (token !== seasonLoadToken) {
      return
    }
    seasonAssets = assets
    // Terrain material keeps the same geometry; swap textures + palette.
    terrainMaterialHandle?.setSeason(season, assets.terrain)
    roadHandle?.setSeason({ base: assets.road.base, overlay: assets.road.overlay }, SEASON_PARAMS[season].shadowFactor)
    water?.setFrozen(SEASON_PARAMS[season].frozenWater)
    if (placements) {
      buildFoliageFromPlacements()
    }
    treeMeshManager?.setSeason({
      textures: assets.treeMeshes,
      // 官方 effects.treeDiscolouration = 变色噪声幅度（不是乘数）。
      discolouration: SEASON_PARAMS[season].treeDiscolouration,
      hasSnow: SEASON_PARAMS[season].hasSnow,
    })
    if (treeMeshManager && placements) {
      treeMeshManager.update(camera.position, placements.trees, foliageUniforms.meshRadius.value, true)
    }
    assetStore.prune(seasonRetainIds(season))
    lastSeasonSwitchMs = performance.now() - startedAt
    settings.season = season
    ui?.setSeasonActive(season)
    // 季节也是环境预设的维度：光照/雾/水面/云/星/雪都随季节变化。
    applyEnvironmentState()
  } catch (error) {
    console.error('[slowroads-lab] season switch failed', error)
    overlayDetail.textContent = `季节加载失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    if (token === seasonLoadToken) {
      ui?.setSeasonLoading(null)
      if (!options.silent) {
        overlay.hidden = true
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Camera helpers
// ---------------------------------------------------------------------------

function resetCameraView(): void {
  if (!profile || profile.length < 1) {
    return
  }
  const start = profile.sampleAt(Math.min(20, profile.length))
  const ahead = profile.sampleAt(Math.min(90, profile.length))
  const backX = Math.cos(start.heading + Math.PI) * 10
  const backZ = Math.sin(start.heading + Math.PI) * 10
  camera.position.set(start.x + backX, start.y + 5.5, start.z + backZ)
  camera.lookAt(ahead.x, ahead.y + 1.6, ahead.z)
  freeFly?.syncFromCamera()
  cameraInitialized = true
}

function handleChange(kind: LabChangeKind, key: keyof LabSettings): void {
  if (key === 'cruiseSpeed' && cruise) {
    cruise.speed = settings.cruiseSpeed
  }
  if (key === 'nearDistance') {
    foliageUniforms.nearDistance.value = settings.nearDistance
  }
  if (key === 'nearTreeRadius') {
    foliageUniforms.meshRadius.value = settings.showNearTreeMeshes ? settings.nearTreeRadius : 0
    if (treeMeshManager && placements) {
      treeMeshManager.update(camera.position, placements.trees, foliageUniforms.meshRadius.value, true)
    }
  }
  if (kind === 'uniform') {
    applyToggles()
    applyWind()
    return
  }
  if (kind === 'placements') {
    rebuildPlacements()
    return
  }
  rebuildWorld()
}

function toggleCruise(): void {
  if (!cruise || !freeFly) {
    return
  }
  cruiseActive = !cruiseActive
  cruise.setActive(cruiseActive)
  freeFly.enabled = !cruiseActive
  ui?.setCruiseActive(cruiseActive)
  if (cruiseActive) {
    cruise.reset()
  }
}

async function recreateAssetStore(mode: AssetSourceMode, baseUrl: string): Promise<void> {
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()
  const gl = renderer.getContext()
  const deviceMaxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  assetStore?.dispose()
  assetStore = new LabAssetStore({
    mode,
    serverBaseUrl: baseUrl,
    maxTextureSize: settings.compatMode ? Math.min(2048, deviceMaxTextureSize) : 0,
    maxAnisotropy: Math.min(8, maxAnisotropy),
  })
  seasonLoadToken += 1
  overlay.hidden = false
  overlayDetail.textContent = '正在加载素材…'
  sharedAssets = await loadSharedAssets((loaded, total) => {
    overlayProgress.style.width = `${Math.round((loaded / Math.max(1, total)) * 50)}%`
  })
  ensureEnvironment()
  await applySeason(settings.season, { silent: false })
  rebuildWorld()
}

function handleResize(): void {
  const width = window.innerWidth
  const height = window.innerHeight
  renderer.setSize(width, height, false)
  camera.aspect = width / Math.max(1, height)
  camera.updateProjectionMatrix()
}

let frames = 0
let fpsWindowStart = performance.now()
let fps = 0
let elapsedSeconds = 0

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function updateStats(): void {
  frames += 1
  const now = performance.now()
  if (now - fpsWindowStart >= 500) {
    fps = (frames * 1000) / (now - fpsWindowStart)
    frames = 0
    fpsWindowStart = now
  }
  const info = renderer.info.render
  const treeCount = (broadleafNearMesh?.count ?? 0) + (coniferNearMesh?.count ?? 0)
  const storeStats = assetStore?.stats()
  const seasonBytes = assetStore
    ? assetStore.bytesFor(collectSeasonTextureRefs(activeSeason).map((ref) => ref.id))
    : 0
  const preset = resolveEnvironmentPreset(currentEnvironmentState())
  statsElement.textContent = [
    `FPS ${fps.toFixed(0)} · draw calls ${info.calls} · tris ${(info.triangles / 1e6).toFixed(2)}M`
      + ` · 环境 ${SEASON_LABELS[activeSeason]}·${TIME_OF_DAY_LABELS[settings.timeOfDay]}·${WEATHER_LABELS[settings.weather]}`,
    `天空${settings.showSky ? '开' : '关'} · 云${settings.showClouds ? '开' : '关'}(${preset.clouds.mode})`
      + ` · 星空${preset.stars ? `夜晴${settings.showStars ? '' : '·切'}` : '—'}`
      + ` · 降雪${preset.snow && preset.snow.density > 0 ? `${preset.snow.density}${settings.showSnow ? '' : '·切'}` : '—'}`,
    `树卡 ${treeCount} · 近树3D ${treeMeshManager?.instanceCount ?? 0} · 草 ${grassMesh?.count ?? 0} · 灌木花草 ${bushMesh?.count ?? 0}`,
    `护栏 ${barrierSegmentCount} · 道路 ${profile ? Math.round(profile.length) : 0}m · 世界生成 ${lastWorldBuildMs ? `${Math.round(lastWorldBuildMs)}ms` : '—'} · 切季 ${lastSeasonSwitchMs ? `${Math.round(lastSeasonSwitchMs)}ms` : '—'}`,
    `素材 ${storeStats?.textureCount ?? 0} 张 · 常驻≈${storeStats ? formatMb(storeStats.residentBytes) : '—'} · 本季下载 ${formatMb(seasonBytes)}${assetStore?.mode === 'server' ? ` · 已下载 ${formatMb(storeStats?.downloadedBytes ?? 0)}` : ''} · 种子 ${settings.seed >>> 0}`,
  ].join('\n')
}

let lastFrameAt = performance.now()

function animate(): void {
  requestAnimationFrame(animate)
  const now = performance.now()
  const dt = Math.min((now - lastFrameAt) / 1000, 0.1)
  lastFrameAt = now
  elapsedSeconds += dt
  foliageUniforms.time.value = elapsedSeconds
  foliageUniforms.cameraPosition.value.copy(camera.position)

  if (terrainBuilder) {
    const done = terrainBuilder.step(10)
    overlayProgress.style.width = `${Math.round(terrainBuilder.progress * 100)}%`
    if (done) {
      finalizeTerrain()
    }
  }

  if (cruiseActive && cruise) {
    cruise.update(dt, camera)
  } else {
    freeFly?.update(dt)
  }
  if (treeMeshManager && placements) {
    treeMeshManager.update(camera.position, placements.trees, foliageUniforms.meshRadius.value)
  }
  environmentController?.update(dt)
  water?.setTime(elapsedSeconds)
  renderer.render(scene, camera)
  updateStats()
}

async function init(): Promise<void> {
  runSelfChecks()
  runSeasonCatalogChecks({ catalog: catalogForChecks })
  runEnvironmentChecks()
  console.info(`[slowroads-lab] max texture units = ${renderer.capabilities.maxTextures}`)

  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  assetStore = new LabAssetStore({
    mode: settings.assetSource,
    serverBaseUrl: settings.serverBaseUrl,
    maxTextureSize: settings.compatMode ? 2048 : 0,
    maxAnisotropy,
  })
  sharedAssets = await loadSharedAssets()
  ensureEnvironment()
  await applySeason(settings.season, { silent: true })

  cruise = createCruiseController(() => profile)
  cruise.speed = settings.cruiseSpeed
  freeFly = createFreeFlyControls(camera, canvas)
  foliageUniforms.nearDistance.value = settings.nearDistance
  foliageUniforms.meshRadius.value = settings.showNearTreeMeshes ? settings.nearTreeRadius : 0

  treeMeshManager = await createTreeMeshManager({
    assetStore: requireStore(),
    shared: foliageUniforms,
    densityMap: getFoliageDensityTexture(),
    // 官方树卡变色噪声（Ui）：与树卡 dissolve 共用同一张 noiseMap，uv = 世界坐标 / 256。
    noiseMap: sharedAssets.noise,
    worldSize: WORLD_SIZE,
  })
  scene.add(treeMeshManager.container)
  treeMeshManager.setSeason({
    textures: seasonAssets!.treeMeshes,
    // 官方 effects.treeDiscolouration = 变色噪声幅度（顶点按 1±factor/2 换算成乘数）。
    discolouration: SEASON_PARAMS[activeSeason].treeDiscolouration,
    hasSnow: SEASON_PARAMS[activeSeason].hasSnow,
  })

  ui = createLabUi(panel, settings, {
    onChange: (kind, key) => handleChange(kind, key),
    onSeasonChange: (season) => {
      if (season !== activeSeason) {
        void applySeason(season)
      }
    },
    onEnvironmentChange: () => applyEnvironmentState(),
    onCompatModeChange: () => {
      void recreateAssetStore(settings.assetSource, settings.serverBaseUrl)
    },
    onAssetSourceChange: (mode, baseUrl) => {
      settings.assetSource = mode
      settings.serverBaseUrl = baseUrl
      void recreateAssetStore(mode, baseUrl)
    },
    onRandomizeSeed: () => {
      settings.seed = (Math.random() * 0xffffffff) >>> 0
      rebuildWorld()
    },
    onRegenerate: () => rebuildWorld(),
    onToggleCruise: () => toggleCruise(),
    onResetCamera: () => {
      if (cruiseActive) {
        toggleCruise()
      }
      resetCameraView()
    },
  })
  window.addEventListener('resize', handleResize)
  handleResize()
  rebuildWorld()
  requestAnimationFrame(animate)
}

void init()

// Expose a couple of handles for quick console debugging.
Object.assign(globalThis, {
  __slowroadsLab: {
    scene,
    camera,
    renderer,
    get settings() {
      return settings
    },
    get terrainMesh() {
      return terrainMesh
    },
    get terrainMaterial() {
      return terrainMaterialHandle?.material ?? null
    },
    get field() {
      return field
    },
    get profile() {
      return profile
    },
    get placements() {
      return placements
    },
    get water() {
      return water?.mesh ?? null
    },
    get activeSeason() {
      return activeSeason
    },
    get treeMeshCount() {
      return treeMeshManager?.instanceCount ?? 0
    },
    auditLandscapeMaterialUniforms,
    get uniformCheck() {
      return lastUniformCheck
    },
    checkFogUniformColorSpace,
    get fogColorCheck() {
      return lastFogColorCheck
    },
    checkSkyFogScale,
    get skyFogCheck() {
      return lastSkyFogCheck
    },
    rebuildWorld,
    rebuildPlacements,
    applySeason: (season: SeasonId) => applySeason(season),
  },
})
