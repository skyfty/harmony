import type { Vector3Like } from './core'
import {
	LOD_FACE_CAMERA_FORWARD_AXIS_X,
	LOD_FACE_CAMERA_FORWARD_AXIS_Z,
	clampLodComponentProps,
	resolveLodRenderTarget,
	type LodComponentProps,
	type LodFaceCameraForwardAxis,
	type LodLevelDefinition,
} from './components'
import { clampSceneNodeInstanceLayout, resolveInstanceLayoutTemplateAssetId } from './instanceLayout'

export type InstancedLodTarget = {
	kind: 'model' | 'billboard'
	assetId: string | null
	sourceModelAssetId: string | null
	faceCamera: boolean
	forwardAxis: LodFaceCameraForwardAxis
	key: string | null
}

export type InstancedLodSelectionSnapshot = {
	sourceAssetId?: string | null
	instanceLayout?: unknown
	lodProps?: Partial<LodComponentProps> | null
	worldPosition?: Vector3Like | null
	cameraPosition?: Vector3Like | null
}

function resolveDistance(a: Vector3Like, b: Vector3Like): number {
	const dx = (a.x ?? 0) - (b.x ?? 0)
	const dy = (a.y ?? 0) - (b.y ?? 0)
	const dz = (a.z ?? 0) - (b.z ?? 0)
	return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz))
}

function resolveChosenLodLevel(levels: ReadonlyArray<Partial<LodLevelDefinition>>, distance: number): Partial<LodLevelDefinition> | null {
	let chosen: Partial<LodLevelDefinition> | null = null
	for (let i = levels.length - 1; i >= 0; i -= 1) {
		const candidate = levels[i]
		if (candidate && distance >= (typeof candidate.distance === 'number' ? candidate.distance : Number(candidate.distance))) {
			chosen = candidate
			break
		}
	}
	return chosen
}

export function resolveInstancedLodTargetFromSnapshot(snapshot: InstancedLodSelectionSnapshot): InstancedLodTarget {
	const sourceAssetId = typeof snapshot.sourceAssetId === 'string' ? snapshot.sourceAssetId : null
	const rawLayout = snapshot.instanceLayout
	const layout = rawLayout ? clampSceneNodeInstanceLayout(rawLayout) : null
	const baseAssetId = resolveInstanceLayoutTemplateAssetId(layout, sourceAssetId)
	const normalizedBase = typeof baseAssetId === 'string' ? baseAssetId.trim() : null

	const props = clampLodComponentProps(snapshot.lodProps ?? null)
	const levels = props.levels
	if (!levels.length) {
		return {
			kind: 'model',
			assetId: normalizedBase,
			sourceModelAssetId: normalizedBase,
			faceCamera: false,
			forwardAxis: LOD_FACE_CAMERA_FORWARD_AXIS_X,
			key: normalizedBase ? `model:${normalizedBase}` : null,
		}
	}

	const worldPosition = snapshot.worldPosition ?? { x: 0, y: 0, z: 0 }
	const cameraPosition = snapshot.cameraPosition ?? worldPosition
	const distance = resolveDistance(worldPosition, cameraPosition)
	const chosen = resolveChosenLodLevel(levels, distance)
	const renderTarget = resolveLodRenderTarget(chosen)
	const assetId = typeof renderTarget.assetId === 'string' ? renderTarget.assetId.trim() : ''
	const resolvedAssetId = assetId || normalizedBase || null
	const kind = renderTarget.kind === 'billboard' && assetId ? 'billboard' : 'model'
	const forwardAxis = kind === 'model'
		? chosen?.forwardAxis ?? LOD_FACE_CAMERA_FORWARD_AXIS_X
		: LOD_FACE_CAMERA_FORWARD_AXIS_Z

	return {
		kind,
		assetId: resolvedAssetId,
		sourceModelAssetId: normalizedBase,
		faceCamera: chosen?.faceCamera === true,
		forwardAxis,
		key: resolvedAssetId ? `${kind}:${resolvedAssetId}` : null,
	}
}
