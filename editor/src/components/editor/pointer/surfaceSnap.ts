import * as THREE from 'three'
import { setBoundingBoxFromObject } from '../sceneUtils'

type PointerCoords = { clientX: number; clientY: number }

type NormalizedPointerGuardLike = {
  setRayFromEvent(event: { clientX: number; clientY: number }): boolean
}

type SurfaceSnapControllerOptions = {
  normalizedPointerGuard: NormalizedPointerGuardLike
  raycaster: THREE.Raycaster
  ensurePlacementSurfaceTargets: () => THREE.Object3D[]
  isEditableKeyboardTarget: (target: EventTarget | null) => boolean
}

export type SurfaceSnapController = {
  updatePointer(event: PointerEvent): void
  handleKeyDown(event: KeyboardEvent): void
  handleKeyUp(event: KeyboardEvent): void
  handleBlur(): void
  setActive(active: boolean): void
  applySurfaceSnap(target: THREE.Object3D, excludedIds: Set<string>): boolean
}

class SurfaceSnapControllerImpl implements SurfaceSnapController {
  private readonly normalizedPointerGuard: NormalizedPointerGuardLike
  private readonly raycaster: THREE.Raycaster
  private readonly ensurePlacementSurfaceTargets: () => THREE.Object3D[]
  private readonly isEditableKeyboardTarget: (target: EventTarget | null) => boolean

  private lastPointerCoords: PointerCoords | null = null
  private isSurfaceSnapActive = false

  private readonly surfaceSnapBounds = new THREE.Box3()
  private readonly surfaceSnapNormal = new THREE.Vector3()
  private readonly surfaceSnapWorldDelta = new THREE.Vector3()
  private readonly surfaceSnapLocalDelta = new THREE.Vector3()
  private readonly surfaceSnapParentPosition = new THREE.Vector3()
  private readonly surfaceSnapParentQuaternion = new THREE.Quaternion()
  private readonly surfaceSnapParentScale = new THREE.Vector3()

  constructor(options: SurfaceSnapControllerOptions) {
    this.normalizedPointerGuard = options.normalizedPointerGuard
    this.raycaster = options.raycaster
    this.ensurePlacementSurfaceTargets = options.ensurePlacementSurfaceTargets
    this.isEditableKeyboardTarget = options.isEditableKeyboardTarget
  }

  public updatePointer(event: PointerEvent): void {
    this.lastPointerCoords = { clientX: event.clientX, clientY: event.clientY }
  }

  public handleKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) {
      return
    }
    if (event.repeat) {
      return
    }
    if (event.code !== 'KeyV') {
      return
    }
    if (this.isEditableKeyboardTarget(event.target)) {
      return
    }
    this.isSurfaceSnapActive = true
  }

  public handleKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'KeyV') {
      return
    }
    this.isSurfaceSnapActive = false
  }

  public handleBlur = (): void => {
    this.isSurfaceSnapActive = false
  }

  public setActive(active: boolean): void {
    if (!active) {
      this.isSurfaceSnapActive = false
    }
  }

  public applySurfaceSnap(target: THREE.Object3D, excludedIds: Set<string>): boolean {
    if (!this.isSurfaceSnapActive || !this.lastPointerCoords) {
      return false
    }
    if (!this.normalizedPointerGuard.setRayFromEvent(this.lastPointerCoords)) {
      return false
    }

    const targets = this.ensurePlacementSurfaceTargets()
    if (!targets.length) {
      return false
    }

    const intersections = this.raycaster.intersectObjects(targets, false)
    if (!intersections.length) {
      return false
    }

    for (const hit of intersections) {
      const hitObject = hit.object
      if (!hitObject || this.isObjectDescendantOf(target, hitObject)) {
        continue
      }

      const nodeId = this.resolveNodeIdFromObject(hitObject)
      if (!nodeId || excludedIds.has(nodeId)) {
        continue
      }

      const face = hit.face
      if (!face) {
        continue
      }

      this.surfaceSnapNormal.copy(face.normal).transformDirection(hitObject.matrixWorld).normalize()
      if (!Number.isFinite(this.surfaceSnapNormal.x) || !Number.isFinite(this.surfaceSnapNormal.y) || !Number.isFinite(this.surfaceSnapNormal.z)) {
        continue
      }

      const absX = Math.abs(this.surfaceSnapNormal.x)
      const absY = Math.abs(this.surfaceSnapNormal.y)
      const absZ = Math.abs(this.surfaceSnapNormal.z)
      let axis: 'x' | 'y' | 'z' = 'x'
      if (absY >= absX && absY >= absZ) {
        axis = 'y'
      } else if (absZ >= absX && absZ >= absY) {
        axis = 'z'
      }
      const direction = this.surfaceSnapNormal[axis] >= 0 ? 1 : -1

      target.updateMatrixWorld(true)
      setBoundingBoxFromObject(target, this.surfaceSnapBounds)
      if (this.surfaceSnapBounds.isEmpty()) {
        return false
      }

      const targetFace = direction > 0 ? this.surfaceSnapBounds.max[axis] : this.surfaceSnapBounds.min[axis]
      const delta = hit.point[axis] - targetFace
      if (!Number.isFinite(delta)) {
        continue
      }

      this.surfaceSnapWorldDelta.set(0, 0, 0)
      this.surfaceSnapWorldDelta[axis] = delta
      if (this.surfaceSnapWorldDelta.lengthSq() <= 1e-8) {
        return true
      }

      this.surfaceSnapLocalDelta.copy(this.surfaceSnapWorldDelta)
      const parent = target.parent
      if (parent) {
        parent.updateMatrixWorld(true)
        parent.matrixWorld.decompose(this.surfaceSnapParentPosition, this.surfaceSnapParentQuaternion, this.surfaceSnapParentScale)
        this.surfaceSnapParentQuaternion.invert()
        this.surfaceSnapLocalDelta.applyQuaternion(this.surfaceSnapParentQuaternion)
        const safeDivide = (value: number) => (Math.abs(value) <= 1e-6 ? 1 : value)
        this.surfaceSnapLocalDelta.set(
          this.surfaceSnapLocalDelta.x / safeDivide(this.surfaceSnapParentScale.x),
          this.surfaceSnapLocalDelta.y / safeDivide(this.surfaceSnapParentScale.y),
          this.surfaceSnapLocalDelta.z / safeDivide(this.surfaceSnapParentScale.z),
        )
      }

      target.position.add(this.surfaceSnapLocalDelta)
      return true
    }

    return false
  }

  private resolveNodeIdFromObject(object: THREE.Object3D): string | null {
    let current: THREE.Object3D | null = object
    while (current) {
      const nodeId = current.userData?.nodeId
      if (typeof nodeId === 'string' && nodeId) {
        return nodeId
      }
      current = current.parent
    }
    return null
  }

  private isObjectDescendantOf(target: THREE.Object3D, candidate: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = candidate
    while (current) {
      if (current === target) {
        return true
      }
      current = current.parent
    }
    return false
  }
}

export function createSurfaceSnapController(options: SurfaceSnapControllerOptions): SurfaceSnapController {
  return new SurfaceSnapControllerImpl(options)
}
