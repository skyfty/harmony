import * as THREE from 'three';
import type { SceneNodeComponentState } from '../core';
import type { SceneNodeWithExtras } from './types';

import type { GuideboardComponentProps } from '../components/definitions/guideboardComponent';
import {
  GUIDEBOARD_COMPONENT_TYPE,
  GUIDEBOARD_EFFECT_METADATA_KEY,
  clampGuideboardComponentProps,
  cloneGuideboardComponentProps,
} from '../components/definitions/guideboardComponent';

import type { ViewPointComponentProps } from '../components/definitions/viewPointComponent';
import { VIEW_POINT_COMPONENT_TYPE } from '../components/definitions/viewPointComponent';
import { PARTICLE_SYSTEM_COMPONENT_TYPE } from '../components/definitions/particleSystemComponent';

export function applyNodeMetadata(object: THREE.Object3D, node: SceneNodeWithExtras): void {
  if (!object || !node || !node.id) {
    return;
  }
  const metadata = object.userData ?? (object.userData = {});
  metadata.nodeId = node.id;
  const resolvedType = node.nodeType ?? (node.light ? 'Light' : node.dynamicMesh ? 'Mesh' : 'Group');
  metadata.nodeType = resolvedType;
  metadata.dynamicMeshType = node.dynamicMesh?.type ?? null;
  metadata.lightType = node.light?.type ?? null;
  metadata.sourceAssetId = node.sourceAssetId ?? null;

  const guideboardState = node.components?.[GUIDEBOARD_COMPONENT_TYPE] as
    | SceneNodeComponentState<GuideboardComponentProps>
    | undefined;
  if (guideboardState?.enabled) {
    metadata.isGuideboard = true;
    const props = clampGuideboardComponentProps(guideboardState.props as Partial<GuideboardComponentProps>);
    metadata.guideboardInitiallyVisible = props.initiallyVisible === true;
    metadata[GUIDEBOARD_EFFECT_METADATA_KEY] = cloneGuideboardComponentProps(props);
  }

  const viewPointState = node.components?.[VIEW_POINT_COMPONENT_TYPE] as
    | SceneNodeComponentState<ViewPointComponentProps>
    | undefined;
  if (viewPointState?.enabled) {
    metadata.viewPoint = true;
    const viewPointProps = viewPointState.props as ViewPointComponentProps | undefined;
    metadata.viewPointInitiallyVisible = viewPointProps?.initiallyVisible === true;
  }

  const particleSystemState = node.components?.[PARTICLE_SYSTEM_COMPONENT_TYPE] as
    | SceneNodeComponentState<unknown>
    | undefined;
  if (particleSystemState?.enabled && node.nodeType === 'WarpGate') {
    metadata.warpGate = true;
  }
}
