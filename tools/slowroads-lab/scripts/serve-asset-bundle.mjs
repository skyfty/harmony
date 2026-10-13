#!/usr/bin/env node
/**
 * Minimal static server used by the lab's "server" asset source mode.
 *
 * The final deployment downloads slowroads assets from the asset server on
 * demand (mini program: wx.request through the asset download worker; H5:
 * fetch). This server simulates that endpoint from the local materialised
 * bundle so the lab can validate the exact download path (fetch -> blob ->
 * texture / treebin) before the assets are uploaded.
 *
 * Usage: node scripts/serve-asset-bundle.mjs [--dir <assets-src>] [--port 8097]
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_DIR = resolve(HERE, '..', 'assets-src')

const MIME = {
  '.png': 'image/png',
  '.json': 'application/json',
  '.treebin': 'application/octet-stream',
  '.obj': 'model/obj',
  '.md': 'text/markdown',
}

function parseArgs(argv) {
  const args = { dir: DEFAULT_DIR, port: 8097 }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir') args.dir = resolve(argv[++i])
    else if (argv[i] === '--port') args.port = Number(argv[++i])
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
if (!existsSync(args.dir)) {
  console.error(`assets directory not found: ${args.dir}\nRun materialize-assets.mjs first.`)
  process.exit(1)
}

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const decoded = decodeURIComponent(url.pathname)
    const target = normalize(join(args.dir, decoded))
    if (!target.startsWith(args.dir) || !existsSync(target) || !statSync(target).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
      return
    }
    const headers = {
      'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(statSync(target).size),
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    }
    response.writeHead(200, headers)
    createReadStream(target).pipe(response)
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain' })
    response.end(String(error))
  }
})

server.listen(args.port, () => {
  console.log(`[slowroads-assets] serving ${args.dir} at http://localhost:${args.port}/`)
})
