import * as THREE from 'three';
import type { SceneNodeComponentState, WallDynamicMesh } from '../../index';
import type { SceneNodeWithExtras } from '../types';
import type { WallComponentProps } from '../../components/definitions/wallComponent';
import {
  WALL_COMPONENT_TYPE,
  clampWallProps,
  resolveWallBodyMaterialConfigIdForRender,
} from '../../components/definitions/wallComponent';
import { createWallGroup, WALL_ASSET_REPEAT_VARIANT_INFO_KEY } from '../../wallMesh';
import {
  createAutoTiledMaterialVariant,
  createWallRepeatScaleMaterialVariant,
  MATERIAL_CONFIG_ID_KEY,
  MATERIAL_TEXTURE_REPEAT_INFO_KEY,
} from '../../material';
import { getCachedModelObject, getOrLoadModelObject, type ModelInstanceGroup } from '../../modelObjectCache';
import {
  applyWallInstancedBindings,
  buildWallInstancedRenderPlan,
  setWallInstancedBindingsOnObject,
} from '../../wallInstancing';
import { buildMaterialConfigMap } from '../materialAssignment';

function applyWallMaterialConfigAssignment(
  root: THREE.Object3D,
  materialByConfigId: Map<string, THREE.Material>,
): void {
  const repeatedMaterialCache = new Map<string, THREE.Material | THREE.Material[]>();

  const resolveAssignedMaterial = (
    source: THREE.Material | THREE.Material[],
    repeatInfo: unknown,
    repeatVariantInfo: unknown,
    isWallAsset: boolean,
  ): THREE.Material | THREE.Material[] => {
    const wallRepeatScaleU = isWallAsset && repeatVariantInfo && typeof repeatVariantInfo === 'object'
      ? Number((repeatVariantInfo as { repeatScaleU?: unknown }).repeatScaleU)
      : Number.NaN;
    const materialKey = Array.isArray(source)
      ? source.map((entry) => entry.uuid).join(',')
      : source.uuid;
    const repeatKey = Number.isFinite(wallRepeatScaleU) && wallRepeatScaleU > 0
      ? `wall-u:${wallRepeatScaleU}`
      : repeatInfo ? JSON.stringify(repeatInfo) : '';
    const cacheKey = `${materialKey}|${repeatKey}`;
    const cached = repeatedMaterialCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const variant = Number.isFinite(wallRepeatScaleU) && wallRepeatScaleU > 0
      ? createWallRepeatScaleMaterialVariant(source, wallRepeatScaleU)
      : createAutoTiledMaterialVariant(source, repeatInfo);
    const assigned = variant.shared ? source : variant.material;
    repeatedMaterialCache.set(cacheKey, assigned);
    return assigned;
  };

  root.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh & { isMesh?: boolean };
    if (!mesh?.isMesh) {
      return;
    }

    const selectorRaw = mesh.userData?.[MATERIAL_CONFIG_ID_KEY] as unknown;
    const selectorId = typeof selectorRaw === 'string' ? selectorRaw.trim() : '';
    const repeatInfo = mesh.userData?.[MATERIAL_TEXTURE_REPEAT_INFO_KEY] as unknown;
    const repeatVariantInfo = mesh.userData?.[WALL_ASSET_REPEAT_VARIANT_INFO_KEY] as unknown;
    const isWallAsset = mesh.userData?.dynamicMeshType === 'WallAsset';
    if (!selectorId) {
      return;
    }
    const material = materialByConfigId.get(selectorId);
    if (material) {
      mesh.material = resolveAssignedMaterial(material, repeatInfo, repeatVariantInfo, isWallAsset);
    }
  });
}

export async function buildWallMesh(
  deps: {
    loadAssetMesh: (assetId: string) => Promise<THREE.Object3D | null>;
    resolveNodeMaterials: (node: SceneNodeWithExtras) => Promise<THREE.Material[]>;
    pickMaterialAssignment: (materials: THREE.Material[]) => THREE.Material | THREE.Material[] | null;
    applyTransform: (object: THREE.Object3D, node: SceneNodeWithExtras) => void;
    applyVisibility: (object: THREE.Object3D, node: SceneNodeWithExtras) => void;
  },
  meshInfo: WallDynamicMesh,
  node: SceneNodeWithExtras,
): Promise<THREE.Object3D | null> {
  const wallState = node.components?.[WALL_COMPONENT_TYPE] as
    | SceneNodeComponentState<WallComponentProps>
    | undefined;
  const wallProps = clampWallProps(wallState?.props as Partial<WallComponentProps> | null | undefined);

  const ensureModelGroup = async (assetId: string | null | undefined): Promise<ModelInstanceGroup | null> => {
    const normalized = typeof assetId === 'string' ? assetId.trim() : '';
    if (!normalized) {
      return null;
    }
    const cached = getCachedModelObject(normalized);
    if (cached) {
      return cached;
    }
    try {
      return await getOrLoadModelObject(normalized, async () => {
        const object = await deps.loadAssetMesh(normalized);
        if (!object) {
          throw new Error(`Failed to load wall asset ${normalized}`);
        }
        return object;
      });
    } catch {
      return null;
    }
  };

  const [bodyGroup, headGroup, footGroup, bodyEndCapGroup, headEndCapGroup, footEndCapGroup] = await Promise.all([
    ensureModelGroup(wallProps.bodyAssetId),
    ensureModelGroup(wallProps.headAssetId),
    ensureModelGroup(wallProps.footAssetId),
    ensureModelGroup(wallProps.bodyEndCapAssetId),
    ensureModelGroup(wallProps.headEndCapAssetId),
    ensureModelGroup(wallProps.footEndCapAssetId),
  ]);

  const cornerModels = Array.isArray(wallProps.cornerModels) ? wallProps.cornerModels : []

  const uniqueBodyCornerAssetIds = Array.from(
    new Set<string>(
      cornerModels
        .map((rule: any) => (typeof rule?.bodyAssetId === 'string' ? rule.bodyAssetId.trim() : ''))
        .filter((value: string) => value.length > 0),
    ),
  )
  const uniqueHeadCornerAssetIds = Array.from(
    new Set<string>(
      cornerModels
        .map((rule: any) => (typeof rule?.headAssetId === 'string' ? rule.headAssetId.trim() : ''))
        .filter((value: string) => value.length > 0),
    ),
  )
  const uniqueFootCornerAssetIds = Array.from(
    new Set<string>(
      cornerModels
        .map((rule: any) => (typeof rule?.footAssetId === 'string' ? rule.footAssetId.trim() : ''))
        .filter((value: string) => value.length > 0),
    ),
  )

  const bodyCornerGroups: Array<readonly [string, ModelInstanceGroup | null]> = await Promise.all(
    uniqueBodyCornerAssetIds.map(async (assetId: string) => [assetId, await ensureModelGroup(assetId)] as const),
  );
  const headCornerGroups: Array<readonly [string, ModelInstanceGroup | null]> = await Promise.all(
    uniqueHeadCornerAssetIds.map(async (assetId: string) => [assetId, await ensureModelGroup(assetId)] as const),
  );
  const footCornerGroups: Array<readonly [string, ModelInstanceGroup | null]> = await Promise.all(
    uniqueFootCornerAssetIds.map(async (assetId: string) => [assetId, await ensureModelGroup(assetId)] as const),
  );

  const configuredInstancedAssetIds = [
    wallProps.bodyAssetId,
    wallProps.headAssetId,
    wallProps.footAssetId,
    wallProps.bodyEndCapAssetId,
    wallProps.headEndCapAssetId,
    wallProps.footEndCapAssetId,
    ...uniqueBodyCornerAssetIds,
    ...uniqueHeadCornerAssetIds,
    ...uniqueFootCornerAssetIds,
  ]
    .map((assetId) => (typeof assetId === 'string' ? assetId.trim() : ''))
    .filter((assetId) => assetId.length > 0);

  const loadedAssetIds = new Set<string>();
  [bodyGroup, headGroup, footGroup, bodyEndCapGroup, headEndCapGroup, footEndCapGroup].forEach((group) => {
    if (group?.assetId) {
      loadedAssetIds.add(group.assetId);
    }
  });
  [bodyCornerGroups, headCornerGroups, footCornerGroups].forEach((entries) => {
    entries.forEach(([assetId, group]) => {
      if (group?.assetId) {
        loadedAssetIds.add(assetId);
      }
    });
  });

  const bodyMaterialConfigId = resolveWallBodyMaterialConfigIdForRender(meshInfo, wallProps);
  const buildProceduralWallGroup = async (): Promise<THREE.Group> => {
    const group = createWallGroup(meshInfo, {
      wallRenderMode: wallProps.wallRenderMode,
      repeatInstanceStep: wallProps.repeatInstanceStep,
      bodyMaterialConfigId,
      headAssetHeight: wallProps.headAssetHeight,
      footAssetHeight: wallProps.footAssetHeight,
    });
    group.name = node.name ?? (group.name || 'Wall');
    const nodeMaterialConfigs = Array.isArray(node.materials) ? node.materials : [];
    const resolvedMaterials = await deps.resolveNodeMaterials(node);
    if (resolvedMaterials.length) {
      const materialByConfigId = buildMaterialConfigMap(nodeMaterialConfigs, resolvedMaterials);
      applyWallMaterialConfigAssignment(group, materialByConfigId);
    }
    deps.applyTransform(group, node);
    deps.applyVisibility(group, node);
    if (wallProps.isAirWall) {
      group.visible = false;
    }
    group.userData = { ...(group.userData ?? {}), isAirWall: Boolean(wallProps.isAirWall), hidden: Boolean(wallProps.isAirWall) };
    return group;
  };

  const hasMissingConfiguredAsset = configuredInstancedAssetIds.some((assetId) => !loadedAssetIds.has(assetId));
  if (wallProps.isAirWall || hasMissingConfiguredAsset) {
    return buildProceduralWallGroup();
  }

  const assetBoundsById = new Map<string, THREE.Box3>();
  [bodyGroup, headGroup, footGroup, bodyEndCapGroup, headEndCapGroup, footEndCapGroup].forEach((group) => {
    if (group?.assetId) {
      assetBoundsById.set(group.assetId, group.boundingBox.clone());
    }
  });
  [bodyCornerGroups, headCornerGroups, footCornerGroups].forEach((entries) => {
    entries.forEach(([assetId, group]) => {
      if (group?.boundingBox) {
        assetBoundsById.set(assetId, group.boundingBox.clone());
      }
    });
  });

  const plan = buildWallInstancedRenderPlan({
    nodeId: node.id,
    definition: meshInfo,
    wallProps,
    getAssetBounds: (assetId: string) => assetBoundsById.get(assetId)?.clone() ?? null,
  });

  if (!plan.hasBindings) {
    return buildProceduralWallGroup();
  }

  const container = new THREE.Group();
  container.name = node.name ?? 'Wall';
  container.userData = { ...(container.userData ?? {}), dynamicMeshType: 'Wall', isAirWall: false, hidden: false };

  if (plan.hasProceduralBodyFallback) {
    const proceduralGroup = await buildProceduralWallGroup();
    container.add(proceduralGroup);
  }

  setWallInstancedBindingsOnObject(container, plan);
  deps.applyTransform(container, node);
  deps.applyVisibility(container, node);

  const applied = applyWallInstancedBindings({
    nodeId: node.id,
    object: container,
    bindings: plan.bindings,
  });
  if (!applied) {
    return buildProceduralWallGroup();
  }

  return container;
}
