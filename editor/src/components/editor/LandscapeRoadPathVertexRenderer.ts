import * as THREE from 'three'
import type { Vector3Like } from '@schema/core'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import { getEndpointGizmoPartInfoFromObject, type EndpointGizmoPart } from './EndpointGizmo'
import { computeWorldUnitsPerPixel } from './handleScreenScaleUtils'
import {
  createLandscapeRoadWaypointMarker,
  LANDSCAPE_ROAD_MARKER_LABEL_LIMIT,
  type LandscapeRoadMarkerState,
  type LandscapeRoadWaypointMarker,
} from './LandscapeRoadWaypointMarker'

/**
 * Editor overlay for proceduralLandscape road waypoints. Waypoints use
 * screen-sized 3D map pins with always-facing index badges; the path itself is
 * still a simple editor-only polyline.
 */

export type LandscapeRoadPathVertexHandlePickResult = {
  nodeId: string
  vertexIndex: number
  gizmoPart: EndpointGizmoPart
  gizmoKind: 'center' | 'axis'
  gizmoAxis?: THREE.Vector3
  point: THREE.Vector3
}

export type LandscapeRoadPathVertexRenderer = {
  clear(): void
  clearHover(): void
  setActiveHandle(active: { nodeId: string; vertexIndex: number; gizmoPart: EndpointGizmoPart } | null): void
  setSelectedHandle(selected: { nodeId: string; vertexIndex: number; gizmoPart?: EndpointGizmoPart } | null): void
  updateHover(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): void
  ensure(options: {
    active: boolean
    nodeId: string | null
    runtimeObject: THREE.Object3D | null
    points: ReadonlyArray<Vector3Like> | null | undefined
  }): void
  forceRebuild(options: {
    active: boolean
    nodeId: string | null
    runtimeObject: THREE.Object3D | null
    points: ReadonlyArray<Vector3Like> | null | undefined
  }): void
  pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): LandscapeRoadPathVertexHandlePickResult | null
  updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    heightPx?: number
  }): void
}

const LANDSCAPE_ROAD_VERTEX_HANDLE_GROUP_NAME = '__LandscapeRoadPathVertexHandles'
const LANDSCAPE_ROAD_VERTEX_HANDLE_RENDER_ORDER = 1002
const LANDSCAPE_ROAD_VERTEX_HANDLE_SCREEN_HEIGHT_PX = 56
const LANDSCAPE_ROAD_VERTEX_HANDLE_Y_OFFSET = 0.04
const LANDSCAPE_ROAD_PATH_LINE_COLOR = 0xffca28
const NEAR_SCALE_DISTANCE = 2.5
const NEAR_SCALE_MAX_MULT = 1.35

type EnsureOptions = {
  active: boolean
  nodeId: string | null
  runtimeObject: THREE.Object3D | null
  points: ReadonlyArray<Vector3Like> | null | undefined
  force?: boolean
}

function sanitizePoints(points: ReadonlyArray<Vector3Like> | null | undefined): THREE.Vector3[] {
  if (!Array.isArray(points)) {
    return []
  }
  const out: THREE.Vector3[] = []
  for (const entry of points) {
    const x = Number(entry?.x)
    const y = Number(entry?.y)
    const z = Number(entry?.z)
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      continue
    }
    out.push(new THREE.Vector3(x, Number.isFinite(y) ? y : 0, z))
  }
  return out
}

function computePointsSignature(points: THREE.Vector3[]): string {
  return hashString(stableSerialize(points.map((point) => [point.x, point.y, point.z])))
}

function isVisibleHitObject(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    if (!current.visible) {
      return false
    }
    current = current.parent
  }
  return true
}

function markerStateFor(
  key: string,
  active: { handleKey: string; gizmoPart: EndpointGizmoPart } | null,
  selected: { handleKey: string; gizmoPart: EndpointGizmoPart } | null,
  hovered: { handleKey: string; gizmoPart: EndpointGizmoPart } | null,
): LandscapeRoadMarkerState {
  if (active?.handleKey === key || selected?.handleKey === key) {
    return 'active'
  }
  if (hovered?.handleKey === key) {
    return 'hover'
  }
  return 'normal'
}

export function createLandscapeRoadPathVertexRenderer(): LandscapeRoadPathVertexRenderer {
  let state: {
    nodeId: string
    group: THREE.Group
    signature: string
    labelsAlwaysVisible: boolean
    line: THREE.Line | null
    markers: Map<string, LandscapeRoadWaypointMarker>
  } | null = null
  let hovered: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null
  let active: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null
  let selected: { handleKey: string; gizmoPart: EndpointGizmoPart } | null = null

  const tmpWorldPos = new THREE.Vector3()
  const tmpCameraWorldPos = new THREE.Vector3()
  const tmpParentWorldScale = new THREE.Vector3(1, 1, 1)

  function clear(): void {
    if (!state) {
      return
    }
    const existing = state
    state = null
    existing.group.removeFromParent()
    if (existing.line) {
      existing.line.geometry.dispose()
      const material = existing.line.material as THREE.Material
      material.dispose()
    }
    for (const marker of existing.markers.values()) {
      marker.dispose()
    }
    existing.markers.clear()
    hovered = null
    active = null
    selected = null
  }

  function refreshHighlight(): void {
    if (!state) {
      return
    }
    for (const [key, marker] of state.markers) {
      const markerState = markerStateFor(key, active, selected, hovered)
      marker.setState(markerState)
      marker.setLabelVisible(state.labelsAlwaysVisible || markerState !== 'normal')
    }
  }

  function clearHover(): void {
    if (!hovered) {
      return
    }
    hovered = null
    refreshHighlight()
  }

  function setActiveHandle(next: { nodeId: string; vertexIndex: number; gizmoPart: EndpointGizmoPart } | null): void {
    active = next
      ? { handleKey: `${next.nodeId}:${next.vertexIndex}`, gizmoPart: next.gizmoPart }
      : null
    refreshHighlight()
  }

  function setSelectedHandle(next: { nodeId: string; vertexIndex: number; gizmoPart?: EndpointGizmoPart } | null): void {
    selected = next
      ? {
          handleKey: `${next.nodeId}:${next.vertexIndex}`,
          gizmoPart: next.gizmoPart ?? 'center',
        }
      : null
    refreshHighlight()
  }

  function attachOrRebuild(options: EnsureOptions): void {
    const { active: isActive, nodeId, runtimeObject } = options
    if (!isActive || !nodeId || !runtimeObject) {
      clear()
      return
    }

    const points = sanitizePoints(options.points)
    if (!points.length) {
      clear()
      return
    }

    const signature = computePointsSignature(points)
    if (!options.force && state && state.nodeId === nodeId && state.signature === signature) {
      if (!runtimeObject.children.includes(state.group)) {
        runtimeObject.add(state.group)
      }
      return
    }

    clear()

    const group = new THREE.Group()
    group.name = LANDSCAPE_ROAD_VERTEX_HANDLE_GROUP_NAME
    group.userData.isLandscapeRoadPathHandles = true
    group.userData.editorOnly = true

    let line: THREE.Line | null = null
    if (points.length >= 2) {
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(
        points.map((point) => new THREE.Vector3(
          point.x,
          point.y + LANDSCAPE_ROAD_VERTEX_HANDLE_Y_OFFSET,
          point.z,
        )),
      )
      const lineMaterial = new THREE.LineBasicMaterial({
        color: LANDSCAPE_ROAD_PATH_LINE_COLOR,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      })
      line = new THREE.Line(lineGeometry, lineMaterial)
      line.name = 'LandscapeRoadPathLine'
      line.renderOrder = LANDSCAPE_ROAD_VERTEX_HANDLE_RENDER_ORDER
      line.layers.enableAll()
      line.userData.editorOnly = true
      group.add(line)
    }

    const labelsAlwaysVisible = points.length <= LANDSCAPE_ROAD_MARKER_LABEL_LIMIT
    const markers = new Map<string, LandscapeRoadWaypointMarker>()
    points.forEach((point, index) => {
      const marker = createLandscapeRoadWaypointMarker({
        label: `P${index + 1}`,
        kind: 'waypoint',
        showLabel: labelsAlwaysVisible,
        renderOrder: LANDSCAPE_ROAD_VERTEX_HANDLE_RENDER_ORDER,
      })
      const handle = marker.root
      const handleKey = `${nodeId}:${index}`
      handle.position.set(
        point.x,
        point.y + LANDSCAPE_ROAD_VERTEX_HANDLE_Y_OFFSET,
        point.z,
      )
      handle.userData.isLandscapeRoadPathHandle = true
      handle.userData.editorOnly = true
      handle.userData.nodeId = nodeId
      handle.userData.landscapeRoadPathVertexIndex = index
      handle.userData.handleKey = handleKey
      handle.userData.yOffset = LANDSCAPE_ROAD_VERTEX_HANDLE_Y_OFFSET
      handle.traverse((child) => {
        child.layers.enableAll()
        child.userData.editorOnly = true
        child.userData.isLandscapeRoadPathHandle = true
        child.userData.nodeId = nodeId
        child.userData.landscapeRoadPathVertexIndex = index
        child.userData.handleKey = handleKey
        if (child.userData.endpointGizmoPart == null) {
          child.userData.endpointGizmoPart = 'center'
        }
      })
      group.add(handle)
      markers.set(handleKey, marker)
    })

    runtimeObject.add(group)
    state = {
      nodeId,
      group,
      signature,
      labelsAlwaysVisible,
      line,
      markers,
    }
    hovered = null
    active = null
    selected = null
  }

  function pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): LandscapeRoadPathVertexHandlePickResult | null {
    if (!state?.group || !options.camera || !options.canvas) {
      return null
    }
    options.raycaster.setFromCamera(options.pointer, options.camera)
    const hits = options.raycaster.intersectObjects(state.group.children, true)
    for (const hit of hits) {
      if (!isVisibleHitObject(hit.object)) {
        continue
      }
      const vertexIndex = Number(hit.object?.userData?.landscapeRoadPathVertexIndex)
      const nodeId = hit.object?.userData?.nodeId
      const gizmoPart = (hit.object?.userData?.endpointGizmoPart as EndpointGizmoPart | undefined) ?? null
      if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || typeof nodeId !== 'string' || !nodeId.length) {
        continue
      }
      const partInfo = getEndpointGizmoPartInfoFromObject(hit.object)
      if (!gizmoPart || !partInfo) {
        continue
      }
      return {
        nodeId,
        vertexIndex,
        gizmoPart,
        gizmoKind: partInfo.kind,
        gizmoAxis: partInfo.kind === 'axis' ? partInfo.axis.clone() : undefined,
        point: hit.point.clone(),
      }
    }
    return null
  }

  function updateHover(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): void {
    const hit = pick(options)
    if (!hit) {
      clearHover()
      return
    }
    hovered = {
      handleKey: `${hit.nodeId}:${hit.vertexIndex}`,
      gizmoPart: hit.gizmoPart,
    }
    refreshHighlight()
  }

  function updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    heightPx?: number
  }): void {
    if (!state?.group || !options.camera || !options.canvas) {
      return
    }
    const heightPx = options.heightPx ?? LANDSCAPE_ROAD_VERTEX_HANDLE_SCREEN_HEIGHT_PX
    state.group.updateMatrixWorld(true)
    for (const marker of state.markers.values()) {
      const child = marker.root
      child.getWorldPosition(tmpWorldPos)
      options.camera.getWorldPosition(tmpCameraWorldPos)
      const distance = tmpWorldPos.distanceTo(tmpCameraWorldPos)
      const worldUnitsPerPixel = computeWorldUnitsPerPixel({
        camera: options.camera,
        distance,
        viewportHeightPx: options.canvas.clientHeight || options.canvas.height || 1,
      })
      const nearScaleMultiplier = distance < NEAR_SCALE_DISTANCE
        ? 1 + ((NEAR_SCALE_DISTANCE - distance) / NEAR_SCALE_DISTANCE) * (NEAR_SCALE_MAX_MULT - 1)
        : 1
      child.parent?.getWorldScale(tmpParentWorldScale)
      const parentScale = Math.max(1e-6, tmpParentWorldScale.x, tmpParentWorldScale.y, tmpParentWorldScale.z)
      marker.setScreenHeight(worldUnitsPerPixel * heightPx * nearScaleMultiplier, parentScale)
    }
    refreshHighlight()
  }

  return {
    clear,
    clearHover,
    setActiveHandle,
    setSelectedHandle,
    updateHover,
    ensure: (options) => attachOrRebuild(options),
    forceRebuild: (options) => attachOrRebuild({ ...options, force: true }),
    pick,
    updateScreenSize,
  }
}

export { LANDSCAPE_ROAD_VERTEX_HANDLE_GROUP_NAME, LANDSCAPE_ROAD_VERTEX_HANDLE_Y_OFFSET }
