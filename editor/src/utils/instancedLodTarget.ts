import type * as THREE from 'three'
import type { SceneNode, SceneNodeComponentState } from '@schema/core'
import { resolveInstancedLodTargetFromSnapshot } from '@schema/instancedLodSelection'
import { clampLodComponentProps, LOD_COMPONENT_TYPE, type LodComponentProps } from '@schema/components'

export type EditorInstancedLodTarget = {
  kind: 'model' | 'billboard'
  assetId: string
  sourceModelAssetId: string | null
  faceCamera: boolean
  forwardAxis: 'x' | 'y' | 'z'
  key: string
}

export type ResolveEditorInstancedLodTargetParams = {
  node: SceneNode
  object: THREE.Object3D
  cameraPosition?: { x: number; y: number; z: number } | null
  worldPosition: { x: number; y: number; z: number }
}

function resolveNodeLodProps(node: SceneNode): Partial<LodComponentProps> | null {
  const component = node.components?.[LOD_COMPONENT_TYPE] as SceneNodeComponentState<LodComponentProps> | undefined
  if (!component || !component.enabled) {
    return null
  }
  return clampLodComponentProps(component.props)
}

export function resolveEditorInstancedLodTarget(params: ResolveEditorInstancedLodTargetParams): EditorInstancedLodTarget | null {
  const target = resolveInstancedLodTargetFromSnapshot({
    sourceAssetId: typeof params.node.sourceAssetId === 'string' ? params.node.sourceAssetId : null,
    instanceLayout: (params.node as unknown as { instanceLayout?: unknown } | null)?.instanceLayout ?? null,
    lodProps: resolveNodeLodProps(params.node),
    worldPosition: params.worldPosition,
    cameraPosition: params.cameraPosition ?? null,
  })
  if (target.assetId) {
    return {
      kind: target.kind,
      assetId: target.assetId,
      sourceModelAssetId: target.sourceModelAssetId,
      faceCamera: target.faceCamera,
      forwardAxis: target.forwardAxis,
      key: target.key ?? `${target.kind}:${target.assetId}`,
    }
  }
  const currentAssetIdRaw = params.object.userData?.instancedAssetId
  const currentAssetId = typeof currentAssetIdRaw === 'string' ? currentAssetIdRaw.trim() : ''
  return currentAssetId
    ? {
      kind: 'model',
      assetId: currentAssetId,
      sourceModelAssetId: currentAssetId,
      faceCamera: false,
      forwardAxis: 'x',
      key: `model:${currentAssetId}`,
    }
    : null
}
