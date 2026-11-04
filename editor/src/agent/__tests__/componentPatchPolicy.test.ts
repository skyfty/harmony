import type { SceneNode, SceneNodeComponentState } from '@schema/core'
import { describe, expect, it } from 'vitest'
import { AgentBridgeError } from '@/agent/errors'
import { validateSimpleComponentPatch } from '@/agent/operations'

const node = {
  id: 'policy-node',
  name: 'Policy Node',
  nodeType: 'Group',
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
} as SceneNode

describe('component patch policy', () => {
  it('rejects protected domain collections from generic patches', () => {
    const component = {
      id: 'behavior-component',
      type: 'behavior',
      enabled: true,
      props: { behaviors: [] },
    } as SceneNodeComponentState<Record<string, unknown>>
    expect(() => validateSimpleComponentPatch(node, component, { behaviors: [] }))
      .toThrowError(AgentBridgeError)
    try {
      validateSimpleComponentPatch(node, component, { behaviors: [] })
    } catch (error) {
      expect((error as AgentBridgeError).code).toBe('FIELD_REQUIRES_DOMAIN_TOOL')
    }
  })

  it('accepts only fields exposed by the component profile', () => {
    const component = {
      id: 'coupon-component',
      type: 'couponComponent',
      enabled: true,
      props: { couponJson: '{}' },
    } as SceneNodeComponentState<Record<string, unknown>>
    expect(() => validateSimpleComponentPatch(node, component, { couponJson: '{}' }))
      .not.toThrow()
    expect(() => validateSimpleComponentPatch(node, component, { hiddenRuntimeField: 1 }))
      .toThrowError(AgentBridgeError)
  })
})
