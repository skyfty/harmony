#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const glob = require('glob')

const root = path.resolve(__dirname, '..', 'editor', 'src')
const patterns = ['**/*.ts', '**/*.tsx', '**/*.vue', '**/*.js']

let changed = 0
for (const pattern of patterns) {
  const files = glob.sync(pattern, { cwd: root, absolute: true })
  for (const file of files) {
    let text = fs.readFileSync(file, 'utf8')
    const replaced = text.replace(/@schema(\/|\b)/g, '@harmony/schema$1')
    if (replaced !== text) {
      fs.writeFileSync(file, replaced, 'utf8')
      changed += 1
      console.log('Updated', path.relative(root, file))
    }
  }
}
console.log('Done. Files changed:', changed)
process.exit(0)
