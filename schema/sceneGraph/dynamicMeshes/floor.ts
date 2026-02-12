import * as THREE from 'three';
import type { FloorDynamicMesh, SceneNodeMaterial } from '../../index';
import type { SceneNodeWithExtras } from '../types';
import { createFloorRenderGroup } from '../../floorMesh';
import { MATERIAL_CONFIG_ID_KEY } from '../../material';
import { buildMaterialConfigMap } from '../materialAssignment';

function isUnlitDefaultMaterial(material: THREE.Material | THREE.Material[]): boolean {
  const materials = Array.isArray(material) ? material : [material];
  return materials.length > 0 && materials.every((entry) => Boolean((entry as any)?.isMeshBasicMaterial));
}

function applyFloorMaterialConfigAssignment(
  root: THREE.Object3D,
  options: {
    defaultMaterial: THREE.Material | THREE.Material[];
    materialByConfigId: Map<string, THREE.Material>;
    selectorKey?: string;
  },
): void {
  const selectorKey = options.selectorKey ?? MATERIAL_CONFIG_ID_KEY;
  const canFallbackToDefault = !isUnlitDefaultMaterial(options.defaultMaterial);

  root.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh & { isMesh?: boolean };
    if (!mesh?.isMesh) {
      return;
    }

    const selectorRaw = mesh.userData?.[selectorKey] as unknown;
    const selectorId = typeof selectorRaw === 'string' ? selectorRaw.trim() : '';
    if (selectorId && options.materialByConfigId.has(selectorId)) {
      mesh.material = options.materialByConfigId.get(selectorId)!;
      return;
    }

    // Preserve the floor's built-in lit materials when:
    // - no selector id is set (common default floors), or
    // - selector id is invalid and the provided default is unlit (e.g. MeshBasicMaterial).
    if (!selectorId || !canFallbackToDefault) {
      return;
    }

    mesh.material = options.defaultMaterial;
  });
}

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
    applyFloorMaterialConfigAssignment(group, {
      defaultMaterial: defaultMaterialAssignment,
      materialByConfigId,
    });
  }

  deps.applyTransform(group, node);
  deps.applyVisibility(group, node);
  return group;
}
