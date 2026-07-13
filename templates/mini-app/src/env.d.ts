/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MINI_API_BASE?: string;
  readonly VITE_MINI_TEST_API_BASE?: string;
  readonly VITE_MINI_APP_ID?: string;
  readonly VITE_MINI_APP_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
