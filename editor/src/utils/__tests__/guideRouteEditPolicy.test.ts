import { describe, expect, it } from 'vitest'

import type { GuideRouteComponentProps } from '@schema/components'
import {
  createGuidePathRouteLeg,
  createGuideRoadRouteLeg,
} from '@schema/components'
import { resolveGuideRoutePathHandles } from '@/utils/guideRouteEditPolicy'

function point(x: number, y = 0, z = 0) {
  return { x, y, z }
}

function pathLeg(id: string, anchors: ReturnType<typeof point>[]) {
  return createGuidePathRouteLeg({
    id,
    anchors: anchors.map((anchor, index) => ({
      ...anchor,
      id: `${id}-anchor-${index + 1}`,
    })),
    preserveAuthoredY: true,
  })
}

function makeProps(
  legs: GuideRouteComponentProps['legs'],
  branchOrigin: GuideRouteComponentProps['branchOrigin'] = null,
): GuideRouteComponentProps {
  return {
    version: 3,
    loop: false,
    legs,
    stops: [],
    transitions: [],
    origin: null,
    branchOrigin,
  }
}

describe('guide route path handle policy', () => {
  it('keeps every pure path anchor editable and identifies route endpoints', () => {
    const handles = resolveGuideRoutePathHandles(makeProps([
      pathLeg('path-1', [point(0), point(10), point(20)]),
    ]))

    expect(handles.map((handle) => handle.endpoint)).toEqual(['start', null, 'end'])
    expect(handles.every((handle) => !handle.locked)).toBe(true)
  })

  it('has no editable path handles on a road-only route', () => {
    const handles = resolveGuideRoutePathHandles(makeProps([
      createGuideRoadRouteLeg({ id: 'road-1', providerNodeId: 'terrain' }),
    ]))

    expect(handles).toEqual([])
  })

  it('locks only the path side attached to a road', () => {
    const roadToPath = resolveGuideRoutePathHandles(makeProps([
      createGuideRoadRouteLeg({ id: 'road-1', providerNodeId: 'terrain' }),
      pathLeg('path-1', [point(0), point(10), point(20)]),
    ]))
    expect(roadToPath.map((handle) => handle.locked)).toEqual([true, false, false])
    expect(roadToPath[0]?.lockReason).toBe('road-boundary')
    expect(roadToPath.some((handle) => handle.endpoint === 'start')).toBe(false)

    const pathToRoad = resolveGuideRoutePathHandles(makeProps([
      pathLeg('path-1', [point(0), point(10), point(20)]),
      createGuideRoadRouteLeg({ id: 'road-1', providerNodeId: 'terrain' }),
    ]))
    expect(pathToRoad.map((handle) => handle.locked)).toEqual([false, false, true])
    expect(pathToRoad[2]?.lockReason).toBe('road-boundary')
    expect(pathToRoad.some((handle) => handle.endpoint === 'end')).toBe(false)
  })

  it('keeps both outer path endpoints editable around an internal road leg', () => {
    const handles = resolveGuideRoutePathHandles(makeProps([
      pathLeg('path-start', [point(-20), point(-10), point(0)]),
      createGuideRoadRouteLeg({ id: 'road-1', providerNodeId: 'terrain' }),
      pathLeg('path-end', [point(10), point(20), point(30)]),
    ]))

    expect(handles.map((handle) => handle.locked)).toEqual([
      false,
      false,
      true,
      true,
      false,
      false,
    ])
    expect(handles.find((handle) => handle.endpoint === 'start')?.locked).toBe(false)
    expect(handles.find((handle) => handle.endpoint === 'end')?.locked).toBe(false)
  })

  it('locks a branch origin while leaving its terminal and middle anchors editable', () => {
    const handles = resolveGuideRoutePathHandles(makeProps(
      [pathLeg('branch-path', [point(0), point(10), point(20)])],
      { routeNodeId: 'parent', stopId: 'stop-1' },
    ))

    expect(handles.map((handle) => handle.locked)).toEqual([true, false, false])
    expect(handles[0]?.lockReason).toBe('branch-origin')
    expect(handles[0]?.endpoint).toBe('start')
    expect(handles[2]?.endpoint).toBe('end')
  })
})
