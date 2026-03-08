import type { SceneNode, SceneMaterialProps, SceneNodeMaterial } from '@schema'

export type SceneStoreWallHelpersDeps = {
  createWallNodeMaterials: (options: { bodyName: string }) => SceneNodeMaterial[]
  createNodeMaterial: (
    materialId: string | null,
    props: SceneMaterialProps,
    options: { id?: string; name?: string; type?: any },
  ) => SceneNodeMaterial
}

export function createSceneStoreWallHelpers(deps: SceneStoreWallHelpersDeps) {
  return {
    ensureWallMaterialConvention(node: SceneNode): { materialsChanged: boolean; meshChanged: boolean } {
      if (node.dynamicMesh?.type !== 'Wall') {
        return { materialsChanged: false, meshChanged: false }
      }

      const currentMaterials = Array.isArray(node.materials) ? node.materials : []
      let nextMaterials = currentMaterials

      if (!currentMaterials.length) {
        nextMaterials = deps.createWallNodeMaterials({ bodyName: 'Body' })
      }

      const materialsChanged = nextMaterials !== currentMaterials
      if (materialsChanged) {
        node.materials = nextMaterials as any
      }

      const mesh = node.dynamicMesh as any
      const normalizeId = (value: unknown) => (typeof value === 'string' && value.trim().length ? value.trim() : null)
      const materialIds = (nextMaterials as any[]).map((entry) => entry.id)
      const fallbackBodyId = (nextMaterials as any[])[0]?.id ?? null

      let bodyMaterialConfigId = normalizeId(mesh.bodyMaterialConfigId) ?? fallbackBodyId
      if (bodyMaterialConfigId && !materialIds.includes(bodyMaterialConfigId)) {
        bodyMaterialConfigId = fallbackBodyId
      }

      const meshChanged = mesh.bodyMaterialConfigId !== bodyMaterialConfigId
      if (meshChanged) {
        node.dynamicMesh = {
          ...mesh,
          bodyMaterialConfigId,
        }
      }

      return { materialsChanged, meshChanged }
    },
  }
}