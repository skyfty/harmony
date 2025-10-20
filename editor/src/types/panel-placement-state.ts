export type PanelPlacement = 'docked' | 'floating'

export interface PanelPlacementState {
  hierarchy: PanelPlacement
  inspector: PanelPlacement
  project: PanelPlacement
}
