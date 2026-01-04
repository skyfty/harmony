import * as THREE from 'three';
import type { FloorDynamicMesh, SceneNodeMaterial } from '@harmony/schema';
import type { SceneNodeWithExtras } from '../types';
import { createFloorRenderGroup } from '../../floorMesh';
import { applyMaterialConfigAssignment, buildMaterialConfigMap } from '../materialAssignment';

export async function buildFloorMesh(
  deps: {
    resolveNodeMaterials: (node: SceneNodeWithExtras) => Promise<THREE.Material[]>;
    pickMaterialAssignment: (materials: THREE.Material[]) => THREE.Material | THREE.Material[] | null;
    applyTransform: (object: THREE.Object3D, node: SceneNodeWithExtras) => void;
    applyVisibility: (object: THREE.Object3D, node: SceneNodeWithExtras) => void;
  },
  meshInfo: FloorDynamicMesh,
  node: SceneNodeWithExtras,
): Promise<THREE.Object3D | null> {
  const group = createFloorRenderGroup(meshInfo, {});
  group.name = node.name ?? (group.name || 'Floor');

  const nodeMaterialConfigs = Array.isArray(node.materials) ? (node.materials as SceneNodeMaterial[]) : [];
  const resolvedMaterials = await deps.resolveNodeMaterials(node);
  const defaultMaterialAssignment = deps.pickMaterialAssignment(resolvedMaterials);

  if (defaultMaterialAssignment) {
    const materialByConfigId = buildMaterialConfigMap(nodeMaterialConfigs, resolvedMaterials);
    applyMaterialConfigAssignment(group, {
      defaultMaterial: defaultMaterialAssignment,
      materialByConfigId,
    });
  }

  deps.applyTransform(group, node);
  deps.applyVisibility(group, node);
  return group;
}
