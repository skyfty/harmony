export type BusinessContractStatus = 'unsigned' | 'signed'

export type BusinessTopStage = 'quote' | 'signing' | 'production' | 'publish' | 'operation'

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

export interface BusinessOrder {
  id: string
  orderNumber: string
  userId: string
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
  contactPhoneForBusiness: string | null
  notes: string | null
  quotedAt: string | null
  signedAt: string | null
  productionStartedAt: string | null
  productionCompletedAt: string | null
  publishReadyAt: string | null
  publishedAt: string | null
  operatingAt: string | null
  createdAt: string
  updatedAt: string
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