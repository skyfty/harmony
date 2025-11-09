import type { DisplayBoardResolvedMedia } from '@schema/components'

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Global {
    __harmonyResolveDisplayBoardMedia?: (source: string) => Promise<DisplayBoardResolvedMedia | null>
  }

  // For environments where `globalThis` is available.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface GlobalThis {
    __harmonyResolveDisplayBoardMedia?: (source: string) => Promise<DisplayBoardResolvedMedia | null>
  }
}

export {}
