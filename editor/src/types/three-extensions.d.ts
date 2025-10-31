import type * as THREE from 'three'

declare module 'three/examples/jsm/utils/SkeletonUtils.js' {
  export function clone<T extends THREE.Object3D>(source: T): T
}

declare module 'three/examples/jsm/loaders/GLTFLoader.js' {
  export * from 'three/examples/jsm/loaders/GLTFLoader'
}

declare module 'three/examples/jsm/loaders/DRACOLoader.js' {
  export * from 'three/examples/jsm/loaders/DRACOLoader'
}
