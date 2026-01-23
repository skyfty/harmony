import type { Object3D } from 'three'
import { Matrix4 } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState, Vector3Like } from '../../index'
import {
  allocateModelInstanceBinding,
  ensureInstancedMeshesRegistered,
  getCachedModelObject,
  releaseModelInstanceBinding,
  updateModelInstanceBindingMatrix,
} from '../../modelObjectCache'
import {
  buildInstancedTilingLocalMatrices,
  computeBoxExtentsAlongBasis,
  computeInstancedTilingBasis,
  type InstancedTilingMode,
} from '../../instancedMeshTiling'

export const INSTANCED_TILING_COMPONENT_TYPE = 'instancedTiling'

export const INSTANCED_TILING_DEFAULT_COUNT = 1
export const INSTANCED_TILING_DEFAULT_SPACING = 0
export const INSTANCED_TILING_DEFAULT_MODE: InstancedTilingMode = 'axis'
export const INSTANCED_TILING_DEFAULT_FORWARD: Vector3Like = { x: 0, y: 0, z: 1 }
export const INSTANCED_TILING_DEFAULT_UP: Vector3Like = { x: 0, y: 1, z: 0 }
export const INSTANCED_TILING_DEFAULT_ROLL_DEGREES = 0

export interface InstancedTilingComponentProps {
  /** Model/Mesh assetId to be instanced. Empty string means "not selected". */
  meshId: string

  /** Instance counts along X/Y/Z (positive direction only). */
  countX: number
  countY: number
  countZ: number

  /** Spacing offsets along X/Y/Z. Can be negative. */
  spacingX: number
  spacingY: number
  spacingZ: number

  /** 'axis' = world-aligned 3D grid; 'vector' = 3D grid using a tilted orthonormal basis. */
  mode: InstancedTilingMode

  /** Only for mode='vector': local forward direction of the grid (tilt direction). */
  forwardLocal: Vector3Like
  /** Only for mode='vector': local up hint to stabilize roll. */
  upLocal: Vector3Like

  /** Only for mode='vector': extra roll around forward axis (degrees). */
  rollDegrees: number
}

function clampCount(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : INSTANCED_TILING_DEFAULT_COUNT
  return Math.max(1, Math.floor(numeric))
}

function clampSpacing(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : INSTANCED_TILING_DEFAULT_SPACING
  return numeric
}

function clampVec3(value: unknown, fallback: Vector3Like): Vector3Like {
  const source = value as Vector3Like | null | undefined
  const x = typeof source?.x === 'number' && Number.isFinite(source.x) ? source.x : fallback.x
  const y = typeof source?.y === 'number' && Number.isFinite(source.y) ? source.y : fallback.y
  const z = typeof source?.z === 'number' && Number.isFinite(source.z) ? source.z : fallback.z
  return { x, y, z }
}

export function clampInstancedTilingComponentProps(
  props: Partial<InstancedTilingComponentProps> | null | undefined,
): InstancedTilingComponentProps {
  const meshIdRaw = typeof props?.meshId === 'string' ? props.meshId : ''
  const meshId = meshIdRaw.trim()

  const modeRaw = typeof props?.mode === 'string' ? props.mode : INSTANCED_TILING_DEFAULT_MODE
  const mode: InstancedTilingMode = modeRaw === 'vector' ? 'vector' : 'axis'

  const rollDegreesRaw = typeof props?.rollDegrees === 'number' && Number.isFinite(props.rollDegrees)
    ? props.rollDegrees
    : INSTANCED_TILING_DEFAULT_ROLL_DEGREES

  return {
    meshId,
    countX: clampCount(props?.countX),
    countY: clampCount(props?.countY),
    countZ: clampCount(props?.countZ),
    spacingX: clampSpacing(props?.spacingX),
    spacingY: clampSpacing(props?.spacingY),
    spacingZ: clampSpacing(props?.spacingZ),
    mode,
    forwardLocal: clampVec3(props?.forwardLocal, INSTANCED_TILING_DEFAULT_FORWARD),
    upLocal: clampVec3(props?.upLocal, INSTANCED_TILING_DEFAULT_UP),
    rollDegrees: rollDegreesRaw,
  }
}

export function cloneInstancedTilingComponentProps(props: InstancedTilingComponentProps): InstancedTilingComponentProps {
  return {
    meshId: props.meshId,
    countX: props.countX,
    countY: props.countY,
    countZ: props.countZ,
    spacingX: props.spacingX,
    spacingY: props.spacingY,
    spacingZ: props.spacingZ,
    mode: props.mode,
    forwardLocal: { ...props.forwardLocal },
    upLocal: { ...props.upLocal },
    rollDegrees: props.rollDegrees,
  }
}

class InstancedTilingComponent extends Component<InstancedTilingComponentProps> {
  private readonly baseMatrix = new Matrix4()
  private readonly instanceMatrix = new Matrix4()

  private activeMeshId: string | null = null
  private bindingIds: string[] = []

  private layoutSignature: string | null = null
  private localMatrices: Matrix4[] = []

  private lastBaseElements: Float32Array | null = null
  private localDirty = true

  constructor(context: ComponentRuntimeContext<InstancedTilingComponentProps>) {
    super(context)
  }

  onRuntimeAttached(_object: Object3D | null): void {
    this.context.markDirty()
    this.localDirty = true
  }

  onPropsUpdated(): void {
    this.context.markDirty()
    this.localDirty = true
  }

  onEnabledChanged(enabled: boolean): void {
    if (!enabled) {
      this.cleanupBindings()
      return
    }
    this.context.markDirty()
    this.localDirty = true
  }

  onDestroy(): void {
    this.cleanupBindings()
  }

  onUpdate(): void {
    if (!this.context.isEnabled()) {
      return
    }

    const runtimeObject = this.context.getRuntimeObject()
    if (!runtimeObject) {
      // No transform source; keep bindings as-is but skip updates.
      return
    }

    const props = clampInstancedTilingComponentProps(this.context.getProps())
    if (!props.meshId) {
      this.cleanupBindings()
      return
    }

    const group = getCachedModelObject(props.meshId)
    if (!group) {
      // Asset not loaded into modelObjectCache yet.
      return
    }

    ensureInstancedMeshesRegistered(props.meshId)

    const instanceCount = props.countX * props.countY * props.countZ
    if (!Number.isFinite(instanceCount) || instanceCount <= 0) {
      this.cleanupBindings()
      return
    }

    if (!this.ensureBindings(props.meshId, instanceCount)) {
      return
    }

    const basis = computeInstancedTilingBasis({
      mode: props.mode,
      forwardLocal: props.forwardLocal,
      upLocal: props.upLocal,
      rollDegrees: props.rollDegrees,
    })

    const extents = computeBoxExtentsAlongBasis(group.boundingBox, basis)
    const stepX = extents.x + props.spacingX
    const stepY = extents.y + props.spacingY
    const stepZ = extents.z + props.spacingZ

    const signature = this.buildLayoutSignature(props, extents)
    if (signature !== this.layoutSignature || this.localMatrices.length !== instanceCount) {
      this.layoutSignature = signature
      this.localMatrices = buildInstancedTilingLocalMatrices({
        countX: props.countX,
        countY: props.countY,
        countZ: props.countZ,
        stepX,
        stepY,
        stepZ,
        basis,
      })
      this.localDirty = true
    }

    runtimeObject.updateMatrixWorld(true)
    this.baseMatrix.copy(runtimeObject.matrixWorld)

    if (!this.shouldUpdateForBaseMatrix(this.baseMatrix)) {
      return
    }

    for (let i = 0; i < this.bindingIds.length; i += 1) {
      const bindingId = this.bindingIds[i]
      const local = this.localMatrices[i]
      if (!bindingId || !local) {
        continue
      }
      this.instanceMatrix.multiplyMatrices(this.baseMatrix, local)
      updateModelInstanceBindingMatrix(bindingId, this.instanceMatrix)
    }

    this.localDirty = false
  }

  private buildLayoutSignature(props: InstancedTilingComponentProps, extents: { x: number; y: number; z: number }): string {
    // Include everything that changes local placement.
    return [
      props.meshId,
      props.mode,
      `${props.countX},${props.countY},${props.countZ}`,
      `${props.spacingX},${props.spacingY},${props.spacingZ}`,
      `${props.forwardLocal.x},${props.forwardLocal.y},${props.forwardLocal.z}`,
      `${props.upLocal.x},${props.upLocal.y},${props.upLocal.z}`,
      `${props.rollDegrees}`,
      `${extents.x},${extents.y},${extents.z}`,
    ].join('|')
  }

  private shouldUpdateForBaseMatrix(matrix: Matrix4): boolean {
    const elements = matrix.elements
    const cached = this.lastBaseElements
    if (!cached) {
      this.lastBaseElements = new Float32Array(elements)
      return true
    }
    let changed = false
    for (let i = 0; i < 16; i += 1) {
      if (Math.abs((cached[i] ?? 0) - (elements[i] ?? 0)) > 1e-7) {
        changed = true
        break
      }
    }
    if (changed) {
      for (let i = 0; i < 16; i += 1) {
        cached[i] = elements[i] ?? 0
      }
    }
    // Also update when props/layout changed, even if matrix unchanged.
    return changed || this.localDirty
  }

  private ensureBindings(meshId: string, count: number): boolean {
    const needsReset = this.activeMeshId !== meshId || this.bindingIds.length !== count
    if (!needsReset && this.bindingIds.length === count) {
      return true
    }

    this.cleanupBindings()
    this.activeMeshId = meshId

    const created: string[] = []
    for (let i = 0; i < count; i += 1) {
      const bindingId = `${this.context.nodeId}:${this.context.componentId}:${i}`
      const binding = allocateModelInstanceBinding(meshId, bindingId, this.context.nodeId)
      if (!binding) {
        created.forEach((id) => releaseModelInstanceBinding(id))
        this.activeMeshId = null
        this.bindingIds = []
        return false
      }
      created.push(bindingId)
    }

    this.bindingIds = created
    this.localDirty = true
    return true
  }

  private cleanupBindings(): void {
    for (const bindingId of this.bindingIds) {
      releaseModelInstanceBinding(bindingId)
    }
    this.bindingIds = []
    this.activeMeshId = null
    this.layoutSignature = null
    this.localMatrices = []
    this.lastBaseElements = null
    this.localDirty = true
  }
}

const instancedTilingComponentDefinition: ComponentDefinition<InstancedTilingComponentProps> = {
  type: INSTANCED_TILING_COMPONENT_TYPE,
  label: 'Instanced Tiling',
  icon: 'mdi-grid',
  order: 85,
  description: 'Tile a model asset into an InstancedMesh 3D grid.',
  canAttach(node: SceneNode) {
    const type = String(node.nodeType ?? '').toLowerCase()
    return type !== 'light' && type !== 'camera'
  },
  createDefaultProps() {
    return clampInstancedTilingComponentProps(null)
  },
  createInstance(context) {
    return new InstancedTilingComponent(context)
  },
}

componentManager.registerDefinition(instancedTilingComponentDefinition)

export function createInstancedTilingComponentState(
  _node: SceneNode,
  overrides?: Partial<InstancedTilingComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<InstancedTilingComponentProps> {
  const merged = clampInstancedTilingComponentProps({
    ...(overrides ?? {}),
  })
  return {
    id: options.id ?? '',
    type: INSTANCED_TILING_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { instancedTilingComponentDefinition }
