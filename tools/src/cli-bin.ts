#!/usr/bin/env node
import { main } from "./cli/main.js";

main(process.argv.slice(2)).catch((err) => {
  // Keep output readable in npm scripts
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
