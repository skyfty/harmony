import path from "node:path";
import { processSvgIcons } from "../../uniapp/processSvgIcons.js";
import { parseArgs } from "../parseArgs.js";

export async function cmdProcessSvgIcons(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const args = parseArgs(argv);

  const projectRoot = args.get("project") ?? args.get("projectRoot") ?? process.cwd();
  const inDir = args.get("in") ?? "assets/svg-icons";
  const outDir = args.get("out") ?? "src/static/icons";

  const sizeRaw = args.get("size");
  const size = sizeRaw ? Number.parseInt(sizeRaw, 10) : undefined;

  const clean = args.get("clean") === "true";
  const verbose = args.get("verbose") === "true";

  const result = await processSvgIcons({
    projectRoot: path.isAbsolute(projectRoot) ? projectRoot : path.resolve(process.cwd(), projectRoot),
    inDir,
    outDir,
    size,
    clean,
    verbose,
  });

  if (result.processed === 0) {
    // eslint-disable-next-line no-console
    console.log(`[process-svg-icons] No SVG files found under: ${result.inputDir}`);
    return;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[process-svg-icons] Generated ${result.processed} PNG(s) into: ${result.outputDir} (size=${result.size}px)`,
  );
}

function printHelp(): void {
  // Keep stable for scripts/CI.
  // eslint-disable-next-line no-console
  console.log(`process-svg-icons

Usage:
  harmony-tools process-svg-icons [--project <path>] [--in <relPath>] [--out <relPath>] [--size <px>] [--clean] [--verbose]

Defaults:
  --project   <cwd>
  --in        assets/svg-icons
  --out       src/static/icons
  --size      96

Notes:
  - Scans --in recursively for *.svg
  - Writes PNG files to --out, preserving relative directory structure
  - Keeps source SVG files unchanged
`);
}
