import * as THREE from 'three'
import type { SceneNode, SceneNodeComponentState } from '@schema'
import { WARP_GATE_COMPONENT_TYPE } from '@schema/components'
import type { WarpGateComponentProps } from '@schema/components'
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

  return created
}