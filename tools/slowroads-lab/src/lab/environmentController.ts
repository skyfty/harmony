import * as THREE from 'three'
import {
  ENVIRONMENT_CLOUD_ALTITUDE,
  ENVIRONMENT_VIEW_DISTANCE,
  resolveEnvironmentPreset,
  resolveFogParams,
  type EnvironmentState,
  type ResolvedFogParams,
} from '../core/environment'
import {
  applyFogToScene,
  resolveFogUniformColorSpace,
  slowroadsFogUniforms,
  updateHazeForCamera,
  writeFogUniformColors,
  type HazeState,
} from './fogPatch'
import { SEASON_PARAMS } from '../core/seasonParams'
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
  /** 用于解析雾色 uniform 的输出色空间（官方 `Bs(renderer)`）。 */
  renderer: THREE.WebGLRenderer
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
  const renderer = options.renderer

  // three 只把它当 USE_FOG/FOG_EXP2 开关；颜色/密度由我们下发（官方也是自管）。
  scene.fog = new THREE.FogExp2(0x000000, 0.0013)

  const hazeState: HazeState = { inHaze: false }
  /** 工作色空间（官方 `fog.colorA/B/C`）。 */
  const fogColors = {
    colA: new THREE.Color(1, 1, 1),
    colB: new THREE.Color(1, 1, 1),
    colC: new THREE.Color(1, 1, 1),
  }
  /**
   * 下发到 shader 的雾色：官方 `refreshFogUniforms` 用 `getRGB(..., Bs(renderer))`
   * 换算到输出色空间，因为 fog chunk 在 tonemapping/colorspace 之后混色。
   */
  const fogUniformColors = {
    colA: new THREE.Color(1, 1, 1),
    colB: new THREE.Color(1, 1, 1),
    colC: new THREE.Color(1, 1, 1),
  }
  const sunOut = new THREE.Color()
  const ambientOut = new THREE.Color()
  const hemiOut = new THREE.Color()
  const legacySun = new THREE.Color()
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

  /**
   * 官方三件套光照（updateSky 等价物）：
   *   sun       = preset.sun.col × preset.sun.intensity
   *   ambient   = preset.ambient.col × preset.ambient.intensity
   *   hemisphere = sky(preset.sun.col) × preset.ambient.intensity、ground = 黑
   * 景观材质（带 uAmbientColor 的着色器）走官方值；水面等旧材质保留 0.21 标定。
   */
  const applyLights = (
    sunCol: string,
    sunIntensity: number,
    ambCol: string,
    ambIntensity: number,
    radiance: number,
    shadowFactor: number,
    fresnelFactor: number,
  ): void => {
    sunOut.set(sunCol).multiplyScalar(sunIntensity)
    ambientOut.set(ambCol).multiplyScalar(ambIntensity)
    hemiOut.set(sunCol).multiplyScalar(ambIntensity)
    legacySun.set(sunCol).multiplyScalar(sunIntensity * LIGHT_EXPOSURE)
    scene.traverse((object) => {
      const material = (object as THREE.Mesh).material
      if (!material) {
        return
      }
      const entries = Array.isArray(material) ? material : [material]
      for (const entry of entries) {
        const uniforms = (entry as THREE.ShaderMaterial).uniforms as Record<string, THREE.IUniform> | undefined
        if (!uniforms) {
          continue
        }
        if (uniforms.uAmbientColor && uniforms.uHemiColor) {
          // 官方景观光照。
          ;(uniforms.uSunDir?.value as THREE.Vector3 | undefined)?.set(0, 1, 0)
          ;(uniforms.uSunColor.value as THREE.Color).copy(sunOut)
          ;(uniforms.uAmbientColor.value as THREE.Color).copy(ambientOut)
          ;(uniforms.uHemiColor.value as THREE.Color).copy(hemiOut)
          if (uniforms.uRadiance) {
            const scale = typeof entry.userData?.radianceScale === 'number' ? entry.userData.radianceScale : 1
            uniforms.uRadiance.value = radiance * scale
          }
          if (uniforms.uShadowFactor) {
            uniforms.uShadowFactor.value = shadowFactor
          }
          if (uniforms.uFresnelIntensity) {
            uniforms.uFresnelIntensity.value = fresnelFactor
          }
          continue
        }
        if (uniforms.uSunColor && !uniforms.uAmbientColor) {
          // 旧标定材质（水面高光等）：保持 0.21 曝光系数不变。
          ;(uniforms.uSunColor.value as THREE.Color).copy(legacySun)
        }
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
    if (colorsDirty) {
      writeFogUniformColors(fogColors, fogUniformColors, resolveFogUniformColorSpace(renderer))
      colorsDirty = false
    }
    // 内置材质（天空/云/星）的 uniforms 只存在于编译后的 shader 上，
    // 无法通过 material.uniforms 遍历，因此把当前值写入它们绑定的共享实例。
    slowroadsFogUniforms.fogNear.value = params.near
    slowroadsFogUniforms.fogFar.value = params.far
    slowroadsFogUniforms.fogDensity.value = params.density
    slowroadsFogUniforms.hazeHeight.value = params.hazeHeight
    slowroadsFogUniforms.hazeIntensity.value = params.hazeIntensity
    ;(slowroadsFogUniforms.fogColorA.value as THREE.Color).copy(fogUniformColors.colA)
    ;(slowroadsFogUniforms.fogColorB.value as THREE.Color).copy(fogUniformColors.colB)
    ;(slowroadsFogUniforms.fogColorC.value as THREE.Color).copy(fogUniformColors.colC)
    applyFogToScene(scene, params, fogUniformColors)
    lastFog = params
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
      applyLights(
        preset.lights.sun.col,
        preset.lights.sun.intensity,
        preset.lights.ambient.col,
        preset.lights.ambient.intensity,
        preset.lights.radiance ?? 0,
        SEASON_PARAMS[next.season].shadowFactor,
        preset.lights.fresnelFactor ?? 1,
      )
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
        base: preset.water.base,
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
