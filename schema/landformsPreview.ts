import * as THREE from 'three'
import type { GroundDynamicMesh, SceneNode } from './index'
import { stableSerialize } from './stableSerialize'
import { resolveEnabledComponentState } from './componentRuntimeUtils'
import {
	LANDFORMS_COMPONENT_TYPE,
	clampLandformsComponentProps,
	type LandformsBlendMode,
	type LandformsComponentProps,
	type LandformsLayer,
} from './components'

type LandformsPreviewTextureCacheEntry = {
	texture: THREE.Texture
	refCount: number
}

const LANDFORMS_PREVIEW_TEXTURE_CACHE = new Map<string, LandformsPreviewTextureCacheEntry>()
const LANDFORMS_PREVIEW_TEXTURE_REQUESTS = new Map<string, Promise<THREE.Texture | null>>()

export const LANDFORMS_PREVIEW_TEXTURE_USERDATA_KEY = '__landformsPreviewTexture'
export const LANDFORMS_PREVIEW_SIGNATURE_USERDATA_KEY = '__landformsPreviewSignature'
export const LANDFORMS_PREVIEW_PENDING_SIGNATURE_USERDATA_KEY = '__landformsPreviewPendingSignature'

const DEFAULT_LANDFORMS_PREVIEW_MAX_RESOLUTION = 1024
const MIN_LANDFORMS_PREVIEW_RESOLUTION = 256

type Canvas2DContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
type RuntimeCanvasLike = {
	width: number
	height: number
	getContext: (contextId: '2d') => Canvas2DContext | null
}
type CanvasLike = OffscreenCanvas | HTMLCanvasElement | RuntimeCanvasLike

export type LandformsPreviewLoaders = {
	loadLandformsTextureFromAssetId: (assetId: string) => Promise<THREE.Texture | null>
}

function normalizeFinite(value: number, fallback = 0): number {
	return Number.isFinite(value) ? value : fallback
}

function normalizeDimension(value: number): number {
	return Math.max(1, normalizeFinite(value, 1))
}

function createWeChatOffscreenCanvas(width: number, height: number): CanvasLike | null {
	const globalScope = globalThis as typeof globalThis & {
		wx?: {
			createOffscreenCanvas?: (options?: { type?: '2d'; width?: number; height?: number }) => RuntimeCanvasLike | null
		}
	}
	const factory = globalScope.wx?.createOffscreenCanvas
	if (typeof factory !== 'function') {
		return null
	}
	try {
		const canvas = factory({ type: '2d', width, height }) ?? factory()
		if (!canvas || typeof canvas.getContext !== 'function') {
			return null
		}
		canvas.width = width
		canvas.height = height
		return canvas
	} catch (_error) {
		return null
	}
}

function createCompositionCanvas(width: number, height: number): { canvas: CanvasLike; context: Canvas2DContext } | null {
	const normalizedWidth = Math.max(1, Math.round(width))
	const normalizedHeight = Math.max(1, Math.round(height))
	if (typeof OffscreenCanvas !== 'undefined') {
		const canvas = new OffscreenCanvas(normalizedWidth, normalizedHeight)
		const context = canvas.getContext('2d')
		if (context) {
			return { canvas, context }
		}
	}
	const weChatCanvas = createWeChatOffscreenCanvas(normalizedWidth, normalizedHeight)
	if (weChatCanvas) {
		const context = weChatCanvas.getContext('2d') as Canvas2DContext | null
		if (context) {
			return { canvas: weChatCanvas, context }
		}
	}
	if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
		const canvas = document.createElement('canvas')
		canvas.width = normalizedWidth
		canvas.height = normalizedHeight
		const context = canvas.getContext('2d') as Canvas2DContext | null
		if (context) {
			return { canvas, context }
		}
	}
	return null
}

function resolveLayerCompositeOperation(mode: LandformsBlendMode): GlobalCompositeOperation {
	switch (mode) {
		case 'multiply':
			return 'multiply'
		case 'screen':
			return 'screen'
		case 'overlay':
			return 'overlay'
		default:
			return 'source-over'
	}
}

function computePreviewTextureSize(definition: GroundDynamicMesh): { width: number; height: number } {
	const groundWidth = normalizeDimension(definition.width)
	const groundDepth = normalizeDimension(definition.depth)
	const maxDimension = Math.max(groundWidth, groundDepth, 1)
	const width = Math.max(
		MIN_LANDFORMS_PREVIEW_RESOLUTION,
		Math.round((groundWidth / maxDimension) * DEFAULT_LANDFORMS_PREVIEW_MAX_RESOLUTION),
	)
	const height = Math.max(
		MIN_LANDFORMS_PREVIEW_RESOLUTION,
		Math.round((groundDepth / maxDimension) * DEFAULT_LANDFORMS_PREVIEW_MAX_RESOLUTION),
	)
	return { width, height }
}

function buildLandformsPreviewSignature(definition: GroundDynamicMesh, props: LandformsComponentProps): string {
	const enabledLayers = props.layers.filter((layer) => layer.enabled && typeof layer.assetId === 'string' && layer.assetId.trim().length)
	return stableSerialize({
		width: normalizeDimension(definition.width),
		depth: normalizeDimension(definition.depth),
		layers: enabledLayers,
	})
}

function applyLayerMask(context: Canvas2DContext, layer: LandformsLayer, width: number, height: number): void {
	const shape = layer.mask.shape
	if (shape === 'none') {
		return
	}
	const centerX = width * normalizeFinite(layer.mask.center.x, 0.5)
	const centerY = height * normalizeFinite(layer.mask.center.y, 0.5)
	const sizeX = width * Math.max(0, normalizeFinite(layer.mask.size.x, 1))
	const sizeY = height * Math.max(0, normalizeFinite(layer.mask.size.y, 1))
	context.beginPath()
	if (shape === 'circle') {
		context.ellipse(centerX, centerY, Math.max(1, sizeX * 0.5), Math.max(1, sizeY * 0.5), 0, 0, Math.PI * 2)
	} else {
		context.rect(centerX - sizeX * 0.5, centerY - sizeY * 0.5, Math.max(1, sizeX), Math.max(1, sizeY))
	}
	context.clip()
}

function drawLayerTiled(
	context: Canvas2DContext,
	image: CanvasImageSource,
	layer: LandformsLayer,
	width: number,
	height: number,
): void {
	const repeatX = Math.max(0.001, normalizeFinite(layer.tileScale.x, 1))
	const repeatY = Math.max(0.001, normalizeFinite(layer.tileScale.y, 1))
	const tileWidth = layer.worldSpace ? width / repeatX : Math.min(width, height) / repeatX
	const tileHeight = layer.worldSpace ? height / repeatY : Math.min(width, height) / repeatY
	const offsetX = normalizeFinite(layer.offset.x, 0) * tileWidth
	const offsetY = normalizeFinite(layer.offset.y, 0) * tileHeight
	const drawStartX = -tileWidth * 2 + offsetX
	const drawStartY = -tileHeight * 2 + offsetY
	const drawEndX = width + tileWidth * 2
	const drawEndY = height + tileHeight * 2
	for (let y = drawStartY; y < drawEndY; y += tileHeight) {
		for (let x = drawStartX; x < drawEndX; x += tileWidth) {
			context.drawImage(image, x, y, tileWidth, tileHeight)
		}
	}
}

function tryResolveCanvasImageSource(texture: THREE.Texture | null): CanvasImageSource | null {
	const image = texture?.image as CanvasImageSource | undefined
	return image ?? null
}

async function composeLandformsPreviewTexture(
	definition: GroundDynamicMesh,
	props: LandformsComponentProps,
	loaders: LandformsPreviewLoaders,
): Promise<THREE.Texture | null> {
	const activeLayers = props.layers.filter((layer) => layer.enabled && typeof layer.assetId === 'string' && layer.assetId.trim().length)
	if (!activeLayers.length) {
		return null
	}
	const textureSize = computePreviewTextureSize(definition)
	const composition = createCompositionCanvas(textureSize.width, textureSize.height)
	if (!composition) {
		return null
	}
	const { canvas, context } = composition
	context.clearRect(0, 0, textureSize.width, textureSize.height)
	for (const layer of activeLayers) {
		const assetId = layer.assetId?.trim()
		if (!assetId) {
			continue
		}
		const texture = await loaders.loadLandformsTextureFromAssetId(assetId)
		const image = tryResolveCanvasImageSource(texture)
		if (!image) {
			continue
		}
		context.save()
		context.globalAlpha = Math.max(0, Math.min(1, normalizeFinite(layer.opacity, 1)))
		context.globalCompositeOperation = resolveLayerCompositeOperation(layer.blendMode)
		applyLayerMask(context, layer, textureSize.width, textureSize.height)
		context.translate(textureSize.width * 0.5, textureSize.height * 0.5)
		context.rotate((normalizeFinite(layer.rotationDeg, 0) * Math.PI) / 180)
		context.translate(-textureSize.width * 0.5, -textureSize.height * 0.5)
		drawLayerTiled(context, image, layer, textureSize.width, textureSize.height)
		context.restore()
	}
	const previewTexture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement)
	previewTexture.wrapS = THREE.ClampToEdgeWrapping
	previewTexture.wrapT = THREE.ClampToEdgeWrapping
	previewTexture.minFilter = THREE.LinearFilter
	previewTexture.magFilter = THREE.LinearFilter
	;(previewTexture as any).colorSpace = (THREE as any).SRGBColorSpace ?? (previewTexture as any).colorSpace
	previewTexture.needsUpdate = true
	return previewTexture
}

export function createDefaultLandformsPreviewLoaders(
	resolveAssetUrlFromCache: (assetId: string) => Promise<{ url: string | null } | null>,
): LandformsPreviewLoaders {
	const loader = new THREE.TextureLoader()
	async function loadLandformsTextureFromAssetId(assetId: string): Promise<THREE.Texture | null> {
		const resolved = await resolveAssetUrlFromCache(assetId)
		if (!resolved?.url) {
			return null
		}
		try {
			const texture = await loader.loadAsync(resolved.url)
			;(texture as any).colorSpace = (THREE as any).SRGBColorSpace ?? (texture as any).colorSpace
			texture.needsUpdate = true
			return texture
		} catch (error) {
			console.warn('[landformsPreview] Failed to load landform texture', assetId, error)
			return null
		}
	}
	return { loadLandformsTextureFromAssetId }
}

function releaseLandformsPreviewTextureBySignature(signature: string | null | undefined): void {
	if (!signature) {
		return
	}
	const entry = LANDFORMS_PREVIEW_TEXTURE_CACHE.get(signature)
	if (!entry) {
		return
	}
	entry.refCount = Math.max(0, entry.refCount - 1)
	if (entry.refCount > 0) {
		return
	}
	LANDFORMS_PREVIEW_TEXTURE_CACHE.delete(signature)
	entry.texture.dispose()
}

function getLandformsPreviewSignature(root: THREE.Object3D | null | undefined): string | null {
	return ((root?.userData as any)?.[LANDFORMS_PREVIEW_SIGNATURE_USERDATA_KEY] as string | null | undefined) ?? null
}

function getLandformsPreviewPendingSignature(root: THREE.Object3D | null | undefined): string | null {
	return ((root?.userData as any)?.[LANDFORMS_PREVIEW_PENDING_SIGNATURE_USERDATA_KEY] as string | null | undefined) ?? null
}

function setLandformsPreviewPendingSignature(root: THREE.Object3D, signature: string | null): void {
	;(root.userData as any)[LANDFORMS_PREVIEW_PENDING_SIGNATURE_USERDATA_KEY] = signature
}

export function clearLandformsPreviewForGround(root: THREE.Object3D | null | undefined): void {
	if (!root) {
		return
	}
	const currentSignature = getLandformsPreviewSignature(root)
	releaseLandformsPreviewTextureBySignature(currentSignature)
	;(root.userData as any)[LANDFORMS_PREVIEW_SIGNATURE_USERDATA_KEY] = null
	;(root.userData as any)[LANDFORMS_PREVIEW_TEXTURE_USERDATA_KEY] = null
	;(root.userData as any)[LANDFORMS_PREVIEW_PENDING_SIGNATURE_USERDATA_KEY] = null
}

export function setLandformsPreviewTexture(root: THREE.Object3D, signature: string | null, texture: THREE.Texture | null): void {
	if (!root) {
		return
	}
	const currentSignature = getLandformsPreviewSignature(root)
	const currentTexture = getLandformsPreviewTexture(root)
	if (currentSignature === signature && currentTexture === texture) {
		setLandformsPreviewPendingSignature(root, signature)
		return
	}
	releaseLandformsPreviewTextureBySignature(currentSignature)
	if (!signature || !texture) {
		;(root.userData as any)[LANDFORMS_PREVIEW_SIGNATURE_USERDATA_KEY] = null
		;(root.userData as any)[LANDFORMS_PREVIEW_TEXTURE_USERDATA_KEY] = null
		;(root.userData as any)[LANDFORMS_PREVIEW_PENDING_SIGNATURE_USERDATA_KEY] = null
		return
	}
	let entry = LANDFORMS_PREVIEW_TEXTURE_CACHE.get(signature)
	if (!entry) {
		entry = { texture, refCount: 0 }
		LANDFORMS_PREVIEW_TEXTURE_CACHE.set(signature, entry)
	}
	entry.refCount += 1
	;(root.userData as any)[LANDFORMS_PREVIEW_SIGNATURE_USERDATA_KEY] = signature
	;(root.userData as any)[LANDFORMS_PREVIEW_TEXTURE_USERDATA_KEY] = entry.texture
	;(root.userData as any)[LANDFORMS_PREVIEW_PENDING_SIGNATURE_USERDATA_KEY] = signature
}

export function getLandformsPreviewTexture(root: THREE.Object3D | null | undefined): THREE.Texture | null {
	return ((root?.userData as any)?.[LANDFORMS_PREVIEW_TEXTURE_USERDATA_KEY] as THREE.Texture | null | undefined) ?? null
}

export function syncLandformsPreviewForGround(
	groundObject: THREE.Object3D,
	groundNode: SceneNode | null | undefined,
	loaders: LandformsPreviewLoaders,
	getToken: () => number,
): void {
	if (!groundObject || !groundNode || groundNode.dynamicMesh?.type !== 'Ground') {
		clearLandformsPreviewForGround(groundObject)
		return
	}
	const component = resolveEnabledComponentState<LandformsComponentProps>(groundNode, LANDFORMS_COMPONENT_TYPE)
	if (!component) {
		clearLandformsPreviewForGround(groundObject)
		return
	}
	const props = clampLandformsComponentProps(component.props)
	const signature = buildLandformsPreviewSignature(groundNode.dynamicMesh, props)
	setLandformsPreviewPendingSignature(groundObject, signature)
	if (!props.layers.some((layer) => layer.enabled && typeof layer.assetId === 'string' && layer.assetId.trim().length)) {
		clearLandformsPreviewForGround(groundObject)
		return
	}
	const existingSignature = getLandformsPreviewSignature(groundObject)
	if (existingSignature === signature) {
		return
	}
	const cachedEntry = LANDFORMS_PREVIEW_TEXTURE_CACHE.get(signature)
	if (cachedEntry) {
		setLandformsPreviewTexture(groundObject, signature, cachedEntry.texture)
		return
	}
	const token = getToken()
	let pending = LANDFORMS_PREVIEW_TEXTURE_REQUESTS.get(signature)
	if (!pending) {
		pending = composeLandformsPreviewTexture(groundNode.dynamicMesh, props, loaders)
		LANDFORMS_PREVIEW_TEXTURE_REQUESTS.set(signature, pending)
	}
	pending.then((texture) => {
		LANDFORMS_PREVIEW_TEXTURE_REQUESTS.delete(signature)
		if (getToken() !== token) {
			texture?.dispose()
			return
		}
		if (!texture) {
			if (getLandformsPreviewPendingSignature(groundObject) === signature) {
				clearLandformsPreviewForGround(groundObject)
			}
			return
		}
		let entry = LANDFORMS_PREVIEW_TEXTURE_CACHE.get(signature)
		if (!entry) {
			entry = { texture, refCount: 0 }
			LANDFORMS_PREVIEW_TEXTURE_CACHE.set(signature, entry)
			queueMicrotask(() => {
				const currentEntry = LANDFORMS_PREVIEW_TEXTURE_CACHE.get(signature)
				if (!currentEntry || currentEntry !== entry || currentEntry.refCount > 0) {
					return
				}
				LANDFORMS_PREVIEW_TEXTURE_CACHE.delete(signature)
				currentEntry.texture.dispose()
			})
		}
		if (getLandformsPreviewPendingSignature(groundObject) !== signature) {
			return
		}
		setLandformsPreviewTexture(groundObject, signature, entry.texture)
	}).catch((error) => {
		LANDFORMS_PREVIEW_TEXTURE_REQUESTS.delete(signature)
		if (getLandformsPreviewPendingSignature(groundObject) === signature) {
			clearLandformsPreviewForGround(groundObject)
		}
		console.warn('[landformsPreview] Failed to compose landforms preview texture', error)
	})
}