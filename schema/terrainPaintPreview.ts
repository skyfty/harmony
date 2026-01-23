import * as THREE from 'three'
import type { GroundDynamicMesh, TerrainPaintChannel, TerrainPaintSettings } from './index'

const TERRAIN_PAINT_MATERIAL_KEY = '__harmonyTerrainPaintMaterialV1'
// Debug helpers removed: keep implementation minimal and focused on preview functionality.

type TerrainPaintShaderState = {
	shader: any
	chunkBounds: THREE.Vector4
	layerTextures: Partial<Record<TerrainPaintChannel, THREE.Texture>>
	weightmaps: Map<string, THREE.Texture>
	defaultWeightmap: THREE.DataTexture
	defaultWhite: THREE.DataTexture
}

function createDefaultWhiteTexture(): THREE.DataTexture {
	const data = new Uint8Array([255, 255, 255, 255])
	const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
	texture.needsUpdate = true
	texture.magFilter = THREE.NearestFilter
	texture.minFilter = THREE.NearestFilter
	texture.wrapS = THREE.ClampToEdgeWrapping
	texture.wrapT = THREE.ClampToEdgeWrapping
	;(texture as any).colorSpace = (THREE as any).NoColorSpace ?? undefined
	return texture
}

function createDefaultWeightmapTexture(): THREE.DataTexture {
	// Base-only: R=1, others=0
	const data = new Uint8Array([255, 0, 0, 0])
	const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
	texture.needsUpdate = true
	texture.magFilter = THREE.NearestFilter
	texture.minFilter = THREE.NearestFilter
	texture.wrapS = THREE.ClampToEdgeWrapping
	texture.wrapT = THREE.ClampToEdgeWrapping
	;(texture as any).colorSpace = (THREE as any).NoColorSpace ?? undefined
	return texture
}

function getOrCreateShaderState(material: THREE.Material): TerrainPaintShaderState {
	const existing = (material.userData as any)[TERRAIN_PAINT_MATERIAL_KEY] as TerrainPaintShaderState | undefined
	if (existing) {
		return existing
	}
	const state: TerrainPaintShaderState = {
		shader: null,
		chunkBounds: new THREE.Vector4(0, 0, 1, 1),
		layerTextures: {},
		weightmaps: new Map(),
		defaultWeightmap: createDefaultWeightmapTexture(),
		defaultWhite: createDefaultWhiteTexture(),
	}
	;(material.userData as any)[TERRAIN_PAINT_MATERIAL_KEY] = state
	return state
}

function installShaderHooks(material: THREE.MeshStandardMaterial): TerrainPaintShaderState {
	const state = getOrCreateShaderState(material)
	if (state.shader) {
		return state
	}

	material.customProgramCacheKey = () => `harmony-terrain-paint-v1`
	material.onBeforeCompile = (shader) => {
		state.shader = shader
		shader.uniforms.uTerrainPaintEnabled = { value: 0 }
		shader.uniforms.uTerrainPaintWeightmap = { value: state.defaultWeightmap }
		shader.uniforms.uTerrainPaintChunkBounds = { value: state.chunkBounds }
		shader.uniforms.uTerrainPaintLayerG = { value: state.defaultWhite }
		shader.uniforms.uTerrainPaintLayerB = { value: state.defaultWhite }
		shader.uniforms.uTerrainPaintLayerA = { value: state.defaultWhite }
		shader.uniforms.uTerrainPaintHasG = { value: 0 }
		shader.uniforms.uTerrainPaintHasB = { value: 0 }
		shader.uniforms.uTerrainPaintHasA = { value: 0 }

		shader.vertexShader = shader.vertexShader
			.replace('void main() {', 'varying vec2 vTerrainPaintLocalXZ;\nvoid main() {')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvTerrainPaintLocalXZ = position.xz;')

		shader.fragmentShader = shader.fragmentShader
			.replace(
				'void main() {',
				[
					'uniform float uTerrainPaintEnabled;',
					'uniform sampler2D uTerrainPaintWeightmap;',
					'uniform vec4 uTerrainPaintChunkBounds;',
					'uniform sampler2D uTerrainPaintLayerG;',
					'uniform sampler2D uTerrainPaintLayerB;',
					'uniform sampler2D uTerrainPaintLayerA;',
					'uniform float uTerrainPaintHasG;',
					'uniform float uTerrainPaintHasB;',
					'uniform float uTerrainPaintHasA;',
					'varying vec2 vTerrainPaintLocalXZ;',
					'void main() {',
				].join('\n'),
			)
			.replace(
				'#include <map_fragment>',
				[
					'#include <map_fragment>',
					'if (uTerrainPaintEnabled > 0.5) {',
					'  vec2 minXZ = uTerrainPaintChunkBounds.xy;',
					'  vec2 sizeXZ = max(uTerrainPaintChunkBounds.zw, vec2(0.000001));',
					'  vec2 wmUv = clamp((vTerrainPaintLocalXZ - minXZ) / sizeXZ, 0.0, 1.0);',
					'  vec2 layerUv = wmUv;',
					'#ifdef USE_UV',
					'  layerUv = vUv;',
					'#endif',
					'  vec4 w = texture2D(uTerrainPaintWeightmap, wmUv);',
					'  vec3 baseCol = diffuseColor.rgb;',
					'  vec3 gCol = mix(baseCol, texture2D(uTerrainPaintLayerG, layerUv).rgb, uTerrainPaintHasG);',
					'  vec3 bCol = mix(baseCol, texture2D(uTerrainPaintLayerB, layerUv).rgb, uTerrainPaintHasB);',
					'  vec3 aCol = mix(baseCol, texture2D(uTerrainPaintLayerA, layerUv).rgb, uTerrainPaintHasA);',
					'  diffuseColor.rgb = baseCol * w.r + gCol * w.g + bCol * w.b + aCol * w.a;',
					'}',
				].join('\n'),
			)
	}

	material.needsUpdate = true
	return state
}

function resolveChunkKeyFromMesh(mesh: THREE.Object3D): string | null {
	const chunk = (mesh.userData as any)?.groundChunk
	const row = typeof chunk?.chunkRow === 'number' ? chunk.chunkRow : null
	const col = typeof chunk?.chunkColumn === 'number' ? chunk.chunkColumn : null
	if (row === null || col === null) {
		return null
	}
	return `${row}:${col}`
}

function computeChunkBounds(definition: GroundDynamicMesh, mesh: THREE.Object3D): THREE.Vector4 | null {
	const chunk = (mesh.userData as any)?.groundChunk
	if (!chunk) {
		return null
	}
	const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
	const halfWidth = definition.width * 0.5
	const halfDepth = definition.depth * 0.5
	const startColumn = typeof chunk.startColumn === 'number' ? chunk.startColumn : 0
	const startRow = typeof chunk.startRow === 'number' ? chunk.startRow : 0
	const columns = typeof chunk.columns === 'number' ? chunk.columns : 0
	const rows = typeof chunk.rows === 'number' ? chunk.rows : 0
	const minX = -halfWidth + startColumn * cellSize
	const minZ = -halfDepth + startRow * cellSize
	const width = Math.max(1e-6, columns * cellSize)
	const depth = Math.max(1e-6, rows * cellSize)
	return new THREE.Vector4(minX, minZ, width, depth)
}

export function ensureTerrainPaintPreviewInstalled(
	root: THREE.Object3D,
	definition: GroundDynamicMesh,
	settings: TerrainPaintSettings | null,
): void {
	if (!root) {
		return
	}
	;(root.userData as any).__terrainPaintDefinition = definition
	;(root.userData as any).__terrainPaintSettings = settings

	// counts removed (debugging variables) — keep function focused on installing hooks
	const materialSet = new Set<THREE.MeshStandardMaterial>()

	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh
		if (!mesh?.isMesh) {
			return
		}
		const material = mesh.material
		if (Array.isArray(material)) {
			material.forEach((entry) => {
				if (entry && entry instanceof THREE.MeshStandardMaterial) {
					materialSet.add(entry)
				}
			})
			return
		}
		if (material && material instanceof THREE.MeshStandardMaterial) {
			materialSet.add(material)
		}
	})
	if (materialSet.size === 0) {
		return
	}

	const materials = Array.from(materialSet)
	materials.forEach((material) => {
		installShaderHooks(material)
	})
	;(root.userData as any).groundMaterials = materials
	;(root.userData as any).groundMaterial = materials[0]
	// Installed shader hooks on discovered materials.

	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh
		if (!mesh?.isMesh) {
			return
		}
		if (typeof (mesh.userData as any).__terrainPaintBound === 'boolean') {
			return
		}
		;(mesh.userData as any).__terrainPaintBound = true
		mesh.onBeforeRender = (_renderer, _scene, _camera, _geometry, mat) => {
			if (!(mat instanceof THREE.MeshStandardMaterial)) {
				return
			}
			const state = getOrCreateShaderState(mat)
			if (!state.shader) {
				return
			}
			const def = (root.userData as any).__terrainPaintDefinition as GroundDynamicMesh | undefined
			const currentSettings = (root.userData as any).__terrainPaintSettings as TerrainPaintSettings | null | undefined
			if (!def) {
				return
			}
			if (currentSettings && currentSettings.version !== 1) {
				// Unsupported settings version; disable preview by not enabling the shader uniforms below.
			}
			const bounds = computeChunkBounds(def, mesh)
			if (bounds) {
				state.chunkBounds.copy(bounds)
			}
			const key = resolveChunkKeyFromMesh(mesh)
			const weightmap = key ? state.weightmaps.get(key) ?? state.defaultWeightmap : state.defaultWeightmap
			state.shader.uniforms.uTerrainPaintEnabled.value = currentSettings && currentSettings.version === 1 ? 1 : 0
			state.shader.uniforms.uTerrainPaintWeightmap.value = weightmap
			state.shader.uniforms.uTerrainPaintChunkBounds.value = state.chunkBounds
			state.shader.uniforms.uTerrainPaintLayerG.value = state.layerTextures.g ?? state.defaultWhite
			state.shader.uniforms.uTerrainPaintLayerB.value = state.layerTextures.b ?? state.defaultWhite
			state.shader.uniforms.uTerrainPaintLayerA.value = state.layerTextures.a ?? state.defaultWhite
			state.shader.uniforms.uTerrainPaintHasG.value = state.layerTextures.g ? 1 : 0
			state.shader.uniforms.uTerrainPaintHasB.value = state.layerTextures.b ? 1 : 0
			state.shader.uniforms.uTerrainPaintHasA.value = state.layerTextures.a ? 1 : 0
		}
	})

	// Bindings installed.
}

export function setTerrainPaintPreviewWeightmapTexture(material: THREE.Material, chunkKey: string, texture: THREE.Texture | null): void {
	const state = getOrCreateShaderState(material)
	if (!chunkKey) {
		return
	}
	if (!texture) {
		state.weightmaps.delete(chunkKey)
		return
	}
	texture.wrapS = THREE.ClampToEdgeWrapping
	texture.wrapT = THREE.ClampToEdgeWrapping
	texture.minFilter = THREE.LinearFilter
	texture.magFilter = THREE.LinearFilter
	;(texture as any).colorSpace = (THREE as any).NoColorSpace ?? undefined
	texture.needsUpdate = true
	state.weightmaps.set(chunkKey, texture)
}

export function updateTerrainPaintPreviewWeightmap(
	material: THREE.Material,
	chunkKey: string,
	data: Uint8ClampedArray,
	resolution: number,
): void {
	const state = getOrCreateShaderState(material)
	const res = Math.max(1, Math.round(resolution))
	const bytes = new Uint8Array(data.buffer as unknown as ArrayBuffer)
	const existing = state.weightmaps.get(chunkKey)
	const existingData = existing instanceof THREE.DataTexture ? existing : null
	let texture = existingData
	if (!texture || texture.image.width !== res || texture.image.height !== res) {
		texture = new THREE.DataTexture(bytes as unknown as BufferSource, res, res, THREE.RGBAFormat)
		texture.needsUpdate = true
		texture.magFilter = THREE.LinearFilter
		texture.minFilter = THREE.LinearFilter
		texture.wrapS = THREE.ClampToEdgeWrapping
		texture.wrapT = THREE.ClampToEdgeWrapping
		;(texture as any).colorSpace = (THREE as any).NoColorSpace ?? undefined
		state.weightmaps.set(chunkKey, texture)
		return
	}
	texture.image.data = bytes as unknown as Uint8Array
	texture.needsUpdate = true
}

export function updateTerrainPaintPreviewLayerTexture(
	material: THREE.Material,
	channel: TerrainPaintChannel,
	texture: THREE.Texture | null,
): void {
	const state = getOrCreateShaderState(material)
	if (channel === 'r') {
		return
	}
	if (texture) {
		texture.wrapS = THREE.RepeatWrapping
		texture.wrapT = THREE.RepeatWrapping
		;(texture as any).colorSpace = (THREE as any).SRGBColorSpace ?? (texture as any).colorSpace
		texture.needsUpdate = true
		;(state.layerTextures as any)[channel] = texture
		return
	}
	delete (state.layerTextures as any)[channel]
}

export async function decodeWeightmapToData(blob: Blob, resolution: number): Promise<Uint8ClampedArray> {
	const res = Math.max(1, Math.round(resolution))
	// Binary fast-path (preferred for persisted terrain paint weightmaps).
	// Format:
	// - 4 bytes magic: 'HWP1'
	// - uint16 little-endian: resolution
	// - uint32 little-endian: payload byte length
	// - payload: RGBA bytes (res * res * 4)
	// Only binary format is supported now.
	if (blob.type === 'application/octet-stream' || blob.type === 'binary/octet-stream' || blob.type === '' || blob.type === 'undefined') {
		const expectedLength = res * res * 4
		const buffer = await blob.arrayBuffer()
		const bytes = new Uint8Array(buffer)
		if (bytes.length === expectedLength) {
			return new Uint8ClampedArray(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + expectedLength))
		}
		if (bytes.length >= 10 && bytes[0] === 0x48 && bytes[1] === 0x57 && bytes[2] === 0x50 && bytes[3] === 0x31) {
			const view = new DataView(buffer)
			const storedRes = view.getUint16(4, true)
			const payloadLen = view.getUint32(6, true)
			const offset = 10
			if (storedRes !== res) {
				throw new Error(`Weightmap resolution mismatch: expected ${res}, got ${storedRes}`)
			}
			if (payloadLen !== expectedLength) {
				throw new Error(`Weightmap payload length mismatch: expected ${expectedLength}, got ${payloadLen}`)
			}
			if (offset + payloadLen > bytes.length) {
				throw new Error('Weightmap payload truncated')
			}
			const payload = bytes.subarray(offset, offset + payloadLen)
			return new Uint8ClampedArray(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength))
		}
	}
	throw new Error('Unsupported weightmap format: only the binary HWP1 weightmap format is supported')
}

export function encodeWeightmapToBinary(data: Uint8ClampedArray, resolution: number): Blob {
	const res = Math.max(1, Math.round(resolution))
	const expectedLength = res * res * 4
	const src = new Uint8Array(data.buffer as unknown as ArrayBuffer, data.byteOffset, data.byteLength)
	if (src.byteLength !== expectedLength) {
		throw new Error(`Weightmap byte length mismatch: expected ${expectedLength}, got ${src.byteLength}`)
	}
	const headerSize = 10
	const out = new Uint8Array(headerSize + expectedLength)
	out[0] = 0x48 // H
	out[1] = 0x57 // W
	out[2] = 0x50 // P
	out[3] = 0x31 // 1
	const view = new DataView(out.buffer)
	view.setUint16(4, res, true)
	view.setUint32(6, expectedLength, true)
	out.set(src, headerSize)
	return new Blob([out], { type: 'application/octet-stream' })
}

export type AssetLoader = (assetId: string) => Promise<Blob | null>
export type TextureLoader = (assetId: string) => Promise<THREE.Texture | null>

export async function loadTerrainPaintAssets(
	root: THREE.Object3D,
	definition: GroundDynamicMesh,
	settings: TerrainPaintSettings,
	assetLoader: AssetLoader,
	textureLoader: TextureLoader,
): Promise<void> {
	ensureTerrainPaintPreviewInstalled(root, definition, settings)
	const materials = (root.userData as any).groundMaterials as THREE.Material[] | undefined
	const material = (root.userData as any).groundMaterial as THREE.Material | undefined
	const targets = (materials && materials.length ? materials : material ? [material] : []) as THREE.Material[]
	if (!targets.length) {
		return
	}

	// Load layers
	if (settings.layers) {
		for (const layer of settings.layers) {
			const tex = await textureLoader(layer.textureAssetId)
			if (tex) {
				targets.forEach((target) => {
					updateTerrainPaintPreviewLayerTexture(target, layer.channel, tex)
				})
			}
		}
	}

	// Load chunks
	if (settings.chunks) {
		const promises = Object.entries(settings.chunks).map(async ([key, chunkRef]) => {
			const logicalId = (chunkRef as any)?.logicalId
			if (typeof logicalId !== 'string') return
			const blob = await assetLoader(logicalId)
			if (blob) {
				try {
					const data = await decodeWeightmapToData(blob, settings.weightmapResolution)
					targets.forEach((target) => {
						updateTerrainPaintPreviewWeightmap(target, key, data, settings.weightmapResolution)
					})
				} catch (error) {
					console.warn(`Failed to decode weightmap for chunk ${key}`, error)
				}
			}
		})
		await Promise.all(promises)
	}
}

// Helper: clone per-mesh materials once to avoid shared-material state when previewing terrain paint.
export function cloneTerrainPaintPreviewMaterialsOnce(root: THREE.Object3D): void {
	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh
		if (!mesh?.isMesh) {
			return
		}
		if ((mesh.userData as any)?.__terrainPaintPreviewMaterialCloned) {
			return
		}
		const mat = mesh.material
		if (Array.isArray(mat)) {
			let changed = false
			const cloned = mat.map((entry) => {
				if (entry instanceof THREE.MeshStandardMaterial) {
					changed = true
					return entry.clone()
				}
				return entry
			})
			if (changed) {
				mesh.material = cloned
			}
		} else if (mat instanceof THREE.MeshStandardMaterial) {
			mesh.material = mat.clone()
		}
		;(mesh.userData as any).__terrainPaintPreviewMaterialCloned = true
	})
}

// Helper: collect visible chunk materials mapping (chunkKey -> materials[]) and a set of visible materials.
export function collectVisibleChunkMaterials(root: THREE.Object3D): {
	visibleChunkMaterials: Map<string, THREE.MeshStandardMaterial[]>
	visibleMaterials: Set<THREE.MeshStandardMaterial>
} {
	const visibleChunkMaterials = new Map<string, THREE.MeshStandardMaterial[]>()
	const visibleMaterials = new Set<THREE.MeshStandardMaterial>()
	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh
		if (!mesh?.isMesh) {
			return
		}
		const chunk = (mesh.userData as any)?.groundChunk
		const row = typeof chunk?.chunkRow === 'number' ? chunk.chunkRow : null
		const col = typeof chunk?.chunkColumn === 'number' ? chunk.chunkColumn : null
		if (row === null || col === null) {
			return
		}
		const chunkKey = `${row}:${col}`
		const materials: THREE.MeshStandardMaterial[] = []
		const mat = mesh.material
		if (Array.isArray(mat)) {
			for (const entry of mat) {
				if (entry instanceof THREE.MeshStandardMaterial) {
					materials.push(entry)
				}
			}
		} else if (mat instanceof THREE.MeshStandardMaterial) {
			materials.push(mat)
		}
		if (!materials.length) {
			return
		}
		const existing = visibleChunkMaterials.get(chunkKey)
		if (existing) {
			for (const material of materials) {
				if (!existing.includes(material)) {
					existing.push(material)
				}
				visibleMaterials.add(material)
			}
			return
		}
		visibleChunkMaterials.set(chunkKey, materials)
		for (const material of materials) {
			visibleMaterials.add(material)
		}
	})
	return { visibleChunkMaterials, visibleMaterials }
}

// Internal caches and request maps used by sync helper
const terrainPaintLayerTextureRequests = new Map<string, Promise<THREE.Texture | null>>()
const terrainPaintLayerTextureCache = new Map<string, THREE.Texture | null>()
const terrainPaintChunkWeightmapRequests = new Map<string, Promise<Uint8ClampedArray | null>>()
const terrainPaintChunkWeightmapDataCache = new Map<string, Uint8ClampedArray | null>()
const terrainPaintChunkRefKeys = new Map<string, string>()

export type TerrainPaintLoaders = {
	loadTerrainPaintTextureFromAssetId: (assetId: string, options: { colorSpace: 'srgb' | 'none' }) => Promise<THREE.Texture | null>
	loadTerrainPaintWeightmapDataFromAssetId: (assetId: string, resolution: number) => Promise<Uint8ClampedArray | null>
}

// Create default loaders using a provided `resolveAssetUrlFromCache` function.
export function createDefaultTerrainPaintLoaders(
	resolveAssetUrlFromCache: (assetId: string) => Promise<{ url: string | null } | null>,
): TerrainPaintLoaders {
	const loader = new THREE.TextureLoader()

	async function loadTerrainPaintTextureFromAssetId(assetId: string, options: { colorSpace: 'srgb' | 'none' }) {
		const resolved = await resolveAssetUrlFromCache(assetId)
		if (!resolved?.url) {
			return null
		}
		try {
			const texture = await loader.loadAsync(resolved.url)
			if (options.colorSpace === 'srgb') {
				;(texture as any).colorSpace = (THREE as any).SRGBColorSpace ?? (texture as any).colorSpace
			} else {
				;(texture as any).colorSpace = (THREE as any).NoColorSpace ?? undefined
			}
			texture.needsUpdate = true
			return texture
		} catch (error) {
			console.warn('[terrainPaintPreview] Failed to load terrain paint texture', assetId, error)
			return null
		}
	}

	async function loadTerrainPaintWeightmapDataFromAssetId(assetId: string, resolution: number) {
		const resolved = await resolveAssetUrlFromCache(assetId)
		if (!resolved?.url) {
			return null
		}
		try {
			const response = await fetch(resolved.url, { credentials: 'include' })
			if (!response.ok) {
				return null
			}
			const blob = await response.blob()
			return await decodeWeightmapToData(blob, resolution)
		} catch (error) {
			console.warn('[terrainPaintPreview] Failed to load terrain paint weightmap', assetId, error)
			return null
		}
	}

	return {
		loadTerrainPaintTextureFromAssetId,
		loadTerrainPaintWeightmapDataFromAssetId,
	}
}

// Shared sync function: clones per-mesh materials (once), installs shader hooks, and loads/apply layer textures + weightmaps.
export function syncTerrainPaintPreviewForGround(
	groundObject: THREE.Object3D,
	dynamicMesh: GroundDynamicMesh,
	loaders: TerrainPaintLoaders,
	getToken: () => number,
): void {
	const settings: any = (dynamicMesh as any)?.terrainPaint ?? null

	// Ensure per-mesh cloned materials and shader hooks
	cloneTerrainPaintPreviewMaterialsOnce(groundObject)
	ensureTerrainPaintPreviewInstalled(groundObject, dynamicMesh, settings)

	const { visibleChunkMaterials, visibleMaterials } = collectVisibleChunkMaterials(groundObject)
	if (!visibleMaterials.size) {
		return
	}
	const targets = Array.from(visibleMaterials)
	const token = getToken()

	const layerG = (function () {
		const layers = Array.isArray(settings?.layers) ? settings.layers : []
		const match = layers.find((layer: any) => layer?.channel === 'g')
		const candidate = typeof match?.textureAssetId === 'string' ? match.textureAssetId.trim() : ''
		return candidate.length ? candidate : null
	})()
	const layerB = (function () {
		const layers = Array.isArray(settings?.layers) ? settings.layers : []
		const match = layers.find((layer: any) => layer?.channel === 'b')
		const candidate = typeof match?.textureAssetId === 'string' ? match.textureAssetId.trim() : ''
		return candidate.length ? candidate : null
	})()
	const layerA = (function () {
		const layers = Array.isArray(settings?.layers) ? settings.layers : []
		const match = layers.find((layer: any) => layer?.channel === 'a')
		const candidate = typeof match?.textureAssetId === 'string' ? match.textureAssetId.trim() : ''
		return candidate.length ? candidate : null
	})()

	const layerPairs: Array<{ channel: 'g' | 'b' | 'a'; assetId: string | null }> = [
		{ channel: 'g', assetId: layerG },
		{ channel: 'b', assetId: layerB },
		{ channel: 'a', assetId: layerA },
	]

	for (const pair of layerPairs) {
		if (!pair.assetId) {
			targets.forEach((target) => {
				updateTerrainPaintPreviewLayerTexture(target, pair.channel, null)
			})
			continue
		}
		const cachedTexture = terrainPaintLayerTextureCache.get(pair.assetId)
		if (cachedTexture !== undefined) {
			targets.forEach((target) => {
				updateTerrainPaintPreviewLayerTexture(target, pair.channel, cachedTexture)
			})
			continue
		}
		let pending = terrainPaintLayerTextureRequests.get(pair.assetId)
		if (!pending) {
			pending = loaders.loadTerrainPaintTextureFromAssetId(pair.assetId, { colorSpace: 'srgb' })
			terrainPaintLayerTextureRequests.set(pair.assetId, pending)
		}
		pending.then((texture) => {
			terrainPaintLayerTextureCache.set(pair.assetId as string, texture)
			if (getToken() !== token) {
				return
			}
			targets.forEach((target) => {
				updateTerrainPaintPreviewLayerTexture(target, pair.channel, texture)
			})
		})
	}

	const chunks = settings?.chunks && typeof settings.chunks === 'object' ? settings.chunks : null
	if (!chunks) {
		return
	}

	for (const [chunkKey, chunkTargets] of visibleChunkMaterials) {
		const ref = (chunks as any)[chunkKey]
		const logicalId = typeof ref?.logicalId === 'string' ? ref.logicalId.trim() : ''
		if (!logicalId.length) {
			terrainPaintChunkRefKeys.delete(chunkKey)
			chunkTargets.forEach((target) => {
				setTerrainPaintPreviewWeightmapTexture(target, chunkKey, null)
			})
			continue
		}
		const refKey = logicalId
		const previousRefKey = terrainPaintChunkRefKeys.get(chunkKey)
		if (previousRefKey !== refKey) {
			terrainPaintChunkRefKeys.set(chunkKey, refKey)
			chunkTargets.forEach((target) => {
				setTerrainPaintPreviewWeightmapTexture(target, chunkKey, null)
			})
		}

		const cachedData = terrainPaintChunkWeightmapDataCache.get(refKey)
		if (cachedData !== undefined) {
			if (cachedData) {
				chunkTargets.forEach((target) => {
					updateTerrainPaintPreviewWeightmap(target, chunkKey, cachedData, settings.weightmapResolution)
				})
			} else {
				chunkTargets.forEach((target) => {
					setTerrainPaintPreviewWeightmapTexture(target, chunkKey, null)
				})
			}
			continue
		}

		let pending = terrainPaintChunkWeightmapRequests.get(refKey)
		if (!pending) {
			pending = loaders.loadTerrainPaintWeightmapDataFromAssetId(logicalId, settings.weightmapResolution)
			terrainPaintChunkWeightmapRequests.set(refKey, pending)
		}
		pending.then((data) => {
			terrainPaintChunkWeightmapDataCache.set(refKey, data)
			if (getToken() !== token) {
				return
			}
			if (terrainPaintChunkRefKeys.get(chunkKey) !== refKey) {
				return
			}
			if (data) {
				chunkTargets.forEach((target) => {
					updateTerrainPaintPreviewWeightmap(target, chunkKey, data, settings.weightmapResolution)
				})
			} else {
				chunkTargets.forEach((target) => {
					setTerrainPaintPreviewWeightmapTexture(target, chunkKey, null)
				})
			}
		})
	}
}

