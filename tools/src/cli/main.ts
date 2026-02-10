import { cmdGeneratePagesJson } from "./commands/generatePagesJson.js";
import { cmdFixEsmExtensions } from "./commands/fixEsmExtensions.js";
import { cmdSyncScenery } from "./commands/syncScenery.js";

export async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;

  switch (command) {
    case "sync-scenery":
      await cmdSyncScenery(rest);
      return;
    case "generate-pages-json":
      await cmdGeneratePagesJson(rest);
      return;
    case "fix-esm-extensions":
      await cmdFixEsmExtensions(rest);
      return;
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${command}. Run harmony-tools --help`);
  }
}

function printHelp(): void {
  // Minimal help text; keep stable for CI/scripts.
  console.log(`harmony-tools

Commands:
  sync-scenery --mode <viewer-subpackage|consumer-uni-modules> [--repoRoot <path>] [--projectRoot <path>] [--consumerRoot <path>]
  generate-pages-json [--projectRoot <path>] [--pagesDir <path>] [--out <path>] [--home <path>]
  fix-esm-extensions [--root <path>] [--skipNodeModules=false]
`);
}
