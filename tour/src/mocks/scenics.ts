import type { ScenicDetail } from '@/types/scenic';
import { readStorageJson, writeStorageJson } from '@/utils/storage';

const KEY = 'tour:scenics:v1';

const seed: ScenicDetail[] = [
  {
    id: 'scenic-1',
    sceneId: 'scene-1',
    title: '云海山谷',
    coverImage: '/assets/photo-1441974231531-c6227db76b6e.avif',
    slides: [
      'https://dummyimage.com/750x420/7ec6ff/ffffff&text=%E6%99%AF%E5%8C%BA%E5%9B%BE1',
      'https://dummyimage.com/750x420/3f97ff/ffffff&text=%E6%99%AF%E5%8C%BA%E5%9B%BE2',
    ],
    address: 'XX省XX市XX区山谷大道 88 号',
    description: '这里是景区的详细介绍文案（mock）。支持多段文本展示。',
    isFeatured: true,
    averageRating: 4.7,
    ratingCount: 128,
    favoriteCount: 236,
    favorited: false,
    userRating: null,
    scene: {
      id: 'scene-1',
      name: '云海山谷场景',
      fileUrl: 'https://example.com/scenepackage/scenic-1.zip',
      fileKey: 'scenes/scenic-1.zip',
      fileSize: 102400,
    },
  },
  {
    id: 'scenic-2',
    sceneId: 'scene-2',
    title: '湖畔栈道',
    coverImage: '/assets/photo-1506744038136-46273834b3fb.avif',
    slides: [
      'https://dummyimage.com/750x420/ffd48a/ffffff&text=%E6%99%AF%E5%8C%BA%E5%9B%BE1',
      'https://dummyimage.com/750x420/ffb340/ffffff&text=%E6%99%AF%E5%8C%BA%E5%9B%BE2',
    ],
    address: 'XX省XX市XX区湖滨路 66 号',
    description: '这里是景区的详细介绍文案（mock）。',
    isFeatured: false,
    averageRating: 4.5,
    ratingCount: 89,
    favoriteCount: 172,
    favorited: false,
    userRating: null,
    scene: {
      id: 'scene-2',
      name: '湖畔栈道场景',
      fileUrl: 'https://example.com/scenepackage/scenic-2.zip',
      fileKey: 'scenes/scenic-2.zip',
      fileSize: 204800,
    },
  },
];

export function listScenics(): ScenicDetail[] {
  const data = readStorageJson<ScenicDetail[]>(KEY, []);
  if (Array.isArray(data) && data.length) {
    return data;
  }
  writeStorageJson(KEY, seed);
  return seed;
}

export function getScenicById(id: string): ScenicDetail | undefined {
  return listScenics().find((s) => s.id === id);
}
