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
}

export interface ListProjectsParams {
  categoryId?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
  userId?: string;
}

export interface ListProjectCategoriesParams {
}

export interface CreateProjectPayload {
  project: UserProjectDocument;
  userId?: string;
}

export interface UpdateProjectPayload {
  project: UserProjectDocument;
}

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return {
    items: result.data || [],
    total: result.total || 0,
  };
}

export async function listProjectsApi(params: ListProjectsParams) {
  const response = await requestClient.get<ServerPageResult<UserProjectListItem>>(
    '/admin/projects',
    {
      params,
    },
  );
  return normalizeGridPage(response);
}

export async function getProjectApi(userId: string, projectId: string) {
  return requestClient.get<{ project: UserProjectDocument; userId: string }>(
    `/admin/projects/${encodeURIComponent(userId)}/${encodeURIComponent(projectId)}`,
  );
}

export async function createProjectApi(payload: CreateProjectPayload) {
  return requestClient.post<{ project: UserProjectDocument; userId: string }>(
    '/admin/projects',
    payload,
  );
}

export async function updateProjectApi(
  userId: string,
  projectId: string,
  payload: UpdateProjectPayload,
) {
  return requestClient.put<{ project: UserProjectDocument; userId: string }>(
    `/admin/projects/${encodeURIComponent(userId)}/${encodeURIComponent(projectId)}`,
    payload,
  );
}

export async function deleteProjectApi(userId: string, projectId: string) {
  return requestClient.delete(
    `/admin/projects/${encodeURIComponent(userId)}/${encodeURIComponent(projectId)}`,
  );
}

export async function uploadProjectSceneBundleApi(
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
    `/admin/projects/${encodeURIComponent(userId)}/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}/bundle`,
    payload,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    },
  );
}

export async function deleteProjectSceneApi(
  userId: string,
  projectId: string,
  sceneId: string,
) {
  return requestClient.delete<{
    project: UserProjectDocument;
    userId: string;
  }>(
    `/admin/projects/${encodeURIComponent(userId)}/${encodeURIComponent(projectId)}/scenes/${encodeURIComponent(sceneId)}`,
  );
}

export async function listProjectCategoriesApi(
  params: ListProjectCategoriesParams = {},
) {
  return requestClient.get<UserProjectCategoryItem[]>('/admin/project-categories', {
    params,
  });
}

export async function createProjectCategoryApi(payload: {
  description?: string;
  enabled?: boolean;
  name: string;
  sortOrder?: number;
}) {
  return requestClient.post<UserProjectCategoryItem>(
    '/admin/project-categories',
    payload,
  );
}

export async function updateProjectCategoryApi(
  id: string,
  payload: {
    description?: null | string;
    enabled?: boolean;
    name?: string;
    sortOrder?: number;
  },
) {
  return requestClient.put<UserProjectCategoryItem>(
    `/admin/project-categories/${encodeURIComponent(id)}`,
    payload,
  );
}

export async function deleteProjectCategoryApi(id: string) {
  return requestClient.delete(`/admin/project-categories/${encodeURIComponent(id)}`)
}
