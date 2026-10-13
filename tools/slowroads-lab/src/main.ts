import * as THREE from 'three'
import './style.css'
import bushUrl from './assets/bush.png'
import grassUrl from './assets/grass.png'
import { SLOWROADS_ASSETS, type SlowroadsAssetId } from './assets/slowroads/manifest'
import { computeBarrierSegments } from './lab/barrier'
import { createCruiseController, createFreeFlyControls, type CruiseController, type FreeFlyControls } from './lab/cruiseCamera'
import {
  createFoliageMesh,
  createFoliageSharedUniforms,
  disposeFoliageMesh,
  setFoliageWindStrength,
  type SpriteInstance,
} from './lab/foliage'
import { createHeightfield, type Heightfield } from './lab/heightfield'
import { degreesToRadians } from './lab/noise'
import { computePlacements, createTreeDensityField, type LabPlacements, type TreeDensityField, type TreePlacement } from './lab/placement'
import { createRoadProfile, type RoadProfile } from './lab/roadProfile'
import { resolveSeedHeadingRad, traceRoadPath } from './lab/roadTrace'
import { runSelfChecks } from './lab/selfCheck'
import {
  BARRIER_RAIL_REGIONS,
  FLOWER_REGIONS,
  NEAR_BROADLEAF_REGIONS,
  NEAR_CONIFER_REGIONS,
  TALL_GRASS_REGIONS,
  gridRegions,
  type SpriteAtlasSpec,
} from './lab/spriteRegions'
import { createTerrainMaterial, type TerrainMaterialHandle, type TerrainTextureSet } from './lab/terrainMaterial'
import { createTerrainMeshBuilder, type TerrainMeshBuilder } from './lab/terrainMesh'
import { createWater, type WaterHandle } from './lab/water'
import { createLabUi, DEFAULT_LAB_SETTINGS, type LabChangeKind, type LabSettings, type LabUiHandle } from './ui'

const WORLD_SIZE = 1600
const TERRAIN_SEGMENTS = 1024
const SKY_COLOR = 0xc9dcee
const ROAD_SHOULDER_WIDTH = 2.5
const WIND_FACTOR = { grass: 0.1, bush: 0.06, tree: 0.03, flower: 0.05, tallGrass: 0.08 } as const

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

interface Atlases {
  grass: SpriteAtlasSpec
  bush: SpriteAtlasSpec
  broadleafNear: SpriteAtlasSpec
  broadleafFar: SpriteAtlasSpec
  coniferNear: SpriteAtlasSpec
  coniferFar: SpriteAtlasSpec
  flowers: SpriteAtlasSpec
  tallGrass: SpriteAtlasSpec
  barrier: SpriteAtlasSpec
}

let atlases: Atlases | null = null
let surfaceTextures: TerrainTextureSet | null = null
let waterWavesTexture: THREE.Texture | null = null
let field: Heightfield | null = null
let profile: RoadProfile | null = null
let densityField: TreeDensityField | null = null
let terrainBuilder: TerrainMeshBuilder | null = null
let terrainMesh: THREE.Mesh | null = null
let terrainMaterialHandle: TerrainMaterialHandle | null = null
let broadleafNearMesh: THREE.InstancedMesh | null = null
let broadleafFarMesh: THREE.InstancedMesh | null = null
let coniferNearMesh: THREE.InstancedMesh | null = null
let coniferFarMesh: THREE.InstancedMesh | null = null
let grassMesh: THREE.InstancedMesh | null = null
let bushMesh: THREE.InstancedMesh | null = null
let flowerMesh: THREE.InstancedMesh | null = null
let tallGrassMesh: THREE.InstancedMesh | null = null
let barrierMesh: THREE.InstancedMesh | null = null
let water: WaterHandle | null = null
let placements: LabPlacements | null = null
let barrierSegmentCount = 0
let cruise: CruiseController | null = null
let freeFly: FreeFlyControls | null = null
let ui: LabUiHandle | null = null
let cameraInitialized = false
let worldBuildStartedAt = 0
let lastWorldBuildMs = 0
let cruiseActive = false

function clearFoliage(): void {
  disposeFoliageMesh(broadleafNearMesh)
  disposeFoliageMesh(broadleafFarMesh)
  disposeFoliageMesh(coniferNearMesh)
  disposeFoliageMesh(coniferFarMesh)
  disposeFoliageMesh(grassMesh)
  disposeFoliageMesh(bushMesh)
  disposeFoliageMesh(flowerMesh)
  disposeFoliageMesh(tallGrassMesh)
  disposeFoliageMesh(barrierMesh)
  broadleafNearMesh = null
  broadleafFarMesh = null
  coniferNearMesh = null
  coniferFarMesh = null
  grassMesh = null
  bushMesh = null
  flowerMesh = null
  tallGrassMesh = null
  barrierMesh = null
  barrierSegmentCount = 0
  placements = null
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
  water?.dispose()
  water = null
}

function applyToggles(): void {
  terrainMaterialHandle?.setToggles({
    surface: settings.showSurface,
    road: settings.showRoad,
    canopy: settings.showCanopy,
    textures: settings.showTextures,
  })
  if (broadleafNearMesh) broadleafNearMesh.visible = settings.showTrees
  if (broadleafFarMesh) broadleafFarMesh.visible = settings.showTrees
  if (coniferNearMesh) coniferNearMesh.visible = settings.showTrees
  if (coniferFarMesh) coniferFarMesh.visible = settings.showTrees
  if (grassMesh) grassMesh.visible = settings.showGrass
  if (bushMesh) bushMesh.visible = settings.showBushes
  if (flowerMesh) flowerMesh.visible = settings.showFlowers
  if (tallGrassMesh) tallGrassMesh.visible = settings.showTallGrass
  if (barrierMesh) barrierMesh.visible = settings.showBarrier
  if (water) water.mesh.visible = settings.showWater
}

function applyWind(): void {
  const strength = settings.windEnabled ? settings.windStrength : 0
  if (grassMesh) setFoliageWindStrength(grassMesh, strength * WIND_FACTOR.grass)
  if (bushMesh) setFoliageWindStrength(bushMesh, strength * WIND_FACTOR.bush)
  if (flowerMesh) setFoliageWindStrength(flowerMesh, strength * WIND_FACTOR.flower)
  if (tallGrassMesh) setFoliageWindStrength(tallGrassMesh, strength * WIND_FACTOR.tallGrass)
  if (broadleafNearMesh) setFoliageWindStrength(broadleafNearMesh, strength * WIND_FACTOR.tree)
  if (coniferNearMesh) setFoliageWindStrength(coniferNearMesh, strength * WIND_FACTOR.tree)
  if (broadleafFarMesh) setFoliageWindStrength(broadleafFarMesh, 0)
  if (coniferFarMesh) setFoliageWindStrength(coniferFarMesh, 0)
  if (barrierMesh) setFoliageWindStrength(barrierMesh, 0)
}

function rebuildWorld(): void {
  if (!atlases) {
    return
  }
  clearFoliage()
  clearTerrain()
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
  if (!terrainBuilder || !terrainBuilder.geometry || !field || !densityField) {
    return
  }
  terrainMaterialHandle = createTerrainMaterial({
    seed: settings.seed >>> 0,
    worldSize: WORLD_SIZE,
    waterLevel: field.waterLevel,
    density: densityField,
    textures: surfaceTextures,
  })
  terrainMesh = new THREE.Mesh(terrainBuilder.geometry, terrainMaterialHandle.material)
  terrainMesh.name = 'slowroads-terrain'
  scene.add(terrainMesh)
  {
    const positions = terrainMesh.geometry.getAttribute('position').array as Float32Array
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let nanCount = 0
    for (let i = 1; i < positions.length; i += 3) {
      const y = positions[i]!
      if (!Number.isFinite(y)) {
        nanCount += 1
      } else if (y < minY) {
        minY = y
      } else if (y > maxY) {
        maxY = y
      }
    }
    const attributes = Object.keys(terrainMesh.geometry.attributes).join(',')
    console.info(`[slowroads-lab] terrain verts=${positions.length / 3} y=[${minY.toFixed(1)},${maxY.toFixed(1)}] nan=${nanCount} attrs=${attributes}`)
  }
  terrainBuilder = null
  overlay.hidden = true
  lastWorldBuildMs = performance.now() - worldBuildStartedAt
  if (waterWavesTexture && field) {
    water = createWater({
      worldSize: WORLD_SIZE,
      waterLevel: field.waterLevel,
      waves: waterWavesTexture,
      skyColor: SKY_COLOR,
      sunDir: foliageUniforms.sunDir.value,
      sunColor: foliageUniforms.sunColor.value,
    })
    scene.add(water.mesh)
  }
  rebuildPlacements()
  applyToggles()
  if (!cameraInitialized) {
    resetCameraView()
  }
}

function toSprite(instance: TreePlacement, variant: number): SpriteInstance {
  return { x: instance.x, z: instance.z, y: instance.y, rotation: instance.rotation, scale: instance.scale, variant }
}

function rebuildPlacements(): void {
  if (!field || !profile || !densityField || !atlases) {
    return
  }
  clearFoliage()
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
  const broadleaf = placements.trees.filter((tree) => tree.species === 0)
  const conifer = placements.trees.filter((tree) => tree.species === 1)
  broadleafNearMesh = createFoliageMesh(broadleaf.map((tree) => toSprite(tree, tree.variantNear)), {
    atlas: atlases.broadleafNear,
    tint: 0xffffff,
    farTintScale: 0.72,
    unitSize: 8,
    shared: foliageUniforms,
    tier: 'near',
  })
  broadleafFarMesh = createFoliageMesh(broadleaf.map((tree) => toSprite(tree, tree.variantFar)), {
    atlas: atlases.broadleafFar,
    tint: 0xffffff,
    farTintScale: 0.7,
    unitSize: 8,
    shared: foliageUniforms,
    tier: 'far',
    singlePlane: true,
  })
  coniferNearMesh = createFoliageMesh(conifer.map((tree) => toSprite(tree, tree.variantNear)), {
    atlas: atlases.coniferNear,
    tint: 0xffffff,
    farTintScale: 0.72,
    unitSize: 8,
    shared: foliageUniforms,
    tier: 'near',
  })
  coniferFarMesh = createFoliageMesh(conifer.map((tree) => toSprite(tree, tree.variantFar)), {
    atlas: atlases.coniferFar,
    tint: 0xffffff,
    farTintScale: 0.7,
    unitSize: 8,
    shared: foliageUniforms,
    tier: 'far',
    singlePlane: true,
  })
  grassMesh = createFoliageMesh(placements.grass, {
    atlas: atlases.grass,
    tint: 0xffffff,
    farTintScale: 1,
    unitSize: 1.6,
    shared: foliageUniforms,
  })
  bushMesh = createFoliageMesh(placements.bushes, {
    atlas: atlases.bush,
    tint: 0xffffff,
    farTintScale: 1,
    unitSize: 2,
    shared: foliageUniforms,
  })
  flowerMesh = createFoliageMesh(placements.flowers, {
    atlas: atlases.flowers,
    tint: 0xffffff,
    farTintScale: 1,
    unitSize: 1.35,
    shared: foliageUniforms,
  })
  tallGrassMesh = createFoliageMesh(placements.tallGrass, {
    atlas: atlases.tallGrass,
    // 素材本身是浅色干草，压一层麦秆色避免看起来像白塑料。
    tint: 0xd9c69b,
    farTintScale: 1,
    unitSize: 1.55,
    shared: foliageUniforms,
  })

  const barrierSegments = computeBarrierSegments(field, profile, {
    seed: settings.seed >>> 0,
    density: settings.barrierDensity,
  })
  barrierSegmentCount = barrierSegments.length
  barrierMesh = createFoliageMesh(barrierSegments, {
    atlas: atlases.barrier,
    tint: 0xffffff,
    farTintScale: 1,
    unitSize: 0.35,
    shared: foliageUniforms,
    singlePlane: true,
  })

  scene.add(
    broadleafNearMesh,
    broadleafFarMesh,
    coniferNearMesh,
    coniferFarMesh,
    grassMesh,
    bushMesh,
    flowerMesh,
    tallGrassMesh,
    barrierMesh,
  )
  applyWind()
  applyToggles()
}

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

async function loadAtlasTexture(url: string): Promise<THREE.Texture> {
  const loader = new THREE.TextureLoader()
  const texture = await loader.loadAsync(url)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  texture.needsUpdate = true
  return texture
}

async function loadSlowroadsTexture(id: SlowroadsAssetId, tiling = false): Promise<THREE.Texture> {
  const asset = SLOWROADS_ASSETS[id]
  const loader = new THREE.TextureLoader()
  const texture = await loader.loadAsync(asset.url)
  texture.colorSpace = asset.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace
  if (tiling) {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
  } else {
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
  }
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  texture.needsUpdate = true
  return texture
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
  statsElement.textContent = [
    `FPS ${fps.toFixed(0)} · draw calls ${info.calls} · tris ${(info.triangles / 1e6).toFixed(2)}M`,
    `树 ${treeCount} · 草 ${grassMesh?.count ?? 0} · 灌木 ${bushMesh?.count ?? 0} · 花草 ${flowerMesh?.count ?? 0} · 高草 ${tallGrassMesh?.count ?? 0}`,
    `护栏 ${barrierSegmentCount} · 道路 ${profile ? Math.round(profile.length) : 0}m · 世界生成 ${lastWorldBuildMs ? `${Math.round(lastWorldBuildMs)}ms` : '—'} · 种子 ${settings.seed >>> 0}`,
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
  water?.setTime(elapsedSeconds)
  renderer.render(scene, camera)
  updateStats()
}

async function init(): Promise<void> {
  runSelfChecks()
  console.info(`[slowroads-lab] max texture units = ${renderer.capabilities.maxTextures}`)
  const [
    grassLegacy,
    bushLegacy,
    grassFiber,
    grassVariation,
    forest,
    heather,
    gravel,
    rock,
    rockBump,
    sand,
    detailNear,
    detailFar,
    noiseFineA,
    noiseFineB,
    noiseFineC,
    noiseFiner,
    nearBroadleaf,
    nearBroadleafNormal,
    nearConifer,
    nearConiferAlpha,
    farBroadleaf,
    farConifer,
    farConiferNormal,
    flowers,
    tallGrass,
    barrier,
    seaWaves,
  ] = await Promise.all([
    loadAtlasTexture(grassUrl),
    loadAtlasTexture(bushUrl),
    loadSlowroadsTexture('grass', true),
    loadSlowroadsTexture('grassVariation', true),
    loadSlowroadsTexture('forest', true),
    loadSlowroadsTexture('heather', true),
    loadSlowroadsTexture('gravel', true),
    loadSlowroadsTexture('rock', true),
    loadSlowroadsTexture('rockBump', true),
    loadSlowroadsTexture('sand', true),
    loadSlowroadsTexture('groundDetailNear', true),
    loadSlowroadsTexture('groundDetailFar', true),
    loadSlowroadsTexture('noiseFineA', true),
    loadSlowroadsTexture('noiseFineB', true),
    loadSlowroadsTexture('noiseFineC', true),
    loadSlowroadsTexture('noiseFinerA', true),
    loadSlowroadsTexture('nearTreesBroadleaf'),
    loadSlowroadsTexture('nearTreesBroadleafNormal'),
    loadSlowroadsTexture('nearTreesConifer'),
    loadSlowroadsTexture('nearTreesConiferAlpha'),
    loadSlowroadsTexture('farTreesBroadleaf'),
    loadSlowroadsTexture('farTreesConifer'),
    loadSlowroadsTexture('farTreesConiferNormal'),
    loadSlowroadsTexture('flowers'),
    loadSlowroadsTexture('tallGrass'),
    loadSlowroadsTexture('barrier'),
    loadSlowroadsTexture('seaWaves', true),
  ])

  surfaceTextures = {
    grassFiber,
    grassVariation,
    forest,
    heather,
    gravel,
    rock,
    rockBump,
    sand,
    detailNear,
    detailFar,
    noiseFineA,
    noiseFineB,
    noiseFineC,
    noiseFiner,
  }
  atlases = {
    grass: { texture: grassLegacy, regions: gridRegions(2, 2, 256, 256), note: 'grass.png 2×2' },
    bush: { texture: bushLegacy, regions: gridRegions(4, 2, 512, 256), note: 'bush.png 4×2' },
    broadleafNear: {
      texture: nearBroadleaf,
      normalTexture: nearBroadleafNormal,
      regions: NEAR_BROADLEAF_REGIONS,
      note: 'spring_trees_0 四列树丛卡 + 法线',
    },
    broadleafFar: { texture: farBroadleaf, regions: gridRegions(16, 4, 4096, 1024), note: 'spring_imposters_0_d 16×4' },
    coniferNear: {
      texture: nearConifer,
      alphaTexture: nearConiferAlpha,
      regions: NEAR_CONIFER_REGIONS,
      note: 'spring_trees_1_m + _a 四棵树卡',
    },
    coniferFar: {
      texture: farConifer,
      normalTexture: farConiferNormal,
      regions: gridRegions(16, 4, 4096, 1024),
      note: 'spring_imposters_1_d 16×4 + autumn_imposters_1_n 法线',
    },
    flowers: { texture: flowers, regions: FLOWER_REGIONS, note: 'spring_bushes 实测区域' },
    tallGrass: { texture: tallGrass, regions: TALL_GRASS_REGIONS, note: 'summer_grasses 实测区域' },
    barrier: { texture: barrier, regions: BARRIER_RAIL_REGIONS, note: 'spring_wall_barrier_wood 两条横栏' },
  }
  waterWavesTexture = seaWaves

  cruise = createCruiseController(() => profile)
  cruise.speed = settings.cruiseSpeed
  freeFly = createFreeFlyControls(camera, canvas)
  foliageUniforms.nearDistance.value = settings.nearDistance
  ui = createLabUi(panel, settings, {
    onChange: (kind, key) => handleChange(kind, key),
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
    rebuildWorld,
    rebuildPlacements,
  },
})
