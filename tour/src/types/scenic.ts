export interface ScenicSummary {
  id: string;
  sceneId: string;
  title: string;
  coverImage: string;
  description: string;
  address: string;
  slides: string[];
  isFeatured: boolean;
  scene: {
    id: string;
    name: string;
    fileUrl: string;
    fileKey: string;
    fileSize: number;
  };
}

export interface ScenicDetail extends ScenicSummary {}
