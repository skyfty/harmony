import * as THREE from 'three'
import { BARRIER_TUNING, DRYSTONE, SEAWALL } from '../core/roadStyle'
import { WALL_FINE_STEP, type WallSegment } from '../core/walls'
import { LANDSCAPE_LIGHT_GLSL } from './landscapeLighting'

/**
 * 官方墙体网格（drystone / barrier / seaWall）移植，three 渲染层。
 *
 * 官方几何（`chunks__SettingsManager.a31845d6.js`，摘录见 `reference/official/walls.js`）：
 *  - **干砌石墙**（类 `_r`）：每个细节点一段 4 顶点梯形截面——
 *    内脚 `(x - n*b2, ground)`、内顶 `(x, ground+H)`、外顶 `(x+W, ground+H)`、
 *    外脚 `(x+W + n*b2, ground)`，其中 `W = DRYSTONE_WIDTH(0.32)`、`b2 = WIDTH_BOTTOM/2 = 0.19`、
 *    `H = HEIGHT(1.1) + 抖动`；整段下沉 `SINK(0.2)`；只画内面 / 顶面 / 外面（官方索引模板
 *    每节点 6 个三角形，无端封口）；UV：u = 里程 × 0.2（官方每粗节点推进 2 个单位，
 *    即每 5m 重复一次贴图），v 模板 `[1, 1-UV_HEIGHT, UV_HEIGHT, 0]`（贴图是“对折条带”：
 *    下半 = 一侧墙面、中间 = 顶面、上半 = 另一侧墙面）；
 *    顶点阴影 = `sqrt(nodeShadow) × 1.5`。
 *  - **硬护栏**（类 `Cr`）：竖直薄带，行高 `q1 × [0, 0.55, 0.68, 0.88, 1]`（`q1 = 0.78`），
 *    内外偏移 `0.1`；UV：u = 里程 × 0.6（官方每粗节点 6 个单位），v 按行高铺满。
 *  - **混凝土海墙**（类 `F7`）：截面 `(x - n*0.15, road)`、`(x, road+1)`、`(x+0.25, road+1)`、
 *    `(x+0.25 + n*0.15, road)`，整段下沉 `0.2`，贴地高度取**路面高度**（官方如此）；
 *    UV：u = 里程 × 0.25，v 沿面铺满（贴图底部深色带对应墙脚）。
 */

export interface WallTextureSet {
  drystone: THREE.Texture | null
  barrier: THREE.Texture | null
  seaWall: THREE.Texture | null
}

export interface WallMeshHandle {
  group: THREE.Group
  setTextures(textures: WallTextureSet, shadowFactor: number): void
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

  /** 四边形 a→b→c→d（顺序同官方截面），法线由面片自身求出（官方 flatShading）。 */
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

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2))
    geometry.setAttribute('aShadow', new THREE.Float32BufferAttribute(this.shadows, 1))
    geometry.computeBoundingSphere()
    return geometry
  }
}

const VERTEX_SHADER = `
#include <common>
attribute float aShadow;
varying vec2 vWallUv;
varying vec3 vWallNormal;
varying float vShadow;
varying vec3 vWorldPosition;
#include <fog_pars_vertex>
void main() {
  vWallUv = uv;
  vWallNormal = normalize(normalMatrix * normal);
  vShadow = aShadow;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const FRAGMENT_SHADER = `
uniform sampler2D uMap;
uniform float uAlphaTest;
${LANDSCAPE_LIGHT_GLSL}
varying vec2 vWallUv;
varying vec3 vWallNormal;
varying float vShadow;
varying vec3 vWorldPosition;
#include <fog_pars_fragment>
void main() {
  vec4 texelColor = texture2D(uMap, vWallUv);
  if (texelColor.a < uAlphaTest) {
    discard;
  }
  // 官方墙体同为 Lambert + 自发光（texelColor × radiance），太阳竖直向下 ⇒ 立面只吃环境光。
  float ndl = clamp(dot(normalize(vWallNormal), uSunDir), -1.0, 1.0) * 0.5 + 0.5;
  vec3 albedo = texelColor.rgb;
  vec3 color = srLandscapeLight(
    albedo,
    ndl,
    srAmbientShadowMul(vShadow * uShadowFactor),
    texelColor.rgb * uRadiance
  );
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

function createWallMaterial(alphaTest: number): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uMap: { value: null },
      uAlphaTest: { value: alphaTest },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0.84, 0.82, 0.73) },
      uAmbientColor: { value: new THREE.Color(0.22, 0.3, 0.12) },
      uHemiColor: { value: new THREE.Color(1.39, 1.36, 1.18) },
      uRadiance: { value: 2 },
      uShadowFactor: { value: 1 },
      uFresnelIntensity: { value: 1 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    fog: true,
    side: THREE.DoubleSide,
  })
  return material
}

function drystoneGeometry(segments: readonly WallSegment[]): THREE.BufferGeometry | null {
  const builder = new GeometryBuilder()
  const height = DRYSTONE.height
  const sink = DRYSTONE.sink
  const top = DRYSTONE.width
  const foot = DRYSTONE.widthBottom / 2
  const vFootIn = 1
  const vTopIn = 1 - DRYSTONE.uvHeight
  const vTopOut = DRYSTONE.uvHeight
  const vFootOut = 0
  for (const segment of segments) {
    const shadowScale = (shadow: number): number => Math.sqrt(Math.max(0, shadow)) * DRYSTONE.shadowScale
    for (let i = 0; i < segment.points.length - 1; i += 1) {
      const current = segment.points[i]!
      const next = segment.points[i + 1]!
      const column = (point: typeof current): [Vertex, Vertex, Vertex, Vertex] => {
        const shadow = shadowScale(point.shadow)
        const baseY = point.groundY - sink
        const topY = point.groundY - sink + height + point.jitterHeight
        return [
          {
            x: point.x - point.nx * foot,
            y: baseY,
            z: point.z - point.nz * foot,
            u: point.u,
            v: vFootIn,
            shadow,
          },
          { x: point.x, y: topY, z: point.z, u: point.u, v: vTopIn, shadow },
          {
            x: point.x + point.nx * top,
            y: topY,
            z: point.z + point.nz * top,
            u: point.u,
            v: vTopOut,
            shadow,
          },
          {
            x: point.x + point.nx * (top + foot),
            y: baseY,
            z: point.z + point.nz * (top + foot),
            u: point.u,
            v: vFootOut,
            shadow,
          },
        ]
      }
      const a = column(current)
      const b = column(next)
      // 内面（0→1）、顶面（1→2）、外面（2→3），与官方索引模板一致。
      builder.pushQuad(a[0], a[1], b[1], b[0])
      builder.pushQuad(a[1], a[2], b[2], b[1])
      builder.pushQuad(a[2], a[3], b[3], b[2])
    }
  }
  return builder.positions.length ? builder.build() : null
}

function barrierGeometry(segments: readonly WallSegment[]): THREE.BufferGeometry | null {
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
          const height = total * rows[row]!
          const v = rows[row]!
          // 官方剖面：底/顶贴外侧 `x1`，中段贴内侧 `x`。
          const useOuter = row === 0 || row === rows.length - 1
          const offset = useOuter ? thickness : 0
          inner.push({
            x: point.x + point.nx * offset,
            y: point.roadY + height,
            z: point.z + point.nz * offset,
            u: point.u,
            v,
            shadow,
          })
          outer.push({
            x: point.x + point.nx * (offset + 0.05),
            y: point.roadY + height,
            z: point.z + point.nz * (offset + 0.05),
            u: point.u,
            v,
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
  return builder.positions.length ? builder.build() : null
}

function seaWallGeometry(segments: readonly WallSegment[]): THREE.BufferGeometry | null {
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
        const shadow = point.shadow
        const baseY = point.roadY - sink
        const topY = point.roadY - sink + height
        return [
          {
            x: point.x - point.nx * foot,
            y: baseY,
            z: point.z - point.nz * foot,
            u: point.u,
            v: 0,
            shadow,
          },
          { x: point.x, y: topY, z: point.z, u: point.u, v: 1, shadow },
          {
            x: point.x + point.nx * top,
            y: topY,
            z: point.z + point.nz * top,
            u: point.u,
            v: 1,
            shadow,
          },
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
  return builder.positions.length ? builder.build() : null
}

export interface WallMeshOptions {
  segments: readonly WallSegment[]
  textures: WallTextureSet
  shadowFactor: number
}

export function createWallMeshes(options: WallMeshOptions): WallMeshHandle {
  const group = new THREE.Group()
  group.name = 'slowroads-walls'
  const drystone = drystoneGeometry(options.segments.filter((segment) => segment.type === 'drystone'))
  const barrier = barrierGeometry(options.segments.filter((segment) => segment.type === 'barrier'))
  const seaWall = seaWallGeometry(options.segments.filter((segment) => segment.type === 'seaWall'))

  const drystoneMaterial = createWallMaterial(0)
  const barrierMaterial = createWallMaterial(0.5)
  const seaWallMaterial = createWallMaterial(0)
  drystoneMaterial.name = 'slowroads-wall-drystone'
  barrierMaterial.name = 'slowroads-wall-barrier'
  seaWallMaterial.name = 'slowroads-wall-seawall'

  const meshes: THREE.Mesh[] = []
  const byType: { drystone: THREE.Mesh | null; barrier: THREE.Mesh | null; seaWall: THREE.Mesh | null } = {
    drystone: null,
    barrier: null,
    seaWall: null,
  }
  const attach = (
    geometry: THREE.BufferGeometry | null,
    material: THREE.ShaderMaterial,
    name: string,
    slot: keyof typeof byType,
  ): void => {
    if (!geometry) {
      return
    }
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.frustumCulled = false
    group.add(mesh)
    meshes.push(mesh)
    byType[slot] = mesh
  }
  attach(drystone, drystoneMaterial, 'slowroads-wall-drystone-mesh', 'drystone')
  attach(barrier, barrierMaterial, 'slowroads-wall-barrier-mesh', 'barrier')
  attach(seaWall, seaWallMaterial, 'slowroads-wall-seawall-mesh', 'seaWall')

  const applyTextures = (textures: WallTextureSet, shadowFactor: number): void => {
    drystoneMaterial.uniforms.uMap!.value = textures.drystone
    barrierMaterial.uniforms.uMap!.value = textures.barrier
    seaWallMaterial.uniforms.uMap!.value = textures.seaWall
    drystoneMaterial.uniforms.uShadowFactor!.value = shadowFactor
    barrierMaterial.uniforms.uShadowFactor!.value = shadowFactor
    seaWallMaterial.uniforms.uShadowFactor!.value = shadowFactor
  }
  applyTextures(options.textures, options.shadowFactor)

  return {
    group,
    setTextures(textures: WallTextureSet, shadowFactor: number): void {
      applyTextures(textures, shadowFactor)
    },
    setVisibility(visible): void {
      if (byType.drystone) byType.drystone.visible = visible.drystone
      if (byType.barrier) byType.barrier.visible = visible.barrier
      if (byType.seaWall) byType.seaWall.visible = visible.seaWall
      group.visible = visible.drystone || visible.barrier || visible.seaWall
    },
    dispose(): void {
      for (const mesh of meshes) {
        mesh.geometry.dispose()
      }
      drystoneMaterial.dispose()
      barrierMaterial.dispose()
      seaWallMaterial.dispose()
      group.removeFromParent()
    },
  }
}

/** 木栏（官方 Fence）精灵：官方是“立柱 + 两道横栏”的网格，lab 沿用实测精灵区域。 */
export function fenceRailSprites(
  segments: readonly WallSegment[],
  step = WALL_FINE_STEP,
): Array<{ x: number; z: number; y: number; rotation: number; scale: number; variant: number }> {
  const out: Array<{ x: number; z: number; y: number; rotation: number; scale: number; variant: number }> = []
  for (const segment of segments) {
    if (segment.type !== 'fence') {
      continue
    }
    const span = Math.max(1e-3, segment.endAlong - segment.startAlong)
    const count = Math.max(1, Math.round(span / step))
    for (let i = 0; i < count; i += 1) {
      const point = segment.points[Math.min(segment.points.length - 1, Math.round((i * (segment.points.length - 1)) / Math.max(1, count - 1)))]!
      out.push({
        x: point.x,
        z: point.z,
        y: point.roadY - 0.02,
        rotation: point.rotation,
        scale: 1,
        variant: i % 2,
      })
    }
  }
  return out
}
