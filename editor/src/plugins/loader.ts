import * as THREE from 'three';
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';
import { unzipSync, strFromU8 } from 'three/examples/jsm/libs/fflate.module.js';

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

export default class Loader {
  public texturePath = '';

  public createFilesMap: (files: File[]) => FilesMap;
  public getFilesFromItemList: (items: DataTransferItemList, onDone: (files: File[], filesMap: FilesMap) => void) => void;
  public loadItemList: (items: DataTransferItemList) => void;
  public loadFiles: (files: File[], filesMap?: FilesMap) => void;
  public loadFile: (file: File, manager?: THREE.LoadingManager) => void;

  private listeners: ListenerMap = {};

  constructor() {
    const scope = this;

    this.createFilesMap = (files: File[]): FilesMap => {
      const map: FilesMap = {};

      for (const file of files) {
        map[file.name] = file;
      }

      return map;
    };

    this.getFilesFromItemList = (items: DataTransferItemList, onDone: (files: File[], filesMap: FilesMap) => void) => {
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

        const entry = item.webkitGetAsEntry?.() as WebkitFileSystemEntry | null | undefined;
        if (entry) {
          handleEntry(entry);
        }
      }
    };

    this.loadItemList = (items: DataTransferItemList) => {
      scope.getFilesFromItemList(items, (files, filesMap) => {
        scope.loadFiles(files, filesMap);
      });
    };

    this.loadFiles = (files: File[], filesMap?: FilesMap) => {
      if (files.length === 0) {
        return;
      }

      const effectiveFilesMap = filesMap ?? scope.createFilesMap(files);

      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url) => {
        const sanitized = url.replace(/^(\.?\/)/, '');
        const file = effectiveFilesMap[sanitized];

        if (file) {
          console.log('Loading', sanitized);
          return URL.createObjectURL(file);
        }

        return url;
      });

      manager.addHandler(/\.tga$/i, new TGALoader());

      for (const file of files) {
        scope.loadFile(file, manager);
      }
    };

    this.loadFile = (file: File, manager?: THREE.LoadingManager) => {
      const filename = file.name;
      const extension = filename.split('.').pop()?.toLowerCase();

      if (!extension) {
        console.error('Unable to determine file extension.');
        return;
      }

      const reader = new FileReader();
      reader.addEventListener('progress', (event: ProgressEvent<FileReader>) => {
        scope.emit('progress', {
          loaded: event.loaded,
          total: event.total,
          filename,
        });
      });

      switch (extension) {
        case '3dm': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result;
            if (!contents) return;

            const { Rhino3dmLoader } = await import('three/addons/loaders/3DMLoader.js');

            const loader = new Rhino3dmLoader();
            loader.setLibraryPath('three/addons/libs/rhino3dm/');
            loader.parse(contents as ArrayBuffer, (object) => {
              object.name = filename;
              scope.emit('loaded', object);
            }, (error) => {
              console.error(error);
              scope.emit('loaded', null);
            });
          });
          reader.readAsArrayBuffer(file);
          break;
        }

        case '3ds': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const { TDSLoader } = await import('three/addons/loaders/TDSLoader.js');

            const loader = new TDSLoader();
            const object = loader.parse(event.target?.result as ArrayBuffer, '');
            object.name = filename;
            scope.emit('loaded', object);
          });
          reader.readAsArrayBuffer(file);
          break;
        }

        case '3mf': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js');

            const loader = new ThreeMFLoader() as any;
            const object = loader.parse(event.target?.result as ArrayBuffer, '');
            object.name = filename;
            loader.dispose();
            scope.emit('loaded', object);
          });
          reader.readAsArrayBuffer(file);
          break;
        }

        case 'amf': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const { AMFLoader } = await import('three/addons/loaders/AMFLoader.js');

            const loader = new AMFLoader();
            const amfobject = loader.parse(event.target?.result as ArrayBuffer);
            scope.emit('loaded', amfobject);
          });
          reader.readAsArrayBuffer(file);
          break;
        }

        case 'dae': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as string;
            if (!contents) return;

            const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');

            const loader = new ColladaLoader(manager);
            const collada = loader.parse(contents, '');

            collada.scene.name = filename;
            scope.emit('loaded', collada.scene);
          });
          reader.readAsText(file);
          break;
        }

        case 'drc': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as ArrayBuffer;
            if (!contents) return;

            const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');

            const loader = new DRACOLoader();
            loader.setDecoderPath('three/addons/libs/draco/');
            loader.parse(contents, (geometry) => {
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
              loader.dispose();
              scope.emit('loaded', object);
            });
          });
          reader.readAsArrayBuffer(file);
          break;
        }

        case 'fbx': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as ArrayBuffer;
            if (!contents) return;

            const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');

            const loader = new FBXLoader(manager);
            const object = loader.parse(contents, '');
            object.name = filename;
            scope.emit('loaded', object);
          });
          reader.readAsArrayBuffer(file);
          break;
        }

        case 'glb': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as ArrayBuffer;
            if (!contents) return;

            const loader = await scope.createGLTFLoader();

            loader.parse(contents, '', (result: any) => {
              const scene = result.scene;
              scene.name = filename;

              scene.animations.push(...result.animations);

              if (loader.dracoLoader) loader.dracoLoader.dispose();
              if (loader.ktx2Loader) loader.ktx2Loader.dispose();

              scope.emit('loaded', scene);
            });
          });
          reader.readAsArrayBuffer(file);
          break;
        }

        case 'gltf': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as string;
            if (!contents) return;

            const loader = await scope.createGLTFLoader(manager);

            loader.parse(contents, '', (result: any) => {
              const scene = result.scene;
              scene.name = filename;

              scene.animations.push(...result.animations);

              if (loader.dracoLoader) loader.dracoLoader.dispose();
              if (loader.ktx2Loader) loader.ktx2Loader.dispose();

              scope.emit('loaded', scene);
            });
          });
          reader.readAsText(file);
          break;
        }

        case 'js':
        case 'json': {
          reader.addEventListener('load', (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as string;
            if (!contents) return;

            if (contents.indexOf('postMessage') !== -1) {
              const blob = new Blob([contents], { type: 'text/javascript' });
              const url = URL.createObjectURL(blob);

              const worker = new Worker(url);

              worker.onmessage = ({ data }) => {
                const payload = data;
                payload.metadata = { version: 2 };
                scope.handleJSON(payload);
              };

              worker.postMessage(Date.now());
              return;
            }

            let data: unknown;

            try {
              data = JSON.parse(contents);
            } catch (error) {
              alert(error);
              return;
            }

            scope.handleJSON(data);
          });
          reader.readAsText(file);
          break;
        }

        case 'kmz': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const { KMZLoader } = await import('three/addons/loaders/KMZLoader.js');

            const loader = new KMZLoader() as any;
            const collada = loader.parse(event.target?.result as ArrayBuffer, '');

            collada.scene.name = filename;
            scope.emit('loaded', collada.scene);
          });
          reader.readAsArrayBuffer(file);
          break;
        }

        case 'ldr':
        case 'mpd': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const { LDrawLoader } = await import('three/addons/loaders/LDrawLoader.js');

            const loader = new LDrawLoader();
            loader.setPath('../../examples/models/ldraw/officialLibrary/');
            loader.parse(event.target?.result as string, (group) => {
              group.name = filename;
              group.rotation.x = Math.PI;
              scope.emit('loaded', group);
            });
          });
          reader.readAsText(file);
          break;
        }

        case 'md2': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as ArrayBuffer;
            if (!contents) return;

            const { MD2Loader } = await import('three/addons/loaders/MD2Loader.js');

            const geometry = new MD2Loader().parse(contents) as any;
            const material = new THREE.MeshStandardMaterial();

            const mesh = new THREE.Mesh(geometry, material) as any;
            mesh.mixer = new THREE.AnimationMixer(mesh);
            mesh.name = filename;

            mesh.animations = Array.isArray(geometry.animations) ? [...geometry.animations] : [];
            scope.emit('loaded', mesh as LoaderLoadedPayload);
          });
          reader.readAsArrayBuffer(file);
          break;
        }

        case 'obj': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as string;
            if (!contents) return;

            const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');

            const object = new OBJLoader().parse(contents);
            object.name = filename;
            scope.emit('loaded', object);
          });
          reader.readAsText(file);
          break;
        }

        case 'pcd': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as ArrayBuffer;
            if (!contents) return;

            const { PCDLoader } = await import('three/addons/loaders/PCDLoader.js');

            const points = new PCDLoader().parse(contents);
            points.name = filename;
            scope.emit('loaded', points);
          });
          reader.readAsArrayBuffer(file);
          break;
        }

        case 'ply': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as ArrayBuffer;
            if (!contents) return;

            const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js');

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
            scope.emit('loaded', object);
          });
          reader.readAsArrayBuffer(file);
          break;
        }

        case 'stl': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as ArrayBuffer;
            if (!contents) return;

            const { STLLoader } = await import('three/addons/loaders/STLLoader.js');

            const geometry = new STLLoader().parse(contents);
            const material = new THREE.MeshStandardMaterial();

            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = filename;
            scope.emit('loaded', mesh);
          });

          if (reader.readAsBinaryString !== undefined) {
            reader.readAsBinaryString(file);
          } else {
            reader.readAsArrayBuffer(file);
          }

          break;
        }

        case 'svg': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as string;
            if (!contents) return;

            const { SVGLoader } = await import('three/addons/loaders/SVGLoader.js');

            const loader = new SVGLoader();
            const paths = loader.parse(contents).paths;

            const group = new THREE.Group();
            group.name = filename;
            group.scale.multiplyScalar(0.1);
            group.scale.y *= -1;

            for (let i = 0; i < paths.length; i += 1) {
              const path = paths[i];
              if (!path) continue;

              const material = new THREE.MeshBasicMaterial({
                color: path.color,
                depthWrite: false,
              });

              const shapes = SVGLoader.createShapes(path as any);

              for (let j = 0; j < shapes.length; j += 1) {
                const shape = shapes[j];

                const geometry = new THREE.ShapeGeometry(shape);
                const mesh = new THREE.Mesh(geometry, material);

                group.add(mesh);
              }
            }

            scope.emit('loaded', group);
          });
          reader.readAsText(file);
          break;
        }

        case 'usda': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as string;
            if (!contents) return;

            const { USDLoader } = await import('three/addons/loaders/USDLoader.js');

            const group = new USDLoader().parse(contents);
            group.name = filename;
            scope.emit('loaded', group);
          });
          reader.readAsText(file);
          break;
        }

        case 'usdc':
        case 'usdz': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as ArrayBuffer;
            if (!contents) return;

            const { USDLoader } = await import('three/addons/loaders/USDLoader.js');

            const group = new USDLoader().parse(contents);
            group.name = filename;
            scope.emit('loaded', group);
          });
          reader.readAsArrayBuffer(file);
          break;
        }

        case 'vox': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as ArrayBuffer;
            if (!contents) return;

            const { VOXLoader, VOXMesh } = await import('three/addons/loaders/VOXLoader.js');

            const chunks = new VOXLoader().parse(contents);

            const group = new THREE.Group();
            group.name = filename;

            for (let i = 0; i < chunks.length; i += 1) {
              const chunk = chunks[i];
              if (!chunk) continue;

              const mesh = new VOXMesh(chunk as any);
              group.add(mesh);
            }

            scope.emit('loaded', group);
          });
          reader.readAsArrayBuffer(file);
          break;
        }

        case 'vtk':
        case 'vtp': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as ArrayBuffer;
            if (!contents) return;

            const { VTKLoader } = await import('three/addons/loaders/VTKLoader.js');

            const geometry = (new VTKLoader() as any).parse(contents, '');
            const material = new THREE.MeshStandardMaterial();

            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = filename;
            scope.emit('loaded', mesh);
          });
          reader.readAsArrayBuffer(file);
          break;
        }

        case 'wrl': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as string;
            if (!contents) return;

            const { VRMLLoader } = await import('three/addons/loaders/VRMLLoader.js');

            const result = (new VRMLLoader() as any).parse(contents, '');
            scope.emit('loaded', result);
          });
          reader.readAsText(file);
          break;
        }

        case 'xyz': {
          reader.addEventListener('load', async (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as string;
            if (!contents) return;

            const { XYZLoader } = await import('three/addons/loaders/XYZLoader.js');

            const geometry = (new XYZLoader() as any).parse(contents) as THREE.BufferGeometry;

            const material = new THREE.PointsMaterial();
            material.vertexColors = typeof geometry?.hasAttribute === 'function' ? geometry.hasAttribute('color') : false;

            const points = new THREE.Points(geometry, material);
            points.name = filename;
            scope.emit('loaded', points);
          });
          reader.readAsText(file);
          break;
        }

        case 'zip': {
          reader.addEventListener('load', (event: ProgressEvent<FileReader>) => {
            const contents = event.target?.result as ArrayBuffer;
            if (!contents) return;

            scope.handleZIP(contents);
          });
          reader.readAsArrayBuffer(file);
          break;
        }

        default:
          console.error(`Unsupported file format (${extension}).`);
          break;
      }
    };
  }

  public $on<K extends keyof LoaderEventMap>(event: K, handler: LoaderEventHandler<K>): void {
    const listeners = (this.listeners[event] ??= new Set()) as Set<LoaderEventHandler<K>>;
    listeners.add(handler);
  }

  public $off<K extends keyof LoaderEventMap>(event: K, handler: LoaderEventHandler<K>): void {
    const listeners = this.listeners[event] as Set<LoaderEventHandler<K>> | undefined;
    listeners?.delete(handler);
  }

  private emit<K extends keyof LoaderEventMap>(event: K, payload: LoaderEventMap[K]): void {
    const listeners = this.listeners[event] as Set<LoaderEventHandler<K>> | undefined;
    listeners?.forEach((listener) => {
      listener(payload);
    });
  }

  private handleJSON = (data: any): void => {
    if (data.metadata === undefined) {
      data.metadata = { type: 'Geometry' };
    }

    if (data.metadata.type === undefined) {
      data.metadata.type = 'Geometry';
    }

    if (data.metadata.formatVersion !== undefined) {
      data.metadata.version = data.metadata.formatVersion;
    }

    switch (data.metadata.type.toLowerCase()) {
      case 'buffergeometry': {
        const loader = new THREE.BufferGeometryLoader();
        const result = loader.parse(data);

        const mesh = new THREE.Mesh(result);
        this.emit('loaded', mesh);
        break;
      }

      case 'geometry':
        console.error('Loader: "Geometry" is no longer supported.');
        break;

      case 'object': {
        const loader = new THREE.ObjectLoader();
        loader.setResourcePath(this.texturePath);

        loader.parse(data, (result) => {
          this.emit('loaded', result);
        });
        break;
      }

      case 'app':
        break;

      default:
        console.warn(`Loader: Unhandled metadata type ${data.metadata.type}.`);
        break;
    }
  };

  private handleZIP = async (contents: ArrayBuffer): Promise<void> => {
  const zip = unzipSync(new Uint8Array(contents)) as Record<string, Uint8Array>;

    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      const file = zip[url];

      if (file) {
        console.log('Loading', url);

        const blob = new Blob([file.buffer as ArrayBuffer], { type: 'application/octet-stream' });
        return URL.createObjectURL(blob);
      }

      return url;
    });

    if (zip['model.obj'] && zip['materials.mtl']) {
      const { MTLLoader } = await import('three/addons/loaders/MTLLoader.js');
      const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');

  const materials = (new MTLLoader(manager) as any).parse(strFromU8(zip['materials.mtl']), '');
      const object = new OBJLoader().setMaterials(materials).parse(strFromU8(zip['model.obj']));

      this.emit('loaded', object);
      return;
    }

    for (const path of Object.keys(zip)) {
      const file = zip[path];
      if (!file) continue;

      const extension = path.split('.').pop()?.toLowerCase();

      if (!extension) continue;

      switch (extension) {
        case 'fbx': {
          const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');

          const loader = new FBXLoader(manager);
          const object = loader.parse(file.buffer as ArrayBuffer, '');

          this.emit('loaded', object);
          break;
        }

        case 'glb': {
          const loader = await this.createGLTFLoader();

          loader.parse(file.buffer as ArrayBuffer, '', (result: any) => {
            const scene = result.scene;

            scene.animations.push(...result.animations);

            if (loader.dracoLoader) loader.dracoLoader.dispose();
            if (loader.ktx2Loader) loader.ktx2Loader.dispose();

            this.emit('loaded', scene);
          });
          break;
        }

        case 'gltf': {
          const loader = await this.createGLTFLoader(manager);

          loader.parse(strFromU8(file), '', (result: any) => {
            const scene = result.scene;

            scene.animations.push(...result.animations);

            if (loader.dracoLoader) loader.dracoLoader.dispose();
            if (loader.ktx2Loader) loader.ktx2Loader.dispose();

            this.emit('loaded', scene);
          });
          break;
        }

        default:
          break;
      }
    }
  };

  private createGLTFLoader = async (manager?: THREE.LoadingManager): Promise<any> => {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
    const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
    const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('../examples/jsm/libs/draco/gltf/');

    const ktx2Loader = new KTX2Loader(manager);
    ktx2Loader.setTranscoderPath('../examples/jsm/libs/basis/');

    const loader = new GLTFLoader(manager);
    loader.setDRACOLoader(dracoLoader);
    loader.setKTX2Loader(ktx2Loader);
    loader.setMeshoptDecoder(MeshoptDecoder);

    return loader;
  };
}
