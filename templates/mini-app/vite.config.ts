import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';

const packagesRoot = '__PACKAGES_RELATIVE__';

export default defineConfig({
  plugins: [uni()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@mini-platform/core': `${packagesRoot}/mini-platform-core/src/index.ts`,
      '@mini-platform/adapters': `${packagesRoot}/mini-platform-adapters/src/index.ts`
    }
  }
});
