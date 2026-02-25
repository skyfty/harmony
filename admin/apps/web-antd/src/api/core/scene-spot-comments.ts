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

export type SceneSpotCommentStatus = 'approved' | 'pending' | 'rejected';

export interface SceneSpotCommentItem {
  id: string;
  sceneSpotId: string;
  sceneSpotTitle: string;
  userId: string;
  userDisplayName: string;
  content: string;
  status: SceneSpotCommentStatus;
  rejectReason?: null | string;
  reviewedAt?: null | string;
  reviewedBy?: null | string;
  editedAt?: null | string;
  editedBy?: null | string;
  createdAt: string;
  updatedAt: string;
}

export interface ListSceneSpotCommentsParams {
  keyword?: string;
  page?: number;
  pageSize?: number;
  sceneSpotId?: string;
  status?: SceneSpotCommentStatus;
}

export interface CreateSceneSpotCommentPayload {
  sceneSpotId: string;
  userId: string;
  content: string;
  status?: SceneSpotCommentStatus;
  rejectReason?: string;
}

export interface UpdateSceneSpotCommentPayload {
  content: string;
}

export interface UpdateSceneSpotCommentStatusPayload {
  status: SceneSpotCommentStatus;
  rejectReason?: string;
}

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return {
    items: result.data || [],
    total: result.total || 0,
  };
}

export async function listSceneSpotCommentsApi(params: ListSceneSpotCommentsParams) {
  const response = await requestClient.get<ServerPageResult<SceneSpotCommentItem>>('/admin/scene-spot-comments', {
    params,
  });
  return normalizeGridPage(response);
}

export async function listSceneSpotCommentsBySceneSpotApi(sceneSpotId: string, params: Omit<ListSceneSpotCommentsParams, 'sceneSpotId'>) {
  const response = await requestClient.get<ServerPageResult<SceneSpotCommentItem>>(
    `/admin/scene-spots/${sceneSpotId}/comments`,
    { params },
  );
  return normalizeGridPage(response);
}

export async function getSceneSpotCommentApi(id: string) {
  return requestClient.get<SceneSpotCommentItem>(`/admin/scene-spot-comments/${id}`);
}

export async function createSceneSpotCommentApi(payload: CreateSceneSpotCommentPayload) {
  return requestClient.post<SceneSpotCommentItem>('/admin/scene-spot-comments', payload);
}

export async function updateSceneSpotCommentApi(id: string, payload: UpdateSceneSpotCommentPayload) {
  return requestClient.put<SceneSpotCommentItem>(`/admin/scene-spot-comments/${id}`, payload);
}

export async function updateSceneSpotCommentStatusApi(id: string, payload: UpdateSceneSpotCommentStatusPayload) {
  return requestClient.put<SceneSpotCommentItem>(`/admin/scene-spot-comments/${id}/status`, payload);
}

export async function deleteSceneSpotCommentApi(id: string) {
  return requestClient.delete(`/admin/scene-spot-comments/${id}`);
}
