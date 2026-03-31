import * as THREE from 'three'

import type { LightNodeProperties,LightNodeType,LightShadowProperties } from './index'
import {
  DEFAULT_COLOR,
  DEFAULT_INTENSITY,
  DEFAULT_DECAY,
  DEFAULT_SPOT_ANGLE_RAD,
  DEFAULT_GROUND_COLOR,
  DEFAULT_SHADOW_MAP_SIZE_DIRECTIONAL,
  DEFAULT_SHADOW_MAP_SIZE_SPOT,
  DEFAULT_SHADOW_RADIUS,
  DEFAULT_SHADOW_BIAS,
  DEFAULT_SHADOW_NORMAL_BIAS,
  DEFAULT_SHADOW_CAMERA_NEAR,
  DEFAULT_SHADOW_CAMERA_FAR,
  DEFAULT_SHADOW_ORTHO_SIZE,
} from './lightDefaults'

// RectAreaLight support removed: no-op placeholder kept for compatibility.
export function ensureRectAreaLightSupport(): void {
  // Intentionally empty — RectAreaLight support removed.
}

export type CreatedThreeLight = {
  light: THREE.Light
  /** Optional target for Directional/Spot lights. Added by caller to the scene/root. */
  target?: THREE.Object3D
}

function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  return value
}

function applyShadowSettings(light: THREE.Light,type:LightNodeType, shadowProps: LightShadowProperties): void {

  const anyLight = light as any
  const shadow = anyLight.shadow as THREE.LightShadow | undefined
  if (!shadow) {
    return
  }

  const shadowCamera = shadow.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera | undefined

  const mapSize = coerceFiniteNumber(shadowProps.mapSize)
  if (mapSize !== null && mapSize > 0) {
    const size = Math.max(1, Math.round(mapSize))
    shadow.mapSize.set(size, size)
  }

  const bias = coerceFiniteNumber(shadowProps.bias)
  if (bias !== null) {
    shadow.bias = bias
  }

  const normalBias = coerceFiniteNumber(shadowProps.normalBias)
  if (normalBias !== null) {
    ;(shadow as any).normalBias = normalBias
  }

  const radius = coerceFiniteNumber(shadowProps.radius)
  if (radius !== null) {
    shadow.radius = radius
  }

  const cameraNear = coerceFiniteNumber(shadowProps.cameraNear)
  if (cameraNear !== null && shadowCamera) {
    shadowCamera.near = cameraNear
  }

  const cameraFar = coerceFiniteNumber(shadowProps.cameraFar)
  if (cameraFar !== null && shadowCamera) {
    shadowCamera.far = cameraFar
  }

  if (type === 'Directional') {
    const orthoSize = coerceFiniteNumber(shadowProps.orthoSize)
    const camera = shadowCamera as THREE.OrthographicCamera | undefined
    if (orthoSize !== null && camera && (camera as any).isOrthographicCamera) {
      const s = Math.max(0.01, orthoSize)
      camera.left = -s
      camera.right = s
      camera.top = s
      camera.bottom = -s
    }
  }

  shadowCamera?.updateProjectionMatrix?.()
}

export function createThreeLightFromLightNode(props: LightNodeProperties): CreatedThreeLight {
  const colorValue = props.color ?? DEFAULT_COLOR
  const color = new THREE.Color(colorValue)
  const intensity = Number.isFinite(props.intensity) ? Number(props.intensity) : DEFAULT_INTENSITY

  switch (props.type) {
    case 'Directional': {
      const directional = new THREE.DirectionalLight(color, intensity)
      directional.castShadow = Boolean(props.castShadow)
      let shadowProps = props.shadow ?? {}
      shadowProps.mapSize ??= DEFAULT_SHADOW_MAP_SIZE_DIRECTIONAL
      shadowProps.cameraNear ??= DEFAULT_SHADOW_CAMERA_NEAR
      shadowProps.cameraFar ??= DEFAULT_SHADOW_CAMERA_FAR
      shadowProps.orthoSize ??= DEFAULT_SHADOW_ORTHO_SIZE
      shadowProps.bias ??= DEFAULT_SHADOW_BIAS
      shadowProps.normalBias ??= DEFAULT_SHADOW_NORMAL_BIAS
      shadowProps.radius ??= DEFAULT_SHADOW_RADIUS
      applyShadowSettings(directional, props.type, shadowProps)

      if (props.target) {
        const target = new THREE.Object3D()
        target.position.set(props.target.x, props.target.y, props.target.z)
        directional.target = target
        return { light: directional, target }
      }

      return { light: directional }
    }

    case 'Point': {
      const point = new THREE.PointLight(color, intensity, props.distance ?? 0, props.decay ?? DEFAULT_DECAY)
      point.castShadow = Boolean(props.castShadow)
      let shadowProps = props.shadow ?? {}
      shadowProps.mapSize ??= DEFAULT_SHADOW_MAP_SIZE_SPOT
      shadowProps.cameraNear ??= DEFAULT_SHADOW_CAMERA_NEAR
      shadowProps.cameraFar ??= DEFAULT_SHADOW_CAMERA_FAR
      shadowProps.bias ??= DEFAULT_SHADOW_BIAS
      shadowProps.normalBias ??= DEFAULT_SHADOW_NORMAL_BIAS
      shadowProps.radius ??= DEFAULT_SHADOW_RADIUS
      applyShadowSettings(point, props.type, shadowProps)
      return { light: point }
    }

    case 'Spot': {
      const spot = new THREE.SpotLight(
        color,
        intensity,
        props.distance ?? 0,
        props.angle ?? DEFAULT_SPOT_ANGLE_RAD,
        props.penumbra ?? 0,
        props.decay ?? DEFAULT_DECAY,
      )
      spot.castShadow = Boolean(props.castShadow)
      let shadowProps = props.shadow ?? {}
      shadowProps.mapSize ??= DEFAULT_SHADOW_MAP_SIZE_SPOT
      shadowProps.cameraNear ??= DEFAULT_SHADOW_CAMERA_NEAR
      shadowProps.cameraFar ??= DEFAULT_SHADOW_CAMERA_FAR
      shadowProps.bias ??= DEFAULT_SHADOW_BIAS
      shadowProps.normalBias ??= DEFAULT_SHADOW_NORMAL_BIAS
      shadowProps.radius ??= DEFAULT_SHADOW_RADIUS
      applyShadowSettings(spot, props.type, shadowProps)

      if (props.target) {
        const target = new THREE.Object3D()
        target.position.set(props.target.x, props.target.y, props.target.z)
        spot.target = target
        return { light: spot, target }
      }

      return { light: spot }
    }

    case 'Hemisphere': {
      const ground = new THREE.Color(props.groundColor ?? DEFAULT_GROUND_COLOR)
      const hemi = new THREE.HemisphereLight(color, ground, intensity)
      return { light: hemi }
    }

    case 'Ambient':
    default: {
      const ambient = new THREE.AmbientLight(color, intensity)
      return { light: ambient }
    }
  }
}
