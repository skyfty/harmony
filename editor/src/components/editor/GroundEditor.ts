import { reactive, ref, watch, type Ref } from 'vue'
import * as THREE from 'three'
import type { GroundDynamicMesh, GroundSculptOperation, SceneNode } from '@harmony/schema'
import {
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
import { getCachedModelObject, getOrLoadModelObject, type ModelInstanceGroup } from '@schema/modelObjectCache'
import {
	bindScatterInstance,
	composeScatterMatrix,
	getScatterInstanceWorldPosition,
	releaseScatterInstance,
	resetScatterInstanceBinding,
} from '@/utils/terrainScatterRuntime'
import { GROUND_NODE_ID, GROUND_HEIGHT_STEP } from './constants'
import type { BuildTool } from '@/types/build-tool'
import { useSceneStore } from '@/stores/sceneStore'
import type { ProjectAsset } from '@/types/project-asset'
import type { GroundPanelTab } from '@/stores/terrainStore'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'
import { loadObjectFromFile } from '@schema/assetImport'
import { useAssetCacheStore } from '@/stores/assetCacheStore'

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
	brushOperation: Ref<GroundSculptOperation>
	groundPanelTab: Ref<GroundPanelTab>
	scatterCategory: Ref<TerrainScatterCategory>
	scatterAsset: Ref<ProjectAsset | null>
	scatterSpacing: Ref<number>
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
const scatterWorldMatrixHelper = new THREE.Matrix4()
const scatterInstanceWorldPositionHelper = new THREE.Vector3()

type ScatterSessionState = {
	pointerId: number
	asset: ProjectAsset
	category: TerrainScatterCategory
	definition: GroundDynamicMesh
	groundMesh: THREE.Mesh
	spacing: number
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
	groundMesh: THREE.Mesh
	radius: number
}

let scatterEraseState: ScatterEraseState | null = null

type SculptSessionState = {
	nodeId: string
	definition: GroundDynamicMesh
	heightMap: GroundDynamicMesh['heightMap']
	dirty: boolean
}

let sculptSessionState: SculptSessionState | null = null

function createBrushGeometry(): THREE.BufferGeometry {
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
		tagBrushGeometry(createBrushGeometry()),
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
	let scatterAssetLoadToken = 0
	let scatterSnapshotUpdatedAt: number | null = null

	function getActiveBrushShape(): TerrainBrushShape {
		return options.brushShape.value ?? 'circle'
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
		updateBrushGeometry(getActiveBrushShape())
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

	async function restoreGroupdScatter(): Promise<void> {
		const store = ensureScatterStoreRef()
		const groundMesh = getGroundMeshObject()
		if (!groundMesh || store.layers.size === 0) {
			return
		}

		const resolveAssetId = (instance: TerrainScatterInstance, layer: TerrainScatterLayer): string | null => {
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
			for (const instance of layer.instances) {
				const assetId = resolveAssetId(instance, layer)
				if (!assetId) {
					continue
				}
				instance.assetId = instance.assetId ?? assetId
				instance.layerId = instance.layerId ?? layer.id
				if (!instance.profileId) {
					instance.profileId = layer.profileId ?? assetId
				}
				resetScatterInstanceBinding(instance)
				const group = await ensureModelGroup(assetId)
				if (!group) {
					continue
				}
				const matrix = composeScatterMatrix(instance, groundMesh, scatterWorldMatrixHelper)
				if (!bindScatterInstance(instance, matrix, group.assetId)) {
					console.warn('绑定地面散布实例失败', {
						layerId: layer.id,
						instanceId: instance.id,
						assetId,
					})
				}
			}
		}
	}

	function ensureScatterStoreRef(): TerrainScatterStore {
		const snapshot = getGroundTerrainScatterSnapshot()
		const snapshotUpdatedAt = getScatterSnapshotTimestamp(snapshot)
		const shouldHydrate = snapshot && (!scatterStore || snapshotUpdatedAt !== scatterSnapshotUpdatedAt)
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
		} catch (error) {
			console.warn('加载散布资源失败', asset.id, error)
			return null
		} finally {
			assetCacheStore.releaseInMemoryBlob(asset.id)
		}
		return group
	}

	async function prepareScatterRuntime(asset: ProjectAsset, category: TerrainScatterCategory): Promise<void> {
		ensureScatterStoreRef()
		scatterLayer = ensureScatterLayerForAsset(asset, category)
		scatterAssetLoadToken += 1
		const token = scatterAssetLoadToken
		scatterModelGroup = null
		const group = await loadScatterModelGroup(asset)
		if (token !== scatterAssetLoadToken) {
			return
		}
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

	function updateBrushGeometry(_shape: TerrainBrushShape) {
		const nextGeometry = tagBrushGeometry(createBrushGeometry())
		const previousGeometry = brushMesh.geometry
		brushMesh.geometry = nextGeometry
		previousGeometry?.dispose()
	}

	function conformBrushToTerrain(definition: GroundDynamicMesh, groundObject: THREE.Mesh) {
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
		options.sceneStore.updateNodeDynamicMesh(groundNode.id, nextMesh)
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

	function getGroundMeshObject(): THREE.Mesh | null {
		const container = options.objectMap.get(GROUND_NODE_ID)
		if (!container) {
			return null
		}
		let mesh: THREE.Mesh | null = null
		container.traverse((child) => {
			if (mesh) {
				return
			}
			const candidate = child as THREE.Mesh
			if (candidate?.isMesh && candidate !== container) {
				mesh = candidate
			}
		})
		return mesh
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
			assetId: scatterSession.asset.id,
			layerId: scatterSession.layer.id,
			profileId: scatterSession.layer.profileId ?? scatterSession.asset.id,
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
		const bound = bindScatterInstance(stored, matrix, scatterSession.asset.id)
		if (!bound) {
			persistScatterInstances(nextLayer, nextLayer.instances.filter((entry) => entry.id !== stored.id))
			return false
		}
		return true
	}

	function traceScatterPath(targetPoint: THREE.Vector3) {
		if (!scatterSession) {
			return
		}
		if (!scatterSession.lastPoint) {
			if (applyScatterPlacement(targetPoint)) {
				scatterSession.lastPoint = targetPoint.clone()
			}
			return
		}
		scatterDirectionHelper.copy(targetPoint).sub(scatterSession.lastPoint)
		const distance = scatterDirectionHelper.length()
		if (distance < scatterSession.spacing * 0.35) {
			return
		}
		scatterDirectionHelper.normalize()
		const steps = Math.floor(distance / scatterSession.spacing)
		for (let index = 1; index <= steps; index += 1) {
			scatterPlacementHelper
				.copy(scatterSession.lastPoint)
				.addScaledVector(scatterDirectionHelper, scatterSession.spacing * index)
			if (applyScatterPlacement(scatterPlacementHelper)) {
				scatterSession.lastPoint = scatterPlacementHelper.clone()
			}
		}
		const remainder = distance - steps * scatterSession.spacing
		if (remainder >= scatterSession.spacing * 0.4) {
			if (applyScatterPlacement(targetPoint)) {
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
		const groundMesh = getGroundMeshObject()
		if (!definition || !groundMesh) {
			return false
		}
		if (!raycastGroundPoint(event, scatterPointerHelper)) {
			return false
		}
		clampPointToGround(definition, scatterPointerHelper)
		const category = options.scatterCategory.value
		const preset = getScatterPreset(category)
		const layer = ensureScatterLayerForAsset(asset, category)
		if (!scatterModelGroup) {
			console.warn('散布资源仍在加载，请稍后重试')
			return false
		}
		const customSpacing = Number.isFinite(options.scatterSpacing.value)
			? options.scatterSpacing.value
			: preset.spacing
		const effectiveSpacing = Math.min(2, Math.max(0.1, customSpacing))
		scatterSession = {
			pointerId: event.pointerId,
			asset,
			category,
			definition,
			groundMesh,
			spacing: effectiveSpacing,
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

	function eraseScatterInstances(worldPoint: THREE.Vector3, radius: number, groundMesh: THREE.Mesh): boolean {
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
		groundMesh.updateMatrixWorld(true)
		for (const layer of layers) {
			if (!layer.instances.length) {
				continue
			}
			const survivors: TerrainScatterInstance[] = []
			const removedInstances: TerrainScatterInstance[] = []
			for (const instance of layer.instances) {
				const position = getScatterInstanceWorldPosition(instance, groundMesh, scatterInstanceWorldPositionHelper)
				if (position.distanceToSquared(worldPoint) <= radiusSq) {
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
		const candidate = Number.isFinite(options.scatterEraseRadius.value)
			? options.scatterEraseRadius.value
			: options.brushRadius.value
		return Math.min(5, Math.max(0.1, candidate))
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
		const allowedButton = eraseModeActive ? (event.button === 0 || event.button === 1) : event.button === 1
		if (!allowedButton) {
			return false
		}
		if (!eraseModeActive && !event.shiftKey) {
			return false
		}
		const definition = getGroundDynamicMeshDefinition()
		const groundMesh = getGroundMeshObject()
		if (!definition || !groundMesh) {
			return false
		}
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

		const groundObject = getGroundMeshObject()
		if (!groundObject) {
			brushMesh.visible = false
			return
		}

		options.pointer.set(x, y)
		options.raycaster.setFromCamera(options.pointer, camera)
		const intersects = options.raycaster.intersectObject(groundObject, false)
		const hit = intersects[0]
		if (hit) {
			brushMesh.position.copy(hit.point)
			const scale = options.brushRadius.value
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

		const groundObject = getGroundMeshObject()
		if (!groundObject) return

		const localPoint = groundObject.worldToLocal(brushMesh.position.clone())
		localPoint.y -= 0.1

		const operation: GroundSculptOperation = event.shiftKey ? 'depress' : options.brushOperation.value
		const flattenReference = operation === 'flatten'
			? sampleGroundHeight(definition, localPoint.x, localPoint.z)
			: undefined

		const modified = sculptGround(definition, {
			point: localPoint,
			radius: options.brushRadius.value,
			strength: options.brushStrength.value,
			shape: options.brushShape.value ?? 'circle',
			operation,
			targetHeight: flattenReference,
		})

		if (modified) {
			if (sculptSessionState && sculptSessionState.nodeId === groundNode.id) {
				sculptSessionState.dirty = true
			}
			const geometry = (groundObject as THREE.Mesh).geometry
			updateGroundGeometry(geometry, definition)
		}
	}

	function refreshGroundMesh(definition: GroundDynamicMesh | null = getGroundDynamicMeshDefinition()) {
		if (!definition) {
			return
		}
		const mesh = getGroundMeshObject()
		if (mesh) {
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
			const mesh = options.objectMap.get(selectedNode.id) as THREE.Mesh | undefined
			if (mesh?.geometry) {
				mesh.geometry.computeVertexNormals()
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
		cancelScatterPlacement()
		cancelScatterErase()
		brushMesh.geometry.dispose()
		const material = brushMesh.material as THREE.Material
		material.dispose()
		groundSelectionGroup.clear()
		sculptSessionState = null
		scatterStore = null
		scatterLayer = null
		scatterSnapshotUpdatedAt = null
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
