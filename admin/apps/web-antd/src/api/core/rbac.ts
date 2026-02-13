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

export interface UserRoleItem {
  code: string;
  id: string;
  name: string;
}

export interface UserItem {
  createdAt: string;
  displayName: null | string;
  email: null | string;
  id: string;
  roles: UserRoleItem[];
  status: 'active' | 'disabled';
  updatedAt: string;
  username: string;
}

export interface UserListParams {
  keyword?: string;
  page?: number;
  pageSize?: number;
  status?: '' | 'active' | 'disabled';
}

export interface CreateUserPayload {
  displayName?: string;
  email?: string;
  password: string;
  roleIds?: string[];
  status?: 'active' | 'disabled';
  username: string;
}

export interface UpdateUserPayload {
  displayName?: string;
  email?: string;
  password?: string;
  roleIds?: string[];
  status?: 'active' | 'disabled';
}

export interface RoleItem {
  code: string;
  createdAt: string;
  description: null | string;
  id: string;
  name: string;
  permissions: string[];
  updatedAt: string;
}

export interface RoleListParams {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface PermissionItem {
  code: string;
  createdAt: string;
  description: null | string;
  group: null | string;
  id: string;
  name: string;
  updatedAt: string;
}

export interface PermissionListParams {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface PermissionOption {
  code: string;
  group: null | string;
  id: string;
  name: string;
}

export interface CreateRolePayload {
  code: string;
  description?: string;
  name: string;
  permissionIds?: string[];
}

export interface UpdateRolePayload {
  code?: string;
  description?: string;
  name?: string;
  permissionIds?: string[];
}

export interface CreatePermissionPayload {
  code: string;
  description?: string;
  group?: string;
  name: string;
}

export interface UpdatePermissionPayload {
  code?: string;
  description?: string;
  group?: string;
  name?: string;
}

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return {
    items: result.data || [],
    total: result.total || 0,
  };
}

export async function listUsersApi(params: UserListParams) {
  const response = await requestClient.get<ServerPageResult<UserItem>>(
    '/admin/users',
    {
      params,
    },
  );
  return normalizeGridPage(response);
}

export async function getUserApi(id: string) {
  return requestClient.get<UserItem>(`/admin/users/${id}`);
}

export async function createUserApi(payload: CreateUserPayload) {
  return requestClient.post<UserItem>('/admin/users', payload);
}

export async function updateUserApi(id: string, payload: UpdateUserPayload) {
  return requestClient.put<UserItem>(`/admin/users/${id}`, payload);
}

export async function deleteUserApi(id: string) {
  return requestClient.delete(`/admin/users/${id}`);
}

export async function updateUserStatusApi(
  id: string,
  status: 'active' | 'disabled',
) {
  return requestClient.put<UserItem>(`/admin/users/${id}/status`, {
    status,
  });
}

export async function listRolesApi(params: RoleListParams) {
  const response = await requestClient.get<ServerPageResult<RoleItem>>('/roles', {
    params,
  });
  return normalizeGridPage(response);
}

export async function getRoleApi(id: string) {
  return requestClient.get<RoleItem>(`/roles/${id}`);
}

export async function createRoleApi(payload: CreateRolePayload) {
  return requestClient.post<RoleItem>('/roles', payload);
}

export async function updateRoleApi(id: string, payload: UpdateRolePayload) {
  return requestClient.put<RoleItem>(`/roles/${id}`, payload);
}

export async function deleteRoleApi(id: string) {
  return requestClient.delete(`/roles/${id}`);
}

export async function listPermissionsApi(params: PermissionListParams) {
  const response = await requestClient.get<ServerPageResult<PermissionItem>>(
    '/permissions',
    {
      params,
    },
  );
  return normalizeGridPage(response);
}

export async function createPermissionApi(payload: CreatePermissionPayload) {
  return requestClient.post<PermissionItem>('/permissions', payload);
}

export async function updatePermissionApi(
  id: string,
  payload: UpdatePermissionPayload,
) {
  return requestClient.put<PermissionItem>(`/permissions/${id}`, payload);
}

export async function deletePermissionApi(id: string) {
  return requestClient.delete(`/permissions/${id}`);
}

export async function listPermissionOptionsApi() {
  return requestClient.get<PermissionOption[]>('/roles/options/permissions');
}
