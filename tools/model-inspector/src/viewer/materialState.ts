import * as THREE from 'three'
import { createUvDebugMaterial } from '@schema/debugTextures'
import type { DisplayMode, MaterialOverrides } from '../types'

type InspectMeshUserData = {
  __inspectOriginalMaterial?: THREE.Material | THREE.Material[]
  __inspectDisplayMaterial?: THREE.Material | THREE.Material[]
}

function isRenderableMesh(object: THREE.Object3D): object is THREE.Mesh {
  const mesh = object as THREE.Mesh & { isSkinnedMesh?: boolean }
  return Boolean(mesh.isMesh || mesh.isSkinnedMesh)
}

function materialList(material: THREE.Material | THREE.Material[] | null | undefined): THREE.Material[] {
  if (!material) {
    return []
  }
  return Array.isArray(material) ? material.filter(Boolean) : [material]
}

/** Stashes the engine/native material of a mesh so display settings never mutate it. */
export function ensureOriginalMaterial(mesh: THREE.Mesh): void {
  const userData = (mesh.userData ??= {}) as InspectMeshUserData
  if (userData.__inspectOriginalMaterial === undefined) {
    userData.__inspectOriginalMaterial = mesh.material
  }
}

/** The material as loaded, ignoring any display-mode/override clone. */
export function resolveOriginalMaterial(mesh: THREE.Mesh): THREE.Material | THREE.Material[] | null {
  const userData = mesh.userData as InspectMeshUserData | undefined
  return userData?.__inspectOriginalMaterial ?? mesh.material ?? null
}

export function isDefaultMaterialState(displayMode: DisplayMode, overrides: MaterialOverrides): boolean {
  return (
    displayMode === 'original' &&
    overrides.side === 'keep' &&
    overrides.transparent === 'keep' &&
    overrides.alphaTest === null &&
    overrides.flatShading === 'keep' &&
    overrides.depthWrite === 'keep' &&
    overrides.metalness === null &&
    overrides.roughness === null &&
    overrides.toneMapped === 'keep'
  )
}

function sideValue(side: MaterialOverrides['side']): THREE.Side | null {
  if (side === 'front') {
    return THREE.FrontSide
  }
  if (side === 'back') {
    return THREE.BackSide
  }
  if (side === 'double') {
    return THREE.DoubleSide
  }
  return null
}

function applyOverrides(material: THREE.Material, overrides: MaterialOverrides): void {
  const record = material as unknown as Record<string, unknown>

  const side = sideValue(overrides.side)
  if (side !== null) {
    material.side = side
  }
  if (overrides.transparent !== 'keep') {
    material.transparent = overrides.transparent === 'on'
  }
  if (overrides.alphaTest !== null) {
    material.alphaTest = overrides.alphaTest
  }
  if (overrides.depthWrite !== 'keep') {
    material.depthWrite = overrides.depthWrite === 'on'
  }
  if (overrides.toneMapped !== 'keep') {
    material.toneMapped = overrides.toneMapped === 'on'
  }
  if (overrides.flatShading !== 'keep' && typeof record.flatShading === 'boolean') {
    record.flatShading = overrides.flatShading === 'on'
  }
  if (overrides.metalness !== null && typeof record.metalness === 'number') {
    record.metalness = overrides.metalness
  }
  if (overrides.roughness !== null && typeof record.roughness === 'number') {
    record.roughness = overrides.roughness
  }
  material.needsUpdate = true
}

function createUnlitMaterial(source: THREE.Material, withMap: boolean): THREE.MeshBasicMaterial {
  const standard = source as THREE.MeshStandardMaterial
  return new THREE.MeshBasicMaterial({
    color: withMap ? new THREE.Color(0xffffff) : standard.color?.clone() ?? new THREE.Color(0xffffff),
    map: withMap ? standard.map ?? null : null,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    side: source.side,
    depthWrite: source.depthWrite,
    vertexColors: Boolean(standard.vertexColors),
  })
}

function buildDisplayMaterial(
  source: THREE.Material,
  displayMode: DisplayMode,
  overrides: MaterialOverrides,
): THREE.Material {
  let material: THREE.Material

  switch (displayMode) {
    case 'wireframe': {
      const clone = source.clone()
      ;(clone as unknown as { wireframe: boolean }).wireframe = true
      material = clone
      break
    }
    case 'unlit':
      material = createUnlitMaterial(source, false)
      break
    case 'albedo':
      material = createUnlitMaterial(source, true)
      break
    case 'normal':
      material = new THREE.MeshNormalMaterial({ flatShading: false })
      break
    case 'uv':
      material = createUvDebugMaterial({ style: 'grid', side: THREE.DoubleSide, metalness: 0, roughness: 1 })
      break
    case 'vertexColor':
      material = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff })
      break
    case 'original':
    default:
      material = source.clone()
      break
  }

  applyOverrides(material, overrides)
  return material
}

function disposeDisplayMaterial(mesh: THREE.Mesh): void {
  const userData = mesh.userData as InspectMeshUserData | undefined
  const previous = userData?.__inspectDisplayMaterial
  if (!previous) {
    return
  }
  for (const material of materialList(previous)) {
    material.dispose()
  }
  if (userData) {
    userData.__inspectDisplayMaterial = undefined
  }
}

/** Applies the current display mode / overrides without touching the loaded materials. */
export function applyMaterialState(
  root: THREE.Object3D,
  displayMode: DisplayMode,
  overrides: MaterialOverrides,
): void {
  const useOriginalDirectly = isDefaultMaterialState(displayMode, overrides)

  root.traverse((child) => {
    if (!isRenderableMesh(child)) {
      return
    }
    const mesh = child as THREE.Mesh
    ensureOriginalMaterial(mesh)
    const userData = mesh.userData as InspectMeshUserData
    const original = userData.__inspectOriginalMaterial ?? mesh.material
    const originals = materialList(original)
    const wasArray = Array.isArray(original)

    disposeDisplayMaterial(mesh)

    if (useOriginalDirectly) {
      mesh.material = original
      return
    }

    const next = originals.map((material) => buildDisplayMaterial(material, displayMode, overrides))
    userData.__inspectDisplayMaterial = wasArray ? next : next[0]
    mesh.material = wasArray ? next : next[0] ?? original
  })
}

export function restoreOriginalMaterials(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!isRenderableMesh(child)) {
      return
    }
    const mesh = child as THREE.Mesh
    const userData = mesh.userData as InspectMeshUserData
    disposeDisplayMaterial(mesh)
    if (userData.__inspectOriginalMaterial !== undefined) {
      mesh.material = userData.__inspectOriginalMaterial ?? mesh.material
    }
  })
}
