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
  appKey: string
  kind: MiniPolicyKind
  policy: MiniPolicyDocument
}

export interface MiniPoliciesResponse {
  appKey: string
  policies: {
    userServiceAgreement: MiniPolicyDocument
    privacyPolicy: MiniPolicyDocument
  }
}

export interface MiniPolicyFile {
  format: 'harmony-mini-app-policy'
  kind: MiniPolicyKind
  appKey: string
  title: string
  content: string
  paragraphs: string[]
  version: number
  generatedAt: string
  updatedAt: string
}

export async function getMiniAppPolicy(kind: MiniPolicyKind, appKey?: string): Promise<MiniPolicyResponse> {
  return await miniRequest<MiniPolicyResponse>('/mini-apps/policies', {
    method: 'GET',
    auth: false,
    query: {
      kind,
      ...(appKey ? { appKey } : {}),
    },
  })
}

export async function getMiniAppPolicies(appKey?: string): Promise<MiniPoliciesResponse> {
  return await miniRequest<MiniPoliciesResponse>('/mini-apps/policies', {
    method: 'GET',
    auth: false,
    query: {
      kind: 'all',
      ...(appKey ? { appKey } : {}),
    },
  })
}
