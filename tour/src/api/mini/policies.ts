import { miniRequest } from '@harmony/utils'

export type MiniPolicyKind = 'user-service-agreement' | 'privacy-policy'

export interface MiniPolicyDocument {
  title: string
  content: string
  fileKey: string
  fileUrl: string
  generatedAt: string | null
  version: number
}

export interface MiniPolicyResponse {
  miniAppId: string
  kind: MiniPolicyKind
  policy: MiniPolicyDocument
}

export interface MiniPoliciesResponse {
  miniAppId: string
  policies: {
    userServiceAgreement: MiniPolicyDocument
    privacyPolicy: MiniPolicyDocument
  }
}

export interface MiniPolicyFile {
  format: 'harmony-mini-app-policy'
  kind: MiniPolicyKind
  miniAppId: string
  title: string
  content: string
  paragraphs: string[]
  version: number
  generatedAt: string
  updatedAt: string
}

export async function getMiniAppPolicy(kind: MiniPolicyKind, miniAppId?: string): Promise<MiniPolicyResponse> {
  return await miniRequest<MiniPolicyResponse>('/mini-apps/policies', {
    method: 'GET',
    auth: false,
    query: {
      kind,
      ...(miniAppId ? { miniAppId } : {}),
    },
  })
}

export async function getMiniAppPolicies(miniAppId?: string): Promise<MiniPoliciesResponse> {
  return await miniRequest<MiniPoliciesResponse>('/mini-apps/policies', {
    method: 'GET',
    auth: false,
    query: {
      kind: 'all',
      ...(miniAppId ? { miniAppId } : {}),
    },
  })
}
