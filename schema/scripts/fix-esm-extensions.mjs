import fs from 'node:fs'
import path from 'node:path'

const KNOWN_EXT_RE = /\.(mjs|cjs|js|json|node)$/i

function hasKnownExt(specifier) {
  return KNOWN_EXT_RE.test(specifier)
}

function rewriteSpecifier(filePath, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return null
  }
  if (hasKnownExt(specifier)) {
    return null
  }

  const baseDir = path.dirname(filePath)
  const abs = path.resolve(baseDir, specifier)
  const fileJs = `${abs}.js`
  const fileJson = `${abs}.json`
  const fileNode = `${abs}.node`
  const dirIndex = path.join(abs, 'index.js')

  if (fs.existsSync(fileJs)) return `${specifier}.js`
  if (fs.existsSync(fileJson)) return `${specifier}.json`
  if (fs.existsSync(fileNode)) return `${specifier}.node`
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory() && fs.existsSync(dirIndex)) {
    return specifier.endsWith('/') ? `${specifier}index.js` : `${specifier}/index.js`
  }

  return null
}

function processFile(content, filePath) {
  let changed = false

  content = content.replace(/(from\s*['"])(\.\.?\/[^'"\)]+)(['"])/g, (match, prefix, specifier, suffix) => {
    const replacement = rewriteSpecifier(filePath, specifier)
    if (!replacement) {
      return match
    }
    changed = true
    return `${prefix}${replacement}${suffix}`
  })

  content = content.replace(/(import\s*['"])(\.\.?\/[^'"\)]+)(['"])/g, (match, prefix, specifier, suffix) => {
    const replacement = rewriteSpecifier(filePath, specifier)
    if (!replacement) {
      return match
    }
    changed = true
    return `${prefix}${replacement}${suffix}`
  })

  content = content.replace(/(import\(\s*['"])(\.\.?\/[^'"\)]+)(['"][^)]*\))/g, (match, prefix, specifier, suffix) => {
    const replacement = rewriteSpecifier(filePath, specifier)
    if (!replacement) {
      return match
    }
    changed = true
    return `${prefix}${replacement}${suffix}`
  })

  return { changed, content }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const targetPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') {
        continue
      }
      walk(targetPath)
      continue
    }
    if (!entry.isFile() || !targetPath.endsWith('.js')) {
      continue
    }
    const source = fs.readFileSync(targetPath, 'utf8')
    const result = processFile(source, targetPath)
    if (result.changed) {
      fs.writeFileSync(targetPath, result.content, 'utf8')
    }
  }
}

const targetRoot = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : path.resolve(process.cwd(), 'dist')
if (!fs.existsSync(targetRoot)) {
  throw new Error(`Directory not found: ${targetRoot}`)
}
walk(targetRoot)