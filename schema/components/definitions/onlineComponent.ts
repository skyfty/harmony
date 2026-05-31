import type { SceneNode, SceneNodeComponentState } from '../../index'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import {
  getActiveMultiuserRuntimeBridge,
  getActiveMultiuserSceneId,
  type MultiuserPeerSnapshot,
  type MultiuserPeerState,
} from '../../multiuserContext'

export const ONLINE_COMPONENT_TYPE = 'online'

export interface OnlineComponentProps {
  enabled: boolean
  maxUsers: number
  syncInterval: number
  server: string
  port: number
}

const ONLINE_DEFAULT_CONFIG: OnlineComponentProps = {
  enabled: true,
  maxUsers: 10,
  syncInterval: 250,
  server: 'ws://localhost',
  port: 7645,
}

const VALID_PORT_RANGE = { min: 1, max: 65535 }
const SYNC_INTERVAL_RANGE = { min: 33, max: 5000 }
const DEFAULT_EFFECTIVE_SYNC_INTERVAL = 250

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

type MultiuserClientMessage = MultiuserJoinMessage | MultiuserStateMessage

type MultiuserServerMessage =
  | { type: 'welcome'; sceneId: string; userId: string; peers: MultiuserPeerSnapshot[] }
  | { type: 'peer-joined'; sceneId: string; peer: MultiuserPeerSnapshot }
  | { type: 'peer-state'; sceneId: string; userId: string; peer: MultiuserPeerSnapshot }
  | { type: 'peer-left'; sceneId: string; userId: string }
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

function getBrowserLocationHostname(): string | null {
  const locationRef = typeof globalThis.location !== 'undefined' ? globalThis.location : null
  const hostname = typeof locationRef?.hostname === 'string' ? locationRef.hostname.trim() : ''
  return hostname.length ? hostname : null
}

function isLocalhostLikeHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

export function clampOnlineComponentProps(overrides?: Partial<OnlineComponentProps> | null): OnlineComponentProps {
  const source = overrides ?? {}
  return {
    enabled: clampBoolean(source.enabled, ONLINE_DEFAULT_CONFIG.enabled),
    maxUsers: clampNumber(source.maxUsers ?? ONLINE_DEFAULT_CONFIG.maxUsers, ONLINE_DEFAULT_CONFIG.maxUsers, 1, 128),
    syncInterval: clampNumber(
      source.syncInterval ?? ONLINE_DEFAULT_CONFIG.syncInterval,
      ONLINE_DEFAULT_CONFIG.syncInterval,
      SYNC_INTERVAL_RANGE.min,
      SYNC_INTERVAL_RANGE.max,
    ),
    server: clampString(source.server ?? ONLINE_DEFAULT_CONFIG.server, ONLINE_DEFAULT_CONFIG.server),
    port: clampNumber(source.port ?? ONLINE_DEFAULT_CONFIG.port, ONLINE_DEFAULT_CONFIG.port, VALID_PORT_RANGE.min, VALID_PORT_RANGE.max),
  }
}

class OnlineComponent extends Component<OnlineComponentProps> {
  private socket: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  private lastSyncTimestamp = 0
  private anonymousUserId = `anonymous-${Math.random().toString(36).slice(2, 10)}`

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
    const server = this.props.server
    const port = this.props.port
    const fallbackHostname = getBrowserLocationHostname()
    const browserProtocol = typeof globalThis.location?.protocol === 'string' ? globalThis.location.protocol : ''
    const preferSecureTransport = browserProtocol === 'https:'
    let target = server.trim()
    if (!target && fallbackHostname) {
      target = `${preferSecureTransport ? 'wss' : 'ws'}://${fallbackHostname}`
    }
    if (!target) {
      return null
    }
    if (!target.startsWith('ws://') && !target.startsWith('wss://')) {
      target = `${preferSecureTransport ? 'wss' : 'ws'}://${target}`
    }
    try {
      const url = new URL(target)
      if (fallbackHostname && isLocalhostLikeHost(url.hostname)) {
        url.hostname = fallbackHostname
        if (preferSecureTransport && url.protocol === 'ws:') {
          url.protocol = 'wss:'
        }
      } else if (preferSecureTransport && url.protocol === 'ws:') {
        url.protocol = 'wss:'
      }
      if (port && Number.isFinite(port)) {
        url.port = String(port)
      }
      return url.toString()
    } catch (error) {
      console.warn('无法解析多人在线服务器地址', error)
      return null
    }
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
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return
    }
    if (typeof WebSocket === 'undefined') {
      console.warn('浏览器不支持 WebSocket，多人在线漫游不可用')
      return
    }
    const endpoint = this.buildEndpoint()
    if (!endpoint) {
      return
    }
    this.socket = new WebSocket(endpoint)
    this.socket.addEventListener('open', () => this.handleSocketOpen())
    this.socket.addEventListener('message', (event) => this.handleSocketMessage(event.data))
    this.socket.addEventListener('close', () => this.handleSocketClose())
    this.socket.addEventListener('error', (event) => {
      console.warn('多用户同步连接出错', event)
    })
  }

  private handleSocketOpen(): void {
    this.lastSyncTimestamp = 0
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
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return
    }
    const message = this.buildJoinMessage()
    if (!message) {
      return
    }
    this.socket.send(JSON.stringify(message satisfies MultiuserClientMessage))
  }

  private handleSocketMessage(raw: unknown): void {
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
      if (Array.isArray(payload.peers)) {
        payload.peers.forEach((peer) => bridge?.handleRemotePeerSnapshot(peer))
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
    }
  }

  private handleSocketClose(): void {
    if (this.socket) {
      this.socket = null
    }
    this.runtimeBridge?.clearRemotePeers()
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
    if (this.socket) {
      try {
        this.socket.close()
      } catch {
        /* ignore */
      }
    }
    this.socket = null
    if (fully) {
      this.runtimeBridge?.clearRemotePeers()
    }
  }

  private maybeSendState(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return
    }
    const bridge = this.runtimeBridge
    if (!bridge) {
      return
    }
    const now = Date.now()
    const effectiveSyncInterval = Math.max(this.props.syncInterval, DEFAULT_EFFECTIVE_SYNC_INTERVAL)
    if (now - this.lastSyncTimestamp < effectiveSyncInterval) {
      return
    }
    const state = bridge.resolveLocalPeerState()
    if (!state) {
      return
    }
    const message: MultiuserStateMessage = {
      type: 'state',
      state,
    }
    this.socket.send(JSON.stringify(message satisfies MultiuserClientMessage))
    this.lastSyncTimestamp = now
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
        { kind: 'number', key: 'syncInterval', label: 'Sync Interval (ms)', min: 33, max: 5000, step: 33 },
        { kind: 'text', key: 'server', label: 'Server', placeholder: 'ws://localhost' },
        { kind: 'number', key: 'port', label: 'Port', min: 1, max: 65535, step: 1 },
      ],
    },
  ],
  canAttach(): boolean {
    return true
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
