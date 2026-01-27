import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/**
 * Harmony wrapper around Three.js OrbitControls.
 * Use this class to centralize default parameters and extensions.
 */
export class CameraControlsOrbit extends OrbitControls {
  /**
   * @param {import('three').Camera} object
   * @param {HTMLElement} domElement
   */
  constructor(object, domElement) {
    super(object, domElement)

    // Defaults currently used by the editor viewport.
    this.minDistance = 2
    this.maxDistance = 200

    // Smooth camera movement.
    this.enableDamping = true
    this.dampingFactor = 0.08

    // Speeds.
    this.rotateSpeed = 0.6
    this.zoomSpeed = 0.9
    this.panSpeed = 1.0
    this.keyPanSpeed = 7.0

    // Keyboard panning.
    this.enableKeys = true
    this.keys = {
      LEFT: 'ArrowLeft',
      UP: 'ArrowUp',
      RIGHT: 'ArrowRight',
      BOTTOM: 'ArrowDown',
    }

    // Touch gestures.
    this.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    }
  }
}
