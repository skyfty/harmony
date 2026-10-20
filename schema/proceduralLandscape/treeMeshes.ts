import * as THREE from 'three'
import { TREE_OBJECT_MODELS } from '../slowroads/core/seasonCatalog'
import type { SeasonId } from '../slowroads/core/seasonCatalog'
import { injectSlowroadsFog } from '../slowroads/render/fogInjection'
import { recordSlowroadsShaderAudit } from './shaderAudit'
import type { SlowroadsAssetStore } from '../slowroads/assets/assetStore'
import type { TreePlacement } from './chunkPlan'

/**
 * 近树 3D 网格层（仿 slowroads NearTreeManager）。
 *
 * 相机附近的树用真实网格渲染（2 物种 × 4 变体 = 8 个模型，UV 直接采样当季
 * trees_0 / trees_1 图集的对应列），远处交给树卡与 imposters。模型来自在线资产包
 * 的 `.treebin`（Float32 pos/normal/uv + Uint16/32 index），避免携带 OBJLoader。
 *
 * 尺寸契约：传入 placements 的 `scale` 是树木世界高度（米），与 runtime 的
 * `TreePlacement.scale` 一致；网格几何会先按 `TREE_UNIT_SIZE`(8m) 基准归一化，
 * 再按 `scale / TREE_UNIT_SIZE` 换算，最终世界高度 = `scale` 米（与树卡层同尺寸，
 * 不再沿用 slowroads-lab 的“8m 倍率”输入语义）。
 */

interface ParsedTreeModel {
  geometry: THREE.BufferGeometry
  unitScale: number
}

const TREE_UNIT_SIZE = 8
const UPDATE_DISTANCE = 4
const MAX_INSTANCES_PER_MESH = 4000

export function parseTreeBin(buffer: ArrayBuffer): ParsedTreeModel {
  const view = new DataView(buffer)
  const magic = view.getUint32(0, false)
  if (magic !== 0x53525442) {
    throw new Error('treebin: bad magic')
  }
  const version = view.getUint32(4, true)
  if (version !== 1) {
    throw new Error(`treebin: unsupported version ${version}`)
  }
  const vertexCount = view.getUint32(8, true)
  const indexCount = view.getUint32(12, true)
  const indexBits = view.getUint32(16, true)
  let offset = 20
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  for (const array of [positions, normals, uvs]) {
    for (let i = 0; i < array.length; i += 1) {
      array[i] = view.getFloat32(offset, true)
      offset += 4
    }
  }
  const indices = indexBits === 16
    ? new Uint16Array(indexCount)
    : new Uint32Array(indexCount)
  for (let i = 0; i < indexCount; i += 1) {
    indices[i] = indexBits === 16 ? view.getUint16(offset, true) : view.getUint32(offset, true)
    offset += indexBits / 8
  }

  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let i = 1; i < positions.length; i += 3) {
    const y = positions[i]!
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const height = Number.isFinite(minY) && Number.isFinite(maxY) ? maxY - minY : 0
  if (height > 0 && minY !== 0) {
    for (let i = 1; i < positions.length; i += 3) {
      positions[i] = positions[i]! - minY
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()
  return { geometry, unitScale: height > 0 ? TREE_UNIT_SIZE / height : 1 }
}

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uTreeAtlas;
uniform sampler2D uTreeAlphaTex;
uniform sampler2D uTreeNormalTex;
uniform float uTreeHasAlphaTex;
uniform float uTreeHasNormalTex;
uniform float uTreeAlphaTest;
uniform float uTreeRadiance;
uniform float uTreeHasSnow;
uniform float uTreeSpecies;
varying vec2 vPlUv;
varying vec3 vPlWorldNormal;
varying mat3 vPlBasis;
varying float vPlLeafBrightness;
varying float vPlRadianceBlend;
varying float vPlTreeDiscolouration;
varying float vPlMeshLodHidden;
varying vec2 vPlMeshFadeSeed;
varying vec3 vPlCameraUp;
`

const FRAGMENT_BODY = /* glsl */ `
{
  vec4 treeTexel = texture2D(uTreeAtlas, vPlUv);
  // 官方共享近树材质（xr()）：alphaMap 走绿通道。阔叶使用贴图 alpha；
  // 针叶使用独立 alpha 图，H5 mipmap 下阈值见 uTreeAlphaTest 的创建处。
  float treeAlpha = mix(treeTexel.a, texture2D(uTreeAlphaTex, vPlUv).g, uTreeHasAlphaTex);
  if (treeAlpha < uTreeAlphaTest) {
    discard;
  }
  if (vPlMeshLodHidden > 0.001) {
    float treeLodDither = fract(sin(dot(vPlMeshFadeSeed + vPlUv * 17.0, vec2(12.9898, 78.233))) * 43758.5453);
    if (vPlMeshLodHidden > 0.999 || treeLodDither < vPlMeshLodHidden) {
      discard;
    }
  }
  vec3 treeColor = treeTexel.rgb;
  vec3 treeNormal = normalize(vPlWorldNormal);
  if (uTreeHasNormalTex > 0.5) {
    // 官方近树材质 normalMapType = ObjectSpace：normal = normalize(basis * n)。
    vec3 treeN = texture2D(uTreeNormalTex, vPlUv).xyz * 2.0 - 1.0;
    treeNormal = normalize(vPlBasis * treeN);
  }
  // Same hue-preserving grade as the tree-card shader: deeper, richer foliage
  // without changing the LOD handoff colour.
  float treeLuma = dot(treeColor, vec3(0.299, 0.587, 0.114));
  treeColor = mix(vec3(treeLuma), treeColor, 1.28) * 0.58;
  float treeLeafTintMask = step(treeColor.b * 1.06, treeColor.g);
  treeColor = mix(treeColor, treeColor * vec3(0.48, 0.78, 0.42), treeLeafTintMask);
  // 官方共享近树材质（lit26 / lh）：leafEffect 含 vLeafBrightness（密林下半部压暗），
  // 阔叶按 discolouration 乘数变色并带叶辉光；针叶只缩放绿通道（无辉光）。
  float treeLeafEffect = step(treeColor.b * 1.5, treeColor.g) * vPlLeafBrightness;
  vec3 treeEmissive = vec3(0.0);
  if (uTreeSpecies < 0.5) {
    treeColor.rg *= 1.0 - (1.0 - vPlTreeDiscolouration) * treeLeafEffect;
    treeEmissive = vec3(treeColor.rg * 8.0, 0.5) * uTreeRadiance * treeLeafEffect * vPlRadianceBlend;
  } else {
    treeColor.g *= vPlTreeDiscolouration;
  }
  treeColor *= vPlRadianceBlend;
  // 官方近树阔叶积雪（Cu 分块）：dotUp 超过 0.1 才按朝上程度混白。
  if (uTreeHasSnow > 0.5 && uTreeSpecies < 0.5) {
    float dotUp = dot(treeNormal, vPlCameraUp);
    if (dotUp > 0.1) {
      treeColor = mix(treeColor, vec3(min(1.0, 0.5 + dotUp)), min(1.0, (dotUp - 0.1) * 8.0));
    }
  }
  totalEmissiveRadiance = treeEmissive;
  diffuseColor = vec4(treeColor, treeAlpha);
}
`

export interface TreeMeshTextures {
  broadleafD: THREE.Texture
  broadleafN: THREE.Texture
  coniferM: THREE.Texture
  coniferA: THREE.Texture
}

export interface TreeMeshSeasonState {
  season: SeasonId
  textures: TreeMeshTextures | null
  discolouration: number
  hasSnow: boolean
}

export interface TreeMeshManager {
  readonly container: THREE.Group
  /** placements[*].scale = 树木世界高度（米）。 */
  update(cameraPosition: THREE.Vector3, placements: ReadonlyArray<TreePlacement>, radius: number, force?: boolean): void
  setLodBand(near: number, far: number): void
  setSeason(state: TreeMeshSeasonState): void
  /** 环境预设光照（radiance 取全量；shadowFactor 驱动密度压暗）。 */
  setLighting(state: { radiance: number; shadowFactor: number }): void
  /** 与地形/树卡同源的树密度图（per-instance 密度压暗 + 变色噪声共用）。 */
  setDensity(texture: THREE.Texture | null, min: THREE.Vector2 | null, size: THREE.Vector2 | null): void
  /** 官方树卡变色噪声（noise_fine）；缺省回落到密度图/图集。 */
  setDiscolourationNoise(texture: THREE.Texture | null): void
  setVisible(visible: boolean): void
  readonly instanceCount: number
  readonly ready: boolean
  dispose(): void
}

export interface TreeMeshManagerOptions {
  assetStore: SlowroadsAssetStore
  hostInverse: THREE.Matrix4 | null
}

const matrixHelper = new THREE.Matrix4()
const positionHelper = new THREE.Vector3()
const quaternionHelper = new THREE.Quaternion()
const eulerHelper = new THREE.Euler()
const scaleHelper = new THREE.Vector3()

export async function createTreeMeshManager(options: TreeMeshManagerOptions): Promise<TreeMeshManager> {
  const speciesModels: ParsedTreeModel[][] = [[], []]
  for (const species of [0, 1] as const) {
    const ids = species === 0 ? TREE_OBJECT_MODELS.broadleaf : TREE_OBJECT_MODELS.conifer
    for (const id of ids) {
      const buffer = await options.assetStore.modelBytes(id)
      if (!buffer) {
        continue
      }
      try {
        speciesModels[species]!.push(parseTreeBin(buffer))
      } catch (error) {
        // 单个模型失败不阻塞其余模型，但必须留下诊断信息。
        console.warn(`[slowroads] treebin parse failed: ${id}`, error)
      }
    }
  }
  const ready = speciesModels[0]!.length > 0 || speciesModels[1]!.length > 0

  const uniformsBySpecies: Array<Record<string, THREE.IUniform>> = [0, 1].map((species) => ({
    uTreeAtlas: { value: null },
    uTreeAlphaTex: { value: null },
    uTreeNormalTex: { value: null },
    uTreeHasAlphaTex: { value: species === 1 ? 1 : 0 },
    uTreeHasNormalTex: { value: species === 0 ? 1 : 0 },
    // 阔叶图集自带 alpha；针叶 alpha 图以细枝覆盖为主，H5 的 mipmap
    // 采样会降低边缘覆盖率，沿用 .4 时近处会整片消失，因此取 .2。
    uTreeAlphaTest: { value: species === 1 ? 0.2 : 0.5 },
    uTreeRadiance: { value: 2 },
    uTreeHasSnow: { value: 0 },
    uTreeSpecies: { value: species },
    /** 官方 effects.treeDiscolouration：噪声变色幅度（不是乘数）。 */
    uTreeDiscolourationFactor: { value: 0 },
    uTreeDiscolourationNoise: { value: null as THREE.Texture | null },
    /** 与地形/树卡同源的树密度图（官方 per-instance density 的近似）。 */
    uTreeDensityMap: { value: null as THREE.Texture | null },
    uTreeDensityMin: { value: new THREE.Vector2() },
    uTreeDensitySize: { value: new THREE.Vector2(1, 1) },
    uTreeShadowFactor: { value: 1 },
    uTreeCameraPos: { value: new THREE.Vector3() },
    uTreeFadeNear: { value: 0 },
    uTreeFadeFar: { value: 0 },
  }))
  const materials: THREE.MeshLambertMaterial[] = [0, 1].map((species) => {
    // 官方近树材质 = Lambert（无镜面）；树冠 radiance 项官方走 directSpecular
    // （依赖车灯），白天不产生自发光，因此这里保持纯 Lambert 光照。
    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      // 逐种 alpha 裁切在片元体里按 uTreeAlphaTest 处理（阔叶 .5 / 针叶 .2）。
      alphaTest: 0,
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true,
    })
    material.name = `slowroads-near-tree-${species === 0 ? 'broadleaf' : 'conifer'}-material`
    material.customProgramCacheKey = () => `pl-tree-mesh-v4-${species}`
    material.onBeforeCompile = (shader) => {
      for (const [name, uniform] of Object.entries(uniformsBySpecies[species]!)) {
        shader.uniforms[name] = uniform as THREE.IUniform
      }
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec2 vPlUv;
varying vec3 vPlWorldNormal;
/** 实例（含模型）世界基向量：对象空间法线图需要用它旋转到世界空间。 */
varying mat3 vPlBasis;
varying float vPlLeafBrightness;
varying float vPlRadianceBlend;
varying float vPlTreeDiscolouration;
varying float vPlMeshLodHidden;
varying vec2 vPlMeshFadeSeed;
/** 官方 vCameraUp：世界空间的相机上方向（无 roll 时即 (0,1,0)）。 */
varying vec3 vPlCameraUp;
uniform sampler2D uTreeDensityMap;
uniform vec2 uTreeDensityMin;
uniform vec2 uTreeDensitySize;
uniform float uTreeShadowFactor;
uniform vec3 uTreeCameraPos;
uniform float uTreeFadeNear;
uniform float uTreeFadeFar;
uniform sampler2D uTreeDiscolourationNoise;
uniform float uTreeDiscolourationFactor;`,
        )
        .replace(
          '#include <begin_vertex>',
          `{
#ifdef USE_INSTANCING
  mat4 treeInstModel = modelMatrix * instanceMatrix;
#else
  mat4 treeInstModel = modelMatrix;
#endif
  vec4 treeWorldPosition = treeInstModel * vec4(position, 1.0);
  vPlBasis = mat3(treeInstModel);
  vPlWorldNormal = normalize(mat3(treeInstModel) * normal);
vPlUv = uv;
  vec4 treeMvPosition = viewMatrix * treeWorldPosition;
  // 官方近树：vLeafBrightness = 1 - density × shadowFactor × saturate((10 - 模型高度m)/3)
  // （与地形/树卡同源的树密度图近似官方 per-instance density 属性）。
  vec3 treeOrigin = treeInstModel[3].xyz;
  vec2 treeDensityUv = (treeOrigin.xz - uTreeDensityMin) / max(uTreeDensitySize, vec2(0.0001));
  float treeDensity = clamp(texture2D(uTreeDensityMap, treeDensityUv).r * 1.15, 0.0, 1.0);
  vPlMeshFadeSeed = treeOrigin.xz;
  float treeDistXZ = distance(treeOrigin.xz, uTreeCameraPos.xz);
  vPlMeshLodHidden = uTreeFadeFar > uTreeFadeNear
    ? smoothstep(uTreeFadeNear, uTreeFadeFar, treeDistXZ)
    : 0.0;
  float treeHeightMeters = position.y * length(treeInstModel[1].xyz);
  vPlLeafBrightness = 1.0 - treeDensity * uTreeShadowFactor * clamp((10.0 - treeHeightMeters) / 3.0, 0.0, 1.0);
  float treeViewDepth = -treeMvPosition.z;
  vPlRadianceBlend = 1.0 - clamp((treeViewDepth - 50.0) / 200.0, 0.0, 1.0) * 0.33;
  // 官方树卡变色（顶点分块）：factor 是幅度，乘数恒在 1 附近（冬季 0.2 → 0.9..1.1）。
  vPlTreeDiscolouration = 1.0
    + (texture2D(uTreeDiscolourationNoise, treeOrigin.xz / 256.0).r - 0.5) * uTreeDiscolourationFactor;
  // 近树图集 u 由 OBJ 给出并按 RepeatWrapping 绕回（官方 trees[r].d = Repeat）。
  float treeAtlasX = vPlUv.x - floor(vPlUv.x);
  if (treeAtlasX > 0.76) {
    vPlTreeDiscolouration = vPlTreeDiscolouration * 0.5 + 0.5;
  }
  // 官方 vCameraUp = normalMatrix * vec3(0,1,0)（视空间相机上方向）；法线为世界空间，
  // 因此取视矩阵第二行（相机 up 在世界空间的表示）。无 roll 时即 (0,1,0)。
  vPlCameraUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
}
#include <begin_vertex>`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
        // 双面叶卡：背面**不翻转**着色法线（官方/lab 同款）。three 默认会把背面
        // normal 取反 → `dot(N, sun) < 0` → direct = 0 → 朝相机的背面区域发黑。
        .replace(
          '#include <normal_fragment_begin>',
          `float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
// Match the tree-card lighting direction near the mesh/card handoff. Real
// leaf normals make a 3D crown much darker than the flat billboard card that
// precedes it, which reads as a different tree rather than a closer LOD.
vec3 treeUpView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
vec3 normal = normalize(mix(normalize(vNormal), treeUpView, 0.58));
vec3 nonPerturbedNormal = normal;`,
        )
        .replace('#include <map_fragment>', FRAGMENT_BODY)
        // 官方自发光合成：emissive 乘进直射项（`direct × (1 + emissive)`）。
        .replace(
          'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
          'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directDiffuse * totalEmissiveRadiance;',
        )
      injectSlowroadsFog(shader, { material })
      recordSlowroadsShaderAudit(material, shader)
    }
    return material
  })

  const meshes: THREE.InstancedMesh[][] = [[], []]
  for (const species of [0, 1] as const) {
    for (const model of speciesModels[species]!) {
      const mesh = new THREE.InstancedMesh(model.geometry, materials[species]!, MAX_INSTANCES_PER_MESH)
      mesh.count = 0
      mesh.frustumCulled = false
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.name = `slowroads-near-tree-${species}-${meshes[species]!.length}`
      meshes[species]!.push(mesh)
    }
  }

  const container = new THREE.Group()
  container.name = 'slowroads-near-trees'
  for (const species of [0, 1] as const) {
    for (const mesh of meshes[species]!) {
      container.add(mesh)
    }
  }

  let lastCamera = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0)
  let instanceCount = 0

  function update(cameraPosition: THREE.Vector3, placements: ReadonlyArray<TreePlacement>, radius: number, force = false): void {
    for (const species of [0, 1] as const) {
      ;(uniformsBySpecies[species]!.uTreeCameraPos!.value as THREE.Vector3).copy(cameraPosition)
    }
    if (!force && radius > 0 && lastCamera.distanceToSquared(cameraPosition) < UPDATE_DISTANCE * UPDATE_DISTANCE) {
      return
    }
    lastCamera.copy(cameraPosition)
    const counters: number[][] = [meshes[0]!.map(() => 0), meshes[1]!.map(() => 0)]
    if (radius > 0) {
      const radiusSq = radius * radius
      for (const tree of placements) {
        const dx = tree.x - cameraPosition.x
        const dz = tree.z - cameraPosition.z
        if (dx * dx + dz * dz > radiusSq) {
          continue
        }
        const meshList = meshes[tree.species]!
        if (!meshList.length) {
          continue
        }
        const modelIndex = Math.floor(Math.max(0, Math.min(0.999, tree.variant)) * meshList.length)
        const index = counters[tree.species]![modelIndex]!
        if (index >= MAX_INSTANCES_PER_MESH) {
          continue
        }
        const model = speciesModels[tree.species]![modelIndex]!
        positionHelper.set(tree.x, tree.y, tree.z)
        eulerHelper.set(0, tree.rotation, 0)
        quaternionHelper.setFromEuler(eulerHelper)
        // tree.scale 是树木世界高度（米）；unitScale 已把几何归一到 TREE_UNIT_SIZE(8m)
        // 基准，所以先除以基准得到“慢路倍率”，世界高度 = maxY × unitScale × (scale / 8) = scale 米。
        const scale = model.unitScale * (tree.scale / TREE_UNIT_SIZE)
        scaleHelper.set(scale, scale, scale)
        matrixHelper.compose(positionHelper, quaternionHelper, scaleHelper)
        if (options.hostInverse) {
          matrixHelper.premultiply(options.hostInverse)
        }
        meshList[modelIndex]!.setMatrixAt(index, matrixHelper)
        counters[tree.species]![modelIndex] = index + 1
      }
    }
    instanceCount = 0
    for (const species of [0, 1] as const) {
      const list = meshes[species]!
      for (let i = 0; i < list.length; i += 1) {
        const mesh = list[i]!
        mesh.count = counters[species]![i]!
        if (mesh.count > 0) {
          mesh.instanceMatrix.needsUpdate = true
        }
        instanceCount += mesh.count
      }
    }
  }

  return {
    container,
    update,
    setLodBand(near: number, far: number): void {
      for (const species of [0, 1] as const) {
        uniformsBySpecies[species]!.uTreeFadeNear!.value = near
        uniformsBySpecies[species]!.uTreeFadeFar!.value = far
      }
    },
    setSeason(state: TreeMeshSeasonState): void {
      if (state.textures) {
        uniformsBySpecies[0]!.uTreeAtlas!.value = state.textures.broadleafD
        uniformsBySpecies[0]!.uTreeNormalTex!.value = state.textures.broadleafN
        uniformsBySpecies[1]!.uTreeAtlas!.value = state.textures.coniferM
        uniformsBySpecies[1]!.uTreeAlphaTex!.value = state.textures.coniferA
      }
      uniformsBySpecies[0]!.uTreeDiscolourationFactor!.value = state.discolouration
      uniformsBySpecies[1]!.uTreeDiscolourationFactor!.value = state.discolouration
      uniformsBySpecies[0]!.uTreeHasSnow!.value = state.hasSnow ? 1 : 0
      uniformsBySpecies[1]!.uTreeHasSnow!.value = 0
    },
    setLighting(state: { radiance: number; shadowFactor: number }): void {
      // 官方树类材质 `oe.radiance = lights.radiance / 2`（lab 记在
      // material.userData.radianceScale）：近树 3D 网格的叶辉光取半量，
      // 否则 `vec3(color.rg * 8, 0.5) × radiance` 会把阔叶烤成白黄。
      const treeRadiance = state.radiance * 0.5
      for (const species of [0, 1] as const) {
        uniformsBySpecies[species]!.uTreeRadiance!.value = treeRadiance
        uniformsBySpecies[species]!.uTreeShadowFactor!.value = state.shadowFactor
      }
    },
    setDensity(texture: THREE.Texture | null, min: THREE.Vector2 | null, size: THREE.Vector2 | null): void {
      for (const species of [0, 1] as const) {
        const uniforms = uniformsBySpecies[species]!
        uniforms.uTreeDensityMap!.value = texture
        if (min) {
          ;(uniforms.uTreeDensityMin!.value as THREE.Vector2).copy(min)
        }
        if (size) {
          ;(uniforms.uTreeDensitySize!.value as THREE.Vector2).copy(size)
        }
        if (uniforms.uTreeDiscolourationNoise!.value == null) {
          uniforms.uTreeDiscolourationNoise!.value = texture
        }
      }
    },
    setDiscolourationNoise(texture: THREE.Texture | null): void {
      for (const species of [0, 1] as const) {
        uniformsBySpecies[species]!.uTreeDiscolourationNoise!.value = texture
      }
    },
    setVisible(visible: boolean): void {
      container.visible = visible
    },
    get instanceCount(): number {
      return instanceCount
    },
    get ready(): boolean {
      return ready
    },
    dispose(): void {
      container.removeFromParent()
      for (const species of [0, 1] as const) {
        for (const model of speciesModels[species]!) {
          model.geometry.dispose()
        }
      }
      for (const material of materials) {
        material.dispose()
      }
    },
  }
}
