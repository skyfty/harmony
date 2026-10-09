import * as THREE from 'three'

// ---------------------------------------------------------------------------
// Screen-space joystick overlay replicating the Summer Afternoon controls.
//
// The joystick is drawn as a screen-space quad (ShaderMaterial) inside the
// Three scene. Input is written to plain fields by the host and the visual
// state (knob position, fade-in/out, base scale) is advanced once per render
// frame with FPS-independent lerp smoothing, so no Vue reactivity or DOM style
// updates run in the touch-move hot path.
//
// The circular lookups are evaluated analytically in the fragment shader. The
// previous implementation baked a 1024x1024 RGBA lookup texture with a JS
// per-pixel loop, which cost ~70 seconds of scene-entry time on an iPhone 6s
// (WeChat mini-program ImageData is extremely slow to fill from script).
// ---------------------------------------------------------------------------

// Shape parameters mirror the original controls/circles.png channel layout:
//   outer circle shape (hard-edged disc), outer circle alpha (soft-edged disc),
//   inner knob shape, inner knob alpha.
// The base disc is enlarged and given a higher alpha than the original so the
// pad clearly frames the knob and reads as a joystick on small screens.
// All radii/edges are normalized UV units on the unit quad.
const JOYSTICK_BASE_SHAPE_RADIUS = 0.4
const JOYSTICK_BASE_SHAPE_EDGE = 0.008
const JOYSTICK_BASE_ALPHA_RADIUS = 0.46
const JOYSTICK_BASE_ALPHA_EDGE = 0.05
const JOYSTICK_BASE_ALPHA = 42 / 255
const JOYSTICK_KNOB_SHAPE_RADIUS = 0.137
// The baked texture used a 2px-hard knob edge on a 1024px canvas; keep the same
// angular softness by scaling that edge to UV units.
const JOYSTICK_KNOB_SHAPE_REFERENCE_SIZE = 1024
const JOYSTICK_KNOB_SHAPE_EDGE = 2 / JOYSTICK_KNOB_SHAPE_REFERENCE_SIZE
const JOYSTICK_KNOB_ALPHA_EDGE = 0.008
const JOYSTICK_KNOB_ALPHA = 150 / 255

const shaderFloat = (value: number): string => value.toFixed(8)

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
  uniform vec2 uInnerPos;
  uniform float uAlpha;
  varying vec2 vUv;

  float smoothstepEdge(float edge0, float edge1, float value) {
    float t = clamp((value - edge0) / (edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
  }

  vec3 blendScreen(vec3 base, vec3 blend) {
    return 1.0 - ((1.0 - base) * (1.0 - blend));
  }

  void main() {
    float baseDistance = length(vUv - vec2(0.5));
    vec2 bg = vec2(
      smoothstepEdge(${shaderFloat(JOYSTICK_BASE_SHAPE_RADIUS - JOYSTICK_BASE_SHAPE_EDGE)}, ${shaderFloat(JOYSTICK_BASE_SHAPE_RADIUS)}, baseDistance),
      ${shaderFloat(JOYSTICK_BASE_ALPHA)} * (1.0 - smoothstepEdge(${shaderFloat(JOYSTICK_BASE_ALPHA_RADIUS - JOYSTICK_BASE_ALPHA_EDGE)}, ${shaderFloat(JOYSTICK_BASE_ALPHA_RADIUS)}, baseDistance))
    );

    float knobDistance = length(vUv + uInnerPos - vec2(0.5));
    vec2 inner = vec2(
      smoothstepEdge(${shaderFloat(JOYSTICK_KNOB_SHAPE_RADIUS - JOYSTICK_KNOB_SHAPE_EDGE)}, ${shaderFloat(JOYSTICK_KNOB_SHAPE_RADIUS)}, knobDistance),
      ${shaderFloat(JOYSTICK_KNOB_ALPHA)} * (1.0 - smoothstepEdge(${shaderFloat(JOYSTICK_KNOB_SHAPE_RADIUS - JOYSTICK_KNOB_ALPHA_EDGE)}, ${shaderFloat(JOYSTICK_KNOB_SHAPE_RADIUS)}, knobDistance))
    );

    vec4 color = vec4(vec3(mix(vec3(0.0), vec3(1.0), bg.x)), bg.y);

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

function frameRateIndependentLerp(current: number, target: number, coefficient: number, deltaSeconds: number): number {
  const factor = 1 - Math.exp(Math.log(1 - coefficient) * deltaSeconds * 60)
  return current + (target - current) * factor
}

export function createJoystickOverlay(scene: THREE.Scene): WebglJoystickOverlay {
  const geometry = new THREE.PlaneGeometry(1, 1)
  const material = new THREE.ShaderMaterial({
    uniforms: {
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
      // Fully faded-out idle overlay: every lerp below would be a no-op (target 0,
      // current 0), so skip the exp/log work entirely. This runs for both overlays
      // every frame, and the mini-program runtime charges per call.
      if (!state.active && state.touchActive <= 0) {
        mesh.visible = false
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
      // The inner knob is centred at `vUv + uInnerPos`, so a positive offset
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
