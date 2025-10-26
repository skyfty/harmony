export class FirstPersonController {
  constructor(canvas, camera, THREE) {
    this.canvas = canvas
    this.camera = camera
    this.THREE = THREE
    this.enabled = true
    this.movementSpeed = 6
    this.lookSpeed = 0.18
    this.moveInput = { x: 0, y: 0 }
    this.yaw = 0
    this.pitch = 0
    this._lookPointerId = null
    this._movePointerId = null
    this._moveOrigin = { x: 0, y: 0 }
    this._lookOrigin = { x: 0, y: 0 }
    this._size = { width: canvas.width, height: canvas.height }

    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    this.yaw = Math.atan2(forward.x, forward.z)
    this.pitch = Math.asin(Math.max(-1, Math.min(1, forward.y)))

    this._bindHandlers()
  }

  setSize(width, height) {
    this._size = { width, height }
  }

  _bindHandlers() {
    this._onTouchStart = this._handleTouchStart.bind(this)
    this._onTouchMove = this._handleTouchMove.bind(this)
    this._onTouchEnd = this._handleTouchEnd.bind(this)

    this.canvas.addEventListener('touchstart', this._onTouchStart)
    this.canvas.addEventListener('touchmove', this._onTouchMove)
    this.canvas.addEventListener('touchend', this._onTouchEnd)
    this.canvas.addEventListener('touchcancel', this._onTouchEnd)
  }

  dispose() {
    this.canvas.removeEventListener('touchstart', this._onTouchStart)
    this.canvas.removeEventListener('touchmove', this._onTouchMove)
    this.canvas.removeEventListener('touchend', this._onTouchEnd)
    this.canvas.removeEventListener('touchcancel', this._onTouchEnd)
  }

  _handleTouchStart(event) {
    if (!this.enabled) {
      return
    }
    for (const touch of event.touches) {
      const isLeft = touch.x <= this._size.width / 2
      if (isLeft && this._movePointerId === null) {
        this._movePointerId = touch.identifier
        this._moveOrigin = { x: touch.x, y: touch.y }
        this.moveInput = { x: 0, y: 0 }
      } else if (!isLeft && this._lookPointerId === null) {
        this._lookPointerId = touch.identifier
        this._lookOrigin = { x: touch.x, y: touch.y }
      }
    }
  }

  _handleTouchMove(event) {
    if (!this.enabled) {
      return
    }
    for (const touch of event.touches) {
      if (touch.identifier === this._movePointerId) {
        const dx = touch.x - this._moveOrigin.x
        const dy = touch.y - this._moveOrigin.y
        const maxRadius = 120
        const clamp = (value) => Math.max(-maxRadius, Math.min(maxRadius, value))
        const nx = clamp(dx) / maxRadius
        const ny = clamp(dy) / maxRadius
        this.moveInput = { x: nx, y: -ny }
      }
      if (touch.identifier === this._lookPointerId) {
        const dx = touch.x - this._lookOrigin.x
        const dy = touch.y - this._lookOrigin.y
        this._lookOrigin = { x: touch.x, y: touch.y }
        this.yaw -= dx * 0.0025 * this.lookSpeed
        this.pitch -= dy * 0.0025 * this.lookSpeed
        const limit = Math.PI / 2 - 0.05
        this.pitch = Math.max(-limit, Math.min(limit, this.pitch))
      }
    }
  }

  _handleTouchEnd(event) {
    if (!this.enabled) {
      return
    }
    for (const touch of event.changedTouches) {
      if (touch.identifier === this._movePointerId) {
        this._movePointerId = null
        this.moveInput = { x: 0, y: 0 }
      }
      if (touch.identifier === this._lookPointerId) {
        this._lookPointerId = null
      }
    }
  }

  update(delta) {
    if (!this.enabled) {
      return
    }
    const THREE = this.THREE
    const quaternion = new THREE.Quaternion()
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')
    quaternion.setFromEuler(euler)
    this.camera.quaternion.copy(quaternion)

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    forward.y = 0
    forward.normalize()
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(-1)

    const move = new THREE.Vector3()
    if (Math.abs(this.moveInput.y) > 0.05) {
      move.add(forward.clone().multiplyScalar(this.moveInput.y))
    }
    if (Math.abs(this.moveInput.x) > 0.05) {
      move.add(right.clone().multiplyScalar(this.moveInput.x))
    }

    if (move.lengthSq() > 0) {
      move.normalize()
      this.camera.position.addScaledVector(move, delta * this.movementSpeed)
    }
  }

  resetOrientation(camera) {
    const forward = new this.THREE.Vector3()
    camera.getWorldDirection(forward)
    this.yaw = Math.atan2(forward.x, forward.z)
    this.pitch = Math.asin(Math.max(-1, Math.min(1, forward.y)))
  }
}
