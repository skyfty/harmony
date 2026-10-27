import { describe, expect, it } from 'vitest'

import {
  clampGuideRouteComponentProps,
  createGuidePathRouteLeg,
  type GuideRouteStop,
} from '@schema/components'
import { addGuideRouteStop } from '@schema/guideRouteEditing'
import { parseGuideRouteDecimalInput } from '@/utils/guideRouteInputDraft'

function routeProps(stops: unknown[] = []) {
  return clampGuideRouteComponentProps({
    loop: false,
    legs: [createGuidePathRouteLeg({
      id: 'path-1',
      anchors: [
        { id: 'anchor-1', x: 0, y: 0, z: 0 },
        { id: 'anchor-2', x: 10, y: 0, z: 0 },
      ],
    })],
    stops: stops as GuideRouteStop[],
    transitions: [],
  })
}

function stopCandidate(name?: unknown) {
  const candidate: Record<string, unknown> = {
    id: 'stop-1',
    thumbnailAssetId: null,
    anchor: { x: 5, y: 0, z: 0 },
    legId: 'path-1',
    behavior: null,
    controlAnchorId: null,
  }
  if (name !== undefined) {
    candidate.name = name
  }
  return candidate
}

describe('Guide Route deferred input drafts', () => {
  it('preserves explicit blank stop names while defaulting missing or invalid names', () => {
    expect(routeProps([stopCandidate('')]).stops[0]?.name).toBe('')
    expect(routeProps([stopCandidate('   ')]).stops[0]?.name).toBe('')
    expect(routeProps([stopCandidate()]).stops[0]?.name).toBe('Stop 1')
    expect(routeProps([stopCandidate(42)]).stops[0]?.name).toBe('Stop 1')
  })

  it('keeps the generated default when creating a new stop', () => {
    const added = addGuideRouteStop(routeProps(), {
      legId: 'path-1',
      anchor: { x: 5, y: 0, z: 0 },
    })
    expect(added?.props.stops[0]?.name).toBe('Stop 1')
  })

  it('accepts committed decimal values but rejects transient or invalid input', () => {
    expect(parseGuideRouteDecimalInput('')).toBeNull()
    expect(parseGuideRouteDecimalInput('-')).toBeNull()
    expect(parseGuideRouteDecimalInput('.')).toBeNull()
    expect(parseGuideRouteDecimalInput('-.')).toBeNull()
    expect(parseGuideRouteDecimalInput('1e3')).toBeNull()

    expect(parseGuideRouteDecimalInput('1.')).toBe(1)
    expect(parseGuideRouteDecimalInput('.5')).toBe(0.5)
    expect(parseGuideRouteDecimalInput('-2.3')).toBe(-2.3)
    expect(parseGuideRouteDecimalInput(' 12.5 ')).toBe(12.5)
  })
})
