import * as THREE from 'three';
import type { GroundDynamicMesh } from '../../index';
import type { SceneNodeWithExtras } from '../types';
import { createGroundMesh, setGroundMaterial, setGroundSculptedMaterial, updateGroundMesh } from '../../groundMesh';

export async function buildGroundMesh(
  deps: {
    resolveNodeMaterials: (node: SceneNodeWithExtras) => Promise<THREE.Material[]>;
    pickMaterialAssignment: (materials: THREE.Material[]) => THREE.Material | THREE.Material[] | null;
    extractGroundTextureFromMaterial: (material: THREE.Material | THREE.Material[] | null) => THREE.Texture | null;
    assignTextureToMaterial: (material: THREE.Material | THREE.Material[] | null, texture: THREE.Texture | null) => void;
    applyTransform: (object: THREE.Object3D, node: SceneNodeWithExtras) => void;
    applyVisibility: (object: THREE.Object3D, node: SceneNodeWithExtras) => void;
    recordMeshStatistics: (object: THREE.Object3D) => void;
  },
  meshInfo: GroundDynamicMesh,
  node: SceneNodeWithExtras,
): Promise<THREE.Object3D | null> {
  const groundObject = createGroundMesh(meshInfo);
  groundObject.name = node.name ?? (groundObject.name || 'Ground');

  const userData = { ...(groundObject.userData ?? {}) } as Record<string, unknown>;
  const sourceUserData = node.userData && typeof node.userData === 'object'
    ? (node.userData as Record<string, unknown>)
    : {};
  userData.dynamicMeshType = 'Ground';
  userData.groundChunked = true;
  if ('runtimeTerrainDatasetManifest' in sourceUserData) {
    userData.runtimeTerrainDatasetManifest = sourceUserData.runtimeTerrainDatasetManifest ?? null;
  }
  if ('runtimeTerrainDatasetEnabled' in sourceUserData) {
    userData.runtimeTerrainDatasetEnabled = sourceUserData.runtimeTerrainDatasetEnabled ?? null;
  }
  if ('runtimeTerrainHeightSampler' in sourceUserData) {
    userData.runtimeTerrainHeightSampler = sourceUserData.runtimeTerrainHeightSampler ?? null;
  }
  if ('compiledGroundEnabled' in sourceUserData) {
    userData.compiledGroundEnabled = sourceUserData.compiledGroundEnabled ?? null;
  }
  if ('compiledGroundManifest' in sourceUserData) {
    userData.compiledGroundManifest = sourceUserData.compiledGroundManifest ?? null;
  }
  groundObject.userData = userData;

  updateGroundMesh(groundObject, meshInfo);

  const materials = await deps.resolveNodeMaterials(node);
  const resolvedAssignment = deps.pickMaterialAssignment(materials);
  if (Array.isArray(resolvedAssignment)) {
    const flatMaterial = resolvedAssignment[0] ? resolvedAssignment[0].clone() : null;
    const sculptedMaterial = resolvedAssignment[1] ? resolvedAssignment[1].clone() : null;
    if (flatMaterial) {
      setGroundMaterial(groundObject, flatMaterial);
    }
    if (sculptedMaterial) {
      setGroundSculptedMaterial(groundObject, sculptedMaterial);
    } else {
      setGroundSculptedMaterial(groundObject, null);
    }
  } else if (resolvedAssignment) {
    const groundMaterial = resolvedAssignment.clone();
    setGroundMaterial(groundObject, groundMaterial);
    setGroundSculptedMaterial(groundObject, null);
  }
  deps.applyTransform(groundObject, node);
  deps.applyVisibility(groundObject, node);

  // Record statistics for each chunk mesh.
  groundObject.traverse((child: THREE.Object3D) => {
    const mesh = child as unknown as THREE.Mesh;
    if (mesh && (mesh as any).isMesh) {
      deps.recordMeshStatistics(mesh);
    }
  });

  return groundObject;
}
