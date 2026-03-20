import { reactive, ref, toRaw, watch, type Ref } from 'vue'
import * as THREE from 'three'
import type {
	GroundDynamicMesh,
	GroundHeightMap,
	GroundSurfaceChunkTextureMap,
	GroundRuntimeDynamicMesh,
	GroundSculptOperation,
	SceneNode,
} from '@schema'
import {
	deleteTerrainScatterStore,
	ensureTerrainScatterStore,
	upsertTerrainScatterLayer,
	replaceTerrainScatterInstances,
	loadTerrainScatterSnapshot,
	serializeTerrainScatterStore,
	type TerrainScatterBrushShape,
	type TerrainScatterCategory,
	type TerrainScatterInstance,
	type TerrainScatterLayer,
	type TerrainScatterStore,
	type TerrainScatterStoreSnapshot,
} from '@schema/terrain-scatter'
import {
	sculptGround,
	sampleGroundHeight,
	resolveGroundEffectiveHeightAtVertex,
	stitchGroundChunkNormals,
	resolveGroundChunkCells,
	updateGroundChunks,
	updateGroundMesh,
	updateGroundMeshRegion,
	type GroundGeometryUpdateRegion,
} from '@schema/groundMesh'
import {
	ensureInstancedMeshesRegistered,
	getCachedModelObject,
	getOrLoadModelObject,
	type ModelInstanceGroup,
} from '@schema/modelObjectCache'
import {
	bindScatterInstance,
	composeScatterMatrix,
	getScatterInstanceWorldPosition,
	releaseScatterInstance,
	resetScatterInstanceBinding,
	updateScatterInstanceMatrix,
	buildScatterNodeId,
} from '@/utils/terrainScatterRuntime'
import { buildRotatedRectangleFromCorner, resolveRectangleDragDirection } from './rotatedRectangleBuild'
import { GROUND_NODE_ID, GROUND_HEIGHT_STEP } from './constants'
import type { BuildTool } from '@/types/build-tool'
import { useSceneStore } from '@/stores/sceneStore'
import { useScenesStore } from '@/stores/scenesStore'
import type { ProjectAsset } from '@/types/project-asset'
import type { GroundPanelTab } from '@/stores/terrainStore'
import { SCATTER_BRUSH_RADIUS_MAX, type TerrainPaintBrushSettings } from '@/stores/terrainStore'
import { useGroundPaintStore } from '@/stores/groundPaintStore'
import { useGroundHeightmapStore } from '@/stores/groundHeightmapStore'
import { useGroundScatterStore } from '@/stores/groundScatterStore'

import { assetProvider, terrainScatterPresets } from '@/resources/projectProviders/asset'
import { loadObjectFromFile } from '@schema/assetImport'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { computeBlobHash } from '@/utils/blob'
import { convertGroundSurfacePreviewCanvasToBlob, type GroundSurfaceLiveChunkPreview } from '@schema/groundSurfacePreview'
import { createInstancedBvhFrustumCuller } from '@schema/instancedBvhFrustumCuller'
import { normalizeScatterMaterials } from '@schema/scatterMaterials'
import { computeOccupancyMinDistance, computeOccupancyTargetCount } from '@/utils/scatterOccupancy'

export type TerrainBrushShape = 'circle' | 'square' | 'star'

type GroundSelectionPhase = 'pending' | 'sizing' | 'finalizing'

type GroundSelectionDragState = {
	pointerId: number
	startRow: number
	startColumn: number
	currentRow: number
	currentColumn: number
	phase: GroundSelectionPhase
}

export type GroundCellSelection = {
	minRow: number
	maxRow: number
	minColumn: number
	maxColumn: number
	worldCenter: THREE.Vector3
}

export type GroundEditorOptions = {
	sceneStore: ReturnType<typeof useSceneStore>
	getSceneNodes: () => SceneNode[]
	canvasRef: Ref<HTMLCanvasElement | null>
	surfaceRef: Ref<HTMLDivElement | null>
	raycaster: THREE.Raycaster
	pointer: THREE.Vector2
	groundPlane: THREE.Plane
	objectMap: Map<string, THREE.Object3D>
	getCamera: () => THREE.Camera | null
	getScene: () => THREE.Scene | null
	brushRadius: Ref<number>
	brushStrength: Ref<number>
	brushShape: Ref<TerrainBrushShape | undefined>
	brushOperation: Ref<GroundSculptOperation | null>
	groundPanelTab: Ref<GroundPanelTab>
	paintAsset: Ref<ProjectAsset | null>
	paintLayerStyle: Ref<TerrainPaintBrushSettings>
	scatterCategory: Ref<TerrainScatterCategory>
	scatterAsset: Ref<ProjectAsset | null>
	scatterBrushRadius: Ref<number>
	scatterBrushShape: Ref<TerrainScatterBrushShape>
	scatterRegularPolygonSides: Ref<number>
	scatterSpacing: Ref<number>
	scatterEraseRadius: Ref<number>
	scatterDensityPercent: Ref<number>
	activeBuildTool: Ref<BuildTool | null>
	onScatterEraseStart?: () => void
	scatterEraseModeActive: Ref<boolean>
	resolveVertexSnapPoint?: (
		event: PointerEvent,
		sourceWorld: THREE.Vector3,
		options?: {
			excludeNodeIds?: readonly string[]
			keepSourceY?: boolean
		},
	) => THREE.Vector3 | null
	clearVertexSnap?: () => void
	lockScatterLodToBaseAsset?: boolean
	scatterChunkStreaming?: {
		enabled?: boolean
		getDynamicRadiusMeters?: () => number
		radiusMeters?: number
		unloadPaddingMeters?: number
		maxChunkChangesPerUpdate?: number
		maxBindingChangesPerUpdate?: number
	}
	onSculptCommitApplied?: (payload: { groundObject: THREE.Object3D; definition: GroundRuntimeDynamicMesh }) => void
	onTerrainPaintSurfacePreviewChanged?: (payload: {
		groundObject: THREE.Object3D
		groundNode: SceneNode
		dynamicMesh: GroundDynamicMesh
		previewRevision: number
		mode: 'live' | 'surface-rebuild'
		liveChunkPreviews?: GroundSurfaceLiveChunkPreview[] | null
	}) => void
	disableOrbitForGroundSelection: () => void
	restoreOrbitAfterGroundSelection: () => void
	isAltOverrideActive: () => boolean
}

export type GroundEditorHandle = ReturnType<typeof createGroundEditor>

const BRUSH_BASE_POSITIONS_KEY = '__harmonyBrushBasePositions'
const BRUSH_SURFACE_OFFSET = 0.02

const brushBasePositionHelper = new THREE.Vector3()
const brushWorldVertexHelper = new THREE.Vector3()
const groundLocalVertexHelper = new THREE.Vector3()
const groundWorldVertexHelper = new THREE.Vector3()
const brushResultVertexHelper = new THREE.Vector3()
const groundSelectionCenterHelper = new THREE.Vector3()
const groundSelectionScreenHelper = new THREE.Vector3()
const groundPointerHelper = new THREE.Vector3()
const scatterPointerHelper = new THREE.Vector3()
const scatterDirectionHelper = new THREE.Vector3()
const scatterPlacementHelper = new THREE.Vector3()
const scatterPlacementCandidateLocalHelper = new THREE.Vector3()
const scatterPlacementCandidateWorldHelper = new THREE.Vector3()
const scatterMidpointHelper = new THREE.Vector3()
const scatterLocalAnchorHelper = new THREE.Vector3()
const scatterLocalCurrentHelper = new THREE.Vector3()
const scatterWorldMatrixHelper = new THREE.Matrix4()
const scatterGroundWorldMatrixHelper = new THREE.Matrix4()
const scatterInstanceWorldPositionHelper = new THREE.Vector3()
const scatterBboxSizeHelper = new THREE.Vector3()
const scatterPreviewProjectedHelper = new THREE.Vector3()

function clampFinite(value: unknown, fallback: number): number {
	const num = typeof value === 'number' ? value : Number(value)
	return Number.isFinite(num) ? num : fallback
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0
	}
	return Math.max(0, Math.min(1, value))
}

function computeSoftBrushFalloff(normalizedDistanceSquared: number, feather: number): number {
	if (normalizedDistanceSquared >= 1) {
		return 0
	}
	const normalizedFeather = clamp01(feather)
	if (normalizedFeather <= 0) {
		return 1
	}
	const effectiveFeather = 1 - ((1 - normalizedFeather) * (1 - normalizedFeather))
	const hardRadius = Math.max(0, 1 - effectiveFeather)
	const hardRadiusSquared = hardRadius * hardRadius
	if (normalizedDistanceSquared <= hardRadiusSquared) {
		return 1
	}
	const normalizedDistance = Math.sqrt(Math.max(0, normalizedDistanceSquared))
	const edgeT = clamp01((normalizedDistance - hardRadius) / Math.max(effectiveFeather, 1e-6))
	const smoothstep = edgeT * edgeT * (3 - 2 * edgeT)
	return 1 - smoothstep
}

function cloneGroundSurfaceChunks(definition: GroundDynamicMesh, nodeId?: string | null): GroundSurfaceChunkTextureMap | null {
	const sceneId = useSceneStore().currentSceneId
	const runtimeState = sceneId && nodeId
		? useGroundPaintStore().getSceneGroundPaint(sceneId)
		: null
	const source = runtimeState && runtimeState.nodeId === nodeId ? runtimeState.groundSurfaceChunks : definition.groundSurfaceChunks
	if (!source) {
		return null
	}
	return JSON.parse(JSON.stringify(source)) as GroundSurfaceChunkTextureMap
}

function createCompositionCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement | null {
	const normalizedWidth = Math.max(1, Math.round(width))
	const normalizedHeight = Math.max(1, Math.round(height))
	if (typeof OffscreenCanvas !== 'undefined') {
		return new OffscreenCanvas(normalizedWidth, normalizedHeight)
	}
	if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
		const canvas = document.createElement('canvas')
		canvas.width = normalizedWidth
		canvas.height = normalizedHeight
		return canvas
	}
	return null
}

const terrainPaintBrushImageCache = new Map<string, Promise<LoadedPaintImage | null>>()
const terrainPaintBrushImageResolvedCache = new Map<string, LoadedPaintImage | null>()

function getLoadedTerrainPaintBrushImage(assetId: string): LoadedPaintImage | null {
	const normalized = typeof assetId === 'string' ? assetId.trim() : ''
	if (!normalized) {
		return null
	}
	return terrainPaintBrushImageResolvedCache.get(normalized) ?? null
}

function resolveCanvasImageSourceSize(source: CanvasImageSource): { width: number; height: number } | null {
	const candidate = source as { width?: number; height?: number; videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number }
	const width = candidate.width ?? candidate.videoWidth ?? candidate.naturalWidth ?? 0
	const height = candidate.height ?? candidate.videoHeight ?? candidate.naturalHeight ?? 0
	if (!(width > 0) || !(height > 0)) {
		return null
	}
	return { width, height }
}

async function blobToCanvasImageSource(blob: Blob): Promise<CanvasImageSource | null> {
	if (typeof createImageBitmap === 'function') {
		try {
			return await createImageBitmap(blob)
		} catch {
			// Fall back to Image below.
		}
	}
	if (typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
		return null
	}
	return await new Promise((resolve) => {
		const image = new Image()
		const objectUrl = URL.createObjectURL(blob)
		image.onload = () => {
			URL.revokeObjectURL(objectUrl)
			resolve(image)
		}
		image.onerror = () => {
			URL.revokeObjectURL(objectUrl)
			resolve(null)
		}
		image.src = objectUrl
	})
}

function extractPaintImageDataFromSource(source: CanvasImageSource, width?: number, height?: number): PaintImageDataSource | null {
	const size = width && height ? { width, height } : resolveCanvasImageSourceSize(source)
	if (!size) {
		return null
	}
	const canvas = createCompositionCanvas(size.width, size.height)
	const context = canvas?.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
	if (!canvas || !context) {
		return null
	}
	context.clearRect(0, 0, size.width, size.height)
	context.drawImage(source, 0, 0, size.width, size.height)
	const imageData = context.getImageData(0, 0, size.width, size.height)
	return {
		width: imageData.width,
		height: imageData.height,
		data: imageData.data,
	}
}

async function loadTerrainPaintBrushImage(asset: ProjectAsset): Promise<LoadedPaintImage | null> {
	const assetId = typeof asset?.id === 'string' ? asset.id.trim() : ''
	const normalized = typeof assetId === 'string' ? assetId.trim() : ''
	if (!normalized) {
		return null
	}
	const cached = terrainPaintBrushImageResolvedCache.get(normalized)
	if (cached) {
		return cached
	}
	const inflight = terrainPaintBrushImageCache.get(normalized)
	if (inflight) {
		return await inflight
	}
	const pending = (async () => {
		const cache = useAssetCacheStore()
		let blob: Blob | null = null
		try {
			const entry = await cache.downloaProjectAsset(asset)
			blob = entry.blob ?? null
		} catch (error) {
			console.warn('加载地貌绘制笔刷失败：', error)
		}
		if (!blob) {
			const fallbackUrl = typeof asset.downloadUrl === 'string' ? asset.downloadUrl.trim() : ''
			if (fallbackUrl) {
				const response = await fetch(fallbackUrl, { credentials: 'include' }).catch(() => null)
				blob = response?.ok ? await response.blob() : null
			}
		}
		if (!blob) {
			return null
		}
		const source = await blobToCanvasImageSource(blob)
		if (!source) {
			return null
		}
		const imageData = extractPaintImageDataFromSource(source)
		if (!imageData) {
			return null
		}
		return { source, imageData }
	})()
	terrainPaintBrushImageCache.set(normalized, pending)
	const loaded = await pending
	terrainPaintBrushImageResolvedCache.set(normalized, loaded)
	terrainPaintBrushImageCache.delete(normalized)
	return loaded
}

function createTerrainPaintImageSamplingContext(image: PaintImageDataSource): TerrainPaintImageSamplingContext {
	return {
		image,
		widthMinusOne: Math.max(0, image.width - 1),
		heightMinusOne: Math.max(0, image.height - 1),
		rowStride: image.width * 4,
	}
}

function samplePaintImageData(imageContext: TerrainPaintImageSamplingContext, u: number, v: number, target: Float32Array): void {
	const image = imageContext.image
	const normalizedU = u - Math.floor(u)
	const normalizedV = v - Math.floor(v)
	const wrappedU = normalizedU < 0 ? normalizedU + 1 : normalizedU
	const wrappedV = normalizedV < 0 ? normalizedV + 1 : normalizedV
	const x = wrappedU * imageContext.widthMinusOne
	const y = wrappedV * imageContext.heightMinusOne
	const x0 = Math.floor(x)
	const y0 = Math.floor(y)
	const x1 = Math.min(image.width - 1, x0 + 1)
	const y1 = Math.min(image.height - 1, y0 + 1)
	const tx = x - x0
	const ty = y - y0
	const rowStride = imageContext.rowStride
	const data = image.data
	const offset00 = y0 * rowStride + x0 * 4
	const offset10 = y0 * rowStride + x1 * 4
	const offset01 = y1 * rowStride + x0 * 4
	const offset11 = y1 * rowStride + x1 * 4
	for (let channelIndex = 0; channelIndex < 4; channelIndex += 1) {
		const top = THREE.MathUtils.lerp((data[offset00 + channelIndex] ?? 0) / 255, (data[offset10 + channelIndex] ?? 0) / 255, tx)
		const bottom = THREE.MathUtils.lerp((data[offset01 + channelIndex] ?? 0) / 255, (data[offset11 + channelIndex] ?? 0) / 255, tx)
		target[channelIndex] = THREE.MathUtils.lerp(top, bottom, ty)
	}
}

function sampleTerrainPaintBrushColor(
	meshU: number,
	meshV: number,
	worldU: number,
	worldV: number,
	settings: TerrainPaintSamplingSettings,
	brushImage: TerrainPaintImageSamplingContext,
	target: Float32Array,
): void {
	const baseU = settings.worldSpace ? worldU : meshU
	const baseV = settings.worldSpace ? worldV : meshV
	const centeredX = baseU - 0.5
	const centeredY = baseV - 0.5
	const rotatedX = settings.rotationCos * centeredX - settings.rotationSin * centeredY
	const rotatedY = settings.rotationSin * centeredX + settings.rotationCos * centeredY
	samplePaintImageData(
		brushImage,
		rotatedX * settings.tileScaleX + 0.5 + settings.offsetX,
		rotatedY * settings.tileScaleY + 0.5 + settings.offsetY,
		target,
	)
}

function createTerrainPaintSamplingSettings(settings: TerrainPaintBrushSettings): TerrainPaintSamplingSettings {
	const rotation = (clampFinite(settings.rotationDeg, 0) * Math.PI) / 180
	return {
		worldSpace: settings.worldSpace,
		rotationSin: Math.sin(rotation),
		rotationCos: Math.cos(rotation),
		tileScaleX: clampFinite(settings.tileScale.x, 1),
		tileScaleY: clampFinite(settings.tileScale.y, 1),
		offsetX: clampFinite(settings.offset.x, 0),
		offsetY: clampFinite(settings.offset.y, 0),
		opacity: clamp01(settings.opacity),
		blendMode: settings.blendMode,
	}
}
function normalizeSurfaceDataToStraightAlpha(surfaceData: Uint8ClampedArray): Uint8ClampedArray {
	for (let offset = 0; offset < surfaceData.length; offset += 4) {
		const alpha = clamp01((surfaceData[offset + 3] ?? 0) / 255)
		if (alpha <= 0) {
			surfaceData[offset] = 0
			surfaceData[offset + 1] = 0
			surfaceData[offset + 2] = 0
			continue
		}
		surfaceData[offset] = Math.round(clamp01(((surfaceData[offset] ?? 0) / 255) / alpha) * 255)
		surfaceData[offset + 1] = Math.round(clamp01(((surfaceData[offset + 1] ?? 0) / 255) / alpha) * 255)
		surfaceData[offset + 2] = Math.round(clamp01(((surfaceData[offset + 2] ?? 0) / 255) / alpha) * 255)
	}
	return surfaceData
}

function createBlankPaintSurfaceData(resolution: number): Uint8ClampedArray {
	const normalized = Math.max(1, Math.round(resolution))
	return new Uint8ClampedArray(normalized * normalized * 4)
}

function extractChunkSurfaceDataAtResolution(source: CanvasImageSource, resolution: number): Uint8ClampedArray {
	const normalized = Math.max(1, Math.round(resolution))
	const imageData = extractPaintImageDataFromSource(source, normalized, normalized)
	return imageData ? new Uint8ClampedArray(imageData.data) : createBlankPaintSurfaceData(normalized)
}

async function encodePaintSurfaceDataToBlob(surfaceData: Uint8ClampedArray, resolution: number): Promise<Blob | null> {
	const normalized = Math.max(1, Math.round(resolution))
	const canvas = createCompositionCanvas(normalized, normalized)
	const context = canvas?.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
	if (!canvas || !context) {
		return null
	}
	const imageData = context.createImageData(normalized, normalized)
	imageData.data.set(surfaceData)
	context.putImageData(imageData, 0, 0)
	return await convertGroundSurfacePreviewCanvasToBlob(canvas)
}

function ensurePaintChunkPreviewBuffer(chunk: PaintChunkState): {
	canvas: OffscreenCanvas | HTMLCanvasElement
	context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
	imageData: ImageData
} | null {
	if (chunk.previewCanvas && chunk.previewContext && chunk.previewImageData) {
		return {
			canvas: chunk.previewCanvas,
			context: chunk.previewContext,
			imageData: chunk.previewImageData,
		}
	}
	const normalized = Math.max(1, Math.round(chunk.resolution))
	const canvas = createCompositionCanvas(normalized, normalized)
	const context = canvas?.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
	if (!canvas || !context) {
		return null
	}
	const imageData = context.createImageData(normalized, normalized)
	chunk.previewCanvas = canvas
	chunk.previewContext = context
	chunk.previewImageData = imageData
	return { canvas, context, imageData }
}

function buildLiveTerrainPaintChunkPreviews(
	session: PaintSessionState,
	chunkKeys: Set<string> | null = null,
): GroundSurfaceLiveChunkPreview[] {
	const previews: GroundSurfaceLiveChunkPreview[] = []
	for (const chunk of session.chunkStates.values()) {
		if (chunkKeys && !chunkKeys.has(chunk.key)) {
			continue
		}
		if (!chunk.dirty) {
			continue
		}
		const bounds = resolvePaintChunkBounds(session.definition, session.chunkCells, chunk.chunkRow, chunk.chunkColumn)
		if (!bounds) {
			continue
		}
		const previewBuffer = ensurePaintChunkPreviewBuffer(chunk)
		if (!previewBuffer) {
			continue
		}
		if (chunk.previewCanvasRevision !== chunk.surfaceRevision) {
			previewBuffer.imageData.data.set(chunk.surfaceData)
			previewBuffer.context.putImageData(previewBuffer.imageData, 0, 0)
			chunk.previewCanvasRevision = chunk.surfaceRevision
		}
		previews.push({
			chunkKey: chunk.key,
			bounds,
			canvas: previewBuffer.canvas,
			revision: chunk.surfaceRevision,
		})
	}
	return previews
}

function resolvePaintChunkBounds(
	definition: GroundDynamicMesh,
	chunkCells: number,
	chunkRow: number,
	chunkColumn: number,
): TerrainPaintChunkBounds | null {
	const halfWidth = definition.width * 0.5
	const halfDepth = definition.depth * 0.5
	const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
	const startColumn = chunkColumn * Math.max(1, chunkCells)
	const startRow = chunkRow * Math.max(1, chunkCells)
	const effectiveColumns = Math.max(0, Math.min(chunkCells, Math.max(0, definition.columns - startColumn)))
	const effectiveRows = Math.max(0, Math.min(chunkCells, Math.max(0, definition.rows - startRow)))
	const width = effectiveColumns * cellSize
	const depth = effectiveRows * cellSize
	if (!(width > 0) || !(depth > 0)) {
		return null
	}
	const minX = -halfWidth + startColumn * cellSize
	const minZ = -halfDepth + startRow * cellSize
	return { minX, minZ, width, depth }
}

async function bakeDirtyGroundSurfaceChunks(params: {
	session: PaintSessionState
	dirtyChunks: PaintChunkState[]
	previewRevision: number
	groundSurfaceChunks: GroundSurfaceChunkTextureMap | null
	registerAssets: typeof useSceneStore extends () => infer T
		? T extends { registerAssets: infer F }
			? F
			: never
		: never
}): Promise<GroundSurfaceChunkTextureMap | null> {
	const { session, dirtyChunks, previewRevision, registerAssets } = params
	if (!dirtyChunks.length) {
		return params.groundSurfaceChunks
	}
	const nextChunks = params.groundSurfaceChunks ? JSON.parse(JSON.stringify(params.groundSurfaceChunks)) as GroundSurfaceChunkTextureMap : {}
	const cache = useAssetCacheStore()
	const assetsToRegister: ProjectAsset[] = []
	for (const chunk of dirtyChunks) {
		const blob = await encodePaintSurfaceDataToBlob(chunk.surfaceData, chunk.resolution)
		if (!blob) {
			continue
		}
		const textureAssetId = await computeBlobHash(blob)
		const filename = `ground-surface-chunk_${session.nodeId}_${chunk.key}.png`
		await cache.storeAssetBlob(textureAssetId, {
			blob,
			mimeType: 'image/png',
			filename,
		})
		assetsToRegister.push({
			id: textureAssetId,
			name: filename,
			type: 'file',
			downloadUrl: textureAssetId,
			previewColor: '#ffffff',
			thumbnail: null,
			description: `Ground surface chunk (${session.nodeId}:${chunk.key})`,
			gleaned: true,
		})
		nextChunks[chunk.key] = {
			textureAssetId,
			revision: previewRevision,
		}
	}
	if (assetsToRegister.length) {
		registerAssets(assetsToRegister, {
			source: { type: 'local' },
			internal: true,
			commitOptions: { updateNodes: false },
			autoSave: false,
		})
	}
	return nextChunks
}

function clampScatterBrushRadius(value: unknown): number {
	const num = clampFinite(value, 0.5)
	return Math.min(SCATTER_BRUSH_RADIUS_MAX, Math.max(0.1, num))
}

const scatterCullingProjView = new THREE.Matrix4()
const scatterCullingFrustum = new THREE.Frustum()
const scatterFrustumCuller = createInstancedBvhFrustumCuller()
const scatterCandidateCenterHelper = new THREE.Vector3()
const scatterEraseLocalPointHelper = new THREE.Vector3()
const sculptStrokePrevPointHelper = new THREE.Vector3()
const sculptStrokeNextPointHelper = new THREE.Vector3()
const paintStrokePrevPointHelper = new THREE.Vector3()
const paintStrokeNextPointHelper = new THREE.Vector3()
const paintStrokeCurrentLocalPointHelper = new THREE.Vector3()
const paintStrokeInterpolatedPointHelper = new THREE.Vector3()

type ScatterSessionState = {
	pointerId: number
	asset: ProjectAsset
	bindingAssetId: string
	lodPresetAssetId: string | null
	category: TerrainScatterCategory
	brushShape: TerrainScatterBrushShape
	definition: GroundDynamicMesh
	groundMesh: THREE.Object3D
	spacing: number
	radius: number
	targetCountPerStamp: number
	minScale: number
	maxScale: number
	store: TerrainScatterStore
	layer: TerrainScatterLayer
	modelGroup: ModelInstanceGroup
	chunkCells: number
	neighborIndex: Map<string, TerrainScatterInstance[]>
	lastPoint: THREE.Vector3 | null
	anchorPoint: THREE.Vector3 | null
	currentPoint: THREE.Vector3 | null
	rectangleDirection: THREE.Vector3 | null
	polygonPoints: THREE.Vector3[]
	polygonPreviewEnd: THREE.Vector3 | null
	previewLayerId: string
	previewInstances: TerrainScatterInstance[]
}

type ScatterPreviewSample = {
	key: string
	point: THREE.Vector3
}

let scatterSession: ScatterSessionState | null = null

type ScatterRightClickState = {
	pointerId: number
	startX: number
	startY: number
	moved: boolean
}

type ScatterLeftClickState = {
	atMs: number
	clientX: number
	clientY: number
}

let scatterRightClickState: ScatterRightClickState | null = null
let scatterLeftClickState: ScatterLeftClickState | null = null

type PaintImageDataSource = {
	width: number
	height: number
	data: Uint8ClampedArray
}

type TerrainPaintImageSamplingContext = {
	image: PaintImageDataSource
	widthMinusOne: number
	heightMinusOne: number
	rowStride: number
}

type LoadedPaintImage = {
	source: CanvasImageSource
	imageData: PaintImageDataSource
}

type TerrainPaintSamplingSettings = {
	worldSpace: boolean
	rotationSin: number
	rotationCos: number
	tileScaleX: number
	tileScaleY: number
	offsetX: number
	offsetY: number
	opacity: number
	blendMode: TerrainPaintBrushSettings['blendMode']
}

type TerrainPaintStrokeMode = 'paint' | 'erase'

type TerrainPaintStampRequest = {
	mode: TerrainPaintStrokeMode
	localX: number
	localZ: number
	radius: number
	strength: number
	feather: number
	sampling: TerrainPaintSamplingSettings
	brushImage: TerrainPaintImageSamplingContext | null
}

type TerrainPaintChunkBounds = {
	minX: number
	minZ: number
	width: number
	depth: number
}

type PaintChunkState = {
	key: string
	chunkRow: number
	chunkColumn: number
	resolution: number
	surfaceData: Uint8ClampedArray
	surfaceRevision: number
	previewEncodedRevision: number
	status: 'loading' | 'ready'
	loadPromise: Promise<void> | null
	pendingStamps: TerrainPaintStampRequest[]
	previewUrl: string | null
	dirty: boolean
	previewCanvas: OffscreenCanvas | HTMLCanvasElement | null
	previewContext: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
	previewImageData: ImageData | null
	previewCanvasRevision: number
}

type PaintSessionState = {
	nodeId: string
	definition: GroundDynamicMesh
	chunkCells: number
	chunkStates: Map<string, PaintChunkState>
	hasPendingChanges: boolean
	terrainPaintSurfacePreviewRevision: number
	liveSurfacePreviewPendingChunkKeys: Map<string, true>
	liveSurfacePreviewFlushRafId: number | null
	terrainPaintSurfacePreviewDebounceTimerId: number | null
	previewGroundSurfaceChunks: GroundSurfaceChunkTextureMap | null
	previewEmitToken: number
}

let paintSessionState: PaintSessionState | null = null
let paintCommitToken = 0
let pendingTerrainPaintFlush: Promise<boolean> | null = null

// Scatter sampling/config constants
const SCATTER_EXISTING_CHECKS_PER_STAMP_MAX = 4096
const SCATTER_SAMPLE_ATTEMPTS_MAX = 500
const SCATTER_CLICK_DRAG_THRESHOLD_PX = 6
const SCATTER_DOUBLE_CLICK_INTERVAL_MS = 320
const SCATTER_DOUBLE_CLICK_DISTANCE_PX = 8
const SCATTER_ERASE_COMMIT_INTERVAL_MS = 16
const SCATTER_PERF_REPORT_INTERVAL_MS = 1000

function isScatterLeftDoubleClick(event: PointerEvent): boolean {
	if (event.button !== 0) {
		return false
	}
	const now = Number.isFinite(event.timeStamp) ? Number(event.timeStamp) : Date.now()
	const previous = scatterLeftClickState
	scatterLeftClickState = {
		atMs: now,
		clientX: event.clientX,
		clientY: event.clientY,
	}
	if (!previous) {
		return false
	}
	const dt = now - previous.atMs
	if (dt < 0 || dt > SCATTER_DOUBLE_CLICK_INTERVAL_MS) {
		return false
	}
	const distance = Math.hypot(event.clientX - previous.clientX, event.clientY - previous.clientY)
	return distance <= SCATTER_DOUBLE_CLICK_DISTANCE_PX
}

// Safety cap to avoid runaway interactive placement on tiny assets / huge brushes.
// Keep this high so densityPercent remains proportional for common use-cases.
const SCATTER_MAX_INSTANCES_PER_STAMP = 20000

// Performance caps for interactive terrain paint.
const TERRAIN_PAINT_STAMP_AFFECTED_CHUNKS_MAX = 64
const TERRAIN_PAINT_LIVE_SURFACE_PREVIEW_FLUSH_CHUNKS_MAX = 64
const TERRAIN_PAINT_SURFACE_PREVIEW_DEBOUNCE_MS = 250

function resolveTerrainPaintChunkScratchResolution(session: PaintSessionState, chunkRow: number, chunkColumn: number): number {
	const chunkBounds = resolvePaintChunkBounds(session.definition, session.chunkCells, chunkRow, chunkColumn)
	if (!chunkBounds) {
		return 256
	}
	const cellSize = Number.isFinite(session.definition.cellSize) && session.definition.cellSize > 0
		? session.definition.cellSize
		: 1
	const cellsPerAxisX = Math.max(1, Math.round(chunkBounds.width / cellSize))
	const cellsPerAxisZ = Math.max(1, Math.round(chunkBounds.depth / cellSize))
	const estimatedResolution = Math.max(cellsPerAxisX, cellsPerAxisZ) * 8
	return THREE.MathUtils.clamp(Math.round(estimatedResolution), 128, 512)
}

function collectPaintChunksOverlappedByBrush(
	definition: GroundDynamicMesh,
	chunkCells: number,
	localX: number,
	localZ: number,
	radius: number,
): Array<{ key: string; chunkRow: number; chunkColumn: number }> {
	if (!Number.isFinite(radius) || radius <= 0) {
		return []
	}
	const chunkCellCount = Math.max(1, Math.round(chunkCells))
	const halfWidth = definition.width * 0.5
	const halfDepth = definition.depth * 0.5
	const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
	const r2 = radius * radius

	const minColumnUnclamped = Math.floor((localX - radius + halfWidth) / cellSize)
	const maxColumnUnclamped = Math.ceil((localX + radius + halfWidth) / cellSize)
	const minRowUnclamped = Math.floor((localZ - radius + halfDepth) / cellSize)
	const maxRowUnclamped = Math.ceil((localZ + radius + halfDepth) / cellSize)

	const minColumn = THREE.MathUtils.clamp(minColumnUnclamped, 0, Math.max(0, definition.columns - 1))
	const maxColumn = THREE.MathUtils.clamp(maxColumnUnclamped, 0, Math.max(0, definition.columns - 1))
	const minRow = THREE.MathUtils.clamp(minRowUnclamped, 0, Math.max(0, definition.rows - 1))
	const maxRow = THREE.MathUtils.clamp(maxRowUnclamped, 0, Math.max(0, definition.rows - 1))

	const minChunkColumn = Math.floor(minColumn / chunkCellCount)
	const maxChunkColumn = Math.floor(maxColumn / chunkCellCount)
	const minChunkRow = Math.floor(minRow / chunkCellCount)
	const maxChunkRow = Math.floor(maxRow / chunkCellCount)

	const candidates: Array<{ key: string; chunkRow: number; chunkColumn: number; distSq: number }> = []
	for (let chunkRow = minChunkRow; chunkRow <= maxChunkRow; chunkRow += 1) {
		for (let chunkColumn = minChunkColumn; chunkColumn <= maxChunkColumn; chunkColumn += 1) {
			const bounds = resolvePaintChunkBounds(definition, chunkCellCount, chunkRow, chunkColumn)
			if (!bounds) {
				continue
			}
			const x0 = bounds.minX
			const x1 = bounds.minX + bounds.width
			const z0 = bounds.minZ
			const z1 = bounds.minZ + bounds.depth
			const qx = THREE.MathUtils.clamp(localX, x0, x1)
			const qz = THREE.MathUtils.clamp(localZ, z0, z1)
			const dx = localX - qx
			const dz = localZ - qz
			const distSq = dx * dx + dz * dz
			if (distSq > r2) {
				continue
			}
			candidates.push({
				key: `${chunkRow}:${chunkColumn}`,
				chunkRow,
				chunkColumn,
				distSq,
			})
		}
	}

	if (!candidates.length) {
		return []
	}

	// Performance cap: only process the closest chunk bounds.
	candidates.sort((a, b) => a.distSq - b.distSq)
	const limited = candidates.length > TERRAIN_PAINT_STAMP_AFFECTED_CHUNKS_MAX
		? candidates.slice(0, TERRAIN_PAINT_STAMP_AFFECTED_CHUNKS_MAX)
		: candidates
	return limited.map((entry) => ({ key: entry.key, chunkRow: entry.chunkRow, chunkColumn: entry.chunkColumn }))
}

function getScatterChunkKeyFromLocal(
	definition: GroundDynamicMesh,
	chunkCells: number,
	localX: number,
	localZ: number,
): { key: string; chunkRow: number; chunkColumn: number } {
	const halfWidth = definition.width * 0.5
	const halfDepth = definition.depth * 0.5
	const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
	const normalizedColumn = (localX + halfWidth) / cellSize
	const normalizedRow = (localZ + halfDepth) / cellSize
	const column = THREE.MathUtils.clamp(Math.floor(normalizedColumn), 0, Math.max(0, definition.columns - 1))
	const row = THREE.MathUtils.clamp(Math.floor(normalizedRow), 0, Math.max(0, definition.rows - 1))
	const chunkRow = Math.floor(row / Math.max(1, chunkCells))
	const chunkColumn = Math.floor(column / Math.max(1, chunkCells))
	return { key: `${chunkRow}:${chunkColumn}`, chunkRow, chunkColumn }
}

const DEFAULT_SCATTER_CHUNK_RADIUS_METERS = 200

function resolveScatterChunkStreamingRadiusMeters(definition: GroundDynamicMesh): number {
	const width = Number.isFinite(definition.width) ? definition.width : 0
	const depth = Number.isFinite(definition.depth) ? definition.depth : 0
	const halfDiagonal = Math.sqrt(Math.max(0, width) ** 2 + Math.max(0, depth) ** 2) * 0.5
	return Math.max(80, Math.min(2000, Math.min(DEFAULT_SCATTER_CHUNK_RADIUS_METERS, halfDiagonal)))
}

function computeScatterChunkKeysInRadius(
	definition: GroundDynamicMesh,
	chunkCells: number,
	localX: number,
	localZ: number,
	radius: number,
): Set<string> {
	const effectiveRadius = clampFinite(radius, 0)
	if (!(effectiveRadius > 0)) {
		return new Set([getScatterChunkKeyFromLocal(definition, chunkCells, localX, localZ).key])
	}

	const chunkCellCount = Math.max(1, Math.round(chunkCells))
	const halfWidth = definition.width * 0.5
	const halfDepth = definition.depth * 0.5
	const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1

	const minColumnUnclamped = Math.floor((localX - effectiveRadius + halfWidth) / cellSize)
	const maxColumnUnclamped = Math.ceil((localX + effectiveRadius + halfWidth) / cellSize)
	const minRowUnclamped = Math.floor((localZ - effectiveRadius + halfDepth) / cellSize)
	const maxRowUnclamped = Math.ceil((localZ + effectiveRadius + halfDepth) / cellSize)

	const minColumn = THREE.MathUtils.clamp(minColumnUnclamped, 0, Math.max(0, definition.columns - 1))
	const maxColumn = THREE.MathUtils.clamp(maxColumnUnclamped, 0, Math.max(0, definition.columns - 1))
	const minRow = THREE.MathUtils.clamp(minRowUnclamped, 0, Math.max(0, definition.rows - 1))
	const maxRow = THREE.MathUtils.clamp(maxRowUnclamped, 0, Math.max(0, definition.rows - 1))

	const minChunkColumn = Math.floor(minColumn / chunkCellCount)
	const maxChunkColumn = Math.floor(maxColumn / chunkCellCount)
	const minChunkRow = Math.floor(minRow / chunkCellCount)
	const maxChunkRow = Math.floor(maxRow / chunkCellCount)

	const keys = new Set<string>()
	for (let chunkRow = minChunkRow; chunkRow <= maxChunkRow; chunkRow += 1) {
		for (let chunkColumn = minChunkColumn; chunkColumn <= maxChunkColumn; chunkColumn += 1) {
			keys.add(`${chunkRow}:${chunkColumn}`)
		}
	}
	return keys
}

function buildScatterNeighborIndex(layer: TerrainScatterLayer, definition: GroundDynamicMesh, chunkCells: number) {
	const map = new Map<string, TerrainScatterInstance[]>()
	for (const instance of layer.instances) {
		const local = instance.localPosition
		const { key } = getScatterChunkKeyFromLocal(definition, chunkCells, local?.x ?? 0, local?.z ?? 0)
		const bucket = map.get(key)
		if (bucket) {
			bucket.push(instance)
		} else {
			map.set(key, [instance])
		}
	}
	return map
}

function addScatterInstanceToNeighborIndex(session: ScatterSessionState, instance: TerrainScatterInstance): void {
	const local = instance.localPosition
	const { key } = getScatterChunkKeyFromLocal(session.definition, session.chunkCells, local?.x ?? 0, local?.z ?? 0)
	const bucket = session.neighborIndex.get(key)
	if (bucket) {
		bucket.push(instance)
	} else {
		session.neighborIndex.set(key, [instance])
	}
}

/**
 * 判断在给定本地坐标处是否可以放置散布实例（基于索引检查邻近已有实例和预算限制）。
 *
 * 核心逻辑：
 * - 通过 getScatterChunkKeyFromLocal 使用 session.definition 和 session.chunkCells 将候选位置映射到格子（chunk）行列键。
 * - 在候选格子及其八个邻居（3x3 区域）中查找已存在的实例桶（session.neighborIndex 存储按 "row:col" 键的实例数组）。
 * - 对每个候选已存在实例：
 *   - 增加本次候选的 candidateChecks 计数器和全局 stampBudget.totalChecks（对外可见且被修改）。
 *   - 若 candidateChecks 超过常量 SCATTER_EXISTING_CHECKS_PER_CANDIDATE_MAX，或 stampBudget.totalChecks 超过常量 SCATTER_EXISTING_CHECKS_PER_STAMP_MAX，则视为超出检测预算，函数返回 false（表示不可放置或需跳过以节省计算）。
 *   - 计算实例与候选位置在本地坐标系下的平方距离（dx*dx + dz*dz），若小于 spacingSq（最小允许平方距离），则返回 false（与已有实例冲突）。
 * - 若遍历完 3x3 区域且未触发预算或距离冲突，则返回 true（表示可放置）。
 *
 * 注意和副作用：
 * - stampBudget.totalChecks 是一个传入的可变对象字段，函数会对其进行累加；调用者需传入并在外部跟踪此预算。
 * - 函数通过常量 SCATTER_EXISTING_CHECKS_PER_CANDIDATE_MAX 和 SCATTER_EXISTING_CHECKS_PER_STAMP_MAX 强制单候选和单次印章（stamp）级别的检查上限。
 * - 对 instance.localPosition 的访问使用了可选链和默认值（local?.x ?? 0 / local?.z ?? 0），因此若实例缺少位置数据会以 0 作为退化坐标。
 *
 * 参数说明：
 * @param session - 当前散布会话状态（ScatterSessionState）。包含：
 *   - definition / chunkCells：用于将本地坐标映射到格子键的必需数据（通过 getScatterChunkKeyFromLocal 使用）。
 *   - neighborIndex：Map 或类似结构，键为 "row:col"，值为对应格子内已存在实例的数组。
 * @param localX - 候选放置位置在本地坐标系的 X 分量（与实例 localPosition.x 采用相同坐标系）。
 * @param localZ - 候选放置位置在本地坐标系的 Z 分量（与实例 localPosition.z 采用相同坐标系）。
 * @param spacingSq - 最小允许距离的平方（squared spacing）。用于避免与已有实例过近的碰撞检测（使用平方距离以避免开方）。
 * @param stampBudget - 一个包含 totalChecks 字段的对象，用于跨多次放置调用累加检查次数并在达到阈值时停止进一步检查。函数会在每次考察已有实例时递增 stampBudget.totalChecks。
 *
 * 返回值：
 * @returns {boolean} - 若在预算限制内且不存在与候选位置冲突的已存在实例，则返回 true（可放置）；否则返回 false（不可放置或因超出检查预算而中止）。
 *
 * 相关常量：
 * - SCATTER_EXISTING_CHECKS_PER_CANDIDATE_MAX：单个候选位置允许检查的最大已存在实例数，超过则放弃该候选。
 * - SCATTER_EXISTING_CHECKS_PER_STAMP_MAX：单次印章/操作允许的总检查数上限，超过则停止进一步检查（通过 stampBudget.totalChecks 判定）。
 */
function isScatterPlacementAvailableByIndex(
	session: ScatterSessionState,
	localX: number,
	localZ: number,
	spacingSq: number,
	stampBudget: { totalChecks: number },
): boolean {
	const { chunkRow, chunkColumn } = getScatterChunkKeyFromLocal(session.definition, session.chunkCells, localX, localZ)
	for (let dr = -1; dr <= 1; dr += 1) {
		for (let dc = -1; dc <= 1; dc += 1) {
			const key = `${chunkRow + dr}:${chunkColumn + dc}`
			const bucket = session.neighborIndex.get(key)
			if (!bucket || !bucket.length) {
				continue
			}
			for (const instance of bucket) {
				stampBudget.totalChecks += 1
				if (stampBudget.totalChecks > SCATTER_EXISTING_CHECKS_PER_STAMP_MAX ) {
					return false
				}
				const local = instance.localPosition
				const dx = (local?.x ?? 0) - localX
				const dz = (local?.z ?? 0) - localZ
				if (dx * dx + dz * dz < spacingSq) {
					return false
				}
			}
		}
	}
	return true
}
type ScatterEraseState = {
	pointerId: number
	definition: GroundDynamicMesh
	groundMesh: THREE.Object3D
	radius: number
	pendingPoint: THREE.Vector3 | null
	pendingCommitRafId: number | null
	pendingCommitTimerId: ReturnType<typeof setTimeout> | null
	lastCommitAt: number
}

let scatterEraseState: ScatterEraseState | null = null
let scatterSidecarPersistPending = false
let pendingScatterSidecarSave: Promise<void> | null = null
let scatterSidecarSaveQueued = false

type ScatterPerfMetrics = {
	eraseCommits: number
	eraseDurationMs: number
	eraseRemovedLayers: number
	eraseRemovedInstances: number
	restoreCalls: number
	restoreDurationMs: number
	lastReportAt: number
}

const scatterPerfMetrics: ScatterPerfMetrics = {
	eraseCommits: 0,
	eraseDurationMs: 0,
	eraseRemovedLayers: 0,
	eraseRemovedInstances: 0,
	restoreCalls: 0,
	restoreDurationMs: 0,
	lastReportAt: 0,
}

function isScatterPerfDebugEnabled(): boolean {
	const flag = (globalThis as { __HARMONY_SCATTER_PERF__?: unknown }).__HARMONY_SCATTER_PERF__
	return flag === true
}

function flushScatterPerfMetricsIfNeeded(force = false): void {
	if (!isScatterPerfDebugEnabled()) {
		return
	}
	const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
		? performance.now()
		: Date.now()
	if (!force && now - scatterPerfMetrics.lastReportAt < SCATTER_PERF_REPORT_INTERVAL_MS) {
		return
	}
	scatterPerfMetrics.lastReportAt = now
	if (
		scatterPerfMetrics.eraseCommits <= 0
		&& scatterPerfMetrics.restoreCalls <= 0
		&& scatterPerfMetrics.eraseRemovedInstances <= 0
	) {
		return
	}
	console.info('[ScatterPerf]', {
		eraseCommits: scatterPerfMetrics.eraseCommits,
		eraseDurationMs: Number(scatterPerfMetrics.eraseDurationMs.toFixed(2)),
		eraseRemovedLayers: scatterPerfMetrics.eraseRemovedLayers,
		eraseRemovedInstances: scatterPerfMetrics.eraseRemovedInstances,
		restoreCalls: scatterPerfMetrics.restoreCalls,
		restoreDurationMs: Number(scatterPerfMetrics.restoreDurationMs.toFixed(2)),
	})
	scatterPerfMetrics.eraseCommits = 0
	scatterPerfMetrics.eraseDurationMs = 0
	scatterPerfMetrics.eraseRemovedLayers = 0
	scatterPerfMetrics.eraseRemovedInstances = 0
	scatterPerfMetrics.restoreCalls = 0
	scatterPerfMetrics.restoreDurationMs = 0
}

function recordScatterErasePerf(durationMs: number, removedLayers: number, removedInstances: number): void {
	if (!isScatterPerfDebugEnabled()) {
		return
	}
	scatterPerfMetrics.eraseCommits += 1
	scatterPerfMetrics.eraseDurationMs += Math.max(0, durationMs)
	scatterPerfMetrics.eraseRemovedLayers += Math.max(0, removedLayers)
	scatterPerfMetrics.eraseRemovedInstances += Math.max(0, removedInstances)
	flushScatterPerfMetricsIfNeeded(false)
}

function recordScatterRestorePerf(durationMs: number): void {
	if (!isScatterPerfDebugEnabled()) {
		return
	}
	scatterPerfMetrics.restoreCalls += 1
	scatterPerfMetrics.restoreDurationMs += Math.max(0, durationMs)
	flushScatterPerfMetricsIfNeeded(false)
}

type SculptSessionState = {
	nodeId: string
	definition: GroundRuntimeDynamicMesh
	heightMap: GroundHeightMap
	dirty: boolean
	affectedRegion: GroundGeometryUpdateRegion | null
	touchedChunkKeys: Set<string>
}

let sculptSessionState: SculptSessionState | null = null
	let sculptStrokePointerId: number | null = null
	let sculptStrokeLastLocalPoint: THREE.Vector3 | null = null
	let paintStrokePointerId: number | null = null
	let paintStrokeLastLocalPoint: THREE.Vector3 | null = null

function mergeRegions(
	current: GroundGeometryUpdateRegion | null,
	next: GroundGeometryUpdateRegion,
): GroundGeometryUpdateRegion {
	if (!current) {
		return { ...next }
	}
	return {
		minRow: Math.min(current.minRow, next.minRow),
		maxRow: Math.max(current.maxRow, next.maxRow),
		minColumn: Math.min(current.minColumn, next.minColumn),
		maxColumn: Math.max(current.maxColumn, next.maxColumn),
	}
}

function resolveChunkCellsForDefinition(definition: GroundDynamicMesh): number {
	// Keep in sync with schema/groundMesh.ts (DEFAULT_GROUND_CHUNK_CELLS / cellSize).
	const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
	const targetMeters = 100
	const candidate = Math.max(4, Math.round(targetMeters / Math.max(1e-6, cellSize)))
	return Math.max(4, Math.min(512, Math.trunc(candidate)))
}

function createStarShape(points = 5, outerRadius = 1, innerRadius = 0.5): THREE.Shape {
	const shape = new THREE.Shape()
	const step = Math.PI / points
	let angle = -Math.PI / 2
	shape.moveTo(Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius)
	for (let i = 0; i < points * 2; i += 1) {
		const radius = i % 2 === 0 ? innerRadius : outerRadius
		angle += step
		shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
	}
	shape.closePath()
	return shape
}

function createBrushGeometry(shape: TerrainBrushShape | undefined): THREE.BufferGeometry {
	switch (shape) {
		case 'square':
			return new THREE.PlaneGeometry(2, 2, 1, 1)
		case 'star':
			return new THREE.ShapeGeometry(createStarShape(5, 1, 0.5))
		case 'circle':
		default:
			return new THREE.CircleGeometry(1, 64)
	}
}
function storeBrushBasePositions(geometry: THREE.BufferGeometry) {
	const positionAttribute = geometry.getAttribute('position')
	if (!positionAttribute) {
		return
	}
	geometry.userData[BRUSH_BASE_POSITIONS_KEY] = Float32Array.from(positionAttribute.array as ArrayLike<number>)
}

function tagBrushGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
	storeBrushBasePositions(geometry)
	return geometry
}

export function createGroundEditor(options: GroundEditorOptions) {
	type GroundNormalsIndexType = 'u16' | 'u32'
	type GroundNormalsComputeRequest = {
		kind: 'compute-normals'
		requestId: number
		chunks: Array<{
			key: string
			positions: ArrayBuffer
			indices: ArrayBuffer
			indexType: GroundNormalsIndexType
		}>
	}
	type GroundNormalsComputeResponse = {
		kind: 'compute-normals-result'
		requestId: number
		results: Array<{ key: string; normals: ArrayBuffer }>
		error?: string
	}

	let groundNormalsWorker: Worker | null = null
	let groundNormalsRequestId = 0
	let groundNormalsJobToken = 0
	const pendingNormalsRequests = new Map<
		number,
		{
			resolve: (response: GroundNormalsComputeResponse) => void
			reject: (error: Error) => void
		}
	>()

	function getGroundNormalsWorker(): Worker | null {
		if (typeof Worker === 'undefined') {
			return null
		}
		if (groundNormalsWorker) {
			return groundNormalsWorker
		}
		try {
			groundNormalsWorker = new Worker(new URL('@/workers/groundNormals.worker.ts', import.meta.url), {
				type: 'module',
			})
			groundNormalsWorker.onmessage = (event: MessageEvent<GroundNormalsComputeResponse>) => {
				const data = event.data
				if (!data || data.kind !== 'compute-normals-result') {
					return
				}
				const pending = pendingNormalsRequests.get(data.requestId)
				if (!pending) {
					return
				}
				pendingNormalsRequests.delete(data.requestId)
				pending.resolve(data)
			}
			groundNormalsWorker.onerror = (event) => {
				console.warn('地形法线 Worker 出错：', event)
			}
			return groundNormalsWorker
		} catch (error) {
			console.warn('无法初始化地形法线 Worker，将回退到主线程计算：', error)
			groundNormalsWorker = null
			return null
		}
	}

	function cloneTypedArrayForTransfer<T extends ArrayBufferView>(array: T): T {
		const ctor = array.constructor as { new (buffer: ArrayBufferLike): T }
		const start = array.byteOffset
		const end = array.byteOffset + array.byteLength
		const slice = array.buffer.slice(start, end)
		return new ctor(slice)
	}

	async function recomputeGroundChunkNormalsInWorker(params: {
		groundObject: THREE.Object3D
		definition: GroundRuntimeDynamicMesh
		region: GroundGeometryUpdateRegion | null
		jobToken: number
		touchedChunkKeys?: Set<string> | null
	}): Promise<void> {
		const worker = getGroundNormalsWorker()
		if (!worker) {
			// Worker not available; fall back.
			params.groundObject.traverse((child) => {
				const mesh = child as THREE.Mesh
				if (!mesh?.isMesh || !(mesh.geometry instanceof THREE.BufferGeometry)) {
					return
				}
				mesh.geometry.computeVertexNormals()
			})
			stitchGroundChunkNormals(params.groundObject, params.definition, params.region ?? null)
			return
		}

		const chunkCells = resolveChunkCellsForDefinition(params.definition)
		const filterKeys = params.touchedChunkKeys && params.touchedChunkKeys.size ? params.touchedChunkKeys : null
		const chunks: GroundNormalsComputeRequest['chunks'] = []
		const meshesByKey = new Map<string, THREE.Mesh>()
		params.groundObject.traverse((child) => {
			const mesh = child as THREE.Mesh
			if (!mesh?.isMesh || !(mesh.geometry instanceof THREE.BufferGeometry)) {
				return
			}
			const geometry = mesh.geometry as THREE.BufferGeometry
			const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
			const indexAttr = geometry.getIndex() as THREE.BufferAttribute | null
			if (!positionAttr || !indexAttr) {
				return
			}
			const positions = positionAttr.array
			const indices = indexAttr.array
			if (!(positions instanceof Float32Array)) {
				return
			}
			if (!(indices instanceof Uint16Array) && !(indices instanceof Uint32Array)) {
				return
			}

			const chunk = mesh.userData?.groundChunk as
				| { startRow: number; startColumn: number; rows: number; columns: number }
				| undefined

			// Prefer touched-chunk filtering (more precise than a bounding rectangle).
			if (filterKeys && chunk) {
				const cr = Math.floor(Math.max(0, chunk.startRow) / chunkCells)
				const cc = Math.floor(Math.max(0, chunk.startColumn) / chunkCells)
				const ck = `${cr}:${cc}`
				if (!filterKeys.has(ck)) {
					return
				}
			} else if (params.region && chunk) {
				// Fall back to region overlap filtering.
				const chunkMinRow = chunk.startRow
				const chunkMaxRow = chunk.startRow + chunk.rows
				const chunkMinColumn = chunk.startColumn
				const chunkMaxColumn = chunk.startColumn + chunk.columns
				const overlaps = !(
					params.region.maxRow < chunkMinRow ||
					params.region.minRow > chunkMaxRow ||
					params.region.maxColumn < chunkMinColumn ||
					params.region.minColumn > chunkMaxColumn
				)
				if (!overlaps) {
					return
				}
			}

			const positionsCopy = cloneTypedArrayForTransfer(positions)
			const indicesCopy = cloneTypedArrayForTransfer(indices)
			const key = mesh.uuid
			meshesByKey.set(key, mesh)
			chunks.push({
				key,
				positions: positionsCopy.buffer as ArrayBuffer,
				indices: indicesCopy.buffer as ArrayBuffer,
				indexType: indicesCopy instanceof Uint16Array ? 'u16' : 'u32',
			})
		})

		if (!chunks.length) {
			return
		}
		const requestId = (groundNormalsRequestId += 1)
		const request: GroundNormalsComputeRequest = { kind: 'compute-normals', requestId, chunks }
		const responsePromise = new Promise<GroundNormalsComputeResponse>((resolve, reject) => {
			pendingNormalsRequests.set(requestId, { resolve, reject })
			try {
				worker.postMessage(request, [
					...chunks.map((chunk) => chunk.positions as ArrayBuffer),
					...chunks.map((chunk) => chunk.indices as ArrayBuffer),
				])
			} catch (error) {
				pendingNormalsRequests.delete(requestId)
				reject(error instanceof Error ? error : new Error(String(error)))
			}
		})

		const response = await responsePromise
		if (params.jobToken !== groundNormalsJobToken) {
			// A newer sculpt finalize started; ignore stale results.
			return
		}
		if (response.error) {
			throw new Error(response.error)
		}
		for (const result of response.results) {
			const mesh = meshesByKey.get(result.key)
			if (!mesh || !(mesh.geometry instanceof THREE.BufferGeometry)) {
				continue
			}
			const geometry = mesh.geometry as THREE.BufferGeometry
			const normals = new Float32Array(result.normals)
			const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
			if (normalAttr && normalAttr.array instanceof Float32Array && normalAttr.array.length === normals.length) {
				;(normalAttr.array as Float32Array).set(normals)
				normalAttr.needsUpdate = true
			} else {
				geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
			}
		}
		stitchGroundChunkNormals(params.groundObject, params.definition, params.region ?? null)
	}

	const assetCacheStore = useAssetCacheStore()
	const brushMaterial = new THREE.MeshBasicMaterial({
		color: 0x5fb0ff,
		transparent: true,
		opacity: 0.35,
		side: THREE.DoubleSide,
		depthTest: false,
		depthWrite: false,
	})
	const brushMesh = new THREE.Mesh(
		tagBrushGeometry(createBrushGeometry('circle')),
		brushMaterial,
	)
	brushMesh.rotation.x = -Math.PI / 2
	brushMesh.visible = false
	brushMesh.renderOrder = 999

	const scatterPreviewGroup = new THREE.Group()
	scatterPreviewGroup.name = 'ScatterHoverPreview'
	scatterPreviewGroup.visible = false
	scatterPreviewGroup.renderOrder = 998

	const scatterAreaPreviewGroup = new THREE.Group()
	scatterAreaPreviewGroup.name = 'ScatterAreaPreview'
	scatterAreaPreviewGroup.visible = false
	scatterAreaPreviewGroup.renderOrder = 997

	const scatterAreaPreviewFill = new THREE.Mesh(
		new THREE.BufferGeometry(),
		new THREE.MeshBasicMaterial({
			color: 0x4dd0e1,
			transparent: true,
			opacity: 0.14,
			side: THREE.DoubleSide,
			depthTest: false,
			depthWrite: false,
		}),
	)
	scatterAreaPreviewFill.renderOrder = 997

	const scatterAreaPreviewOutline = new THREE.Line(
		new THREE.BufferGeometry(),
		new THREE.LineBasicMaterial({
			color: 0x4dd0e1,
			transparent: true,
			opacity: 0.9,
			depthTest: false,
			depthWrite: false,
		}),
	)
	scatterAreaPreviewOutline.renderOrder = 998
	scatterAreaPreviewGroup.add(scatterAreaPreviewFill)
	scatterAreaPreviewGroup.add(scatterAreaPreviewOutline)

	let scatterPreviewAssetId: string | null = null
	let scatterPreviewObject: THREE.Object3D | null = null

	const groundSelectionGroup = new THREE.Group()
	groundSelectionGroup.visible = false
	groundSelectionGroup.name = 'GroundSelection'

	const groundSelectionOutlineMaterial = new THREE.LineBasicMaterial({
		color: 0x4dd0e1,
		linewidth: 2,
		transparent: true,
		opacity: 0.9,
		depthTest: true,
		depthWrite: false,
	})

	const groundSelectionOutlineGeometry = new THREE.BufferGeometry()
	groundSelectionOutlineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(15), 3))
	const groundSelectionOutline = new THREE.LineLoop(groundSelectionOutlineGeometry, groundSelectionOutlineMaterial)

	const groundSelectionFillMaterial = new THREE.MeshBasicMaterial({
		color: 0x4dd0e1,
		transparent: true,
		opacity: 0.2,
		depthWrite: false,
		side: THREE.DoubleSide,
	})
	const groundSelectionFill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundSelectionFillMaterial)
	groundSelectionFill.rotation.x = -Math.PI / 2
	groundSelectionGroup.add(groundSelectionFill)
	groundSelectionGroup.add(groundSelectionOutline)

	const groundSelection = ref<GroundCellSelection | null>(null)
	const isGroundToolbarVisible = ref(false)
	const groundSelectionToolbarStyle = reactive<{ left: string; top: string; opacity: number }>({
		left: '0px',
		top: '0px',
		opacity: 0,
	})
	const groundTextureInputRef = ref<HTMLInputElement | null>(null)
	const isSculpting = ref(false)
	const isPainting = ref(false)

	let groundSelectionDragState: GroundSelectionDragState | null = null
	let scatterStore: TerrainScatterStore | null = null
	let scatterLayer: TerrainScatterLayer | null = null
	let scatterModelGroup: ModelInstanceGroup | null = null
	let scatterResolvedBindingAssetId: string | null = null
	let scatterResolvedLodPresetAssetId: string | null = null
	let scatterAssetLoadToken = 0
	let scatterSnapshotUpdatedAt: number | null = null
	const scatterRuntimeAssetIdByNodeId = new Map<string, string>()

	const scatterChunkStreamingEnabled = Boolean(options.scatterChunkStreaming?.enabled)
	const lockScatterLodToBaseAsset = Boolean(options.lockScatterLodToBaseAsset)
	const scatterChunkStreamingRadiusOverride = clampFinite(options.scatterChunkStreaming?.radiusMeters, Number.NaN)
	const scatterChunkStreamingPaddingOverride = clampFinite(options.scatterChunkStreaming?.unloadPaddingMeters, Number.NaN)
	const scatterChunkStreamingMaxChunkChangesPerUpdate =
		Number.isFinite(options.scatterChunkStreaming?.maxChunkChangesPerUpdate) && (options.scatterChunkStreaming?.maxChunkChangesPerUpdate as number) > 0
			? Number(options.scatterChunkStreaming?.maxChunkChangesPerUpdate)
			: Number.POSITIVE_INFINITY
	const scatterChunkStreamingMaxBindingChangesPerUpdate =
		Number.isFinite(options.scatterChunkStreaming?.maxBindingChangesPerUpdate) && (options.scatterChunkStreaming?.maxBindingChangesPerUpdate as number) > 0
			? Number(options.scatterChunkStreaming?.maxBindingChangesPerUpdate)
			: 500
	const scatterChunkStreamingVisibilityUpdateIntervalMs = 33
	const scatterChunkStreamingCullGraceMs = 300
	const scatterChunkStreamingCullRadiusMultiplier = 1.2

	let scatterChunkIndexDirty = true
	let scatterChunkIndex: Map<string, Array<{ layer: TerrainScatterLayer; instance: TerrainScatterInstance }>> = new Map()
	let scatterChunkEntryByNodeId: Map<string, { chunkKey: string; layer: TerrainScatterLayer; instance: TerrainScatterInstance }> = new Map()
	let scatterActiveChunkKeys = new Set<string>()
	let scatterChunkStreamingToken = 0
	const pendingScatterChunkBindings = new Map<string, Promise<void>>()
	const scatterChunkStreamingPendingBindIds = new Set<string>()
	const scatterChunkStreamingAllocatedNodeIds = new Set<string>()
	const scatterChunkStreamingLastVisibleAt = new Map<string, number>()
	let scatterChunkStreamingLastFrustumVisibleIds: Set<string> = new Set<string>()
	let lastScatterChunkStreamingVisibilityUpdateAt = 0
	let lastScatterChunkStreamingUpdateAt = 0
	const scatterChunkStreamingLocalCameraHelper = new THREE.Vector3()
	const scatterChunkStreamingMatrixHelper = new THREE.Matrix4()
	const scatterChunkStreamingWorldCameraHelper = new THREE.Vector3()
	const scatterChunkStreamingGroupPromises = new Map<string, Promise<ModelInstanceGroup | null>>()
	const scatterChunkStreamingBindingResolutionCache = new Map<
		string,
		{ bindingAssetId: string | null; lodPresetAssetId: string | null }
	>()
	const pendingScatterModelLoads = new Map<string, Promise<void>>()
	const scatterLodPresetCache = new Map<string, Awaited<ReturnType<typeof options.sceneStore.loadLodPreset>> | null>()
	const pendingScatterLodPresetLoads = new Map<string, Promise<void>>()
	let lastScatterLodUpdateAt = 0
	let scatterLodImmediateSyncNeeded = lockScatterLodToBaseAsset
	const scatterLodCameraPosition = new THREE.Vector3()

	const TERRAIN_PAINT_STREAMING_SYNC_DEBOUNCE_MS = 160
	let terrainPaintStreamingSyncTimer: number | null = null
	let lastVisibleTerrainPaintChunkKeys = new Set<string>()
	let lastTerrainPaintSceneSwitchToken: number | null = null

	function getActiveBrushShape(): TerrainBrushShape {
		const value = options.brushShape.value
		if (value === 'square' || value === 'star') {
			return value
		}
		return 'circle'
	}

	function resolveScatterBrushShape(): TerrainScatterBrushShape {
		const value = options.scatterBrushShape.value
		if (value === 'rectangle' || value === 'line' || value === 'polygon') {
			return value
		}
		return 'circle'
	}

	function resolveScatterRegularPolygonSides(): number {
		const raw = Number(options.scatterRegularPolygonSides.value)
		if (!Number.isFinite(raw)) {
			return 0
		}
		const rounded = Math.round(raw)
		const clamped = Math.min(256, Math.max(0, rounded))
		return clamped >= 3 ? clamped : 0
	}

	function getIndicatorBrushShape(): TerrainBrushShape {
		if (options.scatterEraseModeActive.value) {
			return 'circle'
		}
		if (scatterModeEnabled()) {
			const shape = resolveScatterBrushShape()
			return shape === 'rectangle' || shape === 'line' || shape === 'polygon' ? 'square' : 'circle'
		}
		if (options.groundPanelTab.value === 'paint') {
			return 'circle'
		}
		return getActiveBrushShape()
	}

	function getBrushColor(): number {
		if (options.scatterEraseModeActive.value) {
			return 0xffb347
		}
		if (options.groundPanelTab.value === 'terrain') {
			return 0x5fb0ff
		}
		if (options.groundPanelTab.value === 'paint') {
			return options.paintAsset.value ? 0x8bc34a : 0xffb347
		}
		if (scatterModeEnabled()) {
			return 0x4dd0e1
		}
		return 0x5fb0ff
	}

	function refreshBrushAppearance() {
		brushMaterial.color.setHex(getBrushColor())
		updateBrushGeometry(getIndicatorBrushShape())
	}

	const stopBrushShapeWatch = watch(options.brushShape, () => {
		refreshBrushAppearance()
	})
	const stopScatterEraseModeWatch = watch(options.scatterEraseModeActive, () => {
		refreshBrushAppearance()
	})
	watch(options.paintAsset, () => {
		refreshBrushAppearance()
	})
	watch(options.scatterBrushShape, () => {
		refreshBrushAppearance()
	})
	refreshBrushAppearance()

	const stopTabWatch = watch(options.groundPanelTab, (tab) => {
		if (tab === 'terrain' || tab === 'paint') {
			cancelScatterPlacement()
			cancelScatterErase()
		}
		if (tab === 'paint') {
			const groundNode = getGroundNodeFromScene()
			if (groundNode?.dynamicMesh?.type === 'Ground') {
				const groundObject = getGroundObject()
				const definition = groundNode.dynamicMesh as GroundDynamicMesh
				const session = ensurePaintSession(definition, groundNode.id)
				Object.entries(session.previewGroundSurfaceChunks ?? {}).forEach(([key]) => {
					const parts = key.split(':')
					const chunkRow = Number.parseInt(parts[0] ?? '', 10)
					const chunkColumn = Number.parseInt(parts[1] ?? '', 10)
					if (!Number.isFinite(chunkRow) || !Number.isFinite(chunkColumn)) {
						return
					}
					// Only prewarm if the chunk mesh is currently present (loaded).
					const loaded = groundObject
						? !!groundObject.children.find((child: THREE.Object3D) => (child as any)?.userData?.groundChunk?.chunkRow === chunkRow && (child as any)?.userData?.groundChunk?.chunkColumn === chunkColumn)
						: false
					if (!loaded) {
						return
					}
					void ensurePaintChunkState(session, { key, chunkRow, chunkColumn })
				})
			}
		}
		refreshBrushAppearance()
	})

	const stopScatterSelectionWatch = watch(
		() => ({ asset: options.scatterAsset.value, category: options.scatterCategory.value }),
		({ asset, category }) => {
			scatterLodImmediateSyncNeeded = lockScatterLodToBaseAsset
			cancelScatterPlacement()
			cancelScatterErase()
			scatterLayer = null
			scatterPreviewGroup.visible = false
			if (!category) {
				refreshBrushAppearance()
				return
			}
			if (!asset) {
				scatterModelGroup = null
				scatterPreviewAssetId = null
				scatterPreviewObject = null
				scatterPreviewGroup.clear()
				scatterStore = ensureScatterStoreRef()
				scatterLayer = findScatterLayerByAsset(null, category)
				refreshBrushAppearance()
				return
			}
			void prepareScatterRuntime(asset, category)
			refreshBrushAppearance()
		},
		{ immediate: true },
	)

	function ensureScatterPreviewObject(bindingAssetId: string): void {
		if (!bindingAssetId) {
			scatterPreviewGroup.visible = false
			return
		}
		if (scatterPreviewAssetId === bindingAssetId && scatterPreviewObject) {
			return
		}
		const group = getCachedModelObject(bindingAssetId)
		if (!group) {
			scatterPreviewGroup.visible = false
			return
		}
		if (!group.object) {
			scatterPreviewGroup.visible = false
			return
		}
		scatterPreviewGroup.clear()
		const cloned = group.object.clone(true)
		cloned.name = `ScatterPreview:${bindingAssetId}`
		scatterPreviewGroup.add(cloned)
		scatterPreviewAssetId = bindingAssetId
		scatterPreviewObject = cloned
	}

	function isPointerOverGround(
		definition: GroundDynamicMesh,
		groundMesh: THREE.Object3D,
		worldPoint: THREE.Vector3,
	): boolean {
		const halfWidth = definition.width * 0.5
		const halfDepth = definition.depth * 0.5
		if (!Number.isFinite(worldPoint.x) || !Number.isFinite(worldPoint.z) || !Number.isFinite(worldPoint.y)) {
			return false
		}
		// Evaluate bounds in the ground's local space so translation/rotation doesn't break the test.
		groundLocalVertexHelper.copy(worldPoint)
		groundMesh.updateMatrixWorld(true)
		groundMesh.worldToLocal(groundLocalVertexHelper)
		return (
			Number.isFinite(groundLocalVertexHelper.x) &&
			Number.isFinite(groundLocalVertexHelper.z) &&
			groundLocalVertexHelper.x >= -halfWidth &&
			groundLocalVertexHelper.x <= halfWidth &&
			groundLocalVertexHelper.z >= -halfDepth &&
			groundLocalVertexHelper.z <= halfDepth
		)
	}

	function updateScatterHoverPreview(event: PointerEvent): void {
		if (!scatterModeEnabled()) {
			scatterPreviewGroup.visible = false
			return
		}
		const definition = getGroundDynamicMeshDefinition()
		const groundMesh = getGroundObject()
		const asset = options.scatterAsset.value
		const category = options.scatterCategory.value
		const modelGroup = scatterModelGroup
		const bindingAssetId = scatterResolvedBindingAssetId
		if (!definition || !groundMesh || !asset || !category || !modelGroup || !bindingAssetId) {
			scatterPreviewGroup.visible = false
			return
		}
		const snappedPoint = resolveScatterPointFromEvent(event, definition, groundMesh)
		if (!snappedPoint) {
			scatterPreviewGroup.visible = false
			return
		}
		if (scatterSession && resolveScatterBrushShape() !== 'circle') {
			scatterPreviewGroup.visible = false
			return
		}

		scatterPreviewProjectedHelper.copy(snappedPoint)

		ensureScatterPreviewObject(bindingAssetId)
		if (!scatterPreviewObject) {
			scatterPreviewGroup.visible = false
			return
		}

		const preset = getScatterPreset(category)
		const minScale = Number.isFinite(preset.minScale) ? Number(preset.minScale) : 0.9
		const maxScale = Number.isFinite(preset.maxScale) ? Number(preset.maxScale) : 1.1
		const scaleFactor = THREE.MathUtils.clamp(
			(minScale + maxScale) * 0.5,
			Math.min(minScale, maxScale),
			Math.max(minScale, maxScale),
		)
		const yaw = 0
		scatterPreviewGroup.position.copy(scatterPreviewProjectedHelper)
		scatterPreviewGroup.rotation.set(0, yaw, 0)
		scatterPreviewGroup.scale.setScalar(scaleFactor)
		scatterPreviewGroup.visible = true
	}

	function resetScatterStoreState(reason: string) {
		scatterChunkIndexDirty = true
		scatterChunkIndex = new Map()
		scatterChunkEntryByNodeId = new Map()
		scatterActiveChunkKeys = new Set()
		scatterChunkStreamingToken += 1
		pendingScatterChunkBindings.clear()
		scatterChunkStreamingGroupPromises.clear()
		scatterChunkStreamingBindingResolutionCache.clear()
		scatterChunkStreamingPendingBindIds.clear()
		scatterChunkStreamingAllocatedNodeIds.clear()
		scatterChunkStreamingLastVisibleAt.clear()
		scatterChunkStreamingLastFrustumVisibleIds = new Set<string>()
		lastScatterChunkStreamingVisibilityUpdateAt = 0
		lastScatterChunkStreamingUpdateAt = 0
		lastScatterLodUpdateAt = 0
		scatterLodImmediateSyncNeeded = lockScatterLodToBaseAsset

		try {
			cancelScatterPlacement()
			cancelScatterErase()
		} catch {
			// ignore
		}

		if (scatterStore) {
			try {
				for (const layer of Array.from(scatterStore.layers.values())) {
					for (const instance of layer.instances ?? []) {
						scatterRuntimeAssetIdByNodeId.delete(buildScatterNodeId(layer.id, instance.id))
						releaseScatterInstance(instance)
					}
				}
			} catch (error) {
				console.warn('释放地面散布实例失败', reason, error)
			}
		}

		scatterStore = null
		scatterLayer = null
		scatterModelGroup = null
		scatterResolvedBindingAssetId = null
		scatterResolvedLodPresetAssetId = null
		scatterSnapshotUpdatedAt = null
		try {
			deleteTerrainScatterStore(GROUND_NODE_ID)
		} catch (error) {
			console.warn('重置地面散布存储失败', reason, error)
		}
	}

	function getScatterLayerLodPresetId(layer: TerrainScatterLayer): string | null {
		const payload = layer.params?.payload as Record<string, unknown> | null | undefined
		const fromPayload = payload && typeof payload.lodPresetAssetId === 'string' ? payload.lodPresetAssetId.trim() : ''
		if (fromPayload) {
			return fromPayload
		}
		const assetId = typeof layer.assetId === 'string' ? layer.assetId.trim() : ''
		if (!assetId) {
			return null
		}
		const asset = options.sceneStore.getAsset(assetId)
		if (asset?.type === 'prefab') {
			return assetId
		}
		return null
	}

	async function ensureScatterLodPresetCached(presetAssetId: string): Promise<void> {
		const normalized = presetAssetId.trim()
		if (!normalized) {
			return
		}
		if (scatterLodPresetCache.has(normalized)) {
			return
		}
		if (pendingScatterLodPresetLoads.has(normalized)) {
			await pendingScatterLodPresetLoads.get(normalized)
			return
		}

		const ensureReferencedAssetCached = async (assetId: string): Promise<void> => {
			const id = assetId.trim()
			if (!id) {
				return
			}
			try {
				if (!assetCacheStore.hasCache(id)) {
					await assetCacheStore.loadFromIndexedDb(id)
				}
				if (assetCacheStore.hasCache(id)) {
					return
				}
				const asset = options.sceneStore.getAsset(id)
				if (!asset || (asset.type !== 'model' && asset.type !== 'mesh')) {
					return
				}
				await assetCacheStore.downloaProjectAsset(asset)
			} catch (error) {
				console.warn('缓存 LOD 预设引用资源失败', id, error)
			}
		}

		const task = (async () => {
			try {
				const preset = await options.sceneStore.loadLodPreset(normalized)
				const referencedIds: string[] = []
				const refs = (preset as any)?.assetRefs
				if (Array.isArray(refs) && refs.length) {
					for (const ref of refs) {
						const id = typeof ref?.assetId === 'string' ? ref.assetId.trim() : ''
						if (id) {
							referencedIds.push(id)
						}
					}
				} else {
					const levels = (preset as any)?.props?.levels
					if (Array.isArray(levels) && levels.length) {
						for (const level of levels) {
							const id = typeof level?.modelAssetId === 'string' ? level.modelAssetId.trim() : ''
							if (id) {
								referencedIds.push(id)
							}
						}
					}
				}
				const unique = Array.from(new Set(referencedIds))
				if (unique.length) {
					await Promise.all(unique.map((id) => ensureReferencedAssetCached(id)))
				}
				scatterLodPresetCache.set(normalized, preset)
			} catch (_error) {
				scatterLodPresetCache.set(normalized, null)
			}
		})()
			.finally(() => {
				pendingScatterLodPresetLoads.delete(normalized)
			})
		pendingScatterLodPresetLoads.set(normalized, task)
		await task
	}

	function resolveLodBindingAssetId(preset: Awaited<ReturnType<typeof options.sceneStore.loadLodPreset>> | null): string | null {
		const levels = preset?.props?.levels
		if (!Array.isArray(levels) || levels.length === 0) {
			return null
		}
		for (const level of levels) {
			const id = typeof level?.modelAssetId === 'string' ? level.modelAssetId.trim() : ''
			if (id) {
				return id
			}
		}
		return null
	}

	function chooseLodModelAssetId(preset: Awaited<ReturnType<typeof options.sceneStore.loadLodPreset>>, distance: number): string | null {
		const levels = Array.isArray(preset?.props?.levels) ? preset.props.levels : []
		if (!levels.length) {
			return null
		}
		let chosen: (typeof levels)[number] | undefined
		for (let i = levels.length - 1; i >= 0; i -= 1) {
			const candidate = levels[i]
			if (candidate && distance >= (candidate.distance ?? 0)) {
				chosen = candidate
				break
			}
		}
		const id = typeof chosen?.modelAssetId === 'string' ? chosen.modelAssetId.trim() : ''
		return id || null
	}

	function ensureScatterModelCached(assetId: string): boolean {
		const normalized = assetId.trim()
		if (!normalized) {
			return false
		}
		if (getCachedModelObject(normalized)) {
			ensureInstancedMeshesRegistered(normalized)
			return true
		}
		if (pendingScatterModelLoads.has(normalized)) {
			return false
		}
		const task = (async () => {
			const asset = options.sceneStore.getAsset(normalized)
			if (!asset || (asset.type !== 'model' && asset.type !== 'mesh')) {
				return
			}
			try {
				if (!assetCacheStore.hasCache(normalized)) {
					await assetCacheStore.loadFromIndexedDb(normalized)
				}
				if (!assetCacheStore.hasCache(normalized)) {
					await assetCacheStore.downloaProjectAsset(asset)
				}
			} catch (error) {
				console.warn('缓存散布 LOD 资源失败', normalized, error)
			}
			const file = assetCacheStore.createFileFromCache(normalized)
			if (!file) {
				return
			}
			try {
				await getOrLoadModelObject(normalized, async () => {
					const object = await loadObjectFromFile(file, asset.extension ?? undefined)
					normalizeScatterMaterials(object)
					return object
				})
				ensureInstancedMeshesRegistered(normalized)
			} finally {
				assetCacheStore.releaseInMemoryBlob(normalized)
			}
		})()
			.catch((error) => {
				console.warn('预载散布 LOD 资源失败', normalized, error)
			})
			.finally(() => {
				pendingScatterModelLoads.delete(normalized)
			})
		pendingScatterModelLoads.set(normalized, task)
		return false
	}

	const stopSceneIdWatch = watch(
		() => options.sceneStore.currentSceneId,
		(next, previous) => {
			if (next !== previous) {
				// Scene boundaries: force-exit all pointer-driven modes and clear any
				// in-flight session state so tools don't get stuck after switching/new.
				try {
					const canvas = options.canvasRef.value
					const pointerIds: Array<number | null | undefined> = [
						sculptStrokePointerId,
						paintStrokePointerId,
						scatterSession?.pointerId,
						scatterEraseState?.pointerId,
						groundSelectionDragState?.pointerId,
					]
					if (canvas) {
						for (const id of pointerIds) {
							if (typeof id === 'number') {
								try {
									canvas.releasePointerCapture(id)
								} catch {
									// ignore
								}
							}
						}
					}
				} catch {
					// ignore
				}

				isSculpting.value = false
				isPainting.value = false
				sculptStrokePointerId = null
				sculptStrokeLastLocalPoint = null
				paintStrokePointerId = null
				paintStrokeLastLocalPoint = null
				sculptSessionState = null
				scatterSession = null
				scatterEraseState = null
				groundSelectionDragState = null
				groundSelection.value = null
				groundSelectionGroup.visible = false
				isGroundToolbarVisible.value = false
				groundSelectionToolbarStyle.opacity = 0

				brushMesh.visible = false
				scatterPreviewGroup.visible = false
				scatterPreviewGroup.clear()
				scatterPreviewObject = null
				scatterPreviewAssetId = null

				// Invalidate any in-flight paint work tied to the previous scene.
				paintCommitToken += 1
				pendingTerrainPaintFlush = null

				resetScatterStoreState('scene-changed')
				const activePaintSession = paintSessionState
				const activePreviewFlushRafId = activePaintSession?.liveSurfacePreviewFlushRafId ?? null
				if (activePreviewFlushRafId !== null) {
					window.cancelAnimationFrame(activePreviewFlushRafId)
					activePaintSession!.liveSurfacePreviewFlushRafId = null
				}
				const activeSurfacePreviewDebounceTimerId = activePaintSession?.terrainPaintSurfacePreviewDebounceTimerId ?? null
				if (activeSurfacePreviewDebounceTimerId !== null) {
					window.clearTimeout(activeSurfacePreviewDebounceTimerId)
					activePaintSession!.terrainPaintSurfacePreviewDebounceTimerId = null
				}
				paintSessionState = null
				lastVisibleTerrainPaintChunkKeys = new Set()
				lastTerrainPaintSceneSwitchToken = null
				if (terrainPaintStreamingSyncTimer !== null) {
					window.clearTimeout(terrainPaintStreamingSyncTimer)
					terrainPaintStreamingSyncTimer = null
				}
			}
		},
	)

	function collectVisibleTerrainPaintChunks(groundObject: THREE.Object3D): Array<{ key: string; chunkRow: number; chunkColumn: number }> {
		const result: Array<{ key: string; chunkRow: number; chunkColumn: number }> = []
		const seen = new Set<string>()
		groundObject.traverse((obj) => {
			if (obj === groundObject) {
				return
			}
			const chunk = (obj as any)?.userData?.groundChunk as { chunkRow?: number; chunkColumn?: number } | undefined
			const chunkRow = typeof chunk?.chunkRow === 'number' ? chunk.chunkRow : null
			const chunkColumn = typeof chunk?.chunkColumn === 'number' ? chunk.chunkColumn : null
			if (chunkRow == null || chunkColumn == null) {
				return
			}
			const key = `${chunkRow}:${chunkColumn}`
			if (seen.has(key)) {
				return
			}
			seen.add(key)
			result.push({ key, chunkRow, chunkColumn })
		})
		return result
	}

	function warmGroundSurfaceChunkForPreview(session: PaintSessionState, chunk: { key: string; chunkRow: number; chunkColumn: number }): void {
		const state = ensurePaintChunkState(session, chunk)
		if (!session.previewGroundSurfaceChunks?.[chunk.key]) {
			queueTerrainPaintLiveSurfacePreviewChunk(session, state)
		}
	}

	async function restoreGroundPaint(): Promise<void> {
		const tokenSnapshot = options.sceneStore.sceneSwitchToken
		const groundNode = getGroundNodeFromScene()
		const groundMesh = getGroundObject()
		const definition = getGroundDynamicMeshDefinition()
		if (!groundNode || groundNode.dynamicMesh?.type !== 'Ground' || !groundMesh || !definition) {
			return
		}
		const session = ensurePaintSession(definition, groundNode.id)
		session.definition = definition
		session.chunkCells = resolveGroundChunkCells(definition)
		session.previewGroundSurfaceChunks = cloneGroundSurfaceChunks(definition, session.nodeId)
		session.chunkStates = new Map()
		session.hasPendingChanges = false
		session.liveSurfacePreviewPendingChunkKeys.clear()
		if (session.liveSurfacePreviewFlushRafId !== null) {
			window.cancelAnimationFrame(session.liveSurfacePreviewFlushRafId)
			session.liveSurfacePreviewFlushRafId = null
		}
		if (session.terrainPaintSurfacePreviewDebounceTimerId !== null) {
			window.clearTimeout(session.terrainPaintSurfacePreviewDebounceTimerId)
			session.terrainPaintSurfacePreviewDebounceTimerId = null
		}

		const visibleChunks = collectVisibleTerrainPaintChunks(groundMesh)
		const nextVisibleKeys = new Set<string>()
		for (const chunk of visibleChunks) {
			if (tokenSnapshot !== options.sceneStore.sceneSwitchToken) {
				return
			}
			nextVisibleKeys.add(chunk.key)
			warmGroundSurfaceChunkForPreview(session, chunk)
		}
		lastVisibleTerrainPaintChunkKeys = nextVisibleKeys
		lastTerrainPaintSceneSwitchToken = tokenSnapshot
	}

	function scheduleTerrainPaintStreamingSync(): void {
		if (terrainPaintStreamingSyncTimer !== null) {
			return
		}
		terrainPaintStreamingSyncTimer = window.setTimeout(() => {
			terrainPaintStreamingSyncTimer = null
			void syncTerrainPaintForVisibleChunksIncremental()
		}, TERRAIN_PAINT_STREAMING_SYNC_DEBOUNCE_MS)
	}

	async function syncTerrainPaintForVisibleChunksIncremental(): Promise<void> {
		const tokenSnapshot = options.sceneStore.sceneSwitchToken
		// If we haven't successfully restored for this scene yet, do a full initial restore.
		if (lastTerrainPaintSceneSwitchToken !== tokenSnapshot) {
			await restoreGroundPaint()
			return
		}
		const groundNode = getGroundNodeFromScene()
		const groundMesh = getGroundObject()
		const definition = getGroundDynamicMeshDefinition()
		if (!groundNode || groundNode.dynamicMesh?.type !== 'Ground' || !groundMesh || !definition) {
			return
		}
		if (tokenSnapshot !== options.sceneStore.sceneSwitchToken) {
			return
		}
		const session = ensurePaintSession(definition, groundNode.id)

		const visibleChunks = collectVisibleTerrainPaintChunks(groundMesh)
		const nextVisibleKeys = new Set<string>()
		const newlyVisible: Array<{ key: string; chunkRow: number; chunkColumn: number }> = []
		for (const chunk of visibleChunks) {
			nextVisibleKeys.add(chunk.key)
			if (!lastVisibleTerrainPaintChunkKeys.has(chunk.key)) {
				newlyVisible.push(chunk)
			}
		}
		for (const chunk of newlyVisible) {
			if (tokenSnapshot !== options.sceneStore.sceneSwitchToken) {
				return
			}
			warmGroundSurfaceChunkForPreview(session, chunk)
		}

		lastVisibleTerrainPaintChunkKeys = nextVisibleKeys
	}

	function onGroundChunkSetChanged(): void {
		scheduleTerrainPaintStreamingSync()
	}

	async function restoreGroupdScatter(): Promise<void> {
		const perfStart = nowMs()
		try {
		const store = ensureScatterStoreRef()
		const groundMesh = getGroundObject()
		const definition = getGroundDynamicMeshDefinition()
		if (!groundMesh || !definition) {
			return
		}
		updateGroundChunks(groundMesh, definition, options.getCamera())
		if (store.layers.size === 0) {
			return
		}

		if (scatterChunkStreamingEnabled) {
			// Prepare/normalize LOD preset payloads once; binding is handled by chunk streaming.
			for (const layer of store.layers.values()) {
				const lodPresetId = getScatterLayerLodPresetId(layer)
				if (!lodPresetId) {
					continue
				}
				await ensureScatterLodPresetCached(lodPresetId)
				if (scatterLodPresetCache.get(lodPresetId)) {
					const payload = (layer.params?.payload && typeof layer.params.payload === 'object')
						? ({ ...(layer.params.payload as Record<string, unknown>) } as Record<string, unknown>)
						: ({} as Record<string, unknown>)
					if (payload.lodPresetAssetId !== lodPresetId) {
						payload.lodPresetAssetId = lodPresetId
						upsertTerrainScatterLayer(store, { id: layer.id, params: { payload } })
					}
				}
			}
			updateScatterChunkStreaming(true)
			return
		}

		const resolveSelectionAssetId = (instance: TerrainScatterInstance, layer: TerrainScatterLayer): string | null => {
			return resolveScatterSelectionAssetId(instance, layer)
		}

		const resolveBindingAssetId = async (selectionAssetId: string): Promise<{ bindingAssetId: string | null; lodPresetAssetId: string | null }> => {
			const asset = options.sceneStore.getAsset(selectionAssetId)
			if (asset?.type === 'prefab') {
				await ensureScatterLodPresetCached(selectionAssetId)
				const preset = scatterLodPresetCache.get(selectionAssetId) ?? null
				const base = resolveLodBindingAssetId(preset)
				return { bindingAssetId: base, lodPresetAssetId: preset ? selectionAssetId : null }
			}
			return { bindingAssetId: selectionAssetId, lodPresetAssetId: null }
		}

		const groupPromises = new Map<string, Promise<ModelInstanceGroup | null>>()
		const ensureModelGroup = (assetId: string): Promise<ModelInstanceGroup | null> => {
			if (!groupPromises.has(assetId)) {
				const promise = (async () => {
					const asset = options.sceneStore.getAsset(assetId)
					if (!asset) {
						console.warn('地面散布资源缺失，跳过恢复', assetId)
						return null
					}
					try {
						if (!assetCacheStore.hasCache(assetId)) {
							await assetCacheStore.loadFromIndexedDb(assetId)
						}
						if (!assetCacheStore.hasCache(assetId)) {
							await assetCacheStore.downloaProjectAsset(asset)
						}
					} catch (error) {
						console.warn('缓存地面散布资源失败', assetId, error)
					}
					try {
						return await loadScatterModelGroup(asset)
					} catch (error) {
						console.warn('载入地面散布资源失败', assetId, error)
						return null
					}
				})()
					.catch((error) => {
						console.warn('恢复地面散布实例时发生错误', assetId, error)
						return null
					})
				groupPromises.set(assetId, promise)
			}
			return groupPromises.get(assetId) as Promise<ModelInstanceGroup | null>
		}

		for (const layer of store.layers.values()) {
			if (!layer.instances?.length) {
				continue
			}
			groundMesh.updateMatrixWorld(true)
			scatterGroundWorldMatrixHelper.copy(groundMesh.matrixWorld)
			const lodPresetId = getScatterLayerLodPresetId(layer)
			if (lodPresetId) {
				await ensureScatterLodPresetCached(lodPresetId)
				if (scatterLodPresetCache.get(lodPresetId)) {
					// Normalize payload so future runtime updates can detect the preset quickly.
					const payload = (layer.params?.payload && typeof layer.params.payload === 'object')
						? ({ ...(layer.params.payload as Record<string, unknown>) } as Record<string, unknown>)
						: ({} as Record<string, unknown>)
					if (payload.lodPresetAssetId !== lodPresetId) {
						payload.lodPresetAssetId = lodPresetId
						upsertTerrainScatterLayer(store, { id: layer.id, params: { payload } })
					}
				}
			}
			for (const instance of layer.instances) {
				const selectionAssetId = resolveSelectionAssetId(instance, layer)
				if (!selectionAssetId) {
					continue
				}
				instance.assetId = instance.assetId ?? selectionAssetId
				instance.layerId = instance.layerId ?? layer.id
				if (!instance.profileId) {
					instance.profileId = layer.profileId ?? selectionAssetId
				}
				resetScatterInstanceBinding(instance)
				const resolved = await resolveBindingAssetId(selectionAssetId)
				const bindingAssetId = resolved.bindingAssetId
				if (!bindingAssetId) {
					continue
				}
				const group = await ensureModelGroup(bindingAssetId)
				if (!group) {
					continue
				}
				const matrix = composeScatterMatrix(instance, groundMesh, scatterWorldMatrixHelper, scatterGroundWorldMatrixHelper)
				if (!bindScatterInstance(instance, matrix, group.assetId)) {
					console.warn('绑定地面散布实例失败', {
						layerId: layer.id,
						instanceId: instance.id,
						assetId: bindingAssetId,
					})
					continue
				}
				scatterRuntimeAssetIdByNodeId.set(buildScatterNodeId(layer.id, instance.id), group.assetId)
			}
		}
		} finally {
			recordScatterRestorePerf(nowMs() - perfStart)
		}
	}

	function ensureScatterStoreRef(): TerrainScatterStore {
		const snapshot = getGroundTerrainScatterSnapshot()
		const snapshotUpdatedAt = getScatterSnapshotTimestamp(snapshot)
		const hasSnapshot = Boolean(snapshot)
		const hasSnapshotChanged = snapshotUpdatedAt !== scatterSnapshotUpdatedAt
		const shouldHydrate = hasSnapshot && (!scatterStore || hasSnapshotChanged)
		if (!hasSnapshot && (scatterStore || scatterSnapshotUpdatedAt !== null)) {
			// New scenes may not contain a terrainScatter snapshot. Since scatter stores are keyed by
			// the constant ground node id, we must reset the store; otherwise previous scene scatter
			// will leak into the new scene.
			resetScatterStoreState('missing-snapshot')
		}
		if (shouldHydrate && snapshot) {
			// When the snapshot changes (e.g. planning->3D conversion), previously bound instances
			// may remain allocated in the instancing cache. Release old bindings before rehydrating.
			if (scatterStore) {
				try {
					for (const layer of Array.from(scatterStore.layers.values())) {
						for (const instance of layer.instances ?? []) {
							releaseScatterInstance(instance)
						}
					}
				} catch (error) {
					console.warn('释放旧的地面散布实例失败', error)
				}
			}
			try {
				scatterStore = loadTerrainScatterSnapshot(GROUND_NODE_ID, snapshot)
				scatterSnapshotUpdatedAt = snapshotUpdatedAt
				scatterChunkIndexDirty = true
				scatterChunkIndex = new Map()
				scatterChunkEntryByNodeId = new Map()
				scatterActiveChunkKeys = new Set()
				scatterChunkStreamingToken += 1
				pendingScatterChunkBindings.clear()
				scatterChunkStreamingGroupPromises.clear()
				scatterChunkStreamingBindingResolutionCache.clear()
				scatterChunkStreamingPendingBindIds.clear()
				scatterChunkStreamingAllocatedNodeIds.clear()
				scatterChunkStreamingLastVisibleAt.clear()
				scatterChunkStreamingLastFrustumVisibleIds = new Set<string>()
				lastScatterChunkStreamingVisibilityUpdateAt = 0
				lastScatterChunkStreamingUpdateAt = 0
			} catch (error) {
				console.warn('载入地面散布快照失败', error)
				scatterStore = ensureTerrainScatterStore(GROUND_NODE_ID)
				scatterChunkIndexDirty = true
			}
		}
		if (!scatterStore) {
			scatterStore = ensureTerrainScatterStore(GROUND_NODE_ID)
			scatterChunkIndexDirty = true
		}
		return scatterStore
	}

	function rebuildScatterChunkIndexForStore(store: TerrainScatterStore, definition: GroundDynamicMesh, chunkCells: number): void {
		const next = new Map<string, Array<{ layer: TerrainScatterLayer; instance: TerrainScatterInstance }>>()
		const nextByNodeId = new Map<string, { chunkKey: string; layer: TerrainScatterLayer; instance: TerrainScatterInstance }>()
		for (const layer of store.layers.values()) {
			if (!layer.instances?.length) {
				continue
			}
			for (const instance of layer.instances) {
				const local = instance.localPosition
				const { key } = getScatterChunkKeyFromLocal(definition, chunkCells, local?.x ?? 0, local?.z ?? 0)
				const bucket = next.get(key)
				if (bucket) {
					bucket.push({ layer, instance })
				} else {
					next.set(key, [{ layer, instance }])
				}
				const nodeId = buildScatterNodeId(layer.id, instance.id)
				nextByNodeId.set(nodeId, { chunkKey: key, layer, instance })
			}
		}
		scatterChunkIndex = next
		scatterChunkEntryByNodeId = nextByNodeId
		scatterChunkIndexDirty = false
	}

	function resolveScatterSelectionAssetId(instance: TerrainScatterInstance, layer: TerrainScatterLayer): string | null {
		const candidates = [instance.assetId, layer.assetId, instance.profileId, layer.profileId]
		for (const candidate of candidates) {
			if (typeof candidate === 'string') {
				const trimmed = candidate.trim()
				if (trimmed.length) {
					return trimmed
				}
			}
		}
		return null
	}

	async function resolveScatterBindingAssetId(selectionAssetId: string): Promise<{ bindingAssetId: string | null; lodPresetAssetId: string | null }> {
		const normalized = typeof selectionAssetId === 'string' ? selectionAssetId.trim() : ''
		if (!normalized) {
			return { bindingAssetId: null, lodPresetAssetId: null }
		}
		const cached = scatterChunkStreamingBindingResolutionCache.get(normalized)
		if (cached) {
			return cached
		}
		const asset = options.sceneStore.getAsset(normalized)
		if (asset?.type === 'prefab') {
			await ensureScatterLodPresetCached(normalized)
			const preset = scatterLodPresetCache.get(normalized) ?? null
			const base = resolveLodBindingAssetId(preset)
			const result = { bindingAssetId: base, lodPresetAssetId: preset ? normalized : null }
			scatterChunkStreamingBindingResolutionCache.set(normalized, result)
			return result
		}
		const result = { bindingAssetId: normalized, lodPresetAssetId: null }
		scatterChunkStreamingBindingResolutionCache.set(normalized, result)
		return result
	}

	function ensureScatterChunkStreamingModelGroup(bindingAssetId: string): Promise<ModelInstanceGroup | null> {
		const normalized = typeof bindingAssetId === 'string' ? bindingAssetId.trim() : ''
		if (!normalized) {
			return Promise.resolve(null)
		}
		const existing = scatterChunkStreamingGroupPromises.get(normalized)
		if (existing) {
			return existing
		}
		const promise = (async () => {
			const asset = options.sceneStore.getAsset(normalized)
			if (!asset || (asset.type !== 'model' && asset.type !== 'mesh')) {
				return null
			}
			try {
				if (!assetCacheStore.hasCache(normalized)) {
					await assetCacheStore.loadFromIndexedDb(normalized)
				}
				if (!assetCacheStore.hasCache(normalized)) {
					await assetCacheStore.downloaProjectAsset(asset)
				}
			} catch (error) {
				console.warn('缓存地面散布资源失败', normalized, error)
			}
			try {
				return await loadScatterModelGroup(asset)
			} catch (error) {
				console.warn('载入地面散布资源失败', normalized, error)
				return null
			}
		})().finally(() => {
			// keep promise cached
		})
		scatterChunkStreamingGroupPromises.set(normalized, promise)
		return promise
	}

	function nowMs(): number {
		return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
	}

	function computeScatterChunkStreamingVisibleIds(groundMesh: THREE.Object3D, camera: THREE.Camera): Set<string> {
		camera.updateMatrixWorld(true)
		scatterCullingProjView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
		scatterCullingFrustum.setFromProjectionMatrix(scatterCullingProjView)

		const candidateIds: string[] = []
		for (const chunkKey of scatterActiveChunkKeys.values()) {
			const bucket = scatterChunkIndex.get(chunkKey)
			if (!bucket?.length) {
				continue
			}
			for (const entry of bucket) {
				candidateIds.push(buildScatterNodeId(entry.layer.id, entry.instance.id))
			}
		}
		if (!candidateIds.length) {
			return new Set<string>()
		}
		candidateIds.sort()
		scatterFrustumCuller.setIds(candidateIds)

		const visibleIds = scatterFrustumCuller.updateAndQueryVisible(scatterCullingFrustum, (nodeId, centerTarget) => {
			const entry = scatterChunkEntryByNodeId.get(nodeId)
			if (!entry) {
				return null
			}
			const worldPos = getScatterInstanceWorldPosition(entry.instance, groundMesh, scatterCandidateCenterHelper)
			centerTarget.copy(worldPos)
			const boundAssetId = scatterRuntimeAssetIdByNodeId.get(nodeId) ?? null
			const baseRadius = boundAssetId ? (getCachedModelObject(boundAssetId)?.radius ?? 0.5) : 0.5
			const scale = entry.instance.localScale
			const scaleFactor = Math.max(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1)
			const radius = baseRadius * (Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1) * scatterChunkStreamingCullRadiusMultiplier
			return { radius }
		})

		return visibleIds
	}

	async function bindScatterChunkStreamingNodeId(nodeId: string, token: number): Promise<void> {
		if (token !== scatterChunkStreamingToken) {
			return
		}
		const groundMesh = getGroundObject()
		const definition = getGroundDynamicMeshDefinition()
		if (!groundMesh || !definition) {
			return
		}
		const entry = scatterChunkEntryByNodeId.get(nodeId)
		if (!entry) {
			return
		}
		if (!scatterActiveChunkKeys.has(entry.chunkKey)) {
			return
		}
		if (!scatterChunkStreamingLastFrustumVisibleIds.has(nodeId)) {
			return
		}
		if (scatterChunkStreamingAllocatedNodeIds.has(nodeId) || entry.instance.binding?.nodeId) {
			scatterChunkStreamingAllocatedNodeIds.add(nodeId)
			return
		}
		const selectionAssetId = resolveScatterSelectionAssetId(entry.instance, entry.layer)
		if (!selectionAssetId) {
			return
		}
		entry.instance.assetId = entry.instance.assetId ?? selectionAssetId
		entry.instance.layerId = entry.instance.layerId ?? entry.layer.id
		if (!entry.instance.profileId) {
			entry.instance.profileId = entry.layer.profileId ?? selectionAssetId
		}
		resetScatterInstanceBinding(entry.instance)
		const resolved = await resolveScatterBindingAssetId(selectionAssetId)
		const bindingAssetId = resolved.bindingAssetId
		if (!bindingAssetId) {
			return
		}
		const group = await ensureScatterChunkStreamingModelGroup(bindingAssetId)
		if (!group) {
			return
		}
		if (token !== scatterChunkStreamingToken) {
			return
		}
		if (!scatterActiveChunkKeys.has(entry.chunkKey)) {
			return
		}
		if (!scatterChunkStreamingLastFrustumVisibleIds.has(nodeId)) {
			return
		}
		groundMesh.updateMatrixWorld(true)
		scatterGroundWorldMatrixHelper.copy(groundMesh.matrixWorld)
		const matrix = composeScatterMatrix(entry.instance, groundMesh, scatterWorldMatrixHelper, scatterGroundWorldMatrixHelper)
		if (!bindScatterInstance(entry.instance, matrix, group.assetId)) {
			return
		}
		scatterRuntimeAssetIdByNodeId.set(nodeId, group.assetId)
		scatterChunkStreamingAllocatedNodeIds.add(nodeId)
	}

	function updateScatterChunkStreamingVisibilityAndGrace(): void {
		if (!scatterChunkStreamingEnabled) {
			return
		}
		const camera = options.getCamera()
		const groundMesh = getGroundObject()
		const store = scatterStore ?? ensureScatterStoreRef()
		const definition = getGroundDynamicMeshDefinition()
		if (!camera || !groundMesh || !definition || store.layers.size === 0) {
			return
		}

		// Ensure active chunks are up to date.
		updateScatterChunkStreaming(false)

		const now = nowMs()
		if (now - lastScatterChunkStreamingVisibilityUpdateAt < scatterChunkStreamingVisibilityUpdateIntervalMs) {
			return
		}
		lastScatterChunkStreamingVisibilityUpdateAt = now

		if (scatterChunkIndexDirty) {
			const chunkCells = resolveChunkCellsForDefinition(definition)
			rebuildScatterChunkIndexForStore(store, definition, chunkCells)
		}

		const visibleIds = computeScatterChunkStreamingVisibleIds(groundMesh, camera)
		scatterChunkStreamingLastFrustumVisibleIds = visibleIds
		visibleIds.forEach((id) => {
			scatterChunkStreamingLastVisibleAt.set(id, now)
		})

		// Release allocated instances that are outside frustum beyond grace time.
		for (const nodeId of Array.from(scatterChunkStreamingAllocatedNodeIds.values())) {
			if (visibleIds.has(nodeId)) {
				continue
			}
			const lastSeen = scatterChunkStreamingLastVisibleAt.get(nodeId) ?? 0
			if (scatterChunkStreamingCullGraceMs > 0 && now - lastSeen < scatterChunkStreamingCullGraceMs) {
				continue
			}
			const entry = scatterChunkEntryByNodeId.get(nodeId)
			if (entry) {
				scatterRuntimeAssetIdByNodeId.delete(nodeId)
				releaseScatterInstance(entry.instance)
			}
			scatterChunkStreamingAllocatedNodeIds.delete(nodeId)
		}

		// Enqueue visible-but-unbound instances for lazy binding.
		visibleIds.forEach((nodeId) => {
			if (scatterChunkStreamingAllocatedNodeIds.has(nodeId)) {
				return
			}
			const entry = scatterChunkEntryByNodeId.get(nodeId)
			if (!entry || !scatterActiveChunkKeys.has(entry.chunkKey)) {
				return
			}
			if (entry.instance.binding?.nodeId) {
				scatterChunkStreamingAllocatedNodeIds.add(nodeId)
				return
			}
			scatterChunkStreamingPendingBindIds.add(nodeId)
		})

		// Start async bind tasks with a per-tick budget.
		let started = 0
		const token = scatterChunkStreamingToken
		for (const nodeId of Array.from(scatterChunkStreamingPendingBindIds.values())) {
			if (started >= scatterChunkStreamingMaxBindingChangesPerUpdate) {
				break
			}
			if (pendingScatterChunkBindings.has(nodeId)) {
				continue
			}
			started += 1
			const task = bindScatterChunkStreamingNodeId(nodeId, token)
				.catch((error) => {
					console.warn('绑定可见散件失败', nodeId, error)
				})
				.finally(() => {
					pendingScatterChunkBindings.delete(nodeId)
					scatterChunkStreamingPendingBindIds.delete(nodeId)
				})
			pendingScatterChunkBindings.set(nodeId, task)
		}
	}

	function updateScatterChunkStreaming(force = false): void {
		if (!scatterChunkStreamingEnabled) {
			return
		}
		const camera = options.getCamera()
		const groundMesh = getGroundObject()
		const definition = getGroundDynamicMeshDefinition()
		const store = scatterStore ?? ensureScatterStoreRef()
		if (!camera || !groundMesh || !definition || store.layers.size === 0) {
			return
		}

		const now = Date.now()
		if (!force && now - lastScatterChunkStreamingUpdateAt < 80) {
			return
		}
		lastScatterChunkStreamingUpdateAt = now

		const chunkCells = resolveChunkCellsForDefinition(definition)
		if (scatterChunkIndexDirty) {
			rebuildScatterChunkIndexForStore(store, definition, chunkCells)
		}

		const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
		const chunkWorldSize = Math.max(1, Math.round(chunkCells)) * cellSize
		const radius = Number.isFinite(scatterChunkStreamingRadiusOverride)
			? Math.max(0, scatterChunkStreamingRadiusOverride)
			: resolveScatterChunkStreamingRadiusMeters(definition)
		const padding = Number.isFinite(scatterChunkStreamingPaddingOverride)
			? Math.max(0, scatterChunkStreamingPaddingOverride)
			: chunkWorldSize

		const cameraPosition = (camera as any)?.position as THREE.Vector3 | undefined
		if (!cameraPosition) {
			return
		}
		scatterChunkStreamingWorldCameraHelper.copy(cameraPosition)
		groundMesh.updateMatrixWorld(true)
		scatterChunkStreamingMatrixHelper.copy(groundMesh.matrixWorld).invert()
		scatterChunkStreamingLocalCameraHelper.copy(scatterChunkStreamingWorldCameraHelper).applyMatrix4(scatterChunkStreamingMatrixHelper)

		const desired = computeScatterChunkKeysInRadius(
			definition,
			chunkCells,
			scatterChunkStreamingLocalCameraHelper.x,
			scatterChunkStreamingLocalCameraHelper.z,
			radius,
		)
		const retain = computeScatterChunkKeysInRadius(
			definition,
			chunkCells,
			scatterChunkStreamingLocalCameraHelper.x,
			scatterChunkStreamingLocalCameraHelper.z,
			radius + padding,
		)

		const nextActive = new Set<string>()
		desired.forEach((key) => nextActive.add(key))
		scatterActiveChunkKeys.forEach((key) => {
			if (retain.has(key)) {
				nextActive.add(key)
			}
		})

		let chunkChanges = 0
		let didChange = false

		// Unload chunks outside retain window.
		for (const key of Array.from(scatterActiveChunkKeys.values())) {
			if (nextActive.has(key)) {
				continue
			}
			if (chunkChanges >= scatterChunkStreamingMaxChunkChangesPerUpdate) {
				break
			}
			didChange = true
			chunkChanges += 1
			scatterActiveChunkKeys.delete(key)
			const bucket = scatterChunkIndex.get(key) ?? []
			for (const entry of bucket) {
				const nodeId = buildScatterNodeId(entry.layer.id, entry.instance.id)
				scatterChunkStreamingPendingBindIds.delete(nodeId)
				scatterChunkStreamingAllocatedNodeIds.delete(nodeId)
				scatterChunkStreamingLastVisibleAt.delete(nodeId)
				scatterRuntimeAssetIdByNodeId.delete(nodeId)
				releaseScatterInstance(entry.instance)
			}
		}

		// Activate desired chunks and schedule binding.
		for (const key of Array.from(nextActive.values())) {
			if (scatterActiveChunkKeys.has(key)) {
				continue
			}
			if (!desired.has(key)) {
				continue
			}
			if (chunkChanges >= scatterChunkStreamingMaxChunkChangesPerUpdate) {
				break
			}
			didChange = true
			chunkChanges += 1
			scatterActiveChunkKeys.add(key)
		}

		if (didChange) {
			scatterChunkStreamingToken += 1
		}
	}

	function listScatterLayersForCategory(category: TerrainScatterCategory): TerrainScatterLayer[] {
		const store = ensureScatterStoreRef()
		return Array.from(store.layers.values()).filter((layer) => layer.category === category)
	}

	function findScatterLayerByAsset(assetId: string | null, category: TerrainScatterCategory): TerrainScatterLayer | null {
		const candidates = listScatterLayersForCategory(category)
		if (assetId) {
			return candidates.find((layer) => layer.assetId === assetId) ?? null
		}
		return candidates[0] ?? null
	}

	function ensureScatterLayerForAsset(asset: ProjectAsset, category: TerrainScatterCategory): TerrainScatterLayer {
		const existing = findScatterLayerByAsset(asset.id, category)
		if (existing) {
			return existing
		}
		const store = ensureScatterStoreRef()
		const preset = getScatterPreset(category)
		const layer = upsertTerrainScatterLayer(store, {
			assetId: asset.id,
			label: `${asset.name} ${preset.label}`.trim(),
			category,
			profileId: asset.id,
		})
		syncTerrainScatterSnapshotToScene(store)
		return layer
	}

	async function loadScatterModelGroup(asset: ProjectAsset): Promise<ModelInstanceGroup | null> {
		let group = getCachedModelObject(asset.id)
		if (group) {
			ensureInstancedMeshesRegistered(asset.id)
			return group
		}
		if (!assetCacheStore.hasCache(asset.id)) {
			console.warn('Scatter asset未缓存，无法加载', asset.id)
			return null
		}
		const file = assetCacheStore.createFileFromCache(asset.id)
		if (!file) {
			console.warn('无法读取散布资源文件', asset.id)
			return null
		}
		try {
			group = await getOrLoadModelObject(asset.id, async () => {
				const object = await loadObjectFromFile(file, asset.extension ?? undefined)
				normalizeScatterMaterials(object)
				return object
			})
			ensureInstancedMeshesRegistered(asset.id)
		} catch (error) {
			console.warn('加载散布资源失败', asset.id, error)
			return null
		} finally {
			assetCacheStore.releaseInMemoryBlob(asset.id)
		}
		return group
	}

	async function loadScatterModelGroupById(assetId: string): Promise<ModelInstanceGroup | null> {
		const asset = options.sceneStore.getAsset(assetId)
		if (!asset || (asset.type !== 'model' && asset.type !== 'mesh')) {
			return null
		}
		return loadScatterModelGroup(asset)
	}

	async function prepareScatterRuntime(asset: ProjectAsset, category: TerrainScatterCategory): Promise<void> {
		ensureScatterStoreRef()
		scatterLayer = ensureScatterLayerForAsset(asset, category)
		scatterAssetLoadToken += 1
		const token = scatterAssetLoadToken
		scatterModelGroup = null
		scatterResolvedBindingAssetId = null
		scatterResolvedLodPresetAssetId = null

		let bindingAssetId: string | null = asset.id
		let lodPresetAssetId: string | null = null
		if (asset.type === 'prefab') {
			await ensureScatterLodPresetCached(asset.id)
			const preset = scatterLodPresetCache.get(asset.id) ?? null
			const base = resolveLodBindingAssetId(preset)
			if (preset && base) {
				bindingAssetId = base
				lodPresetAssetId = asset.id
				const store = ensureScatterStoreRef()
				const layer = scatterLayer
				if (layer) {
					const payload = (layer.params?.payload && typeof layer.params.payload === 'object')
						? ({ ...(layer.params.payload as Record<string, unknown>) } as Record<string, unknown>)
						: ({} as Record<string, unknown>)
					if (payload.lodPresetAssetId !== asset.id) {
						payload.lodPresetAssetId = asset.id
						scatterLayer = upsertTerrainScatterLayer(store, { id: layer.id, params: { payload } })
						syncTerrainScatterSnapshotToScene(store)
					}
				}
			}
		}

		const group = bindingAssetId ? await loadScatterModelGroupById(bindingAssetId) : null
		if (token !== scatterAssetLoadToken) {
			return
		}
		scatterResolvedBindingAssetId = bindingAssetId
		scatterResolvedLodPresetAssetId = lodPresetAssetId
		scatterModelGroup = group
	}

	function persistScatterInstances(
		layer: TerrainScatterLayer,
		instances: TerrainScatterInstance[],
		optionsOverride: { markChunkIndexDirty?: boolean } = {},
	): TerrainScatterLayer | null {
		const store = ensureScatterStoreRef()
		const result = replaceTerrainScatterInstances(store, layer.id, instances)
		if (result && scatterLayer && scatterLayer.id === layer.id) {
			scatterLayer = result
		}
		if (result) {
			syncTerrainScatterSnapshotToScene(store, {
				bumpRuntimeVersion: false,
				runtimeSyncReason: 'editor-local-edit',
			})
			scatterSidecarPersistPending = true
			if (optionsOverride.markChunkIndexDirty !== false) {
				scatterChunkIndexDirty = true
			}
		}
		return result
	}

	function queueScatterSidecarSave(): void {
		if (!scatterSidecarPersistPending) {
			return
		}
		scatterSidecarSaveQueued = true
		if (pendingScatterSidecarSave) {
			return
		}

		const savePromise = (async () => {
			while (scatterSidecarSaveQueued) {
				scatterSidecarSaveQueued = false
				if (!scatterSidecarPersistPending) {
					continue
				}
				const groundNode = getGroundNodeFromScene()
				const sceneId = typeof options.sceneStore.currentSceneId === 'string'
					? options.sceneStore.currentSceneId.trim()
					: ''
				if (!sceneId || !groundNode || groundNode.dynamicMesh?.type !== 'Ground') {
					continue
				}
				const sidecar = useGroundScatterStore().buildSceneDocumentSidecar(sceneId, groundNode)
				try {
					await useScenesStore().saveSceneGroundScatterSidecar(sceneId, sidecar, { syncServer: false })
					scatterSidecarPersistPending = false
				} catch (error) {
					console.warn('保存散布 sidecar 失败', error)
					return
				}
			}
		})()

		pendingScatterSidecarSave = savePromise
		void savePromise.finally(() => {
			if (pendingScatterSidecarSave === savePromise) {
				pendingScatterSidecarSave = null
			}
			if (scatterSidecarSaveQueued && scatterSidecarPersistPending) {
				queueScatterSidecarSave()
			}
		})
	}

	function generateScatterInstanceId(): string {
		return `scatter_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
	}

	// scatter helpers now sourced from terrainScatterRuntime

	function updateBrushGeometry(shape: TerrainBrushShape) {
		const nextGeometry = tagBrushGeometry(createBrushGeometry(shape))
		const previousGeometry = brushMesh.geometry
		brushMesh.geometry = nextGeometry
		previousGeometry?.dispose()
	}

	function conformBrushToTerrain(definition: GroundDynamicMesh, groundObject: THREE.Object3D) {
		const geometry = brushMesh.geometry
		const positionAttribute = geometry.getAttribute('position')
		const basePositions = geometry.userData?.[BRUSH_BASE_POSITIONS_KEY] as Float32Array | undefined
		if (!positionAttribute || !basePositions) {
			return
		}
		const expectedLength = positionAttribute.count * 3
		if (basePositions.length !== expectedLength) {
			return
		}

		brushMesh.updateMatrixWorld(true)
		groundObject.updateMatrixWorld(true)

		for (let index = 0; index < positionAttribute.count; index += 1) {
			const baseIndex = index * 3
			brushBasePositionHelper.set(
				basePositions[baseIndex + 0] ?? 0,
				basePositions[baseIndex + 1] ?? 0,
				basePositions[baseIndex + 2] ?? 0,
			)

			brushWorldVertexHelper.copy(brushBasePositionHelper)
			brushMesh.localToWorld(brushWorldVertexHelper)

			groundLocalVertexHelper.copy(brushWorldVertexHelper)
			groundObject.worldToLocal(groundLocalVertexHelper)

			const height = sampleGroundHeight(definition, groundLocalVertexHelper.x, groundLocalVertexHelper.z)
			groundLocalVertexHelper.y = height

			groundWorldVertexHelper.copy(groundLocalVertexHelper)
			groundObject.localToWorld(groundWorldVertexHelper)

			brushResultVertexHelper.copy(groundWorldVertexHelper)
			brushMesh.worldToLocal(brushResultVertexHelper)
			positionAttribute.setXYZ(
				index,
				brushResultVertexHelper.x,
				brushResultVertexHelper.y + BRUSH_SURFACE_OFFSET,
				brushResultVertexHelper.z,
			)
		}

		positionAttribute.needsUpdate = true
	}

	function getGroundNodeFromScene(): SceneNode | null {
		return options.sceneStore.currentGroundNode
	}

	function getGroundTerrainScatterSnapshot(): TerrainScatterStoreSnapshot | null {
		const node = getGroundNodeFromScene()
		if (node?.dynamicMesh?.type !== 'Ground') {
			return null
		}
		const sceneId = typeof options.sceneStore.currentSceneId === 'string' ? options.sceneStore.currentSceneId.trim() : ''
		if (sceneId) {
			const runtimeState = useGroundScatterStore().getSceneGroundScatter(sceneId)
			if (runtimeState && runtimeState.nodeId === node.id && runtimeState.terrainScatter) {
				return runtimeState.terrainScatter
			}
		}
		const definition = node.dynamicMesh as GroundDynamicMesh & { terrainScatter?: TerrainScatterStoreSnapshot | null }
		return definition.terrainScatter ?? null
	}

	function getScatterSnapshotTimestamp(snapshot: TerrainScatterStoreSnapshot | null | undefined): number | null {
		if (!snapshot) {
			return null
		}
		const updated = snapshot.metadata?.updatedAt
		return Number.isFinite(updated) ? Number(updated) : null
	}

	function syncTerrainScatterSnapshotToScene(
		storeOverride?: TerrainScatterStore | null,
		syncOptions: {
			bumpRuntimeVersion?: boolean
			runtimeSyncReason?: string
		} = {},
	): void {
		const store = storeOverride ?? scatterStore
		if (!store) {
			return
		}
		const snapshot = serializeTerrainScatterStore(store)
		const groundNode = getGroundNodeFromScene()
		if (!groundNode || groundNode.dynamicMesh?.type !== 'Ground') {
			return
		}
		const sceneId = typeof options.sceneStore.currentSceneId === 'string'
			? options.sceneStore.currentSceneId.trim()
			: ''
		if (sceneId) {
			useGroundScatterStore().replaceTerrainScatter(sceneId, groundNode.id, snapshot, {
				bumpRuntimeVersion: syncOptions.bumpRuntimeVersion,
				reason: syncOptions.runtimeSyncReason,
			})
		}
		scatterSnapshotUpdatedAt = getScatterSnapshotTimestamp(snapshot)
	}

	function getGroundDynamicMeshDefinition(): GroundRuntimeDynamicMesh | null {
		const node = getGroundNodeFromScene()
		if (node?.dynamicMesh?.type === 'Ground') {
			const runtimeDefinition = useGroundHeightmapStore().resolveGroundRuntimeMesh(
				node.id,
				node.dynamicMesh as GroundDynamicMesh,
			)
			const sceneId = typeof options.sceneStore.currentSceneId === 'string'
				? options.sceneStore.currentSceneId.trim()
				: ''
			const paintRuntime = sceneId
				? useGroundPaintStore().getSceneGroundPaint(sceneId)
				: null
			const mergedRuntimeDefinition = paintRuntime && paintRuntime.nodeId === node.id
				? {
					...runtimeDefinition,
					terrainPaint: null,
					groundSurfaceChunks: cloneGroundSurfaceChunks(runtimeDefinition, node.id),
				}
				: runtimeDefinition
			if (sculptSessionState && sculptSessionState.nodeId === node.id) {
				return sculptSessionState.definition
			}
			return mergedRuntimeDefinition
		}
		return null
	}

	function getGroundObject(): THREE.Object3D | null {
		return options.objectMap.get(GROUND_NODE_ID) ?? null
	}

	function ensureSculptSession(definition: GroundRuntimeDynamicMesh, nodeId: string): GroundRuntimeDynamicMesh {
		if (sculptSessionState && sculptSessionState.nodeId === nodeId) {
			return sculptSessionState.definition
		}
		// PERF: Cloning a very large sparse heightMap can stall the UI for seconds.
		// Sculpt currently has no cancel/revert flow, so we avoid the full clone and mutate the existing map.
		const sessionDefinition = definition
		const clonedHeightMap = sessionDefinition.manualHeightMap
		sculptSessionState = {
			nodeId,
			definition: sessionDefinition,
			heightMap: clonedHeightMap,
			dirty: false,
			affectedRegion: null,
			touchedChunkKeys: new Set<string>(),
		}
		return sessionDefinition
	}


	function commitSculptSession(selectedNode: SceneNode | null): boolean {
		if (!sculptSessionState || !sculptSessionState.dirty) {
			sculptSessionState = null
			return false
		}
		let targetNode = selectedNode
		if (!targetNode || targetNode.id !== sculptSessionState.nodeId) {
			const sceneNode = getGroundNodeFromScene()
			targetNode = sceneNode && sceneNode.id === sculptSessionState.nodeId ? sceneNode : null
		}
		if (!targetNode || targetNode.dynamicMesh?.type !== 'Ground') {
			sculptSessionState = null
			return false
		}
		const committedDefinition = sculptSessionState.definition
		options.sceneStore.commitGroundHeightMapEdit(
			targetNode.id,
			committedDefinition,
			sculptSessionState.heightMap,
		)
		const groundObject = getGroundObject()
		if (groundObject) {
			options.onSculptCommitApplied?.({ groundObject, definition: committedDefinition })
		}
		sculptSessionState = null
		return true
	}

	function revokePaintPreviewUrls(session: PaintSessionState | null): void {
		if (!session) {
			return
		}
		session.chunkStates.forEach((chunk) => {
			if (chunk.previewUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
				URL.revokeObjectURL(chunk.previewUrl)
			}
			chunk.previewUrl = null
		})
	}

	function ensurePaintSession(definition: GroundDynamicMesh, nodeId: string): PaintSessionState {
		if (paintSessionState && paintSessionState.nodeId === nodeId) {
			return paintSessionState
		}
		revokePaintPreviewUrls(paintSessionState)
		const chunkCells = resolveGroundChunkCells(definition)
		paintSessionState = {
			nodeId,
			definition,
			chunkCells,
			chunkStates: new Map(),
			hasPendingChanges: false,
			terrainPaintSurfacePreviewRevision: 0,
			liveSurfacePreviewPendingChunkKeys: new Map(),
			liveSurfacePreviewFlushRafId: null,
			terrainPaintSurfacePreviewDebounceTimerId: null,
			previewGroundSurfaceChunks: cloneGroundSurfaceChunks(definition, nodeId),
			previewEmitToken: 0,
		}
		return paintSessionState
	}

	async function buildLiveTerrainPaintGroundSurfaceChunks(
		session: PaintSessionState,
		chunkKeys: Set<string> | null = null,
	): Promise<GroundSurfaceChunkTextureMap | null> {
		const nextChunks = session.previewGroundSurfaceChunks ? JSON.parse(JSON.stringify(session.previewGroundSurfaceChunks)) as GroundSurfaceChunkTextureMap : {}
		for (const chunk of session.chunkStates.values()) {
			if (chunkKeys && !chunkKeys.has(chunk.key)) {
				continue
			}
			if (!chunk.dirty || chunk.previewEncodedRevision === chunk.surfaceRevision) {
				continue
			}
			const blob = await encodePaintSurfaceDataToBlob(chunk.surfaceData, chunk.resolution)
			if (!blob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
				continue
			}
			if (chunk.previewUrl && typeof URL.revokeObjectURL === 'function') {
				URL.revokeObjectURL(chunk.previewUrl)
			}
			chunk.previewUrl = URL.createObjectURL(blob)
			nextChunks[chunk.key] = {
				textureAssetId: chunk.previewUrl,
				revision: session.terrainPaintSurfacePreviewRevision,
			}
			chunk.previewEncodedRevision = chunk.surfaceRevision
		}
		session.previewGroundSurfaceChunks = nextChunks
		return nextChunks
	}

	async function emitTerrainPaintSurfacePreview(
		session: PaintSessionState,
		mode: 'live' | 'surface-rebuild',
		chunkKeys: Set<string> | null = null,
	): Promise<void> {
		if (!options.onTerrainPaintSurfacePreviewChanged) {
			return
		}
		const groundObject = getGroundObject()
		const groundNode = getGroundNodeFromScene()
		if (!groundObject || !groundNode || groundNode.id !== session.nodeId || groundNode.dynamicMesh?.type !== 'Ground') {
			return
		}
		const emitToken = ++session.previewEmitToken
		const expectedRevision = session.terrainPaintSurfacePreviewRevision
		if (mode === 'live') {
			const liveChunkPreviews = buildLiveTerrainPaintChunkPreviews(session, chunkKeys)
			if (
				paintSessionState !== session
				|| session.previewEmitToken !== emitToken
				|| session.terrainPaintSurfacePreviewRevision !== expectedRevision
			) {
				return
			}
			if (!liveChunkPreviews.length) {
				return
			}
			options.onTerrainPaintSurfacePreviewChanged({
				groundObject,
				groundNode,
				dynamicMesh: {
					...session.definition,
				},
				previewRevision: session.terrainPaintSurfacePreviewRevision,
				mode,
				liveChunkPreviews,
			})
			return
		}
		const liveGroundSurfaceChunks = await buildLiveTerrainPaintGroundSurfaceChunks(session, chunkKeys)
		if (
			paintSessionState !== session
			|| session.previewEmitToken !== emitToken
			|| session.terrainPaintSurfacePreviewRevision !== expectedRevision
		) {
			return
		}
		options.onTerrainPaintSurfacePreviewChanged({
			groundObject,
			groundNode,
			dynamicMesh: {
				...session.definition,
				terrainPaint: null,
				groundSurfaceChunks: liveGroundSurfaceChunks,
			},
			previewRevision: session.terrainPaintSurfacePreviewRevision,
			mode,
				liveChunkPreviews: null,
		})
	}

	function scheduleTerrainPaintSurfacePreviewRebuild(session: PaintSessionState): void {
		if (session.terrainPaintSurfacePreviewDebounceTimerId !== null) {
			window.clearTimeout(session.terrainPaintSurfacePreviewDebounceTimerId)
		}
		session.terrainPaintSurfacePreviewDebounceTimerId = window.setTimeout(() => {
			session.terrainPaintSurfacePreviewDebounceTimerId = null
			if (paintSessionState !== session) {
				return
			}
			void emitTerrainPaintSurfacePreview(session, 'surface-rebuild')
		}, TERRAIN_PAINT_SURFACE_PREVIEW_DEBOUNCE_MS)
	}

	function scheduleTerrainPaintLiveSurfacePreviewFlush(session: PaintSessionState): void {
		if (session.liveSurfacePreviewFlushRafId !== null) {
			return
		}
		session.liveSurfacePreviewFlushRafId = window.requestAnimationFrame(() => {
			session.liveSurfacePreviewFlushRafId = null
			const pendingChunkKeys = flushTerrainPaintLiveSurfacePreview(session)
			if (!pendingChunkKeys || !pendingChunkKeys.size) {
				return
			}
			void emitTerrainPaintSurfacePreview(session, 'live', pendingChunkKeys)
		})
	}

	function enqueueTerrainPaintLiveSurfacePreviewChunkKey(session: PaintSessionState, chunkKey: string): void {
		const trimmed = typeof chunkKey === 'string' ? chunkKey.trim() : ''
		if (!trimmed) {
			return
		}
		// LRU behavior: re-insert to update recency.
		if (session.liveSurfacePreviewPendingChunkKeys.has(trimmed)) {
			session.liveSurfacePreviewPendingChunkKeys.delete(trimmed)
		}
		session.liveSurfacePreviewPendingChunkKeys.set(trimmed, true)
		while (session.liveSurfacePreviewPendingChunkKeys.size > TERRAIN_PAINT_LIVE_SURFACE_PREVIEW_FLUSH_CHUNKS_MAX) {
			const oldest = session.liveSurfacePreviewPendingChunkKeys.keys().next().value as string | undefined
			if (!oldest) {
				break
			}
			session.liveSurfacePreviewPendingChunkKeys.delete(oldest)
		}
		scheduleTerrainPaintLiveSurfacePreviewFlush(session)
	}

	function flushTerrainPaintLiveSurfacePreview(session: PaintSessionState): Set<string> | null {
		// Session may have been replaced due to scene/node switching.
		if (paintSessionState !== session) {
			return null
		}
		if (!session.liveSurfacePreviewPendingChunkKeys.size) {
			return null
		}
		const pendingChunkKeys = new Set(session.liveSurfacePreviewPendingChunkKeys.keys())
		session.liveSurfacePreviewPendingChunkKeys.clear()
		return pendingChunkKeys
	}

	function queueTerrainPaintLiveSurfacePreviewChunk(session: PaintSessionState, chunk: PaintChunkState): void {
		session.terrainPaintSurfacePreviewRevision += 1
		enqueueTerrainPaintLiveSurfacePreviewChunkKey(session, chunk.key)
		scheduleTerrainPaintSurfacePreviewRebuild(session)
	}

	function ensurePaintChunkState(session: PaintSessionState, payload: { key: string; chunkRow: number; chunkColumn: number }): PaintChunkState {
		const existing = session.chunkStates.get(payload.key)
		if (existing) {
			return existing
		}
		const resolution = resolveTerrainPaintChunkScratchResolution(session, payload.chunkRow, payload.chunkColumn)
		const state: PaintChunkState = {
			key: payload.key,
			chunkRow: payload.chunkRow,
			chunkColumn: payload.chunkColumn,
			resolution,
			surfaceData: createBlankPaintSurfaceData(resolution),
			surfaceRevision: 0,
			previewEncodedRevision: 0,
			status: 'ready',
			loadPromise: null,
			pendingStamps: [],
			previewUrl: null,
			dirty: false,
			previewCanvas: null,
			previewContext: null,
			previewImageData: null,
			previewCanvasRevision: 0,
		}
		session.chunkStates.set(payload.key, state)

		const chunkRef = session.previewGroundSurfaceChunks?.[payload.key] ?? null
		const textureAssetId = typeof chunkRef?.textureAssetId === 'string' ? chunkRef.textureAssetId.trim() : ''
		const hasPersistedChunkTexture = Boolean(textureAssetId)
		if (textureAssetId) {
			state.status = 'loading'
			state.loadPromise = (async () => {
				try {
					const cache = useAssetCacheStore()
					let entry = cache.getEntry(textureAssetId)
					let blob: Blob | null = entry.status === 'cached' ? (entry.blob ?? null) : null
					if (!blob) {
						entry = (await cache.loadFromIndexedDb(textureAssetId)) ?? entry
						blob = entry.status === 'cached' ? (entry.blob ?? null) : null
					}
					if (!blob) {
						const response = await fetch(textureAssetId, { credentials: 'include' }).catch(() => null)
						blob = response?.ok ? await response.blob() : null
					}
					if (!blob) {
						return
					}
					const source = await blobToCanvasImageSource(blob)
					if (!source) {
						return
					}
					state.surfaceData = normalizeSurfaceDataToStraightAlpha(extractChunkSurfaceDataAtResolution(source, resolution))
					state.surfaceRevision = 1
					state.previewEncodedRevision = 1
				} catch (error) {
					console.warn('加载地貌表面块失败，回退到空白贴图：', error)
					state.surfaceData = createBlankPaintSurfaceData(state.resolution)
					state.surfaceRevision = 0
					state.previewEncodedRevision = 0
				} finally {
					state.status = 'ready'
					state.loadPromise = null
					if (state.pendingStamps.length) {
						const pending = [...state.pendingStamps]
						state.pendingStamps.length = 0
						pending.forEach((stamp) => {
							applyPaintStampToChunk(session, state, stamp)
						})
					} else if (!hasPersistedChunkTexture) {
						queueTerrainPaintLiveSurfacePreviewChunk(session, state)
					}
				}
			})()
		}

		return state
	}

	function applyPaintStampToChunk(session: PaintSessionState, chunk: PaintChunkState, stamp: TerrainPaintStampRequest): void {
		const definition = session.definition
		const bounds = resolvePaintChunkBounds(definition, session.chunkCells, chunk.chunkRow, chunk.chunkColumn)
		if (!bounds) {
			return
		}
		const radius = stamp.radius
		if (!Number.isFinite(radius) || radius <= 0) {
			return
		}
		const res = Math.max(1, Math.round(chunk.resolution))
		const cxMeters = stamp.localX - bounds.minX
		const czMeters = stamp.localZ - bounds.minZ
		const centerX = (cxMeters / bounds.width) * res
		const centerY = (czMeters / bounds.depth) * res
		const radiusX = (radius / bounds.width) * res
		const radiusY = (radius / bounds.depth) * res
		const minX = THREE.MathUtils.clamp(Math.floor(centerX - radiusX - 1), 0, res - 1)
		const maxX = THREE.MathUtils.clamp(Math.ceil(centerX + radiusX + 1), 0, res - 1)
		const minY = THREE.MathUtils.clamp(Math.floor(centerY - radiusY - 1), 0, res - 1)
		const maxY = THREE.MathUtils.clamp(Math.ceil(centerY + radiusY + 1), 0, res - 1)
		const strength = clamp01(stamp.strength)
		if (strength <= 0) {
			return
		}
		const feather = clamp01(stamp.feather)
		const opacity = stamp.sampling.opacity
		if (opacity <= 0) {
			return
		}
		const radiusSq = radius * radius
		const safeRadiusSq = Math.max(radiusSq, 1e-6)
		const pixelWidth = bounds.width / res
		const pixelDepth = bounds.depth / res
		const definitionWidth = Math.max(definition.width, 1e-6)
		const definitionDepth = Math.max(definition.depth, 1e-6)
		const halfWidth = definition.width * 0.5
		const halfDepth = definition.depth * 0.5
		const invDefinitionWidth = 1 / definitionWidth
		const invDefinitionDepth = 1 / definitionDepth
		const invLocalBrushWidth = 1 / Math.max(radiusX * 2, 1e-6)
		const invLocalBrushHeight = 1 / Math.max(radiusY * 2, 1e-6)
		const eraseMode = stamp.mode === 'erase'
		const sampledColor = eraseMode ? null : new Float32Array(4)
		const surfaceData = chunk.surfaceData
		const sampling = stamp.sampling
		const blendMode = sampling.blendMode
		const brushImage = stamp.brushImage
		let any = false
		let pzMeters = (minY + 0.5) * pixelDepth
		for (let y = minY; y <= maxY; y += 1, pzMeters += pixelDepth) {
			const dz = pzMeters - czMeters
			const worldZ = bounds.minZ + pzMeters
			const normalizedMeshV = (worldZ + halfDepth) * invDefinitionDepth
			const meshV = normalizedMeshV <= 0 ? 0 : normalizedMeshV >= 1 ? 1 : normalizedMeshV
			const normalizedLocalBrushV = ((y + 0.5) - (centerY - radiusY)) * invLocalBrushHeight
			const localBrushV = normalizedLocalBrushV <= 0 ? 0 : normalizedLocalBrushV >= 1 ? 1 : normalizedLocalBrushV
			let pxMeters = (minX + 0.5) * pixelWidth
			for (let x = minX; x <= maxX; x += 1, pxMeters += pixelWidth) {
				const dx = pxMeters - cxMeters
				const distSq = dx * dx + dz * dz
				if (distSq >= radiusSq) {
					continue
				}
				const falloff = computeSoftBrushFalloff(distSq / safeRadiusSq, feather)
				const amount = clamp01(strength * opacity * falloff)
				if (amount <= 0) {
					continue
				}
				const offset = (y * res + x) * 4
				const destAlpha = (surfaceData[offset + 3] ?? 0) / 255
				const baseAlpha = destAlpha <= 0 ? 0 : destAlpha >= 1 ? 1 : destAlpha
				if (eraseMode) {
					const nextAlpha = Math.max(0, baseAlpha - amount)
					const nextA = Math.round(nextAlpha * 255)
					const nextR = nextA > 0 ? (surfaceData[offset] ?? 0) : 0
					const nextG = nextA > 0 ? (surfaceData[offset + 1] ?? 0) : 0
					const nextB = nextA > 0 ? (surfaceData[offset + 2] ?? 0) : 0
					if (
						nextR !== (surfaceData[offset] ?? 0)
						|| nextG !== (surfaceData[offset + 1] ?? 0)
						|| nextB !== (surfaceData[offset + 2] ?? 0)
						|| nextA !== (surfaceData[offset + 3] ?? 0)
					) {
						surfaceData[offset] = nextR
						surfaceData[offset + 1] = nextG
						surfaceData[offset + 2] = nextB
						surfaceData[offset + 3] = nextA
						any = true
					}
					continue
				}
				if (!sampledColor || !brushImage) {
					continue
				}
				const worldX = bounds.minX + pxMeters
				const normalizedMeshU = (worldX + halfWidth) * invDefinitionWidth
				const meshU = normalizedMeshU <= 0 ? 0 : normalizedMeshU >= 1 ? 1 : normalizedMeshU
				const normalizedLocalBrushU = ((x + 0.5) - (centerX - radiusX)) * invLocalBrushWidth
				const localBrushU = normalizedLocalBrushU <= 0 ? 0 : normalizedLocalBrushU >= 1 ? 1 : normalizedLocalBrushU
				sampleTerrainPaintBrushColor(
					localBrushU,
					localBrushV,
					meshU,
					meshV,
					sampling,
					brushImage,
					sampledColor,
				)
				const sampleColorR = sampledColor[0] ?? 0
				const sampleColorG = sampledColor[1] ?? 0
				const sampleColorB = sampledColor[2] ?? 0
				const sampleColorA = sampledColor[3] ?? 0
				const sampleAlpha = sampleColorA <= 0 ? 0 : sampleColorA >= 1 ? 1 : sampleColorA
				const blendedAmountRaw = amount * sampleAlpha
				const blendedAmount = blendedAmountRaw <= 0 ? 0 : blendedAmountRaw >= 1 ? 1 : blendedAmountRaw
				if (blendedAmount <= 0) {
					continue
				}
				const baseR = baseAlpha <= 0 ? 0 : ((surfaceData[offset] ?? 0) / 255)
				const baseG = baseAlpha <= 0 ? 0 : ((surfaceData[offset + 1] ?? 0) / 255)
				const baseB = baseAlpha <= 0 ? 0 : ((surfaceData[offset + 2] ?? 0) / 255)
				const layerR = sampleColorR <= 0 ? 0 : sampleColorR >= 1 ? 1 : sampleColorR
				const layerG = sampleColorG <= 0 ? 0 : sampleColorG >= 1 ? 1 : sampleColorG
				const layerB = sampleColorB <= 0 ? 0 : sampleColorB >= 1 ? 1 : sampleColorB

				let blendedR = layerR
				let blendedG = layerG
				let blendedB = layerB
				switch (blendMode) {
					case 'multiply':
						blendedR = baseR * layerR
						blendedG = baseG * layerG
						blendedB = baseB * layerB
						break
					case 'screen':
						blendedR = 1 - (1 - baseR) * (1 - layerR)
						blendedG = 1 - (1 - baseG) * (1 - layerG)
						blendedB = 1 - (1 - baseB) * (1 - layerB)
						break
					case 'overlay':
						blendedR = baseR < 0.5 ? 2 * baseR * layerR : 1 - 2 * (1 - baseR) * (1 - layerR)
						blendedG = baseG < 0.5 ? 2 * baseG * layerG : 1 - 2 * (1 - baseG) * (1 - layerG)
						blendedB = baseB < 0.5 ? 2 * baseB * layerB : 1 - 2 * (1 - baseB) * (1 - layerB)
						break
				}

				const nextAlpha = blendedAmount + baseAlpha * (1 - blendedAmount)
				let nextR = 0
				let nextG = 0
				let nextB = 0
				if (nextAlpha > 1e-6) {
					const invNextAlpha = 1 / nextAlpha
					nextR = Math.round((((blendedR * blendedAmount) + (baseR * baseAlpha * (1 - blendedAmount))) * invNextAlpha) * 255)
					nextG = Math.round((((blendedG * blendedAmount) + (baseG * baseAlpha * (1 - blendedAmount))) * invNextAlpha) * 255)
					nextB = Math.round((((blendedB * blendedAmount) + (baseB * baseAlpha * (1 - blendedAmount))) * invNextAlpha) * 255)
				}
				const nextA = Math.round(nextAlpha * 255)
				if (
					nextR !== (surfaceData[offset] ?? 0)
					|| nextG !== (surfaceData[offset + 1] ?? 0)
					|| nextB !== (surfaceData[offset + 2] ?? 0)
					|| nextA !== (surfaceData[offset + 3] ?? 0)
				) {
					surfaceData[offset] = nextR
					surfaceData[offset + 1] = nextG
					surfaceData[offset + 2] = nextB
					surfaceData[offset + 3] = nextA
					any = true
				}
			}
		}
		if (any) {
			const becameDirty = !chunk.dirty
			chunk.dirty = true
			chunk.surfaceRevision += 1
			queueTerrainPaintLiveSurfacePreviewChunk(session, chunk)
			if (becameDirty && !session.hasPendingChanges) {
				session.hasPendingChanges = true
			}
		}
	}

	function hasDirtyPaintChunks(session: PaintSessionState | null): boolean {
		if (!session) {
			return false
		}
		for (const chunk of session.chunkStates.values()) {
			if (chunk.dirty) {
				return true
			}
		}
		return false
	}

	function flushTerrainPaintChanges(): Promise<boolean> {
		if (pendingTerrainPaintFlush) {
			return pendingTerrainPaintFlush
		}

		const flushPromise = (async () => {
			for (let attempts = 0; attempts < 16; attempts += 1) {
				if (!hasDirtyPaintChunks(paintSessionState)) {
					return true
				}
				const ok = await commitPaintSession(options.sceneStore.selectedNode ?? null)
				if (!ok && hasDirtyPaintChunks(paintSessionState)) {
					return false
				}
			}
			return !hasDirtyPaintChunks(paintSessionState)
		})()

		pendingTerrainPaintFlush = flushPromise
		void flushPromise.finally(() => {
			if (pendingTerrainPaintFlush === flushPromise) {
				pendingTerrainPaintFlush = null
			}
		})
		return flushPromise
	}

	async function commitPaintSession(selectedNode: SceneNode | null): Promise<boolean> {
		if (!paintSessionState) {
			return false
		}
		const session = paintSessionState
		if (!session.chunkStates.size) {
			return false
		}
		let targetNode = selectedNode
		if (!targetNode || targetNode.id !== session.nodeId) {
			const sceneNode = getGroundNodeFromScene()
			targetNode = sceneNode && sceneNode.id === session.nodeId ? sceneNode : null
		}
		if (!targetNode || targetNode.dynamicMesh?.type !== 'Ground') {
			return false
		}
		const dirtyChunks = Array.from(session.chunkStates.values()).filter((chunk) => chunk.dirty)
		if (!dirtyChunks.length) {
			return false
		}

		// Persist layer texture asset mapping so terrain paint can be restored after reload.
		// We only register after we have actual paint data to persist (i.e. at least one dirty chunk).
		const paintAsset = options.paintAsset.value
		if (paintAsset?.id) {
			const existing = options.sceneStore.findAssetInCatalog(paintAsset.id)
			if (!existing) {
				options.sceneStore.registerAssets([paintAsset], {
					source: { type: 'package', providerId: assetProvider.id, originalAssetId: paintAsset.id },
					commitOptions: { updateNodes: false },
					autoSave: false,
				})
			}
		}

		const token = (paintCommitToken += 1)
		try {
			await Promise.all(
				dirtyChunks
					.map((chunk) => chunk.loadPromise)
					.filter((promise): promise is Promise<void> => Boolean(promise)),
			)
			if (token !== paintCommitToken) {
				return false
			}

			let nextGroundSurfaceChunks = cloneGroundSurfaceChunks(session.definition, session.nodeId)

			for (const chunk of dirtyChunks) {
				if (token !== paintCommitToken) {
					return false
				}
				chunk.dirty = false
			}
			nextGroundSurfaceChunks = await bakeDirtyGroundSurfaceChunks({
				session,
				dirtyChunks,
				previewRevision: session.terrainPaintSurfacePreviewRevision,
				groundSurfaceChunks: nextGroundSurfaceChunks,
				registerAssets: options.sceneStore.registerAssets.bind(options.sceneStore),
			})
			if (token !== paintCommitToken) {
				return false
			}
			const sceneId = typeof options.sceneStore.currentSceneId === 'string'
				? options.sceneStore.currentSceneId.trim()
				: ''
			if (!sceneId) {
				return false
			}
			useGroundPaintStore().replaceGroundSurfaceChunks(sceneId, session.nodeId, nextGroundSurfaceChunks, {
				bumpRuntimeVersion: true,
				reason: 'editor-local-paint',
			})
			if (targetNode.dynamicMesh?.type === 'Ground') {
				targetNode.dynamicMesh.terrainPaint = null
			}
			const sidecar = useGroundPaintStore().buildSceneDocumentSidecar(sceneId, targetNode)
			void useScenesStore().saveSceneGroundPaintSidecar(sceneId, sidecar, { syncServer: false }).catch((error) => {
				console.warn('保存地形 paint sidecar 失败', error)
			})
			paintSessionState = null
			return true
		} catch (error) {
			console.warn('提交地貌权重贴图失败：', error)
			return false
		}
	}

	function raycastGroundPoint(event: PointerEvent, result: THREE.Vector3): boolean {
		const camera = options.getCamera()
		if (!camera || !options.canvasRef.value) {
			return false
		}
		const rect = options.canvasRef.value.getBoundingClientRect()
		if (rect.width === 0 || rect.height === 0) {
			return false
		}
		options.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
		options.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
		options.raycaster.setFromCamera(options.pointer, camera)
		return !!options.raycaster.ray.intersectPlane(options.groundPlane, result)
	}

	function clampPointToGround(definition: GroundDynamicMesh, point: THREE.Vector3): THREE.Vector3 {
		const halfWidth = definition.width * 0.5
		const halfDepth = definition.depth * 0.5
		point.x = THREE.MathUtils.clamp(point.x, -halfWidth, halfWidth)
		point.z = THREE.MathUtils.clamp(point.z, -halfDepth, halfDepth)
		return point
	}

	function getGroundCellFromPoint(definition: GroundDynamicMesh, point: THREE.Vector3): { row: number; column: number } {
		const halfWidth = definition.width * 0.5
		const halfDepth = definition.depth * 0.5
		const normalizedColumn = (point.x + halfWidth) / definition.cellSize
		const normalizedRow = (point.z + halfDepth) / definition.cellSize
		const column = THREE.MathUtils.clamp(Math.floor(normalizedColumn), 0, Math.max(0, definition.columns - 1))
		const row = THREE.MathUtils.clamp(Math.floor(normalizedRow), 0, Math.max(0, definition.rows - 1))
		return { row, column }
	}

	function isGroundBuildToolActive(): boolean {
		const tool = options.activeBuildTool.value
		return tool === 'terrain' || tool === 'paint' || tool === 'scatter'
	}

	function scatterModeEnabled(): boolean {
		if (options.activeBuildTool.value !== 'scatter') {
			return false
		}
		if (options.scatterEraseModeActive.value) {
			return false
		}
		if (options.groundPanelTab.value === 'terrain' || options.groundPanelTab.value === 'paint') {
			return false
		}
		if (!options.scatterAsset.value) {
			return false
		}
		return getGroundNodeFromScene()?.dynamicMesh?.type === 'Ground'
	}

	function paintModeEnabled(): boolean {
		if (options.activeBuildTool.value !== 'paint') {
			return false
		}
		if (options.scatterEraseModeActive.value) {
			return false
		}
		if (options.groundPanelTab.value !== 'paint') {
			return false
		}
		return getGroundNodeFromScene()?.dynamicMesh?.type === 'Ground'
	}

	function getScatterPreset(category: TerrainScatterCategory) {
		return terrainScatterPresets[category] ?? {
			label: 'Scatter',
			icon: 'mdi-cube-outline',
			path: '',
			minScale: 0.9,
			maxScale: 1.1,
		}
	}

	function isScatterPlacementAvailable(point: THREE.Vector3, spacing: number, session: ScatterSessionState): boolean {
		const layer = session.layer
		if (!layer) {
			return false
		}
		const threshold = spacing * spacing
		const mesh = session.groundMesh
		mesh.updateMatrixWorld(true)
		scatterPlacementCandidateLocalHelper.copy(point)
		mesh.worldToLocal(scatterPlacementCandidateLocalHelper)
		const budget = { totalChecks: 0 }
		if (session.neighborIndex && session.neighborIndex.size) {
			return isScatterPlacementAvailableByIndex(
				session,
				scatterPlacementCandidateLocalHelper.x,
				scatterPlacementCandidateLocalHelper.z,
				threshold,
				budget,
			)
		}
		for (const instance of layer.instances) {
			const local = instance.localPosition
			const dx = (local?.x ?? 0) - scatterPlacementCandidateLocalHelper.x
			const dz = (local?.z ?? 0) - scatterPlacementCandidateLocalHelper.z
			if (dx * dx + dz * dz < threshold) {
				return false
			}
		}
		return true
	}

	function resolveScatterSpacing(): number {
		const candidate = Number(options.scatterSpacing.value)
		return Math.min(SCATTER_BRUSH_RADIUS_MAX, Math.max(0.1, Number.isFinite(candidate) ? candidate : 1))
	}

	function projectScatterPointToGround(
		definition: GroundDynamicMesh,
		groundMesh: THREE.Object3D,
		worldPoint: THREE.Vector3,
	): THREE.Vector3 | null {
		const localPoint = worldPoint.clone()
		groundMesh.worldToLocal(localPoint)
		const halfWidth = definition.width * 0.5
		const halfDepth = definition.depth * 0.5
		if (
			!Number.isFinite(localPoint.x) ||
			!Number.isFinite(localPoint.z) ||
			localPoint.x < -halfWidth ||
			localPoint.x > halfWidth ||
			localPoint.z < -halfDepth ||
			localPoint.z > halfDepth
		) {
			return null
		}
		const height = sampleGroundHeight(definition, localPoint.x, localPoint.z)
		localPoint.y = height
		groundMesh.localToWorld(localPoint)
		return localPoint
	}

	function resolveScatterPointFromEvent(
		event: PointerEvent,
		definition: GroundDynamicMesh,
		groundMesh: THREE.Object3D,
	): THREE.Vector3 | null {
		if (!raycastGroundPoint(event, scatterPointerHelper)) {
			options.clearVertexSnap?.()
			return null
		}
		if (!isPointerOverGround(definition, groundMesh, scatterPointerHelper)) {
			options.clearVertexSnap?.()
			return null
		}
		const projected = projectScatterPointToGround(definition, groundMesh, scatterPointerHelper)
		if (!projected) {
			options.clearVertexSnap?.()
			return null
		}
		const snapped = options.resolveVertexSnapPoint?.(event, projected.clone())
		if (!snapped) {
			return projected
		}
		return projectScatterPointToGround(definition, groundMesh, snapped) ?? projected
	}

	function resolveRawScatterPointFromEvent(
		event: PointerEvent,
		definition: GroundDynamicMesh,
		groundMesh: THREE.Object3D,
	): THREE.Vector3 | null {
		if (!raycastGroundPoint(event, scatterPointerHelper)) {
			return null
		}
		if (!isPointerOverGround(definition, groundMesh, scatterPointerHelper)) {
			return null
		}
		return projectScatterPointToGround(definition, groundMesh, scatterPointerHelper)
	}

	function projectScatterPoint(worldPoint: THREE.Vector3): THREE.Vector3 | null {
		if (!scatterSession) {
			return null
		}
		return projectScatterPointToGround(scatterSession.definition, scatterSession.groundMesh, worldPoint)
	}

	function applyScatterPlacement(worldPoint: THREE.Vector3, optionsOverride?: { yaw?: number | null }): boolean {
		if (!scatterSession || !scatterSession.layer || !scatterSession.modelGroup) {
			return false
		}
		const projected = projectScatterPoint(worldPoint)
		if (!projected) {
			return false
		}
		const localPoint = projected.clone()
		scatterSession.groundMesh.worldToLocal(localPoint)
		const scaleFactor = THREE.MathUtils.lerp(scatterSession.minScale, scatterSession.maxScale, Math.random())
		const rotation = new THREE.Vector3(0, optionsOverride?.yaw ?? Math.random() * Math.PI * 2, 0)
		const scale = new THREE.Vector3(scaleFactor, scaleFactor, scaleFactor)
		const draft: TerrainScatterInstance = {
			id: generateScatterInstanceId(),
			// Persist the selected scatter asset id (may be a LOD preset).
			assetId: scatterSession.asset.id,
			layerId: scatterSession.layer.id,
			profileId: scatterSession.lodPresetAssetId ?? scatterSession.layer.profileId ?? scatterSession.asset.id,
			seed: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
			localPosition: { x: localPoint.x, y: localPoint.y, z: localPoint.z },
			localRotation: { x: rotation.x, y: rotation.y, z: rotation.z },
			localScale: { x: scale.x, y: scale.y, z: scale.z },
			groundCoords: {
				x: localPoint.x,
				z: localPoint.z,
				height: localPoint.y,
				normal: null,
			},
			binding: null,
			metadata: null,
		}
		const nextLayer = persistScatterInstances(scatterSession.layer, [...scatterSession.layer.instances, draft])
		if (!nextLayer) {
			return false
		}
		scatterSession.layer = nextLayer
		const stored = nextLayer.instances.find((entry) => entry.id === draft.id)
		if (!stored) {
			return false
		}
		scatterSession.groundMesh.updateMatrixWorld(true)
		scatterGroundWorldMatrixHelper.copy(scatterSession.groundMesh.matrixWorld)
		const matrix = composeScatterMatrix(stored, scatterSession.groundMesh, scatterWorldMatrixHelper, scatterGroundWorldMatrixHelper)
		const bound = bindScatterInstance(stored, matrix, scatterSession.bindingAssetId)
		if (!bound) {
			persistScatterInstances(nextLayer, nextLayer.instances.filter((entry) => entry.id !== stored.id))
			return false
		}
		scatterRuntimeAssetIdByNodeId.set(buildScatterNodeId(nextLayer.id, stored.id), scatterSession.bindingAssetId)
		addScatterInstanceToNeighborIndex(scatterSession, stored)
		return true
	}

	function resolveScatterStampYaw(session: ScatterSessionState): number {
		if (session.brushShape !== 'line' || !session.anchorPoint || !session.currentPoint) {
			return 0
		}
		return Math.atan2(
			session.currentPoint.x - session.anchorPoint.x,
			session.currentPoint.z - session.anchorPoint.z,
		)
	}

	function clearScatterSessionPreviewInstances(session: ScatterSessionState | null): void {
		if (!session?.previewInstances.length) {
			return
		}
		for (const instance of session.previewInstances) {
			releaseScatterInstance(instance)
		}
		session.previewInstances = []
	}

	function setScatterAreaPreviewGeometry(target: THREE.Mesh | THREE.Line, nextGeometry: THREE.BufferGeometry): void {
		const previousGeometry = target.geometry
		target.geometry = nextGeometry
		previousGeometry?.dispose()
	}

	function clearScatterAreaPreview(): void {
		scatterAreaPreviewFill.visible = false
		scatterAreaPreviewOutline.visible = false
		scatterAreaPreviewGroup.visible = false
	}

	function createScatterAreaOutlineGeometry(points: THREE.Vector3[], closed: boolean): THREE.BufferGeometry | null {
		if (points.length < 2) {
			return null
		}
		const vertexCount = closed ? points.length + 1 : points.length
		const positions = new Float32Array(vertexCount * 3)
		for (let index = 0; index < points.length; index += 1) {
			const point = points[index]
			if (!point) {
				continue
			}
			const offset = index * 3
			positions[offset] = point.x
			positions[offset + 1] = point.y + BRUSH_SURFACE_OFFSET * 2
			positions[offset + 2] = point.z
		}
		if (closed) {
			const first = points[0]
			if (first) {
				const offset = points.length * 3
				positions[offset] = first.x
				positions[offset + 1] = first.y + BRUSH_SURFACE_OFFSET * 2
				positions[offset + 2] = first.z
			}
		}
		const geometry = new THREE.BufferGeometry()
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
		return geometry
	}

	function createScatterAreaFillGeometry(points: THREE.Vector3[]): THREE.BufferGeometry | null {
		if (points.length < 3) {
			return null
		}
		const contour = points.map((point) => new THREE.Vector2(point.x, point.z))
		const triangles = THREE.ShapeUtils.triangulateShape(contour, [])
		if (!triangles.length) {
			return null
		}
		const positions = new Float32Array(triangles.length * 9)
		let offset = 0
		for (const triangle of triangles) {
			for (const vertexIndex of triangle) {
				const point = points[vertexIndex]
				if (!point) {
					continue
				}
				positions[offset] = point.x
				positions[offset + 1] = point.y + BRUSH_SURFACE_OFFSET
				positions[offset + 2] = point.z
				offset += 3
			}
		}
		if (offset < 9) {
			return null
		}
		const geometry = new THREE.BufferGeometry()
		geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, offset), 3))
		return geometry
	}

	function resolveScatterAreaPreviewPoints(session: ScatterSessionState): { points: THREE.Vector3[]; closed: boolean; fill: boolean } | null {
		if (session.brushShape === 'rectangle') {
			const anchor = session.anchorPoint
			const current = session.currentPoint
			if (!anchor || !current) {
				return null
			}
			const direction = session.rectangleDirection ?? resolveRectangleDragDirection(anchor, current)
			const rectangle = buildRotatedRectangleFromCorner(anchor, current, direction)
			if (!rectangle) {
				return null
			}
			return { points: rectangle.corners.map((point) => point.clone()), closed: true, fill: true }
		}
		if (session.brushShape === 'line') {
			const anchor = session.anchorPoint
			const current = session.currentPoint
			if (!anchor || !current || anchor.distanceToSquared(current) <= 1e-6) {
				return null
			}
			return { points: [anchor.clone(), current.clone()], closed: false, fill: false }
		}
		if (session.brushShape === 'polygon') {
			const points = session.polygonPoints.map((point) => point.clone())
			const previewEnd = session.polygonPreviewEnd
			const lastCommitted = points[points.length - 1] ?? null
			if (previewEnd && (!lastCommitted || previewEnd.distanceToSquared(lastCommitted) > 1e-6)) {
				points.push(previewEnd.clone())
			}
			if (points.length < 2) {
				return null
			}
			return {
				points,
				closed: points.length >= 3,
				fill: points.length >= 3,
			}
		}
		return null
	}

	function refreshScatterAreaPreview(session: ScatterSessionState | null): void {
		if (!session || session.brushShape === 'circle') {
			clearScatterAreaPreview()
			return
		}
		const preview = resolveScatterAreaPreviewPoints(session)
		if (!preview) {
			clearScatterAreaPreview()
			return
		}
		const outlineGeometry = createScatterAreaOutlineGeometry(preview.points, preview.closed)
		if (!outlineGeometry) {
			clearScatterAreaPreview()
			return
		}
		setScatterAreaPreviewGeometry(scatterAreaPreviewOutline, outlineGeometry)
		const fillGeometry = preview.fill ? createScatterAreaFillGeometry(preview.points) : null
		if (fillGeometry) {
			setScatterAreaPreviewGeometry(scatterAreaPreviewFill, fillGeometry)
			scatterAreaPreviewFill.visible = true
		} else {
			scatterAreaPreviewFill.visible = false
		}
		scatterAreaPreviewOutline.visible = true
		scatterAreaPreviewGroup.visible = true
	}

	function createScatterPreviewInstance(
		session: ScatterSessionState,
		point: THREE.Vector3,
		previewKey: string,
		yaw: number,
		existing?: TerrainScatterInstance,
	): TerrainScatterInstance {
		scatterPlacementCandidateLocalHelper.copy(point)
		session.groundMesh.worldToLocal(scatterPlacementCandidateLocalHelper)
		const existingScale = existing?.localScale?.x
		const scaleFactor = Number.isFinite(existingScale)
			? Number(existingScale)
			: THREE.MathUtils.lerp(session.minScale, session.maxScale, Math.random())
		const existingYaw = existing?.localRotation?.y
		const resolvedYaw = Number.isFinite(existingYaw)
			? Number(existingYaw)
			: (Number.isFinite(yaw) ? yaw : 0)
		const instance: TerrainScatterInstance = {
			id: existing?.id ?? `scatter_preview_${session.pointerId}_${previewKey}`,
			assetId: session.asset.id,
			layerId: session.previewLayerId,
			profileId: session.lodPresetAssetId ?? session.layer.profileId ?? session.asset.id,
			seed: existing?.seed ?? Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
			localPosition: {
				x: scatterPlacementCandidateLocalHelper.x,
				y: scatterPlacementCandidateLocalHelper.y,
				z: scatterPlacementCandidateLocalHelper.z,
			},
			localRotation: { x: 0, y: resolvedYaw, z: 0 },
			localScale: { x: scaleFactor, y: scaleFactor, z: scaleFactor },
			groundCoords: {
				x: scatterPlacementCandidateLocalHelper.x,
				z: scatterPlacementCandidateLocalHelper.z,
				height: scatterPlacementCandidateLocalHelper.y,
				normal: null,
			},
			binding: existing?.binding ?? null,
			metadata: null,
		}
		return instance
	}

	function syncScatterSessionPreviewInstances(
		session: ScatterSessionState,
		samples: ScatterPreviewSample[],
		yaw: number,
		options: { randomizeYaw?: boolean } = {},
	): void {
		const existing = session.previewInstances
		const existingById = new Map(existing.map((instance) => [instance.id, instance]))
		const next: TerrainScatterInstance[] = []
		const nextIds = new Set<string>()
		session.groundMesh.updateMatrixWorld(true)
		scatterGroundWorldMatrixHelper.copy(session.groundMesh.matrixWorld)
		for (const sample of samples) {
			const point = sample.point
			if (!point) {
				continue
			}
			const previewId = `scatter_preview_${session.pointerId}_${sample.key}`
			const previous = existingById.get(previewId)
			const previewYaw = options.randomizeYaw
				? (Number.isFinite(previous?.localRotation?.y)
					? Number(previous?.localRotation?.y)
					: Math.random() * Math.PI * 2)
				: yaw
			const preview = createScatterPreviewInstance(session, point, sample.key, previewYaw, previous)
			const matrix = composeScatterMatrix(preview, session.groundMesh, scatterWorldMatrixHelper, scatterGroundWorldMatrixHelper)
			if (!preview.binding?.nodeId) {
				if (!bindScatterInstance(preview, matrix, session.bindingAssetId)) {
					continue
				}
			} else {
				updateScatterInstanceMatrix(preview, session.groundMesh, scatterWorldMatrixHelper, scatterGroundWorldMatrixHelper)
			}
			nextIds.add(preview.id)
			next.push(preview)
		}

		for (const stale of existing) {
			if (!nextIds.has(stale.id)) {
				releaseScatterInstance(stale)
			}
		}

		session.previewInstances = next
	}

	function createScatterPreviewSamples(points: THREE.Vector3[]): ScatterPreviewSample[] {
		return points.map((point, index) => ({ key: `index:${index}`, point }))
	}

	function refreshScatterSessionPreview(session: ScatterSessionState): void {
		if (session.brushShape === 'circle') {
			clearScatterAreaPreview()
			return
		}
		refreshScatterAreaPreview(session)
		if (session.brushShape === 'polygon') {
			const committedPoints = session.polygonPoints
			const lastCommitted = committedPoints[committedPoints.length - 1] ?? null
			const previewEnd = session.polygonPreviewEnd
			const hasDistinctPreview = Boolean(
				previewEnd
				&& (!lastCommitted || previewEnd.distanceToSquared(lastCommitted) > 1e-6),
			)
			const polygonPoints = hasDistinctPreview
				? [...committedPoints, previewEnd!]
				: committedPoints
			if (polygonPoints.length < 3) {
				clearScatterSessionPreviewInstances(session)
				return
			}
			const points = sampleScatterPointsInPolygonArea(polygonPoints)
			syncScatterSessionPreviewInstances(session, createScatterPreviewSamples(points), 0)
			return
		}
		const center = session.currentPoint ?? session.anchorPoint
		if (!center) {
			clearScatterSessionPreviewInstances(session)
			return
		}
		if (session.brushShape === 'line') {
			syncScatterSessionPreviewInstances(
				session,
				sampleScatterPreviewSamplesOnLine(session.anchorPoint ?? center, center),
				0,
				{ randomizeYaw: true },
			)
			return
		}
		const points = sampleScatterPointsInBrush(center)
		syncScatterSessionPreviewInstances(session, createScatterPreviewSamples(points), resolveScatterStampYaw(session))
	}

	function commitScatterSessionPreview(session: ScatterSessionState): number {
		if (!session.layer || !session.previewInstances.length) {
			return 0
		}

		const drafts = session.previewInstances.map((preview) => ({
			id: generateScatterInstanceId(),
			assetId: session.asset.id,
			layerId: session.layer.id,
			profileId: session.lodPresetAssetId ?? session.layer.profileId ?? session.asset.id,
			seed: preview.seed ?? Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
			localPosition: { ...preview.localPosition },
			localRotation: { ...preview.localRotation },
			localScale: { ...preview.localScale },
			groundCoords: preview.groundCoords ? { ...preview.groundCoords, normal: preview.groundCoords.normal ?? null } : null,
			binding: null,
			metadata: null,
		}))
		if (!drafts.length) {
			clearScatterSessionPreviewInstances(session)
			return 0
		}

		const nextLayer = persistScatterInstances(session.layer, [...session.layer.instances, ...drafts])
		if (!nextLayer) {
			clearScatterSessionPreviewInstances(session)
			return 0
		}
		session.layer = nextLayer

		const appended = nextLayer.instances.slice(Math.max(0, nextLayer.instances.length - drafts.length))
		const failedIds = new Set<string>()
		session.groundMesh.updateMatrixWorld(true)
		scatterGroundWorldMatrixHelper.copy(session.groundMesh.matrixWorld)
		for (const stored of appended) {
			const matrix = composeScatterMatrix(stored, session.groundMesh, scatterWorldMatrixHelper, scatterGroundWorldMatrixHelper)
			if (!bindScatterInstance(stored, matrix, session.bindingAssetId)) {
				failedIds.add(stored.id)
				continue
			}
			scatterRuntimeAssetIdByNodeId.set(buildScatterNodeId(nextLayer.id, stored.id), session.bindingAssetId)
			addScatterInstanceToNeighborIndex(session, stored)
		}

		let committedCount = appended.length
		if (failedIds.size) {
			const repaired = nextLayer.instances.filter((entry) => !failedIds.has(entry.id))
			const repairedLayer = persistScatterInstances(nextLayer, repaired)
			if (repairedLayer) {
				session.layer = repairedLayer
			}
			committedCount -= failedIds.size
		}

		clearScatterSessionPreviewInstances(session)
		return Math.max(0, committedCount)
	}

	function createScatterStampNeighborhood(spacing: number) {
		const spacingSq = spacing * spacing
		const cellSize = Math.max(1e-6, spacing)
		const stampIndex = new Map<string, THREE.Vector3[]>()
		const stampCellKey = (point: THREE.Vector3) => {
			const cellX = Math.floor(point.x / cellSize)
			const cellZ = Math.floor(point.z / cellSize)
			return `${cellX}:${cellZ}`
		}
		const insert = (point: THREE.Vector3) => {
			const key = stampCellKey(point)
			const bucket = stampIndex.get(key)
			if (bucket) {
				bucket.push(point)
			} else {
				stampIndex.set(key, [point])
			}
		}
		const hasNeighborTooClose = (point: THREE.Vector3) => {
			const cellX = Math.floor(point.x / cellSize)
			const cellZ = Math.floor(point.z / cellSize)
			for (let deltaZ = -1; deltaZ <= 1; deltaZ += 1) {
				for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
					const bucket = stampIndex.get(`${cellX + deltaX}:${cellZ + deltaZ}`)
					if (!bucket?.length) {
						continue
					}
					for (const entry of bucket) {
						const dx = entry.x - point.x
						const dz = entry.z - point.z
						if (dx * dx + dz * dz < spacingSq) {
							return true
						}
					}
				}
			}
			return false
		}
		return { spacingSq, insert, hasNeighborTooClose }
	}

	function canAcceptScatterPoint(
		projected: THREE.Vector3,
		session: ScatterSessionState,
		existingBudget: { totalChecks: number },
		stampNeighborhood?: ReturnType<typeof createScatterStampNeighborhood>,
	): boolean {
		if (stampNeighborhood?.hasNeighborTooClose(projected)) {
			return false
		}
		// Shape tools (line/rectangle/polygon) intentionally force placement
		// over already placed instances; keep only intra-stamp spacing checks.
		if (session.brushShape === 'line' || session.brushShape === 'rectangle' || session.brushShape === 'polygon') {
			return true
		}
		scatterPlacementCandidateLocalHelper.copy(projected)
		session.groundMesh.worldToLocal(scatterPlacementCandidateLocalHelper)
		if (
			session.neighborIndex &&
			session.neighborIndex.size &&
			!isScatterPlacementAvailableByIndex(
				session,
				scatterPlacementCandidateLocalHelper.x,
				scatterPlacementCandidateLocalHelper.z,
				(session.spacing * session.spacing),
				existingBudget,
			)
		) {
			return false
		}
		if (!session.neighborIndex.size && !isScatterPlacementAvailable(projected, session.spacing, session)) {
			return false
		}
		return true
	}

	function buildScatterRegularPolygonVertices(
		centerPoint: THREE.Vector3,
		currentPoint: THREE.Vector3,
		sides: number,
	): THREE.Vector3[] {
		const radius = Math.hypot(currentPoint.x - centerPoint.x, currentPoint.z - centerPoint.z)
		if (!Number.isFinite(radius) || radius <= 1e-4 || sides < 3) {
			return []
		}
		const baseAngle = Math.atan2(currentPoint.z - centerPoint.z, currentPoint.x - centerPoint.x)
		const points: THREE.Vector3[] = []
		for (let index = 0; index < sides; index += 1) {
			const theta = baseAngle + (index / sides) * Math.PI * 2
			points.push(new THREE.Vector3(
				centerPoint.x + Math.cos(theta) * radius,
				centerPoint.y,
				centerPoint.z + Math.sin(theta) * radius,
			))
		}
		return points
	}

	function computePolygonAreaXZ(points: THREE.Vector3[]): number {
		if (points.length < 3) {
			return 0
		}
		let sum = 0
		for (let index = 0; index < points.length; index += 1) {
			const current = points[index]
			const next = points[(index + 1) % points.length]
			if (!current || !next) {
				continue
			}
			sum += (current.x * next.z) - (next.x * current.z)
		}
		return Math.abs(sum) * 0.5
	}

	function getPolygonPointDistanceSqXZ(a: THREE.Vector3, b: THREE.Vector3): number {
		const dx = a.x - b.x
		const dz = a.z - b.z
		return (dx * dx) + (dz * dz)
	}

	function normalizeScatterPolygonPointsXZ(polygonPoints: THREE.Vector3[]): THREE.Vector3[] {
		if (polygonPoints.length < 3) {
			return []
		}
		const epsilonSq = 1e-8
		const normalized: THREE.Vector3[] = []
		for (const point of polygonPoints) {
			if (!point) {
				continue
			}
			const previous = normalized[normalized.length - 1]
			if (previous && getPolygonPointDistanceSqXZ(previous, point) <= epsilonSq) {
				continue
			}
			normalized.push(point)
		}
		if (normalized.length >= 2) {
			const first = normalized[0]
			const last = normalized[normalized.length - 1]
			if (first && last && getPolygonPointDistanceSqXZ(first, last) <= epsilonSq) {
				normalized.pop()
			}
		}
		return normalized.length >= 3 ? normalized : []
	}

	function isPointOnPolygonSegmentXZ(point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): boolean {
		const epsilon = 1e-5
		const abX = b.x - a.x
		const abZ = b.z - a.z
		const apX = point.x - a.x
		const apZ = point.z - a.z
		const segmentLengthSq = (abX * abX) + (abZ * abZ)
		if (segmentLengthSq <= 1e-8) {
			return getPolygonPointDistanceSqXZ(point, a) <= (epsilon * epsilon)
		}
		const cross = (apX * abZ) - (apZ * abX)
		if (Math.abs(cross) > epsilon * Math.sqrt(segmentLengthSq)) {
			return false
		}
		const dot = (apX * abX) + (apZ * abZ)
		if (dot < -epsilon || dot > segmentLengthSq + epsilon) {
			return false
		}
		return true
	}

	function isPointInsidePolygonXZ(point: THREE.Vector3, polygonPoints: THREE.Vector3[]): boolean {
		if (polygonPoints.length < 3) {
			return false
		}
		let inside = false
		for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
			const a = polygonPoints[i]
			const b = polygonPoints[j]
			if (!a || !b) {
				continue
			}
			if (isPointOnPolygonSegmentXZ(point, a, b)) {
				return true
			}
			const intersects =
				((a.z > point.z) !== (b.z > point.z))
				&& (point.x < (a.x + (((point.z - a.z) * (b.x - a.x)) / (b.z - a.z))))
			if (intersects) {
				inside = !inside
			}
		}
		return inside
	}

	function sampleScatterPointsInPolygonArea(polygonPoints: THREE.Vector3[]): THREE.Vector3[] {
		if (!scatterSession || polygonPoints.length < 3) {
			return []
		}
		const normalizedPolygonPoints = normalizeScatterPolygonPointsXZ(polygonPoints)
		if (normalizedPolygonPoints.length < 3) {
			return []
		}
		const polygonArea = computePolygonAreaXZ(normalizedPolygonPoints)
		if (!Number.isFinite(polygonArea) || polygonArea <= 1e-6) {
			return []
		}
		let minX = Number.POSITIVE_INFINITY
		let maxX = Number.NEGATIVE_INFINITY
		let minZ = Number.POSITIVE_INFINITY
		let maxZ = Number.NEGATIVE_INFINITY
		for (const point of normalizedPolygonPoints) {
			if (!point) {
				continue
			}
			minX = Math.min(minX, point.x)
			maxX = Math.max(maxX, point.x)
			minZ = Math.min(minZ, point.z)
			maxZ = Math.max(maxZ, point.z)
		}
		if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
			return []
		}
		const spacing = scatterSession.spacing
		const accepted: THREE.Vector3[] = []
		const stampNeighborhood = createScatterStampNeighborhood(spacing)
		const existingBudget = { totalChecks: 0 }

		// Polygon placement should be stochastic, not grid-aligned.
		// Estimate target count from area/spacing and sample randomly inside bbox.
		const estimatedCount = Math.max(1, Math.floor(polygonArea / Math.max(1e-6, spacing * spacing)))
		const targetCount = Math.min(SCATTER_MAX_INSTANCES_PER_STAMP, estimatedCount)
		const maxAttempts = Math.min(20000, Math.max(2000, targetCount * 120))

		for (let attempt = 0; attempt < maxAttempts && accepted.length < targetCount; attempt += 1) {
			scatterPlacementCandidateWorldHelper.set(
				THREE.MathUtils.lerp(minX, maxX, Math.random()),
				normalizedPolygonPoints[0]?.y ?? 0,
				THREE.MathUtils.lerp(minZ, maxZ, Math.random()),
			)
			if (!isPointInsidePolygonXZ(scatterPlacementCandidateWorldHelper, normalizedPolygonPoints)) {
				continue
			}
			const projected = projectScatterPoint(scatterPlacementCandidateWorldHelper)
			if (!projected) {
				continue
			}
			// Guard against projection-induced drift beyond the polygon boundary.
			if (!isPointInsidePolygonXZ(projected, normalizedPolygonPoints)) {
				continue
			}
			if (!canAcceptScatterPoint(projected, scatterSession, existingBudget, stampNeighborhood)) {
				continue
			}
			const point = projected.clone()
			accepted.push(point)
			stampNeighborhood.insert(point)
		}
		return accepted
	}

	function sampleScatterPointsInRectangle(anchorPoint: THREE.Vector3, currentPoint: THREE.Vector3): THREE.Vector3[] {
		if (!scatterSession) {
			return []
		}
		const rectangle = buildRotatedRectangleFromCorner(anchorPoint, currentPoint, scatterSession.rectangleDirection)
		if (!rectangle || rectangle.width <= 1e-6 || rectangle.depth <= 1e-6) {
			return []
		}
		const cornerA = rectangle.corners[0]
		const cornerB = rectangle.corners[1]
		const cornerD = rectangle.corners[3]
		if (!cornerA || !cornerB || !cornerD) {
			return []
		}
		scatterDirectionHelper.copy(cornerB).sub(cornerA)
		const widthLength = scatterDirectionHelper.length()
		if (widthLength <= 1e-6) {
			return []
		}
		scatterDirectionHelper.divideScalar(widthLength)
		scatterMidpointHelper.copy(cornerD).sub(cornerA)
		const depthLength = scatterMidpointHelper.length()
		if (depthLength <= 1e-6) {
			return []
		}
		scatterMidpointHelper.divideScalar(depthLength)
		const spacing = scatterSession.spacing
		const columnCount = Math.max(1, Math.floor(rectangle.width / spacing) + 1)
		const rowCount = Math.max(1, Math.floor(rectangle.depth / spacing) + 1)
		const accepted: THREE.Vector3[] = []
		const stampNeighborhood = createScatterStampNeighborhood(spacing)
		const existingBudget = { totalChecks: 0 }
		for (let row = 0; row < rowCount; row += 1) {
			for (let column = 0; column < columnCount; column += 1) {
				scatterPlacementCandidateWorldHelper
					.copy(cornerA)
					.addScaledVector(scatterDirectionHelper, column * spacing)
					.addScaledVector(scatterMidpointHelper, row * spacing)
				const projected = projectScatterPoint(scatterPlacementCandidateWorldHelper)
				if (!projected || !canAcceptScatterPoint(projected, scatterSession, existingBudget, stampNeighborhood)) {
					continue
				}
				const point = projected.clone()
				accepted.push(point)
				stampNeighborhood.insert(point)
			}
		}
		return accepted
	}

	function sampleScatterPointsOnLine(anchorPoint: THREE.Vector3, currentPoint: THREE.Vector3): THREE.Vector3[] {
		return sampleScatterPreviewSamplesOnLine(anchorPoint, currentPoint).map((sample) => sample.point)
	}

	function sampleScatterPreviewSamplesOnLine(anchorPoint: THREE.Vector3, currentPoint: THREE.Vector3): ScatterPreviewSample[] {
		const session = scatterSession
		if (!session) {
			return []
		}
		scatterLocalAnchorHelper.copy(anchorPoint)
		session.groundMesh.worldToLocal(scatterLocalAnchorHelper)
		scatterLocalCurrentHelper.copy(currentPoint)
		session.groundMesh.worldToLocal(scatterLocalCurrentHelper)
		const deltaX = scatterLocalCurrentHelper.x - scatterLocalAnchorHelper.x
		const deltaZ = scatterLocalCurrentHelper.z - scatterLocalAnchorHelper.z
		const length = Math.hypot(deltaX, deltaZ)
		const spacing = session.spacing
		if (length <= 1e-4) {
			const projected = projectScatterPoint(anchorPoint)
			return projected ? [{ key: 'slot:0', point: projected }] : []
		}
		const accepted: ScatterPreviewSample[] = []
		const dirX = deltaX / length
		const dirZ = deltaZ / length
		const minDistanceSq = Math.max(1e-6, (spacing * 0.8) * (spacing * 0.8))
		let lastAcceptedPoint: THREE.Vector3 | null = null
		const appendSampleAtDistance = (distanceOnLine: number, key: string) => {
			scatterPlacementCandidateLocalHelper.set(
				scatterLocalAnchorHelper.x + dirX * distanceOnLine,
				THREE.MathUtils.lerp(scatterLocalAnchorHelper.y, scatterLocalCurrentHelper.y, clamp01(distanceOnLine / length)),
				scatterLocalAnchorHelper.z + dirZ * distanceOnLine,
			)
			session.groundMesh.localToWorld(scatterPlacementCandidateLocalHelper)
			const projected = projectScatterPoint(scatterPlacementCandidateLocalHelper)
			if (!projected) {
				return
			}
			if (lastAcceptedPoint) {
				const dx = projected.x - lastAcceptedPoint.x
				const dz = projected.z - lastAcceptedPoint.z
				if ((dx * dx) + (dz * dz) < minDistanceSq) {
					return
				}
			}
			if (!canAcceptScatterPoint(projected, session, { totalChecks: 0 })) {
				return
			}
			const point = projected.clone()
			accepted.push({ key, point })
			lastAcceptedPoint = point
		}
		const pointCount = Math.max(1, Math.floor(length / spacing) + 1)
		for (let index = 0; index < pointCount; index += 1) {
			appendSampleAtDistance(Math.min(length, index * spacing), `slot:${index}`)
		}
		const lastSlotDistance = (pointCount - 1) * spacing
		if (length - lastSlotDistance > Math.max(1e-4, spacing * 0.2)) {
			appendSampleAtDistance(length, 'end')
		}
		return accepted
	}

	function sampleScatterPointsInBrush(worldCenterPoint: THREE.Vector3): THREE.Vector3[] {
		if (!scatterSession || !scatterSession.layer || !scatterSession.modelGroup) {
			return []
		}
		if (scatterSession.brushShape === 'polygon') {
			const committed = scatterSession.polygonPoints
			const previewEnd = scatterSession.polygonPreviewEnd
			const previewPoints = previewEnd && committed.length > 0
				? [...committed, previewEnd]
				: committed
			return sampleScatterPointsInPolygonArea(previewPoints)
		}
		if (scatterSession.brushShape === 'rectangle') {
			const currentPoint = scatterSession.currentPoint ?? worldCenterPoint
			return sampleScatterPointsInRectangle(scatterSession.anchorPoint ?? worldCenterPoint, currentPoint)
		}
		if (scatterSession.brushShape === 'line') {
			const currentPoint = scatterSession.currentPoint ?? worldCenterPoint
			return sampleScatterPointsOnLine(scatterSession.anchorPoint ?? worldCenterPoint, currentPoint)
		}
		const radius = scatterSession.radius
		const spacing = scatterSession.spacing
		const regularPolygonSides = resolveScatterRegularPolygonSides()
		const regularPolygonVertices = regularPolygonSides >= 3 && scatterSession.anchorPoint && scatterSession.currentPoint
			? buildScatterRegularPolygonVertices(scatterSession.anchorPoint, scatterSession.currentPoint, regularPolygonSides)
			: []

		const targetCount = scatterSession.targetCountPerStamp
		if (targetCount <= 0) {
			return []
		}

		// Budget random samples so we can actually approach targetCount for dense brushes.
		// Keep bounded for interactivity.
		const maxAttempts = Math.min(
			20000,
			Math.max(Math.max(2000, SCATTER_SAMPLE_ATTEMPTS_MAX), Math.max(200, targetCount * 120)),
		)

		const accepted: THREE.Vector3[] = []
		const centerProjected = projectScatterPoint(worldCenterPoint)
		if (!centerProjected) {
			return []
		}

		const stampNeighborhood = createScatterStampNeighborhood(spacing)

		// Budget for overlap checks against existing instances.
		const existingBudget = { totalChecks: 0 }
		// Avoid repeated matrix updates during sampling.
		scatterSession.groundMesh.updateMatrixWorld(true)

		// Always place one instance at the click center.
		// Center placement is not restricted by overlap checks.
		{
			const p = centerProjected.clone()
			accepted.push(p)
			stampNeighborhood.insert(p)
		}

		let minX = centerProjected.x - radius
		let maxX = centerProjected.x + radius
		let minZ = centerProjected.z - radius
		let maxZ = centerProjected.z + radius
		if (regularPolygonVertices.length >= 3) {
			minX = Math.min(...regularPolygonVertices.map((point) => point.x))
			maxX = Math.max(...regularPolygonVertices.map((point) => point.x))
			minZ = Math.min(...regularPolygonVertices.map((point) => point.z))
			maxZ = Math.max(...regularPolygonVertices.map((point) => point.z))
		}

		for (let attempt = 0; attempt < maxAttempts && accepted.length < targetCount; attempt += 1) {
			if (regularPolygonVertices.length >= 3) {
				scatterPlacementCandidateWorldHelper.set(
					THREE.MathUtils.lerp(minX, maxX, Math.random()),
					centerProjected.y,
					THREE.MathUtils.lerp(minZ, maxZ, Math.random()),
				)
				if (!isPointInsidePolygonXZ(scatterPlacementCandidateWorldHelper, regularPolygonVertices)) {
					continue
				}
			} else {
				const u = Math.random()
				const v = Math.random()
				const r = Math.sqrt(u) * radius
				const theta = v * Math.PI * 2
				scatterPlacementCandidateWorldHelper.set(
					centerProjected.x + Math.cos(theta) * r,
					centerProjected.y,
					centerProjected.z + Math.sin(theta) * r,
				)
			}
			const projected = projectScatterPoint(scatterPlacementCandidateWorldHelper)
			if (!projected) {
				continue
			}
			if (!canAcceptScatterPoint(projected, scatterSession, existingBudget, stampNeighborhood)) {
				continue
			}
			const p = projected.clone()
			accepted.push(p)
			stampNeighborhood.insert(p)
		}
		return accepted
	}
	
	function paintScatterStamp(worldCenterPoint: THREE.Vector3): void {
		if (!scatterSession || !scatterSession.layer || !scatterSession.modelGroup) {
			return
		}
		const points = sampleScatterPointsInBrush(worldCenterPoint)
		for (const point of points) {
			applyScatterPlacement(
				point,
				scatterSession.brushShape === 'circle'
					? undefined
					: { yaw: 0 },
			)
		}
	}

	function traceScatterPath(targetPoint: THREE.Vector3) {
		if (!scatterSession) {
			return
		}
		if (!scatterSession.lastPoint) {
			scatterSession.lastPoint = targetPoint.clone()
			paintScatterStamp(targetPoint)
			return
		}
		scatterDirectionHelper.copy(targetPoint).sub(scatterSession.lastPoint)
		const distance = scatterDirectionHelper.length()
		const stepDistance = Math.max(scatterSession.spacing, scatterSession.radius * 0.6)
		if (distance < stepDistance * 0.35) {
			return
		}
		scatterDirectionHelper.normalize()
		const steps = Math.floor(distance / stepDistance)
		for (let index = 1; index <= steps; index += 1) {
			scatterPlacementHelper
				.copy(scatterSession.lastPoint)
				.addScaledVector(scatterDirectionHelper, stepDistance * index)
			paintScatterStamp(scatterPlacementHelper)
		}
		scatterSession.lastPoint = targetPoint.clone()
		paintScatterStamp(targetPoint)
	}

	function beginScatterPlacement(event: PointerEvent): boolean {
		if (!scatterModeEnabled()) {
			return false
		}
		if (event.button === 2 && scatterSession?.brushShape === 'polygon') {
			scatterRightClickState = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				moved: false,
			}
			return false
		}
		if (event.button !== 0) {
			return false
		}
		const asset = options.scatterAsset.value
		if (!asset) {
			return false
		}
		const definition = getGroundDynamicMeshDefinition()
		const groundMesh = getGroundObject()
		if (!definition || !groundMesh) {
			return false
		}
		updateGroundChunks(groundMesh, definition, options.getCamera(), { force: true })
		const startPoint = resolveScatterPointFromEvent(event, definition, groundMesh)
		if (!startPoint) {
			return false
		}
		const brushShape = resolveScatterBrushShape()
		const category = options.scatterCategory.value
		const preset = getScatterPreset(category)
		const layer = scatterLayer ?? ensureScatterLayerForAsset(asset, category)
		if (!scatterModelGroup) {
			console.warn('散布资源仍在加载，请稍后重试')
			return false
		}
		const bindingAssetId = scatterResolvedBindingAssetId ?? scatterModelGroup.assetId
		if (!bindingAssetId) {
			console.warn('无法解析散布资源（可能为无效的 LOD 预设）')
			return false
		}
		const effectiveRadius = clampScatterBrushRadius(options.scatterBrushRadius.value)

		// Estimate capacity from brush area / (model footprint area * E[scale^2]).
		scatterModelGroup.boundingBox.getSize(scatterBboxSizeHelper)
		const sizeX = Math.max(0.01, Math.abs(scatterBboxSizeHelper.x))
		const sizeZ = Math.max(0.01, Math.abs(scatterBboxSizeHelper.z))
		const footprintAreaM2 = Math.max(1e-6, sizeX * sizeZ)
		const footprintMaxSizeM = Math.sqrt(sizeX * sizeX + sizeZ * sizeZ)

		const presetMinScale = Number.isFinite(preset.minScale) ? Number(preset.minScale) : 1
		const presetMaxScale = Number.isFinite(preset.maxScale) ? Number(preset.maxScale) : 1
		const densityPercent = Number(options.scatterDensityPercent.value)

		const spacingStats = computeOccupancyMinDistance({
			footprintMaxSizeM,
			minScale: presetMinScale,
			maxScale: presetMaxScale,
			minFloor: 0.01,
		})

		const regularPolygonSides = brushShape === 'circle' ? resolveScatterRegularPolygonSides() : 0
		const brushAreaM2 = regularPolygonSides >= 3
			? (regularPolygonSides * effectiveRadius * effectiveRadius * Math.sin((Math.PI * 2) / regularPolygonSides) * 0.5)
			: (Math.PI * effectiveRadius * effectiveRadius)
		let { targetCount: targetCountPerStamp } = computeOccupancyTargetCount({
			areaM2: brushAreaM2,
			footprintAreaM2,
			densityPercent,
			minScale: presetMinScale,
			maxScale: presetMaxScale,
			maxCap: SCATTER_MAX_INSTANCES_PER_STAMP,
		})
		if (targetCountPerStamp <= 0) {
			// UX guard: if density > 0, still place 1 instance so a click always produces feedback
			// even when occupancy math rounds down to 0.
			const clampedDensity = Number.isFinite(densityPercent) ? densityPercent : 0
			if (clampedDensity <= 0) {
				return false
			}
			targetCountPerStamp = 1
		}

		const effectiveSpacing = brushShape === 'circle'
			? spacingStats.minDistance
			: resolveScatterSpacing()
		const chunkCells = resolveChunkCellsForDefinition(definition)
		if (brushShape === 'polygon') {
			if (!scatterSession || scatterSession.brushShape !== 'polygon') {
				scatterSession = {
					pointerId: event.pointerId,
					asset,
					bindingAssetId,
					lodPresetAssetId: scatterResolvedLodPresetAssetId,
					category,
					brushShape,
					definition,
					groundMesh,
					spacing: effectiveSpacing,
					radius: effectiveRadius,
					targetCountPerStamp,
					minScale: presetMinScale,
					maxScale: presetMaxScale,
					store: ensureScatterStoreRef(),
					layer,
					modelGroup: scatterModelGroup,
					chunkCells,
					neighborIndex: buildScatterNeighborIndex(layer, definition, chunkCells),
					lastPoint: null,
					anchorPoint: null,
					currentPoint: null,
					rectangleDirection: null,
					polygonPoints: [],
					polygonPreviewEnd: null,
					previewLayerId: `scatter-preview:${layer.id}:polygon`,
					previewInstances: [],
				}
			}
			const currentSession = scatterSession
			if (!currentSession) {
				return false
			}
			const alignedPoint = startPoint.clone()
			if (currentSession.polygonPoints.length > 0) {
				alignedPoint.y = currentSession.polygonPoints[0]?.y ?? alignedPoint.y
				const lastPoint = currentSession.polygonPoints[currentSession.polygonPoints.length - 1]
				if (lastPoint && lastPoint.distanceToSquared(alignedPoint) <= 1e-6) {
					currentSession.pointerId = event.pointerId
					currentSession.currentPoint = alignedPoint.clone()
					currentSession.polygonPreviewEnd = alignedPoint.clone()
					refreshScatterSessionPreview(currentSession)
					event.preventDefault()
					event.stopPropagation()
					event.stopImmediatePropagation()
					return true
				}
			}
			currentSession.pointerId = event.pointerId
			currentSession.anchorPoint = currentSession.polygonPoints[0] ?? alignedPoint.clone()
			currentSession.currentPoint = alignedPoint.clone()
			currentSession.polygonPoints.push(alignedPoint.clone())
			currentSession.polygonPreviewEnd = alignedPoint.clone()
			refreshScatterSessionPreview(currentSession)
			event.preventDefault()
			event.stopPropagation()
			event.stopImmediatePropagation()
			return true
		}

		scatterSession = {
			pointerId: event.pointerId,
			asset,
			bindingAssetId,
			lodPresetAssetId: scatterResolvedLodPresetAssetId,
			category,
			brushShape,
			definition,
			groundMesh,
			spacing: effectiveSpacing,
			radius: effectiveRadius,
			targetCountPerStamp,
			minScale: presetMinScale,
			maxScale: presetMaxScale,
			store: ensureScatterStoreRef(),
			layer,
			modelGroup: scatterModelGroup,
			chunkCells,
			neighborIndex: buildScatterNeighborIndex(layer, definition, chunkCells),
			lastPoint: null,
			anchorPoint: startPoint.clone(),
			currentPoint: startPoint.clone(),
			rectangleDirection: null,
			polygonPoints: [],
			polygonPreviewEnd: null,
			previewLayerId: `scatter-preview:${layer.id}:${event.pointerId}`,
			previewInstances: [],
		}
		if (brushShape === 'circle') {
			traceScatterPath(startPoint)
		} else {
			refreshScatterSessionPreview(scatterSession)
		}
		try {
			options.canvasRef.value?.setPointerCapture(event.pointerId)
		} catch (_error) {
			/* noop */
		}
		event.preventDefault()
		event.stopPropagation()
		event.stopImmediatePropagation()
		return true
	}

	function updateScatterLod({ force = false }: { force?: boolean } = {}): void {
		const camera = options.getCamera()
		if (!camera) {
			return
		}
		const store = scatterStore ?? ensureScatterStoreRef()
		const groundMesh = getGroundObject()
		if (!groundMesh || !store.layers.size) {
			return
		}
		// Keep chunk streaming + per-instance visibility responsive even when LOD switching is throttled.
		updateScatterChunkStreamingVisibilityAndGrace()
		const now = Date.now()
		if (!force && !scatterLodImmediateSyncNeeded && now - lastScatterLodUpdateAt < 200) {
			return
		}
		scatterLodImmediateSyncNeeded = false
		lastScatterLodUpdateAt = now
		scatterLodCameraPosition.copy(camera.position)
		groundMesh.updateMatrixWorld(true)
		scatterGroundWorldMatrixHelper.copy(groundMesh.matrixWorld)

		camera.updateMatrixWorld(true)
		scatterCullingProjView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
		scatterCullingFrustum.setFromProjectionMatrix(scatterCullingProjView)

		if (scatterChunkStreamingEnabled) {
			// In chunk streaming mode, visibility (including grace keep) is handled by
			// updateScatterChunkStreamingVisibilityAndGrace(). Only do LOD switching for
			// instances that are currently frustum-visible.
			for (const nodeId of scatterChunkStreamingLastFrustumVisibleIds.values()) {
				const entry = scatterChunkEntryByNodeId.get(nodeId)
				if (!entry) {
					continue
				}
				const layer = entry.layer
				const presetId = getScatterLayerLodPresetId(layer)
				if (!presetId) {
					continue
				}
				if (!scatterLodPresetCache.has(presetId)) {
					void ensureScatterLodPresetCached(presetId)
					continue
				}
				const preset = scatterLodPresetCache.get(presetId)
				if (!preset) {
					continue
				}
				const instance = entry.instance
				if (!instance.binding?.nodeId) {
					continue
				}
				const worldPos = getScatterInstanceWorldPosition(instance, groundMesh, scatterInstanceWorldPositionHelper)
				const distance = worldPos.distanceTo(scatterLodCameraPosition)
				const desired = lockScatterLodToBaseAsset
					? resolveLodBindingAssetId(preset)
					: chooseLodModelAssetId(preset, distance) ?? resolveLodBindingAssetId(preset)
				if (!desired) {
					continue
				}
				const current = scatterRuntimeAssetIdByNodeId.get(nodeId)
				if (current === desired) {
					continue
				}
				if (!ensureScatterModelCached(desired)) {
					continue
				}
				releaseScatterInstance(instance)
				const matrix = composeScatterMatrix(instance, groundMesh, scatterWorldMatrixHelper, scatterGroundWorldMatrixHelper)
				if (!bindScatterInstance(instance, matrix, desired)) {
					continue
				}
				scatterRuntimeAssetIdByNodeId.set(nodeId, desired)
			}
			return
		}

		const scatterCandidateIds: string[] = []
		const scatterCandidateByNodeId = new Map<string, { layer: TerrainScatterLayer; instance: TerrainScatterInstance; preset: any }>()
		for (const layer of store.layers.values()) {
			const presetId = getScatterLayerLodPresetId(layer)
			if (!presetId) {
				continue
			}
			const preset = scatterLodPresetCache.get(presetId)
			if (!preset || !layer.instances?.length) {
				continue
			}
			for (const instance of layer.instances) {
				const nodeId = buildScatterNodeId(layer.id, instance.id)
				scatterCandidateIds.push(nodeId)
				scatterCandidateByNodeId.set(nodeId, { layer, instance, preset })
			}
		}

		scatterCandidateIds.sort()
		scatterFrustumCuller.setIds(scatterCandidateIds)
		const visibleScatterIds = scatterFrustumCuller.updateAndQueryVisible(scatterCullingFrustum, (nodeId, centerTarget) => {
			const entry = scatterCandidateByNodeId.get(nodeId)
			if (!entry) {
				return null
			}
			const worldPos = getScatterInstanceWorldPosition(entry.instance, groundMesh, scatterCandidateCenterHelper)
			centerTarget.copy(worldPos)
			const baseBindingAssetId = resolveLodBindingAssetId(entry.preset)
			const boundAssetId = lockScatterLodToBaseAsset
				? (baseBindingAssetId ?? scatterRuntimeAssetIdByNodeId.get(nodeId) ?? null)
				: (scatterRuntimeAssetIdByNodeId.get(nodeId) ?? baseBindingAssetId)
			const baseRadius = boundAssetId ? (getCachedModelObject(boundAssetId)?.radius ?? 0.5) : 0.5
			const scale = entry.instance.localScale
			const scaleFactor = Math.max(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1)
			const radius = baseRadius * (Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1)
			return { radius }
		})

		for (const [nodeId, entry] of scatterCandidateByNodeId.entries()) {
			const instance = entry.instance
			if (!visibleScatterIds.has(nodeId)) {
				releaseScatterInstance(instance)
				continue
			}
			const worldPos = getScatterInstanceWorldPosition(instance, groundMesh, scatterInstanceWorldPositionHelper)
			const distance = worldPos.distanceTo(scatterLodCameraPosition)
			const desired = lockScatterLodToBaseAsset
				? resolveLodBindingAssetId(entry.preset)
				: chooseLodModelAssetId(entry.preset, distance) ?? resolveLodBindingAssetId(entry.preset)
			if (!desired) {
				continue
			}
			const current = scatterRuntimeAssetIdByNodeId.get(nodeId)
			const hasBinding = Boolean(instance.binding?.nodeId)
			if (current === desired && hasBinding) {
				continue
			}
			if (!ensureScatterModelCached(desired)) {
				continue
			}
			if (current !== desired) {
				releaseScatterInstance(instance)
			}
			const matrix = composeScatterMatrix(instance, groundMesh, scatterWorldMatrixHelper, scatterGroundWorldMatrixHelper)
			if (!bindScatterInstance(instance, matrix, desired)) {
				continue
			}
			scatterRuntimeAssetIdByNodeId.set(nodeId, desired)
		}
	}

	function updateScatterPlacement(event: PointerEvent): boolean {
		if (scatterRightClickState && event.pointerId === scatterRightClickState.pointerId && !scatterRightClickState.moved) {
			const dx = event.clientX - scatterRightClickState.startX
			const dy = event.clientY - scatterRightClickState.startY
			if (Math.hypot(dx, dy) >= SCATTER_CLICK_DRAG_THRESHOLD_PX) {
				scatterRightClickState.moved = true
			}
		}
		if (!scatterSession) {
			return false
		}
		if (scatterSession.brushShape === 'polygon') {
			const isCameraNavActive = (event.buttons & 2) !== 0 || (event.buttons & 4) !== 0
			if (isCameraNavActive || scatterSession.polygonPoints.length < 1) {
				return false
			}
			const nextPoint = resolveScatterPointFromEvent(event, scatterSession.definition, scatterSession.groundMesh)
			if (!nextPoint) {
				return false
			}
			nextPoint.y = scatterSession.polygonPoints[0]?.y ?? nextPoint.y
			scatterSession.currentPoint = nextPoint.clone()
			scatterSession.polygonPreviewEnd = nextPoint.clone()
			refreshScatterSessionPreview(scatterSession)
			event.preventDefault()
			event.stopPropagation()
			event.stopImmediatePropagation()
			return true
		}
		if (event.pointerId !== scatterSession.pointerId) {
			return false
		}
		const nextPoint = resolveScatterPointFromEvent(event, scatterSession.definition, scatterSession.groundMesh)
		if (!nextPoint) {
			event.preventDefault()
			event.stopPropagation()
			event.stopImmediatePropagation()
			return true
		}
		scatterSession.currentPoint = nextPoint.clone()
		if (scatterSession.brushShape === 'rectangle' && scatterSession.anchorPoint && !scatterSession.rectangleDirection) {
			const rawPoint = resolveRawScatterPointFromEvent(event, scatterSession.definition, scatterSession.groundMesh)
			if (rawPoint) {
				rawPoint.y = scatterSession.anchorPoint.y
				scatterSession.rectangleDirection = resolveRectangleDragDirection(scatterSession.anchorPoint, rawPoint)
			}
		}
		if (scatterSession.brushShape === 'circle') {
			traceScatterPath(nextPoint)
		} else {
			refreshScatterSessionPreview(scatterSession)
			updateBrush(event)
		}
		event.preventDefault()
		event.stopPropagation()
		event.stopImmediatePropagation()
		return true
	}

	function syncScatterDragShapeFromEvent(event: PointerEvent, session: ScatterSessionState): boolean {
		const nextPoint = resolveScatterPointFromEvent(event, session.definition, session.groundMesh)
		if (!nextPoint) {
			return false
		}
		session.currentPoint = nextPoint.clone()
		if (session.brushShape === 'rectangle' && session.anchorPoint && !session.rectangleDirection) {
			const rawPoint = resolveRawScatterPointFromEvent(event, session.definition, session.groundMesh)
			if (rawPoint) {
				rawPoint.y = session.anchorPoint.y
				session.rectangleDirection = resolveRectangleDragDirection(session.anchorPoint, rawPoint)
			}
		}
		return true
	}

	function finalizeScatterPlacement(event: PointerEvent): boolean {
		if (!scatterSession) {
			return false
		}
		if (scatterSession.brushShape === 'polygon') {
			if (event.button === 0 && event.pointerId === scatterSession.pointerId) {
				if (isScatterLeftDoubleClick(event) && scatterSession.polygonPoints.length >= 3) {
					scatterSession.polygonPreviewEnd = null
					refreshScatterSessionPreview(scatterSession)
					commitScatterSessionPreview(scatterSession)
					queueScatterSidecarSave()
					clearScatterAreaPreview()
					options.clearVertexSnap?.()
					scatterSession = null
				}
				return true
			}
			if (event.button === 2 && scatterRightClickState && scatterRightClickState.pointerId === event.pointerId) {
				cancelScatterPlacement()
				scatterRightClickState = null
				return true
			}
			return false
		}
		if (event.pointerId !== scatterSession.pointerId) {
			return false
		}
		if (scatterSession.brushShape !== 'circle') {
			if (scatterSession.brushShape === 'rectangle' || scatterSession.brushShape === 'line') {
				if (syncScatterDragShapeFromEvent(event, scatterSession)) {
					refreshScatterSessionPreview(scatterSession)
				}
			}
			commitScatterSessionPreview(scatterSession)
		}
		if (options.canvasRef.value && options.canvasRef.value.hasPointerCapture(event.pointerId)) {
			options.canvasRef.value.releasePointerCapture(event.pointerId)
		}
		// After finishing a full scatter paint stroke, ensure the selected scatter asset is
		// registered as a scene asset so it can be located and restored after reloading.
		try {
			const asset = scatterSession.asset
			if (asset?.id && !options.sceneStore.findAssetInCatalog(asset.id)) {
				options.sceneStore.registerAssets([asset])
			}
		} catch (error) {
			console.warn('Failed to register scatter asset into scene assets', error)
		}
		queueScatterSidecarSave()
		clearScatterAreaPreview()
		options.clearVertexSnap?.()
		scatterSession = null
		return true
	}

	function cancelScatterPlacement(): boolean {
		if (!scatterSession) {
			scatterRightClickState = null
			clearScatterAreaPreview()
			return false
		}
		clearScatterSessionPreviewInstances(scatterSession)
		clearScatterAreaPreview()
		if (options.canvasRef.value && options.canvasRef.value.hasPointerCapture(scatterSession.pointerId)) {
			options.canvasRef.value.releasePointerCapture(scatterSession.pointerId)
		}
		options.clearVertexSnap?.()
		scatterRightClickState = null
		scatterSession = null
		queueScatterSidecarSave()
		return true
	}

	function eraseScatterInstances(
		worldPoint: THREE.Vector3,
		radius: number,
		groundMesh: THREE.Object3D,
		definition: GroundDynamicMesh,
	): boolean {
		const perfStart = nowMs()
		const store = ensureScatterStoreRef()
		const selectedCategory = options.scatterCategory.value
		let layers = Array.from(store.layers.values()).filter((layer) => layer.category === selectedCategory)
		// After planning->3D conversion, scatter may be generated across different categories
		// than the user's currently selected category. In that case, allow erasing across all
		// scatter layers so the erase tool works immediately without requiring category toggles.
		if (!layers.length) {
			layers = Array.from(store.layers.values())
		}
		if (!layers.length) {
			recordScatterErasePerf(nowMs() - perfStart, 0, 0)
			return false
		}
		const radiusSq = radius * radius
		let removed = false
		let removedLayerCount = 0
		let removedInstanceCount = 0
		let mutatedLayers = 0
		// Compute distance on ground-local XZ plane so the brush radius works regardless of terrain height.
		scatterEraseLocalPointHelper.copy(worldPoint)
		groundMesh.updateMatrixWorld(true)
		groundMesh.worldToLocal(scatterEraseLocalPointHelper)

		if (scatterChunkIndexDirty) {
			const chunkCells = resolveChunkCellsForDefinition(definition)
			rebuildScatterChunkIndexForStore(store, definition, chunkCells)
		}

		const chunkCells = resolveChunkCellsForDefinition(definition)
		const chunkKeys = computeScatterChunkKeysInRadius(
			definition,
			chunkCells,
			scatterEraseLocalPointHelper.x,
			scatterEraseLocalPointHelper.z,
			radius,
		)
		if (chunkKeys.size === 0) {
			recordScatterErasePerf(nowMs() - perfStart, 0, 0)
			return false
		}
		const candidateIdsByLayer = new Map<string, Set<string>>()
		for (const chunkKey of chunkKeys) {
			const bucket = scatterChunkIndex.get(chunkKey)
			if (!bucket?.length) {
				continue
			}
			for (const entry of bucket) {
				let set = candidateIdsByLayer.get(entry.layer.id)
				if (!set) {
					set = new Set<string>()
					candidateIdsByLayer.set(entry.layer.id, set)
				}
				set.add(entry.instance.id)
			}
		}

		for (const layer of layers) {
			if (!layer.instances.length) {
				continue
			}
			const candidateIds = candidateIdsByLayer.get(layer.id)
			if (!candidateIds || candidateIds.size === 0) {
				continue
			}
			const survivors: TerrainScatterInstance[] = []
			const removedInstances: TerrainScatterInstance[] = []
			for (const instance of layer.instances) {
				if (!candidateIds.has(instance.id)) {
					survivors.push(instance)
					continue
				}
				const local = instance.localPosition
				const dx = (local?.x ?? 0) - scatterEraseLocalPointHelper.x
				const dz = (local?.z ?? 0) - scatterEraseLocalPointHelper.z
				if (dx * dx + dz * dz <= radiusSq) {
					removedInstances.push(instance)
				} else {
					survivors.push(instance)
				}
			}
			if (!removedInstances.length) {
				continue
			}
			removed = true
			removedLayerCount += 1
			removedInstanceCount += removedInstances.length
			for (const instance of removedInstances) {
				releaseScatterInstance(instance)
				const nodeId = buildScatterNodeId(layer.id, instance.id)
				const chunkEntry = scatterChunkEntryByNodeId.get(nodeId)
				if (chunkEntry) {
					const bucket = scatterChunkIndex.get(chunkEntry.chunkKey)
					if (bucket) {
						for (let index = bucket.length - 1; index >= 0; index -= 1) {
							const entry = bucket[index]
							if (entry && entry.layer.id === layer.id && entry.instance.id === instance.id) {
								bucket.splice(index, 1)
							}
						}
						if (bucket.length === 0) {
							scatterChunkIndex.delete(chunkEntry.chunkKey)
						}
					}
					scatterChunkEntryByNodeId.delete(nodeId)
				}
				scatterRuntimeAssetIdByNodeId.delete(nodeId)
				scatterChunkStreamingAllocatedNodeIds.delete(nodeId)
				scatterChunkStreamingPendingBindIds.delete(nodeId)
				scatterChunkStreamingLastVisibleAt.delete(nodeId)
				scatterChunkStreamingLastFrustumVisibleIds.delete(nodeId)
			}
					const nextLayer = replaceTerrainScatterInstances(store, layer.id, survivors)
					if (nextLayer && scatterLayer && scatterLayer.id === layer.id) {
						scatterLayer = nextLayer
					}
					if (nextLayer) {
						mutatedLayers += 1
					}
		}
				if (mutatedLayers > 0) {
					syncTerrainScatterSnapshotToScene(store, {
						bumpRuntimeVersion: false,
						runtimeSyncReason: 'editor-local-erase',
					})
					scatterSidecarPersistPending = true
				}
		recordScatterErasePerf(nowMs() - perfStart, removedLayerCount, removedInstanceCount)
		return removed
	}

	function flushScatterErasePending(state: ScatterEraseState): boolean {
		if (!state.pendingPoint) {
			return false
		}
		const removed = eraseScatterInstances(state.pendingPoint, state.radius, state.groundMesh, state.definition)
		state.pendingPoint = null
		state.lastCommitAt = nowMs()
		return removed
	}

	function clearScatterErasePendingSchedule(state: ScatterEraseState): void {
		if (state.pendingCommitRafId != null) {
			cancelAnimationFrame(state.pendingCommitRafId)
			state.pendingCommitRafId = null
		}
		if (state.pendingCommitTimerId == null) {
			return
		}
		clearTimeout(state.pendingCommitTimerId)
		state.pendingCommitTimerId = null
	}

	function scheduleScatterErase(state: ScatterEraseState, worldPoint: THREE.Vector3): void {
		if (!state.pendingPoint) {
			state.pendingPoint = new THREE.Vector3()
		}
		state.pendingPoint.copy(worldPoint)
		if (state.pendingCommitRafId != null || state.pendingCommitTimerId != null) {
			return
		}
		if (typeof requestAnimationFrame === 'function') {
			state.pendingCommitRafId = requestAnimationFrame(() => {
				state.pendingCommitRafId = null
				if (!scatterEraseState || scatterEraseState.pointerId !== state.pointerId) {
					clearScatterErasePendingSchedule(state)
					return
				}
				flushScatterErasePending(state)
			})
			return
		}
		const delay = Math.max(1, SCATTER_ERASE_COMMIT_INTERVAL_MS)
		state.pendingCommitTimerId = setTimeout(() => {
			if (!scatterEraseState || scatterEraseState.pointerId !== state.pointerId) {
				clearScatterErasePendingSchedule(state)
				return
			}
			state.pendingCommitTimerId = null
			flushScatterErasePending(state)
		}, delay)
	}

	function resolveScatterEraseRadius(): number {
		const candidate = Number(options.scatterEraseRadius.value)
		return Math.min(SCATTER_BRUSH_RADIUS_MAX, Math.max(0.1, Number.isFinite(candidate) ? candidate : 1))
	}

	function resolveScatterBrushRadius(): number {
		const candidate = Number(options.scatterBrushRadius.value)
		return Math.min(SCATTER_BRUSH_RADIUS_MAX, Math.max(0.1, Number.isFinite(candidate) ? candidate : 1))
	}

	function clearScatterInstances(): boolean {
		const store = ensureScatterStoreRef()
		let removed = false
		for (const layer of Array.from(store.layers.values())) {
			if (!layer.instances.length) {
				continue
			}
			layer.instances.forEach((instance) => releaseScatterInstance(instance))
			persistScatterInstances(layer, [])
			removed = true
		}
		if (removed) {
			queueScatterSidecarSave()
		}
		return removed
	}

	function beginScatterErase(event: PointerEvent): boolean {
		if (!isGroundBuildToolActive()) {
			return false
		}
		const eraseModeActive = options.scatterEraseModeActive.value
		if (!eraseModeActive) {
			return false
		}
		// Use left click for scatter erase; middle click is reserved for camera pan.
		const allowedButton = event.button === 0
		if (!allowedButton) {
			return false
		}
		const definition = getGroundDynamicMeshDefinition()
		const groundMesh = getGroundObject()
		if (!definition || !groundMesh) {
			return false
		}
		updateGroundChunks(groundMesh, definition, options.getCamera(), { force: true })
		if (!raycastGroundPoint(event, scatterPointerHelper)) {
			return false
		}
		if (!isPointerOverGround(definition, groundMesh, scatterPointerHelper)) {
			return false
		}
		const eraseRadius = resolveScatterEraseRadius()
		eraseScatterInstances(scatterPointerHelper, eraseRadius, groundMesh, definition)
		scatterEraseState = {
			pointerId: event.pointerId,
			definition,
			groundMesh,
			radius: eraseRadius,
			pendingPoint: null,
			pendingCommitRafId: null,
			pendingCommitTimerId: null,
			lastCommitAt: nowMs(),
		}
		options.onScatterEraseStart?.()
		try {
			options.canvasRef.value?.setPointerCapture(event.pointerId)
		} catch (_error) {
			/* noop */
		}
		event.preventDefault()
		event.stopPropagation()
		event.stopImmediatePropagation()
		return true
	}

	function updateScatterErase(event: PointerEvent): boolean {
		if (!scatterEraseState || event.pointerId !== scatterEraseState.pointerId) {
			return false
		}
		if (!raycastGroundPoint(event, scatterPointerHelper)) {
			return false
		}
		if (!isPointerOverGround(scatterEraseState.definition, scatterEraseState.groundMesh, scatterPointerHelper)) {
			event.preventDefault()
			event.stopPropagation()
			event.stopImmediatePropagation()
			return true
		}
		scatterEraseState.radius = resolveScatterEraseRadius()
		scheduleScatterErase(scatterEraseState, scatterPointerHelper)
		event.preventDefault()
		event.stopPropagation()
		event.stopImmediatePropagation()
		return true
	}

	function finalizeScatterErase(event: PointerEvent): boolean {
		if (!scatterEraseState || event.pointerId !== scatterEraseState.pointerId) {
			return false
		}
		if (options.canvasRef.value && options.canvasRef.value.hasPointerCapture(event.pointerId)) {
			options.canvasRef.value.releasePointerCapture(event.pointerId)
		}
		flushScatterErasePending(scatterEraseState)
		clearScatterErasePendingSchedule(scatterEraseState)
		scatterEraseState = null
		queueScatterSidecarSave()
		return true
	}

	function cancelScatterErase(): boolean {
		if (!scatterEraseState) {
			return false
		}
		if (options.canvasRef.value && options.canvasRef.value.hasPointerCapture(scatterEraseState.pointerId)) {
			options.canvasRef.value.releasePointerCapture(scatterEraseState.pointerId)
		}
		clearScatterErasePendingSchedule(scatterEraseState)
		scatterEraseState = null
		queueScatterSidecarSave()
		return true
	}

	function getGroundVertexHeight(definition: GroundDynamicMesh, row: number, column: number): number {
		return resolveGroundEffectiveHeightAtVertex(definition, row, column)
	}

	function createGroundSelectionFromCells(
		definition: GroundDynamicMesh,
		start: { row: number; column: number },
		end: { row: number; column: number },
	): GroundCellSelection {
		const minRow = Math.min(start.row, end.row)
		const maxRow = Math.max(start.row, end.row)
		const minColumn = Math.min(start.column, end.column)
		const maxColumn = Math.max(start.column, end.column)

		const halfWidth = definition.width * 0.5
		const halfDepth = definition.depth * 0.5
		const cellSize = definition.cellSize

		const minX = -halfWidth + minColumn * cellSize
		const maxX = -halfWidth + (maxColumn + 1) * cellSize
		const minZ = -halfDepth + minRow * cellSize
		const maxZ = -halfDepth + (maxRow + 1) * cellSize

		const vertexMinRow = minRow
		const vertexMaxRow = Math.min(definition.rows, maxRow + 1)
		const vertexMinColumn = minColumn
		const vertexMaxColumn = Math.min(definition.columns, maxColumn + 1)

		const heights = [
			getGroundVertexHeight(definition, vertexMinRow, vertexMinColumn),
			getGroundVertexHeight(definition, vertexMinRow, vertexMaxColumn),
			getGroundVertexHeight(definition, vertexMaxRow, vertexMinColumn),
			getGroundVertexHeight(definition, vertexMaxRow, vertexMaxColumn),
		]
		const averageHeight = heights.reduce((sum, value) => sum + value, 0) / heights.length

		const worldCenter = new THREE.Vector3((minX + maxX) * 0.5, averageHeight, (minZ + maxZ) * 0.5)

		return {
			minRow,
			maxRow,
			minColumn,
			maxColumn,
			worldCenter,
		}
	}

	function cellSelectionToVertexBounds(selection: GroundCellSelection, definition: GroundDynamicMesh) {
		return {
			minRow: selection.minRow,
			maxRow: Math.min(definition.rows, selection.maxRow + 1),
			minColumn: selection.minColumn,
			maxColumn: Math.min(definition.columns, selection.maxColumn + 1),
		}
	}

	function applyGroundSelectionVisuals(selection: GroundCellSelection | null, definition: GroundDynamicMesh | null) {
		if (!selection || !definition) {
			groundSelectionGroup.visible = false
			groundSelectionToolbarStyle.opacity = 0
			groundSelection.value = null
			return
		}

		const halfWidth = definition.width * 0.5
		const halfDepth = definition.depth * 0.5
		const cellSize = definition.cellSize

		const minX = -halfWidth + selection.minColumn * cellSize
		const maxX = -halfWidth + (selection.maxColumn + 1) * cellSize
		const minZ = -halfDepth + selection.minRow * cellSize
		const maxZ = -halfDepth + (selection.maxRow + 1) * cellSize

		const midX = (minX + maxX) * 0.5
		const midZ = (minZ + maxZ) * 0.5
		const averageHeight = selection.worldCenter.y

		groundSelectionFill.position.set(midX, averageHeight + 0.002, midZ)
		groundSelectionFill.scale.set(maxX - minX, maxZ - minZ, 1)

		const outlinePositions = groundSelectionOutlineGeometry.getAttribute('position') as THREE.BufferAttribute
		outlinePositions.setXYZ(0, minX, averageHeight + 0.004, minZ)
		outlinePositions.setXYZ(1, maxX, averageHeight + 0.004, minZ)
		outlinePositions.setXYZ(2, maxX, averageHeight + 0.004, maxZ)
		outlinePositions.setXYZ(3, minX, averageHeight + 0.004, maxZ)
		outlinePositions.setXYZ(4, minX, averageHeight + 0.004, minZ)
		outlinePositions.needsUpdate = true

		groundSelectionGroup.visible = true
		groundSelection.value = selection
		groundSelectionCenterHelper.copy(selection.worldCenter)
		updateGroundSelectionToolbarPosition()
	}

	function updateGroundSelectionToolbarPosition() {
		const selectionState = groundSelection.value
		const camera = options.getCamera()
		if (!selectionState || !camera || !options.surfaceRef.value) {
			groundSelectionToolbarStyle.opacity = 0
			return
		}

		groundSelectionScreenHelper.copy(selectionState.worldCenter)
		groundSelectionScreenHelper.project(camera)
		if (groundSelectionScreenHelper.z < -1 || groundSelectionScreenHelper.z > 1) {
			groundSelectionToolbarStyle.opacity = 0
			return
		}

		const bounds = options.surfaceRef.value.getBoundingClientRect()
		const width = bounds.width
		const height = bounds.height

		groundSelectionToolbarStyle.left = `${(groundSelectionScreenHelper.x * 0.5 + 0.5) * width}px`
		groundSelectionToolbarStyle.top = `${(-groundSelectionScreenHelper.y * 0.5 + 0.5) * height}px`
		groundSelectionToolbarStyle.opacity = 1
	}

	function clearGroundSelection() {
		if (groundSelectionDragState) {
			if (options.canvasRef.value && options.canvasRef.value.hasPointerCapture(groundSelectionDragState.pointerId)) {
				options.canvasRef.value.releasePointerCapture(groundSelectionDragState.pointerId)
			}
			groundSelectionDragState = null
			options.restoreOrbitAfterGroundSelection()
		}
		groundSelectionGroup.visible = false
		groundSelection.value = null
		groundSelectionToolbarStyle.opacity = 0
		isGroundToolbarVisible.value = false
	}

	function cancelGroundSelection(): boolean {
		if (!groundSelection.value && !groundSelectionDragState) {
			return false
		}
		clearGroundSelection()
		return true
	}

	function updateGroundSelectionFromPointer(
		event: PointerEvent,
		definition: GroundDynamicMesh,
		optionsOverride: { forceApply?: boolean } = {},
	): boolean {
		if (!groundSelectionDragState) {
			return false
		}
		if (options.isAltOverrideActive()) {
			return false
		}
		if (!raycastGroundPoint(event, groundPointerHelper)) {
			if (optionsOverride.forceApply) {
				const selection = createGroundSelectionFromCells(
					definition,
					{ row: groundSelectionDragState.startRow, column: groundSelectionDragState.startColumn },
					{ row: groundSelectionDragState.currentRow, column: groundSelectionDragState.currentColumn },
				)
				applyGroundSelectionVisuals(selection, definition)
				return true
			}
			return false
		}
		clampPointToGround(definition, groundPointerHelper)
		const cell = getGroundCellFromPoint(definition, groundPointerHelper)
		const changed = cell.row !== groundSelectionDragState.currentRow || cell.column !== groundSelectionDragState.currentColumn
		if (changed) {
			groundSelectionDragState.currentRow = cell.row
			groundSelectionDragState.currentColumn = cell.column
		}
		if (changed || optionsOverride.forceApply) {
			const selection = createGroundSelectionFromCells(
				definition,
				{ row: groundSelectionDragState.startRow, column: groundSelectionDragState.startColumn },
				{ row: groundSelectionDragState.currentRow, column: groundSelectionDragState.currentColumn },
			)
			applyGroundSelectionVisuals(selection, definition)
		}
		return true
	}

	function updateBrush(event: PointerEvent) {
		const scene = options.getScene()
		const camera = options.getCamera()
		if (!scene || !camera) {
			brushMesh.visible = false
			return
		}

		const rect = options.canvasRef.value?.getBoundingClientRect()
		if (!rect) {
			brushMesh.visible = false
			return
		}

		const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
		const y = -((event.clientY - rect.top) / rect.height) * 2 + 1

		const groundNode = getGroundNodeFromScene()
		if (groundNode?.dynamicMesh?.type !== 'Ground') {
			brushMesh.visible = false
			return
		}
		const definition = getGroundDynamicMeshDefinition()
		if (!definition) {
			brushMesh.visible = false
			return
		}

		const groundObject = getGroundObject()
		if (!groundObject) {
			brushMesh.visible = false
			return
		}
		updateGroundChunks(groundObject, definition, options.getCamera())

		options.pointer.set(x, y)
		options.raycaster.setFromCamera(options.pointer, camera)
		const intersects = options.raycaster.intersectObject(groundObject, true)
		const hit = intersects[0]
		if (hit) {
			let targetPoint = hit.point.clone()
			if (scatterModeEnabled()) {
				const snapped = resolveScatterPointFromEvent(event, definition, groundObject)
				if (!snapped) {
					brushMesh.visible = false
					return
				}
				targetPoint = snapped
			}
			brushMesh.position.copy(targetPoint)
			brushMesh.rotation.set(-Math.PI / 2, 0, 0)
			if (options.scatterEraseModeActive.value) {
				const scale = resolveScatterEraseRadius()
				brushMesh.scale.set(scale, scale, 1)
			} else if (scatterModeEnabled()) {
				const shape = resolveScatterBrushShape()
				if (shape !== 'circle') {
					// Rectangle/polygon/line scatter tools rely on dedicated area previews.
					// Keep brush mesh hidden to avoid showing an unrelated circular indicator.
					brushMesh.visible = false
					return
				}
				const scale = resolveScatterBrushRadius()
				brushMesh.scale.set(scale, scale, 1)
			} else {
				const scale = options.brushRadius.value
				brushMesh.scale.set(scale, scale, 1)
			}
			conformBrushToTerrain(definition, groundObject)
			brushMesh.visible = true
		} else {
			brushMesh.visible = false
		}
	}

	function performSculpt(event: PointerEvent) {
		if (!brushMesh.visible) return

		const groundNode = getGroundNodeFromScene()
		if (groundNode?.dynamicMesh?.type !== 'Ground') return
		const runtimeDefinition = getGroundDynamicMeshDefinition()
		if (!runtimeDefinition) return
		if (!sculptSessionState || sculptSessionState.nodeId !== groundNode.id) {
			ensureSculptSession(runtimeDefinition, groundNode.id)
		}

		const definition = getGroundDynamicMeshDefinition()
		if (!definition) return

		const groundObject = getGroundObject()
		if (!groundObject) return
		updateGroundChunks(groundObject, definition, options.getCamera())

		const localPoint = groundObject.worldToLocal(brushMesh.position.clone())
		localPoint.y -= 0.1

		const operation: GroundSculptOperation | null = event.shiftKey ? 'depress' : options.brushOperation.value
		if (!operation) {
			return
		}
		const shape = getActiveBrushShape()
		const radius = options.brushRadius.value

		// If the pointer moves a large distance between frames, insert intermediate samples along the stroke
		// to avoid sparse "control points" causing jagged edges.
		const cellSize = definition.cellSize
		const maxStep = Math.max(cellSize * 0.5, radius * 0.2, 0.05)
		const prev = sculptStrokeLastLocalPoint
		let steps = 1
		if (prev && sculptStrokePointerId === event.pointerId) {
			sculptStrokePrevPointHelper.copy(prev)
			sculptStrokeNextPointHelper.copy(localPoint)
			const dx = sculptStrokeNextPointHelper.x - sculptStrokePrevPointHelper.x
			const dz = sculptStrokeNextPointHelper.z - sculptStrokePrevPointHelper.z
			const dist = Math.hypot(dx, dz)
			steps = Math.max(1, Math.ceil(dist / maxStep))
			steps = Math.min(96, steps)
		}

		let anyModified = false
		let mergedRegion: GroundGeometryUpdateRegion | null = null

		for (let i = 0; i < steps; i += 1) {
			const t = steps <= 1 ? 1 : (i + 1) / steps
			const point = prev && sculptStrokePointerId === event.pointerId
				? sculptStrokePrevPointHelper.clone().lerp(sculptStrokeNextPointHelper, t)
				: localPoint

			const targetHeight = operation === 'flatten'
				? sampleGroundHeight(definition, point.x, point.z)
				: operation === 'flatten-zero'
					? 0
					: undefined

			const modified = sculptGround(definition, {
				point,
				radius,
				// Damp sculpt speed so height grows more gradually for finer control.
				strength: options.brushStrength.value * 0.4,
				shape,
				operation,
				targetHeight,
			})

			if (modified) {
				anyModified = true
				const halfWidth = definition.width * 0.5
				const halfDepth = definition.depth * 0.5
				const minColumn = Math.floor((point.x - radius + halfWidth) / cellSize)
				const maxColumn = Math.ceil((point.x + radius + halfWidth) / cellSize)
				const minRow = Math.floor((point.z - radius + halfDepth) / cellSize)
				const maxRow = Math.ceil((point.z + radius + halfDepth) / cellSize)
				const region: GroundGeometryUpdateRegion = {
					minRow: Math.max(0, minRow),
					maxRow: Math.min(definition.rows, maxRow),
					minColumn: Math.max(0, minColumn),
					maxColumn: Math.min(definition.columns, maxColumn),
				}
				mergedRegion = mergeRegions(mergedRegion, region)
			}
		}

		sculptStrokePointerId = event.pointerId
		sculptStrokeLastLocalPoint = localPoint.clone()

		if (!anyModified || !mergedRegion) {
			return
		}

		if (sculptSessionState && sculptSessionState.nodeId === groundNode.id) {
			sculptSessionState.dirty = true
		}
		updateGroundMeshRegion(groundObject, definition, mergedRegion)
		// Stitch normals across chunk boundaries to prevent visible seams.
		const padded: GroundGeometryUpdateRegion = {
			minRow: Math.max(0, mergedRegion.minRow - 2),
			maxRow: Math.min(definition.rows, mergedRegion.maxRow + 2),
			minColumn: Math.max(0, mergedRegion.minColumn - 2),
			maxColumn: Math.min(definition.columns, mergedRegion.maxColumn + 2),
		}
		stitchGroundChunkNormals(groundObject, definition, padded)
		if (sculptSessionState && sculptSessionState.nodeId === groundNode.id) {
			sculptSessionState.affectedRegion = mergeRegions(sculptSessionState.affectedRegion, mergedRegion)
		}
	}

	function performPaint(event: PointerEvent) {
		if (!brushMesh.visible) {
			updateBrush(event)
		}
		if (!brushMesh.visible) {
			return
		}
		if (!paintModeEnabled()) {
			return
		}

		const groundNode = getGroundNodeFromScene()
		if (groundNode?.dynamicMesh?.type !== 'Ground') {
			return
		}
		const definition = getGroundDynamicMeshDefinition()
		if (!definition) {
			return
		}
		const groundObject = getGroundObject()
		if (!groundObject) {
			return
		}
		updateGroundChunks(groundObject, definition, options.getCamera())

		const localPoint = paintStrokeCurrentLocalPointHelper.copy(brushMesh.position)
		groundObject.worldToLocal(localPoint)
		localPoint.y -= 0.1

		const radius = options.brushRadius.value
		const cellSize = definition.cellSize
		const maxStep = Math.max(cellSize * 0.5, radius * 0.2, 0.05)
		const prev = paintStrokeLastLocalPoint
		let steps = 1
		if (prev && paintStrokePointerId === event.pointerId) {
			paintStrokePrevPointHelper.copy(prev)
			paintStrokeNextPointHelper.copy(localPoint)
			const dx = paintStrokeNextPointHelper.x - paintStrokePrevPointHelper.x
			const dz = paintStrokeNextPointHelper.z - paintStrokePrevPointHelper.z
			const dist = Math.hypot(dx, dz)
			steps = Math.max(1, Math.ceil(dist / maxStep))
			steps = Math.min(96, steps)
		}

		const session = ensurePaintSession(definition, groundNode.id)
		const paintAsset = options.paintAsset.value
		const strokeMode: TerrainPaintStrokeMode = paintAsset?.id ? 'paint' : 'erase'
		const brushStrength = clamp01(options.brushStrength.value)
		if (brushStrength <= 0) {
			return
		}
		const paintLayerStyle = toRaw(options.paintLayerStyle.value)
		const feather = clamp01(paintLayerStyle.feather ?? 0)
		const brushSettings: TerrainPaintBrushSettings = {
			...paintLayerStyle,
			tileScale: {
				x: paintLayerStyle.tileScale.x,
				y: paintLayerStyle.tileScale.y,
			},
			offset: {
				x: paintLayerStyle.offset.x,
				y: paintLayerStyle.offset.y,
			},
			feather,
		}
		const sampling = createTerrainPaintSamplingSettings(brushSettings)
		if (sampling.opacity <= 0) {
			return
		}
		let brushImageContext: TerrainPaintImageSamplingContext | null = null
		if (strokeMode === 'paint') {
			if (!paintAsset?.id) {
				return
			}
			const brushImage = getLoadedTerrainPaintBrushImage(paintAsset.id)
			if (!brushImage) {
				void loadTerrainPaintBrushImage(paintAsset)
				return
			}
			brushImageContext = createTerrainPaintImageSamplingContext(brushImage.imageData)
		}

		for (let i = 0; i < steps; i += 1) {
			const t = steps <= 1 ? 1 : (i + 1) / steps
			const point = prev && paintStrokePointerId === event.pointerId
				? paintStrokeInterpolatedPointHelper.lerpVectors(paintStrokePrevPointHelper, paintStrokeNextPointHelper, t)
				: localPoint
			const stamp: TerrainPaintStampRequest = {
				mode: strokeMode,
				localX: point.x,
				localZ: point.z,
				radius,
				strength: brushStrength,
				feather,
				sampling,
				brushImage: brushImageContext,
			}
			const chunks = collectPaintChunksOverlappedByBrush(definition, session.chunkCells, point.x, point.z, radius)
			for (const chunkInfo of chunks) {
				const chunkState = ensurePaintChunkState(session, chunkInfo)
				if (chunkState.status === 'loading') {
					chunkState.pendingStamps.push(stamp)
					continue
				}
				applyPaintStampToChunk(session, chunkState, stamp)
			}
		}

		paintStrokePointerId = event.pointerId
		paintStrokeLastLocalPoint = paintStrokeNextPointHelper.copy(localPoint)
	}

	function refreshGroundMesh(definition: GroundRuntimeDynamicMesh | null = getGroundDynamicMeshDefinition()) {
		if (!definition) {
			return
		}
		const mesh = getGroundObject()
		if (mesh) {
			updateGroundChunks(mesh, definition, options.getCamera())
			updateGroundMesh(mesh, definition)
		}
	}

	function beginPaint(event: PointerEvent): boolean {
		const groundNode = getGroundNodeFromScene()
		const paintEnabled = paintModeEnabled()
		if (!paintEnabled) {
			return false
		}
		if (groundNode?.dynamicMesh?.type !== 'Ground' || event.button !== 0) {
			return false
		}

		isPainting.value = true
		paintStrokePointerId = event.pointerId
		paintStrokeLastLocalPoint = null
		event.preventDefault()
		event.stopPropagation()
		event.stopImmediatePropagation()
		performPaint(event)
		try {
			options.canvasRef.value?.setPointerCapture(event.pointerId)
		} catch (error) {
			/* noop */
		}
		return true
	}

	function beginSculpt(event: PointerEvent): boolean {
		if (options.activeBuildTool.value !== 'terrain') {
			return false
		}
		if (options.groundPanelTab.value !== 'terrain') {
			return false
		}
		const groundNode = getGroundNodeFromScene()
		if (groundNode?.dynamicMesh?.type !== 'Ground' || event.button !== 0) {
			return false
		}

		const definition = getGroundDynamicMeshDefinition()
		if (!definition) {
			return false
		}
		ensureSculptSession(definition, groundNode.id)

		isSculpting.value = true
		sculptStrokePointerId = event.pointerId
		sculptStrokeLastLocalPoint = null
		event.preventDefault()
		event.stopPropagation()
		event.stopImmediatePropagation()
		performSculpt(event)
		try {
			options.canvasRef.value?.setPointerCapture(event.pointerId)
		} catch (error) {
			/* noop */
		}
		return true
	}

	function finalizePaint(event: PointerEvent): boolean {
		if (!isPainting.value) {
			return false
		}
		performPaint(event)
		void commitPaintSession(options.sceneStore.selectedNode ?? null)
		isPainting.value = false
		paintStrokePointerId = null
		paintStrokeLastLocalPoint = null
		try {
			options.canvasRef.value?.releasePointerCapture(event.pointerId)
		} catch (error) {
			/* noop */
		}
		event.preventDefault()
		event.stopPropagation()
		event.stopImmediatePropagation()
		return true
	}

	function finalizeSculpt(event: PointerEvent): boolean {
		if (!isSculpting.value) {
			return false
		}

		isSculpting.value = false
		sculptStrokePointerId = null
		sculptStrokeLastLocalPoint = null
		try {
			options.canvasRef.value?.releasePointerCapture(event.pointerId)
		} catch (error) {
			/* noop */
		}

		const groundNode = getGroundNodeFromScene()
		if (groundNode?.dynamicMesh?.type === 'Ground') {
			const session = sculptSessionState?.nodeId === groundNode.id ? sculptSessionState : null
			const runtimeDefinition = session?.definition ?? getGroundDynamicMeshDefinition()
			const region = session?.affectedRegion ?? null
				const touchedChunkKeys = session?.touchedChunkKeys ?? null
			const dirty = Boolean(session?.dirty)
			const groundObject = getGroundObject()
			if (!dirty) {
				sculptSessionState = null
				return true
			}
			if (groundObject && runtimeDefinition) {
				const jobToken = (groundNormalsJobToken += 1)
				void recomputeGroundChunkNormalsInWorker({
					groundObject,
					definition: runtimeDefinition,
					region,
						touchedChunkKeys,
					jobToken,
				}).catch((error) => {
					console.warn('地形法线异步构建失败，回退到主线程：', error)
					try {
						groundObject.traverse((child) => {
							const mesh = child as THREE.Mesh
							if (!mesh?.isMesh || !(mesh.geometry instanceof THREE.BufferGeometry)) {
								return
							}
							mesh.geometry.computeVertexNormals()
						})
						stitchGroundChunkNormals(groundObject, runtimeDefinition, region ?? null)
					} catch (_error) {
						/* noop */
					}
				})
			}
			commitSculptSession(groundNode)
		} else {
			sculptSessionState = null
		}
		return true
	}

	function handleGroundToolPointerDown(event: PointerEvent): boolean {
		if (options.activeBuildTool.value !== 'terrain') {
			return false
		}


		if (event.button === 2) {
			const hasSelection = groundSelection.value || groundSelectionDragState
			if (hasSelection) {
				const canceled = cancelGroundSelection()
				if (canceled) {
					event.preventDefault()
					event.stopPropagation()
					event.stopImmediatePropagation()
					return true
				}
			}
			// Keep terrain tool active and allow RMB drag to control the camera.
			return false
		}

		if (event.button !== 0) {
			return false
		}

		const definition = getGroundDynamicMeshDefinition()
		if (!definition || !raycastGroundPoint(event, groundPointerHelper)) {
			event.preventDefault()
			event.stopPropagation()
			event.stopImmediatePropagation()
			return true
		}
		clampPointToGround(definition, groundPointerHelper)
		const cell = getGroundCellFromPoint(definition, groundPointerHelper)

		if (!groundSelectionDragState) {
			groundSelectionDragState = {
				pointerId: event.pointerId,
				startRow: cell.row,
				startColumn: cell.column,
				currentRow: cell.row,
				currentColumn: cell.column,
				phase: 'pending',
			}
			options.disableOrbitForGroundSelection()
			isGroundToolbarVisible.value = false
			const selection = createGroundSelectionFromCells(definition, cell, cell)
			applyGroundSelectionVisuals(selection, definition)
		} else if (groundSelectionDragState.phase === 'sizing') {
			groundSelectionDragState.pointerId = event.pointerId
			groundSelectionDragState.currentRow = cell.row
			groundSelectionDragState.currentColumn = cell.column
			groundSelectionDragState.phase = 'finalizing'
			updateGroundSelectionFromPointer(event, definition, { forceApply: true })
			options.disableOrbitForGroundSelection()
		} else {
			groundSelectionDragState.pointerId = event.pointerId
			groundSelectionDragState.currentRow = cell.row
			groundSelectionDragState.currentColumn = cell.column
		}

		try {
			options.canvasRef.value?.setPointerCapture(event.pointerId)
		} catch (error) {
			/* noop */
		}
		event.preventDefault()
		event.stopPropagation()
		event.stopImmediatePropagation()
		return true
	}

	function handlePointerDown(event: PointerEvent): boolean {
		if (!event.isPrimary) {
			return false
		}
		if (!options.canvasRef.value || !options.getCamera() || !options.getScene()) {
			return false
		}
		if (options.isAltOverrideActive()) {
			return false
		}

		if (beginScatterErase(event)) {
			return true
		}

		if (beginScatterPlacement(event)) {
			return true
		}

		if (beginPaint(event)) {
			return true
		}

		if (beginSculpt(event)) {
			return true
		}

		return handleGroundToolPointerDown(event)
	}

	function handlePointerMove(event: PointerEvent): boolean {
		const hasGroundNode = getGroundNodeFromScene()?.dynamicMesh?.type === 'Ground'
		const isGroundToolActivated = isGroundBuildToolActive()
		const groundPanelTab = options.groundPanelTab.value
		const scatterEraseModeActive = options.scatterEraseModeActive.value
		const scatterModeActive = scatterModeEnabled()
		const showBrush = isGroundToolActivated && hasGroundNode &&
			(groundPanelTab === 'terrain' || groundPanelTab === 'paint' || scatterEraseModeActive || scatterModeActive)
		if (showBrush) {
			updateBrush(event)
			updateScatterHoverPreview(event)
			if (groundPanelTab === 'paint' && isPainting.value && paintStrokePointerId === event.pointerId) {
				performPaint(event)
			}
			if (groundPanelTab === 'terrain' && !scatterEraseModeActive && isSculpting.value) {
				performSculpt(event)
			}
		} else {
			brushMesh.visible = false
			scatterPreviewGroup.visible = false
		}

		if (options.isAltOverrideActive()) {
			return false
		}

		if (updateScatterErase(event)) {
			return true
		}

		if (updateScatterPlacement(event)) {
			return true
		}

		if (groundSelectionDragState && event.pointerId === groundSelectionDragState.pointerId) {
			const definition = getGroundDynamicMeshDefinition()
			if (!definition) {
				groundSelectionDragState = null
				clearGroundSelection()
				event.preventDefault()
				event.stopPropagation()
				event.stopImmediatePropagation()
				return true
			}
			updateGroundSelectionFromPointer(event, definition)
			event.preventDefault()
			event.stopPropagation()
			event.stopImmediatePropagation()
			return true
		}

		return false
	}

	function handlePointerUp(event: PointerEvent): boolean {
		if (finalizeScatterPlacement(event)) {
			return true
		}
		if (finalizeScatterErase(event)) {
			return true
		}
		if (finalizePaint(event)) {
			return true
		}
		if (finalizeSculpt(event)) {
			return true
		}

		const overrideActive = options.isAltOverrideActive()

		if (groundSelectionDragState && event.pointerId === groundSelectionDragState.pointerId) {
			if (options.canvasRef.value && options.canvasRef.value.hasPointerCapture(event.pointerId)) {
				options.canvasRef.value.releasePointerCapture(event.pointerId)
			}
			if (overrideActive) {
				return true
			}
			const definition = getGroundDynamicMeshDefinition()
			if (!definition) {
				clearGroundSelection()
				event.preventDefault()
				event.stopPropagation()
				event.stopImmediatePropagation()
				return true
			}

			if (groundSelectionDragState.phase === 'pending') {
				updateGroundSelectionFromPointer(event, definition, { forceApply: true })
				groundSelectionDragState.phase = 'sizing'
				options.restoreOrbitAfterGroundSelection()
				isGroundToolbarVisible.value = false
				event.preventDefault()
				event.stopPropagation()
				event.stopImmediatePropagation()
				return true
			}

			if (groundSelectionDragState.phase === 'finalizing') {
				updateGroundSelectionFromPointer(event, definition, { forceApply: true })
				groundSelectionDragState = null
				options.restoreOrbitAfterGroundSelection()
				if (groundSelection.value) {
					isGroundToolbarVisible.value = true
					updateGroundSelectionToolbarPosition()
				} else {
					isGroundToolbarVisible.value = false
				}
				event.preventDefault()
				event.stopPropagation()
				event.stopImmediatePropagation()
				return true
			}

			updateGroundSelectionFromPointer(event, definition, { forceApply: true })
			event.preventDefault()
			event.stopPropagation()
			event.stopImmediatePropagation()
			return true
		}

		return false
	}

	function handlePointerCancel(event: PointerEvent): boolean {
		if (scatterSession && event.pointerId === scatterSession.pointerId) {
			cancelScatterPlacement()
			return true
		}
		if (scatterEraseState && event.pointerId === scatterEraseState.pointerId) {
			cancelScatterErase()
			return true
		}
		if (isPainting.value) {
			finalizePaint(event)
		}
		if (isSculpting.value) {
			finalizeSculpt(event)
		}

		if (groundSelectionDragState && event.pointerId === groundSelectionDragState.pointerId) {
			if (options.canvasRef.value && options.canvasRef.value.hasPointerCapture(event.pointerId)) {
				options.canvasRef.value.releasePointerCapture(event.pointerId)
			}
			groundSelectionDragState = null
			clearGroundSelection()
			options.restoreOrbitAfterGroundSelection()
			isGroundToolbarVisible.value = false
			event.preventDefault()
			event.stopPropagation()
			event.stopImmediatePropagation()
			return true
		}

		return false
	}

	function commitGroundModification(
		modifier: (bounds: { minRow: number; maxRow: number; minColumn: number; maxColumn: number }) => boolean,
	) {
		const selection = groundSelection.value
		const definition = getGroundDynamicMeshDefinition()
		if (!selection || !definition) {
			return
		}
		const bounds = cellSelectionToVertexBounds(selection, definition)
		const changed = modifier(bounds)
		if (!changed) {
			return
		}
		refreshGroundMesh(getGroundDynamicMeshDefinition())
		updateGroundSelectionToolbarPosition()
	}

	function handleGroundRaise() {
		commitGroundModification((bounds) => options.sceneStore.raiseGroundRegion(bounds, GROUND_HEIGHT_STEP))
	}

	function handleGroundLower() {
		commitGroundModification((bounds) => options.sceneStore.lowerGroundRegion(bounds, GROUND_HEIGHT_STEP))
	}

	function handleGroundReset() {
		commitGroundModification((bounds) => options.sceneStore.resetGroundRegion(bounds))
	}

	function handleGroundTextureSelectRequest() {
		if (!groundTextureInputRef.value) {
			return
		}
		groundTextureInputRef.value.value = ''
		groundTextureInputRef.value.click()
	}

	function handleGroundTextureFileChange(event: Event) {
		const input = event.target as HTMLInputElement | null
		if (!input?.files || input.files.length === 0) {
			return
		}
		const file = input.files[0]
		if (!file) {
			return
		}
		const reader = new FileReader()
		reader.onload = () => {
			const result = typeof reader.result === 'string' ? reader.result : null
			if (!result) {
				return
			}
			const changed = options.sceneStore.setGroundTexture({ dataUrl: result, name: file.name ?? null })
			if (!changed) {
				return
			}
			refreshGroundMesh(getGroundDynamicMeshDefinition())
		}
		reader.readAsDataURL(file)
	}

	function handleGroundCancel() {
		cancelGroundSelection()
	}

	function hasActiveSelection() {
		return Boolean(groundSelection.value || groundSelectionDragState)
	}

	function handleActiveBuildToolChange(tool: BuildTool | null) {
		if (tool !== 'terrain') {
			groundSelectionDragState = null
			clearGroundSelection()
			options.restoreOrbitAfterGroundSelection()
			if (sculptSessionState) {
				commitSculptSession(getGroundNodeFromScene())
			}
		}
	}

	function dispose() {
		stopBrushShapeWatch()
		stopScatterEraseModeWatch()
		stopTabWatch()
		stopScatterSelectionWatch()
		stopSceneIdWatch()
		cancelScatterPlacement()
		cancelScatterErase()
		brushMesh.geometry.dispose()
		const material = brushMesh.material as THREE.Material
		material.dispose()
		scatterAreaPreviewFill.geometry.dispose()
		;(scatterAreaPreviewFill.material as THREE.Material).dispose()
		scatterAreaPreviewOutline.geometry.dispose()
		;(scatterAreaPreviewOutline.material as THREE.Material).dispose()
		scatterAreaPreviewGroup.clear()
		groundSelectionGroup.clear()
		scatterPreviewGroup.clear()
		sculptSessionState = null
		pendingTerrainPaintFlush = null
		resetScatterStoreState('dispose')
	}

	return {
		brushMesh,
		scatterAreaPreviewGroup,
		scatterPreviewGroup,
		groundSelectionGroup,
		groundSelection,
		isGroundToolbarVisible,
		groundSelectionToolbarStyle,
		groundTextureInputRef,
		isSculpting,
		restoreGroupdScatter,
		restoreGroundPaint,
		onGroundChunkSetChanged,
		updateScatterLod,
		updateGroundSelectionToolbarPosition,
		clearGroundSelection,
		cancelGroundSelection,
		cancelScatterPlacement,
		cancelScatterErase,
		clearScatterInstances,
		handlePointerDown,
		handlePointerMove,
		handlePointerUp,
		handlePointerCancel,
		handleGroundRaise,
		handleGroundLower,
		handleGroundReset,
		handleGroundTextureSelectRequest,
		handleGroundTextureFileChange,
		handleGroundCancel,
		refreshGroundMesh,
		flushTerrainPaintChanges,
		hasActiveSelection,
		handleActiveBuildToolChange,
		dispose,
	}
}
