import type { IncomingMessage } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { nanoid } from 'nanoid'
import fs from 'fs-extra'
import path from 'node:path'
import { appConfig } from '@/config/env'
import { SceneModel } from '@/models/Scene'
import { createCannonPhysicsController } from '@harmony/physics-cannon'
import {
  decodeScenePackageSceneDocument,
  readBinaryFileFromScenePackage,
  unzipScenePackage,
  type SceneJsonExportDocument,
  type SceneNode,
} from '@harmony/schema/core'
import { buildPhysicsSceneAsset } from '@harmony/schema/physicsSceneAsset'
import {
  PHYSICS_AUTHORITY_COMPONENT_TYPE,
  type PhysicsAuthorityComponentProps,
} from '@harmony/schema/components'
import {
  CHARACTER_CONTROLLER_COMPONENT_TYPE,
  type CharacterControllerComponentProps,
  clampCharacterControllerComponentProps,
} from '@harmony/schema/components/definitions/characterControllerComponent'
import type {
  MultiuserPhysicsAuthorityActorType,
  MultiuserPhysicsAuthorityInput,
  MultiuserPhysicsAuthoritySnapshot,
} from '@harmony/schema/multiuserContext'

const DEFAULT_MAX_USERS_PER_SCENE = 32
const MAX_USERS_LIMIT = 128
const MIN_USERS_LIMIT = 2
const MIN_LEASE_MS = 250
const MAX_LEASE_MS = 30000
const DEFAULT_AUTH_PHYSICS_TICK_MS = 33
const AUTHORITY_DEFAULT_LEASE_MS = 3000

type Vector3 = { x: number; y: number; z: number }
type Quaternion = { x: number; y: number; z: number; w: number }
type MultiuserSubjectType = 'vehicle' | 'character'
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

interface MultiuserPeerState {
  subjectType: MultiuserSubjectType
  subjectNodeId: string | null
  subjectIdentifier?: string | null
  subjectAssetId?: string | null
  subjectAssetUrl?: string | null
  position: Vector3
  quaternion: Quaternion
  action?: string | null
  presentation?: MultiuserPeerPresentationState | null
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
  ownerUserId: string | null
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

interface MultiuserPhysicsInputMessage {
  type: 'physics-input'
  input: MultiuserPhysicsAuthorityInput
}

type MultiuserClientMessage = MultiuserJoinMessage | MultiuserStateMessage | MultiuserEntityStateMessage | MultiuserPhysicsInputMessage

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
  | { type: 'physics-snapshot'; sceneId: string; snapshot: MultiuserPhysicsAuthoritySnapshot }
  | { type: 'physics-removed'; sceneId: string; nodeId: string }
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

export interface MultiuserRuntimePhysicsAuthoritySummary {
  nodeId: string
  snapshot: MultiuserPhysicsAuthoritySnapshot
}

export interface MultiuserRuntimeRoomSummary {
  sceneId: string
  userCount: number
  maxUsers: number
  entityCount: number
  physicsAuthorityCount: number
  updatedAt: string
}

export interface MultiuserRuntimeRoomDetail extends MultiuserRuntimeRoomSummary {
  connections: MultiuserRuntimeConnectionSummary[]
  entities: MultiuserRuntimeEntitySummary[]
  physicsAuthority: MultiuserRuntimePhysicsAuthoritySummary[]
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
  public authoritativePhysicsRoom: AuthoritativePhysicsRoom | null = null
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
      physicsAuthorityCount: this.authoritativePhysicsRoom?.getLatestSnapshots().length ?? 0,
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

function rotateAxisByQuaternion(quaternion: Quaternion, x: number, y: number, z: number): Vector3 {
  const qx = quaternion.x
  const qy = quaternion.y
  const qz = quaternion.z
  const qw = quaternion.w
  const ix = qw * x + qy * z - qz * y
  const iy = qw * y + qz * x - qx * z
  const iz = qw * z + qx * y - qy * x
  const iw = -qx * x - qy * y - qz * z
  return {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
    y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
  }
}

function normalizePeerState(value: unknown): MultiuserPeerState | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as Partial<MultiuserPeerState>
  if ((candidate.subjectType !== 'vehicle' && candidate.subjectType !== 'character') || !isVector3(candidate.position) || !isQuaternion(candidate.quaternion)) {
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

function resolveAbsoluteSceneFilePath(fileKey: string): string {
  const normalizedKey = fileKey.replace(/\\+/g, '/').replace(/^\/+/u, '')
  const root = path.resolve(appConfig.assetStoragePath)
  const absolute = path.resolve(root, normalizedKey)
  if (!absolute.startsWith(root)) {
    throw new Error('Invalid scene file path')
  }
  return absolute
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizePhysicsAuthorityComponentProps(
  props: Partial<PhysicsAuthorityComponentProps> | null | undefined,
): PhysicsAuthorityComponentProps {
  const clampBoolean = (value: unknown, fallback: boolean): boolean => {
    if (typeof value === 'boolean') {
      return value
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (normalized === 'true') {
        return true
      }
      if (normalized === 'false') {
        return false
      }
    }
    return fallback
  }
  const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
    const numeric = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(numeric)) {
      return fallback
    }
    return Math.min(max, Math.max(min, Math.round(numeric)))
  }
  const clampNullableInteger = (value: unknown, min: number, max: number): number | null => {
    if (value === null || value === undefined || value === '') {
      return null
    }
    const numeric = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(numeric)) {
      return null
    }
    return Math.min(max, Math.max(min, Math.round(numeric)))
  }
  return {
    enabled: clampBoolean(props?.enabled, true),
    actorType: props?.actorType === 'vehicle' || props?.actorType === 'character' ? props.actorType : 'auto',
    allowClientPrediction: clampBoolean(props?.allowClientPrediction, true),
    inputSendIntervalMs: clampNullableInteger(props?.inputSendIntervalMs, 16, 5000),
    snapshotLerpMs: clampNumber(props?.snapshotLerpMs, 120, 16, 5000),
    snapThreshold: clampNumber(props?.snapThreshold, 1.5, 0.01, 1000),
    inputLeaseMs: clampNumber(props?.inputLeaseMs, AUTHORITY_DEFAULT_LEASE_MS, MIN_LEASE_MS, MAX_LEASE_MS),
    syncLinearVelocity: clampBoolean(props?.syncLinearVelocity, true),
    syncAngularVelocity: clampBoolean(props?.syncAngularVelocity, true),
    syncSleeping: clampBoolean(props?.syncSleeping, true),
  }
}

function normalizeCharacterControllerComponentProps(
  props: Partial<CharacterControllerComponentProps> | null | undefined,
): CharacterControllerComponentProps {
  return clampCharacterControllerComponentProps(props)
}

function findSceneNodeById(nodes: SceneNode[] | undefined | null, nodeId: string): SceneNode | null {
  if (!Array.isArray(nodes) || !nodeId) {
    return null
  }
  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (node.id === nodeId) {
      return node
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
  }
  return null
}

type LoadedPhysicsAuthorityNode = {
  nodeId: string
  actorType: MultiuserPhysicsAuthorityActorType
  props: PhysicsAuthorityComponentProps
  characterProps: CharacterControllerComponentProps | null
  bodyId: number | null
  vehicleId: number | null
  ownerUserId: string | null
  leaseExpiresAt: number
  inputSequence: number
  revision: number
  updatedAt: string
}

type LoadedPhysicsScene = {
  asset: Awaited<ReturnType<typeof buildPhysicsSceneAsset>>
  nodes: Map<string, LoadedPhysicsAuthorityNode>
  bodyNodeIdByBodyId: Map<number, string>
  bodyTransformByNodeId: Map<string, { position: [number, number, number]; quaternion: [number, number, number, number] }>
}

type LoadedPhysicsStepFrame = Awaited<ReturnType<ReturnType<typeof createCannonPhysicsController>['step']>>
type LoadedPhysicsStepContact = NonNullable<LoadedPhysicsStepFrame['contacts']>[number] & {
  impactSpeed?: number | null
}

class AuthoritativePhysicsRoom {
  private readonly inputByNodeId = new Map<string, MultiuserPhysicsAuthorityInput>()
  private readonly latestSnapshotByNodeId = new Map<string, MultiuserPhysicsAuthoritySnapshot>()
  private readonly lastCharacterJumpStateByNodeId = new Map<string, boolean>()
  private readonly loadPromise: Promise<void> | null = null
  private loadPromiseInternal: Promise<void> | null = null
  private loadedScene: LoadedPhysicsScene | null = null
  private controller: ReturnType<typeof createCannonPhysicsController> | null = null
  private tickHandle: ReturnType<typeof globalThis.setInterval> | null = null
  private tick = 0

  constructor(private readonly session: SceneSession) {}

  async ensureLoaded(): Promise<void> {
    if (this.loadedScene) {
      return
    }
    if (this.loadPromiseInternal) {
      return this.loadPromiseInternal
    }
    this.loadPromiseInternal = this.loadScene();
    return this.loadPromiseInternal;
  }

  private async loadScene(): Promise<void> {
    const scene = await SceneModel.findById(this.session.sceneId).lean().exec()
    if (!scene || !scene.fileKey) {
      throw new Error(`Unable to resolve authoritative physics scene: ${this.session.sceneId}`)
    }
    const absolutePath = resolveAbsoluteSceneFilePath(scene.fileKey)
    const exists = await fs.pathExists(absolutePath)
    if (!exists) {
      throw new Error(`Scene package not found for authoritative physics scene: ${this.session.sceneId}`)
    }
    const zipBytes = await fs.readFile(absolutePath)
    const pkg = unzipScenePackage(zipBytes)
    const sceneEntry = pkg.manifest.scenes.find((entry) => entry.sceneId === this.session.sceneId) ?? pkg.manifest.scenes[0] ?? null
    if (!sceneEntry) {
      throw new Error(`No scene entry found for authoritative physics scene: ${this.session.sceneId}`)
    }
    const document = decodeScenePackageSceneDocument(readBinaryFileFromScenePackage(pkg, sceneEntry.path)) as SceneJsonExportDocument
    const asset = await buildPhysicsSceneAsset(document)

    const nodes = new Map<string, LoadedPhysicsAuthorityNode>()
    const bodyNodeIdByBodyId = new Map<number, string>()
    const bodyIdByNodeId = new Map<string, number>()
    const vehicleIdByNodeId = new Map<string, number>()
    const bodyTransformByNodeId = new Map<string, { position: [number, number, number]; quaternion: [number, number, number, number] }>()
    asset.bodies.forEach((body) => {
      if (typeof body.userDataKey === 'string' && body.userDataKey.trim()) {
        const nodeId = body.userDataKey.trim()
        bodyNodeIdByBodyId.set(body.id, nodeId)
        bodyIdByNodeId.set(nodeId, body.id)
        bodyTransformByNodeId.set(nodeId, {
          position: [...body.transform.position] as [number, number, number],
          quaternion: [...body.transform.rotation] as [number, number, number, number],
        })
      }
    })
    asset.vehicles.forEach((vehicle) => {
      const nodeId = bodyNodeIdByBodyId.get(vehicle.bodyId) ?? null
      if (nodeId) {
        vehicleIdByNodeId.set(nodeId, vehicle.id)
      }
    })

    const scanNodes = (sceneNodes: SceneNode[] | undefined | null): void => {
      if (!Array.isArray(sceneNodes)) {
        return
      }
      const stack: SceneNode[] = [...sceneNodes]
      while (stack.length) {
        const node = stack.pop()
        if (!node) {
          continue
        }
        const component = node.components?.[PHYSICS_AUTHORITY_COMPONENT_TYPE]
        if (component && typeof component === 'object' && component.enabled !== false) {
          const props = normalizePhysicsAuthorityComponentProps((component as { props?: Partial<PhysicsAuthorityComponentProps> | null | undefined }).props)
          const characterController = node.components?.[CHARACTER_CONTROLLER_COMPONENT_TYPE]
          const characterProps = characterController && typeof characterController === 'object' && characterController.enabled !== false
            ? normalizeCharacterControllerComponentProps((characterController as { props?: Partial<CharacterControllerComponentProps> | null | undefined }).props)
            : null
          const resolvedActorType: MultiuserPhysicsAuthorityActorType = props.actorType === 'auto'
            ? (vehicleIdByNodeId.has(node.id) ? 'vehicle' : 'character')
            : props.actorType
          nodes.set(node.id, {
            nodeId: node.id,
            actorType: resolvedActorType,
            props,
            characterProps,
            bodyId: bodyIdByNodeId.get(node.id) ?? null,
            vehicleId: vehicleIdByNodeId.get(node.id) ?? null,
            ownerUserId: null,
            leaseExpiresAt: 0,
            inputSequence: 0,
            revision: 0,
            updatedAt: new Date(0).toISOString(),
          })
        }
        if (Array.isArray(node.children) && node.children.length) {
          stack.push(...node.children)
        }
      }
    }
    scanNodes(document.nodes)

    this.controller = createCannonPhysicsController()
    await this.controller.init({
      world: {
        gravity: [0, -9.8, 0],
        fixedTimeStepMs: DEFAULT_AUTH_PHYSICS_TICK_MS,
        maxSubSteps: 4,
      },
    })
    await this.controller.loadScene(asset)
    this.loadedScene = {
      asset,
      nodes,
      bodyNodeIdByBodyId,
      bodyTransformByNodeId,
    }
    this.tick = 0
    this.startTicker()
  }

  private startTicker(): void {
    if (this.tickHandle || !this.loadedScene) {
      return
    }
    this.tickHandle = globalThis.setInterval(() => {
      void this.step()
    }, DEFAULT_AUTH_PHYSICS_TICK_MS)
  }

  private stopTicker(): void {
    if (this.tickHandle) {
      globalThis.clearInterval(this.tickHandle)
      this.tickHandle = null
    }
  }

  private buildSnapshotMessage(node: LoadedPhysicsAuthorityNode, frame: { bodyMeta?: Uint32Array; bodyTransforms: Float32Array; bodyLinearVelocities?: Float32Array; bodyAngularVelocities?: Float32Array; bodySleeping?: Uint8Array; contacts?: LoadedPhysicsStepContact[] }): MultiuserServerMessage | null {
    if (!this.loadedScene || !node.bodyId) {
      return null
    }
    const bodyMeta = frame.bodyMeta ?? null
    const bodyIndex = bodyMeta ? Array.from(bodyMeta).indexOf(node.bodyId) : -1
    if (bodyIndex < 0) {
      return null
    }
    const base = bodyIndex * 8
    const position = {
      x: frame.bodyTransforms[base] ?? 0,
      y: frame.bodyTransforms[base + 1] ?? 0,
      z: frame.bodyTransforms[base + 2] ?? 0,
    }
    const quaternion = {
      x: frame.bodyTransforms[base + 3] ?? 0,
      y: frame.bodyTransforms[base + 4] ?? 0,
      z: frame.bodyTransforms[base + 5] ?? 0,
      w: frame.bodyTransforms[base + 6] ?? 1,
    }
    const linearVelocity = frame.bodyLinearVelocities
      ? {
          x: frame.bodyLinearVelocities[bodyIndex * 3] ?? 0,
          y: frame.bodyLinearVelocities[bodyIndex * 3 + 1] ?? 0,
          z: frame.bodyLinearVelocities[bodyIndex * 3 + 2] ?? 0,
        }
      : null
    const angularVelocity = frame.bodyAngularVelocities
      ? {
          x: frame.bodyAngularVelocities[bodyIndex * 3] ?? 0,
          y: frame.bodyAngularVelocities[bodyIndex * 3 + 1] ?? 0,
          z: frame.bodyAngularVelocities[bodyIndex * 3 + 2] ?? 0,
        }
      : null
    const sleeping = frame.bodySleeping ? Boolean(frame.bodySleeping[bodyIndex]) : false
    const ownerUserId = node.ownerUserId || null
    node.revision += 1
    node.updatedAt = new Date().toISOString()
    const snapshot = {
      nodeId: node.nodeId,
      actorType: node.actorType,
      ownerUserId,
      tick: this.tick,
      revision: node.revision,
      updatedAt: node.updatedAt,
      bodyId: node.bodyId,
      transform: { position, quaternion },
      linearVelocity: node.props.syncLinearVelocity ? linearVelocity : null,
      angularVelocity: node.props.syncAngularVelocity ? angularVelocity : null,
      sleeping: node.props.syncSleeping ? sleeping : false,
      contacts: Array.isArray(frame.contacts)
        ? frame.contacts.map((contact) => ({
            bodyIdA: contact.bodyIdA,
            bodyIdB: contact.bodyIdB,
            normal: { ...contact.normal },
            point: { ...contact.point },
            impulse: contact.impulse ?? null,
            impactSpeed: (contact as LoadedPhysicsStepContact).impactSpeed ?? null,
          }))
        : null,
    }
    this.latestSnapshotByNodeId.set(node.nodeId, snapshot as MultiuserPhysicsAuthoritySnapshot)
    return {
      type: 'physics-snapshot',
      sceneId: this.session.sceneId,
      snapshot: snapshot as MultiuserPhysicsAuthoritySnapshot,
    }
  }

  private resolveCharacterBodyTransform(node: LoadedPhysicsAuthorityNode): { position: Vector3; quaternion: Quaternion } {
    const snapshot = this.latestSnapshotByNodeId.get(node.nodeId)
    if (snapshot) {
      return {
        position: snapshot.transform.position,
        quaternion: snapshot.transform.quaternion,
      }
    }
    const initial = this.loadedScene?.bodyTransformByNodeId.get(node.nodeId) ?? null
    if (initial) {
      return {
        position: {
          x: initial.position[0],
          y: initial.position[1],
          z: initial.position[2],
        },
        quaternion: {
          x: initial.quaternion[0],
          y: initial.quaternion[1],
          z: initial.quaternion[2],
          w: initial.quaternion[3],
        },
      }
    }
    return {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    }
  }

  private resolveCharacterVelocity(node: LoadedPhysicsAuthorityNode, input: MultiuserPhysicsAuthorityInput): Vector3 {
    const character = input.character
    const characterProps = node.characterProps ?? null
    const moveX = Math.max(-1, Math.min(1, character?.moveX ?? 0))
    const moveZ = Math.max(-1, Math.min(1, character?.moveZ ?? 0))
    const crouching = Boolean(character?.crouch)
    const sprinting = Boolean(character?.sprint)
    const movementMagnitude = Math.min(1, Math.hypot(moveX, moveZ))
    let speed = characterProps?.walkSpeed ?? 2.4
    if (crouching) {
      speed = Math.max(0, speed * 0.4)
    } else if (sprinting && movementMagnitude > 0.05) {
      speed = characterProps?.sprintSpeed ?? 6.4
    } else if (movementMagnitude >= 0.85) {
      speed = characterProps?.sprintSpeed ?? 6.4
    } else if (movementMagnitude >= 0.5) {
      speed = characterProps?.runSpeed ?? 4.8
    }

    const transform = this.resolveCharacterBodyTransform(node)
    const quaternion = transform.quaternion
    const forward = rotateAxisByQuaternion(quaternion, 1, 0, 0)
    const right = rotateAxisByQuaternion(quaternion, 0, 0, 1)
    const horizontal = {
      x: forward.x * moveZ * speed + right.x * moveX * speed,
      y: 0,
      z: forward.z * moveZ * speed + right.z * moveX * speed,
    }
    const snapshot = this.latestSnapshotByNodeId.get(node.nodeId)
    const currentVertical = snapshot?.linearVelocity?.y ?? 0
    const wantsJump = Boolean(character?.jump)
    const jumpedLastFrame = this.lastCharacterJumpStateByNodeId.get(node.nodeId) ?? false
    if (wantsJump && !jumpedLastFrame) {
      this.lastCharacterJumpStateByNodeId.set(node.nodeId, true)
      return {
        x: horizontal.x,
        y: characterProps?.jumpImpulse ?? 6.5,
        z: horizontal.z,
      }
    }
    this.lastCharacterJumpStateByNodeId.set(node.nodeId, wantsJump)
    return {
      x: horizontal.x,
      y: currentVertical,
      z: horizontal.z,
    }
  }

  private async applyCharacterInputs(now: number): Promise<void> {
    if (!this.controller || !this.loadedScene) {
      return
    }
    for (const node of this.loadedScene.nodes.values()) {
      if (node.actorType !== 'character' || node.bodyId === null) {
        continue
      }
      const input = this.inputByNodeId.get(node.nodeId) ?? null
      if (!input?.character) {
        continue
      }
      const leaseMs = Math.min(MAX_LEASE_MS, Math.max(MIN_LEASE_MS, Math.round(input.leaseMs || AUTHORITY_DEFAULT_LEASE_MS)))
      node.ownerUserId = input.ownerUserId ?? node.ownerUserId
      node.leaseExpiresAt = now + leaseMs
      const linearVelocity = this.resolveCharacterVelocity(node, input)
      await this.controller.setBodyVelocity({
        bodyId: node.bodyId,
        linearVelocity: [linearVelocity.x, linearVelocity.y, linearVelocity.z],
        angularVelocity: [0, 0, 0],
        wakeUp: true,
      })
    }
  }

  private async step(): Promise<void> {
    if (!this.controller || !this.loadedScene) {
      return
    }
    this.tick += 1
    const now = Date.now()
    this.loadedScene.nodes.forEach((node) => {
      if (node.actorType === 'vehicle' && node.vehicleId !== null) {
        const input = this.inputByNodeId.get(node.nodeId) ?? null
        this.controller?.setVehicleInput({
          vehicleId: node.vehicleId,
          steering: input?.vehicle?.steering ?? 0,
          throttle: input?.vehicle?.throttle ?? 0,
          brake: input?.vehicle?.brake ?? 0,
          handbrake: input?.vehicle?.handbrake ?? 0,
        })
      }
    })
    await this.applyCharacterInputs(now)
    const frame = await this.controller.step(DEFAULT_AUTH_PHYSICS_TICK_MS)
    const messages: MultiuserServerMessage[] = []
    this.loadedScene.nodes.forEach((node) => {
      const ownerExpired = node.ownerUserId && node.leaseExpiresAt > 0 && node.leaseExpiresAt < now
      if (ownerExpired) {
        node.ownerUserId = null
      }
      const message = this.buildSnapshotMessage(node, frame)
      if (message) {
        messages.push(message)
      }
    })
    messages.forEach((message) => {
      this.session.broadcast(message)
    })
  }

  async handleInput(client: SceneClient, input: MultiuserPhysicsAuthorityInput): Promise<void> {
    await this.ensureLoaded()
    if (!this.loadedScene || !client.userId) {
      return
    }
    const node = this.loadedScene.nodes.get(input.nodeId)
    if (!node) {
      return
    }
    const now = Date.now()
    if (node.ownerUserId && node.ownerUserId !== client.userId && node.leaseExpiresAt > now) {
      const snapshot = this.latestSnapshotByNodeId.get(node.nodeId) ?? null
      if (snapshot) {
        try {
          client.socket.send(JSON.stringify({
            type: 'physics-snapshot',
            sceneId: this.session.sceneId,
            snapshot,
          } satisfies MultiuserServerMessage))
        } catch (error) {
          console.warn('Failed to return authoritative physics snapshot to denied client', error)
        }
      }
      return
    }
    const leaseMs = Math.min(MAX_LEASE_MS, Math.max(MIN_LEASE_MS, Math.round(input.leaseMs || AUTHORITY_DEFAULT_LEASE_MS)))
    node.ownerUserId = client.userId
    node.leaseExpiresAt = now + leaseMs
    node.inputSequence = Math.max(node.inputSequence + 1, Math.trunc(Number(input.inputSequence) || 0))
    this.inputByNodeId.set(node.nodeId, {
      ...input,
      ownerUserId: client.userId,
      leaseMs,
      inputSequence: node.inputSequence,
    })
    if (!this.tickHandle) {
      this.startTicker()
    }
  }

  releaseOwnership(userId: string): void {
    if (!this.loadedScene) {
      return
    }
    this.loadedScene.nodes.forEach((node) => {
      if (node.ownerUserId !== userId) {
        return
      }
      node.ownerUserId = null
      node.leaseExpiresAt = 0
      this.inputByNodeId.delete(node.nodeId)
      this.lastCharacterJumpStateByNodeId.delete(node.nodeId)
    })
  }

  getSnapshotMessages(): MultiuserServerMessage[] {
    if (!this.loadedScene) {
      return []
    }
    return Array.from(this.latestSnapshotByNodeId.values()).map((snapshot) => ({
      type: 'physics-snapshot',
      sceneId: this.session.sceneId,
      snapshot,
    }))
  }

  getLatestSnapshots(): MultiuserPhysicsAuthoritySnapshot[] {
    return Array.from(this.latestSnapshotByNodeId.values()).map((snapshot) => ({
      ...snapshot,
      transform: {
        position: { ...snapshot.transform.position },
        quaternion: { ...snapshot.transform.quaternion },
      },
      linearVelocity: snapshot.linearVelocity ? { ...snapshot.linearVelocity } : null,
      angularVelocity: snapshot.angularVelocity ? { ...snapshot.angularVelocity } : null,
    }))
  }

  async dispose(): Promise<void> {
    this.stopTicker()
    this.inputByNodeId.clear()
    this.latestSnapshotByNodeId.clear()
    this.loadedScene = null
    if (this.controller) {
      const controller = this.controller
      this.controller = null
      try {
        await controller.destroy()
      } catch (error) {
        console.warn('Failed to destroy authoritative physics controller', error)
      }
    }
  }
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
      physicsAuthority: session.authoritativePhysicsRoom?.getLatestSnapshots().map((snapshot) => ({
        nodeId: snapshot.nodeId,
        snapshot,
      })) ?? [],
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
      void session.authoritativePhysicsRoom?.dispose()
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
    if (message.type === 'physics-input') {
      await this.handlePhysicsInput(client, message.input)
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
    if (session.authoritativePhysicsRoom) {
      const snapshotMessages = session.authoritativePhysicsRoom.getSnapshotMessages()
      snapshotMessages.forEach((message) => {
        try {
          client.socket.send(JSON.stringify(message))
        } catch (error) {
          console.warn('Failed to send authoritative physics snapshot to joining client', error)
        }
      })
    }

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

  private getOrCreatePhysicsRoom(session: SceneSession): AuthoritativePhysicsRoom {
    if (!session.authoritativePhysicsRoom) {
      session.authoritativePhysicsRoom = new AuthoritativePhysicsRoom(session)
    }
    return session.authoritativePhysicsRoom
  }

  private async handlePhysicsInput(client: SceneClient, input: MultiuserPhysicsAuthorityInput): Promise<void> {
    const session = client.session
    if (!session || !client.userId) {
      this.sendError(client.socket, 'Must join a scene before sending physics input')
      return
    }
    const room = this.getOrCreatePhysicsRoom(session)
    try {
      await room.handleInput(client, input)
      session.touch()
      session.recordActivity({
        type: 'physics-input',
        sessionId: client.sessionId,
        userId: client.userId,
        displayName: client.displayName,
        entityId: null,
        nodeId: input.nodeId ?? null,
        summary: `${client.displayName} 提交物理输入`,
      })
      this.emitRuntimeSnapshot(session.sceneId)
    } catch (error) {
      console.warn('Failed to process authoritative physics input', error)
      this.sendError(client.socket, 'Failed to process authoritative physics input')
    }
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
    session.authoritativePhysicsRoom?.releaseOwnership(client.userId)
    if (!session.clients.size) {
      void session.authoritativePhysicsRoom?.dispose()
      session.authoritativePhysicsRoom = null
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
