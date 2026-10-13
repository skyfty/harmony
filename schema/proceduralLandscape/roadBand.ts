import * as THREE from 'three'
import type { SeasonId } from '../slowroads/core/seasonCatalog'
import { SEASON_PARAMS } from '../slowroads/core/seasonParams'
import { injectSlowroadsFog } from '../slowroads/render/fogInjection'
import { forestDensityClassAt, type LandscapeDensityField } from './densityField'
import type { RoadTraceNode } from './roadTrace'

/**
 * 公路贴图带（slowroads road_single 网格移植）。
 *
 * - 沿道路追踪节点生成贴合压平地形的带状网格（左右边缘 = ±半宽，高出地形
 *   ~2cm），u = 0..1 横跨整个路宽，v = 里程 / (2×路宽)（road_single 的
 *   textureStretch=2 → 每 2 倍路宽重复一次贴图）；
 * - 春/秋 overlay（苔痕 / 落叶）强度 = saturate(道路两侧树影 × shadowFactor × 3)，
 *   树影由森林密度场在道路两缘采样烘焙；
 * - alphaTest 0.75（官方参数），粗糙边缘由底图 alpha 裁切；材质用
 *   MeshStandardMaterial（真实光照/CSM 阴影）+ 共享三色雾。
 */

export interface RoadBandTextures {
  base: THREE.Texture
  overlay: THREE.Texture | null
}

export interface RoadBandHandle {
  mesh: THREE.Mesh
  setSeason(season: SeasonId, textures: RoadBandTextures): void
  setVisible(visible: boolean): void
  dispose(): void
}

export interface RoadBandOptions {
  nodes: ReadonlyArray<RoadTraceNode>
  halfWidth: number
  /** 沿路步长（米）。 */
  stepLength?: number
  /** 树影烘焙（密度场 0..3 → 0..1）。 */
  density: LandscapeDensityField | null
  textures: RoadBandTextures
  season: SeasonId
  hostInverse: THREE.Matrix4 | null
}

const ROAD_LIFT = 0.02

const VERTEX_PARS = /* glsl */ `
attribute float aRoadShadow;
varying vec2 vRoadUv;
varying float vRoadShadow;
`

const VERTEX_BODY = /* glsl */ `
#include <uv_vertex>
vRoadUv = uv;
vRoadUv.y /= 2.0;
vRoadShadow = aRoadShadow;
`

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uRoadMap;
uniform sampler2D uRoadOverlay;
uniform float uRoadHasOverlay;
uniform float uRoadShadowFactor;
varying vec2 vRoadUv;
varying float vRoadShadow;
`

const FRAGMENT_BODY = /* glsl */ `
{
  vec4 roadTexel = texture2D(uRoadMap, vRoadUv);
  if (roadTexel.a < 0.75) {
    discard;
  }
  if (uRoadHasOverlay > 0.5) {
    vec4 overlayCol = texture2D(uRoadOverlay, vRoadUv);
    float overlayFactor = clamp(vRoadShadow * uRoadShadowFactor * 3.0, 0.0, 1.0);
    roadTexel.rgb = mix(roadTexel.rgb, overlayCol.rgb, overlayFactor * overlayCol.a);
  }
  diffuseColor.rgb = roadTexel.rgb;
  diffuseColor.a = 1.0;
}
`

export function createRoadBand(options: RoadBandOptions): RoadBandHandle {
  const nodes = options.nodes
  const positions: number[] = []
  const uvs: number[] = []
  const normals: number[] = []
  const shadows: number[] = []
  const indices: number[] = []

  let cumulative = 0
  let vertexCursor = 0
  let previousX = Number.NaN
  let previousZ = Number.NaN

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!
    if (Number.isFinite(previousX)) {
      cumulative += Math.hypot(node.x - previousX, node.z - previousZ)
    }
    previousX = node.x
    previousZ = node.z
    const along = cumulative
    const halfW = options.halfWidth
    const dirX = Math.cos(node.heading)
    const dirZ = Math.sin(node.heading)
    const perpX = -dirZ
    const perpZ = dirX
    const v = along / Math.max(0.001, halfW * 2)
    let shadow = 0
    if (options.density) {
      const leftClass = forestDensityClassAt(options.density, node.x + perpX * halfW, node.z + perpZ * halfW)
      const rightClass = forestDensityClassAt(options.density, node.x - perpX * halfW, node.z - perpZ * halfW)
      shadow = Math.max(leftClass, rightClass) / 3
    }
    for (const side of [-1, 1] as const) {
      positions.push(node.x + perpX * halfW * side, node.y + ROAD_LIFT, node.z + perpZ * halfW * side)
      uvs.push(side < 0 ? 0 : 1, v)
      normals.push(0, 1, 0)
      shadows.push(shadow)
    }
    if (i > 0) {
      const base = vertexCursor - 2
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
    }
    vertexCursor += 2
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('aRoadShadow', new THREE.Float32BufferAttribute(shadows, 1))
  geometry.setIndex(indices)
  if (options.hostInverse) {
    geometry.applyMatrix4(options.hostInverse)
  }
  geometry.computeBoundingSphere()

  const uniforms = {
    uRoadMap: { value: options.textures.base },
    uRoadOverlay: { value: options.textures.overlay ?? options.textures.base },
    uRoadHasOverlay: { value: options.textures.overlay ? 1 : 0 },
    uRoadShadowFactor: { value: SEASON_PARAMS[options.season].shadowFactor },
  }
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    alphaTest: 0.75,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  })
  material.name = 'slowroads-road-band-material'
  material.customProgramCacheKey = () => 'pl-road-band-v1'
  material.onBeforeCompile = (shader) => {
    for (const [name, uniform] of Object.entries(uniforms)) {
      shader.uniforms[name] = uniform as THREE.IUniform
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', FRAGMENT_BODY)
    injectSlowroadsFog(shader)
  }

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'slowroads-road-band'
  mesh.receiveShadow = true
  mesh.castShadow = false
  mesh.frustumCulled = true

  return {
    mesh,
    setSeason(season: SeasonId, textures: RoadBandTextures): void {
      uniforms.uRoadMap.value = textures.base
      uniforms.uRoadOverlay.value = textures.overlay ?? textures.base
      uniforms.uRoadHasOverlay.value = textures.overlay ? 1 : 0
      uniforms.uRoadShadowFactor.value = SEASON_PARAMS[season].shadowFactor
      material.needsUpdate = true
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
