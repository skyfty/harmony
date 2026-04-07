import * as THREE from 'three';

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


async function safeImport<T>(importer: () => Promise<T>): Promise<T> {

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
      console.error('Unable to determine file extension.');
      this.emit('loaded', null);
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

    switch (ext) {
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

      default:
        console.error(`Unsupported file format (${ext}).`);
        this.emit('loaded', null);
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
  const { DRACOLoader } = await safeImport(
    () => import('three/examples/jsm/loaders/DRACOLoader.js'),
  );
  const loader = new GLTFLoader(options.manager);
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(options.dracoDecoderPath ?? DEFAULT_DRACO_DECODER_PATH);
  loader.setDRACOLoader(dracoLoader);

  // loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}
