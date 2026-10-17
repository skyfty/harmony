import * as THREE from 'three'
import type { TreePlacement } from '../core/placement'
import { TREE_OBJECT_MODELS } from '../core/seasonCatalog'
import type { LabAssetStore } from './assetSource'
import type { FoliageSharedUniforms } from './foliage'
import { LANDSCAPE_LIGHT_GLSL } from './landscapeLighting'

/**
 * 近树 3D 网格层（仿 slowroads NearTreeManager）。
 *
 * slowroads 在相机附近的树上用真实网格渲染（2 物种 × 4 变体 = 8 个 OBJ，
 * 网格 UV 直接采样当季 trees_0 / trees_1 图集的对应列），远处交给树卡与
 * imposters。这里用打包后的 `.treebin`（Float32 pos/normal/uv + Uint16 index）
 * 加载，避免在小程序分包里携带 OBJLoader；实例按相机分块流式更新。
 */

interface ParsedTreeModel {
  geometry: THREE.BufferGeometry
  /** 归一化到单位高度用的缩放（世界高度 = TREE_UNIT_SIZE × instance.scale）。 */
  unitScale: number
}

const TREE_UNIT_SIZE = 8
const UPDATE_DISTANCE = 4
const MAX_INSTANCES_PER_MESH = 4000

function parseTreeBin(buffer: ArrayBuffer): ParsedTreeModel {
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

  let maxY = 0
  for (let i = 1; i < positions.length; i += 3) {
    if (positions[i]! > maxY) {
      maxY = positions[i]!
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingSphere()
  return { geometry, unitScale: maxY > 0 ? TREE_UNIT_SIZE / maxY : 1 }
}

const MESH_VERTEX_SHADER = `
#include <common>
varying vec2 vUv;
varying vec3 vWorldNormal;
/** 实例（含模型）世界基向量：对象空间法线图需要用它旋转到世界空间。 */
varying mat3 vBasis;
/** 官方共享近树材质（xr()）的密度压暗与视深权重。 */
varying float vLeafBrightness;
varying float vRadianceBlend;
/** 官方树卡变色乘数（顶点按噪声幅度换算：≈1±factor/2）。 */
varying float vTreeDiscolouration;
varying float vLodHidden;
varying vec2 vFadeSeed;
/** 官方 vCameraUp：世界空间的相机上方向（无 roll 时即 (0,1,0)）。 */
varying vec3 vCameraUp;
uniform sampler2D uDensityMap;
/** 官方树卡变色噪声（与树卡共用 noiseMap；uv = 实例世界坐标 / 256）。 */
uniform sampler2D uTreeDiscolourationNoise;
/** 官方 effects.treeDiscolouration：噪声变色幅度（不是乘数）。 */
uniform float uTreeDiscolourationFactor;
uniform float uWorldSize;
uniform float uWorldHalf;
uniform float uShadowFactor;
uniform vec3 uCameraPos;
uniform float uFadeNear;
uniform float uFadeFar;
#include <fog_pars_vertex>
void main() {
  #ifdef USE_INSTANCING
    mat4 instModel = modelMatrix * instanceMatrix;
  #else
    mat4 instModel = modelMatrix;
  #endif
  vec4 worldPosition = instModel * vec4(position, 1.0);
  vBasis = mat3(instModel);
  vWorldNormal = normalize(mat3(instModel) * normal);
  vUv = uv;
  vec4 mvPosition = viewMatrix * worldPosition;
  // 官方近树：vLeafBrightness = 1 - density × shadowFactor × saturate((10 - 模型高度m)/3)
  // （lab 用与地形/树卡同源的树密度图近似官方 per-instance density 属性）。
  vec3 instOrigin = instModel[3].xyz;
  vFadeSeed = instOrigin.xz;
  float distXZ = distance(instOrigin.xz, uCameraPos.xz);
  vLodHidden = uFadeFar > uFadeNear
    ? smoothstep(uFadeNear, uFadeFar, distXZ)
    : 0.0;
  float density = clamp(texture2D(uDensityMap, (instOrigin.xz + uWorldHalf) / uWorldSize).r * 1.15, 0.0, 1.0);
  float heightMeters = position.y * length(instModel[1].xyz);
  vLeafBrightness = 1.0 - density * uShadowFactor * clamp((10.0 - heightMeters) / 3.0, 0.0, 1.0);
  float viewDepth = -mvPosition.z;
  vRadianceBlend = 1.0 - clamp((viewDepth - 50.0) / 200.0, 0.0, 1.0) * 0.33;
  // 官方树卡变色（顶点分块 un / Jg）：
  //   discolouration = 1.0 + (noise(wPos.xz / 256.0).r - 0.5) * discolourationFactor;
  //   if(vMapUv.x > 0.76) discolouration = discolouration * 0.5 + 0.5;   // 柏树列兜底
  // 这里的 factor 是幅度，乘数恒在 1 附近（冬季 0.2 → 0.9..1.1）。
  vTreeDiscolouration = 1.0
    + (texture2D(uTreeDiscolourationNoise, instOrigin.xz / 256.0).r - 0.5) * uTreeDiscolourationFactor;
  // 近树图集 u 由 OBJ 给出并按 RepeatWrapping 绕回（官方 trees[r].d = Repeat）。
  float atlasX = vUv.x - floor(vUv.x);
  if (atlasX > 0.76) {
    vTreeDiscolouration = vTreeDiscolouration * 0.5 + 0.5;
  }
  // 官方 vCameraUp = normalMatrix * vec3(0,1,0)（视空间相机上方向）；本着色器法线为世界空间，
  // 因此取视矩阵第二行（相机 up 在世界空间的表示）。无 roll 时即 (0,1,0)。
  vCameraUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const MESH_FRAGMENT_SHADER = `
uniform sampler2D uAtlas;
uniform sampler2D uAlphaTex;
uniform sampler2D uNormalTex;
uniform float uHasAlphaTex;
uniform float uHasNormalTex;
uniform float uAlphaTest;
/** 官方树卡变色乘数（顶点按噪声幅度算好：≈1±factor/2）。 */
varying float vTreeDiscolouration;
varying vec3 vCameraUp;
uniform float uHasSnow;
uniform float uSpecies;
${LANDSCAPE_LIGHT_GLSL}
varying vec2 vUv;
varying vec3 vWorldNormal;
varying mat3 vBasis;
varying float vLeafBrightness;
varying float vRadianceBlend;
varying float vLodHidden;
varying vec2 vFadeSeed;
#include <fog_pars_fragment>
float srMeshLodDither(vec2 world, vec2 uv) {
  return fract(sin(dot(world + uv * 17.0, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec4 texel = texture2D(uAtlas, vUv);
  // 官方共享近树材质（xr()）：alphaMap 走绿通道，阔叶 alphaTest .5（贴图 alpha）、
  // 针叶 alphaTest .4（alpha 图）。
  float alpha = mix(texel.a, texture2D(uAlphaTex, vUv).g, uHasAlphaTex);
  if (alpha < uAlphaTest) {
    discard;
  }
  if (vLodHidden > 0.001) {
    if (vLodHidden > 0.999 || srMeshLodDither(vFadeSeed, vUv) < vLodHidden) {
      discard;
    }
  }
  vec3 color = texel.rgb;
  vec3 normal = normalize(vWorldNormal);
  if (uHasNormalTex > 0.5) {
    // 官方近树材质 normalMapType = ObjectSpace：normal = normalize(normalMatrix * n)。
    vec3 n = texture2D(uNormalTex, vUv).xyz * 2.0 - 1.0;
    normal = normalize(vBasis * n);
  }
  // Match the card shader's deeper foliage palette and handoff lighting.
  float treeLuma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(treeLuma), color, 1.28) * 0.58;
  float treeLeafTintMask = step(color.b * 1.06, color.g);
  color = mix(color, color * vec3(0.48, 0.78, 0.42), treeLeafTintMask);
  // 官方共享近树材质（lit26 / lh）：leafEffect 含 vLeafBrightness（密林下半部压暗），
  // 阔叶按 discolouration 乘数变色并带叶辉光；针叶只缩放绿通道（无辉光）。
  float leafEffect = step(color.b * 1.5, color.g) * vLeafBrightness;
  vec3 emissive = vec3(0.0);
  if (uSpecies < 0.5) {
    color.rg *= 1.0 - (1.0 - vTreeDiscolouration) * leafEffect;
    emissive = vec3(color.rg * 8.0, 0.5) * uRadiance * leafEffect * vRadianceBlend;
  } else {
    color.g *= vTreeDiscolouration;
  }
  color *= vRadianceBlend;
  // 官方近树阔叶积雪（Cu 分块）：dotUp 超过 0.1 才按朝上程度混白。
  if (uHasSnow > 0.5 && uSpecies < 0.5) {
    float dotUp = dot(normal, vCameraUp);
    if (dotUp > 0.1) {
      color = mix(color, vec3(min(1.0, 0.5 + dotUp)), min(1.0, (dotUp - 0.1) * 8.0));
    }
  }
  // 官方近树网格与近树卡共用材质：合成走 direct×(1+emissive)+indirect。
  vec3 lightNormal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), 0.58));
  float ndl = clamp(dot(lightNormal, uSunDir), -1.0, 1.0) * 0.5 + 0.5;
  color = srLandscapeLight(color, ndl, 1.0, emissive);
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

export interface TreeMeshTextures {
  broadleafD: THREE.Texture
  broadleafN: THREE.Texture
  coniferM: THREE.Texture
  coniferA: THREE.Texture
}

export interface TreeMeshManagerOptions {
  assetStore: LabAssetStore
  shared: FoliageSharedUniforms
  /** 树密度图（近似官方 per-instance density 属性，与 foliage 同源）。 */
  densityMap: THREE.Texture
  /** 官方树卡变色噪声（Ui：与树卡 dissolve 同一张 noiseMap）。 */
  noiseMap: THREE.Texture
  /** 密度图覆盖的世界尺寸（米）。 */
  worldSize: number
}

export interface TreeMeshSeasonState {
  textures: TreeMeshTextures
  /**
   * 官方 `effects.treeDiscolouration`：噪声变色**幅度**（不是乘数）。
   * 顶点按官方公式换算成乘数 `1 + (noise(world.xz/256) - 0.5) * factor`
   * （冬季 0.2 → 0.9..1.1），柏树列再走 `*0.5+0.5` 兜底。
   */
  discolouration: number
  hasSnow: boolean
}

export interface TreeMeshManager {
  readonly container: THREE.Group
  /** 重新流式装配近处实例（相机移动超过阈值或世界/季节重建时调用）。 */
  update(cameraPosition: THREE.Vector3, placements: TreePlacement[], radius: number, force?: boolean): void
  setLodBand(near: number, far: number): void
  setSeason(state: TreeMeshSeasonState): void
  setVisible(visible: boolean): void
  readonly instanceCount: number
  dispose(): void
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
      const buffer = await options.assetStore.modelBin(id)
      speciesModels[species]!.push(parseTreeBin(buffer))
    }
  }

  const materials: THREE.ShaderMaterial[] = [0, 1].map((species) => new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uAtlas: { value: null },
      uAlphaTex: { value: null },
      uNormalTex: { value: null },
      uHasAlphaTex: { value: species === 1 ? 1 : 0 },
      uHasNormalTex: { value: species === 0 ? 1 : 0 },
      // 官方 xr()：阔叶（map alpha）alphaTest .5，针叶（alpha map）alphaTest .4。
      uAlphaTest: { value: species === 0 ? 0.5 : 0.4 },
      // 官方预设的 treeDiscolouration 是噪声幅度（顶点按 1±factor/2 换算成乘数）。
      uTreeDiscolourationFactor: { value: 0 },
      uTreeDiscolourationNoise: { value: options.noiseMap },
      uHasSnow: { value: 0 },
      uSpecies: { value: species },
      // 官方光照：环境控制器按预设统一下发（树网格无自发光）。
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0.84, 0.82, 0.73) },
      uAmbientColor: { value: new THREE.Color(0.22, 0.3, 0.12) },
      uHemiColor: { value: new THREE.Color(1.39, 1.36, 1.18) },
      uRadiance: { value: 0 },
      uShadowFactor: { value: 1 },
      uFresnelIntensity: { value: 1 },
      uDensityMap: { value: options.densityMap },
      uWorldSize: { value: options.worldSize },
      uWorldHalf: { value: options.worldSize * 0.5 },
      uCameraPos: options.shared.cameraPosition,
      uFadeNear: { value: 0 },
      uFadeFar: { value: 0 },
    },
    vertexShader: MESH_VERTEX_SHADER,
    fragmentShader: MESH_FRAGMENT_SHADER,
    fog: true,
    side: THREE.DoubleSide,
  }))
  materials[0]!.name = 'slowroads-near-tree-broadleaf-material'
  materials[1]!.name = 'slowroads-near-tree-conifer-material'
  // 官方近树材质 radiance = lights.radiance / 2（叶辉光与树卡同源）。
  materials[0]!.userData.radianceScale = 0.5
  materials[1]!.userData.radianceScale = 0.5

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

  function update(cameraPosition: THREE.Vector3, placements: TreePlacement[], radius: number, force = false): void {
    if (!force && radius > 0 && lastCamera.distanceToSquared(cameraPosition) < UPDATE_DISTANCE * UPDATE_DISTANCE) {
      return
    }
    lastCamera.copy(cameraPosition)
    const counters = [meshes[0]!.map(() => 0), meshes[1]!.map(() => 0)]
    if (radius > 0) {
      const radiusSq = radius * radius
      for (const tree of placements) {
        const dx = tree.x - cameraPosition.x
        const dz = tree.z - cameraPosition.z
        if (dx * dx + dz * dz > radiusSq) {
          continue
        }
        const modelIndex = tree.species === 0 ? tree.variantNear % 4 : tree.variantFar % 4
        const meshList = meshes[tree.species]!
        const mesh = meshList[Math.min(modelIndex, meshList.length - 1)]!
        const index = counters[tree.species]![Math.min(modelIndex, meshList.length - 1)]!
        if (index >= MAX_INSTANCES_PER_MESH) {
          continue
        }
        const model = speciesModels[tree.species]![Math.min(modelIndex, meshList.length - 1)]!
        positionHelper.set(tree.x, tree.y, tree.z)
        eulerHelper.set(0, tree.rotation, 0)
        quaternionHelper.setFromEuler(eulerHelper)
        const scale = model.unitScale * tree.scale
        scaleHelper.set(scale, scale, scale)
        matrixHelper.compose(positionHelper, quaternionHelper, scaleHelper)
        mesh.setMatrixAt(index, matrixHelper)
        counters[tree.species]![Math.min(modelIndex, meshList.length - 1)] = index + 1
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
      for (const material of materials) {
        material.uniforms.uFadeNear!.value = near
        material.uniforms.uFadeFar!.value = far
      }
    },
    setSeason(state: TreeMeshSeasonState): void {
      materials[0]!.uniforms.uAtlas!.value = state.textures.broadleafD
      materials[0]!.uniforms.uNormalTex!.value = state.textures.broadleafN
      materials[0]!.uniforms.uTreeDiscolourationFactor!.value = state.discolouration
      materials[0]!.uniforms.uHasSnow!.value = state.hasSnow ? 1 : 0
      materials[1]!.uniforms.uAtlas!.value = state.textures.coniferM
      materials[1]!.uniforms.uAlphaTex!.value = state.textures.coniferA
      materials[1]!.uniforms.uTreeDiscolourationFactor!.value = state.discolouration
      materials[1]!.uniforms.uHasSnow!.value = 0
    },
    setVisible(visible: boolean): void {
      container.visible = visible
    },
    get instanceCount(): number {
      return instanceCount
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
