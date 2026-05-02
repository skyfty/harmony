import * as THREE from 'three'
import type { GroundDynamicMesh } from '@schema'
import { resolveGroundWorldBounds } from '@schema'
import { GRID_MAJOR_SPACING } from './constants'

const MAJOR_COLOR = '#ffc107'
const MAJOR_OPACITY = 1.3
const GRID_MAJOR_LINE_WIDTH_PX = 0.85
const TERRAIN_GRID_SHADER_KEY = 'harmony-terrain-grid-overlay-v2'
const MAJOR_COLOR_VALUE = new THREE.Color(MAJOR_COLOR)

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
  if (
    !enabledUniform
    || !boundsUniform
    || !majorSpacingUniform
    || !majorWidthUniform
    || !majorColorUniform
    || !majorOpacityUniform
  ) {
    return
  }
  enabledUniform.value = state.enabled ? 1 : 0
  boundsUniform.value.copy(state.bounds)
  majorSpacingUniform.value = GRID_MAJOR_SPACING
  majorWidthUniform.value = GRID_MAJOR_LINE_WIDTH_PX
  majorColorUniform.value.copy(MAJOR_COLOR_VALUE)
  majorOpacityUniform.value = MAJOR_OPACITY
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
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        'varying vec2 vHarmonyTerrainGridLocalXZ;\nvoid main() {',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\tvHarmonyTerrainGridLocalXZ = position.xz;',
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
          'varying vec2 vHarmonyTerrainGridLocalXZ;',
          'float harmonyGridLineFactor(vec2 localXZ, float spacing, float widthPx) {',
          '  vec2 grid = localXZ / max(spacing, 1e-5);',
          '  vec2 deriv = max(fwidth(grid), vec2(1e-4));',
          '  vec2 dist = abs(fract(grid - 0.5) - 0.5) / deriv;',
          '  float minDist = min(dist.x, dist.y);',
          '  return 1.0 - min(minDist / max(widthPx, 0.25), 1.0);',
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
          '  vec2 harmonyGridLocal = vHarmonyTerrainGridLocalXZ - uHarmonyTerrainGridBounds.xy;',
          '  bool harmonyGridInside = harmonyGridLocal.x >= 0.0 && harmonyGridLocal.x <= harmonyGridSize.x && harmonyGridLocal.y >= 0.0 && harmonyGridLocal.y <= harmonyGridSize.y;',
          '  if (harmonyGridInside) {',
          '    float harmonyMajorLine = harmonyGridLineFactor(harmonyGridLocal, uHarmonyTerrainGridMajorSpacing, uHarmonyTerrainGridMajorWidthPx);',
          '    float harmonyMajorAlpha = clamp(harmonyMajorLine * uHarmonyTerrainGridMajorOpacity, 0.0, 1.0);',
          '    float harmonyGridAlpha = harmonyMajorAlpha;',
          '    if (harmonyGridAlpha > 1e-4) {',
          '      vec3 harmonyGridColor = uHarmonyTerrainGridMajorColor;',
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

    const bounds = resolveGroundWorldBounds(definition)
    const width = Math.max(Math.abs(bounds.maxX - bounds.minX), 1e-5)
    const depth = Math.max(Math.abs(bounds.maxZ - bounds.minZ), 1e-5)
    this.bounds.set(bounds.minX, bounds.minZ, width, depth)

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
