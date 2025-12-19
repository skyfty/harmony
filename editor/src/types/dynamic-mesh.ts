import  {type DynamicMeshType } from '@harmony/schema'


const LEGACY_DYNAMIC_MESH_TYPE_MAP: Record<string, DynamicMeshType> = {
  ground: 'Ground',
  wall: 'Wall',
  road: 'Road',
}

export function normalizeDynamicMeshType(input: DynamicMeshType | string | null | undefined): DynamicMeshType {
  if (!input) {
    return 'Ground'
  }
  if (typeof input === 'string') {
    const legacy = LEGACY_DYNAMIC_MESH_TYPE_MAP[input]
    if (legacy) {
      return legacy
    }
    return input as DynamicMeshType
  }
  return input
}
