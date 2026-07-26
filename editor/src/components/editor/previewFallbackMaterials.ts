import * as THREE from 'three'

const PREVIEW_FALLBACK_PALETTE: readonly THREE.ColorRepresentation[] = [
  0x6ec3ff,
  0xffb36b,
  0x7ddc8a,
  0xf08a94,
  0xf2d96b,
  0x80d6d2,
  0xb9a1ff,
  0xff9fd6,
]

type PreviewFallbackTintOptions = {
  transparent?: boolean
  opacity?: number
}

function hashPreviewSeed(seed: string): number {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0
  }
  return hash
}

function resolvePreviewFallbackTint(seed: string): THREE.ColorRepresentation {
  const paletteIndex = Math.abs(hashPreviewSeed(seed)) % PREVIEW_FALLBACK_PALETTE.length
  return PREVIEW_FALLBACK_PALETTE[paletteIndex] ?? PREVIEW_FALLBACK_PALETTE[0]!
}

function applyDebugMaterialTint(
  material: THREE.Material | null | undefined,
  tint: THREE.ColorRepresentation,
  options: PreviewFallbackTintOptions,
): void {
  if (!material) {
    return
  }

  const userData = (material as THREE.Material & { userData?: Record<string, unknown> }).userData ?? null
  if (!userData?.harmonyDebugMaterial) {
    return
  }

  const colorMaterial = material as THREE.Material & {
    color?: THREE.Color
    transparent?: boolean
    opacity?: number
    depthWrite?: boolean
    needsUpdate?: boolean
  }

  if (colorMaterial.color) {
    colorMaterial.color.set(tint)
  }
  colorMaterial.transparent = options.transparent ?? true
  colorMaterial.opacity = typeof options.opacity === 'number' ? options.opacity : 0.88
  colorMaterial.depthWrite = false
  colorMaterial.needsUpdate = true
}

export function tintPreviewFallbackMaterials(
  root: THREE.Object3D,
  seed: string,
  options: PreviewFallbackTintOptions = {},
): void {
  const tint = resolvePreviewFallbackTint(seed)

  root.traverse((child) => {
    const mesh = child as THREE.Mesh & { isMesh?: boolean }
    if (!mesh?.isMesh) {
      return
    }

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => {
      applyDebugMaterialTint(material, tint, options)
    })
  })
}