import type * as THREE from 'three'

import {
  syncBodyFromObject,
  type PhysicsBodyBindingEntry,
  type PhysicsOrientationAdjustment,
} from './physicsBodySync'

export type VehicleMotionAuthorityState =
  | 'idle-physics'
  | 'auto-surface'
  | 'manual-physics'

type PhysicsBodyWithCollisionFlags = {
  collisionResponse?: boolean
  collisionFilterMask?: number
  collisionFilterGroup?: number
  velocity?: { set(x: number, y: number, z: number): void }
  angularVelocity?: { set(x: number, y: number, z: number): void }
  sleep?: () => unknown
}

type StoredBodyCollisionState = {
  body: PhysicsBodyWithCollisionFlags
  collisionResponse: boolean | undefined
  collisionFilterMask: number | undefined
  collisionFilterGroup: number | undefined
}

type AuthorityEntry = {
  state: VehicleMotionAuthorityState
  object: THREE.Object3D | null
  bodies: PhysicsBodyWithCollisionFlags[]
  primaryBody: PhysicsBodyWithCollisionFlags | null
  orientationAdjustment: PhysicsOrientationAdjustment | null
  storedBodies: StoredBodyCollisionState[]
}

function collectBindingBodies(
  binding: Pick<PhysicsBodyBindingEntry, 'body' | 'bodies'> | null | undefined,
): PhysicsBodyWithCollisionFlags[] {
  const bodies: PhysicsBodyWithCollisionFlags[] = []
  const seen = new Set<PhysicsBodyWithCollisionFlags>()
  const append = (body: unknown) => {
    if (!body || typeof body !== 'object') {
      return
    }
    const typed = body as PhysicsBodyWithCollisionFlags
    if (seen.has(typed)) {
      return
    }
    seen.add(typed)
    bodies.push(typed)
  }
  append(binding?.body)
  binding?.bodies?.forEach(append)
  return bodies
}

export class VehicleMotionAuthorityController {
  private readonly entries = new Map<string, AuthorityEntry>()

  getState(nodeId: string): VehicleMotionAuthorityState {
    return this.entries.get(nodeId)?.state ?? 'idle-physics'
  }

  isAutoSurface(nodeId: string): boolean {
    return this.getState(nodeId) === 'auto-surface'
  }

  shouldWritePhysicsToObject(nodeId: string): boolean {
    return !this.isAutoSurface(nodeId)
  }

  shouldIncludeGroundAnchor(nodeId: string): boolean {
    return !this.isAutoSurface(nodeId)
  }

  beginAutoSurface(
    nodeId: string,
    binding: (Partial<Pick<PhysicsBodyBindingEntry, 'body' | 'bodies' | 'orientationAdjustment'>> & {
      object?: THREE.Object3D | null
    }) | null | undefined,
  ): void {
    const existing = this.entries.get(nodeId)
    if (existing?.state === 'auto-surface') {
      return
    }
    if (existing) {
      this.restoreBodies(existing, true)
    }
    const bodies = collectBindingBodies(binding as PhysicsBodyBindingEntry | null | undefined)
    const storedBodies = bodies.map((body) => ({
      body,
      collisionResponse: body.collisionResponse,
      collisionFilterMask: body.collisionFilterMask,
      collisionFilterGroup: body.collisionFilterGroup,
    }))
    bodies.forEach((body) => {
      body.collisionResponse = false
      body.collisionFilterMask = 0
      body.collisionFilterGroup = 0
      body.velocity?.set(0, 0, 0)
      body.angularVelocity?.set(0, 0, 0)
      try {
        body.sleep?.()
      } catch {
        // Best effort; each physics backend exposes a different sleep implementation.
      }
    })
    this.entries.set(nodeId, {
      state: 'auto-surface',
      object: binding?.object ?? null,
      bodies,
      primaryBody: (binding?.body as PhysicsBodyWithCollisionFlags | undefined) ?? null,
      orientationAdjustment: binding?.orientationAdjustment ?? null,
      storedBodies,
    })
  }

  beginManualPhysics(nodeId: string): void {
    const existing = this.entries.get(nodeId)
    if (existing?.state === 'auto-surface') {
      this.endAutoSurface(nodeId)
    }
    const entry = this.entries.get(nodeId)
    if (entry) {
      entry.state = 'manual-physics'
      return
    }
    this.entries.set(nodeId, {
      state: 'manual-physics',
      object: null,
      bodies: [],
      primaryBody: null,
      orientationAdjustment: null,
      storedBodies: [],
    })
  }

  endManualPhysics(nodeId: string): void {
    const entry = this.entries.get(nodeId)
    if (!entry || entry.state !== 'manual-physics') {
      return
    }
    entry.state = 'idle-physics'
  }

  endAutoSurface(nodeId: string): void {
    const entry = this.entries.get(nodeId)
    if (!entry) {
      return
    }
    this.restoreBodies(entry, true)
    entry.state = 'idle-physics'
  }

  clear(): void {
    this.entries.forEach((entry) => this.restoreBodies(entry, false))
    this.entries.clear()
  }

  private restoreBodies(entry: AuthorityEntry, syncFromObject: boolean): void {
    if (syncFromObject && entry.object && entry.primaryBody) {
      syncBodyFromObject(
        entry.primaryBody as unknown as PhysicsBodyBindingEntry['body'],
        entry.object,
        entry.orientationAdjustment,
      )
    }
    entry.storedBodies.forEach((stored) => {
      if (stored.collisionResponse !== undefined) {
        stored.body.collisionResponse = stored.collisionResponse
      }
      if (stored.collisionFilterMask !== undefined) {
        stored.body.collisionFilterMask = stored.collisionFilterMask
      }
      if (stored.collisionFilterGroup !== undefined) {
        stored.body.collisionFilterGroup = stored.collisionFilterGroup
      }
    })
    entry.bodies = []
    entry.storedBodies = []
  }
}
