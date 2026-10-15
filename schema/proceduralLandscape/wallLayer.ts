import * as THREE from 'three'
import { BARRIER_TUNING, DRYSTONE, SEAWALL } from './roadStyle'
import { WALL_FINE_STEP, type WallSegment } from './walls'
import { recordSlowroadsShaderAudit } from './shaderAudit'

/**
 * 官方墙体网格层（drystone / barrier / seaWall）的 three 渲染封装，几何与 UV 规则见
 * `tools/slowroads-lab/src/lab/wallMesh.ts`（同一套官方常量）：
 *
 *  - **干砌石墙**：4 顶点梯形截面（内脚 / 内顶 / 外顶 / 外脚），高 1.1m、顶宽 0.32m、
 *    底宽 0.38m、整体下沉 0.2m；UV：u 沿路每 5m 一个循环，v 走“对折条带”
 *    `[1, 1-UV_HEIGHT, UV_HEIGHT, 0]`；只画内面 / 顶面 / 外面。
 *  - **硬护栏**：竖直面板，行高 `0.78 × [0, .55, .68, .88, 1]`，内外偏移 0.1m，UV u 每 1.67m 循环。
 *  - **混凝土海墙**：截面 `(x-0.15, road) / (x, road+1) / (x+0.25, road+1) / (x+0.25+0.15, road)`，
 *    下沉 0.2m，贴地取**路面高度**。
 *
 * 材质沿用编辑器侧口径：MeshLambertMaterial + 官方自发光/树影注入（同 roadBand.ts），
 * 因此跟随编辑器的真实光照、CSM 阴影与三色雾。
 */

export interface WallLayerTextures {
  drystone: THREE.Texture | null
  barrier: THREE.Texture | null
  seaWall: THREE.Texture | null
}

export interface WallLayerOptions {
  segments: readonly WallSegment[]
  textures: WallLayerTextures
  /** 官方 effects.shadowFactor（环境预设）。 */
  shadowFactor: number
  radiance: number
  /** 挂到编辑器 host 下的逆矩阵（世界 → host 局部）。 */
  hostInverse: THREE.Matrix4 | null
}

export interface WallLayerHandle {
  group: THREE.Group
  setTextures(textures: WallLayerTextures, shadowFactor: number, radiance: number): void
  setVisibility(visible: { drystone: boolean; barrier: boolean; seaWall: boolean }): void
  dispose(): void
}

interface Vertex {
  x: number
  y: number
  z: number
  u: number
  v: number
  shadow: number
}

class GeometryBuilder {
  readonly positions: number[] = []
  readonly normals: number[] = []
  readonly uvs: number[] = []
  readonly shadows: number[] = []

  pushQuad(a: Vertex, b: Vertex, c: Vertex, d: Vertex): void {
    const ux = b.x - a.x
    const uy = b.y - a.y
    const uz = b.z - a.z
    const vx = d.x - a.x
    const vy = d.y - a.y
    const vz = d.z - a.z
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const length = Math.hypot(nx, ny, nz) || 1
    nx /= length
    ny /= length
    nz /= length
    const corner = (vertex: Vertex): void => {
      this.positions.push(vertex.x, vertex.y, vertex.z)
      this.normals.push(nx, ny, nz)
      this.uvs.push(vertex.u, vertex.v)
      this.shadows.push(vertex.shadow)
    }
    corner(a)
    corner(b)
    corner(c)
    corner(a)
    corner(c)
    corner(d)
  }

  build(hostInverse: THREE.Matrix4 | null): THREE.BufferGeometry | null {
    if (!this.positions.length) {
      return null
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2))
    geometry.setAttribute('aWallShadow', new THREE.Float32BufferAttribute(this.shadows, 1))
    if (hostInverse) {
      geometry.applyMatrix4(hostInverse)
    }
    geometry.computeBoundingSphere()
    return geometry
  }
}

const VERTEX_PARS = /* glsl */ `
attribute float aWallShadow;
varying vec2 vWallUv;
varying float vWallShadow;
`

const VERTEX_BODY = /* glsl */ `
#include <uv_vertex>
vWallUv = uv;
vWallShadow = aWallShadow;
`

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uWallMap;
uniform float uWallAlphaTest;
uniform float uWallShadowFactor;
uniform float uWallRadiance;
varying vec2 vWallUv;
varying float vWallShadow;
float plWallAmbientShadow = 1.0;
`

const FRAGMENT_BODY = /* glsl */ `
{
  vec4 wallTexel = texture2D(uWallMap, vWallUv);
  if (wallTexel.a < uWallAlphaTest) {
    discard;
  }
  // 官方墙体同为 Lambert + 自发光（texelColor × radiance），太阳竖直向下 ⇒ 立面只吃环境光。
  totalEmissiveRadiance = wallTexel.rgb * uWallRadiance;
  plWallAmbientShadow = 1.75 - clamp(vWallShadow * uWallShadowFactor, 0.75, 1.0);
  diffuseColor.rgb = wallTexel.rgb;
  diffuseColor.a = 1.0;
}
`

function createWallMaterial(
  map: THREE.Texture | null,
  alphaTest: number,
  shadowFactor: number,
  radiance: number,
  auditKey: string,
): { material: THREE.MeshLambertMaterial; uniforms: Record<string, THREE.IUniform> } {
  const uniforms: Record<string, THREE.IUniform> = {
    uWallMap: { value: map },
    uWallAlphaTest: { value: alphaTest },
    uWallShadowFactor: { value: shadowFactor },
    uWallRadiance: { value: radiance },
  }
  const material = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    alphaTest,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  })
  material.name = auditKey
  material.customProgramCacheKey = () => `${auditKey}:v1`
  material.onBeforeCompile = (shader) => {
    for (const [name, uniform] of Object.entries(uniforms)) {
      shader.uniforms[name] = uniform
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_BODY}`)
      .replace(
        '#include <lights_fragment_begin>',
        '#include <lights_fragment_begin>\n  irradiance *= plWallAmbientShadow;',
      )
    recordSlowroadsShaderAudit(material, shader)
  }
  return { material, uniforms }
}

function drystoneGeometry(
  segments: readonly WallSegment[],
  shadowScale: (shadow: number) => number,
): GeometryBuilder {
  const builder = new GeometryBuilder()
  const height = DRYSTONE.height
  const sink = DRYSTONE.sink
  const top = DRYSTONE.width
  const foot = DRYSTONE.widthBottom / 2
  for (const segment of segments) {
    for (let i = 0; i < segment.points.length - 1; i += 1) {
      const current = segment.points[i]!
      const next = segment.points[i + 1]!
      const column = (point: typeof current): [Vertex, Vertex, Vertex, Vertex] => {
        const shadow = shadowScale(point.shadow)
        const baseY = point.groundY - sink
        const topY = point.groundY - sink + height + point.jitterHeight
        return [
          { x: point.x - point.nx * foot, y: baseY, z: point.z - point.nz * foot, u: point.u, v: 1, shadow },
          { x: point.x, y: topY, z: point.z, u: point.u, v: 1 - DRYSTONE.uvHeight, shadow },
          { x: point.x + point.nx * top, y: topY, z: point.z + point.nz * top, u: point.u, v: DRYSTONE.uvHeight, shadow },
          {
            x: point.x + point.nx * (top + foot),
            y: baseY,
            z: point.z + point.nz * (top + foot),
            u: point.u,
            v: 0,
            shadow,
          },
        ]
      }
      const a = column(current)
      const b = column(next)
      builder.pushQuad(a[0], a[1], b[1], b[0])
      builder.pushQuad(a[1], a[2], b[2], b[1])
      builder.pushQuad(a[2], a[3], b[3], b[2])
    }
  }
  return builder
}

function barrierGeometry(segments: readonly WallSegment[]): GeometryBuilder {
  const builder = new GeometryBuilder()
  const total = BARRIER_TUNING.height
  const thickness = BARRIER_TUNING.thickness
  const rails = BARRIER_TUNING.railHeights
  for (const segment of segments) {
    for (let i = 0; i < segment.points.length - 1; i += 1) {
      const current = segment.points[i]!
      const next = segment.points[i + 1]!
      const column = (point: typeof current): { inner: Vertex[]; outer: Vertex[] } => {
        const shadow = point.shadow * BARRIER_TUNING.shadowScale
        const rows = [0, rails[0], rails[1], rails[2], 1]
        const inner: Vertex[] = []
        const outer: Vertex[] = []
        for (let row = 0; row < rows.length; row += 1) {
          const rowHeight = total * rows[row]!
          const useOuter = row === 0 || row === rows.length - 1
          const offset = useOuter ? thickness : 0
          inner.push({
            x: point.x + point.nx * offset,
            y: point.roadY + rowHeight,
            z: point.z + point.nz * offset,
            u: point.u,
            v: rows[row]!,
            shadow,
          })
          outer.push({
            x: point.x + point.nx * (offset + 0.05),
            y: point.roadY + rowHeight,
            z: point.z + point.nz * (offset + 0.05),
            u: point.u,
            v: rows[row]!,
            shadow,
          })
        }
        return { inner, outer }
      }
      const a = column(current)
      const b = column(next)
      for (let row = 0; row < a.inner.length - 1; row += 1) {
        builder.pushQuad(a.inner[row]!, a.inner[row + 1]!, b.inner[row + 1]!, b.inner[row]!)
        builder.pushQuad(a.outer[row]!, a.outer[row + 1]!, b.outer[row + 1]!, b.outer[row]!)
      }
    }
  }
  return builder
}

function seaWallGeometry(segments: readonly WallSegment[]): GeometryBuilder {
  const builder = new GeometryBuilder()
  const height = SEAWALL.height
  const sink = SEAWALL.sink
  const top = SEAWALL.width
  const foot = SEAWALL.footWidth
  for (const segment of segments) {
    for (let i = 0; i < segment.points.length - 1; i += 1) {
      const current = segment.points[i]!
      const next = segment.points[i + 1]!
      const column = (point: typeof current): [Vertex, Vertex, Vertex, Vertex] => {
        const baseY = point.roadY - sink
        const topY = point.roadY - sink + height
        return [
          { x: point.x - point.nx * foot, y: baseY, z: point.z - point.nz * foot, u: point.u, v: 0, shadow: point.shadow },
          { x: point.x, y: topY, z: point.z, u: point.u, v: 1, shadow: point.shadow },
          { x: point.x + point.nx * top, y: topY, z: point.z + point.nz * top, u: point.u, v: 1, shadow: point.shadow },
          {
            x: point.x + point.nx * (top + foot),
            y: baseY,
            z: point.z + point.nz * (top + foot),
            u: point.u,
            v: 0,
            shadow: point.shadow,
          },
        ]
      }
      const a = column(current)
      const b = column(next)
      builder.pushQuad(a[0], a[1], b[1], b[0])
      builder.pushQuad(a[1], a[2], b[2], b[1])
      builder.pushQuad(a[2], a[3], b[3], b[2])
    }
  }
  return builder
}

export function createWallLayers(options: WallLayerOptions): WallLayerHandle {
  const group = new THREE.Group()
  group.name = 'slowroads-walls'
  const drystone = createWallMaterial(
    options.textures.drystone,
    0,
    options.shadowFactor,
    options.radiance,
    'slowroads-wall-drystone',
  )
  const barrier = createWallMaterial(
    options.textures.barrier,
    0.5,
    options.shadowFactor,
    options.radiance,
    'slowroads-wall-barrier',
  )
  const seaWall = createWallMaterial(
    options.textures.seaWall,
    0,
    options.shadowFactor,
    options.radiance,
    'slowroads-wall-seawall',
  )

  const byType: { drystone: THREE.Mesh | null; barrier: THREE.Mesh | null; seaWall: THREE.Mesh | null } = {
    drystone: null,
    barrier: null,
    seaWall: null,
  }
  const attach = (
    geometry: THREE.BufferGeometry | null,
    material: THREE.Material,
    name: string,
    slot: keyof typeof byType,
  ): void => {
    if (!geometry) {
      return
    }
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.castShadow = false
    mesh.receiveShadow = false
    group.add(mesh)
    byType[slot] = mesh
  }
  attach(
    drystoneGeometry(
      options.segments.filter((segment) => segment.type === 'drystone'),
      (shadow) => Math.sqrt(Math.max(0, shadow)) * DRYSTONE.shadowScale,
    ).build(options.hostInverse),
    drystone.material,
    'slowroads-wall-drystone-mesh',
    'drystone',
  )
  attach(
    barrierGeometry(options.segments.filter((segment) => segment.type === 'barrier')).build(options.hostInverse),
    barrier.material,
    'slowroads-wall-barrier-mesh',
    'barrier',
  )
  attach(
    seaWallGeometry(options.segments.filter((segment) => segment.type === 'seaWall')).build(options.hostInverse),
    seaWall.material,
    'slowroads-wall-seawall-mesh',
    'seaWall',
  )

  return {
    group,
    setTextures(textures: WallLayerTextures, shadowFactor: number, radiance: number): void {
      drystone.uniforms.uWallMap!.value = textures.drystone
      barrier.uniforms.uWallMap!.value = textures.barrier
      seaWall.uniforms.uWallMap!.value = textures.seaWall
      drystone.uniforms.uWallShadowFactor!.value = shadowFactor
      barrier.uniforms.uWallShadowFactor!.value = shadowFactor
      seaWall.uniforms.uWallShadowFactor!.value = shadowFactor
      drystone.uniforms.uWallRadiance!.value = radiance
      barrier.uniforms.uWallRadiance!.value = radiance
      seaWall.uniforms.uWallRadiance!.value = radiance
    },
    setVisibility(visible): void {
      if (byType.drystone) byType.drystone.visible = visible.drystone
      if (byType.barrier) byType.barrier.visible = visible.barrier
      if (byType.seaWall) byType.seaWall.visible = visible.seaWall
      group.visible = visible.drystone || visible.barrier || visible.seaWall
    },
    dispose(): void {
      group.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (mesh.isMesh) {
          mesh.geometry.dispose()
        }
      })
      drystone.material.dispose()
      barrier.material.dispose()
      seaWall.material.dispose()
      group.removeFromParent()
    },
  }
}

/** 木栏（官方 Fence）精灵实例：位置来自 Barrier/Fence 生成器，贴图区域沿用实测横栏。 */
export function wallFenceSpriteSamples(
  segments: readonly WallSegment[],
): Array<{ x: number; z: number; y: number; rotation: number; variant: number }> {
  const out: Array<{ x: number; z: number; y: number; rotation: number; variant: number }> = []
  for (const segment of segments) {
    if (segment.type !== 'fence') {
      continue
    }
    const span = Math.max(1e-3, segment.endAlong - segment.startAlong)
    const count = Math.max(1, Math.round(span / WALL_FINE_STEP))
    for (let i = 0; i < count; i += 1) {
      const pointIndex = Math.min(
        segment.points.length - 1,
        Math.round((i * (segment.points.length - 1)) / Math.max(1, count - 1)),
      )
      const point = segment.points[pointIndex]!
      out.push({
        x: point.x,
        z: point.z,
        y: point.roadY - 0.02,
        rotation: point.rotation,
        variant: i % 2,
      })
    }
  }
  return out
}
