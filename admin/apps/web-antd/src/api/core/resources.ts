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
  directoryId?: null | string;
  directoryPath?: ResourceCategoryPathItem[];
  directoryPathString?: string;
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
  directoryId?: string;
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

export interface BulkMoveAssetsDirectoryPayload {
  assetIds: string[];
  targetDirectoryId: string;
}

export interface ResourceDirectoryItem {
  children: ResourceDirectoryItem[];
  createdAt: string;
  depth: number;
  hasChildren: boolean;
  id: string;
  name: string;
  parentId: null | string;
  path: ResourceCategoryPathItem[];
  updatedAt: string;
}

export interface ResourceDirectoryEntryDirectory {
  createdAt: string;
  depth: number;
  hasChildren: boolean;
  id: string;
  kind: 'directory';
  name: string;
  parentId: null | string;
  path: ResourceCategoryPathItem[];
  pathIds: string[];
  pathNames: string[];
  updatedAt: string;
}

export type ResourceDirectoryEntry = ResourceAssetItem | ResourceDirectoryEntryDirectory;

export interface ResourceDirectoryEntriesResult {
  currentDirectory: {
    id: string;
    name: string;
    parentId: null | string;
    path: ResourceCategoryPathItem[];
  };
  items: ResourceDirectoryEntry[];
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
    '/admin/resources/assets',
    {
      params,
    },
  );
  return normalizeGridPage(response);
}

export async function getResourceAssetApi(id: string) {
  return requestClient.get<ResourceAssetItem>(`/admin/resources/assets/${id}`);
}

export async function createResourceAssetApi(payload: FormData) {
  return requestClient.post<{ asset: ResourceAssetItem }>('/admin/resources/assets', payload, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
}

export async function updateResourceAssetApi(id: string, payload: FormData) {
  return requestClient.put<ResourceAssetItem>(`/admin/resources/assets/${id}`, payload, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
}

export async function deleteResourceAssetApi(id: string) {
  return requestClient.delete(`/admin/resources/assets/${id}`);
}

export async function bulkMoveResourceAssetsApi(payload: BulkMoveAssetsPayload) {
  return requestClient.post<{ matchedCount: number; modifiedCount: number }>(
    '/admin/resources/assets/bulk-move-category',
    payload,
  );
}

export async function bulkMoveResourceAssetsDirectoryApi(payload: BulkMoveAssetsDirectoryPayload) {
  return requestClient.post<{ matchedCount: number; modifiedCount: number }>(
    '/admin/resources/assets/bulk-move-directory',
    payload,
  );
}

export async function listResourceDirectoriesApi() {
  return requestClient.get<ResourceDirectoryItem[]>('/admin/resources/asset-directories');
}

export async function listResourceDirectoryEntriesApi(directoryId?: string) {
  return requestClient.get<ResourceDirectoryEntriesResult>('/admin/resources/asset-directories/entries', {
    params: {
      directoryId,
    },
  });
}

export async function createResourceDirectoryApi(payload: { name: string; parentId?: null | string }) {
  return requestClient.post<ResourceDirectoryItem>('/admin/resources/asset-directories', payload);
}

export async function updateResourceDirectoryApi(id: string, payload: { name: string }) {
  return requestClient.put<ResourceDirectoryItem>(`/admin/resources/asset-directories/${id}`, payload);
}

export async function deleteResourceDirectoryApi(id: string) {
  return requestClient.delete(`/admin/resources/asset-directories/${id}`);
}

export async function moveResourceDirectoryApi(id: string, targetParentId: null | string) {
  return requestClient.post<ResourceDirectoryItem>(`/admin/resources/asset-directories/${id}/move`, {
    targetParentId,
  });
}

export async function listResourceCategoriesApi() {
  return requestClient.get<ResourceCategoryItem[]>('/admin/resources/categories');
}

export async function createResourceCategoryApi(payload: {
  description?: string;
  name: string;
  parentId?: null | string;
}) {
  return requestClient.post<ResourceCategoryItem>('/admin/resources/categories', payload);
}

export async function updateResourceCategoryApi(
  id: string,
  payload: { description?: null | string; name?: string },
) {
  return requestClient.put<ResourceCategoryItem>(`/admin/resources/categories/${id}`, payload);
}

export async function deleteResourceCategoryApi(id: string) {
  return requestClient.delete(`/admin/resources/categories/${id}`);
}

export async function moveResourceCategoryApi(id: string, targetParentId: null | string) {
  return requestClient.post<ResourceCategoryItem>(`/admin/resources/categories/${id}/move`, {
    targetParentId,
  });
}

export async function mergeResourceCategoriesApi(payload: MergeCategoryPayload) {
  return requestClient.post<{
    deletedCategoryId: string;
    movedAssetCount: number;
    movedChildCount: number;
  }>('/admin/resources/categories/merge', payload);
}

export async function listResourceTagsApi() {
  return requestClient.get<ResourceTagItem[]>('/admin/resources/tags');
}

export async function createResourceTagApi(payload: { name?: string; names?: string[]; description?: string }) {
  return requestClient.post<{ tags: ResourceTagItem[]; createdTagIds?: string[] }>('/admin/resources/tags', payload);
}

export async function updateResourceTagApi(id: string, payload: { name: string; description?: null | string }) {
  return requestClient.put<ResourceTagItem>(`/admin/resources/tags/${id}`, payload);
}

export async function deleteResourceTagApi(id: string) {
  return requestClient.delete(`/admin/resources/tags/${id}`);
}

export async function listResourceSeriesApi() {
  return requestClient.get<ResourceSeriesItem[]>('/admin/resources/series');
}

export async function createResourceSeriesApi(payload: { name: string; description?: string | null }) {
  return requestClient.post<ResourceSeriesItem>('/admin/resources/series', payload);
}

export async function updateResourceSeriesApi(id: string, payload: { name: string; description?: string | null }) {
  return requestClient.put<ResourceSeriesItem>(`/admin/resources/series/${id}`, payload);
}

export async function deleteResourceSeriesApi(id: string) {
  return requestClient.delete(`/admin/resources/series/${id}`);
}

export function buildResourceDownloadUrl(id: string) {
  return `/api/admin/resources/assets/${id}/download`;
}
