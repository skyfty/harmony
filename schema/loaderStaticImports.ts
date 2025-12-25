import * as GLTFLoaderModule from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as DRACOLoaderModule from 'three/examples/jsm/loaders/DRACOLoader.js';
import * as KTX2LoaderModule from 'three/examples/jsm/loaders/KTX2Loader.js';
import * as FBXLoaderModule from 'three/examples/jsm/loaders/FBXLoader.js';
import * as LDrawLoaderModule from 'three/examples/jsm/loaders/LDrawLoader.js';
import * as OBJLoaderModule from 'three/examples/jsm/loaders/OBJLoader.js';

export const STATIC_LOADER_MODULES = {
  'three/examples/jsm/loaders/GLTFLoader.js': GLTFLoaderModule,
  'three/examples/jsm/loaders/DRACOLoader.js': DRACOLoaderModule,
  'three/examples/jsm/loaders/KTX2Loader.js': KTX2LoaderModule,
  'three/examples/jsm/loaders/FBXLoader.js': FBXLoaderModule,
  'three/examples/jsm/loaders/LDrawLoader.js': LDrawLoaderModule,
  'three/examples/jsm/loaders/OBJLoader.js': OBJLoaderModule,
} as const;
