import * as THREE from 'three'
import type { Ref } from 'vue'
import type { SceneNode, WallDynamicMesh, WallOpening, WallRepeatErasedSlot } from '@schema/index'
import { addWallOpeningToDefinition, compileWallSegmentsFromDefinition } from '@schema/wallLayout'
import { findSceneNode } from './sceneUtils'

export type WallDoorRectangleSelectionState = {
  pointerId: number
  startClientX: number
  startClientY: number
  currentClientX: number
  currentClientY: number
  moved: boolean
}

export type WallDoorRectangleClientBounds = {
  left: number
  top: number
  right: number
  bottom: number
}

type WallDoorStretchSelectionEntry = { kind: 'stretch'; nodeId: string; intervals: WallOpening[] }
type WallDoorRepeatSelectionEntry = { kind: 'repeatInstances'; nodeId: string; slots: WallRepeatErasedSlot[] }
export type WallDoorSelectionEntry = WallDoorStretchSelectionEntry | WallDoorRepeatSelectionEntry
export type WallDoorSelectionPayload = WallDoorSelectionEntry[]

type CreateWallDoorSelectionControllerOptions = {
  objectMap: Map<string, THREE.Object3D>
  getSceneNodes: () => SceneNode[]
  getCamera: () => THREE.Camera | null
  canvasRef: Ref<HTMLCanvasElement | null>
  surfaceRef: Ref<HTMLElement | null>
  isObjectWorldVisible: (object: THREE.Object3D) => boolean
  resolveSelectedWallRenderMode: (node: SceneNode) => 'stretch' | 'repeatInstances'
  extractWallRepeatInstanceMeta: (mesh: THREE.Mesh | null | undefined) => { chainIndex: number; slotIndex: number } | null
  mergeWallRepeatErasedSlots: (
    existing: Array<{ chainIndex?: unknown; slotIndex?: unknown }> | undefined,
    additions: WallRepeatErasedSlot[],
  ) => WallRepeatErasedSlot[]
  setBoundingBoxFromObject: (object: THREE.Object3D, target: THREE.Box3) => THREE.Box3
  applyWallMeshEraseResult: (node: SceneNode, nodeId: string, nextWallMesh: WallDynamicMesh) => void
}

export function createWallDoorSelectionController(options: CreateWallDoorSelectionControllerOptions) {
  const wallDoorSelectionHighlightGroup = new THREE.Group()
  wallDoorSelectionHighlightGroup.name = 'WallDoorSelectionHighlightGroup'
  wallDoorSelectionHighlightGroup.visible = false
  wallDoorSelectionHighlightGroup.renderOrder = 1200

  const wallDoorSelectionStretchLineMaterial = new THREE.LineBasicMaterial({
    color: 0xffc107,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  })
  wallDoorSelectionStretchLineMaterial.toneMapped = false

  const wallDoorSelectionRepeatFillMaterial = new THREE.MeshBasicMaterial({
    color: 0xffc107,
    transparent: true,
    opacity: 0.3,
    depthTest: false,
    depthWrite: false,
  })
  wallDoorSelectionRepeatFillMaterial.toneMapped = false

  const wallDoorSelectionRepeatWireMaterial = new THREE.MeshBasicMaterial({
    color: 0xffc107,
    wireframe: true,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
  })
  wallDoorSelectionRepeatWireMaterial.toneMapped = false

  function clearWallDoorSelectionHighlight(): void {
    while (wallDoorSelectionHighlightGroup.children.length > 0) {
      const child = wallDoorSelectionHighlightGroup.children[wallDoorSelectionHighlightGroup.children.length - 1]
      if (!child) {
        break
      }
      const line = child as THREE.Line
      if (line?.isLine) {
        line.geometry?.dispose?.()
      }
      child.removeFromParent()
    }
    wallDoorSelectionHighlightGroup.visible = false
  }

  function computeWallDoorRectangleBounds(state: WallDoorRectangleSelectionState): WallDoorRectangleClientBounds {
    const left = Math.min(state.startClientX, state.currentClientX)
    const right = Math.max(state.startClientX, state.currentClientX)
    const top = Math.min(state.startClientY, state.currentClientY)
    const bottom = Math.max(state.startClientY, state.currentClientY)
    return { left, right, top, bottom }
  }

  function updateWallDoorSelectionOverlayBox(
    state: WallDoorRectangleSelectionState,
    wallDoorSelectionOverlayBox: Ref<{ left: number; top: number; width: number; height: number } | null>,
  ): void {
    const surface = options.surfaceRef.value
    if (!surface) {
      wallDoorSelectionOverlayBox.value = null
      return
    }
    const bounds = computeWallDoorRectangleBounds(state)
    const rect = surface.getBoundingClientRect()
    wallDoorSelectionOverlayBox.value = {
      left: bounds.left - rect.left,
      top: bounds.top - rect.top,
      width: Math.max(0, bounds.right - bounds.left),
      height: Math.max(0, bounds.bottom - bounds.top),
    }
  }

  function projectWorldToClientPoint(worldPoint: THREE.Vector3): THREE.Vector2 | null {
    const camera = options.getCamera()
    const canvas = options.canvasRef.value
    if (!camera || !canvas) {
      return null
    }
    const projected = worldPoint.clone().project(camera)
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !Number.isFinite(projected.z)) {
      return null
    }
    const rect = canvas.getBoundingClientRect()
    return new THREE.Vector2(
      rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
    )
  }

  function clipSegmentToRect(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    rect: WallDoorRectangleClientBounds,
  ): [number, number] | null {
    const dx = bx - ax
    const dy = by - ay
    let t0 = 0
    let t1 = 1

    const clip = (p: number, q: number): boolean => {
      if (Math.abs(p) < 1e-9) {
        return q >= 0
      }
      const t = q / p
      if (p < 0) {
        if (t > t1) return false
        if (t > t0) t0 = t
      } else {
        if (t < t0) return false
        if (t < t1) t1 = t
      }
      return true
    }

    if (!clip(-dx, ax - rect.left)) return null
    if (!clip(dx, rect.right - ax)) return null
    if (!clip(-dy, ay - rect.top)) return null
    if (!clip(dy, rect.bottom - ay)) return null
    if (t1 < t0) return null
    return [t0, t1]
  }

  function mergeWallOpeningIntervals(intervals: WallOpening[]): WallOpening[] {
    const byChain = new Map<number, WallOpening[]>()
    intervals.forEach((entry) => {
      const chainIndex = Math.max(0, Math.trunc(Number(entry.chainIndex ?? 0)))
      const start = Number(entry.start)
      const end = Number(entry.end)
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start <= 1e-6) {
        return
      }
      const bucket = byChain.get(chainIndex) ?? []
      if (!byChain.has(chainIndex)) {
        byChain.set(chainIndex, bucket)
      }
      bucket.push({ chainIndex, start: Math.min(start, end), end: Math.max(start, end) })
    })

    const merged: WallOpening[] = []
    byChain.forEach((bucket, chainIndex) => {
      bucket.sort((a, b) => a.start - b.start)
      let current: WallOpening | null = null
      bucket.forEach((entry) => {
        if (!current) {
          current = { ...entry, chainIndex }
          return
        }
        if (entry.start <= current.end + 1e-6) {
          current.end = Math.max(current.end, entry.end)
        } else {
          merged.push(current)
          current = { ...entry, chainIndex }
        }
      })
      if (current) {
        merged.push(current)
      }
    })

    return merged
  }

  function collectWallDoorStretchIntervals(
    wallNode: SceneNode,
    wallObject: THREE.Object3D,
    rect: WallDoorRectangleClientBounds,
  ): WallOpening[] {
    const wallMesh = wallNode.dynamicMesh as WallDynamicMesh
    const segments = compileWallSegmentsFromDefinition(wallMesh)
    if (!segments.length) {
      return []
    }

    const startWorld = new THREE.Vector3()
    const endWorld = new THREE.Vector3()
    const intervals: WallOpening[] = []

    segments.forEach((seg) => {
      startWorld.set(seg.start.x, seg.start.y, seg.start.z)
      endWorld.set(seg.end.x, seg.end.y, seg.end.z)
      wallObject.localToWorld(startWorld)
      wallObject.localToWorld(endWorld)
      const startClient = projectWorldToClientPoint(startWorld)
      const endClient = projectWorldToClientPoint(endWorld)
      if (!startClient || !endClient) {
        return
      }
      const clipped = clipSegmentToRect(startClient.x, startClient.y, endClient.x, endClient.y, rect)
      if (!clipped) {
        return
      }
      const [t0, t1] = clipped
      if (t1 - t0 <= 1e-6) {
        return
      }
      const chainIndex = Math.max(0, Math.trunc(Number(seg.chainIndex ?? 0)))
      const segStart = Number(seg.chainArcStart ?? 0)
      const segLengthXZ = Math.hypot(seg.end.x - seg.start.x, seg.end.z - seg.start.z)
      const segEnd = segStart + segLengthXZ
      const segLen = Math.max(0, segEnd - segStart)
      if (segLen <= 1e-6) {
        return
      }
      intervals.push({
        chainIndex,
        start: segStart + segLen * Math.max(0, Math.min(1, t0)),
        end: segStart + segLen * Math.max(0, Math.min(1, t1)),
      })
    })

    return mergeWallOpeningIntervals(intervals)
  }

  function collectWallDoorRepeatSlots(
    wallObject: THREE.Object3D,
    rect: WallDoorRectangleClientBounds,
  ): WallRepeatErasedSlot[] {
    const slots = new Set<string>()
    const box = new THREE.Box3()
    const corner = new THREE.Vector3()

    wallObject.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh?.isMesh) {
        return
      }
      const meta = options.extractWallRepeatInstanceMeta(mesh)
      if (!meta) {
        return
      }
      const { chainIndex, slotIndex } = meta

      options.setBoundingBoxFromObject(mesh, box)
      if (box.isEmpty()) {
        return
      }

      const corners: [number, number, number][] = [
        [box.min.x, box.min.y, box.min.z],
        [box.min.x, box.min.y, box.max.z],
        [box.min.x, box.max.y, box.min.z],
        [box.min.x, box.max.y, box.max.z],
        [box.max.x, box.min.y, box.min.z],
        [box.max.x, box.min.y, box.max.z],
        [box.max.x, box.max.y, box.min.z],
        [box.max.x, box.max.y, box.max.z],
      ]

      let minX = Number.POSITIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      let hasProjected = false

      corners.forEach(([x, y, z]) => {
        corner.set(x, y, z)
        const projected = projectWorldToClientPoint(corner)
        if (!projected) {
          return
        }
        hasProjected = true
        minX = Math.min(minX, projected.x)
        minY = Math.min(minY, projected.y)
        maxX = Math.max(maxX, projected.x)
        maxY = Math.max(maxY, projected.y)
      })

      if (!hasProjected) {
        return
      }

      const intersects = !(maxX < rect.left || minX > rect.right || maxY < rect.top || minY > rect.bottom)
      if (intersects) {
        slots.add(`${chainIndex}:${slotIndex}`)
      }
    })

    return Array.from(slots.values())
      .map((key) => {
        const [chainRaw, slotRaw] = key.split(':')
        const chainIndex = Math.max(0, Math.trunc(Number(chainRaw ?? 0)))
        const slotIndex = Math.max(0, Math.trunc(Number(slotRaw ?? -1)))
        return { chainIndex, slotIndex }
      })
      .filter((entry) => Number.isFinite(entry.chainIndex) && Number.isFinite(entry.slotIndex) && entry.slotIndex >= 0)
      .sort((a, b) => (a.chainIndex - b.chainIndex) || (a.slotIndex - b.slotIndex))
  }

  function rebuildWallDoorSelectionHighlight(payload: WallDoorSelectionPayload | null): void {
    clearWallDoorSelectionHighlight()

    if (!payload?.length) {
      return
    }

    payload.forEach((entry) => {
      const node = findSceneNode(options.getSceneNodes(), entry.nodeId)
      const wallObject = options.objectMap.get(entry.nodeId) ?? null
      if (!node || node.dynamicMesh?.type !== 'Wall' || !wallObject) {
        return
      }

      if (entry.kind === 'stretch') {
        const wallMesh = node.dynamicMesh as WallDynamicMesh
        const segments = compileWallSegmentsFromDefinition(wallMesh)
        if (!segments.length || !entry.intervals.length) {
          return
        }

        const values: number[] = []
        const startWorld = new THREE.Vector3()
        const endWorld = new THREE.Vector3()

        entry.intervals.forEach((interval) => {
          const intervalStart = Math.min(Number(interval.start), Number(interval.end))
          const intervalEnd = Math.max(Number(interval.start), Number(interval.end))
          if (!Number.isFinite(intervalStart) || !Number.isFinite(intervalEnd) || intervalEnd - intervalStart <= 1e-6) {
            return
          }
          const chainIndex = Math.max(0, Math.trunc(Number(interval.chainIndex ?? 0)))
          segments.forEach((seg) => {
            const segChainIndex = Math.max(0, Math.trunc(Number(seg.chainIndex ?? 0)))
            if (segChainIndex !== chainIndex) {
              return
            }
            const segStart = Number(seg.chainArcStart ?? 0)
            const segLengthXZ = Math.hypot(seg.end.x - seg.start.x, seg.end.z - seg.start.z)
            const segEnd = segStart + segLengthXZ
            const segLength = Math.max(0, segEnd - segStart)
            if (!Number.isFinite(segStart) || !Number.isFinite(segEnd) || segLength <= 1e-6) {
              return
            }
            const overlapStart = Math.max(intervalStart, segStart)
            const overlapEnd = Math.min(intervalEnd, segEnd)
            if (overlapEnd - overlapStart <= 1e-6) {
              return
            }
            const t0 = Math.max(0, Math.min(1, (overlapStart - segStart) / segLength))
            const t1 = Math.max(0, Math.min(1, (overlapEnd - segStart) / segLength))
            startWorld.set(
              seg.start.x + (seg.end.x - seg.start.x) * t0,
              seg.start.y + (seg.end.y - seg.start.y) * t0,
              seg.start.z + (seg.end.z - seg.start.z) * t0,
            )
            endWorld.set(
              seg.start.x + (seg.end.x - seg.start.x) * t1,
              seg.start.y + (seg.end.y - seg.start.y) * t1,
              seg.start.z + (seg.end.z - seg.start.z) * t1,
            )
            wallObject.localToWorld(startWorld)
            wallObject.localToWorld(endWorld)
            values.push(
              startWorld.x, startWorld.y, startWorld.z,
              endWorld.x, endWorld.y, endWorld.z,
            )
          })
        })

        if (!values.length) {
          return
        }

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3))
        const lines = new THREE.LineSegments(geometry, wallDoorSelectionStretchLineMaterial)
        lines.frustumCulled = false
        lines.renderOrder = 1200
        wallDoorSelectionHighlightGroup.add(lines)
        return
      }

      const slotSet = new Set<string>()
      entry.slots.forEach((slot) => {
        const chainIndex = Math.max(0, Math.trunc(Number(slot.chainIndex ?? 0)))
        const slotIndex = Math.max(0, Math.trunc(Number(slot.slotIndex ?? -1)))
        if (Number.isFinite(chainIndex) && Number.isFinite(slotIndex) && slotIndex >= 0) {
          slotSet.add(`${chainIndex}:${slotIndex}`)
        }
      })
      if (!slotSet.size) {
        return
      }

      wallObject.updateWorldMatrix(true, true)
      wallObject.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh?.isMesh) {
          return
        }
        const meta = mesh.userData?.wallInstanceMeta as { chainIndex?: unknown; repeatSlotIndex?: unknown } | undefined
        if (!meta) {
          return
        }
        const chainIndex = Math.max(0, Math.trunc(Number(meta.chainIndex ?? 0)))
        const slotIndex = Math.max(0, Math.trunc(Number(meta.repeatSlotIndex ?? -1)))
        if (!Number.isFinite(chainIndex) || !Number.isFinite(slotIndex) || slotIndex < 0) {
          return
        }
        if (!slotSet.has(`${chainIndex}:${slotIndex}`)) {
          return
        }

        const fillProxy = new THREE.Mesh(mesh.geometry, wallDoorSelectionRepeatFillMaterial)
        fillProxy.matrixAutoUpdate = false
        fillProxy.matrix.copy(mesh.matrixWorld)
        fillProxy.renderOrder = 1199
        fillProxy.frustumCulled = false
        wallDoorSelectionHighlightGroup.add(fillProxy)

        const wireProxy = new THREE.Mesh(mesh.geometry, wallDoorSelectionRepeatWireMaterial)
        wireProxy.matrixAutoUpdate = false
        wireProxy.matrix.copy(mesh.matrixWorld)
        wireProxy.renderOrder = 1200
        wireProxy.frustumCulled = false
        wallDoorSelectionHighlightGroup.add(wireProxy)
      })
    })

    wallDoorSelectionHighlightGroup.visible = wallDoorSelectionHighlightGroup.children.length > 0
  }

  function buildWallDoorSelectionPayloadFromRect(rect: WallDoorRectangleClientBounds): WallDoorSelectionPayload | null {
    const entries: WallDoorSelectionEntry[] = []
    for (const [nodeId, wallObject] of options.objectMap.entries()) {
      if (!options.isObjectWorldVisible(wallObject)) {
        continue
      }
      const node = findSceneNode(options.getSceneNodes(), nodeId)
      if (!node || node.dynamicMesh?.type !== 'Wall') {
        continue
      }

      const mode = options.resolveSelectedWallRenderMode(node)
      if (mode === 'repeatInstances') {
        const slots = collectWallDoorRepeatSlots(wallObject, rect)
        if (slots.length) {
          entries.push({ kind: 'repeatInstances', nodeId, slots })
        }
        continue
      }

      const intervals = collectWallDoorStretchIntervals(node, wallObject, rect)
      if (intervals.length) {
        entries.push({ kind: 'stretch', nodeId, intervals })
      }
    }

    return entries.length ? entries : null
  }

  function applyWallDoorSelectionDelete(payload: WallDoorSelectionPayload | null): boolean {
    if (!payload?.length) {
      return false
    }

    let applied = false
    payload.forEach((entry) => {
      const node = findSceneNode(options.getSceneNodes(), entry.nodeId)
      if (!node || node.dynamicMesh?.type !== 'Wall') {
        return
      }

      const wallMesh = node.dynamicMesh as WallDynamicMesh
      if (entry.kind === 'stretch') {
        let nextOpenings = Array.isArray(wallMesh.openings) ? wallMesh.openings : []
        entry.intervals.forEach((interval) => {
          nextOpenings = addWallOpeningToDefinition({ ...wallMesh, openings: nextOpenings }, interval)
        })
        options.applyWallMeshEraseResult(node, entry.nodeId, { ...wallMesh, openings: nextOpenings })
        applied = true
        return
      }

      const repeatErasedSlots = options.mergeWallRepeatErasedSlots(
        (wallMesh as unknown as { repeatErasedSlots?: Array<{ chainIndex?: unknown; slotIndex?: unknown }> }).repeatErasedSlots,
        entry.slots,
      )
      options.applyWallMeshEraseResult(node, entry.nodeId, { ...wallMesh, repeatErasedSlots })
      applied = true
    })

    return applied
  }

  function dispose(): void {
    clearWallDoorSelectionHighlight()
    wallDoorSelectionHighlightGroup.removeFromParent()
    wallDoorSelectionStretchLineMaterial.dispose()
    wallDoorSelectionRepeatFillMaterial.dispose()
    wallDoorSelectionRepeatWireMaterial.dispose()
  }

  return {
    wallDoorSelectionHighlightGroup,
    clearWallDoorSelectionHighlight,
    computeWallDoorRectangleBounds,
    updateWallDoorSelectionOverlayBox,
    rebuildWallDoorSelectionHighlight,
    buildWallDoorSelectionPayloadFromRect,
    applyWallDoorSelectionDelete,
    dispose,
  }
}
