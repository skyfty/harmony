import * as THREE from 'three'
import type { WallDynamicMesh } from './index'
import { compileWallSegmentsFromDefinition, type WallRenderSegment } from './wallLayout'
import type {
  WallComponentProps,
  WallCornerModelRule,
  WallModelOrientation,
  WallOffsetLocal,
  WallRenderMode,
} from './components/definitions/wallComponent'
import {
  getOrCreateModelObjectRepeatVariant,
  ensureInstancedMeshesRegistered,
  allocateModelInstance,
  allocateModelInstanceBinding,
  updateModelInstanceBindingMatrix,
  updateModelInstanceMatrix,
} from './modelObjectCache'
import { syncInstancedModelCommittedLocalMatrices } from './continuousInstancedModel'

export const WALL_INSTANCED_BINDINGS_USERDATA_KEY = '__harmonyWallInstancedBindings'

export type InstancedBoundsPayload = {
  min: [number, number, number]
  max: [number, number, number]
}

export type WallInstancedBindingSpec = {
  assetId: string
  sourceAssetId?: string | null
  localMatrices: THREE.Matrix4[]
  bindingIdPrefix: string
  useNodeIdForIndex0: boolean
  repeatScaleU?: number
}

export type WallInstancedRenderPlan = {
  effectiveDefinition: WallDynamicMesh
  wantsInstancing: boolean
  hasBindings: boolean
  hasProceduralBodyFallback: boolean
  primaryAssetId: string | null
  bindings: WallInstancedBindingSpec[]
  instancedBounds: InstancedBoundsPayload | null
}

const wallSyncPosHelper = new THREE.Vector3()
const wallSyncScaleHelper = new THREE.Vector3(1, 1, 1)
const wallSyncStartHelper = new THREE.Vector3()
const wallSyncEndHelper = new THREE.Vector3()
const wallSyncLocalStartHelper = new THREE.Vector3()
const wallSyncLocalEndHelper = new THREE.Vector3()
const wallSyncLocalDirHelper = new THREE.Vector3()
const wallSyncLocalUnitDirHelper = new THREE.Vector3()
const wallSyncLocalOffsetHelper = new THREE.Vector3()
const wallSyncLocalMatrixHelper = new THREE.Matrix4()
const wallSyncIncomingHelper = new THREE.Vector3()
const wallSyncOutgoingHelper = new THREE.Vector3()
const wallSyncBisectorHelper = new THREE.Vector3()
const wallSyncYawAxis = new THREE.Vector3(0, 1, 0)
const wallSyncYawQuatHelper = new THREE.Quaternion()

const wallInstancedBoundsBox = new THREE.Box3()
const wallInstancedBoundsPoint = new THREE.Vector3()
const wallInstancedBoundsCorners = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
] as [
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
  THREE.Vector3,
]

const WALL_SYNC_EPSILON = 1e-6
const WALL_SYNC_MIN_TILE_LENGTH = 1e-4
const WALL_SYNC_REPEAT_BUCKETS_MAX = 6
const WALL_SYNC_REPEAT_INSTANCE_STEP_M_DEFAULT = 0.5

function normalizeWallRepeatInstanceStep(value: unknown): number {
  const raw = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(raw)) {
    return WALL_SYNC_REPEAT_INSTANCE_STEP_M_DEFAULT
  }
  return Math.max(WALL_SYNC_MIN_TILE_LENGTH, raw)
}

function distanceSqXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return dx * dx + dz * dz
}

function splitWallSegmentsIntoChains(segments: WallRenderSegment[]): WallRenderSegment[][] {
  const chains: WallRenderSegment[][] = []
  let current: WallRenderSegment[] = []

  for (const seg of segments) {
    const prev = current[current.length - 1]
    if (prev) {
      wallSyncStartHelper.set(prev.end.x, prev.end.y, prev.end.z)
      wallSyncEndHelper.set(seg.start.x, seg.start.y, seg.start.z)
      if (distanceSqXZ(wallSyncStartHelper, wallSyncEndHelper) > WALL_SYNC_EPSILON) {
        if (current.length) {
          chains.push(current)
        }
        current = []
      }
    }
    current.push(seg)
  }

  if (current.length) {
    chains.push(current)
  }

  return chains
}

type WallPlacementMode = 'body' | 'head' | 'foot'

type WallForwardAxisInfo = { axis: 'x' | 'z'; sign: 1 | -1 }

function wallForwardAxisInfo(forwardAxis: WallModelOrientation['forwardAxis']): WallForwardAxisInfo {
  switch (forwardAxis) {
    case '+x':
      return { axis: 'x', sign: 1 }
    case '-x':
      return { axis: 'x', sign: -1 }
    case '+z':
      return { axis: 'z', sign: 1 }
    case '-z':
      return { axis: 'z', sign: -1 }
    default:
      throw new Error(`Wall: invalid forwardAxis ${String(forwardAxis)}`)
  }
}

function writeWallLocalForward(out: THREE.Vector3, forwardAxis: WallModelOrientation['forwardAxis']): THREE.Vector3 {
  switch (forwardAxis) {
    case '+x':
      return out.set(1, 0, 0)
    case '-x':
      return out.set(-1, 0, 0)
    case '+z':
      return out.set(0, 0, 1)
    case '-z':
      return out.set(0, 0, -1)
    default:
      return out.set(0, 0, 1)
  }
}

function resolveWallBoundsAlongAxis(
  bounds: THREE.Box3,
  forwardAxis: WallModelOrientation['forwardAxis'],
): { tileLengthLocal: number; minAlongAxis: number; maxAlongAxis: number } {
  const info = wallForwardAxisInfo(forwardAxis)
  const axis = info.axis
  const minRaw = bounds.min[axis]
  const maxRaw = bounds.max[axis]
  const lengthAbs = Math.abs(maxRaw - minRaw)
  const tileLengthLocal = Math.max(WALL_SYNC_MIN_TILE_LENGTH, lengthAbs)
  const minAlongAxis = info.sign === 1 ? minRaw : -maxRaw
  const maxAlongAxis = info.sign === 1 ? maxRaw : -minRaw
  return { tileLengthLocal, minAlongAxis, maxAlongAxis }
}

function expandBoxByTransformedBoundingBox(target: THREE.Box3, bbox: THREE.Box3, matrix: THREE.Matrix4): void {
  if (!bbox || bbox.isEmpty()) {
    return
  }

  const min = bbox.min
  const max = bbox.max

  wallInstancedBoundsCorners[0].set(min.x, min.y, min.z)
  wallInstancedBoundsCorners[1].set(min.x, min.y, max.z)
  wallInstancedBoundsCorners[2].set(min.x, max.y, min.z)
  wallInstancedBoundsCorners[3].set(min.x, max.y, max.z)
  wallInstancedBoundsCorners[4].set(max.x, min.y, min.z)
  wallInstancedBoundsCorners[5].set(max.x, min.y, max.z)
  wallInstancedBoundsCorners[6].set(max.x, max.y, min.z)
  wallInstancedBoundsCorners[7].set(max.x, max.y, max.z)

  for (const corner of wallInstancedBoundsCorners) {
    wallInstancedBoundsPoint.copy(corner).applyMatrix4(matrix)
    target.expandByPoint(wallInstancedBoundsPoint)
  }
}

export function resolveWallEffectiveDefinition(
  definition: WallDynamicMesh,
  props: WallComponentProps | null,
): WallDynamicMesh {
  if (!props || !definition.chains?.length) {
    return definition
  }

  const { height, width, thickness } = props
  const d = definition.dimensions
  if (d.height === height && d.width === width && d.thickness === thickness) {
    return definition
  }

  return { ...definition, dimensions: { height, width, thickness } }
}

function sanitizeRepeatScaleU(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

function bucketWallPlacementsByRepeatScale(
  placements: WallLocalPlacement[],
  maxBuckets = WALL_SYNC_REPEAT_BUCKETS_MAX,
): Array<{ repeatScaleU: number; placements: WallLocalPlacement[] }> {
  if (!placements.length) {
    return []
  }
  if (placements.length === 1 || maxBuckets <= 1) {
    return [{ repeatScaleU: sanitizeRepeatScaleU(placements[0]!.uvScaleU), placements: placements.slice() }]
  }

  const safeBucketCount = Math.max(1, Math.min(maxBuckets, placements.length))
  const scales = placements.map((entry) => sanitizeRepeatScaleU(entry.uvScaleU))
  const minScale = Math.max(WALL_SYNC_EPSILON, Math.min(...scales))
  const maxScale = Math.max(minScale, Math.max(...scales))
  if (!Number.isFinite(minScale) || !Number.isFinite(maxScale) || maxScale - minScale <= WALL_SYNC_EPSILON) {
    const average = scales.reduce((sum, value) => sum + value, 0) / scales.length
    return [{ repeatScaleU: sanitizeRepeatScaleU(average), placements: placements.slice() }]
  }

  const minLog = Math.log(minScale)
  const maxLog = Math.log(maxScale)
  const buckets = Array.from({ length: safeBucketCount }, () => ({
    sumScale: 0,
    count: 0,
    placements: [] as WallLocalPlacement[],
  }))

  for (let i = 0; i < placements.length; i += 1) {
    const placement = placements[i]!
    const scale = scales[i]!
    let bucketIndex = 0
    if (maxLog - minLog > WALL_SYNC_EPSILON) {
      const normalized = (Math.log(scale) - minLog) / (maxLog - minLog)
      bucketIndex = Math.round(THREE.MathUtils.clamp(normalized, 0, 1) * (safeBucketCount - 1))
    }
    const bucket = buckets[bucketIndex]!
    bucket.sumScale += scale
    bucket.count += 1
    bucket.placements.push(placement)
  }

  return buckets
    .filter((bucket: { sumScale: number; count: number; placements: WallLocalPlacement[] }) => bucket.count > 0 && bucket.placements.length > 0)
    .map((bucket: { sumScale: number; count: number; placements: WallLocalPlacement[] }) => ({
      repeatScaleU: sanitizeRepeatScaleU(bucket.sumScale / bucket.count),
      placements: bucket.placements,
    }))
}

export function buildWallRepeatVariantAssetId(
  baseAssetId: string,
  role: WallPlacementMode,
  repeatScaleU: number,
): string {
  const rounded = sanitizeRepeatScaleU(repeatScaleU).toFixed(4)
  return `${baseAssetId}#wall-repeat:${role}:u:${rounded}`
}

type WallLocalPlacement = {
  matrix: THREE.Matrix4
  uvScaleU: number
}

function buildRepeatErasedSlotSet(definition: WallDynamicMesh): Set<string> {
  const source = definition as unknown as { repeatErasedSlots?: Array<{ chainIndex?: unknown; slotIndex?: unknown }> }
  const slots = Array.isArray(source.repeatErasedSlots) ? source.repeatErasedSlots : []
  return new Set(
    slots.map((entry) => `${Math.max(0, Math.trunc(Number(entry?.chainIndex ?? 0)))}:${Math.max(0, Math.trunc(Number(entry?.slotIndex ?? -1)))}`),
  )
}

function resolveWallBodyHeightForSegment(segment: WallRenderSegment): number {
  const raw = segment.height
  if (!Number.isFinite(raw)) {
    return 1
  }
  return Math.max(0.001, raw)
}

function resolveWallModelHeight(bounds: THREE.Box3): number {
  return Math.max(1e-6, bounds.max.y - bounds.min.y)
}

function pickWallCornerRule(
  angleRadians: number,
  rules: WallCornerModelRule[],
  mode: WallPlacementMode,
): WallCornerModelRule | null {
  if (!Number.isFinite(angleRadians)) {
    return null
  }

  const angleDeg = Math.max(0, Math.min(180, THREE.MathUtils.radToDeg(angleRadians)))
  const straightEpsilon = 1e-3
  if (Math.abs(angleRadians - Math.PI) < straightEpsilon) {
    for (const rule of rules) {
      const rawAsset = mode === 'body'
        ? rule.bodyAssetId
        : mode === 'head'
          ? rule.headAssetId
          : rule.footAssetId
      const assetId = typeof rawAsset === 'string' && rawAsset.trim().length ? rawAsset.trim() : null
      if (!assetId) {
        continue
      }
      const ruleAngle = Number.isFinite(rule.angle) ? Math.max(0, Math.min(180, rule.angle)) : 90
      if (ruleAngle >= 180 - 1e-6) {
        return rule
      }
    }
  }

  let best: { rule: WallCornerModelRule; diff: number; ruleAngle: number } | null = null
  for (const rule of rules) {
    const rawAsset = mode === 'body'
      ? rule.bodyAssetId
      : mode === 'head'
        ? rule.headAssetId
        : rule.footAssetId
    const assetId = typeof rawAsset === 'string' && rawAsset.trim().length ? rawAsset.trim() : null
    if (!assetId) {
      continue
    }
    const ruleAngle = Number.isFinite(rule.angle) ? Math.max(0, Math.min(180, rule.angle)) : 90
    const tolerance = Number.isFinite(rule.tolerance) ? Math.max(0, Math.min(90, rule.tolerance)) : 5
    const diff = Math.abs(angleDeg - ruleAngle)
    if (diff > tolerance + 1e-6) {
      continue
    }
    if (!best || diff + 1e-6 < best.diff || (Math.abs(diff - best.diff) <= 1e-6 && ruleAngle + 1e-6 < best.ruleAngle)) {
      best = { rule, diff, ruleAngle }
    }
  }

  return best ? best.rule : null
}

function computeWallSegmentJointTrims(
  segments: WallRenderSegment[],
  rules: WallCornerModelRule[],
  mode: WallPlacementMode,
): Array<{ start: number; end: number }> {
  const trims = Array.from({ length: segments.length }, () => ({ start: 0, end: 0 }))
  if (segments.length < 2 || !rules.length) {
    return trims
  }

  const start = new THREE.Vector3()
  const end = new THREE.Vector3()
  const incoming = new THREE.Vector3()
  const outgoing = new THREE.Vector3()

  const applyTrimForPair = (aIndex: number, bIndex: number): void => {
    const current = segments[aIndex]
    const next = segments[bIndex]
    if (!current || !next) {
      return
    }

    start.set(current.end.x, current.end.y, current.end.z)
    end.set(next.start.x, next.start.y, next.start.z)
    if (distanceSqXZ(start, end) > WALL_SYNC_EPSILON) {
      return
    }

    start.set(current.start.x, current.start.y, current.start.z)
    end.set(current.end.x, current.end.y, current.end.z)
    incoming.subVectors(end, start)
    incoming.y = 0

    start.set(next.start.x, next.start.y, next.start.z)
    end.set(next.end.x, next.end.y, next.end.z)
    outgoing.subVectors(end, start)
    outgoing.y = 0

    if (incoming.lengthSq() < WALL_SYNC_EPSILON || outgoing.lengthSq() < WALL_SYNC_EPSILON) {
      return
    }

    incoming.normalize()
    outgoing.normalize()
    const dotInterior = THREE.MathUtils.clamp(-incoming.dot(outgoing), -1, 1)
    const angle = Math.acos(dotInterior)
    if (!Number.isFinite(angle)) {
      return
    }

    const rule = pickWallCornerRule(angle, rules, mode)
    if (!rule) {
      return
    }

    const trimStart = Number.isFinite(rule.jointTrim?.start) ? Math.max(0, rule.jointTrim.start) : 0
    const trimEnd = Number.isFinite(rule.jointTrim?.end) ? Math.max(0, rule.jointTrim.end) : 0
    if (trimEnd > 0) {
      trims[aIndex]!.end = Math.max(trims[aIndex]!.end, trimEnd)
    }
    if (trimStart > 0) {
      trims[bIndex]!.start = Math.max(trims[bIndex]!.start, trimStart)
    }
  }

  for (let i = 0; i < segments.length - 1; i += 1) {
    applyTrimForPair(i, i + 1)
  }

  const first = segments[0]!
  const last = segments[segments.length - 1]!
  start.set(last.end.x, last.end.y, last.end.z)
  end.set(first.start.x, first.start.y, first.start.z)
  if (distanceSqXZ(start, end) <= WALL_SYNC_EPSILON) {
    applyTrimForPair(segments.length - 1, 0)
  }

  return trims
}

function computeWallBodyLocalPlacementsStretchTiledUv(
  definition: WallDynamicMesh,
  bounds: THREE.Box3,
  mode: WallPlacementMode,
  orientation: WallModelOrientation,
  cornerModels: WallCornerModelRule[] = [],
): WallLocalPlacement[] {
  const placements: WallLocalPlacement[] = []
  const segments = compileWallSegmentsFromDefinition(definition)
  if (!segments.length) {
    return placements
  }

  const localForward = new THREE.Vector3()
  writeWallLocalForward(localForward, orientation.forwardAxis)
  const { tileLengthLocal, minAlongAxis } = resolveWallBoundsAlongAxis(bounds, orientation.forwardAxis)
  const templateHeight = resolveWallModelHeight(bounds)
  const minY = bounds.min.y
  const trims = computeWallSegmentJointTrims(segments, cornerModels, mode)

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex] as any
    wallSyncLocalStartHelper.set(segment.start.x, segment.start.y, segment.start.z)
    wallSyncLocalEndHelper.set(segment.end.x, segment.end.y, segment.end.z)
    wallSyncLocalDirHelper.subVectors(wallSyncLocalEndHelper, wallSyncLocalStartHelper)
    wallSyncLocalDirHelper.y = 0
    const lengthLocal = wallSyncLocalDirHelper.length()
    if (lengthLocal <= WALL_SYNC_EPSILON) {
      continue
    }

    wallSyncLocalUnitDirHelper.copy(wallSyncLocalDirHelper).normalize()
    const trim = trims[segmentIndex] ?? { start: 0, end: 0 }
    const trimStart = Math.max(0, trim.start)
    const trimEnd = Math.max(0, trim.end)
    if (trimStart > WALL_SYNC_EPSILON) {
      wallSyncLocalStartHelper.addScaledVector(wallSyncLocalUnitDirHelper, trimStart)
    }
    if (trimEnd > WALL_SYNC_EPSILON) {
      wallSyncLocalEndHelper.addScaledVector(wallSyncLocalUnitDirHelper, -trimEnd)
    }

    const trimmedLengthLocal = Math.max(0, lengthLocal - trimStart - trimEnd)
    if (trimmedLengthLocal <= WALL_SYNC_EPSILON) {
      continue
    }

    const quatLocal = new THREE.Quaternion().setFromUnitVectors(localForward, wallSyncLocalUnitDirHelper)
    if (orientation.yawDeg) {
      wallSyncYawQuatHelper.setFromAxisAngle(wallSyncYawAxis, THREE.MathUtils.degToRad(orientation.yawDeg))
      quatLocal.multiply(wallSyncYawQuatHelper)
    }

    const bodyHeight = resolveWallBodyHeightForSegment(segment)
    const scaleY = mode === 'body' ? (bodyHeight / templateHeight) : 1
    const scaleAlong = Math.max(trimmedLengthLocal / tileLengthLocal, 1e-6)
    wallSyncLocalOffsetHelper.copy(localForward).multiplyScalar(minAlongAxis * scaleAlong)
    wallSyncLocalOffsetHelper.applyQuaternion(quatLocal)
    wallSyncPosHelper.copy(wallSyncLocalStartHelper).sub(wallSyncLocalOffsetHelper)

    const baselineY = wallSyncPosHelper.y
    const posY = mode === 'body'
      ? (baselineY - scaleY * minY)
      : mode === 'head'
        ? (baselineY + bodyHeight - minY)
        : (baselineY - minY)
    wallSyncPosHelper.y = posY

    switch (orientation.forwardAxis) {
      case '+x':
      case '-x':
        wallSyncScaleHelper.set(scaleAlong, scaleY, 1)
        break
      case '+z':
      case '-z':
        wallSyncScaleHelper.set(1, scaleY, scaleAlong)
        break
    }
    wallSyncLocalMatrixHelper.compose(wallSyncPosHelper, quatLocal, wallSyncScaleHelper)
    placements.push({
      matrix: new THREE.Matrix4().copy(wallSyncLocalMatrixHelper),
      uvScaleU: scaleAlong,
    })
  }

  return placements
}

function computeWallBodyLocalPlacementsRepeated(
  definition: WallDynamicMesh,
  bounds: THREE.Box3,
  mode: WallPlacementMode,
  orientation: WallModelOrientation,
  repeatInstanceStep: number,
  repeatErasedSlotSet: Set<string>,
  cornerModels: WallCornerModelRule[] = [],
): WallLocalPlacement[] {
  const placements: WallLocalPlacement[] = []
  const segments = compileWallSegmentsFromDefinition(definition)
  if (!segments.length) {
    return placements
  }

  const localForward = new THREE.Vector3()
  writeWallLocalForward(localForward, orientation.forwardAxis)
  const { tileLengthLocal, minAlongAxis } = resolveWallBoundsAlongAxis(bounds, orientation.forwardAxis)
  const templateHeight = resolveWallModelHeight(bounds)
  const minY = bounds.min.y
  const trims = computeWallSegmentJointTrims(segments, cornerModels, mode)
  const repeatSlotByChain = new Map<number, number>()

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex] as any
    wallSyncLocalStartHelper.set(segment.start.x, segment.start.y, segment.start.z)
    wallSyncLocalEndHelper.set(segment.end.x, segment.end.y, segment.end.z)
    wallSyncLocalDirHelper.subVectors(wallSyncLocalEndHelper, wallSyncLocalStartHelper)
    wallSyncLocalDirHelper.y = 0
    const lengthLocal = wallSyncLocalDirHelper.length()
    if (lengthLocal <= WALL_SYNC_EPSILON) {
      continue
    }

    const trim = trims[segmentIndex] ?? { start: 0, end: 0 }
    const trimStart = Math.max(0, trim.start)
    const trimEnd = Math.max(0, trim.end)
    const trimmedLengthLocal = Math.max(0, lengthLocal - trimStart - trimEnd)
    if (trimmedLengthLocal <= WALL_SYNC_EPSILON) {
      continue
    }

    wallSyncLocalUnitDirHelper.copy(wallSyncLocalDirHelper).normalize()
    if (trimStart > WALL_SYNC_EPSILON) {
      wallSyncLocalStartHelper.addScaledVector(wallSyncLocalUnitDirHelper, trimStart)
    }

    const quatLocal = new THREE.Quaternion().setFromUnitVectors(localForward, wallSyncLocalUnitDirHelper)
    if (orientation.yawDeg) {
      wallSyncYawQuatHelper.setFromAxisAngle(wallSyncYawAxis, THREE.MathUtils.degToRad(orientation.yawDeg))
      quatLocal.multiply(wallSyncYawQuatHelper)
    }

    const bodyHeight = resolveWallBodyHeightForSegment(segment)
    const scaleY = mode === 'body' ? (bodyHeight / templateHeight) : 1
    const maxLocalStart = trimmedLengthLocal - tileLengthLocal
    if (maxLocalStart < -WALL_SYNC_EPSILON) {
      continue
    }

    wallSyncScaleHelper.set(1, scaleY, 1)
    const chainIndex = Math.max(0, Math.trunc(Number(segment.chainIndex ?? 0)))
    for (let localStart = 0; localStart <= maxLocalStart + WALL_SYNC_EPSILON; localStart += repeatInstanceStep) {
      const repeatSlotIndex = (() => {
        const next = (repeatSlotByChain.get(chainIndex) ?? 0) + 1
        repeatSlotByChain.set(chainIndex, next)
        return next - 1
      })()
      if (repeatErasedSlotSet.has(`${chainIndex}:${repeatSlotIndex}`)) {
        continue
      }

      const snappedLocalStart = Math.max(0, Math.min(maxLocalStart, localStart))
      wallSyncLocalOffsetHelper.copy(localForward).multiplyScalar(minAlongAxis)
      wallSyncLocalOffsetHelper.applyQuaternion(quatLocal)
      wallSyncPosHelper.copy(wallSyncLocalStartHelper)
      wallSyncPosHelper.addScaledVector(wallSyncLocalUnitDirHelper, snappedLocalStart)
      wallSyncPosHelper.sub(wallSyncLocalOffsetHelper)

      const baselineY = wallSyncPosHelper.y
      const posY = mode === 'body'
        ? (baselineY - scaleY * minY)
        : mode === 'head'
          ? (baselineY + bodyHeight - minY)
          : (baselineY - minY)
      wallSyncPosHelper.y = posY
      wallSyncLocalMatrixHelper.compose(wallSyncPosHelper, quatLocal, wallSyncScaleHelper)
      placements.push({
        matrix: new THREE.Matrix4().copy(wallSyncLocalMatrixHelper),
        uvScaleU: 1,
      })
    }
  }

  return placements
}

function computeWallBodyLocalPlacements(
  definition: WallDynamicMesh,
  bounds: THREE.Box3,
  mode: WallPlacementMode,
  wallRenderMode: WallRenderMode,
  orientation: WallModelOrientation,
  repeatInstanceStep: number,
  cornerModels: WallCornerModelRule[] = [],
): WallLocalPlacement[] {
  if (wallRenderMode === 'repeatInstances') {
    return computeWallBodyLocalPlacementsRepeated(
      definition,
      bounds,
      mode,
      orientation,
      normalizeWallRepeatInstanceStep(repeatInstanceStep),
      buildRepeatErasedSlotSet(definition),
      cornerModels,
    )
  }
  return computeWallBodyLocalPlacementsStretchTiledUv(definition, bounds, mode, orientation, cornerModels)
}

function computeWallJointLocalMatricesByAsset(
  definition: WallDynamicMesh,
  options: {
    cornerModels?: WallCornerModelRule[]
    mode: WallPlacementMode
    getAssetBounds: (assetId: string) => THREE.Box3 | null
  },
): { matricesByAssetId: Map<string, THREE.Matrix4[]>; primaryAssetId: string | null; mode: WallPlacementMode } {
  const matricesByAssetId = new Map<string, THREE.Matrix4[]>()
  let primaryAssetId: string | null = null
  const compiledSegs = compileWallSegmentsFromDefinition(definition)
  if (compiledSegs.length < 2) {
    return { matricesByAssetId, primaryAssetId, mode: options.mode }
  }

  const rulesSource = Array.isArray(options.cornerModels) ? options.cornerModels : []
  const pushMatrix = (assetId: string, matrix: THREE.Matrix4) => {
    const bucket = matricesByAssetId.get(assetId) ?? []
    if (!matricesByAssetId.has(assetId)) {
      matricesByAssetId.set(assetId, bucket)
    }
    bucket.push(matrix)
    if (!primaryAssetId) {
      primaryAssetId = assetId
    }
  }

  const buildCorner = (current: WallRenderSegment, next: WallRenderSegment, corner: THREE.Vector3) => {
    wallSyncStartHelper.set(current.start.x, current.start.y, current.start.z)
    wallSyncEndHelper.set(current.end.x, current.end.y, current.end.z)
    wallSyncIncomingHelper.subVectors(wallSyncEndHelper, wallSyncStartHelper)
    wallSyncIncomingHelper.y = 0

    wallSyncStartHelper.set(next.start.x, next.start.y, next.start.z)
    wallSyncEndHelper.set(next.end.x, next.end.y, next.end.z)
    wallSyncOutgoingHelper.subVectors(wallSyncEndHelper, wallSyncStartHelper)
    wallSyncOutgoingHelper.y = 0
    if (wallSyncIncomingHelper.lengthSq() < WALL_SYNC_EPSILON || wallSyncOutgoingHelper.lengthSq() < WALL_SYNC_EPSILON) {
      return
    }

    wallSyncIncomingHelper.normalize()
    wallSyncOutgoingHelper.normalize()
    const dotInterior = THREE.MathUtils.clamp(-wallSyncIncomingHelper.dot(wallSyncOutgoingHelper), -1, 1)
    const angle = Math.acos(dotInterior)
    if (!Number.isFinite(angle)) {
      return
    }

    const rule = pickWallCornerRule(angle, rulesSource, options.mode)
    if (!rule) {
      return
    }

    const rawAsset = options.mode === 'body'
      ? rule.bodyAssetId
      : options.mode === 'head'
        ? rule.headAssetId
        : rule.footAssetId
    const assetId = typeof rawAsset === 'string' ? rawAsset.trim() : ''
    if (!assetId) {
      return
    }

    const bounds = options.getAssetBounds(assetId)
    const bodyHeight = resolveWallBodyHeightForSegment(current)
    const templateHeight = bounds ? resolveWallModelHeight(bounds) : 1
    const minY = bounds ? bounds.min.y : 0
    const scaleY = options.mode === 'body' ? (bodyHeight / templateHeight) : 1
    const baselineY = corner.y
    const posY = options.mode === 'body'
      ? (baselineY - scaleY * minY)
      : options.mode === 'head'
        ? (baselineY + bodyHeight - minY)
        : (baselineY - minY)

    wallSyncBisectorHelper.copy(wallSyncIncomingHelper).multiplyScalar(-1).add(wallSyncOutgoingHelper)
    if (wallSyncBisectorHelper.lengthSq() < WALL_SYNC_EPSILON) {
      wallSyncBisectorHelper.copy(wallSyncOutgoingHelper)
    }

    const localForward = new THREE.Vector3()
    const forwardAxis = options.mode === 'body'
      ? rule.bodyForwardAxis
      : options.mode === 'head'
        ? rule.headForwardAxis
        : rule.footForwardAxis
    const yawDeg = options.mode === 'body'
      ? rule.bodyYawDeg
      : options.mode === 'head'
        ? rule.headYawDeg
        : rule.footYawDeg
    writeWallLocalForward(localForward, forwardAxis)
    const quat = new THREE.Quaternion().setFromUnitVectors(localForward, wallSyncBisectorHelper.normalize())
    if (typeof yawDeg === 'number' && Number.isFinite(yawDeg) && Math.abs(yawDeg) > 1e-9) {
      wallSyncYawQuatHelper.setFromAxisAngle(wallSyncYawAxis, THREE.MathUtils.degToRad(yawDeg))
      quat.multiply(wallSyncYawQuatHelper)
    }

    wallSyncScaleHelper.set(1, scaleY, 1)
    wallSyncPosHelper.set(corner.x, posY, corner.z)
    const rawOffset = options.mode === 'body'
      ? rule.bodyOffsetLocal
      : options.mode === 'head'
        ? rule.headOffsetLocal
        : rule.footOffsetLocal
    const offsetRecord = rawOffset && typeof rawOffset === 'object' ? (rawOffset as Record<string, unknown>) : null
    const readOffset = (key: 'x' | 'y' | 'z'): number => {
      const raw = offsetRecord ? offsetRecord[key] : 0
      const num = typeof raw === 'number' ? raw : Number(raw)
      return Number.isFinite(num) ? num : 0
    }
    wallSyncLocalOffsetHelper.set(readOffset('x'), readOffset('y'), readOffset('z'))
    wallSyncLocalOffsetHelper.applyQuaternion(quat)
    wallSyncPosHelper.add(wallSyncLocalOffsetHelper)
    wallSyncLocalMatrixHelper.compose(wallSyncPosHelper, quat, wallSyncScaleHelper)
    pushMatrix(assetId, new THREE.Matrix4().copy(wallSyncLocalMatrixHelper))
  }

  const segsByChainIndex = new Map<number, WallRenderSegment[]>()
  for (const seg of compiledSegs) {
    const ci = Math.max(0, Math.trunc(Number(seg.chainIndex ?? 0)))
    let bucket = segsByChainIndex.get(ci)
    if (!bucket) {
      bucket = []
      segsByChainIndex.set(ci, bucket)
    }
    bucket.push(seg)
  }

  for (const segs of segsByChainIndex.values()) {
    for (let i = 0; i < segs.length - 1; i += 1) {
      const current = segs[i]!
      const next = segs[i + 1]!
      wallSyncStartHelper.set(current.end.x, current.end.y, current.end.z)
      wallSyncEndHelper.set(next.start.x, next.start.y, next.start.z)
      if (distanceSqXZ(wallSyncStartHelper, wallSyncEndHelper) > WALL_SYNC_EPSILON) {
        continue
      }
      wallSyncPosHelper.set(current.end.x, current.end.y, current.end.z)
      buildCorner(current, next, wallSyncPosHelper)
    }

    if (segs.length >= 1) {
      const first = segs[0]!
      const last = segs[segs.length - 1]!
      wallSyncStartHelper.set(last.end.x, last.end.y, last.end.z)
      wallSyncEndHelper.set(first.start.x, first.start.y, first.start.z)
      if (distanceSqXZ(wallSyncStartHelper, wallSyncEndHelper) <= WALL_SYNC_EPSILON) {
        wallSyncPosHelper.copy(wallSyncStartHelper)
        buildCorner(last, first, wallSyncPosHelper)
      }
    }
  }

  return { matricesByAssetId, primaryAssetId, mode: options.mode }
}

function computeWallEndCapLocalMatrices(
  definition: WallDynamicMesh,
  bounds: THREE.Box3,
  mode: WallPlacementMode,
  orientation: WallModelOrientation,
  offsetLocalValue?: WallOffsetLocal | null,
): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = []
  const compiledSegs = compileWallSegmentsFromDefinition(definition)
  if (!compiledSegs.length) {
    return matrices
  }

  const chains = splitWallSegmentsIntoChains(compiledSegs)
  const localForward = new THREE.Vector3()
  writeWallLocalForward(localForward, orientation.forwardAxis)
  const { minAlongAxis } = resolveWallBoundsAlongAxis(bounds, orientation.forwardAxis)
  const templateHeight = resolveWallModelHeight(bounds)
  const minY = bounds.min.y
  const endCapOffsetLocal = new THREE.Vector3(
    Number((offsetLocalValue as any)?.x) || 0,
    Number((offsetLocalValue as any)?.y) || 0,
    Number((offsetLocalValue as any)?.z) || 0,
  )

  const findDirectionForSegment = (segment: WallRenderSegment | null, fallback: THREE.Vector3): THREE.Vector3 => {
    if (!segment) {
      return fallback
    }
    fallback.set(segment.end.x - segment.start.x, 0, segment.end.z - segment.start.z)
    if (fallback.lengthSq() <= WALL_SYNC_EPSILON) {
      return fallback
    }
    return fallback.normalize()
  }

  for (const chain of chains) {
    if (!chain.length) {
      continue
    }
    const firstSeg = chain[0]!
    const lastSeg = chain[chain.length - 1]!
    wallSyncStartHelper.set(firstSeg.start.x, firstSeg.start.y, firstSeg.start.z)
    wallSyncEndHelper.set(lastSeg.end.x, lastSeg.end.y, lastSeg.end.z)
    const closed = distanceSqXZ(wallSyncStartHelper, wallSyncEndHelper) <= WALL_SYNC_EPSILON
    if (closed) {
      continue
    }

    const firstDir = findDirectionForSegment(firstSeg, wallSyncLocalUnitDirHelper)
    if (firstDir.lengthSq() > WALL_SYNC_EPSILON) {
      const bodyHeight = resolveWallBodyHeightForSegment(firstSeg)
      const scaleY = mode === 'body' ? (bodyHeight / templateHeight) : 1
      wallSyncLocalDirHelper.copy(firstDir).multiplyScalar(-1)
      const quat = new THREE.Quaternion().setFromUnitVectors(localForward, wallSyncLocalDirHelper)
      if (orientation.yawDeg) {
        wallSyncYawQuatHelper.setFromAxisAngle(wallSyncYawAxis, THREE.MathUtils.degToRad(orientation.yawDeg))
        quat.multiply(wallSyncYawQuatHelper)
      }
      wallSyncLocalOffsetHelper.copy(localForward).multiplyScalar(minAlongAxis)
      wallSyncLocalOffsetHelper.applyQuaternion(quat)
      const baselineY = firstSeg.start.y
      const posY = mode === 'body'
        ? (baselineY - scaleY * minY)
        : mode === 'head'
          ? (baselineY + bodyHeight - minY)
          : (baselineY - minY)
      wallSyncPosHelper.set(firstSeg.start.x, posY, firstSeg.start.z)
      wallSyncPosHelper.sub(wallSyncLocalOffsetHelper)
      wallSyncStartHelper.copy(endCapOffsetLocal).applyQuaternion(quat)
      wallSyncPosHelper.add(wallSyncStartHelper)
      wallSyncScaleHelper.set(1, scaleY, 1)
      wallSyncLocalMatrixHelper.compose(wallSyncPosHelper, quat, wallSyncScaleHelper)
      matrices.push(new THREE.Matrix4().copy(wallSyncLocalMatrixHelper))
    }

    const lastDir = findDirectionForSegment(lastSeg, wallSyncLocalUnitDirHelper)
    if (lastDir.lengthSq() > WALL_SYNC_EPSILON) {
      const bodyHeight = resolveWallBodyHeightForSegment(lastSeg)
      const scaleY = mode === 'body' ? (bodyHeight / templateHeight) : 1
      wallSyncLocalDirHelper.copy(lastDir)
      const quat = new THREE.Quaternion().setFromUnitVectors(localForward, wallSyncLocalDirHelper)
      if (orientation.yawDeg) {
        wallSyncYawQuatHelper.setFromAxisAngle(wallSyncYawAxis, THREE.MathUtils.degToRad(orientation.yawDeg))
        quat.multiply(wallSyncYawQuatHelper)
      }
      wallSyncLocalOffsetHelper.copy(localForward).multiplyScalar(minAlongAxis)
      wallSyncLocalOffsetHelper.applyQuaternion(quat)
      const baselineY = lastSeg.end.y
      const posY = mode === 'body'
        ? (baselineY - scaleY * minY)
        : mode === 'head'
          ? (baselineY + bodyHeight - minY)
          : (baselineY - minY)
      wallSyncPosHelper.set(lastSeg.end.x, posY, lastSeg.end.z)
      wallSyncPosHelper.sub(wallSyncLocalOffsetHelper)
      wallSyncStartHelper.copy(endCapOffsetLocal).applyQuaternion(quat)
      wallSyncPosHelper.add(wallSyncStartHelper)
      wallSyncScaleHelper.set(1, scaleY, 1)
      wallSyncLocalMatrixHelper.compose(wallSyncPosHelper, quat, wallSyncScaleHelper)
      matrices.push(new THREE.Matrix4().copy(wallSyncLocalMatrixHelper))
    }
  }

  return matrices
}

type WallInstancedPlanParams = {
  nodeId: string
  definition: WallDynamicMesh
  wallProps: WallComponentProps | null
  getAssetBounds: (assetId: string) => THREE.Box3 | null
}

export function buildWallInstancedRenderPlan(params: WallInstancedPlanParams): WallInstancedRenderPlan {
  const effectiveDefinition = resolveWallEffectiveDefinition(params.definition, params.wallProps)
  if (!params.wallProps) {
    return {
      effectiveDefinition,
      wantsInstancing: false,
      hasBindings: false,
      hasProceduralBodyFallback: true,
      primaryAssetId: null,
      bindings: [],
      instancedBounds: null,
    }
  }

  const wallProps = params.wallProps
  const cornerModels = Array.isArray(wallProps.cornerModels) ? wallProps.cornerModels : []
  const bodyCornerAssetIds = Array.from(new Set(cornerModels.map((entry) => entry.bodyAssetId?.trim?.() ?? '').filter(Boolean))).sort()
  const headCornerAssetIds = Array.from(new Set(cornerModels.map((entry) => entry.headAssetId?.trim?.() ?? '').filter(Boolean))).sort()
  const footCornerAssetIds = Array.from(new Set(cornerModels.map((entry) => entry.footAssetId?.trim?.() ?? '').filter(Boolean))).sort()
  const canHaveCornerJoints =
    (bodyCornerAssetIds.length > 0 || headCornerAssetIds.length > 0 || footCornerAssetIds.length > 0)
    && (effectiveDefinition.chains?.some((chain) => (chain.points?.length ?? 0) >= 3) ?? false)

  const wantsInstancing = Boolean(
    wallProps.bodyAssetId
      || wallProps.headAssetId
      || wallProps.footAssetId
      || wallProps.bodyEndCapAssetId
      || wallProps.headEndCapAssetId
      || wallProps.footEndCapAssetId
      || canHaveCornerJoints,
  )

  if (!wantsInstancing || wallProps.isAirWall) {
    return {
      effectiveDefinition,
      wantsInstancing,
      hasBindings: false,
      hasProceduralBodyFallback: !wallProps.bodyAssetId,
      primaryAssetId: null,
      bindings: [],
      instancedBounds: null,
    }
  }

  const bindings: WallInstancedBindingSpec[] = []
  wallInstancedBoundsBox.makeEmpty()
  let hasWallBounds = false

  const pushBounds = (assetId: string, sourceAssetId: string | null | undefined, localMatrices: THREE.Matrix4[]) => {
    const bounds = params.getAssetBounds(sourceAssetId || assetId)
    if (!bounds || bounds.isEmpty()) {
      return
    }
    for (const localMatrix of localMatrices) {
      expandBoxByTransformedBoundingBox(wallInstancedBoundsBox, bounds, localMatrix)
      hasWallBounds = true
    }
  }

  if (wallProps.bodyAssetId) {
    const bounds = params.getAssetBounds(wallProps.bodyAssetId)
    if (bounds) {
      const placements = computeWallBodyLocalPlacements(
        effectiveDefinition,
        bounds,
        'body',
        wallProps.wallRenderMode,
        wallProps.bodyOrientation,
        wallProps.repeatInstanceStep,
        cornerModels,
      )
      const buckets = bucketWallPlacementsByRepeatScale(placements)
      for (let i = 0; i < buckets.length; i += 1) {
        const bucket = buckets[i]!
        const variantAssetId = buildWallRepeatVariantAssetId(wallProps.bodyAssetId, 'body', bucket.repeatScaleU)
        const localMatrices = bucket.placements.map((entry) => entry.matrix)
        if (!localMatrices.length) {
          continue
        }
        bindings.push({
          assetId: variantAssetId,
          sourceAssetId: wallProps.bodyAssetId,
          localMatrices,
          bindingIdPrefix: `wall-body:${params.nodeId}:${i}:`,
          useNodeIdForIndex0: i === 0,
          repeatScaleU: bucket.repeatScaleU,
        })
        pushBounds(variantAssetId, wallProps.bodyAssetId, localMatrices)
      }
    }
  }

  if (wallProps.headAssetId) {
    const bounds = params.getAssetBounds(wallProps.headAssetId)
    if (bounds) {
      const placements = computeWallBodyLocalPlacements(
        effectiveDefinition,
        bounds,
        'head',
        wallProps.wallRenderMode,
        wallProps.headOrientation,
        wallProps.repeatInstanceStep,
        cornerModels,
      )
      const buckets = bucketWallPlacementsByRepeatScale(placements)
      for (let i = 0; i < buckets.length; i += 1) {
        const bucket = buckets[i]!
        const variantAssetId = buildWallRepeatVariantAssetId(wallProps.headAssetId, 'head', bucket.repeatScaleU)
        const localMatrices = bucket.placements.map((entry) => entry.matrix)
        if (!localMatrices.length) {
          continue
        }
        bindings.push({
          assetId: variantAssetId,
          sourceAssetId: wallProps.headAssetId,
          localMatrices,
          bindingIdPrefix: `wall-head:${params.nodeId}:${i}:`,
          useNodeIdForIndex0: false,
          repeatScaleU: bucket.repeatScaleU,
        })
        pushBounds(variantAssetId, wallProps.headAssetId, localMatrices)
      }
    }
  }

  if (wallProps.footAssetId) {
    const bounds = params.getAssetBounds(wallProps.footAssetId)
    if (bounds) {
      const placements = computeWallBodyLocalPlacements(
        effectiveDefinition,
        bounds,
        'foot',
        wallProps.wallRenderMode,
        wallProps.footOrientation,
        wallProps.repeatInstanceStep,
        cornerModels,
      )
      const buckets = bucketWallPlacementsByRepeatScale(placements)
      for (let i = 0; i < buckets.length; i += 1) {
        const bucket = buckets[i]!
        const variantAssetId = buildWallRepeatVariantAssetId(wallProps.footAssetId, 'foot', bucket.repeatScaleU)
        const localMatrices = bucket.placements.map((entry) => entry.matrix)
        if (!localMatrices.length) {
          continue
        }
        bindings.push({
          assetId: variantAssetId,
          sourceAssetId: wallProps.footAssetId,
          localMatrices,
          bindingIdPrefix: `wall-foot:${params.nodeId}:${i}:`,
          useNodeIdForIndex0: false,
          repeatScaleU: bucket.repeatScaleU,
        })
        pushBounds(variantAssetId, wallProps.footAssetId, localMatrices)
      }
    }
  }

  const bodyJointBuckets = computeWallJointLocalMatricesByAsset(effectiveDefinition, {
    cornerModels,
    mode: 'body',
    getAssetBounds: params.getAssetBounds,
  })
  const headJointBuckets = computeWallJointLocalMatricesByAsset(effectiveDefinition, {
    cornerModels,
    mode: 'head',
    getAssetBounds: params.getAssetBounds,
  })
  const footJointBuckets = computeWallJointLocalMatricesByAsset(effectiveDefinition, {
    cornerModels,
    mode: 'foot',
    getAssetBounds: params.getAssetBounds,
  })
  const primaryCornerAssetId = bodyJointBuckets.primaryAssetId ?? headJointBuckets.primaryAssetId ?? footJointBuckets.primaryAssetId

  for (const jointBuckets of [bodyJointBuckets, headJointBuckets, footJointBuckets] as const) {
    if (!jointBuckets.matricesByAssetId.size) {
      continue
    }
    const sortedAssetIds = Array.from(jointBuckets.matricesByAssetId.keys()).sort()
    for (const assetId of sortedAssetIds) {
      const localMatrices = jointBuckets.matricesByAssetId.get(assetId) ?? []
      if (!localMatrices.length) {
        continue
      }
      bindings.push({
        assetId,
        localMatrices,
        bindingIdPrefix: `wall-joint-${jointBuckets.mode}:${params.nodeId}:${assetId}:`,
        useNodeIdForIndex0: !wallProps.bodyAssetId && assetId === primaryCornerAssetId,
      })
      pushBounds(assetId, assetId, localMatrices)
    }
  }

  if (wallProps.bodyEndCapAssetId) {
    const bounds = params.getAssetBounds(wallProps.bodyEndCapAssetId)
    if (bounds) {
      const localMatrices = computeWallEndCapLocalMatrices(
        effectiveDefinition,
        bounds,
        'body',
        wallProps.bodyEndCapOrientation,
        wallProps.bodyEndCapOffsetLocal,
      )
      if (localMatrices.length > 0) {
        bindings.push({
          assetId: wallProps.bodyEndCapAssetId,
          localMatrices,
          bindingIdPrefix: `wall-cap-body:${params.nodeId}:`,
          useNodeIdForIndex0: !wallProps.bodyAssetId && !primaryCornerAssetId,
        })
        pushBounds(wallProps.bodyEndCapAssetId, wallProps.bodyEndCapAssetId, localMatrices)
      }
    }
  }

  if (wallProps.headEndCapAssetId) {
    const bounds = params.getAssetBounds(wallProps.headEndCapAssetId)
    if (bounds) {
      const localMatrices = computeWallEndCapLocalMatrices(
        effectiveDefinition,
        bounds,
        'head',
        wallProps.headEndCapOrientation,
        wallProps.headEndCapOffsetLocal,
      )
      if (localMatrices.length > 0) {
        bindings.push({
          assetId: wallProps.headEndCapAssetId,
          localMatrices,
          bindingIdPrefix: `wall-cap-head:${params.nodeId}:`,
          useNodeIdForIndex0: false,
        })
        pushBounds(wallProps.headEndCapAssetId, wallProps.headEndCapAssetId, localMatrices)
      }
    }
  }

  if (wallProps.footEndCapAssetId) {
    const bounds = params.getAssetBounds(wallProps.footEndCapAssetId)
    if (bounds) {
      const localMatrices = computeWallEndCapLocalMatrices(
        effectiveDefinition,
        bounds,
        'foot',
        wallProps.footEndCapOrientation,
        wallProps.footEndCapOffsetLocal,
      )
      if (localMatrices.length > 0) {
        bindings.push({
          assetId: wallProps.footEndCapAssetId,
          localMatrices,
          bindingIdPrefix: `wall-cap-foot:${params.nodeId}:`,
          useNodeIdForIndex0: false,
        })
        pushBounds(wallProps.footEndCapAssetId, wallProps.footEndCapAssetId, localMatrices)
      }
    }
  }

  const primaryAssetId = bindings[0]?.assetId ?? null
  return {
    effectiveDefinition,
    wantsInstancing,
    hasBindings: bindings.length > 0,
    hasProceduralBodyFallback: !wallProps.bodyAssetId,
    primaryAssetId,
    bindings,
    instancedBounds: hasWallBounds && !wallInstancedBoundsBox.isEmpty()
      ? {
          min: [wallInstancedBoundsBox.min.x, wallInstancedBoundsBox.min.y, wallInstancedBoundsBox.min.z],
          max: [wallInstancedBoundsBox.max.x, wallInstancedBoundsBox.max.y, wallInstancedBoundsBox.max.z],
        }
      : null,
  }
}

function normalizeWallInstancedBindingsUserData(value: unknown): WallInstancedBindingSpec[] {
  return Array.isArray(value) ? value.filter((entry) => Boolean(entry && typeof entry === 'object')) as WallInstancedBindingSpec[] : []
}

export function setWallInstancedBindingsOnObject(object: THREE.Object3D, plan: WallInstancedRenderPlan): void {
  const userData = object.userData ?? (object.userData = {})
  userData[WALL_INSTANCED_BINDINGS_USERDATA_KEY] = plan.bindings
  if (plan.primaryAssetId) {
    userData.instancedAssetId = plan.primaryAssetId
  } else {
    delete userData.instancedAssetId
  }
  if (plan.instancedBounds) {
    userData.instancedBounds = plan.instancedBounds
  } else {
    delete userData.instancedBounds
  }
}

export function clearWallInstancedBindingsOnObject(object: THREE.Object3D): void {
  const userData = object.userData ?? (object.userData = {})
  delete userData[WALL_INSTANCED_BINDINGS_USERDATA_KEY]
}

export function hasWallInstancedBindings(object: THREE.Object3D | null | undefined): boolean {
  if (!object) {
    return false
  }
  const userData = object.userData as Record<string, unknown> | undefined
  return normalizeWallInstancedBindingsUserData(userData?.[WALL_INSTANCED_BINDINGS_USERDATA_KEY]).length > 0
}

export function applyWallInstancedBindings(params: {
  nodeId: string
  object: THREE.Object3D
  bindings: WallInstancedBindingSpec[]
}): boolean {
  const nodeId = typeof params.nodeId === 'string' ? params.nodeId.trim() : ''
  if (!nodeId) {
    return false
  }

  let applied = false
  for (const binding of params.bindings) {
    const assetId = typeof binding.assetId === 'string' ? binding.assetId.trim() : ''
    if (!assetId || !Array.isArray(binding.localMatrices) || binding.localMatrices.length === 0) {
      continue
    }
    if (binding.sourceAssetId && binding.repeatScaleU && binding.sourceAssetId !== assetId) {
      const variant = getOrCreateModelObjectRepeatVariant(binding.sourceAssetId, assetId, binding.repeatScaleU)
      if (!variant) {
        continue
      }
    }
    syncInstancedModelCommittedLocalMatrices({
      nodeId,
      assetId,
      object: params.object,
      localMatrices: binding.localMatrices,
      bindingIdPrefix: binding.bindingIdPrefix,
      useNodeIdForIndex0: binding.useNodeIdForIndex0,
    })
    applied = true
  }
  return applied
}

export function syncWallInstancedBindingsForObject(object: THREE.Object3D | null | undefined): boolean {
  if (!object) {
    return false
  }
  const userData = object.userData as Record<string, unknown> | undefined
  const nodeId = typeof userData?.nodeId === 'string' ? userData.nodeId : ''
  const bindings = normalizeWallInstancedBindingsUserData(userData?.[WALL_INSTANCED_BINDINGS_USERDATA_KEY])
  if (!nodeId || !bindings.length) {
    return false
  }
  return applyWallInstancedBindings({ nodeId, object, bindings })
}

export function syncWallDragBindingMatrices(params: {
  nodeId: string
  baseMatrix: THREE.Matrix4
  bindings: WallInstancedBindingSpec[]
}): boolean {
  const nodeId = typeof params.nodeId === 'string' ? params.nodeId.trim() : ''
  if (!nodeId) {
    return false
  }

  const helper = new THREE.Matrix4()
  let updated = false
  for (const binding of params.bindings) {
    const assetId = typeof binding.assetId === 'string' ? binding.assetId.trim() : ''
    if (!assetId || !binding.localMatrices.length) {
      continue
    }

    if (binding.sourceAssetId && binding.repeatScaleU && binding.sourceAssetId !== assetId) {
      const variant = getOrCreateModelObjectRepeatVariant(binding.sourceAssetId, assetId, binding.repeatScaleU)
      if (!variant) {
        continue
      }
    }

    ensureInstancedMeshesRegistered(assetId)
    const count = binding.localMatrices.length
    for (let i = 0; i < count; i += 1) {
      const local = binding.localMatrices[i]
      if (!local) {
        continue
      }
      if (binding.useNodeIdForIndex0 && i === 0) {
        allocateModelInstance(assetId, nodeId)
        helper.multiplyMatrices(params.baseMatrix, local)
        updateModelInstanceMatrix(nodeId, helper)
        updated = true
        continue
      }
      const bindingId = `${binding.bindingIdPrefix}${i}`
      allocateModelInstanceBinding(assetId, bindingId, nodeId)
      helper.multiplyMatrices(params.baseMatrix, local)
      updateModelInstanceBindingMatrix(bindingId, helper)
      updated = true
    }
  }

  return updated
}