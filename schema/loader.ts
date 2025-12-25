import * as THREE from 'three';
import { STATIC_LOADER_MODULES } from './loaderStaticImports';
// import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';

export type LoaderProgressPayload = {
  loaded: number;
  total: number;
  filename: string;
};

export type LoaderLoadedPayload = THREE.Object3D | THREE.Group | THREE.Mesh | THREE.Points | null;

type LoaderEventMap = {
  loaded: LoaderLoadedPayload;
  progress: LoaderProgressPayload;
};

type LoaderEventHandler<K extends keyof LoaderEventMap> = (payload: LoaderEventMap[K]) => void;

type ListenerMap = Partial<Record<keyof LoaderEventMap, Set<LoaderEventHandler<any>>>>;

type WebkitFileSystemEntry = {
  isFile: boolean;
  isDirectory: boolean;
  fullPath: string;
  createReader: () => WebkitFileSystemDirectoryReader;
  file: (successCallback: (file: File) => void, errorCallback?: (error: DOMException) => void) => void;
};

type WebkitFileSystemDirectoryReader = {
  readEntries: (successCallback: (entries: WebkitFileSystemEntry[]) => void, errorCallback?: (error: DOMException) => void) => void;
};

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => WebkitFileSystemEntry | null;
};

type FilesMap = Record<string, File>;

const MINI_PROGRAM_ENV = typeof globalThis !== 'undefined' && typeof (globalThis as any).wx !== 'undefined';

async function safeImport<T>(moduleId: string, importer: () => Promise<T>): Promise<T> {
  if (MINI_PROGRAM_ENV && moduleId in STATIC_LOADER_MODULES) {
    const staticModule = STATIC_LOADER_MODULES[moduleId as keyof typeof STATIC_LOADER_MODULES];
    if (staticModule) {
      return staticModule as T;
    }
  }

  return importer();
}

export default class Loader {
  public texturePath = '';

  private listeners: ListenerMap = {};

  constructor() {
  }

  public createFilesMap(files: File[]): FilesMap{
    const map: FilesMap = {};

    for (const file of files) {
      map[file.name] = file;
    }

    return map;
  }

  public getFilesFromItemList(items: DataTransferItemList, onDone: (files: File[], filesMap: FilesMap) => void) {
    let itemsCount = 0;
    let itemsTotal = 0;

    const files: File[] = [];
    const filesMap: FilesMap = {};

    function onEntryHandled(): void {
      itemsCount += 1;

      if (itemsCount === itemsTotal) {
        onDone(files, filesMap);
      }
    }

    function handleEntry(entry: WebkitFileSystemEntry): void {
      if (entry.isDirectory) {
        const reader = entry.createReader();
        reader.readEntries((entries: WebkitFileSystemEntry[]) => {
          for (const child of entries) {
            handleEntry(child);
          }

          onEntryHandled();
        });
      } else if (entry.isFile) {
        entry.file((file: File) => {
          files.push(file);

          filesMap[entry.fullPath.slice(1)] = file;
          onEntryHandled();
        });
      }

      itemsTotal += 1;
    }

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i] as DataTransferItemWithEntry | undefined;

      if (!item || item.kind !== 'file') continue;

      const entry = item.webkitGetAsEntry?.() as unknown as WebkitFileSystemEntry | null | undefined;
      if (entry) {
        handleEntry(entry);
      }
    }
  }

  public loadItemList(items: DataTransferItemList) {
    this.getFilesFromItemList(items, (files, filesMap) => {
      this.loadFiles(files, filesMap);
    });
  }

  public loadFiles(files: File[], filesMap?: FilesMap){
    if (files.length === 0) {
      return;
    }

    const effectiveFilesMap = filesMap ?? this.createFilesMap(files);

    const manager = new THREE.LoadingManager();
  manager.setURLModifier((url: string) => {
      const sanitized = url.replace(/^(\.?\/)/, '');
      const file = effectiveFilesMap[sanitized];

      if (file) {
        console.log('Loading', sanitized);
        return URL.createObjectURL(file);
      }

      return url;
    });

    // manager.addHandler(/\.tga$/i, new TGALoader());

    for (const file of files) {
      this.loadFile(file, manager);
    }
  }

  public loadFile(file: File, manager?: THREE.LoadingManager) {
    const filename = file.name;
    const extension = filename.split('.').pop()?.toLowerCase();

    if (!extension) {
      console.error('Unable to determine file extension.');
      return;
    }

    const reader = new FileReader();
    reader.addEventListener('progress', (event: ProgressEvent<FileReader>) => {
      this.emit('progress', {
        loaded: event.loaded,
        total: event.total,
        filename,
      });
    });

    switch (extension) {
      case 'fbx': {
        reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
          const contents = event.target?.result as ArrayBuffer;
          if (!contents) return;

          const { FBXLoader } = await safeImport(
            'three/examples/jsm/loaders/FBXLoader.js',
            () => import('three/examples/jsm/loaders/FBXLoader.js'),
          );

          const loader = new FBXLoader(manager);
          const object = loader.parse(contents, '');
          object.name = filename;
          this.emit('loaded', object);
        });
        reader.readAsArrayBuffer(file);
        break;
      }

      case 'glb': {
        reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
          const contents = event.target?.result as ArrayBuffer;
          if (!contents) return;

          const loader = await this.createGLTFLoader();

          loader.parse(contents, '', (result: any) => {
            const scene = result.scene;
            scene.name = filename;

            scene.animations.push(...result.animations);

            if (loader.dracoLoader) loader.dracoLoader.dispose();
            if (loader.ktx2Loader) loader.ktx2Loader.dispose();

            this.emit('loaded', scene);
          });
        });
        reader.readAsArrayBuffer(file);
        break;
      }

      case 'gltf': {
        reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
          const contents = event.target?.result as string;
          if (!contents) return;

          const loader = await this.createGLTFLoader(manager);

          loader.parse(contents, '', (result: any) => {
            const scene = result.scene;
            scene.name = filename;

            scene.animations.push(...result.animations);

            if (loader.dracoLoader) loader.dracoLoader.dispose();
            if (loader.ktx2Loader) loader.ktx2Loader.dispose();

            this.emit('loaded', scene);
          });
        });
        reader.readAsText(file);
        break;
      }

      case 'pcd': {
        reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
          const contents = event.target?.result as ArrayBuffer;
          if (!contents) return;

          const { PCDLoader } = await safeImport(
            'three/examples/jsm/loaders/PCDLoader.js',
            () => import('three/examples/jsm/loaders/PCDLoader.js'),
          );

          const points = new PCDLoader().parse(contents);
          points.name = filename;
          this.emit('loaded', points);
        });
        reader.readAsArrayBuffer(file);
        break;
      }

      case 'ply': {
        reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
          const contents = event.target?.result as ArrayBuffer;
          if (!contents) return;

          const { PLYLoader } = await safeImport(
            'three/examples/jsm/loaders/PLYLoader.js',
            () => import('three/examples/jsm/loaders/PLYLoader.js'),
          );

          const geometry = new PLYLoader().parse(contents);
          let object: LoaderLoadedPayload;

          if (geometry.index !== null) {
            const material = new THREE.MeshStandardMaterial();

            object = new THREE.Mesh(geometry, material);
          } else {
            const material = new THREE.PointsMaterial({ size: 0.01 });
            material.vertexColors = geometry.hasAttribute('color');

            object = new THREE.Points(geometry, material);
          }

          object.name = filename;
          this.emit('loaded', object);
        });
        reader.readAsArrayBuffer(file);
        break;
      }


      default:
        console.error(`Unsupported file format (${extension}).`);
        break;
    }
  }
  public addEventListener<K extends keyof LoaderEventMap>(event: K, handler: LoaderEventHandler<K>): void {
    const listeners = (this.listeners[event] ??= new Set()) as Set<LoaderEventHandler<K>>;
    listeners.add(handler);
  }

  public removeEventListener<K extends keyof LoaderEventMap>(event: K, handler: LoaderEventHandler<K>): void {
    const listeners = this.listeners[event] as Set<LoaderEventHandler<K>> | undefined;
    listeners?.delete(handler);
  }

  private emit<K extends keyof LoaderEventMap>(event: K, payload: LoaderEventMap[K]): void {
    const listeners = this.listeners[event] as Set<LoaderEventHandler<K>> | undefined;
    listeners?.forEach((listener) => {
      listener(payload);
    });
  }

  private createGLTFLoader = async (manager?: THREE.LoadingManager): Promise<any> => {
    return await createGltfLoader({ manager });
  };
}

export interface GltfParseOptions {
  manager?: THREE.LoadingManager;
  dracoDecoderPath?: string;
  ktx2TranscoderPath?: string;
}

export interface ParsedGltfResult {
  scene: THREE.Object3D | null;
  animations: THREE.AnimationClip[];
}

const DEFAULT_DRACO_DECODER_PATH = '../examples/jsm/libs/draco/gltf/';
const DEFAULT_KTX2_TRANSCODER_PATH = '../examples/jsm/libs/basis/';

export async function createGltfLoader(options: GltfParseOptions = {}): Promise<any> {
  const { GLTFLoader } = await safeImport(
    'three/examples/jsm/loaders/GLTFLoader.js',
    () => import('three/examples/jsm/loaders/GLTFLoader.js'),
  );
  const { DRACOLoader } = await safeImport(
    'three/examples/jsm/loaders/DRACOLoader.js',
    () => import('three/examples/jsm/loaders/DRACOLoader.js'),
  );
  const { KTX2Loader } = await safeImport(
    'three/examples/jsm/loaders/KTX2Loader.js',
    () => import('three/examples/jsm/loaders/KTX2Loader.js'),
  );

  const loader = new GLTFLoader(options.manager);
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(options.dracoDecoderPath ?? DEFAULT_DRACO_DECODER_PATH);
  loader.setDRACOLoader(dracoLoader);

  const ktx2Loader = new KTX2Loader(options.manager);
  ktx2Loader.setTranscoderPath(options.ktx2TranscoderPath ?? DEFAULT_KTX2_TRANSCODER_PATH);
  loader.setKTX2Loader(ktx2Loader);

  // loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}
