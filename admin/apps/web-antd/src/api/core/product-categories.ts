import { requestClient } from '#/api/request';

export interface ProductCategoryItem {
  id: string;
  name: string;
  description: null | string;
  sortOrder: number;
  enabled: boolean;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listProductCategoriesApi() {
  return requestClient.get<ProductCategoryItem[]>('/admin/product-categories');
}

export async function createProductCategoryApi(payload: {
  description?: string;
  enabled?: boolean;
  name: string;
  sortOrder?: number;
}) {
  return requestClient.post<ProductCategoryItem>('/admin/product-categories', payload);
}

export async function updateProductCategoryApi(
  id: string,
  payload: {
    description?: null | string;
    enabled?: boolean;
    name?: string;
    sortOrder?: number;
  },
) {
  return requestClient.put<ProductCategoryItem>(`/admin/product-categories/${encodeURIComponent(id)}`, payload);
}

export async function deleteProductCategoryApi(id: string) {
  return requestClient.delete(`/admin/product-categories/${encodeURIComponent(id)}`);
}
