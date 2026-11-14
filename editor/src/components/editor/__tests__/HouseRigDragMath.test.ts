import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { projectRayOntoAxisParameter } from '../HouseRigDragMath'

const VIEWPORT_WIDTH = 1377
const VIEWPORT_HEIGHT = 927

function createDragCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(
    60,
    VIEWPORT_WIDTH / VIEWPORT_HEIGHT,
    0.1,
    10_000,
  )
  camera.position.set(
    17.096118777433762,
    13.883359995468002,
    7.210497611605684,
  )
  camera.lookAt(
    12.46835808999043,
    6.6012893679034415,
    -4.73153760886964,
  )
  camera.updateMatrixWorld()
  return camera
}

function createPointerRay(
  camera: THREE.PerspectiveCamera,
  clientX: number,
  clientY: number,
): THREE.Ray {
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(
    new THREE.Vector2(
      (clientX / VIEWPORT_WIDTH) * 2 - 1,
      -(clientY / VIEWPORT_HEIGHT) * 2 + 1,
    ),
    camera,
  )
  return raycaster.ray
}

describe('House Rig axis drag projection', () => {
  it('maps symmetric pointer movement to symmetric finite width changes', () => {
    const camera = createDragCamera()
    const axisPoint = new THREE.Vector3(
      11.35096294932106,
      4.853647809462309,
      -6.923455452734158,
    )
    const axisDirection = new THREE.Vector3(1, 0, 0)
    const handleX = 677.1819626190372
    const handleY = 477.51667522170476
    const parameterAt = (offsetX: number) => projectRayOntoAxisParameter(
      createPointerRay(camera, handleX + offsetX, handleY),
      axisPoint,
      axisDirection,
    )
    const center = parameterAt(0)!
    const leftOnePixel = parameterAt(-1)! - center
    const rightOnePixel = parameterAt(1)! - center
    const leftTenPixels = parameterAt(-10)! - center
    const rightTenPixels = parameterAt(10)! - center

    expect(Number.isFinite(leftOnePixel)).toBe(true)
    expect(Number.isFinite(rightOnePixel)).toBe(true)
    expect(Math.abs(leftOnePixel + rightOnePixel)).toBeLessThan(5e-5)
    expect(Math.abs(leftTenPixels + rightTenPixels)).toBeLessThan(3e-3)
    expect(Math.abs(leftOnePixel)).toBeLessThan(0.03)
    expect(Math.abs(leftTenPixels)).toBeLessThan(0.25)
  })

  it('rejects pointer rays that are too parallel to the drag axis', () => {
    const camera = new THREE.PerspectiveCamera(
      60,
      VIEWPORT_WIDTH / VIEWPORT_HEIGHT,
      0.1,
      10_000,
    )
    camera.position.set(10, 0, 0)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()

    expect(projectRayOntoAxisParameter(
      createPointerRay(camera, VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
    )).toBeNull()
  })
})
