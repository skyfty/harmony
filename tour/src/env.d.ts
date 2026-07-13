/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MINI_API_BASE?: string
  readonly VITE_MINI_TEST_API_BASE?: string
  readonly VITE_MINI_DOWNLOAD_CDN_BASE?: string
  readonly VITE_MINI_APP_ID?: string
  readonly VITE_MINI_APP_KEY?: string
  readonly VITE_MINI_AUTO_LOGIN?: string
  readonly VITE_MINI_TEST_USER?: string
  readonly VITE_MINI_TEST_DISPLAY_NAME?: string
  readonly VITE_MINI_TEST_USERNAME?: string
  readonly VITE_MINI_TEST_PASSWORD?: string
  readonly VITE_MINI_USE_TEST_LOGIN?: string
  readonly VITE_SCENERY_ENABLE_GLTF_DRACO?: string
  readonly VITE_SCENERY_ENABLE_GLTF_KTX2?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}


declare module '*.vue' {
  import { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  const component: DefineComponent<{}, {}, any>
  export default component
}
