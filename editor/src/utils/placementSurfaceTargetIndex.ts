import * as THREE from 'three'

export type PlacementSurfaceTargetIndexOptions = {
  getObject(nodeId: string): THREE.Object3D | null | undefined
  getInstancedTargets(): THREE.Object3D[]
  getInstancedRevision(): number
}

type PlacementSurfaceMeshLike = THREE.Object3D & {
  isMesh?: boolean
  isSkinnedMesh?: boolean
  isInstancedMesh?: boolean
  count?: number
  geometry?: THREE.BufferGeometry
}

export function isPlacementSurfaceRaycastCandidate(object: THREE.Object3D): boolean {
  const userData = object.userData as Record<string, unknown> | undefined
  if (userData?.editorOnly || userData?.instancedPickProxy) {
    return false
  }

  const candidate = object as PlacementSurfaceMeshLike
  const isInstanced = candidate.isInstancedMesh === true
  if (!candidate.isMesh && !candidate.isSkinnedMesh && !isInstanced) {
    return false
  }
  if (isInstanced && (typeof candidate.count !== 'number' || candidate.count <= 0)) {
    return false
  }

  // MeshBVH and THREE.Mesh.raycast both require a usable position attribute.
  // Empty placeholder geometries otherwise fail on every pointer move.
  const position = candidate.geometry?.getAttribute?.('position')
  return Boolean(position && position.count >= 3)
}

export function collectPlacementSurfaceTargetsFromObject(
  object: THREE.Object3D,
  out: THREE.Object3D[],
  parentVisible = true,
): void {
  const currentVisible = parentVisible && object.visible
  if (!currentVisible) {
    return
  }

  if (isPlacementSurfaceRaycastCandidate(object)) {
    out.push(object)
  }

  for (const child of object.children) {
    collectPlacementSurfaceTargetsFromObject(child, out, currentVisible)
  }
}

/**
 * Lazily flattens the raycast targets used for asset placement.
 *
 * Runtime components can append visible meshes after the scene graph has been
 * synchronized, so callers must refresh the affected node when that runtime
 * reports a new surface revision.
 */
export class PlacementSurfaceTargetIndex {
  private readonly targetsByNodeId = new Map<string, THREE.Object3D[]>()
  private readonly targets: THREE.Object3D[] = []
  private readonly options: PlacementSurfaceTargetIndexOptions
  private dirty = true
  private instancedRevision = -1

  constructor(options: PlacementSurfaceTargetIndexOptions) {
    this.options = options
  }

  refreshNode(nodeId: string): void {
    const object = this.options.getObject(nodeId) ?? null
    if (!object) {
      if (this.targetsByNodeId.delete(nodeId)) {
        this.dirty = true
      }
      return
    }

    const targets: THREE.Object3D[] = []
    collectPlacementSurfaceTargetsFromObject(object, targets, true)
    if (targets.length) {
      this.targetsByNodeId.set(nodeId, targets)
    } else {
      this.targetsByNodeId.delete(nodeId)
    }
    this.dirty = true
  }

  rebuild(nodeIds: Iterable<string>): void {
    this.targetsByNodeId.clear()
    for (const nodeId of nodeIds) {
      this.refreshNode(nodeId)
    }
    this.dirty = true
  }

  markDirty(): void {
    this.dirty = true
  }

  clear(): void {
    this.targetsByNodeId.clear()
    this.targets.length = 0
    this.dirty = true
    this.instancedRevision = -1
  }

  ensureUpToDate(): THREE.Object3D[] {
    const instancedRevision = this.options.getInstancedRevision()
    if (!this.dirty && this.instancedRevision === instancedRevision) {
      return this.targets
    }

    this.targets.length = 0
    const seen = new Set<THREE.Object3D>()
    for (const nodeTargets of this.targetsByNodeId.values()) {
      for (const target of nodeTargets) {
        if (!target || seen.has(target)) {
          continue
        }
        seen.add(target)
        this.targets.push(target)
      }
    }

    for (const target of this.options.getInstancedTargets()) {
      if (!target || seen.has(target) || !isPlacementSurfaceRaycastCandidate(target)) {
        continue
      }
      seen.add(target)
      this.targets.push(target)
    }

    this.dirty = false
    this.instancedRevision = instancedRevision
    return this.targets
  }
}
