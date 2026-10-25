import { describe, expect, it } from 'vitest'

import {
  clampGuideRouteComponentProps,
  createGuidePathRouteLeg,
  type GuideRouteComponentProps,
} from '@schema/components'
import {
  addGuideRouteStop,
  addGuideRouteStopAtPathAnchor,
  appendGuideRoutePathExtension,
  createGuideRouteBranchProps,
  insertGuideRoutePathStop,
  moveGuideRouteStop,
  prependGuideRoutePathExtension,
  removeGuideRoutePathAnchor,
  removeGuideRouteStop,
  unlinkGuideRouteBranchOrigins,
} from '@schema/guideRouteEditing'

function point(x: number, y = 10, z = 0) {
  return { x, y, z }
}

function pathProps(): GuideRouteComponentProps {
  return clampGuideRouteComponentProps({
    version: 3,
    loop: false,
    legs: [createGuidePathRouteLeg({
      id: 'path-1',
      travelMode: 'character',
      anchors: [
        { ...point(0), id: 'a0' },
        { ...point(10), id: 'a1' },
      ],
    })],
    stops: [],
    transitions: [],
  })
}

describe('Guide Route editing model', () => {
  it('appends and prepends path anchor extensions while preserving ids', () => {
    const appended = appendGuideRoutePathExtension(pathProps(), point(10), [point(15), point(20)])
    const appendedLeg = appended.legs[0]
    expect(appendedLeg?.kind).toBe('path')
    if (appendedLeg?.kind !== 'path') {
      throw new Error('expected path leg')
    }
    expect(appendedLeg.anchors.map((anchor) => anchor.id)).toEqual(['a0', 'a1', expect.any(String), expect.any(String)])
    expect(appendedLeg.anchors[appendedLeg.anchors.length - 1]?.x).toBe(20)

    const prepended = prependGuideRoutePathExtension(pathProps(), point(0), [point(-5), point(-10)])
    const prependedLeg = prepended.legs[0]
    if (prependedLeg?.kind !== 'path') {
      throw new Error('expected path leg')
    }
    expect(prependedLeg.anchors[0]?.x).toBe(-10)
    expect(prependedLeg.anchors[1]?.x).toBe(-5)
    expect(prependedLeg.anchors[2]?.id).toBe('a0')
  })

  it('inserts a path stop anchor and moves both stop and route geometry', () => {
    const inserted = insertGuideRoutePathStop(pathProps(), {
      legId: 'path-1',
      anchorIndex: 1,
      anchor: point(5),
      name: 'Lookout',
    })
    expect(inserted).not.toBeNull()
    const props = inserted!.props
    const leg = props.legs[0]
    if (leg?.kind !== 'path') {
      throw new Error('expected path leg')
    }
    expect(leg.anchors).toHaveLength(3)
    expect(props.stops[0]?.controlAnchorId).toBe(inserted!.anchorId)

    const moved = moveGuideRouteStop(props, inserted!.stopId, point(6, 12, 2))
    const movedLeg = moved?.legs[0]
    if (movedLeg?.kind !== 'path') {
      throw new Error('expected path leg')
    }
    expect(moved?.stops[0]?.anchor).toEqual(point(6, 12, 2))
    expect(movedLeg.anchors.find((anchor) => anchor.id === inserted!.anchorId)).toMatchObject(point(6, 12, 2))
    const removed = removeGuideRouteStop(moved!, inserted!.stopId)
    const removedStopLeg = removed.props.legs[0]
    if (removedStopLeg?.kind !== 'path') {
      throw new Error('expected path leg')
    }
    expect(removedStopLeg.anchors).toHaveLength(3)
  })

  it('removes stop metadata while retaining path anchors and image references', () => {
    const added = addGuideRouteStop(pathProps(), {
      legId: 'path-1',
      anchor: point(5),
      thumbnailAssetId: 'image-1',
    })!
    const removed = removeGuideRouteStop(added.props, added.stopId)
    expect(removed.removedStop?.thumbnailAssetId).toBe('image-1')
    expect(removed.props.stops).toHaveLength(0)
    const remainingLeg = removed.props.legs[0]
    if (remainingLeg?.kind !== 'path') {
      throw new Error('expected path leg')
    }
    expect(remainingLeg.anchors).toHaveLength(2)
  })

  it('removes a selected anchor separately and detaches any linked stop', () => {
    const source = appendGuideRoutePathExtension(pathProps(), point(10), [point(20)])
    const added = addGuideRouteStopAtPathAnchor(source, {
      legId: 'path-1',
      anchorId: 'a1',
      name: 'Lookout',
    })!
    const removed = removeGuideRoutePathAnchor(added.props, {
      legId: 'path-1',
      anchorId: 'a1',
    })
    expect(removed).not.toBeNull()
    const leg = removed?.props.legs[0]
    if (leg?.kind !== 'path') {
      throw new Error('expected path leg')
    }
    expect(leg.anchors.map((anchor) => anchor.id)).toEqual(['a0', expect.any(String)])
    expect(removed?.props.stops[0]).toMatchObject({
      name: 'Lookout',
      controlAnchorId: null,
      anchor: point(10),
    })
  })

  it('promotes an existing path endpoint to a stop without inserting another anchor', () => {
    const added = addGuideRouteStopAtPathAnchor(pathProps(), {
      legId: 'path-1',
      anchorId: 'a1',
      name: 'Finish',
    })
    expect(added).not.toBeNull()
    expect(added?.created).toBe(true)
    const props = added!.props
    const leg = props.legs[0]
    if (leg?.kind !== 'path') {
      throw new Error('expected path leg')
    }
    expect(leg.anchors).toHaveLength(2)
    expect(props.stops[0]).toMatchObject({
      id: added!.stopId,
      name: 'Finish',
      anchor: point(10),
      legId: 'path-1',
      controlAnchorId: 'a1',
    })

    const repeated = addGuideRouteStopAtPathAnchor(props, {
      legId: 'path-1',
      anchorId: 'a1',
    })
    expect(repeated).toMatchObject({
      stopId: added!.stopId,
      created: false,
    })
    expect(repeated?.props.stops).toHaveLength(1)

    const removed = removeGuideRouteStop(repeated!.props, added!.stopId)
    const removedLeg = removed.props.legs[0]
    if (removedLeg?.kind !== 'path') {
      throw new Error('expected path leg')
    }
    expect(removedLeg.anchors.map((anchor) => anchor.id)).toEqual(['a0', 'a1'])
    expect(removed.props.stops).toHaveLength(0)
  })

  it('represents a branch as an independent route with source metadata', () => {
    const source = addGuideRouteStop(pathProps(), {
      legId: 'path-1',
      anchor: point(5),
      name: 'Branch source',
    })!
    const branch = createGuideRouteBranchProps({
      parentRouteNodeId: 'route-parent',
      sourceStop: source.props.stops[0]!,
      points: [point(5), point(8), point(12)],
      travelMode: 'character',
      surfaceProviderNodeId: null,
    })
    expect(branch.legs[0]?.id).not.toBe(source.props.legs[0]?.id)
    expect(branch.branchOrigin).toEqual({
      routeNodeId: 'route-parent',
      stopId: source.stopId,
    })
    expect(unlinkGuideRouteBranchOrigins(branch).branchOrigin).toBeNull()
  })
})
