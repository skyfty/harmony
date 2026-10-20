import { describe, expect, it } from 'vitest'
import {
  PROCEDURAL_LANDSCAPE_AUTO_QUALITY,
  resolveProceduralLandscapeQuality,
} from '@schema/proceduralLandscape/config'

describe('procedural landscape automatic quality', () => {
  it('uses high for the viewer and editor environments', () => {
    expect(PROCEDURAL_LANDSCAPE_AUTO_QUALITY.viewer).toBe('high')
    expect(PROCEDURAL_LANDSCAPE_AUTO_QUALITY.editor).toBe('high')
    expect(resolveProceduralLandscapeQuality('auto', 'viewer')).toBe('high')
    expect(resolveProceduralLandscapeQuality('auto', 'editor')).toBe('high')
  })

  it('keeps explicit scene quality overrides', () => {
    expect(resolveProceduralLandscapeQuality('low', 'viewer')).toBe('low')
    expect(resolveProceduralLandscapeQuality('medium', 'viewer')).toBe('medium')
    expect(resolveProceduralLandscapeQuality('high', 'viewer')).toBe('high')
  })
})
