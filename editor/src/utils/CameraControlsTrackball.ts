import * as THREE from 'three'
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js'

/**
 * Harmony wrapper around Three.js TrackballControls.
 * Centralizes defaults and provides extension points.
 */
export class CameraControlsTrackball extends TrackballControls {
  constructor(object: THREE.Camera, domElement: HTMLElement) {
    super(object, domElement)

    // Defaults currently used by the editor viewport.
    // SceneViewport will further refine these dynamically based on focused bounds.
    this.minDistance = 0.02
    this.maxDistance = 50000

    // Smooth camera movement / inertia.
    // TrackballControls uses `staticMoving`/`dynamicDampingFactor` instead of OrbitControls damping.
    // The editor previously ran OrbitControls with `enableDamping = false`, so default to no inertia.
    this.staticMoving = true
    this.dynamicDampingFactor = 0.08

    // Speeds.
    this.rotateSpeed = 0.6
    this.zoomSpeed = 0.9
    this.panSpeed = 1.0

    // Mouse mapping: keep legacy editor behavior (middle mouse rotates).
    this.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE

    // Avoid TrackballControls stealing editor keyboard shortcuts.
    // It registers window key listeners in `connect()`. Remove them and make key bindings inert.
    this.keys = [] as any
    if (typeof window !== 'undefined') {
      const anyThis = this as any
      if (anyThis._onKeyDown) {
        window.removeEventListener('keydown', anyThis._onKeyDown)
      }
      if (anyThis._onKeyUp) {
        window.removeEventListener('keyup', anyThis._onKeyUp)
      }
    }
  }
}
