import * as GLTFLoaderModule from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as DRACOLoaderModule from 'three/examples/jsm/loaders/DRACOLoader.js';

export const STATIC_LOADER_MODULES = {
  'three/examples/jsm/loaders/GLTFLoader.js': GLTFLoaderModule,
  'three/examples/jsm/loaders/DRACOLoader.js': DRACOLoaderModule,
} as const;
