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

export interface SceneSpotItem {
  id: string;
  sceneId: string;
  title: string;
  coverImage?: null | string;
  slides: string[];
  description: string;
  address: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListSceneSpotsParams {
  keyword?: string;
  page?: number;
  pageSize?: number;
  sceneId?: string;
}

export interface SceneSpotCreatePayload {
  sceneId: string;
  title: string;
  coverImage?: null | string;
  slides?: string[] | string;
  description?: null | string;
  address?: null | string;
  order?: number;
}

export interface SceneSpotUpdatePayload {
  sceneId?: string;
  title?: string;
  coverImage?: null | string;
  slides?: string[] | string;
  description?: null | string;
  address?: null | string;
  order?: number;
}

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return {
    items: result.data || [],
    total: result.total || 0,
  };
}

export async function listSceneSpotsApi(params: ListSceneSpotsParams) {
  const response = await requestClient.get<ServerPageResult<SceneSpotItem>>('/admin/scene-spots', {
    params,
  });
  return normalizeGridPage(response);
}

export async function getSceneSpotApi(id: string) {
  return requestClient.get<SceneSpotItem>(`/admin/scene-spots/${id}`);
}

export async function createSceneSpotApi(payload: SceneSpotCreatePayload) {
  return requestClient.post<SceneSpotItem>('/admin/scene-spots', payload);
}

export async function updateSceneSpotApi(id: string, payload: SceneSpotUpdatePayload) {
  return requestClient.put<SceneSpotItem>(`/admin/scene-spots/${id}`, payload);
}

export async function deleteSceneSpotApi(id: string) {
  return requestClient.delete(`/admin/scene-spots/${id}`);
}
