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
export const DEFAULT_SIGNBOARD_REFERENCE_SMOOTH_SPEED = 12
export const DEFAULT_SIGNBOARD_PLACEMENT_SMOOTH_SPEED = 18

export type SignboardReferenceKind = 'camera' | 'vehicle'

export interface SignboardOverlayPlacement {
  xPercent: number
  yPercent: number
  scale: number
  opacity: number
  distanceMeters: number
  distanceLabel: string
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

const placementWorld = new THREE.Vector3()
const placementReference = new THREE.Vector3()
const projected = new THREE.Vector3()
const anchorBox = new THREE.Box3()
const anchorCenter = new THREE.Vector3()
const smoothedReferenceTarget = new THREE.Vector3()

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
  if (distanceMeters >= 100) {
    return `${Math.round(distanceMeters)} m`
  }
  return `${distanceMeters.toFixed(distanceMeters >= 10 ? 1 : 0)} m`
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