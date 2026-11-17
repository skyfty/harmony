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
import { allocateParticleBurstCounts } from '@schema/particles/particleRuntime'
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
        maxParticles: 42,
      },
    })
    expect(celebration?.props.emitters).toHaveLength(3)
    expect(celebration?.props.emitters.reduce((sum, emitter) => sum + emitter.maxParticles, 0))
      .toBeLessThanOrEqual(42)
    expect(celebration?.props.exposedParams.burstCount).toBe(36)
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
    expect(allocateParticleBurstCounts(36, [14, 14, 14])).toEqual([12, 12, 12])
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
                    count: 36,
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
        count: 36,
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
      getParticleCount: vi.fn(() => 36),
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
            count: 36,
          },
        },
      ],
    })

    expect(result.afterRevision).toBe(revision)
    expect(restart).toHaveBeenCalledOnce()
    expect(burst).toHaveBeenCalledWith(36, undefined)
    expect(tick).toHaveBeenCalledTimes(5)
    expect(result.results[0]).toMatchObject({
      presetId: 'celebrationConfettiLite',
      count: 36,
      particleCount: 36,
      previewed: true,
    })
    vi.clearAllTimers()
  })
})
