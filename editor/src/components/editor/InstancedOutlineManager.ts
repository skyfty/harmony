import * as THREE from 'three'
import { getModelInstanceBindingsForNode } from '@schema/modelObjectCache'

type InstancedOutlineEntry = {
  group: THREE.Group
  proxies: Map<string, THREE.Mesh>
}

export type InstancedOutlineManager = {
  createInstancedProxy: (template: THREE.InstancedMesh) => THREE.Mesh
  syncProxyMatrixFromSlot: (proxy: THREE.Mesh, mesh: THREE.InstancedMesh, index: number) => void

  updateInstancedOutlineEntry: (nodeId: string, object: THREE.Object3D | null) => THREE.Mesh[]
  syncInstancedOutlineEntryTransform: (nodeId: string, object: THREE.Object3D | null) => { needsRebuild: boolean }

  releaseInstancedOutlineEntry: (nodeId: string) => void
  clearInstancedOutlineEntries: () => void
  getEntryNodeIds: () => string[]
}

export function createInstancedOutlineManager(options: { outlineGroup: THREE.Group }): InstancedOutlineManager {
  const { outlineGroup } = options

  const entries = new Map<string, InstancedOutlineEntry>()

  const matrixHelper = new THREE.Matrix4()
  const worldMatrixHelper = new THREE.Matrix4()

  const baseMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  })
  baseMaterial.toneMapped = false

  const getProxyMaterial = (source: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] => {
    if (Array.isArray(source)) {
      return source.map(() => baseMaterial)
    }
    return baseMaterial
  }

  const createInstancedProxy = (template: THREE.InstancedMesh): THREE.Mesh => {
    const proxyMaterial = getProxyMaterial(template.material as THREE.Material | THREE.Material[])
    const proxy = new THREE.Mesh(template.geometry, proxyMaterial)
    proxy.matrixAutoUpdate = false
    proxy.visible = false
    proxy.frustumCulled = false
    proxy.renderOrder = 9999
    return proxy
  }

  const syncProxyMatrixFromSlot = (proxy: THREE.Mesh, mesh: THREE.InstancedMesh, index: number) => {
    mesh.updateWorldMatrix(true, false)
    mesh.getMatrixAt(index, matrixHelper)
    worldMatrixHelper.multiplyMatrices(mesh.matrixWorld, matrixHelper)
    proxy.matrix.copy(worldMatrixHelper)
  }

  const ensureEntry = (nodeId: string): InstancedOutlineEntry => {
    let entry = entries.get(nodeId)
    if (!entry) {
      const group = new THREE.Group()
      group.name = `InstancedOutline:${nodeId}`
      outlineGroup.add(group)
      entry = {
        group,
        proxies: new Map<string, THREE.Mesh>(),
      }
      entries.set(nodeId, entry)
    } else if (entry.group.parent !== outlineGroup) {
      outlineGroup.add(entry.group)
    }
    entry.group.visible = true
    return entry
  }

  const releaseInstancedOutlineEntry = (nodeId: string) => {
    const entry = entries.get(nodeId)
    if (!entry) {
      return
    }
    entry.proxies.forEach((proxy) => {
      proxy.visible = false
      proxy.parent?.remove(proxy)
    })
    entry.proxies.clear()
    entry.group.clear()
    entry.group.visible = false
    entry.group.removeFromParent()
    entries.delete(nodeId)
  }

  const updateInstancedOutlineEntry = (nodeId: string, object: THREE.Object3D | null): THREE.Mesh[] => {
    const bindings = getModelInstanceBindingsForNode(nodeId)
    if (!bindings.length) {
      releaseInstancedOutlineEntry(nodeId)
      return []
    }

    const entry = ensureEntry(nodeId)
    const activeHandles = new Set<string>()
    const proxies: THREE.Mesh[] = []
    const isVisible = object?.visible !== false

    bindings.forEach((binding) => {
      binding.slots.forEach((slot) => {
        const { handleId, mesh, index } = slot
        const proxyKey = `${binding.bindingId}:${handleId}`
        let proxy = entry.proxies.get(proxyKey)
        if (!proxy) {
          proxy = createInstancedProxy(mesh)
          entry.proxies.set(proxyKey, proxy)
          entry.group.add(proxy)
        } else {
          if (proxy.geometry !== mesh.geometry) {
            proxy.geometry = mesh.geometry
          }
          if (Array.isArray(mesh.material)) {
            const current = Array.isArray(proxy.material) ? proxy.material : null
            if (!current || current.length !== mesh.material.length) {
              proxy.material = getProxyMaterial(mesh.material)
            }
          } else if (Array.isArray(proxy.material)) {
            proxy.material = baseMaterial
          }
          if (proxy.parent !== entry.group) {
            entry.group.add(proxy)
          }
        }

        syncProxyMatrixFromSlot(proxy, mesh, index)
        proxy.visible = isVisible && mesh.visible !== false
        proxies.push(proxy)
        activeHandles.add(proxyKey)
      })
    })

    const unusedHandles: string[] = []
    entry.proxies.forEach((_proxy, proxyKey) => {
      if (!activeHandles.has(proxyKey)) {
        unusedHandles.push(proxyKey)
      }
    })

    unusedHandles.forEach((proxyKey) => {
      const proxy = entry.proxies.get(proxyKey)
      if (!proxy) {
        return
      }
      proxy.visible = false
      proxy.parent?.remove(proxy)
      entry.proxies.delete(proxyKey)
    })

    entry.group.visible = proxies.some((proxy) => proxy.visible)
    return proxies.filter((proxy) => proxy.visible)
  }

  const syncInstancedOutlineEntryTransform = (
    nodeId: string,
    object: THREE.Object3D | null,
  ): { needsRebuild: boolean } => {
    const entry = entries.get(nodeId)
    if (!entry) {
      return { needsRebuild: false }
    }

    const bindings = getModelInstanceBindingsForNode(nodeId)
    if (!bindings.length || !object) {
      releaseInstancedOutlineEntry(nodeId)
      return { needsRebuild: true }
    }

    let needsRebuild = false
    const isVisible = object.visible !== false

    const activeHandles = new Set<string>()

    bindings.forEach((binding) => {
      binding.slots.forEach((slot) => {
        const proxyKey = `${binding.bindingId}:${slot.handleId}`
        activeHandles.add(proxyKey)
        const proxy = entry.proxies.get(proxyKey)
        if (!proxy) {
          needsRebuild = true
          return
        }
        const { mesh, index } = slot
        syncProxyMatrixFromSlot(proxy, mesh, index)
        proxy.visible = isVisible && mesh.visible !== false
      })
    })

    const unusedHandles: string[] = []
    entry.proxies.forEach((_proxy, proxyKey) => {
      if (!activeHandles.has(proxyKey)) {
        unusedHandles.push(proxyKey)
      }
    })

    if (unusedHandles.length) {
      needsRebuild = true
      unusedHandles.forEach((proxyKey) => {
        const proxy = entry.proxies.get(proxyKey)
        if (!proxy) {
          return
        }
        proxy.visible = false
        proxy.parent?.remove(proxy)
        entry.proxies.delete(proxyKey)
      })
    }

    entry.group.visible = Array.from(entry.proxies.values()).some((proxy) => proxy.visible)
    return { needsRebuild }
  }

  const clearInstancedOutlineEntries = () => {
    const nodeIds = Array.from(entries.keys())
    nodeIds.forEach((nodeId) => releaseInstancedOutlineEntry(nodeId))
  }

  const getEntryNodeIds = () => Array.from(entries.keys())

  return {
    createInstancedProxy,
    syncProxyMatrixFromSlot,
    updateInstancedOutlineEntry,
    syncInstancedOutlineEntryTransform,
    releaseInstancedOutlineEntry,
    clearInstancedOutlineEntries,
    getEntryNodeIds,
  }
}
