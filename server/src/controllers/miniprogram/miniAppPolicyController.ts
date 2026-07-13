import type { Context } from 'koa'
import { MiniAppModel } from '@/models/MiniApp'
import { resolveMiniApp } from '@/services/miniPlatformConfigService'
import { resolveMiniAppPolicyFiles, mapPolicyContent } from '@/services/miniAppPolicyService'

function normalizeAppKey(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeKind(value: unknown): 'user-service-agreement' | 'privacy-policy' | 'all' {
  const kind = normalizeAppKey(value)
  if (kind === 'user-service-agreement' || kind === 'privacy-policy' || kind === 'all') {
    return kind
  }
  return 'all'
}

export async function getMiniAppPolicies(ctx: Context): Promise<void> {
  const query = ctx.query as Record<string, unknown>
  const requestedAppKey = normalizeAppKey(query.appKey)
  const kind = normalizeKind(query.kind)
  const resolvedMiniApp = await resolveMiniApp(requestedAppKey || undefined)
  const row = await MiniAppModel.findOne({ appKey: resolvedMiniApp.appKey, enabled: true }).exec()
  if (!row) {
    ctx.throw(404, 'MiniApp not found')
  }

  await resolveMiniAppPolicyFiles(row)

  const userServiceAgreement = mapPolicyContent('user-service-agreement', row.userServiceAgreement)
  const privacyPolicy = mapPolicyContent('privacy-policy', row.privacyPolicy)

  ctx.body =
    kind === 'user-service-agreement'
      ? {
          appKey: row.appKey,
          kind,
          policy: userServiceAgreement,
        }
      : kind === 'privacy-policy'
        ? {
            appKey: row.appKey,
            kind,
            policy: privacyPolicy,
          }
        : {
            appKey: row.appKey,
            policies: {
              userServiceAgreement,
              privacyPolicy,
            },
          }
}

