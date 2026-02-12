export interface Address {
  id: string;
  receiverName: string;
  phone: string;
  region: string; // 省/市/区
  detail: string;
  isDefault: boolean;
  updatedAt: string;
}
