import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createBehaviorTemplate,
  ensureBehaviorParams,
} from '../behaviors/definitions.ts'
import { registerBehaviorComponent, unregisterBehaviorComponent, triggerBehaviorAction, resolveBehaviorEvent } from '../behaviors/runtime.ts'
import type { BehaviorComponentProps } from '../core.ts'

test('creates and normalizes switch control node behavior for all target types', () => {
  for (const targetType of ['vehicle', 'character', 'ship', 'aircraft'] as const) {
    const behavior = createBehaviorTemplate('click', 'switchControlNode')
    behavior.script = ensureBehaviorParams({
      type: 'switchControlNode',
      params: { targetType },
    })
    assert.equal(behavior.script.type, 'switchControlNode')
    assert.equal(behavior.script.params.targetType, targetType)
    assert.equal(behavior.script.params.transitionPreset, 'quantum')
  }
})

test('switch control node emits an asynchronous token event', () => {
  const nodeId = `switch-test-${Date.now()}`
  const props: BehaviorComponentProps = {
    behaviors: [{
      id: 'switch-behavior',
      name: 'switch',
      action: 'click',
      sequenceId: 'sequence-1',
      script: { type: 'switchControlNode', params: { targetType: 'ship' } },
    }],
  }
  registerBehaviorComponent(nodeId, props.behaviors, null)
  const events = triggerBehaviorAction(nodeId, 'click', {})
  assert.equal(events[0]?.type, 'control-node-switch')
  assert.equal((events[0] as { targetType: string }).targetType, 'ship')
  assert.equal((events[0] as { transitionPreset: string }).transitionPreset, 'quantum')
  const token = (events[0] as { token: string }).token
  const completion = resolveBehaviorEvent(token, { type: 'fail', message: 'test' })
  assert.equal(completion[0]?.type, 'sequence-complete')
  unregisterBehaviorComponent(nodeId)
})

test('restore control node normalizes and emits the selected transition preset', () => {
  const nodeId = `restore-test-${Date.now()}`
  const behavior = createBehaviorTemplate('click', 'restoreControlNode')
  behavior.script = ensureBehaviorParams({
    type: 'restoreControlNode',
    params: { transitionPreset: 'vortex' },
  })
  assert.equal(behavior.script.params.transitionPreset, 'vortex')
  const props: BehaviorComponentProps = {
    behaviors: [{
      id: 'restore-behavior',
      name: 'restore',
      action: 'click',
      sequenceId: 'restore-sequence',
      script: behavior.script,
    }],
  }
  registerBehaviorComponent(nodeId, props.behaviors, null)
  const events = triggerBehaviorAction(nodeId, 'click', {})
  assert.equal(events[0]?.type, 'control-node-restore')
  assert.equal((events[0] as { transitionPreset: string }).transitionPreset, 'vortex')
  const token = (events[0] as { token: string }).token
  resolveBehaviorEvent(token, { type: 'fail', message: 'test' })
  unregisterBehaviorComponent(nodeId)
})
