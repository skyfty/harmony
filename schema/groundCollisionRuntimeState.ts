import * as THREE from 'three'

import type { GroundRuntimeDynamicMesh } from './index'

type GroundCollisionRuntimeKeyState = {
  appliedKeys: string[]
}

const groundCollisionRuntimeKeyStateMap = new WeakMap<THREE.Object3D, GroundCollisionRuntimeKeyState>()

function uniqueSortedGroundCollisionKeys(keys: Iterable<string> | null | undefined): string[] {
  return Array.from(
    new Set(
      Array.from(keys ?? [])
        .map((key) => (typeof key === 'string' ? key.trim() : ''))
        .filter((key) => key.length > 0),
    ),
  ).sort()
}

export function syncGroundCollisionRuntimeLoadedTileKeys(
  groundObject: THREE.Object3D,
  groundMesh: Pick<GroundRuntimeDynamicMesh, 'runtimeLoadedTileKeys'>,
  params: {
    compiledKeys?: Iterable<string> | null
    infiniteKeys?: Iterable<string> | null
  } = {},
): boolean {
  const compiledKeys = uniqueSortedGroundCollisionKeys(params.compiledKeys ?? [])
  const infiniteKeys = uniqueSortedGroundCollisionKeys(params.infiniteKeys ?? [])
  const nextAppliedKeys = uniqueSortedGroundCollisionKeys([
    ...compiledKeys,
    ...infiniteKeys,
  ])
  const state = groundCollisionRuntimeKeyStateMap.get(groundObject) ?? {
    appliedKeys: [],
  }
  const currentKeys = uniqueSortedGroundCollisionKeys(groundMesh.runtimeLoadedTileKeys)
  const nextRuntimeLoadedTileKeys = nextAppliedKeys
  const changed = nextRuntimeLoadedTileKeys.length !== currentKeys.length
    || nextRuntimeLoadedTileKeys.some((key, index) => key !== currentKeys[index])
  if (changed) {
    groundMesh.runtimeLoadedTileKeys = nextRuntimeLoadedTileKeys
  }
  state.appliedKeys = nextAppliedKeys
  groundCollisionRuntimeKeyStateMap.set(groundObject, state)
  return changed
}
