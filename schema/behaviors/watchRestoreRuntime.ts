import * as THREE from 'three'
import type { MoveToSubjectType } from './moveToRuntime'

/**
 * Runtime snapshots of a controllable subject pose, captured before a Move To
 * mutates that subject. Watch can consume these snapshots when the viewer
 * leaves the watch (photo) state to put the character back where it stood.
 *
 * The store is intentionally provider agnostic: any future Watch restore
 * source (fixed pose, referenced node, named property, ...) can either record
 * into the same store or resolve a pose on its own.
 */
export type WatchRestorePoseSnapshot = {
  subjectType: MoveToSubjectType
  subjectNodeId: string | null
  position: THREE.Vector3
  quaternion: THREE.Quaternion
}

export type WatchRestorePoseStore = {
  snapshots: Map<string, WatchRestorePoseSnapshot>
}

/** Key used for camera snapshots, which have no owning node id. */
export const WATCH_RESTORE_CAMERA_SUBJECT_KEY = '__camera__'

export function resolveWatchRestorePoseKey(
  subjectType: MoveToSubjectType,
  subjectNodeId: string | null,
): string | null {
  if (subjectType === 'camera') {
    return WATCH_RESTORE_CAMERA_SUBJECT_KEY
  }
  const trimmed = typeof subjectNodeId === 'string' ? subjectNodeId.trim() : ''
  return trimmed.length ? trimmed : null
}

export function createWatchRestorePoseStore(): WatchRestorePoseStore {
  return {
    snapshots: new Map<string, WatchRestorePoseSnapshot>(),
  }
}

function isFiniteVector3(value: THREE.Vector3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)
}

function isFiniteQuaternion(value: THREE.Quaternion): boolean {
  return Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.z)
    && Number.isFinite(value.w)
}

/**
 * Record (overwrite) the restore pose for a subject. Snapshots without a
 * resolvable key or with non-finite values are ignored so a failed capture can
 * never teleport the subject on a later leave.
 */
export function recordWatchRestorePose(
  store: WatchRestorePoseStore,
  snapshot: WatchRestorePoseSnapshot,
): boolean {
  const key = resolveWatchRestorePoseKey(snapshot.subjectType, snapshot.subjectNodeId)
  if (!key) {
    return false
  }
  const { position, quaternion } = snapshot
  if (!isFiniteVector3(position) || !isFiniteQuaternion(quaternion)) {
    return false
  }
  store.snapshots.set(key, {
    subjectType: snapshot.subjectType,
    subjectNodeId: snapshot.subjectNodeId,
    position: position.clone(),
    quaternion: quaternion.clone(),
  })
  return true
}

export function resolveWatchRestorePose(
  store: WatchRestorePoseStore,
  subjectType: MoveToSubjectType,
  subjectNodeId: string | null,
): WatchRestorePoseSnapshot | null {
  const key = resolveWatchRestorePoseKey(subjectType, subjectNodeId)
  if (!key) {
    return null
  }
  return store.snapshots.get(key) ?? null
}

/** Read and drop the snapshot so a restore only ever runs once per capture. */
export function consumeWatchRestorePose(
  store: WatchRestorePoseStore,
  subjectType: MoveToSubjectType,
  subjectNodeId: string | null,
): WatchRestorePoseSnapshot | null {
  const key = resolveWatchRestorePoseKey(subjectType, subjectNodeId)
  if (!key) {
    return null
  }
  const snapshot = store.snapshots.get(key) ?? null
  if (snapshot) {
    store.snapshots.delete(key)
  }
  return snapshot
}

export function clearWatchRestorePoseStore(store: WatchRestorePoseStore): void {
  store.snapshots.clear()
}
