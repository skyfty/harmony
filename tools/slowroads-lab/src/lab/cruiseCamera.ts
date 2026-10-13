import * as THREE from 'three'
import { clamp } from '../core/noise'
import type { RoadProfile } from '../core/roadProfile'

/**
 * "Drive along the road" camera: advances along the traced road polyline and
 * looks ahead, approximating slowroads' driving view without any vehicle
 * physics.
 */
export interface CruiseController {
  readonly active: boolean
  speed: number
  distance: number
  setActive(active: boolean): void
  reset(): void
  update(dt: number, camera: THREE.PerspectiveCamera): void
}

export function createCruiseController(getProfile: () => RoadProfile | null): CruiseController {
  let active = false
  let distance = 0
  const driver = {
    active,
    speed: 14,
    distance,
    setActive(value: boolean): void {
      active = value
      driver.active = value
    },
    reset(): void {
      distance = 0
      driver.distance = 0
    },
    update(dt: number, camera: THREE.PerspectiveCamera): void {
      const profile = getProfile()
      if (!active || !profile || profile.length <= 1) {
        return
      }
      distance = (distance + driver.speed * dt) % profile.length
      driver.distance = distance
      const position = profile.sampleAt(distance)
      const ahead = profile.sampleAt(Math.min(profile.length, distance + 40))
      camera.position.set(position.x, position.y + 2.2, position.z)
      camera.lookAt(ahead.x, ahead.y + 1.6, ahead.z)
    },
  }
  return driver
}

export interface FreeFlyControls {
  enabled: boolean
  update(dt: number): void
  /** Re-derives yaw/pitch from the camera's current orientation. */
  syncFromCamera(): void
  dispose(): void
}

/**
 * Minimal free-fly camera: drag to look, WASD to move, Q/E for altitude,
 * Shift to sprint.
 */
export function createFreeFlyControls(
  camera: THREE.PerspectiveCamera,
  element: HTMLElement,
): FreeFlyControls {
  const euler = new THREE.Euler(0, 0, 0, 'YXZ')
  let yaw = 0
  let pitch = 0
  let dragging = false
  let lastX = 0
  let lastY = 0
  const keys = new Set<string>()
  const forward = new THREE.Vector3()
  const right = new THREE.Vector3()
  const move = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)

  const applyRotation = (): void => {
    euler.set(pitch, yaw, 0)
    camera.quaternion.setFromEuler(euler)
  }

  const syncFromCamera = (): void => {
    euler.setFromQuaternion(camera.quaternion, 'YXZ')
    yaw = euler.y
    pitch = euler.x
  }
  syncFromCamera()

  const handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return
    }
    dragging = true
    lastX = event.clientX
    lastY = event.clientY
    element.setPointerCapture?.(event.pointerId)
  }
  const handlePointerMove = (event: PointerEvent): void => {
    if (!dragging || !controls.enabled) {
      return
    }
    yaw -= (event.clientX - lastX) * 0.0028
    pitch = clamp(pitch - (event.clientY - lastY) * 0.0024, -1.45, 1.45)
    lastX = event.clientX
    lastY = event.clientY
    applyRotation()
  }
  const handlePointerUp = (event: PointerEvent): void => {
    dragging = false
    element.releasePointerCapture?.(event.pointerId)
  }
  const handleKeyDown = (event: KeyboardEvent): void => {
    keys.add(event.code)
  }
  const handleKeyUp = (event: KeyboardEvent): void => {
    keys.delete(event.code)
  }
  const handleBlur = (): void => {
    keys.clear()
    dragging = false
  }

  element.addEventListener('pointerdown', handlePointerDown)
  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  window.addEventListener('blur', handleBlur)

  const controls: FreeFlyControls = {
    enabled: true,
    update(dt: number): void {
      if (!controls.enabled) {
        return
      }
      camera.getWorldDirection(forward)
      right.crossVectors(forward, up).normalize()
      move.set(0, 0, 0)
      if (keys.has('KeyW')) move.add(forward)
      if (keys.has('KeyS')) move.sub(forward)
      if (keys.has('KeyD')) move.add(right)
      if (keys.has('KeyA')) move.sub(right)
      if (keys.has('KeyE')) move.y += 1
      if (keys.has('KeyQ')) move.y -= 1
      if (move.lengthSq() <= 0) {
        return
      }
      const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 72 : 24
      move.normalize().multiplyScalar(speed * dt)
      camera.position.add(move)
      applyRotation()
    },
    syncFromCamera,
    dispose(): void {
      element.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    },
  }
  return controls
}
