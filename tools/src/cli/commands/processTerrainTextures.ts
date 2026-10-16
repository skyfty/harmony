import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "../parseArgs.js";

interface TerrainTextureManifestEntry {
  id?: string;
  image?: string;
  ktx2?: string;
  ktx2Bytes?: number;
  width?: number;
  height?: number;
  bytes?: number;
  mimeType?: string;
}

interface TerrainTextureManifest {
  version?: number;
  glb?: string;
  textures?: TerrainTextureManifestEntry[];
}

function isToktxAvailable(): boolean {
  for (const command of ["toktx", "toktx.exe"]) {
    const probe = spawnSync(command, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Generates KTX2/Basis variants for the JPEG/PNG files referenced by a terrain
 * package manifest (`textures.json` written by the 3dtiles-viewer export).
 *
 * JPEG files always remain in place as the mini-program fallback; the `ktx2`
 * field is only written for entries whose transcode succeeded. Requires the
 * `toktx` binary from KTX-Software on PATH; when it is missing the command
 * exits successfully without modifying anything.
 */
export async function cmdProcessTerrainTextures(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const args = parseArgs(argv);
  const manifestPathRaw = args.get("manifest") ?? "textures.json";
  const manifestPath = path.isAbsolute(manifestPathRaw)
    ? manifestPathRaw
    : path.resolve(process.cwd(), manifestPathRaw);
  const textureDir = path.resolve(args.get("textureDir") ?? path.dirname(manifestPath));
  const verbose = args.get("verbose") === "true";

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`[process-terrain-textures] Manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as TerrainTextureManifest;
  const textures = manifest.textures;
  if (!Array.isArray(textures)) {
    throw new Error(`[process-terrain-textures] Manifest has no textures array: ${manifestPath}`);
  }

  if (!isToktxAvailable()) {
    // eslint-disable-next-line no-console
    console.log(
      "[process-terrain-textures] toktx (KTX-Software) is not on PATH; skipped KTX2 generation. JPEG files remain the runtime fallback.",
    );
    return;
  }

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of textures) {
    const sourceRel = entry.image;
    if (!sourceRel) {
      skipped += 1;
      continue;
    }
    if (entry.ktx2) {
      skipped += 1;
      continue;
    }
    const sourcePath = path.resolve(textureDir, sourceRel);
    if (!fs.existsSync(sourcePath)) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.warn(`[process-terrain-textures] Missing source texture, skipping: ${sourcePath}`);
      continue;
    }
    const outputPath = sourcePath.replace(/\.(jpe?g|png)$/i, "") + ".ktx2";
    const transcode = spawnSync(
      "toktx",
      [
        "--encode", "etc1s",
        "--genmipmap",
        "--assign_oetf", "srgb",
        "--convert_oetf", "srgb",
        outputPath,
        sourcePath,
      ],
      { encoding: "utf8" },
    );
    if (transcode.status !== 0 || !fs.existsSync(outputPath)) {
      failed += 1;
      // eslint-disable-next-line no-console
      console.warn(
        `[process-terrain-textures] toktx failed for ${sourcePath}: ${String(transcode.stderr ?? transcode.error ?? "").trim()}`,
      );
      continue;
    }
    const relative = path.relative(path.dirname(manifestPath), outputPath).split(path.sep).join("/");
    entry.ktx2 = relative;
    entry.ktx2Bytes = fs.statSync(outputPath).size;
    generated += 1;
    if (verbose) {
      // eslint-disable-next-line no-console
      console.log(`[process-terrain-textures] ${relative} (${entry.ktx2Bytes} bytes)`);
    }
  }

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(
    `[process-terrain-textures] KTX2 generated=${generated} skipped=${skipped} failed=${failed} manifest=${manifestPath}`,
  );
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`process-terrain-textures

Usage:
  harmony-tools process-terrain-textures [--manifest <path>] [--textureDir <dir>] [--verbose]

Defaults:
  --manifest    textures.json (relative to cwd)
  --textureDir  directory containing --manifest

Notes:
  - Requires the toktx binary from KTX-Software on PATH.
  - Writes <name>.ktx2 next to each source JPEG/PNG and adds the "ktx2" field
    (plus "ktx2Bytes") to the manifest entries. Entries whose transcode fails
    are left without a ktx2 field; JPEG remains the runtime fallback.
`);
}

