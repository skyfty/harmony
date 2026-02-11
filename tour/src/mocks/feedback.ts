import type { FeedbackTicket, FeedbackCategory, FeedbackStatus } from '@/types/feedback';
import { readStorageJson, writeStorageJson } from '@/utils/storage';
import { nowISO, shortId } from '@/mocks/_seed';

const KEY = 'tour:feedback:v1';

const seed: FeedbackTicket[] = [
  {
    id: 'fb-1',
    category: 'ui',
    content: '希望景区详情页图片能支持左右滑动查看。',
    contact: '',
    createdAt: new Date(Date.now() - 86400 * 1000 * 4).toISOString(),
    status: 'resolved',
    reply: '已优化图片轮播体验，感谢反馈。',
  },
  {
    id: 'fb-2',
    category: 'feature',
    content: '建议加入离线缓存提示。',
    contact: '微信：tour_user',
    createdAt: new Date(Date.now() - 86400 * 1000 * 1).toISOString(),
    status: 'in_progress',
  },
];

export function listFeedback(): FeedbackTicket[] {
  const data = readStorageJson<FeedbackTicket[]>(KEY, []);
  if (Array.isArray(data) && data.length) {
    return data;
  }
  writeStorageJson(KEY, seed);
  return seed;
}

export function createFeedback(input: { category: FeedbackCategory; content: string; contact?: string }): FeedbackTicket {
  const all = listFeedback();
  const entry: FeedbackTicket = {
    id: shortId('fb'),
    category: input.category,
    content: input.content,
    contact: input.contact,
    createdAt: nowISO(),
    status: 'new',
  };
  const next = [entry, ...all];
  writeStorageJson(KEY, next);
  return entry;
}

export function updateFeedbackStatus(id: string, status: FeedbackStatus): void {
  const all = listFeedback();
  const next = all.map((f) => (f.id === id ? { ...f, status } : f));
  writeStorageJson(KEY, next);
}
