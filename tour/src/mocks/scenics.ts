import type { ScenicDetail } from '@/types/scenic';
import { readStorageJson, writeStorageJson } from '@/utils/storage';

const KEY = 'tour:scenics:v1';

const seed: ScenicDetail[] = [
  {
    id: 'scenic-1',
    name: '云海山谷',
    summary: '观云海、穿峡谷，沉浸式山地景观。',
    coverUrl: '/assets/photo-1441974231531-c6227db76b6e.avif',
    imageUrls: [
      'https://dummyimage.com/750x420/7ec6ff/ffffff&text=%E6%99%AF%E5%8C%BA%E5%9B%BE1',
      'https://dummyimage.com/750x420/3f97ff/ffffff&text=%E6%99%AF%E5%8C%BA%E5%9B%BE2',
    ],
    address: 'XX省XX市XX区山谷大道 88 号',
    phone: '10086',
    rating: 4.6,
    likes: 1820,
    checkinProgress: 0.35,
    description: '这里是景区的详细介绍文案（mock）。支持多段文本展示。',
    packageUrl: 'https://example.com/scenepackage/scenic-1.zip',
  },
  {
    id: 'scenic-2',
    name: '湖畔栈道',
    summary: '环湖漫步与夜景灯光带。',
    coverUrl: '/assets/photo-1506744038136-46273834b3fb.avif',
    imageUrls: [
      'https://dummyimage.com/750x420/ffd48a/ffffff&text=%E6%99%AF%E5%8C%BA%E5%9B%BE1',
      'https://dummyimage.com/750x420/ffb340/ffffff&text=%E6%99%AF%E5%8C%BA%E5%9B%BE2',
    ],
    address: 'XX省XX市XX区湖滨路 66 号',
    phone: '10010',
    rating: 4.2,
    likes: 905,
    checkinProgress: 0.78,
    description: '这里是景区的详细介绍文案（mock）。',
    packageUrl: 'https://example.com/scenepackage/scenic-2.zip',
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
