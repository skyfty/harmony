import { describe, expect, it } from 'vitest'
import { resolveCharacterGroundProbeClearance } from '../../../../physics-cannon/src/characterGroundProbe'

describe('Cannon character ground probe clearance', () => {
  it('measures vertical clearance from the character foot reference', () => {
    const result = resolveCharacterGroundProbeClearance(0.876, 0.773)
    expect(result.verticalGapFromBase).toBeCloseTo(0.103)
    expect(result.clearance).toBeCloseTo(0.103)
    expect(result.isGroundCandidate).toBe(true)
  })

  it('rejects uphill hits above the character foot reference', () => {
    const result = resolveCharacterGroundProbeClearance(0.876, 1.202)
    expect(result.verticalGapFromBase).toBeCloseTo(-0.326)
    expect(result.clearance).toBe(0)
    expect(result.isGroundCandidate).toBe(false)
  })
})