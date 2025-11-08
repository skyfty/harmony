import { defineStore } from 'pinia';

import {
	apiGetProfile,
	apiUpdateProfile,
	apiGetWorks,
	apiCreateWorks,
	apiDeleteWork,
	apiUpdateWork,
	apiToggleWorkLike,
	apiRateWork,
	apiGetCollections,
	apiCreateCollection,
	apiUpdateCollection,
	apiDeleteCollection,
	apiGetWorkRecords,
	apiDeleteWorkRecord,
	apiClearWorkRecords,
	apiGetExhibitions,
	apiWithdrawExhibition,
	apiVisitExhibition,
	apiToggleExhibitionLike,
	apiRateExhibition,
	apiShareExhibition,
	apiGetProducts,
	apiPurchaseProduct,
	apiGetOrders,
	apiGetOrder,
} from '@/api/miniprogram';
import type {
	AuthSession,
	WorkSummary,
	CollectionSummary,
	WorkRecordSummary,
	ExhibitionSummary,
	ProductSummary,
	OrderSummary,
} from '@/api/miniprogram';

export type WorkType = 'image' | 'video' | 'model' | 'other';

export interface PendingWorkUpload {
	id: string;
	name: string;
	filePath: string;
	size?: number;
	mimeType?: string;
	type: WorkType;
	description?: string;
}

export interface WorkItem {
	id: string;
	ownerId: string;
	name: string;
	size: string;
	time: string;
	rating: number;
	ratingCount: number;
	likes: number;
	liked: boolean;
	gradient: string;
	type: WorkType;
	collections: string[];
	description?: string;
	duration?: string;
	fileUrl: string;
	thumbnailUrl?: string;
	userRatingScore?: number;
}

export interface CollectionItem {
	id: string;
	ownerId: string;
	title: string;
	description: string;
	cover: string;
	isPublic: boolean;
	works: string[];
	createdAt: string;
	updatedAt: string;
}

export interface WorkRecordItem {
	id: string;
	workId: string;
	name: string;
	fileUrl: string;
	mediaType: string;
	fileSize?: number;
	sizeLabel: string;
	uploadedAt: string;
	timeLabel: string;
	gradient: string;
}

export interface ExhibitionItem {
	id: string;
	ownerId: string;
	name: string;
	status: 'draft' | 'published' | 'withdrawn';
	cover: string;
	primaryCover?: string;
	coverImages: string[];
	dateRange: string;
	workIds: string[];
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
	rating: number;
	ratingCount: number;
	userRatingScore?: number;
	visitCount: number;
	visited: boolean;
	shareCount: number;
	description?: string;
	createdAt: string;
	updatedAt: string;
}

export interface ProductItem {
	id: string;
	slug: string;
	name: string;
	category: string;
	price: number;
	image: string;
	description?: string;
	purchased: boolean;
	purchasedAt?: string;
}

export type OrderStatus = 'pending' | 'paid' | 'completed' | 'cancelled';

export interface OrderItem {
	id: string;
	orderNumber: string;
	status: OrderStatus;
	totalAmount: number;
	paymentMethod?: string;
	shippingAddress?: string;
	createdAt: string;
	updatedAt: string;
	items: OrderSummary['items'];
	summary: string;
	gradient: string;
}

export interface NewWorkInput {
	name: string;
	fileUrl: string;
	thumbnailUrl?: string;
	description?: string;
	tags?: string[];
	size?: number | string;
	type: WorkType;
	fileName?: string;
}

export interface PurchasePayload {
	paymentMethod?: string;
	shippingAddress?: string;
	metadata?: Record<string, unknown>;
}

const gradientPalette = [
	'linear-gradient(135deg, #ffe0f2, #ffd0ec)',
	'linear-gradient(135deg, #dff5ff, #c6ebff)',
	'linear-gradient(135deg, #fff0ce, #ffe2a8)',
	'linear-gradient(135deg, #e7e4ff, #f1eeff)',
	'linear-gradient(135deg, #ffd6ec, #ffeaf5)',
	'linear-gradient(135deg, #c1d8ff, #a0c5ff)',
	'linear-gradient(135deg, #b7f5ec, #90e0d9)',
	'linear-gradient(135deg, #ffd59e, #ffe8c9)',
];

function pickGradient(index: number): string {
	const normalized = Number.isFinite(index)
		? index
		: Math.floor(Math.random() * gradientPalette.length);
	return gradientPalette[((normalized % gradientPalette.length) + gradientPalette.length) % gradientPalette.length];
}

function formatSize(value?: number | string): string {
	if (typeof value === 'string' && value.trim()) {
		return value;
	}
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
		const mb = value / (1024 * 1024);
		return `${mb.toFixed(mb >= 100 ? 0 : 1)}MB`;
	}
	return '未记录';
}

function formatRelativeTime(iso?: string): string {
	if (!iso) {
		return '刚刚';
	}
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return '刚刚';
	}
	const diff = Date.now() - date.getTime();
	if (diff < 60 * 1000) {
		return '刚刚';
	}
	if (diff < 60 * 60 * 1000) {
		const minutes = Math.floor(diff / 60000);
		return `${minutes} 分钟前`;
	}
	if (diff < 24 * 60 * 60 * 1000) {
		const hours = Math.floor(diff / 3600000);
		return `${hours} 小时前`;
	}
	const days = Math.floor(diff / (24 * 60 * 60 * 1000));
	if (days < 7) {
		return `${days} 天前`;
	}
	const month = `${date.getMonth() + 1}`.padStart(2, '0');
	const day = `${date.getDate()}`.padStart(2, '0');
	return `${month}-${day}`;
}

function formatDate(value?: string): string {
	if (!value) {
		return '';
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	const year = date.getFullYear();
	const month = `${date.getMonth() + 1}`.padStart(2, '0');
	const day = `${date.getDate()}`.padStart(2, '0');
	return `${year}.${month}.${day}`;
}

function formatDateRange(start?: string, end?: string): string {
	if (start && end) {
		return `${formatDate(start)} - ${formatDate(end)}`;
	}
	if (start || end) {
		return formatDate(start || end);
	}
	return '';
}

function formatOrderSummary(order: OrderSummary): string {
	if (!Array.isArray(order.items) || !order.items.length) {
		return '暂无商品信息';
	}
	if (order.items.length === 1) {
		const item = order.items[0];
		return `${item.name} · ¥${item.price.toFixed(2)}`;
	}
	const first = order.items[0];
	return `${first.name} 等 ${order.items.length} 件`;
}

function ensureBackground(url: string | undefined, index: number): string {
	if (url && url.startsWith('http')) {
		return `url(${url})`;
	}
	return pickGradient(index);
}

function mapWorkSummary(summary: WorkSummary, index: number): WorkItem {
	const metadata = (summary as unknown as { metadata?: { duration?: unknown } }).metadata;
	return {
		id: summary.id,
		ownerId: summary.ownerId,
		name: summary.title,
		size: formatSize(summary.size),
		time: formatRelativeTime(summary.updatedAt || summary.createdAt),
		rating: Number(summary.averageRating ?? 0),
		ratingCount: summary.ratingCount ?? 0,
		likes: summary.likesCount ?? 0,
		liked: Boolean(summary.liked),
		gradient: ensureBackground(summary.thumbnailUrl, index),
		type: (summary.mediaType ?? 'image') as WorkType,
		collections: Array.isArray(summary.collections) ? summary.collections.map((item) => item.id) : [],
		description: summary.description ?? '',
		duration:
			metadata && typeof metadata === 'object' && 'duration' in metadata
				? String(metadata.duration)
				: '--',
		fileUrl: summary.fileUrl,
		thumbnailUrl: summary.thumbnailUrl,
		userRatingScore: summary.userRating?.score ?? 0,
	};
}

function mapCollectionSummary(summary: CollectionSummary, index: number): CollectionItem {
	return {
		id: summary.id,
		ownerId: summary.ownerId,
		title: summary.title,
		description: summary.description ?? '',
		cover: ensureBackground(summary.coverUrl, index),
		isPublic: Boolean(summary.isPublic),
		works: Array.isArray(summary.works) ? summary.works.map((item) => item.id) : [],
		createdAt: summary.createdAt,
		updatedAt: summary.updatedAt,
	};
}

function mapWorkRecordSummary(summary: WorkRecordSummary, index: number): WorkRecordItem {
	return {
		id: summary.id,
		workId: summary.workId,
		name: summary.fileName,
		fileUrl: summary.fileUrl,
		mediaType: summary.mediaType,
		fileSize: summary.fileSize,
		sizeLabel: formatSize(summary.fileSize),
		uploadedAt: summary.uploadedAt,
		timeLabel: formatRelativeTime(summary.uploadedAt),
		gradient: ensureBackground(summary.work?.thumbnailUrl, index),
	};
}

function mapExhibitionSummary(summary: ExhibitionSummary, index: number): ExhibitionItem {
	const coverImages = Array.isArray(summary.coverUrls) && summary.coverUrls.length
		? summary.coverUrls.filter((url): url is string => typeof url === 'string' && url.length > 0)
		: summary.coverUrl
			? [summary.coverUrl]
			: []
	const primaryCover = coverImages[0]
	const collections = Array.isArray(summary.collections)
		? summary.collections.map((item) => ({
				id: item.id,
				title: item.title,
				description: item.description ?? '',
				coverUrl: item.coverUrl,
				workCount: item.workCount ?? 0,
			}))
		: []
	const collectionIds = Array.isArray(summary.collectionIds) ? summary.collectionIds : collections.map((item) => item.id)
	return {
		id: summary.id,
		ownerId: summary.ownerId,
		name: summary.name,
		status: summary.status,
		cover: ensureBackground(primaryCover, index),
		primaryCover,
		coverImages,
		dateRange: formatDateRange(summary.startDate, summary.endDate),
		workIds: Array.isArray(summary.works) ? summary.works.map((item) => item.id) : [],
		workCount: Array.isArray(summary.works) ? summary.works.length : summary.workCount ?? 0,
		collections,
		collectionIds,
		likesCount: summary.likesCount ?? 0,
		liked: Boolean(summary.liked),
		rating: Number(summary.averageRating ?? 0),
		ratingCount: summary.ratingCount ?? 0,
		userRatingScore: summary.userRating?.score ?? 0,
		visitCount: summary.visitCount ?? 0,
		visited: Boolean(summary.visited),
		shareCount: summary.shareCount ?? 0,
		description: summary.description ?? '',
		createdAt: summary.createdAt,
		updatedAt: summary.updatedAt,
	};
}

function mapProductSummary(summary: ProductSummary, index: number): ProductItem {
	return {
		id: summary.id,
		slug: summary.slug,
		name: summary.name,
		category: summary.category,
		price: summary.price,
		image: ensureBackground(summary.imageUrl, index),
		description: summary.description ?? '',
		purchased: Boolean(summary.purchased),
		purchasedAt: summary.purchasedAt,
	};
}

function mapOrderSummary(summary: OrderSummary, index: number): OrderItem {
	return {
		id: summary.id,
		orderNumber: summary.orderNumber,
		status: summary.status,
		totalAmount: summary.totalAmount,
		paymentMethod: summary.paymentMethod,
		shippingAddress: summary.shippingAddress,
		createdAt: summary.createdAt,
		updatedAt: summary.updatedAt,
		items: summary.items,
		summary: formatOrderSummary(summary),
		gradient: ensureBackground(summary.items?.[0]?.product?.imageUrl, index),
	};
}

export const useWorksStore = defineStore('worksStore', {
	state: () => ({
		profile: null as AuthSession | null,
		works: [] as WorkItem[],
		collections: [] as CollectionItem[],
		workRecords: [] as WorkRecordItem[],
		exhibitions: [] as ExhibitionItem[],
		products: [] as ProductItem[],
		orders: [] as OrderItem[],
		pendingUploads: [] as PendingWorkUpload[],
		loadingProfile: false,
		profileLoaded: false,
		loadingWorks: false,
		worksLoaded: false,
		loadingCollections: false,
		collectionsLoaded: false,
		loadingWorkRecords: false,
		workRecordsLoaded: false,
		loadingExhibitions: false,
		exhibitionsLoaded: false,
		loadingProducts: false,
		productsLoaded: false,
		loadingOrders: false,
		ordersLoaded: false,
	}),
	getters: {
		workMap: (state) =>
			state.works.reduce<Record<string, WorkItem>>((acc, item) => {
				acc[item.id] = item;
				return acc;
			}, {}),
		collectionMap: (state) =>
			state.collections.reduce<Record<string, CollectionItem>>((acc, item) => {
				acc[item.id] = item;
				return acc;
			}, {}),
		exhibitionMap: (state) =>
			state.exhibitions.reduce<Record<string, ExhibitionItem>>((acc, item) => {
				acc[item.id] = item;
				return acc;
			}, {}),
		productMap: (state) =>
			state.products.reduce<Record<string, ProductItem>>((acc, item) => {
				acc[item.id] = item;
				return acc;
			}, {}),
		orderMap: (state) =>
			state.orders.reduce<Record<string, OrderItem>>((acc, item) => {
				acc[item.id] = item;
				return acc;
			}, {}),
		worksByCollection: (state) => (collectionId?: string) => {
			if (!collectionId || collectionId === 'all') {
				return state.works;
			}
			return state.works.filter((work) => work.collections.includes(collectionId));
		},
	},
	actions: {
		setPendingUploads(uploads: PendingWorkUpload[]) {
			this.pendingUploads = [...uploads];
		},
		clearPendingUploads() {
			this.pendingUploads = [];
		},
		removePendingUpload(id: string) {
			this.pendingUploads = this.pendingUploads.filter((item) => item.id !== id);
		},
		updatePendingUpload(id: string, patch: Partial<PendingWorkUpload>) {
			this.pendingUploads = this.pendingUploads.map((item) =>
				item.id === id ? { ...item, ...patch } : item,
			);
		},
		async ensureProfile(force = false) {
			if (this.loadingProfile) {
				return;
			}
			if (this.profileLoaded && !force) {
				return;
			}
			this.loadingProfile = true;
			try {
				this.profile = await apiGetProfile();
				this.profileLoaded = true;
			} catch (error) {
				console.error('Failed to load profile', error);
			} finally {
				this.loadingProfile = false;
			}
		},
		async updateProfile(payload: Parameters<typeof apiUpdateProfile>[0]) {
			try {
				this.profile = await apiUpdateProfile(payload);
				this.profileLoaded = true;
			} catch (error) {
				console.error('Failed to update profile', error);
				throw error;
			}
		},
		async ensureWorks(force = false) {
			if (this.loadingWorks) {
				return;
			}
			if (this.worksLoaded && !force) {
				return;
			}
			this.loadingWorks = true;
			try {
				const response = await apiGetWorks();
				this.works = response.works.map((item, index) => mapWorkSummary(item, index));
				this.worksLoaded = true;
			} catch (error) {
				console.error('Failed to load works', error);
			} finally {
				this.loadingWorks = false;
			}
		},
		async addWorks(inputs: NewWorkInput[]): Promise<string[]> {
			if (!inputs.length) {
				return [];
			}
			const payload = inputs.map((item) => ({
				title: item.name,
				fileUrl: item.fileUrl,
				description: item.description ?? '',
				mediaType: item.type,
				thumbnailUrl: item.thumbnailUrl ?? item.fileUrl,
				size: typeof item.size === 'number' ? item.size : undefined,
				tags: item.tags ?? [],
				fileName: item.fileName ?? item.name,
			}));
			try {
				const response = await apiCreateWorks(payload);
				const mapped = response.works.map((item, index) => mapWorkSummary(item, index));
				this.works = [...mapped, ...this.works];
				this.worksLoaded = true;
				await this.ensureWorkRecords(true);
				return mapped.map((work) => work.id);
			} catch (error) {
				console.error('Failed to create works', error);
				throw error;
			}
		},
		async deleteWork(id: string) {
			try {
				await apiDeleteWork(id);
				this.works = this.works.filter((work) => work.id !== id);
				this.collections = this.collections.map((collection) => ({
					...collection,
					works: collection.works.filter((workId) => workId !== id),
				}));
				this.workRecords = this.workRecords.filter((record) => record.workId !== id);
			} catch (error) {
				console.error('Failed to delete work', error);
				throw error;
			}
		},
		async updateWorkMetadata(id: string, payload: { title?: string; description?: string }) {
			if (!payload.title && payload.description === undefined) {
				return;
			}
			try {
				const updated = await apiUpdateWork(id, {
					title: payload.title,
					description: payload.description,
				});
				this.works = this.works.map((work, index) => {
					if (work.id !== id) {
						return work;
					}
					const mapped = mapWorkSummary(updated, index);
					return { ...mapped, gradient: work.gradient };
				});
			} catch (error) {
				console.error('Failed to update work metadata', error);
				throw error;
			}
		},
		async toggleWorkLike(id: string) {
			try {
				const result = await apiToggleWorkLike(id);
				this.works = this.works.map((work) => {
					if (work.id !== id) {
						return work;
					}
					return {
						...work,
						liked: result.liked,
						likes: result.likesCount,
					};
				});
			} catch (error) {
				console.error('Failed to toggle work like', error);
				throw error;
			}
		},
		async rateWork(id: string, score: number, comment?: string) {
			try {
				const updated = await apiRateWork(id, { score, comment });
				this.works = this.works.map((work, index) =>
					work.id === id ? mapWorkSummary(updated, index) : work,
				);
			} catch (error) {
				console.error('Failed to rate work', error);
				throw error;
			}
		},
		async ensureCollections(force = false) {
			if (this.loadingCollections) {
				return;
			}
			if (this.collectionsLoaded && !force) {
				return;
			}
			this.loadingCollections = true;
			try {
				const response = await apiGetCollections();
				this.collections = response.collections.map((item, index) => mapCollectionSummary(item, index));
				this.collectionsLoaded = true;
			} catch (error) {
				console.error('Failed to load collections', error);
			} finally {
				this.loadingCollections = false;
			}
		},
		async createCollection(payload: {
			title: string;
			description?: string;
			coverUrl?: string;
			workIds?: string[];
			isPublic?: boolean;
		}): Promise<CollectionItem> {
			try {
				const created = await apiCreateCollection(payload);
				const mapped = mapCollectionSummary(created, this.collections.length);
				this.collections = [mapped, ...this.collections];
				this.collectionsLoaded = true;
				if (payload.workIds?.length) {
					const set = new Set(payload.workIds);
					this.works = this.works.map((work) =>
						set.has(work.id)
							? { ...work, collections: Array.from(new Set([...work.collections, mapped.id])) }
							: work,
					);
				}
				return mapped;
			} catch (error) {
				console.error('Failed to create collection', error);
				throw error;
			}
		},
		async updateCollection(id: string, payload: Parameters<typeof apiUpdateCollection>[1]) {
			try {
				const updated = await apiUpdateCollection(id, payload);
				const mapped = mapCollectionSummary(updated, this.collections.length);
				this.collections = this.collections.map((collection) =>
					collection.id === id ? mapped : collection,
				);
				if (payload.workIds) {
					const assigned = new Set(payload.workIds);
					this.works = this.works.map((work) => {
						const has = assigned.has(work.id);
						return {
							...work,
							collections: has
								? Array.from(new Set([...work.collections, id]))
								: work.collections.filter((collectionId) => collectionId !== id),
						};
					});
				}
			} catch (error) {
				console.error('Failed to update collection', error);
				throw error;
			}
		},
		async addWorksToCollection(workIds: string[], collectionId: string) {
			if (!workIds.length) {
				return;
			}
			try {
				const updated = await apiUpdateCollection(collectionId, { appendWorkIds: workIds });
				const mapped = mapCollectionSummary(updated, this.collections.length);
				this.collections = this.collections.map((collection) =>
					collection.id === collectionId ? mapped : collection,
				);
				const additions = new Set(workIds);
				this.works = this.works.map((work) =>
					additions.has(work.id)
						? { ...work, collections: Array.from(new Set([...work.collections, collectionId])) }
						: work,
				);
			} catch (error) {
				console.error('Failed to append works to collection', error);
				throw error;
			}
		},
		async removeWorkFromCollection(workId: string, collectionId: string) {
			try {
				const updated = await apiUpdateCollection(collectionId, { removeWorkIds: [workId] });
				const mapped = mapCollectionSummary(updated, this.collections.length);
				this.collections = this.collections.map((collection) =>
					collection.id === collectionId ? mapped : collection,
				);
				this.works = this.works.map((work) =>
					work.id === workId
						? { ...work, collections: work.collections.filter((cid) => cid !== collectionId) }
						: work,
				);
			} catch (error) {
				console.error('Failed to remove work from collection', error);
				throw error;
			}
		},
		async deleteCollection(id: string) {
			try {
				await apiDeleteCollection(id);
				this.collections = this.collections.filter((collection) => collection.id !== id);
				this.works = this.works.map((work) => ({
					...work,
					collections: work.collections.filter((collectionId) => collectionId !== id),
				}));
			} catch (error) {
				console.error('Failed to delete collection', error);
				throw error;
			}
		},
		async ensureWorkRecords(force = false) {
			if (this.loadingWorkRecords) {
				return;
			}
			if (this.workRecordsLoaded && !force) {
				return;
			}
			this.loadingWorkRecords = true;
			try {
				const response = await apiGetWorkRecords();
				this.workRecords = response.records.map((item, index) => mapWorkRecordSummary(item, index));
				this.workRecordsLoaded = true;
			} catch (error) {
				console.error('Failed to load work records', error);
			} finally {
				this.loadingWorkRecords = false;
			}
		},
		async deleteWorkRecord(id: string) {
			try {
				await apiDeleteWorkRecord(id);
				this.workRecords = this.workRecords.filter((record) => record.id !== id);
			} catch (error) {
				console.error('Failed to delete work record', error);
				throw error;
			}
		},
		async clearWorkRecords() {
			try {
				await apiClearWorkRecords();
				this.workRecords = [];
			} catch (error) {
				console.error('Failed to clear work records', error);
				throw error;
			}
		},
		async ensureExhibitions(force = false) {
			if (this.loadingExhibitions) {
				return;
			}
			if (this.exhibitionsLoaded && !force) {
				return;
			}
			this.loadingExhibitions = true;
			try {
				const response = await apiGetExhibitions({ scope: 'all' });
				this.exhibitions = response.exhibitions.map((item, index) => mapExhibitionSummary(item, index));
				this.exhibitionsLoaded = true;
			} catch (error) {
				console.error('Failed to load exhibitions', error);
			} finally {
				this.loadingExhibitions = false;
			}
		},
		async withdrawExhibition(id: string) {
			try {
				const updated = await apiWithdrawExhibition(id);
				const mapped = mapExhibitionSummary(updated, this.exhibitions.length);
				this.exhibitions = this.exhibitions.map((item) =>
					item.id === id ? mapped : item,
				);
			} catch (error) {
				console.error('Failed to withdraw exhibition', error);
				throw error;
			}
		},
		async toggleExhibitionLike(id: string) {
			try {
				const result = await apiToggleExhibitionLike(id);
				this.exhibitions = this.exhibitions.map((item) =>
					item.id === id
						? {
								...item,
								liked: result.liked,
								likesCount: result.likesCount,
							}
						: item,
				);
			} catch (error) {
				console.error('Failed to toggle exhibition like', error);
				throw error;
			}
		},
		async rateExhibition(id: string, score: number, comment?: string) {
			try {
				const updated = await apiRateExhibition(id, { score, comment });
				const mapped = mapExhibitionSummary(updated, this.exhibitions.length);
				this.exhibitions = this.exhibitions.map((item) =>
					item.id === id ? mapped : item,
				);
			} catch (error) {
				console.error('Failed to rate exhibition', error);
				throw error;
			}
		},
		async visitExhibition(id: string) {
			try {
				const result = await apiVisitExhibition(id);
				this.exhibitions = this.exhibitions.map((item) =>
					item.id === id
						? {
								...item,
								visitCount: result.visitCount,
								visited: true,
							}
						: item,
				);
			} catch (error) {
				console.error('Failed to record exhibition visit', error);
			}
		},
		async shareExhibition(id: string) {
			try {
				const result = await apiShareExhibition(id);
				this.exhibitions = this.exhibitions.map((item) =>
					item.id === id
						? {
								...item,
								shareCount: result.shareCount,
							}
						: item,
				);
			} catch (error) {
				console.error('Failed to share exhibition', error);
			}
		},
		async ensureProducts(force = false) {
			if (this.loadingProducts) {
				return;
			}
			if (this.productsLoaded && !force) {
				return;
			}
			this.loadingProducts = true;
			try {
				const response = await apiGetProducts();
				this.products = response.products.map((item, index) => mapProductSummary(item, index));
				this.productsLoaded = true;
			} catch (error) {
				console.error('Failed to load products', error);
			} finally {
				this.loadingProducts = false;
			}
		},
		async purchaseProduct(id: string, payload: PurchasePayload) {
			try {
				const result = await apiPurchaseProduct(id, payload);
				const updatedProduct = mapProductSummary(result.product, this.products.length);
				this.products = this.products.map((item) =>
					item.id === id ? updatedProduct : item,
				);
				const mappedOrder = mapOrderSummary(result.order, this.orders.length);
				this.orders = [mappedOrder, ...this.orders];
				this.ordersLoaded = true;
				return mappedOrder.id;
			} catch (error) {
				console.error('Failed to purchase product', error);
				throw error;
			}
		},
		async ensureOrders(force = false) {
			if (this.loadingOrders) {
				return;
			}
			if (this.ordersLoaded && !force) {
				return;
			}
			this.loadingOrders = true;
			try {
				const response = await apiGetOrders();
				this.orders = response.orders.map((item, index) => mapOrderSummary(item, index));
				this.ordersLoaded = true;
			} catch (error) {
				console.error('Failed to load orders', error);
			} finally {
				this.loadingOrders = false;
			}
		},
		async refreshOrder(id: string) {
			try {
				const detail = await apiGetOrder(id);
				const mapped = mapOrderSummary(detail, this.orders.length);
				const exists = this.orders.some((order) => order.id === id);
				this.orders = exists
					? this.orders.map((order) => (order.id === id ? mapped : order))
					: [mapped, ...this.orders];
				this.ordersLoaded = true;
				return mapped;
			} catch (error) {
				console.error('Failed to refresh order', error);
				throw error;
			}
		},
	},
});

