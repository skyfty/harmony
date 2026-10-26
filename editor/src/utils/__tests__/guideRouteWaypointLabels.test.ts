import { afterEach, describe, expect, it, vi } from 'vitest'

import { createGuideRouteWaypointLabelTexture } from '@/components/editor/GuideRouteWaypointLabels'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Guide Route waypoint labels', () => {
  it('draws CJK stop names into the canvas texture without glyph substitution', () => {
    const fillText = vi.fn()
    const strokeText = vi.fn()
    const context = {
      font: '',
      textAlign: '',
      textBaseline: '',
      lineJoin: '',
      lineWidth: 0,
      strokeStyle: '',
      fillStyle: '',
      measureText: (text: string) => ({ width: Array.from(text).length * 50 }),
      fillText,
      strokeText,
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
    }
    vi.stubGlobal('document', {
      createElement: () => canvas,
    })

    const label = createGuideRouteWaypointLabelTexture('清凉禅寺')

    expect(fillText).toHaveBeenCalledWith('清凉禅寺', canvas.width / 2, canvas.height / 2)
    expect(strokeText).toHaveBeenCalledWith('清凉禅寺', canvas.width / 2, canvas.height / 2)
    expect(label.texture.name).toBe('GuideRouteWaypointLabel:清凉禅寺')
    expect(label.worldWidth).toBeGreaterThan(0)
    expect(label.worldHeight).toBeGreaterThan(0)
    label.texture.dispose()
  })
})
