import { describe, expect, it } from 'vitest'

import { createPhysicsInitializationGate } from '@schema/physicsInitializationGate'

describe('physics initialization gate', () => {
  it('stays closed until every active lease finishes', () => {
    const gate = createPhysicsInitializationGate()
    const sceneLoad = gate.begin()
    const extraCoverage = gate.begin()

    expect(gate.hasPending()).toBe(true)
    expect(gate.finish(sceneLoad)).toBe(true)
    expect(gate.hasPending()).toBe(true)
    expect(gate.finish(extraCoverage)).toBe(true)
    expect(gate.hasPending()).toBe(false)
  })

  it('does not let a stale lease clear a newer initialization request', () => {
    const gate = createPhysicsInitializationGate()
    const stale = gate.begin()
    const current = gate.begin()

    gate.finish(stale)
    expect(gate.hasPending()).toBe(true)

    gate.finish(current)
    expect(gate.hasPending()).toBe(false)
  })
})
