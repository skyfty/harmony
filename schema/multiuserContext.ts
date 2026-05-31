let currentSceneId: string | null = null

export type MultiuserSubjectType = 'vehicle' | 'character'
export type MultiuserSharedEntityMode = 'transform'
export type MultiuserOwnershipMode = 'lease'

export type MultiuserVector3Like = { x: number; y: number; z: number }
export type MultiuserQuaternionLike = { x: number; y: number; z: number; w: number }

export interface MultiuserIdentity {
  userId: string
  displayName?: string | null
}

export interface MultiuserPeerState {
  subjectType: MultiuserSubjectType
  subjectNodeId: string | null
  subjectIdentifier?: string | null
  subjectAssetId?: string | null
  subjectAssetUrl?: string | null
  position: MultiuserVector3Like
  quaternion: MultiuserQuaternionLike
  action?: string | null
}

export interface MultiuserPeerSnapshot {
  userId: string
  displayName: string
  state: MultiuserPeerState | null
}

export interface MultiuserSharedEntityTransform {
  position: MultiuserVector3Like
  quaternion: MultiuserQuaternionLike
  scale?: MultiuserVector3Like | null
}

export interface MultiuserSharedEntityLease {
  mode: MultiuserOwnershipMode
  leaseMs: number
}

export interface MultiuserSharedEntityState {
  entityId: string
  nodeId: string
  ownerUserId?: string | null
  mode: MultiuserSharedEntityMode
  transform: MultiuserSharedEntityTransform
  revision: number
  updatedAt: string
  lease?: MultiuserSharedEntityLease | null
}

export interface MultiuserSharedEntitySnapshot {
  entityId: string
  state: MultiuserSharedEntityState | null
}

export interface MultiuserRuntimeBridge {
  getIdentity(): MultiuserIdentity | null
  resolveLocalPeerState(): MultiuserPeerState | null
  resolveLocalSharedEntityStates(): MultiuserSharedEntityState[]
  handleRemotePeerSnapshot(peer: MultiuserPeerSnapshot): void
  handleRemotePeerLeft(userId: string): void
  handleRemoteSharedEntitySnapshot(snapshot: MultiuserSharedEntitySnapshot): void
  handleRemoteSharedEntityRemoved(entityId: string): void
  clearRemotePeers(): void
  clearRemoteSharedEntities(): void
}

let currentRuntimeBridge: MultiuserRuntimeBridge | null = null

export function setActiveMultiuserSceneId(sceneId: string | null): void {
  currentSceneId = sceneId
}

export function getActiveMultiuserSceneId(): string | null {
  return currentSceneId
}

export function setActiveMultiuserRuntimeBridge(bridge: MultiuserRuntimeBridge | null): void {
  currentRuntimeBridge = bridge
}

export function getActiveMultiuserRuntimeBridge(): MultiuserRuntimeBridge | null {
  return currentRuntimeBridge
}
