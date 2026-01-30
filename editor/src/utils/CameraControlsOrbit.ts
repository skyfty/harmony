import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/**
 * Harmony wrapper around Three.js OrbitControls.
 * Centralizes defaults and provides extension points.
 */
export class CameraControlsOrbit extends OrbitControls {
  constructor(object: THREE.Camera, domElement: HTMLElement) {
    super(object, domElement)

    // Defaults currently used by the editor viewport.
    // this.minDistance = 2
    // this.maxDistance = 200

    // Smooth camera movement.
    this.enableDamping = true
    this.dampingFactor = 0.08


    // Speeds.
    this.rotateSpeed = 0.6
    this.zoomSpeed = 0.9
    this.panSpeed = 1.0
    // @ts-ignore - OrbitControls does not officially type keyPanSpeed on some versions
    ;(this as any).keyPanSpeed = 7.0

    // Keyboard panning.
    ;(this as any).enableKeys = true
    // @ts-ignore - keys typing differs across three versions
    ;(this as any).keys = {
      LEFT: 'ArrowLeft',
      UP: 'ArrowUp',
      RIGHT: 'ArrowRight',
      BOTTOM: 'ArrowDown',
    }

    this.mouseButtons.LEFT = THREE.MOUSE.PAN
    this.mouseButtons.MIDDLE = THREE.MOUSE.PAN
  }
}
