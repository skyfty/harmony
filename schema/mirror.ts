/**
 * Clone geometry for mirrored instance (for InstancedMesh).
 * Returns a new BufferGeometry with tangent.w flipped if present.
 */
export function cloneGeometryForMirroredInstance(geometry: THREE.BufferGeometry, mirror?: MirrorMode): THREE.BufferGeometry {
  const cloned = geometry.clone()
  // Flip tangent.w if present
  const tang = cloned.attributes && (cloned.attributes as any).tangent
  if (tang && tang.itemSize === 4) {
    const arr = tang.array as any
    for (let i = 3; i < arr.length; i += 4) {
      arr[i] = -arr[i]
    }
    tang.needsUpdate = true
  }
  // Optionally: flip normals if needed (not usually required for mirror)
  return cloned
}
import * as THREE from 'three'

export type MirrorMode = 'horizontal' | 'vertical' | null | undefined

export function isMirroredMode(value: unknown): value is 'horizontal' | 'vertical' {
  return value === 'horizontal' || value === 'vertical'
}

export function applyMirroredScaleToObject(
  object: THREE.Object3D,
  baseScale?: { x: number; y: number; z: number } | null,
  mirror?: MirrorMode,
): void {
  const baseX = typeof baseScale?.x === 'number' ? baseScale.x : 1
  const baseY = typeof baseScale?.y === 'number' ? baseScale.y : 1
  const baseZ = typeof baseScale?.z === 'number' ? baseScale.z : 1

  let scaleX = Math.abs(baseX)
  let scaleY = Math.abs(baseY)
  const scaleZ = Math.abs(baseZ)

  if (mirror === 'horizontal') {
    scaleX *= -1
  } else if (mirror === 'vertical') {
    scaleY *= -1
  }

  object.scale.set(scaleX, scaleY, scaleZ)
}

type MirrorMaterialState = {
  original: THREE.Material | THREE.Material[]
  mirrored: THREE.Material | THREE.Material[]
}

const MIRROR_MATERIAL_STATE_KEY = '__harmonyMirrorMaterialState'

function cloneMaterial(material: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
  if (Array.isArray(material)) {
    return material.map((entry) => entry.clone())
  }
  return material.clone()
}

function mirroredSideFor(side: THREE.Side): THREE.Side {
  if (side === THREE.FrontSide) {
    return THREE.BackSide as THREE.Side
  }
  if (side === THREE.BackSide) {
    return THREE.FrontSide as THREE.Side
  }
  return THREE.DoubleSide as THREE.Side
}

function syncMirroredMaterialSide(
  original: THREE.Material | THREE.Material[],
  mirrored: THREE.Material | THREE.Material[],
): void {
  if (Array.isArray(original) && Array.isArray(mirrored)) {
    const len = Math.min(original.length, mirrored.length)
    for (let i = 0; i < len; i += 1) {
      const src = original[i]
      const dst = mirrored[i]
      if (src == null || dst == null) {
        continue
      }
      const nextSide = mirroredSideFor(src.side)
      if (dst.side !== nextSide) {
        ;(dst.side as any) = nextSide
        dst.needsUpdate = true
      }
    }
    return
  }

  const src = Array.isArray(original) ? original[0] : original
  const dst = Array.isArray(mirrored) ? mirrored[0] : mirrored
  if (src == null || dst == null) {
    return
  }
  const nextSide = mirroredSideFor(src.side)
  if (dst.side !== nextSide) {
    ;(dst.side as any) = nextSide
    dst.needsUpdate = true
  }
}

export const MIRROR_TANGENTS_FLAG = '__harmonyMirrorTangentsFlipped'

function flipTangentWOnGeometryIfNeeded(geometry: THREE.BufferGeometry): boolean {
  const tang = geometry.attributes && (geometry.attributes as any).tangent
  if (!tang || !(tang.itemSize === 4)) {
    return false
  }
  const arr = tang.array as any
  // w is the 4th component of tangent (index 3,7,11...)
  for (let i = 3; i < arr.length; i += 4) {
    arr[i] = -arr[i]
  }
  tang.needsUpdate = true
  return true
}

function adjustMaterialNormalScales(material: THREE.Material | THREE.Material[] | null | undefined, mirror?: MirrorMode): void {
  if (!material) return
  const applyToMat = (m: any) => {
    if (!m) return
    try {
      if (mirror === 'horizontal') {
        if (m.normalScale) m.normalScale.x = -m.normalScale.x
        if (m.clearcoatNormalScale) m.clearcoatNormalScale.x = -m.clearcoatNormalScale.x
      } else if (mirror === 'vertical') {
        if (m.normalScale) m.normalScale.y = -m.normalScale.y
        if (m.clearcoatNormalScale) m.clearcoatNormalScale.y = -m.clearcoatNormalScale.y
      }
    } catch (e) {
      // ignore
    }
  }

  if (Array.isArray(material)) {
    for (let i = 0; i < material.length; i += 1) {
      applyToMat(material[i])
    }
    return
  }
  applyToMat(material as any)
}

export function syncMirroredMeshMaterials(root: THREE.Object3D, mirrored: boolean, mirror?: MirrorMode): void {
  root.traverse((child) => {
    const mesh = child as unknown as THREE.Mesh
    if (!(mesh as any)?.isMesh) {
      return
    }

    const userData = ((mesh.userData ??= {}) as any)
    const existing = userData[MIRROR_MATERIAL_STATE_KEY] as MirrorMaterialState | undefined

    if (mirrored) {
      const currentMaterial = mesh.material as any
      const state: MirrorMaterialState = existing ?? {
        original: currentMaterial,
        mirrored: cloneMaterial(currentMaterial),
      }

      // If material overrides replaced the mesh material, treat the new one as the original.
      if (existing && currentMaterial !== state.original && currentMaterial !== state.mirrored) {
        state.original = currentMaterial
        state.mirrored = cloneMaterial(currentMaterial)
      }

      syncMirroredMaterialSide(state.original, state.mirrored)
      // Adjust normal-like scales on the cloned/mirrored material to correct normal-map X/Y flipping
      adjustMaterialNormalScales(state.mirrored, mirror)

      userData[MIRROR_MATERIAL_STATE_KEY] = state
      mesh.material = state.mirrored as any

      // Fix geometry tangents handedness if present. Track via userData so we can revert.
      const geom = (mesh as any).geometry as THREE.BufferGeometry | undefined
      if (geom) {
        const flipped = flipTangentWOnGeometryIfNeeded(geom)
        if (flipped) {
          userData[MIRROR_TANGENTS_FLAG] = true
        }
      }

      return
    }

    // restoring original material
    if (existing) {
      mesh.material = existing.original as any
    }

    // If we previously flipped tangents for this mesh, flip them back
    const geom = (mesh as any).geometry as THREE.BufferGeometry | undefined
    if (geom && userData[MIRROR_TANGENTS_FLAG]) {
      const flippedBack = flipTangentWOnGeometryIfNeeded(geom)
      if (flippedBack) {
        delete userData[MIRROR_TANGENTS_FLAG]
      }
    }
  })
}
