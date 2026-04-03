import { requestClient } from '#/api/request';

interface ServerPageResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

interface GridPageResult<T> {
  items: T[];
  total: number;
}

export type MedalRuleType =
  | 'enter_scenic'
  | 'punch_ratio_gte'
  | 'enter_count_gte'
  | 'punch_count_gte'
  | 'specific_scenic_set_complete';

export interface MedalRuleItem {
  type: MedalRuleType;
  params?: Record<string, unknown> | null;
  order?: number;
}

export interface MedalItem {
  id: string;
  name: string;
  description?: null | string;
  lockedIconUrl?: null | string;
  unlockedIconUrl?: null | string;
  enabled: boolean;
  sort: number;
  rules: MedalRuleItem[];
  ruleCount: number;
  metadata?: null | Record<string, unknown>;
  createdAt?: null | string;
  updatedAt?: null | string;
}

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return {
    items: result.data || [],
    total: result.total || 0,
  };
}

export async function listMedalsApi(params?: { keyword?: string; page?: number; pageSize?: number }) {
  const response = await requestClient.get<ServerPageResult<MedalItem>>('/admin/medals', { params });
  return normalizeGridPage(response);
}

export async function getMedalApi(id: string) {
  return requestClient.get<MedalItem>(`/admin/medals/${id}`);
}

export async function createMedalApi(payload: {
  name: string;
  description?: string;
  lockedIconUrl?: null | string;
  unlockedIconUrl?: null | string;
  enabled?: boolean;
  sort?: number;
  rules: MedalRuleItem[];
}) {
  return requestClient.post<MedalItem>('/admin/medals', payload);
}

export async function updateMedalApi(
  id: string,
  payload: Partial<{
    name: string;
    description?: string;
    lockedIconUrl?: null | string;
    unlockedIconUrl?: null | string;
    enabled?: boolean;
    sort?: number;
    rules: MedalRuleItem[];
  }>,
) {
  return requestClient.put<MedalItem>(`/admin/medals/${id}`, payload);
}

export async function deleteMedalApi(id: string) {
  return requestClient.delete(`/admin/medals/${id}`);
}