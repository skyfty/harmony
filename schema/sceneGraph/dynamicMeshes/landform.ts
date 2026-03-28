import * as THREE from 'three'
import type { LandformDynamicMesh, SceneNodeMaterial } from '../../index'
import type { SceneNodeWithExtras } from '../types'
import { createLandformRenderGroup, applyLandformFeatherMaterial } from '../../landformMesh'
import { createAutoTiledMaterialVariant, MATERIAL_CONFIG_ID_KEY } from '../../material'
import { buildMaterialConfigMap } from '../materialAssignment'

function applyLandformMaterialConfigAssignment(
  root: THREE.Object3D,
  options: {
    defaultMaterial: THREE.Material | THREE.Material[]
    materialByConfigId: Map<string, THREE.Material>
  },
): void {
  const variantCache = new Map<string, THREE.Material | THREE.Material[]>()

  const resolveAssignedMaterial = (source: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] => {
    const materialKey = Array.isArray(source)
      ? source.map((entry) => entry.uuid).join(',')
      : source.uuid
    const cached = variantCache.get(materialKey)
    if (cached) {
      return cached
    }
    const variant = createAutoTiledMaterialVariant(source, null)
    const assigned = variant.shared ? source : variant.material
    variantCache.set(materialKey, assigned)
    return assigned
  }

  root.traverse((child) => {
    const mesh = child as THREE.Mesh & { isMesh?: boolean }
    if (!mesh?.isMesh) {
      return
    }
    const selectorRaw = mesh.userData?.[MATERIAL_CONFIG_ID_KEY] as unknown
    const selectorId = typeof selectorRaw === 'string' ? selectorRaw.trim() : ''
    const assigned = selectorId && options.materialByConfigId.has(selectorId)
      ? resolveAssignedMaterial(options.materialByConfigId.get(selectorId)!)
      : resolveAssignedMaterial(options.defaultMaterial)

    if (Array.isArray(assigned)) {
      mesh.material = assigned.map((entry) => applyLandformFeatherMaterial(entry) ?? entry)
    } else {
      mesh.material = applyLandformFeatherMaterial(assigned) ?? assigned
    }
  })
}

export async function buildLandformMesh(
  deps: {
    resolveNodeMaterials: (node: SceneNodeWithExtras) => Promise<THREE.Material[]>
    pickMaterialAssignment: (materials: THREE.Material[]) => THREE.Material | THREE.Material[] | null
    applyTransform: (object: THREE.Object3D, node: SceneNodeWithExtras) => void
    applyVisibility: (object: THREE.Object3D, node: SceneNodeWithExtras) => void
  },
  meshInfo: LandformDynamicMesh,
  node: SceneNodeWithExtras,
): Promise<THREE.Object3D | null> {
  const group = createLandformRenderGroup(meshInfo)
  group.name = node.name ?? (group.name || 'Landform')

  const nodeMaterialConfigs = Array.isArray(node.materials) ? (node.materials as SceneNodeMaterial[]) : []
  const resolvedMaterials = await deps.resolveNodeMaterials(node)
  const defaultMaterialAssignment = deps.pickMaterialAssignment(resolvedMaterials)
  if (defaultMaterialAssignment) {
    const materialByConfigId = buildMaterialConfigMap(nodeMaterialConfigs, resolvedMaterials)
    applyLandformMaterialConfigAssignment(group, {
      defaultMaterial: defaultMaterialAssignment,
      materialByConfigId,
    })
  }

  deps.applyTransform(group, node)
  deps.applyVisibility(group, node)
  return group
}