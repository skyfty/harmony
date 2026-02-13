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

export interface ProductItem {
  id: string;
  name: string;
  slug: string;
  type: string;
  category: string;
  validityDays: number | null;
  applicableSceneTags: string[];
  summary: string | null;
  description: string | null;
  price: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListProductsParams {
  keyword?: string;
  page?: number;
  pageSize?: number;
  type?: string;
}

export interface CreateProductPayload {
  name: string;
  slug: string;
  type: string;
  category?: string;
  validityDays?: number | null;
  applicableSceneTags?: string[];
  summary?: string | null;
  description?: string | null;
  price?: number;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateProductPayload {
  name?: string;
  slug?: string;
  type?: string;
  category?: string;
  validityDays?: number | null;
  applicableSceneTags?: string[];
  summary?: string | null;
  description?: string | null;
  price?: number;
  metadata?: Record<string, unknown> | null;
}

function normalizeGridPage<T>(result: ServerPageResult<T>): GridPageResult<T> {
  return {
    items: result.data || [],
    total: result.total || 0,
  };
}

export async function listProductsApi(params: ListProductsParams) {
  const response = await requestClient.get<ServerPageResult<ProductItem>>('/admin/products', {
    params,
  });
  return normalizeGridPage(response);
}

export async function getProductApi(id: string) {
  return requestClient.get<ProductItem>(`/admin/products/${id}`);
}

export async function createProductApi(payload: CreateProductPayload) {
  return requestClient.post<ProductItem>('/admin/products', payload);
}

export async function updateProductApi(id: string, payload: UpdateProductPayload) {
  return requestClient.put<ProductItem>(`/admin/products/${id}`, payload);
}

export async function deleteProductApi(id: string) {
  return requestClient.delete(`/admin/products/${id}`);
}
