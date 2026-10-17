import * as THREE from 'three'
import type { TreeDensityField } from '../core/placement'
import type { RoadProfile } from '../core/roadProfile'
import type { RoadMarkingWeights } from '../core/roadMarkings'
import { isSingleTrackRoad } from '../core/roadStyle'
import { LANDSCAPE_LIGHT_GLSL } from './landscapeLighting'

/**
 * 公路贴图带（官方 `road` / `roadSingle` 两套路型网格移植）。
 *
 * - 沿 RoadProfile 生成贴合压平地形的带状网格（左右边缘 = ±半宽，高出地形 ~2cm）；
 * - UV 按官方规则：u = 0..1 横跨整个路宽，v = 里程 / (2×半宽)，再除以 `textureStretch`
 *   （官方 `roadSingle.stretch = 2` → 每 2 倍路宽重复一次；宽路 `stretch = 1`）；
 * - 宽路（路宽 ≥ 2.25m，官方 `ms = false`）额外挂 6 张划线贴图：官方片元在
 *   **未拉伸**的 uv 上采样 `dashed`，按 per-vertex 权重把 `solid / solidLeft /
 *   solidRight / mergeLeft / mergeRight` 依次混入（`smoothstep(0.49, 0.51)` 起判，
 *   merge 被实线 `1 - ceil(max(wSolidLeft, wSolidRight))` 抑制），最后以
 *   `paintCol.a` 与原路面混色；
 * - 春/秋的 overlay（苔痕 / 落叶）强度 = saturate(道路两侧树影 × shadowFactor × 3)，
 *   即落叶在树荫下更密，与 slowroads 完全一致；冬/夏无 overlay；
 * - alphaTest 0.75（官方材质参数），粗糙边缘由底图 alpha 裁切。
 */
export interface RoadMeshOptions {
  profile: RoadProfile
  density: TreeDensityField
  sunDir: THREE.Vector3
  sunColor: THREE.Color
  /** 划线权重（每追踪节点一个）；为空或是单车道则不启用划线。 */
  markings?: readonly RoadMarkingWeights[] | null
  /** 追踪节点间距（米），用于把 2m 采样映射到节点权重。 */
  nodeSpacing?: number
  /** 与 2m 路面行对齐的横向列高度（不含 clearance）。 */
  columnHeights?: readonly (readonly number[])[] | null
  /** 道路带相对表面包络的额外抬升。 */
  clearance?: number
}

export interface RoadPaintTextures {
  dashed: THREE.Texture
  solid: THREE.Texture
  solidLeft: THREE.Texture
  solidRight: THREE.Texture
  mergeLeft: THREE.Texture
  mergeRight: THREE.Texture
}

export interface RoadTextureSet {
  base: THREE.Texture
  overlay: THREE.Texture | null
  /** 宽路划线贴图；官方只在宽路材质里绑定（冬季宽路无划线）。 */
  paint?: RoadPaintTextures | null
  /** 官方 `stretch`：单车道 2、宽路 1。 */
  textureStretch?: number
}

export interface RoadMeshHandle {
  mesh: THREE.Mesh
  setSeason(textures: RoadTextureSet, shadowFactor: number): void
  dispose(): void
}

const STEP_ALONG = 2
const ROAD_LIFT = 0.02

const VERTEX_SHADER = `
#include <common>
attribute float aShadow;
attribute float aPaintSolid;
attribute float aPaintSolidLeft;
attribute float aPaintSolidRight;
attribute float aPaintMergeLeft;
attribute float aPaintMergeRight;
uniform float uTextureStretch;
varying vec2 vRoadUv;
varying vec2 vPaintUv;
varying float vShadow;
varying float vSolid;
varying float vSolidLeft;
varying float vSolidRight;
varying float vMergeLeft;
varying float vMergeRight;
varying float vViewDistance;
varying vec3 vWorldPosition;
#include <fog_pars_vertex>
void main() {
  vRoadUv = uv;
  vRoadUv.y /= uTextureStretch;
  vPaintUv = uv;
  vShadow = aShadow;
  vSolid = aPaintSolid;
  vSolidLeft = aPaintSolidLeft;
  vSolidRight = aPaintSolidRight;
  vMergeLeft = aPaintMergeLeft;
  vMergeRight = aPaintMergeRight;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vec4 mvPosition = viewMatrix * worldPosition;
  vViewDistance = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const FRAGMENT_SHADER = `
uniform sampler2D uMap;
uniform sampler2D uOverlay;
uniform float uHasOverlay;
uniform float uHasPaint;
uniform sampler2D uPaintDashed;
uniform sampler2D uPaintSolid;
uniform sampler2D uPaintSolidLeft;
uniform sampler2D uPaintSolidRight;
uniform sampler2D uPaintMergeLeft;
uniform sampler2D uPaintMergeRight;
${LANDSCAPE_LIGHT_GLSL}
varying vec2 vRoadUv;
varying vec2 vPaintUv;
varying float vShadow;
varying float vSolid;
varying float vSolidLeft;
varying float vSolidRight;
varying float vMergeLeft;
varying float vMergeRight;
varying float vViewDistance;
varying vec3 vWorldPosition;
#include <fog_pars_fragment>
void main() {
  vec4 texelColor = texture2D(uMap, vRoadUv);
  if (texelColor.a < 0.75) {
    discard;
  }
  if (uHasOverlay > 0.5) {
    vec4 overlayCol = texture2D(uOverlay, vRoadUv);
    float overlayFactor = clamp(vShadow * uShadowFactor * 3.0, 0.0, 1.0);
    texelColor.rgb = mix(texelColor.rgb, overlayCol.rgb, overlayFactor * overlayCol.a);
  }
  // 官方划线：虚线上采样用未拉伸 uv，实线/渐变按 per-vertex 权重叠加。
  if (uHasPaint > 0.5) {
    vec4 paintCol = texture2D(uPaintDashed, vPaintUv);
    float wSolid = smoothstep(0.49, 0.51, vSolid);
    float wSolidLeft = smoothstep(0.49, 0.51, vSolidLeft);
    float wSolidRight = smoothstep(0.49, 0.51, vSolidRight);
    float solidAny = ceil(max(wSolidLeft, wSolidRight));
    float wMergeLeft = smoothstep(0.49, 0.51, vMergeLeft) * (1.0 - solidAny);
    float wMergeRight = smoothstep(0.49, 0.51, vMergeRight) * (1.0 - solidAny);
    if (wMergeLeft + wMergeRight > 0.0) {
      paintCol = mix(paintCol, texture2D(uPaintMergeLeft, vPaintUv), wMergeLeft);
      paintCol = mix(paintCol, texture2D(uPaintMergeRight, vPaintUv), wMergeRight);
    }
    if (wSolidRight + wSolidLeft > 0.0) {
      paintCol = mix(paintCol, texture2D(uPaintSolidRight, vPaintUv), wSolidRight);
      paintCol = mix(paintCol, texture2D(uPaintSolidLeft, vPaintUv), wSolidLeft);
      paintCol = mix(paintCol, texture2D(uPaintSolid, vPaintUv), wSolid);
    }
    texelColor.rgb = mix(texelColor.rgb, paintCol.rgb, paintCol.a);
  }
  // 官方道路 = Lambert + 自发光（texelColor × radiance，与地表共享），
  // 环境项按官方 vShadow 变体调制。
  float ndl = clamp(dot(vec3(0.0, 1.0, 0.0), uSunDir), -1.0, 1.0) * 0.5 + 0.5;
  // 官方路面掠射边缘光（ef chunk）：与地表同款 fresnel，但无 blendVal / uv 偏置。
  float fresnel = 1.0 - max(0.0, dot(normalize(cameraPosition - vWorldPosition), vec3(0.0, 1.0, 0.0)));
  float lightFresnel = max(0.0, (fresnel - 0.75)) * 4.0;
  lightFresnel *= lightFresnel;
  lightFresnel *= (1.0 - vShadow * uShadowFactor);
  lightFresnel *= uFresnelIntensity;
  float darkFresnel = 1.0 - min(1.0, fresnel * 1.3333);
  darkFresnel *= uFresnelIntensity;
  darkFresnel = 0.25 + min(0.25, max(0.0, darkFresnel - 0.25) * 0.5);
  vec3 albedo = texelColor.rgb * (1.0 + lightFresnel - darkFresnel);
  vec3 color = srLandscapeLight(albedo, ndl, srAmbientShadowMul(vShadow * uShadowFactor), texelColor.rgb * uRadiance);
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

export function createRoadMesh(options: RoadMeshOptions): RoadMeshHandle {
  const { profile } = options
  const step = STEP_ALONG
  const sampleCount = Math.max(2, Math.floor(profile.length / step) + 1)
  const columnCount = Math.max(2, options.columnHeights?.[0]?.length ?? 2)
  const vertexCount = sampleCount * columnCount
  const positions = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const normals = new Float32Array(vertexCount * 3)
  const roadHeights = new Float32Array(vertexCount)
  const shadows = new Float32Array(vertexCount)
  const paintSolid = new Float32Array(vertexCount)
  const paintSolidLeft = new Float32Array(vertexCount)
  const paintSolidRight = new Float32Array(vertexCount)
  const paintMergeLeft = new Float32Array(vertexCount)
  const paintMergeRight = new Float32Array(vertexCount)
  const indices = new Uint32Array((sampleCount - 1) * (columnCount - 1) * 6)

  const shadowLateral = profile.halfWidth + profile.shoulderWidth
  const columnSpacing = (profile.halfWidth * 2) / (columnCount - 1)
  const clearance = options.clearance ?? (options.columnHeights ? 0.05 : ROAD_LIFT)
  // Official mapping: v advances 1/(2*halfWidth) per metre, then the shader
  // divides by `textureStretch` (2 for the single-track set) => one texture
  // repeat every 2x road width (4x half width).
  const repeatLength = Math.max(1e-3, profile.halfWidth * 2)
  const markings = options.markings ?? null
  const nodeSpacing = Math.max(1e-3, options.nodeSpacing ?? 0)
  const markingAt = (distance: number): RoadMarkingWeights | null => {
    if (!markings || !markings.length || nodeSpacing <= 0) {
      return null
    }
    const index = Math.min(markings.length - 1, Math.max(0, Math.round(distance / nodeSpacing)))
    return markings[index] ?? null
  }

  const columnHeightAt = (row: number, column: number): number => {
    const nodeColumns = options.columnHeights?.[row]
    if (!nodeColumns || nodeColumns.length < 2) {
      return profile.sampleAt(Math.min(profile.length, row * step)).y
    }
    const scaled = (column / (columnCount - 1)) * (nodeColumns.length - 1)
    const low = Math.floor(scaled)
    const high = Math.min(nodeColumns.length - 1, low + 1)
    const fraction = scaled - low
    return nodeColumns[low]! + (nodeColumns[high]! - nodeColumns[low]!) * fraction
  }

  for (let i = 0; i < sampleCount; i += 1) {
    const distance = Math.min(profile.length, i * step)
    const sample = profile.sampleAt(distance)
    const perpX = -Math.sin(sample.heading)
    const perpZ = Math.cos(sample.heading)
    const v = distance / repeatLength
    const marking = markingAt(distance)
    for (let column = 0; column < columnCount; column += 1) {
      const u = column / (columnCount - 1)
      const lateral = -profile.halfWidth + u * profile.halfWidth * 2
      const vertexIndex = i * columnCount + column
      const height = columnHeightAt(i, column)
      roadHeights[vertexIndex] = height
      positions[vertexIndex * 3] = sample.x + perpX * lateral
      positions[vertexIndex * 3 + 1] = height + clearance
      positions[vertexIndex * 3 + 2] = sample.z + perpZ * lateral
      uvs[vertexIndex * 2] = u
      uvs[vertexIndex * 2 + 1] = v
      const probeSide = column < columnCount / 2 ? -1 : 1
      const probeX = sample.x + perpX * probeSide * shadowLateral
      const probeZ = sample.z + perpZ * probeSide * shadowLateral
      shadows[vertexIndex] = Math.min(1, options.density.sampleUnit(probeX, probeZ) * 1.3)
      paintSolid[vertexIndex] = marking?.solid ? 1 : 0
      paintSolidLeft[vertexIndex] = marking?.solidLeft ? 1 : 0
      paintSolidRight[vertexIndex] = marking?.solidRight ? 1 : 0
      paintMergeLeft[vertexIndex] = marking?.mergeLeft ? 1 : 0
      paintMergeRight[vertexIndex] = marking?.mergeRight ? 1 : 0
    }
  }

  for (let i = 0; i < sampleCount; i += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      const vertexIndex = i * columnCount + column
      const left = roadHeights[i * columnCount + Math.max(0, column - 1)]!
      const right = roadHeights[i * columnCount + Math.min(columnCount - 1, column + 1)]!
      const up = roadHeights[Math.max(0, i - 1) * columnCount + column]!
      const down = roadHeights[Math.min(sampleCount - 1, i + 1) * columnCount + column]!
      const dx = (right - left) / Math.max(1e-4, columnSpacing * 2)
      const dz = (down - up) / Math.max(1e-4, step * 2)
      const inverseLength = 1 / Math.hypot(dx, 1, dz)
      normals[vertexIndex * 3] = -dx * inverseLength
      normals[vertexIndex * 3 + 1] = inverseLength
      normals[vertexIndex * 3 + 2] = -dz * inverseLength
    }
  }

  for (let i = 0; i < sampleCount - 1; i += 1) {
    for (let column = 0; column < columnCount - 1; column += 1) {
      const a = i * columnCount + column
      const b = a + 1
      const c = a + columnCount
      const d = c + 1
      const cursor = (i * (columnCount - 1) + column) * 6
      indices[cursor] = a
      indices[cursor + 1] = c
      indices[cursor + 2] = d
      indices[cursor + 3] = a
      indices[cursor + 4] = d
      indices[cursor + 5] = b
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setAttribute('aShadow', new THREE.BufferAttribute(shadows, 1))
  geometry.setAttribute('aPaintSolid', new THREE.BufferAttribute(paintSolid, 1))
  geometry.setAttribute('aPaintSolidLeft', new THREE.BufferAttribute(paintSolidLeft, 1))
  geometry.setAttribute('aPaintSolidRight', new THREE.BufferAttribute(paintSolidRight, 1))
  geometry.setAttribute('aPaintMergeLeft', new THREE.BufferAttribute(paintMergeLeft, 1))
  geometry.setAttribute('aPaintMergeRight', new THREE.BufferAttribute(paintMergeRight, 1))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uMap: { value: null },
      uOverlay: { value: null },
      uHasOverlay: { value: 0 },
      uHasPaint: { value: 0 },
      uPaintDashed: { value: null },
      uPaintSolid: { value: null },
      uPaintSolidLeft: { value: null },
      uPaintSolidRight: { value: null },
      uPaintMergeLeft: { value: null },
      uPaintMergeRight: { value: null },
      uShadowFactor: { value: 1 },
      uTextureStretch: { value: 2 },
      // 官方光照：环境控制器按预设统一下发。
      uSunDir: { value: options.sunDir.clone() },
      uSunColor: { value: options.sunColor.clone() },
      uAmbientColor: { value: new THREE.Color(0.22, 0.3, 0.12) },
      uHemiColor: { value: new THREE.Color(1.39, 1.36, 1.18) },
      uRadiance: { value: 2 },
      uFresnelIntensity: { value: 1 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    fog: true,
    side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'slowroads-road-ribbon'
  material.name = 'slowroads-road-material'
  mesh.receiveShadow = false
  mesh.castShadow = false
  mesh.frustumCulled = false

  return {
    mesh,
    setSeason(textures: RoadTextureSet, shadowFactor: number): void {
      material.uniforms.uMap!.value = textures.base
      material.uniforms.uOverlay!.value = textures.overlay ?? textures.base
      material.uniforms.uHasOverlay!.value = textures.overlay ? 1 : 0
      const paint = textures.paint ?? null
      material.uniforms.uHasPaint!.value = paint ? 1 : 0
      material.uniforms.uPaintDashed!.value = paint?.dashed ?? null
      material.uniforms.uPaintSolid!.value = paint?.solid ?? null
      material.uniforms.uPaintSolidLeft!.value = paint?.solidLeft ?? null
      material.uniforms.uPaintSolidRight!.value = paint?.solidRight ?? null
      material.uniforms.uPaintMergeLeft!.value = paint?.mergeLeft ?? null
      material.uniforms.uPaintMergeRight!.value = paint?.mergeRight ?? null
      material.uniforms.uTextureStretch!.value = textures.textureStretch
        ?? (paint || !isSingleTrackRoad(profile.halfWidth * 2) ? 1 : 2)
      material.uniforms.uShadowFactor!.value = shadowFactor
    },
    dispose(): void {
      mesh.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  }
}
