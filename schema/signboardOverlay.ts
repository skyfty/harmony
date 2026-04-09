import * as THREE from 'three'
import type { Vector3Like } from './index'

export const SIGNBOARD_WORLD_Y_OFFSET = 0.35
export const SIGNBOARD_MAX_DISTANCE = 120
export const SIGNBOARD_FADE_START_DISTANCE = 78
export const SIGNBOARD_FULL_SCALE_DISTANCE = 10
export const SIGNBOARD_MIN_SCALE = 0.56
export const SIGNBOARD_MAX_SCALE = 1.14
export const SIGNBOARD_SCREEN_MARGIN = 0.08

export type SignboardReferenceKind = 'camera' | 'vehicle'

export interface SignboardOverlayPlacement {
  xPercent: number
  yPercent: number
  scale: number
  opacity: number
  distanceMeters: number
  distanceLabel: string
}

const placementWorld = new THREE.Vector3()
const placementReference = new THREE.Vector3()
const projected = new THREE.Vector3()
const anchorBox = new THREE.Box3()
const anchorCenter = new THREE.Vector3()

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
  minScale?: number
  maxScale?: number
  screenMargin?: number
}): SignboardOverlayPlacement | null {
  const maxDistance = params.maxDistance ?? SIGNBOARD_MAX_DISTANCE
  const fadeStartDistance = Math.min(params.fadeStartDistance ?? SIGNBOARD_FADE_START_DISTANCE, maxDistance)
  const fullScaleDistance = Math.min(params.fullScaleDistance ?? SIGNBOARD_FULL_SCALE_DISTANCE, fadeStartDistance)
  const minScale = params.minScale ?? SIGNBOARD_MIN_SCALE
  const maxScale = params.maxScale ?? SIGNBOARD_MAX_SCALE
  const screenMargin = params.screenMargin ?? SIGNBOARD_SCREEN_MARGIN

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
  const yNorm = projected.y * -0.5 + 0.5
  if (
    xNorm < -screenMargin
    || xNorm > 1 + screenMargin
    || yNorm < -screenMargin
    || yNorm > 1 + screenMargin
  ) {
    return null
  }

  const scaleRange = Math.max(fadeStartDistance - fullScaleDistance, 1e-6)
  const scaleAmount = clamp01((distanceMeters - fullScaleDistance) / scaleRange)
  const fadeRange = Math.max(maxDistance - fadeStartDistance, 1e-6)
  const fadeAmount = clamp01((distanceMeters - fadeStartDistance) / fadeRange)

  return {
    xPercent: xNorm * 100,
    yPercent: yNorm * 100,
    scale: lerp(maxScale, minScale, scaleAmount),
    opacity: lerp(1, 0, fadeAmount),
    distanceMeters,
    distanceLabel: formatSignboardDistance(distanceMeters),
  }
}