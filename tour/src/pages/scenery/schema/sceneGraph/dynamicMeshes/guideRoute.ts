import * as THREE from 'three'
import type { GuideRouteDynamicMesh, SceneNodeMaterial } from '../../index'
import type { SceneNodeWithExtras } from '../types'
import { createGuideRouteRenderGroup } from '../../guideRouteMesh'
import { applyMaterialConfigAssignment, buildMaterialConfigMap } from '../materialAssignment'

export async function buildGuideRouteMesh(
  deps: {
    resolveNodeMaterials: (node: SceneNodeWithExtras) => Promise<THREE.Material[]>
    pickMaterialAssignment: (materials: THREE.Material[]) => THREE.Material | THREE.Material[] | null
    applyTransform: (object: THREE.Object3D, node: SceneNodeWithExtras) => void
    applyVisibility: (object: THREE.Object3D, node: SceneNodeWithExtras) => void
  },
  meshInfo: GuideRouteDynamicMesh,
  node: SceneNodeWithExtras,
): Promise<THREE.Object3D | null> {
  const group = createGuideRouteRenderGroup(meshInfo, {})
  group.name = node.name ?? (group.name || 'GuideRoute')

  const nodeMaterialConfigs = Array.isArray(node.materials) ? (node.materials as SceneNodeMaterial[]) : []
  const resolvedMaterials = await deps.resolveNodeMaterials(node)
  const defaultMaterialAssignment = deps.pickMaterialAssignment(resolvedMaterials)

  if (defaultMaterialAssignment) {
    const materialByConfigId = buildMaterialConfigMap(nodeMaterialConfigs, resolvedMaterials)
    applyMaterialConfigAssignment(group, {
      defaultMaterial: defaultMaterialAssignment,
      materialByConfigId,
    })
  }

  deps.applyTransform(group, node)
  deps.applyVisibility(group, node)
  return group
}
