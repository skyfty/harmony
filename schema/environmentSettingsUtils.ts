import type { EnvironmentSettings, SceneJsonExportDocument, SceneNode } from './index'

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

export const DEFAULT_ENVIRONMENT_BACKGROUND_COLOR = '#516175'
export const DEFAULT_ENVIRONMENT_AMBIENT_COLOR = '#ffffff'
export const DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY = 0.75
export const DEFAULT_ENVIRONMENT_FOG_COLOR = '#516175'
export const DEFAULT_ENVIRONMENT_FOG_DENSITY = 0.02
export const DEFAULT_ENVIRONMENT_FOG_NEAR = 1
export const DEFAULT_ENVIRONMENT_FOG_FAR = 50
export const DEFAULT_ENVIRONMENT_GRAVITY = 9.81
export const DEFAULT_ENVIRONMENT_RESTITUTION = 0.2
export const DEFAULT_ENVIRONMENT_FRICTION = 0.3
export const DEFAULT_ENVIRONMENT_ORIENTATION_PRESET = 'yUp' as const
export const DEFAULT_ENVIRONMENT_ROTATION_DEGREES = { x: 0, y: 0, z: 0 }

export const DEFAULT_ENVIRONMENT_GRADIENT_OFFSET = 33
export const DEFAULT_ENVIRONMENT_GRADIENT_EXPONENT = 0.6

export const DEFAULT_ENVIRONMENT_SETTINGS: EnvironmentSettings = {
  background: {
    mode: 'skybox',
    solidColor: DEFAULT_ENVIRONMENT_BACKGROUND_COLOR,
    gradientTopColor: null,
    gradientOffset: DEFAULT_ENVIRONMENT_GRADIENT_OFFSET,
    gradientExponent: DEFAULT_ENVIRONMENT_GRADIENT_EXPONENT,
    hdriAssetId: null,
    skycubeFormat: 'faces',
    skycubeZipAssetId: null,
    positiveXAssetId: null,
    negativeXAssetId: null,
    positiveYAssetId: null,
    negativeYAssetId: null,
    positiveZAssetId: null,
    negativeZAssetId: null,
  },
  environmentOrientationPreset: DEFAULT_ENVIRONMENT_ORIENTATION_PRESET,
  environmentRotationDegrees: { ...DEFAULT_ENVIRONMENT_ROTATION_DEGREES },
  ambientLightColor: DEFAULT_ENVIRONMENT_AMBIENT_COLOR,
  ambientLightIntensity: DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY,
  fogMode: 'none',
  fogColor: DEFAULT_ENVIRONMENT_FOG_COLOR,
  fogDensity: DEFAULT_ENVIRONMENT_FOG_DENSITY,
  fogNear: DEFAULT_ENVIRONMENT_FOG_NEAR,
  fogFar: DEFAULT_ENVIRONMENT_FOG_FAR,
  gravityStrength: DEFAULT_ENVIRONMENT_GRAVITY,
  collisionRestitution: DEFAULT_ENVIRONMENT_RESTITUTION,
  collisionFriction: DEFAULT_ENVIRONMENT_FRICTION,
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const sanitized = value.trim()
    if (HEX_COLOR_PATTERN.test(sanitized)) {
      return `#${sanitized.slice(1).toLowerCase()}`
    }
  }
  return fallback
}

function normalizeNullableHexColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const sanitized = value.trim()
  if (!sanitized.length) {
    return null
  }
  if (HEX_COLOR_PATTERN.test(sanitized)) {
    return `#${sanitized.slice(1).toLowerCase()}`
  }
  return null
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  if (numeric < min) {
    return min
  }
  if (numeric > max) {
    return max
  }
  return numeric
}

function normalizeAssetId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function cloneEnvironmentSettings(
  source?: Partial<EnvironmentSettings> | EnvironmentSettings | null,
): EnvironmentSettings {
  const normalizedSource = source ?? DEFAULT_ENVIRONMENT_SETTINGS
  const backgroundSource = normalizedSource.background ?? null

  const normalizeSkycubeFormat = (value: unknown) => (value === 'zip' ? 'zip' : 'faces')

  const normalizeOrientationPreset = (value: unknown) => {
    if (value === 'yUp' || value === 'zUp' || value === 'xUp' || value === 'custom') {
      return value as EnvironmentSettings['environmentOrientationPreset']
    }
    return DEFAULT_ENVIRONMENT_ORIENTATION_PRESET
  }

  const resolvePresetRotationDegrees = (preset: EnvironmentSettings['environmentOrientationPreset']) => {
    if (preset === 'zUp') {
      return { x: -90, y: 0, z: 0 }
    }
    if (preset === 'xUp') {
      return { x: 0, y: 0, z: 90 }
    }
    return { ...DEFAULT_ENVIRONMENT_ROTATION_DEGREES }
  }

  let backgroundMode: EnvironmentSettings['background']['mode'] = 'skybox'
  if (backgroundSource?.mode === 'hdri') {
    backgroundMode = 'hdri'
  } else if (backgroundSource?.mode === 'skycube') {
    backgroundMode = 'skycube'
  } else if (backgroundSource?.mode === 'solidColor') {
    backgroundMode = 'solidColor'
  }

  let fogMode: EnvironmentSettings['fogMode'] = 'none'
  if (normalizedSource.fogMode === 'linear') {
    fogMode = 'linear'
  } else if (normalizedSource.fogMode === 'exp') {
    fogMode = 'exp'
  }

  const fogNear = clampNumber(normalizedSource.fogNear, 0, 100000, DEFAULT_ENVIRONMENT_FOG_NEAR)
  const fogFar = clampNumber(normalizedSource.fogFar, 0, 100000, DEFAULT_ENVIRONMENT_FOG_FAR)
  const normalizedFogFar = fogFar > fogNear ? fogFar : fogNear + 0.001

  const preset = normalizeOrientationPreset((normalizedSource as any)?.environmentOrientationPreset)
  const presetRotation = resolvePresetRotationDegrees(preset)
  const rotationSource = (normalizedSource as any)?.environmentRotationDegrees ?? null
  const environmentRotationDegrees = {
    x: clampNumber(rotationSource?.x, -360, 360, presetRotation.x),
    y: clampNumber(rotationSource?.y, -360, 360, presetRotation.y),
    z: clampNumber(rotationSource?.z, -360, 360, presetRotation.z),
  }

  return {
    background: {
      mode: backgroundMode,
      solidColor: normalizeHexColor(backgroundSource?.solidColor, DEFAULT_ENVIRONMENT_BACKGROUND_COLOR),
      gradientTopColor:
        backgroundMode === 'solidColor'
          ? normalizeNullableHexColor((backgroundSource as any)?.gradientTopColor ?? null)
          : null,
      gradientOffset:
        backgroundMode === 'solidColor'
          ? clampNumber((backgroundSource as any)?.gradientOffset, 0, 100000, DEFAULT_ENVIRONMENT_GRADIENT_OFFSET)
          : DEFAULT_ENVIRONMENT_GRADIENT_OFFSET,
      gradientExponent:
        backgroundMode === 'solidColor'
          ? clampNumber((backgroundSource as any)?.gradientExponent, 0, 10, DEFAULT_ENVIRONMENT_GRADIENT_EXPONENT)
          : DEFAULT_ENVIRONMENT_GRADIENT_EXPONENT,
      hdriAssetId: normalizeAssetId(backgroundSource?.hdriAssetId ?? null),
      skycubeFormat: normalizeSkycubeFormat((backgroundSource as any)?.skycubeFormat),
      skycubeZipAssetId:
        backgroundMode === 'skycube'
          ? normalizeAssetId((backgroundSource as any)?.skycubeZipAssetId ?? null)
          : null,
      positiveXAssetId:
        backgroundMode === 'skycube'
          ? normalizeAssetId((backgroundSource as any)?.positiveXAssetId ?? null)
          : null,
      negativeXAssetId:
        backgroundMode === 'skycube'
          ? normalizeAssetId((backgroundSource as any)?.negativeXAssetId ?? null)
          : null,
      positiveYAssetId:
        backgroundMode === 'skycube'
          ? normalizeAssetId((backgroundSource as any)?.positiveYAssetId ?? null)
          : null,
      negativeYAssetId:
        backgroundMode === 'skycube'
          ? normalizeAssetId((backgroundSource as any)?.negativeYAssetId ?? null)
          : null,
      positiveZAssetId:
        backgroundMode === 'skycube'
          ? normalizeAssetId((backgroundSource as any)?.positiveZAssetId ?? null)
          : null,
      negativeZAssetId:
        backgroundMode === 'skycube'
          ? normalizeAssetId((backgroundSource as any)?.negativeZAssetId ?? null)
          : null,
    },
    environmentOrientationPreset: preset,
    environmentRotationDegrees,
    ambientLightColor: normalizeHexColor(normalizedSource.ambientLightColor, DEFAULT_ENVIRONMENT_AMBIENT_COLOR),
    ambientLightIntensity: clampNumber(
      normalizedSource.ambientLightIntensity,
      0,
      10,
      DEFAULT_ENVIRONMENT_AMBIENT_INTENSITY,
    ),
    fogMode,
    fogColor: normalizeHexColor(normalizedSource.fogColor, DEFAULT_ENVIRONMENT_FOG_COLOR),
    fogDensity: clampNumber(normalizedSource.fogDensity, 0, 5, DEFAULT_ENVIRONMENT_FOG_DENSITY),
    fogNear,
    fogFar: normalizedFogFar,
    gravityStrength: clampNumber(normalizedSource.gravityStrength, 0, 100, DEFAULT_ENVIRONMENT_GRAVITY),
    collisionRestitution: clampNumber(
      normalizedSource.collisionRestitution,
      0,
      1,
      DEFAULT_ENVIRONMENT_RESTITUTION,
    ),
    collisionFriction: clampNumber(
      normalizedSource.collisionFriction,
      0,
      1,
      DEFAULT_ENVIRONMENT_FRICTION,
    ),
  }
}

export function extractEnvironmentSettingsFromNodes(
  nodes: SceneNode[] | null | undefined,
): EnvironmentSettings | null {
  if (!Array.isArray(nodes) || !nodes.length) {
    return null
  }

  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }

    if (node.id === 'harmony:environment' || node.nodeType === 'Environment') {
      const payload = isPlainRecord(node.userData)
        ? ((node.userData as Record<string, unknown>).environment as
            | EnvironmentSettings
            | Partial<EnvironmentSettings>
            | null
            | undefined)
        : null
      return cloneEnvironmentSettings(payload ?? DEFAULT_ENVIRONMENT_SETTINGS)
    }

    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
  }

  return null
}

export function resolveDocumentEnvironment(
  document: SceneJsonExportDocument | null | undefined,
): EnvironmentSettings {
  if (!document) {
    return cloneEnvironmentSettings(DEFAULT_ENVIRONMENT_SETTINGS)
  }

  const payload = (document as SceneJsonExportDocument & {
    environment?: Partial<EnvironmentSettings> | EnvironmentSettings | null
  }).environment

  if (payload) {
    return cloneEnvironmentSettings(payload)
  }

  const derived = extractEnvironmentSettingsFromNodes(document.nodes)
  if (derived) {
    return derived
  }

  return cloneEnvironmentSettings(DEFAULT_ENVIRONMENT_SETTINGS)
}
