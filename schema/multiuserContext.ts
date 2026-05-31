let currentSceneId: string | null = null

export type MultiuserSubjectType = 'vehicle' | 'character'
export type MultiuserSharedEntityMode = 'transform'
export type MultiuserOwnershipMode = 'lease'
export type MultiuserPhysicsAuthorityActorType = 'auto' | 'vehicle' | 'character'

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

export interface MultiuserPhysicsAuthorityInput {
  nodeId: string
  actorType: MultiuserPhysicsAuthorityActorType
  inputSequence: number
  ownerUserId?: string | null
  leaseMs: number
  vehicle?: {
    vehicleId: number
    steering: number
    throttle: number
    brake: number
    handbrake?: number | null
  } | null
  character?: {
    moveX: number
    moveZ: number
    jump: boolean
    sprint: boolean
    crouch: boolean
    interact: boolean
  } | null
}

export interface MultiuserPhysicsAuthoritySnapshot {
  nodeId: string
  actorType: MultiuserPhysicsAuthorityActorType
  ownerUserId?: string | null
  tick: number
  revision: number
  updatedAt: string
  bodyId: number | null
  transform: {
    position: MultiuserVector3Like
    quaternion: MultiuserQuaternionLike
  }
  linearVelocity?: MultiuserVector3Like | null
  angularVelocity?: MultiuserVector3Like | null
  sleeping?: boolean
  contacts?: Array<{
    bodyIdA: number
    bodyIdB: number
    normal: MultiuserVector3Like
    point: MultiuserVector3Like
    impulse?: number | null
    impactSpeed?: number | null
  }> | null
}

export interface MultiuserRuntimeBridge {
  getIdentity(): MultiuserIdentity | null
  resolveLocalPeerState(): MultiuserPeerState | null
  resolveLocalSharedEntityStates(): MultiuserSharedEntityState[]
  resolveLocalPhysicsAuthorityInputs(): MultiuserPhysicsAuthorityInput[]
  handleRemotePeerSnapshot(peer: MultiuserPeerSnapshot): void
  handleRemotePeerLeft(userId: string): void
  handleRemoteSharedEntitySnapshot(snapshot: MultiuserSharedEntitySnapshot): void
  handleRemoteSharedEntityRemoved(entityId: string): void
  handleRemotePhysicsAuthoritySnapshot(snapshot: MultiuserPhysicsAuthoritySnapshot): void
  handleRemotePhysicsAuthorityRemoved(nodeId: string): void
  clearRemotePeers(): void
  clearRemoteSharedEntities(): void
  clearRemotePhysicsAuthority(): void
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
