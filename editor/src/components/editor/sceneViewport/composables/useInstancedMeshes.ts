import * as THREE from 'three'
import { updateModelInstanceMatrix } from '@schema/modelObjectCache'

export function useInstancedMeshes(
  instancedMeshGroup: THREE.Group,
  instancedMeshes: THREE.InstancedMesh[],
  callbacks: {
    syncInstancedOutlineEntryTransform: (nodeId: string) => void
  }
) {
  const instancedMatrixHelper = new THREE.Matrix4()
  const instancedScaleHelper = new THREE.Vector3()
  const instancedPositionHelper = new THREE.Vector3()
  const instancedQuaternionHelper = new THREE.Quaternion()

  function syncInstancedTransform(object: THREE.Object3D | null) {
    if (!object?.userData?.instancedAssetId) {
      return
    }
    const nodeId = object.userData.nodeId as string | undefined
    if (!nodeId) {
      return
    }
    object.updateMatrixWorld(true)
    object.matrixWorld.decompose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper)
    const isVisible = object.visible !== false
    if (!isVisible) {
      instancedScaleHelper.setScalar(0)
    }
    instancedMatrixHelper.compose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper)
    updateModelInstanceMatrix(nodeId, instancedMatrixHelper)
    callbacks.syncInstancedOutlineEntryTransform(nodeId)
  }

  function attachInstancedMesh(mesh: THREE.InstancedMesh) {
    if (instancedMeshes.includes(mesh)) {
      return
    }
    instancedMeshes.push(mesh)
    instancedMeshGroup.add(mesh)
  }

  function clearInstancedMeshes() {
    instancedMeshes.splice(0, instancedMeshes.length).forEach((mesh) => {
      instancedMeshGroup.remove(mesh)
    })
  }

  return {
    syncInstancedTransform,
    attachInstancedMesh,
    clearInstancedMeshes
  }
}
