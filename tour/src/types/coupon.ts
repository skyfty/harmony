export type CouponStatus = 'unused' | 'used' | 'expired';

export type CouponTypeCode = 'ticket' | 'souvenir' | 'photo' | 'discount' | string;

export interface CouponType {
  id: string;
  name: string;
  code: CouponTypeCode;
  iconUrl?: string;
}

export interface Coupon {
  id: string;
  title: string;
  description: string;
  validUntil: string;
  type?: CouponType | null;
  status: CouponStatus;
  claimedAt?: string | null;
  usedAt?: string | null;
  expiresAt?: string | null;
}
