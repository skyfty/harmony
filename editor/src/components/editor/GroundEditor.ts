import { reactive, ref, watch, type Ref } from 'vue'
import * as THREE from 'three'
import type { GroundDynamicMesh, GroundSculptOperation, SceneNode, TerrainPaintChannel, TerrainPaintSettings } from '@harmony/schema'
import {
	deleteTerrainScatterStore,
	ensureTerrainScatterStore,
	upsertTerrainScatterLayer,
	replaceTerrainScatterInstances,
	loadTerrainScatterSnapshot,
	serializeTerrainScatterStore,
	type TerrainScatterCategory,
	type TerrainScatterInstance,
	type TerrainScatterLayer,
	type TerrainScatterStore,
	type TerrainScatterStoreSnapshot,
} from '@harmony/schema/terrain-scatter'
import {
	sculptGround,
	sampleGroundHeight,
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
	buildScatterNodeId,
} from '@/utils/terrainScatterRuntime'
import { GROUND_NODE_ID, GROUND_HEIGHT_STEP } from './constants'
import { SCATTER_BRUSH_RADIUS_MAX } from '@/constants/terrainScatter'
import type { BuildTool } from '@/types/build-tool'
import { useSceneStore } from '@/stores/sceneStore'
import type { ProjectAsset } from '@/types/project-asset'
import type { GroundPanelTab } from '@/stores/terrainStore'
import { assetProvider, terrainScatterPresets } from '@/resources/projectProviders/asset'
import { loadObjectFromFile } from '@schema/assetImport'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { computeBlobHash } from '@/utils/blob'
import {
	ensureTerrainPaintPreviewInstalled,
	loadTerrainPaintAssets,
	updateTerrainPaintPreviewLayerTexture,
	updateTerrainPaintPreviewWeightmap,
	decodeWeightmapToData,
	encodeWeightmapToBinary,
} from '@schema/terrainPaintPreview'
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
	paintSmoothness: Ref<number>
	scatterCategory: Ref<TerrainScatterCategory>
	scatterAsset: Ref<ProjectAsset | null>
	scatterBrushRadius: Ref<number>
	scatterEraseRadius: Ref<number>
	scatterDensityPercent: Ref<number>
	activeBuildTool: Ref<BuildTool | null>
	onScatterEraseStart?: () => void
	scatterEraseModeActive: Ref<boolean>
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
const scatterWorldMatrixHelper = new THREE.Matrix4()
const scatterInstanceWorldPositionHelper = new THREE.Vector3()
const scatterBboxSizeHelper = new THREE.Vector3()
const scatterPreviewProjectedHelper = new THREE.Vector3()

const terrainPaintTextureLoader = new THREE.TextureLoader()
const terrainPaintLayerTextureCache = new Map<string, Promise<THREE.Texture | null>>()

async function loadTerrainPaintLayerTexture(asset: ProjectAsset): Promise<THREE.Texture | null> {
	const assetId = typeof asset?.id === 'string' ? asset.id : ''
	if (!assetId) {
		return null
	}
	const cached = terrainPaintLayerTextureCache.get(assetId)
	if (cached) {
		return cached
	}
	const promise = (async () => {
		try {
			const cache = useAssetCacheStore()
			const entry = await cache.downloaProjectAsset(asset)
			const blobUrl = entry?.status === 'cached' ? (entry.blobUrl ?? null) : null
			if (!blobUrl) {
				return null
			}
			const texture = await terrainPaintTextureLoader.loadAsync(blobUrl)
			texture.wrapS = THREE.RepeatWrapping
			texture.wrapT = THREE.RepeatWrapping
			;(texture as any).colorSpace = (THREE as any).SRGBColorSpace ?? (texture as any).colorSpace
			texture.needsUpdate = true
			return texture
		} catch (error) {
			console.warn('加载地貌贴图纹理失败：', error)
			return null
		}
	})()
	terrainPaintLayerTextureCache.set(assetId, promise)
	return promise
}

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

function channelToIndex(channel: TerrainPaintChannel): number {
	switch (channel) {
		case 'r':
			return 0
		case 'g':
			return 1
		case 'b':
			return 2
		case 'a':
			return 3
		default:
			return 1
	}
}

function chooseAvailablePaintChannel(settings: TerrainPaintSettings): TerrainPaintChannel | null {
	const used = new Set<TerrainPaintChannel>(settings.layers.map((layer) => layer.channel))
	const candidates: TerrainPaintChannel[] = ['g', 'b', 'a']
	for (const candidate of candidates) {
		if (!used.has(candidate)) {
			return candidate
		}
	}
	return null
}

function ensureTerrainPaintLayer(settings: TerrainPaintSettings, textureAssetId: string): TerrainPaintChannel | null {
	const trimmed = typeof textureAssetId === 'string' ? textureAssetId.trim() : ''
	if (!trimmed) {
		return null
	}
	const existing = settings.layers.find((layer) => layer.textureAssetId === trimmed)
	if (existing) {
		return existing.channel
	}
	const nextChannel = chooseAvailablePaintChannel(settings)
	if (!nextChannel) {
		return null
	}
	settings.layers.push({ channel: nextChannel, textureAssetId: trimmed })
	return nextChannel
}

function cloneOrCreateTerrainPaintSettings(definition: GroundDynamicMesh): TerrainPaintSettings {
	const existing = definition.terrainPaint
	if (existing && existing.version === 1) {
		return {
			version: 1,
			weightmapResolution: Number.isFinite(existing.weightmapResolution)
				? Math.max(8, Math.min(2048, Math.round(existing.weightmapResolution)))
				: 256,
			layers: Array.isArray(existing.layers) ? existing.layers.map((layer) => ({ ...layer })) : [],
			chunks: existing.chunks ? { ...existing.chunks } : {},
		}
	}
	return {
		version: 1,
		weightmapResolution: 256,
		layers: [],
		chunks: {},
	}
}

function createBlankWeightmap(resolution: number): Uint8ClampedArray {
	const res = Math.max(1, Math.round(resolution))
	const data = new Uint8ClampedArray(res * res * 4)
	for (let i = 0; i < res * res; i += 1) {
		const offset = i * 4
		data[offset] = 255
		data[offset + 1] = 0
		data[offset + 2] = 0
		data[offset + 3] = 0
	}
	return data
}

function normalizeWeightsTo255(weights: [number, number, number, number]): [number, number, number, number] {
	let total = weights[0] + weights[1] + weights[2] + weights[3]
	if (total <= 0) {
		return [255, 0, 0, 0]
	}
	if (total === 255) {
		return weights
	}
	const scale = 255 / total
	let r = Math.round(weights[0] * scale)
	let g = Math.round(weights[1] * scale)
	let b = Math.round(weights[2] * scale)
	let a = Math.round(weights[3] * scale)
	let sum = r + g + b + a
	if (sum !== 255) {
		const diff = 255 - sum
		r = THREE.MathUtils.clamp(r + diff, 0, 255)
		sum = r + g + b + a
		if (sum !== 255) {
			r = THREE.MathUtils.clamp(r, 0, 255)
			g = THREE.MathUtils.clamp(g, 0, 255)
			b = THREE.MathUtils.clamp(b, 0, 255)
			a = THREE.MathUtils.clamp(a, 0, 255)
			const fallbackSum = r + g + b + a
			if (fallbackSum !== 255) {
				r = THREE.MathUtils.clamp(r + (255 - fallbackSum), 0, 255)
			}
		}
	}
	return [r, g, b, a]
}

function addWeightToPixel(data: Uint8ClampedArray, baseOffset: number, targetChannelIndex: number, amount: number): boolean {
	if (!Number.isFinite(amount) || amount <= 0) {
		return false
	}
	const weights: [number, number, number, number] = [
		data[baseOffset] ?? 0,
		data[baseOffset + 1] ?? 0,
		data[baseOffset + 2] ?? 0,
		data[baseOffset + 3] ?? 0,
	]
	const normalized = normalizeWeightsTo255(weights)
	let r = normalized[0]
	let g = normalized[1]
	let b = normalized[2]
	let a = normalized[3]
	const idx = THREE.MathUtils.clamp(Math.floor(targetChannelIndex), 0, 3)
	const get = (i: number) => (i === 0 ? r : i === 1 ? g : i === 2 ? b : a)
	const set = (i: number, value: number) => {
		if (i === 0) r = value
		else if (i === 1) g = value
		else if (i === 2) b = value
		else a = value
	}
	const available = 255 - get(idx)
	const delta = Math.min(available, Math.max(0, Math.round(amount)))
	if (delta <= 0) {
		return false
	}
	set(idx, get(idx) + delta)
	let remaining = delta
	const otherTotal = 255 - get(idx) + remaining
	if (otherTotal > 0) {
		for (let c = 0; c < 4; c += 1) {
			if (c === idx) {
				continue
			}
			const current = get(c)
			const take = Math.min(current, Math.floor((delta * current) / otherTotal))
			set(c, current - take)
			remaining -= take
		}
	}
	if (remaining > 0) {
		for (let c = 0; c < 4; c += 1) {
			if (c === idx) {
				continue
			}
			if (remaining <= 0) {
				break
			}
			const current = get(c)
			const take = Math.min(current, remaining)
			set(c, current - take)
			remaining -= take
		}
	}
	data[baseOffset] = r
	data[baseOffset + 1] = g
	data[baseOffset + 2] = b
	data[baseOffset + 3] = a
	return true
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


function blurWeightmap(data: Uint8ClampedArray, resolution: number, iterations: number): Uint8ClampedArray {
	const res = Math.max(1, Math.round(resolution))
	let src: Uint8ClampedArray<ArrayBufferLike> = data
	let dst: Uint8ClampedArray<ArrayBufferLike> = new Uint8ClampedArray(src.length) as Uint8ClampedArray<ArrayBufferLike>
	const iters = Math.max(0, Math.min(8, Math.round(iterations)))
	for (let iter = 0; iter < iters; iter += 1) {
		for (let y = 0; y < res; y += 1) {
			for (let x = 0; x < res; x += 1) {
				const base = (y * res + x) * 4
				const sums: [number, number, number, number] = [0, 0, 0, 0]
				let count = 0
				for (let oy = -1; oy <= 1; oy += 1) {
					const yy = THREE.MathUtils.clamp(y + oy, 0, res - 1)
					for (let ox = -1; ox <= 1; ox += 1) {
						const xx = THREE.MathUtils.clamp(x + ox, 0, res - 1)
						const off = (yy * res + xx) * 4
						sums[0] += src[off] ?? 0
						sums[1] += src[off + 1] ?? 0
						sums[2] += src[off + 2] ?? 0
						sums[3] += src[off + 3] ?? 0
						count += 1
					}
				}
				const r = Math.round(sums[0] / Math.max(1, count))
				const g = Math.round(sums[1] / Math.max(1, count))
				const b = Math.round(sums[2] / Math.max(1, count))
				const a = Math.round(sums[3] / Math.max(1, count))
				const normalized = normalizeWeightsTo255([r, g, b, a])
				dst[base] = normalized[0]
				dst[base + 1] = normalized[1]
				dst[base + 2] = normalized[2]
				dst[base + 3] = normalized[3]
			}
		}
		const swap = src
		src = dst
		dst = swap
	}
	return src
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

type ScatterSessionState = {
	pointerId: number
	asset: ProjectAsset
	bindingAssetId: string
	lodPresetAssetId: string | null
	category: TerrainScatterCategory
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
}

let scatterSession: ScatterSessionState | null = null

type TerrainPaintStampRequest = {
	localX: number
	localZ: number
	radius: number
	strength: number
	channelIndex: number
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
	data: Uint8ClampedArray
	status: 'loading' | 'ready'
	loadPromise: Promise<void> | null
	pendingStamps: TerrainPaintStampRequest[]
	dirty: boolean
}

type PaintSessionState = {
	nodeId: string
	definition: GroundDynamicMesh
	chunkCells: number
	settings: TerrainPaintSettings
	chunkStates: Map<string, PaintChunkState>
	hasPendingChanges: boolean
}

let paintSessionState: PaintSessionState | null = null
let paintCommitToken = 0

// Scatter sampling/config constants
const SCATTER_EXISTING_CHECKS_PER_STAMP_MAX = 4096
const SCATTER_SAMPLE_ATTEMPTS_MAX = 500

// Safety cap to avoid runaway interactive placement on tiny assets / huge brushes.
// Keep this high so densityPercent remains proportional for common use-cases.
const SCATTER_MAX_INSTANCES_PER_STAMP = 20000

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
}

let scatterEraseState: ScatterEraseState | null = null

type SculptSessionState = {
	nodeId: string
	definition: GroundDynamicMesh
	heightMap: GroundDynamicMesh['heightMap']
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
		const x = Math.cos(angle + step * (i + 1)) * radius
		const y = Math.sin(angle + step * (i + 1)) * radius
		shape.lineTo(x, y)
	}
	shape.closePath()
	return shape
}

function createBrushGeometry(shape: TerrainBrushShape): THREE.BufferGeometry {
	if (shape === 'square') {
		return new THREE.PlaneGeometry(2, 2)
	}
	if (shape === 'star') {
		return new THREE.ShapeGeometry(createStarShape())
	}
	return new THREE.CircleGeometry(1, 64)
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
		definition: GroundDynamicMesh
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
	const pendingScatterModelLoads = new Map<string, Promise<void>>()
	const scatterLodPresetCache = new Map<string, Awaited<ReturnType<typeof options.sceneStore.loadLodPreset>> | null>()
	const pendingScatterLodPresetLoads = new Map<string, Promise<void>>()
	let lastScatterLodUpdateAt = 0
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

	function getIndicatorBrushShape(): TerrainBrushShape {
		// Scatter paint/erase use a consistent circle indicator for clarity.
		if (options.scatterEraseModeActive.value || scatterModeEnabled()) {
			return 'circle'
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
			return 0x8bc34a
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
	refreshBrushAppearance()

	const stopTabWatch = watch(options.groundPanelTab, (tab) => {
		if (tab === 'terrain' || tab === 'paint') {
			cancelScatterPlacement()
			cancelScatterErase()
		}
		if (tab === 'paint') {
			const selectedNode = options.sceneStore.selectedNode
			if (selectedNode?.dynamicMesh?.type === 'Ground') {
				const definition = selectedNode.dynamicMesh as GroundDynamicMesh
				const groundObject = getGroundObject()
				const settings = cloneOrCreateTerrainPaintSettings(definition)
				if (groundObject) {
					ensureTerrainPaintPreviewInstalled(groundObject, definition, settings)
				}
				// Warm layer textures (best-effort).
				const catalogMap = options.sceneStore.collectCatalogAssetMap()
				settings.layers.forEach((layer) => {
					const asset = catalogMap.get(layer.textureAssetId) ?? null
					if (asset) {
						void pushTerrainPaintPreviewLayer(
							{
								nodeId: selectedNode.id,
								definition,
								chunkCells: resolveGroundChunkCells(definition),
								settings,
								chunkStates: new Map(),
												hasPendingChanges: false,
							},
							layer.channel,
							asset,
						)
					}
				})
				// Warm currently loaded chunk weightmaps.
				const session = ensurePaintSession(definition, selectedNode.id)
				settings.chunks && Object.entries(settings.chunks).forEach(([key]) => {
					const parts = key.split(':')
					const chunkRow = Number.parseInt(parts[0] ?? '', 10)
					const chunkColumn = Number.parseInt(parts[1] ?? '', 10)
					if (!Number.isFinite(chunkRow) || !Number.isFinite(chunkColumn)) {
						return
					}
					// Only prewarm if the chunk mesh is currently present (loaded).
					const loaded = groundObject
						? !!groundObject.children.find((child) => (child as any)?.userData?.groundChunk?.chunkRow === chunkRow && (child as any)?.userData?.groundChunk?.chunkColumn === chunkColumn)
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
		if (!raycastGroundPoint(event, scatterPointerHelper)) {
			scatterPreviewGroup.visible = false
			return
		}
		if (!isPointerOverGround(definition, groundMesh, scatterPointerHelper)) {
			scatterPreviewGroup.visible = false
			return
		}

		// Project onto terrain height.
		scatterPreviewProjectedHelper.copy(scatterPointerHelper)
		groundMesh.updateMatrixWorld(true)
		groundMesh.worldToLocal(scatterPreviewProjectedHelper)
		const height = sampleGroundHeight(definition, scatterPreviewProjectedHelper.x, scatterPreviewProjectedHelper.z)
		scatterPreviewProjectedHelper.y = height
		groundMesh.localToWorld(scatterPreviewProjectedHelper)

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
					const object = await loadObjectFromFile(file)
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

				resetScatterStoreState('scene-changed')
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

	async function ensureTerrainPaintLayersPushed(
		session: PaintSessionState,
		catalogMap: Map<string, ProjectAsset>,
		tokenSnapshot: number,
	): Promise<void> {
		const groundObject = getGroundObject()
		if (!groundObject) {
			return
		}
		ensureTerrainPaintPreviewInstalled(groundObject, session.definition, session.settings)
		const materials = getGroundPreviewMaterials(groundObject)
		if (!materials.length) {
			return
		}

		// Always clear first to avoid stale textures leaking across scene switches.
		materials.forEach((material) => {
			updateTerrainPaintPreviewLayerTexture(material, 'g', null)
			updateTerrainPaintPreviewLayerTexture(material, 'b', null)
			updateTerrainPaintPreviewLayerTexture(material, 'a', null)
		})

		for (const layer of session.settings.layers ?? []) {
			if (tokenSnapshot !== options.sceneStore.sceneSwitchToken) {
				return
			}
			const textureAssetId = typeof layer?.textureAssetId === 'string' ? layer.textureAssetId.trim() : ''
			if (!textureAssetId) {
				materials.forEach((material) => {
					updateTerrainPaintPreviewLayerTexture(material, layer.channel, null)
				})
				continue
			}
			const asset = catalogMap.get(textureAssetId) ?? null
			if (!asset) {
				// Silent skip (and clear the channel so it doesn't keep stale data).
				materials.forEach((material) => {
					updateTerrainPaintPreviewLayerTexture(material, layer.channel, null)
				})
				continue
			}
			const texture = await loadTerrainPaintLayerTexture(asset)
			if (tokenSnapshot !== options.sceneStore.sceneSwitchToken) {
				return
			}
			if (!texture) {
				// Silent skip
				materials.forEach((material) => {
					updateTerrainPaintPreviewLayerTexture(material, layer.channel, null)
				})
				continue
			}
			materials.forEach((material) => {
				updateTerrainPaintPreviewLayerTexture(material, layer.channel, texture)
			})
		}
	}

	async function loadTerrainPaintAssetsForChunkKeys(
		groundMesh: THREE.Object3D,
		definition: GroundDynamicMesh,
		settings: TerrainPaintSettings,
		chunkKeys: Iterable<string>,
		tokenSnapshot: number,
	): Promise<void> {
		if (tokenSnapshot !== options.sceneStore.sceneSwitchToken) {
			return
		}

		const subsetChunks: NonNullable<TerrainPaintSettings['chunks']> = {}
		for (const key of chunkKeys) {
			const trimmed = typeof key === 'string' ? key.trim() : ''
			if (!trimmed) {
				continue
			}
			const ref = settings.chunks?.[trimmed]
			if (ref) {
				subsetChunks[trimmed] = ref
			}
		}

		const subsetSettings: TerrainPaintSettings = {
			...settings,
			chunks: subsetChunks,
		}

		await loadTerrainPaintAssets(
			groundMesh,
			definition,
			subsetSettings,
			async (assetId) => {
				const trimmed = typeof assetId === 'string' ? assetId.trim() : ''
				if (!trimmed) {
					return null
				}
				try {
					const restored = await assetCacheStore.loadFromIndexedDb(trimmed)
					if (restored?.status === 'cached' && restored.blob) {
						return restored.blob
					}
				} catch (error) {
					/* noop */
				}
				const embedded = options.sceneStore.packageAssetMap?.[`local::${trimmed}`]
				if (typeof embedded === 'string' && embedded.startsWith('data:')) {
					try {
						const response = await fetch(embedded)
						if (response.ok) {
							return await response.blob()
						}
					} catch (error) {
						/* noop */
					}
				}
				return null
			},
			async (assetId) => {
				const trimmed = typeof assetId === 'string' ? assetId.trim() : ''
				if (!trimmed) {
					return null
				}
				const asset = options.sceneStore.getAsset(trimmed)
				if (asset) {
					return await loadTerrainPaintLayerTexture(asset)
				}
				const mappedUrl = options.sceneStore.packageAssetMap?.[`url::${trimmed}`]
				if (typeof mappedUrl === 'string' && mappedUrl.trim().length) {
					const pseudoAsset: ProjectAsset = {
						id: trimmed,
						name: trimmed,
						type: 'texture',
						downloadUrl: mappedUrl,
						previewColor: '#ffffff',
						thumbnail: null,
						description: undefined,
						gleaned: true,
					}
					return await loadTerrainPaintLayerTexture(pseudoAsset)
				}
				return null
			},
		)
	}

	function applyTerrainPaintForChunkKey(session: PaintSessionState, chunk: { key: string; chunkRow: number; chunkColumn: number }): void {
		const ref = session.settings.chunks?.[chunk.key] ?? null
		const logicalId = typeof (ref as any)?.logicalId === 'string' ? String((ref as any).logicalId).trim() : ''
		const state = ensurePaintChunkState(session, chunk)
		if (!logicalId) {
			// Ensure stale cached textures don't leak into this scene.
			pushTerrainPaintPreviewWeightmap(session, state)
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
		// Ensure we're working off the latest stored settings snapshot.
		session.settings = cloneOrCreateTerrainPaintSettings(definition)
		session.chunkStates = new Map()
		session.hasPendingChanges = false
		ensureTerrainPaintPreviewInstalled(groundMesh, definition, session.settings)

		const catalogMap = options.sceneStore.collectCatalogAssetMap()
		await ensureTerrainPaintLayersPushed(session, catalogMap, tokenSnapshot)
		if (tokenSnapshot !== options.sceneStore.sceneSwitchToken) {
			return
		}

		const visibleChunks = collectVisibleTerrainPaintChunks(groundMesh)
		// Load paint assets for the current scene so preview can render after reload.
		// We intentionally only load streamed-in (visible) chunks for performance.
		await loadTerrainPaintAssetsForChunkKeys(
			groundMesh,
			definition,
			session.settings,
			visibleChunks.map((chunk) => chunk.key),
			tokenSnapshot,
		)
		if (tokenSnapshot !== options.sceneStore.sceneSwitchToken) {
			return
		}

		const nextVisibleKeys = new Set<string>()
		for (const chunk of visibleChunks) {
			if (tokenSnapshot !== options.sceneStore.sceneSwitchToken) {
				return
			}
			nextVisibleKeys.add(chunk.key)
			applyTerrainPaintForChunkKey(session, chunk)
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
		// Rebind preview hooks for newly created chunk meshes.
		ensureTerrainPaintPreviewInstalled(groundMesh, definition, session.settings)

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
			// Load weightmaps for newly streamed-in chunks.
			// We keep this separate from ensurePaintChunkState so preview updates immediately.
			// (The paint session state is still initialized via applyTerrainPaintForChunkKey below.)
			applyTerrainPaintForChunkKey(session, chunk)
		}

		if (newlyVisible.length) {
			await loadTerrainPaintAssetsForChunkKeys(
				groundMesh,
				definition,
				session.settings,
				newlyVisible.map((chunk) => chunk.key),
				tokenSnapshot,
			)
			if (tokenSnapshot !== options.sceneStore.sceneSwitchToken) {
				return
			}
		}
		lastVisibleTerrainPaintChunkKeys = nextVisibleKeys
	}

	function onGroundChunkSetChanged(): void {
		scheduleTerrainPaintStreamingSync()
	}

	async function restoreGroupdScatter(): Promise<void> {
		const store = ensureScatterStoreRef()
		const groundMesh = getGroundObject()
		const definition = getGroundDynamicMeshDefinition()
		if (!groundMesh || !definition || store.layers.size === 0) {
			return
		}
		updateGroundChunks(groundMesh, definition, options.getCamera())

		const resolveSelectionAssetId = (instance: TerrainScatterInstance, layer: TerrainScatterLayer): string | null => {
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
				const matrix = composeScatterMatrix(instance, groundMesh, scatterWorldMatrixHelper)
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
			} catch (error) {
				console.warn('载入地面散布快照失败', error)
				scatterStore = ensureTerrainScatterStore(GROUND_NODE_ID)
			}
		}
		if (!scatterStore) {
			scatterStore = ensureTerrainScatterStore(GROUND_NODE_ID)
		}
		return scatterStore
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
				const object = await loadObjectFromFile(file)
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
	): TerrainScatterLayer | null {
		const store = ensureScatterStoreRef()
		const result = replaceTerrainScatterInstances(store, layer.id, instances)
		if (result && scatterLayer && scatterLayer.id === layer.id) {
			scatterLayer = result
		}
		if (result) {
			syncTerrainScatterSnapshotToScene(store)
		}
		return result
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

	function findGroundNodeInTree(nodes: SceneNode[]): SceneNode | null {
		for (const node of nodes) {
			if (node.id === GROUND_NODE_ID || node.dynamicMesh?.type === 'Ground') {
				return node
			}
			if (node.children?.length) {
				const nested = findGroundNodeInTree(node.children)
				if (nested) {
					return nested
				}
			}
		}
		return null
	}

	function getGroundNodeFromScene(): SceneNode | null {
		return findGroundNodeInTree(options.sceneStore.nodes)
	}

	function getGroundTerrainScatterSnapshot(): TerrainScatterStoreSnapshot | null {
		const node = getGroundNodeFromScene()
		if (node?.dynamicMesh?.type !== 'Ground') {
			return null
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

	function syncTerrainScatterSnapshotToScene(storeOverride?: TerrainScatterStore | null): void {
		const store = storeOverride ?? scatterStore
		if (!store) {
			return
		}
		const snapshot = serializeTerrainScatterStore(store)
		const groundNode = getGroundNodeFromScene()
		if (!groundNode || groundNode.dynamicMesh?.type !== 'Ground') {
			return
		}
		const nextMesh: GroundDynamicMesh = {
			...(groundNode.dynamicMesh as GroundDynamicMesh),
			terrainScatter: snapshot,
		}
		groundNode.dynamicMesh = nextMesh
		scatterSnapshotUpdatedAt = getScatterSnapshotTimestamp(snapshot)
	}

	function getGroundDynamicMeshDefinition(): GroundDynamicMesh | null {
		const node = getGroundNodeFromScene()
		if (node?.dynamicMesh?.type === 'Ground') {
			if (sculptSessionState && sculptSessionState.nodeId === node.id) {
				return sculptSessionState.definition
			}
			return node.dynamicMesh
		}
		return null
	}

	function getGroundObject(): THREE.Object3D | null {
		return options.objectMap.get(GROUND_NODE_ID) ?? null
	}

	function ensureSculptSession(definition: GroundDynamicMesh, nodeId: string): GroundDynamicMesh {
		if (sculptSessionState && sculptSessionState.nodeId === nodeId) {
			return sculptSessionState.definition
		}
		// PERF: Cloning a very large sparse heightMap can stall the UI for seconds.
		// Sculpt currently has no cancel/revert flow, so we avoid the full clone and mutate the existing map.
		const clonedHeightMap = definition.heightMap
		const sessionDefinition: GroundDynamicMesh = {
			...definition,
			heightMap: clonedHeightMap,
		}
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
		const nextDynamicMesh: GroundDynamicMesh = {
			...(targetNode.dynamicMesh as GroundDynamicMesh),
			heightMap: sculptSessionState.heightMap,
		}
		targetNode.dynamicMesh = nextDynamicMesh
		options.sceneStore.updateNodeDynamicMesh(targetNode.id, nextDynamicMesh)
		sculptSessionState = null
		return true
	}

	function ensurePaintSession(definition: GroundDynamicMesh, nodeId: string): PaintSessionState {
		if (paintSessionState && paintSessionState.nodeId === nodeId) {
			return paintSessionState
		}
		const chunkCells = resolveGroundChunkCells(definition)
		paintSessionState = {
			nodeId,
			definition,
			chunkCells,
			settings: cloneOrCreateTerrainPaintSettings(definition),
			chunkStates: new Map(),
			hasPendingChanges: false,
		}
		const groundObject = getGroundObject()
		if (groundObject) {
			ensureTerrainPaintPreviewInstalled(groundObject, definition, paintSessionState.settings)
		}
		return paintSessionState
	}

	function getGroundPreviewMaterials(groundObject: THREE.Object3D): THREE.Material[] {
		const userData = (groundObject.userData as Record<string, unknown> | undefined) ?? {}
		const cachedMaterials = (userData as any).groundMaterials as THREE.Material[] | undefined
		if (Array.isArray(cachedMaterials) && cachedMaterials.length) {
			return cachedMaterials.filter(Boolean)
		}
		const cachedMaterialValue = (userData as any).groundMaterial as THREE.Material | THREE.Material[] | undefined
		if (cachedMaterialValue) {
			return Array.isArray(cachedMaterialValue)
				? cachedMaterialValue.filter(Boolean)
				: [cachedMaterialValue]
		}
		const found = new Set<THREE.Material>()
		groundObject.traverse((obj) => {
			const mesh = obj as THREE.Mesh
			if (!mesh?.isMesh) {
				return
			}
			const material = mesh.material
			if (Array.isArray(material)) {
				material.forEach((mat) => {
					if (mat) {
						found.add(mat)
					}
				})
				return
			}
			if (material) {
				found.add(material)
			}
		})
		return Array.from(found)
	}

	function pushTerrainPaintPreviewWeightmap(session: PaintSessionState, chunk: PaintChunkState): void {
		const groundObject = getGroundObject()
		if (!groundObject) {
			return
		}
		ensureTerrainPaintPreviewInstalled(groundObject, session.definition, session.settings)
		const materials = getGroundPreviewMaterials(groundObject)
		if (!materials.length) {
			return
		}
		materials.forEach((material) => {
			updateTerrainPaintPreviewWeightmap(material, chunk.key, chunk.data, chunk.resolution)
		})
	}

	async function pushTerrainPaintPreviewLayer(session: PaintSessionState, channel: TerrainPaintChannel, asset: ProjectAsset): Promise<void> {
		const groundObject = getGroundObject()
		if (!groundObject) {
			return
		}
		ensureTerrainPaintPreviewInstalled(groundObject, session.definition, session.settings)
		const materials = getGroundPreviewMaterials(groundObject)
		if (!materials.length) {
			return
		}
		const texture = await loadTerrainPaintLayerTexture(asset)
		if (!texture) {
			return
		}
		materials.forEach((material) => {
			updateTerrainPaintPreviewLayerTexture(material, channel, texture)
		})
	}

	function ensurePaintChunkState(session: PaintSessionState, payload: { key: string; chunkRow: number; chunkColumn: number }): PaintChunkState {
		const existing = session.chunkStates.get(payload.key)
		if (existing) {
			return existing
		}
		const resolution = session.settings.weightmapResolution
		const state: PaintChunkState = {
			key: payload.key,
			chunkRow: payload.chunkRow,
			chunkColumn: payload.chunkColumn,
			resolution,
			data: createBlankWeightmap(resolution),
			status: 'ready',
			loadPromise: null,
			pendingStamps: [],
			dirty: false,
		}
		session.chunkStates.set(payload.key, state)

		const ref = session.settings.chunks?.[payload.key] ?? null
		const logicalId = typeof (ref as any)?.logicalId === 'string' ? String((ref as any).logicalId).trim() : ''
		if (logicalId) {
			state.status = 'loading'
			state.loadPromise = (async () => {
				try {
					const cache = useAssetCacheStore()
					let entry = cache.getEntry(logicalId)
					let blob: Blob | null = entry.status === 'cached' ? (entry.blob ?? null) : null
					if (!blob) {
						entry = (await cache.loadFromIndexedDb(logicalId)) ?? entry
						blob = entry.status === 'cached' ? (entry.blob ?? null) : null
					}
					if (blob) {
						state.data = await decodeWeightmapToData(blob, state.resolution)
					}
				} catch (error) {
					console.warn('加载地貌权重贴图失败，回退到空白贴图：', error)
					state.data = createBlankWeightmap(state.resolution)
				} finally {
					pushTerrainPaintPreviewWeightmap(session, state)
					state.status = 'ready'
					state.loadPromise = null
					if (state.pendingStamps.length) {
						const pending = [...state.pendingStamps]
						state.pendingStamps.length = 0
						pending.forEach((stamp) => {
							applyPaintStampToChunk(session, state, stamp)
						})
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
		const strength255 = strength * 255
		let any = false
		for (let y = minY; y <= maxY; y += 1) {
			for (let x = minX; x <= maxX; x += 1) {
				const pxMeters = ((x + 0.5) / res) * bounds.width
				const pzMeters = ((y + 0.5) / res) * bounds.depth
				const dx = pxMeters - cxMeters
				const dz = pzMeters - czMeters
				const dist = Math.hypot(dx, dz)
				if (dist > radius) {
					continue
				}
				const t = dist / Math.max(1e-6, radius)
				const falloff = (1 - t) * (1 - t)
				const amount = strength255 * falloff
				const offset = (y * res + x) * 4
				if (addWeightToPixel(chunk.data, offset, stamp.channelIndex, amount)) {
					any = true
				}
			}
		}
		if (any) {
			const becameDirty = !chunk.dirty
			chunk.dirty = true
			pushTerrainPaintPreviewWeightmap(session, chunk)
			if (becameDirty && !session.hasPendingChanges) {
				session.hasPendingChanges = true
				options.sceneStore.updateNodeDynamicMesh(session.nodeId, { hasManualEdits: true })
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

	async function flushTerrainPaintChanges(): Promise<boolean> {
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

			const smoothness = clamp01(options.paintSmoothness.value)
			const smoothIterations = Math.max(0, Math.min(6, Math.round(smoothness * 4)))
			if (smoothIterations > 0) {
				dirtyChunks.forEach((chunk) => {
					chunk.data = blurWeightmap(chunk.data, chunk.resolution, smoothIterations)
					pushTerrainPaintPreviewWeightmap(session, chunk)
				})
			}

			const groundObject = getGroundObject()
			if (groundObject) {
				ensureTerrainPaintPreviewInstalled(groundObject, session.definition, session.settings)
			}

			const cache = useAssetCacheStore()
			for (const chunk of dirtyChunks) {
				if (token !== paintCommitToken) {
					return false
				}
				const weightmapBlob = encodeWeightmapToBinary(chunk.data, chunk.resolution)
				const filename = `terrain-weightmap_${session.nodeId}_${chunk.key}.bin`
				const logicalId = await computeBlobHash(weightmapBlob)
				await cache.storeAssetBlob(logicalId, {
					blob: weightmapBlob,
					mimeType: 'application/octet-stream',
					filename,
				})
				options.sceneStore.registerAsset(
					{
						id: logicalId,
						name: filename,
						type: 'file',
						downloadUrl: logicalId,
						previewColor: '#ffffff',
						thumbnail: null,
						description: `Terrain weightmap (${session.nodeId}:${chunk.key})`,
						gleaned: true,
					},
					{
						source: { type: 'local' },
						internal: true,
						commitOptions: { updateNodes: false },
					},
				)
				session.settings.chunks[chunk.key] = {
					logicalId,
				}
				chunk.dirty = false
			}
			if (token !== paintCommitToken) {
				return false
			}
			options.sceneStore.updateNodeDynamicMesh(session.nodeId, {
				terrainPaint: session.settings,
				hasManualEdits: true,
			})
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

	function scatterModeEnabled(): boolean {
		if (options.scatterEraseModeActive.value) {
			return false
		}
		if (options.groundPanelTab.value === 'terrain' || options.groundPanelTab.value === 'paint') {
			return false
		}
		if (!options.scatterAsset.value) {
			return false
		}
		const selectedNode = options.sceneStore.selectedNode
		return selectedNode?.dynamicMesh?.type === 'Ground'
	}

	function paintModeEnabled(): boolean {
		if (options.scatterEraseModeActive.value) {
			return false
		}
		if (options.groundPanelTab.value !== 'paint') {
			return false
		}
		if (!options.paintAsset.value) {
			return false
		}
		const selectedNode = options.sceneStore.selectedNode
		return selectedNode?.dynamicMesh?.type === 'Ground'
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

	function projectScatterPoint(worldPoint: THREE.Vector3): THREE.Vector3 | null {
		if (!scatterSession) {
			return null
		}
		const { groundMesh, definition } = scatterSession
		const localPoint = worldPoint.clone()
		groundMesh.worldToLocal(localPoint)
		// Never place scatter outside the ground bounds.
		// (We still use the heightmap for Y, but XZ must remain inside the ground region.)
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

	function applyScatterPlacement(worldPoint: THREE.Vector3): boolean {
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
		const rotation = new THREE.Vector3(0, Math.random() * Math.PI * 2, 0)
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
		const matrix = composeScatterMatrix(stored, scatterSession.groundMesh, scatterWorldMatrixHelper)
		const bound = bindScatterInstance(stored, matrix, scatterSession.bindingAssetId)
		if (!bound) {
			persistScatterInstances(nextLayer, nextLayer.instances.filter((entry) => entry.id !== stored.id))
			return false
		}
		scatterRuntimeAssetIdByNodeId.set(buildScatterNodeId(nextLayer.id, stored.id), scatterSession.bindingAssetId)
		addScatterInstanceToNeighborIndex(scatterSession, stored)
		return true
	}

	function sampleScatterPointsInBrush(worldCenterPoint: THREE.Vector3): THREE.Vector3[] {
		if (!scatterSession || !scatterSession.layer || !scatterSession.modelGroup) {
			return []
		}
		const radius = scatterSession.radius
		const spacing = scatterSession.spacing
		const spacingSq = spacing * spacing

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

		// Local grid index for points accepted in this stamp (fast intra-stamp overlap checks).
		const cellSize = Math.max(1e-6, spacing)
		const stampIndex = new Map<string, THREE.Vector3[]>()
		const stampCellKey = (p: THREE.Vector3) => {
			const cx = Math.floor(p.x / cellSize)
			const cz = Math.floor(p.z / cellSize)
			return `${cx}:${cz}`
		}
		const stampIndexInsert = (p: THREE.Vector3) => {
			const key = stampCellKey(p)
			const bucket = stampIndex.get(key)
			if (bucket) {
				bucket.push(p)
			} else {
				stampIndex.set(key, [p])
			}
		}
		const stampIndexHasNeighborTooClose = (p: THREE.Vector3) => {
			const cx = Math.floor(p.x / cellSize)
			const cz = Math.floor(p.z / cellSize)
			for (let dz = -1; dz <= 1; dz += 1) {
				for (let dx = -1; dx <= 1; dx += 1) {
					const bucket = stampIndex.get(`${cx + dx}:${cz + dz}`)
					if (!bucket?.length) {
						continue
					}
					for (const q of bucket) {
						const ddx = q.x - p.x
						const ddz = q.z - p.z
						if (ddx * ddx + ddz * ddz < spacingSq) {
							return true
						}
					}
				}
			}
			return false
		}

		// Budget for overlap checks against existing instances.
		const existingBudget = { totalChecks: 0 }
		// Avoid repeated matrix updates during sampling.
		scatterSession.groundMesh.updateMatrixWorld(true)

		// Always place one instance at the click center.
		// Center placement is not restricted by overlap checks.
		{
			const p = centerProjected.clone()
			accepted.push(p)
			stampIndexInsert(p)
		}

		for (let attempt = 0; attempt < maxAttempts && accepted.length < targetCount; attempt += 1) {
			const u = Math.random()
			const v = Math.random()
			const r = Math.sqrt(u) * radius
			const theta = v * Math.PI * 2
			scatterPlacementCandidateWorldHelper.set(
				centerProjected.x + Math.cos(theta) * r,
				centerProjected.y,
				centerProjected.z + Math.sin(theta) * r,
			)
			const projected = projectScatterPoint(scatterPlacementCandidateWorldHelper)
			if (!projected) {
				continue
			}
			// Avoid overlaps within this stamp (XZ plane).
			if (stampIndexHasNeighborTooClose(projected)) {
				continue
			}

			// Avoid overlaps with existing instances (ground-local XZ plane).
			scatterPlacementCandidateLocalHelper.copy(projected)
			scatterSession.groundMesh.worldToLocal(scatterPlacementCandidateLocalHelper)
			if (
				scatterSession.neighborIndex &&
				scatterSession.neighborIndex.size &&
				!isScatterPlacementAvailableByIndex(
					scatterSession,
					scatterPlacementCandidateLocalHelper.x,
					scatterPlacementCandidateLocalHelper.z,
					spacingSq,
					existingBudget,
				)
			) {
				continue
			}
			// Fallback if index not present.
			if (!scatterSession.neighborIndex.size && !isScatterPlacementAvailable(projected, spacing, scatterSession)) {
				continue
			}
			const p = projected.clone()
			accepted.push(p)
			stampIndexInsert(p)
		}
		return accepted
	}
	
	function paintScatterStamp(worldCenterPoint: THREE.Vector3): void {
		if (!scatterSession || !scatterSession.layer || !scatterSession.modelGroup) {
			return
		}
		const points = sampleScatterPointsInBrush(worldCenterPoint)
		for (const point of points) {
			applyScatterPlacement(point)
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
		if (!scatterModeEnabled() || event.button !== 0 || event.shiftKey) {
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
		updateGroundChunks(groundMesh, definition, options.getCamera())
		if (!raycastGroundPoint(event, scatterPointerHelper)) {
			return false
		}
		// Do not place scatter if the pointer is not over the ground region.
		if (!isPointerOverGround(definition, groundMesh, scatterPointerHelper)) {
			return false
		}
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

		const brushAreaM2 = Math.PI * effectiveRadius * effectiveRadius
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

		const effectiveSpacing = spacingStats.minDistance
		const chunkCells = resolveChunkCellsForDefinition(definition)
		scatterSession = {
			pointerId: event.pointerId,
			asset,
			bindingAssetId,
			lodPresetAssetId: scatterResolvedLodPresetAssetId,
			category,
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
		}
		traceScatterPath(scatterPointerHelper.clone())
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

	function updateScatterLod(): void {
		const camera = options.getCamera()
		if (!camera) {
			return
		}
		const store = scatterStore ?? ensureScatterStoreRef()
		const groundMesh = getGroundObject()
		if (!groundMesh || !store.layers.size) {
			return
		}
		const now = Date.now()
		if (now - lastScatterLodUpdateAt < 200) {
			return
		}
		lastScatterLodUpdateAt = now
		scatterLodCameraPosition.copy(camera.position)

		camera.updateMatrixWorld(true)
		scatterCullingProjView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
		scatterCullingFrustum.setFromProjectionMatrix(scatterCullingProjView)

		const scatterCandidateIds: string[] = []
		const scatterCandidateByNodeId = new Map<
			string,
			{ layer: TerrainScatterLayer; instance: TerrainScatterInstance; preset: any }
		>()
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
			const boundAssetId = scatterRuntimeAssetIdByNodeId.get(nodeId) ?? resolveLodBindingAssetId(entry.preset)
			const baseRadius = boundAssetId ? (getCachedModelObject(boundAssetId)?.radius ?? 0.5) : 0.5
			const scale = entry.instance.localScale
			const scaleFactor = Math.max(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1)
			const radius = baseRadius * (Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1)
			return { radius }
		})

		for (const layer of store.layers.values()) {
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
			if (!layer.instances?.length) {
				continue
			}
			for (const instance of layer.instances) {
				const nodeId = buildScatterNodeId(layer.id, instance.id)
				if (!visibleScatterIds.has(nodeId)) {
					releaseScatterInstance(instance)
					continue
				}
				const worldPos = getScatterInstanceWorldPosition(instance, groundMesh, scatterInstanceWorldPositionHelper)
				const distance = worldPos.distanceTo(scatterLodCameraPosition)
				const desired = chooseLodModelAssetId(preset, distance) ?? resolveLodBindingAssetId(preset)
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
				const matrix = composeScatterMatrix(instance, groundMesh, scatterWorldMatrixHelper)
				if (!bindScatterInstance(instance, matrix, desired)) {
					continue
				}
				scatterRuntimeAssetIdByNodeId.set(nodeId, desired)
			}
		}
	}

	function updateScatterPlacement(event: PointerEvent): boolean {
		if (!scatterSession || event.pointerId !== scatterSession.pointerId) {
			return false
		}
		if (!raycastGroundPoint(event, scatterPointerHelper)) {
			return false
		}
		if (!isPointerOverGround(scatterSession.definition, scatterSession.groundMesh, scatterPointerHelper)) {
			event.preventDefault()
			event.stopPropagation()
			event.stopImmediatePropagation()
			return true
		}
		traceScatterPath(scatterPointerHelper.clone())
		event.preventDefault()
		event.stopPropagation()
		event.stopImmediatePropagation()
		return true
	}

	function finalizeScatterPlacement(event: PointerEvent): boolean {
		if (!scatterSession || event.pointerId !== scatterSession.pointerId) {
			return false
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
		scatterSession = null
		return true
	}

	function cancelScatterPlacement(): boolean {
		if (!scatterSession) {
			return false
		}
		if (options.canvasRef.value && options.canvasRef.value.hasPointerCapture(scatterSession.pointerId)) {
			options.canvasRef.value.releasePointerCapture(scatterSession.pointerId)
		}
		scatterSession = null
		return true
	}

	function eraseScatterInstances(worldPoint: THREE.Vector3, radius: number, groundMesh: THREE.Object3D): boolean {
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
			return false
		}
		const radiusSq = radius * radius
		let removed = false
		// Compute distance on ground-local XZ plane so the brush radius works regardless of terrain height.
		scatterEraseLocalPointHelper.copy(worldPoint)
		groundMesh.updateMatrixWorld(true)
		groundMesh.worldToLocal(scatterEraseLocalPointHelper)
		for (const layer of layers) {
			if (!layer.instances.length) {
				continue
			}
			const survivors: TerrainScatterInstance[] = []
			const removedInstances: TerrainScatterInstance[] = []
			for (const instance of layer.instances) {
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
			removedInstances.forEach((instance) => releaseScatterInstance(instance))
			persistScatterInstances(layer, survivors)
		}
		return removed
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
		return removed
	}

	function beginScatterErase(event: PointerEvent): boolean {
		const eraseModeActive = options.scatterEraseModeActive.value
		if (!eraseModeActive && !scatterModeEnabled()) {
			return false
		}
		// Use left click for scatter erase; middle click is reserved for camera pan.
		const allowedButton = event.button === 0
		if (!allowedButton) {
			return false
		}
		if (!eraseModeActive && !event.shiftKey) {
			return false
		}
		const definition = getGroundDynamicMeshDefinition()
		const groundMesh = getGroundObject()
		if (!definition || !groundMesh) {
			return false
		}
		updateGroundChunks(groundMesh, definition, options.getCamera())
		if (!raycastGroundPoint(event, scatterPointerHelper)) {
			return false
		}
		if (!isPointerOverGround(definition, groundMesh, scatterPointerHelper)) {
			return false
		}
		const eraseRadius = resolveScatterEraseRadius()
		eraseScatterInstances(scatterPointerHelper.clone(), eraseRadius, groundMesh)
		scatterEraseState = {
			pointerId: event.pointerId,
			definition,
			groundMesh,
			radius: eraseRadius,
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
		eraseScatterInstances(scatterPointerHelper.clone(), scatterEraseState.radius, scatterEraseState.groundMesh)
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
		scatterEraseState = null
		return true
	}

	function cancelScatterErase(): boolean {
		if (!scatterEraseState) {
			return false
		}
		if (options.canvasRef.value && options.canvasRef.value.hasPointerCapture(scatterEraseState.pointerId)) {
			options.canvasRef.value.releasePointerCapture(scatterEraseState.pointerId)
		}
		scatterEraseState = null
		return true
	}

	function getGroundVertexHeight(definition: GroundDynamicMesh, row: number, column: number): number {
		const key = `${row}:${column}`
		return definition.heightMap[key] ?? 0
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

		const groundNode = options.sceneStore.selectedNode
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
			brushMesh.position.copy(hit.point)
			const scale = options.scatterEraseModeActive.value
				? resolveScatterEraseRadius()
				: scatterModeEnabled()
					? resolveScatterBrushRadius()
					: options.brushRadius.value
			brushMesh.scale.set(scale, scale, 1)
			conformBrushToTerrain(definition, groundObject)
			brushMesh.visible = true
		} else {
			brushMesh.visible = false
		}
	}

	function performSculpt(event: PointerEvent) {
		if (!brushMesh.visible) return

		const groundNode = options.sceneStore.selectedNode
		if (groundNode?.dynamicMesh?.type !== 'Ground') return
		if (!sculptSessionState || sculptSessionState.nodeId !== groundNode.id) {
			ensureSculptSession(groundNode.dynamicMesh as GroundDynamicMesh, groundNode.id)
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
			return
		}
		if (!paintModeEnabled()) {
			return
		}

		const groundNode = options.sceneStore.selectedNode
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

		const localPoint = groundObject.worldToLocal(brushMesh.position.clone())
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

		for (let i = 0; i < steps; i += 1) {
			const t = steps <= 1 ? 1 : (i + 1) / steps
			const point = prev && paintStrokePointerId === event.pointerId
				? paintStrokePrevPointHelper.clone().lerp(paintStrokeNextPointHelper, t)
				: localPoint
			const paintAsset = options.paintAsset.value
			if (!paintAsset) {
				continue
			}
			const session = ensurePaintSession(definition, groundNode.id)
			const channel = ensureTerrainPaintLayer(session.settings, paintAsset.id)
			if (!channel) {
				// No available channel slot (G/B/A) for new layers.
				continue
			}
			// Best-effort: ensure the layer texture is visible during painting.
			void pushTerrainPaintPreviewLayer(session, channel, paintAsset)
			const stamp: TerrainPaintStampRequest = {
				localX: point.x,
				localZ: point.z,
				radius,
				strength: clamp01(options.brushStrength.value),
				channelIndex: channelToIndex(channel),
			}
			const chunkInfo = getScatterChunkKeyFromLocal(definition, session.chunkCells, point.x, point.z)
			const chunkState = ensurePaintChunkState(session, chunkInfo)
			if (chunkState.status === 'loading') {
				chunkState.pendingStamps.push(stamp)
				continue
			}
			applyPaintStampToChunk(session, chunkState, stamp)
		}

		paintStrokePointerId = event.pointerId
		paintStrokeLastLocalPoint = localPoint.clone()
	}

	function refreshGroundMesh(definition: GroundDynamicMesh | null = getGroundDynamicMeshDefinition()) {
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
		if (!paintModeEnabled()) {
			return false
		}
		const groundNode = options.sceneStore.selectedNode
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
		if (options.groundPanelTab.value !== 'terrain') {
			return false
		}
		const groundNode = options.sceneStore.selectedNode
		if (groundNode?.dynamicMesh?.type !== 'Ground' || event.button !== 0) {
			return false
		}

		const definition = groundNode.dynamicMesh as GroundDynamicMesh
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

		const selectedNode = options.sceneStore.selectedNode
		if (selectedNode?.dynamicMesh?.type === 'Ground') {
			const session = sculptSessionState?.nodeId === selectedNode.id ? sculptSessionState : null
			const region = session?.affectedRegion ?? null
				const touchedChunkKeys = session?.touchedChunkKeys ?? null
			const dirty = Boolean(session?.dirty)
			const groundObject = getGroundObject()
			if (!dirty) {
				sculptSessionState = null
				return true
			}
			if (groundObject) {
				const jobToken = (groundNormalsJobToken += 1)
				void recomputeGroundChunkNormalsInWorker({
					groundObject,
					definition: selectedNode.dynamicMesh as GroundDynamicMesh,
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
						stitchGroundChunkNormals(groundObject, selectedNode.dynamicMesh as GroundDynamicMesh, region ?? null)
					} catch (_error) {
						/* noop */
					}
				})
			}
			commitSculptSession(selectedNode)
		} else {
			sculptSessionState = null
		}
		return true
	}

	function handleGroundToolPointerDown(event: PointerEvent): boolean {
		if (options.activeBuildTool.value !== 'ground') {
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
				}
			} else {
				options.activeBuildTool.value = null
			}
			event.preventDefault()
			event.stopPropagation()
			event.stopImmediatePropagation()
			return true
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
		const selectedNodeIsGround = options.sceneStore.selectedNode?.dynamicMesh?.type === 'Ground'
		const showBrush = selectedNodeIsGround &&
			(options.groundPanelTab.value === 'terrain' || options.groundPanelTab.value === 'paint' || options.scatterEraseModeActive.value || scatterModeEnabled())
		if (showBrush) {
			updateBrush(event)
			updateScatterHoverPreview(event)
			if (options.groundPanelTab.value === 'paint' && isPainting.value && paintStrokePointerId === event.pointerId) {
				performPaint(event)
			}
			if (options.groundPanelTab.value === 'terrain' && !options.scatterEraseModeActive.value && isSculpting.value) {
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
		if (tool !== 'ground') {
			groundSelectionDragState = null
			clearGroundSelection()
			options.restoreOrbitAfterGroundSelection()
			if (sculptSessionState) {
				commitSculptSession(options.sceneStore.selectedNode ?? null)
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
		groundSelectionGroup.clear()
		scatterPreviewGroup.clear()
		sculptSessionState = null
		resetScatterStoreState('dispose')
	}

	return {
		brushMesh,
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
