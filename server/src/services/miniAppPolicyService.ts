import path from 'node:path'
import fs from 'fs-extra'
import { appConfig } from '@/config/env'
import type { MiniAppDocument, MiniAppPolicyContent, MiniAppPolicyKind } from '@/types/models'

export type MiniAppPolicyFilePayload = {
  format: 'harmony-mini-app-policy'
  kind: MiniAppPolicyKind
  miniAppId: string
  title: string
  content: string
  paragraphs: string[]
  version: number
  generatedAt: string
  updatedAt: string
}

const POLICY_DIRECTORY = 'mini-app-policies'

const DEFAULT_POLICY_CONTENTS: Record<MiniAppPolicyKind, { title: string; content: string }> = {
  'user-service-agreement': {
    title: '用户服务协议',
    content: [
      '欢迎使用本小程序。为保障你的合法权益，请在使用前仔细阅读并理解本协议全部内容。',
      '',
      '一、服务内容',
      '本小程序向你提供景区浏览、订单管理、手机号绑定、反馈提交、收藏与互动等功能，具体功能可能会随版本更新而调整。',
      '',
      '二、账号与使用',
      '你可以通过微信授权或账号密码方式使用本服务。你应保证提交信息真实、准确、完整，并妥善保管登录凭证。',
      '',
      '三、个人信息处理',
      '为实现登录、资料展示、手机号绑定、订单处理、客服与风控等必要功能，我们可能处理你的微信昵称、头像、手机号、订单信息及操作记录。',
      '',
      '四、用户责任',
      '你应合法合规使用本服务，不得利用本小程序从事违法违规、侵害他人权益或破坏系统安全的行为。',
      '',
      '五、协议变更',
      '我们可能根据法律法规、业务调整或平台要求更新本协议。更新后将通过页面提示或重新授权方式告知你。',
      '',
      '六、联系与反馈',
      '如你对本协议有疑问，可通过小程序内反馈入口或平台公布的联系方式与我们取得联系。',
    ].join('\n'),
  },
  'privacy-policy': {
    title: '隐私政策',
    content: [
      '本隐私政策说明我们如何收集、使用、存储和保护你的个人信息。请在使用本小程序前仔细阅读。',
      '',
      '一、我们收集的信息',
      '1. 你主动提供的信息，例如昵称、头像、手机号、反馈内容、订单信息、收货地址等。',
      '2. 为完成登录和微信能力调用可能获取的信息，例如微信授权标识、手机号验证码结果等。',
      '3. 你使用服务过程中产生的信息，例如浏览记录、订单记录、反馈记录、操作日志等。',
      '',
      '二、信息使用目的',
      '我们收集上述信息的目的包括账号登录与识别、资料展示、手机号绑定、订单履约、客服沟通、服务安全、异常排查以及法律法规要求的合规管理。',
      '',
      '三、信息使用方式',
      '仅在实现对应功能所必要的范围内使用你的个人信息，不会超出合理关联目的进行处理。对于敏感信息，我们会在获得授权后再处理。',
      '',
      '四、信息共享与公开',
      '除法律法规要求、实现服务所必需或获得你明确同意外，我们不会向无关第三方共享你的个人信息。涉及微信支付、手机号能力等场景时，仅会在完成对应业务所需的最小范围内使用相关信息。',
      '',
      '五、信息存储与保护',
      '我们会采取合理的安全措施保护你的信息，并仅在达成处理目的所需的期限内保存。达到保存期限后，我们将按照法律法规要求处理。',
      '',
      '六、你的权利',
      '你可以依法查询、更正、删除相关个人信息，或撤回此前授予的授权。撤回后可能导致部分功能无法继续使用。',
      '',
      '七、联系我们',
      '如你对本隐私政策有任何疑问或投诉建议，可通过小程序内反馈入口联系我们。',
    ].join('\n'),
  },
}

function normalizeMiniAppId(miniAppId: string): string {
  return String(miniAppId ?? '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-')
}

function normalizePolicyText(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || fallback
}

function splitParagraphs(content: string): string[] {
  return String(content ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
}

function buildPolicyFileKey(miniAppId: string, kind: MiniAppPolicyKind): string {
  return `${POLICY_DIRECTORY}/${normalizeMiniAppId(miniAppId)}/${kind}.json`
}

function buildPolicyFileUrl(fileKey: string): string {
  const base = appConfig.assetPublicUrl.replace(/\/?$/, '')
  return `${base}/${fileKey.replace(/\\+/g, '/').replace(/^\/+/, '')}`
}

function buildPolicyPayload(
  miniAppId: string,
  kind: MiniAppPolicyKind,
  content: string,
  version: number,
  updatedAt: Date,
): MiniAppPolicyFilePayload {
  const template = DEFAULT_POLICY_CONTENTS[kind]
  const title = template.title
  const normalizedContent = normalizePolicyText(content, template.content)
  return {
    format: 'harmony-mini-app-policy',
    kind,
    miniAppId: miniAppId.trim(),
    title,
    content: normalizedContent,
    paragraphs: splitParagraphs(normalizedContent),
    version,
    generatedAt: new Date().toISOString(),
    updatedAt: updatedAt.toISOString(),
  }
}

async function writePolicyFile(fileKey: string, payload: MiniAppPolicyFilePayload): Promise<string> {
  const absolutePath = path.resolve(appConfig.assetStoragePath, fileKey)
  await fs.ensureDir(path.dirname(absolutePath))
  await fs.writeJson(absolutePath, payload, { spaces: 2 })
  return buildPolicyFileUrl(fileKey)
}

function getPolicyField(app: MiniAppDocument, kind: MiniAppPolicyKind): MiniAppPolicyContent {
  return kind === 'user-service-agreement' ? app.userServiceAgreement : app.privacyPolicy
}

export function getDefaultMiniAppPolicyContent(kind: MiniAppPolicyKind): { title: string; content: string } {
  return DEFAULT_POLICY_CONTENTS[kind]
}

export function normalizeMiniAppPolicyContent(kind: MiniAppPolicyKind, content?: Partial<MiniAppPolicyContent> | null) {
  const template = DEFAULT_POLICY_CONTENTS[kind]
  const normalizedContent = normalizePolicyText(content?.content, template.content)
  return {
    title: normalizePolicyText(content?.title, template.title),
    content: normalizedContent,
    version: Number(content?.version ?? 0) || 0,
    fileKey: typeof content?.fileKey === 'string' ? content.fileKey.trim() : '',
    fileUrl: typeof content?.fileUrl === 'string' ? content.fileUrl.trim() : '',
    generatedAt: content?.generatedAt ?? null,
  }
}

export function mapPolicyContent(kind: MiniAppPolicyKind, content?: Partial<MiniAppPolicyContent> | null): {
  title: string
  content: string
  fileKey: string
  fileUrl: string
  generatedAt: string | null
  version: number
} {
  const normalized = normalizeMiniAppPolicyContent(kind, content)
  return {
    title: normalized.title,
    content: normalized.content,
    fileKey: normalized.fileKey,
    fileUrl: normalized.fileUrl,
    generatedAt:
      normalized.generatedAt instanceof Date
        ? normalized.generatedAt.toISOString()
        : typeof normalized.generatedAt === 'string'
          ? normalized.generatedAt
          : null,
    version: normalized.version,
  }
}

export async function syncMiniAppPolicyFiles(app: MiniAppDocument): Promise<void> {
  const policyEntries: Array<{ kind: MiniAppPolicyKind; field: MiniAppPolicyContent }> = [
    { kind: 'user-service-agreement', field: getPolicyField(app, 'user-service-agreement') },
    { kind: 'privacy-policy', field: getPolicyField(app, 'privacy-policy') },
  ]

  let touched = false
  for (const entry of policyEntries) {
    const normalizedContent = normalizeMiniAppPolicyContent(entry.kind, entry.field)
    const fileKey = buildPolicyFileKey(app.miniAppId, entry.kind)
    const fileUrl = await writePolicyFile(
      fileKey,
      buildPolicyPayload(
        app.miniAppId,
        entry.kind,
        normalizedContent.content,
        normalizedContent.version + 1,
        new Date(),
      ),
    )

    const target = entry.kind === 'user-service-agreement' ? app.userServiceAgreement : app.privacyPolicy
    target.title = normalizedContent.title
    target.content = normalizedContent.content
    target.fileKey = fileKey
    target.fileUrl = fileUrl
    target.generatedAt = new Date()
    target.version = normalizedContent.version + 1
    touched = true
  }

  if (touched) {
    await app.save()
  }
}

export async function ensureMiniAppPolicyFiles(app: MiniAppDocument): Promise<void> {
  const agreement = mapPolicyContent('user-service-agreement', app.userServiceAgreement)
  const privacy = mapPolicyContent('privacy-policy', app.privacyPolicy)
  const resolveAbsolutePath = (fileKey: string) => path.resolve(appConfig.assetStoragePath, fileKey)
  const needsAgreement = !agreement.fileKey || !agreement.fileUrl || !(await fs.pathExists(resolveAbsolutePath(agreement.fileKey)))
  const needsPrivacy = !privacy.fileKey || !privacy.fileUrl || !(await fs.pathExists(resolveAbsolutePath(privacy.fileKey)))
  if (!needsAgreement && !needsPrivacy) {
    return
  }
  await syncMiniAppPolicyFiles(app)
}

export async function resolveMiniAppPolicyFiles(app: MiniAppDocument): Promise<void> {
  await ensureMiniAppPolicyFiles(app)
}
