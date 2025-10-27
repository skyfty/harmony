#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const sourceDir = path.join(projectRoot, 'node_modules', 'threejs-miniprogram', 'dist')
const targetDir = path.join(projectRoot, 'miniprogram', 'miniprogram_npm', 'threejs-miniprogram')

function copyRecursive(src, dest) {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry))
    }
    return
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
}

function main() {
  if (!fs.existsSync(sourceDir)) {
    console.error('[sync-threejs-npm] Missing dependency: could not find threejs-miniprogram in node_modules.')
    console.error('Run "npm install" inside wechat-miniprogram before syncing the npm bundle.')
    process.exit(1)
  }

  fs.rmSync(targetDir, { recursive: true, force: true })
  fs.mkdirSync(targetDir, { recursive: true })

  copyRecursive(sourceDir, targetDir)

  const licensePath = path.join(projectRoot, 'node_modules', 'threejs-miniprogram', 'LICENSE')
  if (fs.existsSync(licensePath)) {
    fs.copyFileSync(licensePath, path.join(targetDir, 'LICENSE'))
  }

  const pkgPath = path.join(projectRoot, 'node_modules', 'threejs-miniprogram', 'package.json')
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    const slimPkg = {
      name: pkg.name,
      version: pkg.version,
      main: 'index.js',
      license: pkg.license,
    }
    fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(slimPkg, null, 2))
  }

  console.log('[sync-threejs-npm] Copied threejs-miniprogram into miniprogram/miniprogram_npm.')
}

main()
