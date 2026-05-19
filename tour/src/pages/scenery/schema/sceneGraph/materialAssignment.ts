import * as THREE from 'three';
import { MATERIAL_CONFIG_ID_KEY } from '../material';
import type { SceneNodeMaterial } from '../index';

export function buildMaterialConfigMap(
  nodeMaterialConfigs: SceneNodeMaterial[],
  resolvedMaterials: THREE.Material[],
): Map<string, THREE.Material> {
  const materialByConfigId = new Map<string, THREE.Material>();
  nodeMaterialConfigs.forEach((config, index) => {
    const configId = typeof config?.id === 'string' ? config.id.trim() : '';
    const material = resolvedMaterials[index];
    if (configId && material) {
      materialByConfigId.set(configId, material);
    }
  });
  return materialByConfigId;
}

export function applyMaterialConfigAssignment(
  root: THREE.Object3D,
  options: {
    defaultMaterial: THREE.Material | THREE.Material[];
    materialByConfigId: Map<string, THREE.Material>;
    selectorKey?: string;
  },
): void {
  const selectorKey = options.selectorKey ?? MATERIAL_CONFIG_ID_KEY;

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

    mesh.material = options.defaultMaterial;
  });
}
