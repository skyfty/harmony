import * as THREE from 'three';
import type { SceneNodeComponentState, WallDynamicMesh } from '@harmony/schema';
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

  const cornerModels = Array.isArray((wallProps as any).cornerModels) ? (wallProps as any).cornerModels : []
  const uniqueCornerAssetIds = Array.from(
    new Set<string>(
      cornerModels
        .map((rule: any) => (typeof rule?.assetId === 'string' ? rule.assetId.trim() : ''))
        .filter((value: string) => value.length > 0),
    ),
  )

  const cornerObjectsEntries = await Promise.all(
    uniqueCornerAssetIds.map(async (assetId: string) => [assetId, await deps.loadAssetMesh(assetId)] as const),
  )
  const cornerObjectsByAssetId: Record<string, THREE.Object3D | null> = {}
  for (const [assetId, object] of cornerObjectsEntries) {
    cornerObjectsByAssetId[assetId] = object
  }

  const group = createWallRenderGroup(
    meshInfo,
    { bodyObject, cornerObjectsByAssetId },
    { smoothing: wallProps.smoothing, cornerModels },
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
