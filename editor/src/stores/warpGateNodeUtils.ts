import * as THREE from 'three'
import type { SceneBehavior, SceneNode, SceneNodeComponentState } from '@schema'
import {
  BEHAVIOR_COMPONENT_TYPE,
  WARP_GATE_COMPONENT_TYPE,
} from '@schema/components'
import { createBehaviorSequenceId, ensureBehaviorParams } from '@schema/behaviors/definitions'
import type { WarpGateComponentProps } from '@schema/components'
import { generateUuid } from '@/utils/uuid'
import { useSceneStore } from './sceneStore'

type SceneStoreLike = ReturnType<typeof useSceneStore>

export type WarpGateNodeCreationOptions = {
  name?: string | null
  parentId?: string | null
  position?: THREE.Vector3 | null
}

function collectNodeNames(nodes: SceneNode[] | undefined, names: Set<string>): void {
  if (!nodes?.length) {
    return
  }

  nodes.forEach((node) => {
    if (!node) {
      return
    }
    if (typeof node.name === 'string' && node.name.trim().length > 0) {
      names.add(node.name)
    }
    if (node.children?.length) {
      collectNodeNames(node.children, names)
    }
  })
}

export function getNextWarpGateName(nodes: SceneNode[] | undefined): string {
  const names = new Set<string>()
  collectNodeNames(nodes, names)
  const base = 'Warp Gate'
  if (!names.has(base)) {
    return base
  }

  let index = 1
  while (names.has(`${base} ${index}`)) {
    index += 1
  }
  return `${base} ${index}`
}

export function createWarpGateObject(name: string): THREE.Object3D {
  const warpGateMesh = new THREE.Object3D()
  warpGateMesh.name = `${name} Visual`
  warpGateMesh.castShadow = false
  warpGateMesh.receiveShadow = false
  warpGateMesh.userData = {
    ...(warpGateMesh.userData ?? {}),
    ignoreGridSnapping: true,
    warpGate: true,
  }

  const warpGateRoot = new THREE.Object3D()
  warpGateRoot.name = name
  warpGateRoot.add(warpGateMesh)
  warpGateRoot.userData = {
    ...(warpGateRoot.userData ?? {}),
    ignoreGridSnapping: true,
    warpGate: true,
  }

  return warpGateRoot
}

export async function createWarpGateNode(
  sceneStore: SceneStoreLike,
  options: WarpGateNodeCreationOptions = {},
): Promise<SceneNode | null> {
  const resolvedName = typeof options.name === 'string' && options.name.trim().length > 0
    ? options.name.trim()
    : getNextWarpGateName(sceneStore.nodes)

  const created = await sceneStore.addModelNode({
    object: createWarpGateObject(resolvedName),
    nodeType: 'WarpGate',
    name: resolvedName,
    baseY: 0,
    position: options.position?.clone() ?? new THREE.Vector3(0, 0, 0),
    parentId: options.parentId ?? undefined,
    snapToGrid: false,
    editorFlags: {
      ignoreGridSnapping: true,
    },
  })

  if (!created) {
    return null
  }

  const primaryMaterial = created.materials?.[0] ?? null
  if (primaryMaterial) {
    sceneStore.updateNodeMaterialProps(created.id, primaryMaterial.id, { side: 'double' })
  }

  let warpGateComponent = created.components?.[WARP_GATE_COMPONENT_TYPE] as
    | SceneNodeComponentState<WarpGateComponentProps>
    | undefined
  if (!warpGateComponent) {
    const added = sceneStore.addNodeComponent<typeof WARP_GATE_COMPONENT_TYPE>(created.id, WARP_GATE_COMPONENT_TYPE)
    warpGateComponent = added?.component
  }

  let behaviorComponent = created.components?.[BEHAVIOR_COMPONENT_TYPE] as
    | SceneNodeComponentState<{ behaviors: SceneBehavior[] }>
    | undefined
  if (!behaviorComponent) {
    const added = sceneStore.addNodeComponent<typeof BEHAVIOR_COMPONENT_TYPE>(created.id, BEHAVIOR_COMPONENT_TYPE)
    behaviorComponent = added?.component as SceneNodeComponentState<{ behaviors: SceneBehavior[] }> | undefined
  }

  const existingBehaviors = behaviorComponent?.props?.behaviors
  if (behaviorComponent && (!Array.isArray(existingBehaviors) || existingBehaviors.length === 0)) {
    const clickSequenceId = createBehaviorSequenceId()
    const approachSequenceId = createBehaviorSequenceId()
    const departSequenceId = createBehaviorSequenceId()
    const behaviors: SceneBehavior[] = [
      {
        id: generateUuid(),
        name: '',
        action: 'click',
        sequenceId: clickSequenceId,
        script: ensureBehaviorParams({
          type: 'moveTo',
          params: {
            targetNodeId: created.id,
            duration: 0.8,
          },
        }),
      },
      {
        id: generateUuid(),
        name: '',
        action: 'approach',
        sequenceId: approachSequenceId,
        script: ensureBehaviorParams({
          type: 'hide',
          params: {
            targetNodeId: created.id,
          },
        }),
      },
      {
        id: generateUuid(),
        name: '',
        action: 'depart',
        sequenceId: departSequenceId,
        script: ensureBehaviorParams({
          type: 'show',
          params: {
            targetNodeId: created.id,
          },
        }),
      },
    ]

    sceneStore.updateNodeComponentProps(created.id, behaviorComponent.id, { behaviors })
  }

  return created
}