import { basicNamingHouseRigScript } from '../basic-naming/v1_0_0'
import type { HouseRigCompatibility, HouseRigScript } from '../../types'

const REQUIRED_NAMES = [
  '墙-前-内',
  '墙-前-外',
  '墙-后-内',
  '墙-后-外',
  '墙-左-内',
  '墙-左-外',
  '墙-右-内',
  '墙-右-外',
  '墙-上-内',
  '墙-上-外',
]

function getCompatibility(asset: Parameters<HouseRigScript['getCompatibility']>[0]): HouseRigCompatibility {
  const names = new Set(asset.parts.map((part) => part.meshName))
  const missing = REQUIRED_NAMES.filter((name) => !names.has(name))
  const base = basicNamingHouseRigScript.getCompatibility(asset)
  return {
    compatible: missing.length === 0 && base.compatible,
    issues: [
      ...missing.map((name) => `Missing ten-part fixture mesh: ${name}`),
      ...base.issues,
    ],
  }
}

export const currentTenPartHouseRigScript: HouseRigScript = {
  id: 'current-ten-part-house',
  label: 'Current Ten-Part House',
  version: '1.0.0',
  description: 'Pinned deformation profile for the current ten-plane Blender house fixture.',
  requiredParts: REQUIRED_NAMES,
  getCompatibility,
  buildPlan(rest, dimensions) {
    return basicNamingHouseRigScript.buildPlan(rest, dimensions)
  },
}
