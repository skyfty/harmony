import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import type {
  SceneMaterial,
  SceneMaterialProps,
  SceneMaterialTextureRef,
  SceneMaterialTextureSettings,
  SceneMaterialTextureSlotMap,
  SceneMaterialType,
  SceneNodeMaterial,
} from '@harmony/schema';

export type MaterialAssetSource =
  | { kind: 'arraybuffer'; data: ArrayBuffer }
  | { kind: 'data-url'; dataUrl: string }
  | { kind: 'remote-url'; url: string };

export interface MaterialAssetProvider {
  acquireAssetSource(assetId: string): Promise<MaterialAssetSource | null>;
}

export interface SceneMaterialFactoryOptions {
  provider: MaterialAssetProvider;
  loadingManager?: THREE.LoadingManager;
  textureLoader?: THREE.TextureLoader;
  hdrLoader?: RGBELoader;
  warn?: (message: string) => void;
}

const MATERIAL_TEXTURE_ASSIGNMENTS: Record<
  keyof SceneMaterialTextureSlotMap,
  { key: string; colorSpace?: 'srgb' | 'linear' }
> = {
  albedo: { key: 'map', colorSpace: 'srgb' },
  normal: { key: 'normalMap' },
  metalness: { key: 'metalnessMap' },
  roughness: { key: 'roughnessMap' },
  ao: { key: 'aoMap' },
  emissive: { key: 'emissiveMap', colorSpace: 'srgb' },
};

const HDR_EXTENSION_PATTERN = /\.(hdr|hdri|rgbe)$/i;
const HDR_DATA_URL_PATTERN = /^data:image\/(?:vnd\.radiance|hdr|x-rgbe)/i;

export const DEFAULT_TEXTURE_SETTINGS: SceneMaterialTextureSettings = {
  wrapS: 'ClampToEdgeWrapping',
  wrapT: 'ClampToEdgeWrapping',
  wrapR: 'ClampToEdgeWrapping',
  offset: { x: 0, y: 0 },
  repeat: { x: 1, y: 1 },
  rotation: 0,
  center: { x: 0, y: 0 },
  matrixAutoUpdate: true,
  generateMipmaps: true,
  premultiplyAlpha: false,
  flipY: true,
};

export function createTextureSettings(
  overrides?: Partial<SceneMaterialTextureSettings> | null,
): SceneMaterialTextureSettings {
  const base = DEFAULT_TEXTURE_SETTINGS;
  const candidate = overrides ?? null;
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
    resolved.rotation,
    resolved.center.x,
    resolved.center.y,
    resolved.matrixAutoUpdate ? 1 : 0,
    resolved.generateMipmaps ? 1 : 0,
    resolved.premultiplyAlpha ? 1 : 0,
    resolved.flipY ? 1 : 0,
  ].join('|');
}

export const DEFAULT_SCENE_MATERIAL_ID = '__scene_default_material__';

export const DEFAULT_SCENE_MATERIAL_TYPE: SceneMaterialType = 'MeshStandardMaterial';

export class SceneMaterialFactory {
  private readonly materialTemplates = new Map<string, THREE.Material>();
  private readonly textureCache = new Map<string, Promise<THREE.Texture | null>>();
  private readonly disposableUrls = new Set<string>();
  private readonly provider: MaterialAssetProvider;
  private readonly warn?: (message: string) => void;
  private readonly loadingManager: THREE.LoadingManager;
  private readonly textureLoader: THREE.TextureLoader;
  private readonly hdrLoader: RGBELoader | null;

  constructor(options: SceneMaterialFactoryOptions) {
    if (!options?.provider) {
      throw new Error('SceneMaterialFactory requires a material asset provider');
    }
    this.provider = options.provider;
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
      this.hdrLoader = new RGBELoader(this.loadingManager).setDataType(THREE.FloatType);
    }
  }

  async prepareTemplates(materials: readonly SceneMaterial[] | null | undefined): Promise<void> {
    if (!Array.isArray(materials) || !materials.length) {
      return;
    }

    for (const material of materials) {
      if (!material || typeof material !== 'object') {
        continue;
      }
      try {
        const instance = await this.instantiateMaterial(material);
        if (instance && material.id) {
          this.materialTemplates.set(material.id, instance);
        }
      } catch (error) {
        console.warn('创建材质失败', material?.id, error);
        const label = material?.name || material?.id || 'unknown-material';
        this.warn?.(`材质 ${label} 初始化失败`);
      }
    }
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
      metalness: 0.2,
      roughness: 0.7,
    });
    material.side = THREE.DoubleSide;
    material.name = 'Default Material';
    return material;
  }

  async createMaterialForNode(entry: SceneNodeMaterial): Promise<THREE.Material | null> {
    if (entry.materialId) {
      const template = this.materialTemplates.get(entry.materialId);
      if (template) {
        const clone = template.clone();
        this.applyMaterialProps(clone, entry);
        await this.applyMaterialTextures(clone, entry.textures ?? null);
        return clone;
      }
    }
    return this.instantiateMaterial(entry);
  }

  dispose(): void {
    this.materialTemplates.forEach((material) => {
      if (typeof (material as THREE.Material).dispose === 'function') {
        (material as THREE.Material).dispose();
      }
    });
    this.materialTemplates.clear();
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
      metalness: material.metalness ?? 0.5,
      roughness: material.roughness ?? 0.5,
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
          const texture = await this.ensureTexture(ref.assetId, ref.name, ref.settings ?? null);
          if (texture) {
            const assignment = MATERIAL_TEXTURE_ASSIGNMENTS[slot];
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
    name: string | undefined,
    settings: Partial<SceneMaterialTextureSettings> | null,
  ): Promise<THREE.Texture | null> {
    const signature = `${assetId}::${textureSettingsSignature(settings as SceneMaterialTextureSettings | null)}`;
    if (this.textureCache.has(signature)) {
      return this.textureCache.get(signature)!;
    }

    const pending = this.createTextureInstance(assetId, name, settings)
      .catch((error) => {
        console.warn('纹理加载失败', assetId, error);
        this.warn?.(`纹理 ${assetId} 加载失败`);
        return null;
      });

    this.textureCache.set(signature, pending);
    return pending;
  }

  private async createTextureInstance(
    assetId: string,
    name: string | undefined,
    settings: Partial<SceneMaterialTextureSettings> | null,
  ): Promise<THREE.Texture | null> {
    const source = await this.provider.acquireAssetSource(assetId);
    if (!source) {
      return null;
    }

    const url = await this.createTextureUrlFromSource(assetId, source);
    if (!url) {
      return null;
    }

    const texture = await this.loadTextureFromUrl(url, {
      hdr: this.isHdrSource(assetId, name, source, url),
    });
    if (!texture) {
      return null;
    }

    applyTextureSettings(texture, settings);
    return texture;
  }

  private async createTextureUrlFromSource(
    assetId: string,
    source: MaterialAssetSource,
  ): Promise<string | null> {
    switch (source.kind) {
      case 'remote-url':
        return source.url;
      case 'data-url':
        return normalizeDataUrlMime(source.dataUrl, assetId);
      case 'arraybuffer': {
        const mime = inferMimeType(assetId) ?? 'application/octet-stream';
        const blob = new Blob([source.data], { type: mime });
        const url = URL.createObjectURL(blob);
        this.disposableUrls.add(url);
        return url;
      }
      default:
        return null;
    }
  }

  private isHdrSource(assetId: string, name: string | undefined, source: MaterialAssetSource, url: string | null): boolean {
    const matchesHdrExtension = (value: string | null | undefined) => {
      if (!value) {
        return false;
      }
      const sanitized = value.split('?')[0]?.split('#')[0] ?? value;
      return HDR_EXTENSION_PATTERN.test(sanitized);
    };

    if (matchesHdrExtension(assetId)) {
      return true;
    }
    if (matchesHdrExtension(url)) {
      return true;
    }
    if (name && matchesHdrExtension(name)) {
      return true;
    }
    if (url && HDR_DATA_URL_PATTERN.test(url)) {
      return true;
    }
    if (source.kind === 'data-url' && HDR_DATA_URL_PATTERN.test(source.dataUrl)) {
      return true;
    }
    return false;
  }

  private async loadTextureFromUrl(url: string, options?: { hdr?: boolean }): Promise<THREE.Texture | null> {
    if (options?.hdr && this.hdrLoader) {
      try {
        const texture = await this.hdrLoader.loadAsync(url);
        texture.colorSpace = THREE.LinearSRGBColorSpace;
        texture.needsUpdate = true;
        return texture;
      } catch (_error) {
        return null;
      }
    }

    return await new Promise((resolve) => {
      this.textureLoader.load(
        url,
        (texture: THREE.Texture) => {
          resolve(texture);
        },
        undefined,
        (_error: unknown) => {
          resolve(null);
        },
      );
    });
  }
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
  texture.wrapS = resolveWrapMode(settings.wrapS);
  texture.wrapT = resolveWrapMode(settings.wrapT);
  if ('wrapR' in texture) {
    (texture as unknown as { wrapR?: THREE.Wrapping }).wrapR = resolveWrapMode(settings.wrapR);
  }

  texture.offset.set(settings.offset.x, settings.offset.y);
  texture.repeat.set(settings.repeat.x, settings.repeat.y);
  texture.center.set(settings.center.x, settings.center.y);
  texture.rotation = settings.rotation;
  texture.matrixAutoUpdate = settings.matrixAutoUpdate;
  texture.generateMipmaps = settings.generateMipmaps;
  texture.premultiplyAlpha = settings.premultiplyAlpha;
  texture.flipY = settings.flipY;
  texture.needsUpdate = true;
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

function normalizeDataUrlMime(dataUrl: string, assetId: string): string {
  if (!dataUrl.startsWith('data:')) {
    return dataUrl;
  }
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    return dataUrl;
  }
  const header = dataUrl.slice(0, commaIndex);
  if (header.includes(';base64')) {
    return dataUrl;
  }
  const mime = inferMimeType(assetId) ?? 'application/octet-stream';
  return `data:${mime};base64,${dataUrl.slice(commaIndex + 1)}`;
}

function inferMimeType(assetId: string): string | null {
  const lower = assetId.toLowerCase();
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lower.endsWith('.ktx2')) {
    return 'image/ktx2';
  }
  if (lower.endsWith('.ktx')) {
    return 'image/ktx';
  }
  if (lower.endsWith('.hdr')) {
    return 'image/vnd.radiance';
  }
  if (lower.endsWith('.dds')) {
    return 'image/vnd-ms.dds';
  }
  if (lower.endsWith('.gif')) {
    return 'image/gif';
  }
  if (lower.endsWith('.bmp')) {
    return 'image/bmp';
  }
  if (lower.endsWith('.tga')) {
    return 'image/x-tga';
  }
  if (lower.endsWith('.glb')) {
    return 'model/gltf-binary';
  }
  if (lower.endsWith('.gltf')) {
    return 'model/gltf+json';
  }
  return null;
}
