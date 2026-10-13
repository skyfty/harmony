import * as THREE from 'three'
import {
  ENVIRONMENT_CLOUD_ALTITUDE,
  ENVIRONMENT_VIEW_DISTANCE,
  resolveEnvironmentPreset,
  resolveFogParams,
  type EnvironmentState,
  type ResolvedFogParams,
} from '../core/environment'
import { applyFogToScene, slowroadsFogUniforms, updateHazeForCamera, type HazeState } from './fogPatch'
import type { CloudsHandle } from './clouds'
import type { SkyHandle } from './sky'
import type { SnowHandle } from './snow'
import type { StarsHandle } from './stars'
import type { WaterHandle } from './water'

/**
 * 把 EnvironmentState（季节 × 时间 × 天气）应用到 lab 场景：
 *  - 光照：sun/ambient 颜色与强度（含官方 hemisphere 近似的折算与统一曝光标定）；
 *  - 雾：三色 + haze（每帧按相机高度插值）；
 *  - 水面颜色与菲涅尔、天空距离、云层、星空、降雪；
 *  - 季节切换只换资产集，环境参数始终由本控制器统一下发（季节也是预设维度）。
 *
 * 曝光标定：lab 的材质在无 tone mapping 下用 `color *= ambient + sun*ndl` 手工
 * 光照，官方则用 three 灯光管线（sun 强度最高 4、ambient/hemi 1.x）。为了让
 * 「春季·白天·晴」与移植前的画面一致，统一乘 `LIGHT_EXPOSURE`，其余组合继承
 * 官方相对比例。
 */

const LIGHT_EXPOSURE = 0.21

export interface EnvironmentToggles {
  sky: boolean
  clouds: boolean
  stars: boolean
  snow: boolean
}

export interface EnvironmentControllerOptions {
  scene: THREE.Scene
  camera: THREE.Camera
  sky: SkyHandle
  clouds: CloudsHandle
  stars: StarsHandle
  snow: SnowHandle
  getWater: () => WaterHandle | null
}

export interface EnvironmentController {
  applyState(state: EnvironmentState): void
  update(deltaSeconds: number): void
  setToggles(toggles: EnvironmentToggles): void
  readonly state: EnvironmentState | null
  readonly activeFog: ResolvedFogParams
  dispose(): void
}

export function createEnvironmentController(options: EnvironmentControllerOptions): EnvironmentController {
  const scene = options.scene
  const camera = options.camera

  // three 只把它当 USE_FOG/FOG_EXP2 开关；颜色/密度由我们下发（官方也是自管）。
  scene.fog = new THREE.FogExp2(0x000000, 0.0013)

  const hazeState: HazeState = { inHaze: false }
  const fogColors = {
    colA: new THREE.Color(1, 1, 1),
    colB: new THREE.Color(1, 1, 1),
    colC: new THREE.Color(1, 1, 1),
  }
  const sunOut = new THREE.Color()
  const ambientOut = new THREE.Color()
  const ambientTerm = new THREE.Color()
  let baseFog: ResolvedFogParams = resolveFogParams(resolveEnvironmentPreset({
    season: 'spring',
    timeOfDay: 'day',
    weather: 'clear',
  }))
  let state: EnvironmentState | null = null
  let toggles: EnvironmentToggles = { sky: true, clouds: true, stars: true, snow: true }
  const forwardScratch = new THREE.Vector3()
  let cachedStars: ReturnType<typeof resolveEnvironmentPreset>['stars'] | null = null
  let cachedSnow: ReturnType<typeof resolveEnvironmentPreset>['snow'] | null = null
  let colorsDirty = true
  let lastFog: ResolvedFogParams | null = null
  let elapsedSeconds = 0

  const applyLights = (sunCol: string, sunIntensity: number, ambCol: string, ambIntensity: number): void => {
    sunOut.set(sunCol).multiplyScalar(sunIntensity * LIGHT_EXPOSURE)
    // 官方除了 ambient light 还有 hemisphere（color=sun.col, intensity=ambient.intensity,
    // groundColor=0）；把它的上半球平均贡献折进 lab 的单一 ambient 项。
    ambientTerm.set(ambCol).multiplyScalar(ambIntensity * LIGHT_EXPOSURE)
    ambientOut.copy(ambientTerm).add(sunOut.clone().multiplyScalar(0.75))
    scene.traverse((object) => {
      const material = (object as THREE.Mesh).material
      if (!material) {
        return
      }
      const entries = Array.isArray(material) ? material : [material]
      for (const entry of entries) {
        const uniforms = (entry as THREE.ShaderMaterial).uniforms as Record<string, THREE.IUniform> | undefined
        if (!uniforms || !uniforms.uSunColor || !uniforms.uAmbient) {
          continue
        }
        ;(uniforms.uSunColor.value as THREE.Color).copy(sunOut)
        ;(uniforms.uAmbient.value as THREE.Color).copy(ambientOut)
      }
    })
  }

  const applyFog = (params: ResolvedFogParams): void => {
    const unchanged = !colorsDirty
      && lastFog !== null
      && lastFog.near === params.near
      && lastFog.far === params.far
      && lastFog.density === params.density
      && lastFog.hazeHeight === params.hazeHeight
      && lastFog.hazeIntensity === params.hazeIntensity
    if (unchanged) {
      return
    }
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.density = params.density
    } else {
      scene.fog = new THREE.FogExp2(0x000000, params.density)
    }
    // 内置材质（天空/云/星）的 uniforms 只存在于编译后的 shader 上，
    // 无法通过 material.uniforms 遍历，因此把当前值写入它们绑定的共享实例。
    slowroadsFogUniforms.fogNear.value = params.near
    slowroadsFogUniforms.fogFar.value = params.far
    slowroadsFogUniforms.fogDensity.value = params.density
    slowroadsFogUniforms.hazeHeight.value = params.hazeHeight
    slowroadsFogUniforms.hazeIntensity.value = params.hazeIntensity
    ;(slowroadsFogUniforms.fogColorA.value as THREE.Color).copy(fogColors.colA)
    ;(slowroadsFogUniforms.fogColorB.value as THREE.Color).copy(fogColors.colB)
    ;(slowroadsFogUniforms.fogColorC.value as THREE.Color).copy(fogColors.colC)
    applyFogToScene(scene, params, fogColors)
    lastFog = params
    colorsDirty = false
  }

  return {
    get state() {
      return state
    },
    get activeFog() {
      return baseFog
    },
    applyState(next: EnvironmentState): void {
      state = next
      const preset = resolveEnvironmentPreset(next)
      applyLights(preset.lights.sun.col, preset.lights.sun.intensity, preset.lights.ambient.col, preset.lights.ambient.intensity)
      fogColors.colA.set(preset.fog.colA)
      fogColors.colB.set(preset.fog.colB)
      fogColors.colC.set(preset.fog.colC ?? preset.fog.colB)
      colorsDirty = true
      baseFog = resolveFogParams(preset)
      hazeState.inHaze = false
      applyFog(baseFog)
      options.sky.setViewDistance(ENVIRONMENT_VIEW_DISTANCE)
      options.clouds.setState(preset.clouds, ENVIRONMENT_CLOUD_ALTITUDE, ENVIRONMENT_VIEW_DISTANCE)
      cachedStars = preset.stars ?? null
      cachedSnow = preset.snow ?? null
      options.stars.setConfig(toggles.stars ? cachedStars : null)
      options.snow.setConfig(toggles.snow ? cachedSnow : null)
      options.getWater()?.setEnvironment({
        body: preset.water.body,
        highlight: preset.water.highlight,
        fresnelFactor: preset.lights.fresnelFactor,
      })
      options.sky.setVisible(toggles.sky)
      options.clouds.setVisible(toggles.clouds)
    },
    update(deltaSeconds: number): void {
      const effective = updateHazeForCamera(baseFog, camera.position.y, hazeState)
      applyFog(effective)
      elapsedSeconds += deltaSeconds
      options.clouds.update(deltaSeconds, camera.position)
      options.stars.update(camera.position)
      camera.getWorldDirection(forwardScratch)
      options.snow.update(elapsedSeconds, camera.position, forwardScratch)
    },
    setToggles(next: EnvironmentToggles): void {
      toggles = next
      options.sky.setVisible(next.sky)
      options.clouds.setVisible(next.clouds)
      options.stars.setConfig(next.stars ? cachedStars : null)
      options.snow.setConfig(next.snow ? cachedSnow : null)
    },
    dispose(): void {
      options.sky.dispose()
      options.clouds.dispose()
      options.stars.dispose()
      options.snow.dispose()
    },
  }
}
