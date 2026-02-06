import * as THREE from 'three';
import type { SceneNodeComponentState, WallDynamicMesh } from '../../index';
import type { SceneNodeWithExtras } from '../types';
import type { WallComponentProps } from '../../components/definitions/wallComponent';
import { WALL_COMPONENT_TYPE, clampWallProps } from '../../components/definitions/wallComponent';
import { createWallRenderGroup } from '../../wallMesh';

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

  const bodyEndCapObject = bodyObject && wallProps.bodyEndCapAssetId
    ? await deps.loadAssetMesh(wallProps.bodyEndCapAssetId)
    : null;
  const headEndCapObject = bodyEndCapObject && wallProps.headEndCapAssetId
    ? await deps.loadAssetMesh(wallProps.headEndCapAssetId)
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

  const bodyCornerObjectsByAssetId: Record<string, THREE.Object3D | null> = {}
  const headCornerObjectsByAssetId: Record<string, THREE.Object3D | null> = {}

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

  const group = createWallRenderGroup(
    meshInfo,
    {
      bodyObject,
      headObject,
      bodyEndCapObject,
      headEndCapObject,
      bodyCornerObjectsByAssetId,
      headCornerObjectsByAssetId,
    },
    {
      smoothing: wallProps.smoothing,
      cornerModels,
      bodyOrientation: wallProps.bodyOrientation,
      headOrientation: wallProps.headOrientation,
      bodyEndCapOrientation: wallProps.bodyEndCapOrientation,
      headEndCapOrientation: wallProps.headEndCapOrientation,
      jointTrimMode: wallProps.jointTrimMode,
      jointTrimManual: wallProps.jointTrimManual,
    },
  );
  group.name = node.name ?? (group.name || 'Wall');

  const materials = await deps.resolveNodeMaterials(node);
  const materialAssignment = deps.pickMaterialAssignment(materials);
  if (materialAssignment) {
    group.traverse((child: THREE.Object3D) => {
      const mesh = child as THREE.Mesh;
      if (!(mesh as any)?.isMesh) {
        return;
      }
      const tag = (mesh.userData as any)?.dynamicMeshType;
      // Only override the procedural wall mesh material; asset instances should keep their own materials.
      if (tag === 'Wall') {
        mesh.material = materialAssignment;
      }
    });
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
