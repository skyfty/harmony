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
  const jointObject = wallProps.jointAssetId ? await deps.loadAssetMesh(wallProps.jointAssetId) : null;

  const group = createWallRenderGroup(
    meshInfo,
    { bodyObject, jointObject },
    { smoothing: wallProps.smoothing },
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
