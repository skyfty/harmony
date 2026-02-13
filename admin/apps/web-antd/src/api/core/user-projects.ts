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

export interface UserProjectSceneMeta {
  id: string;
  name: string;
  projectId: string;
  sceneJsonUrl: string;
}

export interface UserProjectDocument {
  categoryId?: null | string;
  id: string;
  lastEditedSceneId: null | string;
  name: string;
  scenes: UserProjectSceneMeta[];
}

export interface UserProjectListItem {
  categoryId: null | string;
  createdAt: string;
  id: string;
  lastEditedSceneId: null | string;
  name: string;
  sceneCount: number;
  updatedAt: string;
  userId: string;
}

export interface UserProjectCategoryItem {
  createdAt: string;
  description: null | string;
  enabled: boolean;
  id: string;
  name: string;
  sortOrder: number;
  updatedAt: string;
  userId: string;
}

export interface ListUserProjectsParams {
  categoryId?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
  userId?: string;
}

export interface ListUserProjectCategoriesParams {
  userId?: string;
}

export interface CreateUserProjectPayload {
  project: UserProjectDocument;
  userId?: string;
}

export interface UpdateUserProjectPayload {
  project: UserProjectDocument;
}

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return {
    items: result.data || [],
    total: result.total || 0,
  };
}

export async function listUserProjectsApi(params: ListUserProjectsParams) {
  const response = await requestClient.get<ServerPageResult<UserProjectListItem>>(
    '/admin/user-projects',
    {
      params,
    },
  );
  return normalizeGridPage(response);
}

export async function getUserProjectApi(userId: string, projectId: string) {
  return requestClient.get<{ project: UserProjectDocument; userId: string }>(
    `/admin/user-projects/${encodeURIComponent(userId)}/${encodeURIComponent(projectId)}`,
  );
}

export async function createUserProjectApi(payload: CreateUserProjectPayload) {
  return requestClient.post<{ project: UserProjectDocument; userId: string }>(
    '/admin/user-projects',
    payload,
  );
}

export async function updateUserProjectApi(
  userId: string,
  projectId: string,
  payload: UpdateUserProjectPayload,
) {
  return requestClient.put<{ project: UserProjectDocument; userId: string }>(
    `/admin/user-projects/${encodeURIComponent(userId)}/${encodeURIComponent(projectId)}`,
    payload,
  );
}

export async function deleteUserProjectApi(userId: string, projectId: string) {
  return requestClient.delete(
    `/admin/user-projects/${encodeURIComponent(userId)}/${encodeURIComponent(projectId)}`,
  );
}

export async function uploadUserProjectSceneBundleApi(
  userId: string,
  projectId: string,
  sceneId: string,
  file: File,
) {
  const payload = new FormData();
  payload.append('file', file);
  return requestClient.put<{
    project: UserProjectDocument;
    scene: {
      id: string;
      name: string;
      projectId: string;
    };
    userId: string;
  }>(
    `/admin/user-projects/${encodeURIComponent(userId)}/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/bundle`,
    payload,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    },
  );
}

export async function deleteUserProjectSceneApi(
  userId: string,
  projectId: string,
  sceneId: string,
) {
  return requestClient.delete<{
    project: UserProjectDocument;
    userId: string;
  }>(
    `/admin/user-projects/${encodeURIComponent(userId)}/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}`,
  );
}

export async function listUserProjectCategoriesApi(
  params: ListUserProjectCategoriesParams = {},
) {
  return requestClient.get<UserProjectCategoryItem[]>('/admin/user-project-categories', {
    params,
  });
}

export async function createUserProjectCategoryApi(payload: {
  description?: string;
  enabled?: boolean;
  name: string;
  sortOrder?: number;
  userId?: string;
}) {
  return requestClient.post<UserProjectCategoryItem>(
    '/admin/user-project-categories',
    payload,
  );
}

export async function updateUserProjectCategoryApi(
  id: string,
  payload: {
    description?: null | string;
    enabled?: boolean;
    name?: string;
    sortOrder?: number;
    userId?: string;
  },
) {
  return requestClient.put<UserProjectCategoryItem>(
    `/admin/user-project-categories/${encodeURIComponent(id)}`,
    payload,
  );
}

export async function deleteUserProjectCategoryApi(id: string, userId?: string) {
  return requestClient.delete(`/admin/user-project-categories/${encodeURIComponent(id)}`,
    {
      params: userId ? { userId } : undefined,
    },
  );
}
