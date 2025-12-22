import * as GLTFLoaderModule from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as DRACOLoaderModule from 'three/examples/jsm/loaders/DRACOLoader.js';
import * as KTX2LoaderModule from 'three/examples/jsm/loaders/KTX2Loader.js';
import * as TDSLoaderModule from 'three/examples/jsm/loaders/TDSLoader.js';
import * as ThreeMFLoaderModule from 'three/examples/jsm/loaders/3MFLoader.js';
import * as AMFLoaderModule from 'three/examples/jsm/loaders/AMFLoader.js';
import * as ColladaLoaderModule from 'three/examples/jsm/loaders/ColladaLoader.js';
import * as FBXLoaderModule from 'three/examples/jsm/loaders/FBXLoader.js';
import * as KMZLoaderModule from 'three/examples/jsm/loaders/KMZLoader.js';
import * as LDrawLoaderModule from 'three/examples/jsm/loaders/LDrawLoader.js';
import * as MD2LoaderModule from 'three/examples/jsm/loaders/MD2Loader.js';
import * as OBJLoaderModule from 'three/examples/jsm/loaders/OBJLoader.js';
import * as PCDLoaderModule from 'three/examples/jsm/loaders/PCDLoader.js';
import * as PLYLoaderModule from 'three/examples/jsm/loaders/PLYLoader.js';
import * as STLLoaderModule from 'three/examples/jsm/loaders/STLLoader.js';
import * as SVGLoaderModule from 'three/examples/jsm/loaders/SVGLoader.js';
import * as VOXLoaderModule from 'three/examples/jsm/loaders/VOXLoader.js';
import * as VTKLoaderModule from 'three/examples/jsm/loaders/VTKLoader.js';
import * as VRMLLoaderModule from 'three/examples/jsm/loaders/VRMLLoader.js';
import * as XYZLoaderModule from 'three/examples/jsm/loaders/XYZLoader.js';

export const STATIC_LOADER_MODULES = {
  'three/examples/jsm/loaders/GLTFLoader.js': GLTFLoaderModule,
  'three/examples/jsm/loaders/DRACOLoader.js': DRACOLoaderModule,
  'three/examples/jsm/loaders/KTX2Loader.js': KTX2LoaderModule,
  'three/examples/jsm/loaders/TDSLoader.js': TDSLoaderModule,
  'three/examples/jsm/loaders/3MFLoader.js': ThreeMFLoaderModule,
  'three/examples/jsm/loaders/AMFLoader.js': AMFLoaderModule,
  'three/examples/jsm/loaders/ColladaLoader.js': ColladaLoaderModule,
  'three/examples/jsm/loaders/FBXLoader.js': FBXLoaderModule,
  'three/examples/jsm/loaders/KMZLoader.js': KMZLoaderModule,
  'three/examples/jsm/loaders/LDrawLoader.js': LDrawLoaderModule,
  'three/examples/jsm/loaders/MD2Loader.js': MD2LoaderModule,
  'three/examples/jsm/loaders/OBJLoader.js': OBJLoaderModule,
  'three/examples/jsm/loaders/PCDLoader.js': PCDLoaderModule,
  'three/examples/jsm/loaders/PLYLoader.js': PLYLoaderModule,
  'three/examples/jsm/loaders/STLLoader.js': STLLoaderModule,
  'three/examples/jsm/loaders/SVGLoader.js': SVGLoaderModule,
  'three/examples/jsm/loaders/VOXLoader.js': VOXLoaderModule,
  'three/examples/jsm/loaders/VTKLoader.js': VTKLoaderModule,
  'three/examples/jsm/loaders/VRMLLoader.js': VRMLLoaderModule,
  'three/examples/jsm/loaders/XYZLoader.js': XYZLoaderModule,
} as const;
