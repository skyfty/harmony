import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { optimize, type PluginConfig } from "svgo";
import { Resvg } from "@resvg/resvg-js";
import { ensureDir, rmrf, walkFiles } from "../node/fsUtils.js";

export type ProcessSvgIconsOptions = {
  projectRoot: string;
  /** Relative to projectRoot. Default: assets/svg-icons */
  inDir?: string;
  /** Relative to projectRoot. Default: src/static/svg-icons */
  outDir?: string;
  /** Output PNG width in px. Default: 96 */
  size?: number;
  /** If true, remove outDir before generating. Default: false */
  clean?: boolean;
  /** If true, print per-file logs. Default: false */
  verbose?: boolean;
};

export type ProcessSvgIconsResult = {
  inputDir: string;
  outputDir: string;
  size: number;
  processed: number;
  failed: number;
  failures: Array<{ file: string; error: string }>;
};

export async function processSvgIcons(
  options: ProcessSvgIconsOptions,
): Promise<ProcessSvgIconsResult> {
  const inputDirRel = options.inDir ?? "assets/svg-icons";
  const outDirRel = options.outDir ?? "src/static/icons";
  const size = normalizeSize(options.size);

  const inputDir = resolveInsideProject(options.projectRoot, inputDirRel);
  const outputDir = resolveInsideProject(options.projectRoot, outDirRel);

  if (!fs.existsSync(inputDir)) {
    return {
      inputDir,
      outputDir,
      size,
      processed: 0,
      failed: 0,
      failures: [],
    };
  }

  if (options.clean) {
    rmrf(outputDir);
  }
  ensureDir(outputDir);

  const svgFiles = walkFiles(inputDir, (absPath) => absPath.toLowerCase().endsWith(".svg"));

  let processed = 0;
  const failures: ProcessSvgIconsResult["failures"] = [];

  for (const svgAbsPath of svgFiles) {
    const relFromInput = path.relative(inputDir, svgAbsPath);
    const relPngPath = relFromInput.replace(/\.svg$/i, ".png");
    const outAbsPath = path.join(outputDir, relPngPath);

    try {
      const rawSvg = await fsp.readFile(svgAbsPath, "utf-8");
      const optimizedSvg = optimizeSvg(rawSvg);
      const png = renderSvgToPng(optimizedSvg, size);

      ensureDir(path.dirname(outAbsPath));
      await fsp.writeFile(outAbsPath, png);
      processed++;

      if (options.verbose) {
        // eslint-disable-next-line no-console
        console.log(`[process-svg-icons] ${toPosix(relFromInput)} -> ${toPosix(path.relative(outputDir, outAbsPath))}`);
      }
    } catch (err) {
      failures.push({
        file: svgAbsPath,
        error: err instanceof Error ? err.message : String(err),
      });
      if (options.verbose) {
        // eslint-disable-next-line no-console
        console.error(`[process-svg-icons] Failed: ${svgAbsPath}`);
      }
    }
  }

  const result: ProcessSvgIconsResult = {
    inputDir,
    outputDir,
    size,
    processed,
    failed: failures.length,
    failures,
  };

  if (failures.length > 0) {
    const preview = failures
      .slice(0, 5)
      .map((f) => `- ${f.file}: ${f.error}`)
      .join("\n");

    throw new Error(
      `process-svg-icons: ${failures.length} file(s) failed.\n${preview}` +
        (failures.length > 5 ? `\n- ...and ${failures.length - 5} more` : ""),
    );
  }

  return result;
}

function optimizeSvg(raw: string): string {
  const plugins: PluginConfig[] = ["preset-default"];

  return optimize(raw, {
    multipass: true,
    plugins,
  }).data;
}

function renderSvgToPng(svg: string, widthPx: number): Uint8Array {
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: widthPx,
    },
  });

  return resvg.render().asPng();
}

function normalizeSize(size: number | undefined): number {
  if (!size) return 96;
  if (!Number.isFinite(size) || size <= 0) return 96;
  return Math.floor(size);
}

function resolveInsideProject(projectRoot: string, relPath: string): string {
  const absProjectRoot = path.isAbsolute(projectRoot)
    ? projectRoot
    : path.resolve(process.cwd(), projectRoot);
  return path.resolve(absProjectRoot, relPath);
}

function toPosix(p: string): string {
  return p.replaceAll("\\\\", "/");
}
