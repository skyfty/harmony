import * as THREE from 'three'
import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import {
  COMPONENT_ARTIFACT_COMPONENT_ID_KEY,
  COMPONENT_ARTIFACT_KEY,
  COMPONENT_ARTIFACT_NODE_ID_KEY,
  componentManager,
  type ComponentDefinition,
} from '../componentManager'
import type {
  FloorDynamicMesh,
  LandformDynamicMesh,
  RegionDynamicMesh,
  RoadDynamicMesh,
  SceneNode,
  SceneNodeComponentState,
} from '../../core'

export const PROCEDURAL_CITY_COMPONENT_TYPE = 'proceduralCity'
export const PROCEDURAL_CITY_HOST_USER_DATA_KEY = 'proceduralCityHost'
const PROCEDURAL_CITY_RUNTIME_GROUP_KEY = '__harmonyProceduralCityRuntimeGroup'

export type ProceduralCityStyle = 'office' | 'bright' | 'classic' | 'warm' | 'cool'

export const PROCEDURAL_CITY_DEFAULT_PROPS: ProceduralCityComponentProps = {
  seed: 1337,
  spacing: 3,
  inset: 1.5,
  density: 0.72,
  minWidth: 4,
  maxWidth: 10,
  minDepth: 4,
  maxDepth: 12,
  minHeight: 12,
  maxHeight: 96,
  roadSetback: 2,
  junctionSetback: 8,
  maxBuildings: 1200,
  style: 'office',
}

export interface ProceduralCityComponentProps {
  seed: number
  spacing: number
  inset: number
  density: number
  minWidth: number
  maxWidth: number
  minDepth: number
  maxDepth: number
  minHeight: number
  maxHeight: number
  roadSetback: number
  junctionSetback: number
  maxBuildings: number
  style: ProceduralCityStyle
}

type ProceduralCityHostSnapshot =
  | { type: 'Floor'; mesh: FloorDynamicMesh }
  | { type: 'Region'; mesh: RegionDynamicMesh }
  | { type: 'Road'; mesh: RoadDynamicMesh }
  | { type: 'Landform'; mesh: LandformDynamicMesh }

type ProceduralCityPolygonFootprint = {
  kind: 'polygon'
  points: THREE.Vector2[]
}

type ProceduralCityRoadFootprint = {
  kind: 'road'
  vertices: THREE.Vector2[]
  segments: Array<{ a: number; b: number }>
  width: number
  segmentHeights: number[][]
}

type ProceduralCityLandformFootprint = {
  kind: 'landform'
  points: THREE.Vector2[]
  mesh: LandformDynamicMesh
}

type ProceduralCityFootprint = ProceduralCityPolygonFootprint | ProceduralCityRoadFootprint | ProceduralCityLandformFootprint

interface ProceduralCityParcel {
  position: THREE.Vector3
  rotationY: number
  width: number
  depth: number
  height: number
  variantIndex: number
  color: THREE.Color
}

const PROCEDURAL_CITY_FLOOR_HEIGHT = 3.6
const PROCEDURAL_CITY_MIN_FLOORS = 3
const PROCEDURAL_CITY_FACADE_SOURCE_WIDTH = 128
const PROCEDURAL_CITY_FACADE_SOURCE_HEIGHT = 256
const PROCEDURAL_CITY_BUILDING_WIDTH_SCALE_MIN = 1.8
const PROCEDURAL_CITY_BUILDING_WIDTH_SCALE_MAX = 2.6
const PROCEDURAL_CITY_BUILDING_DEPTH_SCALE_MIN = 1.7
const PROCEDURAL_CITY_BUILDING_DEPTH_SCALE_MAX = 2.3
const PROCEDURAL_CITY_BUILDING_STEP_SCALE = 1.08
const PROCEDURAL_CITY_BUILDING_MARGIN_SCALE = 0.72
const PROCEDURAL_CITY_BUILDING_CLUSTER_SCALE = 0.84
const PROCEDURAL_CITY_BUILDING_LANE_SCALE = 0.94
const PROCEDURAL_CITY_BUILDING_JITTER_SCALE = 0.08
const PROCEDURAL_CITY_BUILDING_WIDTH_BIAS_MIN = 1.55
const PROCEDURAL_CITY_BUILDING_WIDTH_BIAS_MAX = 2.2
const PROCEDURAL_CITY_BUILDING_DEPTH_BIAS_MIN = 1.42
const PROCEDURAL_CITY_BUILDING_DEPTH_BIAS_MAX = 1.98
const PROCEDURAL_CITY_BUILDING_HALF_WIDTH_MAX = 3.0
const PROCEDURAL_CITY_BUILDING_HALF_DEPTH_MAX = 2.6

type ProceduralCityStyleTheme = {
  parcelPalette: string[]
  wallShades: string[]
  frameShade: string
  windowLit: string[]
  windowDark: string[]
  vertexBottomShade: number
  vertexTopShade: number
  floorBandAlpha: number
  shadowAlpha: number
  litChance: number
  alternateFloorBands: boolean
  bandTint: number
  windowGap: number
}

const PROCEDURAL_CITY_STYLE_THEMES: Record<ProceduralCityStyle, ProceduralCityStyleTheme> = {
  office: {
    parcelPalette: ['#f7f7f7', '#f4f4f4', '#f8f8f8', '#f1f1f1', '#f6f6f6', '#f3f3f3'],
    wallShades: ['#ffffff', '#f0f0f0', '#e4e4e4', '#d8d8d8'],
    frameShade: '#dcdcdc',
    windowLit: ['#f4f4f4', '#ededed', '#e6e6e6', '#f7f7f7'],
    windowDark: ['#d6d6d6', '#cbcbcb', '#c0c0c0', '#b4b4b4'],
    vertexBottomShade: 0.19,
    vertexTopShade: 1,
    floorBandAlpha: 0.0,
    shadowAlpha: 0.0,
    litChance: 0.0,
    alternateFloorBands: true,
    bandTint: 0.0,
    windowGap: 0.02,
  },
  bright: {
    parcelPalette: ['#dcd9cf', '#d5dde2', '#e1d7c7', '#d7e0e4', '#e0d0c8', '#d3dfdb'],
    wallShades: ['#88929c', '#95a0a8', '#a3adb4', '#b0b8be'],
    frameShade: '#56606a',
    windowLit: ['#f7fafc', '#fff6d4', '#eef7ff', '#f9ebbd'],
    windowDark: ['#66717b', '#727d86', '#7d8790', '#88929b'],
    vertexBottomShade: 0.7,
    vertexTopShade: 1,
    floorBandAlpha: 0.12,
    shadowAlpha: 0.08,
    litChance: 0.24,
    alternateFloorBands: false,
    bandTint: 0.03,
    windowGap: 0.2,
  },
  classic: {
    parcelPalette: ['#cfc8bc', '#bec7cd', '#d3c5b4', '#c6d0d4', '#d1c0b5', '#c1cdca'],
    wallShades: ['#7d8790', '#89939b', '#949ea6', '#a1aab1'],
    frameShade: '#4f5861',
    windowLit: ['#f0f4f7', '#fcefb8', '#e4eff9', '#f4e4a8'],
    windowDark: ['#5e6871', '#6b747d', '#768088', '#818a92'],
    vertexBottomShade: 0.62,
    vertexTopShade: 0.98,
    floorBandAlpha: 0.1,
    shadowAlpha: 0.1,
    litChance: 0.3,
    alternateFloorBands: false,
    bandTint: 0.025,
    windowGap: 0.2,
  },
  warm: {
    parcelPalette: ['#dfd2c0', '#d9c7b1', '#e4d7c6', '#d8cec1', '#e1cdbb', '#d2d4cd'],
    wallShades: ['#8e867c', '#9a9185', '#a69d92', '#b3a99d'],
    frameShade: '#665a50',
    windowLit: ['#fff4dc', '#fce4b8', '#fff1c6', '#fde8ad'],
    windowDark: ['#786d61', '#85796d', '#918478', '#9d8f83'],
    vertexBottomShade: 0.66,
    vertexTopShade: 0.98,
    floorBandAlpha: 0.12,
    shadowAlpha: 0.08,
    litChance: 0.28,
    alternateFloorBands: false,
    bandTint: 0.025,
    windowGap: 0.2,
  },
  cool: {
    parcelPalette: ['#d8dee6', '#ced8df', '#e0e6eb', '#d3dce3', '#dee4ea', '#cfd8d6'],
    wallShades: ['#87939d', '#95a0aa', '#a1adb6', '#aeb8c1'],
    frameShade: '#52606a',
    windowLit: ['#eef7ff', '#f9fbfd', '#dceeff', '#f2f7fb'],
    windowDark: ['#67727c', '#73808a', '#7f8a94', '#8b96a0'],
    vertexBottomShade: 0.68,
    vertexTopShade: 1,
    floorBandAlpha: 0.11,
    shadowAlpha: 0.07,
    litChance: 0.26,
    alternateFloorBands: false,
    bandTint: 0.03,
    windowGap: 0.2,
  },
}

function resolveProceduralCityStyle(style: unknown): ProceduralCityStyle {
  if (style === 'office' || style === 'bright' || style === 'classic' || style === 'warm' || style === 'cool') {
    return style as ProceduralCityStyle
  }
  return 'bright'
}

function getProceduralCityStyleTheme(style: unknown): ProceduralCityStyleTheme {
  return PROCEDURAL_CITY_STYLE_THEMES[resolveProceduralCityStyle(style)]
}

function finiteNumber(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finiteNumber(value, fallback)))
}

function normalizeRange(minValue: number, maxValue: number, minimumGap: number): { min: number; max: number } {
  if (maxValue < minValue + minimumGap) {
    return { min: minValue, max: minValue + minimumGap }
  }
  return { min: minValue, max: maxValue }
}

function configureCityTexture(texture: THREE.Texture): THREE.Texture {
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.anisotropy = 8
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = true
  return texture
}

function toFiniteNumber(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizePolygonVertices(values: unknown): THREE.Vector2[] {
  if (!Array.isArray(values)) {
    return []
  }
  const out: THREE.Vector2[] = []
  values.forEach((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) {
      return
    }
    const x = toFiniteNumber(entry[0])
    const z = toFiniteNumber(entry[1])
    if (x === null || z === null) {
      return
    }
    const point = new THREE.Vector2(x, z)
    const previous = out[out.length - 1]
    if (previous && previous.distanceToSquared(point) <= 1e-10) {
      return
    }
    out.push(point)
  })
  if (out.length >= 2 && out[0]!.distanceToSquared(out[out.length - 1]!) <= 1e-10) {
    out.pop()
  }
  return out
}

function normalizeIndexedVertices(values: unknown): THREE.Vector2[] {
  if (!Array.isArray(values)) {
    return []
  }
  return values.map((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) {
      return null
    }
    const x = toFiniteNumber(entry[0])
    const z = toFiniteNumber(entry[1])
    if (x === null || z === null) {
      return null
    }
    return new THREE.Vector2(x, z)
  }).filter((entry): entry is THREE.Vector2 => !!entry)
}

function cloneRoadSegment(value: unknown): { a: number; b: number } | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const a = Math.trunc(Number((value as { a?: unknown }).a))
  const b = Math.trunc(Number((value as { b?: unknown }).b))
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0 || a === b) {
    return null
  }
  return { a, b }
}

export function cloneProceduralCityHostSnapshot(dynamicMesh: unknown): ProceduralCityHostSnapshot | null {
  if (!dynamicMesh || typeof dynamicMesh !== 'object') {
    return null
  }
  const type = (dynamicMesh as { type?: unknown }).type
  if (type === 'Floor') {
    const source = dynamicMesh as FloorDynamicMesh
    const vertices = normalizePolygonVertices(source.vertices).map((point) => [point.x, point.y] as [number, number])
    return vertices.length >= 3
      ? { type: 'Floor', mesh: { ...source, type: 'Floor', vertices } }
      : null
  }
  if (type === 'Region') {
    const source = dynamicMesh as RegionDynamicMesh
    const vertices = normalizePolygonVertices(source.vertices).map((point) => [point.x, point.y] as [number, number])
    return vertices.length >= 3
      ? { type: 'Region', mesh: { type: 'Region', vertices } }
      : null
  }
  if (type === 'Road') {
    const source = dynamicMesh as RoadDynamicMesh
    const vertices = normalizeIndexedVertices(source.vertices).map((point) => [point.x, point.y] as [number, number])
    const segments = Array.isArray(source.segments)
      ? source.segments.map(cloneRoadSegment).filter((segment): segment is { a: number; b: number } => !!segment)
      : []
    const segmentHeights = Array.isArray(source.segmentHeights)
      ? source.segmentHeights.map((entry) => Array.isArray(entry) ? entry.map(Number).filter(Number.isFinite) : [])
      : []
    const width = Number.isFinite(source.width) ? Math.max(0.01, source.width) : 2
    return vertices.length >= 2 && segments.length
      ? { type: 'Road', mesh: { type: 'Road', width, vertices, segments, segmentHeights } }
      : null
  }
  if (type === 'Landform') {
    const source = dynamicMesh as LandformDynamicMesh
    const vertices = normalizePolygonVertices(source.vertices).map((point) => [point.x, point.y] as [number, number])
    const renderCache = source.renderCache && typeof source.renderCache === 'object'
      ? {
          surfaceVertices: Array.isArray(source.renderCache.surfaceVertices)
            ? source.renderCache.surfaceVertices.map((entry) => {
                const vector = toFiniteVector3(entry)
                return vector ? { x: vector.x, y: vector.y, z: vector.z } : null
              }).filter((entry): entry is { x: number; y: number; z: number } => Boolean(entry))
            : [],
          surfaceIndices: Array.isArray(source.renderCache.surfaceIndices)
            ? source.renderCache.surfaceIndices.map((entry) => Math.trunc(Number(entry))).filter((entry) => Number.isInteger(entry) && entry >= 0)
            : [],
          surfaceUvs: Array.isArray(source.renderCache.surfaceUvs)
            ? source.renderCache.surfaceUvs.map((entry) => {
                const x = Number((entry as { x?: unknown }).x)
                const y = Number((entry as { y?: unknown }).y)
                return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
              }).filter((entry): entry is { x: number; y: number } => Boolean(entry))
            : [],
          surfaceFeather: Array.isArray(source.renderCache.surfaceFeather)
            ? source.renderCache.surfaceFeather.map((entry) => Number(entry)).filter(Number.isFinite)
            : [],
          surfaceGroundUvs: Array.isArray(source.renderCache.surfaceGroundUvs)
            ? source.renderCache.surfaceGroundUvs.map((entry) => {
                const x = Number((entry as { x?: unknown }).x)
                const y = Number((entry as { y?: unknown }).y)
                return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
              }).filter((entry): entry is { x: number; y: number } => Boolean(entry))
            : [],
          groundTextureDataUrl: typeof source.renderCache.groundTextureDataUrl === 'string'
            ? source.renderCache.groundTextureDataUrl
            : null,
        }
      : null
    return vertices.length >= 3
      ? {
          type: 'Landform',
          mesh: {
            ...source,
            type: 'Landform',
            vertices,
            renderCache,
          },
        }
      : null
  }
  return null
}

function resolveProceduralCityFootprint(snapshot: ProceduralCityHostSnapshot | null | undefined): ProceduralCityFootprint | null {
  if (!snapshot) {
    return null
  }
  if (snapshot.type === 'Floor' || snapshot.type === 'Region') {
    const points = normalizePolygonVertices(snapshot.mesh.vertices)
    return points.length >= 3 ? { kind: 'polygon', points } : null
  }
  if (snapshot.type === 'Landform') {
    const points = normalizePolygonVertices(snapshot.mesh.vertices)
    return points.length >= 3 ? { kind: 'landform', points, mesh: snapshot.mesh } : null
  }
  const vertices = normalizeIndexedVertices(snapshot.mesh.vertices)
  const segments = snapshot.mesh.segments
    .map(cloneRoadSegment)
    .filter((segment): segment is { a: number; b: number } => !!segment && !!vertices[segment.a] && !!vertices[segment.b])
  return vertices.length >= 2 && segments.length
    ? {
      kind: 'road',
      vertices,
      segments,
      width: Number.isFinite(snapshot.mesh.width) ? Math.max(0.01, snapshot.mesh.width) : 2,
      segmentHeights: Array.isArray(snapshot.mesh.segmentHeights) ? snapshot.mesh.segmentHeights : [],
    }
    : null
}

function createProceduralCityRandom(seed: number): () => number {
  let state = (Math.trunc(seed) >>> 0) || 0x9e3779b9
  return () => {
    state += 0x6d2b79f5
    let next = state
    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

function randomRange(random: () => number, min: number, max: number): number {
  return min + (max - min) * random()
}

function hashUint32(value: number): number {
  let x = value >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b)
  x ^= x >>> 16
  return x >>> 0
}

function hash2D(seed: number, x: number, y: number): number {
  const combined = Math.imul((x | 0) ^ Math.imul(y | 0, 374761393), 668265263) ^ (seed | 0)
  return hashUint32(combined) / 4294967296
}

function polygonArea(points: THREE.Vector2[]): number {
  let area = 0
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[previous]!
    const b = points[index]!
    area += a.x * b.y - b.x * a.y
  }
  return area * 0.5
}

function isPointInsidePolygon(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
  let inside = false
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index++) {
    const a = polygon[index]!
    const b = polygon[previousIndex]!
    const intersects = ((a.y > point.y) !== (b.y > point.y))
      && (point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || Number.EPSILON) + a.x)
    if (intersects) {
      inside = !inside
    }
  }
  return inside
}

function resolveLongestEdgeAngle(points: THREE.Vector2[]): number {
  let bestLengthSq = -1
  let bestAngle = 0
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!
    const b = points[(index + 1) % points.length]!
    const dx = b.x - a.x
    const dz = b.y - a.y
    const lengthSq = dx * dx + dz * dz
    if (lengthSq > bestLengthSq) {
      bestLengthSq = lengthSq
      bestAngle = Math.atan2(dz, dx)
    }
  }
  return bestAngle
}

function resolvePolygonSurfaceHeight(snapshot: ProceduralCityHostSnapshot): number {
  if (snapshot.type === 'Floor') {
    return Number.isFinite(snapshot.mesh.thickness) ? Math.max(0, snapshot.mesh.thickness ?? 0) : 0
  }
  return 0
}

const proceduralCityMountPosition = new THREE.Vector3()
const proceduralCityMountQuaternion = new THREE.Quaternion()
const proceduralCityMountScale = new THREE.Vector3()

function resolveProceduralCityMountObject(host: Object3D, snapshot: ProceduralCityHostSnapshot): Object3D {
  if (snapshot.type === 'Landform') {
    let current: Object3D = host
    while (current.parent) {
      current = current.parent
    }
    return current
  }
  const parent = host.parent
  return parent ?? host
}

function copyWorldTransform(source: Object3D, target: Object3D): void {
  source.updateMatrixWorld(true)
  source.matrixWorld.decompose(proceduralCityMountPosition, proceduralCityMountQuaternion, proceduralCityMountScale)
  target.position.copy(proceduralCityMountPosition)
  target.quaternion.copy(proceduralCityMountQuaternion)
  target.scale.copy(proceduralCityMountScale)
}

function toFiniteVector3(entry: unknown): THREE.Vector3 | null {
  if (!entry || typeof entry !== 'object') {
    return null
  }
  const source = entry as { x?: unknown; y?: unknown; z?: unknown }
  const x = Number(source.x)
  const y = Number(source.y)
  const z = Number(source.z)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null
  }
  return new THREE.Vector3(x, y, z)
}

function sampleTriangleSurfaceHeight(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  x: number,
  z: number,
): number | null {
  const v0x = b.x - a.x
  const v0z = b.z - a.z
  const v1x = c.x - a.x
  const v1z = c.z - a.z
  const v2x = x - a.x
  const v2z = z - a.z
  const den = v0x * v1z - v1x * v0z
  if (Math.abs(den) <= 1e-8) {
    return null
  }
  const invDen = 1 / den
  const u = (v2x * v1z - v1x * v2z) * invDen
  const v = (v0x * v2z - v2x * v0z) * invDen
  const w = 1 - u - v
  if (u < -1e-4 || v < -1e-4 || w < -1e-4) {
    return null
  }
  return a.y * w + b.y * u + c.y * v
}

function sampleLandformHeight(mesh: LandformDynamicMesh, x: number, z: number): number {
  const renderCache = mesh.renderCache ?? null
  const vertices = Array.isArray(renderCache?.surfaceVertices)
    ? renderCache!.surfaceVertices.map(toFiniteVector3).filter((entry): entry is THREE.Vector3 => Boolean(entry))
    : []
  const indices = Array.isArray(renderCache?.surfaceIndices)
    ? renderCache!.surfaceIndices.map((entry) => Math.trunc(Number(entry))).filter((entry) => Number.isInteger(entry) && entry >= 0)
    : []
  if (vertices.length >= 3 && indices.length >= 3) {
    let bestDistanceSq = Number.POSITIVE_INFINITY
    let bestHeight = 0
    for (let index = 0; index < indices.length; index += 3) {
      const a = vertices[indices[index] ?? -1]
      const b = vertices[indices[index + 1] ?? -1]
      const c = vertices[indices[index + 2] ?? -1]
      if (!a || !b || !c) {
        continue
      }
      const sample = sampleTriangleSurfaceHeight(a, b, c, x, z)
      if (sample !== null) {
        return sample
      }
      const centroidX = (a.x + b.x + c.x) / 3
      const centroidZ = (a.z + b.z + c.z) / 3
      const dx = centroidX - x
      const dz = centroidZ - z
      const distanceSq = dx * dx + dz * dz
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq
        bestHeight = (a.y + b.y + c.y) / 3
      }
    }
    return bestHeight
  }

  const fallbackHeights = Array.isArray(mesh.vertexHeights) ? mesh.vertexHeights : []
  if (!fallbackHeights.length) {
    return 0
  }
  let sum = 0
  let count = 0
  fallbackHeights.forEach((value) => {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      sum += numeric
      count += 1
    }
  })
  return count > 0 ? sum / count : 0
}

function sampleLandformParcelSurfaceHeight(
  mesh: LandformDynamicMesh,
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
  rotationY: number,
): number {
  let surfaceY = sampleLandformHeight(mesh, centerX, centerZ)
  const halfWidth = width * 0.5
  const halfDepth = depth * 0.5
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  const offsets = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [halfWidth, halfDepth],
    [-halfWidth, halfDepth],
  ] as const
  offsets.forEach(([dx, dz]) => {
    const worldX = centerX + dx * cos - dz * sin
    const worldZ = centerZ + dx * sin + dz * cos
    surfaceY = Math.max(surfaceY, sampleLandformHeight(mesh, worldX, worldZ))
  })
  return surfaceY
}

function rotate2(point: THREE.Vector2, angle: number): THREE.Vector2 {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return new THREE.Vector2(point.x * cos - point.y * sin, point.x * sin + point.y * cos)
}

function createParcelColor(random: () => number, style: ProceduralCityStyle): THREE.Color {
  if (style === 'office') {
    const value = 1 - random() * random()
    return new THREE.Color(
      value + random() * 0.1,
      value,
      value + random() * 0.1,
    )
  }
  const theme = getProceduralCityStyleTheme(style)
  const base = new THREE.Color(theme.parcelPalette[Math.floor(random() * theme.parcelPalette.length)]!)
  base.offsetHSL(
    randomRange(random, -0.014, 0.014),
    randomRange(random, -0.04, 0.02),
    randomRange(random, -0.06, 0.08),
  )
  base.lerp(new THREE.Color('#ffffff'), randomRange(random, 0.05, 0.14))
  return base
}

function createParcel(
  random: () => number,
  props: ProceduralCityComponentProps,
  position: THREE.Vector3,
  rotationY: number,
): ProceduralCityParcel {
  const width = randomRange(random, props.minWidth, props.maxWidth) * randomRange(random, PROCEDURAL_CITY_BUILDING_WIDTH_SCALE_MIN, PROCEDURAL_CITY_BUILDING_WIDTH_SCALE_MAX)
  const depth = randomRange(random, props.minDepth, props.maxDepth) * randomRange(random, PROCEDURAL_CITY_BUILDING_DEPTH_SCALE_MIN, PROCEDURAL_CITY_BUILDING_DEPTH_SCALE_MAX)
  const minFloors = Math.max(PROCEDURAL_CITY_MIN_FLOORS, Math.ceil(props.minHeight / PROCEDURAL_CITY_FLOOR_HEIGHT))
  const maxFloors = Math.max(minFloors, Math.floor(props.maxHeight / PROCEDURAL_CITY_FLOOR_HEIGHT))
  const floorMix = Math.pow(random(), 1.3)
  const floors = minFloors + Math.floor(floorMix * (maxFloors - minFloors + 1))
  const roofHeight = randomRange(random, 0.4, 1.8)
  const towerBonus = random() > 0.9 ? randomRange(random, 0.8, 3.5) : 0
  const height = Math.max(props.minHeight, floors * PROCEDURAL_CITY_FLOOR_HEIGHT + roofHeight + towerBonus)
  return {
    position,
    rotationY,
    width,
    depth,
    height,
    variantIndex: Math.floor(random() * 12),
    color: createParcelColor(random, props.style),
  }
}

function generatePolygonParcels(
  points: THREE.Vector2[],
  props: ProceduralCityComponentProps,
  random: () => number,
  surfaceY: number,
): ProceduralCityParcel[] {
  if (points.length < 3 || Math.abs(polygonArea(points)) <= 1e-5) {
    return []
  }

  const angle = resolveLongestEdgeAngle(points)
  const inverse = -angle
  const rotated = points.map((point) => rotate2(point, inverse))
  const min = new THREE.Vector2(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  const max = new THREE.Vector2(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)
  rotated.forEach((point) => {
    min.x = Math.min(min.x, point.x)
    min.y = Math.min(min.y, point.y)
    max.x = Math.max(max.x, point.x)
    max.y = Math.max(max.y, point.y)
  })

  const parcels: ProceduralCityParcel[] = []
  const stepScale = PROCEDURAL_CITY_BUILDING_STEP_SCALE
  const stepX = Math.max(props.spacing * stepScale, props.maxWidth * 1.15 + props.spacing * stepScale)
  const stepZ = Math.max(props.spacing * stepScale, props.maxDepth * 1.15 + props.spacing * stepScale)
  const margin = props.inset * PROCEDURAL_CITY_BUILDING_MARGIN_SCALE
  const coarseCellX = Math.max(stepX * 2.1, 11)
  const coarseCellZ = Math.max(stepZ * 2.1, 11)
  const centerX = (min.x + max.x) * 0.5
  const centerZ = (min.y + max.y) * 0.5
  for (let z = min.y + margin + stepZ * 0.5; z <= max.y - margin; z += stepZ) {
    for (let x = min.x + margin + stepX * 0.5; x <= max.x - margin; x += stepX) {
      if (parcels.length >= props.maxBuildings) {
        return parcels
      }
      const cellX = Math.floor((x - min.x) / stepX)
      const cellZ = Math.floor((z - min.y) / stepZ)
      const cluster = PROCEDURAL_CITY_BUILDING_CLUSTER_SCALE + hash2D(Math.trunc(props.seed) ^ 0x51a7, Math.floor((x - centerX) / coarseCellX), Math.floor((z - centerZ) / coarseCellZ)) * 0.34
      const lane = PROCEDURAL_CITY_BUILDING_LANE_SCALE + hash2D(Math.trunc(props.seed) ^ 0x2d91, cellX, cellZ) * 0.12
      if (random() > props.density * cluster * lane) {
        continue
      }
      const jitterScale = PROCEDURAL_CITY_BUILDING_JITTER_SCALE
      const jitterX = (hash2D(Math.trunc(props.seed) ^ 0x7f4a, cellX, cellZ) - 0.5) * stepX * jitterScale
      const jitterZ = (hash2D(Math.trunc(props.seed) ^ 0x1c93, cellX, cellZ) - 0.5) * stepZ * jitterScale
      const local = rotate2(new THREE.Vector2(x + jitterX, z + jitterZ), angle)
      const widthBias = PROCEDURAL_CITY_BUILDING_WIDTH_BIAS_MIN + hash2D(Math.trunc(props.seed) ^ 0x3ab1, cellX, cellZ) * (PROCEDURAL_CITY_BUILDING_WIDTH_BIAS_MAX - PROCEDURAL_CITY_BUILDING_WIDTH_BIAS_MIN)
      const depthBias = PROCEDURAL_CITY_BUILDING_DEPTH_BIAS_MIN + hash2D(Math.trunc(props.seed) ^ 0x63c5, cellX, cellZ) * (PROCEDURAL_CITY_BUILDING_DEPTH_BIAS_MAX - PROCEDURAL_CITY_BUILDING_DEPTH_BIAS_MIN)
      const halfX = Math.min(props.maxWidth * PROCEDURAL_CITY_BUILDING_HALF_WIDTH_MAX, stepX * widthBias - props.spacing * 0.02) * 0.5
      const halfZ = Math.min(props.maxDepth * PROCEDURAL_CITY_BUILDING_HALF_DEPTH_MAX, stepZ * depthBias - props.spacing * 0.02) * 0.5
      const corners = [
        rotate2(new THREE.Vector2(local.x - halfX, local.y - halfZ), 0),
        rotate2(new THREE.Vector2(local.x + halfX, local.y - halfZ), 0),
        rotate2(new THREE.Vector2(local.x + halfX, local.y + halfZ), 0),
        rotate2(new THREE.Vector2(local.x - halfX, local.y + halfZ), 0),
      ]
      if (!isPointInsidePolygon(local, points) || !corners.every((corner) => isPointInsidePolygon(corner, points))) {
        continue
      }
      parcels.push(createParcel(random, props, new THREE.Vector3(local.x, surfaceY, local.y), -angle))
    }
  }
  return parcels
}

function sampleSegmentHeight(heights: number[] | undefined, t: number): number {
  if (!heights?.length) {
    return 0
  }
  if (heights.length === 1) {
    return Number.isFinite(heights[0]) ? heights[0]! : 0
  }
  const scaled = t * (heights.length - 1)
  const index = Math.min(heights.length - 2, Math.max(0, Math.floor(scaled)))
  const alpha = scaled - index
  const a = Number.isFinite(heights[index]) ? heights[index]! : 0
  const b = Number.isFinite(heights[index + 1]) ? heights[index + 1]! : a
  return a + (b - a) * alpha
}

function buildRoadEndpointCounts(road: ProceduralCityRoadFootprint): Map<number, number> {
  const counts = new Map<number, number>()
  road.segments.forEach((segment) => {
    counts.set(segment.a, (counts.get(segment.a) ?? 0) + 1)
    counts.set(segment.b, (counts.get(segment.b) ?? 0) + 1)
  })
  return counts
}

function generateRoadParcels(
  road: ProceduralCityRoadFootprint,
  props: ProceduralCityComponentProps,
  random: () => number,
): ProceduralCityParcel[] {
  const parcels: ProceduralCityParcel[] = []
  const endpointCounts = buildRoadEndpointCounts(road)
  const baseStep = Math.max(props.spacing, props.maxWidth + props.spacing)
  const lateralDistance = road.width * 0.5 + props.roadSetback + props.maxDepth * 0.5
  for (let segmentIndex = 0; segmentIndex < road.segments.length; segmentIndex += 1) {
    const segment = road.segments[segmentIndex]!
    const a = road.vertices[segment.a]
    const b = road.vertices[segment.b]
    if (!a || !b) {
      continue
    }
    const direction = b.clone().sub(a)
    const length = direction.length()
    if (length <= baseStep) {
      continue
    }
    direction.divideScalar(length)
    const normal = new THREE.Vector2(-direction.y, direction.x)
    const startGap = endpointCounts.get(segment.a)! > 1 ? props.junctionSetback : props.junctionSetback * 0.5
    const endGap = endpointCounts.get(segment.b)! > 1 ? props.junctionSetback : props.junctionSetback * 0.5
    let distance = startGap + baseStep * (0.45 + hash2D(Math.trunc(props.seed) ^ 0x118b, segment.a, segment.b) * 0.2)
    let slotIndex = 0
    while (distance <= length - endGap) {
      const t = distance / length
      const center = a.clone().lerp(b, t)
      const height = sampleSegmentHeight(road.segmentHeights[segmentIndex], t)
      for (const side of [-1, 1]) {
        if (parcels.length >= props.maxBuildings) {
          return parcels
        }
        if (random() > props.density) {
          continue
        }
        const lateralJitter = (hash2D(Math.trunc(props.seed) ^ 0x214b, segmentIndex, slotIndex * 2 + (side > 0 ? 1 : 0)) - 0.5) * props.maxDepth * 0.35
        const offset = normal.clone().multiplyScalar(lateralDistance * side + lateralJitter)
        parcels.push(createParcel(
          random,
          props,
          new THREE.Vector3(center.x + offset.x, height, center.y + offset.y),
          -Math.atan2(direction.y, direction.x),
        ))
      }
      const stepJitter = 0.72 + hash2D(Math.trunc(props.seed) ^ 0x5c31, segmentIndex, slotIndex) * 0.75
      distance += baseStep * stepJitter
      slotIndex += 1
    }
  }
  return parcels
}

function generateLandformParcels(
  footprint: ProceduralCityLandformFootprint,
  props: ProceduralCityComponentProps,
  random: () => number,
): ProceduralCityParcel[] {
  if (footprint.points.length < 3 || Math.abs(polygonArea(footprint.points)) <= 1e-5) {
    return []
  }

  const angle = resolveLongestEdgeAngle(footprint.points)
  const inverse = -angle
  const rotated = footprint.points.map((point) => rotate2(point, inverse))
  const min = new THREE.Vector2(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  const max = new THREE.Vector2(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)
  rotated.forEach((point) => {
    min.x = Math.min(min.x, point.x)
    min.y = Math.min(min.y, point.y)
    max.x = Math.max(max.x, point.x)
    max.y = Math.max(max.y, point.y)
  })

  const parcels: ProceduralCityParcel[] = []
  const stepScale = PROCEDURAL_CITY_BUILDING_STEP_SCALE
  const stepX = Math.max(props.spacing * stepScale, props.maxWidth * 1.15 + props.spacing * stepScale)
  const stepZ = Math.max(props.spacing * stepScale, props.maxDepth * 1.15 + props.spacing * stepScale)
  const margin = props.inset * PROCEDURAL_CITY_BUILDING_MARGIN_SCALE
  for (let z = min.y + margin + stepZ * 0.5; z <= max.y - margin; z += stepZ) {
    for (let x = min.x + margin + stepX * 0.5; x <= max.x - margin; x += stepX) {
      if (parcels.length >= props.maxBuildings) {
        return parcels
      }
      if (random() > props.density) {
        continue
      }
      const cellX = Math.floor((x - min.x) / stepX)
      const cellZ = Math.floor((z - min.y) / stepZ)
      const cluster = PROCEDURAL_CITY_BUILDING_CLUSTER_SCALE + hash2D(Math.trunc(props.seed) ^ 0x51a7, Math.floor((x - (min.x + max.x) * 0.5) / Math.max(stepX * 2.1, 11)), Math.floor((z - (min.y + max.y) * 0.5) / Math.max(stepZ * 2.1, 11))) * 0.32
      const lane = PROCEDURAL_CITY_BUILDING_LANE_SCALE + hash2D(Math.trunc(props.seed) ^ 0x2d91, cellX, cellZ) * 0.12
      if (random() > props.density * cluster * lane) {
        continue
      }
      const jitterScale = PROCEDURAL_CITY_BUILDING_JITTER_SCALE
      const jitterX = (hash2D(Math.trunc(props.seed) ^ 0x7f4a, cellX, cellZ) - 0.5) * stepX * jitterScale
      const jitterZ = (hash2D(Math.trunc(props.seed) ^ 0x1c93, cellX, cellZ) - 0.5) * stepZ * jitterScale
      const local = rotate2(new THREE.Vector2(x + jitterX, z + jitterZ), angle)
      const widthBias = PROCEDURAL_CITY_BUILDING_WIDTH_BIAS_MIN + hash2D(Math.trunc(props.seed) ^ 0x3ab1, cellX, cellZ) * (PROCEDURAL_CITY_BUILDING_WIDTH_BIAS_MAX - PROCEDURAL_CITY_BUILDING_WIDTH_BIAS_MIN)
      const depthBias = PROCEDURAL_CITY_BUILDING_DEPTH_BIAS_MIN + hash2D(Math.trunc(props.seed) ^ 0x63c5, cellX, cellZ) * (PROCEDURAL_CITY_BUILDING_DEPTH_BIAS_MAX - PROCEDURAL_CITY_BUILDING_DEPTH_BIAS_MIN)
      const halfX = Math.min(props.maxWidth * PROCEDURAL_CITY_BUILDING_HALF_WIDTH_MAX, stepX * widthBias - props.spacing * 0.02) * 0.5
      const halfZ = Math.min(props.maxDepth * PROCEDURAL_CITY_BUILDING_HALF_DEPTH_MAX, stepZ * depthBias - props.spacing * 0.02) * 0.5
      const corners = [
        rotate2(new THREE.Vector2(local.x - halfX, local.y - halfZ), 0),
        rotate2(new THREE.Vector2(local.x + halfX, local.y - halfZ), 0),
        rotate2(new THREE.Vector2(local.x + halfX, local.y + halfZ), 0),
        rotate2(new THREE.Vector2(local.x - halfX, local.y + halfZ), 0),
      ]
      if (!isPointInsidePolygon(local, footprint.points) || !corners.every((corner) => isPointInsidePolygon(corner, footprint.points))) {
        continue
      }
      const worldX = local.x
      const worldZ = local.y
      const rotationY = -angle
      const surfaceY = sampleLandformParcelSurfaceHeight(
        footprint.mesh,
        worldX,
        worldZ,
        Math.max(props.minWidth, halfX * 2),
        Math.max(props.minDepth, halfZ * 2),
        rotationY,
      )
      parcels.push(createParcel(
        random,
        props,
        new THREE.Vector3(worldX, surfaceY, worldZ),
        rotationY,
      ))
    }
  }

  return parcels
}

function generateProceduralCityParcels(
  footprint: ProceduralCityFootprint,
  props: ProceduralCityComponentProps,
  surfaceY: number,
): ProceduralCityParcel[] {
  const random = createProceduralCityRandom(props.seed)
  if (footprint.kind === 'polygon') {
    return generatePolygonParcels(footprint.points, props, random, surfaceY)
  }
  if (footprint.kind === 'landform') {
    return generateLandformParcels(footprint, props, random)
  }
  return generateRoadParcels(footprint, props, random)
}

const BUILDING_VARIANT_COUNT = 12
const PROCEDURAL_CITY_TILE_SIZE = 48
const facadeTextureByStyle = new Map<ProceduralCityStyle, THREE.Texture>()
const wallMaterialByStyle = new Map<ProceduralCityStyle, THREE.MeshLambertMaterial>()
const archetypesByStyle = new Map<ProceduralCityStyle, Array<{ geometry: THREE.BufferGeometry }>>()

function loadFacadeTexture(style: unknown): THREE.Texture {
  const resolvedStyle = resolveProceduralCityStyle(style)
  const cachedTexture = facadeTextureByStyle.get(resolvedStyle)
  if (cachedTexture) {
    return cachedTexture
  }
  const theme = getProceduralCityStyleTheme(resolvedStyle)
  if (typeof document !== 'undefined') {
    if (resolvedStyle === 'office') {
      const canvas = document.createElement('canvas')
      canvas.width = 32
      canvas.height = 64
      const context = canvas.getContext('2d')!
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      let seed = 0x2f6e2b1
      const nextRandom = () => {
        seed = (Math.imul(seed ^ (seed >>> 15), seed | 1) + 0x6d2b79f5) | 0
        return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296
      }
      for (let y = 2; y < canvas.height; y += 2) {
        for (let x = 0; x < canvas.width; x += 2) {
          const value = Math.floor(nextRandom() * 64)
          context.fillStyle = `rgb(${value}, ${value}, ${value})`
          context.fillRect(x, y, 2, 1)
        }
      }
      const upscale = document.createElement('canvas')
      upscale.width = 512
      upscale.height = 1024
      const upscaleContext = upscale.getContext('2d')!
      upscaleContext.imageSmoothingEnabled = false
      upscaleContext.drawImage(canvas, 0, 0, upscale.width, upscale.height)
      const texture = configureCityTexture(new THREE.CanvasTexture(upscale))
      texture.needsUpdate = true
      facadeTextureByStyle.set(resolvedStyle, texture)
      return texture
    }
    const canvas = document.createElement('canvas')
    canvas.width = PROCEDURAL_CITY_FACADE_SOURCE_WIDTH
    canvas.height = PROCEDURAL_CITY_FACADE_SOURCE_HEIGHT
    const context = canvas.getContext('2d')!
    context.fillStyle = theme.wallShades[0]!
    context.fillRect(0, 0, canvas.width, canvas.height)
    let seed = 0x2f6e2b1
    const nextRandom = () => {
      seed = (Math.imul(seed ^ (seed >>> 15), seed | 1) + 0x6d2b79f5) | 0
      return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296
    }
    const floorHeight = 18
    const columnCount = 6
    const wallShades = theme.wallShades
    const frameShade = theme.frameShade
    const windowLit = theme.windowLit
    const windowDark = theme.windowDark
    const officeStyle = style === 'office'
    for (let y = 0; y < canvas.height; y += floorHeight) {
      const bandIndex = Math.floor(nextRandom() * wallShades.length)
      const bandShade = wallShades[bandIndex]!
      context.fillStyle = bandShade
      context.fillRect(0, y, canvas.width, floorHeight)
      if (theme.alternateFloorBands && (Math.floor(y / floorHeight) % 2 === 1)) {
        context.fillStyle = officeStyle
          ? `rgba(255,255,255,${theme.bandTint})`
          : `rgba(255,255,255,${theme.bandTint})`
        context.fillRect(0, y, canvas.width, floorHeight)
      }
      context.fillStyle = `rgba(255,255,255,${theme.floorBandAlpha})`
      context.fillRect(0, y, canvas.width, 1)
      context.fillStyle = officeStyle ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.035)'
      context.fillRect(0, y + floorHeight - 1, canvas.width, 1)
      const innerHeight = officeStyle ? floorHeight - 8 : floorHeight - 4
      const innerY = officeStyle ? y + 4 : y + 2
      for (let column = 0; column < columnCount; column += 1) {
        const span = canvas.width / columnCount
        const windowWidth = Math.max(4, Math.floor(span * (officeStyle ? 0.16 : 0.24) + nextRandom() * span * theme.windowGap))
        const windowHeight = Math.max(3, Math.floor(innerHeight * (officeStyle ? 0.5 : 0.7 + nextRandom() * 0.12)))
        const offsetX = Math.floor(span * (officeStyle ? 0.18 : 0.14) + nextRandom() * span * theme.windowGap)
        const windowX = Math.floor(column * span + offsetX)
        const windowY = Math.floor(innerY + (innerHeight - windowHeight) * 0.5)
        context.fillStyle = frameShade
        context.fillRect(windowX - 2, windowY - 1, windowWidth + 4, windowHeight + 2)
        const lit = nextRandom() > theme.litChance
        context.fillStyle = lit ? windowLit[Math.floor(nextRandom() * windowLit.length)]! : windowDark[Math.floor(nextRandom() * windowDark.length)]!
        context.fillRect(windowX, windowY, windowWidth, windowHeight)
        if (lit) {
          context.fillStyle = officeStyle ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.28)'
          context.fillRect(windowX, windowY, windowWidth, 1)
        }
      }
    }
    const upscale = document.createElement('canvas')
    upscale.width = 512
    upscale.height = 1024
    const upscaleContext = upscale.getContext('2d')!
    upscaleContext.imageSmoothingEnabled = false
    upscaleContext.drawImage(canvas, 0, 0, upscale.width, upscale.height)
    const texture = configureCityTexture(new THREE.CanvasTexture(upscale))
    texture.needsUpdate = true
    facadeTextureByStyle.set(resolvedStyle, texture)
    return texture
  }
  const data = new Uint8Array([
    220, 216, 207, 255, 218, 214, 206, 255,
    215, 210, 202, 255, 217, 212, 204, 255,
  ])
  const texture = configureCityTexture(new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat))
  texture.needsUpdate = true
  facadeTextureByStyle.set(resolvedStyle, texture)
  return texture
}

function getWallMaterial(style: unknown): THREE.MeshLambertMaterial {
  const resolvedStyle = resolveProceduralCityStyle(style)
  const cachedMaterial = wallMaterialByStyle.get(resolvedStyle)
  if (cachedMaterial) {
    return cachedMaterial
  }
  const material = new THREE.MeshLambertMaterial({
    map: loadFacadeTexture(resolvedStyle),
    vertexColors: true,
  })
  wallMaterialByStyle.set(resolvedStyle, material)
  return material
}

function applyProceduralCityVertexShade(geometry: THREE.BufferGeometry, bottomShade: number, topShade: number): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) {
    return
  }
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  const minY = box?.min.y ?? 0
  const maxY = box?.max.y ?? 1
  const height = Math.max(1e-6, maxY - minY)
  const colors: number[] = []
  for (let index = 0; index < position.count; index += 1) {
    const t = (position.getY(index) - minY) / height
    const shade = bottomShade + (topShade - bottomShade) * t
    colors.push(shade, shade, shade)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
}

function applyProceduralCityRoofColors(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!position) {
    return
  }
  const colors: number[] = []
  for (let index = 0; index < position.count; index += 1) {
    colors.push(1, 1, 1)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
}

function createTaperedBoxGeometry(topScaleX: number, topScaleZ: number, bottomShade: number, topShade: number): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index)
    if (y > 0) {
      position.setX(index, position.getX(index) * topScaleX)
      position.setZ(index, position.getZ(index) * topScaleZ)
    }
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.translate(0, 0.5, 0)
  applyProceduralCityVertexShade(geometry, bottomShade, topShade)
  return geometry
}

function getArchetypes(style: unknown): Array<{ geometry: THREE.BufferGeometry }> {
  const resolvedStyle = resolveProceduralCityStyle(style)
  const cached = archetypesByStyle.get(resolvedStyle)
  if (cached) {
    return cached
  }
  const theme = getProceduralCityStyleTheme(resolvedStyle)
  const archetypes = Array.from({ length: BUILDING_VARIANT_COUNT }, (_entry, index) => {
    const taper = 1 - (index % 6) * 0.004
    const sideTaper = 1 - ((index + 3) % 4) * 0.004
    const roofHeight = 0.02 + (index % 3) * 0.01
    const wall = createTaperedBoxGeometry(
      taper,
      sideTaper,
      theme.vertexBottomShade,
      theme.vertexTopShade,
    )
    const roof = new THREE.BoxGeometry(
      Math.max(0.5, taper - 0.02),
      roofHeight,
      Math.max(0.5, sideTaper - 0.02),
    )
    roof.translate(0, roofHeight * 0.5, 0)
    applyProceduralCityRoofColors(roof)
    const geometry = wall
    roof.dispose()
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return { geometry }
  })
  archetypesByStyle.set(resolvedStyle, archetypes)
  return archetypes
}

function createMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  count: number,
  name: string,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = false
  mesh.frustumCulled = false
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  return mesh
}

type ProceduralCityTileBucket = {
  tileX: number
  tileZ: number
  parcelsByVariant: Map<number, ProceduralCityParcel[]>
}

const proceduralCityTileGroupCenter = new THREE.Vector3()
const proceduralCityTileWorldCenter = new THREE.Vector3()
const proceduralCityTileMatrix = new THREE.Matrix4()
const proceduralCityTileQuaternion = new THREE.Quaternion()
const proceduralCityTileScale = new THREE.Vector3()
const proceduralCityTileUpAxis = new THREE.Vector3(0, 1, 0)

function getTileKey(tileX: number, tileZ: number): string {
  return `${tileX}:${tileZ}`
}

function getTileOrigin(tileX: number, tileZ: number): THREE.Vector2 {
  return new THREE.Vector2(tileX * PROCEDURAL_CITY_TILE_SIZE, tileZ * PROCEDURAL_CITY_TILE_SIZE)
}

function buildProceduralCityGroup(parcels: ProceduralCityParcel[], style: unknown): THREE.Group {
  const group = new THREE.Group()
  group.name = 'ProceduralCity'
  const resolvedStyle = resolveProceduralCityStyle(style)
  const tileBuckets = new Map<string, ProceduralCityTileBucket>()
  parcels.forEach((parcel) => {
    const tileX = Math.floor(parcel.position.x / PROCEDURAL_CITY_TILE_SIZE)
    const tileZ = Math.floor(parcel.position.z / PROCEDURAL_CITY_TILE_SIZE)
    const key = getTileKey(tileX, tileZ)
    let tileBucket = tileBuckets.get(key)
    if (!tileBucket) {
      tileBucket = {
        tileX,
        tileZ,
        parcelsByVariant: new Map<number, ProceduralCityParcel[]>(),
      }
      tileBuckets.set(key, tileBucket)
    }
    const variant = Math.abs(Math.trunc(parcel.variantIndex)) % BUILDING_VARIANT_COUNT
    const variantBucket = tileBucket.parcelsByVariant.get(variant) ?? []
    variantBucket.push(parcel)
    tileBucket.parcelsByVariant.set(variant, variantBucket)
  })

  const archetypeList = getArchetypes(resolvedStyle)
  tileBuckets.forEach((tileBucket) => {
    const tileGroup = new THREE.Group()
    tileGroup.name = `ProceduralCityTile_${tileBucket.tileX}_${tileBucket.tileZ}`
    const tileOrigin = getTileOrigin(tileBucket.tileX, tileBucket.tileZ)
    proceduralCityTileGroupCenter.set(
      tileOrigin.x + PROCEDURAL_CITY_TILE_SIZE * 0.5,
      0,
      tileOrigin.y + PROCEDURAL_CITY_TILE_SIZE * 0.5,
    )
    tileGroup.position.copy(proceduralCityTileGroupCenter)

    tileBucket.parcelsByVariant.forEach((entries, variant) => {
      const archetype = archetypeList[variant]!
      const cityMesh = createMesh(archetype.geometry, getWallMaterial(resolvedStyle), entries.length, `ProceduralCity_${tileBucket.tileX}_${tileBucket.tileZ}_${variant}`)
      entries.forEach((parcel, index) => {
        proceduralCityTileQuaternion.setFromAxisAngle(proceduralCityTileUpAxis, parcel.rotationY)
        proceduralCityTileScale.set(parcel.width, parcel.height, parcel.depth)
        proceduralCityTileMatrix.compose(
          proceduralCityTileWorldCenter.copy(parcel.position).sub(proceduralCityTileGroupCenter),
          proceduralCityTileQuaternion,
          proceduralCityTileScale,
        )
        cityMesh.setMatrixAt(index, proceduralCityTileMatrix)
        cityMesh.setColorAt(index, parcel.color)
      })
      cityMesh.count = entries.length
      cityMesh.instanceMatrix.needsUpdate = true
      if (cityMesh.instanceColor) {
        cityMesh.instanceColor.needsUpdate = true
      }
      tileGroup.add(cityMesh)
    })

    group.add(tileGroup)
  })

  return group
}

function disposeProceduralCityObject(object: THREE.Object3D): void {
  object.clear()
}

export function clampProceduralCityComponentProps(
  props: Partial<ProceduralCityComponentProps> | null | undefined,
): ProceduralCityComponentProps {
  const seed = Math.trunc(clampNumber(props?.seed, PROCEDURAL_CITY_DEFAULT_PROPS.seed, 0, 2147483647))
  const spacing = clampNumber(props?.spacing, PROCEDURAL_CITY_DEFAULT_PROPS.spacing, 0.25, 100)
  const inset = clampNumber(props?.inset, PROCEDURAL_CITY_DEFAULT_PROPS.inset, 0, 100)
  const density = clampNumber(props?.density, PROCEDURAL_CITY_DEFAULT_PROPS.density, 0, 1)
  const widthRange = normalizeRange(
    clampNumber(props?.minWidth, PROCEDURAL_CITY_DEFAULT_PROPS.minWidth, 0.5, 500),
    clampNumber(props?.maxWidth, PROCEDURAL_CITY_DEFAULT_PROPS.maxWidth, 0.5, 500),
    0.1,
  )
  const depthRange = normalizeRange(
    clampNumber(props?.minDepth, PROCEDURAL_CITY_DEFAULT_PROPS.minDepth, 0.5, 500),
    clampNumber(props?.maxDepth, PROCEDURAL_CITY_DEFAULT_PROPS.maxDepth, 0.5, 500),
    0.1,
  )
  const heightRange = normalizeRange(
    clampNumber(props?.minHeight, PROCEDURAL_CITY_DEFAULT_PROPS.minHeight, PROCEDURAL_CITY_FLOOR_HEIGHT * 2, 1000),
    clampNumber(props?.maxHeight, PROCEDURAL_CITY_DEFAULT_PROPS.maxHeight, PROCEDURAL_CITY_FLOOR_HEIGHT * 2, 1000),
    0.1,
  )
  return {
    seed,
    spacing,
    inset,
    density,
    minWidth: widthRange.min,
    maxWidth: widthRange.max,
    minDepth: depthRange.min,
    maxDepth: depthRange.max,
    minHeight: heightRange.min,
    maxHeight: heightRange.max,
    roadSetback: clampNumber(props?.roadSetback, PROCEDURAL_CITY_DEFAULT_PROPS.roadSetback, 0, 100),
    junctionSetback: clampNumber(props?.junctionSetback, PROCEDURAL_CITY_DEFAULT_PROPS.junctionSetback, 0, 200),
    maxBuildings: Math.trunc(clampNumber(props?.maxBuildings, PROCEDURAL_CITY_DEFAULT_PROPS.maxBuildings, 0, 20000)),
    style: resolveProceduralCityStyle(props?.style ?? PROCEDURAL_CITY_DEFAULT_PROPS.style),
  }
}

export function cloneProceduralCityComponentProps(
  props: ProceduralCityComponentProps,
): ProceduralCityComponentProps {
  return { ...props }
}

function tagProceduralCityArtifact(object: Object3D, componentId: string): void {
  object.traverse((child) => {
    child.userData = child.userData ?? {}
    child.userData[COMPONENT_ARTIFACT_KEY] = true
    child.userData[COMPONENT_ARTIFACT_COMPONENT_ID_KEY] = componentId
    delete child.userData[COMPONENT_ARTIFACT_NODE_ID_KEY]
    delete child.userData.nodeId
  })
}

function clearProceduralCityRuntimeArtifact(hostObject: Object3D): void {
  const userData = hostObject.userData ?? (hostObject.userData = {})
  const existingGroup = userData[PROCEDURAL_CITY_RUNTIME_GROUP_KEY] as Object3D | null | undefined
  if (existingGroup) {
    existingGroup.parent?.remove(existingGroup)
    disposeProceduralCityObject(existingGroup)
  }
  delete userData[PROCEDURAL_CITY_RUNTIME_GROUP_KEY]
}

export function syncProceduralCityRuntimeArtifact(
  hostObject: Object3D | null,
  node: SceneNode,
): void {
  if (!hostObject) {
    return
  }

  const userData = hostObject.userData ?? (hostObject.userData = {})
  const componentEntry = node.components?.[PROCEDURAL_CITY_COMPONENT_TYPE] as
    | SceneNodeComponentState<ProceduralCityComponentProps>
    | undefined

  if (!componentEntry || componentEntry.enabled === false) {
    clearProceduralCityRuntimeArtifact(hostObject)
    delete userData[PROCEDURAL_CITY_HOST_USER_DATA_KEY]
    return
  }

  const snapshot = cloneProceduralCityHostSnapshot(node.dynamicMesh)
  if (!snapshot) {
    clearProceduralCityRuntimeArtifact(hostObject)
    delete userData[PROCEDURAL_CITY_HOST_USER_DATA_KEY]
    return
  }

  userData[PROCEDURAL_CITY_HOST_USER_DATA_KEY] = snapshot

  const props = clampProceduralCityComponentProps(componentEntry?.props ?? PROCEDURAL_CITY_DEFAULT_PROPS)
  const surfaceY = resolvePolygonSurfaceHeight(snapshot)
  const footprint = resolveProceduralCityFootprint(snapshot)
  if (!footprint) {
    return
  }

  const parcels = generateProceduralCityParcels(footprint, props, surfaceY)
  if (!parcels.length) {
    return
  }

  const group = buildProceduralCityGroup(parcels, props.style)
  const existingGroup = userData[PROCEDURAL_CITY_RUNTIME_GROUP_KEY] as Object3D | null | undefined
  if (existingGroup) {
    existingGroup.parent?.remove(existingGroup)
    disposeProceduralCityObject(existingGroup)
  }
  tagProceduralCityArtifact(group, componentEntry.id)
  const mountObject = resolveProceduralCityMountObject(hostObject, snapshot)
  if (snapshot.type === 'Landform' || mountObject !== hostObject) {
    copyWorldTransform(hostObject, group)
  }
  mountObject.add(group)
  userData[PROCEDURAL_CITY_RUNTIME_GROUP_KEY] = group
}

class ProceduralCityComponent extends Component<ProceduralCityComponentProps> {
  private cityObject: Object3D | null = null

  constructor(context: ComponentRuntimeContext<ProceduralCityComponentProps>) {
    super(context)
  }

  onInit(): void {
    this.rebuild()
  }

  onRuntimeAttached(_object: Object3D | null): void {
    this.rebuild()
  }

  onPropsUpdated(): void {
    this.rebuild()
  }

  onEnabledChanged(enabled: boolean): void {
    if (enabled) {
      this.rebuild()
    } else {
      this.clear()
    }
  }

  onDestroy(): void {
    this.clear()
  }

  private clear(): void {
    const host = this.context.getRuntimeObject()
    if (!this.cityObject) {
      if (host) {
        clearProceduralCityRuntimeArtifact(host)
      }
      return
    }
    if (host) {
      clearProceduralCityRuntimeArtifact(host)
    } else {
      this.cityObject.parent?.remove(this.cityObject)
      disposeProceduralCityObject(this.cityObject)
    }
    this.cityObject = null
  }

  private rebuild(): void {
    const host = this.context.getRuntimeObject()
    this.clear()
    if (!this.context.isEnabled() || !host) {
      return
    }
    const snapshot = host.userData?.[PROCEDURAL_CITY_HOST_USER_DATA_KEY] as ProceduralCityHostSnapshot | null | undefined
    if (!snapshot) {
      return
    }
    const props = clampProceduralCityComponentProps(this.context.getProps())
    const surfaceY = resolvePolygonSurfaceHeight(snapshot)
    const footprint = resolveProceduralCityFootprint(snapshot)
    if (!footprint) {
      return
    }
    const parcels = generateProceduralCityParcels(footprint, props, surfaceY)
    if (!parcels.length) {
      return
    }
    const group = buildProceduralCityGroup(parcels, props.style)
    const existingGroup = host.userData?.[PROCEDURAL_CITY_RUNTIME_GROUP_KEY] as Object3D | null | undefined
    if (existingGroup) {
      existingGroup.parent?.remove(existingGroup)
      disposeProceduralCityObject(existingGroup)
    }
    tagProceduralCityArtifact(group, this.context.componentId)
    const mountObject = resolveProceduralCityMountObject(host, snapshot)
    if (snapshot.type === 'Landform' || mountObject !== host) {
      copyWorldTransform(host, group)
    }
    mountObject.add(group)
    const userData = host.userData ?? (host.userData = {})
    userData[PROCEDURAL_CITY_RUNTIME_GROUP_KEY] = group
    this.cityObject = group
  }
}

const proceduralCityComponentDefinition: ComponentDefinition<ProceduralCityComponentProps> = {
  type: PROCEDURAL_CITY_COMPONENT_TYPE,
  label: 'Procedural City',
  icon: 'mdi-city-variant-outline',
  order: 54,
  recreateOnPropsChange: false,
  canAttach(node: SceneNode) {
    const type = node.dynamicMesh?.type
    return type === 'Floor' || type === 'Region' || type === 'Road' || type === 'Landform'
  },
  createDefaultProps() {
    return cloneProceduralCityComponentProps(PROCEDURAL_CITY_DEFAULT_PROPS)
  },
  createInstance(context) {
    return new ProceduralCityComponent(context)
  },
}

componentManager.registerDefinition(proceduralCityComponentDefinition)

export function createProceduralCityComponentState(
  _node?: SceneNode | null,
  overrides?: Partial<ProceduralCityComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<ProceduralCityComponentProps> {
  return {
    id: options.id ?? '',
    type: PROCEDURAL_CITY_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: clampProceduralCityComponentProps({
      ...PROCEDURAL_CITY_DEFAULT_PROPS,
      ...overrides,
    }),
  }
}

export { proceduralCityComponentDefinition }
