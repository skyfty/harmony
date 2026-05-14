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

function parseGroundCollisionKey(key: string): { row: number; column: number } | null {
  const separatorIndex = key.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex >= key.length - 1 || key.indexOf(':', separatorIndex + 1) !== -1) {
    return null
  }
  const row = Number(key.slice(0, separatorIndex))
  const column = Number(key.slice(separatorIndex + 1))
  if (!Number.isFinite(row) || !Number.isFinite(column)) {
    return null
  }
  return {
    row: Math.trunc(row),
    column: Math.trunc(column),
  }
}

function selectNearInfiniteGroundCollisionKeys(keys: Iterable<string> | null | undefined): string[] {
  const parsed = uniqueSortedGroundCollisionKeys(keys)
  if (parsed.length <= 9) {
    return parsed
  }
  const coords = parsed
    .map((key) => ({ key, coord: parseGroundCollisionKey(key) }))
    .filter((entry): entry is { key: string; coord: { row: number; column: number } } => entry.coord != null)
  if (!coords.length) {
    return parsed
  }
  let minRow = Number.POSITIVE_INFINITY
  let maxRow = Number.NEGATIVE_INFINITY
  let minColumn = Number.POSITIVE_INFINITY
  let maxColumn = Number.NEGATIVE_INFINITY
  for (const entry of coords) {
    minRow = Math.min(minRow, entry.coord.row)
    maxRow = Math.max(maxRow, entry.coord.row)
    minColumn = Math.min(minColumn, entry.coord.column)
    maxColumn = Math.max(maxColumn, entry.coord.column)
  }
  const centerRow = Math.round((minRow + maxRow) * 0.5)
  const centerColumn = Math.round((minColumn + maxColumn) * 0.5)
  const radius = 1
  return coords
    .filter((entry) => Math.abs(entry.coord.row - centerRow) <= radius && Math.abs(entry.coord.column - centerColumn) <= radius)
    .map((entry) => entry.key)
    .sort()
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
  const infiniteKeys = selectNearInfiniteGroundCollisionKeys(params.infiniteKeys ?? [])
  const nextAppliedKeys = uniqueSortedGroundCollisionKeys([
    ...compiledKeys,
    ...infiniteKeys,
  ])
  const state = groundCollisionRuntimeKeyStateMap.get(groundObject) ?? {
    appliedKeys: [],
  }
  const currentKeys = uniqueSortedGroundCollisionKeys(groundMesh.runtimeLoadedTileKeys)
  const preservedKeys = currentKeys.filter((key) => !state.appliedKeys.includes(key))
  const nextRuntimeLoadedTileKeys = uniqueSortedGroundCollisionKeys([
    ...preservedKeys,
    ...nextAppliedKeys,
  ])
  const changed = nextRuntimeLoadedTileKeys.length !== currentKeys.length
    || nextRuntimeLoadedTileKeys.some((key, index) => key !== currentKeys[index])
  if (changed) {
    groundMesh.runtimeLoadedTileKeys = nextRuntimeLoadedTileKeys
  }
  state.appliedKeys = nextAppliedKeys
  groundCollisionRuntimeKeyStateMap.set(groundObject, state)
  return changed
}
