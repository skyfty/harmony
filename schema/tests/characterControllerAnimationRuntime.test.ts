import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCharacterControllerAnimationBindings } from '../characterControllerAnimationRuntime.ts'

test('matches animation clips to character controller slots by normalized name', () => {
  const bindings = resolveCharacterControllerAnimationBindings([
    'idle',
    'hero_walk_cycle',
    'RUN',
    'sprint-fast',
    'turn_left',
    'jump_up',
    'fall-down',
    'side_strafe',
    'crouch pose',
    'interact_action',
    'death_animation',
  ])

  assert.deepEqual(bindings.map((binding) => binding.clipName), [
    'idle',
    'hero_walk_cycle',
    'RUN',
    'sprint-fast',
    'turn_left',
    'jump_up',
    'fall-down',
    'side_strafe',
    'crouch pose',
    'interact_action',
    'death_animation',
  ])
})

test('does not reuse the same clip for multiple slots', () => {
  const bindings = resolveCharacterControllerAnimationBindings([
    'idle_walk',
    'walk_cycle',
  ])

  assert.equal(bindings[0]?.clipName, 'idle_walk')
  assert.equal(bindings[1]?.clipName, 'walk_cycle')
  assert.notEqual(bindings[0]?.clipName, bindings[1]?.clipName)
})

test('returns empty bindings when no clip matches any slot', () => {
  const bindings = resolveCharacterControllerAnimationBindings([
    'pose_a',
    'pose_b',
  ])

  assert.equal(bindings.length, 11)
  assert.ok(bindings.every((binding) => binding.clipName === null))
})
