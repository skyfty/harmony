export type GroundCollisionVehicleOwnerParams = {
  activeVehicleNodeId: string | null | undefined
  autoTourNodeIds: Iterable<string>
  pendingDefaultVehicleNodeId: string | null | undefined
  vehicleNodeIds: Iterable<string>
}

function normalizeNodeId(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || null
}

/**
 * Resolves the single vehicle that owns the near-field procedural ground patch.
 * Ambiguous multi-vehicle scenes return null so the regular ground fallback stays active.
 */
export function resolveGroundCollisionVehicleOwnerNodeId(
  params: GroundCollisionVehicleOwnerParams,
): string | null {
  const vehicleNodeIds = new Set(
    Array.from(params.vehicleNodeIds, normalizeNodeId).filter((value): value is string => Boolean(value)),
  )
  const activeVehicleNodeId = normalizeNodeId(params.activeVehicleNodeId)
  if (activeVehicleNodeId && vehicleNodeIds.has(activeVehicleNodeId)) {
    return activeVehicleNodeId
  }
  for (const nodeId of params.autoTourNodeIds) {
    const normalizedNodeId = normalizeNodeId(nodeId)
    if (normalizedNodeId && vehicleNodeIds.has(normalizedNodeId)) {
      return normalizedNodeId
    }
  }
  const pendingDefaultVehicleNodeId = normalizeNodeId(params.pendingDefaultVehicleNodeId)
  if (pendingDefaultVehicleNodeId && vehicleNodeIds.has(pendingDefaultVehicleNodeId)) {
    return pendingDefaultVehicleNodeId
  }
  return vehicleNodeIds.size === 1 ? vehicleNodeIds.values().next().value ?? null : null
}
