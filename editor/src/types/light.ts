import  {type LightNodeType, LEGACY_LIGHT_TYPE_MAP } from '@harmony/schema'

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
