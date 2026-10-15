import * as THREE from 'three'
import { ENVIRONMENT_SKY_DISTANCE } from '../core/environment'
import { bindSlowroadsSkyFogUniforms, slowroadsFogInjectionSource, SLOWROADS_SKY_FOG_FRAGMENT } from './fogInjection'

/**
 * slowroads 天空：一块挂在相机上的巨型平面，画面完全由注入的三色雾决定
 * （与官方一致：材质自身只开启雾，雾距≈视距时输出 fogColorA/B 渐变）。
 *
 * 官方实现（Hills 场景）：`sky = new Mesh(PlaneGeometry(1,1), basicMaterial)`，
 * 缩放 (1e6,1e5,1e5)、renderOrder=-10、作为相机的子节点挂在
 * `z = -(n1 - 0.1)`（n1 = tileSize × 2 = `ENVIRONMENT_SKY_DISTANCE`）。
 * 第五批起天空绑「天空组」雾 uniform（2000 尺度）：`vFogBlend` 因此回到官方值
 * （`preset.fog.near < 0` 的预设不再掉到 0.722），天空 A/B 渐变与官方一致。
 */
export interface SlowroadsSkyHandle {
  mesh: THREE.Mesh
  /**
   * 天空尺度距离（官方 sky.position.z = -n1 + 0.1，n1 = tileSize × 2）。
   *
   * `coverageDistance` 用于保持官方视场覆盖角：官方平面半高 5e4 挂在 n1=2000 处，
   * 覆盖到 atan(5e4/2000)≈87.7°；编辑器雾尺度自适应把 n1 放大到 2000×倍率后，
   * 若几何不变，天顶会出现约 16.8°（7.5×）～25.6°（12×）的空洞并露出背景色。
   * 因此几何按 `coverageDistance / ENVIRONMENT_SKY_DISTANCE` 等比放大（默认取
   * `viewDistance`，即不裁剪时与 lab 逐字一致）。
   */
  setViewDistance(viewDistance: number, coverageDistance?: number): void
  setVisible(visible: boolean): void
  dispose(): void
}

/** 官方天空平面几何（Lab/官方：scale = (1e6, 1e5, 1e5)）。 */
const SKY_PLANE_SCALE = { x: 1e6, y: 1e5, z: 1e5 }

/**
 * 保持官方覆盖角所需的几何倍率 = 覆盖距离 / 官方天空距离。
 * ≥ 1（覆盖距离不小于官方 n1 时按比例放大；更近的裁剪距离只会带来更大覆盖）。
 */
export function resolveSkyPlaneScale(coverageDistance: number): number {
  if (!Number.isFinite(coverageDistance) || coverageDistance <= 0) {
    return 1
  }
  return Math.max(1, coverageDistance / ENVIRONMENT_SKY_DISTANCE)
}

export function createSlowroadsSky(): SlowroadsSkyHandle {
  const geometry = new THREE.PlaneGeometry(1, 1)
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    fog: true,
    depthTest: true,
    wireframe: false,
  })
  material.onBeforeCompile = (shader) => {
    // 内置材质的雾 uniform 是模块加载时的快照，需绑定共享实例（天空组）。
    bindSlowroadsSkyFogUniforms(shader.uniforms)
    const fog = slowroadsFogInjectionSource()
    shader.vertexShader = shader.vertexShader
      // 天空平面用「官方距离等效」的顶点雾体：平台距离可能被相机远裁剪面压近
      // （雾尺度自适应后 n1 远超编辑器相机 far），skyDepthCorrection 负责换算。
      .replace('#include <fog_pars_vertex>', fog.skyVertexPars)
      .replace('#include <fog_vertex>', fog.skyVertexBody)
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <fog_pars_fragment>',
        fog.displaySpaceEnabled ? fog.displayFragmentPars : fog.fragmentPars,
      )
      .replace(
        '#include <fog_fragment>',
        fog.displaySpaceEnabled
          ? `${fog.displayFragmentSkyBody}\n${fog.displayFragmentEpilogue}`
          : SLOWROADS_SKY_FOG_FRAGMENT,
      )
  }
  material.name = 'slowroads-sky-material'
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'slowroads-sky'
  mesh.scale.set(SKY_PLANE_SCALE.x, SKY_PLANE_SCALE.y, SKY_PLANE_SCALE.z)
  mesh.renderOrder = -10
  mesh.frustumCulled = false
  mesh.position.z = -(ENVIRONMENT_SKY_DISTANCE - 0.1)

  return {
    mesh,
    setViewDistance(viewDistance: number, coverageDistance: number = viewDistance): void {
      mesh.position.z = -(viewDistance - 0.1)
      const scale = resolveSkyPlaneScale(coverageDistance)
      mesh.scale.set(SKY_PLANE_SCALE.x * scale, SKY_PLANE_SCALE.y * scale, SKY_PLANE_SCALE.z * scale)
    },
    setVisible(visible: boolean): void {
      mesh.visible = visible
    },
    dispose(): void {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
