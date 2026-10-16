import * as THREE from 'three'
import type { SeasonId } from '../slowroads/core/seasonCatalog'
import { SEASON_PARAMS } from '../slowroads/core/seasonParams'
import { injectSlowroadsFog } from '../slowroads/render/fogInjection'
import { forestDensityClassAt, type LandscapeDensityField } from './densityField'
import type { RoadMarkingWeights } from './roadMarkings'
import { isSingleTrackRoad } from './roadStyle'
import type { RoadTraceNode } from './roadTrace'
import { recordSlowroadsShaderAudit } from './shaderAudit'

/**
 * 公路贴图带（官方 `road` / `roadSingle` 两套路型网格移植）。
 *
 * - 沿道路追踪节点生成贴合压平地形的带状网格（左右边缘 = ±半宽，高出地形
 *   ~2cm），u = 0..1 横跨整个路宽，v = 里程 / (2×半宽) / textureStretch
 *   （单车道 stretch = 2、宽路 stretch = 1，与官方一致）；
 * - 宽路（路宽 ≥ 2.25m）额外挂 6 张划线贴图：官方片元在**未拉伸**的 uv 上采样
 *   `dashed`，按 per-vertex 权重把 solid / solidLeft / solidRight / mergeLeft /
 *   mergeRight 依次混入（`smoothstep(0.49, 0.51)` 起判，merge 被实线抑制），
 *   最后以 `paintCol.a` 与原路面混色；
 * - 春/秋 overlay（苔痕 / 落叶）强度 = saturate(道路两侧树影 × shadowFactor × 3)，
 *   树影由森林密度场在道路两缘采样烘焙；
 * - 官方路面掠射边缘光（ef chunk）：与地表同款 fresnel，但无 blendVal / uv 偏置；
 * - alphaTest 0.75（官方参数），粗糙边缘由底图 alpha 裁切；材质用
 *   MeshStandardMaterial（真实光照/CSM 阴影）+ 共享三色雾。
 */

export interface RoadBandTextures {
  base: THREE.Texture
  overlay: THREE.Texture | null
  /** 宽路划线贴图（冬季宽路官方无划线 ⇒ null）。 */
  paint?: RoadPaintTextures | null
  /** 官方 `stretch`（单车道 2 / 宽路 1）。 */
  textureStretch?: number
}

export interface RoadPaintTextures {
  dashed: THREE.Texture
  solid: THREE.Texture
  solidLeft: THREE.Texture
  solidRight: THREE.Texture
  mergeLeft: THREE.Texture
  mergeRight: THREE.Texture
}

export interface RoadBandHandle {
  mesh: THREE.Mesh
  setSeason(season: SeasonId, textures: RoadBandTextures): void
  /** 官方 `lights.radiance`（与地表共享）：路面自发光强度。 */
  setRadiance(radiance: number): void
  /** 官方 `lights.fresnelFactor`：路面掠射边缘光强度。 */
  setFresnel(fresnel: number): void
  setVisible(visible: boolean): void
  dispose(): void
}

export interface RoadBandOptions {
  nodes: ReadonlyArray<RoadTraceNode>
  halfWidth: number
  /** 划线权重（每追踪节点一个）；为空或单车道时不启用划线。 */
  markings?: readonly RoadMarkingWeights[] | null
  /** 追踪节点间距（米），用于把节点权重映射到采样点。 */
  nodeSpacing?: number
  /** 沿路步长（米）。 */
  stepLength?: number
  /** 树影烘焙（密度场 0..3 → 0..1）。 */
  density: LandscapeDensityField | null
  textures: RoadBandTextures
  season: SeasonId
  hostInverse: THREE.Matrix4 | null
  /**
   * 路面相对地形的高度抬升（米）。默认 0.02（贴合慢速公路那种高密度地形）。
   * 导入的粗网格地形（如 3dtiles 导出 GLB，三角面平均 40m+）无法精确表达
   * 7m 宽的路基压平，路面带会被三角面穿插成"虚线"，此时由调用方传入更大的
   * 抬升量（见 runtime.buildRoadBand）。
   */
  lift?: number
}

const DEFAULT_ROAD_LIFT = 0.02

const VERTEX_PARS = /* glsl */ `
attribute float aRoadShadow;
attribute float aRoadPaintSolid;
attribute float aRoadPaintSolidLeft;
attribute float aRoadPaintSolidRight;
attribute float aRoadPaintMergeLeft;
attribute float aRoadPaintMergeRight;
uniform float uRoadTextureStretch;
varying vec2 vRoadUv;
varying vec2 vRoadPaintUv;
varying float vRoadShadow;
varying float vRoadSolid;
varying float vRoadSolidLeft;
varying float vRoadSolidRight;
varying float vRoadMergeLeft;
varying float vRoadMergeRight;
varying vec3 vRoadWorldPosition;
`

const VERTEX_BODY = /* glsl */ `
#include <uv_vertex>
vRoadUv = uv;
vRoadUv.y /= uRoadTextureStretch;
vRoadPaintUv = uv;
vRoadShadow = aRoadShadow;
vRoadSolid = aRoadPaintSolid;
vRoadSolidLeft = aRoadPaintSolidLeft;
vRoadSolidRight = aRoadPaintSolidRight;
vRoadMergeLeft = aRoadPaintMergeLeft;
vRoadMergeRight = aRoadPaintMergeRight;
vRoadWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
`

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uRoadMap;
uniform sampler2D uRoadOverlay;
uniform float uRoadHasOverlay;
uniform float uRoadHasPaint;
uniform sampler2D uRoadPaintDashed;
uniform sampler2D uRoadPaintSolid;
uniform sampler2D uRoadPaintSolidLeft;
uniform sampler2D uRoadPaintSolidRight;
uniform sampler2D uRoadPaintMergeLeft;
uniform sampler2D uRoadPaintMergeRight;
uniform float uRoadShadowFactor;
uniform float uRoadRadiance;
uniform float uRoadFresnelIntensity;
varying vec2 vRoadUv;
varying vec2 vRoadPaintUv;
varying float vRoadShadow;
varying float vRoadSolid;
varying float vRoadSolidLeft;
varying float vRoadSolidRight;
varying float vRoadMergeLeft;
varying float vRoadMergeRight;
varying vec3 vRoadWorldPosition;

/** 官方环境光树影调制（与地表同一变体）。 */
float plRoadAmbientShadow = 1.0;
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
  // 官方划线：虚线采样用未拉伸 uv，实线/渐变按 per-vertex 权重叠加。
  if (uRoadHasPaint > 0.5) {
    vec4 paintCol = texture2D(uRoadPaintDashed, vRoadPaintUv);
    float wSolid = smoothstep(0.49, 0.51, vRoadSolid);
    float wSolidLeft = smoothstep(0.49, 0.51, vRoadSolidLeft);
    float wSolidRight = smoothstep(0.49, 0.51, vRoadSolidRight);
    float solidAny = ceil(max(wSolidLeft, wSolidRight));
    float wMergeLeft = smoothstep(0.49, 0.51, vRoadMergeLeft) * (1.0 - solidAny);
    float wMergeRight = smoothstep(0.49, 0.51, vRoadMergeRight) * (1.0 - solidAny);
    if (wMergeLeft + wMergeRight > 0.0) {
      paintCol = mix(paintCol, texture2D(uRoadPaintMergeLeft, vRoadPaintUv), wMergeLeft);
      paintCol = mix(paintCol, texture2D(uRoadPaintMergeRight, vRoadPaintUv), wMergeRight);
    }
    if (wSolidRight + wSolidLeft > 0.0) {
      paintCol = mix(paintCol, texture2D(uRoadPaintSolidRight, vRoadPaintUv), wSolidRight);
      paintCol = mix(paintCol, texture2D(uRoadPaintSolidLeft, vRoadPaintUv), wSolidLeft);
      paintCol = mix(paintCol, texture2D(uRoadPaintSolid, vRoadPaintUv), wSolid);
    }
    roadTexel.rgb = mix(roadTexel.rgb, paintCol.rgb, paintCol.a);
  }
  // 官方路面掠射边缘光（ef chunk）：与地表同款 fresnel，无 blendVal / uv 偏置。
  float roadFresnel = 1.0 - max(0.0, dot(normalize(cameraPosition - vRoadWorldPosition), vec3(0.0, 1.0, 0.0)));
  float roadLightFresnel = max(0.0, (roadFresnel - 0.75)) * 4.0;
  roadLightFresnel *= roadLightFresnel;
  roadLightFresnel *= (1.0 - vRoadShadow * uRoadShadowFactor);
  roadLightFresnel *= uRoadFresnelIntensity;
  float roadDarkFresnel = 1.0 - min(1.0, roadFresnel * 1.3333);
  roadDarkFresnel *= uRoadFresnelIntensity;
  roadDarkFresnel = 0.25 + min(0.25, max(0.0, roadDarkFresnel - 0.25) * 0.5);
  roadTexel.rgb *= 1.0 + roadLightFresnel - roadDarkFresnel;
  // 官方路面自发光：路面色 × radiance（与地表共享预设 radiance）。
  totalEmissiveRadiance = roadTexel.rgb * uRoadRadiance;
  plRoadAmbientShadow = 1.75 - clamp(vRoadShadow, 0.75, 1.0);
  diffuseColor.rgb = roadTexel.rgb;
  diffuseColor.a = 1.0;
}
`

export function createRoadBand(options: RoadBandOptions): RoadBandHandle {
  const nodes = options.nodes
  const lift = options.lift ?? DEFAULT_ROAD_LIFT
  const positions: number[] = []
  const uvs: number[] = []
  const normals: number[] = []
  const shadows: number[] = []
  const paintSolid: number[] = []
  const paintSolidLeft: number[] = []
  const paintSolidRight: number[] = []
  const paintMergeLeft: number[] = []
  const paintMergeRight: number[] = []
  const indices: number[] = []
  const markings = options.markings ?? null

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
    const marking = markings ? markings[Math.min(markings.length - 1, i)] ?? null : null
    for (const side of [-1, 1] as const) {
      positions.push(node.x + perpX * halfW * side, node.y + lift, node.z + perpZ * halfW * side)
      uvs.push(side < 0 ? 0 : 1, v)
      normals.push(0, 1, 0)
      shadows.push(shadow)
      paintSolid.push(marking?.solid ? 1 : 0)
      paintSolidLeft.push(marking?.solidLeft ? 1 : 0)
      paintSolidRight.push(marking?.solidRight ? 1 : 0)
      paintMergeLeft.push(marking?.mergeLeft ? 1 : 0)
      paintMergeRight.push(marking?.mergeRight ? 1 : 0)
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
  geometry.setAttribute('aRoadPaintSolid', new THREE.Float32BufferAttribute(paintSolid, 1))
  geometry.setAttribute('aRoadPaintSolidLeft', new THREE.Float32BufferAttribute(paintSolidLeft, 1))
  geometry.setAttribute('aRoadPaintSolidRight', new THREE.Float32BufferAttribute(paintSolidRight, 1))
  geometry.setAttribute('aRoadPaintMergeLeft', new THREE.Float32BufferAttribute(paintMergeLeft, 1))
  geometry.setAttribute('aRoadPaintMergeRight', new THREE.Float32BufferAttribute(paintMergeRight, 1))
  geometry.setIndex(indices)
  if (options.hostInverse) {
    geometry.applyMatrix4(options.hostInverse)
  }
  geometry.computeBoundingSphere()

  // 初值全部指向 base 贴图；真正的路型（划线 6 张 / 单车道 stretch）由下面的
  // applyTextures(textures) 在创建时立即写入，换季走同一条路径。
  const uniforms = {
    uRoadMap: { value: options.textures.base },
    uRoadOverlay: { value: options.textures.base },
    uRoadHasOverlay: { value: 0 },
    uRoadHasPaint: { value: 0 },
    uRoadPaintDashed: { value: options.textures.base },
    uRoadPaintSolid: { value: options.textures.base },
    uRoadPaintSolidLeft: { value: options.textures.base },
    uRoadPaintSolidRight: { value: options.textures.base },
    uRoadPaintMergeLeft: { value: options.textures.base },
    uRoadPaintMergeRight: { value: options.textures.base },
    uRoadTextureStretch: { value: 1 },
    uRoadShadowFactor: { value: SEASON_PARAMS[options.season].shadowFactor },
    uRoadRadiance: { value: 2 },
    uRoadFresnelIntensity: { value: 1 },
  }
  // 官方路面 = Lambert（无镜面），自发光合成与地表一致。
  const material = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    alphaTest: 0.75,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  })
  material.name = 'slowroads-road-band-material'
  material.customProgramCacheKey = () => 'pl-road-band-v2'
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
      .replace(
        '#include <lights_fragment_end>',
        '#include <lights_fragment_end>\n\treflectedLight.indirectDiffuse *= plRoadAmbientShadow;',
      )
      .replace(
        'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
        'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directDiffuse * totalEmissiveRadiance;',
      )
    injectSlowroadsFog(shader, { material })
    recordSlowroadsShaderAudit(material, shader)
  }

  /**
   * 写入一套官方路面贴图（base / overlay / 划线 6 张 / `stretch`）。
   *
   * 创建与换季共用同一条路径：`createRoadBand()` 建出来就是正确路型。
   * 这一点必须成立——runtime 每次重建公路（改路宽、重画路径、重新生成）都会
   * 重新 `createRoadBand()`，若只在换季时套用贴图，重建后 `uRoadHasPaint`
   * 会退回 0、`uRoadTextureStretch` 退回 1，宽路的划线（宽路 + 划线档）与窄路
   * （< 2.25m 单车道档）的贴图拉伸就都丢了。lab 建完 mesh 立刻调
   * `setSeason`（`tools/slowroads-lab/src/main.ts`），所以 lab 表现正确。
   */
  function applyTextures(textures: RoadBandTextures): void {
    const paint = textures.paint ?? null
    uniforms.uRoadMap.value = textures.base
    uniforms.uRoadOverlay.value = textures.overlay ?? textures.base
    uniforms.uRoadHasOverlay.value = textures.overlay ? 1 : 0
    uniforms.uRoadHasPaint.value = paint ? 1 : 0
    uniforms.uRoadPaintDashed.value = paint?.dashed ?? textures.base
    uniforms.uRoadPaintSolid.value = paint?.solid ?? textures.base
    uniforms.uRoadPaintSolidLeft.value = paint?.solidLeft ?? textures.base
    uniforms.uRoadPaintSolidRight.value = paint?.solidRight ?? textures.base
    uniforms.uRoadPaintMergeLeft.value = paint?.mergeLeft ?? textures.base
    uniforms.uRoadPaintMergeRight.value = paint?.mergeRight ?? textures.base
    uniforms.uRoadTextureStretch.value = textures.textureStretch
      ?? (paint || !isSingleTrackRoad(options.halfWidth * 2) ? 1 : 2)
    material.needsUpdate = true
  }

  applyTextures(options.textures)

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'slowroads-road-band'
  mesh.receiveShadow = true
  mesh.castShadow = false
  mesh.frustumCulled = true

  return {
    mesh,
    setSeason(season: SeasonId, textures: RoadBandTextures): void {
      applyTextures(textures)
      uniforms.uRoadShadowFactor.value = SEASON_PARAMS[season].shadowFactor
    },
    setRadiance(radiance: number): void {
      uniforms.uRoadRadiance.value = radiance
    },
    setFresnel(fresnel: number): void {
      uniforms.uRoadFresnelIntensity.value = fresnel
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
