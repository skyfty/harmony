import  {type LightNodeType } from '@harmony/schema'

const LEGACY_LIGHT_TYPE_MAP: Record<string, LightNodeType> = {
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
