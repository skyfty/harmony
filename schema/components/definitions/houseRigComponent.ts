import * as THREE from 'three'
import type { SceneNode, SceneNodeComponentState } from '../../core'
import {
  applyHouseRigDeformPlan,
  buildHouseRigRestSnapshot,
  clampHouseRigDimensions,
  computeHouseRigMaterialSignature,
  createHouseRigDimensionLimits,
  getHouseRigScript,
  houseRigDimensionsAreInitialized,
  normalizeHouseRigComponentProps,
  toHouseRigAssetDescriptor,
} from '../../houseRig'
import {
  HOUSE_RIG_COMPONENT_TYPE,
  HOUSE_RIG_DEFAULT_SCRIPT_ID,
  HOUSE_RIG_DEFAULT_SCRIPT_VERSION,
  HOUSE_RIG_SCHEMA_VERSION,
} from '../../houseRig/types'
import type {
  HouseRigComponentProps,
  HouseRigDimensions,
  HouseRigRuntimeSnapshot,
} from '../../houseRig/types'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'

const HOUSE_RIG_MATERIAL_SIGNATURE_KEY = '__houseRigMaterialSignature'
const runtimeSnapshots = new Map<string, HouseRigRuntimeSnapshot>()
const runtimeSnapshotListeners = new Map<string, Set<(snapshot: HouseRigRuntimeSnapshot | null) => void>>()

function notifyHouseRigRuntimeSnapshot(
  nodeId: string,
  snapshot: HouseRigRuntimeSnapshot | null,
): void {
  const listeners = runtimeSnapshotListeners.get(nodeId)
  if (!listeners?.size) {
    return
  }
  listeners.forEach((listener) => {
    try {
      listener(snapshot)
    } catch (error) {
      console.warn('House Rig runtime listener failed', error)
    }
  })
}

function clearRuntimeSnapshot(nodeId: string): void {
  runtimeSnapshots.delete(nodeId)
  notifyHouseRigRuntimeSnapshot(nodeId, null)
}

interface IsolatedMeshRecord {
  mesh: THREE.Mesh
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
}

function isEditorHelperObject(object: THREE.Object3D): boolean {
  const userData = object.userData ?? {}
  return Boolean(
    userData.editorOnly
    || userData.instancedPickProxy
    || userData.overrideMaterial
    || object.name.startsWith('__'),
  )
}

function collectHouseRigMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh?.isMesh || isEditorHelperObject(mesh)) {
      return
    }
    if (mesh.parent && isEditorHelperObject(mesh.parent)) {
      return
    }
    meshes.push(mesh)
  })
  return meshes
}

function cloneMaterialValue(
  value: THREE.Material | THREE.Material[],
): THREE.Material | THREE.Material[] {
  return Array.isArray(value) ? value.map((material) => material.clone()) : value.clone()
}

function disposeMaterialValue(value: THREE.Material | THREE.Material[]): void {
  const materials = Array.isArray(value) ? value : [value]
  materials.forEach((material) => material.dispose())
}

function sourceAssetIdForNode(node: SceneNode | null | undefined): string | null {
  return typeof node?.sourceAssetId === 'string' && node.sourceAssetId.trim()
    ? node.sourceAssetId.trim()
    : null
}

function readBoundsFromNodeUserData(node: SceneNode | null | undefined): HouseRigDimensions | null {
  const raw = node?.userData?.instancedBounds
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const value = raw as {
    min?: { x?: number; y?: number; z?: number }
    max?: { x?: number; y?: number; z?: number }
  }
  const min = value.min
  const max = value.max
  if (!min || !max) {
    return null
  }
  const width = Number(max.x) - Number(min.x)
  const height = Number(max.y) - Number(min.y)
  const depth = Number(max.z) - Number(min.z)
  if (![width, height, depth].every((entry) => Number.isFinite(entry) && entry > 0)) {
    return null
  }
  return { width, depth, wallHeight: height }
}

export function createDefaultHouseRigProps(node?: SceneNode | null): HouseRigComponentProps {
  const detected = readBoundsFromNodeUserData(node)
  const restDimensions = detected ?? { width: 0, depth: 0, wallHeight: 0 }
  return {
    schemaVersion: HOUSE_RIG_SCHEMA_VERSION,
    scriptId: HOUSE_RIG_DEFAULT_SCRIPT_ID,
    scriptVersion: HOUSE_RIG_DEFAULT_SCRIPT_VERSION,
    assetId: sourceAssetIdForNode(node),
    topologyHash: null,
    restDimensions,
    dimensions: { ...restDimensions },
    parts: [],
  }
}

export function clampHouseRigComponentProps(
  props: Partial<HouseRigComponentProps> | null | undefined,
  node?: SceneNode | null,
): HouseRigComponentProps {
  const normalized = normalizeHouseRigComponentProps(
    (props ?? {}) as Partial<HouseRigComponentProps> & Record<string, unknown>,
    node,
  )
  if (!houseRigDimensionsAreInitialized(normalized.restDimensions)) {
    return normalized
  }
  const limits = createHouseRigDimensionLimits(normalized.restDimensions)
  return {
    ...normalized,
    dimensions: houseRigDimensionsAreInitialized(normalized.dimensions)
      ? clampHouseRigDimensions(normalized.dimensions, limits, normalized.restDimensions)
      : { ...normalized.restDimensions },
  }
}

export function cloneHouseRigComponentProps(
  props: HouseRigComponentProps,
): HouseRigComponentProps {
  return JSON.parse(JSON.stringify(props)) as HouseRigComponentProps
}

class HouseRigComponent extends Component<HouseRigComponentProps> {
  private isolatedMeshes: IsolatedMeshRecord[] = []
  private activeRoot: THREE.Object3D | null = null
  private pendingMeshRetryTimer: ReturnType<typeof setTimeout> | null = null
  private pendingMeshRetryCount = 0
  private initialAttachPending = false

  constructor(context: ComponentRuntimeContext<HouseRigComponentProps>) {
    super(context)
  }

  onRuntimeAttached(object: THREE.Object3D | null): void {
    this.releaseRuntimeResources()
    if (!object) {
      clearRuntimeSnapshot(this.context.nodeId)
      return
    }
    this.activeRoot = object
    this.initialAttachPending = true
    this.isolateRuntimeAssets(object)
    this.applyCurrentProps(this.context.getProps(), { initialAttach: true })
  }

  onPropsUpdated(next: Readonly<HouseRigComponentProps>): void {
    this.applyCurrentProps(next, { initialAttach: false })
  }

  onEnabledChanged(enabled: boolean): void {
    if (!enabled) {
      this.releaseRuntimeResources()
      return
    }
    const object = this.context.getRuntimeObject()
    if (object) {
      this.onRuntimeAttached(object)
    }
  }

  onDestroy(): void {
    this.releaseRuntimeResources()
  }

  private isolateRuntimeAssets(root: THREE.Object3D): void {
    this.isolatedMeshes = collectHouseRigMeshes(root).map((mesh) => {
      const record: IsolatedMeshRecord = {
        mesh,
        geometry: mesh.geometry,
        material: mesh.material,
      }
      mesh.geometry = mesh.geometry.clone()
      mesh.material = cloneMaterialValue(mesh.material)
      return record
    })
  }

  private applyCurrentProps(
    rawProps: Readonly<HouseRigComponentProps>,
    options: { initialAttach: boolean },
  ): void {
    const root = this.activeRoot
    const node = this.context.getNode()
    if (!root || !node) {
      return
    }
    const props = normalizeHouseRigComponentProps(
      rawProps as Partial<HouseRigComponentProps> & Record<string, unknown>,
      node,
    )
    let rest: ReturnType<typeof buildHouseRigRestSnapshot>
    try {
      rest = buildHouseRigRestSnapshot({
        root,
        assetId: props.assetId ?? sourceAssetIdForNode(node),
        dimensions: houseRigDimensionsAreInitialized(props.restDimensions)
          ? props.restDimensions
          : null,
      })
    } catch {
      this.schedulePendingMeshRetry(root)
      return
    }
    this.clearPendingMeshRetry()
    if (options.initialAttach || this.initialAttachPending) {
      root.userData = root.userData ?? {}
      root.userData[HOUSE_RIG_MATERIAL_SIGNATURE_KEY] = computeHouseRigMaterialSignature(props)
      this.initialAttachPending = false
    }

    const dimensions = houseRigDimensionsAreInitialized(props.restDimensions)
      ? clampHouseRigDimensions(props.dimensions, rest.limits, rest.dimensions)
      : { ...rest.dimensions }
    const script = getHouseRigScript(props.scriptId, props.scriptVersion)
    if (!script) {
      this.publishSnapshot({
        nodeId: this.context.nodeId,
        componentId: this.context.componentId,
        rest,
        dimensions,
        plan: null,
        scriptId: props.scriptId,
        scriptVersion: props.scriptVersion,
        compatibility: {
          compatible: false,
          issues: [`House Rig script not found: ${props.scriptId}@${props.scriptVersion}`],
        },
        warnings: rest.warnings,
      })
      return
    }

    const compatibility = script.getCompatibility(toHouseRigAssetDescriptor(rest))
    if (!compatibility.compatible) {
      this.publishSnapshot({
        nodeId: this.context.nodeId,
        componentId: this.context.componentId,
        rest,
        dimensions,
        plan: null,
        scriptId: script.id,
        scriptVersion: script.version,
        compatibility,
        warnings: rest.warnings,
      })
      return
    }

    try {
      const plan = script.buildPlan(rest, dimensions)
      applyHouseRigDeformPlan(root, rest, plan)
      this.publishSnapshot({
        nodeId: this.context.nodeId,
        componentId: this.context.componentId,
        rest,
        dimensions,
        plan,
        scriptId: script.id,
        scriptVersion: script.version,
        compatibility,
        warnings: plan.warnings,
      })
    } catch (error) {
      this.publishSnapshot({
        nodeId: this.context.nodeId,
        componentId: this.context.componentId,
        rest,
        dimensions,
        plan: null,
        scriptId: script.id,
        scriptVersion: script.version,
        compatibility: {
          compatible: false,
          issues: [error instanceof Error ? error.message : String(error)],
        },
        warnings: rest.warnings,
      })
    }
  }

  private publishSnapshot(snapshot: HouseRigRuntimeSnapshot): void {
    runtimeSnapshots.set(this.context.nodeId, snapshot)
    notifyHouseRigRuntimeSnapshot(this.context.nodeId, snapshot)
  }

  private schedulePendingMeshRetry(root: THREE.Object3D): void {
    if (this.pendingMeshRetryTimer || this.pendingMeshRetryCount >= 40) {
      return
    }
    this.pendingMeshRetryCount += 1
    this.pendingMeshRetryTimer = setTimeout(() => {
      this.pendingMeshRetryTimer = null
      if (this.activeRoot !== root) {
        return
      }
      this.applyCurrentProps(this.context.getProps(), {
        initialAttach: this.initialAttachPending,
      })
    }, 50)
  }

  private clearPendingMeshRetry(): void {
    if (this.pendingMeshRetryTimer) {
      clearTimeout(this.pendingMeshRetryTimer)
      this.pendingMeshRetryTimer = null
    }
    this.pendingMeshRetryCount = 0
  }

  private releaseRuntimeResources(): void {
    this.clearPendingMeshRetry()
    for (const record of this.isolatedMeshes) {
      record.mesh.geometry?.dispose?.()
      disposeMaterialValue(record.mesh.material)
      record.mesh.geometry = record.geometry
      record.mesh.material = record.material
    }
    this.isolatedMeshes = []
    this.activeRoot = null
    this.initialAttachPending = false
    clearRuntimeSnapshot(this.context.nodeId)
  }
}

const houseRigComponentDefinition: ComponentDefinition<HouseRigComponentProps> = {
  type: HOUSE_RIG_COMPONENT_TYPE,
  label: 'House Rig',
  icon: 'mdi-home-edit-outline',
  description: 'Apply an extensible, model-specific three-axis house deformation rig.',
  category: 'Model',
  order: 41,
  inspector: [],
  canAttach(node: SceneNode) {
    if (
      !node
      || (node.nodeType !== 'Group' && node.nodeType !== 'Mesh')
      || node.dynamicMesh
      || node.importChildrenExpanded
      || !sourceAssetIdForNode(node)
    ) {
      return false
    }
    const metadata = node.importMetadata
    if (metadata?.lightweight === true) {
      return false
    }
    if (Array.isArray(metadata?.objectPath) && metadata.objectPath.length > 0) {
      return false
    }
    if (node.instanceLayout && node.instanceLayout.mode !== 'single') {
      return false
    }
    return true
  },
  createDefaultProps(node) {
    return createDefaultHouseRigProps(node)
  },
  createInstance(context) {
    return new HouseRigComponent(context)
  },
}

componentManager.registerDefinition(houseRigComponentDefinition)

export function createHouseRigComponentState(
  node: SceneNode,
  overrides?: Partial<HouseRigComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<HouseRigComponentProps> {
  return {
    id: options.id ?? '',
    type: HOUSE_RIG_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: clampHouseRigComponentProps({
      ...createDefaultHouseRigProps(node),
      ...overrides,
    }, node),
  }
}

export function getHouseRigRuntimeSnapshot(
  nodeId: string,
): HouseRigRuntimeSnapshot | null {
  return runtimeSnapshots.get(nodeId) ?? null
}

export function clearHouseRigRuntimeSnapshot(nodeId: string): void {
  clearRuntimeSnapshot(nodeId)
}

export function subscribeHouseRigRuntime(
  nodeId: string,
  listener: (snapshot: HouseRigRuntimeSnapshot | null) => void,
): () => void {
  const normalizedNodeId = typeof nodeId === 'string' ? nodeId.trim() : ''
  if (!normalizedNodeId) {
    return () => {}
  }
  const listeners = runtimeSnapshotListeners.get(normalizedNodeId) ?? new Set()
  listeners.add(listener)
  runtimeSnapshotListeners.set(normalizedNodeId, listeners)
  return () => {
    const current = runtimeSnapshotListeners.get(normalizedNodeId)
    if (!current) {
      return
    }
    current.delete(listener)
    if (!current.size) {
      runtimeSnapshotListeners.delete(normalizedNodeId)
    }
  }
}

export {
  HOUSE_RIG_COMPONENT_TYPE,
  houseRigComponentDefinition,
}
