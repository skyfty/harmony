import path from "node:path";
import { walkFiles, writeJsonPretty } from "../node/fsUtils.js";
import { toPosixPath } from "../node/pathUtils.js";

export type GeneratePagesJsonOptions = {
  projectRoot: string;
  pagesDir: string;
  outPath: string;
  home: string; // e.g. pages/home/index
};

export async function generatePagesJson(options: GeneratePagesJsonOptions): Promise<void> {
  const vueFiles = walkFiles(options.pagesDir, (absPath) => absPath.endsWith(".vue"));

  const pagePaths = vueFiles
    .map((absVue) => toUniPagePath(absVue, options.projectRoot))
    .filter((p) => p.startsWith("pages/"));

  const unique = Array.from(new Set(pagePaths));

  unique.sort((a, b) => {
    if (a === options.home) return -1;
    if (b === options.home) return 1;
    return a.localeCompare(b);
  });

  const pages = unique.map((p) => ({ path: p }));

  // Keep behavior consistent with existing exhibition script.
  const json = {
    pages,
    globalStyle: {
      navigationStyle: "custom",
      navigationBarTextStyle: "white",
      navigationBarBackgroundColor: "#F8F8F8",
      backgroundColor: "#F8F8F8",
    }
  };

  writeJsonPretty(options.outPath, json);
  console.log(`[harmony-tools] generated pages.json -> ${options.outPath}`);
}

function toUniPagePath(absVueFile: string, projectRoot: string): string {
  const srcRoot = path.resolve(projectRoot, "src");
  const relFromSrc = toPosixPath(path.relative(srcRoot, absVueFile));
  if (!relFromSrc.startsWith("pages/")) return "";
  return relFromSrc.replace(/\.vue$/, "");
}
