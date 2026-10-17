import * as THREE from 'three'
import './style.css'
import assetsCatalog from './core/assets-catalog.json'
import {
  createDemHeightfield,
  type DemSidecar,
  type DemTerrainBuildResult,
  type DemTerrainGrid,
  type DemTerrainWorkerRequest,
  type DemTerrainWorkerResponse,
} from './core/demTerrain'
import { runDemTerrainChecks } from './core/demSelfCheck'
import { createHeightfield, type Heightfield } from './core/heightfield'
import { clamp, degreesToRadians } from './core/noise'
import {
  computePlacements,
  computeForestTreePlacements,
  computeRoadCorridorPlacements,
  computeRoadsideTreePlacements,
  createDemForestDensityField,
  createTreeDensityField,
  type LabPlacements,
  type TreeDensityField,
  type TreePlacement,
} from './core/placement'
import { resolveTreeLodBands } from './core/treeLod'
import { createRoadProfile, type RoadProfile } from './core/roadProfile'
import {
  createFlatRoadBandColumns,
  createRoadbedPlacementSurface,
  createRoadbedTarget,
  type PlacementSurface,
  type RoadbedTarget,
} from './core/roadbed'
import { createTerrainGridSurface, type TerrainSurfaceHeightSource } from './core/terrainSurface'
import { resolveSeedHeadingRad, traceRoadPath } from './core/roadTrace'
import { computeRoadMarkings, type RoadMarkingWeights } from './core/roadMarkings'
import {
  DEFAULT_ROAD_STYLE,
  ROAD_STYLE_PROFILES,
  isSingleTrackRoad,
} from './core/roadStyle'
import { computeWallSegments, type WallSegment } from './core/walls'
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
import { createStars, resolveStarSize } from './lab/stars'
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
  BROADLEAF_CARD_REGIONS,
  bushVariantEntries,
  getConiferCardRegions,
  getGrassEntries,
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
import { createRoadMesh, type RoadMeshHandle, type RoadPaintTextures, type RoadTextureSet } from './lab/roadMesh'
import { createWallMeshes, type WallMeshHandle } from './lab/wallMesh'
import { createTerrainMaterial, type TerrainMaterialHandle, type TerrainTextureSet } from './lab/terrainMaterial'
import {
  createRoadbedGeometry,
  createTerrainGridMeshBuilder,
  type TerrainGridMeshBuilder,
} from './lab/terrainGridMesh'
import { createTerrainMeshBuilder, type TerrainMeshBuilder } from './lab/terrainMesh'
import { createTreeMeshManager, type TreeMeshManager, type TreeMeshTextures } from './lab/treeMeshes'
import { createWater, type WaterHandle } from './lab/water'
import {
  createLabUi,
  DEFAULT_LAB_SETTINGS,
  type DemBenchmarkMetrics,
  type LabChangeKind,
  type LabSettings,
  type LabUiHandle,
  type TerrainSource,
} from './ui'

// 必须在任何材质创建之前替换 three 的 fog chunk 并扩展 UniformsLib.fog。
installSlowroadsFog()

const WORLD_SIZE = 1600
const TERRAIN_SEGMENTS = 1024
const SKY_COLOR = 0xc9dcee
const ROAD_SHOULDER_WIDTH = 2.5
/** 官方 `midline.nodeSpacing` 的 lab 等价步长（追踪节点间距，米）。 */
const ROAD_TRACE_STEP = 8
/** 官方 `X.detail`：lab 固定 high 档（≥2 ⇒ Barrier / Fence 交替生成）。 */
const LAB_DETAIL = 3
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
  road: {
    single: { base: THREE.Texture; overlay: THREE.Texture | null }
    wide: {
      base: THREE.Texture
      overlay: THREE.Texture | null
      paint: RoadPaintTextures | null
    }
  }
  walls: {
    barrier: THREE.Texture
    seaWall: THREE.Texture
    fence: THREE.Texture
    drystone: THREE.Texture
  }
  treeMeshes: TreeMeshTextures
}

interface SharedRuntimeAssets {
  noise: THREE.Texture
  bushNoise: THREE.Texture
  grassVariation: THREE.Texture
  rockBump: THREE.Texture
  seaWaves: THREE.Texture
  clouds: THREE.Texture
}

let assetStore: LabAssetStore | null = null
let sharedAssets: SharedRuntimeAssets | null = null
let seasonAssets: SeasonRuntimeAssets | null = null
let seasonLoadToken = 0

let field: Heightfield | null = null
let profile: RoadProfile | null = null
let densityField: TreeDensityField | null = null
type AnyTerrainBuilder = TerrainMeshBuilder | TerrainGridMeshBuilder
let terrainBuilder: AnyTerrainBuilder | null = null
let terrainMesh: THREE.Mesh | null = null
let roadCorridorMesh: THREE.Mesh | null = null
let terrainMaterialHandle: TerrainMaterialHandle | null = null
let roadbedMaterialHandle: TerrainMaterialHandle | null = null
let roadHandle: RoadMeshHandle | null = null
let roadMarkings: RoadMarkingWeights[] | null = null
let wallHandle: WallMeshHandle | null = null
let wallSegments: WallSegment[] = []
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
let forestTrees: TreePlacement[] = []
let demGrid: DemTerrainGrid | null = null
let demBuildResult: DemTerrainBuildResult | null = null
let lastDemFiles: { demFile: File; jsonFile: File } | null = null
let demLoadToken = 0
let demLoadStartedAt = 0
let demMeshStartedAt = 0
let demMeshMs = 0
let demUploadMs = 0
let demMeshVertexCount = 0
let demMeshTriangleCount = 0
let demRoadColumnCount = 0
let demRoadCrossSlopeMax = 0
let demRoadbedSideWidth = 0
let demRoadbedHalfWidth = 0
let demRoadbedOuterError = 0
let demRoadbedMaxCutFill = 0
let demRoadbedOcclusionCount = 0
let demRoadbedAuditSamples = 0
let demRoadbedCutProx = 0
let demForestPlacementMs = 0
let demFoliageBuildMs = 0
let demWallBuildMs = 0
let demRawSurface: TerrainSurfaceHeightSource | null = null
let demRoadbedTarget: RoadbedTarget | null = null
let placementSurface: PlacementSurface | null = null
let demFirstFramePending = false
let demTotalBuildMs = 0
let activeViewDistanceScale = 1
let demBenchmarkRun: {
  sampleStartedAt: number
  frames: number
  status: 'warmup' | 'sample'
} | null = null

let grassMesh: THREE.InstancedMesh | null = null
let bushMesh: THREE.InstancedMesh | null = null
let broadleafNearMesh: THREE.InstancedMesh | null = null
let broadleafFarMesh: THREE.InstancedMesh | null = null
let coniferNearMesh: THREE.InstancedMesh | null = null
let coniferFarMesh: THREE.InstancedMesh | null = null

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
    // noise/rockBump/grassVariation/seaWaves/clouds = srgb-linear。
    { id: SHARED_TEXTURES.noise.id, options: { colorSpace: SHARED_TEXTURES.noise.colorSpace, tiling: true } },
    { id: SHARED_TEXTURES.bushNoise.id, options: { colorSpace: SHARED_TEXTURES.bushNoise.colorSpace, tiling: true } },
    { id: SHARED_TEXTURES.grassVariation.id, options: { colorSpace: SHARED_TEXTURES.grassVariation.colorSpace, tiling: true } },
    { id: SHARED_TEXTURES.rockBump.id, options: { colorSpace: SHARED_TEXTURES.rockBump.colorSpace, tiling: true } },
    { id: SHARED_TEXTURES.seaWaves.id, options: { colorSpace: SHARED_TEXTURES.seaWaves.colorSpace, tiling: true } },
    { id: SHARED_TEXTURES.clouds.id, options: { colorSpace: SHARED_TEXTURES.clouds.colorSpace, tiling: true } },
  ]
  const textures = await requireStore().textureSet(requests, onProgress)
  return {
    noise: textures.get(SHARED_TEXTURES.noise.id)!,
    bushNoise: textures.get(SHARED_TEXTURES.bushNoise.id)!,
    grassVariation: textures.get(SHARED_TEXTURES.grassVariation.id)!,
    rockBump: textures.get(SHARED_TEXTURES.rockBump.id)!,
    seaWaves: textures.get(SHARED_TEXTURES.seaWaves.id)!,
    clouds: textures.get(SHARED_TEXTURES.clouds.id)!,
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
    { id: entry.road.single.base.id, options: { colorSpace: entry.road.single.base.colorSpace, tiling: true } },
    { id: entry.road.wide.base.id, options: { colorSpace: entry.road.wide.base.colorSpace, tiling: true } },
    // 官方墙体贴图（barrier = srgb + 透明像素；concrete/drystone 不透明白底）。
    // 三类墙体网格的 u 沿墙推进（石墙每 5m 一个循环、护栏每 1.67m）⇒ 必须 Repeat，
    // 否则 u>1 会被 ClampToEdge 拉成条纹（“材质花”）；v 始终在 0..1 内不受影响。
    { id: entry.walls.barrier.id, options: { colorSpace: entry.walls.barrier.colorSpace, tiling: true } },
    { id: entry.walls.seaWall.id, options: { colorSpace: entry.walls.seaWall.colorSpace, tiling: true } },
    { id: entry.walls.fence.id, options: { colorSpace: entry.walls.fence.colorSpace, tiling: false } },
    { id: entry.walls.drystone.id, options: { colorSpace: entry.walls.drystone.colorSpace, tiling: true } },
  ]
  for (const roadSet of [entry.road.single, entry.road.wide]) {
    if (roadSet.overlay) {
      requests.push({ id: roadSet.overlay.id, options: { colorSpace: roadSet.overlay.colorSpace, tiling: true } })
    }
    if (roadSet.paint) {
      for (const ref of [
        roadSet.paint.dashed,
        roadSet.paint.solid,
        roadSet.paint.solidLeft,
        roadSet.paint.solidRight,
        roadSet.paint.mergeLeft,
        roadSet.paint.mergeRight,
      ]) {
        requests.push({ id: ref.id, options: { colorSpace: ref.colorSpace, tiling: true } })
      }
    }
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
      single: {
        base: get(entry.road.single.base),
        overlay: entry.road.single.overlay ? get(entry.road.single.overlay) : null,
      },
      wide: {
        base: get(entry.road.wide.base),
        overlay: entry.road.wide.overlay ? get(entry.road.wide.overlay) : null,
        paint: entry.road.wide.paint
          ? {
              dashed: get(entry.road.wide.paint.dashed),
              solid: get(entry.road.wide.paint.solid),
              solidLeft: get(entry.road.wide.paint.solidLeft),
              solidRight: get(entry.road.wide.paint.solidRight),
              mergeLeft: get(entry.road.wide.paint.mergeLeft),
              mergeRight: get(entry.road.wide.paint.mergeRight),
            }
          : null,
      },
    },
    walls: {
      barrier: get(entry.walls.barrier),
      seaWall: get(entry.walls.seaWall),
      fence: get(entry.walls.fence),
      drystone: get(entry.walls.drystone),
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
  grassMesh = null
  bushMesh = null
  broadleafNearMesh = null
  broadleafFarMesh = null
  coniferNearMesh = null
  coniferFarMesh = null
}

function clearTerrain(): void {
  if (terrainMesh) {
    scene.remove(terrainMesh)
    terrainMesh.geometry.dispose()
    terrainMesh = null
  }
  if (roadCorridorMesh) {
    scene.remove(roadCorridorMesh)
    roadCorridorMesh.geometry.dispose()
    roadCorridorMesh = null
  }
  terrainMaterialHandle?.dispose()
  terrainMaterialHandle = null
  roadbedMaterialHandle?.dispose()
  roadbedMaterialHandle = null
  terrainBuilder = null
  roadHandle?.dispose()
  roadHandle = null
  roadMarkings = null
  wallHandle?.dispose()
  wallHandle = null
  wallSegments = []
  water?.dispose()
  water = null
}

function clearWorldStructure(): void {
  clearFoliage()
  treeMeshManager?.update(camera.position, [], 0, true)
  clearTerrain()
  placements = null
  forestTrees = []
  field = null
  profile = null
  densityField = null
  placementSurface = null
  demFirstFramePending = false
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
  const skyBase = resolveSkyFogParams(preset, activeViewDistanceScale)
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
  const wantSkyZ = -(ENVIRONMENT_SKY_DISTANCE * activeViewDistanceScale - 0.1)
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
  const terrainOnly = settings.terrainSource === 'dem' && settings.terrainOnly
  const terrainToggles = {
    surface: settings.showSurface,
    road: !terrainOnly && settings.showRoad,
    canopy: !terrainOnly && settings.showCanopy,
    textures: settings.showTextures,
  }
  terrainMaterialHandle?.setToggles(terrainToggles)
  roadbedMaterialHandle?.setToggles({
    surface: settings.showSurface,
    road: false,
    canopy: false,
    textures: settings.showTextures,
  })
  if (grassMesh) grassMesh.visible = settings.showGrass
  if (bushMesh) bushMesh.visible = settings.showBushes
  if (broadleafNearMesh) broadleafNearMesh.visible = settings.showTrees
  if (broadleafFarMesh) broadleafFarMesh.visible = settings.showTrees
  if (coniferNearMesh) coniferNearMesh.visible = settings.showTrees
  if (coniferFarMesh) coniferFarMesh.visible = settings.showTrees
  wallHandle?.setVisibility({
    drystone: settings.showWalls && settings.showDrystone,
    barrier: settings.showWalls && settings.showBarrier,
    seaWall: settings.showWalls && settings.showSeaWall,
    fence: settings.showWalls && settings.showFence,
  })
  if (roadHandle) roadHandle.mesh.visible = settings.showRoad
  if (water) water.mesh.visible = settings.showWater
  environmentController?.setToggles({
    sky: !terrainOnly && settings.showSky,
    clouds: !terrainOnly && settings.showClouds,
    stars: !terrainOnly && settings.showStars,
    snow: !terrainOnly && settings.showSnow,
  })
  if (treeMeshManager) {
    treeMeshManager.setVisible(!terrainOnly && settings.showNearTreeMeshes)
  }
  foliageUniforms.meshRadius.value = !terrainOnly && settings.showNearTreeMeshes ? settings.nearTreeRadius : 0
  applyTreeLodBands()
}

function applyWind(): void {
  const strength = settings.windEnabled ? settings.windStrength : 0
  if (grassMesh) setFoliageWindStrength(grassMesh, strength * WIND_FACTOR.grass)
  if (bushMesh) setFoliageWindStrength(bushMesh, strength * WIND_FACTOR.bush)
  if (broadleafNearMesh) setFoliageWindStrength(broadleafNearMesh, strength * WIND_FACTOR.tree)
  if (coniferNearMesh) setFoliageWindStrength(coniferNearMesh, strength * WIND_FACTOR.tree)
  if (broadleafFarMesh) setFoliageWindStrength(broadleafFarMesh, 0)
  if (coniferFarMesh) setFoliageWindStrength(coniferFarMesh, 0)
}

function toSprite(
  instance: { x: number; z: number; y: number; rotation: number; scale: number; variantUnit: number; roadProx: number },
  entries: SpriteCellRegion[],
  field: Heightfield,
  surface?: PlacementSurface | null,
): SpriteInstance {
  const index = Math.min(entries.length - 1, Math.max(0, Math.floor(instance.variantUnit * entries.length)))
  const entry = entries[index]!
  // 官方草丛/灌木用 per-instance groundNormal 受光并驱动 fresnel；lab 从高度场采样。
  const normal = surface
    ? surface.normalAt(instance.x, instance.z)
    : field.sampleNormal(instance.x, instance.z, normalScratch)
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
function updateFoliageDensityTexture(density: TreeDensityField, worldSize = WORLD_SIZE): void {
  const texture = getFoliageDensityTexture()
  const size = FOLIAGE_DENSITY_SIZE
  const data = texture.image.data as Uint8Array
  const half = worldSize * 0.5
  for (let y = 0; y < size; y += 1) {
    const z = -half + (y / (size - 1)) * worldSize
    for (let x = 0; x < size; x += 1) {
      const px = -half + (x / (size - 1)) * worldSize
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
  const worldSize = field.worldSize
  const grassEntries = assets.grassSprites.entries
  const bushEntries = assets.bushes.entries
  const lodBands = resolveTreeLodBands(
    settings.nearDistance,
    settings.showNearTreeMeshes ? settings.nearTreeRadius : 0,
  )
  const cardDissolveFar = lodBands.cardFar
  const cardDissolveNear = lodBands.cardNear
  const cardDissolveInterval = Math.max(1, cardDissolveFar - cardDissolveNear)
  const cardNoise = sharedAssets.noise
  const foliageDensity = densityField ? getFoliageDensityTexture() : undefined

  grassMesh = createFoliageMesh(
    placements.grass.map((placement) => toSprite(placement, grassEntries, heightfield, placementSurface)),
    {
      atlas: { texture: assets.grassSprites.texture, regions: grassEntries.map((entry) => entry.region) },
      tint: 0xffffff,
      alphaTest: params.grassAlphaTest,
      unitSize: 1.6,
      shared: foliageUniforms,
      densityMap: foliageDensity,
      worldSize,
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
    placements.bushes.map((placement) => toSprite(placement, bushEntries, heightfield, placementSurface)),
    {
      atlas: { texture: assets.bushes.texture, regions: bushEntries.map((entry) => entry.region) },
      tint: 0xffffff,
      alphaTest: params.bushAlphaTest,
      distanceAlpha: true,
      unitSize: 2,
      shared: foliageUniforms,
      densityMap: foliageDensity,
      worldSize,
      palette: {
        mode: 'bush',
        season,
        noiseMap: sharedAssets.bushNoise,
        grassVariation: sharedAssets.grassVariation,
        detailFar: assets.terrain.detailFar,
      },
    },
  )

  const nearBroadleaf = placements.trees.filter((tree) => tree.species === 0)
  const nearConifer = placements.trees.filter((tree) => tree.species === 1)
  // DEM worlds place the near LOD along the road and a coarse full-terrain
  // forest in `forestTrees`. The global layer uses static cross cards so the
  // hills stay wooded at multi-kilometre range; near cards/3D trees remain
  // bounded to the road corridor.
  const farTrees = forestTrees.length ? placements.trees.concat(forestTrees) : placements.trees
  const farBroadleaf = farTrees.filter((tree) => tree.species === 0)
  const farConifer = farTrees.filter((tree) => tree.species === 1)
  // 官方 effects.treeDiscolouration 是变色噪声的**幅度**（着色器换算成 ≈1±factor/2 的乘数）。
  const treeOptions = { discolouration: params.treeDiscolouration, hasSnow: params.hasSnow }
  broadleafNearMesh = createFoliageMesh(nearBroadleaf.map((tree) => toTreeSprite(tree, tree.variantNear)), {
    atlas: { texture: assets.broadleaf.texture, normalTexture: assets.broadleaf.normalTexture, regions: assets.broadleaf.regions },
    tint: 0xffffff,
    alphaTest: 0.5,
    unitSize: 8,
    shared: foliageUniforms,
    card: { kind: 'near', dissolveNear: cardDissolveNear, dissolveFar: cardDissolveFar, dissolveInterval: cardDissolveInterval },
    lodFade: { mode: 'near-card', near: cardDissolveNear, far: cardDissolveFar },
    noiseMap: cardNoise,
    densityMap: foliageDensity,
    worldSize,
    tree: { ...treeOptions, species: 0 },
  })
  // 全图森林：静态十字面片 + 近树图集。远距离 mip 下仍能保持树冠 alpha，
  // 不受 imposter 图集透明边距影响。
  broadleafFarMesh = createFoliageMesh(farBroadleaf.map((tree) => toTreeSprite(tree, tree.variantNear)), {
    atlas: { texture: assets.broadleaf.texture, normalTexture: assets.broadleaf.normalTexture, regions: assets.broadleaf.regions },
    tint: 0xffffff,
    alphaTest: 0.15,
    unitSize: 8,
    shared: foliageUniforms,
    lodFade: { mode: 'far-card', near: cardDissolveNear, far: cardDissolveFar },
    singlePlane: true,
    staticBillboard: true,
    noiseMap: cardNoise,
    densityMap: foliageDensity,
    worldSize,
    tree: { ...treeOptions, species: 0 },
  })
  coniferNearMesh = createFoliageMesh(nearConifer.map((tree) => toTreeSprite(tree, tree.variantNear)), {
    atlas: { texture: assets.conifer.texture, alphaTexture: assets.conifer.alphaTexture, regions: assets.conifer.regions },
    tint: 0xffffff,
    alphaTest: 0.4,
    unitSize: 8,
    shared: foliageUniforms,
    card: { kind: 'near', dissolveNear: cardDissolveNear, dissolveFar: cardDissolveFar, dissolveInterval: cardDissolveInterval },
    lodFade: { mode: 'near-card', near: cardDissolveNear, far: cardDissolveFar },
    noiseMap: cardNoise,
    densityMap: foliageDensity,
    worldSize,
    tree: { ...treeOptions, species: 1 },
  })
  coniferFarMesh = createFoliageMesh(farConifer.map((tree) => toTreeSprite(tree, tree.variantNear)), {
    atlas: { texture: assets.conifer.texture, alphaTexture: assets.conifer.alphaTexture, regions: assets.conifer.regions },
    tint: 0xffffff,
    alphaTest: 0.12,
    unitSize: 8,
    shared: foliageUniforms,
    lodFade: { mode: 'far-card', near: cardDissolveNear, far: cardDissolveFar },
    singlePlane: true,
    staticBillboard: true,
    noiseMap: cardNoise,
    densityMap: foliageDensity,
    worldSize,
    tree: { ...treeOptions, species: 1 },
  })
  scene.add(
    grassMesh,
    bushMesh,
    broadleafNearMesh,
    broadleafFarMesh,
    coniferNearMesh,
    coniferFarMesh,
  )
  applyWind()
  applyToggles()
  applyTreeLodBands()
  // 新材质（雾/光照 uniform 是每材质克隆的）需要重新下发环境参数。
  environmentController?.applyState(currentEnvironmentState())
}

/** Update tree LOD uniforms without rebuilding the 1.2M far-tree instances. */
function applyTreeLodBands(): void {
  const terrainOnly = settings.terrainSource === 'dem' && settings.terrainOnly
  const meshRadius = !terrainOnly && settings.showNearTreeMeshes ? settings.nearTreeRadius : 0
  foliageUniforms.meshRadius.value = meshRadius
  const bands = resolveTreeLodBands(settings.nearDistance, meshRadius)
  const interval = Math.max(1, bands.cardFar - bands.cardNear)
  for (const mesh of [broadleafNearMesh, broadleafFarMesh, coniferNearMesh, coniferFarMesh]) {
    if (!mesh) {
      continue
    }
    const material = mesh.material as THREE.ShaderMaterial
    material.uniforms.uDissolveNear!.value = bands.cardNear
    material.uniforms.uDissolveFar!.value = bands.cardFar
    material.uniforms.uDissolveInterval!.value = interval
  }
  treeMeshManager?.setLodBand(bands.meshNear, bands.meshFar)
}

function rebuildPlacements(): void {
  if (settings.terrainSource === 'dem') {
    if (settings.terrainOnly || !field || !profile || !densityField) {
      return
    }
    const roadside = computeRoadCorridorPlacements(field, profile, {
      seed: settings.seed >>> 0,
      worldSize: field.worldSize,
      treeDensity: settings.treeDensity,
      treeSize: settings.treeSize,
      grassCorridor: settings.grassCorridor,
      grassDensity: settings.grassDensity,
      bushDensity: settings.bushDensity,
      flowerDensity: settings.flowerDensity,
      tallGrassDensity: settings.tallGrassDensity,
    }, placementSurface ?? undefined)
    const corridorTrees = computeRoadsideTreePlacements(field, profile, densityField, {
      seed: settings.seed >>> 0,
      worldSize: field.worldSize,
      treeDensity: settings.treeDensity,
      treeSize: settings.treeSize,
      grassCorridor: settings.grassCorridor,
      grassDensity: settings.grassDensity,
      bushDensity: settings.bushDensity,
      flowerDensity: settings.flowerDensity,
      tallGrassDensity: settings.tallGrassDensity,
    }, {
      surface: placementSurface ?? undefined,
      maxTrees: 30000,
      maxDistance: 150,
      alongStep: 6,
      lateralStep: 10,
      slopeLimit: 0.6,
    })
    const forestStartedAt = performance.now()
    forestTrees = computeForestTreePlacements(field, densityField, {
      seed: settings.seed >>> 0,
      worldSize: field.worldSize,
      treeDensity: settings.treeDensity,
      treeSize: settings.treeSize,
      grassCorridor: settings.grassCorridor,
      grassDensity: settings.grassDensity,
      bushDensity: settings.bushDensity,
      flowerDensity: settings.flowerDensity,
      tallGrassDensity: settings.tallGrassDensity,
    }, {
      cellSize: 40,
      maxTrees: 1300000,
      slopeLimit: 0.6,
      surface: placementSurface ?? undefined,
      profile,
      roadClearance: 14,
    })
    demForestPlacementMs = performance.now() - forestStartedAt
    placements = {
      trees: corridorTrees,
      grass: roadside.grass,
      bushes: roadside.bushes,
    }
    // Walls are generated from the same profile; on this DEM the height gates
    // may legitimately produce zero segments.
    const wallsStartedAt = performance.now()
    buildWalls()
    demWallBuildMs = performance.now() - wallsStartedAt
    const foliageStartedAt = performance.now()
    buildFoliageFromPlacements()
    demFoliageBuildMs = performance.now() - foliageStartedAt
    if (treeMeshManager && placements) {
      treeMeshManager.update(camera.position, placements.trees, foliageUniforms.meshRadius.value, true)
    }
    return
  }
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
  // 墙体先算：木栏精灵由官方 Barrier/Fence 生成器产出的段决定。
  buildWalls()
  buildFoliageFromPlacements()
  if (treeMeshManager && placements) {
    treeMeshManager.update(camera.position, placements.trees, foliageUniforms.meshRadius.value, true)
  }
}

/** 按当前路宽选官方路型贴图集：路宽 < 2.25m 用 `roadSingle`，否则用宽路 + 划线。 */
function roadTextureSet(): RoadTextureSet | null {
  if (!seasonAssets) {
    return null
  }
  const singleTrack = isSingleTrackRoad(settings.roadWidth)
  if (singleTrack) {
    return {
      base: seasonAssets.road.single.base,
      overlay: seasonAssets.road.single.overlay,
      paint: null,
      textureStretch: SEASON_CATALOG[activeSeason].road.single.stretch ?? 2,
    }
  }
  return {
    base: seasonAssets.road.wide.base,
    overlay: seasonAssets.road.wide.overlay,
    paint: seasonAssets.road.wide.paint,
    textureStretch: SEASON_CATALOG[activeSeason].road.wide.stretch ?? 1,
  }
}

/**
 * 官方路侧墙体（干砌石墙 / 硬护栏+木栏 / 混凝土海墙）。
 *
 * 放置规则见 `core/walls.ts`；这里只负责用当前季节贴图建网格并接管可见性开关。
 */
function buildWalls(): void {
  if (settings.terrainSource === 'dem' && settings.terrainOnly) {
    return
  }
  wallHandle?.dispose()
  wallHandle = null
  wallSegments = []
  if (!field || !profile || !densityField || !seasonAssets) {
    return
  }
  const style = ROAD_STYLE_PROFILES[DEFAULT_ROAD_STYLE]
  const density = densityField
  const shadowAt = (x: number, z: number): number =>
    Math.min(1, density.sampleUnit(x, z) * 1.3)
  wallSegments = computeWallSegments(field, profile, profile.nodes, {
    seed: settings.seed >>> 0,
    roadWidth: settings.roadWidth,
    density: settings.wallDensity,
    detail: LAB_DETAIL,
    waterLevel: field.waterLevel,
    style,
    shadowAt,
  })
  wallHandle = createWallMeshes({
    segments: wallSegments,
    textures: {
      drystone: seasonAssets.walls.drystone,
      barrier: seasonAssets.walls.barrier,
      seaWall: seasonAssets.walls.seaWall,
      fence: seasonAssets.walls.fence,
    },
    shadowFactor: SEASON_PARAMS[activeSeason].shadowFactor,
  })
  scene.add(wallHandle.group)
  applyToggles()
}

function rebuildWorld(): void {
  if (!sharedAssets) {
    return
  }
  if (settings.terrainSource === 'dem') {
    rebuildDemWorld()
    return
  }
  clearWorldStructure()
  cameraInitialized = false
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
  applyTerrainViewScale()
  worldBuildStartedAt = performance.now()
  overlay.hidden = false
  overlayProgress.style.width = '0%'
  overlayDetail.textContent = `种子 ${seed} · 道路 ${Math.round(profile.length)}m · 顶点 ${(terrainBuilder.vertexCount / 1e6).toFixed(2)}M`
}

function rebuildDemWorld(): void {
  if (!demGrid) {
    ui?.setDemStatus('DEM 尚未加载。请选择 dem.tif 与 dem.json。')
    return
  }
  clearWorldStructure()
  field = createDemHeightfield(demGrid)
  profile = null
  densityField = null
  placements = null
  demRoadbedTarget = null
  demRawSurface = createTerrainGridSurface({
    cols: demGrid.cols,
    rows: demGrid.rows,
    minX: demGrid.bounds.minX,
    minZ: demGrid.bounds.minZ,
    cellSizeX: demGrid.cellSizeX,
    cellSizeZ: demGrid.cellSizeZ,
    heights: demGrid.heights,
  })
  demRoadColumnCount = 0
  demRoadCrossSlopeMax = 0
  demRoadbedSideWidth = 0
  demRoadbedHalfWidth = 0
  demRoadbedOuterError = 0
  demRoadbedMaxCutFill = 0
  demRoadbedOcclusionCount = 0
  demRoadbedAuditSamples = 0
  demRoadbedCutProx = 0
  demForestPlacementMs = 0
  demFoliageBuildMs = 0
  demWallBuildMs = 0
  if (!settings.terrainOnly && settings.demSampleStep !== 1) {
    settings.demSampleStep = 1
    ui?.sync()
    ui?.setDemStatus('DEM 场景固定使用全分辨率 30m；半/四分之一仅用于 terrain-only 性能诊断。')
  }
  const seed = settings.seed >>> 0
  if (!settings.terrainOnly) {
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
    if (trace.nodes.length > 1) {
      profile = createRoadProfile(trace.nodes, {
        halfWidth: settings.roadWidth * 0.5,
        shoulderWidth: ROAD_SHOULDER_WIDTH,
        flattenBand: settings.flattenBand,
      })
      densityField = createDemForestDensityField(seed, field.worldSize)
      updateFoliageDensityTexture(densityField, field.worldSize)
      const terrainCellSize = Math.max(demGrid.cellSizeX, demGrid.cellSizeZ)
      const sideWidth = Math.max(30, terrainCellSize * 1.5)
      const coverageWidth = terrainCellSize * 0.5
      demRoadbedTarget = createRoadbedTarget(profile, demRawSurface, {
        sideWidth,
        coverageWidth,
        roadDrop: 0.05,
        coarseClearance: 4,
      })
      demRoadbedSideWidth = demRoadbedTarget.sideWidth
      demRoadbedHalfWidth = demRoadbedTarget.meshHalfWidth
      demRoadbedCutProx = Math.max(
        0,
        demRoadbedTarget.meshHalfWidth - 8 - profile.halfWidth,
      )
      placementSurface = createRoadbedPlacementSurface(demRoadbedTarget, demRawSurface)
    } else {
      ui?.setDemStatus(`DEM 道路追踪失败：${trace.failureReason ?? 'unknown'}`)
    }
  }
  const builder = createTerrainGridMeshBuilder(demGrid, {
    sampleStep: settings.terrainOnly ? settings.demSampleStep : 1,
    roadbed: demRoadbedTarget,
  })
  terrainBuilder = builder
  demMeshStartedAt = performance.now()
  const baseBuildMs = (demBuildResult?.decodeMs ?? 0) + (demBuildResult?.hybridMs ?? 0)
  demLoadStartedAt = performance.now() - baseBuildMs
  cameraInitialized = false
  applyTerrainViewScale()
  ui?.setTerrainOnlyMode(settings.terrainOnly)
  worldBuildStartedAt = performance.now()
  overlay.hidden = false
  overlayProgress.style.width = '0%'
  overlayDetail.textContent =
    `DEM ${demGrid.sourceWidth}×${demGrid.sourceHeight} · ` +
    `网格 ${builder.cols}×${builder.rows} · ` +
    `顶点 ${(builder.vertexCount / 1e6).toFixed(2)}M · ` +
    `${settings.terrainOnly ? 'terrain-only' : '路基压平 + 高分辨率路基'}`
  ui?.setDemStatus(
    `已载入 ${demGrid.sourceWidth}×${demGrid.sourceHeight} DEM；` +
    `世界 ${(demGrid.bounds.sizeX / 1000).toFixed(2)}×${(demGrid.bounds.sizeZ / 1000).toFixed(2)}km，` +
    `高程 ${demGrid.minHeight.toFixed(1)}–${demGrid.maxHeight.toFixed(1)}m` +
    `${profile ? `；道路 ${Math.round(profile.length)}m` : '；terrain-only'}。`,
  )
  resetCameraView()
}

function updateDemMetrics(fps = 0, drawCalls = 0): void {
  if (!demGrid) {
    ui?.setDemMetrics(null)
    return
  }
  const heap = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory
  const metrics: DemBenchmarkMetrics = {
    source: `dem ${demGrid.sourceWidth}×${demGrid.sourceHeight} @ ${demGrid.sourceCellSize}m`,
    width: demGrid.sourceWidth,
    height: demGrid.sourceHeight,
    sampleStep: settings.demSampleStep,
    detailEnabled: demGrid.detailEnabled,
    decodeMs: demBuildResult?.decodeMs ?? 0,
    hybridMs: demBuildResult?.hybridMs ?? 0,
    meshMs: demMeshMs,
    uploadMs: demUploadMs,
    totalBuildMs: demTotalBuildMs,
    forestPlacementMs: demForestPlacementMs,
    foliageBuildMs: demFoliageBuildMs,
    wallBuildMs: demWallBuildMs,
    forestCount: forestTrees.length,
    nearTreeCards: (broadleafNearMesh?.count ?? 0) + (coniferNearMesh?.count ?? 0),
    grassSprites: grassMesh?.count ?? 0,
    bushSprites: bushMesh?.count ?? 0,
    vertices: demMeshVertexCount,
    triangles: renderer.info.render.triangles,
    drawCalls,
    fps,
    jsHeapMb: heap?.usedJSHeapSize ? heap.usedJSHeapSize / (1024 * 1024) : null,
    roadbedSideWidth: demRoadbedSideWidth,
    roadbedHalfWidth: demRoadbedHalfWidth,
    roadbedCutProx: demRoadbedCutProx,
    roadColumns: demRoadColumnCount,
    roadCrossSlopeMax: demRoadCrossSlopeMax,
    roadbedOuterError: demRoadbedOuterError,
    roadbedMaxCutFill: demRoadbedMaxCutFill,
    roadbedOcclusionCount: demRoadbedOcclusionCount,
    roadbedAuditSamples: demRoadbedAuditSamples,
    warnings: demGrid.warnings,
  }
  ui?.setDemMetrics(metrics)
}

function finalizeDemTerrain(): void {
  if (!terrainBuilder || !terrainBuilder.geometry || !field || !seasonAssets || !demGrid) {
    return
  }
  const geometry = terrainBuilder.geometry
  demMeshMs = performance.now() - demMeshStartedAt
  demMeshVertexCount = terrainBuilder.vertexCount
  demMeshTriangleCount = terrainBuilder.triangleCount
  const heightScale = 300 / Math.max(1, field.maxHeight - field.waterLevel)
  terrainMaterialHandle = createTerrainMaterial({
    seed: settings.seed >>> 0,
    worldSize: field.worldSize,
    waterLevel: field.waterLevel,
    textures: seasonAssets.terrain,
    season: activeSeason,
    heightScale,
    density: settings.terrainOnly ? undefined : densityField ?? undefined,
    densityBounds: field.bounds,
    roadDisplacement: false,
    roadbedCutProx: demRoadbedCutProx,
    reduced: settings.compatMode,
  })
  roadbedMaterialHandle = createTerrainMaterial({
    seed: settings.seed >>> 0,
    worldSize: field.worldSize,
    waterLevel: field.waterLevel,
    textures: seasonAssets.terrain,
    season: activeSeason,
    heightScale,
    roadDisplacement: false,
    roadbedCutProx: 0,
    useBaseSurface: true,
    reduced: settings.compatMode,
  })
  // The roadbed is a strip whose winding depends on the arbitrary road
  // direction; render both sides so it always fills the coarse shader cut.
  roadbedMaterialHandle.material.side = THREE.DoubleSide
  terrainMesh = new THREE.Mesh(geometry, terrainMaterialHandle.material)
  terrainMesh.name = 'slowroads-dem-terrain'
  scene.add(terrainMesh)
  if (profile && densityField && !settings.terrainOnly) {
    const gridBuilder = terrainBuilder as TerrainGridMeshBuilder
    const gradedSurface = gridBuilder.surface
    if (!gradedSurface || !demRawSurface || !demRoadbedTarget) {
      ui?.setDemStatus('DEM 路基生成失败：地表采样器或路基目标不可用。')
      terrainBuilder = null
      overlay.hidden = true
      return
    }
    const roadbed = demRoadbedTarget
    const flatColumns = createFlatRoadBandColumns(profile, { step: 2, columnCount: 9 })
    demRoadColumnCount = flatColumns.columnCount
    demRoadCrossSlopeMax = 0
    demRoadbedAuditSamples = 0
    demRoadbedOcclusionCount = 0
    demRoadbedOuterError = 0
    demRoadbedMaxCutFill = 0
    const auditRows = Math.min(flatColumns.columns.length, 4096)
    for (let i = 0; i < auditRows; i += 1) {
      const row = profile.sampleAt(Math.min(profile.length, i * flatColumns.step))
      const perpX = -Math.sin(row.heading)
      const perpZ = Math.cos(row.heading)
      for (let sample = 0; sample < 17; sample += 1) {
        const u = sample / 16
        const lateral = -roadbed.outerHalfWidth + u * roadbed.outerHalfWidth * 2
        const x = row.x + perpX * lateral
        const z = row.z + perpZ * lateral
        const targetY = roadbed.heightAt(x, z)
        const rawY = demRawSurface.heightAt(x, z)
        const coarseY = gradedSurface.heightAt(x, z)
        demRoadbedMaxCutFill = Math.max(demRoadbedMaxCutFill, Math.abs(targetY - rawY))
        demRoadbedAuditSamples += 1
        const cut = roadbed.roadProximityAt(x, z) < demRoadbedCutProx
        if (!cut && coarseY > targetY + 1e-3) {
          demRoadbedOcclusionCount += 1
        }
        if (sample === 0 || sample === 16) {
          const outerY = roadbed.rawHeightAt(x, z)
          demRoadbedOuterError = Math.max(demRoadbedOuterError, Math.abs(outerY - rawY))
        }
      }
    }

    const roadbedGeometry = createRoadbedGeometry(profile, roadbed, {
      // Shoulder/side-slope geometry does not need asphalt-level density;
      // 4m x 3m keeps the cut/fill silhouette while cutting ~4x triangles.
      alongStep: 4,
      crossStep: 3,
      lift: 0.01,
    })
    roadCorridorMesh = new THREE.Mesh(roadbedGeometry, roadbedMaterialHandle.material)
    roadCorridorMesh.name = 'slowroads-dem-roadbed'
    scene.add(roadCorridorMesh)

    const style = ROAD_STYLE_PROFILES[DEFAULT_ROAD_STYLE]
    const densityForShadow = densityField
    roadMarkings = computeRoadMarkings(profile.nodes, {
      style,
      nodeSpacing: ROAD_TRACE_STEP,
      shadowAt: (x, z) => Math.min(1, densityForShadow.sampleUnit(x, z) * 1.3),
      edgeOffset: profile.halfWidth,
      waterLevel: field.waterLevel,
    })
    roadHandle = createRoadMesh({
      profile,
      density: densityField,
      sunDir: foliageUniforms.sunDir.value,
      sunColor: foliageUniforms.sunColor.value,
      markings: isSingleTrackRoad(settings.roadWidth) ? null : roadMarkings,
      nodeSpacing: ROAD_TRACE_STEP,
      columnHeights: flatColumns.columns,
      clearance: 0.05,
    })
    const params = SEASON_PARAMS[activeSeason]
    const roadTextures = roadTextureSet()
    if (roadTextures) {
      roadHandle.setSeason(roadTextures, params.shadowFactor)
    }
    scene.add(roadHandle.mesh)
  }
  terrainBuilder = null
  overlay.hidden = true
  lastWorldBuildMs = performance.now() - worldBuildStartedAt
  const uploadStart = performance.now()
  renderer.compile(scene, camera)
  demUploadMs = performance.now() - uploadStart
  demFirstFramePending = true
  applyToggles()
  applyEnvironmentState()
  if (!settings.terrainOnly && profile) {
    rebuildPlacements()
  }
  checkSkyFogScale()
  ui?.setDemStatus(
    `DEM 地形网格就绪：${demMeshVertexCount.toLocaleString()} 顶点 / ` +
    `${demMeshTriangleCount.toLocaleString()} 三角形；等待首帧后汇总构建时间。`,
  )
  if (!settings.terrainOnly && profile) {
    if (demRoadbedOcclusionCount > 0) {
      console.warn(
        `[slowroads-lab] DEM roadbed coarse overlap at ${demRoadbedOcclusionCount}/` +
        `${demRoadbedAuditSamples} audit samples`,
      )
    }
    ui?.setDemStatus(
      `路基压平：边坡宽 ${demRoadbedSideWidth.toFixed(1)}m，` +
      `半宽 ${demRoadbedHalfWidth.toFixed(1)}m；外侧误差 ${demRoadbedOuterError.toFixed(2)}m，` +
      `最大挖填 ${demRoadbedMaxCutFill.toFixed(1)}m，` +
      `粗网格重叠 ${demRoadbedOcclusionCount}/${demRoadbedAuditSamples}。`,
    )
  }
}

function finalizeTerrain(): void {
  if (settings.terrainSource === 'dem') {
    finalizeDemTerrain()
    return
  }
  if (!terrainBuilder || !terrainBuilder.geometry || !field || !densityField || !profile || !seasonAssets) {
    return
  }
  terrainMaterialHandle = createTerrainMaterial({
    seed: settings.seed >>> 0,
    worldSize: WORLD_SIZE,
    waterLevel: field.waterLevel,
    density: densityField,
    densityBounds: field.bounds,
    textures: seasonAssets.terrain,
    season: activeSeason,
    reduced: settings.compatMode,
  })
  terrainMesh = new THREE.Mesh(terrainBuilder.geometry, terrainMaterialHandle.material)
  terrainMesh.name = 'slowroads-terrain'
  scene.add(terrainMesh)

  // 官方划线权重（只在宽路生效）：树影按路缘采样，海拔门限以水面为零点。
  const style = ROAD_STYLE_PROFILES[DEFAULT_ROAD_STYLE]
  const densityForShadow = densityField
  roadMarkings = computeRoadMarkings(profile.nodes, {
    style,
    nodeSpacing: ROAD_TRACE_STEP,
    shadowAt: (x, z) => Math.min(1, densityForShadow.sampleUnit(x, z) * 1.3),
    edgeOffset: profile.halfWidth,
    waterLevel: field.waterLevel,
  })
  roadHandle = createRoadMesh({
    profile,
    density: densityField,
    sunDir: foliageUniforms.sunDir.value,
    sunColor: foliageUniforms.sunColor.value,
    markings: isSingleTrackRoad(settings.roadWidth) ? null : roadMarkings,
    nodeSpacing: ROAD_TRACE_STEP,
  })
  const params = SEASON_PARAMS[activeSeason]
  const roadTextures = roadTextureSet()
  if (roadTextures) {
    roadHandle.setSeason(roadTextures, params.shadowFactor)
  }
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
    roadbedMaterialHandle?.setSeason(season, assets.terrain)
    const roadTextures = roadTextureSet()
    if (roadTextures) {
      roadHandle?.setSeason(roadTextures, SEASON_PARAMS[season].shadowFactor)
    }
    wallHandle?.setTextures(
      {
        drystone: assets.walls.drystone,
        barrier: assets.walls.barrier,
        seaWall: assets.walls.seaWall,
        fence: assets.walls.fence,
      },
      SEASON_PARAMS[season].shadowFactor,
    )
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

function applyTerrainViewScale(): void {
  const extent = field ? Math.max(field.bounds.sizeX, field.bounds.sizeZ) : WORLD_SIZE
  activeViewDistanceScale = settings.terrainSource === 'dem'
    ? clamp(extent / 3000, 1, 16)
    : 1
  environmentController?.setViewDistanceScale(activeViewDistanceScale)
  camera.near = settings.terrainSource === 'dem' ? 1 : 0.1
  camera.far = settings.terrainSource === 'dem' ? 70000 : 3000
  camera.updateProjectionMatrix()
  const speedScale = settings.terrainSource === 'dem' ? activeViewDistanceScale : 1
  freeFly?.setSpeed(24 * speedScale, 72 * speedScale)
}

function resetCameraView(): void {
  if (settings.terrainSource === 'dem' && field && demGrid) {
    if (!settings.terrainOnly && profile && profile.length > 1) {
      const start = profile.sampleAt(Math.min(20, profile.length))
      const ahead = profile.sampleAt(Math.min(90, profile.length))
      const backX = Math.cos(start.heading + Math.PI) * 10
      const backZ = Math.sin(start.heading + Math.PI) * 10
      camera.position.set(start.x + backX, start.y + 5.5, start.z + backZ)
      camera.lookAt(ahead.x, ahead.y + 1.6, ahead.z)
      freeFly?.syncFromCamera()
      cameraInitialized = true
      return
    }
    const eyeY = demGrid.maxHeight + 800
    camera.position.set(0, eyeY, 0)
    camera.lookAt(demGrid.peakX, demGrid.maxHeight * 0.35, demGrid.peakZ)
    freeFly?.syncFromCamera()
    cameraInitialized = true
    return
  }
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

async function loadDemFiles(demFile: File, jsonFile: File): Promise<void> {
  cancelDemBenchmark()
  const token = ++demLoadToken
  lastDemFiles = { demFile, jsonFile }
  demLoadStartedAt = performance.now()
  demMeshStartedAt = 0
  demMeshMs = 0
  demUploadMs = 0
  demTotalBuildMs = 0
  demFirstFramePending = false
  ui?.setDemStatus('读取 dem.json…')
  try {
    const sidecar = JSON.parse(await jsonFile.text()) as DemSidecar
    const demBuffer = await demFile.arrayBuffer()
    ui?.setDemStatus('Worker 解码 DEM 与生成混合高度场…')
    const worker = new Worker(new URL('./lab/demTerrain.worker.ts', import.meta.url), { type: 'module' })
    const response = await new Promise<DemTerrainWorkerResponse>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<DemTerrainWorkerResponse>) => resolve(event.data)
      worker.onerror = (event) => reject(new Error(event.message || 'DEM worker failed'))
      const request: DemTerrainWorkerRequest = {
        demBuffer,
        sidecar,
        options: {
          detailEnabled: settings.demDetailEnabled,
          detailSeed: settings.seed >>> 0,
        },
      }
      worker.postMessage(request, [demBuffer])
    })
    worker.terminate()
    if (token !== demLoadToken) {
      return
    }
    if (!response.ok) {
      throw new Error(response.error)
    }
    demGrid = response.result.grid
    demBuildResult = response.result
    settings.terrainSource = 'dem'
    settings.terrainOnly = false
    settings.showWater = false
    ui?.sync()
    ui?.setTerrainOnlyMode(false)
    rebuildDemWorld()
  } catch (error) {
    if (token !== demLoadToken) {
      return
    }
    ui?.setDemStatus(`DEM 加载失败：${error instanceof Error ? error.message : String(error)}`)
    ui?.setDemMetrics(null)
  }
}

function handleTerrainSourceChange(source: TerrainSource): void {
  cancelDemBenchmark()
  settings.terrainSource = source
  if (source === 'dem' && !demGrid) {
    if (lastDemFiles) {
      void loadDemFiles(lastDemFiles.demFile, lastDemFiles.jsonFile)
    } else {
      ui?.setDemStatus('请先选择 dem.tif 与 dem.json，然后点击“加载 DEM”。')
    }
    return
  }
  if (source === 'procedural') {
    settings.terrainOnly = false
    ui?.setTerrainOnlyMode(false)
    ui?.setDemMetrics(null)
    ui?.setDemStatus('程序化 1600m 世界已启用；DEM 数据仍保留，可切回。')
    ui?.sync()
  }
  rebuildWorld()
}

function handleDemOptionsChange(): void {
  cancelDemBenchmark()
  if (settings.terrainSource !== 'dem' || !demGrid) {
    return
  }
  if (demGrid.detailEnabled !== settings.demDetailEnabled && lastDemFiles) {
    void loadDemFiles(lastDemFiles.demFile, lastDemFiles.jsonFile)
    return
  }
  if (demGrid.detailEnabled === settings.demDetailEnabled) {
    rebuildDemWorld()
  }
}

function runDemBenchmark(): void {
  if (!demGrid || !terrainMesh || !terrainMaterialHandle) {
    ui?.setDemStatus('DEM 地形尚未就绪，无法运行基准。')
    return
  }
  if (cruiseActive) {
    toggleCruise()
  }
  resetCameraView()
  renderer.setPixelRatio(1)
  renderer.setSize(1920, 1080, false)
  camera.aspect = 16 / 9
  camera.updateProjectionMatrix()
  if (freeFly) {
    freeFly.enabled = false
  }
  demBenchmarkRun = {
    sampleStartedAt: performance.now() + 2000,
    frames: 0,
    status: 'warmup',
  }
  ui?.setDemStatus('基准运行中：预热 2s，随后在 1920×1080、pixel ratio 1 下采样 5s。')
}

function cancelDemBenchmark(): void {
  if (!demBenchmarkRun) {
    return
  }
  demBenchmarkRun = null
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  handleResize()
  if (freeFly) {
    freeFly.enabled = true
  }
}

function handleChange(kind: LabChangeKind, key: keyof LabSettings): void {
  if (key === 'cruiseSpeed' && cruise) {
    cruise.speed = settings.cruiseSpeed
  }
  if (key === 'nearDistance') {
    foliageUniforms.nearDistance.value = settings.nearDistance
    applyTreeLodBands()
  }
  if (key === 'nearTreeRadius') {
    applyTreeLodBands()
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
  const terrainOnly = settings.terrainSource === 'dem' && settings.terrainOnly
  statsElement.textContent = [
    `FPS ${fps.toFixed(0)} · draw calls ${info.calls} · tris ${(info.triangles / 1e6).toFixed(2)}M`
      + ` · 环境 ${SEASON_LABELS[activeSeason]}·${TIME_OF_DAY_LABELS[settings.timeOfDay]}·${WEATHER_LABELS[settings.weather]}`
      + (terrainOnly ? ' · terrain-only' : ''),
    terrainOnly
      ? '天空/云/星空/降雪/水面/道路/植被/墙体：terrain-only 停用'
      : `天空${settings.showSky ? '开' : '关'} · 云${settings.showClouds ? '开' : '关'}(${preset.clouds.mode})`
        + ` · 星空${preset.stars ? `夜晴${settings.showStars ? '' : '·切'}` : '—'}`
        + ` · 降雪${preset.snow && preset.snow.density > 0 ? `${preset.snow.density}${settings.showSnow ? '' : '·切'}` : '—'}`,
    terrainOnly
      ? `DEM ${demGrid?.sourceWidth ?? 0}×${demGrid?.sourceHeight ?? 0} · 三角 ${demMeshTriangleCount.toLocaleString()}`
      : `树卡 ${treeCount} · 全图森林 ${forestTrees.length}`
        + ` · 远景实例 ${(broadleafFarMesh?.count ?? 0) + (coniferFarMesh?.count ?? 0)}`
        + ` · 近树3D ${treeMeshManager?.instanceCount ?? 0}`
        + ` · 草 ${grassMesh?.count ?? 0} · 灌木花草 ${bushMesh?.count ?? 0}`,
    terrainOnly
      ? `世界生成 ${lastWorldBuildMs ? `${Math.round(lastWorldBuildMs)}ms` : '—'} · 切季 ${lastSeasonSwitchMs ? `${Math.round(lastSeasonSwitchMs)}ms` : '—'}`
      : `墙体 ${wallSegments.length}（石墙 ${wallSegments.filter((segment) => segment.type === 'drystone').length}`
        + ` · 木栏 ${wallSegments.filter((segment) => segment.type === 'fence').length} 段`
        + ` · 护栏 ${wallSegments.filter((segment) => segment.type === 'barrier').length}`
        + ` · 海墙 ${wallSegments.filter((segment) => segment.type === 'seaWall').length}）`
        + ` · 道路 ${profile ? Math.round(profile.length) : 0}m · 世界生成 ${lastWorldBuildMs ? `${Math.round(lastWorldBuildMs)}ms` : '—'} · 切季 ${lastSeasonSwitchMs ? `${Math.round(lastSeasonSwitchMs)}ms` : '—'}`
        + (settings.terrainSource === 'dem'
          ? ` · 森林 ${Math.round(demForestPlacementMs)}ms · 植被 ${Math.round(demFoliageBuildMs)}ms`
            + ` · 墙体 ${Math.round(demWallBuildMs)}ms`
          : ''),
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
  syncStarSize()
  water?.setTime(elapsedSeconds)
  renderer.render(scene, camera)
  const frameNow = performance.now()
  if (demFirstFramePending) {
    demFirstFramePending = false
    demTotalBuildMs = demLoadStartedAt ? frameNow - demLoadStartedAt : 0
    updateDemMetrics(0, renderer.info.render.calls)
    ui?.setDemStatus(
      `DEM 首帧完成：总构建 ${demTotalBuildMs.toFixed(0)}ms；` +
      `解码 ${demBuildResult?.decodeMs.toFixed(0) ?? '—'}ms，混合 ${demBuildResult?.hybridMs.toFixed(0) ?? '—'}ms，` +
      `网格 ${demMeshMs.toFixed(0)}ms，上传 ${demUploadMs.toFixed(0)}ms。`,
    )
  }
  if (demBenchmarkRun) {
    if (frameNow < demBenchmarkRun.sampleStartedAt) {
      demBenchmarkRun.status = 'warmup'
    } else {
      demBenchmarkRun.status = 'sample'
      demBenchmarkRun.frames += 1
      if (frameNow - demBenchmarkRun.sampleStartedAt >= 5000) {
        const fps = demBenchmarkRun.frames / ((frameNow - demBenchmarkRun.sampleStartedAt) / 1000)
        updateDemMetrics(fps, renderer.info.render.calls)
        ui?.setDemStatus(
          `基准完成：${fps.toFixed(1)} FPS，draw calls ${renderer.info.render.calls}，` +
          `三角形 ${renderer.info.render.triangles.toLocaleString()}。`,
        )
        demBenchmarkRun = null
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        handleResize()
        if (freeFly) {
          freeFly.enabled = true
        }
      }
    }
  }
  updateStats()
}

/**
 * 星点尺寸按视口（绘制缓冲）高度换算：官方世界尺寸 0.01 在 dpr=1、高度 800 上下
 * 的画布上只有约 0.4 物理像素（看不清），这里换算到约 1.8 物理像素，与迁移端
 * `schema/slowroads/render/stars.ts` 的 `resolveStarSize` 一致。
 */
let lastStarSize = Number.NaN
const starSizeScratch = new THREE.Vector2()
function syncStarSize(): void {
  if (!environmentHandles) {
    return
  }
  renderer.getDrawingBufferSize(starSizeScratch)
  const size = resolveStarSize(starSizeScratch.y, renderer.getPixelRatio())
  if (size !== lastStarSize) {
    lastStarSize = size
    environmentHandles.stars.setSize(size)
  }
}

async function init(): Promise<void> {
  runSelfChecks()
  runDemTerrainChecks()
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
    onTerrainSourceChange: (source) => handleTerrainSourceChange(source),
    onLoadDem: (demFile, jsonFile) => {
      void loadDemFiles(demFile, jsonFile)
    },
    onDemOptionsChange: () => handleDemOptionsChange(),
    onRunDemBenchmark: () => runDemBenchmark(),
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
