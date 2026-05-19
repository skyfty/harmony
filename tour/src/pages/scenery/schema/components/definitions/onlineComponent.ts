import type { Object3D } from 'three'
import { CapsuleGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import type { SceneNode, SceneNodeComponentState } from '../../index'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import { getActiveMultiuserSceneId } from '../../multiuserContext'

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
  syncInterval: 100,
  server: 'ws://localhost',
  port: 7645,
}

const VALID_PORT_RANGE = { min: 1, max: 65535 }
const SYNC_INTERVAL_RANGE = { min: 33, max: 5000 }

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

type Vector3Like = { x: number; y: number; z: number }
type QuaternionLike = { x: number; y: number; z: number; w: number }

interface MultiuserPeerState {
  position: Vector3Like
  quaternion: QuaternionLike
  action?: string | null
}

type MultiuserServerMessage =
  | { type: 'welcome'; peers: Array<{ userId: string; state: MultiuserPeerState | null }> }
  | { type: 'peer-joined'; peer: { userId: string; state: MultiuserPeerState | null } }
  | { type: 'peer-state'; userId: string; state: MultiuserPeerState }
  | { type: 'peer-left'; userId: string }
  | { type: 'error'; reason?: string }

type PeerEntry = {
  mesh: Mesh
  state: MultiuserPeerState | null
}

const capsuleGeometry = new CapsuleGeometry(0.32, 0.6, 4, 8)

function createPeerMesh(): Mesh {
  const material = new MeshStandardMaterial({ color: 0x4d9bff })
  const mesh = new Mesh(capsuleGeometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.name = 'Multiuser Peer'
  mesh.frustumCulled = false
  return mesh
}

class OnlineComponent extends Component<OnlineComponentProps> {
  private socket: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  private avatarRoot: Group | null = null
  private peers = new Map<string, PeerEntry>()
  private lastSyncTimestamp = 0
  private readonly displayName = `Viewer-${Math.random().toString(36).slice(2, 8)}`

  constructor(context: ComponentRuntimeContext<OnlineComponentProps>) {
    super(context)
  }

  onInit(): void {
    this.ensureConnected()
  }

  onRuntimeAttached(object: Object3D | null): void {
    this.attachAvatarRoot(object)
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

  private shouldConnect(): boolean {
    return this.context.isEnabled() && this.props.enabled && Boolean(this.sceneId)
  }

  private buildEndpoint(): string | null {
    const server = this.props.server
    const port = this.props.port
    if (!server) {
      return null
    }
    let target = server
    if (!target.startsWith('ws://') && !target.startsWith('wss://')) {
      target = `ws://${target}`
    }
    try {
      const url = new URL(target)
      if (port && Number.isFinite(port)) {
        url.port = String(port)
      }
      return url.toString()
    } catch (error) {
      console.warn('无法解析多人在线服务器地址', error)
      return null
    }
  }

  private attachAvatarRoot(object: Object3D | null): void {
    if (!object) {
      this.removeAvatarRoot()
      return
    }
    const parent = object.parent
    if (!parent) {
      return
    }
    if (!this.avatarRoot) {
      this.avatarRoot = new Group()
      this.avatarRoot.name = 'Multiuser Avatars'
    }
    if (this.avatarRoot.parent && this.avatarRoot.parent !== parent) {
      this.avatarRoot.parent.remove(this.avatarRoot)
    }
    if (!this.avatarRoot.parent) {
      parent.add(this.avatarRoot)
    }
    this.peers.forEach((peer) => {
      if (peer.mesh.parent !== this.avatarRoot && this.avatarRoot) {
        this.avatarRoot.add(peer.mesh)
      }
    })
  }

  private removeAvatarRoot(): void {
    if (!this.avatarRoot) {
      return
    }
    this.avatarRoot.parent?.remove(this.avatarRoot)
    this.avatarRoot.clear()
    this.avatarRoot = null
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

  private sendJoin(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return
    }
    const sceneId = this.sceneId
    if (!sceneId) {
      return
    }
    const message = {
      type: 'join',
      sceneId,
      displayName: this.displayName,
      maxUsers: this.props.maxUsers,
    }
    this.socket.send(JSON.stringify(message))
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
    if (payload.type === 'peer-joined' && payload.peer) {
      this.updatePeer(payload.peer.userId, payload.peer.state)
      return
    }
    if (payload.type === 'peer-state' && payload.userId && payload.state) {
      this.updatePeer(payload.userId, payload.state)
      return
    }
    if (payload.type === 'peer-left' && payload.userId) {
      this.removePeer(payload.userId)
      return
    }
    if (payload.type === 'welcome' && Array.isArray(payload.peers)) {
      payload.peers.forEach((peer) => this.updatePeer(peer.userId, peer.state))
      return
    }
  }

  private updatePeer(userId: string, state: MultiuserPeerState | null): void {
    if (!state) {
      this.removePeer(userId)
      return
    }
    let entry = this.peers.get(userId)
    if (!entry) {
      const mesh = createPeerMesh()
      if (this.avatarRoot) {
        this.avatarRoot.add(mesh)
      }
      entry = { mesh, state: null }
      this.peers.set(userId, entry)
    }
    entry.state = state
    entry.mesh.position.set(state.position.x, state.position.y, state.position.z)
    entry.mesh.quaternion.set(state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w)
    entry.mesh.visible = true
    const color = state.action ? 0xffb300 : 0x4d9bff
    ;(entry.mesh.material as MeshStandardMaterial).color.setHex(color)
  }

  private removePeer(userId: string): void {
    const entry = this.peers.get(userId)
    if (!entry) {
      return
    }
    entry.mesh.parent?.remove(entry.mesh)
    const material = entry.mesh.material
    if (Array.isArray(material)) {
      material.forEach((m) => m.dispose())
    } else {
      material.dispose()
    }
    this.peers.delete(userId)
  }

  private handleSocketClose(): void {
    this.peers.forEach((peer) => peer.mesh.parent?.remove(peer.mesh))
    this.peers.clear()
    if (this.socket) {
      this.socket = null
    }
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
    if (fully) {
      this.removeAvatarRoot()
    }
    this.socket = null
    this.peers.forEach((peer) => peer.mesh.parent?.remove(peer.mesh))
    this.peers.clear()
  }

  private maybeSendState(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return
    }
    const now = Date.now()
    if (now - this.lastSyncTimestamp < this.props.syncInterval) {
      return
    }
    const object = this.context.getRuntimeObject()
    if (!object) {
      return
    }
    const state: MultiuserPeerState = {
      position: { x: object.position.x, y: object.position.y, z: object.position.z },
      quaternion: {
        x: object.quaternion.x,
        y: object.quaternion.y,
        z: object.quaternion.z,
        w: object.quaternion.w,
      },
    }
    const message = {
      type: 'state',
      state,
    }
    this.socket.send(JSON.stringify(message))
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