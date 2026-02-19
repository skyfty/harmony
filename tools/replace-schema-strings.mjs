import fs from 'fs/promises'
import path from 'path'

const root = path.resolve('editor', 'src')
const exts = new Set(['.ts', '.tsx', '.vue', '.js'])

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full)
      continue
    }
    if (!exts.has(path.extname(entry.name))) continue
    let text = await fs.readFile(full, 'utf8')
    const replaced = text
      .replace(/(["'])@schema\//g, "$1@harmony/schema/")
      .replace(/(["'])@schema(["'])/g, "$1@harmony/schema$2")
    if (replaced !== text) {
      await fs.writeFile(full, replaced, 'utf8')
      console.log('Updated', path.relative(root, full))
    }
  }
}

(async () => {
  await walk(root)
  console.log('Done')
})()
