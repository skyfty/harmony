import { Vector3, type Box3 } from 'three'

export const SUSPICIOUS_SMALL_MODEL_MAX_DIMENSION_METERS = 0.05

export interface ImportedModelScaleDiagnostic {
  code: 'suspicious-small-unit-scale'
  maxDimensionMeters: number
  thresholdMeters: number
  message: string
}

/**
 * Flags likely repeat-applied centimetre/metre scaling without changing the
 * model. Tiny assets can be intentional, so this is diagnostic-only.
 */
export function diagnoseImportedModelScale(
  bounds: Box3 | null | undefined,
): ImportedModelScaleDiagnostic | null {
  if (!bounds || bounds.isEmpty()) {
    return null
  }
  const size = bounds.getSize(new Vector3())
  const maxDimensionMeters = Math.max(
    Math.abs(size.x),
    Math.abs(size.y),
    Math.abs(size.z),
  )
  if (
    !Number.isFinite(maxDimensionMeters)
    || maxDimensionMeters <= 0
    || maxDimensionMeters >= SUSPICIOUS_SMALL_MODEL_MAX_DIMENSION_METERS
  ) {
    return null
  }
  return {
    code: 'suspicious-small-unit-scale',
    maxDimensionMeters,
    thresholdMeters: SUSPICIOUS_SMALL_MODEL_MAX_DIMENSION_METERS,
    message: `模型最大尺寸仅 ${(maxDimensionMeters * 100).toFixed(2)} cm，疑似重复应用了厘米/米缩放。`,
  }
}
