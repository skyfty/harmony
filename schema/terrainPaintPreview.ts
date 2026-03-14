import * as THREE from 'three'
import type {
	GroundDynamicMesh,
	TerrainPaintBlendMode,
	TerrainPaintChannel,
	TerrainPaintLayerDefinition,
	TerrainPaintSettings,
} from './index'
import { getLandformsPreviewTexture } from './landformsPreview'

// Debug helpers removed: keep implementation minimal and focused on preview functionality.

const terrainPaintShaderStateByMaterial = new WeakMap<THREE.Material, TerrainPaintShaderState>()

type TerrainPaintShaderState = {
	shader: any
	chunkBounds: THREE.Vector4
	landformsBounds: THREE.Vector4
	layerTextures: Partial<Record<TerrainPaintChannel, THREE.Texture>>
	layerParamsA: Record<TerrainPaintChannel, THREE.Vector4>
	layerParamsB: Record<TerrainPaintChannel, THREE.Vector4>
	weightmaps: Map<string, THREE.Texture>
	defaultWeightmap: THREE.DataTexture
	defaultWhite: THREE.DataTexture
	defaultTransparent: THREE.DataTexture
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
	const data = new Uint8Array([0, 0, 0, 0])
	const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
	texture.needsUpdate = true
	texture.magFilter = THREE.NearestFilter
	texture.minFilter = THREE.NearestFilter
	texture.wrapS = THREE.ClampToEdgeWrapping
	texture.wrapT = THREE.ClampToEdgeWrapping
	;(texture as any).colorSpace = (THREE as any).NoColorSpace ?? undefined
	return texture
}

function createDefaultTransparentTexture(): THREE.DataTexture {
	const data = new Uint8Array([255, 255, 255, 0])
	const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
	texture.needsUpdate = true
	texture.magFilter = THREE.NearestFilter
	texture.minFilter = THREE.NearestFilter
	texture.wrapS = THREE.ClampToEdgeWrapping
	texture.wrapT = THREE.ClampToEdgeWrapping
	;(texture as any).colorSpace = (THREE as any).NoColorSpace ?? undefined
	return texture
}

function createShaderState(): TerrainPaintShaderState {
	return {
		shader: null,
		chunkBounds: new THREE.Vector4(0, 0, 1, 1),
		landformsBounds: new THREE.Vector4(-0.5, -0.5, 1, 1),
		layerTextures: {},
		layerParamsA: {
			r: new THREE.Vector4(1, 1, 0, 0),
			g: new THREE.Vector4(1, 1, 0, 0),
			b: new THREE.Vector4(1, 1, 0, 0),
			a: new THREE.Vector4(1, 1, 0, 0),
		},
		layerParamsB: {
			r: new THREE.Vector4(0, 1, 1, 0),
			g: new THREE.Vector4(0, 1, 1, 0),
			b: new THREE.Vector4(0, 1, 1, 0),
			a: new THREE.Vector4(0, 1, 1, 0),
		},
		weightmaps: new Map(),
		defaultWeightmap: createDefaultWeightmapTexture(),
		defaultWhite: createDefaultWhiteTexture(),
		defaultTransparent: createDefaultTransparentTexture(),
	}
}

function getOrCreateShaderState(material: THREE.Material): TerrainPaintShaderState {
	const existing = terrainPaintShaderStateByMaterial.get(material)
	if (existing) {
		return existing
	}

	const state = createShaderState()
	terrainPaintShaderStateByMaterial.set(material, state)
	return state
}

function installShaderHooks(material: THREE.MeshStandardMaterial): TerrainPaintShaderState {
	const state = getOrCreateShaderState(material)
	if (state.shader) {
		return state
	}

	material.customProgramCacheKey = () => `harmony-terrain-paint-v3`
	material.onBeforeCompile = (shader) => {
		state.shader = shader
		shader.uniforms.uLandformsEnabled = { value: 0 }
		shader.uniforms.uLandformsTexture = { value: state.defaultTransparent }
		shader.uniforms.uLandformsBounds = { value: state.landformsBounds }
		shader.uniforms.uTerrainPaintEnabled = { value: 0 }
		shader.uniforms.uTerrainPaintWeightmap = { value: state.defaultWeightmap }
		shader.uniforms.uTerrainPaintChunkBounds = { value: state.chunkBounds }
		shader.uniforms.uTerrainPaintGroundBounds = { value: state.landformsBounds }
		shader.uniforms.uTerrainPaintLayerR = { value: state.defaultWhite }
		shader.uniforms.uTerrainPaintLayerG = { value: state.defaultWhite }
		shader.uniforms.uTerrainPaintLayerB = { value: state.defaultWhite }
		shader.uniforms.uTerrainPaintLayerA = { value: state.defaultWhite }
		shader.uniforms.uTerrainPaintLayerRParamsA = { value: state.layerParamsA.r }
		shader.uniforms.uTerrainPaintLayerGParamsA = { value: state.layerParamsA.g }
		shader.uniforms.uTerrainPaintLayerBParamsA = { value: state.layerParamsA.b }
		shader.uniforms.uTerrainPaintLayerAParamsA = { value: state.layerParamsA.a }
		shader.uniforms.uTerrainPaintLayerRParamsB = { value: state.layerParamsB.r }
		shader.uniforms.uTerrainPaintLayerGParamsB = { value: state.layerParamsB.g }
		shader.uniforms.uTerrainPaintLayerBParamsB = { value: state.layerParamsB.b }
		shader.uniforms.uTerrainPaintLayerAParamsB = { value: state.layerParamsB.a }
		shader.uniforms.uTerrainPaintHasR = { value: 0 }
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
					'uniform float uLandformsEnabled;',
					'uniform sampler2D uLandformsTexture;',
					'uniform vec4 uLandformsBounds;',
					'uniform float uTerrainPaintEnabled;',
					'uniform sampler2D uTerrainPaintWeightmap;',
					'uniform vec4 uTerrainPaintChunkBounds;',
					'uniform vec4 uTerrainPaintGroundBounds;',
					'uniform sampler2D uTerrainPaintLayerR;',
					'uniform sampler2D uTerrainPaintLayerG;',
					'uniform sampler2D uTerrainPaintLayerB;',
					'uniform sampler2D uTerrainPaintLayerA;',
					'uniform vec4 uTerrainPaintLayerRParamsA;',
					'uniform vec4 uTerrainPaintLayerGParamsA;',
					'uniform vec4 uTerrainPaintLayerBParamsA;',
					'uniform vec4 uTerrainPaintLayerAParamsA;',
					'uniform vec4 uTerrainPaintLayerRParamsB;',
					'uniform vec4 uTerrainPaintLayerGParamsB;',
					'uniform vec4 uTerrainPaintLayerBParamsB;',
					'uniform vec4 uTerrainPaintLayerAParamsB;',
					'uniform float uTerrainPaintHasR;',
					'uniform float uTerrainPaintHasG;',
					'uniform float uTerrainPaintHasB;',
					'uniform float uTerrainPaintHasA;',
					'varying vec2 vTerrainPaintLocalXZ;',
					'vec3 terrainPaintBlendColor(vec3 baseColor, vec3 layerColor, float blendMode) {',
					'  if (blendMode < 0.5) return layerColor;',
					'  if (blendMode < 1.5) return baseColor * layerColor;',
					'  if (blendMode < 2.5) return 1.0 - (1.0 - baseColor) * (1.0 - layerColor);',
					'  vec3 low = 2.0 * baseColor * layerColor;',
					'  vec3 high = 1.0 - 2.0 * (1.0 - baseColor) * (1.0 - layerColor);',
					'  return mix(low, high, step(vec3(0.5), baseColor));',
					'}',
					'vec2 terrainPaintTransformUv(vec2 meshUv, vec2 worldUv, vec4 paramsA, vec4 paramsB) {',
					'  vec2 baseUv = mix(meshUv, worldUv, step(0.5, paramsB.z));',
					'  float rotation = paramsB.x;',
					'  float s = sin(rotation);',
					'  float c = cos(rotation);',
					'  vec2 centeredUv = baseUv - vec2(0.5);',
					'  vec2 rotatedUv = vec2(c * centeredUv.x - s * centeredUv.y, s * centeredUv.x + c * centeredUv.y);',
					'  return rotatedUv * paramsA.xy + vec2(0.5) + paramsA.zw;',
					'}',
					'vec3 terrainPaintSampleLayer(vec3 baseColor, sampler2D layerTexture, vec2 meshUv, vec2 worldUv, vec4 paramsA, vec4 paramsB) {',
					'  vec2 layerUv = terrainPaintTransformUv(meshUv, worldUv, paramsA, paramsB);',
					'  vec4 layerSample = texture2D(layerTexture, layerUv);',
					'  vec3 blendedColor = terrainPaintBlendColor(baseColor, layerSample.rgb, paramsB.w);',
					'  float alpha = clamp(paramsB.y, 0.0, 1.0) * layerSample.a;',
					'  return mix(baseColor, blendedColor, alpha);',
					'}',
					'void main() {',
				].join('\n'),
			)
			.replace(
				'#include <map_fragment>',
				[
					'#include <map_fragment>',
					'vec3 terrainBaseCol = diffuseColor.rgb;',
					'if (uLandformsEnabled > 0.5) {',
					'  vec2 landformsMinXZ = uLandformsBounds.xy;',
					'  vec2 landformsSizeXZ = max(uLandformsBounds.zw, vec2(0.000001));',
					'  vec2 landformsUv = clamp((vTerrainPaintLocalXZ - landformsMinXZ) / landformsSizeXZ, 0.0, 1.0);',
					'  vec4 landformsSample = texture2D(uLandformsTexture, landformsUv);',
					'  terrainBaseCol = mix(terrainBaseCol, landformsSample.rgb, landformsSample.a);',
					'}',
					'diffuseColor.rgb = terrainBaseCol;',
					'if (uTerrainPaintEnabled > 0.5) {',
					'  vec2 minXZ = uTerrainPaintChunkBounds.xy;',
					'  vec2 sizeXZ = max(uTerrainPaintChunkBounds.zw, vec2(0.000001));',
					'  vec2 groundMinXZ = uTerrainPaintGroundBounds.xy;',
					'  vec2 groundSizeXZ = max(uTerrainPaintGroundBounds.zw, vec2(0.000001));',
					'  vec2 wmUv = clamp((vTerrainPaintLocalXZ - minXZ) / sizeXZ, 0.0, 1.0);',
					'  vec2 meshUv = wmUv;',
					'#ifdef USE_UV',
					'  meshUv = vUv;',
					'#endif',
					'  vec2 groundUv = clamp((vTerrainPaintLocalXZ - groundMinXZ) / groundSizeXZ, 0.0, 1.0);',
					'  vec4 w = texture2D(uTerrainPaintWeightmap, wmUv);',
					'  vec3 baseCol = terrainBaseCol;',
					'  vec3 rCol = mix(baseCol, terrainPaintSampleLayer(baseCol, uTerrainPaintLayerR, meshUv, groundUv, uTerrainPaintLayerRParamsA, uTerrainPaintLayerRParamsB), uTerrainPaintHasR);',
					'  vec3 gCol = mix(baseCol, terrainPaintSampleLayer(baseCol, uTerrainPaintLayerG, meshUv, groundUv, uTerrainPaintLayerGParamsA, uTerrainPaintLayerGParamsB), uTerrainPaintHasG);',
					'  vec3 bCol = mix(baseCol, terrainPaintSampleLayer(baseCol, uTerrainPaintLayerB, meshUv, groundUv, uTerrainPaintLayerBParamsA, uTerrainPaintLayerBParamsB), uTerrainPaintHasB);',
					'  vec3 aCol = mix(baseCol, terrainPaintSampleLayer(baseCol, uTerrainPaintLayerA, meshUv, groundUv, uTerrainPaintLayerAParamsA, uTerrainPaintLayerAParamsB), uTerrainPaintHasA);',
					'  float totalWeight = clamp(w.r + w.g + w.b + w.a, 0.0, 1.0);',
					'  float baseWeight = max(0.0, 1.0 - totalWeight);',
					'  diffuseColor.rgb = baseCol * baseWeight + rCol * w.r + gCol * w.g + bCol * w.b + aCol * w.a;',
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

function computeGroundBounds(definition: GroundDynamicMesh): THREE.Vector4 {
	const width = Math.max(1e-6, definition.width)
	const depth = Math.max(1e-6, definition.depth)
	return new THREE.Vector4(-width * 0.5, -depth * 0.5, width, depth)
}

function encodeTerrainPaintBlendMode(mode: TerrainPaintBlendMode | null | undefined): number {
	if (mode === 'multiply') {
		return 1
	}
	if (mode === 'screen') {
		return 2
	}
	if (mode === 'overlay') {
		return 3
	}
	return 0
}

function resolveTerrainPaintLayerByChannel(
	settings: TerrainPaintSettings | null | undefined,
	channel: TerrainPaintChannel,
): TerrainPaintLayerDefinition | null {
	const layers = Array.isArray(settings?.layers) ? settings.layers : []
	return layers.find((layer) => layer?.channel === channel) ?? null
}

function applyTerrainPaintLayerUniforms(
	state: TerrainPaintShaderState,
	channel: TerrainPaintChannel,
	layer: TerrainPaintLayerDefinition | null,
): void {
	const paramsA = state.layerParamsA[channel]
	const paramsB = state.layerParamsB[channel]
	if (!layer) {
		paramsA.set(1, 1, 0, 0)
		paramsB.set(0, 1, 1, 0)
		return
	}
	paramsA.set(layer.tileScale.x, layer.tileScale.y, layer.offset.x, layer.offset.y)
	paramsB.set((layer.rotationDeg * Math.PI) / 180, layer.opacity, layer.worldSpace ? 1 : 0, encodeTerrainPaintBlendMode(layer.blendMode))
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
				console.log('[terrainPaintPreview] onBeforeRender skipped: shader missing', {
					meshUuid: mesh.uuid,
					materialUuid: mat.uuid,
					chunkKey: resolveChunkKeyFromMesh(mesh),
				})
				return
			}
			const def = (root.userData as any).__terrainPaintDefinition as GroundDynamicMesh | undefined
			const currentSettings = (root.userData as any).__terrainPaintSettings as TerrainPaintSettings | null | undefined
			if (!def) {
				return
			}
			if (currentSettings && currentSettings.version !== 2) {
				// Unsupported settings version; disable preview by not enabling the shader uniforms below.
			}
			state.landformsBounds.copy(computeGroundBounds(def))
			const bounds = computeChunkBounds(def, mesh)
			if (bounds) {
				state.chunkBounds.copy(bounds)
			}
			const key = resolveChunkKeyFromMesh(mesh)
			const weightmap = key ? state.weightmaps.get(key) ?? state.defaultWeightmap : state.defaultWeightmap
			const landformsTexture = getLandformsPreviewTexture(root)
			applyTerrainPaintLayerUniforms(state, 'r', resolveTerrainPaintLayerByChannel(currentSettings, 'r'))
			applyTerrainPaintLayerUniforms(state, 'g', resolveTerrainPaintLayerByChannel(currentSettings, 'g'))
			applyTerrainPaintLayerUniforms(state, 'b', resolveTerrainPaintLayerByChannel(currentSettings, 'b'))
			applyTerrainPaintLayerUniforms(state, 'a', resolveTerrainPaintLayerByChannel(currentSettings, 'a'))
			state.shader.uniforms.uLandformsEnabled.value = landformsTexture ? 1 : 0
			state.shader.uniforms.uLandformsTexture.value = landformsTexture ?? state.defaultTransparent
			state.shader.uniforms.uLandformsBounds.value = state.landformsBounds
			state.shader.uniforms.uTerrainPaintEnabled.value = currentSettings && currentSettings.version === 2 ? 1 : 0
			state.shader.uniforms.uTerrainPaintWeightmap.value = weightmap
			state.shader.uniforms.uTerrainPaintChunkBounds.value = state.chunkBounds
			state.shader.uniforms.uTerrainPaintGroundBounds.value = state.landformsBounds
			state.shader.uniforms.uTerrainPaintLayerR.value = state.layerTextures.r ?? state.defaultWhite
			state.shader.uniforms.uTerrainPaintLayerG.value = state.layerTextures.g ?? state.defaultWhite
			state.shader.uniforms.uTerrainPaintLayerB.value = state.layerTextures.b ?? state.defaultWhite
			state.shader.uniforms.uTerrainPaintLayerA.value = state.layerTextures.a ?? state.defaultWhite
			state.shader.uniforms.uTerrainPaintLayerRParamsA.value = state.layerParamsA.r
			state.shader.uniforms.uTerrainPaintLayerGParamsA.value = state.layerParamsA.g
			state.shader.uniforms.uTerrainPaintLayerBParamsA.value = state.layerParamsA.b
			state.shader.uniforms.uTerrainPaintLayerAParamsA.value = state.layerParamsA.a
			state.shader.uniforms.uTerrainPaintLayerRParamsB.value = state.layerParamsB.r
			state.shader.uniforms.uTerrainPaintLayerGParamsB.value = state.layerParamsB.g
			state.shader.uniforms.uTerrainPaintLayerBParamsB.value = state.layerParamsB.b
			state.shader.uniforms.uTerrainPaintLayerAParamsB.value = state.layerParamsB.a
			state.shader.uniforms.uTerrainPaintHasR.value = state.layerTextures.r ? 1 : 0
			state.shader.uniforms.uTerrainPaintHasG.value = state.layerTextures.g ? 1 : 0
			state.shader.uniforms.uTerrainPaintHasB.value = state.layerTextures.b ? 1 : 0
			state.shader.uniforms.uTerrainPaintHasA.value = state.layerTextures.a ? 1 : 0
		}
	})

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
	channel: TerrainPaintChannel | number,
	texture: THREE.Texture | null,
): void {
	const state = getOrCreateShaderState(material)
	const normalizedChannel = typeof channel === 'number'
		? (['r', 'g', 'b', 'a'][Math.max(0, Math.min(3, Math.floor(channel) % 4))] as TerrainPaintChannel)
		: channel
	if (texture) {
		texture.wrapS = THREE.RepeatWrapping
		texture.wrapT = THREE.RepeatWrapping
		;(texture as any).colorSpace = (THREE as any).SRGBColorSpace ?? (texture as any).colorSpace
		texture.needsUpdate = true
		;(state.layerTextures as any)[normalizedChannel] = texture
		return
	}
	delete (state.layerTextures as any)[normalizedChannel]
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
			const logicalId = (chunkRef as any)?.pages?.[0]?.logicalId
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

export type SyncTerrainPaintPreviewOptions = {
	liveChunkPagesByKey?: Map<string, Uint8ClampedArray[]>
	previewRevision?: number
	includePersistedChunkWeightmaps?: boolean
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
	options: SyncTerrainPaintPreviewOptions = {},
): void {
	const settings: any = (dynamicMesh as any)?.terrainPaint ?? null
	const liveChunkPagesByKey = options.liveChunkPagesByKey
	const includePersistedChunkWeightmaps = options.includePersistedChunkWeightmaps !== false

	// Ensure per-mesh cloned materials and shader hooks
	cloneTerrainPaintPreviewMaterialsOnce(groundObject)
	ensureTerrainPaintPreviewInstalled(groundObject, dynamicMesh, settings)

	const { visibleChunkMaterials, visibleMaterials } = collectVisibleChunkMaterials(groundObject)
	if (!visibleMaterials.size) {
		return
	}
	const targets = Array.from(visibleMaterials)
	const token = getToken()
	const layers = Array.isArray(settings?.layers) ? settings.layers : []

	const layerR = (function () {
		const match = layers.find((layer: any) => layer?.channel === 'r')
		const candidate = typeof match?.textureAssetId === 'string' ? match.textureAssetId.trim() : ''
		return candidate.length ? candidate : null
	})()
	const layerG = (function () {
		const match = layers.find((layer: any) => layer?.channel === 'g')
		const candidate = typeof match?.textureAssetId === 'string' ? match.textureAssetId.trim() : ''
		return candidate.length ? candidate : null
	})()
	const layerB = (function () {
		const match = layers.find((layer: any) => layer?.channel === 'b')
		const candidate = typeof match?.textureAssetId === 'string' ? match.textureAssetId.trim() : ''
		return candidate.length ? candidate : null
	})()
	const layerA = (function () {
		const match = layers.find((layer: any) => layer?.channel === 'a')
		const candidate = typeof match?.textureAssetId === 'string' ? match.textureAssetId.trim() : ''
		return candidate.length ? candidate : null
	})()

	const layerPairs: Array<{ channel: 'r' | 'g' | 'b' | 'a'; assetId: string | null }> = [
		{ channel: 'r', assetId: layerR },
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

	const chunks = settings?.chunks && typeof settings.chunks === 'object' ? settings.chunks : {}
	if (!liveChunkPagesByKey?.size && (!includePersistedChunkWeightmaps || !Object.keys(chunks).length)) {
		return
	}

	for (const [chunkKey, chunkTargets] of visibleChunkMaterials) {
		const livePages = liveChunkPagesByKey?.get(chunkKey) ?? null
		const livePage0 = livePages?.[0] ?? null
		if (livePage0) {
			const weightmapResolution = Number.isFinite(settings?.weightmapResolution)
				? Math.max(1, Math.round(settings.weightmapResolution))
				: Math.max(1, Math.round(Math.sqrt(livePage0.length / 4)))
			const liveRefKey = `__live__:${options.previewRevision ?? 0}:${chunkKey}`
			terrainPaintChunkRefKeys.set(chunkKey, liveRefKey)
			chunkTargets.forEach((target) => {
				updateTerrainPaintPreviewWeightmap(target, chunkKey, livePage0, weightmapResolution)
			})
			continue
		}
		if (!includePersistedChunkWeightmaps) {
			terrainPaintChunkRefKeys.delete(chunkKey)
			chunkTargets.forEach((target) => {
				setTerrainPaintPreviewWeightmapTexture(target, chunkKey, null)
			})
			continue
		}
		const ref = (chunks as any)[chunkKey]
		const logicalId = typeof ref?.pages?.[0]?.logicalId === 'string' ? ref.pages[0].logicalId.trim() : ''
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

