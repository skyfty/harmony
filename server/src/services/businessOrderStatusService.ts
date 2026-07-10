import type { BusinessOrderServiceStatus, BusinessOrderTopStage } from '@/types/models'

export interface BusinessServiceSnapshotInput {
  serviceEndAt?: Date | null
  serviceStartAt?: Date | null
  topStage?: BusinessOrderTopStage | null
  renewalWarningDays?: number | null
}

export interface BusinessServiceSnapshot {
  daysRemaining: number | null
  status: BusinessOrderServiceStatus
}

const DAY_MS = 24 * 60 * 60 * 1000

export function getBusinessServiceSnapshot(input: BusinessServiceSnapshotInput, now = new Date()): BusinessServiceSnapshot {
  if (input.topStage !== 'operation' || !input.serviceStartAt || !input.serviceEndAt) {
    return {
      daysRemaining: null,
      status: 'pending',
    }
  }

  const diffMs = input.serviceEndAt.getTime() - now.getTime()
  const daysRemaining = Math.ceil(diffMs / DAY_MS)
  if (daysRemaining <= 0) {
    return {
      daysRemaining,
      status: 'expired',
    }
  }

  const warningDays = Math.max(Number(input.renewalWarningDays) || 15, 1)
  if (daysRemaining <= warningDays) {
    return {
      daysRemaining,
      status: 'expiring',
    }
  }

  return {
    daysRemaining,
    status: 'active',
  }
}

