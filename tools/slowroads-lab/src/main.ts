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
import { runEnvironmentChecks, runSeasonCatalogChecks, runSelfChecks, type AssetsCatalogLike } from './core/selfCheck'
import { installSlowroadsFog } from './lab/fogPatch'
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
import { TIME_OF_DAY_LABELS, WEATHER_LABELS, resolveEnvironmentPreset, type EnvironmentState } from './core/environment'
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
    { id: SHARED_TEXTURES.noise.id, options: { colorSpace: 'linear', tiling: true } },
    { id: SHARED_TEXTURES.bushNoise.id, options: { colorSpace: 'linear', tiling: true } },
    { id: SHARED_TEXTURES.grassVariation.id, options: { colorSpace: 'linear', tiling: true } },
    { id: SHARED_TEXTURES.rockBump.id, options: { colorSpace: 'linear', tiling: true } },
    { id: SHARED_TEXTURES.seaWaves.id, options: { colorSpace: 'linear', tiling: true } },
    { id: SHARED_TEXTURES.clouds.id, options: { colorSpace: 'srgb', tiling: true } },
    { id: SHARED_TEXTURES.barrier.id, options: { colorSpace: 'srgb', tiling: false } },
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
    { id: entry.trees.coniferM.id, options: { colorSpace: entry.trees.coniferM.colorSpace, tiling: true } },
    { id: entry.trees.coniferA.id, options: { colorSpace: entry.trees.coniferA.colorSpace, tiling: false } },
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
): SpriteInstance {
  const index = Math.min(entries.length - 1, Math.max(0, Math.floor(instance.variantUnit * entries.length)))
  const entry = entries[index]!
  return {
    x: instance.x,
    z: instance.z,
    y: instance.y,
    rotation: instance.rotation,
    scale: instance.scale,
    variant: index,
    cell: entry.cell,
    roadProx: instance.roadProx,
  }
}

function toTreeSprite(instance: TreePlacement, variant: number): SpriteInstance {
  return { x: instance.x, z: instance.z, y: instance.y, rotation: instance.rotation, scale: instance.scale, variant }
}

function buildFoliageFromPlacements(): void {
  if (!field || !profile || !placements || !seasonAssets || !sharedAssets) {
    return
  }
  clearFoliage()
  const assets = seasonAssets
  const season = activeSeason
  const params = SEASON_PARAMS[season]
  const grassEntries = assets.grassSprites.entries
  const bushEntries = assets.bushes.entries

  grassMesh = createFoliageMesh(
    placements.grass.map((placement) => toSprite(placement, grassEntries)),
    {
      atlas: { texture: assets.grassSprites.texture, regions: grassEntries.map((entry) => entry.region) },
      tint: 0xffffff,
      farTintScale: 1,
      unitSize: 1.6,
      shared: foliageUniforms,
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
    placements.bushes.map((placement) => toSprite(placement, bushEntries)),
    {
      atlas: { texture: assets.bushes.texture, regions: bushEntries.map((entry) => entry.region) },
      tint: 0xffffff,
      farTintScale: 1,
      unitSize: 2,
      shared: foliageUniforms,
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
  const treeOptions = { discolouration: params.treeDiscolouration, hasSnow: params.hasSnow }
  broadleafNearMesh = createFoliageMesh(broadleaf.map((tree) => toTreeSprite(tree, tree.variantNear)), {
    atlas: { texture: assets.broadleaf.texture, normalTexture: assets.broadleaf.normalTexture, regions: assets.broadleaf.regions },
    tint: 0xffffff,
    farTintScale: 0.72,
    unitSize: 8,
    shared: foliageUniforms,
    tier: 'near',
    tree: { ...treeOptions, species: 0 },
  })
  broadleafFarMesh = createFoliageMesh(broadleaf.map((tree) => toTreeSprite(tree, tree.variantFar)), {
    atlas: { texture: assets.imposterBroadleaf.texture, normalTexture: assets.imposterBroadleaf.normalTexture, regions: gridRegions(16, 4, 4096, 1024) },
    tint: 0xffffff,
    farTintScale: 0.7,
    unitSize: 8,
    shared: foliageUniforms,
    tier: 'far',
    singlePlane: true,
    tree: { ...treeOptions, species: 0 },
  })
  coniferNearMesh = createFoliageMesh(conifer.map((tree) => toTreeSprite(tree, tree.variantNear)), {
    atlas: { texture: assets.conifer.texture, alphaTexture: assets.conifer.alphaTexture, regions: assets.conifer.regions },
    tint: 0xffffff,
    farTintScale: 0.72,
    unitSize: 8,
    shared: foliageUniforms,
    tier: 'near',
    tree: { ...treeOptions, species: 1 },
  })
  coniferFarMesh = createFoliageMesh(conifer.map((tree) => toTreeSprite(tree, tree.variantFar)), {
    atlas: { texture: assets.imposterConifer.texture, normalTexture: assets.imposterConifer.normalTexture, regions: gridRegions(16, 4, 4096, 1024) },
    tint: 0xffffff,
    farTintScale: 0.7,
    unitSize: 8,
    shared: foliageUniforms,
    tier: 'far',
    singlePlane: true,
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
    farTintScale: 1,
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
    ambient: foliageUniforms.ambient.value,
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
  })
  scene.add(treeMeshManager.container)
  treeMeshManager.setSeason({
    textures: seasonAssets!.treeMeshes,
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
    rebuildWorld,
    rebuildPlacements,
    applySeason: (season: SeasonId) => applySeason(season),
  },
})
