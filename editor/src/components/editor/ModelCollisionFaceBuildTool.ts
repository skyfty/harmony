import * as THREE from 'three'
import type { Ref } from 'vue'
import type { BuildTool } from '@/types/build-tool'

export type ModelCollisionFaceBuildToolSession = {
  targetNodeId: string
  points: THREE.Vector3[]
  previewEnd: THREE.Vector3 | null
  previewGroup: THREE.Group | null
  previewRoot: THREE.Object3D | null
  surfaceObject: THREE.Object3D | null
}

export type ModelCollisionFaceBuildToolHandle = {
  getSession: () => ModelCollisionFaceBuildToolSession | null
  flushPreviewIfNeeded: () => void
  handlePointerDown: (event: PointerEvent) => boolean
  handlePointerMove: (event: PointerEvent) => boolean
  handlePointerUp: (event: PointerEvent) => boolean
  handlePointerCancel: (event: PointerEvent) => boolean
  cancel: () => boolean
  dispose: () => void
}

type LeftClickState = {
  atMs: number
  clientX: number
  clientY: number
}

const DOUBLE_CLICK_MAX_INTERVAL_MS = 320
const DOUBLE_CLICK_MAX_DISTANCE_PX = 8
const PREVIEW_FILL_COLOR = 0x00d8ff
const PREVIEW_EDGE_COLOR = 0xffffff

function getNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

function disposePreviewGroup(group: THREE.Group): void {
  group.traverse((child) => {
    const drawable = child as THREE.Line | THREE.Mesh
    drawable.geometry?.dispose?.()
    const material = drawable.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose?.())
    } else {
      material?.dispose?.()
    }
  })
}

function computeFaceNormal(points: THREE.Vector3[]): THREE.Vector3 | null {
  if (points.length < 3) {
    return null
  }
  const normal = new THREE.Vector3()
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    normal.x += (current.y - next.y) * (current.z + next.z)
    normal.y += (current.z - next.z) * (current.x + next.x)
    normal.z += (current.x - next.x) * (current.y + next.y)
  }
  if (normal.lengthSq() <= 1e-10) {
    return null
  }
  return normal.normalize()
}

function buildFillGeometry(points: THREE.Vector3[]): THREE.BufferGeometry | null {
  const normal = computeFaceNormal(points)
  if (!normal) {
    return null
  }
  const seed = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
  const tangent = seed.cross(normal).normalize()
  const bitangent = normal.clone().cross(tangent).normalize()
  const origin = points.reduce((sum, entry) => sum.add(entry), new THREE.Vector3()).multiplyScalar(1 / points.length)
  const outline2D: THREE.Vector2[] = []
  const planarVertices: THREE.Vector3[] = []
  const helper = new THREE.Vector3()
  for (const point of points) {
    helper.copy(point).sub(origin)
    const u = helper.dot(tangent)
    const v = helper.dot(bitangent)
    outline2D.push(new THREE.Vector2(u, v))
    planarVertices.push(origin.clone().addScaledVector(tangent, u).addScaledVector(bitangent, v))
  }
  const triangles = THREE.ShapeUtils.triangulateShape(outline2D, [])
  if (!triangles.length) {
    return null
  }
  const positions: number[] = []
  for (const triangle of triangles) {
    if (!Array.isArray(triangle) || triangle.length !== 3) {
      continue
    }
    for (const index of triangle) {
      const point = planarVertices[index ?? -1]
      if (!point) {
        continue
      }
      positions.push(point.x, point.y, point.z)
    }
  }
  if (!positions.length) {
    return null
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

function createPreviewGroup(points: THREE.Vector3[]): THREE.Group {
  const group = new THREE.Group()
  group.name = '__ModelCollisionFacePreview'

  const lineMaterial = new THREE.LineBasicMaterial({
    color: PREVIEW_EDGE_COLOR,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  })
  const line = points.length >= 3
    ? new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), lineMaterial)
    : new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial)
  line.renderOrder = 104
  line.userData.editorOnly = true
  line.userData.pickableEditorOnly = true
  group.userData.line = line

  if (points.length >= 3) {
    const fillGeometry = buildFillGeometry(points)
    if (fillGeometry) {
      const fill = new THREE.Mesh(
        fillGeometry,
        new THREE.MeshBasicMaterial({
          color: PREVIEW_FILL_COLOR,
          transparent: true,
          opacity: 0.25,
          side: THREE.DoubleSide,
          depthWrite: false,
          depthTest: false,
        }),
      )
      fill.renderOrder = 103
      fill.userData.editorOnly = true
      fill.userData.pickableEditorOnly = true
      group.userData.fill = fill
      group.add(fill)
    }
  }

  group.userData.editorOnly = true
  group.add(line)
  return group
}

function updatePreviewGroup(group: THREE.Group, points: THREE.Vector3[]): void {
  const line = group.userData.line as THREE.Line | undefined
  if (!line) {
    return
  }
  const nextLineGeometry = new THREE.BufferGeometry().setFromPoints(points)
  const wantsLoop = points.length >= 3
  const isLoop = line instanceof THREE.LineLoop
  if (wantsLoop !== isLoop) {
    const replacement = wantsLoop
      ? new THREE.LineLoop(nextLineGeometry, line.material)
      : new THREE.Line(nextLineGeometry, line.material)
    replacement.renderOrder = 104
    replacement.userData = { ...(line.userData ?? {}), editorOnly: true, pickableEditorOnly: true }
    line.geometry?.dispose?.()
    group.remove(line)
    group.add(replacement)
    group.userData.line = replacement
  }
  line.geometry?.dispose?.()
  line.geometry = nextLineGeometry

  const fill = group.userData.fill as THREE.Mesh | undefined
  const nextFillGeometry = wantsLoop ? buildFillGeometry(points) : null
  if (!wantsLoop) {
    if (fill) {
      fill.removeFromParent()
      fill.geometry?.dispose?.()
      const fillMaterial = fill.material as THREE.Material | undefined
      fillMaterial?.dispose?.()
      delete group.userData.fill
    }
    return
  }

  if (!nextFillGeometry) {
    return
  }
  if (!fill) {
    const nextFill = new THREE.Mesh(
      nextFillGeometry,
      new THREE.MeshBasicMaterial({
        color: PREVIEW_FILL_COLOR,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      }),
    )
    nextFill.renderOrder = 103
    nextFill.userData.editorOnly = true
    nextFill.userData.pickableEditorOnly = true
    group.userData.fill = nextFill
    group.add(nextFill)
    return
  }

  fill.geometry?.dispose?.()
  fill.geometry = nextFillGeometry
}

export function createModelCollisionFaceBuildTool(options: {
  activeBuildTool: Ref<BuildTool | null>
  resolveTargetNodeId: () => string | null
  resolveTargetRuntimeObject: (nodeId: string) => THREE.Object3D | null
  resolvePlacementVertex: (event: PointerEvent, targetObject?: THREE.Object3D | null) => { point: THREE.Vector3; surfaceObject: THREE.Object3D } | null
  commitFace: (targetNodeId: string, points: THREE.Vector3[]) => boolean
  onCommitted?: (nodeId: string) => void
}): ModelCollisionFaceBuildToolHandle {
  let session: ModelCollisionFaceBuildToolSession | null = null
  let previewDirty = false
  let leftClickState: LeftClickState | null = null

  const clearSession = () => {
    if (session?.previewGroup) {
      session.previewGroup.removeFromParent()
      disposePreviewGroup(session.previewGroup)
    }
    session = null
    previewDirty = false
  }

  const ensureSession = (): ModelCollisionFaceBuildToolSession | null => {
    if (session) {
      return session
    }
    const targetNodeId = options.resolveTargetNodeId()
    if (!targetNodeId) {
      return null
    }
    const previewRoot = options.resolveTargetRuntimeObject(targetNodeId)
    if (!previewRoot) {
      return null
    }
    session = {
      targetNodeId,
      points: [],
      previewEnd: null,
      previewGroup: null,
      previewRoot,
      surfaceObject: null,
    }
    return session
  }

  const getPreviewPoints = (target: ModelCollisionFaceBuildToolSession | null): THREE.Vector3[] => {
    if (!target) {
      return []
    }
    const combined = target.points.map((point) => point.clone())
    if (target.previewEnd) {
      const last = combined[combined.length - 1] ?? null
      if (!last || last.distanceToSquared(target.previewEnd) > 1e-10) {
        combined.push(target.previewEnd.clone())
      }
    }
    return combined
  }

  const flushPreview = () => {
    previewDirty = false
    const previewPoints = getPreviewPoints(session)
    if (!session || !session.previewRoot || previewPoints.length < 2) {
      if (session?.previewGroup) {
        session.previewGroup.removeFromParent()
        disposePreviewGroup(session.previewGroup)
        session.previewGroup = null
      }
      return
    }
    if (!session.previewGroup) {
      session.previewGroup = createPreviewGroup(previewPoints)
      session.previewRoot.add(session.previewGroup)
      return
    }
    updatePreviewGroup(session.previewGroup, previewPoints)
  }

  const isLeftDoubleClick = (event: PointerEvent): boolean => {
    if (event.button !== 0) {
      return false
    }
    const now = Number.isFinite(event.timeStamp) ? Number(event.timeStamp) : getNowMs()
    const previous = leftClickState
    leftClickState = { atMs: now, clientX: event.clientX, clientY: event.clientY }
    if (!previous) {
      return false
    }
    const dt = now - previous.atMs
    if (dt < 0 || dt > DOUBLE_CLICK_MAX_INTERVAL_MS) {
      return false
    }
    return Math.hypot(event.clientX - previous.clientX, event.clientY - previous.clientY) <= DOUBLE_CLICK_MAX_DISTANCE_PX
  }

  const finalize = () => {
    if (!session || session.points.length < 3) {
      clearSession()
      return
    }
    const targetNodeId = session.targetNodeId
    const committed = options.commitFace(targetNodeId, session.points.map((point) => point.clone()))
    clearSession()
    if (committed) {
      options.onCommitted?.(targetNodeId)
    }
  }

  return {
    getSession: () => session,
    flushPreviewIfNeeded: () => {
      if (!previewDirty) {
        return
      }
      flushPreview()
    },
    handlePointerDown: (_event) => {
      if (options.activeBuildTool.value !== 'modelCollision') {
        return false
      }
      return false
    },
    handlePointerMove: (event) => {
      if (options.activeBuildTool.value !== 'modelCollision' || !session || !session.points.length) {
        return false
      }
      const hit = options.resolvePlacementVertex(event, session.surfaceObject)
      if (!hit) {
        return false
      }
      const previous = session.previewEnd
      if (previous && previous.distanceToSquared(hit.point) <= 1e-10) {
        return true
      }
      session.surfaceObject = hit.surfaceObject
      session.previewEnd = hit.point.clone()
      previewDirty = true
      return true
    },
    handlePointerUp: (event) => {
      if (options.activeBuildTool.value !== 'modelCollision') {
        return false
      }
      if (event.button !== 0) {
        return false
      }
      const target = ensureSession()
      if (!target) {
        return false
      }
      const hit = options.resolvePlacementVertex(event, target.surfaceObject)
      if (!hit) {
        return false
      }
      target.surfaceObject = hit.surfaceObject
      const last = target.points[target.points.length - 1] ?? null
      if (!last || last.distanceToSquared(hit.point) > 1e-10) {
        target.points.push(hit.point.clone())
      }
      target.previewEnd = hit.point.clone()
      previewDirty = true
      if (isLeftDoubleClick(event) && target.points.length >= 3) {
        finalize()
      }
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      return true
    },
    handlePointerCancel: (event) => {
      if (options.activeBuildTool.value !== 'modelCollision') {
        return false
      }
      if (event.button === 2 || event.type === 'pointercancel') {
        if (!session) {
          return false
        }
        clearSession()
        return true
      }
      return false
    },
    cancel: () => {
      if (!session) {
        return false
      }
      clearSession()
      return true
    },
    dispose: () => {
      clearSession()
    },
  }
}