const GROUND_PROBE_BASE_TOLERANCE = 0.02

export type CharacterGroundProbeClearance = {
  verticalGapFromBase: number
  clearance: number
  isGroundCandidate: boolean
}

/**
 * Converts a vertical-ray hit height to clearance from the character's foot
 * reference. The ray origin is intentionally not part of this measurement.
 */
export function resolveCharacterGroundProbeClearance(
  baseY: number,
  hitY: number,
): CharacterGroundProbeClearance {
  const verticalGapFromBase = baseY - hitY
  return {
    verticalGapFromBase,
    clearance: Math.max(0, verticalGapFromBase),
    isGroundCandidate: verticalGapFromBase >= -GROUND_PROBE_BASE_TOLERANCE,
  }
}