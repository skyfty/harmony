import type * as THREE from 'three'

declare module 'three/examples/jsm/utils/SkeletonUtils.js' {
  export function clone<T extends THREE.Object3D>(source: T): T
}
