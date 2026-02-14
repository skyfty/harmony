export interface ScenicSummary {
  id: string;
  sceneId: string;
  title: string;
  coverImage: string;
  description: string;
  address: string;
  slides: string[];
  isFeatured: boolean;
  averageRating: number;
  ratingCount: number;
  favoriteCount: number;
  favorited: boolean;
  userRating: number | null;
  scene: {
    id: string;
    name: string;
    fileUrl: string;
    fileKey: string;
    fileSize: number;
  };
}

export interface ScenicDetail extends ScenicSummary {}
