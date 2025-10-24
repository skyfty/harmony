import type { Vector3Like } from './scene'

export type LightNodeType = 'Directional' | 'Point' | 'Spot' | 'Ambient'

export const LEGACY_LIGHT_TYPE_MAP: Record<string, LightNodeType> = {
  directional: 'Directional',
  point: 'Point',
  spot: 'Spot',
  ambient: 'Ambient',
}

export function normalizeLightNodeType(input: LightNodeType | string | null | undefined): LightNodeType {
  if (!input) {
    return 'Directional'
  }
  if (typeof input === 'string') {
    const legacy = LEGACY_LIGHT_TYPE_MAP[input]
    if (legacy) {
      return legacy
    }
    return input as LightNodeType
  }
  return input
}

export interface LightNodeProperties {
  type: LightNodeType
  color: string
  intensity: number
  distance?: number
  angle?: number
  decay?: number
  penumbra?: number
  target?: Vector3Like
  castShadow?: boolean
}
