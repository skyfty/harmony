import { describe, expect, it } from 'vitest'
import { PROCEDURAL_LANDSCAPE_COMPONENT_TYPE } from '@schema/components'
import type { SceneNode } from '@schema/core'
import {
  canEditLandscapeRoadWaypoints,
  shouldPreserveLandscapeRoadSelectionOnLock,
} from '@/components/editor/landscapeRoadEditPolicy'

function makeNode(options: {
  locked?: boolean
  withLandscape?: boolean
} = {}): SceneNode {
  return {
    id: 'terrain-1',
    name: 'Terrain',
    nodeType: 'Group',
    locked: options.locked ?? false,
    components: options.withLandscape === false
      ? {}
      : {
          [PROCEDURAL_LANDSCAPE_COMPONENT_TYPE]: {
            id: 'landscape-component',
            type: PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
            enabled: true,
            props: {},
          },
        },
  } as unknown as SceneNode
}

describe('landscape road edit policy', () => {
  it('allows a locked procedural landscape node to edit road waypoints', () => {
    const node = makeNode({ locked: true })
    expect(canEditLandscapeRoadWaypoints(node, { hasRuntimeObject: true })).toBe(true)
  })

  it('still requires the component and runtime object', () => {
    expect(canEditLandscapeRoadWaypoints(
      makeNode({ locked: true }),
      { hasRuntimeObject: false },
    )).toBe(false)
    expect(canEditLandscapeRoadWaypoints(
      makeNode({ locked: true, withLandscape: false }),
      { hasRuntimeObject: true },
    )).toBe(false)
    expect(canEditLandscapeRoadWaypoints(
      null,
      { hasRuntimeObject: true },
    )).toBe(false)
  })

  it('preserves selection only while locking the active landscape road target', () => {
    const node = makeNode({ locked: false })
    const base = {
      willLock: true,
      activeBuildTool: 'landscapeRoad',
      selectedNodeIds: ['terrain-1'],
      nodeId: 'terrain-1',
      node,
    }
    expect(shouldPreserveLandscapeRoadSelectionOnLock(base)).toBe(true)
    expect(shouldPreserveLandscapeRoadSelectionOnLock({
      ...base,
      willLock: false,
    })).toBe(false)
    expect(shouldPreserveLandscapeRoadSelectionOnLock({
      ...base,
      activeBuildTool: 'wall',
    })).toBe(false)
    expect(shouldPreserveLandscapeRoadSelectionOnLock({
      ...base,
      selectedNodeIds: ['terrain-1', 'other'],
    })).toBe(false)
    expect(shouldPreserveLandscapeRoadSelectionOnLock({
      ...base,
      node: makeNode({ withLandscape: false }),
    })).toBe(false)
  })
})
