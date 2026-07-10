export type BusinessContractStatus = 'unsigned' | 'signed'
export type BusinessTopStage = 'quote' | 'signing' | 'production' | 'publish' | 'operation'
export type BusinessOrderKind = 'new' | 'renewal'
export type BusinessServiceStatus = 'pending' | 'active' | 'expiring' | 'expired'

export interface BusinessLandscapeOption {
  code: string
  label: string
}

export interface BusinessCategoryOption {
  id: string
  name: string
}

export interface BusinessProductionNode {
  code: string
  label: string
  status: 'pending' | 'active' | 'completed'
  activatedAt: string | null
  remark: string | null
  sortOrder: number
}

export interface BusinessRenewalHistoryItem {
  approvedAt: string | null
  createdAt: string
  durationDays: number
  id: string
  orderKind: BusinessOrderKind
  orderNumber: string
  price: number
  paymentStatus: 'unpaid' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'closed'
  serviceEndAt: string | null
  serviceStartAt: string | null
  serviceStatus: BusinessServiceStatus
}

export interface BusinessOrder {
  id: string
  orderNumber: string
  userId: string
  rootOrderId: string
  parentOrderId: string | null
  orderKind: BusinessOrderKind
  scenicName: string
  addressText: string
  location: { lat: number; lng: number } | null
  contactPhone: string
  scenicArea: number | null
  sceneSpotCategoryId: string | null
  sceneSpotCategoryName: string | null
  specialLandscapeTags: string[]
  topStage: BusinessTopStage
  productionProgress: BusinessProductionNode[]
  delivery: {
    boundAt: string | null
    sceneId: string | null
    sceneSpotId: string | null
    sceneSpotTitle: string | null
  }
  service: {
    daysRemaining: number | null
    durationDays: number
    endAt: string | null
    price: number
    startAt: string | null
    status: BusinessServiceStatus
    warningDays: number
  }
  contactPhoneForBusiness: string | null
  notes: string | null
  quotedAt: string | null
  signedAt: string | null
  productionStartedAt: string | null
  productionCompletedAt: string | null
  publishReadyAt: string | null
  publishedAt: string | null
  operatingAt: string | null
  renewalCount: number
  lastRenewedAt: string | null
  share: {
    miniProgramPath: string | null
    urlScheme: string | null
    wechatRuleLink: string | null
  }
  analyticsAvailable: boolean
  renewalHistory: BusinessRenewalHistoryItem[]
  createdAt: string
  updatedAt: string
}

export interface BusinessOrderAnalytics {
  checkpointStats: Array<{
    nodeId: string
    nodeName: string
    punchCount: number
    userCount: number
  }>
  overview: {
    todayNewUsers: number
    todayUv: number
    totalPunchCount: number
    totalUv: number
  }
  query: {
    end: string
    sceneId: string
    sceneSpotId: string | null
    start: string
  }
  visitTrend: Array<{
    date: string
    newUsers: number
    pv: number
    uv: number
  }>
}

export interface BusinessOrderRenewalPreview {
  amount: number
  currentServiceEndAt: string | null
  durationDays: number
  nextServiceEndAt: string
  nextServiceStartAt: string
}

export interface BusinessRenewalPaymentResult {
  orderNumber: string
  paymentStatus: 'unpaid' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'closed'
  renewal: BusinessRenewalHistoryItem
  payParams: {
    appId: string
    timeStamp: string
    nonceStr: string
    package: string
    signType: 'RSA'
    paySign: string
    prepayId?: string
  } | null
}

export interface BusinessBootstrapData {
  contractStatus: BusinessContractStatus
  latestOrder: BusinessOrder | null
  scenicTypes: BusinessCategoryOption[]
  specialLandscapeOptions: BusinessLandscapeOption[]
  businessContactPhone: string
}

export interface CreateBusinessOrderPayload {
  scenicName: string
  addressText: string
  location?: { lat: number; lng: number } | null
  contactPhone: string
  scenicArea?: number | null
  sceneSpotCategoryId?: string | null
  specialLandscapeTags?: string[]
}
