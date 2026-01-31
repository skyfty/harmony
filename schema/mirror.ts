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

export function syncMirroredMeshMaterials(root: THREE.Object3D, mirrored: boolean): void {
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
      userData[MIRROR_MATERIAL_STATE_KEY] = state
      mesh.material = state.mirrored as any
      return
    }

    if (existing) {
      mesh.material = existing.original as any
    }
  })
}
