#!/usr/bin/env node
const { resolve } = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')

const args = process.argv.slice(2)
const command = args[0] || 'build'

async function removeDir(target) {
  await fsp.rm(target, { recursive: true, force: true })
}

async function copyDir(src, dest) {
  const stats = await fsp.stat(src)
  if (!stats.isDirectory()) {
    await fsp.mkdir(dirname(dest), { recursive: true })
    await fsp.copyFile(src, dest)
    return
  }
  await fsp.mkdir(dest, { recursive: true })
  const entries = await fsp.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const from = resolve(src, entry.name)
    const to = resolve(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDir(from, to)
    } else if (entry.isSymbolicLink()) {
      const link = await fsp.readlink(from)
      await fsp.symlink(link, to)
    } else {
      await fsp.copyFile(from, to)
    }
  }
}

async function runBuild() {
  const projectRoot = resolve(__dirname, '../../')
  const packageJson = JSON.parse(fs.readFileSync(resolve(projectRoot, 'package.json'), 'utf8'))
  const dependencies = Object.keys(packageJson.dependencies || {})

  if (!dependencies.length) {
    console.info('No dependencies to process for miniprogram npm build')
    return
  }

  const miniProgramRoot = resolve(projectRoot, 'miniprogram')
  const targetRoot = resolve(miniProgramRoot, 'miniprogram_npm')
  await removeDir(targetRoot)
  await fsp.mkdir(targetRoot, { recursive: true })

  for (const dep of dependencies) {
    const sourceDir = resolve(projectRoot, 'node_modules', dep)
    try {
      await fsp.access(sourceDir)
    } catch (error) {
      console.warn(`Skipping ${dep}: not installed`)
      continue
    }
    const destinationDir = resolve(targetRoot, dep)
    console.info(`Copying ${dep} -> ${destinationDir}`)
    await copyDir(sourceDir, destinationDir)
  }
}

if (command === 'build') {
  runBuild().catch((error) => {
    console.error(error)
    process.exit(1)
  })
} else {
  console.error(`Unknown command: ${command}`)
  process.exit(1)
}
