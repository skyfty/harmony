import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import {
  COMPONENT_ARTIFACT_KEY,
  COMPONENT_ARTIFACT_NODE_ID_KEY,
  COMPONENT_ARTIFACT_COMPONENT_ID_KEY,
} from './components/componentManager'
import {
  clampSkinComponentProps,
  type SkinComponentProps,
} from './components/definitions/skinComponent'

/**
 * Character 换装（Skin）运行时。
 *
 * 每个槽位加载外部模型资产：
 * 1. 蒙皮路径：资产内所有 SkinnedMesh 的骨骼名都能在角色对象中匹配时，
 *    把皮肤重绑到角色骨骼（保持资产自身的骨骼顺序与 bindMatrix），随角色动画变形；
 * 2. 静态路径：否则把资产克隆挂到槽位固定锚骨（帽子/眼镜/头发→Head，
 *    上衣→Chest，裤子→Hips，鞋子→左右脚），刚性跟随。
 *
 * 挂件通过 COMPONENT_ARTIFACT_* userData 打标，组件被禁用/移除或节点删除时
 * 会被 componentManager.cleanupTaggedArtifacts 自动清理。
 */

export type SkinSlotKey =
  | 'hatAssetId'
  | 'glassesAssetId'
  | 'hairAssetId'
  | 'topAssetId'
  | 'pantsAssetId'
  | 'shoesAssetId'

export type SkinAnchorKind = 'head' | 'chest' | 'hips' | 'feet'

export type SkinSlotDescriptor = {
  key: SkinSlotKey
  label: string
  anchor: SkinAnchorKind
}

export const SKIN_SLOT_DESCRIPTORS: SkinSlotDescriptor[] = [
  { key: 'hatAssetId', label: 'Hat', anchor: 'head' },
  { key: 'glassesAssetId', label: 'Glasses', anchor: 'head' },
  { key: 'hairAssetId', label: 'Hair', anchor: 'head' },
  { key: 'topAssetId', label: 'Top', anchor: 'chest' },
  { key: 'pantsAssetId', label: 'Pants', anchor: 'hips' },
  { key: 'shoesAssetId', label: 'Shoes', anchor: 'feet' },
]

const ANCHOR_PATTERNS: Record<Exclude<SkinAnchorKind, 'feet'>, RegExp[]> = {
  head: [/^head$/i, /head/i, /头/],
  chest: [/chest/i, /spine1/i, /^spine$/i, /胸/, /躯干/, /脊柱/],
  hips: [/^hips?$/i, /pelvis/i, /臀/, /骨盆/],
}

const LEFT_FOOT_PATTERNS = [
  /^left.*foot/i,
  /foot.*left/i,
  /^foot_l$/i,
  /^l_foot/i,
  /left.*(ankle|toe)/i,
  /左.*(脚|足)/,
]

const RIGHT_FOOT_PATTERNS = [
  /^right.*foot/i,
  /foot.*right/i,
  /^foot_r$/i,
  /^r_foot/i,
  /right.*(ankle|toe)/i,
  /右.*(脚|足)/,
]

// ---------------------------------------------------------------------------
// 资产缓存（与 externalAnimationAssetCache 保持一致的模式）
// ---------------------------------------------------------------------------

const cachedObjects = new Map<string, THREE.Object3D | null>()
const pendingLoads = new Map<string, Promise<THREE.Object3D | null>>()

export function hasCachedSkinAsset(assetId: string): boolean {
  const normalized = typeof assetId === 'string' ? assetId.trim() : ''
  return Boolean(normalized && (cachedObjects.has(normalized) || pendingLoads.has(normalized)))
}

export function getCachedSkinAsset(assetId: string): THREE.Object3D | null | undefined {
  const normalized = typeof assetId === 'string' ? assetId.trim() : ''
  if (!normalized) {
    return undefined
  }
  return cachedObjects.get(normalized)
}

export function getOrLoadSkinAsset(
  assetId: string,
  loader: () => Promise<THREE.Object3D | null>,
): Promise<THREE.Object3D | null> {
  const normalized = typeof assetId === 'string' ? assetId.trim() : ''
  if (!normalized) {
    return Promise.resolve(null)
  }
  if (cachedObjects.has(normalized)) {
    return Promise.resolve(cachedObjects.get(normalized) ?? null)
  }
  const pending = pendingLoads.get(normalized)
  if (pending) {
    return pending
  }
  const promise = (async () => {
    try {
      const object = await loader()
      cachedObjects.set(normalized, object)
      return object
    } catch (error) {
      console.warn('[SkinRuntime] Failed to load skin asset', normalized, error)
      cachedObjects.set(normalized, null)
      return null
    } finally {
      pendingLoads.delete(normalized)
    }
  })()
  pendingLoads.set(normalized, promise)
  return promise
}

export function resetSkinAssetCache(): void {
  cachedObjects.clear()
  pendingLoads.clear()
}

export const resetSkinRuntimeCache = resetSkinAssetCache

export function getMissingSkinAssetIds(props: SkinComponentProps | null | undefined): string[] {
  const normalized = clampSkinComponentProps(props)
  const missing: string[] = []
  SKIN_SLOT_DESCRIPTORS.forEach((slot) => {
    const assetId = normalized[slot.key]
    if (!assetId || hasCachedSkinAsset(assetId)) {
      return
    }
    missing.push(assetId)
  })
  return missing
}

// ---------------------------------------------------------------------------
// 骨骼解析
// ---------------------------------------------------------------------------

export function collectBoneNames(root: THREE.Object3D | null | undefined): string[] {
  if (!root) {
    return []
  }
  const names: string[] = []
  const seen = new Set<string>()
  root.traverse((object) => {
    if (object.type !== 'Bone') {
      return
    }
    const name = object.name?.trim()
    if (!name || seen.has(name)) {
      return
    }
    seen.add(name)
    names.push(name)
  })
  return names
}

function findBoneByPatterns(root: THREE.Object3D, patterns: RegExp[]): THREE.Object3D | null {
  // 按 pattern 顺序优先：先尝试高优先级命名（如 Chest/Spine1），再回退到通用命名。
  for (const pattern of patterns) {
    let match: THREE.Object3D | null = null
    root.traverse((object) => {
      if (match || !object.name) {
        return
      }
      if (pattern.test(object.name.trim().toLowerCase())) {
        match = object
      }
    })
    if (match) {
      return match
    }
  }
  return null
}

function findBoneByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
  const normalized = name.trim().toLowerCase()
  if (!normalized) {
    return null
  }
  let result: THREE.Object3D | null = null
  root.traverse((object) => {
    if (result || !object.name) {
      return
    }
    if (object.name.trim().toLowerCase() === normalized) {
      result = object
    }
  })
  return result
}

function normalizeBoneNameForMatch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(mixamorig[:_]?|mixamo[:_]?|bone[:_]?)/i, '')
    .replace(/[\s_]+/g, '')
}

function resolveCharacterBone(root: THREE.Object3D, boneName: string): THREE.Object3D | null {
  const exact = findBoneByName(root, boneName)
  if (exact) {
    return exact
  }
  const normalized = normalizeBoneNameForMatch(boneName)
  if (!normalized) {
    return null
  }
  let result: THREE.Object3D | null = null
  root.traverse((object) => {
    if (result || !object.name) {
      return
    }
    if (normalizeBoneNameForMatch(object.name) === normalized) {
      result = object
    }
  })
  return result
}

export function resolveSlotAnchorBoneNames(
  root: THREE.Object3D | null | undefined,
): Record<SkinSlotKey, string | null> {
  const result: Record<SkinSlotKey, string | null> = {
    hatAssetId: null,
    glassesAssetId: null,
    hairAssetId: null,
    topAssetId: null,
    pantsAssetId: null,
    shoesAssetId: null,
  }
  if (!root) {
    return result
  }
  SKIN_SLOT_DESCRIPTORS.forEach((slot) => {
    if (slot.anchor === 'feet') {
      const left = findBoneByPatterns(root, LEFT_FOOT_PATTERNS)
      const right = findBoneByPatterns(root, RIGHT_FOOT_PATTERNS)
      const names = [left?.name, right?.name].filter(
        (name): name is string => typeof name === 'string' && name.trim().length > 0,
      )
      result[slot.key] = names.length ? names.join(' / ') : null
      return
    }
    result[slot.key] = findBoneByPatterns(root, ANCHOR_PATTERNS[slot.anchor])?.name ?? null
  })
  return result
}

// ---------------------------------------------------------------------------
// 挂载 / 重绑定
// ---------------------------------------------------------------------------

function collectSkinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = []
  root.traverse((object) => {
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) {
      meshes.push(object as THREE.SkinnedMesh)
    }
  })
  return meshes
}

function findCharacterSkeleton(root: THREE.Object3D): THREE.Skeleton | null {
  let result: THREE.Skeleton | null = null
  root.traverse((object) => {
    if (result) {
      return
    }
    const mesh = object as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh || !mesh.skeleton) {
      return
    }
    if (Array.isArray(mesh.skeleton.bones) && mesh.skeleton.bones.length) {
      result = mesh.skeleton
    }
  })
  return result
}

/**
 * 尝试把外部服装网格重绑到角色骨骼。
 * 全部骨骼名匹配成功才重绑（all-or-nothing），并保持资产自身骨骼顺序与 bindMatrix。
 */
function tryRebindSkinnedMeshes(assetRoot: THREE.Object3D, characterRoot: THREE.Object3D): boolean {
  const skinnedMeshes = collectSkinnedMeshes(assetRoot)
  if (!skinnedMeshes.length) {
    return false
  }
  const boneNames = new Set<string>()
  skinnedMeshes.forEach((mesh) => {
    if (!mesh.skeleton?.bones) {
      return
    }
    mesh.skeleton.bones.forEach((bone) => {
      const name = bone?.name?.trim() ?? ''
      if (name) {
        boneNames.add(name)
      }
    })
  })
  if (!boneNames.size) {
    return false
  }
  const boneMap = new Map<string, THREE.Object3D>()
  for (const boneName of boneNames) {
    const bone = resolveCharacterBone(characterRoot, boneName)
    if (!bone) {
      return false
    }
    boneMap.set(boneName, bone)
  }

  // 复用角色自身骨骼的 bind-pose boneInverses（GLB 加载时在绑定姿态下计算），
  // 避免在动画进行中调用 calculateInverses 导致蒙皮错误。
  const characterSkeleton = findCharacterSkeleton(characterRoot)
  const inverseByName = new Map<string, THREE.Matrix4 | null>()
  if (characterSkeleton && characterSkeleton.bones.length === characterSkeleton.boneInverses.length) {
    characterSkeleton.bones.forEach((bone, index) => {
      if (!bone?.name) {
        return
      }
      inverseByName.set(normalizeBoneNameForMatch(bone.name), characterSkeleton.boneInverses[index] ?? null)
    })
  }

  characterRoot.updateMatrixWorld(true)
  const processedSkeletons = new Set<THREE.Skeleton>()
  skinnedMeshes.forEach((mesh) => {
    const skeleton = mesh.skeleton
    if (!skeleton || processedSkeletons.has(skeleton)) {
      return
    }
    processedSkeletons.add(skeleton)
    const bones = skeleton.bones.map(
      (bone) => (boneMap.get(bone.name.trim()) ?? bone) as THREE.Bone,
    )
    const inverses = bones.map((bone) => inverseByName.get(normalizeBoneNameForMatch(bone.name)) ?? null)
    skeleton.bones = bones
    if (inverses.every((inverse) => Boolean(inverse))) {
      skeleton.boneInverses = inverses as THREE.Matrix4[]
    } else {
      skeleton.calculateInverses()
    }
    const bindMatrix = mesh.bindMatrix ? mesh.bindMatrix.clone() : new THREE.Matrix4()
    mesh.bind(skeleton, bindMatrix)
  })
  return true
}

function prepareAttachedObjectForRender(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) {
      return
    }
    const mesh = child as THREE.Mesh
    mesh.castShadow = true
    mesh.receiveShadow = true
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    materials.forEach((material) => {
      if (!material) {
        return
      }
      const typed = material as THREE.Material & { side?: number }
      if (typeof typed.side !== 'undefined') {
        typed.side = THREE.DoubleSide
      }
      typed.needsUpdate = true
    })
  })
}

function tagSkinArtifact(root: THREE.Object3D, nodeId: string, componentId: string): void {
  root.userData = root.userData ?? {}
  root.userData[COMPONENT_ARTIFACT_KEY] = true
  root.userData[COMPONENT_ARTIFACT_NODE_ID_KEY] = nodeId
  root.userData[COMPONENT_ARTIFACT_COMPONENT_ID_KEY] = componentId
}

function isPairLikeAsset(root: THREE.Object3D): boolean {
  let hasLeft = false
  let hasRight = false
  root.traverse((object) => {
    if (hasLeft && hasRight) {
      return
    }
    const name = object.name?.toLowerCase() ?? ''
    if (!name) {
      return
    }
    if (!hasLeft && /(^|[\s_.-])(left|l)([\s_.-]|$)|左/.test(name)) {
      hasLeft = true
    }
    if (!hasRight && /(^|[\s_.-])(right|r)([\s_.-]|$)|右/.test(name)) {
      hasRight = true
    }
  })
  return hasLeft && hasRight
}

function attachStaticToBone(
  bone: THREE.Object3D,
  assetRoot: THREE.Object3D,
  nodeId: string,
  componentId: string,
  roots: THREE.Object3D[],
): void {
  bone.add(assetRoot)
  tagSkinArtifact(assetRoot, nodeId, componentId)
  roots.push(assetRoot)
}

function attachSlotToCharacter(
  characterRoot: THREE.Object3D,
  assetRoot: THREE.Object3D,
  slot: SkinSlotDescriptor,
  nodeId: string,
  componentId: string,
  roots: THREE.Object3D[],
): void {
  prepareAttachedObjectForRender(assetRoot)

  // 蒙皮路径：全部骨骼名匹配成功则重绑并挂到角色根节点。
  if (tryRebindSkinnedMeshes(assetRoot, characterRoot)) {
    characterRoot.add(assetRoot)
    tagSkinArtifact(assetRoot, nodeId, componentId)
    roots.push(assetRoot)
    return
  }

  if (slot.anchor === 'feet') {
    const left = findBoneByPatterns(characterRoot, LEFT_FOOT_PATTERNS)
    const right = findBoneByPatterns(characterRoot, RIGHT_FOOT_PATTERNS)
    if (isPairLikeAsset(assetRoot)) {
      // 资产自带左右两只：整体挂到 Hips，保持作者姿态。
      const hips = findBoneByPatterns(characterRoot, ANCHOR_PATTERNS.hips) ?? characterRoot
      attachStaticToBone(hips, assetRoot, nodeId, componentId, roots)
      return
    }
    if (left && right) {
      const rightClone = cloneSkinned(assetRoot)
      prepareAttachedObjectForRender(rightClone)
      attachStaticToBone(left, assetRoot, nodeId, componentId, roots)
      attachStaticToBone(right, rightClone, nodeId, componentId, roots)
      return
    }
    const singleBone = left ?? right ?? null
    if (singleBone) {
      attachStaticToBone(singleBone, assetRoot, nodeId, componentId, roots)
      return
    }
    console.warn('[SkinRuntime] Shoes slot: no left/right foot bone found on character model.')
    return
  }

  const anchorBone = findBoneByPatterns(characterRoot, ANCHOR_PATTERNS[slot.anchor])
  if (!anchorBone) {
    console.warn(`[SkinRuntime] Skin slot '${slot.label}' anchor bone not found on character model.`)
    return
  }
  attachStaticToBone(anchorBone, assetRoot, nodeId, componentId, roots)
}

// ---------------------------------------------------------------------------
// 挂件注册与同步
// ---------------------------------------------------------------------------

const nodeAttachmentRoots = new Map<string, THREE.Object3D[]>()
const attachedNodeKeys = new Set<string>()

function buildAttachmentKey(nodeId: string, componentId: string): string {
  return `${nodeId}\u0001${componentId}`
}

function detachAttachmentKey(key: string): void {
  const roots = nodeAttachmentRoots.get(key)
  if (roots?.length) {
    roots.forEach((root) => {
      if (root.parent) {
        root.parent.remove(root)
      }
    })
  }
  nodeAttachmentRoots.delete(key)
  attachedNodeKeys.delete(key)
}

export function detachSkinAttachments(nodeId: string, componentId: string): void {
  detachAttachmentKey(buildAttachmentKey(nodeId, componentId))
}

export function cleanupInactiveSkinAttachments(activeKeys: Iterable<string>): void {
  const active = new Set(activeKeys)
  attachedNodeKeys.forEach((key) => {
    if (!active.has(key)) {
      detachAttachmentKey(key)
    }
  })
}

export function resetSkinRuntime(): void {
  nodeAttachmentRoots.forEach((roots) => {
    roots.forEach((root) => {
      if (root.parent) {
        root.parent.remove(root)
      }
    })
  })
  nodeAttachmentRoots.clear()
  attachedNodeKeys.clear()
  resetSkinAssetCache()
}

export interface SkinRuntimeSyncOptions {
  nodeId: string
  componentId: string
  runtimeObject: THREE.Object3D | null
  props: SkinComponentProps
  loadAsset: (assetId: string) => Promise<THREE.Object3D | null>
}

export interface SkinAssetOverride {
  slotKey: SkinSlotKey
  assetId: string
}

export interface SyncSkinAssetsForObjectOptions {
  nodeId?: string
  componentId?: string
  loadAsset: (assetId: string) => Promise<THREE.Object3D | null>
}

/**
 * 直接把一组按槽位划分的皮肤资产挂到角色对象上（不依赖场景文档中的 skinComponent）。
 * 用于多人在线远端角色与运行时动态生成的、已注入 skinComponent 的角色。
 * 使用固定的合成 nodeId/componentId，重复调用会先 detach 旧挂件再重新挂载。
 */
export function syncSkinAssetsForObject(
  runtimeObject: THREE.Object3D | null,
  overrides: SkinAssetOverride[] | null | undefined,
  options: SyncSkinAssetsForObjectOptions,
): void {
  const props = clampSkinComponentProps(null)
  ;(Array.isArray(overrides) ? overrides : []).forEach((override) => {
    const key = override?.slotKey
    const value = typeof override?.assetId === 'string' ? override.assetId.trim() : ''
    if (key && key in props && value) {
      props[key] = value
    }
  })
  syncSkinRuntimeForNode({
    nodeId: options.nodeId ?? 'skin-override',
    componentId: options.componentId ?? 'skin-override',
    runtimeObject,
    props,
    loadAsset: options.loadAsset,
  })
}

export function syncSkinRuntimeForNode(options: SkinRuntimeSyncOptions): void {
  const normalized = clampSkinComponentProps(options.props)
  detachSkinAttachments(options.nodeId, options.componentId)
  if (!options.runtimeObject) {
    return
  }
  const runtimeObject = options.runtimeObject
  const key = buildAttachmentKey(options.nodeId, options.componentId)
  const roots: THREE.Object3D[] = []
  nodeAttachmentRoots.set(key, roots)
  attachedNodeKeys.add(key)

  SKIN_SLOT_DESCRIPTORS.forEach((slot) => {
    const assetId = normalized[slot.key]
    if (!assetId) {
      return
    }
    const cached = getCachedSkinAsset(assetId)
    if (cached === undefined) {
      // 未缓存：先触发加载，加载完成后由调用方重新同步挂载。
      void getOrLoadSkinAsset(assetId, () => options.loadAsset(assetId))
      return
    }
    if (cached === null) {
      return
    }
    attachSlotToCharacter(runtimeObject, cloneSkinned(cached), slot, options.nodeId, options.componentId, roots)
  })
}
