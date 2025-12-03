import { reactive, ref, watch, type Ref } from 'vue'
import * as THREE from 'three'
import type { GroundDynamicMesh, GroundSculptOperation, SceneNode } from '@harmony/schema'
import { sculptGround, updateGroundGeometry, updateGroundMesh, sampleGroundHeight } from '@schema/groundMesh'
import { GROUND_NODE_ID, GROUND_HEIGHT_STEP } from './constants'
import type { BuildTool } from '@/types/build-tool'
import type { useSceneStore } from '@/stores/sceneStore'
import type { ProjectAsset } from '@/types/project-asset'
import type { GroundPanelTab } from '@/stores/terrainStore'
import type { TerrainScatterCategory } from '@/resources/projectProviders/asset'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'

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
	activeBuildTool: Ref<BuildTool | null>
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
const scatterPositionHelper = new THREE.Vector3()
const scatterScaleHelper = new THREE.Vector3()
const scatterQuaternionHelper = new THREE.Quaternion()
const scatterEulerHelper = new THREE.Euler()
const scatterMatrixHelper = new THREE.Matrix4()
const scatterWorldMatrixHelper = new THREE.Matrix4()

type ScatterSessionState = {
	pointerId: number
	asset: ProjectAsset
	category: TerrainScatterCategory
	definition: GroundDynamicMesh
	groundMesh: THREE.Mesh
	spacing: number
	minScale: number
	maxScale: number
	occupiedPositions: THREE.Vector3[]
	lastPoint: THREE.Vector3 | null
}

let scatterSession: ScatterSessionState | null = null

function createPolygonRingGeometry(points: THREE.Vector2[], innerScale = 0.8): THREE.BufferGeometry {
	if (!points.length) {
		return new THREE.BufferGeometry()
	}
	const shape = new THREE.Shape()
	points.forEach((point, index) => {
		if (index === 0) {
			shape.moveTo(point.x, point.y)
		} else {
			shape.lineTo(point.x, point.y)
		}
	})
	shape.closePath()

	const innerPoints = points.map((point) => point.clone().multiplyScalar(innerScale)).reverse()
	if (innerPoints.length) {
		const hole = new THREE.Path()
		innerPoints.forEach((point, index) => {
			if (index === 0) {
				hole.moveTo(point.x, point.y)
			} else {
				hole.lineTo(point.x, point.y)
			}
		})
		hole.closePath()
		shape.holes.push(hole)
	}
	return new THREE.ShapeGeometry(shape, 1)
}

function createStarPoints(count: number, outerRadius: number, innerRadius: number): THREE.Vector2[] {
	const points: THREE.Vector2[] = []
	const step = Math.PI / count
	for (let index = 0; index < count * 2; index += 1) {
		const radius = index % 2 === 0 ? outerRadius : innerRadius
		const angle = index * step
		points.push(new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius))
	}
	return points
}

function createBrushGeometry(shape: TerrainBrushShape): THREE.BufferGeometry {
	switch (shape) {
		case 'square': {
			const size = 1
			const points = [
				new THREE.Vector2(-size, -size),
				new THREE.Vector2(size, -size),
				new THREE.Vector2(size, size),
				new THREE.Vector2(-size, size),
			]
			return createPolygonRingGeometry(points, 0.85)
		}
		case 'star': {
			const points = createStarPoints(5, 1, 0.5)
			return createPolygonRingGeometry(points, 0.55)
		}
		case 'circle':
		default:
			return new THREE.RingGeometry(0.9, 1, 64)
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
	const brushMesh = new THREE.Mesh(
		tagBrushGeometry(createBrushGeometry(options.brushShape.value ?? 'circle')),
		new THREE.MeshBasicMaterial({
			color: 0xff3333,
			transparent: true,
			opacity: 0.8,
			side: THREE.DoubleSide,
			depthTest: false,
			depthWrite: false,
		}),
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

	const stopBrushWatch = watch(options.brushShape, (shape) => {
		updateBrushGeometry(shape ?? 'circle')
	})

	const stopTabWatch = watch(options.groundPanelTab, (tab) => {
		if (tab === 'terrain') {
			cancelScatterPlacement()
		}
	})

	const stopScatterAssetWatch = watch(options.scatterAsset, (asset) => {
		if (!asset) {
			cancelScatterPlacement()
		}
	})

	function updateBrushGeometry(shape: TerrainBrushShape) {
		const nextGeometry = tagBrushGeometry(createBrushGeometry(shape))
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

	function getGroundNodeFromProps(): SceneNode | null {
		return findGroundNodeInTree(options.getSceneNodes())
	}

	function getGroundDynamicMeshDefinition(): GroundDynamicMesh | null {
		const node = getGroundNodeFromScene() ?? getGroundNodeFromProps()
		if (node?.dynamicMesh?.type === 'Ground') {
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

	function composeNodeMatrix(node: SceneNode, target: THREE.Matrix4): THREE.Matrix4 {
		scatterPositionHelper.set(node.position?.x ?? 0, node.position?.y ?? 0, node.position?.z ?? 0)
		scatterScaleHelper.set(node.scale?.x ?? 1, node.scale?.y ?? 1, node.scale?.z ?? 1)
		scatterEulerHelper.set(node.rotation?.x ?? 0, node.rotation?.y ?? 0, node.rotation?.z ?? 0, 'XYZ')
		scatterQuaternionHelper.setFromEuler(scatterEulerHelper)
		return target.compose(scatterPositionHelper.clone(), scatterQuaternionHelper.clone(), scatterScaleHelper.clone())
	}

	function collectExistingScatterPositions(assetId: string): THREE.Vector3[] {
		const result: THREE.Vector3[] = []
		const traverse = (nodes: SceneNode[], parentMatrix: THREE.Matrix4 | null) => {
			nodes.forEach((node) => {
				const localMatrix = composeNodeMatrix(node, new THREE.Matrix4())
				const worldMatrix = parentMatrix ? scatterWorldMatrixHelper.copy(parentMatrix).multiply(localMatrix) : localMatrix
				if (node.sourceAssetId === assetId) {
					const position = new THREE.Vector3()
					position.setFromMatrixPosition(worldMatrix)
					result.push(position)
				}
				if (node.children?.length) {
					traverse(node.children, worldMatrix)
				}
			})
		}
		traverse(options.sceneStore.nodes, null)
		return result
	}

	function isScatterPlacementAvailable(point: THREE.Vector3, spacing: number, occupied: THREE.Vector3[]): boolean {
		const threshold = spacing * spacing
		return occupied.every((existing) => existing.distanceToSquared(point) >= threshold)
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

	function spawnScatterNode(worldPoint: THREE.Vector3) {
		if (!scatterSession) {
			return
		}
		const rotation = new THREE.Vector3(0, Math.random() * Math.PI * 2, 0)
		const scaleFactor = THREE.MathUtils.lerp(scatterSession.minScale, scatterSession.maxScale, Math.random())
		const scale = new THREE.Vector3(scaleFactor, scaleFactor, scaleFactor)
		void options.sceneStore
			.addModelNode({
				asset: scatterSession.asset,
				position: worldPoint.clone(),
				rotation,
				scale,
				parentId: GROUND_NODE_ID,
				snapToGrid: false,
			})
			.catch((error) => {
				console.warn('Failed to add scatter object', error)
			})
	}

	function applyScatterPlacement(worldPoint: THREE.Vector3) {
		if (!scatterSession) {
			return
		}
		const projected = projectScatterPoint(worldPoint)
		if (!projected) {
			return
		}
		if (!isScatterPlacementAvailable(projected, scatterSession.spacing, scatterSession.occupiedPositions)) {
			return
		}
		scatterSession.occupiedPositions.push(projected.clone())
		spawnScatterNode(projected)
	}

	function traceScatterPath(targetPoint: THREE.Vector3) {
		if (!scatterSession) {
			return
		}
		if (!scatterSession.lastPoint) {
			scatterSession.lastPoint = targetPoint.clone()
			applyScatterPlacement(targetPoint)
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
			applyScatterPlacement(scatterPlacementHelper)
			scatterSession.lastPoint = scatterPlacementHelper.clone()
		}
		const remainder = distance - steps * scatterSession.spacing
		if (remainder >= scatterSession.spacing * 0.4) {
			scatterSession.lastPoint = targetPoint.clone()
			applyScatterPlacement(targetPoint)
		}
	}

	function beginScatterPlacement(event: PointerEvent): boolean {
		if (!scatterModeEnabled() || event.button !== 1) {
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
		scatterSession = {
			pointerId: event.pointerId,
			asset,
			category,
			definition,
			groundMesh,
			spacing: preset.spacing,
			minScale: preset.minScale,
			maxScale: preset.maxScale,
			occupiedPositions: collectExistingScatterPositions(asset.id),
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
		const definition = groundNode.dynamicMesh as GroundDynamicMesh

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

		const definition = groundNode.dynamicMesh as GroundDynamicMesh

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
			options.sceneStore.updateNodeDynamicMesh(selectedNode.id, selectedNode.dynamicMesh)
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
		if (selectedNodeIsGround && options.groundPanelTab.value === 'terrain') {
			updateBrush(event)
			if (isSculpting.value) {
				performSculpt(event)
			}
		} else {
			brushMesh.visible = false
		}

		if (options.isAltOverrideActive()) {
			return false
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
		if (finalizeScatterPlacement(event)) {
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
		if (isSculpting.value) {
			isSculpting.value = false
			try {
				options.canvasRef.value?.releasePointerCapture(event.pointerId)
			} catch (error) {
				/* noop */
			}
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
		}
	}

	function dispose() {
		stopBrushWatch()
		stopTabWatch()
		stopScatterAssetWatch()
		brushMesh.geometry.dispose()
		const material = brushMesh.material as THREE.Material
		material.dispose()
		groundSelectionGroup.clear()
	}

	return {
		brushMesh,
		groundSelectionGroup,
		groundSelection,
		isGroundToolbarVisible,
		groundSelectionToolbarStyle,
		groundTextureInputRef,
		isSculpting,
		updateGroundSelectionToolbarPosition,
		clearGroundSelection,
		cancelGroundSelection,
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
