import { getMiniAppPolicies, type MiniPolicyDocument } from '@/api/mini/policies'

type MiniPrivacyConsentRecord = {
  acceptedAt: string
  policyVersions: {
    userServiceAgreement: number
    privacyPolicy: number
  }
}

type MiniPrivacyConsentSummary = {
  accepted: boolean
  record: MiniPrivacyConsentRecord | null
  policies: {
    userServiceAgreement: MiniPolicyDocument
    privacyPolicy: MiniPolicyDocument
  } | null
}

const MINI_PRIVACY_CONSENT_STORAGE_PREFIX = 'tour:mini-privacy-consent:v1'

function getMiniAppId(): string {
  return String(import.meta.env.VITE_MINI_APP_ID ?? '').trim()
}

function getStorageKey(): string {
  const miniAppId = getMiniAppId() || 'default'
  return `${MINI_PRIVACY_CONSENT_STORAGE_PREFIX}:${miniAppId}`
}

function safeJsonParse<T>(raw: unknown): T | null {
  if (typeof raw !== 'string' || !raw.trim()) {
    return null
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function readMiniPrivacyConsentRecord(): MiniPrivacyConsentRecord | null {
  try {
    const raw = uni.getStorageSync(getStorageKey())
    if (!raw) {
      return null
    }
    const parsed = typeof raw === 'string' ? safeJsonParse<MiniPrivacyConsentRecord>(raw) : (raw as MiniPrivacyConsentRecord)
    if (!parsed) {
      return null
    }
    const agreementVersion = Number(parsed.policyVersions?.userServiceAgreement ?? 0)
    const privacyVersion = Number(parsed.policyVersions?.privacyPolicy ?? 0)
    if (!agreementVersion || !privacyVersion) {
      return null
    }
    return {
      acceptedAt: String(parsed.acceptedAt || ''),
      policyVersions: {
        userServiceAgreement: agreementVersion,
        privacyPolicy: privacyVersion,
      },
    }
  } catch {
    return null
  }
}

export async function loadMiniPrivacyConsentSummary(): Promise<MiniPrivacyConsentSummary> {
  const record = readMiniPrivacyConsentRecord()
  const response = await getMiniAppPolicies(getMiniAppId() || undefined)
  const policies = response.policies
  const accepted =
    Boolean(record) &&
    record?.policyVersions.userServiceAgreement === Number(policies.userServiceAgreement.version || 0) &&
    record?.policyVersions.privacyPolicy === Number(policies.privacyPolicy.version || 0)

  return {
    accepted,
    record,
    policies,
  }
}

export function acceptMiniPrivacyConsent(policies: {
  userServiceAgreement: MiniPolicyDocument
  privacyPolicy: MiniPolicyDocument
}): void {
  const record: MiniPrivacyConsentRecord = {
    acceptedAt: new Date().toISOString(),
    policyVersions: {
      userServiceAgreement: Number(policies.userServiceAgreement.version || 0),
      privacyPolicy: Number(policies.privacyPolicy.version || 0),
    },
  }
  try {
    uni.setStorageSync(getStorageKey(), JSON.stringify(record))
  } catch {
    // ignore storage failures
  }
}

export function clearMiniPrivacyConsent(): void {
  try {
    uni.removeStorageSync(getStorageKey())
  } catch {
    // ignore storage failures
  }
}

export function hasMiniPrivacyConsent(): boolean {
  return Boolean(readMiniPrivacyConsentRecord())
}

