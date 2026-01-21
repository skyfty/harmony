import * as THREE from 'three'
import type { GroundDynamicMesh, TerrainPaintChannel, TerrainPaintSettings } from '@harmony/schema'

const TERRAIN_PAINT_MATERIAL_KEY = '__harmonyTerrainPaintMaterialV1'

type TerrainPaintShaderState = {
	shader: any
	chunkBounds: THREE.Vector4
	layerTextures: Partial<Record<TerrainPaintChannel, THREE.Texture>>
	weightmaps: Map<string, THREE.DataTexture>
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
					'  vec4 w = texture2D(uTerrainPaintWeightmap, wmUv);',
					'  vec3 baseCol = diffuseColor.rgb;',
					'  vec3 gCol = mix(baseCol, texture2D(uTerrainPaintLayerG, vUv).rgb, uTerrainPaintHasG);',
					'  vec3 bCol = mix(baseCol, texture2D(uTerrainPaintLayerB, vUv).rgb, uTerrainPaintHasB);',
					'  vec3 aCol = mix(baseCol, texture2D(uTerrainPaintLayerA, vUv).rgb, uTerrainPaintHasA);',
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

	let targetMaterial: THREE.MeshStandardMaterial | null = null
	root.traverse((obj) => {
		if (targetMaterial) {
			return
		}
		const mesh = obj as THREE.Mesh
		if (!mesh?.isMesh) {
			return
		}
		const material = mesh.material
		const resolved = Array.isArray(material) ? (material[0] as THREE.Material | undefined) : (material as THREE.Material | undefined)
		if (resolved && resolved instanceof THREE.MeshStandardMaterial) {
			targetMaterial = resolved
		}
	})
	if (!targetMaterial) {
		return
	}

	const state = installShaderHooks(targetMaterial)
	// Cache back to root so new chunks reuse the patched material.
	;(root.userData as any).groundMaterial = targetMaterial

	// Install per-mesh uniform binding.
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
			if (!state.shader) {
				return
			}
			if (!(mat instanceof THREE.MeshStandardMaterial)) {
				return
			}
			const def = (root.userData as any).__terrainPaintDefinition as GroundDynamicMesh | undefined
			const currentSettings = (root.userData as any).__terrainPaintSettings as TerrainPaintSettings | null | undefined
			if (!def) {
				return
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
	let texture = state.weightmaps.get(chunkKey) ?? null
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
		// Base is the material itself.
		return
	}
	if (texture) {
		texture.wrapS = THREE.RepeatWrapping
		texture.wrapT = THREE.RepeatWrapping
		texture.needsUpdate = true
		state.layerTextures[channel] = texture
		return
	}
	delete state.layerTextures[channel]
}
