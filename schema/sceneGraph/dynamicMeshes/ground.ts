import * as THREE from 'three';
import type { GroundDynamicMesh } from '../../index';
import type { SceneNodeWithExtras } from '../types';
import { applyGroundTextureToGroundObject, createGroundMesh, setGroundMaterial, updateGroundMesh } from '../../groundMesh';
import { buildGroundOptimizedGeometry, hasGroundOptimizedMeshData } from '../../groundOptimizedMesh';

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
  const groundObject = hasGroundOptimizedMeshData(meshInfo)
    ? new THREE.Mesh(
        buildGroundOptimizedGeometry(meshInfo.optimizedMesh!),
        new THREE.MeshStandardMaterial({ color: '#707070', roughness: 0.85, metalness: 0.05 }),
      )
    : createGroundMesh(meshInfo);
  groundObject.name = node.name ?? (groundObject.name || 'Ground');

  const userData = { ...(groundObject.userData ?? {}) } as Record<string, unknown>;
  userData.dynamicMeshType = 'Ground';
  userData.groundChunked = !hasGroundOptimizedMeshData(meshInfo);
  groundObject.userData = userData;

  if (!hasGroundOptimizedMeshData(meshInfo)) {
    updateGroundMesh(groundObject, meshInfo);
  } else {
    const mesh = groundObject as THREE.Mesh;
    mesh.receiveShadow = true;
    mesh.castShadow = meshInfo.castShadow === true;
  }

  // Apply node materials across all ground chunks.
  let groundTexture: THREE.Texture | null = null;
  groundObject.traverse((child: THREE.Object3D) => {
    const mesh = child as unknown as THREE.Mesh;
    if (!groundTexture && mesh && (mesh as any).isMesh) {
      groundTexture = deps.extractGroundTextureFromMaterial(mesh.material) ?? null;
    }
  });

  const materials = await deps.resolveNodeMaterials(node);
  const resolvedAssignment = deps.pickMaterialAssignment(materials);
  const resolvedMaterial = Array.isArray(resolvedAssignment) ? resolvedAssignment[0] : resolvedAssignment;
  if (resolvedMaterial) {
    const groundMaterial = resolvedMaterial.clone();
    setGroundMaterial(groundObject, groundMaterial);
    if (groundTexture) {
      deps.assignTextureToMaterial(groundMaterial, groundTexture);
    }
  }
  applyGroundTextureToGroundObject(groundObject, meshInfo);

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
