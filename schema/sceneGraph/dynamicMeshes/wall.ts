import * as THREE from 'three';
import type { SceneNodeComponentState, WallDynamicMesh } from '../../index';
import type { SceneNodeWithExtras } from '../types';
import type { WallComponentProps } from '../../components/definitions/wallComponent';
import { WALL_COMPONENT_TYPE, clampWallProps } from '../../components/definitions/wallComponent';
import { createWallRenderGroup } from '../../wallMesh';
import { createAutoTiledMaterialVariant, MATERIAL_CONFIG_ID_KEY, MATERIAL_TEXTURE_REPEAT_INFO_KEY } from '../../material';
import { buildMaterialConfigMap } from '../materialAssignment';

function resolveWallBodyMaterialConfigId(node: SceneNodeWithExtras, meshInfo: WallDynamicMesh): string | null {
  const meshValue = typeof meshInfo.bodyMaterialConfigId === 'string' ? meshInfo.bodyMaterialConfigId.trim() : '';
  if (meshValue) {
    return meshValue;
  }
  const first = node.materials?.[0];
  const nodeValue = typeof first?.id === 'string' ? first.id.trim() : '';
  return nodeValue || null;
}

function applyWallMaterialConfigAssignment(
  root: THREE.Object3D,
  materialByConfigId: Map<string, THREE.Material>,
): void {
  const repeatedMaterialCache = new Map<string, THREE.Material | THREE.Material[]>();

  const resolveAssignedMaterial = (
    source: THREE.Material | THREE.Material[],
    repeatInfo: unknown,
  ): THREE.Material | THREE.Material[] => {
    const materialKey = Array.isArray(source)
      ? source.map((entry) => entry.uuid).join(',')
      : source.uuid;
    const repeatKey = repeatInfo ? JSON.stringify(repeatInfo) : '';
    const cacheKey = `${materialKey}|${repeatKey}`;
    const cached = repeatedMaterialCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const variant = createAutoTiledMaterialVariant(source, repeatInfo);
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
    if (!selectorId) {
      return;
    }
    const material = materialByConfigId.get(selectorId);
    if (material) {
      mesh.material = resolveAssignedMaterial(material, repeatInfo);
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

  const bodyObject = wallProps.bodyAssetId ? await deps.loadAssetMesh(wallProps.bodyAssetId) : null;
  const headObject = bodyObject && wallProps.headAssetId ? await deps.loadAssetMesh(wallProps.headAssetId) : null;
  const footObject = bodyObject && wallProps.footAssetId ? await deps.loadAssetMesh(wallProps.footAssetId) : null;

  const bodyEndCapObject = bodyObject && wallProps.bodyEndCapAssetId
    ? await deps.loadAssetMesh(wallProps.bodyEndCapAssetId)
    : null;
  const headEndCapObject = bodyEndCapObject && wallProps.headEndCapAssetId
    ? await deps.loadAssetMesh(wallProps.headEndCapAssetId)
    : null;
  const footEndCapObject = bodyEndCapObject && wallProps.footEndCapAssetId
    ? await deps.loadAssetMesh(wallProps.footEndCapAssetId)
    : null;

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

  const bodyCornerObjectsByAssetId: Record<string, THREE.Object3D | null> = {}
  const headCornerObjectsByAssetId: Record<string, THREE.Object3D | null> = {}
  const footCornerObjectsByAssetId: Record<string, THREE.Object3D | null> = {}

  const bodyCornerObjectsEntries = await Promise.all(
    uniqueBodyCornerAssetIds.map(async (assetId: string) => [assetId, await deps.loadAssetMesh(assetId)] as const),
  )
  for (const [assetId, object] of bodyCornerObjectsEntries) {
    bodyCornerObjectsByAssetId[assetId] = object
  }

  const headCornerObjectsEntries = await Promise.all(
    uniqueHeadCornerAssetIds.map(async (assetId: string) => [assetId, await deps.loadAssetMesh(assetId)] as const),
  )
  for (const [assetId, object] of headCornerObjectsEntries) {
    headCornerObjectsByAssetId[assetId] = object
  }

  const footCornerObjectsEntries = await Promise.all(
    uniqueFootCornerAssetIds.map(async (assetId: string) => [assetId, await deps.loadAssetMesh(assetId)] as const),
  )
  for (const [assetId, object] of footCornerObjectsEntries) {
    footCornerObjectsByAssetId[assetId] = object
  }

  const group = createWallRenderGroup(
    meshInfo,
    {
      bodyObject,
      headObject,
      footObject,
      bodyEndCapObject,
      headEndCapObject,
      footEndCapObject,
      bodyCornerObjectsByAssetId,
      headCornerObjectsByAssetId,
      footCornerObjectsByAssetId,
    },
    {
      smoothing: wallProps.smoothing,
      bodyMaterialConfigId: resolveWallBodyMaterialConfigId(node, meshInfo),
      cornerModels,
      bodyUvAxis: wallProps.bodyUvAxis,
      headUvAxis: wallProps.headUvAxis,
      footUvAxis: wallProps.footUvAxis,
      bodyOrientation: wallProps.bodyOrientation,
      headOrientation: wallProps.headOrientation,
      footOrientation: wallProps.footOrientation,
      bodyEndCapOrientation: wallProps.bodyEndCapOrientation,
      headEndCapOrientation: wallProps.headEndCapOrientation,
      footEndCapOrientation: wallProps.footEndCapOrientation,
    },
  );
  group.name = node.name ?? (group.name || 'Wall');

  const nodeMaterialConfigs = Array.isArray(node.materials) ? node.materials : [];
  const resolvedMaterials = await deps.resolveNodeMaterials(node);
  if (resolvedMaterials.length) {
    const materialByConfigId = buildMaterialConfigMap(nodeMaterialConfigs, resolvedMaterials);
    applyWallMaterialConfigAssignment(group, materialByConfigId);
  }

  // When a body asset is configured, the wall should be rendered only via the specified model asset.
  // Keep the procedural mesh in the hierarchy for downstream systems, but hide it from rendering.
  if (wallProps.bodyAssetId) {
    group.traverse((child: THREE.Object3D) => {
      const mesh = child as THREE.Mesh;
      if (!(mesh as any)?.isMesh) {
        return;
      }
      const tag = (mesh.userData as any)?.dynamicMeshType;
      if (tag === 'Wall') {
        mesh.visible = false;
      }
    });
  }

  deps.applyTransform(group, node);
  deps.applyVisibility(group, node);

  // Air wall: keep mesh hierarchy (for rigidbody generation), but hide it from rendering.
  if (wallProps.isAirWall) {
    group.visible = false;
  }

  // Tag for downstream systems (physics/debug tooling) if needed.
  group.userData = { ...(group.userData ?? {}), isAirWall: Boolean(wallProps.isAirWall), hidden: Boolean(wallProps.isAirWall) };
  return group;
}
