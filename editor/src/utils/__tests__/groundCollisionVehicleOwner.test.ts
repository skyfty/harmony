import { describe, expect, it } from 'vitest'

import { resolveGroundCollisionVehicleOwnerNodeId } from '@/utils/groundCollisionVehicleOwner'

describe('ground collision vehicle owner', () => {
  it('prefers the actively driven vehicle', () => {
    expect(resolveGroundCollisionVehicleOwnerNodeId({
      activeVehicleNodeId: 'vehicle-active',
      autoTourNodeIds: ['vehicle-tour'],
      pendingDefaultVehicleNodeId: 'vehicle-default',
      vehicleNodeIds: ['vehicle-active', 'vehicle-tour', 'vehicle-default'],
    })).toBe('vehicle-active')
  })

  it('falls back through Auto Tour, pending default, and the sole vehicle', () => {
    expect(resolveGroundCollisionVehicleOwnerNodeId({
      activeVehicleNodeId: null,
      autoTourNodeIds: ['character-tour', 'vehicle-tour'],
      pendingDefaultVehicleNodeId: 'vehicle-default',
      vehicleNodeIds: ['vehicle-tour', 'vehicle-default'],
    })).toBe('vehicle-tour')

    expect(resolveGroundCollisionVehicleOwnerNodeId({
      activeVehicleNodeId: null,
      autoTourNodeIds: [],
      pendingDefaultVehicleNodeId: 'vehicle-default',
      vehicleNodeIds: ['vehicle-default', 'vehicle-other'],
    })).toBe('vehicle-default')

    expect(resolveGroundCollisionVehicleOwnerNodeId({
      activeVehicleNodeId: null,
      autoTourNodeIds: [],
      pendingDefaultVehicleNodeId: null,
      vehicleNodeIds: ['vehicle-only'],
    })).toBe('vehicle-only')
  })

  it('does not guess when multiple vehicles are inactive and no default owner exists', () => {
    expect(resolveGroundCollisionVehicleOwnerNodeId({
      activeVehicleNodeId: null,
      autoTourNodeIds: ['character-tour'],
      pendingDefaultVehicleNodeId: null,
      vehicleNodeIds: ['vehicle-a', 'vehicle-b'],
    })).toBeNull()
  })
})
