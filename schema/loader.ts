import * as THREE from 'three';

export type LoaderProgressPayload = {
  loaded: number;
  total: number;
  filename: string;
};

export type LoaderLoadedPayload = THREE.Object3D | THREE.Group | THREE.Mesh | THREE.Points | null;
export type LoaderErrorPayload = Error;

type LoaderEventMap = {
  loaded: LoaderLoadedPayload;
  progress: LoaderProgressPayload;
  error: LoaderErrorPayload;
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


async function safeImport<T>(importer: () => Promise<T>): Promise<T> {

  return importer();
}

const GLTF_DRACO_ENABLED = (() => {
  const raw = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SCENERY_ENABLE_GLTF_DRACO;
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return normalized !== 'false' && normalized !== '0' && normalized !== 'no';
})();

function toError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'string' && error.trim()) {
    return new Error(error.trim());
  }
  return new Error(fallbackMessage);
}

function disposeLoaderResources(loader: any): void {
  loader?.dracoLoader?.dispose?.();
  loader?.ktx2Loader?.dispose?.();
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

  public getFilesFromItemList(items: DataTransferItemList, onDone: (files: File[]) => void) {
    let itemsCount = 0;
    let itemsTotal = 0;

    const files: File[] = [];

    function onEntryHandled(): void {
      itemsCount += 1;

      if (itemsCount === itemsTotal) {
        onDone(files);
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
    this.getFilesFromItemList(items, (files) => {
      this.loadFiles(files);
    });
  }

  public loadFiles(files: File[]){
    if (files.length === 0) {
      return;
    }

    for (const file of files) {
      this.loadFile(file);
    }
  }

  public loadFile(file: File) {
    const filename = file.name;
    const inferred = filename.split('.').pop()?.toLowerCase();
    const ext = inferred;

    if (!ext) {
      this.emit('error', new Error(`无法识别资源文件扩展名 (${filename})`));
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
    reader.addEventListener('error', () => {
      this.emit('error', toError(reader.error, `读取资源文件失败 (${filename})`));
    });
    reader.addEventListener('abort', () => {
      this.emit('error', new Error(`读取资源文件被取消 (${filename})`));
    });

    switch (ext) {
      case 'glb': {
        reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
          const contents = event.target?.result as ArrayBuffer;
          if (!contents) {
            this.emit('error', new Error(`资源文件内容为空 (${filename})`));
            return;
          }

          let loader: any = null;
          try {
            loader = await this.createGLTFLoader();
            loader.parse(
              contents,
              '',
              (result: any) => {
                try {
                  const scene = result?.scene;
                  if (!scene) {
                    this.emit('error', new Error(`GLTF 场景对象为空 (${filename})`));
                    return;
                  }
                  scene.name = filename;
                  if (Array.isArray(result?.animations) && Array.isArray((scene as any).animations)) {
                    scene.animations.push(...result.animations);
                  }
                  this.emit('loaded', scene);
                } catch (error) {
                  this.emit('error', toError(error, `GLTF 结果处理失败 (${filename})`));
                } finally {
                  disposeLoaderResources(loader);
                }
              },
              (error: unknown) => {
                try {
                  this.emit('error', toError(error, `GLTF 解析失败 (${filename})`));
                } finally {
                  disposeLoaderResources(loader);
                }
              },
            );
          } catch (error) {
            disposeLoaderResources(loader);
            this.emit('error', toError(error, `GLTF 加载器初始化失败 (${filename})`));
          }
        });
        reader.readAsArrayBuffer(file);
        break;
      }

      default:
        // this.emit('error', new Error(`不支持的文件格式 (${ext})`));
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
  enableKtx2?: boolean;
}

export interface ParsedGltfResult {
  scene: THREE.Object3D | null;
  animations: THREE.AnimationClip[];
}

const DEFAULT_DRACO_DECODER_PATH = '../examples/jsm/libs/draco/gltf/';

export async function createGltfLoader(options: GltfParseOptions = {}): Promise<any> {
  const { GLTFLoader } = await safeImport(
    () => import('three/examples/jsm/loaders/GLTFLoader.js'),
  );
  const loader = new GLTFLoader(options.manager);

  if (GLTF_DRACO_ENABLED) {
    const { DRACOLoader } = await safeImport(
      () => import('three/examples/jsm/loaders/DRACOLoader.js'),
    );
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(options.dracoDecoderPath ?? DEFAULT_DRACO_DECODER_PATH);
    loader.setDRACOLoader(dracoLoader);
  }

  // loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}
