import type { SceneNode } from '@schema'
import { WATER_COMPONENT_TYPE } from '@schema/components'
import type { WaterBuildShape } from '@/types/water-build-shape'

export const WATER_SURFACE_USERDATA_KEY = '__harmonyWaterSurface'

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isWaterBuildShape(value: unknown): value is WaterBuildShape {
  return value === 'polygon' || value === 'rectangle' || value === 'circle'
}

export function mergeUserDataWithWaterBuildShape(
  userData: SceneNode['userData'] | undefined,
  buildShape: WaterBuildShape,
): Record<string, unknown> {
  const base = isPlainRecord(userData) ? userData : {}
  const previous = isPlainRecord(base[WATER_SURFACE_USERDATA_KEY]) ? base[WATER_SURFACE_USERDATA_KEY] : {}
  return {
    ...base,
    [WATER_SURFACE_USERDATA_KEY]: {
      ...previous,
      kind: 'water-surface',
      buildShape,
    },
  }
}

export function readWaterBuildShapeFromNode(node: SceneNode | null | undefined): WaterBuildShape | null {
  const raw = isPlainRecord(node?.userData)
    ? node?.userData?.[WATER_SURFACE_USERDATA_KEY]
    : null
  if (!isPlainRecord(raw)) {
    return null
  }
  return isWaterBuildShape(raw.buildShape) ? raw.buildShape : null
}

export function isWaterSurfaceNode(node: SceneNode | null | undefined): boolean {
  if (!node || node.nodeType !== 'Plane') {
    return false
  }
  return Boolean(node.components?.[WATER_COMPONENT_TYPE])
}

export function resolveWaterRectangleBounds(node: SceneNode | null | undefined): {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  y: number
  width: number
  depth: number
} | null {
  if (!isWaterSurfaceNode(node)) {
    return null
  }

  const target = node as SceneNode

  const width = Math.abs(Number(target.scale?.x ?? 1))
  const depth = Math.abs(Number(target.scale?.y ?? 1))
  if (!Number.isFinite(width) || !Number.isFinite(depth) || width <= 1e-6 || depth <= 1e-6) {
    return null
  }

  const centerX = Number(target.position?.x ?? 0)
  const centerZ = Number(target.position?.z ?? 0)
  const y = Number(target.position?.y ?? 0)

  return {
    minX: centerX - width * 0.5,
    maxX: centerX + width * 0.5,
    minZ: centerZ - depth * 0.5,
    maxZ: centerZ + depth * 0.5,
    y,
    width,
    depth,
  }
}
