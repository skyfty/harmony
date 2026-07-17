import type { IncomingMessage } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { nanoid } from 'nanoid'
import { appConfig } from '@/config/env'

const DEFAULT_MAX_USERS_PER_SCENE = 32
const MAX_USERS_LIMIT = 128
const MIN_USERS_LIMIT = 2
const MIN_LEASE_MS = 250
const MAX_LEASE_MS = 30000

type Vector3 = { x: number; y: number; z: number }
type Quaternion = { x: number; y: number; z: number; w: number }
type MultiuserSubjectType = 'vehicle' | 'character' | 'ship' | 'aircraft'
type MultiuserSharedEntityMode = 'transform'
type MultiuserOwnershipMode = 'lease'

interface MultiuserVehicleWheelPresentation {
  nodeId?: string | null
  wheelIndex: number
  position: Vector3
  quaternion: Quaternion
  scale?: Vector3 | null
  steeringAxis?: Vector3 | null
  spinAxis?: Vector3 | null
  steeringAngle?: number | null
  spinAngle?: number | null
}

interface MultiuserVehiclePresentation {
  speedMps?: number | null
  linearVelocity?: Vector3 | null
  wheels: MultiuserVehicleWheelPresentation[]
}

interface MultiuserCharacterAnimationPresentation {
  clipName: string | null
  time: number
  duration: number
  loop: boolean
  timeScale: number
  normalizedTime?: number | null
}

interface MultiuserCharacterPresentation {
  animation: MultiuserCharacterAnimationPresentation | null
}

interface MultiuserPeerPresentationState {
  vehicle?: MultiuserVehiclePresentation | null
  character?: MultiuserCharacterPresentation | null
}

interface MultiuserNodeSyncPresentation {
  vehicle?: MultiuserVehiclePresentation | null
  character?: MultiuserCharacterPresentation | null
}

interface MultiuserPeerState {
  subjectType: MultiuserSubjectType
  subjectNodeId: string | null
  subjectIdentifier?: string | null
  subjectAssetId?: string | null
  subjectAssetUrl?: string | null
  position: Vector3
  quaternion: Quaternion
  scale: Vector3
  action?: string | null
  presentation?: MultiuserPeerPresentationState | null
}

interface MultiuserSharedEntityTransform {
  position: Vector3
  quaternion: Quaternion
  scale: Vector3
}

interface MultiuserSharedEntityLease {
  mode: MultiuserOwnershipMode
  leaseMs: number
}

interface MultiuserSharedEntityState {
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

interface StoredSharedEntity {
  entityId: string
  nodeId: string
  ownerUserId: string | null
  mode: MultiuserSharedEntityMode
  transform: MultiuserSharedEntityTransform
  revision: number
  updatedAt: string
  lease: MultiuserSharedEntityLease
  leaseExpiresAt: number
  presentation: MultiuserNodeSyncPresentation | null
}

interface MultiuserJoinMessage {
  type: 'join'
  sceneId: string
  userId?: string | null
  displayName?: string | null
  maxUsers?: number | null
}

interface MultiuserStateMessage {
  type: 'state'
  state: MultiuserPeerState
}

interface MultiuserEntityStateMessage {
  type: 'entity-state'
  entity: MultiuserSharedEntityState
}

type MultiuserClientMessage = MultiuserJoinMessage | MultiuserStateMessage | MultiuserEntityStateMessage

interface MultiuserPeerSnapshot {
  userId: string
  displayName: string
  state: MultiuserPeerState | null
}

interface MultiuserSharedEntitySnapshot {
  entityId: string
  state: MultiuserSharedEntityState | null
}

type MultiuserServerMessage =
  | { type: 'welcome'; sceneId: string; userId: string; peers: MultiuserPeerSnapshot[]; entities: MultiuserSharedEntitySnapshot[] }
  | { type: 'peer-joined'; sceneId: string; peer: MultiuserPeerSnapshot }
  | { type: 'peer-state'; sceneId: string; userId: string; peer: MultiuserPeerSnapshot }
  | { type: 'peer-left'; sceneId: string; userId: string }
  | { type: 'entity-state'; sceneId: string; entity: MultiuserSharedEntitySnapshot }
  | { type: 'entity-removed'; sceneId: string; entityId: string }
  | { type: 'error'; reason?: string }

export interface MultiuserRuntimeConnectionSummary {
  sessionId: string
  userId: string
  displayName: string
  connectedAt: string
  lastActiveAt: string
  remoteAddress: string | null
  forwardedFor: string | null
  origin: string | null
  userAgent: string | null
  state: MultiuserPeerState | null
}

export interface MultiuserRuntimeEntitySummary {
  entityId: string
  state: MultiuserSharedEntitySnapshot['state']
}

export interface MultiuserRuntimeActivitySummary {
  id: string
  type:
    | 'peer-connected'
    | 'peer-disconnected'
    | 'peer-state'
    | 'entity-state'
    | 'entity-removed'
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

export interface MultiuserRuntimeRoomSummary {
  sceneId: string
  userCount: number
  maxUsers: number
  entityCount: number
  nodeSyncCount: number
  updatedAt: string
}

export interface MultiuserRuntimeRoomDetail extends MultiuserRuntimeRoomSummary {
  connections: MultiuserRuntimeConnectionSummary[]
  entities: MultiuserRuntimeEntitySummary[]
  activities: MultiuserRuntimeActivitySummary[]
}

export interface MultiuserRuntimeSnapshot {
  rooms: MultiuserRuntimeRoomSummary[]
  updatedAt: string
}

interface SceneClient {
  socket: WebSocket
  sessionId: string
  userId: string | null
  displayName: string
  connectedAt: string
  lastActiveAt: string
  remoteAddress: string | null
  forwardedFor: string | null
  origin: string | null
  userAgent: string | null
  state: MultiuserPeerState | null
  session: SceneSession | null
}

class SceneSession {
  public readonly clients = new Set<SceneClient>()
  public readonly sharedEntities = new Map<string, StoredSharedEntity>()
  public readonly activities: MultiuserRuntimeActivitySummary[] = []
  public readonly createdAt: string = new Date().toISOString()
  public updatedAt: string = this.createdAt

  constructor(public readonly sceneId: string, public maxUsers: number) {}

  isFull(): boolean {
    return this.clients.size >= this.maxUsers
  }

  touch(timestamp = new Date().toISOString()): void {
    this.updatedAt = timestamp
  }

  recordActivity(activity: Omit<MultiuserRuntimeActivitySummary, 'id' | 'createdAt' | 'sceneId'>): void {
    this.activities.unshift({
      id: nanoid(),
      createdAt: new Date().toISOString(),
      sceneId: this.sceneId,
      ...activity,
    })
    if (this.activities.length > 50) {
      this.activities.length = 50
    }
  }

  broadcast(message: MultiuserServerMessage, options?: { exclude?: SceneClient | null }): void {
    const payload = JSON.stringify(message)
    this.clients.forEach((client) => {
      if (options?.exclude && options.exclude === client) {
        return
      }
      try {
        client.socket.send(payload)
      } catch (error) {
        console.warn('Failed to broadcast multiuser message', error)
      }
    })
  }

  addClient(client: SceneClient): void {
    this.clients.add(client)
    client.session = this
    this.touch(client.connectedAt)
  }

  removeClient(client: SceneClient): void {
    this.clients.delete(client)
    client.session = null
    this.touch()
  }

  getPeerSnapshots(exclude?: SceneClient): MultiuserPeerSnapshot[] {
    const snapshots: MultiuserPeerSnapshot[] = []
    this.clients.forEach((client) => {
      if (exclude && exclude === client) {
        return
      }
      if (!client.userId) {
        return
      }
      snapshots.push({
        userId: client.userId,
        displayName: client.displayName,
        state: client.state,
      })
    })
    return snapshots
  }

  getConnectionSummaries(): MultiuserRuntimeConnectionSummary[] {
    return Array.from(this.clients.values()).map((client) => ({
      sessionId: client.sessionId,
      userId: client.userId ?? client.sessionId,
      displayName: client.displayName,
      connectedAt: client.connectedAt,
      lastActiveAt: client.lastActiveAt,
      remoteAddress: client.remoteAddress,
      forwardedFor: client.forwardedFor,
      origin: client.origin,
      userAgent: client.userAgent,
      state: client.state,
    }))
  }

  getConnectionBySessionId(sessionId: string): SceneClient | null {
    return Array.from(this.clients.values()).find((client) => client.sessionId === sessionId) ?? null
  }

  getConnectionsByUserId(userId: string): SceneClient[] {
    return Array.from(this.clients.values()).filter((client) => client.userId === userId)
  }

  getEntitySnapshots(): MultiuserSharedEntitySnapshot[] {
    const now = Date.now()
    const snapshots: MultiuserSharedEntitySnapshot[] = []
    this.sharedEntities.forEach((entity, entityId) => {
      if (entity.leaseExpiresAt <= now) {
        this.sharedEntities.delete(entityId)
        return
      }
      snapshots.push({
        entityId,
        state: toSharedEntityState(entity),
      })
    })
    return snapshots
  }

  getEntitySummaries(): MultiuserRuntimeEntitySummary[] {
    return this.getEntitySnapshots().map((entity) => ({
      entityId: entity.entityId,
      state: entity.state,
    }))
  }

  releaseEntitiesOwnedBy(userId: string): string[] {
    const removed: string[] = []
    this.sharedEntities.forEach((entity, entityId) => {
      if (entity.ownerUserId !== userId) {
        return
      }
      entity.ownerUserId = null
      entity.leaseExpiresAt = 0
      removed.push(entityId)
    })
    this.touch()
    return removed
  }

  clear(): void {
    this.clients.clear()
    this.sharedEntities.clear()
    this.touch()
  }

  getActivities(): MultiuserRuntimeActivitySummary[] {
    return [...this.activities]
  }

  getSummary(): MultiuserRuntimeRoomSummary {
    const entityCount = this.getEntitySnapshots().length
    return {
      sceneId: this.sceneId,
      userCount: this.clients.size,
      maxUsers: this.maxUsers,
      entityCount,
      nodeSyncCount: entityCount,
      updatedAt: this.updatedAt,
    }
  }
}

function clampSceneMaxUsers(value: number | undefined | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_USERS_PER_SCENE
  }
  const rounded = Math.round(value)
  if (rounded < MIN_USERS_LIMIT) {
    return MIN_USERS_LIMIT
  }
  if (rounded > MAX_USERS_LIMIT) {
    return MAX_USERS_LIMIT
  }
  return rounded
}

function clampLeaseMs(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return 3000
  }
  const rounded = Math.round(numeric)
  return Math.min(MAX_LEASE_MS, Math.max(MIN_LEASE_MS, rounded))
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function isVector3(value: unknown): value is Vector3 {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<Vector3>
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y) && Number.isFinite(candidate.z)
}

function isQuaternion(value: unknown): value is Quaternion {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<Quaternion>
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y) && Number.isFinite(candidate.z) && Number.isFinite(candidate.w)
}

function normalizePeerState(value: unknown): MultiuserPeerState | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as Partial<MultiuserPeerState>
  if ((candidate.subjectType !== 'vehicle' && candidate.subjectType !== 'character' && candidate.subjectType !== 'ship' && candidate.subjectType !== 'aircraft') || !isVector3(candidate.position) || !isVector3(candidate.scale) || !isQuaternion(candidate.quaternion)) {
    return null
  }
  const presentation = normalizePeerPresentation(candidate.presentation)
  return {
    subjectType: candidate.subjectType,
    subjectNodeId: normalizeOptionalText(candidate.subjectNodeId),
    subjectIdentifier: normalizeOptionalText(candidate.subjectIdentifier),
    subjectAssetId: normalizeOptionalText(candidate.subjectAssetId),
    subjectAssetUrl: normalizeOptionalText(candidate.subjectAssetUrl),
    position: {
      x: candidate.position.x,
      y: candidate.position.y,
      z: candidate.position.z,
    },
    quaternion: {
      x: candidate.quaternion.x,
      y: candidate.quaternion.y,
      z: candidate.quaternion.z,
      w: candidate.quaternion.w,
    },
    scale: {
      x: candidate.scale.x,
      y: candidate.scale.y,
      z: candidate.scale.z,
    },
    action: normalizeOptionalText(candidate.action),
    presentation,
  }
}

function normalizeVehiclePresentation(value: unknown): MultiuserVehiclePresentation | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as Partial<MultiuserVehiclePresentation> & { wheels?: unknown }
  if (!Array.isArray(candidate.wheels)) {
    return null
  }
  const wheels: MultiuserVehicleWheelPresentation[] = []
  candidate.wheels.forEach((wheel: unknown, index: number) => {
    if (!wheel || typeof wheel !== 'object') {
      return
    }
    const item = wheel as Partial<MultiuserVehicleWheelPresentation>
    if (!isVector3(item.position) || !isQuaternion(item.quaternion)) {
      return
    }
    wheels.push({
      nodeId: normalizeOptionalText(item.nodeId),
      wheelIndex: Number.isFinite(item.wheelIndex) ? Math.max(0, Math.trunc(item.wheelIndex as number)) : index,
      position: {
        x: item.position.x,
        y: item.position.y,
        z: item.position.z,
      },
      quaternion: {
        x: item.quaternion.x,
        y: item.quaternion.y,
        z: item.quaternion.z,
        w: item.quaternion.w,
      },
      scale: isVector3(item.scale)
        ? {
            x: item.scale.x,
            y: item.scale.y,
            z: item.scale.z,
          }
        : null,
      steeringAxis: isVector3(item.steeringAxis)
        ? {
            x: item.steeringAxis.x,
            y: item.steeringAxis.y,
            z: item.steeringAxis.z,
          }
        : null,
      spinAxis: isVector3(item.spinAxis)
        ? {
            x: item.spinAxis.x,
            y: item.spinAxis.y,
            z: item.spinAxis.z,
          }
        : null,
      steeringAngle: typeof item.steeringAngle === 'number' && Number.isFinite(item.steeringAngle)
        ? item.steeringAngle
        : null,
      spinAngle: typeof item.spinAngle === 'number' && Number.isFinite(item.spinAngle)
        ? item.spinAngle
        : null,
    })
  })
  return {
    speedMps: typeof candidate.speedMps === 'number' && Number.isFinite(candidate.speedMps) ? candidate.speedMps : null,
    linearVelocity: isVector3(candidate.linearVelocity)
      ? {
          x: candidate.linearVelocity.x,
          y: candidate.linearVelocity.y,
          z: candidate.linearVelocity.z,
        }
      : null,
    wheels,
  }
}

function normalizeCharacterPresentation(value: unknown): MultiuserCharacterPresentation | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as Partial<MultiuserCharacterPresentation> & { animation?: unknown }
  if (!candidate.animation || typeof candidate.animation !== 'object') {
    return null
  }
  const animation = candidate.animation as Partial<MultiuserCharacterAnimationPresentation> & { loop?: unknown }
  const clipName = normalizeOptionalText(animation.clipName)
  const time = typeof animation.time === 'number' && Number.isFinite(animation.time) ? animation.time : 0
  const duration = typeof animation.duration === 'number' && Number.isFinite(animation.duration) ? Math.max(0, animation.duration) : 0
  const timeScale = typeof animation.timeScale === 'number' && Number.isFinite(animation.timeScale) ? animation.timeScale : 1
  const normalizedTime = typeof animation.normalizedTime === 'number' && Number.isFinite(animation.normalizedTime)
    ? animation.normalizedTime
    : null
  return {
    animation: {
      clipName,
      time,
      duration,
      loop: Boolean(animation.loop),
      timeScale,
      normalizedTime,
    },
  }
}

function normalizePeerPresentation(value: unknown): MultiuserPeerPresentationState | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as Partial<MultiuserPeerPresentationState>
  const vehicle = candidate.vehicle ? normalizeVehiclePresentation(candidate.vehicle) : null
  const character = candidate.character ? normalizeCharacterPresentation(candidate.character) : null
  if (!vehicle && !character) {
    return null
  }
  return {
    vehicle,
    character,
  }
}

function normalizeSharedEntityState(value: unknown): MultiuserSharedEntityState | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as Partial<MultiuserSharedEntityState>
  const entityId = normalizeOptionalText(candidate.entityId)
  const nodeId = normalizeOptionalText(candidate.nodeId)
  if (!entityId || !nodeId || candidate.mode !== 'transform') {
    return null
  }
  const transformCandidate = candidate.transform as Partial<MultiuserSharedEntityTransform> | undefined
  if (!transformCandidate || !isVector3(transformCandidate.position) || !isVector3(transformCandidate.scale) || !isQuaternion(transformCandidate.quaternion)) {
    return null
  }

  const presentation = normalizePeerPresentation((candidate as { presentation?: unknown }).presentation) as MultiuserNodeSyncPresentation | null
  return {
    entityId,
    nodeId,
    ownerUserId: normalizeOptionalText(candidate.ownerUserId),
    mode: 'transform',
    transform: {
      position: {
        x: transformCandidate.position.x,
        y: transformCandidate.position.y,
        z: transformCandidate.position.z,
      },
      quaternion: {
        x: transformCandidate.quaternion.x,
        y: transformCandidate.quaternion.y,
        z: transformCandidate.quaternion.z,
        w: transformCandidate.quaternion.w,
      },
      scale: {
        x: transformCandidate.scale.x,
        y: transformCandidate.scale.y, 
        z: transformCandidate.scale.z 
      },
    },
    revision: Math.max(0, Math.trunc(Number(candidate.revision) || 0)),
    updatedAt: normalizeOptionalText(candidate.updatedAt) ?? new Date().toISOString(),
    lease: {
      mode: 'lease',
      leaseMs: clampLeaseMs((candidate.lease as Partial<MultiuserSharedEntityLease> | undefined)?.leaseMs),
    },
    presentation,
  }
}

function toSharedEntityState(entity: StoredSharedEntity): MultiuserSharedEntityState {
  return {
    entityId: entity.entityId,
    nodeId: entity.nodeId,
    ownerUserId: entity.ownerUserId,
    mode: entity.mode,
    transform: {
      position: { ...entity.transform.position },
      quaternion: { ...entity.transform.quaternion },
      scale:  { ...entity.transform.scale },
    },
    revision: entity.revision,
    updatedAt: entity.updatedAt,
    lease: {
      mode: entity.lease.mode,
      leaseMs: entity.lease.leaseMs,
    },
    presentation: (entity as StoredSharedEntity & { presentation?: MultiuserNodeSyncPresentation | null }).presentation ?? null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export class MultiuserService {
  private wsServer: WebSocketServer | null = null
  private readonly sessions = new Map<string, SceneSession>()
  private readonly runtimeListeners = new Set<(snapshot: MultiuserRuntimeSnapshot & { changedSceneId: string | null }) => void>()
  private runtimeSnapshotUpdatedAt = new Date().toISOString()

  constructor(private readonly port: number) {}

  subscribeRuntimeSnapshot(listener: (snapshot: MultiuserRuntimeSnapshot & { changedSceneId: string | null }) => void): () => void {
    this.runtimeListeners.add(listener)
    listener(this.getRuntimeSnapshot(null))
    return () => {
      this.runtimeListeners.delete(listener)
    }
  }

  getRuntimeSnapshot(changedSceneId: string | null = null): MultiuserRuntimeSnapshot & { changedSceneId: string | null } {
    return {
      rooms: this.getRuntimeRoomSummaries(),
      updatedAt: this.runtimeSnapshotUpdatedAt,
      changedSceneId,
    }
  }

  getRuntimeRoomSummaries(): MultiuserRuntimeRoomSummary[] {
    return Array.from(this.sessions.values())
      .map((session) => session.getSummary())
      .sort((left, right) => {
        if (left.updatedAt === right.updatedAt) {
          return left.sceneId.localeCompare(right.sceneId)
        }
        return right.updatedAt.localeCompare(left.updatedAt)
      })
  }

  getRuntimeRoomDetail(sceneId: string): MultiuserRuntimeRoomDetail | null {
    const session = this.sessions.get(sceneId)
    if (!session) {
      return null
    }
    return {
      ...session.getSummary(),
      connections: session.getConnectionSummaries(),
      entities: session.getEntitySummaries(),
      activities: session.getActivities(),
    }
  }

  kickRuntimeRoomConnection(sceneId: string, sessionId: string): boolean {
    const session = this.sessions.get(sceneId)
    if (!session) {
      return false
    }
    const client = session.getConnectionBySessionId(sessionId)
    if (!client) {
      return false
    }
    session.recordActivity({
      type: 'admin-kick-connection',
      sessionId: client.sessionId,
      userId: client.userId,
      displayName: client.displayName,
      entityId: null,
      nodeId: null,
      summary: `管理员断开连接 ${client.displayName} (${client.sessionId})`,
    })
    try {
      client.socket.close(4000, 'ADMIN_KICK')
    } catch (error) {
      console.warn('Failed to kick multiuser connection', error)
    }
    session.touch()
    this.emitRuntimeSnapshot(sceneId)
    return true
  }

  kickRuntimeRoomUser(sceneId: string, userId: string): boolean {
    const session = this.sessions.get(sceneId)
    if (!session) {
      return false
    }
    const clients = session.getConnectionsByUserId(userId)
    if (!clients.length) {
      return false
    }
    session.recordActivity({
      type: 'admin-kick-user',
      sessionId: clients[0]?.sessionId ?? null,
      userId,
      displayName: clients[0]?.displayName ?? null,
      entityId: null,
      nodeId: null,
      summary: `管理员断开用户 ${userId} 的全部连接`,
    })
    clients.forEach((client) => {
      try {
        client.socket.close(4000, 'ADMIN_KICK')
      } catch (error) {
        console.warn('Failed to kick multiuser user connection', error)
      }
    })
    session.touch()
    this.emitRuntimeSnapshot(sceneId)
    return true
  }

  clearRuntimeRoom(sceneId: string): boolean {
    const session = this.sessions.get(sceneId)
    if (!session) {
      return false
    }
    session.recordActivity({
      type: 'admin-clear',
      sessionId: null,
      userId: null,
      displayName: null,
      entityId: null,
      nodeId: null,
      summary: '管理员清空房间',
    })
    const clients = Array.from(session.clients.values())
    this.sessions.delete(sceneId)
    session.clear()
    clients.forEach((client) => {
      try {
        client.socket.close(4000, 'ADMIN_CLEAR')
      } catch (error) {
        console.warn('Failed to clear multiuser connection', error)
      }
    })
    this.emitRuntimeSnapshot(sceneId)
    return true
  }

  private emitRuntimeSnapshot(changedSceneId: string | null): void {
    this.runtimeSnapshotUpdatedAt = new Date().toISOString()
    const snapshot = this.getRuntimeSnapshot(changedSceneId)
    this.runtimeListeners.forEach((listener) => {
      try {
        listener(snapshot)
      } catch (error) {
        console.warn('Failed to notify multiuser runtime listener', error)
      }
    })
  }

  start(): void {
    if (this.wsServer) {
      return
    }
    this.wsServer = new WebSocketServer({ port: this.port })
    this.wsServer.on('connection', (socket, request) => this.handleConnection(socket, request))
    this.wsServer.on('listening', () => {
      console.log(`Multiuser service listening on wss://muluser.v.touchmagic.cn:${this.port}`)
    })
  }

  async stop(): Promise<void> {
    if (!this.wsServer) {
      return
    }
    const server = this.wsServer
    this.wsServer = null
    this.sessions.forEach((session) => {
      session.clients.forEach((client) => {
        try {
          client.socket.close()
        } catch (error) {
          console.warn('Failed to close multiuser socket', error)
        }
      })
    })
    this.sessions.clear()
    return new Promise((resolve) => {
      server.close(() => resolve())
    })
  }

  private handleConnection(socket: WebSocket, request?: IncomingMessage): void {
    const headers = request?.headers ?? {}
    const forwardedFor = this.normalizeForwardedFor(headers['x-forwarded-for'])
    const origin = this.normalizeHeaderValue(headers.origin)
    const userAgent = this.normalizeHeaderValue(headers['user-agent'])
    const remoteAddress = this.normalizeHeaderValue(request?.socket?.remoteAddress)
      ?? this.normalizeHeaderValue((socket as WebSocket & { _socket?: { remoteAddress?: string | null } })._socket?.remoteAddress)
    const client: SceneClient = {
      socket,
      sessionId: nanoid(),
      userId: null,
      displayName: 'Guest',
      connectedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      remoteAddress,
      forwardedFor,
      origin,
      userAgent,
      state: null,
      session: null,
    }

    socket.on('message', (data) => {
      const payload = this.parseMessage(data)
      if (!payload) {
        this.sendError(socket, 'Invalid message payload')
        socket.close()
        return
      }
      client.lastActiveAt = new Date().toISOString()
      void this.handleClientMessage(client, payload)
    })

    socket.on('close', () => {
      this.handleClientDisconnection(client)
    })

    socket.on('error', (error) => {
      console.warn('Multiuser socket error', error)
    })
  }

  private parseMessage(data: string | Buffer | ArrayBuffer | Buffer[]): MultiuserClientMessage | null {
    const raw =
      typeof data === 'string'
        ? data
        : data instanceof ArrayBuffer
          ? Buffer.from(data).toString('utf-8')
          : Array.isArray(data)
            ? Buffer.concat(data).toString('utf-8')
            : data.toString('utf-8')
    try {
      return JSON.parse(raw) as MultiuserClientMessage
    } catch {
      return null
    }
  }

  private async handleClientMessage(client: SceneClient, message: MultiuserClientMessage): Promise<void> {
    if (message.type === 'join') {
      this.handleJoin(client, message)
      return
    }
    if (message.type === 'state') {
      this.handleState(client, message.state)
      return
    }
    if (message.type === 'entity-state') {
      this.handleEntityState(client, message.entity)
      return
    }
    this.sendError(client.socket, 'Unknown message type')
  }

  private handleJoin(client: SceneClient, message: MultiuserJoinMessage): void {
    if (client.session) {
      this.sendError(client.socket, 'Already joined a scene')
      return
    }
    const sceneId = normalizeOptionalText(message.sceneId)
    if (!sceneId) {
      this.sendError(client.socket, 'Scene ID is required')
      return
    }
    const maxUsers = clampSceneMaxUsers(message.maxUsers ?? undefined)
    let session = this.sessions.get(sceneId)
    if (!session) {
      session = new SceneSession(sceneId, maxUsers)
      this.sessions.set(sceneId, session)
    } else {
      session.maxUsers = Math.max(session.clients.size + 1, maxUsers)
    }
    if (session.isFull()) {
      this.sendError(client.socket, 'Scene has reached the user limit')
      return
    }

    client.userId = normalizeOptionalText(message.userId) ?? client.sessionId
    client.displayName = normalizeOptionalText(message.displayName) ?? `Guest-${client.userId.slice(0, 6)}`

    session.addClient(client)
    session.recordActivity({
      type: 'peer-connected',
      sessionId: client.sessionId,
      userId: client.userId,
      displayName: client.displayName,
      entityId: null,
      nodeId: null,
      summary: `${client.displayName} 加入房间`,
    })
    this.emitRuntimeSnapshot(sceneId)
    const peers = session.getPeerSnapshots(client)
    const entities = session.getEntitySnapshots()
    const welcome: MultiuserServerMessage = {
      type: 'welcome',
      sceneId,
      userId: client.userId,
      peers,
      entities,
    }
    client.socket.send(JSON.stringify(welcome))
    const joinedMessage: MultiuserServerMessage = {
      type: 'peer-joined',
      sceneId,
      peer: {
        userId: client.userId,
        displayName: client.displayName,
        state: client.state,
      },
    }
    session.broadcast(joinedMessage, { exclude: client })
  }

  private normalizeHeaderValue(value: string | string[] | undefined | null): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed.length ? trimmed : null
    }
    if (Array.isArray(value)) {
      const first = value.find((item) => item.trim().length > 0)
      return first ? first.trim() : null
    }
    return null
  }

  private normalizeForwardedFor(value: string | string[] | undefined | null): string | null {
    const normalized = this.normalizeHeaderValue(value)
    if (!normalized) {
      return null
    }
    const first = normalized.split(',')[0]?.trim()
    return first?.length ? first : null
  }

  private handleState(client: SceneClient, rawState: unknown): void {
    const session = client.session
    if (!session || !client.userId) {
      this.sendError(client.socket, 'Must join a scene before sending state')
      return
    }
    const state = normalizePeerState(rawState)
    if (!state) {
      this.sendError(client.socket, 'Invalid peer state')
      return
    }
    client.state = state
    client.lastActiveAt = new Date().toISOString()
    session.touch(client.lastActiveAt)
    session.recordActivity({
      type: 'peer-state',
      sessionId: client.sessionId,
      userId: client.userId,
      displayName: client.displayName,
      entityId: null,
      nodeId: state.subjectNodeId,
      summary: `${client.displayName} 更新角色状态${state.action ? ` · ${state.action}` : ''}`,
    })
    this.emitRuntimeSnapshot(session.sceneId)
    const peer = {
      userId: client.userId,
      displayName: client.displayName,
      state,
    }
    const message: MultiuserServerMessage = {
      type: 'peer-state',
      sceneId: session.sceneId,
      userId: client.userId,
      peer,
    }
    session.broadcast(message, { exclude: client })
  }

  private handleEntityState(client: SceneClient, rawEntity: unknown): void {
    const session = client.session
    if (!session || !client.userId) {
      this.sendError(client.socket, 'Must join a scene before sending entity state')
      return
    }
    const entity = normalizeSharedEntityState(rawEntity)
    if (!entity) {
      this.sendError(client.socket, 'Invalid entity state')
      return
    }
    const now = Date.now()
    const existing = session.sharedEntities.get(entity.entityId) ?? null
    if (existing && existing.ownerUserId !== client.userId && existing.leaseExpiresAt > now) {
      const message: MultiuserServerMessage = {
        type: 'entity-state',
        sceneId: session.sceneId,
        entity: {
          entityId: existing.entityId,
          state: toSharedEntityState(existing),
        },
      }
      try {
        client.socket.send(JSON.stringify(message))
      } catch (error) {
        console.warn('Failed to send authoritative entity state to denied client', error)
      }
      return
    }
    const leaseMs = clampLeaseMs(entity.lease?.leaseMs)
    client.lastActiveAt = new Date().toISOString()
    const stored: StoredSharedEntity = {
      entityId: entity.entityId,
      nodeId: entity.nodeId,
      ownerUserId: client.userId,
      mode: 'transform',
      transform: {
        position: { ...entity.transform.position },
        quaternion: { ...entity.transform.quaternion },
        scale: { ...entity.transform.scale },
      },
      revision: Math.max((existing?.revision ?? 0) + 1, entity.revision || 0),
      updatedAt: new Date(now).toISOString(),
      lease: {
        mode: 'lease',
        leaseMs,
      },
      leaseExpiresAt: now + leaseMs,
      presentation: entity.presentation ? {
        vehicle: entity.presentation.vehicle ? {
          speedMps: entity.presentation.vehicle.speedMps ?? null,
          linearVelocity: entity.presentation.vehicle.linearVelocity ? { ...entity.presentation.vehicle.linearVelocity } : null,
          wheels: entity.presentation.vehicle.wheels.map((wheel) => ({
            nodeId: wheel.nodeId ?? null,
            wheelIndex: wheel.wheelIndex,
            position: { ...wheel.position },
            quaternion: { ...wheel.quaternion },
            scale: wheel.scale ? { ...wheel.scale } : null,
            steeringAxis: wheel.steeringAxis ? { ...wheel.steeringAxis } : null,
            spinAxis: wheel.spinAxis ? { ...wheel.spinAxis } : null,
            steeringAngle: wheel.steeringAngle ?? null,
            spinAngle: wheel.spinAngle ?? null,
          })),
        } : null,
        character: entity.presentation.character ? {
          animation: entity.presentation.character.animation ? {
            clipName: entity.presentation.character.animation.clipName,
            time: entity.presentation.character.animation.time,
            duration: entity.presentation.character.animation.duration,
            loop: entity.presentation.character.animation.loop,
            timeScale: entity.presentation.character.animation.timeScale,
            normalizedTime: entity.presentation.character.animation.normalizedTime ?? null,
          } : null,
        } : null,
      } : null,
    }
    session.sharedEntities.set(entity.entityId, stored)
    session.touch()
    session.recordActivity({
      type: 'entity-state',
      sessionId: client.sessionId,
      userId: client.userId,
      displayName: client.displayName,
      entityId: entity.entityId,
      nodeId: entity.nodeId,
      summary: `${client.displayName} 更新实体 ${entity.entityId}`,
    })
    this.emitRuntimeSnapshot(session.sceneId)
    const message: MultiuserServerMessage = {
      type: 'entity-state',
      sceneId: session.sceneId,
      entity: {
        entityId: stored.entityId,
        state: toSharedEntityState(stored),
      },
    }
    session.broadcast(message, { exclude: client })
  }

  private handleClientDisconnection(client: SceneClient): void {
    const session = client.session
    if (!session || !client.userId) {
      return
    }
    session.removeClient(client)
    session.recordActivity({
      type: 'peer-disconnected',
      sessionId: client.sessionId,
      userId: client.userId,
      displayName: client.displayName,
      entityId: null,
      nodeId: null,
      summary: `${client.displayName} 离开房间`,
    })
    this.emitRuntimeSnapshot(session.sceneId)
    const left: MultiuserServerMessage = {
      type: 'peer-left',
      sceneId: session.sceneId,
      userId: client.userId,
    }
    session.broadcast(left)
    const releasedEntityIds = session.releaseEntitiesOwnedBy(client.userId)
    releasedEntityIds.forEach((entityId) => {
      const entity = session.sharedEntities.get(entityId)
      if (!entity) {
        return
      }
      const removed: MultiuserServerMessage = {
        type: 'entity-state',
        sceneId: session.sceneId,
        entity: {
          entityId,
          state: toSharedEntityState(entity),
        },
      }
      session.broadcast(removed)
    })
    if (!session.clients.size) {
      this.sessions.delete(session.sceneId)
      this.emitRuntimeSnapshot(session.sceneId)
    }
  }

  private sendError(socket: WebSocket, reason: string): void {
    try {
      socket.send(JSON.stringify({ type: 'error', reason } satisfies MultiuserServerMessage))
    } catch (error) {
      console.warn('Failed to send multiuser error message', error)
    }
  }
}

let activeMultiuserService: MultiuserService | null = null

export function setActiveMultiuserService(service: MultiuserService | null): void {
  activeMultiuserService = service
}

export function getActiveMultiuserService(): MultiuserService | null {
  return activeMultiuserService
}
