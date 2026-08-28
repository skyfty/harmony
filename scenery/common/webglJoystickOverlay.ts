import * as THREE from 'three'
import { createCanvas } from '@harmony/schema/canvas'

// ---------------------------------------------------------------------------
// Screen-space joystick overlay replicating the Summer Afternoon controls.
//
// The joystick is drawn as a screen-space quad (ShaderMaterial) inside the
// Three scene. Input is written to plain fields by the host and the visual
// state (knob position, fade-in/out, base scale) is advanced once per render
// frame with FPS-independent lerp smoothing, so no Vue reactivity or DOM style
// updates run in the touch-move hot path.
// ---------------------------------------------------------------------------

const JOYSTICK_TEXTURE_SIZE = 1024
// Channel layout mirrors the original controls/circles.png:
//   R = outer circle shape (hard-edged disc)
//   G = outer circle alpha (soft-edged disc)
//   B = inner knob shape
//   A = inner knob alpha
// The base disc is enlarged and given a higher alpha than the original so the
// pad clearly frames the knob and reads as a joystick on small screens.
const JOYSTICK_BASE_SHAPE_RADIUS = 0.4
const JOYSTICK_BASE_SHAPE_EDGE = 0.008
const JOYSTICK_BASE_ALPHA_RADIUS = 0.46
const JOYSTICK_BASE_ALPHA_EDGE = 0.05
const JOYSTICK_BASE_ALPHA = 42 / 255
const JOYSTICK_KNOB_SHAPE_RADIUS = 0.137
const JOYSTICK_KNOB_ALPHA_EDGE = 0.008
const JOYSTICK_KNOB_ALPHA = 150 / 255

// Reference constants from the Summer Afternoon shader/controls.
const JOYSTICK_BASE_PIXEL_SIZE = 700
const JOYSTICK_KNOB_TRAVEL_UV = 0.35
const JOYSTICK_TOUCH_POSITION_SMOOTHING = 0.2
const JOYSTICK_TOUCH_ACTIVE_SMOOTHING = 0.25

const vertexShader = `
  uniform vec2 uResolution;
  uniform float uScale;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 pos = position;
    pos.x /= uResolution.x / uResolution.y;
    pos /= uResolution.y / (${JOYSTICK_BASE_PIXEL_SIZE.toFixed(1)} * uScale);
    gl_Position = modelMatrix * vec4(pos, 1.0);
  }
`

const fragmentShader = `
  uniform sampler2D tCircles;
  uniform vec2 uInnerPos;
  uniform float uAlpha;
  varying vec2 vUv;

  vec3 blendScreen(vec3 base, vec3 blend) {
    return 1.0 - ((1.0 - base) * (1.0 - blend));
  }

  void main() {
    vec2 bg = texture2D(tCircles, vUv).rg;
    vec4 color = vec4(vec3(mix(vec3(0.0), vec3(1.0), bg.x)), bg.y);

    vec2 inner = texture2D(tCircles, vUv + uInnerPos).ba;
    color.rgb = blendScreen(color.rgb, vec3(mix(vec3(0.0), vec3(1.0), inner.x)));
    color.a = max(color.a, inner.y);

    gl_FragColor = color;
    gl_FragColor.a *= uAlpha;
  }
`

export type JoystickOverlayViewport = {
  cssWidth: number
  cssHeight: number
  pxWidth: number
  pxHeight: number
}

export type WebglJoystickOverlay = {
  begin: (baseX: number, baseY: number) => void
  move: (rawX: number, rawY: number) => void
  end: () => void
  update: (deltaSeconds: number, viewport: JoystickOverlayViewport) => void
  dispose: () => void
}

type CirclesRenderingContext = {
  createImageData: (width: number, height: number) => ImageData
  putImageData: (imageData: ImageData, dx: number, dy: number) => void
}

let sharedCirclesTexture: THREE.CanvasTexture | null = null

function smoothstepEdge(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function createCirclesTexture(): THREE.CanvasTexture {
  const size = JOYSTICK_TEXTURE_SIZE
  const canvas = createCanvas(size, size)
  const context = canvas.getContext('2d') as CirclesRenderingContext
  const imageData = context.createImageData(size, size)
  const data = imageData.data
  const center = (size - 1) / 2

  const baseShapeRadiusPx = JOYSTICK_BASE_SHAPE_RADIUS * size
  const baseShapeEdgePx = JOYSTICK_BASE_SHAPE_EDGE * size
  const baseAlphaRadiusPx = JOYSTICK_BASE_ALPHA_RADIUS * size
  const baseAlphaEdgePx = JOYSTICK_BASE_ALPHA_EDGE * size
  const knobShapeRadiusPx = JOYSTICK_KNOB_SHAPE_RADIUS * size
  const knobAlphaEdgePx = JOYSTICK_KNOB_ALPHA_EDGE * size

  for (let y = 0; y < size; y += 1) {
    const dy = y - center
    for (let x = 0; x < size; x += 1) {
      const dx = x - center
      const distance = Math.sqrt(dx * dx + dy * dy)
      const baseShape = smoothstepEdge(baseShapeRadiusPx - baseShapeEdgePx, baseShapeRadiusPx, distance)
      const baseAlpha = JOYSTICK_BASE_ALPHA
        * (1 - smoothstepEdge(baseAlphaRadiusPx - baseAlphaEdgePx, baseAlphaRadiusPx, distance))
      const knobShape = smoothstepEdge(knobShapeRadiusPx - 2, knobShapeRadiusPx, distance)
      const knobAlpha = JOYSTICK_KNOB_ALPHA
        * (1 - smoothstepEdge(knobShapeRadiusPx - knobAlphaEdgePx, knobShapeRadiusPx, distance))
      const offset = (y * size + x) * 4
      data[offset] = Math.round(baseShape * 255)
      data[offset + 1] = Math.round(baseAlpha * 255)
      data[offset + 2] = Math.round(knobShape * 255)
      data[offset + 3] = Math.round(knobAlpha * 255)
    }
  }

  context.putImageData(imageData, 0, 0)

  const texture = new THREE.CanvasTexture(canvas as CanvasImageSource)
  texture.colorSpace = THREE.NoColorSpace
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

function getSharedCirclesTexture(): THREE.CanvasTexture {
  if (!sharedCirclesTexture) {
    sharedCirclesTexture = createCirclesTexture()
  }
  return sharedCirclesTexture
}

function frameRateIndependentLerp(current: number, target: number, coefficient: number, deltaSeconds: number): number {
  const factor = 1 - Math.exp(Math.log(1 - coefficient) * deltaSeconds * 60)
  return current + (target - current) * factor
}

export function createJoystickOverlay(scene: THREE.Scene): WebglJoystickOverlay {
  const geometry = new THREE.PlaneGeometry(1, 1)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tCircles: { value: getSharedCirclesTexture() },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uScale: { value: 1 },
      uAlpha: { value: 0 },
      uInnerPos: { value: new THREE.Vector2(0, 0) },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 9000
  mesh.visible = false
  scene.add(mesh)

  const state = {
    active: false,
    baseX: 0,
    baseY: 0,
    rawX: 0,
    rawY: 0,
    smoothX: 0,
    smoothY: 0,
    touchActive: 0,
  }

  const overlay: WebglJoystickOverlay = {
    begin(baseX: number, baseY: number): void {
      state.active = true
      state.baseX = baseX
      state.baseY = baseY
      state.rawX = 0
      state.rawY = 0
      state.smoothX = 0
      state.smoothY = 0
    },

    move(rawX: number, rawY: number): void {
      state.rawX = rawX
      state.rawY = rawY
    },

    end(): void {
      state.active = false
      state.rawX = 0
      state.rawY = 0
    },

    update(deltaSeconds: number, viewport: JoystickOverlayViewport): void {
      if (deltaSeconds <= 0 || !Number.isFinite(deltaSeconds)) {
        return
      }
      state.smoothX = frameRateIndependentLerp(state.smoothX, state.rawX, JOYSTICK_TOUCH_POSITION_SMOOTHING, deltaSeconds)
      state.smoothY = frameRateIndependentLerp(state.smoothY, state.rawY, JOYSTICK_TOUCH_POSITION_SMOOTHING, deltaSeconds)
      state.touchActive = frameRateIndependentLerp(
        state.touchActive,
        state.active ? 1 : 0,
        JOYSTICK_TOUCH_ACTIVE_SMOOTHING,
        deltaSeconds,
      )

      if (!state.active && state.touchActive < 0.001) {
        mesh.visible = false
        return
      }
      mesh.visible = true

      const uniforms = material.uniforms
      const uResolution = uniforms.uResolution.value as THREE.Vector2
      const uInnerPos = uniforms.uInnerPos.value as THREE.Vector2
      const pxWidth = viewport.pxWidth > 0 ? viewport.pxWidth : viewport.cssWidth
      const pxHeight = viewport.pxHeight > 0 ? viewport.pxHeight : viewport.cssHeight
      uResolution.set(pxWidth, pxHeight)
      // The inner knob is sampled at `vUv + uInnerPos`, so a positive offset
      // shifts the knob visually in the opposite direction. Negate the host
      // input (which is already finger-direction-positive) so the knob follows
      // the finger on both axes.
      uInnerPos.set(-state.smoothX * JOYSTICK_KNOB_TRAVEL_UV, -state.smoothY * JOYSTICK_KNOB_TRAVEL_UV)
      uniforms.uScale.value = 0.75 + 0.25 * state.touchActive
      uniforms.uAlpha.value = 1 - Math.pow(1 - state.touchActive, 3)

      const cssWidth = viewport.cssWidth > 0 ? viewport.cssWidth : pxWidth
      const cssHeight = viewport.cssHeight > 0 ? viewport.cssHeight : pxHeight
      mesh.position.set((state.baseX / cssWidth) * 2 - 1, 1 - (state.baseY / cssHeight) * 2, 0)
      mesh.updateMatrixWorld(true)
    },

    dispose(): void {
      scene.remove(mesh)
      geometry.dispose()
      material.dispose()
    },
  }

  return overlay
}
