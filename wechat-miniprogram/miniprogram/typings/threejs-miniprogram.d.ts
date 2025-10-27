declare module 'miniprogram_npm/threejs-miniprogram/index' {
  export * from 'threejs-miniprogram'
}

declare module 'threejs-miniprogram' {
  export function createScopedThreejs(canvas: any): any
}

declare module 'threejs-miniprogram/plugins/OrbitControls' {
  const register: (THREE: any) => void
  export = register
}

declare module 'threejs-miniprogram/loaders/GLTFLoader' {
  const register: (THREE: any) => void
  export = register
}
