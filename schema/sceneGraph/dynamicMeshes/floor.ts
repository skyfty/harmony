import * as THREE from 'three';
import type { FloorDynamicMesh, SceneNodeMaterial } from '../../index';
import type { SceneNodeWithExtras } from '../types';
import { createFloorRenderGroup } from '../../floorMesh';
import { createAutoTiledMaterialVariant, MATERIAL_CONFIG_ID_KEY, MATERIAL_TEXTURE_REPEAT_INFO_KEY } from '../../material';
import { buildMaterialConfigMap } from '../materialAssignment';

const FLOOR_RUNTIME_DEBUG_LOG_PREFIX = '[FloorDynamicMesh]';

function logFloorRuntimeDebug(message: string, payload?: Record<string, unknown>): void {
  if (payload) {
    console.info(FLOOR_RUNTIME_DEBUG_LOG_PREFIX, message, payload);
    return;
  }
  console.info(FLOOR_RUNTIME_DEBUG_LOG_PREFIX, message);
}

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
  const materialVariantCache = new Map<string, THREE.Material | THREE.Material[]>();

  const resolveAssignedMaterial = (
    source: THREE.Material | THREE.Material[],
    repeatInfo: unknown,
  ): THREE.Material | THREE.Material[] => {
    const materialKey = Array.isArray(source)
      ? source.map((entry) => entry.uuid).join(',')
      : source.uuid;
    const repeatKey = repeatInfo ? JSON.stringify(repeatInfo) : '';
    const cacheKey = `${materialKey}|${repeatKey}`;
    const cached = materialVariantCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const variant = createAutoTiledMaterialVariant(source, repeatInfo);
    const assigned = variant.shared ? source : variant.material;
    materialVariantCache.set(cacheKey, assigned);
    return assigned;
  };

  root.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh & { isMesh?: boolean };
    if (!mesh?.isMesh) {
      return;
    }

    const repeatInfo = mesh.userData?.[MATERIAL_TEXTURE_REPEAT_INFO_KEY] as unknown;
    const selectorRaw = mesh.userData?.[selectorKey] as unknown;
    const selectorId = typeof selectorRaw === 'string' ? selectorRaw.trim() : '';
    if (selectorId && options.materialByConfigId.has(selectorId)) {
      mesh.material = resolveAssignedMaterial(options.materialByConfigId.get(selectorId)!, repeatInfo);
      return;
    }

    if (selectorId && !options.materialByConfigId.has(selectorId)) {
      logFloorRuntimeDebug('applyFloorMaterialConfigAssignment missing selector match', {
        meshName: mesh.name || null,
        selectorId,
        availableSelectorIds: Array.from(options.materialByConfigId.keys()),
      });
    }

    // Preserve the floor's built-in lit materials when:
    // - no selector id is set (common default floors), or
    // - selector id is invalid and the provided default is unlit (e.g. MeshBasicMaterial).
    if (!selectorId || !canFallbackToDefault) {
      return;
    }

    mesh.material = resolveAssignedMaterial(options.defaultMaterial, repeatInfo);
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
    logFloorRuntimeDebug('buildFloorMesh resolved material assignments', {
      nodeId: node.id ?? null,
      nodeName: node.name ?? null,
      meshMaterialConfig: {
        topBottomMaterialConfigId: meshInfo.topBottomMaterialConfigId ?? null,
        sideMaterialConfigId: meshInfo.sideMaterialConfigId ?? null,
      },
      nodeMaterialIds: nodeMaterialConfigs.map((entry) => entry?.id ?? null),
      materialByConfigIdKeys: Array.from(materialByConfigId.keys()),
    });
    applyFloorMaterialConfigAssignment(group, {
      defaultMaterial: defaultMaterialAssignment,
      materialByConfigId,
    });
  }

  deps.applyTransform(group, node);
  deps.applyVisibility(group, node);
  return group;
}
