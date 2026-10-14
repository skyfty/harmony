import * as THREE from 'three'
import type { SlowroadsEnvironmentSettings } from '../../core'
import {
  ENVIRONMENT_CLOUD_ALTITUDE,
  ENVIRONMENT_VIEW_DISTANCE,
  resolveEnvironmentPreset,
  resolveFogParams,
  type EnvironmentPreset,
  type ResolvedFogParams,
} from '../core/environment'
import { SHARED_TEXTURES } from '../core/seasonCatalog'
import type { SlowroadsAssetStore } from '../assets/assetStore'
import {
  resolveHazeForCamera,
  setSlowroadsFogEnabled,
  setSlowroadsFogParams,
  type SlowroadsHazeState,
} from './fogInjection'
import { createSlowroadsSky, type SlowroadsSkyHandle } from './sky'
import { createSlowroadsClouds, type SlowroadsCloudsHandle } from './clouds'
import { createSlowroadsStars, type SlowroadsStarsHandle } from './stars'
import { createSlowroadsSnow, type SlowroadsSnowHandle } from './snow'

/**
 * 场景级 Slow Roads 环境运行时（editor / preview / viewer 三端共用）。
 *
 * - 光照：与官方 `updateSky()` 一致的三件套（颜色/强度直接取预设）：
 *   `sun = DirectionalLight(预设 sun 色, 预设 sun 强度)`、
 *   `ambient = AmbientLight(预设 ambient 色, 预设 ambient 强度)`、
 *   `hemisphere = HemisphereLight(sky = 预设 sun 色, ground = 黑, 强度 = 预设
 *   ambient 强度)`；太阳方向固定竖直向下（官方锚定载具上方 10m 的等价物），
 *   曝光缩放统一乘在三盏灯上。阴影开关只控制投影（castShadow），不再关灯。
 * - 雾：写入共享三色雾 uniform（场景唯一雾；`scene.fog` 恒为 null）；
 *   `setFogEnabled` 供 editor 视口做"仅选中 Environment 节点时预览"。
 * - 天空/云/星空/降雪：官方实现；材质来自在线资产包。
 */

export interface SlowroadsLightingState {
  sunColor: THREE.Color
  sunIntensity: number
  ambientColor: THREE.Color
  ambientIntensity: number
  /** 半球光：官方 skyColor = 预设 sun 色、groundColor = 黑、强度 = 预设 ambient 强度。 */
  hemiColor: THREE.Color
  hemiIntensity: number
}

export interface SlowroadsEnvironmentRuntimeOptions {
  scene: THREE.Scene
  camera: THREE.Camera
  /**
   * 预设光照下发：宿主把它应用到自己的 CSM 太阳灯与 ambient 灯。
   * 颜色实例复用，宿主应当 copy 而非保存引用。
   */
  applyLighting?: (state: SlowroadsLightingState) => void
  assetStore: SlowroadsAssetStore
  /** 雾预览开关初值（editor 视口传入"当前是否选中环境节点"）。 */
  fogEnabled?: boolean
}

export interface SlowroadsEnvironmentRuntime {
  setSettings(settings: SlowroadsEnvironmentSettings): void
  setFogEnabled(enabled: boolean): void
  /** CSM 太阳灯被外部重建/同步（如阴影配置变化）后，重新下发一次预设光照。 */
  refreshLighting(): void
  update(deltaSeconds: number): void
  readonly activePreset: EnvironmentPreset
  dispose(): void
}

export function createSlowroadsEnvironmentRuntime(
  options: SlowroadsEnvironmentRuntimeOptions,
): SlowroadsEnvironmentRuntime {
  const scene = options.scene
  const camera = options.camera
  // SR 雾是场景唯一雾：标准雾彻底置空（旧场景雾设置停用，已接受的迁移决策）。
  scene.fog = null

  const sky: SlowroadsSkyHandle = createSlowroadsSky()
  const clouds: SlowroadsCloudsHandle = createSlowroadsClouds(getPlaceholderTexture())
  const stars: SlowroadsStarsHandle = createSlowroadsStars()
  const snow: SlowroadsSnowHandle = createSlowroadsSnow(null)

  camera.add(sky.mesh)
  scene.add(clouds.mesh, stars.container, snow.container)

  const hazeState: SlowroadsHazeState = { inHaze: false }
  const fogColors = {
    colA: new THREE.Color(1, 1, 1),
    colB: new THREE.Color(1, 1, 1),
    colC: new THREE.Color(1, 1, 1),
  }
  const sunColorScratch = new THREE.Color()
  const forwardScratch = new THREE.Vector3()

  let settings: SlowroadsEnvironmentSettings | null = null
  let preset: EnvironmentPreset = resolveEnvironmentPreset({ season: 'spring', timeOfDay: 'day', weather: 'clear' })
  let baseFog: ResolvedFogParams = resolveFogParams(preset)
  let fogEnabled = options.fogEnabled ?? true
  let elapsedSeconds = 0
  let disposed = false
  let textureToken = 0

  const lightingState: SlowroadsLightingState = {
    sunColor: new THREE.Color('#ffffff'),
    sunIntensity: 3,
    ambientColor: new THREE.Color('#ffffff'),
    ambientIntensity: 1,
    hemiColor: new THREE.Color('#ffffff'),
    hemiIntensity: 1,
  }

  setSlowroadsFogEnabled(fogEnabled)
  applyPreset(preset, settings)

  function applyLights(next: EnvironmentPreset, nextSettings: SlowroadsEnvironmentSettings | null): void {
    if (!options.applyLighting) {
      return
    }
    const exposure = nextSettings?.exposureScale ?? 1
    lightingState.sunColor.copy(sunColorScratch.set(next.lights.sun.col))
    lightingState.sunIntensity = next.lights.sun.intensity * exposure
    lightingState.ambientColor.set(next.lights.ambient.col)
    lightingState.ambientIntensity = next.lights.ambient.intensity * exposure
    lightingState.hemiColor.copy(sunColorScratch.set(next.lights.sun.col))
    lightingState.hemiIntensity = next.lights.ambient.intensity * exposure
    options.applyLighting(lightingState)
  }

  function applyFog(next: EnvironmentPreset): void {
    fogColors.colA.set(next.fog.colA)
    fogColors.colB.set(next.fog.colB)
    fogColors.colC.set(next.fog.colC ?? next.fog.colB)
    baseFog = resolveFogParams(next, ENVIRONMENT_VIEW_DISTANCE)
    hazeState.inHaze = false
    setSlowroadsFogParams(baseFog, fogColors)
    setSlowroadsFogEnabled(fogEnabled)
  }

  function applyPreset(next: EnvironmentPreset, nextSettings: SlowroadsEnvironmentSettings | null): void {
    applyLights(next, nextSettings)
    applyFog(next)
    sky.setViewDistance(ENVIRONMENT_VIEW_DISTANCE)
    clouds.setState(next.clouds, ENVIRONMENT_CLOUD_ALTITUDE, ENVIRONMENT_VIEW_DISTANCE)
    stars.setConfig(nextSettings?.showStars === false ? null : next.stars ?? null)
    snow.setConfig(nextSettings?.showSnow === false ? null : next.snow ?? null)
    applyToggles(nextSettings)
  }

  function applyToggles(nextSettings: SlowroadsEnvironmentSettings | null): void {
    const showClouds = nextSettings?.showClouds ?? true
    const showStars = nextSettings?.showStars ?? true
    const showSnow = nextSettings?.showSnow ?? true
    // 天空是唯一背景（无 fallback background），始终显示。
    sky.setVisible(true)
    clouds.setVisible(showClouds)
    stars.setConfig(showStars ? preset.stars ?? null : null)
    snow.setConfig(showSnow ? preset.snow ?? null : null)
  }

  async function loadEnvironmentTextures(): Promise<void> {
    const token = ++textureToken
    const store = options.assetStore
    const cloudsTexture = await store.texture(SHARED_TEXTURES.clouds)
    if (token !== textureToken || disposed) {
      return
    }
    if (cloudsTexture) {
      clouds.setTexture(cloudsTexture)
    }
    const noiseTexture = await store.texture(SHARED_TEXTURES.noise)
    if (token !== textureToken || disposed) {
      return
    }
    if (noiseTexture) {
      snow.setNoiseTexture(noiseTexture)
    }
  }

  void loadEnvironmentTextures()

  return {
    get activePreset(): EnvironmentPreset {
      return preset
    },
    setSettings(next: SlowroadsEnvironmentSettings): void {
      if (disposed) {
        return
      }
      const stateChanged = !settings
        || settings.season !== next.season
        || settings.timeOfDay !== next.timeOfDay
        || settings.weather !== next.weather
      settings = { ...next }
      if (stateChanged) {
        preset = resolveEnvironmentPreset({
          season: next.season,
          timeOfDay: next.timeOfDay,
          weather: next.weather,
        })
        applyPreset(preset, settings)
        return
      }
      // 仅开关/曝光变化：不重算预设表，直接应用增量。
      applyLights(preset, settings)
      applyToggles(settings)
    },
    setFogEnabled(enabled: boolean): void {
      fogEnabled = enabled
      setSlowroadsFogEnabled(enabled)
    },
    refreshLighting(): void {
      applyLights(preset, settings)
    },
    update(deltaSeconds: number): void {
      if (disposed) {
        return
      }
      elapsedSeconds += deltaSeconds
      const effective = resolveHazeForCamera(baseFog, camera.position.y, hazeState)
      setSlowroadsFogParams(effective, fogColors)
      clouds.update(deltaSeconds, camera.position)
      stars.update(camera.position)
      camera.getWorldDirection(forwardScratch)
      snow.update(elapsedSeconds, camera.position, forwardScratch)
    },
    dispose(): void {
      if (disposed) {
        return
      }
      disposed = true
      textureToken += 1
      sky.dispose()
      clouds.dispose()
      stars.dispose()
      snow.dispose()
    },
  }
}

let placeholderTexture: THREE.Texture | null = null

function getPlaceholderTexture(): THREE.Texture {
  if (!placeholderTexture) {
    const data = new Uint8Array([0, 0, 0, 0])
    placeholderTexture = new THREE.DataTexture(data, 1, 1)
    placeholderTexture.needsUpdate = true
  }
  return placeholderTexture
}
