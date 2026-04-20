import * as THREE from 'three';
import type { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import type {
  SceneMaterial,
  SceneMaterialProps,
  SceneMaterialTextureRef,
  SceneMaterialTextureSettings,
  SceneMaterialTextureSlot,
  SceneMaterialTextureSlotMap,
  SceneMaterialType,
  SceneNodeMaterial,
  SceneResourceSummaryEntry,
} from './index';
import type { AssetCacheEntry } from './assetCache';
import type ResourceCache from './ResourceCache';
import { inferAssetTypeOrNull } from './assetTypeConversion';
import { hashString, stableSerialize } from './stableSerialize';
import { getDefaultUvDebugTexture } from './debugTextures';

type RGBELoaderClass = new (manager?: THREE.LoadingManager) => RGBELoader;
let rgbeLoaderClassPromise: Promise<RGBELoaderClass> | null = null;

async function createRgbELoader(manager?: THREE.LoadingManager): Promise<RGBELoader> {
  if (!rgbeLoaderClassPromise) {
    rgbeLoaderClassPromise = import('three/examples/jsm/loaders/RGBELoader.js').then(
      (module) => module.RGBELoader as RGBELoaderClass,
    );
  }
  const LoaderClass = await rgbeLoaderClassPromise;
  return new LoaderClass(manager).setDataType(THREE.FloatType);
}

export interface SceneMaterialFactoryOptions {
  provider: ResourceCache;
  resources: SceneResourceSummaryEntry[];
  loadingManager?: THREE.LoadingManager;
  textureLoader?: THREE.TextureLoader;
  hdrLoader?: RGBELoader;
  warn?: (message: string) => void;
}

export type MeshStandardTextureKey =
  | 'map'
  | 'envMap'
  | 'normalMap'
  | 'metalnessMap'
  | 'roughnessMap'
  | 'aoMap'
  | 'emissiveMap'
  | 'displacementMap'

export const STANDARD_TEXTURE_KEYS: MeshStandardTextureKey[] = [
  'map',
  'envMap',
  'normalMap',
  'metalnessMap',
  'roughnessMap',
  'aoMap',
  'emissiveMap',
  'displacementMap',
];

export function disposeMaterialTextures(material: THREE.Material | null | undefined): void {
  if (!material) {
    return;
  }
  disposeMaterialOverrides(material);
  const standard = material as THREE.MeshStandardMaterial &
    Partial<Record<MeshStandardTextureKey, THREE.Texture | null>>;
  const materialRecord = standard as unknown as Record<string, unknown>;
  STANDARD_TEXTURE_KEYS.forEach((key) => {
    const texture = standard[key];
    if (texture && typeof texture.dispose === 'function') {
      texture.dispose();
    }
    if (key in standard) {
      materialRecord[key] = null;
    }
  });
}

export const MATERIAL_TEXTURE_ASSIGNMENTS: Record<
  keyof SceneMaterialTextureSlotMap,
  { key: MeshStandardTextureKey; colorSpace?: THREE.ColorSpace }
> = {
  albedo: { key: 'map', colorSpace: THREE.SRGBColorSpace },
  normal: { key: 'normalMap' },
  metalness: { key: 'metalnessMap' },
  roughness: { key: 'roughnessMap' },
  ao: { key: 'aoMap' },
  emissive: { key: 'emissiveMap', colorSpace: THREE.SRGBColorSpace },
  displacement: { key: 'displacementMap' },
};

export const MATERIAL_TEXTURE_SLOTS = Object.keys(MATERIAL_TEXTURE_ASSIGNMENTS) as SceneMaterialTextureSlot[];

const WALL_REPEAT_U_TEXTURE_SLOTS = [
  'map',
  'alphaMap',
  'lightMap',
  'aoMap',
  'bumpMap',
  'normalMap',
  'displacementMap',
  'emissiveMap',
  'metalnessMap',
  'roughnessMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'specularMap',
  'specularColorMap',
  'specularIntensityMap',
  'transmissionMap',
  'thicknessMap',
  'anisotropyMap',
] as const;

const MATERIAL_CLONED_KEY = '__harmonyMaterialCloned';
const MATERIAL_ORIGINAL_KEY = '__harmonyMaterialOriginal';
const TEXTURE_SLOT_STATE_KEY = '__harmonyTextureSlots';
const TEXTURE_SLOT_OVERRIDES_KEY = '__harmonyTextureOverrides';
const MATERIAL_OVERRIDE_STATE_KEY = '__harmonyMaterialOverrideState';
const TEXTURE_SETTINGS_USERDATA_KEY = '__harmonyTextureSettings';
export const MATERIAL_CONFIG_ID_KEY = '__harmonyMaterialConfigId';
export const WALL_REPEAT_SCALE_KEY = '__harmonyWallRepeatScale';
export const WALL_REPEAT_UV_AXIS_KEY = '__harmonyWallRepeatUvAxis';
export const MATERIAL_TEXTURE_REPEAT_INFO_KEY = '__harmonyTextureRepeatInfo';
const LANDFORM_FEATHER_PATCHED_FLAG = '__landformFeatherPatched';

export type MaterialTextureRepeatInfo = {
  uvMetersPerUnit: { x: number; y: number };
  repeatScale?: { x: number; y: number };
};

type MaterialOverrideState = {
  signature: string;
  materialUUIDs: string[];
  selectorId?: string | null;
};

export const DEFAULT_TEXTURE_SETTINGS: SceneMaterialTextureSettings = {
  wrapS: 'ClampToEdgeWrapping',
  wrapT: 'ClampToEdgeWrapping',
  wrapR: 'ClampToEdgeWrapping',
  offset: { x: 0, y: 0 },
  repeat: { x: 1, y: 1 },
  tileSizeMeters: { x: 1, y: 1 },
  rotation: 0,
  center: { x: 0, y: 0 },
  matrixAutoUpdate: true,
  generateMipmaps: true,
  premultiplyAlpha: false,
  flipY: true,
};


export const MATERIAL_CLASS_NAMES = [
  'MeshBasicMaterial',
  'MeshNormalMaterial',
  'MeshLambertMaterial',
  'MeshMatcapMaterial',
  'MeshPhongMaterial',
  'MeshToonMaterial',
  'MeshStandardMaterial',
  'MeshPhysicalMaterial',
] as SceneMaterialType[]
export const MATERIAL_CLASS_MAP: Record<SceneMaterialType, new () => THREE.Material> = MATERIAL_CLASS_NAMES.reduce(
  (map, className) => {
    const candidate = (THREE as unknown as Record<SceneMaterialType, unknown>)[className]
    const ctor = typeof candidate === 'function'
      ? (candidate as new () => THREE.Material)
      : THREE.MeshStandardMaterial
    map[className] = ctor
    return map
  },
  {} as Record<SceneMaterialType, new () => THREE.Material>,
)

export type MaterialBaselineState = {
  color?: THREE.Color
  opacity: number
  transparent: boolean
  depthWrite: boolean
  wireframe?: boolean
  metalness?: number
  roughness?: number
  emissive?: THREE.Color
  emissiveIntensity?: number
  side?: THREE.Side
  aoMapIntensity?: number
  envMapIntensity?: number
} & Partial<Record<MeshStandardTextureKey, THREE.Texture | null>>

export interface MaterialTextureAssignmentOptions {
  resolveTexture?: (ref: SceneMaterialTextureRef) => THREE.Texture | null | Promise<THREE.Texture | null>
  warn?: (message: string) => void
  defaultTextureSettingsSignature?: string
}

export function createTextureSettings(
  overrides?: Partial<SceneMaterialTextureSettings> | null,
): SceneMaterialTextureSettings {
  const base = DEFAULT_TEXTURE_SETTINGS;
  const candidate = overrides ?? null;
  const tileSizeX = typeof candidate?.tileSizeMeters?.x === 'number' ? candidate.tileSizeMeters.x : Number.NaN;
  const tileSizeY = typeof candidate?.tileSizeMeters?.y === 'number' ? candidate.tileSizeMeters.y : Number.NaN;
  return {
    wrapS: candidate?.wrapS ?? base.wrapS,
    wrapT: candidate?.wrapT ?? base.wrapT,
    wrapR: candidate?.wrapR ?? base.wrapR,
    offset: {
      x: candidate?.offset?.x ?? base.offset.x,
      y: candidate?.offset?.y ?? base.offset.y,
    },
    repeat: {
      x: candidate?.repeat?.x ?? base.repeat.x,
      y: candidate?.repeat?.y ?? base.repeat.y,
    },
    tileSizeMeters: {
      x: Number.isFinite(tileSizeX) && tileSizeX > 1e-6 ? tileSizeX : base.tileSizeMeters.x,
      y: Number.isFinite(tileSizeY) && tileSizeY > 1e-6 ? tileSizeY : base.tileSizeMeters.y,
    },
    rotation: candidate?.rotation ?? base.rotation,
    center: {
      x: candidate?.center?.x ?? base.center.x,
      y: candidate?.center?.y ?? base.center.y,
    },
    matrixAutoUpdate: candidate?.matrixAutoUpdate ?? base.matrixAutoUpdate,
    generateMipmaps: candidate?.generateMipmaps ?? base.generateMipmaps,
    premultiplyAlpha: candidate?.premultiplyAlpha ?? base.premultiplyAlpha,
    flipY: candidate?.flipY ?? base.flipY,
  };
}

export function cloneTextureSettings(
  settings?: SceneMaterialTextureSettings | null,
): SceneMaterialTextureSettings {
  return createTextureSettings(settings ?? null);
}

export function textureSettingsSignature(
  settings?: SceneMaterialTextureSettings | null,
): string {
  const resolved = createTextureSettings(settings ?? null);
  return [
    resolved.wrapS,
    resolved.wrapT,
    resolved.wrapR,
    resolved.offset.x,
    resolved.offset.y,
    resolved.repeat.x,
    resolved.repeat.y,
    resolved.tileSizeMeters.x,
    resolved.tileSizeMeters.y,
    resolved.rotation,
    resolved.center.x,
    resolved.center.y,
    resolved.matrixAutoUpdate ? 1 : 0,
    resolved.generateMipmaps ? 1 : 0,
    resolved.premultiplyAlpha ? 1 : 0,
    resolved.flipY ? 1 : 0,
  ].join('|');
}

export const DEFAULT_TEXTURE_SETTINGS_SIGNATURE = textureSettingsSignature();

function sanitizeAutoRepeatAxisValue(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 1e-6) {
    return fallback;
  }
  return numeric;
}

function sanitizeWallRepeatScaleU(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function ensureWallMaterialRepeatWrapU(material: THREE.Material): void {
  const candidate = material as THREE.Material & Record<string, unknown>;
  let changed = false;
  WALL_REPEAT_U_TEXTURE_SLOTS.forEach((slot) => {
    const texture = candidate[slot] as THREE.Texture | null | undefined;
    if (!texture) {
      return;
    }
    if (texture.wrapS !== THREE.RepeatWrapping) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.needsUpdate = true;
      changed = true;
    }
  });
  if (changed) {
    candidate.needsUpdate = true;
  }
}

function createWallRepeatScaleMaterialVariantOne(
  source: THREE.Material,
  repeatScaleU: number,
): { material: THREE.Material; ownedTextures: THREE.Texture[]; shared: boolean } {
  const safeScale = sanitizeWallRepeatScaleU(repeatScaleU);
  if (Math.abs(safeScale - 1) <= 1e-6) {
    return { material: source, ownedTextures: [], shared: true };
  }

  const typedSource = source as THREE.MeshStandardMaterial & Record<string, unknown>;
  const cloned = source.clone() as THREE.Material & Record<string, unknown>;
  const ownedTextures: THREE.Texture[] = [];
  let changed = false;

  WALL_REPEAT_U_TEXTURE_SLOTS.forEach((slot) => {
    const texture = typedSource[slot] as THREE.Texture | null | undefined;
    if (!texture) {
      return;
    }
    const clonedTexture = texture.clone();
    clonedTexture.wrapS = THREE.RepeatWrapping;
    clonedTexture.repeat.x *= safeScale;
    clonedTexture.needsUpdate = true;
    cloned[slot] = clonedTexture;
    ownedTextures.push(clonedTexture);
    changed = true;
  });

  if (!changed) {
    cloned.dispose();
    return { material: source, ownedTextures: [], shared: true };
  }

  cloned.needsUpdate = true;
  return { material: cloned as THREE.Material, ownedTextures, shared: false };
}

export function createWallRepeatScaleMaterialVariant(
  source: THREE.Material | THREE.Material[],
  repeatScaleU: number,
): { material: THREE.Material | THREE.Material[]; ownedTextures: THREE.Texture[]; shared: boolean } {
  if (Array.isArray(source)) {
    const variants = source.map((entry) => createWallRepeatScaleMaterialVariantOne(entry, repeatScaleU));
    const shared = variants.every((entry) => entry.shared);
    return {
      material: shared ? source : variants.map((entry) => entry.material),
      ownedTextures: variants.flatMap((entry) => entry.ownedTextures),
      shared,
    };
  }
  return createWallRepeatScaleMaterialVariantOne(source, repeatScaleU);
}

export function resolveMaterialTextureRepeatInfo(value: unknown): MaterialTextureRepeatInfo | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as {
    uvMetersPerUnit?: { x?: unknown; y?: unknown } | null;
    repeatScale?: { x?: unknown; y?: unknown } | null;
  };
  const uvMetersPerUnit = {
    x: sanitizeAutoRepeatAxisValue(record.uvMetersPerUnit?.x, Number.NaN),
    y: sanitizeAutoRepeatAxisValue(record.uvMetersPerUnit?.y, Number.NaN),
  };
  if (!Number.isFinite(uvMetersPerUnit.x) || !Number.isFinite(uvMetersPerUnit.y)) {
    return null;
  }
  const repeatScale = record.repeatScale
    ? {
        x: sanitizeAutoRepeatAxisValue(record.repeatScale.x, 1),
        y: sanitizeAutoRepeatAxisValue(record.repeatScale.y, 1),
      }
    : undefined;
  return { uvMetersPerUnit, repeatScale };
}

function computeTextureAxisRepeat(
  settings: SceneMaterialTextureSettings,
  repeatInfo: MaterialTextureRepeatInfo | null,
  axis: 'x' | 'y',
): number {
  const manualRepeat = axis === 'x' ? settings.repeat.x : settings.repeat.y;
  if (!repeatInfo) {
    return manualRepeat;
  }
  const tileSize = axis === 'x' ? settings.tileSizeMeters.x : settings.tileSizeMeters.y;
  const uvMetersPerUnit = axis === 'x' ? repeatInfo.uvMetersPerUnit.x : repeatInfo.uvMetersPerUnit.y;
  const repeatScale = axis === 'x'
    ? repeatInfo.repeatScale?.x ?? 1
    : repeatInfo.repeatScale?.y ?? 1;
  return manualRepeat * repeatScale * (uvMetersPerUnit / Math.max(1e-6, tileSize));
}

function shouldForceTextureRepeatWrap(
  settings: SceneMaterialTextureSettings,
  repeatInfo: MaterialTextureRepeatInfo | null,
  axis: 'x' | 'y',
): boolean {
  if (!repeatInfo) {
    return false;
  }
  const tileSize = axis === 'x' ? settings.tileSizeMeters.x : settings.tileSizeMeters.y;
  const uvMetersPerUnit = axis === 'x' ? repeatInfo.uvMetersPerUnit.x : repeatInfo.uvMetersPerUnit.y;
  if (tileSize > 1e-6 && uvMetersPerUnit > 1e-6) {
    return true;
  }
  const repeatScale = axis === 'x'
    ? repeatInfo.repeatScale?.x ?? 1
    : repeatInfo.repeatScale?.y ?? 1;
  return Math.abs(repeatScale - 1) > 1e-6;
}

export function syncTextureRepeatFromAutoInfo(texture: THREE.Texture): void {
  const settings = createTextureSettings(texture.userData?.[TEXTURE_SETTINGS_USERDATA_KEY] ?? null);
  const repeatInfo = resolveMaterialTextureRepeatInfo(texture.userData?.[MATERIAL_TEXTURE_REPEAT_INFO_KEY] ?? null);
  texture.repeat.set(
    computeTextureAxisRepeat(settings, repeatInfo, 'x'),
    computeTextureAxisRepeat(settings, repeatInfo, 'y'),
  );
  if (shouldForceTextureRepeatWrap(settings, repeatInfo, 'x')) {
    texture.wrapS = THREE.RepeatWrapping;
  }
  if (shouldForceTextureRepeatWrap(settings, repeatInfo, 'y')) {
    texture.wrapT = THREE.RepeatWrapping;
  }
  texture.needsUpdate = true;
}

export function applyMaterialTextureRepeatInfo(
  material: THREE.Material,
  repeatInfo: MaterialTextureRepeatInfo | null | undefined,
): void {
  const resolvedRepeatInfo = resolveMaterialTextureRepeatInfo(repeatInfo ?? null);
  if (!resolvedRepeatInfo) {
    if (material.userData && MATERIAL_TEXTURE_REPEAT_INFO_KEY in material.userData) {
      delete material.userData[MATERIAL_TEXTURE_REPEAT_INFO_KEY];
    }
  } else {
    material.userData = {
      ...(material.userData ?? {}),
      [MATERIAL_TEXTURE_REPEAT_INFO_KEY]: resolvedRepeatInfo,
    };
  }
  const typed = material as THREE.MeshStandardMaterial & Partial<Record<MeshStandardTextureKey, THREE.Texture | null>>;
  STANDARD_TEXTURE_KEYS.forEach((key) => {
    const texture = typed[key];
    if (!texture) {
      return;
    }
    if (resolvedRepeatInfo) {
      texture.userData = {
        ...(texture.userData ?? {}),
        [MATERIAL_TEXTURE_REPEAT_INFO_KEY]: resolvedRepeatInfo,
      };
    } else if (texture.userData && MATERIAL_TEXTURE_REPEAT_INFO_KEY in texture.userData) {
      delete texture.userData[MATERIAL_TEXTURE_REPEAT_INFO_KEY];
    }
    syncTextureRepeatFromAutoInfo(texture);
  });
}

function createAutoTiledMaterialVariantOne(
  source: THREE.Material,
  repeatInfo: MaterialTextureRepeatInfo | null,
): { material: THREE.Material; ownedTextures: THREE.Texture[]; shared: boolean } {
  const resolvedRepeatInfo = resolveMaterialTextureRepeatInfo(repeatInfo);
  if (!resolvedRepeatInfo) {
    return { material: source, ownedTextures: [], shared: true };
  }

  const typedSource = source as THREE.MeshStandardMaterial & Partial<Record<MeshStandardTextureKey, THREE.Texture | null>>;
  const cloned = source.clone() as THREE.Material & Record<string, unknown>;
  const ownedTextures: THREE.Texture[] = [];
  let changed = false;

  STANDARD_TEXTURE_KEYS.forEach((key) => {
    const texture = typedSource[key];
    if (!texture) {
      return;
    }
    const clonedTexture = texture.clone();
    clonedTexture.userData = {
      ...(texture.userData ?? {}),
      [MATERIAL_TEXTURE_REPEAT_INFO_KEY]: resolvedRepeatInfo,
    };
    syncTextureRepeatFromAutoInfo(clonedTexture);
    cloned[key] = clonedTexture;
    ownedTextures.push(clonedTexture);
    changed = true;
  });

  if (!changed) {
    cloned.dispose();
    return { material: source, ownedTextures: [], shared: true };
  }

  applyMaterialTextureRepeatInfo(cloned as THREE.Material, resolvedRepeatInfo);
  return { material: cloned as THREE.Material, ownedTextures, shared: false };
}

export function createAutoTiledMaterialVariant(
  source: THREE.Material | THREE.Material[],
  repeatInfo: unknown,
): { material: THREE.Material | THREE.Material[]; ownedTextures: THREE.Texture[]; shared: boolean } {
  const resolvedRepeatInfo = resolveMaterialTextureRepeatInfo(repeatInfo);
  if (!resolvedRepeatInfo) {
    return { material: source, ownedTextures: [], shared: true };
  }
  if (Array.isArray(source)) {
    const variants = source.map((entry) => createAutoTiledMaterialVariantOne(entry, resolvedRepeatInfo));
    const shared = variants.every((entry) => entry.shared);
    return {
      material: shared ? source : variants.map((entry) => entry.material),
      ownedTextures: variants.flatMap((entry) => entry.ownedTextures),
      shared,
    };
  }
  return createAutoTiledMaterialVariantOne(source, resolvedRepeatInfo);
}

export const DEFAULT_SCENE_MATERIAL_ID = '__scene_default_material__';

export const DEFAULT_SCENE_MATERIAL_TYPE: SceneMaterialType = 'MeshStandardMaterial';

export class SceneMaterialFactory {
  private readonly textureCache = new Map<string, Promise<THREE.Texture | null>>();
  private readonly disposableUrls = new Set<string>();
  private readonly provider: ResourceCache;
  private readonly warn?: (message: string) => void;
  private readonly loadingManager: THREE.LoadingManager;
  private readonly textureLoader: THREE.TextureLoader;
  private readonly hdrLoader: RGBELoader | null;
  private hdrLoaderPromise: Promise<RGBELoader> | null = null;
  private readonly resourceEntrys: SceneResourceSummaryEntry[];
  constructor(options: SceneMaterialFactoryOptions) {
    if (!options?.provider) {
      throw new Error('SceneMaterialFactory requires a material asset provider');
    }
    this.provider = options.provider;
    this.resourceEntrys = options.resources ?? [];
    this.warn = options.warn;
    this.loadingManager = options.loadingManager ?? new THREE.LoadingManager();
    if (options.textureLoader) {
      options.textureLoader.manager = this.loadingManager;
      this.textureLoader = options.textureLoader;
    } else {
      this.textureLoader = new THREE.TextureLoader(this.loadingManager);
    }
    if (options.hdrLoader) {
      options.hdrLoader.manager = this.loadingManager;
      this.hdrLoader = options.hdrLoader;
    } else {
      this.hdrLoader = null;
    }
  }

  private getHdrLoader(): Promise<RGBELoader> {
    if (this.hdrLoader) {
      return Promise.resolve(this.hdrLoader);
    }
    if (!this.hdrLoaderPromise) {
      this.hdrLoaderPromise = createRgbELoader(this.loadingManager);
    }
    return this.hdrLoaderPromise;
  }

  async resolveNodeMaterials(
    entries: readonly SceneNodeMaterial[] | SceneNodeMaterial[] | null | undefined,
    context: { nodeId?: string | null; nodeName?: string | null } = {},
  ): Promise<THREE.Material[]> {
    if (!Array.isArray(entries) || entries.length === 0) {
      return [this.createDefaultMaterial('#ffffff')];
    }

    const resolved: THREE.Material[] = [];
    for (const entry of entries) {
      if (!entry) {
        continue;
      }
      try {
        const material = await this.createMaterialForNode(entry);
        if (material) {
          resolved.push(material);
        }
      } catch (error) {
        console.warn('节点材质创建失败', entry, error);
        const label = context.nodeName ?? context.nodeId ?? '未命名节点';
        this.warn?.(`节点 ${label} 初始化材质失败`);
      }
    }

    return resolved.length ? resolved : [this.createDefaultMaterial('#ffffff')];
  }

  createDefaultMaterial(colorHex: string): THREE.Material {
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorHex),
      map: getDefaultUvDebugTexture(),
      metalness: 0.2,
      roughness: 0.7,
    });
    material.side = THREE.DoubleSide;
    material.name = 'Default Material';
    return material;
  }

  async createMaterialForNode(entry: SceneNodeMaterial): Promise<THREE.Material | null> {
    return this.instantiateMaterial(entry);
  }

  dispose(): void {
    this.textureCache.clear();
    this.disposableUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (_error) {
        /* noop */
      }
    });
    this.disposableUrls.clear();
  }

  private extractMaterialProps(material: SceneMaterial | SceneNodeMaterial): SceneMaterialProps {
    return {
      color: material.color ?? '#ffffff',
      transparent: material.transparent ?? false,
      opacity: material.opacity ?? 1,
      side: material.side ?? 'front',
      wireframe: material.wireframe ?? false,
      metalness: material.metalness ?? 0.1,
      roughness: material.roughness ?? 1.0,
      emissive: material.emissive ?? '#000000',
      emissiveIntensity: material.emissiveIntensity ?? 0,
      aoStrength: material.aoStrength ?? 1,
      envMapIntensity: material.envMapIntensity ?? 1,
      textures: (material.textures ?? {}) as SceneMaterialTextureSlotMap,
    };
  }

  private applyMaterialProps(material: THREE.Material, props: SceneMaterial | SceneNodeMaterial): void {
    const materialAny = material as Record<string, any>;
    if (typeof props.transparent === 'boolean') {
      materialAny.transparent = props.transparent;
    }
    if (typeof props.opacity === 'number') {
      materialAny.opacity = props.opacity;
    }
    materialAny.side = resolveMaterialSide(props.side);

    if (props.color && materialAny.color?.set) {
      materialAny.color.set(props.color);
    }
    if (props.emissive && materialAny.emissive?.set) {
      materialAny.emissive.set(props.emissive);
    }
    if (typeof props.emissiveIntensity === 'number' && 'emissiveIntensity' in materialAny) {
      materialAny.emissiveIntensity = props.emissiveIntensity;
    }
    if (typeof props.wireframe === 'boolean') {
      materialAny.wireframe = props.wireframe;
    }
    if (typeof props.metalness === 'number' && 'metalness' in materialAny) {
      materialAny.metalness = props.metalness;
    }
    if (typeof props.roughness === 'number' && 'roughness' in materialAny) {
      materialAny.roughness = props.roughness;
    }
    if (typeof props.envMapIntensity === 'number' && 'envMapIntensity' in materialAny) {
      materialAny.envMapIntensity = props.envMapIntensity;
    }
    if (typeof props.aoStrength === 'number' && 'aoMapIntensity' in materialAny) {
      materialAny.aoMapIntensity = props.aoStrength;
    }

    material.needsUpdate = true;
  }

  private async instantiateMaterial(material: SceneMaterial | SceneNodeMaterial): Promise<THREE.Material | null> {
    const props = this.extractMaterialProps(material);
    const side = resolveMaterialSide(props.side);
    const color = new THREE.Color(props.color);
    const emissiveColor = new THREE.Color(props.emissive ?? '#000000');

    let instance: THREE.Material | null = null;
    switch (material.type) {
      case 'MeshBasicMaterial':
        instance = new THREE.MeshBasicMaterial({
          color,
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        });
        break;
      case 'MeshLambertMaterial':
        instance = new THREE.MeshLambertMaterial({
          color,
          emissive: emissiveColor,
          emissiveIntensity: props.emissiveIntensity,
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        });
        break;
      case 'MeshPhongMaterial':
        instance = new THREE.MeshPhongMaterial({
          color,
          emissive: emissiveColor,
          emissiveIntensity: props.emissiveIntensity,
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        });
        break;
      case 'MeshToonMaterial':
        instance = new THREE.MeshToonMaterial({
          color,
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        });
        break;
      case 'MeshNormalMaterial':
        instance = new THREE.MeshNormalMaterial({
          flatShading: false,
          transparent: props.transparent,
          opacity: props.opacity,
          side,
        });
        break;
      case 'MeshPhysicalMaterial':
        instance = new THREE.MeshPhysicalMaterial({
          color,
          metalness: props.metalness,
          roughness: props.roughness,
          emissive: emissiveColor,
          emissiveIntensity: props.emissiveIntensity,
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        });
        break;
      case 'MeshMatcapMaterial':
        instance = new THREE.MeshMatcapMaterial({
          color,
          transparent: props.transparent,
          opacity: props.opacity,
          side,
        });
        break;
      case 'MeshStandardMaterial':
      default:
        instance = new THREE.MeshStandardMaterial({
          color,
          metalness: props.metalness,
          roughness: props.roughness,
          emissive: emissiveColor,
          emissiveIntensity: props.emissiveIntensity,
          transparent: props.transparent,
          opacity: props.opacity,
          wireframe: props.wireframe,
          side,
        });
        break;
    }

    if (!instance) {
      return null;
    }

    this.applyMaterialProps(instance, material);
    await this.applyMaterialTextures(instance, props.textures);
    return instance;
  }

  private async applyMaterialTextures(
    material: THREE.Material,
    textures?: SceneMaterialTextureSlotMap | null,
  ): Promise<void> {
    if (!textures) {
      return;
    }

    const assignments = await this.resolveMaterialTextures(textures);
    this.assignResolvedTextures(material, assignments);
  }

  private async resolveMaterialTextures(
    textures: SceneMaterialTextureSlotMap,
  ): Promise<Record<string, THREE.Texture>> {
    const resolved: Record<string, THREE.Texture> = {};
    const entries = Object.entries(textures) as Array<[
      keyof SceneMaterialTextureSlotMap,
      SceneMaterialTextureRef | null,
    ]>;

    await Promise.all(
      entries.map(async ([slot, ref]) => {
        if (!ref || typeof ref !== 'object' || typeof ref.assetId !== 'string') {
          return;
        }
        try {
          const texture = await this.ensureTexture(ref.assetId, ref.settings ?? null);
          if (texture) {
            const assignment = MATERIAL_TEXTURE_ASSIGNMENTS[slot];
            if (assignment.colorSpace) {
              texture.colorSpace = assignment.colorSpace;
              texture.needsUpdate = true;
            }
            resolved[assignment.key] = texture;
          }
        } catch (error) {
          console.warn('材质纹理加载失败', ref, error);
          this.warn?.(`纹理 ${ref.assetId} 加载失败`);
        }
      }),
    );

    return resolved;
  }

  private assignResolvedTextures(
    material: THREE.Material,
    assignments: Record<string, THREE.Texture>,
  ): void {
    Object.entries(assignments).forEach(([key, texture]) => {
      if (!texture) {
        return;
      }
      const typed = material as unknown as Record<string, unknown>;
      typed[key] = texture;
    });
    material.needsUpdate = true;
  }

  private async ensureTexture(
    assetId: string,
    settings: Partial<SceneMaterialTextureSettings> | null,
  ): Promise<THREE.Texture | null> {
    const signature = `${assetId}::${textureSettingsSignature(settings as SceneMaterialTextureSettings | null)}`;
    if (this.textureCache.has(signature)) {
      return this.textureCache.get(signature)!;
    }

    const pending = this.createTextureInstance(assetId, settings)
      .catch((error) => {
        console.warn('纹理加载失败', assetId, error);
        this.warn?.(`纹理 ${assetId} 加载失败`);
        return null;
      });

    this.textureCache.set(signature, pending);
    return pending;
  }

  async loadTexture(
    assetId: string,
    settings: Partial<SceneMaterialTextureSettings> | null = null,
  ): Promise<THREE.Texture | null> {
    return this.ensureTexture(assetId, settings)
  }

  private isHdrTextureAsset(assetId: string, asset: AssetCacheEntry): boolean {
    const resourceEntry = this.resourceEntrys.find((entry) => entry.assetId === assetId);
    if (resourceEntry?.type) {
      return resourceEntry.type === 'hdri';
    }
    const inferredType = inferAssetTypeOrNull({
      mimeType: asset.mimeType,
      nameOrUrl: asset.filename ?? asset.downloadUrl ?? assetId,
    });
    return inferredType === 'hdri';
  }

  private async createTextureInstance(
    assetId: string,
    settings: Partial<SceneMaterialTextureSettings> | null,
  ): Promise<THREE.Texture | null> {
    let texture: THREE.Texture | null = null;
    const entry = await this.provider.acquireAssetEntry(assetId);
    if (entry) {
      texture = await this.loadTextureFromEntry(entry, {
        hdr: this.isHdrTextureAsset(assetId, entry),
      });
    }
    if (texture !== null) {
      applyTextureSettings(texture, settings);
    }
    return texture;
  }

  private async loadTextureFromEntry(asset: AssetCacheEntry, options?: { hdr?: boolean }): Promise<THREE.Texture | null> {
    try {
      const isWeChatMiniProgram = Boolean((globalThis as typeof globalThis & { wx?: { getSystemInfoSync?: () => unknown } }).wx
        && typeof (globalThis as typeof globalThis & { wx?: { getSystemInfoSync?: () => unknown } }).wx?.getSystemInfoSync === 'function');
      const preferredUrl = isWeChatMiniProgram
        ? (asset.downloadUrl && !asset.downloadUrl.startsWith('builtin') ? asset.downloadUrl : asset.blobUrl)
        : (asset.blobUrl || asset.downloadUrl);
      const downloadUrl = preferredUrl ?? '';
      if (!downloadUrl) {
        console.warn('纹理资源下载链接缺失', asset.assetId);
        return null;
      }

      if (options?.hdr) {
        const hdrLoader = await this.getHdrLoader();
        const texture = await new Promise<THREE.Texture>((resolve, reject) => {
          hdrLoader.load(
            downloadUrl,
            (loaded: unknown) => resolve(loaded as THREE.Texture),
            undefined,
            (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
          );
        });
        return texture;
      }
      const texture = await new Promise<THREE.Texture>((resolve, reject) => {
        this.textureLoader.load(
          downloadUrl,
          (loaded: THREE.Texture) => resolve(loaded),
          undefined,
          (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
        );
      });
      return texture;
    } catch (error) {
      console.warn('纹理资源加载失败', asset.assetId, error);
      return null;
    }
  }
}

export function ensureMeshMaterialsUnique(mesh: THREE.Mesh): void {
  const userData = mesh.userData ?? (mesh.userData = {});
  if (userData[MATERIAL_CLONED_KEY]) {
    return;
  }

  if (!mesh.material) {
    userData[MATERIAL_CLONED_KEY] = true;
    return;
  }

  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map((material: THREE.Material | null) =>
      material ? material.clone() : new THREE.MeshBasicMaterial(),
    );
  } else if (mesh.material) {
    mesh.material = mesh.material.clone();
  }

  userData[MATERIAL_CLONED_KEY] = true;
}

export function ensureMaterialType(
  material: THREE.Material,
  type: SceneMaterialType | null | undefined,
): { material: THREE.Material; replaced: boolean; dispose?: () => void } {
  const desiredType = type ?? (material.type as SceneMaterialType | undefined) ?? 'MeshStandardMaterial';
  const currentType = material.type ?? material.constructor?.name ?? '';
  if (currentType === desiredType) {
    return { material, replaced: false };
  }

  const ctor = MATERIAL_CLASS_MAP[desiredType];
  if (!ctor) {
    return { material, replaced: false };
  }

  const next = new ctor();
  next.name = material.name;
  next.userData = { ...(material.userData ?? {}) };
  if (next.userData[MATERIAL_ORIGINAL_KEY]) {
    delete next.userData[MATERIAL_ORIGINAL_KEY];
  }

  return {
    material: next,
    replaced: true,
    dispose: typeof material.dispose === 'function' ? () => material.dispose() : undefined,
  };
}

function getMaterialBaseline(material: THREE.Material): MaterialBaselineState {
  const userData = material.userData ?? (material.userData = {});
  let state = userData[MATERIAL_ORIGINAL_KEY] as MaterialBaselineState | undefined;
  if (state) {
    return state;
  }

  const typed = material as THREE.Material & { color?: THREE.Color; wireframe?: boolean };
  const standard = material as THREE.MeshStandardMaterial & { emissive?: THREE.Color };

  const textureBaseline: Partial<Record<MeshStandardTextureKey, THREE.Texture | null>> = {};
  const textureSource = standard as unknown as Record<string, unknown>;
  STANDARD_TEXTURE_KEYS.forEach((key) => {
    if (!(key in textureSource)) {
      return;
    }
    const texture = textureSource[key];
    textureBaseline[key] = texture instanceof THREE.Texture ? texture : (texture as THREE.Texture | null);
  });

  state = {
    color: typed.color ? typed.color.clone() : undefined,
    opacity: material.opacity,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
    wireframe: typeof typed.wireframe === 'boolean' ? typed.wireframe : undefined,
    metalness: 'metalness' in standard ? standard.metalness : undefined,
    roughness: 'roughness' in standard ? standard.roughness : undefined,
    emissive: standard.emissive ? standard.emissive.clone() : undefined,
    emissiveIntensity: 'emissiveIntensity' in standard ? standard.emissiveIntensity : undefined,
    side: material.side,
    aoMapIntensity: 'aoMapIntensity' in standard ? standard.aoMapIntensity : undefined,
    envMapIntensity: 'envMapIntensity' in standard ? standard.envMapIntensity : undefined,
    ...textureBaseline,
  };
  userData[MATERIAL_ORIGINAL_KEY] = state;
  return state;
}

function disposeOverrideTexture(
  overrides: Record<SceneMaterialTextureSlot, THREE.Texture | null>,
  slot: SceneMaterialTextureSlot,
): void {
  const texture = overrides?.[slot] ?? null;
  if (texture) {
    texture.dispose?.();
    overrides[slot] = null;
  }
}

function resolveWallRepeatInfo(material: THREE.Material): { repeatScale: number; uvAxis: 'u' | 'v' } | null {
  const userData = material.userData ?? {};
  const repeatScaleRaw = userData[WALL_REPEAT_SCALE_KEY] as unknown;
  const uvAxisRaw = userData[WALL_REPEAT_UV_AXIS_KEY] as unknown;
  const repeatScale = typeof repeatScaleRaw === 'number' ? repeatScaleRaw : Number(repeatScaleRaw);
  const uvAxis = uvAxisRaw === 'v' ? 'v' : uvAxisRaw === 'u' ? 'u' : null;
  if (!uvAxis || !Number.isFinite(repeatScale) || Math.abs(repeatScale - 1) <= 1e-6) {
    return null;
  }
  return {
    repeatScale: Math.max(1e-6, repeatScale),
    uvAxis,
  };
}

function applyWallRepeatToTexture(texture: THREE.Texture, repeatInfo: { repeatScale: number; uvAxis: 'u' | 'v' }): void {
  if (repeatInfo.uvAxis === 'v') {
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.y *= repeatInfo.repeatScale;
  } else {
    texture.wrapS = THREE.RepeatWrapping;
    texture.repeat.x *= repeatInfo.repeatScale;
  }
  texture.needsUpdate = true;
}

function assignTextureToMaterial(
  material: THREE.Material,
  slot: SceneMaterialTextureSlot,
  ref: SceneMaterialTextureRef | null | undefined,
  options: MaterialTextureAssignmentOptions = {},
): void {
  const assignment = MATERIAL_TEXTURE_ASSIGNMENTS[slot];
  if (!assignment) {
    return;
  }

  const typed = material as THREE.MeshStandardMaterial & Record<MeshStandardTextureKey, THREE.Texture | null>;
  const userData = material.userData ?? (material.userData = {});
  const slotState = (userData[TEXTURE_SLOT_STATE_KEY] ??= {} as Record<SceneMaterialTextureSlot, string | null>);
  const overrideState = (userData[TEXTURE_SLOT_OVERRIDES_KEY] ??=
    {} as Record<SceneMaterialTextureSlot, THREE.Texture | null>);

  if (!ref) {
    disposeOverrideTexture(overrideState, slot);
    slotState[slot] = null;
    if (assignment.key in typed && typed[assignment.key] !== null) {
      typed[assignment.key] = null;
      material.needsUpdate = true;
    }
    return;
  }

  const settingsSignature = textureSettingsSignature(ref.settings);
  const defaultSignature = options.defaultTextureSettingsSignature ?? textureSettingsSignature();
  const wallRepeatInfo = resolveWallRepeatInfo(material);
  const materialRepeatInfo = resolveMaterialTextureRepeatInfo(material.userData?.[MATERIAL_TEXTURE_REPEAT_INFO_KEY] ?? null);
  const stateKey = `${ref.assetId}|${settingsSignature}`;
  const needsClone = settingsSignature !== defaultSignature || Boolean(wallRepeatInfo) || Boolean(materialRepeatInfo);

  if (slotState[slot] === stateKey) {
    const current = typed[assignment.key] ?? null;
    if (needsClone) {
      if (current && overrideState[slot] && current === overrideState[slot]) {
        return;
      }
    } else if (current && !overrideState[slot]) {
      return;
    }
  }

  slotState[slot] = stateKey;

  const applyResolvedTexture = (texture: THREE.Texture | null) => {
    if (!texture) {
      return;
    }
    if (slotState[slot] !== stateKey) {
      return;
    }
    if (!(assignment.key in typed)) {
      return;
    }

    disposeOverrideTexture(overrideState, slot);
    let instance = texture;
    if (needsClone) {
      instance = texture.clone();
      applyTextureSettings(instance, ref.settings ?? null);
      if (materialRepeatInfo) {
        instance.userData = {
          ...(instance.userData ?? {}),
          [MATERIAL_TEXTURE_REPEAT_INFO_KEY]: materialRepeatInfo,
        };
        syncTextureRepeatFromAutoInfo(instance);
      }
      if (wallRepeatInfo) {
        applyWallRepeatToTexture(instance, wallRepeatInfo);
      }
      overrideState[slot] = instance;
    } else {
      overrideState[slot] = null;
    }

    if (assignment.colorSpace) {
      instance.colorSpace = assignment.colorSpace;
      instance.needsUpdate = true;
    }

    typed[assignment.key] = instance;
    material.needsUpdate = true;
  };

  if (!options.resolveTexture) {
    options.warn?.(`缺少纹理加载函数，跳过纹理 ${ref.assetId}`);
    slotState[slot] = null;
    disposeOverrideTexture(overrideState, slot);
    return;
  }

  try {
    const resolved = options.resolveTexture(ref)
    if (resolved && typeof (resolved as Promise<THREE.Texture | null>).then === 'function') {
      void (resolved as Promise<THREE.Texture | null>)
        .then((texture) => {
          applyResolvedTexture(texture)
        })
        .catch((error) => {
          console.warn('Failed to resolve material texture', ref, error)
          options.warn?.(`纹理 ${ref.assetId} 加载失败`)
        })
      return
    }
    applyResolvedTexture(resolved as THREE.Texture | null)
  } catch (error) {
    console.warn('Failed to resolve material texture', ref, error)
    options.warn?.(`纹理 ${ref.assetId} 加载失败`)
  }
}

export function applyMaterialConfigToMaterial(
  material: THREE.Material,
  config: SceneMaterial | SceneNodeMaterial,
  options: MaterialTextureAssignmentOptions = {},
): void {
  const typed = material as THREE.Material & { color?: THREE.Color; wireframe?: boolean };
  const baseline = getMaterialBaseline(material);
  let needsUpdate = false;

  const color = config.color ? new THREE.Color(config.color) : null;
  if (color && typed.color) {
    typed.color.copy(color);
    needsUpdate = true;
  }

  if (typeof config.wireframe === 'boolean' && typeof typed.wireframe === 'boolean' && typed.wireframe !== config.wireframe) {
    typed.wireframe = config.wireframe;
    needsUpdate = true;
  }

  const standard = material as THREE.MeshStandardMaterial & { [key: string]: unknown };

  const transparent = typeof config.transparent === 'boolean' ? config.transparent : undefined;
  const opacity = typeof config.opacity === 'number' ? THREE.MathUtils.clamp(config.opacity, 0, 1) : undefined;

  let desiredTransparent = baseline.transparent;
  let desiredDepthWrite = baseline.depthWrite;

  if (transparent !== undefined) {
    desiredTransparent = transparent;
    desiredDepthWrite = transparent ? false : baseline.depthWrite;
  }

  if (opacity !== undefined) {
    typed.opacity = opacity;
    if (opacity < 0.999) {
      desiredTransparent = true;
      desiredDepthWrite = false;
    }
    needsUpdate = true;
  }

  if (typed.transparent !== desiredTransparent) {
    typed.transparent = desiredTransparent;
    needsUpdate = true;
  }
  if (typed.depthWrite !== desiredDepthWrite) {
    typed.depthWrite = desiredDepthWrite;
    needsUpdate = true;
  }

  if (typeof config.side === 'string') {
    const sideValue = resolveMaterialSide(config.side);
    if (material.side !== sideValue) {
      material.side = sideValue;
      needsUpdate = true;
    }
  }

  if ('metalness' in standard && typeof config.metalness === 'number' && standard.metalness !== config.metalness) {
    standard.metalness = config.metalness;
    needsUpdate = true;
  }

  if ('roughness' in standard && typeof config.roughness === 'number' && standard.roughness !== config.roughness) {
    standard.roughness = config.roughness;
    needsUpdate = true;
  }

  const emissiveColor = config.emissive ? new THREE.Color(config.emissive) : null;
  if (emissiveColor && 'emissive' in standard && standard.emissive) {
    standard.emissive.copy(emissiveColor);
    needsUpdate = true;
  }

  if ('emissiveIntensity' in standard && typeof config.emissiveIntensity === 'number' && standard.emissiveIntensity !== config.emissiveIntensity) {
    standard.emissiveIntensity = config.emissiveIntensity;
    needsUpdate = true;
  }

  if ('aoMapIntensity' in standard && typeof config.aoStrength === 'number' && standard.aoMapIntensity !== config.aoStrength) {
    standard.aoMapIntensity = config.aoStrength;
    needsUpdate = true;
  }

  if ('envMapIntensity' in standard && typeof config.envMapIntensity === 'number' && standard.envMapIntensity !== config.envMapIntensity) {
    standard.envMapIntensity = config.envMapIntensity;
    needsUpdate = true;
  }

  MATERIAL_TEXTURE_SLOTS.forEach((slot) => {
    const ref = config.textures?.[slot] ?? null;
    assignTextureToMaterial(material, slot, ref, options);
  });

  if (material.userData?.[LANDFORM_FEATHER_PATCHED_FLAG] === true) {
    if (!typed.transparent) {
      typed.transparent = true;
      needsUpdate = true;
    }
    if (typed.depthWrite) {
      typed.depthWrite = false;
      needsUpdate = true;
    }
    if (!typed.polygonOffset) {
      typed.polygonOffset = true;
      needsUpdate = true;
    }
    if (typed.alphaTest < 0.001) {
      typed.alphaTest = 0.001;
      needsUpdate = true;
    }
    if (typed.side !== THREE.DoubleSide) {
      typed.side = THREE.DoubleSide;
      needsUpdate = true;
    }
  }

  if (needsUpdate) {
    typed.needsUpdate = true;
  }
}

export function restoreMaterialFromBaseline(material: THREE.Material): void {
  const typed = material as THREE.Material & { color?: THREE.Color; wireframe?: boolean };
  const baseline = (typed.userData?.[MATERIAL_ORIGINAL_KEY] ?? null) as MaterialBaselineState | null;
  if (!baseline) {
    return;
  }

  if (baseline.color && typed.color) {
    typed.color.copy(baseline.color);
  }
  typed.opacity = baseline.opacity;
  typed.transparent = baseline.transparent;
  typed.depthWrite = baseline.depthWrite;
  if (typeof baseline.wireframe === 'boolean' && typeof typed.wireframe === 'boolean') {
    typed.wireframe = baseline.wireframe;
  }
  material.side = baseline.side ?? material.side;

  const standard = material as THREE.MeshStandardMaterial & { [key: string]: unknown };
  if (baseline.metalness !== undefined && 'metalness' in standard) {
    standard.metalness = baseline.metalness;
  }
  if (baseline.roughness !== undefined && 'roughness' in standard) {
    standard.roughness = baseline.roughness;
  }
  if (baseline.emissive && 'emissive' in standard && standard.emissive) {
    standard.emissive.copy(baseline.emissive);
  }
  if (baseline.emissiveIntensity !== undefined && 'emissiveIntensity' in standard) {
    standard.emissiveIntensity = baseline.emissiveIntensity;
  }
  if (baseline.aoMapIntensity !== undefined && 'aoMapIntensity' in standard) {
    standard.aoMapIntensity = baseline.aoMapIntensity;
  }
  if (baseline.envMapIntensity !== undefined && 'envMapIntensity' in standard) {
    standard.envMapIntensity = baseline.envMapIntensity;
  }

  const standardRecord = standard as unknown as Record<string, unknown>;
  STANDARD_TEXTURE_KEYS.forEach((key) => {
    const value = baseline[key];
    if (value === undefined) {
      return;
    }
    if (!(key in standardRecord)) {
      return;
    }
    standardRecord[key] = value ?? null;
  });

  const slotState = typed.userData?.[TEXTURE_SLOT_STATE_KEY] as Record<SceneMaterialTextureSlot, string | null> | undefined;
  const overrideState = typed.userData?.[TEXTURE_SLOT_OVERRIDES_KEY] as
    | Record<SceneMaterialTextureSlot, THREE.Texture | null>
    | undefined;
  if (slotState) {
    MATERIAL_TEXTURE_SLOTS.forEach((slot) => {
      slotState[slot] = null;
    });
  }
  if (overrideState) {
    MATERIAL_TEXTURE_SLOTS.forEach((slot) => {
      disposeOverrideTexture(overrideState, slot);
    });
  }
  typed.needsUpdate = true;
}

export function applyMaterialOverrides(
  target: THREE.Object3D,
  materialConfigs?: SceneNodeMaterial[] | null,
  options: MaterialTextureAssignmentOptions = {},
): void {
  const configs = materialConfigs?.length ? materialConfigs : [];
  if (!configs.length) {
    resetMaterialOverrides(target);
    return;
  }

  const overrideSignature = materialConfigsSignature(configs);

  target.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh & { isMesh?: boolean };
    if (!mesh?.isMesh) {
      return;
    }

    // Never apply material overrides to the invisible instanced pick proxy.
    // It is an editor interaction helper and should remain non-rendered.
    if (mesh.userData?.instancedPickProxy) {
      return;
    }

    const overrideMaterial = Boolean(mesh.userData?.overrideMaterial)
    if (overrideMaterial) {
      if (mesh.userData && MATERIAL_OVERRIDE_STATE_KEY in mesh.userData) {
        delete mesh.userData[MATERIAL_OVERRIDE_STATE_KEY];
      }
      return;
    }

    const currentMaterial = mesh.material;
    if (!currentMaterial) {
      if (mesh.userData && MATERIAL_OVERRIDE_STATE_KEY in mesh.userData) {
        delete mesh.userData[MATERIAL_OVERRIDE_STATE_KEY];
      }
      return;
    }

    const previousState = (mesh.userData?.[MATERIAL_OVERRIDE_STATE_KEY] ?? null) as MaterialOverrideState | null;
    const requestedSelectorIdRaw = mesh.userData?.[MATERIAL_CONFIG_ID_KEY] as unknown;
    const requestedSelectorId = typeof requestedSelectorIdRaw === 'string' ? requestedSelectorIdRaw.trim() : '';
    const isWallAsset = mesh.userData?.dynamicMeshType === 'WallAsset';
    const currentMaterialUUIDs = collectMaterialUUIDs(currentMaterial);
    if (
      previousState &&
      previousState.signature === overrideSignature &&
      (previousState.selectorId ?? null) === (requestedSelectorId || null) &&
      arraysShallowEqual(previousState.materialUUIDs, currentMaterialUUIDs)
    ) {
      return;
    }

    ensureMeshMaterialsUnique(mesh);
    const resolvedMaterial = mesh.material;
    if (!resolvedMaterial) {
      if (!mesh.userData) {
        mesh.userData = {};
      }
      mesh.userData[MATERIAL_OVERRIDE_STATE_KEY] = { signature: overrideSignature, materialUUIDs: [] };
      return;
    }

    const materials = Array.isArray(resolvedMaterial) ? resolvedMaterial : [resolvedMaterial];
    const meshRepeatInfo = resolveMaterialTextureRepeatInfo(mesh.userData?.[MATERIAL_TEXTURE_REPEAT_INFO_KEY] ?? null);
    const configById = requestedSelectorId
      ? (configs.find((entry) => typeof entry?.id === 'string' && entry.id === requestedSelectorId) ?? null)
      : null;
    const disposables: Array<(() => void) | undefined> = [];
    let replaced = false;
    materials.forEach((materialRef, index) => {
      const config = configById ?? (!requestedSelectorId && !isWallAsset
        ? (configs.length === 1 ? configs[0] : configs[index] ?? null)
        : null);
      if (config) {
        const { material: ensured, replaced: didReplace, dispose } = ensureMaterialType(materialRef, config.type);
        if (didReplace) {
          materials[index] = ensured;
          replaced = true;
          disposables.push(dispose);
        }
        applyMaterialTextureRepeatInfo(materials[index]!, meshRepeatInfo);
        applyMaterialConfigToMaterial(materials[index]!, config, options);
      } else {
        applyMaterialTextureRepeatInfo(materials[index]!, meshRepeatInfo);
        restoreMaterialFromBaseline(materials[index]!);
      }
    });

    if (!Array.isArray(resolvedMaterial) && replaced) {
      mesh.material = materials[0]!;
    } else if (Array.isArray(resolvedMaterial) && replaced) {
      mesh.material = materials.slice();
    }
    disposables.forEach((dispose) => dispose?.());

    if (!mesh.userData) {
      mesh.userData = {};
    }
    mesh.userData[MATERIAL_OVERRIDE_STATE_KEY] = {
      signature: overrideSignature,
      selectorId: requestedSelectorId || null,
      materialUUIDs: collectMaterialUUIDs(mesh.material),
    };
  });
}

export function resetMaterialOverrides(target: THREE.Object3D): void {
  target.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh & { isMesh?: boolean };
    if (!mesh?.isMesh) {
      return;
    }

    // Never apply material overrides to the invisible instanced pick proxy.
    if (mesh.userData?.instancedPickProxy) {
      return;
    }

    const overrideMaterial = Boolean(mesh.userData?.overrideMaterial);
    if (overrideMaterial) {
      if (mesh.userData && MATERIAL_OVERRIDE_STATE_KEY in mesh.userData) {
        delete mesh.userData[MATERIAL_OVERRIDE_STATE_KEY];
      }
      return;
    }

    const currentMaterial = mesh.material;
    if (!currentMaterial) {
      if (mesh.userData && MATERIAL_OVERRIDE_STATE_KEY in mesh.userData) {
        delete mesh.userData[MATERIAL_OVERRIDE_STATE_KEY];
      }
      return;
    }

    const materials = Array.isArray(currentMaterial) ? currentMaterial : [currentMaterial];
    materials.forEach((material: THREE.Material) => {
      restoreMaterialFromBaseline(material);
    });
    if (mesh.userData && MATERIAL_OVERRIDE_STATE_KEY in mesh.userData) {
      delete mesh.userData[MATERIAL_OVERRIDE_STATE_KEY];
    }
  });
}

export function disposeMaterialOverrides(material: THREE.Material): void {
  const overrideState = material.userData?.[TEXTURE_SLOT_OVERRIDES_KEY] as
    | Record<SceneMaterialTextureSlot, THREE.Texture | null>
    | undefined;
  if (!overrideState) {
    return;
  }
  MATERIAL_TEXTURE_SLOTS.forEach((slot) => {
    disposeOverrideTexture(overrideState, slot);
  });
}

function resolveMaterialSide(side?: string): THREE.Side {
  switch (side) {
    case 'back':
      return THREE.BackSide;
    case 'double':
      return THREE.DoubleSide;
    case 'front':
    default:
      return THREE.FrontSide;
  }
}

function applyTextureSettings(
  texture: THREE.Texture,
  overrides: Partial<SceneMaterialTextureSettings> | null,
): void {
  const settings = createTextureSettings(overrides);
  texture.userData = {
    ...(texture.userData ?? {}),
    [TEXTURE_SETTINGS_USERDATA_KEY]: cloneTextureSettings(settings),
  };
  texture.wrapS = resolveWrapMode(settings.wrapS);
  texture.wrapT = resolveWrapMode(settings.wrapT);
  if ('wrapR' in texture) {
    (texture as unknown as { wrapR?: THREE.Wrapping }).wrapR = resolveWrapMode(settings.wrapR);
  }

  texture.offset.set(settings.offset.x, settings.offset.y);
  texture.center.set(settings.center.x, settings.center.y);
  texture.rotation = settings.rotation;
  texture.matrixAutoUpdate = settings.matrixAutoUpdate;
  if (!texture.matrixAutoUpdate && typeof texture.updateMatrix === 'function') {
    texture.updateMatrix();
  }
  texture.generateMipmaps = settings.generateMipmaps;
  texture.premultiplyAlpha = settings.premultiplyAlpha;
  texture.flipY = settings.flipY;
  syncTextureRepeatFromAutoInfo(texture);
}

function resolveWrapMode(mode: string): THREE.Wrapping {
  switch (mode) {
    case 'RepeatWrapping':
      return THREE.RepeatWrapping;
    case 'MirroredRepeatWrapping':
      return THREE.MirroredRepeatWrapping;
    case 'ClampToEdgeWrapping':
    default:
      return THREE.ClampToEdgeWrapping;
  }
}

function materialConfigsSignature(configs: SceneNodeMaterial[]): string {
  if (!configs.length) {
    return '';
  }
  const serialized = stableSerialize(configs);
  return hashString(serialized);
}

function collectMaterialUUIDs(material: THREE.Material | THREE.Material[]): string[] {
  if (Array.isArray(material)) {
    return material.map((entry) => (entry?.uuid ?? ''));
  }
  return material ? [material.uuid ?? ''] : [];
}

function arraysShallowEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

