export type AutoTourManualTakeoverKind = 'vehicle' | 'character'

export type AutoTourManualTakeoverInput = {
  activeVehicleTour: boolean
  activeCharacterTour: boolean
  canvasTarget: boolean
  primaryPointer: boolean
  primaryButton: boolean
  padActive: boolean
  takeoverBlocked: boolean
}

export function resolveAutoTourManualTakeoverKind(
  input: AutoTourManualTakeoverInput,
): AutoTourManualTakeoverKind | null {
  if (
    input.takeoverBlocked
    || !input.canvasTarget
    || !input.primaryPointer
    || !input.primaryButton
    || input.padActive
  ) {
    return null
  }
  if (input.activeVehicleTour) {
    return 'vehicle'
  }
  return input.activeCharacterTour ? 'character' : null
}
