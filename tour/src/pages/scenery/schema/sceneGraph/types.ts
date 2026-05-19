import * as THREE from 'three';
import type { SceneNode, SceneNodeComponentMap, SceneNodeEditorFlags, LightShadowProperties } from '../index';

export type SceneNodeWithExtras = SceneNode & {
  light?: {
    type?: string;
    color?: string;
    intensity?: number;
    distance?: number;
    decay?: number;
    angle?: number;
    penumbra?: number;
    castShadow?: boolean;
    shadow?: LightShadowProperties;
    target?: THREE.Vector3;
  };
  dynamicMesh?: any;
  components?: SceneNodeComponentMap;
  editorFlags?: SceneNodeEditorFlags;
};
