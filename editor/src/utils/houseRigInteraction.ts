import type { SceneNode, SceneNodeComponentState } from '@schema/core'
import { HOUSE_RIG_COMPONENT_TYPE } from '@schema/components'
import type { HouseRigComponentProps } from '@schema/houseRig'

export type HouseRigComponentState = SceneNodeComponentState<HouseRigComponentProps>

export function getHouseRigComponentState(
  node: SceneNode | null | undefined,
): HouseRigComponentState | null {
  const state = node?.components?.[HOUSE_RIG_COMPONENT_TYPE] as HouseRigComponentState | undefined
  return state ?? null
}

export function resolveEditableHouseRigComponent(
  node: SceneNode | null | undefined,
  isSelectionLocked = false,
): HouseRigComponentState | null {
  if (!node || isSelectionLocked) {
    return null
  }
  const state = getHouseRigComponentState(node)
  if (!state || state.enabled === false) {
    return null
  }
  return state
}
