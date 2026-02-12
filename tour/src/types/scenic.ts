export interface ScenicSummary {
  id: string;
  name: string;
  summary: string;
  coverUrl: string;
  rating?: number;
  likes?: number;
}

export interface ScenicDetail extends ScenicSummary {
  imageUrls: string[];
  address: string;
  phone: string;
  packageUrl: string;
  checkinProgress?: number;
  description?: string;
}
