import type { DeviceAdaptationProfile } from '@harmony/schema/deviceAdaptation'

export type ViewerRenderMemoryState = 'normal' | 'moderate' | 'critical'

export interface ViewerRenderBudgetInput {
  basePixelRatio: number
  baseShadowsEnabled: boolean
  isWeChatMiniProgram: boolean
  landscapePixelRatioCap: number | null
  profile: Pick<DeviceAdaptationProfile, 'quality' | 'pixelRatioCap' | 'shadowsEnabled'> | null
  memoryState: ViewerRenderMemoryState
}

export interface ViewerRenderBudget {
  pixelRatio: number
  shadowsEnabled: boolean
}

function positiveFinite(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

export function resolveViewerRenderBudget(input: ViewerRenderBudgetInput): ViewerRenderBudget {
  const basePixelRatio = Math.max(0.5, positiveFinite(input.basePixelRatio, 1))
  let pixelRatio = basePixelRatio
  let shadowsEnabled = input.baseShadowsEnabled

  if (input.profile) {
    const profilePixelRatio = Math.min(basePixelRatio, positiveFinite(input.profile.pixelRatioCap, basePixelRatio))
    if (input.profile.quality === 'low') {
      pixelRatio = Math.min(profilePixelRatio, 1)
      shadowsEnabled = false
    } else if (input.profile.quality === 'balanced') {
      pixelRatio = Math.min(profilePixelRatio, 1.5)
    } else {
      pixelRatio = profilePixelRatio
    }
    if (!input.profile.shadowsEnabled) {
      shadowsEnabled = false
    }
  } else if (input.isWeChatMiniProgram) {
    // Mini-program canvas presentation is more expensive than a browser canvas.
    // Start at native CSS-pixel resolution unless an explicit profile opts higher.
    pixelRatio = Math.min(pixelRatio, 1)
  }

  if (input.landscapePixelRatioCap !== null) {
    pixelRatio = Math.min(
      pixelRatio,
      positiveFinite(input.landscapePixelRatioCap, pixelRatio),
    )
  }

  if (input.memoryState !== 'normal') {
    pixelRatio = Math.min(pixelRatio, 1)
    shadowsEnabled = false
  }

  return {
    pixelRatio: Math.round(Math.max(0.5, pixelRatio) * 100) / 100,
    shadowsEnabled,
  }
}
