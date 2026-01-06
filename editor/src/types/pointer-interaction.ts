export type PointerInteractionSessionBase = {
  pointerId: number
  startX: number
  startY: number
  moved: boolean
}

export type PointerInteractionSession =
  | (PointerInteractionSessionBase & {
      kind: 'repairClick'
    })
  | (PointerInteractionSessionBase & {
      kind: 'buildToolRightClick'
      /** True if this right-click started while a road build session existed. */
      roadCancelEligible: boolean
    })
