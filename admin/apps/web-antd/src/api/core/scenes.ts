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

export interface SceneItem {
  id: string;
  name: string;
  fileKey: string;
  fileUrl: string;
  fileSize: number;
  fileType?: null | string;
  originalFilename?: null | string;
  publishedBy?: null | string;
  createdAt: string;
  updatedAt: string;
}

export interface SceneCreatePayload {
  name: string;
  file?: Blob | File | null;
}

export interface SceneUpdatePayload {
  name?: string;
  file?: Blob | File | null;
}

export interface ListScenesParams {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

function appendField(form: FormData, key: string, value: null | string | undefined) {
  if (value === undefined) {
    return;
  }
  form.append(key, value ?? '');
}

function toSceneFormData(payload: SceneCreatePayload | SceneUpdatePayload): FormData {
  const form = new FormData();
  appendField(form, 'name', payload.name);
  if (payload.file) {
    form.append('file', payload.file);
  }
  return form;
}

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return {
    items: result.data || [],
    total: result.total || 0,
  };
}

export async function listScenesApi(params: ListScenesParams) {
  const response = await requestClient.get<ServerPageResult<SceneItem>>('/admin/scenes', {
    params,
  });
  return normalizeGridPage(response);
}

export async function getSceneApi(id: string) {
  return requestClient.get<SceneItem>(`/admin/scenes/${id}`);
}

export async function createSceneApi(payload: FormData | SceneCreatePayload) {
  const data = payload instanceof FormData ? payload : toSceneFormData(payload);
  return requestClient.post<SceneItem>('/admin/scenes', data, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
}

export async function updateSceneApi(id: string, payload: FormData | SceneUpdatePayload) {
  const data = payload instanceof FormData ? payload : toSceneFormData(payload);
  return requestClient.put<SceneItem>(`/admin/scenes/${id}`, data, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
}

export async function deleteSceneApi(id: string) {
  return requestClient.delete(`/admin/scenes/${id}`);
}
