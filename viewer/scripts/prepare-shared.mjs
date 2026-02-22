import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentFile = fileURLToPath(import.meta.url)
const scriptDir = dirname(currentFile)
const projectRoot = resolve(scriptDir, '..')
const viteDepsDir = resolve(projectRoot, 'node_modules/.vite/deps')

execSync('pnpm --dir ../utils run build', {
  cwd: projectRoot,
  stdio: 'inherit',
})

rmSync(viteDepsDir, { recursive: true, force: true })
