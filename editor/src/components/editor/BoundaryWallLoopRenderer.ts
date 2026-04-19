import * as THREE from 'three'
import { hashString, stableSerialize } from '@schema/stableSerialize'

const BOUNDARY_WALL_LOOP_GROUP_NAME = '__BoundaryWallLoopPreview'
const BOUNDARY_WALL_LINE_Y_OFFSET = 0.08
const BOUNDARY_WALL_OUTLINE_COLOR = 0xff8a3d
const BOUNDARY_WALL_OUTLINE_OPACITY = 0.96

function computeSignature(points: Array<[number, number]>): string {
  return hashString(stableSerialize(points))
}

function sanitizePoints(points: Array<[number, number]> | undefined | null): Array<[number, number]> {
  if (!Array.isArray(points)) {
    return []
  }
  return points
    .map(([x, z]) => [Number(x), Number(z)] as [number, number])
    .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z))
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((child) => {
    const drawable = child as THREE.Line
    drawable.geometry?.dispose?.()
    const material = drawable.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose?.())
    } else {
      material?.dispose?.()
    }
  })
}

export type BoundaryWallLoopRenderer = {
  clear(): void
  ensure(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
    previewPoints?: Array<[number, number]>
  }): void
  forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
    previewPoints?: Array<[number, number]>
  }): void
}

export function createBoundaryWallLoopRenderer(): BoundaryWallLoopRenderer {
  let state: { nodeId: string; group: THREE.Group; signature: string } | null = null

  function clear() {
    if (!state) {
      return
    }
    const existing = state
    state = null
    existing.group.removeFromParent()
    disposeGroup(existing.group)
  }

  function attachOrRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
    previewPoints?: Array<[number, number]>
    force?: boolean
  }): void {
    const { active, selectedNodeId } = options
    if (!active || !selectedNodeId) {
      clear()
      return
    }

    if (options.isSelectionLocked(selectedNodeId)) {
      clear()
      return
    }

    const runtimeObject = options.resolveRuntimeObject(selectedNodeId)
    if (!runtimeObject) {
      clear()
      return
    }

    const points = sanitizePoints(options.previewPoints)
    if (points.length < 3) {
      clear()
      return
    }

    const signature = computeSignature(points)
    if (!options.force && state && state.nodeId === selectedNodeId && state.signature === signature) {
      if (!runtimeObject.children.includes(state.group)) {
        runtimeObject.add(state.group)
      }
      return
    }

    clear()

    const worldPoints = points.map(([x, z]) => new THREE.Vector3(x, BOUNDARY_WALL_LINE_Y_OFFSET, z))
    const line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(worldPoints),
      new THREE.LineBasicMaterial({
        color: BOUNDARY_WALL_OUTLINE_COLOR,
        transparent: true,
        opacity: BOUNDARY_WALL_OUTLINE_OPACITY,
        depthWrite: false,
      }),
    )
    line.name = 'BoundaryWallLoop'
    line.renderOrder = 102

    const group = new THREE.Group()
    group.name = BOUNDARY_WALL_LOOP_GROUP_NAME
    group.userData.isBoundaryWallLoopPreview = true
    group.add(line)

    runtimeObject.add(group)
    state = { nodeId: selectedNodeId, group, signature }
  }

  return {
    clear,
    ensure: (options) => attachOrRebuild({ ...options, force: false }),
    forceRebuild: (options) => attachOrRebuild({ ...options, force: true }),
  }
}