import { Box3, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  SUSPICIOUS_SMALL_MODEL_MAX_DIMENSION_METERS,
  diagnoseImportedModelScale,
} from '@schema/modelScaleDiagnostics'

describe('imported model scale diagnostics', () => {
  it('flags a model that appears to have centimetre/metre scaling applied twice', () => {
    const bounds = new Box3(
      new Vector3(-0.005, 0, -0.008),
      new Vector3(0.005, 0.003, 0.008),
    )

    const diagnostic = diagnoseImportedModelScale(bounds)

    expect(diagnostic).toMatchObject({
      code: 'suspicious-small-unit-scale',
      thresholdMeters: SUSPICIOUS_SMALL_MODEL_MAX_DIMENSION_METERS,
    })
    expect(diagnostic?.maxDimensionMeters).toBeCloseTo(0.016)
    expect(diagnostic?.message).toContain('1.60 cm')
  })

  it('does not flag models whose largest dimension is at least five centimetres', () => {
    const bounds = new Box3(
      new Vector3(-0.5, 0, -0.2),
      new Vector3(0.5, 1.65, 0.2),
    )

    expect(diagnoseImportedModelScale(bounds)).toBeNull()
  })

  it('ignores empty bounds', () => {
    expect(diagnoseImportedModelScale(new Box3())).toBeNull()
    expect(diagnoseImportedModelScale(null)).toBeNull()
  })
})
