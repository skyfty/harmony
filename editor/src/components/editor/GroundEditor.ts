import { reactive, ref, watch, type Ref } from 'vue'
import * as THREE from 'three'
import type { GroundDynamicMesh, GroundSculptOperation, SceneNode } from '@harmony/schema'
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
import { sculptGround, updateGroundGeometry, updateGroundMesh, sampleGroundHeight } from '@schema/groundMesh'
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
import type { BuildTool } from '@/types/build-tool'
import { useSceneStore } from '@/stores/sceneStore'
import type { ProjectAsset } from '@/types/project-asset'
import type { GroundPanelTab } from '@/stores/terrainStore'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'
import { loadObjectFromFile } from '@schema/assetImport'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { createInstancedBvhFrustumCuller } from '@schema/sceneGraph'

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
	scatterCategory: Ref<TerrainScatterCategory>
	scatterAsset: Ref<ProjectAsset | null>
	scatterSpacing: Ref<number>
	scatterBrushRadius: Ref<number>
	scatterEraseRadius: Ref<number>
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
const scatterPlacementCenterLocalHelper = new THREE.Vector3()
const scatterPlacementCandidateLocalHelper = new THREE.Vector3()
const scatterPlacementCandidateWorldHelper = new THREE.Vector3()
const scatterWorldMatrixHelper = new THREE.Matrix4()
const scatterInstanceWorldPositionHelper = new THREE.Vector3()
const scatterCullingProjView = new THREE.Matrix4()
const scatterCullingFrustum = new THREE.Frustum()
const scatterFrustumCuller = createInstancedBvhFrustumCuller()
const scatterCandidateCenterHelper = new THREE.Vector3()
const scatterEraseLocalPointHelper = new THREE.Vector3()

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
	minScale: number
	maxScale: number
	store: TerrainScatterStore
	layer: TerrainScatterLayer
	modelGroup: ModelInstanceGroup
	lastPoint: THREE.Vector3 | null
}

let scatterSession: ScatterSessionState | null = null
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
}

let sculptSessionState: SculptSessionState | null = null

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
		return getActiveBrushShape()
	}

	function getBrushColor(): number {
		if (options.scatterEraseModeActive.value) {
			return 0xffb347
		}
		if (options.groundPanelTab.value === 'terrain') {
			return 0x5fb0ff
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
		if (tab === 'terrain') {
			cancelScatterPlacement()
		}
		refreshBrushAppearance()
	})

	const stopScatterSelectionWatch = watch(
		() => ({ asset: options.scatterAsset.value, category: options.scatterCategory.value }),
		({ asset, category }) => {
			cancelScatterPlacement()
			cancelScatterErase()
			scatterLayer = null
			if (!category) {
				refreshBrushAppearance()
				return
			}
			if (!asset) {
				scatterModelGroup = null
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
				await getOrLoadModelObject(normalized, () => loadObjectFromFile(file))
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
				resetScatterStoreState('scene-changed')
			}
		},
	)

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
			group = await getOrLoadModelObject(asset.id, () => loadObjectFromFile(file))
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
		// options.sceneStore.updateNodeDynamicMesh(groundNode.id, nextMesh)
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

	function cloneHeightMap(heightMap: GroundDynamicMesh['heightMap']): GroundDynamicMesh['heightMap'] {
		return { ...heightMap }
	}

	function ensureSculptSession(definition: GroundDynamicMesh, nodeId: string): GroundDynamicMesh {
		if (sculptSessionState && sculptSessionState.nodeId === nodeId) {
			return sculptSessionState.definition
		}
		const clonedHeightMap = cloneHeightMap(definition.heightMap)
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
		if (options.groundPanelTab.value === 'terrain') {
			return false
		}
		if (!options.scatterAsset.value) {
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
			spacing: 1.2,
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
		for (const instance of layer.instances) {
			const position = getScatterInstanceWorldPosition(instance, mesh, scatterInstanceWorldPositionHelper)
			if (position.distanceToSquared(point) < threshold) {
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
		if (!isScatterPlacementAvailable(projected, scatterSession.spacing, scatterSession)) {
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
		return true
	}

	function generateScatterClusterPoints(center: THREE.Vector3, radius: number, spacing: number): THREE.Vector3[] {
		if (radius <= spacing * 0.25) {
			return [center.clone()]
		}
		const maxPoints = Math.min(12, Math.max(2, Math.round((Math.PI * radius * radius) / Math.max(spacing * spacing, 0.01))))
		const points: THREE.Vector3[] = [center.clone()]
		const maxAttempts = maxPoints * 4
		for (let attempt = 0; attempt < maxAttempts && points.length < maxPoints; attempt += 1) {
			const distance = Math.random() * radius
			const angle = Math.random() * Math.PI * 2
			const candidate = center.clone().add(new THREE.Vector3(Math.cos(angle) * distance, 0, Math.sin(angle) * distance))
			if (points.every((point) => point.distanceToSquared(candidate) >= spacing * spacing * 0.5)) {
				points.push(candidate)
			}
		}
		return points
	}

	function applyScatterPlacementCluster(center: THREE.Vector3): boolean {
		if (!scatterSession) {
			return false
		}
		const points = generateScatterClusterPoints(center, scatterSession.radius, scatterSession.spacing)
		let placed = false
		for (const point of points) {
			placed = applyScatterPlacement(point) || placed
		}
		return placed
	}
	
	function paintScatterStamp(worldCenterPoint: THREE.Vector3): void {
		if (!scatterSession || !scatterSession.layer || !scatterSession.modelGroup) {
			return
		}
		const radius = resolveScatterBrushRadius()
		const spacing = scatterSession.spacing

		// Estimate how many instances to try to place per stamp.
		// Brush radius controls the area; spacing controls density.
		const area = Math.PI * radius * radius
		const attemptsTarget = Math.min(25, Math.max(1, Math.floor((area / (spacing * spacing)) * 0.25)))
		const maxAttempts = Math.min(150, Math.max(20, attemptsTarget * 8))

		let placed = applyScatterPlacement(worldCenterPoint) ? 1 : 0
		if (placed >= attemptsTarget) {
			return
		}

		const { groundMesh, definition } = scatterSession
		groundMesh.updateMatrixWorld(true)
		scatterPlacementCenterLocalHelper.copy(worldCenterPoint)
		groundMesh.worldToLocal(scatterPlacementCenterLocalHelper)

		for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
			if (!scatterSession) {
				return
			}
			const u = Math.random()
			const v = Math.random()
			const r = Math.sqrt(u) * radius
			const theta = v * Math.PI * 2
			const dx = Math.cos(theta) * r
			const dz = Math.sin(theta) * r

			scatterPlacementCandidateLocalHelper.set(
				scatterPlacementCenterLocalHelper.x + dx,
				0,
				scatterPlacementCenterLocalHelper.z + dz,
			)
			scatterPlacementCandidateLocalHelper.y = sampleGroundHeight(
				definition,
				scatterPlacementCandidateLocalHelper.x,
				scatterPlacementCandidateLocalHelper.z,
			)

			scatterPlacementCandidateWorldHelper.copy(scatterPlacementCandidateLocalHelper)
			groundMesh.localToWorld(scatterPlacementCandidateWorldHelper)
			if (applyScatterPlacement(scatterPlacementCandidateWorldHelper)) {
				placed += 1
				if (placed >= attemptsTarget) {
					return
				}
			}
		}
	}

	function traceScatterPath(targetPoint: THREE.Vector3) {
		if (!scatterSession) {
			return
		}
		if (!scatterSession.lastPoint) {
			if (applyScatterPlacementCluster(targetPoint)) {
				scatterSession.lastPoint = targetPoint.clone()
			}
			scatterSession.lastPoint = targetPoint.clone()
			paintScatterStamp(targetPoint)
			return
		}
		scatterDirectionHelper.copy(targetPoint).sub(scatterSession.lastPoint)
		const distance = scatterDirectionHelper.length()
		const stepDistance = Math.max(scatterSession.spacing, resolveScatterBrushRadius() * 0.5)
		if (distance < stepDistance * 0.35) {
			return
		}
		scatterDirectionHelper.normalize()
		const steps = Math.floor(distance / stepDistance)
		for (let index = 1; index <= steps; index += 1) {
			scatterPlacementHelper
				.copy(scatterSession.lastPoint)
				.addScaledVector(scatterDirectionHelper, scatterSession.spacing * index)
			if (applyScatterPlacementCluster(scatterPlacementHelper)) {
				scatterSession.lastPoint = scatterPlacementHelper.clone()
			}
		}
		const remainder = distance - steps * scatterSession.spacing
		if (remainder >= scatterSession.spacing * 0.4) {
			if (applyScatterPlacementCluster(targetPoint)) {
				scatterSession.lastPoint = targetPoint.clone()
			}
		}
	}

	function beginScatterPlacement(event: PointerEvent): boolean {
		if (!scatterModeEnabled() || event.button !== 1 || event.shiftKey) {
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
		clampPointToGround(definition, scatterPointerHelper)
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
		const customSpacing = Number.isFinite(options.scatterSpacing.value)
			? options.scatterSpacing.value
			: preset.spacing
		const effectiveSpacing = Math.min(2, Math.max(0.1, customSpacing))
		const customRadius = Number.isFinite(options.scatterBrushRadius.value)
			? options.scatterBrushRadius.value
			: 0.5
		const effectiveRadius = Math.min(2, Math.max(0.1, customRadius))
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
			minScale: preset.minScale,
			maxScale: preset.maxScale,
			store: ensureScatterStoreRef(),
			layer,
			modelGroup: scatterModelGroup,
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
		const groundMesh = getGroundMeshObject()
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
		clampPointToGround(scatterSession.definition, scatterPointerHelper)
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
		return Math.min(5, Math.max(0.1, Number.isFinite(candidate) ? candidate : 1))
	}

	function resolveScatterBrushRadius(): number {
		const candidate = Number(options.scatterBrushRadius.value)
		return Math.min(5, Math.max(0.1, Number.isFinite(candidate) ? candidate : 1))
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
		// Only allow middle mouse for scatter erase so left/right remain available for pan/rotate.
		const allowedButton = event.button === 1
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
		clampPointToGround(definition, scatterPointerHelper)
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
		clampPointToGround(scatterEraseState.definition, scatterPointerHelper)
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
		const flattenReference = operation === 'flatten'
			? sampleGroundHeight(definition, localPoint.x, localPoint.z)
			: undefined

		const modified = sculptGround(definition, {
			point: localPoint,
			radius: options.brushRadius.value,
			// Damp sculpt speed so height grows more gradually for finer control.
			strength: options.brushStrength.value * 0.4,
			shape,
			operation,
			targetHeight: flattenReference,
		})

		if (modified) {
			if (sculptSessionState && sculptSessionState.nodeId === groundNode.id) {
				sculptSessionState.dirty = true
			}
			const halfWidth = definition.width * 0.5
			const halfDepth = definition.depth * 0.5
			const cellSize = definition.cellSize
			const radius = options.brushRadius.value
			const minColumn = Math.floor((localPoint.x - radius + halfWidth) / cellSize)
			const maxColumn = Math.ceil((localPoint.x + radius + halfWidth) / cellSize)
			const minRow = Math.floor((localPoint.z - radius + halfDepth) / cellSize)
			const maxRow = Math.ceil((localPoint.z + radius + halfDepth) / cellSize)
			const region: GroundGeometryUpdateRegion = {
				minRow: Math.max(0, minRow),
				maxRow: Math.min(definition.rows, maxRow),
				minColumn: Math.max(0, minColumn),
				maxColumn: Math.min(definition.columns, maxColumn),
			}
			updateGroundMeshRegion(groundObject, definition, region)
			// Stitch normals across chunk boundaries to prevent visible seams.
			const padded: GroundGeometryUpdateRegion = {
				minRow: Math.max(0, region.minRow - 2),
				maxRow: Math.min(definition.rows, region.maxRow + 2),
				minColumn: Math.max(0, region.minColumn - 2),
				maxColumn: Math.min(definition.columns, region.maxColumn + 2),
			}
			stitchGroundChunkNormals(groundObject, definition, padded)
			if (sculptSessionState && sculptSessionState.nodeId === groundNode.id) {
				sculptSessionState.affectedRegion = mergeRegions(sculptSessionState.affectedRegion, region)
			}
		}
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

	function beginSculpt(event: PointerEvent): boolean {
		if (options.groundPanelTab.value !== 'terrain') {
			return false
		}
		const groundNode = options.sceneStore.selectedNode
		if (groundNode?.dynamicMesh?.type !== 'Ground' || event.button !== 1) {
			return false
		}

		const definition = groundNode.dynamicMesh as GroundDynamicMesh
		ensureSculptSession(definition, groundNode.id)

		isSculpting.value = true
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

	function finalizeSculpt(event: PointerEvent): boolean {
		if (!isSculpting.value) {
			return false
		}

		isSculpting.value = false
		try {
			options.canvasRef.value?.releasePointerCapture(event.pointerId)
		} catch (error) {
			/* noop */
		}

		const selectedNode = options.sceneStore.selectedNode
		if (selectedNode?.dynamicMesh?.type === 'Ground') {
			const groundObject = getGroundObject()
			const region = sculptSessionState?.nodeId === selectedNode.id
				? sculptSessionState?.affectedRegion
				: null
			if (groundObject) {
				groundObject.traverse((child) => {
					const mesh = child as THREE.Mesh
					if (!mesh?.isMesh || !mesh.geometry) {
						return
					}
					if (!region) {
						mesh.geometry.computeVertexNormals()
						return
					}
					const chunk = mesh.userData?.groundChunk as
						| { startRow: number; startColumn: number; rows: number; columns: number }
						| undefined
					if (!chunk) {
						mesh.geometry.computeVertexNormals()
						return
					}
					const chunkMinRow = chunk.startRow
					const chunkMaxRow = chunk.startRow + chunk.rows
					const chunkMinColumn = chunk.startColumn
					const chunkMaxColumn = chunk.startColumn + chunk.columns
					const overlaps = !(
						region.maxRow < chunkMinRow ||
						region.minRow > chunkMaxRow ||
						region.maxColumn < chunkMinColumn ||
						region.minColumn > chunkMaxColumn
					)
					if (overlaps) {
						mesh.geometry.computeVertexNormals()
					}
				})
				stitchGroundChunkNormals(groundObject, selectedNode.dynamicMesh as GroundDynamicMesh, region ?? null)
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

		if (beginSculpt(event)) {
			return true
		}

		return handleGroundToolPointerDown(event)
	}

	function handlePointerMove(event: PointerEvent): boolean {
		const selectedNodeIsGround = options.sceneStore.selectedNode?.dynamicMesh?.type === 'Ground'
		const showBrush = selectedNodeIsGround &&
			(options.groundPanelTab.value === 'terrain' || options.scatterEraseModeActive.value || scatterModeEnabled())
		if (showBrush) {
			updateBrush(event)
			if (options.groundPanelTab.value === 'terrain' && !options.scatterEraseModeActive.value && isSculpting.value) {
				performSculpt(event)
			}
		} else {
			brushMesh.visible = false
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
		sculptSessionState = null
		resetScatterStoreState('dispose')
	}

	return {
		brushMesh,
		groundSelectionGroup,
		groundSelection,
		isGroundToolbarVisible,
		groundSelectionToolbarStyle,
		groundTextureInputRef,
		isSculpting,
		restoreGroupdScatter,
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
		hasActiveSelection,
		handleActiveBuildToolChange,
		dispose,
	}
}
