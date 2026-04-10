import * as THREE from 'three'
import CameraControls from 'camera-controls'

type SceneViewportCameraControlEventMap = {
  change: { type: 'change' }
  start: { type: 'start' }
  end: { type: 'end' }
}

export type SceneViewportCameraControlMode = 'map' | 'orbit'

let installed = false

function ensureInstalled() {
  if (installed) {
    return
  }
  CameraControls.install({ THREE })
  installed = true
}

const TARGET_EPSILON = 1e-8
const POSITION_EPSILON = 1e-8
const PLANAR_DIRECTION_EPSILON = 1e-10

export class SceneViewportCameraControls extends THREE.EventDispatcher<SceneViewportCameraControlEventMap> {
  readonly target = new THREE.Vector3()

  private readonly controls: CameraControls
  private readonly currentTarget = new THREE.Vector3()
  private readonly lastCameraPosition = new THREE.Vector3()
  private readonly keyboardStep = new THREE.Vector2()
  private readonly planarPanForward = new THREE.Vector3()
  private readonly planarPanRight = new THREE.Vector3()
  private readonly planarPanDelta = new THREE.Vector3()
  private readonly planarPanTarget = new THREE.Vector3()
  private readonly planarPanPosition = new THREE.Vector3()
  private orbitRotateSession: { pointerId: number; lastX: number; lastY: number } | null = null
  private readonly boundKeyDown: (event: KeyboardEvent) => void

  private domElement: HTMLElement
  private keyPanSpeedValue = 7
  private currentMode: SceneViewportCameraControlMode = 'orbit'
  private planarPanSession: { pointerId: number; lastX: number; lastY: number } | null = null
  private transientLeftRotateActive = false

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    super()
    ensureInstalled()
    this.domElement = domElement
    this.controls = new CameraControls(camera, domElement)
    this.boundKeyDown = this.handleKeyDown.bind(this)

    this.controls.smoothTime = 0.08
    this.controls.draggingSmoothTime = 0.04
    this.controls.restThreshold = 0.002
    this.controls.dollyToCursor = true
    this.controls.infinityDolly = false

    this.controls.addEventListener('controlstart', this.handleControlStart)
    this.controls.addEventListener('controlend', this.handleControlEnd)
    window.addEventListener('keydown', this.boundKeyDown)

    this.syncFromControls()
  }

  get enabled(): boolean {
    return this.controls.enabled
  }

  set enabled(value: boolean) {
    this.controls.enabled = value
  }

  get object(): THREE.PerspectiveCamera {
    return this.controls.camera as THREE.PerspectiveCamera
  }

  set object(value: THREE.PerspectiveCamera) {
    ;(this.controls as unknown as { camera: THREE.PerspectiveCamera }).camera = value
    this.syncLegacyStateToControls()
    this.syncFromControls()
  }

  get minDistance(): number {
    return this.controls.minDistance
  }

  set minDistance(value: number) {
    this.controls.minDistance = value
  }

  get maxDistance(): number {
    return this.controls.maxDistance
  }

  set maxDistance(value: number) {
    this.controls.maxDistance = value
  }

  get minPolarAngle(): number {
    return this.controls.minPolarAngle
  }

  set minPolarAngle(value: number) {
    this.controls.minPolarAngle = value
  }

  get maxPolarAngle(): number {
    return this.controls.maxPolarAngle
  }

  set maxPolarAngle(value: number) {
    this.controls.maxPolarAngle = value
  }

  get rotateSpeed(): number {
    return (this.controls.azimuthRotateSpeed + this.controls.polarRotateSpeed) * 0.5
  }

  set rotateSpeed(value: number) {
    this.controls.azimuthRotateSpeed = value
    this.controls.polarRotateSpeed = value
  }

  get zoomSpeed(): number {
    return this.controls.dollySpeed
  }

  set zoomSpeed(value: number) {
    this.controls.dollySpeed = value
  }

  get panSpeed(): number {
    return this.controls.truckSpeed
  }

  set panSpeed(value: number) {
    this.controls.truckSpeed = value
  }

  get keyPanSpeed(): number {
    return this.keyPanSpeedValue
  }

  set keyPanSpeed(value: number) {
    this.keyPanSpeedValue = value
  }

  applyMode(mode: SceneViewportCameraControlMode) {
    this.currentMode = mode
    const { ACTION } = CameraControls

    this.controls.mouseButtons.left = ACTION.NONE
    this.controls.mouseButtons.wheel = ACTION.DOLLY

    if (mode === 'map') {
      this.controls.mouseButtons.middle = ACTION.NONE
      this.controls.mouseButtons.right = ACTION.ROTATE
      this.controls.touches.one = ACTION.TOUCH_TRUCK
      this.controls.touches.two = ACTION.TOUCH_DOLLY_TRUCK
      this.controls.touches.three = ACTION.TOUCH_TRUCK
      this.controls.minPolarAngle = THREE.MathUtils.degToRad(10)
      this.controls.maxPolarAngle = THREE.MathUtils.degToRad(88)
      this.controls.dollyToCursor = true
      this.controls.draggingSmoothTime = 0.035
    } else {
      this.controls.mouseButtons.middle = ACTION.ROTATE
      this.controls.mouseButtons.right = ACTION.TRUCK
      this.controls.touches.one = ACTION.TOUCH_ROTATE
      this.controls.touches.two = ACTION.TOUCH_DOLLY_ROTATE
      this.controls.touches.three = ACTION.TOUCH_TRUCK
      this.controls.minPolarAngle = 0.001
      this.controls.maxPolarAngle = Math.PI - 0.001
      this.controls.dollyToCursor = true
      this.controls.draggingSmoothTime = 0.05
    }
  }

  beginPlanarPanGesture(pointerId: number, clientX: number, clientY: number) {
    if (this.currentMode !== 'map') {
      return
    }
    this.planarPanSession = {
      pointerId,
      lastX: clientX,
      lastY: clientY,
    }
  }

  updatePlanarPanGesture(pointerId: number, clientX: number, clientY: number) {
    if (this.currentMode !== 'map' || !this.planarPanSession || this.planarPanSession.pointerId !== pointerId) {
      return false
    }

    const dx = clientX - this.planarPanSession.lastX
    const dy = clientY - this.planarPanSession.lastY
    this.planarPanSession.lastX = clientX
    this.planarPanSession.lastY = clientY

    if (Math.abs(dx) <= Number.EPSILON && Math.abs(dy) <= Number.EPSILON) {
      return false
    }

    const cameraPosition = this.getPosition(this.planarPanPosition, false)
    const target = this.getTarget(this.planarPanTarget, false)
    const distance = Math.max(cameraPosition.distanceTo(target), 1e-3)
    const unitsPerPixel = this.computeWorldUnitsPerPixel(distance) * Math.max(this.panSpeed, 1e-3)

    this.planarPanForward.copy(target).sub(cameraPosition)
    this.planarPanForward.y = 0
    if (this.planarPanForward.lengthSq() <= PLANAR_DIRECTION_EPSILON) {
      this.controls.camera.getWorldDirection(this.planarPanForward)
      this.planarPanForward.y = 0
    }
    if (this.planarPanForward.lengthSq() <= PLANAR_DIRECTION_EPSILON) {
      return false
    }
    this.planarPanForward.normalize()

    this.planarPanRight.crossVectors(this.planarPanForward, THREE.Object3D.DEFAULT_UP)
    if (this.planarPanRight.lengthSq() <= PLANAR_DIRECTION_EPSILON) {
      this.planarPanRight.set(1, 0, 0)
    } else {
      this.planarPanRight.normalize()
    }

    this.planarPanDelta
      .copy(this.planarPanRight)
      .multiplyScalar(-dx * unitsPerPixel)
      .addScaledVector(this.planarPanForward, dy * unitsPerPixel)

    this.planarPanPosition.add(this.planarPanDelta)
    this.planarPanTarget.add(this.planarPanDelta)
    this.setLookAt(this.planarPanPosition, this.planarPanTarget, false)
    return true
  }

  endPlanarPanGesture(pointerId?: number) {
    if (!this.planarPanSession) {
      return
    }
    if (typeof pointerId === 'number' && this.planarPanSession.pointerId !== pointerId) {
      return
    }
    this.planarPanSession = null
  }

  beginTransientLeftRotateGesture() {
    if (this.currentMode !== 'orbit' || this.transientLeftRotateActive) {
      return
    }
    this.controls.mouseButtons.left = CameraControls.ACTION.ROTATE
    this.transientLeftRotateActive = true
  }

  endTransientLeftRotateGesture() {
    if (!this.transientLeftRotateActive) {
      return
    }
    this.transientLeftRotateActive = false
    this.applyMode(this.currentMode)
  }

  beginOrbitRotateGesture(pointerId: number, clientX: number, clientY: number) {
    if (this.currentMode !== 'orbit') {
      return
    }
    this.orbitRotateSession = {
      pointerId,
      lastX: clientX,
      lastY: clientY,
    }
  }

  updateOrbitRotateGesture(pointerId: number, clientX: number, clientY: number) {
    if (this.currentMode !== 'orbit' || !this.orbitRotateSession || this.orbitRotateSession.pointerId !== pointerId) {
      return false
    }

    const dx = clientX - this.orbitRotateSession.lastX
    const dy = clientY - this.orbitRotateSession.lastY
    this.orbitRotateSession.lastX = clientX
    this.orbitRotateSession.lastY = clientY

    if (Math.abs(dx) <= Number.EPSILON && Math.abs(dy) <= Number.EPSILON) {
      return false
    }

    const width = Math.max(1, this.domElement.clientWidth || 1)
    const height = Math.max(1, this.domElement.clientHeight || 1)
    const azimuth = (-dx / width) * Math.PI * Math.max(this.rotateSpeed, 1e-3)
    const polar = (-dy / height) * Math.PI * Math.max(this.rotateSpeed, 1e-3)
    this.controls.rotate(azimuth, polar, false)
    this.syncFromControls()
    this.dispatchEvent({ type: 'change' })
    return true
  }

  endOrbitRotateGesture(pointerId?: number) {
    if (!this.orbitRotateSession) {
      return
    }
    if (typeof pointerId === 'number' && this.orbitRotateSession.pointerId !== pointerId) {
      return
    }
    this.orbitRotateSession = null
  }

  setLookAt(position: THREE.Vector3, target: THREE.Vector3, enableTransition = false) {
    this.controls
      .normalizeRotations()
      .setLookAt(
        position.x,
        position.y,
        position.z,
        target.x,
        target.y,
        target.z,
        enableTransition,
      )
    this.syncFromControls()
    this.dispatchEvent({ type: 'change' })
  }

  setTarget(target: THREE.Vector3, enableTransition = false) {
    this.controls
      .normalizeRotations()
      .setTarget(target.x, target.y, target.z, enableTransition)
    this.syncFromControls()
    this.dispatchEvent({ type: 'change' })
  }

  fitToSphere(sphere: THREE.Sphere, enableTransition = false) {
    this.controls.fitToSphere(sphere, enableTransition)
    this.syncFromControls()
    this.dispatchEvent({ type: 'change' })
  }

  getTarget(out: THREE.Vector3, receiveEndValue = false): THREE.Vector3 {
    this.controls.getTarget(out, receiveEndValue)
    return out
  }

  getPosition(out: THREE.Vector3, receiveEndValue = false): THREE.Vector3 {
    this.controls.getPosition(out, receiveEndValue)
    return out
  }

  update(delta = 0): boolean {
    const manualChange = this.syncLegacyStateToControls()
    const changed = this.controls.update(delta)
    const syncedChange = this.syncFromControls()
    if (manualChange || changed || syncedChange) {
      this.dispatchEvent({ type: 'change' })
      return true
    }
    return false
  }

  handleResize(): void {}

  dispose() {
    window.removeEventListener('keydown', this.boundKeyDown)
    this.controls.removeEventListener('controlstart', this.handleControlStart)
    this.controls.removeEventListener('controlend', this.handleControlEnd)
    this.controls.dispose()
  }

  private readonly handleControlStart = () => {
    this.dispatchEvent({ type: 'start' })
  }

  private readonly handleControlEnd = () => {
    this.syncFromControls()
    this.dispatchEvent({ type: 'end' })
    this.dispatchEvent({ type: 'change' })
  }

  private handleKeyDown(event: KeyboardEvent) {
    if (!this.enabled) {
      return
    }
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return
    }
    const target = event.target as HTMLElement | null
    if (target) {
      const tagName = target.tagName
      if (target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
        return
      }
    }

    this.keyboardStep.set(0, 0)
    if (event.key === 'ArrowLeft') {
      this.keyboardStep.x = -this.keyPanSpeedValue
    } else if (event.key === 'ArrowRight') {
      this.keyboardStep.x = this.keyPanSpeedValue
    } else if (event.key === 'ArrowUp') {
      this.keyboardStep.y = this.keyPanSpeedValue
    } else if (event.key === 'ArrowDown') {
      this.keyboardStep.y = -this.keyPanSpeedValue
    }

    if (this.keyboardStep.lengthSq() <= 0) {
      return
    }

    const isDomEventInsideViewport = event.composedPath().includes(this.domElement)
    const activeElement = document.activeElement
    const viewportOwnsFocus = activeElement === document.body || activeElement === this.domElement
    if (!isDomEventInsideViewport && !viewportOwnsFocus) {
      return
    }

    event.preventDefault()
    this.controls.truck(this.keyboardStep.x, this.keyboardStep.y, false)
    this.syncFromControls()
    this.dispatchEvent({ type: 'change' })
  }

  private computeWorldUnitsPerPixel(distance: number): number {
    const viewportHeightPx = Math.max(1, this.domElement.clientHeight || 1)
    const camera = this.controls.camera

    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const perspective = camera as THREE.PerspectiveCamera
      const vFovRad = THREE.MathUtils.degToRad(perspective.fov)
      const worldHeight = 2 * Math.max(1e-6, distance) * Math.tan(vFovRad / 2)
      return worldHeight / viewportHeightPx
    }

    return Math.max(1e-6, distance) / viewportHeightPx
  }

  private syncLegacyStateToControls(): boolean {
    const cameraPosition = this.controls.camera.position
    const targetChanged = this.currentTarget.distanceToSquared(this.target) > TARGET_EPSILON
    const positionChanged = this.lastCameraPosition.distanceToSquared(cameraPosition) > POSITION_EPSILON
    if (!targetChanged && !positionChanged) {
      return false
    }

    this.controls
      .normalizeRotations()
      .setLookAt(
        cameraPosition.x,
        cameraPosition.y,
        cameraPosition.z,
        this.target.x,
        this.target.y,
        this.target.z,
        false,
      )

    this.currentTarget.copy(this.target)
    this.lastCameraPosition.copy(cameraPosition)
    return true
  }

  private syncFromControls(): boolean {
    const previousTarget = new THREE.Vector3().copy(this.target)
    const previousPosition = new THREE.Vector3().copy(this.lastCameraPosition)

    this.controls.getTarget(this.currentTarget, false)
    this.target.copy(this.currentTarget)
    this.lastCameraPosition.copy(this.controls.camera.position)

    return previousTarget.distanceToSquared(this.target) > TARGET_EPSILON
      || previousPosition.distanceToSquared(this.lastCameraPosition) > POSITION_EPSILON
  }
}