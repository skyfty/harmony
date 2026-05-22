import * as THREE from 'three'
import type { GroundDynamicMesh } from '@schema/core'
import { GRID_MAJOR_SPACING } from './constants'
import { setBoundingBoxFromObject } from './sceneUtils'

const MAJOR_COLOR = '#7f8fa6'
const MAJOR_OPACITY = 0.6
const GRID_MAJOR_LINE_WIDTH_PX = 0.85
const GRID_ACCENT_SPACING = 10
const GRID_ACCENT_LINE_WIDTH_PX = 1.25
const GRID_ACCENT_COLOR = '#c7d2e0'
const GRID_ACCENT_OPACITY = 0.48
const TERRAIN_GRID_SHADER_KEY = 'harmony-terrain-grid-overlay-v3'
const MAJOR_COLOR_VALUE = new THREE.Color(MAJOR_COLOR)
const GRID_ACCENT_COLOR_VALUE = new THREE.Color(GRID_ACCENT_COLOR)

export type TerrainGridVisibleRange = {
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
}

type TerrainGridHelperOptions = {
  getGroundObject?: () => THREE.Object3D | null
}

type CompiledTerrainGridShader = {
  uniforms: Record<string, { value: any }>
  vertexShader: string
  fragmentShader: string
}

type TerrainGridMaterialState = {
  installed: boolean
  shader: CompiledTerrainGridShader | null
  enabled: boolean
  bounds: THREE.Vector4
  originalOnBeforeCompile: THREE.MeshStandardMaterial['onBeforeCompile']
  originalCustomProgramCacheKey?: THREE.MeshStandardMaterial['customProgramCacheKey']
}

function forEachGroundMaterial(root: THREE.Object3D, visitor: (material: THREE.MeshStandardMaterial) => void): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    const { material } = mesh
    if (Array.isArray(material)) {
      material.forEach((entry) => {
        if (entry instanceof THREE.MeshStandardMaterial) {
          visitor(entry)
        }
      })
      return
    }
    if (material instanceof THREE.MeshStandardMaterial) {
      visitor(material)
    }
  })
}

function updateTerrainGridShaderUniforms(
  state: TerrainGridMaterialState,
): void {
  const shader = state.shader
  if (!shader) {
    return
  }
  const enabledUniform = shader.uniforms.uHarmonyTerrainGridEnabled
  const boundsUniform = shader.uniforms.uHarmonyTerrainGridBounds
  const majorSpacingUniform = shader.uniforms.uHarmonyTerrainGridMajorSpacing
  const majorWidthUniform = shader.uniforms.uHarmonyTerrainGridMajorWidthPx
  const majorColorUniform = shader.uniforms.uHarmonyTerrainGridMajorColor
  const majorOpacityUniform = shader.uniforms.uHarmonyTerrainGridMajorOpacity
  const accentSpacingUniform = shader.uniforms.uHarmonyTerrainGridAccentSpacing
  const accentWidthUniform = shader.uniforms.uHarmonyTerrainGridAccentWidthPx
  const accentColorUniform = shader.uniforms.uHarmonyTerrainGridAccentColor
  const accentOpacityUniform = shader.uniforms.uHarmonyTerrainGridAccentOpacity
  if (
    !enabledUniform
    || !boundsUniform
    || !majorSpacingUniform
    || !majorWidthUniform
    || !majorColorUniform
    || !majorOpacityUniform
    || !accentSpacingUniform
    || !accentWidthUniform
    || !accentColorUniform
    || !accentOpacityUniform
  ) {
    return
  }
  enabledUniform.value = state.enabled ? 1 : 0
  boundsUniform.value.copy(state.bounds)
  majorSpacingUniform.value = GRID_MAJOR_SPACING
  majorWidthUniform.value = GRID_MAJOR_LINE_WIDTH_PX
  majorColorUniform.value.copy(MAJOR_COLOR_VALUE)
  majorOpacityUniform.value = MAJOR_OPACITY
  accentSpacingUniform.value = GRID_ACCENT_SPACING
  accentWidthUniform.value = GRID_ACCENT_LINE_WIDTH_PX
  accentColorUniform.value.copy(GRID_ACCENT_COLOR_VALUE)
  accentOpacityUniform.value = GRID_ACCENT_OPACITY
}

function installTerrainGridShaderHooks(
  material: THREE.MeshStandardMaterial,
  state: TerrainGridMaterialState,
): void {
  if (state.installed) {
    updateTerrainGridShaderUniforms(state)
    return
  }

  material.customProgramCacheKey = () => {
    const originalKey = state.originalCustomProgramCacheKey?.call(material) ?? ''
    return `${originalKey}|${TERRAIN_GRID_SHADER_KEY}`
  }

  material.onBeforeCompile = (shader, renderer) => {
    state.originalOnBeforeCompile?.call(material, shader, renderer)
    state.shader = shader
    shader.uniforms.uHarmonyTerrainGridEnabled = { value: state.enabled ? 1 : 0 }
    shader.uniforms.uHarmonyTerrainGridBounds = { value: state.bounds.clone() }
    shader.uniforms.uHarmonyTerrainGridMajorSpacing = { value: GRID_MAJOR_SPACING }
    shader.uniforms.uHarmonyTerrainGridMajorWidthPx = { value: GRID_MAJOR_LINE_WIDTH_PX }
    shader.uniforms.uHarmonyTerrainGridMajorColor = { value: MAJOR_COLOR_VALUE.clone() }
    shader.uniforms.uHarmonyTerrainGridMajorOpacity = { value: MAJOR_OPACITY }
    shader.uniforms.uHarmonyTerrainGridAccentSpacing = { value: GRID_ACCENT_SPACING }
    shader.uniforms.uHarmonyTerrainGridAccentWidthPx = { value: GRID_ACCENT_LINE_WIDTH_PX }
    shader.uniforms.uHarmonyTerrainGridAccentColor = { value: GRID_ACCENT_COLOR_VALUE.clone() }
    shader.uniforms.uHarmonyTerrainGridAccentOpacity = { value: GRID_ACCENT_OPACITY }
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        'varying vec2 vHarmonyTerrainGridWorldXZ;\nvoid main() {',
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'vec4 harmonyGridWorldPosition = vec4(transformed, 1.0);',
          '#ifdef USE_BATCHING',
          '  harmonyGridWorldPosition = batchingMatrix * harmonyGridWorldPosition;',
          '#endif',
          '#ifdef USE_INSTANCING',
          '  harmonyGridWorldPosition = instanceMatrix * harmonyGridWorldPosition;',
          '#endif',
          'harmonyGridWorldPosition = modelMatrix * harmonyGridWorldPosition;',
          'vHarmonyTerrainGridWorldXZ = harmonyGridWorldPosition.xz;',
        ].join('\n'),
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        [
          'uniform float uHarmonyTerrainGridEnabled;',
          'uniform vec4 uHarmonyTerrainGridBounds;',
          'uniform float uHarmonyTerrainGridMajorSpacing;',
          'uniform float uHarmonyTerrainGridMajorWidthPx;',
          'uniform vec3 uHarmonyTerrainGridMajorColor;',
          'uniform float uHarmonyTerrainGridMajorOpacity;',
          'uniform float uHarmonyTerrainGridAccentSpacing;',
          'uniform float uHarmonyTerrainGridAccentWidthPx;',
          'uniform vec3 uHarmonyTerrainGridAccentColor;',
          'uniform float uHarmonyTerrainGridAccentOpacity;',
          'varying vec2 vHarmonyTerrainGridWorldXZ;',
          'float harmonyGridLineFactor(vec2 worldXZ, float spacing, float widthPx) {',
          '  vec2 grid = worldXZ / max(spacing, 1e-5);',
          '  vec2 deriv = max(fwidth(grid), vec2(1e-4));',
          '  vec2 dist = abs(fract(grid - 0.5) - 0.5) / deriv;',
          '  float minDist = min(dist.x, dist.y);',
          '  return 1.0 - min(minDist / max(widthPx, 0.25), 1.0);',
          '}',
          'float harmonyGridVisibilityScale(vec2 worldXZ) {',
          '  vec2 worldDeriv = max(fwidth(worldXZ), vec2(1e-4));',
          '  float pixelsPerMeter = 1.0 / max(max(worldDeriv.x, worldDeriv.y), 1e-5);',
          '  return smoothstep(2.5, 5.5, pixelsPerMeter);',
          '}',
          'void main() {',
        ].join('\n'),
      )
      .replace(
        '#include <map_fragment>',
        [
          '#include <map_fragment>',
          'if (uHarmonyTerrainGridEnabled > 0.5) {',
          '  vec2 harmonyGridSize = max(uHarmonyTerrainGridBounds.zw, vec2(1e-5));',
          '  vec2 harmonyGridLocal = vHarmonyTerrainGridWorldXZ - uHarmonyTerrainGridBounds.xy;',
          '  bool harmonyGridInside = harmonyGridLocal.x >= 0.0 && harmonyGridLocal.x <= harmonyGridSize.x && harmonyGridLocal.y >= 0.0 && harmonyGridLocal.y <= harmonyGridSize.y;',
          '  if (harmonyGridInside) {',
          '    float harmonyMajorLine = harmonyGridLineFactor(vHarmonyTerrainGridWorldXZ, uHarmonyTerrainGridMajorSpacing, uHarmonyTerrainGridMajorWidthPx);',
          '    float harmonyAccentLine = harmonyGridLineFactor(vHarmonyTerrainGridWorldXZ, uHarmonyTerrainGridAccentSpacing, uHarmonyTerrainGridAccentWidthPx);',
          '    float harmonyMinorVisibility = harmonyGridVisibilityScale(vHarmonyTerrainGridWorldXZ);',
          '    float harmonyMajorAlpha = clamp(harmonyMajorLine * uHarmonyTerrainGridMajorOpacity * harmonyMinorVisibility, 0.0, 1.0);',
          '    float harmonyAccentAlpha = clamp(harmonyAccentLine * uHarmonyTerrainGridAccentOpacity, 0.0, 1.0);',
          '    float harmonyGridAlpha = max(harmonyMajorAlpha, harmonyAccentAlpha);',
          '    if (harmonyGridAlpha > 1e-4) {',
          '      vec3 harmonyGridColor = mix(uHarmonyTerrainGridMajorColor, uHarmonyTerrainGridAccentColor, step(harmonyMajorAlpha, harmonyAccentAlpha));',
          '      diffuseColor.rgb = mix(diffuseColor.rgb, harmonyGridColor, harmonyGridAlpha);',
          '    }',
          '  }',
          '}',
        ].join('\n'),
      )
    updateTerrainGridShaderUniforms(state)
  }

  state.installed = true
  material.needsUpdate = true
}

export class TerrainGridHelper extends THREE.Object3D {
  private readonly getGroundObject: () => THREE.Object3D | null
  private readonly materialStates = new Map<THREE.MeshStandardMaterial, TerrainGridMaterialState>()
  private readonly currentMaterials = new Set<THREE.MeshStandardMaterial>()
  private readonly bounds = new THREE.Vector4(-0.5, -0.5, 1, 1)
  private readonly worldBoundsHelper = new THREE.Box3()
  private overlayVisible = true
  private currentDefinition: GroundDynamicMesh | null = null

  constructor(options: TerrainGridHelperOptions = {}) {
    super()
    this.name = 'TerrainGridHelper'
    this.getGroundObject = options.getGroundObject ?? (() => null)
  }

  getLastHeightRange(): { min: number; max: number } | null {
    return null
  }

  setOverlayVisible(visible: boolean): void {
    if (this.overlayVisible === visible) {
      return
    }
    this.overlayVisible = visible
    this.syncOverlay()
  }

  update(definition: GroundDynamicMesh | null, _nextSignature: string | null, _visibleRange?: TerrainGridVisibleRange | null): void {
    this.currentDefinition = definition
    this.syncOverlay()
  }

  dispose(): void {
    this.currentDefinition = null
    this.disableAllMaterials()
    this.materialStates.clear()
    this.currentMaterials.clear()
  }

  private syncOverlay(): void {
    const definition = this.currentDefinition
    if (!definition || !this.overlayVisible) {
      this.disableAllMaterials()
      return
    }

    const root = this.getGroundObject()
    if (!root) {
      this.disableAllMaterials()
      return
    }

    root.updateWorldMatrix(true, true)
    setBoundingBoxFromObject(root, this.worldBoundsHelper)
    if (this.worldBoundsHelper.isEmpty()) {
      this.disableAllMaterials()
      return
    }

    const min = this.worldBoundsHelper.min
    const max = this.worldBoundsHelper.max
    const width = Math.max(Math.abs(max.x - min.x), 1e-5)
    const depth = Math.max(Math.abs(max.z - min.z), 1e-5)
    this.bounds.set(min.x, min.z, width, depth)

    const nextMaterials = new Set<THREE.MeshStandardMaterial>()
    forEachGroundMaterial(root, (material) => {
      nextMaterials.add(material)
      const state = this.materialStates.get(material) ?? {
        installed: false,
        shader: null,
        enabled: true,
        bounds: this.bounds.clone(),
        originalOnBeforeCompile: material.onBeforeCompile,
        originalCustomProgramCacheKey: material.customProgramCacheKey,
      }
      state.enabled = true
      state.bounds.copy(this.bounds)
      this.materialStates.set(material, state)
      installTerrainGridShaderHooks(material, state)
      updateTerrainGridShaderUniforms(state)
    })

    for (const material of this.currentMaterials) {
      if (nextMaterials.has(material)) {
        continue
      }
      const state = this.materialStates.get(material)
      if (!state) {
        continue
      }
      state.enabled = false
      updateTerrainGridShaderUniforms(state)
    }

    this.currentMaterials.clear()
    nextMaterials.forEach((material) => {
      this.currentMaterials.add(material)
    })
  }

  private disableAllMaterials(): void {
    for (const material of this.currentMaterials) {
      const state = this.materialStates.get(material)
      if (!state) {
        continue
      }
      state.enabled = false
      updateTerrainGridShaderUniforms(state)
    }
    this.currentMaterials.clear()
  }
}
