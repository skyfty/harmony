import { WebSocketServer, type WebSocket } from 'ws'
import { nanoid } from 'nanoid'

const DEFAULT_MAX_USERS_PER_SCENE = 32
const MAX_USERS_LIMIT = 128
const MIN_USERS_LIMIT = 2
const MIN_LEASE_MS = 250
const MAX_LEASE_MS = 30000

type Vector3 = { x: number; y: number; z: number }
type Quaternion = { x: number; y: number; z: number; w: number }
type MultiuserSubjectType = 'vehicle' | 'character'
type MultiuserSharedEntityMode = 'transform'
type MultiuserOwnershipMode = 'lease'

interface MultiuserPeerState {
  subjectType: MultiuserSubjectType
  subjectNodeId: string | null
  subjectIdentifier?: string | null
  subjectAssetId?: string | null
  subjectAssetUrl?: string | null
  position: Vector3
  quaternion: Quaternion
  action?: string | null
}

interface MultiuserSharedEntityTransform {
  position: Vector3
  quaternion: Quaternion
  scale?: Vector3 | null
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
}

interface StoredSharedEntity {
  entityId: string
  nodeId: string
  ownerUserId: string
  mode: MultiuserSharedEntityMode
  transform: MultiuserSharedEntityTransform
  revision: number
  updatedAt: string
  lease: MultiuserSharedEntityLease
  leaseExpiresAt: number
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

interface SceneClient {
  socket: WebSocket
  sessionId: string
  userId: string | null
  displayName: string
  state: MultiuserPeerState | null
  session: SceneSession | null
}

class SceneSession {
  public readonly clients = new Set<SceneClient>()
  public readonly sharedEntities = new Map<string, StoredSharedEntity>()

  constructor(public readonly sceneId: string, public maxUsers: number) {}

  isFull(): boolean {
    return this.clients.size >= this.maxUsers
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
  }

  removeClient(client: SceneClient): void {
    this.clients.delete(client)
    client.session = null
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

  releaseEntitiesOwnedBy(userId: string): string[] {
    const removed: string[] = []
    this.sharedEntities.forEach((entity, entityId) => {
      if (entity.ownerUserId !== userId) {
        return
      }
      this.sharedEntities.delete(entityId)
      removed.push(entityId)
    })
    return removed
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
  if ((candidate.subjectType !== 'vehicle' && candidate.subjectType !== 'character') || !isVector3(candidate.position) || !isQuaternion(candidate.quaternion)) {
    return null
  }
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
    action: normalizeOptionalText(candidate.action),
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
  if (!transformCandidate || !isVector3(transformCandidate.position) || !isQuaternion(transformCandidate.quaternion)) {
    return null
  }
  const scale = transformCandidate.scale
  const normalizedScale = isVector3(scale)
    ? { x: scale.x, y: scale.y, z: scale.z }
    : null
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
      scale: normalizedScale,
    },
    revision: Math.max(0, Math.trunc(Number(candidate.revision) || 0)),
    updatedAt: normalizeOptionalText(candidate.updatedAt) ?? new Date().toISOString(),
    lease: {
      mode: 'lease',
      leaseMs: clampLeaseMs((candidate.lease as Partial<MultiuserSharedEntityLease> | undefined)?.leaseMs),
    },
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
      scale: entity.transform.scale ? { ...entity.transform.scale } : null,
    },
    revision: entity.revision,
    updatedAt: entity.updatedAt,
    lease: {
      mode: entity.lease.mode,
      leaseMs: entity.lease.leaseMs,
    },
  }
}

export class MultiuserService {
  private wsServer: WebSocketServer | null = null
  private readonly sessions = new Map<string, SceneSession>()

  constructor(private readonly port: number) {}

  start(): void {
    if (this.wsServer) {
      return
    }
    this.wsServer = new WebSocketServer({ port: this.port })
    this.wsServer.on('connection', (socket) => this.handleConnection(socket))
    this.wsServer.on('listening', () => {
      console.log(`Multiuser service listening on ws://localhost:${this.port}`)
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

  private handleConnection(socket: WebSocket): void {
    const client: SceneClient = {
      socket,
      sessionId: nanoid(),
      userId: null,
      displayName: 'Guest',
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
      this.handleClientMessage(client, payload)
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

  private handleClientMessage(client: SceneClient, message: MultiuserClientMessage): void {
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
    const stored: StoredSharedEntity = {
      entityId: entity.entityId,
      nodeId: entity.nodeId,
      ownerUserId: client.userId,
      mode: 'transform',
      transform: {
        position: { ...entity.transform.position },
        quaternion: { ...entity.transform.quaternion },
        scale: entity.transform.scale ? { ...entity.transform.scale } : null,
      },
      revision: Math.max((existing?.revision ?? 0) + 1, entity.revision || 0),
      updatedAt: new Date(now).toISOString(),
      lease: {
        mode: 'lease',
        leaseMs,
      },
      leaseExpiresAt: now + leaseMs,
    }
    session.sharedEntities.set(entity.entityId, stored)
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
    const left: MultiuserServerMessage = {
      type: 'peer-left',
      sceneId: session.sceneId,
      userId: client.userId,
    }
    session.broadcast(left)
    const releasedEntityIds = session.releaseEntitiesOwnedBy(client.userId)
    releasedEntityIds.forEach((entityId) => {
      const removed: MultiuserServerMessage = {
        type: 'entity-removed',
        sceneId: session.sceneId,
        entityId,
      }
      session.broadcast(removed)
    })
    if (!session.clients.size) {
      this.sessions.delete(session.sceneId)
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
