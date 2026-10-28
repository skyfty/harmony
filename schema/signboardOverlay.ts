import * as THREE from 'three'
import { computeFollowLerpAlpha } from './followCameraController'

type Vector3Like = { x: number; y: number; z: number }

export const SIGNBOARD_WORLD_Y_OFFSET = 0.35
export const SIGNBOARD_MAX_DISTANCE = 120
export const SIGNBOARD_FADE_START_DISTANCE = 78
export const SIGNBOARD_FULL_SCALE_DISTANCE = 10
export const SIGNBOARD_CLOSE_FADE_DISTANCE = 3
export const SIGNBOARD_MIN_SCREEN_Y_PERCENT = 7
export const SIGNBOARD_MIN_SCALE = 0.56
export const SIGNBOARD_MAX_SCALE = 1.14
export const SIGNBOARD_SCREEN_MARGIN = 0.08
export const DEFAULT_SIGNBOARD_REFERENCE_SMOOTH_SPEED = 6
export const DEFAULT_SIGNBOARD_PLACEMENT_SMOOTH_SPEED = 9
export const SIGNBOARD_GUIDANCE_MAX_ENTRIES = 4
export const SIGNBOARD_GUIDANCE_DEFAULT_INSET_PX = 16
export const SIGNBOARD_GUIDANCE_DEFAULT_MARKER_HEIGHT_PX = 46
export const SIGNBOARD_NEAR_HIDE_DISTANCE = 8
export const SIGNBOARD_NEAR_FADE_END_DISTANCE = 14
export const SIGNBOARD_CARD_FAR_OPACITY = 0.8
export const SIGNBOARD_CARD_FAR_SCALE = 0.86
export const SIGNBOARD_GUIDANCE_MIN_OPACITY = 0.72
export const SIGNBOARD_GUIDANCE_MIN_SCALE = 0.82
export const SIGNBOARD_GUIDANCE_VISUAL_SATURATION_DISTANCE = 2000

export type SignboardReferenceKind = 'camera' | 'vehicle'
export type SignboardGuidanceEdge = 'top' | 'right' | 'bottom' | 'left'

export interface SignboardOverlayPlacement {
  xPercent: number
  yPercent: number
  scale: number
  opacity: number
  distanceMeters: number
  distanceLabel: string
}

export interface SignboardDistancePresentation {
  visible: boolean
  opacity: number
  scale: number
}

export interface SignboardReferenceSmoothingState {
  initialized: boolean
  kind: SignboardReferenceKind | null
  nodeId: string | null
  position: THREE.Vector3
}

export interface SignboardPlacementSmoothingState {
  initialized: boolean
  xPercent: number
  yPercent: number
  scale: number
  opacity: number
}

export interface PurposeOverlayPlacement extends SignboardOverlayPlacement {}

export interface PurposeOverlayPlacementCandidate {
  id: string
  placement: PurposeOverlayPlacement
  estimatedWidthPx: number
  estimatedHeightPx: number
}

export interface SignboardGuidanceInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface SignboardGuidanceCandidate {
  nodeId: string
  label: string
  anchorWorld: THREE.Vector3 | Vector3Like
  distanceMeters: number
  estimatedWidthPx?: number
  estimatedHeightPx?: number
}

export interface SignboardGuidanceEntry {
  nodeId: string
  label: string
  distanceMeters: number
  distanceLabel: string
  xPercent: number
  yPercent: number
  arrowAngleDeg: number
  edge: SignboardGuidanceEdge
  scale: number
  opacity: number
  estimatedWidthPx: number
  estimatedHeightPx: number
}

const purposeAnchorWorldBox = new THREE.Box3()
const purposeAnchorWorldCenter = new THREE.Vector3()
const purposePlacementWorld = new THREE.Vector3()
const purposePlacementReference = new THREE.Vector3()
const purposePlacementProjected = new THREE.Vector3()
const purposeResolvedPlacements: Array<{
  id: string
  placement: PurposeOverlayPlacement
  estimatedWidthPx: number
  estimatedHeightPx: number
  rect: { left: number; top: number; right: number; bottom: number }
}> = []

const placementWorld = new THREE.Vector3()
const placementReference = new THREE.Vector3()
const projected = new THREE.Vector3()
const anchorBox = new THREE.Box3()
const anchorCenter = new THREE.Vector3()
const smoothedReferenceTarget = new THREE.Vector3()
const guidanceCameraSpace = new THREE.Vector3()
const guidanceProjected = new THREE.Vector3()

function copyVector3(target: THREE.Vector3, source: THREE.Vector3 | Vector3Like): THREE.Vector3 {
  target.set(source.x, source.y, source.z)
  return target
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(Math.max(value, 0), 1)
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}

function smoothstep01(value: number): number {
  const clamped = clamp01(value)
  return clamped * clamped * (3 - 2 * clamped)
}

export function computeSignboardDistancePresentation(distanceMeters: number): SignboardDistancePresentation {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return {
      visible: false,
      opacity: 0,
      scale: SIGNBOARD_CARD_FAR_SCALE,
    }
  }
  if (distanceMeters < SIGNBOARD_NEAR_HIDE_DISTANCE) {
    return {
      visible: false,
      opacity: 0,
      scale: SIGNBOARD_CARD_FAR_SCALE,
    }
  }

  const nearFade = smoothstep01(
    (distanceMeters - SIGNBOARD_NEAR_HIDE_DISTANCE)
      / Math.max(SIGNBOARD_NEAR_FADE_END_DISTANCE - SIGNBOARD_NEAR_HIDE_DISTANCE, 1e-6),
  )
  if (distanceMeters < SIGNBOARD_NEAR_FADE_END_DISTANCE) {
    return {
      visible: true,
      opacity: nearFade,
      scale: lerp(SIGNBOARD_CARD_FAR_SCALE, 1, nearFade),
    }
  }

  if (distanceMeters <= SIGNBOARD_MAX_DISTANCE) {
    const farFade = smoothstep01(
      (distanceMeters - SIGNBOARD_NEAR_FADE_END_DISTANCE)
        / Math.max(SIGNBOARD_MAX_DISTANCE - SIGNBOARD_NEAR_FADE_END_DISTANCE, 1e-6),
    )
    return {
      visible: true,
      opacity: lerp(1, SIGNBOARD_CARD_FAR_OPACITY, farFade),
      scale: lerp(1, SIGNBOARD_CARD_FAR_SCALE, farFade),
    }
  }

  const guidanceFade = smoothstep01(
    (distanceMeters - SIGNBOARD_MAX_DISTANCE)
      / Math.max(SIGNBOARD_GUIDANCE_VISUAL_SATURATION_DISTANCE - SIGNBOARD_MAX_DISTANCE, 1e-6),
  )
  return {
    visible: true,
    opacity: lerp(SIGNBOARD_CARD_FAR_OPACITY, SIGNBOARD_GUIDANCE_MIN_OPACITY, guidanceFade),
    scale: lerp(SIGNBOARD_CARD_FAR_SCALE, SIGNBOARD_GUIDANCE_MIN_SCALE, guidanceFade),
  }
}

export function createSignboardReferenceSmoothingState(): SignboardReferenceSmoothingState {
  return {
    initialized: false,
    kind: null,
    nodeId: null,
    position: new THREE.Vector3(),
  }
}

export function resetSignboardReferenceSmoothingState(state: SignboardReferenceSmoothingState): void {
  state.initialized = false
  state.kind = null
  state.nodeId = null
  state.position.set(0, 0, 0)
}

export function createSignboardPlacementSmoothingState(): SignboardPlacementSmoothingState {
  return {
    initialized: false,
    xPercent: 0,
    yPercent: 0,
    scale: 1,
    opacity: 1,
  }
}

export function resetSignboardPlacementSmoothingState(state: SignboardPlacementSmoothingState): void {
  state.initialized = false
  state.xPercent = 0
  state.yPercent = 0
  state.scale = 1
  state.opacity = 1
}

export function smoothSignboardReference(
  state: SignboardReferenceSmoothingState,
  params: {
    targetWorld: THREE.Vector3 | Vector3Like
    deltaSeconds: number
    kind: SignboardReferenceKind
    nodeId: string | null
    speed?: number
  },
): THREE.Vector3 {
  copyVector3(smoothedReferenceTarget, params.targetWorld)
  const bindingChanged = state.kind !== params.kind || state.nodeId !== params.nodeId
  if (!state.initialized || bindingChanged) {
    state.position.copy(smoothedReferenceTarget)
    state.initialized = true
  } else {
    const alpha = computeFollowLerpAlpha(params.deltaSeconds, params.speed ?? DEFAULT_SIGNBOARD_REFERENCE_SMOOTH_SPEED)
    state.position.lerp(smoothedReferenceTarget, alpha)
  }
  state.kind = params.kind
  state.nodeId = params.nodeId
  return state.position
}

export function smoothSignboardPlacement(
  state: SignboardPlacementSmoothingState,
  params: {
    placement: SignboardOverlayPlacement
    deltaSeconds: number
    speed?: number
  },
): SignboardOverlayPlacement {
  const { placement } = params
  if (!state.initialized) {
    state.initialized = true
    state.xPercent = placement.xPercent
    state.yPercent = placement.yPercent
    state.scale = placement.scale
    state.opacity = placement.opacity
  } else {
    const alpha = computeFollowLerpAlpha(params.deltaSeconds, params.speed ?? DEFAULT_SIGNBOARD_PLACEMENT_SMOOTH_SPEED)
    state.xPercent = lerp(state.xPercent, placement.xPercent, alpha)
    state.yPercent = lerp(state.yPercent, placement.yPercent, alpha)
    state.scale = lerp(state.scale, placement.scale, alpha)
    state.opacity = lerp(state.opacity, placement.opacity, alpha)
  }
  return {
    ...placement,
    xPercent: state.xPercent,
    yPercent: state.yPercent,
    scale: state.scale,
    opacity: state.opacity,
  }
}

export function resolveSignboardDisplayLabel(
  explicitLabel: string | null | undefined,
  nodeName: string | null | undefined,
  fallbackId = '',
): string {
  const label = typeof explicitLabel === 'string' ? explicitLabel.trim() : ''
  if (label.length) {
    return label
  }
  const name = typeof nodeName === 'string' ? nodeName.trim() : ''
  if (name.length) {
    return name
  }
  return fallbackId
}

export function formatSignboardDistance(distanceMeters: number): string {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return '--'
  }
  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(distanceMeters >= 10000 ? 0 : 1)} km`
  }
  if (distanceMeters >= 10) {
    return `${distanceMeters.toFixed(1)} m`
  }
  return `${distanceMeters.toFixed(2)} m`
}

export function resolveSignboardAnchorWorldPosition(
  object: THREE.Object3D,
  target = new THREE.Vector3(),
  yOffset = SIGNBOARD_WORLD_Y_OFFSET,
): THREE.Vector3 {
  anchorBox.setFromObject(object)
  if (!anchorBox.isEmpty()) {
    anchorBox.getCenter(anchorCenter)
    target.set(anchorCenter.x, anchorBox.max.y + yOffset, anchorCenter.z)
    return target
  }
  object.getWorldPosition(target)
  target.y += yOffset
  return target
}

export function resolvePurposeOverlayAnchorWorldPosition(
  object: THREE.Object3D,
  target = new THREE.Vector3(),
  options: {
    shortHeightThreshold?: number
    tallHeightThreshold?: number
    topOffset?: number
    middleRatio?: number
  } = {},
): THREE.Vector3 {
  const shortHeightThreshold = options.shortHeightThreshold ?? 1.6
  const tallHeightThreshold = Math.max(options.tallHeightThreshold ?? 5.4, shortHeightThreshold + 1e-3)
  const topOffset = options.topOffset ?? SIGNBOARD_WORLD_Y_OFFSET
  const middleRatio = options.middleRatio ?? 0.58

  purposeAnchorWorldBox.setFromObject(object)
  if (purposeAnchorWorldBox.isEmpty()) {
    object.getWorldPosition(target)
    target.y += topOffset
    return target
  }

  purposeAnchorWorldBox.getCenter(purposeAnchorWorldCenter)
  const height = Math.max(0, purposeAnchorWorldBox.max.y - purposeAnchorWorldBox.min.y)
  if (height <= shortHeightThreshold) {
    target.set(purposeAnchorWorldCenter.x, purposeAnchorWorldBox.max.y + topOffset, purposeAnchorWorldCenter.z)
    return target
  }

  const topY = purposeAnchorWorldBox.max.y + topOffset
  const middleY = purposeAnchorWorldBox.min.y + (height * middleRatio)
  if (height >= tallHeightThreshold) {
    target.set(purposeAnchorWorldCenter.x, middleY, purposeAnchorWorldCenter.z)
    return target
  }

  const blend = clamp01((height - shortHeightThreshold) / (tallHeightThreshold - shortHeightThreshold))
  target.set(
    purposeAnchorWorldCenter.x,
    lerp(topY, middleY, blend),
    purposeAnchorWorldCenter.z,
  )
  return target
}

function clampPurposeOverlayPlacement(
  placement: PurposeOverlayPlacement,
  params: {
    viewportWidth: number
    viewportHeight: number
    estimatedWidthPx: number
    estimatedHeightPx: number
    screenMarginPx: number
  },
): PurposeOverlayPlacement {
  const viewportWidth = Math.max(1, params.viewportWidth)
  const viewportHeight = Math.max(1, params.viewportHeight)
  const estimatedWidthPx = Math.max(0, params.estimatedWidthPx)
  const estimatedHeightPx = Math.max(0, params.estimatedHeightPx)
  const halfWidthPercent = ((estimatedWidthPx * 0.5) + params.screenMarginPx) / viewportWidth * 100
  const heightPercent = ((estimatedHeightPx) + params.screenMarginPx) / viewportHeight * 100

  const minX = Math.min(50, halfWidthPercent)
  const maxX = Math.max(minX, 100 - halfWidthPercent)
  const minY = Math.min(50, heightPercent)
  const maxY = Math.max(minY, 100 - (params.screenMarginPx / viewportHeight * 100))

  return {
    ...placement,
    xPercent: Math.min(Math.max(placement.xPercent, minX), maxX),
    yPercent: Math.min(Math.max(placement.yPercent, minY), maxY),
  }
}

export function computePurposeOverlayPlacement(params: {
  anchorWorld: THREE.Vector3 | Vector3Like
  referenceWorld: THREE.Vector3 | Vector3Like
  camera: THREE.Camera
  viewportWidth: number
  viewportHeight: number
  maxDistance?: number
  fadeStartDistance?: number
  fullScaleDistance?: number
  closeFadeDistance?: number
  minScreenYPercent?: number
  minScale?: number
  maxScale?: number
  screenMarginPx?: number
  estimatedWidthPx?: number
  estimatedHeightPx?: number
}): PurposeOverlayPlacement | null {
  const maxDistance = params.maxDistance ?? SIGNBOARD_MAX_DISTANCE
  const fadeStartDistance = Math.min(params.fadeStartDistance ?? SIGNBOARD_FADE_START_DISTANCE, maxDistance)
  const fullScaleDistance = Math.min(params.fullScaleDistance ?? SIGNBOARD_FULL_SCALE_DISTANCE, fadeStartDistance)
  const closeFadeDistance = Math.max(params.closeFadeDistance ?? SIGNBOARD_CLOSE_FADE_DISTANCE, 0)
  const minScreenYPercent = Math.max(params.minScreenYPercent ?? 0, 0)
  const minScale = params.minScale ?? SIGNBOARD_MIN_SCALE
  const maxScale = params.maxScale ?? SIGNBOARD_MAX_SCALE
  const screenMarginPx = Math.max(params.screenMarginPx ?? 12, 0)

  copyVector3(purposePlacementWorld, params.anchorWorld)
  copyVector3(purposePlacementReference, params.referenceWorld)

  const distanceMeters = purposePlacementWorld.distanceTo(purposePlacementReference)
  if (!Number.isFinite(distanceMeters) || distanceMeters > maxDistance) {
    return null
  }

  purposePlacementProjected.copy(purposePlacementWorld)
  purposePlacementProjected.project(params.camera)
  if (!Number.isFinite(purposePlacementProjected.x) || !Number.isFinite(purposePlacementProjected.y) || !Number.isFinite(purposePlacementProjected.z)) {
    return null
  }
  if (purposePlacementProjected.z < -1 || purposePlacementProjected.z > 1) {
    return null
  }

  const xNorm = purposePlacementProjected.x * 0.5 + 0.5
  const rawYNorm = purposePlacementProjected.y * -0.5 + 0.5
  const minScreenYNorm = minScreenYPercent / 100
  const yNorm = minScreenYNorm > 0
    ? Math.max(rawYNorm - 0.03, minScreenYNorm)
    : Math.max(rawYNorm - 0.03, 0)

  const scaleRange = Math.max(fadeStartDistance - fullScaleDistance, 1e-6)
  const scaleAmount = clamp01((distanceMeters - fullScaleDistance) / scaleRange)
  const fadeRange = Math.max(maxDistance - fadeStartDistance, 1e-6)
  const fadeAmount = clamp01((distanceMeters - fadeStartDistance) / fadeRange)
  const closeFadeAmount = closeFadeDistance > 0 ? clamp01(distanceMeters / closeFadeDistance) : 1

  const placement = clampPurposeOverlayPlacement(
    {
      xPercent: xNorm * 100,
      yPercent: yNorm * 100,
      scale: lerp(maxScale, minScale, scaleAmount),
      opacity: lerp(1, 0, fadeAmount) * closeFadeAmount,
      distanceMeters,
      distanceLabel: formatSignboardDistance(distanceMeters),
    },
    {
      viewportWidth: params.viewportWidth,
      viewportHeight: params.viewportHeight,
      estimatedWidthPx: params.estimatedWidthPx ?? 120,
      estimatedHeightPx: params.estimatedHeightPx ?? 40,
      screenMarginPx,
    },
  )

  return placement
}

function buildPurposeOverlayRect(
  placement: PurposeOverlayPlacement,
  estimatedWidthPx: number,
  estimatedHeightPx: number,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number; right: number; bottom: number } {
  const left = (placement.xPercent / 100) * viewportWidth - (estimatedWidthPx / 2)
  const top = (placement.yPercent / 100) * viewportHeight - estimatedHeightPx
  return {
    left,
    top,
    right: left + estimatedWidthPx,
    bottom: top + estimatedHeightPx,
  }
}

function rectsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom)
}

export function resolvePurposeOverlayPlacements(params: {
  placements: PurposeOverlayPlacementCandidate[]
  viewportWidth: number
  viewportHeight: number
  screenMarginPx?: number
}): PurposeOverlayPlacementCandidate[] {
  purposeResolvedPlacements.length = 0
  const viewportWidth = Math.max(1, params.viewportWidth)
  const viewportHeight = Math.max(1, params.viewportHeight)
  const screenMarginPx = Math.max(params.screenMarginPx ?? 12, 0)
  const sortedPlacements = params.placements
    .map((entry) => ({ ...entry }))
    .sort((a, b) => (
      a.placement.yPercent - b.placement.yPercent
      || a.placement.xPercent - b.placement.xPercent
      || a.id.localeCompare(b.id)
    ))
  const stepX = Math.max(8, Math.min(20, Math.round(viewportWidth * 0.015)))
  const stepY = Math.max(12, Math.min(28, Math.round(viewportHeight * 0.022)))
  const offsetPatterns = [
    { x: 0, y: 0 },
    { x: 0, y: -stepY },
    { x: 0, y: stepY },
    { x: stepX, y: 0 },
    { x: -stepX, y: 0 },
    { x: stepX, y: -stepY },
    { x: -stepX, y: -stepY },
    { x: stepX, y: stepY },
    { x: -stepX, y: stepY },
  ]

  for (const entry of sortedPlacements) {
    const widthPx = Math.max(36, entry.estimatedWidthPx)
    const heightPx = Math.max(28, entry.estimatedHeightPx)
    let placement = entry.placement
    let rect = buildPurposeOverlayRect(placement, widthPx, heightPx, viewportWidth, viewportHeight)
    const resolvePlacement = (candidate: PurposeOverlayPlacement): {
      placement: PurposeOverlayPlacement
      rect: { left: number; top: number; right: number; bottom: number }
    } => ({
      placement: clampPurposeOverlayPlacement(candidate, {
        viewportWidth,
        viewportHeight,
        estimatedWidthPx: widthPx,
        estimatedHeightPx: heightPx,
        screenMarginPx,
      }),
      rect: buildPurposeOverlayRect(
        clampPurposeOverlayPlacement(candidate, {
          viewportWidth,
          viewportHeight,
          estimatedWidthPx: widthPx,
          estimatedHeightPx: heightPx,
          screenMarginPx,
        }),
        widthPx,
        heightPx,
        viewportWidth,
        viewportHeight,
      ),
    })

    let conflict = purposeResolvedPlacements.some((resolved) => rectsOverlap(rect, resolved.rect))
    if (conflict) {
      for (const offset of offsetPatterns) {
        const shifted = resolvePlacement({
          ...placement,
          xPercent: placement.xPercent + (offset.x / viewportWidth) * 100,
          yPercent: placement.yPercent + (offset.y / viewportHeight) * 100,
        })
        placement = shifted.placement
        rect = shifted.rect
        conflict = purposeResolvedPlacements.some((resolved) => rectsOverlap(rect, resolved.rect))
        if (!conflict) {
          break
        }
      }
    }

    purposeResolvedPlacements.push({
      ...entry,
      placement,
      estimatedWidthPx: widthPx,
      estimatedHeightPx: heightPx,
      rect,
    })
  }

  return purposeResolvedPlacements.map(({ rect: _rect, ...entry }) => entry)
}

export function computeSignboardPlacement(params: {
  anchorWorld: THREE.Vector3 | Vector3Like
  referenceWorld: THREE.Vector3 | Vector3Like
  camera: THREE.Camera
  maxDistance?: number
  fadeStartDistance?: number
  fullScaleDistance?: number
  closeFadeDistance?: number
  minScreenYPercent?: number
  minScale?: number
  maxScale?: number
  screenMargin?: number
}): SignboardOverlayPlacement | null {
  const maxDistance = params.maxDistance ?? SIGNBOARD_MAX_DISTANCE
  const fadeStartDistance = Math.min(params.fadeStartDistance ?? SIGNBOARD_FADE_START_DISTANCE, maxDistance)
  const fullScaleDistance = Math.min(params.fullScaleDistance ?? SIGNBOARD_FULL_SCALE_DISTANCE, fadeStartDistance)
  const closeFadeDistance = Math.max(params.closeFadeDistance ?? SIGNBOARD_CLOSE_FADE_DISTANCE, 0)
  const minScreenYPercent = Math.max(params.minScreenYPercent ?? 0, 0)
  const minScale = params.minScale ?? SIGNBOARD_MIN_SCALE
  const maxScale = params.maxScale ?? SIGNBOARD_MAX_SCALE
  const screenMargin = params.screenMargin ?? SIGNBOARD_SCREEN_MARGIN
  const screenLift = 0.03

  copyVector3(placementWorld, params.anchorWorld)
  copyVector3(placementReference, params.referenceWorld)

  const distanceMeters = placementWorld.distanceTo(placementReference)
  if (!Number.isFinite(distanceMeters) || distanceMeters > maxDistance) {
    return null
  }

  projected.copy(placementWorld)
  projected.project(params.camera)
  if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !Number.isFinite(projected.z)) {
    return null
  }
  if (projected.z < -1 || projected.z > 1) {
    return null
  }

  const xNorm = projected.x * 0.5 + 0.5
  const rawYNorm = projected.y * -0.5 + 0.5
  if (
    xNorm < -screenMargin
    || xNorm > 1 + screenMargin
    || rawYNorm < -screenMargin
    || rawYNorm > 1 + screenMargin
  ) {
    return null
  }

  const minScreenYNorm = minScreenYPercent / 100
  const yNorm = minScreenYNorm > 0
    ? Math.max(rawYNorm - screenLift, minScreenYNorm)
    : Math.max(rawYNorm - screenLift, 0)

  const scaleRange = Math.max(fadeStartDistance - fullScaleDistance, 1e-6)
  const scaleAmount = clamp01((distanceMeters - fullScaleDistance) / scaleRange)
  const fadeRange = Math.max(maxDistance - fadeStartDistance, 1e-6)
  const fadeAmount = clamp01((distanceMeters - fadeStartDistance) / fadeRange)
  const closeFadeAmount = closeFadeDistance > 0 ? clamp01(distanceMeters / closeFadeDistance) : 1

  return {
    xPercent: xNorm * 100,
    yPercent: yNorm * 100,
    scale: lerp(maxScale, minScale, scaleAmount),
    opacity: lerp(1, 0, fadeAmount) * closeFadeAmount,
    distanceMeters,
    distanceLabel: formatSignboardDistance(distanceMeters),
  }
}

function normalizeGuidanceInset(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0
}

function resolveGuidanceMarkerDimensions(
  candidate: SignboardGuidanceCandidate,
  viewportWidth: number,
  insets: SignboardGuidanceInsets,
): { width: number; height: number } {
  const availableWidth = Math.max(1, viewportWidth - insets.left - insets.right)
  const estimatedWidth = Number.isFinite(candidate.estimatedWidthPx)
    ? candidate.estimatedWidthPx ?? 0
    : 88 + candidate.label.length * 8
  const width = Math.min(availableWidth, Math.max(148, Math.min(236, estimatedWidth)))
  const estimatedHeight = Number.isFinite(candidate.estimatedHeightPx)
    ? candidate.estimatedHeightPx ?? 0
    : SIGNBOARD_GUIDANCE_DEFAULT_MARKER_HEIGHT_PX
  const height = Math.max(28, estimatedHeight)
  return { width, height }
}

function guidanceRectsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  const gap = 6
  return !(
    a.right + gap <= b.left
    || a.left >= b.right + gap
    || a.bottom + gap <= b.top
    || a.top >= b.bottom + gap
  )
}

export function isSignboardAnchorInView(
  anchorWorld: THREE.Vector3 | Vector3Like,
  camera: THREE.Camera,
): boolean {
  camera.updateWorldMatrix(true, false)
  guidanceCameraSpace.set(anchorWorld.x, anchorWorld.y, anchorWorld.z)
  guidanceCameraSpace.applyMatrix4(camera.matrixWorldInverse)
  if (
    !Number.isFinite(guidanceCameraSpace.x)
    || !Number.isFinite(guidanceCameraSpace.y)
    || !Number.isFinite(guidanceCameraSpace.z)
    || guidanceCameraSpace.z >= -1e-5
  ) {
    return false
  }

  guidanceProjected.set(anchorWorld.x, anchorWorld.y, anchorWorld.z).project(camera)
  return (
    Number.isFinite(guidanceProjected.x)
    && Number.isFinite(guidanceProjected.y)
    && Number.isFinite(guidanceProjected.z)
    && guidanceProjected.x >= -1
    && guidanceProjected.x <= 1
    && guidanceProjected.y >= -1
    && guidanceProjected.y <= 1
    && guidanceProjected.z >= -1
    && guidanceProjected.z <= 1
  )
}

export function computeSignboardGuidanceEntries(params: {
  candidates: SignboardGuidanceCandidate[]
  camera: THREE.Camera
  viewportWidth: number
  viewportHeight: number
  safeArea?: Partial<SignboardGuidanceInsets>
  maxDistance?: number
  maxEntries?: number
}): SignboardGuidanceEntry[] {
  const viewportWidth = Math.max(1, params.viewportWidth)
  const viewportHeight = Math.max(1, params.viewportHeight)
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) {
    return []
  }

  const defaultInset = SIGNBOARD_GUIDANCE_DEFAULT_INSET_PX
  const insets: SignboardGuidanceInsets = {
    top: normalizeGuidanceInset(params.safeArea?.top ?? defaultInset),
    right: normalizeGuidanceInset(params.safeArea?.right ?? defaultInset),
    bottom: normalizeGuidanceInset(params.safeArea?.bottom ?? defaultInset),
    left: normalizeGuidanceInset(params.safeArea?.left ?? defaultInset),
  }
  const maxDistance = params.maxDistance ?? SIGNBOARD_MAX_DISTANCE
  const requestedMaxEntries = params.maxEntries ?? SIGNBOARD_GUIDANCE_MAX_ENTRIES
  const maxEntries = Number.isFinite(requestedMaxEntries)
    ? Math.max(0, Math.floor(requestedMaxEntries))
    : SIGNBOARD_GUIDANCE_MAX_ENTRIES
  if (maxEntries === 0) {
    return []
  }

  params.camera.updateWorldMatrix(true, false)
  const sortedCandidates = params.candidates
    .filter((candidate) => (
      candidate.nodeId.trim().length > 0
      && Number.isFinite(candidate.distanceMeters)
      && candidate.distanceMeters >= 0
      && Number.isFinite(candidate.anchorWorld.x)
      && Number.isFinite(candidate.anchorWorld.y)
      && Number.isFinite(candidate.anchorWorld.z)
    ))
    .slice()
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.nodeId.localeCompare(b.nodeId))

  const entries: SignboardGuidanceEntry[] = []
  const placedRects: Array<{ left: number; top: number; right: number; bottom: number }> = []
  const seenNodeIds = new Set<string>()

  for (const candidate of sortedCandidates) {
    if (seenNodeIds.has(candidate.nodeId)) {
      continue
    }

    guidanceCameraSpace
      .set(candidate.anchorWorld.x, candidate.anchorWorld.y, candidate.anchorWorld.z)
      .applyMatrix4(params.camera.matrixWorldInverse)
    if (
      !Number.isFinite(guidanceCameraSpace.x)
      || !Number.isFinite(guidanceCameraSpace.y)
      || !Number.isFinite(guidanceCameraSpace.z)
      || guidanceCameraSpace.z >= -1e-5
    ) {
      continue
    }
    const presentation = computeSignboardDistancePresentation(candidate.distanceMeters)
    if (!presentation.visible) {
      continue
    }
    seenNodeIds.add(candidate.nodeId)

    guidanceProjected
      .set(candidate.anchorWorld.x, candidate.anchorWorld.y, candidate.anchorWorld.z)
      .project(params.camera)
    const inView = (
      Number.isFinite(guidanceProjected.x)
      && Number.isFinite(guidanceProjected.y)
      && Number.isFinite(guidanceProjected.z)
      && guidanceProjected.x >= -1
      && guidanceProjected.x <= 1
      && guidanceProjected.y >= -1
      && guidanceProjected.y <= 1
      && guidanceProjected.z >= -1
      && guidanceProjected.z <= 1
    )
    if (!inView || candidate.distanceMeters <= maxDistance) {
      continue
    }

    const { width, height } = resolveGuidanceMarkerDimensions(candidate, viewportWidth, insets)
    const availableWidth = Math.max(1, viewportWidth - insets.left - insets.right)
    const availableHeight = Math.max(1, viewportHeight - insets.top - insets.bottom)
    const halfWidth = Math.min(width, availableWidth) / 2
    const halfHeight = Math.min(height, availableHeight) / 2
    let minX = insets.left + halfWidth
    let maxX = viewportWidth - insets.right - halfWidth
    let minY = insets.top + halfHeight
    let maxY = viewportHeight - insets.bottom - halfHeight
    if (minX > maxX) {
      minX = viewportWidth / 2
      maxX = minX
    }
    if (minY > maxY) {
      minY = viewportHeight / 2
      maxY = minY
    }

    let directionX = guidanceCameraSpace.x
    let directionY = guidanceCameraSpace.z
    let directionLength = Math.hypot(directionX, directionY)
    if (!Number.isFinite(directionLength) || directionLength <= 1e-6) {
      directionX = 0
      directionY = -1
      directionLength = 1
    }
    directionX /= directionLength
    directionY /= directionLength

    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    let intersectionDistance = Number.POSITIVE_INFINITY
    if (directionX > 1e-6) {
      intersectionDistance = Math.min(intersectionDistance, (maxX - centerX) / directionX)
    } else if (directionX < -1e-6) {
      intersectionDistance = Math.min(intersectionDistance, (minX - centerX) / directionX)
    }
    if (directionY > 1e-6) {
      intersectionDistance = Math.min(intersectionDistance, (maxY - centerY) / directionY)
    } else if (directionY < -1e-6) {
      intersectionDistance = Math.min(intersectionDistance, (minY - centerY) / directionY)
    }
    if (!Number.isFinite(intersectionDistance) || intersectionDistance < 0) {
      intersectionDistance = 0
    }

    const edge: SignboardGuidanceEdge = Math.abs(directionX) > Math.abs(directionY)
      ? (directionX < 0 ? 'left' : 'right')
      : (directionY < 0 ? 'top' : 'bottom')
    const baseX = centerX + directionX * intersectionDistance
    const baseY = centerY + directionY * intersectionDistance
    const tangentStep = edge === 'top' || edge === 'bottom'
      ? Math.max(36, halfWidth)
      : Math.max(34, height + 8)
    const inwardStep = Math.max(34, height + 8)
    const tangentIndexes = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5]

    let resolvedX = baseX
    let resolvedY = baseY
    let resolvedRect = {
      left: baseX - halfWidth,
      top: baseY - halfHeight,
      right: baseX + halfWidth,
      bottom: baseY + halfHeight,
    }
    placementSearch:
    for (let inwardIndex = 0; inwardIndex < 5; inwardIndex += 1) {
      for (const tangentIndex of tangentIndexes) {
        const tangentOffset = tangentIndex * tangentStep
        const inwardOffset = inwardIndex * inwardStep
        let x = baseX
        let y = baseY
        if (edge === 'top' || edge === 'bottom') {
          x += tangentOffset
          y += edge === 'top' ? inwardOffset : -inwardOffset
        } else {
          x += edge === 'left' ? inwardOffset : -inwardOffset
          y += tangentOffset
        }
        x = Math.min(maxX, Math.max(minX, x))
        y = Math.min(maxY, Math.max(minY, y))
        const rect = {
          left: x - halfWidth,
          top: y - halfHeight,
          right: x + halfWidth,
          bottom: y + halfHeight,
        }
        const overlaps = placedRects.some((placed) => guidanceRectsOverlap(rect, placed))
        if (!overlaps) {
          resolvedX = x
          resolvedY = y
          resolvedRect = rect
          break placementSearch
        }
      }
    }

    placedRects.push(resolvedRect)
    entries.push({
      nodeId: candidate.nodeId,
      label: candidate.label,
      distanceMeters: candidate.distanceMeters,
      distanceLabel: formatSignboardDistance(candidate.distanceMeters),
      xPercent: resolvedX / viewportWidth * 100,
      yPercent: resolvedY / viewportHeight * 100,
      arrowAngleDeg: Math.atan2(directionX, -directionY) * 180 / Math.PI,
      edge,
      scale: presentation.scale,
      opacity: presentation.opacity,
      estimatedWidthPx: width,
      estimatedHeightPx: height,
    })
    if (entries.length >= maxEntries) {
      break
    }
  }

  return entries
}
