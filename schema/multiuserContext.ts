let currentSceneId: string | null = null

export type MultiuserSubjectType = 'vehicle' | 'character' | 'ship' | 'aircraft'
export type MultiuserSharedEntityMode = 'transform'
export type MultiuserOwnershipMode = 'lease'

export type MultiuserVector3Like = { x: number; y: number; z: number }
export type MultiuserQuaternionLike = { x: number; y: number; z: number; w: number }

export interface MultiuserIdentity {
  userId: string
  displayName?: string | null
}

export interface MultiuserPresentationVector3Like {
  x: number
  y: number
  z: number
}

export interface MultiuserPresentationQuaternionLike {
  x: number
  y: number
  z: number
  w: number
}

export interface MultiuserVehicleWheelPresentation {
  nodeId?: string | null
  wheelIndex: number
  position: MultiuserPresentationVector3Like
  quaternion: MultiuserPresentationQuaternionLike
  scale?: MultiuserPresentationVector3Like | null
  steeringAxis?: MultiuserPresentationVector3Like | null
  spinAxis?: MultiuserPresentationVector3Like | null
  steeringAngle?: number | null
  spinAngle?: number | null
}

export interface MultiuserVehiclePresentation {
  speedMps?: number | null
  linearVelocity?: MultiuserPresentationVector3Like | null
  wheels: MultiuserVehicleWheelPresentation[]
}

export interface MultiuserCharacterAnimationPresentation {
  clipName: string | null
  time: number
  duration: number
  loop: boolean
  timeScale: number
  normalizedTime?: number | null
}

export interface MultiuserCharacterPresentation {
  animation: MultiuserCharacterAnimationPresentation | null
}

export interface MultiuserPeerPresentationState {
  vehicle?: MultiuserVehiclePresentation | null
  character?: MultiuserCharacterPresentation | null
}

export interface MultiuserPeerState {
  subjectType: MultiuserSubjectType
  subjectNodeId: string | null
  subjectIdentifier?: string | null
  subjectAssetId?: string | null
  subjectAssetUrl?: string | null
  position: MultiuserVector3Like
  quaternion: MultiuserQuaternionLike
  scale: MultiuserVector3Like
  action?: string | null
  presentation?: MultiuserPeerPresentationState | null
}

export interface MultiuserPeerSnapshot {
  userId: string
  displayName: string
  state: MultiuserPeerState | null
}

export interface MultiuserSharedEntityTransform {
  position: MultiuserVector3Like
  quaternion: MultiuserQuaternionLike
  scale: MultiuserVector3Like
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

export interface MultiuserNodeSyncPresentation {
  vehicle?: MultiuserVehiclePresentation | null
  character?: MultiuserCharacterPresentation | null
}

export interface MultiuserNodeSyncState {
  entityId: string
  nodeId: string
  ownerUserId?: string | null
  mode: MultiuserSharedEntityMode
  transform: MultiuserSharedEntityTransform
  revision: number
  updatedAt: string
  lease?: MultiuserSharedEntityLease | null
  presentation?: MultiuserNodeSyncPresentation | null
}

export interface MultiuserNodeSyncSnapshot {
  entityId: string
  state: MultiuserNodeSyncState | null
}

export interface MultiuserRuntimeBridge {
  getIdentity(): MultiuserIdentity | null
  resolveLocalPeerState(): MultiuserPeerState | null
  resolveLocalNodeSyncStates(): MultiuserNodeSyncState[]
  handleRemotePeerSnapshot(peer: MultiuserPeerSnapshot): void
  handleRemotePeerLeft(userId: string): void
  handleRemoteNodeSyncSnapshot(snapshot: MultiuserNodeSyncSnapshot): void
  handleRemoteNodeSyncRemoved(entityId: string): void
  clearRemotePeers(): void
  clearRemoteNodeSync(): void
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
