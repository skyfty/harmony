import { get, post, patch, del, setAuthToken, getAuthToken, getApiOrigin } from '@/utils/http';

export interface AuthSession {
  token?: string;
  user: {
    id: string;
    username: string;
    displayName?: string;
    email?: string;
    avatarUrl?: string;
    phone?: string;
    bio?: string;
    gender?: 'male' | 'female' | 'other';
    birthDate?: string;
    workShareCount?: number;
    exhibitionShareCount?: number;
  };
  permissions: string[];
}

export interface WorkSummary {
  id: string;
  ownerId: string;
  title: string;
  description?: string;
  mediaType: 'image' | 'video' | 'model' | 'other';
  fileUrl: string;
  thumbnailUrl?: string;
  size?: number;
  tags: string[];
  likesCount: number;
  liked: boolean;
  averageRating: number;
  ratingCount: number;
  userRating?: {
    score: number;
    comment?: string;
  };
  collections: Array<{
    id: string;
    title: string;
    coverUrl?: string;
  }>;
  commentCount: number;
  shareCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionSummary {
  id: string;
  ownerId: string;
  title: string;
  description?: string;
  coverUrl?: string;
  isPublic: boolean;
  // Optional engagement fields
  likesCount?: number;
  liked?: boolean;
  ratingCount?: number;
  averageRating?: number;
  userRating?: {
    score: number;
    comment?: string;
  };
  works: WorkSummary[];
  workCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkRecordSummary {
  id: string;
  workId: string;
  fileName: string;
  fileUrl: string;
  mediaType: string;
  fileSize?: number;
  uploadedAt: string;
  work?: {
    id: string;
    title: string;
    thumbnailUrl?: string;
  };
}

export interface ExhibitionSummary {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  coverUrl?: string;
  coverUrls: string[];
  status: 'draft' | 'published' | 'withdrawn';
  startDate?: string;
  endDate?: string;
  works: WorkSummary[];
  workCount: number;
  collections: Array<{
    id: string;
    title: string;
    description?: string;
    coverUrl?: string;
    workCount: number;
  }>;
  collectionIds: string[];
  likesCount: number;
  liked: boolean;
  ratingCount: number;
  averageRating: number;
  userRating?: {
    score: number;
    comment?: string;
  };
  visitCount: number;
  visited: boolean;
  shareCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  category: string;
  price: number;
  imageUrl?: string;
  description?: string;
  tags?: string[];
  usageConfig?: ProductUsageConfig;
  purchased: boolean;
  purchasedAt?: string;
}

export interface ProductUsageConfig {
  type: 'permanent' | 'consumable';
  perExhibitionLimit?: number | null;
  exclusiveGroup?: string | null;
  stackable?: boolean;
  notes?: string;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: 'pending' | 'paid' | 'completed' | 'cancelled';
  totalAmount: number;
  paymentMethod?: string;
  shippingAddress?: string;
  items: Array<{
    productId: string;
    name: string;
    price: number;
    quantity: number;
    product?: {
      id: string;
      slug: string;
      category: string;
      imageUrl?: string;
      description?: string;
    };
  }>;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export async function apiRegister(payload: {
  username: string;
  password: string;
  displayName?: string;
  email?: string;
  phone?: string;
}): Promise<AuthSession> {
  const session = await post<AuthSession>('/users/register', payload, false);
  if (session.token) {
    setAuthToken(session.token);
  }
  return session;
}

export async function apiLogin(payload: { username: string; password: string }): Promise<AuthSession> {
  const session = await post<AuthSession>('/users/login', payload, false);
  if (session.token) {
    setAuthToken(session.token);
  }
  return session;
}

export function apiGetProfile(): Promise<AuthSession> {
  return get<AuthSession>('/users/me');
}

export function apiUpdateProfile(payload: {
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  phone?: string;
  bio?: string;
  gender?: 'male' | 'female' | 'other';
  birthDate?: string;
}): Promise<AuthSession> {
  return patch<AuthSession>('/users/me', payload);
}

export interface CreateWorkPayload {
  title: string;
  fileUrl: string;
  description?: string;
  mediaType?: 'image' | 'video' | 'model' | 'other';
  thumbnailUrl?: string;
  size?: number;
  tags?: string[];
  fileName?: string;
}

export function apiCreateWorks(payload: CreateWorkPayload[]): Promise<{ works: WorkSummary[] }> {
  return post('/works', { works: payload });
}

export function apiGetWorks(params?: { owner?: string; collectionId?: string; search?: string }): Promise<{
  total: number;
  works: WorkSummary[];
}> {
  const query = params
    ? `?${Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== '')
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
        .join('&')}`
    : '';
  return get(`/works${query}`);
}

export function apiGetWork(id: string): Promise<WorkSummary> {
  return get(`/works/${id}`);
}

export function apiDeleteWork(id: string): Promise<{ success: boolean }> {
  return del(`/works/${id}`);
}

export function apiToggleWorkLike(id: string): Promise<{ liked: boolean; likesCount: number }> {
  return post(`/works/${id}/like`, {});
}

export function apiRateWork(id: string, payload: { score: number; comment?: string }): Promise<WorkSummary> {
  return post(`/works/${id}/rate`, payload);
}

export function apiGetCollections(): Promise<{
  total: number;
  collections: CollectionSummary[];
}> {
  return get('/collections');
}

export function apiGetCollection(id: string): Promise<CollectionSummary> {
  return get(`/collections/${id}`);
}

export function apiToggleCollectionLike(id: string): Promise<{ liked: boolean; likesCount: number }> {
  return post(`/collections/${id}/like`, {});
}

export function apiRateCollection(
  id: string,
  payload: { score: number; comment?: string },
): Promise<CollectionSummary> {
  return post(`/collections/${id}/rate`, payload);
}

export function apiGetExhibition(id: string): Promise<ExhibitionSummary> {
  return get(`/exhibitions/${id}`);
}

export function apiCreateCollection(payload: {
  title: string;
  description?: string;
  coverUrl?: string;
  workIds?: string[];
  isPublic?: boolean;
}): Promise<CollectionSummary> {
  return post('/collections', payload);
}

export function apiUpdateCollection(
  id: string,
  payload: {
    title?: string;
    description?: string;
    coverUrl?: string;
    isPublic?: boolean;
    workIds?: string[];
    appendWorkIds?: string[];
    removeWorkIds?: string[];
  },
): Promise<CollectionSummary> {
  return patch(`/collections/${id}`, payload);
}

export function apiDeleteCollection(id: string): Promise<{ success: boolean }> {
  return del(`/collections/${id}`);
}

export function apiUpdateWork(
  id: string,
  payload: Partial<{
    title: string;
    description: string;
    thumbnailUrl: string;
    fileUrl: string;
    tags: string[];
    collectionIds: string[];
    appendCollectionIds: string[];
    removeCollectionIds: string[];
  }>,
): Promise<WorkSummary> {
  return patch(`/works/${id}`, payload);
}

export function apiGetWorkRecords(): Promise<{
  total: number;
  records: WorkRecordSummary[];
}> {
  return get('/works/records');
}

export function apiDeleteWorkRecord(id: string): Promise<{ success: boolean }> {
  return del(`/works/records/${id}`);
}

export function apiClearWorkRecords(): Promise<{ success: boolean }> {
  return del('/works/records');
}

export function apiGetExhibitions(params?: { owner?: string; scope?: 'all' | 'mine' }): Promise<{
  total: number;
  exhibitions: ExhibitionSummary[];
}> {
  const query = params
    ? `?${Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== '')
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
        .join('&')}`
    : '';
  return get(`/exhibitions${query}`);
}

export function apiCreateExhibition(payload: {
  name: string;
  description?: string;
  coverUrl?: string;
  coverUrls?: string[];
  startDate?: string;
  endDate?: string;
  workIds?: string[];
  collectionIds?: string[];
  status?: 'draft' | 'published' | 'withdrawn';
}): Promise<ExhibitionSummary> {
  return post('/exhibitions', payload);
}

export function apiUpdateExhibition(
  id: string,
  payload: Partial<{
    name: string;
    description: string;
    coverUrl: string;
    coverUrls: string[];
    startDate: string;
    endDate: string;
    workIds: string[];
    collectionIds: string[];
    status: 'draft' | 'published' | 'withdrawn';
  }>,
): Promise<ExhibitionSummary> {
  return patch(`/exhibitions/${id}`, payload);
}

export function apiDeleteExhibition(id: string): Promise<{ success: boolean }> {
  return del(`/exhibitions/${id}`);
}

export function apiWithdrawExhibition(id: string): Promise<ExhibitionSummary> {
  return post(`/exhibitions/${id}/withdraw`, {});
}

export function apiToggleExhibitionLike(id: string): Promise<{ liked: boolean; likesCount: number }> {
  return post(`/exhibitions/${id}/like`, {});
}

export function apiRateExhibition(id: string, payload: { score: number; comment?: string }): Promise<ExhibitionSummary> {
  return post(`/exhibitions/${id}/rate`, payload);
}

export function apiVisitExhibition(id: string): Promise<{ visitedAt: string; visitCount: number }> {
  return post(`/exhibitions/${id}/visit`, {});
}

export function apiShareExhibition(id: string): Promise<{ shareCount: number }> {
  return post(`/exhibitions/${id}/share`, {});
}

export function apiShareWork(id: string): Promise<{ shareCount: number }> {
  return post(`/works/${id}/share`, {});
}

export function apiGetProducts(params?: { category?: string }): Promise<{
  total: number;
  products: ProductSummary[];
}> {
  const query = params?.category ? `?category=${encodeURIComponent(params.category)}` : '';
  return get(`/products${query}`);
}

export function apiGetProduct(id: string): Promise<ProductSummary> {
  return get(`/products/${id}`);
}

export function apiPurchaseProduct(
  id: string,
  payload: {
    paymentMethod?: string;
    shippingAddress?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<{ order: OrderSummary; product: ProductSummary }> {
  return post(`/products/${id}/purchase`, payload);
}

export function apiGetOrders(params?: { status?: string }): Promise<{
  total: number;
  orders: OrderSummary[];
}> {
  const query = params?.status ? `?status=${encodeURIComponent(params.status)}` : '';
  return get(`/orders${query}`);
}

export function apiGetOrder(id: string): Promise<OrderSummary> {
  return get(`/orders/${id}`);
}

export interface ResourceCategory {
  id: string;
  name: string;
  type: 'model' | 'image' | 'texture' | 'file';
  description?: string | null;
}

export interface ManagedAsset {
  id: string;
  name: string;
  categoryId: string;
  type: 'model' | 'image' | 'texture' | 'file';
  size: number;
  url: string;
  previewUrl?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UploadAssetResponse {
  asset: ManagedAsset;
}

export interface UploadAssetOptions {
  filePath: string;
  categoryId: string;
  fileName?: string;
  type?: 'model' | 'image' | 'texture' | 'file';
}

export function apiListResourceCategories(): Promise<ResourceCategory[]> {
  const origin = getApiOrigin();
  return get<ResourceCategory[]>(`${origin}/api/resources/categories`);
}

export function apiUploadAsset(options: UploadAssetOptions): Promise<ManagedAsset> {
  const { filePath, categoryId, fileName, type = 'file' } = options;
  const origin = getApiOrigin();
  const token = getAuthToken();
  const formData: Record<string, string> = {
    categoryId,
    type,
  };
  if (fileName) {
    formData.name = fileName;
  }
  return new Promise<ManagedAsset>((resolve, reject) => {
    const header: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    uni.uploadFile({
      url: `${origin}/api/resources/assets`,
      filePath,
      name: 'file',
      formData,
      header,
      success: (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          try {
            const payload = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
            const message = (payload as Record<string, any>)?.message ?? `上传失败(${status})`;
            reject(new Error(message));
          } catch {
            reject(new Error(`上传失败(${status})`));
          }
          return;
        }
        try {
          const payload = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          const data = payload as UploadAssetResponse;
          if (data?.asset) {
            resolve(data.asset);
          } else {
            reject(new Error('上传响应解析失败'));
          }
        } catch (error) {
          reject(error instanceof Error ? error : new Error('上传响应解析失败'));
        }
      },
      fail: (err) => {
        reject(new Error(err.errMsg || '文件上传失败'));
      },
    });
  });
}
