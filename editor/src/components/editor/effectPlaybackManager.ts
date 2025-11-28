import type * as THREE from 'three'
import {
  GUIDEBOARD_RUNTIME_REGISTRY_KEY,
  WARP_GATE_RUNTIME_REGISTRY_KEY,
} from '@schema/components'
import type { GuideboardComponentProps, WarpGateComponentProps } from '@schema/components'

export type EffectPlaybackEntry = {
  id: string
  tick?: (delta: number) => void
  activate?: () => void
  deactivate?: () => void
}

export type EffectPlaybackManager = {
  refresh(selectedIds: readonly string[], objects: Map<string, THREE.Object3D>): void
  reset(objects: Map<string, THREE.Object3D>): void
  getTickers(): Array<(delta: number) => void>
}

type EffectRuntimeAdapter = {
  registryKey: string
  collect(object: THREE.Object3D, nodeId: string): EffectPlaybackEntry[]
  requiresSelection?: boolean
}

type WarpGateRuntimeRegistryEntry = {
  tick?: (delta: number) => void
  setPlaybackActive?: (active: boolean) => void
  props?: Partial<WarpGateComponentProps> | null
}

type GuideboardRuntimeRegistryEntry = {
  tick?: (delta: number) => void
  setPlaybackActive?: (active: boolean) => void
  props?: Partial<GuideboardComponentProps> | null
}

export function createEffectPlaybackManager(): EffectPlaybackManager {
  const activeEntries = new Map<string, EffectPlaybackEntry>()
  let currentTickers: Array<(delta: number) => void> = []

  const adapters: EffectRuntimeAdapter[] = [
    {
      registryKey: WARP_GATE_RUNTIME_REGISTRY_KEY,
      collect(object, nodeId) {
        const registry = object.userData?.[WARP_GATE_RUNTIME_REGISTRY_KEY] as
          | Record<string, WarpGateRuntimeRegistryEntry>
          | undefined
        if (!registry) {
          return []
        }
        return Object.entries(registry).map(([componentId, entry]) => {
          const playbackId = `${nodeId}:${WARP_GATE_RUNTIME_REGISTRY_KEY}:${componentId}`
          return {
            id: playbackId,
            tick: typeof entry.tick === 'function' ? entry.tick.bind(entry) : undefined,
            activate:
              typeof entry.setPlaybackActive === 'function'
                ? () => entry.setPlaybackActive?.(true)
                : undefined,
            deactivate:
              typeof entry.setPlaybackActive === 'function'
                ? () => entry.setPlaybackActive?.(false)
                : undefined,
          }
        })
      },
    },
    {
      registryKey: GUIDEBOARD_RUNTIME_REGISTRY_KEY,
      collect(object, nodeId) {
        const registry = object.userData?.[GUIDEBOARD_RUNTIME_REGISTRY_KEY] as
          | Record<string, GuideboardRuntimeRegistryEntry>
          | undefined
        if (!registry) {
          return []
        }
        return Object.entries(registry).map(([componentId, entry]) => {
          const playbackId = `${nodeId}:${GUIDEBOARD_RUNTIME_REGISTRY_KEY}:${componentId}`
          return {
            id: playbackId,
            tick: typeof entry?.tick === 'function' ? entry.tick.bind(entry) : undefined,
            activate:
              typeof entry?.setPlaybackActive === 'function'
                ? () => entry.setPlaybackActive?.(true)
                : undefined,
            deactivate:
              typeof entry?.setPlaybackActive === 'function'
                ? () => entry.setPlaybackActive?.(false)
                : undefined,
          }
        })
      },
    },
  ]

  function refresh(selectedIds: readonly string[], objects: Map<string, THREE.Object3D>): void {
    const selectedSet = new Set(selectedIds)
    const nextActive = new Map<string, EffectPlaybackEntry>()
    const nextTickers = new Set<(delta: number) => void>()
    const staleEntries = new Map<string, EffectPlaybackEntry>(activeEntries)

    objects.forEach((object, nodeId) => {
      adapters.forEach((adapter) => {
        const entries = adapter.collect(object, nodeId)
        if (!entries.length) {
          return
        }
        const isSelected = selectedSet.has(nodeId)
        const requiresSelection = adapter.requiresSelection !== false
        entries.forEach((entry) => {
          staleEntries.delete(entry.id)
          const shouldActivate = !requiresSelection || isSelected
          if (shouldActivate) {
            if (!activeEntries.has(entry.id)) {
              entry.activate?.()
            }
            nextActive.set(entry.id, entry)
            if (entry.tick) {
              nextTickers.add(entry.tick)
            }
          } else {
            entry.deactivate?.()
          }
        })
      })
    })

    staleEntries.forEach((entry) => {
      entry.deactivate?.()
    })

    activeEntries.clear()
    nextActive.forEach((entry, id) => {
      activeEntries.set(id, entry)
    })
    currentTickers = Array.from(nextTickers)
  }

  function reset(objects: Map<string, THREE.Object3D>): void {
    activeEntries.forEach((entry) => {
      entry.deactivate?.()
    })
    adapters.forEach((adapter) => {
      objects.forEach((object, nodeId) => {
        adapter.collect(object, nodeId).forEach((entry) => {
          entry.deactivate?.()
        })
      })
    })
    activeEntries.clear()
    currentTickers = []
  }

  function getTickers(): Array<(delta: number) => void> {
    return currentTickers
  }

  return { refresh, reset, getTickers }
}
