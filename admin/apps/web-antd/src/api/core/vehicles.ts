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

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return {
    items: result.data || [],
    total: result.total || 0,
  };
}

export interface VehicleItem {
  id: string;
  name: string;
  description: string;
  coverUrl: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListVehiclesParams {
  keyword?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export interface VehiclePayload {
  name?: string;
  description?: string;
  coverUrl?: string;
  isActive?: boolean;
}

export interface UserVehicleItem {
  id: string;
  userId: string;
  user: {
    id: string;
    username?: string | null;
    displayName?: string | null;
  } | null;
  vehicleId: string;
  vehicle: {
    id: string;
    name: string;
    description: string;
    coverUrl: string;
    isActive: boolean;
  } | null;
  ownedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListUserVehiclesParams {
  keyword?: string;
  userId?: string;
  vehicleId?: string;
  page?: number;
  pageSize?: number;
}

export interface UserVehiclePayload {
  userId?: string;
  vehicleId?: string;
}

export async function listVehiclesApi(params: ListVehiclesParams) {
  const response = await requestClient.get<ServerPageResult<VehicleItem>>('/admin/vehicles', {
    params,
  });
  return normalizeGridPage(response);
}

export async function getVehicleApi(id: string) {
  return requestClient.get<VehicleItem>(`/admin/vehicles/${id}`);
}

export async function createVehicleApi(payload: VehiclePayload) {
  return requestClient.post<VehicleItem>('/admin/vehicles', payload);
}

export async function updateVehicleApi(id: string, payload: VehiclePayload) {
  return requestClient.put<VehicleItem>(`/admin/vehicles/${id}`, payload);
}

export async function deleteVehicleApi(id: string) {
  return requestClient.delete(`/admin/vehicles/${id}`);
}

export async function listUserVehiclesApi(params: ListUserVehiclesParams) {
  const response = await requestClient.get<ServerPageResult<UserVehicleItem>>('/admin/user-vehicles', {
    params,
  });
  return normalizeGridPage(response);
}

export async function getUserVehicleApi(id: string) {
  return requestClient.get<UserVehicleItem>(`/admin/user-vehicles/${id}`);
}

export async function createUserVehicleApi(payload: UserVehiclePayload) {
  return requestClient.post<UserVehicleItem>('/admin/user-vehicles', payload);
}

export async function updateUserVehicleApi(id: string, payload: UserVehiclePayload) {
  return requestClient.put<UserVehicleItem>(`/admin/user-vehicles/${id}`, payload);
}

export async function deleteUserVehicleApi(id: string) {
  return requestClient.delete(`/admin/user-vehicles/${id}`);
}
