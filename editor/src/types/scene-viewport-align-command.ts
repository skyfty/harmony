export type WorldAlignMode = 'left' | 'right' | 'top' | 'bottom' | 'center-x' | 'center-y'

export type ArrangeDirection = 'horizontal' | 'vertical'

export type AlignCommandOptions = {
  fixedPrimaryAsAnchor?: boolean
}

export type AlignCommand =
  | {
      type: 'world-align'
      mode: WorldAlignMode
    }
  | {
      type: 'arrange'
      direction: ArrangeDirection
      options?: AlignCommandOptions
    }
  | {
      type: 'distribute'
      direction: ArrangeDirection
      options?: AlignCommandOptions
    }
