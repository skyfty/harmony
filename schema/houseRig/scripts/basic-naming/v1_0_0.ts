import {
  cloneRootPositions,
  createHouseRigHandles,
  planBounds,
} from '../../geometry'
import type {
  HouseRigCompatibility,
  HouseRigDeformPlan,
  HouseRigDeformPlanPart,
  HouseRigDimensions,
  HouseRigRestSnapshot,
  HouseRigScript,
} from '../../types'

function scaleCoordinate(
  positions: Float32Array,
  axis: 0 | 1 | 2,
  pivot: number,
  scale: number,
): void {
  for (let index = axis; index < positions.length; index += 3) {
    positions[index] = pivot + ((positions[index] ?? 0) - pivot) * scale
  }
}

function scaleWallHeight(
  positions: Float32Array,
  baseY: number,
  scale: number,
): void {
  for (let index = 1; index < positions.length; index += 3) {
    positions[index] = baseY + ((positions[index] ?? 0) - baseY) * scale
  }
}

function translateWallTops(
  positions: Float32Array,
  baseY: number,
  heightDelta: number,
  bottomTolerance: number,
): void {
  for (let index = 1; index < positions.length; index += 3) {
    const y = positions[index] ?? 0
    if (y > baseY + bottomTolerance) {
      positions[index] = y + heightDelta
    }
  }
}

function compatibility(parts: Parameters<HouseRigScript['getCompatibility']>[0]['parts']): HouseRigCompatibility {
  const issues: string[] = []
  if (!parts.some((part) => part.role === 'wall')) {
    issues.push('No wall part was recognized')
  }
  if (!parts.some((part) => part.role === 'roof')) {
    issues.push('No roof part was recognized')
  }
  const unknown = parts.filter((part) => part.role === 'unknown')
  if (unknown.length) {
    issues.push(`Unclassified parts will remain rigid: ${unknown.map((part) => part.meshName).join(', ')}`)
  }
  return {
    compatible: parts.some((part) => part.role === 'wall' || part.role === 'roof'),
    issues,
  }
}

export const basicNamingHouseRigScript: HouseRigScript = {
  id: 'basic-naming',
  label: 'Basic Naming Rig',
  version: '1.0.0',
  description: 'Name-driven wall and roof deformation for standard exterior-shell white models.',
  requiredParts: ['wall-*', 'roof-*'],
  getCompatibility(asset) {
    return compatibility(asset.parts)
  },
  buildPlan(rest, dimensions) {
    const widthScale = dimensions.width / Math.max(1e-6, rest.dimensions.width)
    const depthScale = dimensions.depth / Math.max(1e-6, rest.dimensions.depth)
    const heightScale = dimensions.wallHeight / Math.max(1e-6, rest.dimensions.wallHeight)
    const heightDelta = dimensions.wallHeight - rest.dimensions.wallHeight
    const baseY = rest.bounds.min.y
    const warnings = [...rest.warnings]
    const parts: HouseRigDeformPlanPart[] = rest.parts.map((part) => {
      const positions = cloneRootPositions(part)

      // Every part shares the same footprint mapping. Applying different
      // translations to normal-facing walls than to tangent walls opens the
      // corner seams, especially after large expansions.
      scaleCoordinate(positions, 0, rest.bounds.center.x, widthScale)
      scaleCoordinate(positions, 2, rest.bounds.center.z, depthScale)

      if (part.role === 'roof') {
        for (let index = 1; index < positions.length; index += 3) {
          positions[index] = (positions[index] ?? 0) + heightDelta
        }
      } else if (part.role === 'wall') {
        // The roof stays rigid and translates by heightDelta. Wall vertices above
        // the foundation must receive the exact same vertical delta, otherwise
        // the eave and gable contact edges drift away from the roof as it grows.
        const wallBaseY = part.bounds.min.y
        const wallHeight = Math.max(1e-6, part.bounds.max.y - wallBaseY)
        translateWallTops(
          positions,
          wallBaseY,
          heightDelta,
          Math.max(1e-4, wallHeight * 1e-3),
        )
      } else if (part.role === 'floor' || part.role === 'foundation') {
        // Footprint scaling already ran above.
      } else if (
        part.role === 'door'
        || part.role === 'window'
        || part.role === 'trim'
        || part.role === 'decoration'
      ) {
        scaleWallHeight(positions, baseY, heightScale)
      }

      return {
        key: part.key,
        positionsRoot: positions,
        uvs: part.uvs,
      }
    })
    const bounds = planBounds(parts)
    return {
      parts,
      handles: createHouseRigHandles(bounds, 0.18),
      bounds,
      warnings: Array.from(new Set(warnings)),
    }
  },
}

export function buildBasicNamingPlan(
  rest: HouseRigRestSnapshot,
  dimensions: HouseRigDimensions,
): HouseRigDeformPlan {
  return basicNamingHouseRigScript.buildPlan(rest, dimensions)
}
