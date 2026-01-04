import * as THREE from 'three';
import type { RoadDynamicMesh, SceneNodeComponentState, SceneNodeMaterial } from '@harmony/schema';
import type { SceneNodeWithExtras } from '../types';
import type { RoadComponentProps } from '../../components/definitions/roadComponent';
import { ROAD_COMPONENT_TYPE, clampRoadProps } from '../../components/definitions/roadComponent';
import { createRoadRenderGroup, resolveRoadLocalHeightSampler, type RoadJunctionSmoothingOptions } from '../../roadMesh';
import { findGroundNodeInNodes } from '../nodeTraversal';
import { applyMaterialConfigAssignment, buildMaterialConfigMap } from '../materialAssignment';

function resolveRoadMaterialConfigId(node: SceneNodeWithExtras): string | null {
  const first = node.materials?.[0];
  const id = typeof first?.id === 'string' ? first.id.trim() : '';
  return id ? id : null;
}

export async function buildRoadMesh(
  deps: {
    loadAssetMesh: (assetId: string) => Promise<THREE.Object3D | null>;
    resolveNodeMaterials: (node: SceneNodeWithExtras) => Promise<THREE.Material[]>;
    pickMaterialAssignment: (materials: THREE.Material[]) => THREE.Material | THREE.Material[] | null;
    applyTransform: (object: THREE.Object3D, node: SceneNodeWithExtras) => void;
    applyVisibility: (object: THREE.Object3D, node: SceneNodeWithExtras) => void;
    getDocumentNodes: () => SceneNodeWithExtras[];
  },
  meshInfo: RoadDynamicMesh,
  node: SceneNodeWithExtras,
): Promise<THREE.Object3D | null> {
  const roadState = node.components?.[ROAD_COMPONENT_TYPE] as
    | SceneNodeComponentState<RoadComponentProps>
    | undefined;
  const roadProps = clampRoadProps(roadState?.props as Partial<RoadComponentProps> | null | undefined);

  const bodyObject = roadProps.bodyAssetId ? await deps.loadAssetMesh(roadProps.bodyAssetId) : null;
  const materialConfigId = resolveRoadMaterialConfigId(node);
  const roadOptions: RoadJunctionSmoothingOptions = {
    junctionSmoothing: roadProps.junctionSmoothing,
    laneLines: roadProps.laneLines,
    shoulders: roadProps.shoulders,
    materialConfigId,
    samplingDensityFactor: roadProps.samplingDensityFactor,
    smoothingStrengthFactor: roadProps.smoothingStrengthFactor,
    minClearance: roadProps.minClearance,
    laneLineWidth: roadProps.laneLineWidth,
    shoulderWidth: roadProps.shoulderWidth,
  };

  const documentNodes = deps.getDocumentNodes();
  const groundNode = findGroundNodeInNodes(documentNodes);
  roadOptions.heightSampler = resolveRoadLocalHeightSampler(node, groundNode);

  const group = createRoadRenderGroup(meshInfo, { bodyObject }, roadOptions);
  group.name = node.name ?? (group.name || 'Road');

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

  const applyOverlayMaterial = (meshName: string, material: THREE.Material | undefined) => {
    if (!material) {
      return;
    }
    const overlay = group.getObjectByName(meshName) as THREE.Mesh | null;
    if (overlay?.isMesh) {
      overlay.material = material;
    }
  };

  applyOverlayMaterial('RoadShoulders', resolvedMaterials[1]);
  applyOverlayMaterial('RoadLaneLines', resolvedMaterials[2]);

  deps.applyTransform(group, node);
  deps.applyVisibility(group, node);
  return group;
}
