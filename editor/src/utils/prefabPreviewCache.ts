import * as THREE from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

export type LruCacheOptions = {
  maxEntries: number
}

type CacheEntry<T> = {
  value: T
  pinCount: number
}

export class PinnedLruCache<K, V> {
  private readonly maxEntries: number
  private readonly map = new Map<K, CacheEntry<V>>()

  constructor(options: LruCacheOptions) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries))
  }

  getPinned(key: K): { value: V; release: () => void } | null {
    const entry = this.map.get(key)
    if (!entry) {
      return null
    }

    // Touch
    this.map.delete(key)
    this.map.set(key, entry)

    entry.pinCount += 1

    let released = false
    const release = () => {
      if (released) {
        return
      }
      released = true
      entry.pinCount = Math.max(0, entry.pinCount - 1)
      this.evictIfNeeded()
    }

    return { value: entry.value, release }
  }

  set(key: K, value: V): void {
    const existing = this.map.get(key)
    if (existing) {
      existing.value = value
      // Touch
      this.map.delete(key)
      this.map.set(key, existing)
      this.evictIfNeeded()
      return
    }

    this.map.set(key, { value, pinCount: 0 })
    this.evictIfNeeded()
  }

  delete(key: K): void {
    this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }

  entries(): Array<[K, V]> {
    return Array.from(this.map.entries()).map(([key, entry]) => [key, entry.value])
  }

  private evictIfNeeded(): void {
    if (this.map.size <= this.maxEntries) {
      return
    }

    // Evict from oldest -> newest, skipping pinned entries.
    for (const [key, entry] of this.map) {
      if (this.map.size <= this.maxEntries) {
        return
      }
      if (entry.pinCount > 0) {
        continue
      }
      this.map.delete(key)
    }
  }
}

export function cloneObject3DShared(root: THREE.Object3D): THREE.Object3D {
  let hasSkinnedMesh = false
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if ((mesh as any).isSkinnedMesh) {
      hasSkinnedMesh = true
    }
  })

  const clone = hasSkinnedMesh ? (cloneSkeleton(root) as THREE.Object3D) : root.clone(true)
  copyMorphTargetState(root, clone)
  return clone
}

function copyMorphTargetState(sourceRoot: THREE.Object3D, cloneRoot: THREE.Object3D): void {
  const sourceNodes = sourceRoot.children.slice()
  const cloneNodes = cloneRoot.children.slice()

  const stack: Array<[THREE.Object3D, THREE.Object3D]> = []
  for (let i = 0; i < Math.min(sourceNodes.length, cloneNodes.length); i++) {
    stack.push([sourceNodes[i]!, cloneNodes[i]!])
  }

  while (stack.length > 0) {
    const [sourceNode, cloneNode] = stack.pop()!
    const sourceMesh = sourceNode as THREE.Mesh & {
      morphTargetDictionary?: Record<string, number>
      morphTargetInfluences?: number[]
    }
    const cloneMesh = cloneNode as THREE.Mesh & {
      morphTargetDictionary?: Record<string, number>
      morphTargetInfluences?: number[]
    }

    const sourceGeometry = sourceMesh.geometry as THREE.BufferGeometry | undefined
    const morphAttributes = sourceGeometry?.morphAttributes
    const morphTargets = morphAttributes?.position || morphAttributes?.normal || morphAttributes?.color || null

    if (sourceMesh.morphTargetInfluences && sourceMesh.morphTargetInfluences.length > 0) {
      cloneMesh.morphTargetInfluences = sourceMesh.morphTargetInfluences.slice()
    } else if (morphTargets && morphTargets.length > 0) {
      cloneMesh.morphTargetInfluences = new Array(morphTargets.length).fill(0)
    }
    if (sourceMesh.morphTargetDictionary) {
      cloneMesh.morphTargetDictionary = { ...sourceMesh.morphTargetDictionary }
    } else if (morphTargets && morphTargets.length > 0) {
      const dictionary: Record<string, number> = {}
      morphTargets.forEach((_, index) => {
        dictionary[index] = index
      })
      cloneMesh.morphTargetDictionary = dictionary
    }

    const sourceChildren = sourceNode.children
    const cloneChildren = cloneNode.children
    for (let i = 0; i < Math.min(sourceChildren.length, cloneChildren.length); i++) {
      stack.push([sourceChildren[i]!, cloneChildren[i]!])
    }
  }
}
