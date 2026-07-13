import { listMiniAppPlatformConfigs, resolveMiniApp, resolveMiniAppPlatformConfig } from '@/services/miniPlatformConfigService'
import type { MiniPlatformKind } from '@/types/models'

export async function resolveMiniAppConfig(appKey?: string, platform?: MiniPlatformKind) {
  const app = await resolveMiniApp(appKey)
  const platformConfigs = await listMiniAppPlatformConfigs(app.appKey)

  if (!platform) {
    return {
      ...app,
      platformConfigs,
    }
  }

  const platformConfig = await resolveMiniAppPlatformConfig(platform, app.appKey)
  return {
    ...app,
    platformConfig,
    platformConfigs,
  }
}

export async function listEnabledMiniApps() {
  const app = await resolveMiniApp().catch(() => null)
  if (!app) {
    return []
  }
  return [app]
}
