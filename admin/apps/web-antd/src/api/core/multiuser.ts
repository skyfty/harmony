import { requestClient } from '#/api/request'

export interface MultiuserRuntimeVector3 {
  x: number
  y: number
  z: number
}

export interface MultiuserRuntimeQuaternion {
  x: number
  y: number
  z: number
  w: number
}

export interface MultiuserRuntimePeerPresentation {
  vehicle?: {
    wheels: Array<{
      nodeId?: string | null
      wheelIndex: number
      position: MultiuserRuntimeVector3
      quaternion: MultiuserRuntimeQuaternion
      scale?: MultiuserRuntimeVector3 | null
      steeringAxis?: MultiuserRuntimeVector3 | null
      spinAxis?: MultiuserRuntimeVector3 | null
      steeringAngle?: number | null
      spinAngle?: number | null
    }>
  } | null
  character?: {
    animation: {
      clipName: string | null
      time: number
      duration: number
      loop: boolean
      timeScale: number
      normalizedTime?: number | null
    } | null
  } | null
}

export interface MultiuserRuntimePeerState {
  subjectType: 'vehicle' | 'character'
  subjectNodeId: string | null
  subjectIdentifier?: string | null
  subjectAssetId?: string | null
  subjectAssetUrl?: string | null
  position: MultiuserRuntimeVector3
  quaternion: MultiuserRuntimeQuaternion
  action?: string | null
  presentation?: MultiuserRuntimePeerPresentation | null
}

export interface MultiuserRuntimePeerItem {
  sessionId: string
  userId: string
  displayName: string
  connectedAt: string
  lastActiveAt: string
  remoteAddress?: string | null
  forwardedFor?: string | null
  origin?: string | null
  userAgent?: string | null
  state: MultiuserRuntimePeerState | null
}

export interface MultiuserRuntimeEntityState {
  entityId: string
  nodeId: string
  ownerUserId?: string | null
  mode: 'transform'
  transform: {
    position: MultiuserRuntimeVector3
    quaternion: MultiuserRuntimeQuaternion
    scale?: MultiuserRuntimeVector3 | null
  }
  revision: number
  updatedAt: string
  lease?: {
    mode: 'lease'
    leaseMs: number
  } | null
}

export interface MultiuserRuntimeEntityItem {
  entityId: string
  state: MultiuserRuntimeEntityState | null
}

export interface MultiuserRuntimePhysicsAuthoritySnapshot {
  nodeId: string
  actorType: 'auto' | 'vehicle' | 'character'
  ownerUserId?: string | null
  tick: number
  revision: number
  updatedAt: string
  bodyId: number | null
  transform: {
    position: MultiuserRuntimeVector3
    quaternion: MultiuserRuntimeQuaternion
  }
  linearVelocity?: MultiuserRuntimeVector3 | null
  angularVelocity?: MultiuserRuntimeVector3 | null
  sleeping?: boolean
  contacts?: Array<{
    bodyIdA: number
    bodyIdB: number
    normal: MultiuserRuntimeVector3
    point: MultiuserRuntimeVector3
    impulse?: number | null
    impactSpeed?: number | null
  }> | null
}

export interface MultiuserRuntimePhysicsItem {
  nodeId: string
  snapshot: MultiuserRuntimePhysicsAuthoritySnapshot
}

export interface MultiuserRuntimeRoomItem {
  sceneId: string
  sceneName?: string | null
  userCount: number
  maxUsers: number
  entityCount: number
  physicsAuthorityCount: number
  updatedAt: string
}

export interface MultiuserRuntimeRoomDetail extends MultiuserRuntimeRoomItem {
  connections: MultiuserRuntimePeerItem[]
  entities: MultiuserRuntimeEntityItem[]
  physicsAuthority: MultiuserRuntimePhysicsItem[]
  activities: MultiuserRuntimeActivityItem[]
}

export interface MultiuserRuntimeActivityItem {
  id: string
  type:
    | 'peer-connected'
    | 'peer-disconnected'
    | 'peer-state'
    | 'entity-state'
    | 'entity-removed'
    | 'physics-input'
    | 'admin-kick-connection'
    | 'admin-kick-user'
    | 'admin-clear'
  sceneId: string
  sessionId: string | null
  userId: string | null
  displayName: string | null
  entityId: string | null
  nodeId: string | null
  summary: string
  createdAt: string
}

export interface MultiuserRuntimeSnapshot {
  rooms: MultiuserRuntimeRoomItem[]
  updatedAt: string
  changedSceneId?: string | null
}

export async function listMultiuserRuntimeRoomsApi() {
  return requestClient.get<{ rooms: MultiuserRuntimeRoomItem[]; updatedAt: string }>('/admin/multiuser/runtime')
}

export async function getMultiuserRuntimeRoomApi(sceneId: string) {
  return requestClient.get<MultiuserRuntimeRoomDetail>(`/admin/multiuser/runtime/${encodeURIComponent(sceneId)}`)
}

export async function kickMultiuserRuntimeConnectionApi(sceneId: string, sessionId: string) {
  return requestClient.post<{ ok: true }>(
    `/admin/multiuser/runtime/${encodeURIComponent(sceneId)}/peers/${encodeURIComponent(sessionId)}/kick`,
  )
}

export async function kickMultiuserRuntimeUserApi(sceneId: string, userId: string) {
  return requestClient.post<{ ok: true }>(
    `/admin/multiuser/runtime/${encodeURIComponent(sceneId)}/users/${encodeURIComponent(userId)}/kick`,
  )
}

export async function clearMultiuserRuntimeRoomApi(sceneId: string) {
  return requestClient.post<{ ok: true }>(`/admin/multiuser/runtime/${encodeURIComponent(sceneId)}/clear`)
}
