import path from "node:path";
import { generatePagesJson } from "../../uniapp/generatePagesJson.js";
import { parseArgs } from "../parseArgs.js";

export async function cmdGeneratePagesJson(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const projectRoot = resolveMaybe(args.get("projectRoot"), process.cwd());

  const pagesDir = resolveMaybe(args.get("pagesDir"), path.join(projectRoot, "src/pages"));
  const outPath = resolveMaybe(args.get("out"), path.join(projectRoot, "src/pages.json"));
  const home = args.get("home") ?? "pages/home/index";

  await generatePagesJson({ projectRoot, pagesDir, outPath, home });
}

function resolveMaybe(p: string | undefined, base: string): string {
  if (!p) return base;
  return path.isAbsolute(p) ? p : path.resolve(base, p);
}
