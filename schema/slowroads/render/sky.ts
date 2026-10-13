import * as THREE from 'three'
import { ENVIRONMENT_VIEW_DISTANCE } from '../core/environment'
import { bindSlowroadsFogUniforms, slowroadsFogInjectionSource, SLOWROADS_SKY_FOG_FRAGMENT } from './fogInjection'

/**
 * slowroads 天空：一块挂在相机上的巨型平面，画面完全由注入的三色雾决定
 * （与官方一致：材质自身只开启雾，雾距≈视距时输出 fogColorA/B 渐变）。
 */
export interface SlowroadsSkyHandle {
  mesh: THREE.Mesh
  /** 视距（官方 sky.position.z = -viewDistance + 0.1）。 */
  setViewDistance(viewDistance: number): void
  setVisible(visible: boolean): void
  dispose(): void
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
    bindSlowroadsFogUniforms(shader.uniforms)
    const fog = slowroadsFogInjectionSource()
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', fog.vertexPars)
      .replace('#include <fog_vertex>', fog.vertexBody)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', fog.fragmentPars)
      .replace('#include <fog_fragment>', SLOWROADS_SKY_FOG_FRAGMENT)
  }
  material.name = 'slowroads-sky-material'
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'slowroads-sky'
  mesh.scale.set(1e6, 1e5, 1e5)
  mesh.renderOrder = -10
  mesh.frustumCulled = false
  mesh.position.z = -(ENVIRONMENT_VIEW_DISTANCE - 0.1)

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
