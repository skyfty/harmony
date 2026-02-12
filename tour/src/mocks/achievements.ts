import type { Achievement } from '@/types/achievement';
import { readStorageJson, writeStorageJson } from '@/utils/storage';

const KEY = 'tour:achievements:v1';

const seed: Achievement[] = [
  {
    id: 'ach-1',
    title: '山谷初见',
    description: '完成云海山谷 30% 打卡进度',
    progress: 0.35,
    scenicId: 'scenic-1',
  },
  {
    id: 'ach-2',
    title: '湖畔达人',
    description: '完成湖畔栈道 70% 打卡进度',
    progress: 0.78,
    scenicId: 'scenic-2',
  },
];

export function listAchievements(): Achievement[] {
  const data = readStorageJson<Achievement[]>(KEY, []);
  if (Array.isArray(data) && data.length) {
    return data;
  }
  writeStorageJson(KEY, seed);
  return seed;
}
