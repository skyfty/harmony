import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  SIGNBOARD_CARD_FAR_OPACITY,
  SIGNBOARD_CARD_FAR_SCALE,
  SIGNBOARD_GUIDANCE_MIN_OPACITY,
  SIGNBOARD_GUIDANCE_MIN_SCALE,
  SIGNBOARD_MAX_DISTANCE,
  SIGNBOARD_NEAR_FADE_END_DISTANCE,
  SIGNBOARD_NEAR_HIDE_DISTANCE,
  computeSignboardDistancePresentation,
  computeSignboardGuidanceEntries,
  isSignboardAnchorInView,
  type SignboardGuidanceCandidate,
} from '@schema/signboardOverlay'

const VIEWPORT = {
  width: 1000,
  height: 700,
  safeArea: { top: 72, right: 16, bottom: 88, left: 16 },
}

function createCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, 0.1, 20_000)
  camera.position.set(0, 2, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  return camera
}

function candidate(
  nodeId: string,
  x: number,
  y: number,
  z: number,
  distanceMeters = 200,
  label = nodeId,
): SignboardGuidanceCandidate {
  return {
    nodeId,
    label,
    anchorWorld: new THREE.Vector3(x, y, z),
    distanceMeters,
  }
}

function resolve(candidates: SignboardGuidanceCandidate[]) {
  return computeSignboardGuidanceEntries({
    candidates,
    camera: createCamera(),
    viewportWidth: VIEWPORT.width,
    viewportHeight: VIEWPORT.height,
    safeArea: VIEWPORT.safeArea,
  })
}

describe('Signboard distance presentation', () => {
  it('fades in from the near hide boundary and reaches full size at 14 m', () => {
    expect(computeSignboardDistancePresentation(SIGNBOARD_NEAR_HIDE_DISTANCE - 0.1)).toEqual({
      visible: false,
      opacity: 0,
      scale: SIGNBOARD_CARD_FAR_SCALE,
    })
    expect(computeSignboardDistancePresentation(SIGNBOARD_NEAR_HIDE_DISTANCE)).toEqual({
      visible: true,
      opacity: 0,
      scale: SIGNBOARD_CARD_FAR_SCALE,
    })
    expect(computeSignboardDistancePresentation(SIGNBOARD_NEAR_FADE_END_DISTANCE)).toEqual({
      visible: true,
      opacity: 1,
      scale: 1,
    })
  })

  it('continues the curve through the card boundary to the 2 km guidance minimum', () => {
    expect(computeSignboardDistancePresentation(SIGNBOARD_MAX_DISTANCE)).toEqual({
      visible: true,
      opacity: SIGNBOARD_CARD_FAR_OPACITY,
      scale: SIGNBOARD_CARD_FAR_SCALE,
    })

    const beyondCard = computeSignboardDistancePresentation(SIGNBOARD_MAX_DISTANCE + 1)
    expect(beyondCard.opacity).toBeLessThan(SIGNBOARD_CARD_FAR_OPACITY)
    expect(beyondCard.opacity).toBeGreaterThan(SIGNBOARD_GUIDANCE_MIN_OPACITY)
    expect(beyondCard.scale).toBeLessThan(SIGNBOARD_CARD_FAR_SCALE)
    expect(beyondCard.scale).toBeGreaterThan(SIGNBOARD_GUIDANCE_MIN_SCALE)

    expect(computeSignboardDistancePresentation(2000)).toEqual({
      visible: true,
      opacity: SIGNBOARD_GUIDANCE_MIN_OPACITY,
      scale: SIGNBOARD_GUIDANCE_MIN_SCALE,
    })
    expect(computeSignboardDistancePresentation(5000)).toEqual(computeSignboardDistancePresentation(2000))
  })
})

describe('Signboard guidance overlay', () => {
  it('keeps visible nearby targets in the existing card mode', () => {
    const anchor = new THREE.Vector3(0, 2, -50)
    expect(isSignboardAnchorInView(anchor, createCamera())).toBe(true)
    expect(resolve([candidate('near', 0, 2, -50, 50)])).toEqual([])
  })

  it('handles the card-to-guidance boundary at 120 m', () => {
    expect(resolve([
      candidate('card-boundary', 0, 2, -SIGNBOARD_MAX_DISTANCE, SIGNBOARD_MAX_DISTANCE),
    ])).toEqual([])

    const entries = resolve([
      candidate('guidance-boundary', 0, 2, -SIGNBOARD_MAX_DISTANCE - 0.01, SIGNBOARD_MAX_DISTANCE + 0.01),
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      nodeId: 'guidance-boundary',
      edge: 'top',
    })
    expect(entries[0]?.opacity).toBeLessThan(SIGNBOARD_CARD_FAR_OPACITY)
    expect(entries[0]?.scale).toBeLessThan(SIGNBOARD_CARD_FAR_SCALE)
  })

  it('places front-facing forward and side targets on the expected edges', () => {
    const entries = resolve([
      candidate('forward', 0, 2, -200, 200),
      candidate('left', -100, 2, -10, 100),
      candidate('right', 100, 2, -10, 100),
      candidate('rear', 0, 2, 20, 20),
    ])
    const byId = new Map(entries.map((entry) => [entry.nodeId, entry]))
    const forward = byId.get('forward')
    const left = byId.get('left')
    const right = byId.get('right')
    const rear = byId.get('rear')

    expect(forward).toMatchObject({ nodeId: 'forward', edge: 'top' })
    expect(forward?.arrowAngleDeg).toBeCloseTo(0, 4)
    expect(left).toMatchObject({ nodeId: 'left', edge: 'left' })
    expect(left?.arrowAngleDeg).toBeCloseTo(-84.2894, 3)
    expect(right).toMatchObject({ nodeId: 'right', edge: 'right' })
    expect(right?.arrowAngleDeg).toBeCloseTo(84.2894, 3)
    expect(rear).toBeUndefined()
  })

  it('does not show guidance for targets behind the camera', () => {
    expect(resolve([candidate('behind', 0, 2, 20, 20)])).toEqual([])
  })

  it('does not show an offscreen marker inside the near hide radius', () => {
    expect(resolve([candidate('near-offscreen', 100, 2, -6, 7)])).toEqual([])
  })

  it('limits results to the four nearest targets with deterministic ties', () => {
    const entries = resolve([
      candidate('node-e', 120, 2, -200, 300),
      candidate('node-d', -120, 2, -200, 200),
      candidate('node-c', 0, 2, -50, 180),
      candidate('node-b', 200, 2, -100, 100),
      candidate('node-a', -200, 2, -100, 100),
    ])

    expect(entries.map((entry) => entry.nodeId)).toEqual(['node-a', 'node-b', 'node-c', 'node-d'])
  })

  it('keeps markers inside the configured safe area', () => {
    const entries = resolve([
      candidate('forward', 0, 2, -500, 500),
      candidate('right-rear', 100, 2, -1, 500, 'A very long signboard display name'),
    ])

    for (const entry of entries) {
      expect(entry.xPercent).toBeGreaterThanOrEqual(0)
      expect(entry.xPercent).toBeLessThanOrEqual(100)
      expect(entry.yPercent).toBeGreaterThan(72 / VIEWPORT.height * 100)
      expect(entry.yPercent).toBeLessThan(100 - 88 / VIEWPORT.height * 100)
    }
  })

  it('ignores invalid targets and duplicate node ids', () => {
    const entries = resolve([
      candidate('invalid', Number.NaN, 2, -200, 200),
      candidate('same', 0, 2, -200, 200),
      candidate('same', -100, 2, 10, 10),
    ])

    expect(entries.map((entry) => entry.nodeId)).toEqual(['same'])
  })
})
