import {
  cloneRootPositions,
  createHouseRigHandles,
  planBounds,
} from '../geometry'
import type {
  HouseRigCompatibility,
  HouseRigDeformPlan,
  HouseRigDeformPlanPart,
  HouseRigDimensions,
  HouseRigPartLayer,
  HouseRigRestPart,
  HouseRigRestSnapshot,
  HouseRigScript,
} from '../types'
import { basicNamingHouseRigScript } from './basic-naming'

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

function resolveRoofSurfaceYAtX(
  positions: ArrayLike<number>,
  x: number,
): number {
  let ridgeY = Number.NEGATIVE_INFINITY
  let eaveY = Number.POSITIVE_INFINITY
  let ridgeX = 0
  let eaveRadius = 0
  for (let index = 1; index < positions.length; index += 3) {
    ridgeY = Math.max(ridgeY, positions[index] ?? 0)
    eaveY = Math.min(eaveY, positions[index] ?? 0)
  }
  for (let index = 0; index < positions.length; index += 3) {
    const pointX = positions[index] ?? 0
    const pointY = positions[index + 1] ?? 0
    if (Math.abs(pointY - ridgeY) <= 1e-6) {
      ridgeX = pointX
      break
    }
  }
  for (let index = 0; index < positions.length; index += 3) {
    const pointY = positions[index + 1] ?? 0
    if (Math.abs(pointY - eaveY) <= 1e-6) {
      eaveRadius = Math.max(eaveRadius, Math.abs((positions[index] ?? 0) - ridgeX))
    }
  }
  const slope = (ridgeY - eaveY) / Math.max(1e-6, eaveRadius)
  return ridgeY - Math.abs(x - ridgeX) * slope
}

function roofNameForLayer(layer: HouseRigPartLayer | null): string | null {
  if (layer === 'inner') {
    return '墙-上-内'
  }
  if (layer === 'outer') {
    return '墙-上-外'
  }
  return null
}

function resolveRoofSinPitch(part: HouseRigRestPart): number | null {
  let ridgeY = Number.NEGATIVE_INFINITY
  let eaveY = Number.POSITIVE_INFINITY
  let ridgeX = 0
  let eaveRadius = 0
  for (let index = 1; index < part.positionsRoot.length; index += 3) {
    ridgeY = Math.max(ridgeY, part.positionsRoot[index] ?? 0)
    eaveY = Math.min(eaveY, part.positionsRoot[index] ?? 0)
  }
  for (let index = 0; index < part.positionsRoot.length; index += 3) {
    if (Math.abs((part.positionsRoot[index + 1] ?? 0) - ridgeY) <= 1e-6) {
      ridgeX = part.positionsRoot[index] ?? 0
      break
    }
  }
  for (let index = 0; index < part.positionsRoot.length; index += 3) {
    if (Math.abs((part.positionsRoot[index + 1] ?? 0) - eaveY) <= 1e-6) {
      eaveRadius = Math.max(
        eaveRadius,
        Math.abs((part.positionsRoot[index] ?? 0) - ridgeX),
      )
    }
  }
  const rise = ridgeY - eaveY
  if (!(rise > 1e-6) || !(eaveRadius > 1e-6)) {
    return null
  }
  return rise / Math.hypot(rise, eaveRadius)
}

function projectMetricUvs(
  rest: HouseRigRestSnapshot,
  part: HouseRigRestPart,
  positions: ArrayLike<number>,
): Float32Array | null {
  if (part.role === 'unknown') {
    return null
  }
  const result = new Float32Array(part.vertexCount * 2)
  const originX = rest.bounds.min.x
  const originY = rest.bounds.min.y
  const originZ = rest.bounds.min.z
  const roofSinPitch = part.role === 'roof' ? resolveRoofSinPitch(part) : null
  let currentEaveY = Number.POSITIVE_INFINITY
  if (part.role === 'roof') {
    if (!roofSinPitch) {
      return null
    }
    for (let index = 1; index < positions.length; index += 3) {
      currentEaveY = Math.min(currentEaveY, positions[index] ?? 0)
    }
  }

  for (let index = 0; index < part.vertexCount; index += 1) {
    const x = positions[index * 3] ?? 0
    const y = positions[index * 3 + 1] ?? 0
    const z = positions[index * 3 + 2] ?? 0
    let u = 0
    let v = 0
    if (part.role === 'roof') {
      u = z - originZ
      v = (y - currentEaveY) / (roofSinPitch ?? 1)
    } else if (part.role === 'floor' || part.role === 'foundation') {
      u = x - originX
      v = z - originZ
    } else if (part.side === 'front' || part.side === 'back') {
      u = z - originZ
      v = y - originY
    } else if (part.side === 'left' || part.side === 'right') {
      u = x - originX
      v = y - originY
    } else {
      return null
    }
    result[index * 2] = u
    result[index * 2 + 1] = v
  }
  return result
}

function buildAspectCorrectPlan(
  rest: HouseRigRestSnapshot,
  dimensions: HouseRigDimensions,
  options: { metricUvs: boolean },
): HouseRigDeformPlan {
  const widthScale = dimensions.width / Math.max(1e-6, rest.dimensions.width)
  const depthScale = dimensions.depth / Math.max(1e-6, rest.dimensions.depth)
  const heightScale = dimensions.wallHeight / Math.max(1e-6, rest.dimensions.wallHeight)
  const heightDelta = dimensions.wallHeight - rest.dimensions.wallHeight
  const baseY = rest.bounds.min.y
  const restRoofs = new Map(
    rest.parts
      .filter((part) => part.role === 'roof')
      .map((part) => [part.meshName, part]),
  )
  const plannedPositions = new Map<string, Float32Array>()
  const warnings = [...rest.warnings]
  const parts: HouseRigDeformPlanPart[] = rest.parts.map((part) => {
    const positions = cloneRootPositions(part)
    scaleCoordinate(positions, 0, rest.bounds.center.x, widthScale)
    scaleCoordinate(positions, 2, rest.bounds.center.z, depthScale)

    if (part.role === 'roof') {
      const eaveY = part.bounds.min.y
      for (let index = 1; index < positions.length; index += 3) {
        const restY = part.positionsRoot[index] ?? 0
        positions[index] = eaveY
          + heightDelta
          + (restY - eaveY) * widthScale
      }
    } else if (part.role === 'floor' || part.role === 'foundation') {
      // Footprint scaling already applied.
    } else if (
      part.role === 'door'
      || part.role === 'window'
      || part.role === 'trim'
      || part.role === 'decoration'
    ) {
      scaleWallHeight(positions, baseY, heightScale)
    }

    plannedPositions.set(part.meshName, positions)
    return {
      key: part.key,
      positionsRoot: positions,
      uvs: part.uvs,
    }
  })

  rest.parts
    .filter((part) => part.role === 'wall')
    .forEach((wall) => {
      const planned = plannedPositions.get(wall.meshName)
      const roofName = roofNameForLayer(wall.layer)
      const restRoof = roofName ? restRoofs.get(roofName) ?? null : null
      const plannedRoof = roofName ? plannedPositions.get(roofName) ?? null : null
      if (!planned || !restRoof || !plannedRoof) {
        return
      }
      const wallBaseY = wall.bounds.min.y
      const wallHeight = Math.max(1e-6, wall.bounds.max.y - wallBaseY)
      const topTolerance = Math.max(1e-4, wallHeight * 1e-3)
      for (let index = 1; index < planned.length; index += 3) {
        const restY = wall.positionsRoot[index] ?? 0
        if (restY <= wallBaseY + topTolerance) {
          continue
        }
        const restX = wall.positionsRoot[index - 1] ?? 0
        const plannedX = planned[index - 1] ?? 0
        const restGap = resolveRoofSurfaceYAtX(restRoof.positionsRoot, restX) - restY
        planned[index] = resolveRoofSurfaceYAtX(plannedRoof, plannedX) - restGap
      }
    })

  if (options.metricUvs) {
    parts.forEach((plannedPart) => {
      const source = rest.parts.find((part) => part.key === plannedPart.key)
      if (!source) {
        return
      }
      const metricUvs = projectMetricUvs(rest, source, plannedPart.positionsRoot)
      if (metricUvs) {
        plannedPart.uvs = metricUvs
        plannedPart.uvMetersPerUnit = { x: 1, y: 1 }
      } else if (source.role !== 'unknown') {
        warnings.push(`Could not generate metric UVs for ${source.meshName}; retaining source UVs`)
      }
    })
  }

  const bounds = planBounds(parts)
  return {
    parts,
    handles: createHouseRigHandles(bounds, 0.18),
    bounds,
    warnings: Array.from(new Set(warnings)),
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

export const currentTenPartHouseRigScriptV1_0_1: HouseRigScript = {
  id: 'current-ten-part-house',
  label: 'Current Ten-Part House',
  version: '1.0.1',
  description: 'Ten-plane house deformation with aspect-correct roof pitch and attached wall tops.',
  requiredParts: REQUIRED_NAMES,
  getCompatibility,
  buildPlan(rest, dimensions) {
    return buildAspectCorrectPlan(rest, dimensions, { metricUvs: false })
  },
}

export const currentTenPartHouseRigScriptV1_0_2: HouseRigScript = {
  id: 'current-ten-part-house',
  label: 'Current Ten-Part House',
  version: '1.0.2',
  description: 'Ten-plane house deformation with aspect-correct geometry and metric UVs.',
  requiredParts: REQUIRED_NAMES,
  getCompatibility,
  buildPlan(rest, dimensions) {
    return buildAspectCorrectPlan(rest, dimensions, { metricUvs: true })
  },
}
