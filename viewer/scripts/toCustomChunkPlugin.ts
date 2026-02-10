import type { Plugin } from "vite";

type ManualChunksConfig = Record<string, string[]>;

export interface ToCustomChunkPluginOptions {
  manualChunks: ManualChunksConfig;
  enabled?: boolean;
}

function normalizeId(id: string): string {
  return id.replace(/\\/g, "/");
}

function hasWildcard(pattern: string): boolean {
  return pattern.includes("*");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wildcardToRegExp(pattern: string): RegExp {
  // Supports '*' and '**' in a filesystem-ish style, matching within a path.
  // We intentionally do not anchor, because Rollup/Vite ids are full paths.
  const normalized = normalizeId(pattern);
  const escaped = escapeRegExp(normalized)
    .replace(/\\\*\\\*\//g, "(?:.*?/)?")
    .replace(/\\\*\\\*/g, ".*")
    .replace(/\\\*/g, "[^/]*");
  return new RegExp(escaped);
}

function matchesPattern(id: string, pattern: string): boolean {
  const normalizedId = normalizeId(id);
  const normalizedPattern = normalizeId(pattern);

  if (hasWildcard(normalizedPattern)) {
    return wildcardToRegExp(normalizedPattern).test(normalizedId);
  }

  // Treat bare package names and subpaths as node_modules lookups.
  // Example: 'three' => .../node_modules/three/...
  // Example: 'three/examples/jsm' => .../node_modules/three/examples/jsm/...
  const nodeModulesNeedle = `/node_modules/${normalizedPattern}/`;
  if (normalizedId.includes(nodeModulesNeedle)) return true;

  // Some ids can be virtual or resolved without the trailing '/'
  // e.g. .../node_modules/three/build/three.module.js
  if (!normalizedPattern.includes("/") && normalizedId.includes(`/node_modules/${normalizedPattern}`)) {
    return true;
  }

  return false;
}

function createMatchTable(manualChunks: ManualChunksConfig): Array<{ chunkName: string; patterns: string[] }> {
  return Object.entries(manualChunks).map(([chunkName, patterns]) => ({
    chunkName,
    patterns: Array.isArray(patterns) ? patterns : [],
  }));
}

function wrapManualChunks(
  previous: unknown,
  matchTable: Array<{ chunkName: string; patterns: string[] }>,
): (id: string, meta: any) => string | undefined {
  const previousFn = typeof previous === "function" ? (previous as (id: string, meta: any) => string | undefined) : undefined;
  const previousObj = previous && typeof previous === "object" ? (previous as Record<string, string[]>) : undefined;

  return (id: string, meta: any) => {
    for (const { chunkName, patterns } of matchTable) {
      for (const pattern of patterns) {
        if (matchesPattern(id, pattern)) return chunkName;
      }
    }

    if (previousFn) return previousFn(id, meta);

    if (previousObj) {
      // Rollup supports object-form manualChunks: { chunkName: [moduleIds...] }
      // We only support exact id matches here.
      const normalizedId = normalizeId(id);
      for (const [chunkName, ids] of Object.entries(previousObj)) {
        if (ids?.some((x) => normalizeId(x) === normalizedId)) return chunkName;
      }
    }

    return undefined;
  };
}

export default function toCustomChunkPlugin(options: ToCustomChunkPluginOptions): Plugin {
  const enabled = options.enabled ?? true;
  const matchTable = createMatchTable(options.manualChunks ?? {});

  return {
    name: "to-custom-chunk",
    apply: "build",
    config(config) {
      if (!enabled) return;

      const isMp = (process.env.UNI_PLATFORM ?? "").startsWith("mp-");
      if (!isMp) return;

      const rollupOptions = (config.build ??= {}).rollupOptions ?? (config.build!.rollupOptions = {});
      const output = (rollupOptions.output ??= {} as any);

      const patchOneOutput = (out: any) => {
        out.manualChunks = wrapManualChunks(out.manualChunks, matchTable);
      };

      if (Array.isArray(output)) {
        for (const out of output) patchOneOutput(out);
      } else {
        patchOneOutput(output);
      }
    },
  };
}
