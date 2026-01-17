import * as THREE from 'three'
import {
  getModelInstanceBinding,
  getModelInstanceBindingById,
  getModelInstanceBindingsForNode,
  updateModelInstanceBindingMatrix,
  updateModelInstanceMatrix,
  type ModelInstanceBinding,
} from '@schema/modelObjectCache'
import type { SceneNode } from '@harmony/schema'
import { getContinuousInstancedModelUserData, syncContinuousInstancedModelCommitted } from '@schema/continuousInstancedModel'

export function useInstancedMeshes(
  instancedMeshGroup: THREE.Group,
  instancedMeshes: THREE.InstancedMesh[],
  callbacks: {
    syncInstancedOutlineEntryTransform: (nodeId: string) => void
    resolveSceneNodeById?: (nodeId: string) => SceneNode | null
    syncInstancedTransformOverride?: (params: {
      nodeId: string
      object: THREE.Object3D
      baseMatrix: THREE.Matrix4
      assetId?: string
      isVisible: boolean
      isCulled: boolean
    }) => boolean
  }
) {
  const instancedMatrixHelper = new THREE.Matrix4()
  const instancedScaleHelper = new THREE.Vector3()
  const instancedPositionHelper = new THREE.Vector3()
  const instancedQuaternionHelper = new THREE.Quaternion()

  type InstancedMatrixCacheEntry = {
    bindingKey: string
    elements: Float32Array
  }

  const instancedMatrixCache = new Map<string, InstancedMatrixCacheEntry>()

  type MultiBindingLocalCacheEntry = {
    bindingKey: string
    base: THREE.Matrix4
    baseInverse: THREE.Matrix4
    locals: Map<string, THREE.Matrix4>
  }

  const multiBindingLocalCache = new Map<string, MultiBindingLocalCacheEntry>()

  function buildModelInstanceBindingKey(binding: ModelInstanceBinding): string {
    return binding.slots.map((slot) => `${slot.mesh.uuid}:${slot.index}`).join('|')
  }

  function matrixElementsEqual(a: Float32Array, b: ArrayLike<number>, epsilon = 1e-7): boolean {
    for (let i = 0; i < 16; i += 1) {
      if (Math.abs(a[i]! - (b[i] ?? 0)) > epsilon) {
        return false
      }
    }
    return true
  }

  function copyMatrixElements(target: Float32Array, source: ArrayLike<number>): void {
    for (let i = 0; i < 16; i += 1) {
      target[i] = source[i] ?? 0
    }
  }

  function updateModelInstanceMatrixIfChanged(nodeId: string, matrix: THREE.Matrix4): void {
    const binding = getModelInstanceBinding(nodeId)
    if (!binding) {
      instancedMatrixCache.delete(nodeId)
      return
    }
    const bindingKey = buildModelInstanceBindingKey(binding)
    const cached = instancedMatrixCache.get(nodeId)
    if (cached && cached.bindingKey === bindingKey && matrixElementsEqual(cached.elements, matrix.elements)) {
      return
    }
    const nextEntry = cached ?? { bindingKey, elements: new Float32Array(16) }
    nextEntry.bindingKey = bindingKey
    copyMatrixElements(nextEntry.elements, matrix.elements)
    instancedMatrixCache.set(nodeId, nextEntry)
    updateModelInstanceMatrix(nodeId, matrix)
  }

  function updateModelInstanceBindingMatrixIfChanged(bindingId: string, matrix: THREE.Matrix4): void {
    const binding = getModelInstanceBindingById(bindingId)
    if (!binding) {
      instancedMatrixCache.delete(bindingId)
      return
    }
    const bindingKey = buildModelInstanceBindingKey(binding)
    const cached = instancedMatrixCache.get(bindingId)
    if (cached && cached.bindingKey === bindingKey && matrixElementsEqual(cached.elements, matrix.elements)) {
      return
    }
    const nextEntry = cached ?? { bindingKey, elements: new Float32Array(16) }
    nextEntry.bindingKey = bindingKey
    copyMatrixElements(nextEntry.elements, matrix.elements)
    instancedMatrixCache.set(bindingId, nextEntry)
    updateModelInstanceBindingMatrix(bindingId, matrix)
  }

  function buildMultiBindingKey(bindings: ModelInstanceBinding[]): string {
    return bindings
      .map((binding) => `${binding.bindingId}:${buildModelInstanceBindingKey(binding)}`)
      .sort()
      .join('\n')
  }

  function syncMultiBindingTransform(nodeId: string, baseMatrix: THREE.Matrix4): void {
    const bindings = getModelInstanceBindingsForNode(nodeId)
    if (!bindings.length) {
      multiBindingLocalCache.delete(nodeId)
      return
    }

    // Single-binding nodes are handled by the existing fast path.
    if (bindings.length === 1 && bindings[0]?.bindingId === nodeId) {
      multiBindingLocalCache.delete(nodeId)
      updateModelInstanceMatrixIfChanged(nodeId, baseMatrix)
      return
    }

    const nextBindingKey = buildMultiBindingKey(bindings)
    const cached = multiBindingLocalCache.get(nodeId)
    const needsRebuild = !cached || cached.bindingKey !== nextBindingKey
    const entry: MultiBindingLocalCacheEntry = cached ?? {
      bindingKey: nextBindingKey,
      base: new THREE.Matrix4(),
      baseInverse: new THREE.Matrix4(),
      locals: new Map<string, THREE.Matrix4>(),
    }

    if (needsRebuild) {
      entry.bindingKey = nextBindingKey
      entry.locals.clear()
      // Best-effort: derive locals from the currently committed instance matrices.
      // At steady state, those matrices were authored as: instance = base * local.
      // IMPORTANT: use the *current* baseMatrix as the reference to avoid drift.
      entry.base.copy(baseMatrix)
      entry.baseInverse.copy(baseMatrix).invert()

      for (const binding of bindings) {
        const slot = binding.slots[0]
        if (!slot) {
          continue
        }
        slot.mesh.getMatrixAt(slot.index, instancedMatrixHelper)
        const local = entry.locals.get(binding.bindingId) ?? new THREE.Matrix4()
        local.multiplyMatrices(entry.baseInverse, instancedMatrixHelper)
        entry.locals.set(binding.bindingId, local)
      }
    }

    // Apply new base to all locals.
    for (const binding of bindings) {
      const local = entry.locals.get(binding.bindingId)
      if (!local) {
        continue
      }
      instancedMatrixHelper.multiplyMatrices(baseMatrix, local)
      if (binding.bindingId === nodeId) {
        updateModelInstanceMatrixIfChanged(nodeId, instancedMatrixHelper)
      } else {
        updateModelInstanceBindingMatrixIfChanged(binding.bindingId, instancedMatrixHelper)
      }
    }

    entry.base.copy(baseMatrix)
    entry.baseInverse.copy(baseMatrix).invert()
    multiBindingLocalCache.set(nodeId, entry)
  }

  function primeMultiBindingLocalCache(nodeId: string, baseMatrix: THREE.Matrix4): void {
    const bindings = getModelInstanceBindingsForNode(nodeId)
    if (bindings.length <= 1) {
      return
    }

    const nextBindingKey = buildMultiBindingKey(bindings)
    const cached = multiBindingLocalCache.get(nodeId)
    if (cached && cached.bindingKey === nextBindingKey) {
      cached.base.copy(baseMatrix)
      cached.baseInverse.copy(baseMatrix).invert()
      return
    }

    const entry: MultiBindingLocalCacheEntry = {
      bindingKey: nextBindingKey,
      base: baseMatrix.clone(),
      baseInverse: baseMatrix.clone().invert(),
      locals: new Map<string, THREE.Matrix4>(),
    }

    for (const binding of bindings) {
      const slot = binding.slots[0]
      if (!slot) {
        continue
      }
      slot.mesh.getMatrixAt(slot.index, instancedMatrixHelper)
      const local = new THREE.Matrix4().multiplyMatrices(entry.baseInverse, instancedMatrixHelper)
      entry.locals.set(binding.bindingId, local)
    }

    multiBindingLocalCache.set(nodeId, entry)
  }

  function primeInstancedTransform(object: THREE.Object3D | null): void {
    if (!object?.userData?.instancedAssetId) {
      return
    }
    const nodeId = object.userData.nodeId as string | undefined
    if (!nodeId) {
      return
    }
    object.updateMatrixWorld(true)

    const isCulled = object.userData?.__harmonyCulled === true
    const isVisible = object.visible !== false

    // Preserve shear for visible objects by using matrixWorld directly.
    if (!isCulled && isVisible) {
      instancedMatrixHelper.copy(object.matrixWorld)
      primeMultiBindingLocalCache(nodeId, instancedMatrixHelper)
      return
    }

    // When culled/hidden, collapse scale to 0 but keep position/orientation.
    object.matrixWorld.decompose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper)
    instancedScaleHelper.setScalar(0)
    instancedMatrixHelper.compose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper)
    primeMultiBindingLocalCache(nodeId, instancedMatrixHelper)
  }

  function syncInstancedTransform(object: THREE.Object3D | null, includeChildren = false) {
    if (!object) {
      return
    }

    object.updateMatrixWorld(true)

    if (object.userData?.instancedAssetId) {
      const nodeId = object.userData.nodeId as string | undefined
      if (nodeId) {
        const assetId = object.userData.instancedAssetId as string | undefined
        const node = callbacks.resolveSceneNodeById ? callbacks.resolveSceneNodeById(nodeId) : null
        const isCulled = object.userData?.__harmonyCulled === true
        const isVisible = object.visible !== false
        if (isCulled || !isVisible) {
          object.matrixWorld.decompose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper)
          instancedScaleHelper.setScalar(0)
          instancedMatrixHelper.compose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper)
        } else {
          instancedMatrixHelper.copy(object.matrixWorld)
        }

        const handled = callbacks.syncInstancedTransformOverride?.({
          nodeId,
          object,
          baseMatrix: instancedMatrixHelper,
          assetId,
          isVisible,
          isCulled,
        })

        if (handled) {
          // handled by override
        } else if (isCulled || !isVisible) {
          syncMultiBindingTransform(nodeId, instancedMatrixHelper)
        } else if (assetId && node && getContinuousInstancedModelUserData(node)) {
          syncContinuousInstancedModelCommitted({ node, object, assetId })
        } else {
          syncMultiBindingTransform(nodeId, instancedMatrixHelper)
        }
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
          const assetId = current.userData.instancedAssetId as string | undefined
          const node = callbacks.resolveSceneNodeById ? callbacks.resolveSceneNodeById(nodeId) : null
          const isCulled = current.userData?.__harmonyCulled === true
          const isVisible = current.visible !== false
          if (isCulled || !isVisible) {
            current.matrixWorld.decompose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper)
            instancedScaleHelper.setScalar(0)
            instancedMatrixHelper.compose(instancedPositionHelper, instancedQuaternionHelper, instancedScaleHelper)
          } else {
            instancedMatrixHelper.copy(current.matrixWorld)
          }

          const handled = callbacks.syncInstancedTransformOverride?.({
            nodeId,
            object: current,
            baseMatrix: instancedMatrixHelper,
            assetId,
            isVisible,
            isCulled,
          })

          if (handled) {
            // handled by override
          } else if (isCulled || !isVisible) {
            syncMultiBindingTransform(nodeId, instancedMatrixHelper)
          } else if (assetId && node && getContinuousInstancedModelUserData(node)) {
            syncContinuousInstancedModelCommitted({ node, object: current, assetId })
          } else {
            syncMultiBindingTransform(nodeId, instancedMatrixHelper)
          }
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
    instancedMatrixCache.clear()
    multiBindingLocalCache.clear()
  }

  return {
    syncInstancedTransform,
    primeInstancedTransform,
    attachInstancedMesh,
    clearInstancedMeshes
  }
}
