export type CouponStatus = 'unused' | 'used' | 'expired';

export interface Coupon {
  id: string;
  title: string;
  description: string;
  validUntil: string;
  status: CouponStatus;
}
