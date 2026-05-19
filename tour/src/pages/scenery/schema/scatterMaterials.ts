import type { Material, Object3D } from 'three'

export interface ScatterMaterialNormalizationOptions {
  /** Cutout threshold for alpha-masked foliage. Typical values: 0.3–0.7 */
  alphaTest?: number
}

function normalizeMaterialForScatterCutout(material: Material, options?: ScatterMaterialNormalizationOptions): boolean {
  const anyMat = material as any
  if (anyMat.userData?.__scatterCutoutApplied) {
    return false
  }

  // Heuristic:
  // - Instanced scatter vegetation often comes in as alpha-blended (transparent=true).
  // - Three.js disables depthWrite for transparent materials, which breaks occlusion between rows.
  // - Converting to alpha-test (cutout) restores correct depth behavior and works well with InstancedMesh.
  const isTransparent = Boolean(anyMat.transparent)
  const opacity = typeof anyMat.opacity === 'number' ? anyMat.opacity : 1
  const hasAlphaMap = Boolean(anyMat.alphaMap)
  const hasTextureMap = Boolean(anyMat.map)
  const hasAlphaTest = typeof anyMat.alphaTest === 'number' && anyMat.alphaTest > 0

  // Only touch materials that are clearly alpha-blended and not intentionally semi-transparent.
  if (!isTransparent) return false
  if (opacity < 0.98) return false
  if (hasAlphaTest) return false
  if (!hasAlphaMap && !hasTextureMap) return false

  anyMat.transparent = false
  anyMat.depthWrite = true
  anyMat.depthTest = true
  anyMat.alphaTest = typeof options?.alphaTest === 'number' ? options.alphaTest : 0.5

  anyMat.userData = anyMat.userData ?? {}
  anyMat.userData.__scatterCutoutApplied = true

  material.needsUpdate = true
  return true
}

function normalizeMaterialSlot(slot: Material | Material[] | null | undefined, options?: ScatterMaterialNormalizationOptions): boolean {
  if (!slot) return false
  if (Array.isArray(slot)) {
    let changed = false
    for (const mat of slot) {
      if (mat) changed = normalizeMaterialForScatterCutout(mat, options) || changed
    }
    return changed
  }
  return normalizeMaterialForScatterCutout(slot, options)
}

export function normalizeScatterMaterials(root: Object3D, options?: ScatterMaterialNormalizationOptions): boolean {
  if (!root) return false
  let changed = false
  root.traverse((child: any) => {
    if (!child) return
    // Mesh / SkinnedMesh
    if (child.isMesh || child.isSkinnedMesh) {
      changed = normalizeMaterialSlot(child.material, options) || changed
    }
  })
  return changed
}
