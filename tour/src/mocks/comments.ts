import type { ScenicComment } from '@/types/comment';
import { readStorageJson, writeStorageJson } from '@/utils/storage';
import { nowISO, shortId } from '@/mocks/_seed';

const KEY = 'tour:comments:v1';

const seed: ScenicComment[] = [
  {
    id: 'c-1',
    scenicId: 'scenic-1',
    nickname: '小河豚',
    timeISO: new Date(Date.now() - 86400 * 1000 * 2).toISOString(),
    content: '模型很流畅，开车体验不错，景色也漂亮。',
  },
  {
    id: 'c-2',
    scenicId: 'scenic-1',
    nickname: '阿北',
    timeISO: new Date(Date.now() - 86400 * 1000 * 6).toISOString(),
    content: '建议增加更多指示牌，方便找路。',
  },
  {
    id: 'c-3',
    scenicId: 'scenic-2',
    nickname: '夏天',
    timeISO: new Date(Date.now() - 86400 * 1000 * 1).toISOString(),
    content: '湖边夜景很出片。',
  },
];

export function listComments(): ScenicComment[] {
  const data = readStorageJson<ScenicComment[]>(KEY, []);
  if (Array.isArray(data) && data.length) {
    return data;
  }
  writeStorageJson(KEY, seed);
  return seed;
}

export function listCommentsByScenic(scenicId: string): ScenicComment[] {
  return listComments().filter((c) => c.scenicId === scenicId);
}

export function addComment(input: Omit<ScenicComment, 'id' | 'timeISO'>): ScenicComment {
  const all = listComments();
  const entry: ScenicComment = {
    id: shortId('c'),
    timeISO: nowISO(),
    ...input,
  };
  const next = [entry, ...all];
  writeStorageJson(KEY, next);
  return entry;
}
