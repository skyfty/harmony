export const TerrainScatterCategories = ['flora', 'rocks', 'trees', 'water', 'ground']

export const TERRAIN_SCATTER_STORE_VERSION = 1

const CATEGORY_SET = new Set(TerrainScatterCategories)
const DEFAULT_LAYER_PARAMS = Object.freeze({
	alignToNormal: true,
	randomYaw: true,
	minSlope: 0,
	maxSlope: 35,
	minHeight: -200,
	maxHeight: 400,
	minScale: 1,
	maxScale: 1,
	density: 1,
	seed: null,
	jitter: Object.freeze({
		position: 0.25,
		rotation: 180,
		scale: 0.1,
	}),
	payload: null,
})
const ZERO_VECTOR = Object.freeze({ x: 0, y: 0, z: 0 })
const UNIT_VECTOR = Object.freeze({ x: 1, y: 1, z: 1 })

const terrainScatterStores = new Map()

const now = () => Date.now()

export function createTerrainScatterStore(groundNodeId, snapshot = null) {
	if (typeof groundNodeId !== 'string' || !groundNodeId.trim()) {
		throw new Error('groundNodeId is required')
	}
	if (snapshot) {
		const hydrated = deserializeTerrainScatterStore(snapshot, { groundNodeId })
		registerTerrainScatterStore(hydrated)
		return hydrated
	}
	const createdAt = now()
	const store = {
		version: TERRAIN_SCATTER_STORE_VERSION,
		groundNodeId,
		metadata: {
			createdAt,
			updatedAt: createdAt,
			version: TERRAIN_SCATTER_STORE_VERSION,
		},
		layers: new Map(),
	}
	return registerTerrainScatterStore(store)
}

export function registerTerrainScatterStore(store) {
	if (!store || typeof store.groundNodeId !== 'string') {
		throw new Error('Invalid terrain scatter store')
	}
	terrainScatterStores.set(store.groundNodeId, store)
	return store
}

export function getTerrainScatterStore(groundNodeId) {
	return terrainScatterStores.get(groundNodeId) ?? null
}

export function ensureTerrainScatterStore(groundNodeId) {
	return getTerrainScatterStore(groundNodeId) ?? createTerrainScatterStore(groundNodeId)
}

export function listTerrainScatterStores() {
	return Array.from(terrainScatterStores.values())
}

export function deleteTerrainScatterStore(groundNodeId) {
	return terrainScatterStores.delete(groundNodeId)
}

export function clearTerrainScatterStores() {
	terrainScatterStores.clear()
}

export function upsertTerrainScatterLayer(store, payload = {}) {
	if (!store) {
		throw new Error('store is required')
	}
	const targetId = typeof payload.id === 'string' && payload.id.trim() ? payload.id : null
	const existing = targetId ? store.layers.get(targetId) : null
	const layer = normalizeLayer(payload, existing)
	store.layers.set(layer.id, layer)
	touchLayer(layer)
	touchStore(store)
	return layer
}

export function getTerrainScatterLayer(store, layerId) {
	if (!store || typeof layerId !== 'string') {
		return null
	}
	return store.layers.get(layerId) ?? null
}

export function removeTerrainScatterLayer(store, layerId) {
	if (!store) {
		throw new Error('store is required')
	}
	if (!layerId) {
		return false
	}
	const removed = store.layers.delete(layerId)
	if (removed) {
		touchStore(store)
	}
	return removed
}

export function replaceTerrainScatterInstances(store, layerId, instances) {
	if (!store) {
		throw new Error('store is required')
	}
	const layer = store.layers.get(layerId)
	if (!layer) {
		return null
	}
	const nextInstances = Array.isArray(instances) ? instances : []
	layer.instances = nextInstances.map((entry) => normalizeInstance({ ...entry, layerId: layer.id }))
	touchLayer(layer)
	touchStore(store)
	return layer
}

export function serializeTerrainScatterStore(store) {
	if (!store) {
		throw new Error('store is required')
	}
	return {
		version: store.version ?? TERRAIN_SCATTER_STORE_VERSION,
		groundNodeId: store.groundNodeId,
		metadata: {
			createdAt: store.metadata?.createdAt ?? now(),
			updatedAt: store.metadata?.updatedAt ?? now(),
			version: store.metadata?.version ?? store.version ?? TERRAIN_SCATTER_STORE_VERSION,
		},
		layers: Array.from(store.layers.values()).map(toSerializableLayer),
	}
}

export function deserializeTerrainScatterStore(snapshot, overrides = {}) {
	if (!snapshot || typeof snapshot !== 'object') {
		throw new Error('snapshot is required')
	}
	const groundNodeId = typeof overrides.groundNodeId === 'string' ? overrides.groundNodeId : snapshot.groundNodeId
	if (typeof groundNodeId !== 'string' || !groundNodeId.trim()) {
		throw new Error('snapshot groundNodeId is required')
	}
	const version = Number.isFinite(snapshot.version) ? Number(snapshot.version) : TERRAIN_SCATTER_STORE_VERSION
	const createdAt = Number.isFinite(snapshot.metadata?.createdAt) ? Number(snapshot.metadata.createdAt) : now()
	const updatedAt = Number.isFinite(snapshot.metadata?.updatedAt) ? Number(snapshot.metadata.updatedAt) : createdAt
	const store = {
		version,
		groundNodeId,
		metadata: {
			createdAt,
			updatedAt,
			version: Number.isFinite(snapshot.metadata?.version)
				? Number(snapshot.metadata.version)
				: version,
		},
		layers: new Map(),
	}
	const layers = Array.isArray(snapshot.layers) ? snapshot.layers : []
	layers.forEach((layerSnapshot) => {
		const layer = normalizeLayer(layerSnapshot)
		store.layers.set(layer.id, layer)
	})
	return store
}

export function loadTerrainScatterSnapshot(groundNodeId, snapshot) {
	const store = deserializeTerrainScatterStore(snapshot, { groundNodeId })
	registerTerrainScatterStore(store)
	return store
}

export function saveTerrainScatterSnapshot(groundNodeId) {
	const store = getTerrainScatterStore(groundNodeId)
	if (!store) {
		return null
	}
	return serializeTerrainScatterStore(store)
}

function toSerializableLayer(layer) {
	return {
		id: layer.id,
		label: layer.label,
		category: layer.category,
		assetId: layer.assetId,
		profileId: layer.profileId,
		params: cloneLayerParams(layer.params),
		metadata: { ...layer.metadata },
		instances: layer.instances.map(toSerializableInstance),
	}
}

function toSerializableInstance(instance) {
	return {
		id: instance.id,
		assetId: instance.assetId,
		layerId: instance.layerId,
		profileId: instance.profileId,
		seed: instance.seed,
		localPosition: cloneVector3(instance.localPosition, ZERO_VECTOR),
		localRotation: cloneVector3(instance.localRotation, ZERO_VECTOR),
		localScale: cloneVector3(instance.localScale, UNIT_VECTOR),
		groundCoords: cloneGroundCoords(instance.groundCoords),
		binding: instance.binding
			? {
				nodeId: instance.binding.nodeId,
				slots: instance.binding.slots.map((slot) => ({ handleId: slot.handleId, instanceIndex: slot.instanceIndex })),
			}
			: null,
		metadata: instance.metadata ? { ...instance.metadata } : null,
	}
}

function cloneLayerParams(params = DEFAULT_LAYER_PARAMS) {
	return {
		alignToNormal: typeof params.alignToNormal === 'boolean' ? params.alignToNormal : DEFAULT_LAYER_PARAMS.alignToNormal,
		randomYaw: typeof params.randomYaw === 'boolean' ? params.randomYaw : DEFAULT_LAYER_PARAMS.randomYaw,
		minSlope: toFiniteNumber(params.minSlope, DEFAULT_LAYER_PARAMS.minSlope),
		maxSlope: toFiniteNumber(params.maxSlope, DEFAULT_LAYER_PARAMS.maxSlope),
		minHeight: toFiniteNumber(params.minHeight, DEFAULT_LAYER_PARAMS.minHeight),
		maxHeight: toFiniteNumber(params.maxHeight, DEFAULT_LAYER_PARAMS.maxHeight),
		minScale: toFiniteNumber(params.minScale, DEFAULT_LAYER_PARAMS.minScale),
		maxScale: toFiniteNumber(params.maxScale, DEFAULT_LAYER_PARAMS.maxScale),
		density: toFiniteNumber(params.density, DEFAULT_LAYER_PARAMS.density),
		seed: params.seed == null ? null : toFiniteNumber(params.seed, DEFAULT_LAYER_PARAMS.seed),
		payload: params.payload && typeof params.payload === 'object' ? { ...params.payload } : null,
		jitter: {
			position: toFiniteNumber(params.jitter?.position, DEFAULT_LAYER_PARAMS.jitter.position),
			rotation: toFiniteNumber(params.jitter?.rotation, DEFAULT_LAYER_PARAMS.jitter.rotation),
			scale: toFiniteNumber(params.jitter?.scale, DEFAULT_LAYER_PARAMS.jitter.scale),
		},
	}
}

function normalizeLayer(payload = {}, target) {
	const layer = target ?? {
		id: createScatterId('layer'),
		label: 'Scatter Layer',
		category: 'ground',
		assetId: null,
		profileId: null,
		params: cloneLayerParams(DEFAULT_LAYER_PARAMS),
		instances: [],
		metadata: {
			createdAt: now(),
			updatedAt: now(),
			authorId: null,
		},
	}

	if (typeof payload.id === 'string' && payload.id.trim()) {
		layer.id = payload.id
	}
	if (typeof payload.label === 'string' && payload.label.trim()) {
		layer.label = payload.label
	}
	if (typeof payload.category === 'string') {
		layer.category = selectCategory(payload.category)
	}
	if ('assetId' in payload) {
		layer.assetId = typeof payload.assetId === 'string' && payload.assetId.trim() ? payload.assetId : null
	}
	if ('profileId' in payload || 'assetId' in payload || !target) {
		const profileSource =
			typeof payload.profileId === 'string' && payload.profileId.trim()
				? payload.profileId
				: typeof layer.assetId === 'string' && layer.assetId.trim() && !('profileId' in payload)
					? layer.assetId
					: layer.profileId
		layer.profileId = profileSource ?? null
	}
	layer.params = mergeLayerParams(payload.params, layer.params)

	if (Array.isArray(payload.instances)) {
		layer.instances = payload.instances.map((entry) => normalizeInstance({ ...entry, layerId: layer.id }))
	} else if (!target) {
		layer.instances = []
	}

	layer.metadata = {
		createdAt: toFiniteNumber(payload.metadata?.createdAt, layer.metadata.createdAt ?? now()),
		updatedAt: toFiniteNumber(payload.metadata?.updatedAt, now()),
		authorId: resolveAuthorId(payload.metadata?.authorId, layer.metadata.authorId ?? null),
	}

	return layer
}

function normalizeInstance(payload = {}) {
	return {
		id: typeof payload.id === 'string' && payload.id.trim() ? payload.id : createScatterId('instance'),
		assetId: typeof payload.assetId === 'string' && payload.assetId.trim() ? payload.assetId : null,
		layerId: typeof payload.layerId === 'string' && payload.layerId.trim() ? payload.layerId : null,
		profileId: typeof payload.profileId === 'string' && payload.profileId.trim() ? payload.profileId : null,
		seed: payload.seed == null ? null : toFiniteNumber(payload.seed, null),
		localPosition: normalizeVector3(payload.localPosition ?? payload.position, ZERO_VECTOR),
		localRotation: normalizeVector3(payload.localRotation ?? payload.rotation, ZERO_VECTOR),
		localScale: normalizeVector3(payload.localScale ?? payload.scale, UNIT_VECTOR),
		groundCoords: normalizeGroundCoords(payload.groundCoords),
		binding: normalizeBinding(payload.binding),
		metadata: payload.metadata && typeof payload.metadata === 'object' ? { ...payload.metadata } : null,
	}
}

function normalizeVector3(value, fallback) {
	const base = fallback ?? ZERO_VECTOR
	if (!value || typeof value !== 'object') {
		return { x: base.x, y: base.y, z: base.z }
	}
	return {
		x: toFiniteNumber(value.x, base.x),
		y: toFiniteNumber(value.y, base.y),
		z: toFiniteNumber(value.z, base.z),
	}
}

function normalizeGroundCoords(value) {
	if (!value || typeof value !== 'object') {
		return null
	}
	const x = toFiniteNumber(value.x, null)
	const z = toFiniteNumber(value.z, null)
	if (x == null || z == null) {
		return null
	}
	return {
		x,
		z,
		height: toFiniteNumber(value.height, null),
		normal: normalizeOptionalVector3(value.normal),
	}
}

function normalizeOptionalVector3(value) {
	if (!value || typeof value !== 'object') {
		return null
	}
	const x = toFiniteNumber(value.x, null)
	const y = toFiniteNumber(value.y, null)
	const z = toFiniteNumber(value.z, null)
	if (x == null || y == null || z == null) {
		return null
	}
	return { x, y, z }
}

function normalizeBinding(value) {
	if (!value || typeof value !== 'object') {
		return null
	}
	const nodeId = typeof value.nodeId === 'string' && value.nodeId.trim() ? value.nodeId : null
	const slots = Array.isArray(value.slots)
		? value.slots
				.map((slot) => {
					const handleId = typeof slot?.handleId === 'string' && slot.handleId.trim() ? slot.handleId : null
					const instanceIndex = Number.isInteger(slot?.instanceIndex) ? slot.instanceIndex : null
					if (!handleId || instanceIndex === null) {
						return null
					}
					return { handleId, instanceIndex }
				})
				.filter(Boolean)
		: []
	if (!nodeId || !slots.length) {
		return null
	}
	return { nodeId, slots }
}

function mergeLayerParams(params, current = DEFAULT_LAYER_PARAMS) {
	if (!params || typeof params !== 'object') {
		return cloneLayerParams(current)
	}
	const base = cloneLayerParams(current)
	if ('alignToNormal' in params) {
		base.alignToNormal = Boolean(params.alignToNormal)
	}
	if ('randomYaw' in params) {
		base.randomYaw = Boolean(params.randomYaw)
	}
	if ('minSlope' in params) {
		base.minSlope = toFiniteNumber(params.minSlope, base.minSlope)
	}
	if ('maxSlope' in params) {
		base.maxSlope = toFiniteNumber(params.maxSlope, base.maxSlope)
	}
	if ('minHeight' in params) {
		base.minHeight = toFiniteNumber(params.minHeight, base.minHeight)
	}
	if ('maxHeight' in params) {
		base.maxHeight = toFiniteNumber(params.maxHeight, base.maxHeight)
	}
	if ('minScale' in params) {
		base.minScale = toFiniteNumber(params.minScale, base.minScale)
	}
	if ('maxScale' in params) {
		base.maxScale = toFiniteNumber(params.maxScale, base.maxScale)
	}
	if ('density' in params) {
		base.density = toFiniteNumber(params.density, base.density)
	}
	if ('seed' in params) {
		base.seed = params.seed == null ? null : toFiniteNumber(params.seed, base.seed)
	}
	if ('payload' in params) {
		base.payload = params.payload && typeof params.payload === 'object' ? { ...params.payload } : null
	}
	if ('jitter' in params && params.jitter) {
		base.jitter = {
			position: toFiniteNumber(params.jitter.position, base.jitter.position),
			rotation: toFiniteNumber(params.jitter.rotation, base.jitter.rotation),
			scale: toFiniteNumber(params.jitter.scale, base.jitter.scale),
		}
	}
	return base
}

function cloneVector3(value, fallback) {
	const base = fallback ?? ZERO_VECTOR
	return {
		x: toFiniteNumber(value?.x, base.x),
		y: toFiniteNumber(value?.y, base.y),
		z: toFiniteNumber(value?.z, base.z),
	}
}

function cloneGroundCoords(value) {
	if (!value || typeof value !== 'object') {
		return null
	}
	const x = toFiniteNumber(value.x, null)
	const z = toFiniteNumber(value.z, null)
	if (x == null || z == null) {
		return null
	}
	return {
		x,
		z,
		height: toFiniteNumber(value.height, null),
		normal: value.normal ? cloneVector3(value.normal, nullVector()) : null,
	}
}

function nullVector() {
	return { x: 0, y: 0, z: 0 }
}

function touchStore(store) {
	store.metadata.updatedAt = now()
	store.metadata.version = TERRAIN_SCATTER_STORE_VERSION
	store.version = TERRAIN_SCATTER_STORE_VERSION
}

function touchLayer(layer) {
	if (layer && layer.metadata) {
		layer.metadata.updatedAt = now()
	}
}

function selectCategory(category) {
	if (CATEGORY_SET.has(category)) {
		return category
	}
	return 'ground'
}

function createScatterId(prefix) {
	return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

function toFiniteNumber(value, fallback) {
	const numeric = Number(value)
	return Number.isFinite(numeric) ? numeric : fallback
}

function resolveAuthorId(candidate, fallback) {
	if (candidate === null) {
		return null
	}
	if (typeof candidate === 'string' && candidate.trim()) {
		return candidate
	}
	return fallback ?? null
}
