import * as THREE from 'three'
import { createParticlePresetProps } from './particlePresets'
import {
  createParticleSystemRuntime,
  type ParticleSystemRuntimeHandle,
} from './particleRuntime'
import { getPunchCelebrationEffect } from './punchCelebration'
import type { PunchCelebrationEffectId } from '../core'

const DEFAULT_CELEBRATION_DURATION_SECONDS = 4
const CELEBRATION_TOP_CLEARANCE = 0.25
const FALLBACK_TOP_HEIGHT = 1.8
const PARTICLE_EFFECT_GROUP_NAME = 'Effect:ParticleSystem'
const PUNCH_EFFECT_GROUP_NAME = 'Effect:PunchCelebration'

export interface PunchCelebrationTarget {
  nodeId: string
  object: THREE.Object3D
}

export type PunchCelebrationTargetResolver = () => PunchCelebrationTarget | null

interface ActivePunchCelebration {
  anchor: THREE.Group
  runtime: ParticleSystemRuntimeHandle
  resolveTarget: PunchCelebrationTargetResolver
  targetObject: THREE.Object3D
  localAnchor: THREE.Vector3
  elapsed: number
}

function readInstancedBounds(object: THREE.Object3D): THREE.Box3 | null {
  const raw = object.userData?.instancedBounds as {
    min?: [number, number, number]
    max?: [number, number, number]
  } | undefined
  if (!raw?.min || !raw?.max) {
    return null
  }
  const localBounds = new THREE.Box3(
    new THREE.Vector3().fromArray(raw.min),
    new THREE.Vector3().fromArray(raw.max),
  )
  object.updateMatrixWorld(true)
  return localBounds.applyMatrix4(object.matrixWorld)
}

function collectRenderableBounds(object: THREE.Object3D): THREE.Box3 {
  const bounds = new THREE.Box3()
  const meshBounds = new THREE.Box3()
  object.updateMatrixWorld(true)

  const visit = (child: THREE.Object3D): void => {
    if (!child.visible) {
      return
    }
    if (child.name === PARTICLE_EFFECT_GROUP_NAME || child.name === PUNCH_EFFECT_GROUP_NAME) {
      return
    }
    const mesh = child as THREE.Mesh
    if (mesh.isMesh && mesh.geometry) {
      if (!mesh.geometry.boundingBox) {
        mesh.geometry.computeBoundingBox()
      }
      if (mesh.geometry.boundingBox) {
        mesh.updateWorldMatrix(true, false)
        meshBounds.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld)
        if (!meshBounds.isEmpty()) {
          bounds.union(meshBounds)
        }
      }
    }
    child.children.forEach(visit)
  }

  visit(object)
  return bounds
}

export function resolvePunchCelebrationAnchor(
  object: THREE.Object3D,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  object.updateMatrixWorld(true)
  const bounds = readInstancedBounds(object) ?? collectRenderableBounds(object)
  if (bounds.isEmpty()) {
    object.getWorldPosition(target)
    target.y += FALLBACK_TOP_HEIGHT
    return target
  }
  const center = bounds.getCenter(new THREE.Vector3())
  target.set(center.x, bounds.max.y + CELEBRATION_TOP_CLEARANCE, center.z)
  return target
}

export class PunchCelebrationRuntime {
  private readonly active: ActivePunchCelebration[] = []
  private readonly anchorScratch = new THREE.Vector3()

  play(
    effectId: PunchCelebrationEffectId | string | null | undefined,
    scene: THREE.Scene | null,
    resolveTarget: PunchCelebrationTargetResolver,
  ): boolean {
    if (!scene) {
      return false
    }
    const effect = getPunchCelebrationEffect(effectId)
    if (!effect) {
      return false
    }
    const initialTarget = resolveTarget()
    if (!initialTarget) {
      return false
    }

    const props = createParticlePresetProps(effect.particlePresetId)
    const runtime = createParticleSystemRuntime(props)
    const anchor = new THREE.Group()
    anchor.name = PUNCH_EFFECT_GROUP_NAME
    anchor.position.copy(resolvePunchCelebrationAnchor(initialTarget.object, this.anchorScratch))
    anchor.add(runtime.group)
    scene.add(anchor)
    const localAnchor = initialTarget.object.worldToLocal(anchor.position.clone())

    runtime.restart()
    runtime.burst(props.exposedParams.burstCount)
    this.active.push({
      anchor,
      runtime,
      resolveTarget,
      targetObject: initialTarget.object,
      localAnchor,
      elapsed: 0,
    })
    return true
  }

  tick(
    deltaSeconds: number,
    frameState: { cameraWorldPosition: { x: number; y: number; z: number } | null } = {
      cameraWorldPosition: null,
    },
  ): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || !this.active.length) {
      return
    }
    for (let index = this.active.length - 1; index >= 0; index -= 1) {
      const entry = this.active[index]
      if (!entry) {
        continue
      }
      entry.elapsed += deltaSeconds
      const target = entry.resolveTarget()
      if (target && target.object !== entry.targetObject) {
        entry.targetObject = target.object
        entry.localAnchor.copy(
          target.object.worldToLocal(
            resolvePunchCelebrationAnchor(target.object, this.anchorScratch),
          ),
        )
      }
      entry.targetObject.updateMatrixWorld(true)
      entry.anchor.position.copy(entry.localAnchor)
      entry.targetObject.localToWorld(entry.anchor.position)
      entry.runtime.tick(deltaSeconds, frameState)
      if (entry.elapsed < DEFAULT_CELEBRATION_DURATION_SECONDS) {
        continue
      }
      this.disposeEntry(index)
    }
  }

  clear(): void {
    for (let index = this.active.length - 1; index >= 0; index -= 1) {
      this.disposeEntry(index)
    }
  }

  getActiveCount(): number {
    return this.active.length
  }

  private disposeEntry(index: number): void {
    const entry = this.active[index]
    if (!entry) {
      return
    }
    this.active.splice(index, 1)
    entry.runtime.dispose()
    entry.anchor.removeFromParent()
  }
}

export function createPunchCelebrationRuntime(): PunchCelebrationRuntime {
  return new PunchCelebrationRuntime()
}
