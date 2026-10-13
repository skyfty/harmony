/**
 * ComponentManager 共享帧状态测试。
 *
 * 宿主（editor / preview / SceneryViewer）每帧下发
 * `{ cameraWorldPosition, environment: { season, timeOfDay, weather } }`；
 * proceduralLandscape 从帧状态读取季节决定四季素材与调色板。
 *
 * 回归背景：setFrameState 曾只拷贝 cameraWorldPosition、丢弃 environment，
 * 导致运行时永远回退 spring，切换季节时树木/植被/地表素材不变化。
 */
import { describe, expect, it } from 'vitest'
import { Component, type ComponentFrameState, type ComponentRuntimeContext } from '@schema/components/Component'
import { ComponentManager, type ComponentDefinition } from '@schema/components/componentManager'
import type { SceneNode } from '@schema/core'

type ProbeProps = Record<string, never>

const probeSeen: Array<ComponentFrameState['environment']> = []

class EnvironmentProbeComponent extends Component<ProbeProps> {
  constructor(context: ComponentRuntimeContext<ProbeProps>) {
    super(context)
  }

  onUpdate(): void {
    probeSeen.push(this.context.getFrameState().environment ?? null)
  }
}

const probeDefinition: ComponentDefinition<ProbeProps> = {
  type: 'test-environment-probe',
  label: 'Environment Probe',
  canAttach: () => true,
  createDefaultProps: () => ({}),
  createInstance: (context) => new EnvironmentProbeComponent(context),
}

function createProbeNode(): SceneNode {
  return {
    id: 'probe-node',
    name: 'Probe Node',
    nodeType: 'Group',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    components: {
      probe: { id: 'probe', type: 'test-environment-probe', enabled: true, props: {} },
    },
  } as unknown as SceneNode
}

describe('ComponentManager frame state', () => {
  it('propagates environment season/time/weather to component contexts', () => {
    probeSeen.length = 0
    const manager = new ComponentManager()
    manager.registerDefinition(probeDefinition)
    manager.syncScene([createProbeNode()])

    const environment = { season: 'winter', timeOfDay: 'night', weather: 'clear' } as const
    manager.setFrameState({ cameraWorldPosition: { x: 1, y: 2, z: 3 }, environment })
    manager.update(0.016)
    const firstSeen = probeSeen[probeSeen.length - 1]
    expect(firstSeen).toEqual(environment)
    // 帧状态逐字段拷贝，不持有宿主复用的临时对象。
    expect(firstSeen).not.toBe(environment)

    // 再次切换季节无需重新 syncScene 即可生效。
    const nextEnvironment = { season: 'summer', timeOfDay: 'day', weather: 'overcast' } as const
    manager.setFrameState({ cameraWorldPosition: { x: 1, y: 2, z: 3 }, environment: nextEnvironment })
    manager.update(0.016)
    expect(probeSeen[probeSeen.length - 1]).toEqual(nextEnvironment)

    // 宿主未提供环境状态时清空，组件按约定回退默认季节。
    manager.setFrameState({ cameraWorldPosition: null })
    manager.update(0.016)
    expect(probeSeen[probeSeen.length - 1]).toBeNull()
  })
})
