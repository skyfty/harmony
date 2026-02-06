// Light-related helpers extracted from sceneStore.
// Use `import type` for shared types to avoid runtime cycles.

import type { SceneNode, LightNodeType } from '@harmony/schema'
import type { Vector3, Light } from 'three'
import { normalizeLightNodeType } from '@/types/light'

export type LightDeps = {
  createVector: (x: number, y: number, z: number) => Vector3
  generateUuid?: () => string
}

export function createLightNodeWithDeps(deps: LightDeps, options: {
  name: string
  type: LightNodeType
  color: string
  intensity: number
  position: Vector3
  rotation?: Vector3
  target?: Vector3
  extras?: Record<string, unknown>
}): SceneNode {
  const normalizedType = normalizeLightNodeType(options.type)
  const light = {
    type: normalizedType,
    color: options.color,
    intensity: options.intensity,
    ...(options.extras ?? {}),
  } as any

  if (options.target) {
    light.target = deps.createVector(options.target.x, options.target.y, options.target.z)
  }

  const id = deps.generateUuid ? deps.generateUuid() : 'light-' + Math.random().toString(36).slice(2, 9)

  return {
    id,
    name: options.name,
    nodeType: 'Light',
    light,
    position: deps.createVector(options.position.x, options.position.y, options.position.z),
    rotation: options.rotation
      ? deps.createVector(options.rotation.x, options.rotation.y, options.rotation.z)
      : deps.createVector(0, 0, 0),
    scale: deps.createVector(1, 1, 1),
    visible: true,
  }
}

export function getLightPresetWithDeps(deps: Pick<LightDeps, 'createVector'>, type: LightNodeType) {
  const normalizedType = normalizeLightNodeType(type)
  switch (normalizedType) {
    case 'Directional':
      return {
        name: 'Directional Light',
        color: '#ffffff',
        intensity: 1.2,
        position: deps.createVector(15, 20, 15),
        target: deps.createVector(0, 0, 0),
        extras: { castShadow: true } as Record<string, unknown>,
      }
    case 'Point':
      return {
        name: 'Point Light',
        color: '#ffffff',
        intensity: 1,
        position: deps.createVector(0, 8, 0),
        extras: { distance: 60, decay: 2, castShadow: false } as Record<string, unknown>,
      }
    case 'Spot':
      return {
        name: 'Spot Light',
        color: '#ffffff',
        intensity: 1,
        position: deps.createVector(10, 14, 10),
        target: deps.createVector(0, 0, 0),
        extras: { angle: Math.PI / 5, penumbra: 0.35, distance: 80, decay: 2, castShadow: true } as Record<string, unknown>,
      }
    case 'Ambient':
    default:
      return {
        name: 'Ambient Light',
        color: '#ffffff',
        intensity: 0.35,
        position: deps.createVector(0, 8, 0),
        extras: {} as Record<string, unknown>,
      }
    case 'Hemisphere':
      return {
        name: 'Hemisphere Light',
        color: '#ffffff',
        intensity: 0.6,
        position: deps.createVector(0, 8, 0),
        extras: { groundColor: '#444444' } as Record<string, unknown>,
      }
    case 'RectArea':
      return {
        name: 'RectArea Light',
        color: '#ffffff',
        intensity: 3,
        position: deps.createVector(8, 10, 8),
        rotation: deps.createVector(0, Math.PI / 4, 0) as any,
        extras: { width: 10, height: 6 } as Record<string, unknown>,
      }
  }
}

export const LIGHT_TYPE_ICONS: Record<LightNodeType, string> = {
  Directional: 'mdi-white-balance-sunny',
  Point: 'mdi-lightbulb-on-outline',
  Spot: 'mdi-spotlight-beam',
  Ambient: 'mdi-weather-night',
  Hemisphere: 'mdi-weather-sunset',
  RectArea: 'mdi-rectangle-outline',
}

export const POINT_LIGHT_HELPER_SIZE = 0.5
export const DIRECTIONAL_LIGHT_HELPER_SIZE = 5
// Default helper color used when a helper-specific color is needed
export const LIGHT_HELPER_DEFAULT_COLOR = '#ffffff'
// Global debug flag for light helpers (turn on additional helper debugging/metrics)
export const LIGHT_HELPERS_DEBUG = false

export function resolveLightTypeFromObject(light: Light): LightNodeType {
  const typed = light as Light & Record<string, unknown>
  if (typed.isDirectionalLight) {
    return 'Directional'
  }
  if (typed.isSpotLight) {
    return 'Spot'
  }
  if (typed.isPointLight) {
    return 'Point'
  }
  if (typed.isRectAreaLight) {
    return 'RectArea'
  }
  if (typed.isHemisphereLight) {
    return 'Hemisphere'
  }
  return 'Ambient'
}

export default {
  createLightNodeWithDeps,
  getLightPresetWithDeps,
  resolveLightTypeFromObject,
}
