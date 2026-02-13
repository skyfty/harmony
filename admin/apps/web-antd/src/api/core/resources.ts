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

export interface ResourceCategoryPathItem {
  id: string;
  name: string;
}

export interface ResourceCategoryItem {
  children: ResourceCategoryItem[];
  createdAt: string;
  depth: number;
  description: null | string;
  hasChildren: boolean;
  id: string;
  name: string;
  parentId: null | string;
  path: ResourceCategoryPathItem[];
  updatedAt: string;
}

export interface ResourceTagItem {
  createdAt: string;
  description: null | string;
  id: string;
  name: string;
  updatedAt: string;
}

export interface ResourceSeriesItem {
  assetCount?: number;
  createdAt: string;
  description: null | string;
  id: string;
  name: string;
  updatedAt: string;
}

export interface ResourceAssetItem {
  categoryId: string;
  categoryPath: ResourceCategoryPathItem[];
  categoryPathString: string;
  color: null | string;
  createdAt: string;
  description: null | string;
  dimensionHeight: null | number;
  dimensionLength: null | number;
  dimensionWidth: null | number;
  downloadUrl: string;
  id: string;
  imageHeight: null | number;
  imageWidth: null | number;
  mimeType: null | string;
  name: string;
  originalFilename: null | string;
  previewUrl: null | string;
  seriesId: null | string;
  seriesName: null | string;
  size: number;
  sizeCategory: null | string;
  tagIds: string[];
  tags: Array<{ id: string; name: string }>;
  terrainScatterPreset: null | string;
  thumbnailUrl: null | string;
  type: string;
  updatedAt: string;
  url: string;
}

export interface ListResourceAssetsParams {
  categoryId?: string;
  includeDescendants?: boolean;
  keyword?: string;
  page?: number;
  pageSize?: number;
  seriesId?: string;
  tagIds?: string[];
  types?: string[];
}

export interface BulkMoveAssetsPayload {
  assetIds?: string[];
  fromCategoryId?: string;
  includeDescendants?: boolean;
  targetCategoryId: string;
}

export interface MergeCategoryPayload {
  moveChildren?: boolean;
  sourceCategoryId: string;
  targetCategoryId: string;
}

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return {
    items: result.data || [],
    total: result.total || 0,
  };
}

export async function listResourceAssetsApi(params: ListResourceAssetsParams) {
  const response = await requestClient.get<ServerPageResult<ResourceAssetItem>>(
    '/resources/assets',
    {
      params,
    },
  );
  return normalizeGridPage(response);
}

export async function getResourceAssetApi(id: string) {
  return requestClient.get<ResourceAssetItem>(`/resources/assets/${id}`);
}

export async function createResourceAssetApi(payload: FormData) {
  return requestClient.post<{ asset: ResourceAssetItem }>('/resources/assets', payload, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
}

export async function updateResourceAssetApi(id: string, payload: FormData) {
  return requestClient.put<ResourceAssetItem>(`/resources/assets/${id}`, payload, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
}

export async function deleteResourceAssetApi(id: string) {
  return requestClient.delete(`/resources/assets/${id}`);
}

export async function bulkMoveResourceAssetsApi(payload: BulkMoveAssetsPayload) {
  return requestClient.post<{ matchedCount: number; modifiedCount: number }>(
    '/resources/assets/bulk-move-category',
    payload,
  );
}

export async function listResourceCategoriesApi() {
  return requestClient.get<ResourceCategoryItem[]>('/resources/categories');
}

export async function createResourceCategoryApi(payload: {
  description?: string;
  name: string;
  parentId?: null | string;
}) {
  return requestClient.post<ResourceCategoryItem>('/resources/categories', payload);
}

export async function updateResourceCategoryApi(
  id: string,
  payload: { description?: null | string; name?: string },
) {
  return requestClient.put<ResourceCategoryItem>(`/resources/categories/${id}`, payload);
}

export async function deleteResourceCategoryApi(id: string) {
  return requestClient.delete(`/resources/categories/${id}`);
}

export async function moveResourceCategoryApi(id: string, targetParentId: null | string) {
  return requestClient.post<ResourceCategoryItem>(`/resources/categories/${id}/move`, {
    targetParentId,
  });
}

export async function mergeResourceCategoriesApi(payload: MergeCategoryPayload) {
  return requestClient.post<{
    deletedCategoryId: string;
    movedAssetCount: number;
    movedChildCount: number;
  }>('/resources/categories/merge', payload);
}

export async function listResourceTagsApi() {
  return requestClient.get<ResourceTagItem[]>('/resources/tags');
}

export async function createResourceTagApi(payload: { name?: string; names?: string[]; description?: string }) {
  return requestClient.post<{ tags: ResourceTagItem[]; createdTagIds?: string[] }>('/resources/tags', payload);
}

export async function updateResourceTagApi(id: string, payload: { name: string; description?: null | string }) {
  return requestClient.put<ResourceTagItem>(`/resources/tags/${id}`, payload);
}

export async function deleteResourceTagApi(id: string) {
  return requestClient.delete(`/resources/tags/${id}`);
}

export async function listResourceSeriesApi() {
  return requestClient.get<ResourceSeriesItem[]>('/resources/series');
}

export async function createResourceSeriesApi(payload: { name: string; description?: string | null }) {
  return requestClient.post<ResourceSeriesItem>('/resources/series', payload);
}

export async function updateResourceSeriesApi(id: string, payload: { name: string; description?: string | null }) {
  return requestClient.put<ResourceSeriesItem>(`/resources/series/${id}`, payload);
}

export async function deleteResourceSeriesApi(id: string) {
  return requestClient.delete(`/resources/series/${id}`);
}

export function buildResourceDownloadUrl(id: string) {
  return `/api/resources/assets/${id}/download`;
}
