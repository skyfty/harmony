import * as THREE from 'three'
import { TREE_OBJECT_MODELS } from '../slowroads/core/seasonCatalog'
import type { SeasonId } from '../slowroads/core/seasonCatalog'
import { injectSlowroadsFog } from '../slowroads/render/fogInjection'
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
const UPDATE_DISTANCE = 24
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

const FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uTreeAtlas;
uniform sampler2D uTreeAlphaTex;
uniform sampler2D uTreeNormalTex;
uniform float uTreeHasAlphaTex;
uniform float uTreeHasNormalTex;
uniform float uTreeDiscolouration;
uniform float uTreeHasSnow;
uniform float uTreeSpecies;
varying vec2 vPlUv;
varying vec3 vPlWorldNormal;
`

const FRAGMENT_BODY = /* glsl */ `
{
  vec4 treeTexel = texture2D(uTreeAtlas, vPlUv);
  float treeAlpha = mix(treeTexel.a, texture2D(uTreeAlphaTex, vPlUv).r, uTreeHasAlphaTex);
  vec3 treeColor = treeTexel.rgb;
  float treeLeafEffect = step(treeColor.b * 1.5, treeColor.g);
  treeColor.rg *= 1.0 - (1.0 - uTreeDiscolouration) * treeLeafEffect;
  if (uTreeHasSnow > 0.5 && uTreeSpecies < 0.5) {
    vec3 treeNormal = normalize(vPlWorldNormal);
    if (uTreeHasNormalTex > 0.5) {
      vec3 n = texture2D(uTreeNormalTex, vPlUv).xyz * 2.0 - 1.0;
      treeNormal = normalize(treeNormal + vec3(n.x, 0.0, n.z) * 0.5);
    }
    float up = clamp(treeNormal.y, 0.0, 1.0);
    treeColor = mix(treeColor, vec3(1.0), clamp(up * 1.4, 0.0, 1.0) * 0.8);
  }
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
  setSeason(state: TreeMeshSeasonState): void
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
    uTreeDiscolouration: { value: 1 },
    uTreeHasSnow: { value: 0 },
    uTreeSpecies: { value: species },
  }))
  const materials: THREE.MeshStandardMaterial[] = [0, 1].map((species) => {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true,
      // 网格 UV 直接采样树卡图集；法线来自模型 + 卡片法线混合。
    })
    material.name = `slowroads-near-tree-${species === 0 ? 'broadleaf' : 'conifer'}-material`
    material.customProgramCacheKey = () => `pl-tree-mesh-v1-${species}`
    material.onBeforeCompile = (shader) => {
      for (const [name, uniform] of Object.entries(uniformsBySpecies[species]!)) {
        shader.uniforms[name] = uniform as THREE.IUniform
      }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vPlUv;\nvarying vec3 vPlWorldNormal;`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vPlUv = uv;
#ifdef USE_INSTANCING
  vPlWorldNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
#else
  vPlWorldNormal = normalize(mat3(modelMatrix) * normal);
#endif`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
        .replace('#include <map_fragment>', FRAGMENT_BODY)
      injectSlowroadsFog(shader)
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
    setSeason(state: TreeMeshSeasonState): void {
      if (state.textures) {
        uniformsBySpecies[0]!.uTreeAtlas!.value = state.textures.broadleafD
        uniformsBySpecies[0]!.uTreeNormalTex!.value = state.textures.broadleafN
        uniformsBySpecies[1]!.uTreeAtlas!.value = state.textures.coniferM
        uniformsBySpecies[1]!.uTreeAlphaTex!.value = state.textures.coniferA
      }
      uniformsBySpecies[0]!.uTreeDiscolouration!.value = state.discolouration
      uniformsBySpecies[1]!.uTreeDiscolouration!.value = state.discolouration
      uniformsBySpecies[0]!.uTreeHasSnow!.value = state.hasSnow ? 1 : 0
      uniformsBySpecies[1]!.uTreeHasSnow!.value = 0
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
