import * as THREE from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'

/**
 * Harmony wrapper around Three.js MapControls.
 * Centralizes defaults and provides extension points.
 */
export class CameraControlsMap extends MapControls {
  constructor(object: THREE.Camera, domElement: HTMLElement) {
    super(object, domElement)

    // Defaults currently used by the editor viewport.
    // SceneViewport will further refine these dynamically based on focused bounds.
    this.minDistance = 0.2
    this.maxDistance = 50000

    // Smooth camera movement.
    this.enableDamping = false
    this.dampingFactor = 0.08

    // Speeds.
    this.rotateSpeed = 0.6
    this.zoomSpeed = 0.9
    this.panSpeed = 1.0
    // @ts-ignore
    ;(this as any).keyPanSpeed = 7.0

    // Keyboard panning.
    ;(this as any).enableKeys = true
    // @ts-ignore
    ;(this as any).keys = {
      LEFT: 'ArrowLeft',
      UP: 'ArrowUp',
      RIGHT: 'ArrowRight',
      BOTTOM: 'ArrowDown',
    }

    // Touch gestures (map-style).
    // @ts-ignore
    ;(this as any).touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_ROTATE,
    }
  }
}
