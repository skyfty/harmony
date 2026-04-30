export async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;

  switch (command) {
    case "sync-scenery":
      {
        const { cmdSyncScenery } = await import("./commands/syncScenery.js");
        await cmdSyncScenery(rest);
        return;
      }
    case "generate-pages-json":
      {
        const { cmdGeneratePagesJson } = await import("./commands/generatePagesJson.js");
        await cmdGeneratePagesJson(rest);
        return;
      }
    case "fix-esm-extensions":
      {
        const { cmdFixEsmExtensions } = await import("./commands/fixEsmExtensions.js");
        await cmdFixEsmExtensions(rest);
        return;
      }
    case "process-svg-icons":
      {
        const { cmdProcessSvgIcons } = await import("./commands/processSvgIcons.js");
        await cmdProcessSvgIcons(rest);
        return;
      }
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
  sync-scenery --mode <subpackage-uni-modules|consumer-uni-modules> [--repoRoot <path>] [--projectRoot <path>] [--consumerRoot <path>] [--dest <path>] [--subpackageRoot <path>] [--moduleName <name>]
    (viewer-subpackage is supported as an alias of subpackage-uni-modules)
  generate-pages-json [--projectRoot <path>] [--pagesDir <path>] [--out <path>] [--home <path>]
  fix-esm-extensions [--root <path>] [--skipNodeModules=false]
  process-svg-icons [--project <path>] [--in <relPath>] [--out <relPath>] [--size <px>] [--clean] [--verbose]
`);
}
