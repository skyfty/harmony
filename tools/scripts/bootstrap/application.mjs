import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapSharedDependencies } from './shared-dependencies.mjs';

function runCommand(command, args, cwd) {
  const quoted = [command, ...args].map((part) => {
    if (/[\s"&()<>|^]/.test(part)) {
      return `"${part.replaceAll('"', '\\"')}"`;
    }
    return part;
  });

  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', quoted.join(' ')], {
    cwd,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${quoted.join(' ')}`);
  }
}

export function bootstrapApplication(appName, scope, mode, repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')) {
  if (!appName) {
    throw new Error('bootstrap requires an app name, for example: viewer, tour, editor, exhibition');
  }

  const appRoot = resolve(repoRoot, appName);
  bootstrapSharedDependencies(repoRoot);

  if (appName === 'viewer' || appName === 'tour') {
    if (scope === 'mp' || scope === 'h5') {
      runCommand('pnpm', ['run', mode === 'dev' ? 'sync:scenery:dev' : 'sync:scenery'], appRoot);
    }
  }
}
