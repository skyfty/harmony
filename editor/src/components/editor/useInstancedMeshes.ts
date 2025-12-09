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

  function syncInstancedTransform(object: THREE.Object3D | null, includeChildren = false) {
    if (!object) {
      return
    }

    object.updateMatrixWorld(true)

    if (object.userData?.instancedAssetId) {
      const nodeId = object.userData.nodeId as string | undefined
      if (nodeId) {
        object.matrixWorld.decompose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper)
        const isVisible = object.visible !== false
        if (!isVisible) {
          instancedScaleHelper.setScalar(0)
        }
        instancedMatrixHelper.compose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper)
        updateModelInstanceMatrix(nodeId, instancedMatrixHelper)
        callbacks.syncInstancedOutlineEntryTransform(nodeId)
      }
    }

    if (!includeChildren) {
      return
    }

    const stack = [...object.children]
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) {
        continue
      }

      if (current.userData?.instancedAssetId) {
        const nodeId = current.userData.nodeId as string | undefined
        if (nodeId) {
          current.matrixWorld.decompose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper)
          const isVisible = current.visible !== false
          if (!isVisible) {
            instancedScaleHelper.setScalar(0)
          }
          instancedMatrixHelper.compose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper)
          updateModelInstanceMatrix(nodeId, instancedMatrixHelper)
          callbacks.syncInstancedOutlineEntryTransform(nodeId)
        }
      }

      const childCount = current.children?.length ?? 0
      if (childCount > 0) {
        for (let index = 0; index < childCount; index += 1) {
          const child = current.children[index]
          if (child) {
            stack.push(child)
          }
        }
      }
    }
  }

  function attachInstancedMesh(mesh: THREE.InstancedMesh) {
    if (instancedMeshes.includes(mesh)) {
      return
    }
    // InstancedMesh 使用共享几何体的包围体，默认视锥裁剪会把远离原始包围体的实例裁掉
    // 禁用 frustumCulled 以避免实例在某些相机角度下闪烁消失
    mesh.frustumCulled = false
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
