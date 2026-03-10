import * as THREE from 'three'
import type { Ref } from 'vue'
import type { BuildTool } from '@/types/build-tool'
import type { useSceneStore } from '@/stores/sceneStore'

const MIN_EDGE_LENGTH = 1e-3
const MIN_RECT_SIZE = 1e-3
const SNAP_OFFSET_EPSILON = 1e-4
const HELPER_NORMAL_SCALE = 0.3
const HELPER_AXIS_SCALE = 0.35
const HELPER_MIN_AXIS_LENGTH = 0.08
const HELPER_CORNER_MARKER_RADIUS = 0.022

type PlanarPoint = { x: number; y: number }

export type DisplayBoardBuildSurface = {
  point: THREE.Vector3
  normal: THREE.Vector3
  nodeId: string | null
}

export type DisplayBoardVertexSnap = {
  sourceWorld: THREE.Vector3
  targetWorld: THREE.Vector3
}

export type DisplayBoardBuildToolHandle = {
  getSession: () => DisplayBoardBuildSession | null
  handlePointerDown: (event: PointerEvent) => boolean
  handlePointerMove: (event: PointerEvent) => boolean
  handlePointerUp: (event: PointerEvent) => boolean
  handlePointerCancel: (event: PointerEvent) => boolean
  handleDoubleClick: (event: MouseEvent) => boolean
  cancel: () => boolean
  dispose: () => void
}

export type DisplayBoardBuildSession = {
  pointerId: number
  plane: THREE.Plane
  origin: THREE.Vector3
  normal: THREE.Vector3
  axisU: THREE.Vector3
  axisV: THREE.Vector3
  points: THREE.Vector3[]
  currentPoint: THREE.Vector3
  previewRoot: THREE.Group
  previewMesh: THREE.Mesh
  previewMaterial: THREE.MeshBasicMaterial
  previewOutline: THREE.LineSegments
  previewOutlineMaterial: THREE.LineBasicMaterial
  previewPolygonLines: THREE.LineSegments
  previewPolygonLineMaterial: THREE.LineBasicMaterial
  previewPolygonGeometry: THREE.BufferGeometry
  previewHelperLines: THREE.LineSegments
  previewHelperLineMaterial: THREE.LineBasicMaterial
  previewHelperGeometry: THREE.BufferGeometry
  previewCornerMarkers: [THREE.Mesh, THREE.Mesh, THREE.Mesh, THREE.Mesh]
  previewCornerMarkerGeometry: THREE.SphereGeometry
  previewCornerMarkerMaterials: [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial, THREE.MeshBasicMaterial, THREE.MeshBasicMaterial]
  width: number
  height: number
  previewCenter: THREE.Vector3
  previewQuaternion: THREE.Quaternion
  previewCorners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]
}

type FittedRectangle = {
  centerWorld: THREE.Vector3
  axisXWorld: THREE.Vector3
  axisYWorld: THREE.Vector3
  quaternion: THREE.Quaternion
  width: number
  height: number
  cornersWorld: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]
}

const previewHelperCenter = new THREE.Vector3()
const previewHelperAxisU = new THREE.Vector3()
const previewHelperAxisV = new THREE.Vector3()
const previewHelperNormalTip = new THREE.Vector3()
const tmpMatrix = new THREE.Matrix4()

function choosePlaneAxes(normal: THREE.Vector3, cameraDirection: THREE.Vector3): { axisU: THREE.Vector3; axisV: THREE.Vector3 } {
  const axisU = new THREE.Vector3().crossVectors(normal, cameraDirection)
  if (axisU.lengthSq() <= 1e-8) {
    axisU.crossVectors(normal, Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0))
  }
  axisU.normalize()
  const axisV = new THREE.Vector3().crossVectors(normal, axisU).normalize()
  return { axisU, axisV }
}

function cross2D(a: PlanarPoint, b: PlanarPoint, c: PlanarPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function distance2D(a: PlanarPoint, b: PlanarPoint): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function dedupePlanarPoints(points: PlanarPoint[], epsilon = 1e-6): PlanarPoint[] {
  const result: PlanarPoint[] = []
  for (const point of points) {
    const prev = result[result.length - 1]
    if (prev && distance2D(prev, point) <= epsilon) {
      continue
    }
    result.push(point)
  }
  if (result.length >= 2) {
    const first = result[0]!
    const last = result[result.length - 1]!
    if (distance2D(first, last) <= epsilon) {
      result.pop()
    }
  }
  return result
}

function buildConvexHull(points: PlanarPoint[]): PlanarPoint[] {
  const unique = dedupePlanarPoints(
    [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x)),
  )
  if (unique.length <= 2) {
    return unique
  }

  const lower: PlanarPoint[] = []
  for (const point of unique) {
    while (lower.length >= 2 && cross2D(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) {
      lower.pop()
    }
    lower.push(point)
  }

  const upper: PlanarPoint[] = []
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index]!
    while (upper.length >= 2 && cross2D(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) {
      upper.pop()
    }
    upper.push(point)
  }

  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

function fitMinimumAreaRectangle(points: PlanarPoint[]): {
  center: PlanarPoint
  axisX: PlanarPoint
  axisY: PlanarPoint
  width: number
  height: number
} | null {
  const hull = buildConvexHull(points)
  if (hull.length < 2) {
    return null
  }

  let best: {
    area: number
    center: PlanarPoint
    axisX: PlanarPoint
    axisY: PlanarPoint
    width: number
    height: number
  } | null = null

  const hullCount = hull.length
  for (let index = 0; index < hullCount; index += 1) {
    const a = hull[index]!
    const b = hull[(index + 1) % hullCount]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.sqrt(dx * dx + dy * dy)
    if (length <= 1e-8) {
      continue
    }

    const axisX = { x: dx / length, y: dy / length }
    const axisY = { x: -axisX.y, y: axisX.x }

    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const point of hull) {
      const px = point.x * axisX.x + point.y * axisX.y
      const py = point.x * axisY.x + point.y * axisY.y
      minX = Math.min(minX, px)
      maxX = Math.max(maxX, px)
      minY = Math.min(minY, py)
      maxY = Math.max(maxY, py)
    }

    const width = maxX - minX
    const height = maxY - minY
    const area = width * height
    if (best && area >= best.area - 1e-8) {
      continue
    }

    best = {
      area,
      center: {
        x: axisX.x * ((minX + maxX) * 0.5) + axisY.x * ((minY + maxY) * 0.5),
        y: axisX.y * ((minX + maxX) * 0.5) + axisY.y * ((minY + maxY) * 0.5),
      },
      axisX,
      axisY,
      width,
      height,
    }
  }

  if (!best) {
    return null
  }

  return {
    center: best.center,
    axisX: best.axisX,
    axisY: best.axisY,
    width: Math.max(best.width, MIN_RECT_SIZE),
    height: Math.max(best.height, MIN_RECT_SIZE),
  }
}

function fitRectangleForWorldPoints(session: DisplayBoardBuildSession, pointsWorld: THREE.Vector3[]): FittedRectangle | null {
  if (pointsWorld.length < 3) {
    return null
  }

  const planarPoints = dedupePlanarPoints(
    pointsWorld.map((point) => {
      const offset = point.clone().sub(session.origin)
      return {
        x: offset.dot(session.axisU),
        y: offset.dot(session.axisV),
      }
    }),
  )
  if (planarPoints.length < 3) {
    return null
  }

  const rect = fitMinimumAreaRectangle(planarPoints)
  if (!rect) {
    return null
  }

  const axisXWorld = new THREE.Vector3()
    .addScaledVector(session.axisU, rect.axisX.x)
    .addScaledVector(session.axisV, rect.axisX.y)
    .normalize()
  const axisYWorld = new THREE.Vector3()
    .addScaledVector(session.axisU, rect.axisY.x)
    .addScaledVector(session.axisV, rect.axisY.y)
    .normalize()
  const centerWorld = session.origin.clone()
    .addScaledVector(session.axisU, rect.center.x)
    .addScaledVector(session.axisV, rect.center.y)

  tmpMatrix.makeBasis(axisXWorld, axisYWorld, session.normal)
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(tmpMatrix)

  const halfWidth = rect.width * 0.5
  const halfHeight = rect.height * 0.5
  const cornersWorld: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
    centerWorld.clone().addScaledVector(axisXWorld, -halfWidth).addScaledVector(axisYWorld, -halfHeight),
    centerWorld.clone().addScaledVector(axisXWorld, halfWidth).addScaledVector(axisYWorld, -halfHeight),
    centerWorld.clone().addScaledVector(axisXWorld, halfWidth).addScaledVector(axisYWorld, halfHeight),
    centerWorld.clone().addScaledVector(axisXWorld, -halfWidth).addScaledVector(axisYWorld, halfHeight),
  ]

  return {
    centerWorld,
    axisXWorld,
    axisYWorld,
    quaternion,
    width: rect.width,
    height: rect.height,
    cornersWorld,
  }
}

function setLineSegmentsGeometry(
  geometry: THREE.BufferGeometry,
  points: THREE.Vector3[],
  color: [number, number, number],
): void {
  if (points.length < 2) {
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3))
    return
  }

  const segmentCount = Math.floor(points.length / 2)
  const positions = new Float32Array(segmentCount * 6)
  const colors = new Float32Array(segmentCount * 6)
  for (let index = 0; index < segmentCount; index += 1) {
    const a = points[index * 2]!
    const b = points[index * 2 + 1]!
    const offset = index * 6
    positions[offset] = a.x
    positions[offset + 1] = a.y
    positions[offset + 2] = a.z
    positions[offset + 3] = b.x
    positions[offset + 4] = b.y
    positions[offset + 5] = b.z
    colors[offset] = color[0]
    colors[offset + 1] = color[1]
    colors[offset + 2] = color[2]
    colors[offset + 3] = color[0]
    colors[offset + 4] = color[1]
    colors[offset + 5] = color[2]
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeBoundingSphere()
}

function updateHelperVisuals(session: DisplayBoardBuildSession, rectangle: FittedRectangle | null): void {
  if (!rectangle) {
    setLineSegmentsGeometry(session.previewHelperGeometry, [], [1, 1, 1])
    session.previewCornerMarkers.forEach((marker) => {
      marker.visible = false
    })
    return
  }

  const axisULength = Math.max(HELPER_MIN_AXIS_LENGTH, rectangle.width * HELPER_AXIS_SCALE)
  const axisVLength = Math.max(HELPER_MIN_AXIS_LENGTH, rectangle.height * HELPER_AXIS_SCALE)
  const normalLength = Math.max(HELPER_MIN_AXIS_LENGTH, Math.max(rectangle.width, rectangle.height) * HELPER_NORMAL_SCALE)

  previewHelperCenter.copy(rectangle.centerWorld)
  previewHelperAxisU.copy(rectangle.centerWorld).addScaledVector(rectangle.axisXWorld, axisULength)
  previewHelperAxisV.copy(rectangle.centerWorld).addScaledVector(rectangle.axisYWorld, axisVLength)
  previewHelperNormalTip.copy(rectangle.centerWorld).addScaledVector(session.normal, normalLength)

  const positions = new Float32Array([
    previewHelperCenter.x, previewHelperCenter.y, previewHelperCenter.z,
    previewHelperAxisU.x, previewHelperAxisU.y, previewHelperAxisU.z,
    previewHelperCenter.x, previewHelperCenter.y, previewHelperCenter.z,
    previewHelperAxisV.x, previewHelperAxisV.y, previewHelperAxisV.z,
    previewHelperCenter.x, previewHelperCenter.y, previewHelperCenter.z,
    previewHelperNormalTip.x, previewHelperNormalTip.y, previewHelperNormalTip.z,
  ])
  const colors = new Float32Array([
    1.0, 0.72, 0.23,
    1.0, 0.72, 0.23,
    0.34, 0.89, 0.58,
    0.34, 0.89, 0.58,
    0.51, 0.83, 0.98,
    0.51, 0.83, 0.98,
  ])

  session.previewHelperGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  session.previewHelperGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  session.previewHelperGeometry.computeBoundingSphere()

  session.previewCornerMarkers.forEach((marker, index) => {
    marker.visible = true
    marker.position.copy(rectangle.cornersWorld[index]!)
  })
}

function updatePolygonVisuals(session: DisplayBoardBuildSession, points: THREE.Vector3[]): void {
  const linePoints: THREE.Vector3[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    linePoints.push(points[index]!, points[index + 1]!)
  }
  if (points.length >= 3) {
    linePoints.push(points[points.length - 1]!, points[0]!)
  }
  setLineSegmentsGeometry(session.previewPolygonGeometry, linePoints, [0.51, 0.83, 0.98])
}

function updateRectPreview(session: DisplayBoardBuildSession, rectangle: FittedRectangle | null): void {
  if (!rectangle) {
    session.previewRoot.visible = false
    session.width = 0
    session.height = 0
    updateHelperVisuals(session, null)
    return
  }

  session.previewRoot.visible = true
  session.previewRoot.position.copy(rectangle.centerWorld)
  session.previewRoot.quaternion.copy(rectangle.quaternion)
  session.previewRoot.scale.set(rectangle.width, rectangle.height, 1)
  session.previewCenter.copy(rectangle.centerWorld)
  session.previewQuaternion.copy(rectangle.quaternion)
  session.width = rectangle.width
  session.height = rectangle.height
  rectangle.cornersWorld.forEach((corner, index) => {
    const targetCorner = session.previewCorners[index]
    if (targetCorner) {
      targetCorner.copy(corner)
    }
  })
  updateHelperVisuals(session, rectangle)
}

function resolveDraftPoints(session: DisplayBoardBuildSession): THREE.Vector3[] {
  const points = session.points.map((point) => point.clone())
  const last = points[points.length - 1] ?? null
  if (!last || last.distanceTo(session.currentPoint) > MIN_EDGE_LENGTH) {
    points.push(session.currentPoint.clone())
  }
  return points
}

function refreshPreview(session: DisplayBoardBuildSession): void {
  const draftPoints = resolveDraftPoints(session)
  updatePolygonVisuals(session, draftPoints)
  const rectangle = fitRectangleForWorldPoints(session, draftPoints)
  updateRectPreview(session, rectangle)
}

function createPreviewRoot(): THREE.Group {
  const group = new THREE.Group()
  group.visible = false
  group.name = 'DisplayBoardBuildPreview'
  return group
}

function resolvePlacementPoint(
  event: PointerEvent | MouseEvent,
  options: Parameters<typeof createDisplayBoardBuildTool>[0],
  session: DisplayBoardBuildSession | null,
): THREE.Vector3 | null {
  if (!session) {
    const surface = options.resolveSurfaceAtPointer(event as PointerEvent)
    if (!surface) {
      return null
    }
    return surface.point.clone()
  }
  return options.projectPointerToPlane(event as PointerEvent, session.plane)?.clone() ?? null
}

export function createDisplayBoardBuildTool(options: {
  activeBuildTool: Ref<BuildTool | null>
  sceneStore: ReturnType<typeof useSceneStore>
  rootGroup: THREE.Group
  isAltOverrideActive: () => boolean
  resolveSurfaceAtPointer: (event: PointerEvent) => DisplayBoardBuildSurface | null
  projectPointerToPlane: (event: PointerEvent, plane: THREE.Plane) => THREE.Vector3 | null
  getCameraDirection: () => THREE.Vector3
  resolveVertexSnapAtPointer: (event: PointerEvent, sourceWorld: THREE.Vector3, activeNormal: THREE.Vector3) => DisplayBoardVertexSnap | null
  updatePlacementSnap: (event: PointerEvent, previewObject: THREE.Object3D) => THREE.Vector3 | null
  clearPlacementSnap: () => void
  showVertexSnap: (snap: DisplayBoardVertexSnap | null) => void
  createDisplayBoardNode: (payload: {
    center: THREE.Vector3
    rotation: THREE.Vector3
    scale: THREE.Vector3
  }) => unknown
}): DisplayBoardBuildToolHandle {
  let session: DisplayBoardBuildSession | null = null

  const clearSession = () => {
    if (session) {
      options.clearPlacementSnap()
      options.showVertexSnap(null)
      session.previewRoot.removeFromParent()
      session.previewPolygonLines.removeFromParent()
      session.previewHelperLines.removeFromParent()
      session.previewCornerMarkers.forEach((marker) => marker.removeFromParent())
      session.previewMesh.geometry.dispose()
      session.previewMaterial.dispose()
      session.previewOutline.geometry.dispose()
      session.previewOutlineMaterial.dispose()
      session.previewPolygonGeometry.dispose()
      session.previewPolygonLineMaterial.dispose()
      session.previewHelperGeometry.dispose()
      session.previewHelperLineMaterial.dispose()
      session.previewCornerMarkerGeometry.dispose()
      session.previewCornerMarkerMaterials.forEach((material) => material.dispose())
    }
    session = null
  }

  const beginSession = (event: PointerEvent, surface: DisplayBoardBuildSurface, startPoint: THREE.Vector3) => {
    const previewMaterial = new THREE.MeshBasicMaterial({
      color: 0x42a5f5,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const previewMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), previewMaterial)
    const previewOutlineMaterial = new THREE.LineBasicMaterial({
      color: 0x81d4fa,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    })
    const previewOutline = new THREE.LineSegments(new THREE.EdgesGeometry(previewMesh.geometry), previewOutlineMaterial)
    const previewPolygonGeometry = new THREE.BufferGeometry()
    const previewPolygonLineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
    })
    const previewPolygonLines = new THREE.LineSegments(previewPolygonGeometry, previewPolygonLineMaterial)
    previewPolygonLines.renderOrder = 102

    const previewHelperGeometry = new THREE.BufferGeometry()
    const previewHelperLineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    })
    const previewHelperLines = new THREE.LineSegments(previewHelperGeometry, previewHelperLineMaterial)
    previewHelperLines.renderOrder = 103

    const previewCornerMarkerGeometry = new THREE.SphereGeometry(HELPER_CORNER_MARKER_RADIUS, 10, 10)
    const previewCornerMarkerMaterials: [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial, THREE.MeshBasicMaterial, THREE.MeshBasicMaterial] = [
      new THREE.MeshBasicMaterial({ color: 0xffc107, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: 0x4dd0e1, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false }),
    ]
    const previewCornerMarkers: [THREE.Mesh, THREE.Mesh, THREE.Mesh, THREE.Mesh] = [
      new THREE.Mesh(previewCornerMarkerGeometry, previewCornerMarkerMaterials[0]),
      new THREE.Mesh(previewCornerMarkerGeometry, previewCornerMarkerMaterials[1]),
      new THREE.Mesh(previewCornerMarkerGeometry, previewCornerMarkerMaterials[2]),
      new THREE.Mesh(previewCornerMarkerGeometry, previewCornerMarkerMaterials[3]),
    ]
    previewCornerMarkers.forEach((marker) => {
      marker.renderOrder = 104
      marker.visible = false
      options.rootGroup.add(marker)
    })

    previewMesh.renderOrder = 100
    previewOutline.renderOrder = 101
    const previewRoot = createPreviewRoot()
    previewRoot.add(previewMesh)
    previewRoot.add(previewOutline)
    options.rootGroup.add(previewRoot)
    options.rootGroup.add(previewPolygonLines)
    options.rootGroup.add(previewHelperLines)

    const normal = surface.normal.clone().normalize()
    const { axisU, axisV } = choosePlaneAxes(normal, options.getCameraDirection())
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, startPoint)

    session = {
      pointerId: event.pointerId,
      plane,
      origin: startPoint.clone(),
      normal,
      axisU,
      axisV,
      points: [startPoint.clone()],
      currentPoint: startPoint.clone(),
      previewRoot,
      previewMesh,
      previewMaterial,
      previewOutline,
      previewOutlineMaterial,
      previewPolygonLines,
      previewPolygonLineMaterial,
      previewPolygonGeometry,
      previewHelperLines,
      previewHelperLineMaterial,
      previewHelperGeometry,
      previewCornerMarkers,
      previewCornerMarkerGeometry,
      previewCornerMarkerMaterials,
      width: 0,
      height: 0,
      previewCenter: startPoint.clone(),
      previewQuaternion: new THREE.Quaternion(),
      previewCorners: [startPoint.clone(), startPoint.clone(), startPoint.clone(), startPoint.clone()],
    }

    refreshPreview(session)
  }

  const snapPoint = (event: PointerEvent, point: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 => {
    const snapped = point.clone()
    const snap = options.resolveVertexSnapAtPointer(event, snapped, normal)
    if (snap) {
      snapped.copy(snap.targetWorld)
      options.showVertexSnap(snap)
    } else {
      options.showVertexSnap(null)
    }
    return snapped
  }

  const commitCurrentPoint = (event: PointerEvent): boolean => {
    if (!session) {
      const surface = options.resolveSurfaceAtPointer(event)
      if (!surface) {
        return false
      }
      const startPoint = snapPoint(event, surface.point.clone(), surface.normal)
      clearSession()
      beginSession(event, surface, startPoint)
      return true
    }

    const point = resolvePlacementPoint(event, options, session)
    if (!point) {
      return false
    }

    const snapped = snapPoint(event, point, session.normal)
    const last = session.points[session.points.length - 1] ?? null
    session.pointerId = event.pointerId
    session.currentPoint.copy(snapped)
    if (last && last.distanceTo(snapped) <= MIN_EDGE_LENGTH) {
      refreshPreview(session)
      return true
    }
    session.points.push(snapped.clone())
    refreshPreview(session)
    return true
  }

  const finalize = (): boolean => {
    const activeSession = session
    if (!activeSession) {
      return false
    }
    const stablePoints = dedupePlanarPoints(
      activeSession.points.map((point) => {
        const offset = point.clone().sub(activeSession.origin)
        return { x: offset.dot(activeSession.axisU), y: offset.dot(activeSession.axisV) }
      }),
      MIN_EDGE_LENGTH,
    )
    if (stablePoints.length < 3) {
      return true
    }

    const rectangle = fitRectangleForWorldPoints(activeSession, activeSession.points)
    if (!rectangle || rectangle.width <= MIN_RECT_SIZE || rectangle.height <= MIN_RECT_SIZE) {
      return true
    }

    const center = rectangle.centerWorld.clone().addScaledVector(activeSession.normal, SNAP_OFFSET_EPSILON)
    const rotation = new THREE.Euler().setFromQuaternion(rectangle.quaternion, 'XYZ')
    options.createDisplayBoardNode({
      center,
      rotation: new THREE.Vector3(rotation.x, rotation.y, rotation.z),
      scale: new THREE.Vector3(rectangle.width, rectangle.height, 1),
    })
    clearSession()
    return true
  }

  return {
    getSession: () => session,

    handlePointerDown: (event: PointerEvent) => {
      if (options.activeBuildTool.value !== 'displayBoard' || event.button !== 0 || options.isAltOverrideActive()) {
        return false
      }
      return commitCurrentPoint(event)
    },

    handlePointerMove: (event: PointerEvent) => {
      if (!session || options.activeBuildTool.value !== 'displayBoard' || event.pointerId !== session.pointerId) {
        return false
      }

      const point = resolvePlacementPoint(event, options, session)
      if (!point) {
        return true
      }

      const snapped = snapPoint(event, point, session.normal)
      session.currentPoint.copy(snapped)
      refreshPreview(session)
      return true
    },

    handlePointerUp: (event: PointerEvent) => {
      if (!session || options.activeBuildTool.value !== 'displayBoard' || event.pointerId !== session.pointerId) {
        return false
      }
      return event.button === 0
    },

    handlePointerCancel: (event: PointerEvent) => {
      if (!session || event.pointerId !== session.pointerId) {
        return false
      }
      clearSession()
      return true
    },

    handleDoubleClick: (_event: MouseEvent) => {
      if (options.activeBuildTool.value !== 'displayBoard' || !session) {
        return false
      }
      return finalize()
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