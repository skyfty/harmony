import { listMiniAppPlatformConfigs, resolveMiniApp } from '@/services/miniPlatformConfigService'
import type { MiniPlatformKind } from '@/types/models'

export type MiniRuntimeConfigResponse = {
  appKey: string
  appType: 'tour' | 'viewer'
  platform: MiniPlatformKind
  capabilities: {
    auth: boolean
    payment: boolean
    privacy: boolean
    share: boolean
    update: boolean
    phone: boolean
  }
  publicRuntimeConfig: {
    branding: {
      appName: string
      logoUrl: string
      themeColor: string
    }
    base: {
      appId: string
      landingPage: string
    }
    payment: {
      enabled: boolean
      provider: string
    }
    features: Record<string, boolean>
    values: Record<string, string | number | boolean | null>
    share: {
      defaultPath: string
      defaultTitle: string
      posterEnabled: boolean
      qrCodeRuleLink: string
    }
    privacy: {
      requireConsentBeforeUse: boolean
    }
    update: {
      promptMode: 'none' | 'soft' | 'force'
    }
    extConfig: Record<string, unknown>
  }
}

export async function buildMiniRuntimeConfig(appKey: string | undefined, platform: MiniPlatformKind): Promise<MiniRuntimeConfigResponse> {
  const app = await resolveMiniApp(appKey)
  const platformConfigs = await listMiniAppPlatformConfigs(app.appKey)
  const currentPlatformConfig = platformConfigs.find((item) => item.platform === platform)
  if (!currentPlatformConfig) {
    throw new Error('MiniApp platform config not found')
  }

  return {
    appKey: app.appKey,
    appType: app.appType,
    platform,
    capabilities: {
      auth: currentPlatformConfig.loginConfig.enabled,
      payment: currentPlatformConfig.paymentConfig.enabled,
      privacy: currentPlatformConfig.privacyConfig.enabled,
      share: currentPlatformConfig.shareConfig.enabled,
      update: currentPlatformConfig.updateConfig.enabled,
      phone: currentPlatformConfig.loginConfig.enabled,
    },
    publicRuntimeConfig: {
      branding: app.branding,
      base: {
        appId: currentPlatformConfig.appId,
        landingPage: currentPlatformConfig.navigateConfig.landingPage,
      },
      payment: {
        enabled: currentPlatformConfig.paymentConfig.enabled,
        provider: String(currentPlatformConfig.paymentConfig.channel || platform),
      },
      features: app.runtimeConfig.features,
      values: app.runtimeConfig.values,
      share: {
        defaultPath: currentPlatformConfig.shareConfig.defaultPath,
        defaultTitle: currentPlatformConfig.shareConfig.defaultTitle,
        posterEnabled: currentPlatformConfig.shareConfig.posterEnabled,
        qrCodeRuleLink: currentPlatformConfig.shareConfig.qrCodeRuleLink,
      },
      privacy: {
        requireConsentBeforeUse: currentPlatformConfig.privacyConfig.requireConsentBeforeUse,
      },
      update: {
        promptMode: currentPlatformConfig.updateConfig.promptMode,
      },
      extConfig: {
        ...(currentPlatformConfig.extConfig ?? {}),
      },
    },
  }
}
