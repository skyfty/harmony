import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  computePurposeOverlayPlacement,
  resolvePurposeOverlayAnchorWorldPosition,
  resolvePurposeOverlayPlacements,
} from '../signboardOverlay.ts'

function createBoxMesh(width: number, height: number, depth: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth))
}

test('purpose overlay anchor stays near the top on short nodes', () => {
  const object = createBoxMesh(1, 1, 1)
  object.position.set(0, 0, 0)
  object.updateMatrixWorld(true)

  const anchor = resolvePurposeOverlayAnchorWorldPosition(object)

  assert.ok(anchor.y > 0.5)
  assert.ok(anchor.y < 1.0)
})

test('purpose overlay anchor moves toward the middle on tall nodes', () => {
  const object = createBoxMesh(1, 10, 1)
  object.position.set(0, 0, 0)
  object.updateMatrixWorld(true)

  const anchor = resolvePurposeOverlayAnchorWorldPosition(object)

  assert.ok(anchor.y > 0.5)
  assert.ok(anchor.y < 2.5)
})

test('purpose overlay placement clamps to the visible viewport', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)

  const placement = computePurposeOverlayPlacement({
    anchorWorld: new THREE.Vector3(100, 100, 0),
    referenceWorld: camera.position,
    camera,
    viewportWidth: 320,
    viewportHeight: 240,
    estimatedWidthPx: 120,
    estimatedHeightPx: 40,
  })

  assert.ok(placement)
  assert.ok(placement!.xPercent >= 0)
  assert.ok(placement!.xPercent <= 100)
  assert.ok(placement!.yPercent >= 0)
  assert.ok(placement!.yPercent <= 100)
})

test('purpose overlay collision resolution separates overlapping nodes', () => {
  const resolved = resolvePurposeOverlayPlacements({
    placements: [
      {
        id: 'node-a',
        placement: {
          xPercent: 50,
          yPercent: 50,
          scale: 1,
          opacity: 1,
          distanceMeters: 0,
          distanceLabel: '0 m',
        },
        estimatedWidthPx: 120,
        estimatedHeightPx: 40,
      },
      {
        id: 'node-b',
        placement: {
          xPercent: 50,
          yPercent: 50,
          scale: 1,
          opacity: 1,
          distanceMeters: 0,
          distanceLabel: '0 m',
        },
        estimatedWidthPx: 120,
        estimatedHeightPx: 40,
      },
    ],
    viewportWidth: 320,
    viewportHeight: 240,
    screenMarginPx: 12,
  })

  assert.equal(resolved.length, 2)
  assert.notDeepEqual(
    [resolved[0].placement.xPercent, resolved[0].placement.yPercent],
    [resolved[1].placement.xPercent, resolved[1].placement.yPercent],
  )
})
