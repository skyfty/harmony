import type { SceneNode, SceneNodeComponentState } from '../../index'
import { MULTIUSER_NODE_ID } from '../../core'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import {
  getActiveMultiuserRuntimeBridge,
  getActiveMultiuserSceneId,
  type MultiuserCharacterPresentation,
  type MultiuserPeerPresentationState,
  type MultiuserPeerSnapshot,
  type MultiuserPeerState,
  type MultiuserPhysicsAuthorityInput,
  type MultiuserPhysicsAuthoritySnapshot,
  type MultiuserVehiclePresentation,
  type MultiuserSharedEntitySnapshot,
  type MultiuserSharedEntityState,
} from '../../multiuserContext'
import {
  createRuntimeSocketAdapter,
  SOCKET_READY_STATE_CONNECTING,
  SOCKET_READY_STATE_OPEN,
  type RuntimeSocketAdapter,
} from '../../runtimeSocketAdapter'

export const ONLINE_COMPONENT_TYPE = 'online'

export interface OnlineComponentProps {
  enabled: boolean
  maxUsers: number
  maxVisiblePeers: number
  syncInterval: number
  server: string
}

const ONLINE_DEFAULT_CONFIG: OnlineComponentProps = {
  enabled: true,
  maxUsers: 10,
  maxVisiblePeers: 6,
  syncInterval: 250,
  server: 'ws://localhost:7645',
}

const SYNC_INTERVAL_RANGE = { min: 33, max: 5000 }
const DEFAULT_MOVING_SYNC_INTERVAL = 160
const DEFAULT_IDLE_SYNC_INTERVAL = 500
const STATE_KEEPALIVE_INTERVAL = 4000
const POSITION_CHANGE_EPSILON = 0.05
const QUATERNION_DOT_EPSILON = 0.9995
const SCALE_CHANGE_EPSILON = 0.01

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

type MultiuserClientMessage =
  | MultiuserJoinMessage
  | MultiuserStateMessage
  | MultiuserEntityStateMessage
  | MultiuserPhysicsInputMessage

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

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  const rounded = Math.round(value)
  if (rounded < min) {
    return min
  }
  if (rounded > max) {
    return max
  }
  return rounded
}

function clampBoolean(value: unknown, fallback: boolean): boolean {
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

function clampString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : fallback
}

function normalizeWebSocketUrl(value: unknown, fallback: string): string {
  const candidate = clampString(value, fallback)
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      return fallback
    }
    return url.toString()
  } catch {
    return fallback
  }
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function getPresentationVectorSignature(value: { x: number; y: number; z: number } | null | undefined): string {
  if (!value) {
    return ''
  }
  return `${value.x}|${value.y}|${value.z}`
}

function getPresentationQuaternionSignature(value: { x: number; y: number; z: number; w: number } | null | undefined): string {
  if (!value) {
    return ''
  }
  return `${value.x}|${value.y}|${value.z}|${value.w}`
}

function getMultiuserVehiclePresentationSignature(presentation: MultiuserVehiclePresentation | null | undefined): string {
  if (!presentation || !Array.isArray(presentation.wheels) || !presentation.wheels.length) {
    return ''
  }
  return presentation.wheels.map((wheel) => [
    normalizeOptionalString(wheel.nodeId) ?? '',
    wheel.wheelIndex,
    getPresentationVectorSignature(wheel.position),
    getPresentationQuaternionSignature(wheel.quaternion),
    getPresentationVectorSignature(wheel.scale ?? null),
  ].join(':')).join('|')
}

function getMultiuserCharacterPresentationSignature(presentation: MultiuserCharacterPresentation | null | undefined): string {
  const animation = presentation?.animation ?? null
  if (!animation) {
    return ''
  }
  return [
    normalizeOptionalString(animation.clipName) ?? '',
    animation.time,
    animation.duration,
    animation.loop ? 1 : 0,
    animation.timeScale,
    animation.normalizedTime ?? '',
  ].join('|')
}

function getMultiuserPresentationSignature(presentation: MultiuserPeerPresentationState | null | undefined): string {
  if (!presentation) {
    return ''
  }
  return [
    getMultiuserVehiclePresentationSignature(presentation.vehicle ?? null),
    getMultiuserCharacterPresentationSignature(presentation.character ?? null),
  ].join('#')
}

function getMultiuserStateSignature(state: MultiuserPeerState): string {
  return [
    state.subjectType,
    normalizeOptionalString(state.subjectNodeId) ?? '',
    normalizeOptionalString(state.subjectIdentifier) ?? '',
    normalizeOptionalString(state.subjectAssetId) ?? '',
    normalizeOptionalString(state.subjectAssetUrl) ?? '',
    state.position.x,
    state.position.y,
    state.position.z,
    state.quaternion.x,
    state.quaternion.y,
    state.quaternion.z,
    state.quaternion.w,
    normalizeOptionalString(state.action) ?? '',
    getMultiuserPresentationSignature(state.presentation ?? null),
  ].join('|')
}

function isMultiuserStateMeaningfullyChanged(prev: MultiuserPeerState | null, next: MultiuserPeerState): boolean {
  if (!prev) {
    return true
  }
  if (prev.subjectType !== next.subjectType) {
    return true
  }
  if (normalizeOptionalString(prev.subjectNodeId) !== normalizeOptionalString(next.subjectNodeId)) {
    return true
  }
  if (normalizeOptionalString(prev.subjectIdentifier) !== normalizeOptionalString(next.subjectIdentifier)) {
    return true
  }
  if (normalizeOptionalString(prev.subjectAssetId) !== normalizeOptionalString(next.subjectAssetId)) {
    return true
  }
  if (normalizeOptionalString(prev.subjectAssetUrl) !== normalizeOptionalString(next.subjectAssetUrl)) {
    return true
  }
  if (normalizeOptionalString(prev.action) !== normalizeOptionalString(next.action)) {
    return true
  }
  if (getMultiuserPresentationSignature(prev.presentation ?? null) !== getMultiuserPresentationSignature(next.presentation ?? null)) {
    return true
  }

  const dx = next.position.x - prev.position.x
  const dy = next.position.y - prev.position.y
  const dz = next.position.z - prev.position.z
  if ((dx * dx) + (dy * dy) + (dz * dz) >= POSITION_CHANGE_EPSILON * POSITION_CHANGE_EPSILON) {
    return true
  }

  const dot =
    (prev.quaternion.x * next.quaternion.x)
    + (prev.quaternion.y * next.quaternion.y)
    + (prev.quaternion.z * next.quaternion.z)
    + (prev.quaternion.w * next.quaternion.w)
  return Math.abs(dot) < QUATERNION_DOT_EPSILON
}

function computeMovingSyncInterval(baseInterval: number): number {
  const scaled = Math.round(baseInterval / 3)
  return Math.max(80, Math.min(180, Number.isFinite(scaled) ? scaled : DEFAULT_MOVING_SYNC_INTERVAL))
}

function computeIdleSyncInterval(baseInterval: number): number {
  return Math.max(DEFAULT_IDLE_SYNC_INTERVAL, baseInterval)
}

function getScaleSignature(state: MultiuserSharedEntityState): string {
  const scale = state.transform.scale
  return scale ? `${scale.x}|${scale.y}|${scale.z}` : ''
}

function getMultiuserEntityStateSignature(state: MultiuserSharedEntityState): string {
  return [
    state.entityId,
    state.nodeId,
    state.ownerUserId ?? '',
    state.mode,
    state.transform.position.x,
    state.transform.position.y,
    state.transform.position.z,
    state.transform.quaternion.x,
    state.transform.quaternion.y,
    state.transform.quaternion.z,
    state.transform.quaternion.w,
    getScaleSignature(state),
    state.revision,
    state.updatedAt,
    state.lease?.mode ?? '',
    state.lease?.leaseMs ?? '',
  ].join('|')
}

function isMultiuserEntityStateMeaningfullyChanged(prev: MultiuserSharedEntityState | null, next: MultiuserSharedEntityState): boolean {
  if (!prev) {
    return true
  }
  if (prev.entityId !== next.entityId || prev.nodeId !== next.nodeId || prev.mode !== next.mode) {
    return true
  }
  const dx = next.transform.position.x - prev.transform.position.x
  const dy = next.transform.position.y - prev.transform.position.y
  const dz = next.transform.position.z - prev.transform.position.z
  if ((dx * dx) + (dy * dy) + (dz * dz) >= POSITION_CHANGE_EPSILON * POSITION_CHANGE_EPSILON) {
    return true
  }
  const dot =
    (prev.transform.quaternion.x * next.transform.quaternion.x)
    + (prev.transform.quaternion.y * next.transform.quaternion.y)
    + (prev.transform.quaternion.z * next.transform.quaternion.z)
    + (prev.transform.quaternion.w * next.transform.quaternion.w)
  if (Math.abs(dot) < QUATERNION_DOT_EPSILON) {
    return true
  }
  const prevScale = prev.transform.scale ?? null
  const nextScale = next.transform.scale ?? null
  if (Boolean(prevScale) !== Boolean(nextScale)) {
    return true
  }
  if (prevScale && nextScale) {
    const dsx = nextScale.x - prevScale.x
    const dsy = nextScale.y - prevScale.y
    const dsz = nextScale.z - prevScale.z
    if ((dsx * dsx) + (dsy * dsy) + (dsz * dsz) >= SCALE_CHANGE_EPSILON * SCALE_CHANGE_EPSILON) {
      return true
    }
  }
  return false
}

export function clampOnlineComponentProps(overrides?: Partial<OnlineComponentProps> | null): OnlineComponentProps {
  const source = overrides ?? {}
  return {
    enabled: clampBoolean(source.enabled, ONLINE_DEFAULT_CONFIG.enabled),
    maxUsers: clampNumber(source.maxUsers ?? ONLINE_DEFAULT_CONFIG.maxUsers, ONLINE_DEFAULT_CONFIG.maxUsers, 1, 128),
    maxVisiblePeers: clampNumber(
      source.maxVisiblePeers ?? ONLINE_DEFAULT_CONFIG.maxVisiblePeers,
      ONLINE_DEFAULT_CONFIG.maxVisiblePeers,
      1,
      64,
    ),
    syncInterval: clampNumber(
      source.syncInterval ?? ONLINE_DEFAULT_CONFIG.syncInterval,
      ONLINE_DEFAULT_CONFIG.syncInterval,
      SYNC_INTERVAL_RANGE.min,
      SYNC_INTERVAL_RANGE.max,
    ),
    server: normalizeWebSocketUrl(source.server, ONLINE_DEFAULT_CONFIG.server),
  }
}

class OnlineComponent extends Component<OnlineComponentProps> {
  private socket: RuntimeSocketAdapter | null = null
  private reconnectTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  private lastPeerSyncTimestamp = 0
  private lastKeepaliveTimestamp = 0
  private lastSentState: MultiuserPeerState | null = null
  private lastSentStateSignature = ''
  private readonly lastSharedEntityById = new Map<string, MultiuserSharedEntityState>()
  private readonly lastSharedEntitySignatureById = new Map<string, string>()
  private readonly lastPhysicsInputByNodeId = new Map<string, MultiuserPhysicsAuthorityInput>()
  private readonly lastPhysicsInputSignatureByNodeId = new Map<string, string>()
  private lastPhysicsInputSyncTimestamp = 0
  private anonymousUserId = `anonymous-${Math.random().toString(36).slice(2, 10)}`
  private connectionToken = 0

  constructor(context: ComponentRuntimeContext<OnlineComponentProps>) {
    super(context)
  }

  onInit(): void {
    this.ensureConnected()
  }

  onRuntimeAttached(): void {
    this.ensureConnected()
  }

  onPropsUpdated(): void {
    this.restartConnection()
  }

  onEnabledChanged(enabled: boolean): void {
    if (!enabled) {
      this.closeConnection()
    } else {
      this.ensureConnected()
    }
  }

  onUpdate(): void {
    this.maybeSendState()
  }

  onDestroy(): void {
    this.closeConnection(true)
  }

  private get props(): OnlineComponentProps {
    return this.context.getProps()
  }

  private get sceneId(): string | null {
    return getActiveMultiuserSceneId()
  }

  private get runtimeBridge() {
    return getActiveMultiuserRuntimeBridge()
  }

  private shouldConnect(): boolean {
    return this.context.isEnabled() && this.props.enabled && Boolean(this.sceneId) && Boolean(this.runtimeBridge)
  }

  private buildEndpoint(): string | null {
    const target = this.props.server.trim()
    return target;
  }

  private restartConnection(): void {
    this.closeConnection()
    this.ensureConnected()
  }

  private ensureConnected(): void {
    if (!this.shouldConnect()) {
      this.closeConnection()
      return
    }
    if (this.socket && (this.socket.readyState === SOCKET_READY_STATE_OPEN || this.socket.readyState === SOCKET_READY_STATE_CONNECTING)) {
      return
    }
    const endpoint = this.buildEndpoint()
    if (!endpoint) {
      return
    }
    const socket = createRuntimeSocketAdapter(endpoint)
    if (!socket) {
      console.warn('当前运行环境不支持多人在线所需的 WebSocket/SocketTask，漫游功能不可用')
      return
    }
    const token = this.nextConnectionToken()
    this.socket = socket
    socket.onOpen(() => this.handleSocketOpen(token))
    socket.onMessage((data: unknown) => this.handleSocketMessage(token, data))
    socket.onClose(() => this.handleSocketClose(token))
    socket.onError((event) => {
      if (!this.isCurrentConnectionToken(token)) {
        return
      }
      console.warn('多用户同步连接出错', event)
    })
  }

  private nextConnectionToken(): number {
    this.connectionToken += 1
    return this.connectionToken
  }

  private isCurrentConnectionToken(token: number): boolean {
    return token === this.connectionToken
  }

  private handleSocketOpen(token: number): void {
    if (!this.isCurrentConnectionToken(token)) {
      return
    }
    this.lastPeerSyncTimestamp = 0
    this.lastKeepaliveTimestamp = 0
    this.lastSentState = null
    this.lastSentStateSignature = ''
    this.lastSharedEntityById.clear()
    this.lastSharedEntitySignatureById.clear()
    this.lastPhysicsInputByNodeId.clear()
    this.lastPhysicsInputSignatureByNodeId.clear()
    this.lastPhysicsInputSyncTimestamp = 0
    this.sendJoin()
  }

  private buildJoinMessage(): MultiuserJoinMessage | null {
    const sceneId = this.sceneId
    if (!sceneId) {
      return null
    }
    const identity = this.runtimeBridge?.getIdentity() ?? null
    return {
      type: 'join',
      sceneId,
      userId: identity?.userId?.trim() || this.anonymousUserId,
      displayName: identity?.displayName?.trim() || identity?.userId?.trim() || 'Guest',
      maxUsers: this.props.maxUsers,
    }
  }

  private sendJoin(): void {
    if (!this.socket || this.socket.readyState !== SOCKET_READY_STATE_OPEN) {
      return
    }
    const message = this.buildJoinMessage()
    if (!message) {
      return
    }
    this.socket.send(JSON.stringify(message satisfies MultiuserClientMessage))
  }

  private handleSocketMessage(token: number, raw: unknown): void {
    if (!this.isCurrentConnectionToken(token)) {
      return
    }
    const payloadText = typeof raw === 'string' ? raw : String(raw)
    try {
      const parsed = JSON.parse(payloadText)
      this.processServerMessage(parsed)
    } catch (error) {
      console.warn('解析多人在线消息失败', error)
    }
  }

  private processServerMessage(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return
    }
    const payload = message as MultiuserServerMessage
    if (!payload.type) {
      return
    }
    if (payload.type === 'welcome') {
      const bridge = this.runtimeBridge
      bridge?.clearRemotePeers()
      bridge?.clearRemoteSharedEntities()
      bridge?.clearRemotePhysicsAuthority()
      if (Array.isArray(payload.peers)) {
        payload.peers.forEach((peer) => bridge?.handleRemotePeerSnapshot(peer))
      }
      if (Array.isArray(payload.entities)) {
        payload.entities.forEach((entity) => bridge?.handleRemoteSharedEntitySnapshot(entity))
      }
      return
    }
    if (payload.type === 'peer-joined' && payload.peer) {
      this.runtimeBridge?.handleRemotePeerSnapshot(payload.peer)
      return
    }
    if (payload.type === 'peer-state' && payload.peer) {
      this.runtimeBridge?.handleRemotePeerSnapshot(payload.peer)
      return
    }
    if (payload.type === 'peer-left' && payload.userId) {
      this.runtimeBridge?.handleRemotePeerLeft(payload.userId)
      return
    }
    if (payload.type === 'entity-state' && payload.entity) {
      this.runtimeBridge?.handleRemoteSharedEntitySnapshot(payload.entity)
      return
    }
    if (payload.type === 'entity-removed' && payload.entityId) {
      this.runtimeBridge?.handleRemoteSharedEntityRemoved(payload.entityId)
      return
    }
    if (payload.type === 'physics-snapshot' && payload.snapshot) {
      this.runtimeBridge?.handleRemotePhysicsAuthoritySnapshot(payload.snapshot)
      return
    }
    if (payload.type === 'physics-removed' && payload.nodeId) {
      this.runtimeBridge?.handleRemotePhysicsAuthorityRemoved(payload.nodeId)
    }
  }

  private handleSocketClose(token: number): void {
    if (!this.isCurrentConnectionToken(token)) {
      return
    }
    if (this.socket) {
      this.socket = null
    }
    this.runtimeBridge?.clearRemotePeers()
    this.runtimeBridge?.clearRemoteSharedEntities()
    this.runtimeBridge?.clearRemotePhysicsAuthority()
    if (this.shouldConnect()) {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer()
    this.reconnectTimer = globalThis.setTimeout(() => {
      this.reconnectTimer = null
      this.ensureConnected()
    }, 2000)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      globalThis.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private closeConnection(fully = false): void {
    this.clearReconnectTimer()
    this.nextConnectionToken()
    if (this.socket) {
      try {
        this.socket.close()
      } catch {
        /* ignore */
      }
    }
    this.socket = null
    this.lastPeerSyncTimestamp = 0
    this.lastKeepaliveTimestamp = 0
    this.lastSentState = null
    this.lastSentStateSignature = ''
    this.lastSharedEntityById.clear()
    this.lastSharedEntitySignatureById.clear()
    this.lastPhysicsInputByNodeId.clear()
    this.lastPhysicsInputSignatureByNodeId.clear()
    this.lastPhysicsInputSyncTimestamp = 0
    if (fully) {
      this.runtimeBridge?.clearRemotePeers()
      this.runtimeBridge?.clearRemoteSharedEntities()
      this.runtimeBridge?.clearRemotePhysicsAuthority()
    }
  }

  private getPhysicsInputSignature(input: MultiuserPhysicsAuthorityInput): string {
    const vehicle = input.vehicle
    const character = input.character
    return [
      input.nodeId,
      input.actorType,
      input.inputSequence,
      input.ownerUserId ?? '',
      input.leaseMs,
      vehicle ? `${vehicle.vehicleId}|${vehicle.steering}|${vehicle.throttle}|${vehicle.brake}|${vehicle.handbrake ?? ''}` : '',
      character ? `${character.moveX}|${character.moveZ}|${character.jump ? 1 : 0}|${character.sprint ? 1 : 0}|${character.crouch ? 1 : 0}|${character.interact ? 1 : 0}` : '',
    ].join('|')
  }

  private maybeSendState(): void {
    if (!this.socket || this.socket.readyState !== SOCKET_READY_STATE_OPEN) {
      return
    }
    const socket = this.socket
    const bridge = this.runtimeBridge
    if (!bridge) {
      return
    }
    const now = Date.now()
    const peerState = bridge.resolveLocalPeerState()
    if (peerState) {
      const signature = getMultiuserStateSignature(peerState)
      const shouldKeepalive = now - this.lastKeepaliveTimestamp >= STATE_KEEPALIVE_INTERVAL
      const changed = signature !== this.lastSentStateSignature && isMultiuserStateMeaningfullyChanged(this.lastSentState, peerState)
      const effectiveSyncInterval = changed
        ? computeMovingSyncInterval(this.props.syncInterval)
        : computeIdleSyncInterval(this.props.syncInterval)
      if (now - this.lastPeerSyncTimestamp >= effectiveSyncInterval && (changed || shouldKeepalive)) {
        const message: MultiuserStateMessage = {
          type: 'state',
          state: peerState,
        }
        this.socket.send(JSON.stringify(message satisfies MultiuserClientMessage))
        this.lastPeerSyncTimestamp = now
        if (changed) {
          this.lastSentState = {
            ...peerState,
            position: { ...peerState.position },
            quaternion: { ...peerState.quaternion },
          }
          this.lastSentStateSignature = signature
        }
        this.lastKeepaliveTimestamp = now
      }
    }

    const sharedStates = bridge.resolveLocalSharedEntityStates()
    if (!Array.isArray(sharedStates) || sharedStates.length === 0) {
      // Continue to physics input handling below.
    } else {
      sharedStates.forEach((state) => {
        if (!state || typeof state.entityId !== 'string' || !state.entityId.trim()) {
          return
        }
        const signature = getMultiuserEntityStateSignature(state)
        const previous = this.lastSharedEntityById.get(state.entityId) ?? null
        const changed = signature !== this.lastSharedEntitySignatureById.get(state.entityId)
          && isMultiuserEntityStateMeaningfullyChanged(previous, state)
        const intervalHint = state.lease?.leaseMs ?? this.props.syncInterval
        const effectiveSyncInterval = changed
          ? computeMovingSyncInterval(intervalHint)
          : computeIdleSyncInterval(intervalHint)
        if (!changed && now - this.lastKeepaliveTimestamp < Math.max(effectiveSyncInterval, STATE_KEEPALIVE_INTERVAL)) {
          return
        }
        if (changed || now - this.lastPeerSyncTimestamp >= effectiveSyncInterval) {
          const message: MultiuserEntityStateMessage = {
            type: 'entity-state',
            entity: state,
          }
          socket.send(JSON.stringify(message satisfies MultiuserClientMessage))
          this.lastSharedEntityById.set(state.entityId, {
            ...state,
            transform: {
              position: { ...state.transform.position },
              quaternion: { ...state.transform.quaternion },
              scale: state.transform.scale ? { ...state.transform.scale } : null,
            },
            lease: state.lease ? { ...state.lease } : null,
          })
          this.lastSharedEntitySignatureById.set(state.entityId, signature)
        }
      })
    }

    const physicsInputs = bridge.resolveLocalPhysicsAuthorityInputs()
    if (!Array.isArray(physicsInputs) || physicsInputs.length === 0) {
      return
    }
    physicsInputs.forEach((input) => {
      if (!input || typeof input.nodeId !== 'string' || !input.nodeId.trim()) {
        return
      }
      const signature = this.getPhysicsInputSignature(input)
      const previousSignature = this.lastPhysicsInputSignatureByNodeId.get(input.nodeId)
      const changed = signature !== previousSignature
      const inputInterval = Math.max(16, Math.min(5000, input.leaseMs || this.props.syncInterval))
      if (!changed && now - this.lastPhysicsInputSyncTimestamp < inputInterval) {
        return
      }
      const message: MultiuserPhysicsInputMessage = {
        type: 'physics-input',
        input,
      }
      socket.send(JSON.stringify(message satisfies MultiuserClientMessage))
      this.lastPhysicsInputByNodeId.set(input.nodeId, { ...input })
      this.lastPhysicsInputSignatureByNodeId.set(input.nodeId, signature)
      this.lastPhysicsInputSyncTimestamp = now
    })
  }
}

const onlineComponentDefinition: ComponentDefinition<OnlineComponentProps> = {
  type: ONLINE_COMPONENT_TYPE,
  label: 'Multiuser',
  icon: 'mdi-account-group',
  order: 300,
  inspector: [
    {
      id: 'tuning',
      label: 'Multiuser Settings',
      fields: [
        { kind: 'boolean', key: 'enabled', label: 'Enabled' },
        { kind: 'number', key: 'maxUsers', label: 'Max Users', min: 2, max: 128, step: 1 },
        { kind: 'number', key: 'maxVisiblePeers', label: 'Visible Peers', min: 1, max: 64, step: 1 },
        { kind: 'number', key: 'syncInterval', label: 'Sync Interval (ms)', min: 33, max: 5000, step: 33 },
        { kind: 'text', key: 'server', label: 'Server URL', placeholder: 'ws://muluser.v.touchmagic.cn:7645' },
      ],
    },
  ],
  canAttach(node: SceneNode): boolean {
    return node?.id === MULTIUSER_NODE_ID
  },
  createDefaultProps(): OnlineComponentProps {
    return { ...ONLINE_DEFAULT_CONFIG }
  },
  createInstance(context) {
    return new OnlineComponent(context)
  },
}

componentManager.registerDefinition(onlineComponentDefinition)

export function createOnlineComponentState(
  node: SceneNode,
  overrides?: Partial<OnlineComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<OnlineComponentProps> {
  const defaults = onlineComponentDefinition.createDefaultProps(node)
  const props = clampOnlineComponentProps({ ...defaults, ...overrides })
  return {
    id: options.id ?? '',
    type: ONLINE_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props,
  }
}

export { onlineComponentDefinition }
