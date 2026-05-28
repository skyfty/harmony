import * as THREE from 'three'
import type { LandformDynamicMesh } from '../../index'
import type { SceneNodeWithExtras } from '../types'

export async function buildLandformMesh(
  _deps: {
    resolveNodeMaterials: (node: SceneNodeWithExtras) => Promise<THREE.Material[]>
    pickMaterialAssignment: (materials: THREE.Material[]) => THREE.Material | THREE.Material[] | null
    applyTransform: (object: THREE.Object3D, node: SceneNodeWithExtras) => void
    applyVisibility: (object: THREE.Object3D, node: SceneNodeWithExtras) => void
  },
  _meshInfo: LandformDynamicMesh,
  _node: SceneNodeWithExtras,
): Promise<THREE.Object3D | null> {
  console.warn('[SceneGraph] Landform runtime rendering has been removed. Expected baked groundSurfaceChunks before preview or runtime build.', {
    nodeId: _node.id,
    name: _node.name ?? null,
  })
  return null
}
