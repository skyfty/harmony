import { requestClient } from '#/api/request';

type PagedResponse<T> = {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
};

type Query = Record<string, number | string | undefined>;

function get<T>(url: string, params?: Query) {
  return requestClient.get<T>(url, { params });
}

function post<T>(url: string, body?: Record<string, unknown>) {
  return requestClient.post<T>(url, body ?? {});
}

function put<T>(url: string, body?: Record<string, unknown>) {
  return requestClient.put<T>(url, body ?? {});
}

function remove(url: string) {
  return requestClient.delete(url);
}

export async function fetchScenics(params: Query) {
  return get<PagedResponse<Record<string, unknown>>>('/admin/scenics', params);
}

export async function createScenic(payload: Record<string, unknown>) {
  return post('/admin/scenics', payload);
}

export async function updateScenic(id: string, payload: Record<string, unknown>) {
  return put(`/admin/scenics/${id}`, payload);
}

export async function deleteScenic(id: string) {
  return remove(`/admin/scenics/${id}`);
}

export async function fetchProducts(params: Query) {
  return get<PagedResponse<Record<string, unknown>>>('/admin/products', params);
}

export async function createProduct(payload: Record<string, unknown>) {
  return post('/admin/products', payload);
}

export async function updateProduct(id: string, payload: Record<string, unknown>) {
  return put(`/admin/products/${id}`, payload);
}

export async function deleteProduct(id: string) {
  return remove(`/admin/products/${id}`);
}

export async function fetchCoupons(params: Query) {
  return get<PagedResponse<Record<string, unknown>>>('/admin/coupons', params);
}

export async function createCoupon(payload: Record<string, unknown>) {
  return post('/admin/coupons', payload);
}

export async function updateCoupon(id: string, payload: Record<string, unknown>) {
  return put(`/admin/coupons/${id}`, payload);
}

export async function deleteCoupon(id: string) {
  return remove(`/admin/coupons/${id}`);
}

export async function fetchUsers(params: Query) {
  return get<PagedResponse<Record<string, unknown>>>('/admin/users', params);
}

export async function createUser(payload: Record<string, unknown>) {
  return post('/admin/users', payload);
}

export async function updateUser(id: string, payload: Record<string, unknown>) {
  return put(`/admin/users/${id}`, payload);
}

export async function deleteUser(id: string) {
  return remove(`/admin/users/${id}`);
}

export async function fetchOrders(params: Query) {
  return get<PagedResponse<Record<string, unknown>>>('/admin/orders', params);
}

export async function createOrder(payload: Record<string, unknown>) {
  return post('/admin/orders', payload);
}

export async function updateOrder(id: string, payload: Record<string, unknown>) {
  return put(`/admin/orders/${id}`, payload);
}

export async function deleteOrder(id: string) {
  return remove(`/admin/orders/${id}`);
}

export async function fetchCategories(params: Query) {
  const data = await get<Record<string, unknown>[]>('/admin/categories', params);
  return {
    data,
    page: 1,
    pageSize: data.length,
    total: data.length,
  } satisfies PagedResponse<Record<string, unknown>>;
}

export async function createCategory(payload: Record<string, unknown>) {
  return post('/admin/categories', payload);
}

export async function updateCategory(id: string, payload: Record<string, unknown>) {
  return put(`/admin/categories/${id}`, payload);
}

export async function deleteCategory(id: string) {
  return remove(`/admin/categories/${id}`);
}

export async function fetchAssets(params: Query) {
  return get<PagedResponse<Record<string, unknown>>>('/admin/resources/assets', params);
}

function toFormData(payload: Record<string, unknown>) {
  const data = new FormData();
  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    if (value instanceof Blob) {
      data.append(key, value);
      return;
    }
    if (typeof value === 'object') {
      data.append(key, JSON.stringify(value));
      return;
    }
    data.append(key, String(value));
  });
  return data;
}

export async function createAsset(payload: Record<string, unknown>) {
  return requestClient.post('/admin/resources/assets', toFormData(payload), {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
}

export async function updateAsset(id: string, payload: Record<string, unknown>) {
  return requestClient.put(`/admin/resources/assets/${id}`, toFormData(payload), {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
}

export async function deleteAsset(id: string) {
  return remove(`/admin/resources/assets/${id}`);
}
