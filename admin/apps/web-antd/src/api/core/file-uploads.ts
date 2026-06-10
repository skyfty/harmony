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

export interface FileUploadItem {
  id: string;
  module: string;
  label?: string | null;
  fileKey: string;
  url: string;
  originalFilename?: string | null;
  mimeType?: string | null;
  size: number;
  uploaderAdminId?: string | null;
  uploaderUsername?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListFileUploadsParams {
  keyword?: string;
  module?: string;
  page?: number;
  pageSize?: number;
}

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return {
    items: result.data || [],
    total: result.total || 0,
  };
}

export async function listFileUploadsApi(params: ListFileUploadsParams) {
  const response = await requestClient.get<ServerPageResult<FileUploadItem>>('/admin/uploads', {
    params,
  });
  return normalizeGridPage(response);
}

export async function getFileUploadApi(id: string) {
  return requestClient.get<FileUploadItem>(`/admin/uploads/${id}`);
}

export async function uploadFileApi(payload: FormData) {
  return requestClient.post<FileUploadItem>('/admin/uploads', payload, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
}

export async function deleteFileUploadApi(id: string) {
  return requestClient.delete(`/admin/uploads/${id}`);
}