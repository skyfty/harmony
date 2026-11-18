import * as THREE from 'three'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PARTICLE_SYSTEM_COMPONENT_TYPE,
  clampParticleSystemComponentProps,
  cloneParticleSystemComponentProps,
  createParticlePresetProps,
  getParticlePresetDefinition,
  listParticlePresets,
  registerParticleSystemRuntime,
  type ParticleSystemComponentProps,
} from '@schema/components'
import type { BehaviorComponentProps, SceneNodeComponentState } from '@schema/core'
import {
  allocateParticleBurstCounts,
  createParticleSystemRuntime,
} from '@schema/particles/particleRuntime'
import { applySceneOperations } from '@/agent/operations'
import { getRuntimeObject, useSceneStore } from '@/stores/sceneStore'

function createTestNode(
  store: ReturnType<typeof useSceneStore>,
  name = 'Particle test node',
) {
  const object = new THREE.Group()
  object.name = name
  return store.addSceneNode({
    nodeType: 'Group',
    object,
    name,
  })
}

describe('Particle Agent operations', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    const store = useSceneStore()
    store.currentSceneId = 'agent-particle-test'
    store.currentSceneMeta = {
      name: 'Agent particle test',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      projectId: 'agent-test-project',
    }
    store.isSceneReady = true
  })

  it('exposes the celebration preset with a bounded paper render mode', () => {
    const presets = listParticlePresets()
    const celebration = presets.find((preset) => preset.id === 'celebrationConfettiLite')

    expect(celebration).toMatchObject({
      category: 'Interaction',
      subcategory: 'Celebration',
    })
    expect(celebration?.props).toMatchObject({
      presetId: 'celebrationConfettiLite',
      playback: {
        autoPlay: false,
        loop: false,
        startActive: false,
      },
      render: {
        renderMode: 'paper',
        blendMode: 'alpha',
        depthWrite: false,
      },
      budget: {
        qualityTier: 'mini-safe',
        maxParticles: 112,
      },
    })
    expect(celebration?.props.emitters).toHaveLength(4)
    expect(celebration?.props.emitters.reduce((sum, emitter) => sum + emitter.maxParticles, 0))
      .toBe(112)
    expect(celebration?.props.exposedParams.burstCount).toBe(96)
    expect(celebration?.props.exposedParams.particleSize).toBeCloseTo(0.235)
    expect(celebration?.props.exposedParams.lifetime).toBeGreaterThanOrEqual(3.4)
    expect(celebration?.props.emitters.every((emitter) =>
      (emitter.physics?.force.y ?? 0) <= -0.05,
    )).toBe(true)
    expect(celebration?.props.emitters.map((emitter) => ({
      shape: emitter.shape,
      radius: emitter.radius,
      velocityMode: emitter.velocityMode,
      direction: emitter.direction,
      spread: emitter.spread,
      particleSize: emitter.particleSize,
      speed: emitter.speed,
    }))).toEqual([
      { shape: 'sphere', radius: 0.12, velocityMode: 'radial', direction: { x: 0, y: 1, z: 0 }, spread: 3.1, particleSize: 0.26, speed: 4.5 },
      { shape: 'sphere', radius: 0.12, velocityMode: 'radial', direction: { x: 0, y: 1, z: 0 }, spread: 3.1, particleSize: 0.245, speed: 4.75 },
      { shape: 'sphere', radius: 0.13, velocityMode: 'radial', direction: { x: 0, y: 1, z: 0 }, spread: 3.1, particleSize: 0.22, speed: 4.35 },
      { shape: 'sphere', radius: 0.12, velocityMode: 'radial', direction: { x: 0, y: 1, z: 0 }, spread: 3.1, particleSize: 0.225, speed: 4.9 },
    ])
  })

  it('normalizes legacy render props and deep-clones paper settings', () => {
    const source = createParticlePresetProps('celebrationConfettiLite')
    const normalized = clampParticleSystemComponentProps({
      ...source,
      render: {
        ...source.render,
        paper: {
          aspectRatio: 0.42,
          tumbleCyclesPerSecond: 1.6,
        },
      },
    })
    const clone = cloneParticleSystemComponentProps(normalized)

    expect(clone.render.paper).toEqual(normalized.render.paper)
    expect(clone.render.paper).not.toBe(normalized.render.paper)
    expect(getParticlePresetDefinition('groundAuraLite')?.props.render.renderMode).toBe('sprite')
  })

  it('distributes one burst across all emitters without exceeding capacities', () => {
    expect(allocateParticleBurstCounts(96, [28, 28, 28, 28])).toEqual([24, 24, 24, 24])
    expect(allocateParticleBurstCounts(7, [2, 6])).toEqual([2, 5])
    expect(allocateParticleBurstCounts(20, [0, 0])).toEqual([0, 0])
  })

  it('applies a particle preset and behavior sequence atomically', async () => {
    const store = useSceneStore()
    const node = createTestNode(store, 'Celebration test node')
    const component = store.addNodeComponent(node.id, PARTICLE_SYSTEM_COMPONENT_TYPE)?.component
    expect(component).toBeTruthy()
    const flushSpy = vi.spyOn(store, 'flushPendingSceneAutoSave').mockResolvedValue(null)
    const beforeRevision = store.sceneRevision

    const result = await applySceneOperations(store, {
      expectedRevision: beforeRevision,
      label: 'Configure celebration particle',
      operations: [
        {
          op: 'domain.apply',
          domain: 'builder',
          action: 'apply_preset',
          args: {
            nodeId: node.id,
            componentType: PARTICLE_SYSTEM_COMPONENT_TYPE,
            presetId: 'celebrationConfettiLite',
          },
        },
        {
          op: 'domain.apply',
          domain: 'behavior',
          action: 'replace',
          args: {
            nodeId: node.id,
            behaviors: [
              {
                id: 'behavior-burst',
                name: 'Celebration burst',
                action: 'punch',
                sequenceId: 'sequence-punch',
                script: {
                  type: 'burstParticleEffect',
                  params: {
                    targetNodeId: node.id,
                    componentId: component?.id ?? null,
                    emitterId: null,
                    count: 96,
                  },
                },
              },
            ],
          },
        },
      ],
    })

    const updated = store.getNodeById(node.id)
    const particle = updated?.components?.[PARTICLE_SYSTEM_COMPONENT_TYPE] as
      | SceneNodeComponentState<ParticleSystemComponentProps>
      | undefined
    const behavior = updated?.components?.behavior as
      | SceneNodeComponentState<BehaviorComponentProps>
      | undefined
    expect(result.afterRevision).toBe(beforeRevision + 1)
    expect(particle?.props).toMatchObject({
      presetId: 'celebrationConfettiLite',
      render: { renderMode: 'paper' },
    })
    expect(behavior?.props.behaviors[0]?.script).toMatchObject({
      type: 'burstParticleEffect',
      params: {
        targetNodeId: node.id,
        componentId: component?.id,
        count: 96,
      },
    })
    expect(flushSpy).toHaveBeenCalledOnce()
    vi.clearAllTimers()
  })

  it('rejects an unknown particle preset without changing the scene revision', async () => {
    const store = useSceneStore()
    const node = createTestNode(store, 'Invalid preset test node')
    store.addNodeComponent(node.id, PARTICLE_SYSTEM_COMPONENT_TYPE)
    const revision = store.sceneRevision

    await expect(applySceneOperations(store, {
      expectedRevision: revision,
      operations: [
        {
          op: 'domain.apply',
          domain: 'builder',
          action: 'apply_preset',
          args: {
            nodeId: node.id,
            componentType: PARTICLE_SYSTEM_COMPONENT_TYPE,
            presetId: 'missingConfettiPreset',
          },
        },
      ],
    })).rejects.toThrow('Unknown particle preset')
    expect(store.sceneRevision).toBe(revision)
    vi.clearAllTimers()
  })

  it('previews a particle burst through the semantic MCP operation without a revision', async () => {
    const store = useSceneStore()
    const node = createTestNode(store, 'Particle preview test node')
    const component = store.addNodeComponent(node.id, PARTICLE_SYSTEM_COMPONENT_TYPE)?.component
    const runtimeObject = getRuntimeObject(node.id)
    expect(component).toBeTruthy()
    expect(runtimeObject).toBeTruthy()
    const restart = vi.fn()
    const burst = vi.fn()
    const tick = vi.fn()
    registerParticleSystemRuntime(runtimeObject!, component!.id, {
      props: createParticlePresetProps('celebrationConfettiLite'),
      play: vi.fn(),
      stop: vi.fn(),
      restart,
      burst,
      getParticleCount: vi.fn(() => 96),
      tick,
      setPlaybackActive: vi.fn(),
      setExposedParams: vi.fn(),
      dispose: vi.fn(),
    })
    const revision = store.sceneRevision

    const result = await applySceneOperations(store, {
      expectedRevision: revision,
      operations: [
        {
          op: 'domain.apply',
          domain: 'builder',
          action: 'preview_particle',
          args: {
            nodeId: node.id,
            componentId: component?.id,
            count: 96,
          },
        },
      ],
    })

    expect(result.afterRevision).toBe(revision)
    expect(restart).toHaveBeenCalledOnce()
    expect(burst).toHaveBeenCalledWith(96, undefined)
    expect(tick).toHaveBeenCalledTimes(5)
    expect(result.results[0]).toMatchObject({
      presetId: 'celebrationConfettiLite',
      count: 96,
      particleCount: 96,
      previewed: true,
    })
    vi.clearAllTimers()
  })

  it('creates the dense paper burst and lets paper fall after the upward phase', () => {
    const runtime = createParticleSystemRuntime(
      createParticlePresetProps('celebrationConfettiLite'),
    )
    runtime.restart()
    runtime.burst(96)
    for (let frame = 0; frame < 10; frame += 1) {
      runtime.tick(1 / 30)
    }
    const renderGroup = runtime.group.getObjectByName('Effect:ParticleRenderGroup')
    const earlyPositions = renderGroup?.children
      .filter((child) => child.type === 'Mesh')
      .map((child) => child.position.clone()) ?? []
    expect(earlyPositions).toHaveLength(96)
    const horizontalSpan = Math.max(...earlyPositions.map((position) => Math.hypot(position.x, position.z)))
    expect(horizontalSpan).toBeGreaterThan(0.5)
    const earlyAverageY = earlyPositions.reduce((sum, position) => sum + position.y, 0)
      / earlyPositions.length
    for (let frame = 0; frame < 60; frame += 1) {
      runtime.tick(1 / 30)
    }
    const fallingPositions = renderGroup?.children
      .filter((child) => child.type === 'Mesh')
      .map((child) => child.position.clone()) ?? []
    expect(fallingPositions.length).toBeGreaterThan(0)
    const fallingAverageY = fallingPositions.reduce((sum, position) => sum + position.y, 0)
      / fallingPositions.length
    expect(fallingAverageY).toBeLessThan(earlyAverageY)
    runtime.dispose()
  })
})
