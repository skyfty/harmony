import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

export function bootstrapSharedDependencies(repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')) {
  const packages = [
    'utils',
    'physics-core',
    'physics-bridge',
    'schema',
    'tools',
    'physics-ammo',
    'physics-cannon',
  ];

  for (const packageName of packages) {
    rmSync(resolve(repoRoot, packageName, 'dist'), { recursive: true, force: true });
  }

  for (const packageName of packages) {
    runCommand('pnpm', ['--dir', resolve(repoRoot, packageName), 'run', 'build'], repoRoot);
  }
}
