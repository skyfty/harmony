import * as THREE from 'three'
import type { Vector3Like } from '@schema/core'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import { createEndpointGizmoObject, getEndpointGizmoPartInfoFromObject, type EndpointGizmoPart } from './EndpointGizmo'
import { computeWorldUnitsPerPixel } from './handleScreenScaleUtils'

/**
 * Editor overlay for hand-drawn proceduralLandscape road waypoints: one
 * endpoint handle per point plus a polyline through them. Everything lives in
 * the host node's local space and is tagged `editorOnly` so the runtime
 * terrain height-field rasterizer never mistakes it for real terrain.
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
    diameterPx?: number
  }): void
}

const LANDSCAPE_ROAD_VERTEX_HANDLE_GROUP_NAME = '__LandscapeRoadPathVertexHandles'
const LANDSCAPE_ROAD_VERTEX_HANDLE_RENDER_ORDER = 1002
const LANDSCAPE_ROAD_VERTEX_HANDLE_SCREEN_DIAMETER_PX = 46
const LANDSCAPE_ROAD_VERTEX_HANDLE_Y_OFFSET = 0.04
const LANDSCAPE_ROAD_VERTEX_HANDLE_COLOR = 0xffb300
const LANDSCAPE_ROAD_PATH_LINE_COLOR = 0xffca28
const NEAR_SCALE_DISTANCE = 2.5
const NEAR_SCALE_MAX_MULT = 2.0

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

function disposeGroup(group: THREE.Group): void {
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
  for (const child of group.children) {
    const gizmo = child?.userData?.endpointGizmo as { dispose?: () => void } | undefined
    gizmo?.dispose?.()
  }
}

export function createLandscapeRoadPathVertexRenderer(): LandscapeRoadPathVertexRenderer {
  let state: { nodeId: string; group: THREE.Group; signature: string } | null = null
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
    disposeGroup(existing.group)
    hovered = null
    active = null
    selected = null
  }

  function refreshHighlight(): void {
    if (!state) {
      return
    }
    for (const handle of state.group.children) {
      const gizmo = handle?.userData?.endpointGizmo as
        | { clearStates?: () => void; setState?: (part: EndpointGizmoPart, state: 'hover' | 'active') => void }
        | undefined
      if (!gizmo?.clearStates || !gizmo?.setState) {
        continue
      }
      gizmo.clearStates()
      const key = typeof handle.userData?.handleKey === 'string' ? handle.userData.handleKey : ''
      if (active && key === active.handleKey) {
        gizmo.setState(active.gizmoPart, 'active')
      } else if (selected && key === selected.handleKey) {
        gizmo.setState(selected.gizmoPart, 'active')
      } else if (hovered && key === hovered.handleKey) {
        gizmo.setState(hovered.gizmoPart, 'hover')
      }
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
    if (!state) {
      active = null
      return
    }
    if (!next) {
      active = null
      refreshHighlight()
      return
    }
    active = {
      handleKey: `${next.nodeId}:${next.vertexIndex}`,
      gizmoPart: next.gizmoPart,
    }
    refreshHighlight()
  }

  function setSelectedHandle(next: { nodeId: string; vertexIndex: number; gizmoPart?: EndpointGizmoPart } | null): void {
    if (!state) {
      selected = null
      return
    }
    if (!next) {
      selected = null
      refreshHighlight()
      return
    }
    selected = {
      handleKey: `${next.nodeId}:${next.vertexIndex}`,
      gizmoPart: next.gizmoPart ?? 'center',
    }
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

    if (points.length >= 2) {
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(
        points.map((point) => new THREE.Vector3(point.x, point.y + LANDSCAPE_ROAD_VERTEX_HANDLE_Y_OFFSET, point.z)),
      )
      const lineMaterial = new THREE.LineBasicMaterial({
        color: LANDSCAPE_ROAD_PATH_LINE_COLOR,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      })
      const line = new THREE.Line(lineGeometry, lineMaterial)
      line.name = 'LandscapeRoadPathLine'
      line.renderOrder = LANDSCAPE_ROAD_VERTEX_HANDLE_RENDER_ORDER
      line.layers.enableAll()
      line.userData.editorOnly = true
      group.add(line)
    }

    points.forEach((point, index) => {
      const gizmo = createEndpointGizmoObject({
        axes: { x: false, y: false, z: false },
        renderOrder: LANDSCAPE_ROAD_VERTEX_HANDLE_RENDER_ORDER,
        depthTest: false,
        depthWrite: false,
        opacity: 0.9,
        centerColor: LANDSCAPE_ROAD_VERTEX_HANDLE_COLOR,
      })

      const handle = gizmo.root
      handle.name = `LandscapeRoadPathHandle_${index + 1}`
      handle.position.set(point.x, point.y + LANDSCAPE_ROAD_VERTEX_HANDLE_Y_OFFSET, point.z)
      handle.layers.enableAll()
      handle.userData.isLandscapeRoadPathHandle = true
      handle.userData.editorOnly = true
      handle.userData.nodeId = nodeId
      handle.userData.landscapeRoadPathVertexIndex = index
      handle.userData.baseDiameter = gizmo.baseDiameter
      handle.userData.endpointGizmo = gizmo
      handle.userData.handleKey = `${nodeId}:${index}`
      handle.userData.yOffset = LANDSCAPE_ROAD_VERTEX_HANDLE_Y_OFFSET

      handle.traverse((child) => {
        child.userData.editorOnly = true
        const mesh = child as THREE.Mesh
        if (!mesh?.isMesh) {
          return
        }
        mesh.userData.isLandscapeRoadPathHandle = true
        mesh.userData.nodeId = nodeId
        mesh.userData.landscapeRoadPathVertexIndex = index
      })

      group.add(handle)
    })

    runtimeObject.add(group)
    state = { nodeId, group, signature }
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
      const owner = hit.object?.parent?.userData?.isLandscapeRoadPathHandle
        ? hit.object.parent
        : hit.object
      const vertexIndex = Number(owner?.userData?.landscapeRoadPathVertexIndex)
      const nodeId = owner?.userData?.nodeId
      const gizmoPart = (hit.object?.userData?.endpointGizmoPart as EndpointGizmoPart | undefined) ?? null
      if (!Number.isInteger(vertexIndex) || typeof nodeId !== 'string' || !nodeId.length) {
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
    diameterPx?: number
  }): void {
    if (!state?.group || !options.camera || !options.canvas) {
      return
    }
    const diameterPx = options.diameterPx ?? LANDSCAPE_ROAD_VERTEX_HANDLE_SCREEN_DIAMETER_PX
    state.group.updateMatrixWorld(true)
    for (const child of state.group.children) {
      const gizmo = child.userData?.endpointGizmo as { setBaseDiameter?: (diameter: number) => void } | undefined
      if (!gizmo?.setBaseDiameter) {
        continue
      }
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
      const parent = child.parent
      parent?.getWorldScale(tmpParentWorldScale)
      const parentScale = Math.max(1e-6, tmpParentWorldScale.x, tmpParentWorldScale.y, tmpParentWorldScale.z)
      const targetDiameter = Math.max(1e-4, worldUnitsPerPixel * diameterPx * nearScaleMultiplier)
      gizmo.setBaseDiameter(targetDiameter / parentScale)
    }
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
