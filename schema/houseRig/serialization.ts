import type { SceneNode, SceneNodeMaterial } from '../core'
import { stableSerialize } from '../stableSerialize'
import { normalizeHouseRigPartBinding } from './naming'
import {
  HOUSE_RIG_DEFAULT_SCRIPT_ID,
  HOUSE_RIG_DEFAULT_SCRIPT_VERSION,
  HOUSE_RIG_SCHEMA_VERSION,
  type HouseRigComponentProps,
  type HouseRigDimensions,
  type HouseRigPartBinding,
} from './types'

function readDimension(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback
}

function normalizeDimensions(
  value: Partial<HouseRigDimensions> | null | undefined,
): HouseRigDimensions {
  return {
    width: readDimension(value?.width),
    depth: readDimension(value?.depth),
    wallHeight: readDimension(value?.wallHeight),
  }
}

export function houseRigDimensionsAreInitialized(
  dimensions: HouseRigDimensions | null | undefined,
): boolean {
  return Boolean(
    dimensions
    && dimensions.width > 1e-4
    && dimensions.depth > 1e-4
    && dimensions.wallHeight > 1e-4,
  )
}

export function normalizeHouseRigComponentProps(
  raw: Partial<HouseRigComponentProps> & Record<string, unknown>,
  node?: SceneNode | null,
): HouseRigComponentProps {
  const legacyParameters = raw.parameters && typeof raw.parameters === 'object'
    ? (raw.parameters as Partial<HouseRigDimensions>)
    : null
  const rawRest = raw.restDimensions && typeof raw.restDimensions === 'object'
    ? (raw.restDimensions as Partial<HouseRigDimensions>)
    : null
  const rawDimensions = raw.dimensions && typeof raw.dimensions === 'object'
    ? (raw.dimensions as Partial<HouseRigDimensions>)
    : legacyParameters
  const rawParts = Array.isArray(raw.parts)
    ? raw.parts
    : Array.isArray(raw.partBindings)
      ? raw.partBindings
      : []
  const parts: HouseRigPartBinding[] = rawParts.map((part) => {
    const record = part as Partial<HouseRigPartBinding> & Record<string, unknown>
    return normalizeHouseRigPartBinding(
      record,
      typeof record?.meshName === 'string' ? record.meshName : '',
    )
  })
  const migratedFromPrototype =
    raw.migratedFromPrototype === true
    || Boolean(raw.graph || raw.compiled || raw.compiledArtifact || raw.partBindings)
  const sourceAssetId = typeof node?.sourceAssetId === 'string' && node.sourceAssetId.trim()
    ? node.sourceAssetId.trim()
    : null
  return {
    schemaVersion: HOUSE_RIG_SCHEMA_VERSION,
    scriptId: typeof raw.scriptId === 'string' && raw.scriptId.trim()
      ? raw.scriptId.trim()
      : HOUSE_RIG_DEFAULT_SCRIPT_ID,
    scriptVersion: typeof raw.scriptVersion === 'string' && raw.scriptVersion.trim()
      ? raw.scriptVersion.trim()
      : HOUSE_RIG_DEFAULT_SCRIPT_VERSION,
    assetId: typeof raw.assetId === 'string' && raw.assetId.trim()
      ? raw.assetId.trim()
      : sourceAssetId,
    topologyHash: typeof raw.topologyHash === 'string' && raw.topologyHash.trim()
      ? raw.topologyHash.trim()
      : typeof raw.rigHash === 'string' && raw.rigHash.trim()
        ? raw.rigHash.trim()
        : null,
    restDimensions: normalizeDimensions(rawRest),
    dimensions: normalizeDimensions(rawDimensions),
    parts,
    ...(migratedFromPrototype ? { migratedFromPrototype: true } : {}),
  }
}

export function cloneHouseRigPartMaterial(
  material: SceneNodeMaterial | null | undefined,
): SceneNodeMaterial | null {
  if (!material) {
    return null
  }
  return {
    ...material,
    textures: Object.fromEntries(
      Object.entries(material.textures ?? {}).map(([key, value]) => [
        key,
        value
          ? {
              ...value,
              settings: value.settings ? JSON.parse(JSON.stringify(value.settings)) : undefined,
            }
          : null,
      ]),
    ),
  }
}

export function computeHouseRigMaterialSignature(
  props: Partial<HouseRigComponentProps> | null | undefined,
): string {
  const parts = Array.isArray(props?.parts) ? props.parts : []
  return stableSerialize(parts.map((part) => {
    const materialSignature = part.material ? { ...part.material } : null
    if (materialSignature) {
      delete (materialSignature as { thumbnail?: string | null }).thumbnail
    }
    return {
      key: part.key,
      material: materialSignature,
    }
  }))
}
