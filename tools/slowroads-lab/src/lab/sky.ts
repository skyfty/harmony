import * as THREE from 'three'
import { bindSlowroadsFogUniforms } from './fogPatch'

/**
 * slowroads 天空：一块挂在相机上的巨型平面 + 官方三色雾。
 *
 * 官方实现（Hills 场景）：`sky = new Mesh(PlaneGeometry(1,1), basicMaterial)`
 * 缩放 (1e6,1e5,1e5)、renderOrder=-10、作为相机的子节点挂在 z=-(视距)+0.1 处；
 * 材质自身只有 fog:true，因此画面完全由 patch 后的 fog chunk 决定（雾距≈视距时
 * vFogDepth≈1 → 输出 mix(fogColorA, fogColorB, 视线高度因子)）。
 */
export interface SkyHandle {
  mesh: THREE.Mesh
  /** 视距（官方 sky.position.z = -viewDistance + 0.1）。 */
  setViewDistance(viewDistance: number): void
  setVisible(visible: boolean): void
  dispose(): void
}

export function createSky(): SkyHandle {
  const geometry = new THREE.PlaneGeometry(1, 1)
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    fog: true,
    depthTest: true,
    wireframe: false,
  })
  material.onBeforeCompile = (shader) => {
    // 内置材质的雾 uniform 是模块加载时的快照，需绑定共享实例。
    bindSlowroadsFogUniforms(shader.uniforms)
  }
  material.name = 'slowroads-sky-material'
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'slowroads-sky'
  mesh.scale.set(1e6, 1e5, 1e5)
  mesh.renderOrder = -10
  mesh.frustumCulled = false
  mesh.position.z = -999.9

  return {
    mesh,
    setViewDistance(viewDistance: number): void {
      mesh.position.z = -(viewDistance - 0.1)
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
