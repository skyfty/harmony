import { Vector3 } from 'three'
import type { FloorDynamicMesh, SceneNode, Vector3Like } from '@harmony/schema'
import {
  clampFloorComponentProps,
  FLOOR_DEFAULT_SIDE_UV_SCALE,
  FLOOR_DEFAULT_SMOOTH,
  FLOOR_DEFAULT_THICKNESS,
  type FloorComponentProps,
} from '@schema/components'
import type { Object3D } from 'three'
import type { SceneMaterialProps, SceneNodeMaterial } from '@/types/material'

export type SceneStoreFloorHelpersDeps = {
  createFloorNodeMaterials: (options: { topBottomName: string; sideName: string }) => SceneNodeMaterial[]
  createNodeMaterial: (
    materialId: string | null,
    props: SceneMaterialProps,
    options: { id?: string; name?: string; type?: any },
  ) => SceneNodeMaterial

  getRuntimeObject: (id: string) => Object3D | null
  updateFloorGroup: (runtime: Object3D, mesh: FloorDynamicMesh) => void
}

function buildFloorWorldPoints(points: Vector3Like[]): Vector3[] {
  const out: Vector3[] = []
  points.forEach((p) => {
    if (!p) {
      return
    }
    const x = Number(p.x)
    const z = Number(p.z)
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return
    }
    const vec = new Vector3(x, 0, z)
    const prev = out[out.length - 1]
    if (prev && prev.distanceToSquared(vec) <= 1e-10) {
      return
    }
    out.push(vec)
  })

  // Drop a closing point if it repeats the first.
  if (out.length >= 3) {
    const first = out[0]!
    const last = out[out.length - 1]!
    if (first.distanceToSquared(last) <= 1e-10) {
      out.pop()
    }
  }

  return out
}

function computeFloorCenter(points: Vector3[]): Vector3 {
  const min = new Vector3(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY)
  const max = new Vector3(Number.NEGATIVE_INFINITY, 0, Number.NEGATIVE_INFINITY)

  points.forEach((p) => {
    min.x = Math.min(min.x, p.x)
    min.z = Math.min(min.z, p.z)
    max.x = Math.max(max.x, p.x)
    max.z = Math.max(max.z, p.z)
  })

  if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) {
    return new Vector3(0, 0, 0)
  }

  return new Vector3((min.x + max.x) * 0.5, 0, (min.z + max.z) * 0.5)
}

export function createSceneStoreFloorHelpers(deps: SceneStoreFloorHelpersDeps) {
  return {
    ensureFloorMaterialConvention(node: SceneNode): { materialsChanged: boolean; meshChanged: boolean } {
      if (node.dynamicMesh?.type !== 'Floor') {
        return { materialsChanged: false, meshChanged: false }
      }

      const currentMaterials = Array.isArray(node.materials) ? node.materials : []
      let nextMaterials = currentMaterials

      if (!currentMaterials.length) {
        nextMaterials = deps.createFloorNodeMaterials({ topBottomName: 'TopBottom', sideName: 'Side' })
      } else if (currentMaterials.length === 1) {
        const first = currentMaterials[0]!
        const sideMaterial = deps.createNodeMaterial(first.materialId ?? null, first as any, {
          name: 'Side',
          type: (first as any).type,
        })
        nextMaterials = [first as any, sideMaterial]
      }

      const materialsChanged = nextMaterials !== currentMaterials
      if (materialsChanged) {
        node.materials = nextMaterials as any
      }

      const mesh = node.dynamicMesh as any
      const normalizeId = (value: unknown) => (typeof value === 'string' && value.trim().length ? value.trim() : null)
      const materialIds = (nextMaterials as any[]).map((m) => m.id)

      const topFallback = (nextMaterials as any[])[0]?.id ?? null
      const sideFallback = (nextMaterials as any[])[1]?.id ?? topFallback

      let topId = normalizeId(mesh.topBottomMaterialConfigId) ?? topFallback
      if (topId && !materialIds.includes(topId)) {
        topId = topFallback
      }
      let sideId = normalizeId(mesh.sideMaterialConfigId) ?? sideFallback ?? topId
      if (sideId && !materialIds.includes(sideId)) {
        sideId = sideFallback
      }

      const meshChanged = mesh.topBottomMaterialConfigId !== topId || mesh.sideMaterialConfigId !== sideId
      if (meshChanged) {
        node.dynamicMesh = {
          ...mesh,
          topBottomMaterialConfigId: topId,
          sideMaterialConfigId: sideId,
        }
      }

      return { materialsChanged, meshChanged }
    },

    buildFloorDynamicMeshFromWorldPoints(points: Vector3Like[]): { center: Vector3; definition: FloorDynamicMesh } | null {
      const worldPoints = buildFloorWorldPoints(points)
      if (worldPoints.length < 3) {
        return null
      }

      const center = computeFloorCenter(worldPoints)
      // Preserve world Z in local space; geometry no longer flips Z.
      const vertices = worldPoints.map((p) => [p.x - center.x, p.z - center.z] as [number, number])

      const definition: FloorDynamicMesh = {
        type: 'Floor',
        vertices,
        topBottomMaterialConfigId: null,
        sideMaterialConfigId: null,
        smooth: FLOOR_DEFAULT_SMOOTH,
        thickness: FLOOR_DEFAULT_THICKNESS,
        sideUvScale: { x: FLOOR_DEFAULT_SIDE_UV_SCALE.x, y: FLOOR_DEFAULT_SIDE_UV_SCALE.y },
      }

      return { center, definition }
    },

    applyFloorComponentPropsToNode(node: SceneNode, props: FloorComponentProps): boolean {
      if (node.dynamicMesh?.type !== 'Floor') {
        return false
      }
      const normalized = clampFloorComponentProps(props)
      const currentSmooth = Number.isFinite((node.dynamicMesh as any).smooth ?? Number.NaN)
        ? Number((node.dynamicMesh as any).smooth)
        : FLOOR_DEFAULT_SMOOTH
      const currentThickness = Number.isFinite((node.dynamicMesh as any).thickness)
        ? Number((node.dynamicMesh as any).thickness)
        : FLOOR_DEFAULT_THICKNESS
      const currentSideU = Number.isFinite((node.dynamicMesh as any).sideUvScale?.x)
        ? Number((node.dynamicMesh as any).sideUvScale.x)
        : FLOOR_DEFAULT_SIDE_UV_SCALE.x
      const currentSideV = Number.isFinite((node.dynamicMesh as any).sideUvScale?.y)
        ? Number((node.dynamicMesh as any).sideUvScale.y)
        : FLOOR_DEFAULT_SIDE_UV_SCALE.y

      const unchanged =
        Math.abs(currentSmooth - normalized.smooth) <= 1e-6 &&
        Math.abs(currentThickness - normalized.thickness) <= 1e-6 &&
        Math.abs(currentSideU - normalized.sideUvScale.x) <= 1e-6 &&
        Math.abs(currentSideV - normalized.sideUvScale.y) <= 1e-6
      if (unchanged) {
        return false
      }

      const nextMesh: FloorDynamicMesh = {
        ...(node.dynamicMesh as any),
        smooth: normalized.smooth,
        thickness: normalized.thickness,
        sideUvScale: { x: normalized.sideUvScale.x, y: normalized.sideUvScale.y },
      }
      node.dynamicMesh = nextMesh as any

      const runtime = deps.getRuntimeObject(node.id)
      if (runtime) {
        deps.updateFloorGroup(runtime, nextMesh)
      }
      return true
    },
  }
}
