import * as THREE from 'three'
import type { SceneNode } from '@schema/core'
import type { RigidbodyPhysicsShape } from '@schema/components'
import { computeOrientedBoxFromObject } from './orientedBox'

export type ColliderScaleFactors = { x: number; y: number; z: number }

/** Primitive collider kinds that are derived from a sampled model object. */
export type ColliderPrimitiveShapeKind = 'box' | 'sphere' | 'capsule' | 'cylinder'

/**
 * A collider shape expressed in the *collider frame*: the host node's position/rotation with unit
 * scale, i.e. the space the viewport overlay draws in and the space where the physics
 * box/sphere/capsule ends up with its final world size.
 *
 * `dimensions` is the full size along the box axes (diameter for sphere/capsule/cylinder).
 */
export type ColliderFrameFitShape = {
  dimensions: THREE.Vector3
  offset: THREE.Vector3
  rotation: THREE.Euler
}

/** Structural view of a world transform; matches `SceneNodeWorldTransform` without importing it. */
export type ColliderFrameTransform = {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: { x: number; y: number; z: number }
}

export type ColliderFrameMatrixOptions = {
  /** Node that owns the Rigidbody component: its frame and world scale define the collider. */
  hostTransform?: ColliderFrameTransform | null
  /** Node the geometry is sampled from (equals the host unless `targetNodeId` points elsewhere). */
  sourceTransform?: ColliderFrameTransform | null
  /** Local node scale, only used when no world transform is available (single-node fallback). */
  fallbackHostScale?: ColliderScaleFactors | null
}

export type ColliderShapeFitOptions = {
  kind: ColliderPrimitiveShapeKind
  object: THREE.Object3D
  frameMatrix?: THREE.Matrix4 | null
}

export type ColliderStoredShapeOptions = {
  kind: ColliderPrimitiveShapeKind
  fit: ColliderFrameFitShape
  storageScale?: ColliderScaleFactors | null
}

export type ColliderShapeFromObjectOptions = {
  frameMatrix?: THREE.Matrix4 | null
  storageScale?: ColliderScaleFactors | null
}

const COLLIDER_SCALE_EPSILON = 1e-4
/** Minimum size used by the auto-generated default shapes. */
const COLLIDER_DEFAULT_MIN_SIZE = 0.25
/** Minimum size persisted into collider metadata. */
const COLLIDER_STORED_MIN_SIZE = 1e-4
export const DEFAULT_COLLIDER_SCALE: ColliderScaleFactors = { x: 1, y: 1, z: 1 }

const colliderBoxMatrixHelper = new THREE.Matrix4()
const colliderBoxInverseHelper = new THREE.Matrix4()
const colliderBoxScratch = new THREE.Box3()
const colliderFrameHostMatrixHelper = new THREE.Matrix4()
const colliderFrameSourceMatrixHelper = new THREE.Matrix4()
const colliderFrameScaleMatrixHelper = new THREE.Matrix4()
const colliderFrameScaleHelper = new THREE.Vector3()
const colliderFitCenterHelper = new THREE.Vector3()
const colliderFitSizeHelper = new THREE.Vector3()

export function normalizeColliderScale(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 1
  const abs = Math.abs(numeric)
  return abs > COLLIDER_SCALE_EPSILON ? abs : 1
}

export function resolveNodeScaleFactors(node: SceneNode | null | undefined): ColliderScaleFactors {
  return {
    x: normalizeColliderScale(node?.scale?.x),
    y: normalizeColliderScale(node?.scale?.y),
    z: normalizeColliderScale(node?.scale?.z),
  }
}

function normalizeColliderScaleFactors(
  scaleFactors: ColliderScaleFactors | null | undefined,
): ColliderScaleFactors {
  return {
    x: normalizeColliderScale(scaleFactors?.x),
    y: normalizeColliderScale(scaleFactors?.y),
    z: normalizeColliderScale(scaleFactors?.z),
  }
}

function composeFrameTransformMatrix(
  transform: ColliderFrameTransform,
  target: THREE.Matrix4,
): THREE.Matrix4 {
  colliderFrameScaleHelper.set(
    normalizeColliderScale(transform.scale?.x),
    normalizeColliderScale(transform.scale?.y),
    normalizeColliderScale(transform.scale?.z),
  )
  return target.compose(transform.position, transform.quaternion, colliderFrameScaleHelper)
}

/**
 * Builds the matrix that maps sampled geometry from the sampling node's *pre-scale* local frame
 * into the collider frame, plus the host world scale used when persisting the shape.
 *
 * The viewport overlay and the physics shape live in the host frame with the host world scale
 * already baked into the collider size, so the sampled point cloud has to be mapped the same way:
 *
 *   `p_collider = storageScale ⊗ (M_host^-1 · M_source · p)`
 *
 * Mapping into the host frame up front (instead of multiplying fitted dimensions per node local
 * axis afterwards) is what keeps a rotated, non-uniformly scaled GLB node hugging its collider.
 */
export function composeColliderFrameMatrix(
  options: ColliderFrameMatrixOptions = {},
): { frameMatrix: THREE.Matrix4; storageScale: ColliderScaleFactors } {
  const host = options.hostTransform ?? null
  const source = options.sourceTransform ?? host
  const storageScale = host
    ? normalizeColliderScaleFactors(host.scale)
    : normalizeColliderScaleFactors(options.fallbackHostScale)

  const frameMatrix = new THREE.Matrix4()
  if (host && source) {
    composeFrameTransformMatrix(host, colliderFrameHostMatrixHelper)
    composeFrameTransformMatrix(source, colliderFrameSourceMatrixHelper)
    frameMatrix
      .copy(colliderFrameHostMatrixHelper)
      .invert()
      .multiply(colliderFrameSourceMatrixHelper)
  }
  colliderFrameScaleMatrixHelper.makeScale(storageScale.x, storageScale.y, storageScale.z)
  frameMatrix.premultiply(colliderFrameScaleMatrixHelper)
  return { frameMatrix, storageScale }
}

/**
 * Bounds of the sampled geometry after it has been mapped into the collider frame.
 * The optional `frameMatrix` applies the node rotation/scale (and the `targetNodeId` source
 * node's own transform) so the bounds describe the model as it is actually rendered.
 */
export function computeColliderLocalBoundingBox(
  object: THREE.Object3D,
  options: { frameMatrix?: THREE.Matrix4 | null } = {},
): THREE.Box3 | null {
  object.updateWorldMatrix(true, true)
  const result = new THREE.Box3()
  colliderBoxInverseHelper.copy(object.matrixWorld).invert()
  const frameMatrix = options.frameMatrix ?? null
  let hasBox = false
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined
    if (!geometry || typeof geometry.computeBoundingBox !== 'function') {
      return
    }
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox()
    }
    if (!geometry.boundingBox) {
      return
    }
    colliderBoxScratch.copy(geometry.boundingBox)
    colliderBoxMatrixHelper.copy(child.matrixWorld).premultiply(colliderBoxInverseHelper)
    if (frameMatrix) {
      colliderBoxMatrixHelper.premultiply(frameMatrix)
    }
    colliderBoxScratch.applyMatrix4(colliderBoxMatrixHelper)
    if (!hasBox) {
      result.copy(colliderBoxScratch)
      hasBox = true
    } else {
      result.union(colliderBoxScratch)
    }
  })
  return hasBox ? result : null
}

/**
 * Derives the default collider shape in the collider frame.
 *
 * Box uses a tight oriented fit of the *already scaled* point cloud, so a non-uniform node scale
 * can no longer stretch the box along the wrong axes. Sphere/Capsule/Cylinder keep their previous
 * heuristics, but read them off the collider-frame bounds.
 */
export function fitColliderShapeInFrame(
  options: ColliderShapeFitOptions,
): ColliderFrameFitShape | null {
  const { kind, object } = options
  const frameMatrix = options.frameMatrix ?? null

  if (kind === 'box') {
    const oriented = computeOrientedBoxFromObject(object, { frameMatrix })
    if (oriented) {
      return {
        dimensions: oriented.dimensions.clone(),
        offset: oriented.center.clone(),
        rotation: oriented.rotation.clone(),
      }
    }
    const fallbackBounds = computeColliderLocalBoundingBox(object, { frameMatrix })
    if (!fallbackBounds || fallbackBounds.isEmpty()) {
      return null
    }
    const fallbackSize = fallbackBounds.getSize(colliderFitSizeHelper)
    const fallbackCenter = fallbackBounds.getCenter(colliderFitCenterHelper)
    return {
      dimensions: new THREE.Vector3(
        Math.max(COLLIDER_DEFAULT_MIN_SIZE, fallbackSize.x || COLLIDER_DEFAULT_MIN_SIZE),
        Math.max(COLLIDER_DEFAULT_MIN_SIZE, fallbackSize.y || COLLIDER_DEFAULT_MIN_SIZE),
        Math.max(COLLIDER_DEFAULT_MIN_SIZE, fallbackSize.z || COLLIDER_DEFAULT_MIN_SIZE),
      ),
      offset: fallbackCenter.clone(),
      rotation: new THREE.Euler(),
    }
  }

  const bounds = computeColliderLocalBoundingBox(object, { frameMatrix })
  if (!bounds || bounds.isEmpty()) {
    return null
  }
  const size = bounds.getSize(colliderFitSizeHelper)
  const center = bounds.getCenter(colliderFitCenterHelper)

  if (kind === 'sphere') {
    const diameter = Math.max(COLLIDER_DEFAULT_MIN_SIZE, Math.max(size.x, size.y, size.z))
    return {
      dimensions: new THREE.Vector3(diameter, diameter, diameter),
      offset: center.clone(),
      rotation: new THREE.Euler(),
    }
  }

  const diameter = Math.max(COLLIDER_DEFAULT_MIN_SIZE, Math.max(size.x, size.z))
  if (kind === 'capsule') {
    return {
      dimensions: new THREE.Vector3(
        diameter,
        Math.max(diameter, size.y || diameter),
        diameter,
      ),
      offset: center.clone(),
      rotation: new THREE.Euler(),
    }
  }

  return {
    dimensions: new THREE.Vector3(
      diameter,
      Math.max(COLLIDER_DEFAULT_MIN_SIZE, size.y || COLLIDER_DEFAULT_MIN_SIZE),
      diameter,
    ),
    offset: center.clone(),
    rotation: new THREE.Euler(),
  }
}

/**
 * Converts a collider-frame fit into the persisted shape convention: half extents and offsets are
 * stored in the node's pre-scale local frame and `applyScale` makes the runtime multiply them back
 * by the same world scale, so the runtime collider equals the editor overlay exactly.
 */
export function buildStoredShapeFromFrameFit(
  options: ColliderStoredShapeOptions,
): RigidbodyPhysicsShape | null {
  const { kind, fit } = options
  const storageScale = normalizeColliderScaleFactors(options.storageScale)
  const offset: [number, number, number] = [
    fit.offset.x / storageScale.x,
    fit.offset.y / storageScale.y,
    fit.offset.z / storageScale.z,
  ]
  const rotation: [number, number, number] = [
    fit.rotation.x,
    fit.rotation.y,
    fit.rotation.z,
  ]

  if (kind === 'box') {
    return {
      kind: 'box',
      halfExtents: [
        Math.max(COLLIDER_STORED_MIN_SIZE, (fit.dimensions.x * 0.5) / storageScale.x),
        Math.max(COLLIDER_STORED_MIN_SIZE, (fit.dimensions.y * 0.5) / storageScale.y),
        Math.max(COLLIDER_STORED_MIN_SIZE, (fit.dimensions.z * 0.5) / storageScale.z),
      ],
      offset,
      rotation,
      applyScale: true,
    }
  }

  const dominantScale = Math.max(storageScale.x, storageScale.y, storageScale.z)
  const lateralScale = Math.max(storageScale.x, storageScale.z)

  if (kind === 'sphere') {
    return {
      kind: 'sphere',
      radius: Math.max(COLLIDER_STORED_MIN_SIZE, (fit.dimensions.x * 0.5) / dominantScale),
      offset,
      rotation,
      applyScale: true,
    }
  }

  if (kind === 'capsule') {
    const radius = Math.max(COLLIDER_STORED_MIN_SIZE, (fit.dimensions.x * 0.5) / lateralScale)
    return {
      kind: 'capsule',
      radius,
      // The runtime clamps the height against the *world* radius (`max(radius * 2, height * scale.y)`),
      // so the stored height must stay a plain pre-scale value here: clamping it pre-scale would
      // inflate it by the node scale again and break the preview -> saved -> preview round trip.
      height: Math.max(COLLIDER_STORED_MIN_SIZE, fit.dimensions.y / storageScale.y),
      offset,
      rotation,
      applyScale: true,
    }
  }

  const cylinderRadius = Math.max(
    COLLIDER_STORED_MIN_SIZE,
    (fit.dimensions.x * 0.5) / lateralScale,
  )
  return {
    kind: 'cylinder',
    radiusTop: cylinderRadius,
    radiusBottom: cylinderRadius,
    height: Math.max(COLLIDER_STORED_MIN_SIZE, fit.dimensions.y / storageScale.y),
    segments: 16,
    offset,
    rotation,
    applyScale: true,
  }
}

function buildStoredShapeFromObject(
  kind: ColliderPrimitiveShapeKind,
  object: THREE.Object3D,
  options: ColliderShapeFromObjectOptions = {},
): RigidbodyPhysicsShape | null {
  const fit = fitColliderShapeInFrame({
    kind,
    object,
    frameMatrix: options.frameMatrix ?? null,
  })
  if (!fit) {
    return null
  }
  return buildStoredShapeFromFrameFit({
    kind,
    fit,
    storageScale: options.storageScale ?? DEFAULT_COLLIDER_SCALE,
  })
}

export function buildBoxShapeFromObject(
  object: THREE.Object3D,
  options: ColliderShapeFromObjectOptions = {},
): RigidbodyPhysicsShape | null {
  return buildStoredShapeFromObject('box', object, options)
}

export function buildSphereShapeFromObject(
  object: THREE.Object3D,
  options: ColliderShapeFromObjectOptions = {},
): RigidbodyPhysicsShape | null {
  return buildStoredShapeFromObject('sphere', object, options)
}

export function buildCylinderShapeFromObject(
  object: THREE.Object3D,
  options: ColliderShapeFromObjectOptions = {},
): RigidbodyPhysicsShape | null {
  return buildStoredShapeFromObject('cylinder', object, options)
}

export function buildCapsuleShapeFromObject(
  object: THREE.Object3D,
  options: ColliderShapeFromObjectOptions = {},
): RigidbodyPhysicsShape | null {
  return buildStoredShapeFromObject('capsule', object, options)
}
