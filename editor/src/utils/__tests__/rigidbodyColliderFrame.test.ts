import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { RigidbodyPhysicsShape } from '@schema/components'
import {
  buildBoxShapeFromObject,
  composeColliderFrameMatrix,
  fitColliderShapeInFrame,
  type ColliderFrameTransform,
  type ColliderScaleFactors,
} from '@/utils/rigidbodyCollider'
import {
  buildColliderMetadataPayload,
  buildDefaultColliderShape,
  convertColliderMetadataShape,
} from '@/utils/rigidbodyColliderEdit'

const COLLIDER_EPSILON = 1e-5

function expectVectorClose(
  actual: THREE.Vector3 | number[],
  expected: number[],
  digits = 5,
): void {
  const values = actual instanceof THREE.Vector3 ? actual.toArray() : actual
  expect(values.length).toBe(expected.length)
  values.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index] ?? 0, digits)
  })
}

type SamplingObjectParams = {
  /** Local size of the asset's mesh, standing in for the geometry inside an imported GLB. */
  size: [number, number, number]
  /** Transform of the asset node inside the file (imported GLBs usually carry their own rotation). */
  assetRotation?: [number, number, number]
  assetPosition?: [number, number, number]
  assetScale?: [number, number, number]
  /** Scene node transform, applied on the sampling root exactly like `buildRigidbodySamplingObject`. */
  nodeScale?: [number, number, number]
  nodePosition?: [number, number, number]
  nodeRotation?: [number, number, number]
}

/**
 * Mirrors `buildRigidbodySamplingObject`: the root carries the node's world transform and the
 * imported asset node stays inside it with its own transform.
 */
function createSamplingObject(params: SamplingObjectParams): THREE.Object3D {
  const geometry = new THREE.BoxGeometry(params.size[0], params.size[1], params.size[2])
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
  const assetNode = new THREE.Group()
  assetNode.add(mesh)
  if (params.assetRotation) {
    assetNode.rotation.set(params.assetRotation[0], params.assetRotation[1], params.assetRotation[2])
  }
  if (params.assetPosition) {
    assetNode.position.set(params.assetPosition[0], params.assetPosition[1], params.assetPosition[2])
  }
  if (params.assetScale) {
    assetNode.scale.set(params.assetScale[0], params.assetScale[1], params.assetScale[2])
  }
  const root = new THREE.Group()
  root.add(assetNode)
  if (params.nodePosition) {
    root.position.set(params.nodePosition[0], params.nodePosition[1], params.nodePosition[2])
  }
  if (params.nodeRotation) {
    root.rotation.set(params.nodeRotation[0], params.nodeRotation[1], params.nodeRotation[2])
  }
  if (params.nodeScale) {
    root.scale.set(params.nodeScale[0], params.nodeScale[1], params.nodeScale[2])
  }
  root.updateMatrixWorld(true)
  return root
}

/** World transform of an object, matching `SceneNodeWorldTransform` produced by the scene graph. */
function worldTransformOf(object: THREE.Object3D): ColliderFrameTransform {
  object.updateMatrixWorld(true)
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  object.matrixWorld.decompose(position, quaternion, scale)
  return { position, quaternion, scale }
}

/** Model vertices expressed in the collider frame (host frame with the host world scale applied). */
function collectPointsInColliderFrame(
  object: THREE.Object3D,
  frameMatrix: THREE.Matrix4,
): THREE.Vector3[] {
  object.updateMatrixWorld(true)
  const inverseRoot = new THREE.Matrix4().copy(object.matrixWorld).invert()
  const matrix = new THREE.Matrix4()
  const point = new THREE.Vector3()
  const points: THREE.Vector3[] = []
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined
    const position = geometry?.getAttribute('position')
    if (!geometry || !position) {
      return
    }
    matrix.copy(inverseRoot).multiply(mesh.matrixWorld).premultiply(frameMatrix)
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(matrix)
      points.push(point.clone())
    }
  })
  return points
}

type RuntimeCollider = {
  halfSize: THREE.Vector3
  center: THREE.Vector3
  rotation: THREE.Quaternion
}

/**
 * Collider as the runtime builds it from persisted metadata: half extents and offset are
 * multiplied by the node world scale, the shape rotation stays relative to the body.
 */
function resolveRuntimeCollider(
  shape: RigidbodyPhysicsShape,
  storageScale: ColliderScaleFactors,
): RuntimeCollider {
  if (shape.kind !== 'box') {
    throw new Error(`Expected a box shape, received ${shape.kind}`)
  }
  const offset = shape.offset ?? [0, 0, 0]
  const rotation = shape.rotation ?? [0, 0, 0]
  return {
    halfSize: new THREE.Vector3(
      shape.halfExtents[0] * storageScale.x,
      shape.halfExtents[1] * storageScale.y,
      shape.halfExtents[2] * storageScale.z,
    ),
    center: new THREE.Vector3(
      offset[0] * storageScale.x,
      offset[1] * storageScale.y,
      offset[2] * storageScale.z,
    ),
    rotation: new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotation[0], rotation[1], rotation[2], 'XYZ'),
    ),
  }
}

/** Largest distance (in meters) any model vertex sticks out of the runtime collider. */
function maxProtrusion(points: THREE.Vector3[], collider: RuntimeCollider): number {
  const inverseRotation = collider.rotation.clone().invert()
  const local = new THREE.Vector3()
  let worst = Number.NEGATIVE_INFINITY
  for (const point of points) {
    local.copy(point).sub(collider.center).applyQuaternion(inverseRotation)
    worst = Math.max(
      worst,
      Math.abs(local.x) - collider.halfSize.x,
      Math.abs(local.y) - collider.halfSize.y,
      Math.abs(local.z) - collider.halfSize.z,
    )
  }
  return worst
}

type FitCase = {
  model: THREE.Object3D
  frameMatrix: THREE.Matrix4
  storageScale: ColliderScaleFactors
}

function createFitCase(params: {
  model: SamplingObjectParams
  host?: THREE.Object3D
  source?: THREE.Object3D
}): FitCase {
  const model = createSamplingObject(params.model)
  const hostObject = params.host ?? null
  const sourceObject = params.source ?? null
  const { frameMatrix, storageScale } = composeColliderFrameMatrix({
    hostTransform: hostObject ? worldTransformOf(hostObject) : worldTransformOf(model),
    sourceTransform: sourceObject
      ? worldTransformOf(sourceObject)
      : worldTransformOf(model),
  })
  return { model, frameMatrix, storageScale }
}

/** Reads a preview fit back as a persisted shape, exactly like the Collider Editor save path. */
function persistPreviewShape(
  kind: 'box' | 'sphere' | 'capsule',
  fit: { dimensions: THREE.Vector3; offset: THREE.Vector3; rotation: THREE.Euler },
  storageScale: ColliderScaleFactors,
): RigidbodyPhysicsShape | null {
  const colliderGroup = new THREE.Object3D()
  colliderGroup.position.copy(fit.offset)
  colliderGroup.rotation.copy(fit.rotation)
  colliderGroup.scale.set(
    fit.dimensions.x,
    kind === 'capsule' ? fit.dimensions.y * 0.5 : fit.dimensions.y,
    fit.dimensions.z,
  )
  const payload = buildColliderMetadataPayload({ kind, colliderGroup, scale: new THREE.Vector3(storageScale.x, storageScale.y, storageScale.z) })
  return payload?.shape ?? null
}

describe('collider auto-fit frame', () => {
  it('keeps the legacy result for an axis aligned asset with a non-uniform node scale', () => {
    const { model, frameMatrix, storageScale } = createFitCase({
      model: { size: [2, 1, 1], nodeScale: [2, 1, 1] },
    })
    const shape = buildDefaultColliderShape({ kind: 'box', samplingObject: model, frameMatrix })
    expect(shape).not.toBeNull()
    expectVectorClose(shape!.dimensions, [4, 1, 1])
    expect(shape!.offset.length()).toBeCloseTo(0, 6)
    expect(shape!.rotation.x).toBeCloseTo(0, 6)
    expect(shape!.rotation.y).toBeCloseTo(0, 6)
    expect(shape!.rotation.z).toBeCloseTo(0, 6)

    const stored = persistPreviewShape('box', shape!, storageScale)
    expect(stored?.kind).toBe('box')
    const runtime = resolveRuntimeCollider(stored!, storageScale)
    expectVectorClose(runtime.halfSize, [2, 0.5, 0.5])
    expect(
      maxProtrusion(collectPointsInColliderFrame(model, frameMatrix), runtime),
    ).toBeLessThan(COLLIDER_EPSILON)
  })

  it('keeps the legacy result for a rotated asset with a uniform node scale', () => {
    const { model, frameMatrix, storageScale } = createFitCase({
      model: { size: [2, 1, 1], assetRotation: [0, Math.PI / 4, 0], nodeScale: [2, 2, 2] },
    })
    const shape = buildDefaultColliderShape({ kind: 'box', samplingObject: model, frameMatrix })
    expect(shape).not.toBeNull()
    expectVectorClose(
      shape!.dimensions.toArray().map((value) => Math.abs(value)),
      [4, 2, 2],
    )
    const stored = persistPreviewShape('box', shape!, storageScale)
    const runtime = resolveRuntimeCollider(stored!, storageScale)
    expect(
      maxProtrusion(collectPointsInColliderFrame(model, frameMatrix), runtime),
    ).toBeLessThan(COLLIDER_EPSILON)
  })

  it('keeps the legacy result when only the node is rotated and non-uniformly scaled', () => {
    const { model, frameMatrix, storageScale } = createFitCase({
      model: { size: [2, 1, 1], nodeRotation: [0, 0, Math.PI / 6], nodeScale: [1, 3, 1] },
    })
    const shape = buildDefaultColliderShape({ kind: 'box', samplingObject: model, frameMatrix })
    expect(shape).not.toBeNull()
    // The node rotation lives on the overlay frame, so the fitted box stays axis aligned in it and
    // only its dimensions change (ordered along the fit axes, largest variance first).
    expectVectorClose(
      shape!.dimensions.toArray().sort((left, right) => right - left),
      [3, 2, 1],
    )
    const stored = persistPreviewShape('box', shape!, storageScale)
    const runtime = resolveRuntimeCollider(stored!, storageScale)
    expect(
      maxProtrusion(collectPointsInColliderFrame(model, frameMatrix), runtime),
    ).toBeLessThan(COLLIDER_EPSILON)
  })

  it('hugs a rotated asset after a single-axis node scale (30deg Z, scale 1/3/1)', () => {
    const { model, frameMatrix, storageScale } = createFitCase({
      model: { size: [2, 1, 1], assetRotation: [0, 0, Math.PI / 6], nodeScale: [1, 3, 1] },
    })
    const shape = buildDefaultColliderShape({ kind: 'box', samplingObject: model, frameMatrix })
    expect(shape).not.toBeNull()
    const stored = persistPreviewShape('box', shape!, storageScale)
    expect(stored?.kind).toBe('box')
    const runtime = resolveRuntimeCollider(stored!, storageScale)
    const points = collectPointsInColliderFrame(model, frameMatrix)
    expect(maxProtrusion(points, runtime)).toBeLessThan(COLLIDER_EPSILON)
    // The previous implementation produced a 2 x 3 x 1 box that could not cover the model.
    const legacyDims = [2, 3, 1]
    const dims = runtime.halfSize.clone().multiplyScalar(2).toArray()
    expect(
      dims.every((value, index) => Math.abs(value - (legacyDims[index] ?? 0)) < 1e-3),
    ).toBe(false)
  })

  it('hugs a rotated asset after a single-axis node scale (45deg Y, scale 2/1/1)', () => {
    const { model, frameMatrix, storageScale } = createFitCase({
      model: { size: [2, 1, 1], assetRotation: [0, Math.PI / 4, 0], nodeScale: [2, 1, 1] },
    })
    const shape = buildDefaultColliderShape({ kind: 'box', samplingObject: model, frameMatrix })
    const stored = persistPreviewShape('box', shape!, storageScale)
    const runtime = resolveRuntimeCollider(stored!, storageScale)
    expect(
      maxProtrusion(collectPointsInColliderFrame(model, frameMatrix), runtime),
    ).toBeLessThan(COLLIDER_EPSILON)
  })

  it('round-trips preview -> persisted -> preview for box, sphere and capsule', () => {
    const kinds = ['box', 'sphere', 'capsule'] as const
    for (const kind of kinds) {
      const { model, frameMatrix, storageScale } = createFitCase({
        model: { size: [2, 1, 1], assetRotation: [0, 0, Math.PI / 6], nodeScale: [1, 3, 1] },
      })
      const preview = buildDefaultColliderShape({ kind, samplingObject: model, frameMatrix })
      expect(preview).not.toBeNull()
      const stored = persistPreviewShape(kind, preview!, storageScale)
      expect(stored).not.toBeNull()
      const restored = convertColliderMetadataShape(stored!, kind, new THREE.Vector3(storageScale.x, storageScale.y, storageScale.z))
      expect(restored).not.toBeNull()
      expectVectorClose(restored!.dimensions, preview!.dimensions.toArray(), 4)
      expectVectorClose(restored!.offset, preview!.offset.toArray(), 4)
      expect(restored!.rotation.x).toBeCloseTo(preview!.rotation.x, 4)
      expect(restored!.rotation.y).toBeCloseTo(preview!.rotation.y, 4)
      expect(restored!.rotation.z).toBeCloseTo(preview!.rotation.z, 4)
    }
  })

  it('generates the same shape from the export pipeline as the Collider Editor persists', () => {
    const { model, frameMatrix, storageScale } = createFitCase({
      model: { size: [2, 1, 1], assetRotation: [0.2, 0.4, 0.3], nodeScale: [1.5, 3, 0.5] },
    })
    const preview = buildDefaultColliderShape({ kind: 'box', samplingObject: model, frameMatrix })
    expect(preview).not.toBeNull()
    const editorShape = persistPreviewShape('box', preview!, storageScale)
    const exportShape = buildBoxShapeFromObject(model, { frameMatrix, storageScale })
    expect(exportShape).not.toBeNull()
    expect(exportShape!.kind).toBe('box')
    expect(editorShape!.kind).toBe('box')
    if (exportShape?.kind !== 'box' || editorShape?.kind !== 'box') {
      throw new Error('Expected box shapes')
    }
    expectVectorClose(exportShape.halfExtents, editorShape.halfExtents, 5)
    expectVectorClose(exportShape.offset ?? [0, 0, 0], editorShape.offset ?? [0, 0, 0], 5)
    expectVectorClose(exportShape.rotation ?? [0, 0, 0], editorShape.rotation ?? [0, 0, 0], 5)
  })

  it('maps a targetNodeId source node into the host frame', () => {
    const host = new THREE.Group()
    host.position.set(1, 0, -2)
    host.rotation.set(0, Math.PI / 3, 0)
    host.scale.set(2, 1, 1)
    const source = new THREE.Group()
    source.position.set(0.5, 1.5, 0)
    source.rotation.set(0, 0, Math.PI / 6)
    source.updateMatrixWorld(true)
    const { model, frameMatrix, storageScale } = createFitCase({
      model: { size: [2, 1, 1] },
      host,
      source,
    })
    const shape = buildDefaultColliderShape({ kind: 'box', samplingObject: model, frameMatrix })
    expect(shape).not.toBeNull()
    const stored = persistPreviewShape('box', shape!, storageScale)
    const runtime = resolveRuntimeCollider(stored!, storageScale)
    const points = collectPointsInColliderFrame(model, frameMatrix)
    expect(maxProtrusion(points, runtime)).toBeLessThan(COLLIDER_EPSILON)
    // The shape sits on the child node's location inside the host frame (Y offset untouched).
    expect(runtime.center.y).toBeCloseTo(1.5, 5)
    expect(runtime.center.length()).toBeGreaterThan(1)
  })

  it('derives sphere and capsule sizes from the collider-frame bounds', () => {
    const { model, frameMatrix } = createFitCase({
      model: { size: [2, 1, 1], nodeScale: [1, 3, 1] },
    })
    const sphere = fitColliderShapeInFrame({ kind: 'sphere', object: model, frameMatrix })
    expect(sphere).not.toBeNull()
    expectVectorClose(sphere!.dimensions, [3, 3, 3])

    const capsule = fitColliderShapeInFrame({ kind: 'capsule', object: model, frameMatrix })
    expect(capsule).not.toBeNull()
    expect(capsule!.dimensions.x).toBeCloseTo(2, 5)
    expect(capsule!.dimensions.y).toBeCloseTo(3, 5)
    expect(capsule!.dimensions.z).toBeCloseTo(2, 5)
  })
})
