export const TerrainScatterCategories: readonly ['flora', 'rocks', 'trees']

export type TerrainScatterCategory = (typeof TerrainScatterCategories)[number]

export const TERRAIN_SCATTER_STORE_VERSION: number

export interface TerrainScatterVector3 {
	x: number
	y: number
	z: number
}

export interface TerrainScatterJitterSettings {
	position: number
	rotation: number
	scale: number
}

export interface TerrainScatterLayerParams {
	alignToNormal: boolean
	randomYaw: boolean
	minSlope: number
	maxSlope: number
	minHeight: number
	maxHeight: number
	minScale: number
	maxScale: number
	density: number
	seed: number | null
	jitter: TerrainScatterJitterSettings
	payload?: Record<string, unknown> | null
}

export interface TerrainScatterGroundCoords {
	x: number
	z: number
	height?: number | null
	normal?: TerrainScatterVector3 | null
}

export interface TerrainScatterInstanceBindingSlot {
	handleId: string
	instanceIndex: number
}

export interface TerrainScatterInstanceBinding {
	nodeId: string
	slots: TerrainScatterInstanceBindingSlot[]
}

export interface TerrainScatterInstance {
	id: string
	assetId: string | null
	layerId: string | null
	profileId: string | null
	seed: number | null
	localPosition: TerrainScatterVector3
	localRotation: TerrainScatterVector3
	localScale: TerrainScatterVector3
	groundCoords: TerrainScatterGroundCoords | null
	binding?: TerrainScatterInstanceBinding | null
	metadata: Record<string, unknown> | null
}

export interface TerrainScatterLayerMetadata {
	createdAt: number
	updatedAt: number
	authorId?: string | null
}

export interface TerrainScatterLayer {
	id: string
	label: string
	category: TerrainScatterCategory
	assetId: string | null
	profileId: string | null
	params: TerrainScatterLayerParams
	instances: TerrainScatterInstance[]
	metadata: TerrainScatterLayerMetadata
}

export interface TerrainScatterStoreMetadata {
	createdAt: number
	updatedAt: number
	version: number
}

export interface TerrainScatterLayerSnapshot extends TerrainScatterLayer {}

export interface TerrainScatterStoreSnapshot {
	version: number
	groundNodeId: string
	metadata: TerrainScatterStoreMetadata
	layers: TerrainScatterLayerSnapshot[]
}

export interface TerrainScatterStore {
	version: number
	groundNodeId: string
	metadata: TerrainScatterStoreMetadata
	layers: Map<string, TerrainScatterLayer>
}

export type TerrainScatterLayerDraft = Partial<Omit<TerrainScatterLayer, 'params' | 'instances' | 'metadata'>> & {
	id?: string
	params?: Partial<TerrainScatterLayerParams>
	instances?: TerrainScatterInstance[]
	metadata?: Partial<TerrainScatterLayerMetadata>
}

export function createTerrainScatterStore(
	groundNodeId: string,
	snapshot?: TerrainScatterStoreSnapshot | null,
): TerrainScatterStore

export function registerTerrainScatterStore(store: TerrainScatterStore): TerrainScatterStore

export function getTerrainScatterStore(groundNodeId: string): TerrainScatterStore | null

export function ensureTerrainScatterStore(groundNodeId: string): TerrainScatterStore

export function listTerrainScatterStores(): TerrainScatterStore[]

export function deleteTerrainScatterStore(groundNodeId: string): boolean

export function clearTerrainScatterStores(): void

export function serializeTerrainScatterStore(store: TerrainScatterStore): TerrainScatterStoreSnapshot

export function deserializeTerrainScatterStore(
	snapshot: TerrainScatterStoreSnapshot,
	overrides?: { groundNodeId?: string },
): TerrainScatterStore

export function loadTerrainScatterSnapshot(
	groundNodeId: string,
	snapshot: TerrainScatterStoreSnapshot,
): TerrainScatterStore

export function saveTerrainScatterSnapshot(groundNodeId: string): TerrainScatterStoreSnapshot | null

export function upsertTerrainScatterLayer(
	store: TerrainScatterStore,
	payload: TerrainScatterLayerDraft,
): TerrainScatterLayer

export function getTerrainScatterLayer(
	store: TerrainScatterStore,
	layerId: string,
): TerrainScatterLayer | null

export function removeTerrainScatterLayer(store: TerrainScatterStore, layerId: string): boolean

export function replaceTerrainScatterInstances(
	store: TerrainScatterStore,
	layerId: string,
	instances: TerrainScatterInstance[],
): TerrainScatterLayer | null
