import { describe, expect, it } from 'vitest'
import type { SceneNode } from '@schema/core'
import { HOUSE_RIG_COMPONENT_TYPE } from '@schema/components'
import {
  getHouseRigComponentState,
  resolveEditableHouseRigComponent,
} from '@/utils/houseRigInteraction'

function createNode(enabled: boolean): SceneNode {
  return {
    id: 'house-rig-test',
    name: 'House Rig test',
    components: {
      [HOUSE_RIG_COMPONENT_TYPE]: {
        id: 'component-house-rig-test',
        type: HOUSE_RIG_COMPONENT_TYPE,
        enabled,
        props: {},
      },
    },
  } as unknown as SceneNode
}

describe('House Rig interaction eligibility', () => {
  it('only resolves enabled House Rig components', () => {
    const enabledNode = createNode(true)
    expect(getHouseRigComponentState(enabledNode)?.enabled).toBe(true)
    expect(resolveEditableHouseRigComponent(enabledNode)).not.toBeNull()
    expect(resolveEditableHouseRigComponent(createNode(false))).toBeNull()
  })

  it('does not activate adjustment for locked or ordinary nodes', () => {
    expect(resolveEditableHouseRigComponent(createNode(true), true)).toBeNull()
    expect(resolveEditableHouseRigComponent(null)).toBeNull()
    expect(resolveEditableHouseRigComponent({
      id: 'ordinary-model',
      name: 'Ordinary model',
    } as SceneNode)).toBeNull()
  })
})
