import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  createBehaviorTemplate,
  ensureBehaviorParams,
  normalizePunchBehaviorParams,
} from '@schema/behaviors/definitions'
import {
  registerBehaviorComponent,
  resetBehaviorRuntime,
  triggerBehaviorAction,
  unregisterBehaviorComponent,
} from '@schema/behaviors/runtime'
import {
  listPunchCelebrationOptions,
  normalizePunchCelebrationEffectId,
  shouldPlayPunchCelebration,
} from '@schema/particles/punchCelebration'
import {
  createPunchCelebrationRuntime,
  resolvePunchCelebrationAnchor,
} from '@schema/particles/punchCelebrationRuntime'

describe('Punch celebration behavior', () => {
  it('offers a disabled option and the built-in confetti effect', () => {
    expect(listPunchCelebrationOptions()).toEqual([
      { title: '不播放动画', value: 'none' },
      { title: '彩纸爆炸', value: 'confettiBurst' },
    ])
    expect(normalizePunchCelebrationEffectId('none')).toBe('none')
    expect(normalizePunchCelebrationEffectId('unknown')).toBe('confettiBurst')
  })

  it('normalizes legacy Punch params to first-only confetti', () => {
    expect(normalizePunchBehaviorParams(undefined)).toEqual({
      celebrationEffectId: 'confettiBurst',
      celebrationOnlyFirst: true,
    })
    expect(ensureBehaviorParams({ type: 'punch', params: {} } as never)).toEqual({
      type: 'punch',
      params: {
        celebrationEffectId: 'confettiBurst',
        celebrationOnlyFirst: true,
      },
    })
    expect(ensureBehaviorParams({
      type: 'punch',
      params: {
        celebrationEffectId: 'none',
        celebrationOnlyFirst: false,
      },
    })).toEqual({
      type: 'punch',
      params: {
        celebrationEffectId: 'none',
        celebrationOnlyFirst: false,
      },
    })
  })

  it('applies no effect and first-only repeat policy consistently', () => {
    expect(shouldPlayPunchCelebration('none', false, false)).toBe(false)
    expect(shouldPlayPunchCelebration('confettiBurst', true, false)).toBe(true)
    expect(shouldPlayPunchCelebration('confettiBurst', true, true)).toBe(false)
    expect(shouldPlayPunchCelebration('confettiBurst', false, true)).toBe(true)
  })

  it('emits normalized celebration settings with the Punch runtime event', () => {
    const step = createBehaviorTemplate('click', 'punch', 'punch-sequence')
    step.id = 'punch-step'
    registerBehaviorComponent('punch-node', [step], new THREE.Object3D())
    const event = triggerBehaviorAction('punch-node', 'click', {})
      .find((entry) => entry.type === 'punch')
    expect(event).toMatchObject({
      type: 'punch',
      celebrationEffectId: 'confettiBurst',
      celebrationOnlyFirst: true,
    })
    unregisterBehaviorComponent('punch-node')
    resetBehaviorRuntime()
  })

  it('anchors above renderable bounds and ignores existing particle effects', () => {
    const target = new THREE.Group()
    target.position.set(10, 5, 3)
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6))
    target.add(body)
    const existingEffect = new THREE.Group()
    existingEffect.name = 'Effect:ParticleSystem'
    const oversizedEffectMesh = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100))
    oversizedEffectMesh.position.y = 200
    existingEffect.add(oversizedEffectMesh)
    target.add(existingEffect)

    expect(resolvePunchCelebrationAnchor(target).toArray()).toEqual([10, 7.25, 3])
  })

  it('follows the active target and disposes transient particles after four seconds', () => {
    const scene = new THREE.Scene()
    const target = new THREE.Group()
    target.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)))
    scene.add(target)
    const runtime = createPunchCelebrationRuntime()

    expect(runtime.play('confettiBurst', scene, () => ({ nodeId: 'actor', object: target }))).toBe(true)
    expect(runtime.getActiveCount()).toBe(1)
    const anchor = scene.getObjectByName('Effect:PunchCelebration')
    expect(anchor?.position.toArray()).toEqual([0, 1.25, 0])

    target.position.x = 6
    runtime.tick(0.1)
    expect(anchor?.position.toArray()).toEqual([6, 1.25, 0])

    runtime.tick(4)
    expect(runtime.getActiveCount()).toBe(0)
    expect(scene.getObjectByName('Effect:PunchCelebration')).toBeUndefined()
  })
})
