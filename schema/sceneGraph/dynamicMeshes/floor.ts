import * as THREE from 'three';
import type { FloorDynamicMesh, SceneNodeMaterial } from '../../index';
import type { SceneNodeWithExtras } from '../types';
import { createFloorRenderGroup } from '../../floorMesh';
import { createAutoTiledMaterialVariant, MATERIAL_CONFIG_ID_KEY, MATERIAL_TEXTURE_REPEAT_INFO_KEY } from '../../material';
import { buildMaterialConfigMap } from '../materialAssignment';

const FLOOR_DYNAMIC_MESH_DEBUG_PREFIX = '[FloorDynamicMesh][debug]';

function logFloorDynamicMeshDebug(event: string, detail?: Record<string, unknown>): void {
  if (typeof detail === 'undefined') {
    console.log(`${FLOOR_DYNAMIC_MESH_DEBUG_PREFIX} ${event}`);
    return;
  }
  console.log(`${FLOOR_DYNAMIC_MESH_DEBUG_PREFIX} ${event}`, detail);
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
  logFloorDynamicMeshDebug('buildFloorMesh:start', {
    nodeId: node.id ?? null,
    nodeName: node.name ?? '',
    hasMaterials: Array.isArray(node.materials) && node.materials.length > 0,
  });
  const group = createFloorRenderGroup(meshInfo, {});
  logFloorDynamicMeshDebug('buildFloorMesh:group-created', {
    nodeId: node.id ?? null,
    nodeName: node.name ?? '',
  });
  group.name = node.name ?? (group.name || 'Floor');

  const nodeMaterialConfigs = Array.isArray(node.materials) ? (node.materials as SceneNodeMaterial[]) : [];
  logFloorDynamicMeshDebug('buildFloorMesh:resolve-materials:start', {
    nodeId: node.id ?? null,
    nodeName: node.name ?? '',
    materialConfigCount: nodeMaterialConfigs.length,
  });
  const resolvedMaterials = await deps.resolveNodeMaterials(node);
  logFloorDynamicMeshDebug('buildFloorMesh:resolve-materials:done', {
    nodeId: node.id ?? null,
    nodeName: node.name ?? '',
    resolvedCount: resolvedMaterials.length,
  });
  const defaultMaterialAssignment = deps.pickMaterialAssignment(resolvedMaterials);

  if (defaultMaterialAssignment) {
    logFloorDynamicMeshDebug('buildFloorMesh:apply-material-config:start', {
      nodeId: node.id ?? null,
      nodeName: node.name ?? '',
    });
    const materialByConfigId = buildMaterialConfigMap(nodeMaterialConfigs, resolvedMaterials);
    applyFloorMaterialConfigAssignment(group, {
      defaultMaterial: defaultMaterialAssignment,
      materialByConfigId,
    });
    logFloorDynamicMeshDebug('buildFloorMesh:apply-material-config:done', {
      nodeId: node.id ?? null,
      nodeName: node.name ?? '',
    });
  }

  deps.applyTransform(group, node);
  deps.applyVisibility(group, node);
  logFloorDynamicMeshDebug('buildFloorMesh:done', {
    nodeId: node.id ?? null,
    nodeName: node.name ?? '',
    childCount: group.children.length,
  });
  return group;
}
