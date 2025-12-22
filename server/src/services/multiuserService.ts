import { WebSocketServer, type WebSocket } from 'ws'
import { nanoid } from 'nanoid'

const DEFAULT_MAX_USERS_PER_SCENE = 32
const MAX_USERS_LIMIT = 128
const MIN_USERS_LIMIT = 2

type Vector3 = { x: number; y: number; z: number }
type Quaternion = { x: number; y: number; z: number; w: number }

interface MultiuserPeerState {
  position: Vector3
  quaternion: Quaternion
  action?: string | null
}

interface MultiuserJoinMessage {
  type: 'join'
  sceneId: string
  displayName?: string | null
  maxUsers?: number | null
}

interface MultiuserStateMessage {
  type: 'state'
  state: MultiuserPeerState
}

type MultiuserClientMessage = MultiuserJoinMessage | MultiuserStateMessage

interface MultiuserPeerSnapshot {
  userId: string
  displayName: string
  state: MultiuserPeerState | null
}

type MultiuserServerMessage =
  | { type: 'welcome'; sceneId: string; userId: string; peers: MultiuserPeerSnapshot[] }
  | { type: 'peer-joined'; sceneId: string; peer: MultiuserPeerSnapshot }
  | { type: 'peer-state'; sceneId: string; userId: string; state: MultiuserPeerState }
  | { type: 'peer-left'; sceneId: string; userId: string }
  | { type: 'error'; reason?: string }

interface SceneClient {
  socket: WebSocket
  userId: string | null
  displayName: string
  state: MultiuserPeerState | null
  session: SceneSession | null
}

class SceneSession {
  public readonly clients = new Set<SceneClient>()
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
    this.sendError(client.socket, 'Unknown message type')
  }

  private handleJoin(client: SceneClient, message: MultiuserJoinMessage): void {
    if (client.session) {
      this.sendError(client.socket, 'Already joined a scene')
      return
    }
    const sceneId = (message.sceneId ?? '').trim()
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
    client.userId = nanoid()
    client.displayName = (message.displayName?.trim() ?? '') || `Guest-${client.userId.slice(0, 6)}`
    session.addClient(client)
    const peers = session.getPeerSnapshots(client)
    const welcome: MultiuserServerMessage = {
      type: 'welcome',
      sceneId,
      userId: client.userId,
      peers,
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

  private handleState(client: SceneClient, state: MultiuserPeerState): void {
    const session = client.session
    if (!session || !client.userId) {
      this.sendError(client.socket, 'Must join a scene before sending state')
      return
    }
    client.state = state
    const message: MultiuserServerMessage = {
      type: 'peer-state',
      sceneId: session.sceneId,
      userId: client.userId,
      state,
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
    if (!session.clients.size) {
      this.sessions.delete(session.sceneId)
    }
  }

  private sendError(socket: WebSocket, reason: string): void {
    try {
      socket.send(JSON.stringify({ type: 'error', reason }))
    } catch (error) {
      console.warn('Failed to send multiuser error message', error)
    }
  }
}