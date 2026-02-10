import path from "node:path";
import { walkFiles, writeJsonPretty } from "../node/fsUtils.js";
import { toPosixPath } from "../node/pathUtils.js";

const SRC_DIRNAME = "src";
const UNI_PAGES_PREFIX = "pages/";
const SCENERY_ROOT = "pages/scenery";
const SCENERY_PREFIX = `${SCENERY_ROOT}/`;

export type GeneratePagesJsonOptions = {
  projectRoot: string;
  pagesDir: string;
  outPath: string;
  home: string; // e.g. pages/home/index
};

export async function generatePagesJson(options: GeneratePagesJsonOptions): Promise<void> {
  const pagePaths = collectUniPagePaths(options.pagesDir, options.projectRoot);
  const sorted = sortWithHomeFirst(dedupe(pagePaths), options.home);

  const { mainPages, sceneryPages } = splitSceneryPages(sorted);

  const pages = mainPages.map((pagePath) => ({ path: pagePath }));
  const subPackages = sceneryPages.length
    ? [
        {
          root: SCENERY_ROOT,
          pages: sceneryPages.map((pagePath) => ({ path: pagePath.slice(SCENERY_PREFIX.length) })),
        },
      ]
    : undefined;

  const json = {
    pages,
    ...(subPackages ? { subPackages } : {}),
    globalStyle: {
      navigationStyle: "custom",
      navigationBarTextStyle: "white",
      navigationBarBackgroundColor: "#F8F8F8",
      backgroundColor: "#F8F8F8",
    },
  };

  writeJsonPretty(options.outPath, json);
  console.log(`[harmony-tools] generated pages.json -> ${options.outPath}`);
}

function toUniPagePath(absVueFile: string, projectRoot: string): string {
  const srcRoot = path.resolve(projectRoot, SRC_DIRNAME);
  const relFromSrc = toPosixPath(path.relative(srcRoot, absVueFile));
  if (!relFromSrc.startsWith(UNI_PAGES_PREFIX)) return "";
  return relFromSrc.replace(/\.vue$/, "");
}

function collectUniPagePaths(pagesDir: string, projectRoot: string): string[] {
  const vueFiles = walkFiles(pagesDir, (absPath) => absPath.endsWith(".vue"));
  return vueFiles
    .map((absVue) => toUniPagePath(absVue, projectRoot))
    .filter((p) => p.startsWith(UNI_PAGES_PREFIX));
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function sortWithHomeFirst(pagePaths: string[], home: string): string[] {
  return pagePaths.sort((a, b) => {
    if (a === home) return -1;
    if (b === home) return 1;
    return a.localeCompare(b);
  });
}

function splitSceneryPages(pagePaths: string[]): { mainPages: string[]; sceneryPages: string[] } {
  const mainPages: string[] = [];
  const sceneryPages: string[] = [];

  for (const pagePath of pagePaths) {
    if (pagePath.startsWith(SCENERY_PREFIX)) sceneryPages.push(pagePath);
    else mainPages.push(pagePath);
  }

  return { mainPages, sceneryPages };
}
