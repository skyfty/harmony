export interface ScenicSummary {
  id: string;
  sceneId: string;
  title: string;
  coverImage: string;
  description: string;
  address: string;
  slides: string[];
  isHome: boolean;
  distance?: string | null;
  phone?: string | null;
  location?: { lat: number; lng: number } | null;
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
