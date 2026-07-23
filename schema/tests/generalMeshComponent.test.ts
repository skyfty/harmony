import test from 'node:test'
import assert from 'node:assert/strict'
import { Mesh, Object3D } from 'three'
import type { SceneNode } from '../core.ts'
import {
  GENERAL_MESH_COMPONENT_TYPE,
  clampGeneralMeshComponentProps,
  generalMeshComponentDefinition,
} from '../components/definitions/generalMeshComponent.ts'
import { canNodeUseRuntimeModelInstancing, collectRuntimeModelNodesByAssetId } from '../runtimeModelInstancing.ts'

function createNode(overrides: Partial<SceneNode> = {}): SceneNode {
  return {
    id: 'model',
    name: 'Model',
    nodeType: 'Mesh',
    sourceAssetId: 'asset:model',
    ...overrides,
  } as SceneNode
}

test('general mesh can only attach to sourced Mesh and Group nodes', () => {
  assert.equal(generalMeshComponentDefinition.canAttach(createNode()), true)
  assert.equal(generalMeshComponentDefinition.canAttach(createNode({ nodeType: 'Group' })), true)
  assert.equal(generalMeshComponentDefinition.canAttach(createNode({ sourceAssetId: undefined })), false)
  assert.equal(generalMeshComponentDefinition.canAttach(createNode({ nodeType: 'Light' })), false)
  assert.equal(generalMeshComponentDefinition.canAttach(createNode({ nodeType: 'Box' })), false)
})

test('general mesh defaults and normalizes frustum culling', () => {
  assert.equal(generalMeshComponentDefinition.createDefaultProps(createNode()).enableFrustumCulling, true)
  assert.equal(clampGeneralMeshComponentProps({ enableFrustumCulling: false }).enableFrustumCulling, false)
  assert.equal(clampGeneralMeshComponentProps({ enableFrustumCulling: 'false' as never }).enableFrustumCulling, true)
})

test('general mesh applies frustum culling to all descendant meshes', () => {
  const root = new Object3D()
  const parentMesh = new Mesh()
  const childMesh = new Mesh()
  root.add(parentMesh)
  parentMesh.add(childMesh)
  const component = generalMeshComponentDefinition.createInstance({
    nodeId: 'model',
    componentId: 'generalMesh-1',
    getRuntimeObject: () => root,
    getProps: () => ({ enableFrustumCulling: false }),
    isEnabled: () => true,
    getFrameState: () => ({ cameraWorldPosition: null }),
    markDirty: () => undefined,
  })

  component.onRuntimeAttached(root)
  assert.equal(parentMesh.frustumCulled, false)
  assert.equal(childMesh.frustumCulled, false)
})

test('enabled general mesh nodes bypass runtime model instancing', () => {
  const generalMeshNode = createNode({
    components: {
      [GENERAL_MESH_COMPONENT_TYPE]: {
        id: 'generalMesh-1',
        type: GENERAL_MESH_COMPONENT_TYPE,
        enabled: true,
        props: { enableFrustumCulling: true },
      },
    },
  })
  const regularNode = createNode({ id: 'regular', name: 'Regular' })

  assert.equal(canNodeUseRuntimeModelInstancing(generalMeshNode), false)
  assert.equal(canNodeUseRuntimeModelInstancing(regularNode), true)
  assert.equal(collectRuntimeModelNodesByAssetId([generalMeshNode]).size, 0)
  assert.deepEqual([...collectRuntimeModelNodesByAssetId([regularNode]).keys()], ['asset:model'])
})
