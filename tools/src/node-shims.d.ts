declare module "node:fs" {
  const fs: any;
  export default fs;
}

declare module "node:fs/promises" {
  const fsp: any;
  export default fsp;
}

declare module "node:path" {
  const path: any;
  export default path;
}

declare module "vite" {
  export interface Plugin {
    [key: string]: unknown;
  }

  export interface UserConfig {
    build?: {
      rollupOptions?: {
        output?: unknown;
      };
    };
    [key: string]: unknown;
  }
}

declare module "svgo" {
  export type PluginConfig = unknown;
  export function optimize(svg: string, config?: unknown): any;
}

declare module "@resvg/resvg-js" {
  export class Resvg {
    constructor(svg: string, options?: unknown);
    render(): { asPng(): Uint8Array };
  }
}

declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

declare const process: {
  argv: string[];
  cwd(): string;
  env: Record<string, string | undefined>;
  exitCode?: number;
};