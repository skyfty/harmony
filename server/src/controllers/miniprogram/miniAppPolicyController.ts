import type { Context } from 'koa'
import { MiniAppModel } from '@/models/MiniApp'
import { resolveMiniAppConfig } from '@/services/miniAppService'
import { resolveMiniAppPolicyFiles, mapPolicyContent } from '@/services/miniAppPolicyService'

function normalizeMiniAppId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeKind(value: unknown): 'user-service-agreement' | 'privacy-policy' | 'all' {
  const kind = normalizeMiniAppId(value)
  if (kind === 'user-service-agreement' || kind === 'privacy-policy' || kind === 'all') {
    return kind
  }
  return 'all'
}

export async function getMiniAppPolicies(ctx: Context): Promise<void> {
  const query = ctx.query as Record<string, unknown>
  const requestedMiniAppId = normalizeMiniAppId(query.miniAppId)
  const kind = normalizeKind(query.kind)
  const resolvedMiniApp = await resolveMiniAppConfig(requestedMiniAppId || undefined)
  const row = await MiniAppModel.findOne({ miniAppId: resolvedMiniApp.miniAppId, enabled: true }).exec()
  if (!row) {
    ctx.throw(404, 'MiniApp not found')
  }

  await resolveMiniAppPolicyFiles(row)

  const userServiceAgreement = mapPolicyContent('user-service-agreement', row.userServiceAgreement)
  const privacyPolicy = mapPolicyContent('privacy-policy', row.privacyPolicy)

  ctx.body =
    kind === 'user-service-agreement'
      ? {
          miniAppId: row.miniAppId,
          kind,
          policy: userServiceAgreement,
        }
      : kind === 'privacy-policy'
        ? {
            miniAppId: row.miniAppId,
            kind,
            policy: privacyPolicy,
          }
        : {
            miniAppId: row.miniAppId,
            policies: {
              userServiceAgreement,
              privacyPolicy,
            },
          }
}

