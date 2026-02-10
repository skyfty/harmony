import path from "node:path";
import { fixEsmExtensions } from "../../node/fixEsmExtensions.js";
import { parseArgs } from "../parseArgs.js";

export async function cmdFixEsmExtensions(argv: string[]): Promise<void> {
  const args = parseArgs(argv);

  const root = args.get("root") ?? args.get("rootDir") ?? "dist";
  const skipNodeModules = args.get("skipNodeModules") !== "false";

  const rootDir = path.isAbsolute(root) ? root : path.resolve(process.cwd(), root);
  fixEsmExtensions({ rootDir, skipNodeModules });
}
