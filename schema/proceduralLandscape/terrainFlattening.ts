import * as THREE from 'three'
import type {
  FloorDynamicMesh,
  FloorVertex2D,
  RegionDynamicMesh,
  SceneNode,
  WallDynamicMesh,
} from '../core'
import { extractFloorPerimeterChains } from '../floorMesh'
import { smoothstep } from './noise'

export const TERRAIN_FLATTENING_DEFAULT_EDGE_BLEND_WIDTH = 8
export const TERRAIN_FLATTENING_MIN_EDGE_BLEND_WIDTH = 0.25
export const TERRAIN_FLATTENING_MAX_EDGE_BLEND_WIDTH = 100
export const TERRAIN_FLATTENING_DEFAULT_CORRIDOR_WIDTH = 4
export const TERRAIN_FLATTENING_MIN_CORRIDOR_WIDTH = 0.5
export const TERRAIN_FLATTENING_MAX_CORRIDOR_WIDTH = 200
export const TERRAIN_FLATTENING_FLOOR_CLEARANCE = 0.12
export const TERRAIN_FLATTENING_TERRAIN_CLEARANCE = 0.01

export type TerrainFlatteningHeightMode = 'owner' | 'manual'
export type TerrainFlatteningEdgeMode = 'slope' | 'wall'

export interface TerrainFlatteningComponentProps {
  heightMode: TerrainFlatteningHeightMode
  manualHeight: number
  edgeMode: TerrainFlatteningEdgeMode
  edgeBlendWidth: number
  corridorWidth: number
  autoClearVegetation: boolean
}

export function clampTerrainFlatteningComponentProps(
  props: Partial<TerrainFlatteningComponentProps> | null | undefined,
): TerrainFlatteningComponentProps {
  const manualHeight = Number(props?.manualHeight)
  const edgeBlendWidth = Number(props?.edgeBlendWidth)
  const corridorWidth = Number(props?.corridorWidth)
  return {
    heightMode: props?.heightMode === 'manual' ? 'manual' : 'owner',
    manualHeight: Number.isFinite(manualHeight) ? manualHeight : 0,
    edgeMode: props?.edgeMode === 'wall' ? 'wall' : 'slope',
    edgeBlendWidth: Math.min(
      TERRAIN_FLATTENING_MAX_EDGE_BLEND_WIDTH,
      Math.max(
        TERRAIN_FLATTENING_MIN_EDGE_BLEND_WIDTH,
        Number.isFinite(edgeBlendWidth)
          ? edgeBlendWidth
          : TERRAIN_FLATTENING_DEFAULT_EDGE_BLEND_WIDTH,
      ),
    ),
    corridorWidth: Math.min(
      TERRAIN_FLATTENING_MAX_CORRIDOR_WIDTH,
      Math.max(
        TERRAIN_FLATTENING_MIN_CORRIDOR_WIDTH,
        Number.isFinite(corridorWidth)
          ? corridorWidth
          : TERRAIN_FLATTENING_DEFAULT_CORRIDOR_WIDTH,
      ),
    ),
    autoClearVegetation: props?.autoClearVegetation !== false,
  }
}

export function cloneTerrainFlatteningComponentProps(
  props: TerrainFlatteningComponentProps,
): TerrainFlatteningComponentProps {
  return clampTerrainFlatteningComponentProps(props)
}

export type TerrainFlatteningOwnerType = 'Floor' | 'Region' | 'Wall'
export type TerrainFlatteningCollisionAuthority = 'generated-terrain' | 'rigidbody'

export interface TerrainFlatteningPolygonFootprint {
  kind: 'polygon'
  contourWorldXZ: FloorVertex2D[]
}

export interface TerrainFlatteningCorridorChain {
  pointsWorldXZ: FloorVertex2D[]
  closed: boolean
}

export interface TerrainFlatteningCorridorFootprint {
  kind: 'corridor'
  chains: TerrainFlatteningCorridorChain[]
  halfWidth: number
}

export type TerrainFlatteningFootprint =
  | TerrainFlatteningPolygonFootprint
  | TerrainFlatteningCorridorFootprint

export interface TerrainFlatteningSurfacePlane {
  origin: [number, number, number]
  normal: [number, number, number]
}

export interface LandscapeTerrainFlatteningSnapshot {
  id: string
  ownerNodeId: string
  componentId: string
  ownerType: TerrainFlatteningOwnerType
  /**
   * The collision source that owns the configured footprint. A static Rigidbody
   * keeps its exact collider authoritative; generated DEM collision remains
   * available below it and outside the footprint.
   */
  collisionAuthority: TerrainFlatteningCollisionAuthority
  footprint: TerrainFlatteningFootprint
  targetY: number
  gradeY: number
  surfaceY: number
  /** Follow Owner mode on a non-horizontal Floor uses its exact world plane. */
  surfacePlane: TerrainFlatteningSurfacePlane | null
  edgeMode: TerrainFlatteningEdgeMode
  edgeBlendWidth: number
  autoClearVegetation: boolean
  minX: number
  minZ: number
  maxX: number
  maxZ: number
  signature: string
}

export type LandscapeTerrainFlatteningWarningCode =
  | 'invalid-footprint'
  | 'owner-not-visible'
  | 'invalid-height'
  | 'overlapping-targets'

export interface LandscapeTerrainFlatteningWarning {
  id: string
  ownerNodeId: string
  code: LandscapeTerrainFlatteningWarningCode
}

export interface LandscapeTerrainFlatteningSnapshotResult {
  targets: LandscapeTerrainFlatteningSnapshot[]
  warnings: LandscapeTerrainFlatteningWarning[]
  signature: string
}

interface LandscapeTerrainFlatteningRegistration {
  id: string
  ownerNodeId: string
  componentId: string
  resolveNode: () => SceneNode | null
  object: THREE.Object3D | null
  props: TerrainFlatteningComponentProps
  enabled: boolean
}

const registrations = new Map<string, LandscapeTerrainFlatteningRegistration>()
const ownerUp = new THREE.Vector3()
const ownerPoint = new THREE.Vector3()

export function isTerrainFlatteningOwnerNode(
  node: SceneNode | null | undefined,
): node is SceneNode & { dynamicMesh: FloorDynamicMesh | RegionDynamicMesh | WallDynamicMesh } {
  const type = node?.dynamicMesh?.type
  return type === 'Floor' || type === 'Region' || type === 'Wall'
}

export function resolveTerrainFlatteningOwnerReferenceWorldY(
  node: SceneNode | null | undefined,
  object: THREE.Object3D | null | undefined,
): number | null {
  if (!node || !object || !isTerrainFlatteningOwnerNode(node)) {
    return null
  }
  object.updateWorldMatrix(true, false)
  const mesh = node.dynamicMesh
  if (mesh.type === 'Floor') {
    ownerPoint
      .set(0, mesh.type === 'Floor' ? Math.max(0, Number(mesh.thickness) || 0) : 0, 0)
      .applyMatrix4(object.matrixWorld)
    return Number.isFinite(ownerPoint.y) ? ownerPoint.y : null
  }
  if (mesh.type === 'Region') {
    ownerPoint.set(0, 0, 0).applyMatrix4(object.matrixWorld)
    return Number.isFinite(ownerPoint.y) ? ownerPoint.y : null
  }
  const heights: number[] = []
  mesh.chains.forEach((chain) => {
    chain.points.forEach((point) => {
      const x = Number(point.x)
      const y = Number(point.y)
      const z = Number(point.z)
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return
      }
      ownerPoint.set(x, y, z).applyMatrix4(object.matrixWorld)
      if (Number.isFinite(ownerPoint.y)) {
        heights.push(ownerPoint.y)
      }
    })
  })
  if (!heights.length) {
    return null
  }
  heights.sort((a, b) => a - b)
  return heights[Math.floor(heights.length / 2)]!
}

function isVisibleInHierarchy(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    if (current.visible === false) {
      return false
    }
    current = current.parent
  }
  return true
}

function rounded(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : 'NaN'
}

function resolveCollisionAuthority(
  node: SceneNode,
): TerrainFlatteningCollisionAuthority {
  const rigidbody = node.components?.rigidbody as
    | {
        enabled?: boolean
        props?: {
          bodyType?: unknown
        } | null
      }
    | undefined
  if (!rigidbody || rigidbody.enabled === false) {
    return 'generated-terrain'
  }
  const bodyType = rigidbody?.props?.bodyType
  return bodyType === 'DYNAMIC' || bodyType === 'KINEMATIC'
    ? 'generated-terrain'
    : 'rigidbody'
}

function sanitizeContour(points: ReadonlyArray<FloorVertex2D>): FloorVertex2D[] {
  const out: FloorVertex2D[] = []
  for (const point of points) {
    const x = Number(point[0])
    const z = Number(point[1])
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      continue
    }
    const previous = out[out.length - 1]
    if (previous && Math.abs(previous[0] - x) <= 1e-6 && Math.abs(previous[1] - z) <= 1e-6) {
      continue
    }
    out.push([x, z])
  }
  if (out.length >= 2) {
    const first = out[0]!
    const last = out[out.length - 1]!
    if (Math.abs(first[0] - last[0]) <= 1e-6 && Math.abs(first[1] - last[1]) <= 1e-6) {
      out.pop()
    }
  }
  return out
}

function transformLocalXZToWorld(
  points: ReadonlyArray<FloorVertex2D>,
  matrixWorld: THREE.Matrix4,
): FloorVertex2D[] {
  const out: FloorVertex2D[] = []
  for (const [x, z] of points) {
    ownerPoint.set(x, 0, z).applyMatrix4(matrixWorld)
    if (Number.isFinite(ownerPoint.x) && Number.isFinite(ownerPoint.z)) {
      out.push([ownerPoint.x, ownerPoint.z])
    }
  }
  return sanitizeContour(out)
}

function resolveFloorLocalContour(mesh: FloorDynamicMesh): FloorVertex2D[] {
  const chain = extractFloorPerimeterChains(mesh)[0]
  const source = chain?.points?.length
    ? chain.points.map((point) => [point.x, point.z] as FloorVertex2D)
    : mesh.vertices.map(([x, z]) => [x, z] as FloorVertex2D)
  return sanitizeContour(source)
}

function buildFootprintBounds(
  footprint: TerrainFlatteningFootprint,
  edgeBlendWidth: number,
): { minX: number; minZ: number; maxX: number; maxZ: number } | null {
  const points: FloorVertex2D[] = footprint.kind === 'polygon'
    ? footprint.contourWorldXZ
    : footprint.chains.flatMap((chain) => chain.pointsWorldXZ)
  if (!points.length) {
    return null
  }
  const padding = footprint.kind === 'polygon'
    ? edgeBlendWidth
    : footprint.halfWidth + edgeBlendWidth
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  points.forEach(([x, z]) => {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxZ = Math.max(maxZ, z)
  })
  return {
    minX: minX - padding,
    minZ: minZ - padding,
    maxX: maxX + padding,
    maxZ: maxZ + padding,
  }
}

export function buildLandscapeTerrainFlatteningOwnerSnapshot(params: {
  id: string
  node: SceneNode
  object: THREE.Object3D
  props: Partial<TerrainFlatteningComponentProps> | null | undefined
  componentId?: string
}): {
  snapshot: LandscapeTerrainFlatteningSnapshot | null
  warningCode: LandscapeTerrainFlatteningWarningCode | null
} {
  const { id, node, object } = params
  if (!isTerrainFlatteningOwnerNode(node)) {
    return { snapshot: null, warningCode: 'invalid-footprint' }
  }
  if (!isVisibleInHierarchy(object)) {
    return { snapshot: null, warningCode: 'owner-not-visible' }
  }
  object.updateWorldMatrix(true, false)
  const props = clampTerrainFlatteningComponentProps(params.props)
  const ownerType = node.dynamicMesh.type
  const collisionAuthority = resolveCollisionAuthority(node)
  const mesh = node.dynamicMesh
  let footprint: TerrainFlatteningFootprint
  if (mesh.type === 'Floor' || mesh.type === 'Region') {
    const localContour = mesh.type === 'Floor'
      ? resolveFloorLocalContour(mesh)
      : sanitizeContour(mesh.vertices)
    const contourWorldXZ = transformLocalXZToWorld(localContour, object.matrixWorld)
    if (contourWorldXZ.length < 3) {
      return { snapshot: null, warningCode: 'invalid-footprint' }
    }
    footprint = { kind: 'polygon', contourWorldXZ }
  } else {
    const chains: TerrainFlatteningCorridorChain[] = []
    mesh.chains.forEach((chain) => {
      const pointsWorldXZ: FloorVertex2D[] = []
      chain.points.forEach((point) => {
        const x = Number(point.x)
        const y = Number(point.y)
        const z = Number(point.z)
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          return
        }
        ownerPoint.set(x, y, z).applyMatrix4(object.matrixWorld)
        if (Number.isFinite(ownerPoint.x) && Number.isFinite(ownerPoint.z)) {
          pointsWorldXZ.push([ownerPoint.x, ownerPoint.z])
        }
      })
      const sanitized = sanitizeContour(pointsWorldXZ)
      if (sanitized.length >= 2) {
        chains.push({
          pointsWorldXZ: sanitized,
          closed: chain.closed === true,
        })
      }
    })
    if (!chains.length) {
      return { snapshot: null, warningCode: 'invalid-footprint' }
    }
    footprint = {
      kind: 'corridor',
      chains,
      halfWidth: props.corridorWidth * 0.5,
    }
  }
  const ownerY = resolveTerrainFlatteningOwnerReferenceWorldY(node, object)
  if (ownerY == null) {
    return { snapshot: null, warningCode: 'invalid-height' }
  }
  const targetY = props.heightMode === 'manual' ? props.manualHeight : ownerY
  if (!Number.isFinite(targetY)) {
    return { snapshot: null, warningCode: 'invalid-height' }
  }
  const bounds = buildFootprintBounds(footprint, props.edgeBlendWidth)
  if (!bounds) {
    return { snapshot: null, warningCode: 'invalid-footprint' }
  }
  const gradeY = targetY - (
    ownerType === 'Floor'
      ? TERRAIN_FLATTENING_FLOOR_CLEARANCE
      : TERRAIN_FLATTENING_TERRAIN_CLEARANCE
  )
  const surfaceY = ownerType === 'Floor' ? targetY : gradeY
  let surfacePlane: TerrainFlatteningSurfacePlane | null = null
  if (ownerType === 'Floor' && props.heightMode === 'owner') {
    ownerUp.set(0, 1, 0).transformDirection(object.matrixWorld).normalize()
    if (Math.abs(ownerUp.y) <= 1e-5) {
      return { snapshot: null, warningCode: 'invalid-height' }
    }
    ownerPoint
      .set(0, mesh.type === 'Floor' ? Math.max(0, Number(mesh.thickness) || 0) : 0, 0)
      .applyMatrix4(object.matrixWorld)
    surfacePlane = {
      origin: [ownerPoint.x, ownerY, ownerPoint.z],
      normal: [ownerUp.x, ownerUp.y, ownerUp.z],
    }
  }
  const signatureParts = [
    id,
    ownerType,
    collisionAuthority,
    props.heightMode,
    rounded(targetY),
    props.edgeMode,
    rounded(props.edgeBlendWidth),
    rounded(props.corridorWidth),
    props.autoClearVegetation ? '1' : '0',
  ]
  if (footprint.kind === 'polygon') {
    footprint.contourWorldXZ.forEach(([x, z]) => signatureParts.push(rounded(x), rounded(z)))
  } else {
    footprint.chains.forEach((chain) => {
      signatureParts.push(chain.closed ? 'closed' : 'open')
      chain.pointsWorldXZ.forEach(([x, z]) => signatureParts.push(rounded(x), rounded(z)))
    })
  }
  return {
    snapshot: {
      id,
      ownerNodeId: node.id,
      componentId: params.componentId ?? '',
      ownerType,
      collisionAuthority,
      footprint,
      targetY,
      gradeY,
      surfaceY,
      surfacePlane,
      edgeMode: props.edgeMode,
      edgeBlendWidth: props.edgeBlendWidth,
      autoClearVegetation: props.autoClearVegetation,
      ...bounds,
      signature: signatureParts.join('|'),
    },
    warningCode: null,
  }
}

export function registerLandscapeTerrainFlattening(params: {
  id: string
  ownerNodeId: string
  componentId: string
  resolveNode: () => SceneNode | null
  object: THREE.Object3D | null
  props: TerrainFlatteningComponentProps
  enabled?: boolean
}): void {
  registrations.set(params.id, {
    id: params.id,
    ownerNodeId: params.ownerNodeId,
    componentId: params.componentId,
    resolveNode: params.resolveNode,
    object: params.object,
    props: clampTerrainFlatteningComponentProps(params.props),
    enabled: params.enabled !== false,
  })
}

export function updateLandscapeTerrainFlattening(
  id: string,
  patch: {
    object?: THREE.Object3D | null
    props?: TerrainFlatteningComponentProps
    enabled?: boolean
  },
): void {
  const current = registrations.get(id)
  if (!current) {
    return
  }
  if (patch.object !== undefined) current.object = patch.object
  if (patch.props !== undefined) current.props = clampTerrainFlatteningComponentProps(patch.props)
  if (patch.enabled !== undefined) current.enabled = patch.enabled
}

export function unregisterLandscapeTerrainFlattening(id: string): void {
  registrations.delete(id)
}

export function getLandscapeTerrainFlatteningSnapshot(): LandscapeTerrainFlatteningSnapshotResult {
  const targets: LandscapeTerrainFlatteningSnapshot[] = []
  const warnings: LandscapeTerrainFlatteningWarning[] = []
  registrations.forEach((registration) => {
    if (!registration.enabled) {
      return
    }
    const node = registration.resolveNode()
    if (!node || !registration.object) {
      warnings.push({
        id: registration.id,
        ownerNodeId: registration.ownerNodeId,
        code: 'invalid-footprint',
      })
      return
    }
    const result = buildLandscapeTerrainFlatteningOwnerSnapshot({
      id: registration.id,
      node,
      object: registration.object,
      props: registration.props,
      componentId: registration.componentId,
    })
    if (result.snapshot) {
      targets.push(result.snapshot)
    } else if (result.warningCode) {
      warnings.push({
        id: registration.id,
        ownerNodeId: registration.ownerNodeId,
        code: result.warningCode,
      })
    }
  })
  targets.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  for (let firstIndex = 0; firstIndex < targets.length; firstIndex += 1) {
    const first = targets[firstIndex]!
    for (let secondIndex = firstIndex + 1; secondIndex < targets.length; secondIndex += 1) {
      const second = targets[secondIndex]!
      if (
        first.maxX < second.minX
        || first.minX > second.maxX
        || first.maxZ < second.minZ
        || first.minZ > second.maxZ
      ) {
        continue
      }
      warnings.push({
        id: `${first.id}|${second.id}`,
        ownerNodeId: first.ownerNodeId,
        code: 'overlapping-targets',
      })
    }
  }
  warnings.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  return {
    targets,
    warnings,
    signature: targets.length || warnings.length
      ? `${targets.map((target) => target.signature).join('||')}::${warnings.map((warning) => `${warning.id}:${warning.code}`).join('|')}`
      : '',
  }
}

export function resetLandscapeTerrainFlatteningForTests(): void {
  registrations.clear()
}

export interface DemTerrainFlatteningTarget {
  readonly snapshot: LandscapeTerrainFlatteningSnapshot
  readonly id: string
  readonly targetY: number
  readonly gradeY: number
  readonly surfaceY: number
  readonly autoClearVegetation: boolean
  readonly influenceWidth: number
  readonly minX: number
  readonly minZ: number
  readonly maxX: number
  readonly maxZ: number
  contains(x: number, z: number, padding?: number): boolean
  distanceOutsideCore(x: number, z: number): number
  heightAt(x: number, z: number, rawHeight: number): number
  surfaceHeightAt(x: number, z: number): number
  terrainHeightAt(x: number, z: number): number
  visibleHeightAt(x: number, z: number, rawHeight: number): number
  /**
   * Height used by automatically generated physics surfaces. When a static
   * Rigidbody owns the footprint, this deliberately stays below the rendered
   * owner surface so the authored collider is the only contact surface.
   */
  collisionHeightAt(x: number, z: number, rawHeight: number): number
}

function clampPointToSegmentDistanceSquared(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax
  const dz = bz - az
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared <= 1e-12) {
    const ox = x - ax
    const oz = z - az
    return ox * ox + oz * oz
  }
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared))
  const px = ax + dx * t
  const pz = az + dz * t
  const ox = x - px
  const oz = z - pz
  return ox * ox + oz * oz
}

function pointInsideContour(x: number, z: number, contour: ReadonlyArray<FloorVertex2D>): boolean {
  let inside = false
  for (let index = 0, previousIndex = contour.length - 1; index < contour.length; previousIndex = index++) {
    const a = contour[index]!
    const b = contour[previousIndex]!
    const cross = (z - a[1]) * (b[0] - a[0]) - (x - a[0]) * (b[1] - a[1])
    if (Math.abs(cross) <= 1e-6) {
      const dot = (x - a[0]) * (b[0] - a[0]) + (z - a[1]) * (b[1] - a[1])
      const lengthSquared = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2
      if (dot >= -1e-6 && dot <= lengthSquared + 1e-6) {
        return true
      }
    }
    if (
      ((a[1] > z) !== (b[1] > z))
      && (x < ((b[0] - a[0]) * (z - a[1])) / ((b[1] - a[1]) || Number.EPSILON) + a[0])
    ) {
      inside = !inside
    }
  }
  return inside
}

function distanceToPolygonBoundary(
  x: number,
  z: number,
  contour: ReadonlyArray<FloorVertex2D>,
): number {
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < contour.length; index += 1) {
    const a = contour[index]!
    const b = contour[(index + 1) % contour.length]!
    best = Math.min(best, clampPointToSegmentDistanceSquared(x, z, a[0], a[1], b[0], b[1]))
  }
  return Math.sqrt(best)
}

function distanceToCorridorCore(
  x: number,
  z: number,
  chains: ReadonlyArray<TerrainFlatteningCorridorChain>,
  halfWidth: number,
): number {
  let best = Number.POSITIVE_INFINITY
  chains.forEach((chain) => {
    const segmentCount = chain.closed ? chain.pointsWorldXZ.length : chain.pointsWorldXZ.length - 1
    for (let index = 0; index < segmentCount; index += 1) {
      const a = chain.pointsWorldXZ[index]!
      const b = chain.pointsWorldXZ[(index + 1) % chain.pointsWorldXZ.length]!
      best = Math.min(best, clampPointToSegmentDistanceSquared(x, z, a[0], a[1], b[0], b[1]))
    }
  })
  return Math.max(0, Math.sqrt(best) - halfWidth)
}

function triangleArea2D(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
}

function pointInsideTriangle2D(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): boolean {
  const ab = triangleArea2D(ax, az, bx, bz, x, z)
  const bc = triangleArea2D(bx, bz, cx, cz, x, z)
  const ca = triangleArea2D(cx, cz, ax, az, x, z)
  const hasNegative = ab < -1e-7 || bc < -1e-7 || ca < -1e-7
  const hasPositive = ab > 1e-7 || bc > 1e-7 || ca > 1e-7
  return !(hasNegative && hasPositive)
}

function segmentsIntersect2D(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): boolean {
  const firstC = triangleArea2D(ax, az, bx, bz, cx, cz)
  const firstD = triangleArea2D(ax, az, bx, bz, dx, dz)
  const secondA = triangleArea2D(cx, cz, dx, dz, ax, az)
  const secondB = triangleArea2D(cx, cz, dx, dz, bx, bz)
  if (
    ((firstC > 1e-7 && firstD < -1e-7) || (firstC < -1e-7 && firstD > 1e-7))
    && ((secondA > 1e-7 && secondB < -1e-7) || (secondA < -1e-7 && secondB > 1e-7))
  ) {
    return true
  }
  const onSegment = (
    px: number,
    pz: number,
    qx: number,
    qz: number,
    rx: number,
    rz: number,
  ): boolean => (
    Math.abs(triangleArea2D(px, pz, qx, qz, rx, rz)) <= 1e-7
    && rx >= Math.min(px, qx) - 1e-7
    && rx <= Math.max(px, qx) + 1e-7
    && rz >= Math.min(pz, qz) - 1e-7
    && rz <= Math.max(pz, qz) + 1e-7
  )
  return onSegment(ax, az, bx, bz, cx, cz)
    || onSegment(ax, az, bx, bz, dx, dz)
    || onSegment(cx, cz, dx, dz, ax, az)
    || onSegment(cx, cz, dx, dz, bx, bz)
}

function segmentDistanceSquared(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): number {
  if (segmentsIntersect2D(ax, az, bx, bz, cx, cz, dx, dz)) {
    return 0
  }
  return Math.min(
    clampPointToSegmentDistanceSquared(ax, az, cx, cz, dx, dz),
    clampPointToSegmentDistanceSquared(bx, bz, cx, cz, dx, dz),
    clampPointToSegmentDistanceSquared(cx, cz, ax, az, bx, bz),
    clampPointToSegmentDistanceSquared(dx, dz, ax, az, bx, bz),
  )
}

/**
 * Tests the full XZ triangle, not only its centroid. Coarse DEM cells can be
 * much wider than a concave plaza, so centroid-only tests leave triangle
 * wedges above the flattened Floor even though no cell vertex is inside it.
 */
export function terrainFlatteningTriangleIntersectsCore(
  target: DemTerrainFlatteningTarget,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): boolean {
  const minX = Math.min(ax, bx, cx)
  const maxX = Math.max(ax, bx, cx)
  const minZ = Math.min(az, bz, cz)
  const maxZ = Math.max(az, bz, cz)
  if (
    maxX < target.minX
    || minX > target.maxX
    || maxZ < target.minZ
    || minZ > target.maxZ
  ) {
    return false
  }
  if (
    target.distanceOutsideCore(ax, az) <= 1e-7
    || target.distanceOutsideCore(bx, bz) <= 1e-7
    || target.distanceOutsideCore(cx, cz) <= 1e-7
  ) {
    return true
  }

  const footprint = target.snapshot.footprint
  if (footprint.kind === 'polygon') {
    const contour = footprint.contourWorldXZ
    for (const [x, z] of contour) {
      if (pointInsideTriangle2D(x, z, ax, az, bx, bz, cx, cz)) {
        return true
      }
    }
    for (let index = 0; index < contour.length; index += 1) {
      const current = contour[index]!
      const next = contour[(index + 1) % contour.length]!
      if (
        segmentsIntersect2D(ax, az, bx, bz, current[0], current[1], next[0], next[1])
        || segmentsIntersect2D(bx, bz, cx, cz, current[0], current[1], next[0], next[1])
        || segmentsIntersect2D(cx, cz, ax, az, current[0], current[1], next[0], next[1])
      ) {
        return true
      }
    }
    return false
  }

  const halfWidth = footprint.halfWidth
  const maxDistanceSquared = halfWidth * halfWidth + 1e-7
  for (const chain of footprint.chains) {
    const points = chain.pointsWorldXZ
    const segmentCount = chain.closed ? points.length : points.length - 1
    for (let index = 0; index < segmentCount; index += 1) {
      const current = points[index]!
      const next = points[(index + 1) % points.length]!
      if (
        pointInsideTriangle2D(
          current[0],
          current[1],
          ax,
          az,
          bx,
          bz,
          cx,
          cz,
        )
      ) {
        return true
      }
      if (
        segmentDistanceSquared(ax, az, bx, bz, current[0], current[1], next[0], next[1])
          <= maxDistanceSquared
        || segmentDistanceSquared(bx, bz, cx, cz, current[0], current[1], next[0], next[1])
          <= maxDistanceSquared
        || segmentDistanceSquared(cx, cz, ax, az, current[0], current[1], next[0], next[1])
          <= maxDistanceSquared
      ) {
        return true
      }
    }
  }
  return false
}

function footprintBoundsPoints(
  footprint: TerrainFlatteningFootprint,
): FloorVertex2D[] {
  return footprint.kind === 'polygon'
    ? footprint.contourWorldXZ
    : footprint.chains.flatMap((chain) => chain.pointsWorldXZ)
}

export function collectTerrainFlatteningSamplePoints(
  footprint: TerrainFlatteningFootprint,
  samplesPerAxis = 11,
): FloorVertex2D[] {
  const points = footprintBoundsPoints(footprint)
  if (!points.length) {
    return []
  }
  if (footprint.kind === 'corridor') {
    const samples: FloorVertex2D[] = []
    const maxSamples = 512
    footprint.chains.forEach((chain) => {
      for (let index = 0; index < chain.pointsWorldXZ.length; index += 1) {
        const current = chain.pointsWorldXZ[index]!
        samples.push(current)
        if (samples.length >= maxSamples) {
          break
        }
        const next = chain.pointsWorldXZ[(index + 1) % chain.pointsWorldXZ.length]!
        const distance = Math.hypot(next[0] - current[0], next[1] - current[1])
        const steps = Math.max(1, Math.ceil(distance / Math.max(2, footprint.halfWidth * 0.5)))
        for (let step = 1; step < steps && samples.length < maxSamples; step += 1) {
          const t = step / steps
          samples.push([
            current[0] + (next[0] - current[0]) * t,
            current[1] + (next[1] - current[1]) * t,
          ])
        }
        if (samples.length >= maxSamples) {
          break
        }
      }
    })
    return samples
  }
  const minX = Math.min(...points.map((point) => point[0]))
  const maxX = Math.max(...points.map((point) => point[0]))
  const minZ = Math.min(...points.map((point) => point[1]))
  const maxZ = Math.max(...points.map((point) => point[1]))
  const safeSamples = Math.max(3, Math.min(31, Math.round(samplesPerAxis)))
  const samples: FloorVertex2D[] = []
  for (let row = 0; row < safeSamples; row += 1) {
    for (let column = 0; column < safeSamples; column += 1) {
      const x = minX + (maxX - minX) * ((column + 0.5) / safeSamples)
      const z = minZ + (maxZ - minZ) * ((row + 0.5) / safeSamples)
      if (pointInsideContour(x, z, footprint.contourWorldXZ)) {
        samples.push([x, z])
      }
    }
  }
  return samples
}

export function collectTerrainFlatteningRoadProbes(
  footprint: TerrainFlatteningFootprint,
): FloorVertex2D[] {
  if (footprint.kind === 'corridor') {
    return collectTerrainFlatteningSamplePoints(footprint, 31)
  }
  const contour = footprint.contourWorldXZ
  if (contour.length < 3) {
    return []
  }
  const probes: FloorVertex2D[] = []
  let centroidX = 0
  let centroidZ = 0
  contour.forEach(([x, z]) => {
    centroidX += x
    centroidZ += z
  })
  probes.push([centroidX / contour.length, centroidZ / contour.length])
  for (let index = 0; index < contour.length; index += 1) {
    const current = contour[index]!
    const next = contour[(index + 1) % contour.length]!
    const steps = Math.max(1, Math.ceil(Math.hypot(next[0] - current[0], next[1] - current[1]) / 5))
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps
      probes.push([
        current[0] + (next[0] - current[0]) * t,
        current[1] + (next[1] - current[1]) * t,
      ])
    }
  }
  return probes
}

export function createDemTerrainFlatteningTarget(
  snapshot: LandscapeTerrainFlatteningSnapshot,
): DemTerrainFlatteningTarget {
  const footprint = snapshot.footprint
  const influenceWidth = snapshot.edgeMode === 'wall'
    ? Math.min(0.35, snapshot.edgeBlendWidth)
    : Math.max(TERRAIN_FLATTENING_MIN_EDGE_BLEND_WIDTH, snapshot.edgeBlendWidth)
  const isCore = (x: number, z: number): boolean => (
    footprint.kind === 'polygon'
      ? pointInsideContour(x, z, footprint.contourWorldXZ)
      : distanceToCorridorCore(x, z, footprint.chains, footprint.halfWidth) <= 1e-6
  )
  const distanceOutsideCore = (x: number, z: number): number => {
    if (footprint.kind === 'corridor') {
      return distanceToCorridorCore(x, z, footprint.chains, footprint.halfWidth)
    }
    const distance = distanceToPolygonBoundary(x, z, footprint.contourWorldXZ)
    return pointInsideContour(x, z, footprint.contourWorldXZ) ? 0 : distance
  }
  const surfaceHeightAt = (x: number, z: number): number => {
    const plane = snapshot.surfacePlane
    if (!plane) {
      return snapshot.targetY
    }
    const [originX, originY, originZ] = plane.origin
    const [normalX, normalY, normalZ] = plane.normal
    return originY - (
      normalX * (x - originX)
      + normalZ * (z - originZ)
    ) / normalY
  }
  const terrainHeightAt = (x: number, z: number): number => (
    surfaceHeightAt(x, z) - (
      snapshot.ownerType === 'Floor'
        ? TERRAIN_FLATTENING_FLOOR_CLEARANCE
        : TERRAIN_FLATTENING_TERRAIN_CLEARANCE
    )
  )
  const target: DemTerrainFlatteningTarget = {
    snapshot,
    id: snapshot.id,
    targetY: snapshot.targetY,
    gradeY: snapshot.gradeY,
    surfaceY: snapshot.surfaceY,
    autoClearVegetation: snapshot.autoClearVegetation,
    influenceWidth,
    minX: snapshot.minX,
    minZ: snapshot.minZ,
    maxX: snapshot.maxX,
    maxZ: snapshot.maxZ,
    contains(x: number, z: number, padding = 0): boolean {
      if (isCore(x, z)) {
        return true
      }
      return distanceOutsideCore(x, z) <= Math.max(0, padding)
    },
    distanceOutsideCore,
    heightAt(x: number, z: number, rawHeight: number): number {
      const distance = distanceOutsideCore(x, z)
      if (distance <= 1e-6) {
        return terrainHeightAt(x, z)
      }
      if (distance >= influenceWidth) {
        return rawHeight
      }
      const coreHeight = terrainHeightAt(x, z)
      return coreHeight
        + (rawHeight - coreHeight) * smoothstep(0, influenceWidth, distance)
    },
    surfaceHeightAt,
    terrainHeightAt,
    visibleHeightAt(x: number, z: number, rawHeight: number): number {
      return isCore(x, z)
        ? (snapshot.ownerType === 'Floor' ? surfaceHeightAt(x, z) : terrainHeightAt(x, z))
        : target.heightAt(x, z, rawHeight)
    },
    collisionHeightAt(x: number, z: number, rawHeight: number): number {
      return snapshot.collisionAuthority === 'rigidbody'
        ? target.heightAt(x, z, rawHeight)
        : target.visibleHeightAt(x, z, rawHeight)
    },
  }
  return target
}

export function selectDemTerrainFlatteningTargetAt(
  targets: ReadonlyArray<DemTerrainFlatteningTarget>,
  x: number,
  z: number,
): DemTerrainFlatteningTarget | null {
  let selected: DemTerrainFlatteningTarget | null = null
  for (const target of targets) {
    if (
      x < target.minX - target.influenceWidth
      || x > target.maxX + target.influenceWidth
      || z < target.minZ - target.influenceWidth
      || z > target.maxZ + target.influenceWidth
      || !target.contains(x, z, target.influenceWidth)
    ) {
      continue
    }
    if (
      !selected
      || target.targetY > selected.targetY + 1e-6
      || (
        Math.abs(target.targetY - selected.targetY) <= 1e-6
        && target.id.localeCompare(selected.id, 'en') < 0
      )
    ) {
      selected = target
    }
  }
  return selected
}

export function isTerrainFlatteningPointCleared(
  targets: ReadonlyArray<DemTerrainFlatteningTarget>,
  x: number,
  z: number,
  margin = 0,
): boolean {
  return targets.some((target) => (
    target.autoClearVegetation && target.contains(x, z, Math.max(0, margin))
  ))
}

export interface RoadbedFloorClipResult {
  geometry: THREE.BufferGeometry
  remainingTriangleCount: number
  removedTriangleCount: number
}

/**
 * Keeps roadbed shoulders and side slopes from covering an opaque Floor. The
 * asphalt road band is a separate mesh and remains above the plaza.
 */
export function clipRoadbedGeometryInsideFloorFlattening(
  geometry: THREE.BufferGeometry,
  hostMatrix: THREE.Matrix4,
  targets: ReadonlyArray<DemTerrainFlatteningTarget>,
): RoadbedFloorClipResult {
  const floorTargets = targets.filter((target) => target.snapshot.ownerType === 'Floor')
  const position = geometry.getAttribute('position')
  if (!floorTargets.length || !position) {
    return {
      geometry,
      remainingTriangleCount: Math.floor((geometry.getIndex()?.count ?? position.count) / 3),
      removedTriangleCount: 0,
    }
  }
  const sourceIndex = geometry.getIndex()
  const sourceCount = sourceIndex?.count ?? position.count
  const kept: number[] = []
  const triangle = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  let removedTriangleCount = 0
  for (let cursor = 0; cursor + 2 < sourceCount; cursor += 3) {
    const ia = sourceIndex ? sourceIndex.getX(cursor) : cursor
    const ib = sourceIndex ? sourceIndex.getX(cursor + 1) : cursor + 1
    const ic = sourceIndex ? sourceIndex.getX(cursor + 2) : cursor + 2
    const triangleIndices = [ia, ib, ic]
    triangleIndices.forEach((index, triangleIndex) => {
      triangle[triangleIndex]!
        .set(position.getX(index), position.getY(index), position.getZ(index))
        .applyMatrix4(hostMatrix)
    })
    const overlapsFloor = floorTargets.some((target) => (
      terrainFlatteningTriangleIntersectsCore(
        target,
        triangle[0]!.x,
        triangle[0]!.z,
        triangle[1]!.x,
        triangle[1]!.z,
        triangle[2]!.x,
        triangle[2]!.z,
      )
      || target.contains(
        (triangle[0]!.x + triangle[1]!.x + triangle[2]!.x) / 3,
        (triangle[0]!.z + triangle[1]!.z + triangle[2]!.z) / 3,
        0.25,
      )
    ))
    if (overlapsFloor) {
      removedTriangleCount += 1
      continue
    }
    kept.push(ia, ib, ic)
  }
  const clipped = new THREE.BufferGeometry()
  Object.entries(geometry.attributes).forEach(([name, attribute]) => {
    clipped.setAttribute(name, attribute)
  })
  clipped.setIndex(kept)
  clipped.computeBoundingBox()
  clipped.computeBoundingSphere()
  return {
    geometry: clipped,
    remainingTriangleCount: kept.length / 3,
    removedTriangleCount,
  }
}

export interface TerrainFlatteningRoadPoint {
  x: number
  y: number
  z: number
}

export interface TerrainFlatteningRoadConnection {
  x: number
  z: number
  y: number
  distance: number
}

export function findNearestTerrainFlatteningRoadConnection(
  rows: ReadonlyArray<TerrainFlatteningRoadPoint>,
  worldX: number,
  worldZ: number,
  surfaceLift = 0,
): TerrainFlatteningRoadConnection | null {
  if (
    !Array.isArray(rows)
    || rows.length < 2
    || !Number.isFinite(worldX)
    || !Number.isFinite(worldZ)
  ) {
    return null
  }
  const lift = Number.isFinite(surfaceLift) ? surfaceLift : 0
  let bestDistanceSquared = Number.POSITIVE_INFINITY
  let bestX = 0
  let bestZ = 0
  let bestY = 0
  for (let index = 0; index < rows.length - 1; index += 1) {
    const from = rows[index]!
    const to = rows[index + 1]!
    const dx = to.x - from.x
    const dz = to.z - from.z
    const lengthSquared = dx * dx + dz * dz
    if (
      lengthSquared <= 1e-9
      || !Number.isFinite(from.y)
      || !Number.isFinite(to.y)
    ) {
      continue
    }
    const t = Math.max(
      0,
      Math.min(1, ((worldX - from.x) * dx + (worldZ - from.z) * dz) / lengthSquared),
    )
    const x = from.x + dx * t
    const z = from.z + dz * t
    const ox = worldX - x
    const oz = worldZ - z
    const distanceSquared = ox * ox + oz * oz
    if (distanceSquared >= bestDistanceSquared) {
      continue
    }
    bestDistanceSquared = distanceSquared
    bestX = x
    bestZ = z
    bestY = from.y + (to.y - from.y) * t + lift
  }
  if (!Number.isFinite(bestDistanceSquared)) {
    return null
  }
  return {
    x: bestX,
    z: bestZ,
    y: bestY,
    distance: Math.sqrt(bestDistanceSquared),
  }
}

interface TerrainFlatteningRoadbedPriority {
  distanceAt(x: number, z: number): number
  meshHalfWidth: number
}

export interface DemTerrainFlatteningGeometryOptions {
  rawHeightAt(x: number, z: number): number | null
  hostInverse: THREE.Matrix4
  roadbed?: TerrainFlatteningRoadbedPriority | null
  maxSegmentLength?: number
  ringCount?: number
  burialDepth?: number
  coarseCellSize?: number
}

export interface DemTerrainFlatteningGeometryResult {
  geometry: THREE.BufferGeometry
  vertexCount: number
  triangleCount: number
  maxCutFill: number
}

interface ContourFramePoint {
  x: number
  z: number
  nx: number
  nz: number
}

function signedArea(contour: ReadonlyArray<FloorVertex2D>): number {
  let area = 0
  for (let index = 0; index < contour.length; index += 1) {
    const a = contour[index]!
    const b = contour[(index + 1) % contour.length]!
    area += a[0] * b[1] - b[0] * a[1]
  }
  return area * 0.5
}

function buildOutwardNormals(contour: ReadonlyArray<FloorVertex2D>): ContourFramePoint[] {
  const orientation = signedArea(contour) >= 0 ? 1 : -1
  return contour.map((point, index) => {
    const previous = contour[(index - 1 + contour.length) % contour.length]!
    const next = contour[(index + 1) % contour.length]!
    const prevDx = point[0] - previous[0]
    const prevDz = point[1] - previous[1]
    const nextDx = next[0] - point[0]
    const nextDz = next[1] - point[1]
    const prevLength = Math.hypot(prevDx, prevDz)
    const nextLength = Math.hypot(nextDx, nextDz)
    let prevNx = prevLength > 1e-8 ? orientation * prevDz / prevLength : 0
    let prevNz = prevLength > 1e-8 ? -orientation * prevDx / prevLength : 0
    let nextNx = nextLength > 1e-8 ? orientation * nextDz / nextLength : 0
    let nextNz = nextLength > 1e-8 ? -orientation * nextDx / nextLength : 0
    let nx = prevNx + nextNx
    let nz = prevNz + nextNz
    const length = Math.hypot(nx, nz)
    if (length <= 1e-8) {
      nx = nextNx || prevNx || 1
      nz = nextNz || prevNz
    } else {
      nx /= length
      nz /= length
    }
    return { x: point[0], z: point[1], nx, nz }
  })
}

function offsetContour(frame: ReadonlyArray<ContourFramePoint>, distance: number): FloorVertex2D[] {
  return frame.map((point) => [
    point.x + point.nx * distance,
    point.z + point.nz * distance,
  ])
}

function pushUpwardTriangle(
  positions: number[],
  indices: number[],
  a: number,
  b: number,
  c: number,
): void {
  const ax = positions[a * 3]!
  const az = positions[a * 3 + 2]!
  const bx = positions[b * 3]!
  const bz = positions[b * 3 + 2]!
  const cx = positions[c * 3]!
  const cz = positions[c * 3 + 2]!
  const crossY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
  if (crossY >= 0) {
    indices.push(a, b, c)
  } else {
    indices.push(a, c, b)
  }
}

function appendWorldVertex(
  positions: number[],
  uvs: number[],
  hostInverse: THREE.Matrix4,
  x: number,
  y: number,
  z: number,
): number {
  ownerPoint.set(x, y, z).applyMatrix4(hostInverse)
  positions.push(ownerPoint.x, ownerPoint.y, ownerPoint.z)
  uvs.push(x / 10, z / 10)
  return positions.length / 3 - 1
}

function createPolygonGeometry(
  target: DemTerrainFlatteningTarget,
  contour: ReadonlyArray<FloorVertex2D>,
  options: DemTerrainFlatteningGeometryOptions,
): DemTerrainFlatteningGeometryResult | null {
  if (contour.length < 3) {
    return null
  }
  const influenceWidth = target.influenceWidth
  const coarseCellSize = Math.max(0, options.coarseCellSize ?? 0)
  const coverageWidth = Math.max(
    1.5,
    Math.min(6, influenceWidth * 0.55),
    Math.min(64, coarseCellSize * 1.5),
  )
  const rowCount = Math.max(2, Math.min(10, Math.round(
    options.ringCount ?? (target.snapshot.edgeMode === 'wall' ? 4 : 7),
  )))
  const maxSegmentLength = Math.max(0.75, options.maxSegmentLength ?? 2.5)
  const burialDepth = Math.max(0, options.burialDepth ?? 0.3)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let maxCutFill = 0

  contour.forEach(([x, z]) => {
    appendWorldVertex(
      positions,
      uvs,
      options.hostInverse,
      x,
      target.terrainHeightAt(x, z),
      z,
    )
  })
  const shapeVertices = contour.map(([x, z]) => new THREE.Vector2(x, z))
  const triangles = THREE.ShapeUtils.triangulateShape(shapeVertices, [])
  triangles.forEach(([a, b, c]) => {
    if (a == null || b == null || c == null) {
      return
    }
    const midpoint = shapeVertices[a]!.clone()
      .add(shapeVertices[b]!)
      .add(shapeVertices[c]!)
      .multiplyScalar(1 / 3)
    if (
      options.roadbed
      && options.roadbed.distanceAt(midpoint.x, midpoint.y) <= options.roadbed.meshHalfWidth + 0.35
    ) {
      return
    }
    pushUpwardTriangle(positions, indices, a, b, c)
  })

  const dense: FloorVertex2D[] = []
  for (let index = 0; index < contour.length; index += 1) {
    const current = contour[index]!
    const next = contour[(index + 1) % contour.length]!
    const length = Math.hypot(next[0] - current[0], next[1] - current[1])
    const steps = Math.max(1, Math.ceil(length / maxSegmentLength))
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps
      dense.push([
        current[0] + (next[0] - current[0]) * t,
        current[1] + (next[1] - current[1]) * t,
      ])
    }
  }
  const denseFrame = buildOutwardNormals(dense)
  const rings: FloorVertex2D[][] = []
  const firstRingVertex = positions.length / 3
  for (let row = 0; row < rowCount; row += 1) {
    const t = row / (rowCount - 1)
    const ring = offsetContour(denseFrame, (influenceWidth + coverageWidth) * t)
    rings.push(ring)
    ring.forEach(([x, z]) => {
      const rawY = options.rawHeightAt(x, z)
      const safeRaw = rawY == null || !Number.isFinite(rawY) ? target.gradeY : rawY
      const desiredY = row === 0
        ? target.terrainHeightAt(x, z)
        : target.heightAt(x, z, safeRaw)
      const burial = burialDepth * smoothstep(0.7, 1, t)
      maxCutFill = Math.max(maxCutFill, Math.abs(target.targetY - safeRaw))
      appendWorldVertex(positions, uvs, options.hostInverse, x, desiredY - burial, z)
    })
  }
  const rowStride = rings[0]!.length
  for (let row = 0; row < rowCount - 1; row += 1) {
    for (let index = 0; index < rowStride; index += 1) {
      const nextIndex = (index + 1) % rowStride
      const a = firstRingVertex + row * rowStride + index
      const b = firstRingVertex + row * rowStride + nextIndex
      const c = firstRingVertex + (row + 1) * rowStride + index
      const d = firstRingVertex + (row + 1) * rowStride + nextIndex
      const currentRing = rings[row]!
      const nextRing = rings[row + 1]!
      const midpointX = (
        currentRing[index]![0]
        + currentRing[nextIndex]![0]
        + nextRing[index]![0]
        + nextRing[nextIndex]![0]
      ) * 0.25
      const midpointZ = (
        currentRing[index]![1]
        + currentRing[nextIndex]![1]
        + nextRing[index]![1]
        + nextRing[nextIndex]![1]
      ) * 0.25
      if (
        options.roadbed
        && options.roadbed.distanceAt(midpointX, midpointZ) <= options.roadbed.meshHalfWidth + 0.35
      ) {
        continue
      }
      pushUpwardTriangle(positions, indices, a, d, c)
      pushUpwardTriangle(positions, indices, a, b, d)
    }
  }
  return finishGeometry(positions, uvs, indices, maxCutFill)
}

function sampleCorridorPoints(
  chain: TerrainFlatteningCorridorChain,
  maxSegmentLength: number,
): Array<{ x: number; z: number; nx: number; nz: number }> {
  const points = chain.pointsWorldXZ
  if (points.length < 2) {
    return []
  }
  const dense: FloorVertex2D[] = []
  const segmentCount = chain.closed ? points.length : points.length - 1
  for (let index = 0; index < segmentCount; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    const length = Math.hypot(next[0] - current[0], next[1] - current[1])
    const steps = Math.max(1, Math.ceil(length / maxSegmentLength))
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps
      dense.push([
        current[0] + (next[0] - current[0]) * t,
        current[1] + (next[1] - current[1]) * t,
      ])
    }
  }
  if (!chain.closed) {
    dense.push(points[points.length - 1]!)
  }
  return dense.map((point, index) => {
    const previous = dense[(index - 1 + dense.length) % dense.length]!
    const next = dense[(index + 1) % dense.length]!
    const dx = next[0] - previous[0]
    const dz = next[1] - previous[1]
    const length = Math.hypot(dx, dz)
    return {
      x: point[0],
      z: point[1],
      nx: length > 1e-8 ? -dz / length : 1,
      nz: length > 1e-8 ? dx / length : 0,
    }
  })
}

function createCorridorGeometry(
  target: DemTerrainFlatteningTarget,
  footprint: TerrainFlatteningCorridorFootprint,
  options: DemTerrainFlatteningGeometryOptions,
): DemTerrainFlatteningGeometryResult | null {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let maxCutFill = 0
  const maxSegmentLength = Math.max(0.75, options.maxSegmentLength ?? 2.5)
  const burialDepth = Math.max(0, options.burialDepth ?? 0.3)
  const coarseCellSize = Math.max(0, options.coarseCellSize ?? 0)
  const coverageWidth = Math.max(1.5, Math.min(64, coarseCellSize * 1.5))
  const sampleHeight = (x: number, z: number, core: boolean): number => {
    if (core) {
      return target.terrainHeightAt(x, z)
    }
    const raw = options.rawHeightAt(x, z)
    const safeRaw = raw == null || !Number.isFinite(raw) ? target.gradeY : raw
    maxCutFill = Math.max(maxCutFill, Math.abs(target.targetY - safeRaw))
    return target.heightAt(x, z, safeRaw) - burialDepth
  }
  footprint.chains.forEach((chain) => {
    const samples = sampleCorridorPoints(chain, maxSegmentLength)
    if (samples.length < 2) {
      return
    }
    const outerOffset = footprint.halfWidth + target.influenceWidth + coverageWidth
    const lateral = [
      -outerOffset,
      -(footprint.halfWidth + target.influenceWidth),
      -footprint.halfWidth,
      footprint.halfWidth,
      footprint.halfWidth + target.influenceWidth,
      outerOffset,
    ]
    const rowStride = lateral.length
    const rowVertices: number[][] = []
    samples.forEach((sample) => {
      const row: number[] = []
      lateral.forEach((distance) => {
        const x = sample.x + sample.nx * distance
        const z = sample.z + sample.nz * distance
        const core = Math.abs(distance) <= footprint.halfWidth + 1e-6
        row.push(appendWorldVertex(
          positions,
          uvs,
          options.hostInverse,
          x,
          sampleHeight(x, z, core),
          z,
        ))
      })
      rowVertices.push(row)
    })
    const rowPairs = chain.closed ? samples.length : samples.length - 1
    for (let row = 0; row < rowPairs; row += 1) {
      const nextRow = (row + 1) % samples.length
      const currentSample = samples[row]!
      const nextSample = samples[nextRow]!
      if (
        options.roadbed
        && options.roadbed.distanceAt(
          (currentSample.x + nextSample.x) * 0.5,
          (currentSample.z + nextSample.z) * 0.5,
        ) <= options.roadbed.meshHalfWidth + 0.35
      ) {
        continue
      }
      for (let column = 0; column < rowStride - 1; column += 1) {
        const a = rowVertices[row]![column]!
        const b = rowVertices[row]![column + 1]!
        const c = rowVertices[nextRow]![column]!
        const d = rowVertices[nextRow]![column + 1]!
        pushUpwardTriangle(positions, indices, a, d, c)
        pushUpwardTriangle(positions, indices, a, b, d)
      }
    }
    if (!chain.closed) {
      const start = rowVertices[0]!
      const end = rowVertices[rowVertices.length - 1]!
      pushUpwardTriangle(positions, indices, start[0]!, start[2]!, start[1]!)
      pushUpwardTriangle(positions, indices, start[0]!, start[3]!, start[2]!)
      pushUpwardTriangle(positions, indices, end[0]!, end[1]!, end[2]!)
      pushUpwardTriangle(positions, indices, end[0]!, end[2]!, end[3]!)
    }
  })
  return finishGeometry(positions, uvs, indices, maxCutFill)
}

function finishGeometry(
  positions: number[],
  uvs: number[],
  indices: number[],
  maxCutFill: number,
): DemTerrainFlatteningGeometryResult | null {
  if (!positions.length || !indices.length) {
    return null
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return {
    geometry,
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
    maxCutFill,
  }
}

export function createDemTerrainFlatteningGeometry(
  target: DemTerrainFlatteningTarget,
  options: DemTerrainFlatteningGeometryOptions,
): DemTerrainFlatteningGeometryResult | null {
  return target.snapshot.footprint.kind === 'polygon'
    ? createPolygonGeometry(target, target.snapshot.footprint.contourWorldXZ, options)
    : createCorridorGeometry(target, target.snapshot.footprint, options)
}
