import * as THREE from 'three'

import {
	clampRigidbodyComponentProps,
	resolveInfiniteGroundGridOriginMeters,
	deserializeGroundChunkData,
	parseGroundChunkKey,
	resolveGroundChunkCoordFromWorldPosition,
	resolveGroundChunkOrigin,
	RIGIDBODY_COMPONENT_TYPE,
	type GroundChunkManifestRecord,
	type GroundLocalEditTileData,
	type GroundRuntimeDynamicMesh,
	type RigidbodyComponentProps,
	type RigidbodyPhysicsShape,
	type SceneNode,
	type SceneNodeComponentState,
} from './index'
import { resolveGroundEffectiveHeightAtVertex, sampleGroundHeight } from './groundMesh'
import {
	type PhysicsBodyBindingEntry as RigidbodyInstance,
	type PhysicsBodyLike,
	type PhysicsOrientationAdjustment,
} from './physicsBodySync'
import {
	type PhysicsWorldLike,
	addPhysicsBodyToWorld,
	removePhysicsBodyBindingBodies,
} from './physicsRuntimeBridge'

type HeightfieldShapeDefinition = Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }>

type InfiniteGroundChunkColliderSource = 'manifest' | 'runtime-detailed' | 'base-flat'


export type InfiniteGroundChunkColliderRuntimeDeps = {
	getPhysicsWorld: () => PhysicsWorldLike | null
	ensurePhysicsWorld: () => PhysicsWorldLike
	createBody: (
		node: SceneNode,
		component: SceneNodeComponentState<RigidbodyComponentProps>,
		shapeDefinition: HeightfieldShapeDefinition | null,
		object: THREE.Object3D,
	) => { body: PhysicsBodyLike; orientationAdjustment: PhysicsOrientationAdjustment | null } | null
	loggerTag?: string
}

export type InfiniteGroundChunkColliderSyncParams = {
	enabled: boolean
	groundObject: THREE.Object3D
	groundDefinition: GroundRuntimeDynamicMesh
	camera: THREE.Camera | null | undefined
	sourceId: string
	manifestRevision?: number
	manifestRecords?: Record<string, GroundChunkManifestRecord>
	loadChunkData?: (record: GroundChunkManifestRecord) => Promise<ArrayBuffer | null>
	excludedChunkKeys?: Iterable<string> | null
}

export type InfiniteGroundChunkColliderRuntime = {
	clear: () => void
	sync: (params: InfiniteGroundChunkColliderSyncParams) => void
	getActiveChunkKeys: () => string[]
	getDebugEntries: () => InfiniteGroundChunkColliderDebugEntry[]
}

export type InfiniteGroundChunkColliderDebugEntry = {
	runtimeKey: string
	nodeId: string
	source: InfiniteGroundChunkColliderSource
	instance: RigidbodyInstance
	shapes: HeightfieldShapeDefinition[]
}

export type InfiniteGroundChunkCollisionRuntimeState = {
  enabled: boolean
  sourceId: string
  signature: string
  activeChunkKeys: string[]
}

function uniqueSortedKeys(keys: Iterable<string> | null | undefined): string[] {
  return Array.from(new Set(Array.from(keys ?? []).map((key) => key.trim()).filter((key) => key.length > 0))).sort()
}


export function createInfiniteGroundChunkColliderRuntime(
	deps: InfiniteGroundChunkColliderRuntimeDeps,
): InfiniteGroundChunkColliderRuntime {
	const instances = new Map<string, RigidbodyInstance>()
	const debugShapes = new Map<string, HeightfieldShapeDefinition[]>()

	function clear(): void {

	}

	function sync(params: InfiniteGroundChunkColliderSyncParams): void {
		
	}

	return {
		clear,
		sync,
		getActiveChunkKeys: () => uniqueSortedKeys(Array.from(instances.keys()).map((runtimeKey) => {
			const separatorIndex = runtimeKey.indexOf(':')
			return separatorIndex >= 0 ? runtimeKey.slice(separatorIndex + 1) : runtimeKey
		})),
		getDebugEntries: () => Array.from(instances.entries()).map(([runtimeKey, instance]) => ({
			runtimeKey,
			nodeId: instance.nodeId,
			source: runtimeKey.startsWith('manifest:')
				? 'manifest'
				: runtimeKey.startsWith('runtime-detailed:')
					? 'runtime-detailed'
					: 'base-flat',
			instance,
			shapes: debugShapes.get(runtimeKey)?.map((shape) => ({
				...shape,
				matrix: shape.matrix.map((column) => [...column]),
			})) ?? [],
		})),
	}
}
