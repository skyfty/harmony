/**
 * Editor-internal helper meshes (instanced pick proxies, selection outlines,
 * instance-layout helpers) live inside a scene node's runtime subtree but are
 * never part of the visible model. They must therefore never be used as the
 * source of a node material seed or an override target.
 *
 * Name fragments mirror `INSTANCE_LAYOUT_INTERNAL_NAME_PARTS` in
 * `SceneViewport.vue` / `prefabPreviewBuilder.ts`;
 * `instancedPickProxy`/`excludeFromOutline` are set by `PickProxyManager.ts`.
 */
export const EDITOR_INTERNAL_MESH_NAME_PARTS = ['PickProxy', 'Outline', 'InstancedOutline'] as const

type MaterialLike = {
  colorWrite?: unknown
  transparent?: unknown
  opacity?: unknown
}

type ObjectLike = {
  name?: unknown
  userData?: unknown
  material?: unknown
  visible?: unknown
}

function firstMaterialOf(object: ObjectLike): MaterialLike | null {
  const material = object.material
  if (!material) {
    return null
  }
  if (Array.isArray(material)) {
    return (material[0] ?? null) as MaterialLike | null
  }
  return typeof material === 'object' ? (material as MaterialLike) : null
}

/**
 * A material that can never be the visible surface of a model: the pick proxy
 * uses `opacity: 0` + `colorWrite: false`, so anything matching this is a helper
 * (or a fully hidden surface, which is equally useless as a material seed).
 */
export function isEffectivelyInvisibleMaterial(material: MaterialLike | null | undefined): boolean {
  if (!material) {
    return false
  }
  if (material.colorWrite === false) {
    return true
  }
  return material.transparent === true
    && typeof material.opacity === 'number'
    && material.opacity <= 0.0001
}

export function isEditorInternalMesh(object: ObjectLike | null | undefined): boolean {
  if (!object) {
    return false
  }
  const userData = (object.userData ?? null) as Record<string, unknown> | null
  if (userData) {
    if (
      userData.instancedPickProxy === true
      || userData.excludeFromOutline === true
      || userData.editorOnly === true
      || userData.instancedPickProxyBounds !== undefined
    ) {
      return true
    }
  }
  const name = typeof object.name === 'string' ? object.name : ''
  if (name.length && EDITOR_INTERNAL_MESH_NAME_PARTS.some((part) => name.includes(part))) {
    return true
  }
  return isEffectivelyInvisibleMaterial(firstMaterialOf(object))
}
