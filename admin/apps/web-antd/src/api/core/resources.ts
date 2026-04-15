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

export interface BulkMoveAssetsCategoryPayload {
  assetIds: string[];
  targetDirectoryId: string;
}

export interface ResourceCategoryTreeItem {
  children: ResourceCategoryTreeItem[];
  createdAt: string;
  depth: number;
  hasChildren: boolean;
  id: string;
  name: string;
  parentId: null | string;
  path: ResourceCategoryPathItem[];
  updatedAt: string;
}

export interface ResourceCategoryEntryDirectory {
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

export type ResourceCategoryEntry = ResourceAssetItem | ResourceCategoryEntryDirectory;

export interface ResourceCategoryEntriesResult {
  currentDirectory: {
    id: string;
    name: string;
    parentId: null | string;
    path: ResourceCategoryPathItem[];
  };
  items: ResourceCategoryEntry[];
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

export async function bulkMoveResourceAssetsCategoryApi(payload: BulkMoveAssetsCategoryPayload) {
  return requestClient.post<{ matchedCount: number; modifiedCount: number }>(
    '/admin/resources/assets/bulk-move-category',
    {
      assetIds: payload.assetIds,
      targetCategoryId: payload.targetDirectoryId,
    },
  );
}

export async function listResourceCategoriesTreeApi() {
  return requestClient.get<ResourceCategoryTreeItem[]>('/admin/resources/categories');
}

export async function listResourceCategoryEntriesApi(categoryId?: string) {
  return requestClient.get<ResourceCategoryEntriesResult>('/admin/resources/categories/entries', {
    params: {
      categoryId,
    },
  });
}

export async function createResourceCategoryTreeItemApi(payload: { name: string; parentId?: null | string }) {
  return requestClient.post<ResourceCategoryTreeItem>('/admin/resources/categories', payload);
}

export async function updateResourceCategoryTreeItemApi(id: string, payload: { name: string }) {
  return requestClient.put<ResourceCategoryTreeItem>(`/admin/resources/categories/${id}`, payload);
}

export async function deleteResourceCategoryTreeItemApi(id: string) {
  return requestClient.delete(`/admin/resources/categories/${id}`);
}

export async function moveResourceCategoryTreeItemApi(id: string, targetParentId: null | string) {
  return requestClient.post<ResourceCategoryTreeItem>(`/admin/resources/categories/${id}/move`, {
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
