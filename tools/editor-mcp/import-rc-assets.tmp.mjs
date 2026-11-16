import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'

const mcpPath = fileURLToPath(new URL('./mcp.mjs', import.meta.url))
const textureRoot = 'C:\\Users\\Administrator\\.codex\\visualizations\\2026\\11\\15\\01a1dea7-f8b7-7983-a5f4-a6cc6fe029c1\\rc-hall-textures'
const items = [
  ['rc-roof-tiles-albedo.png', 'Roof Tiles Albedo'],
  ['rc-roof-tiles-normal.png', 'Roof Tiles Normal'],
  ['rc-roof-tiles-roughness.png', 'Roof Tiles Roughness'],
  ['rc-plaster-albedo.png', 'Plaster Albedo'],
  ['rc-plaster-normal.png', 'Plaster Normal'],
  ['rc-plaster-roughness.png', 'Plaster Roughness'],
  ['rc-red-lacquer-albedo.png', 'Red Lacquer Albedo'],
  ['rc-red-lacquer-normal.png', 'Red Lacquer Normal'],
  ['rc-red-lacquer-roughness.png', 'Red Lacquer Roughness'],
  ['source-painted-frieze.png', 'Painted Frieze Albedo'],
  ['rc-painted-frieze-normal.png', 'Painted Frieze Normal'],
  ['rc-painted-frieze-roughness.png', 'Painted Frieze Roughness'],
  ['rc-window-lattice.png', 'Window Lattice'],
  ['rc-door-lattice.png', 'Door Lattice'],
  ['rc-sign-visitor-center.png', 'Visitor Center Sign'],
].map(([file, name]) => ({
  path: `${textureRoot}\\${file}`,
  name,
  type: 'image',
}))

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [mcpPath],
})
const client = new Client({ name: 'rc-asset-import', version: '1.0.0' })

try {
  await client.connect(transport)
  const status = await client.callTool({ name: 'harmony_editor_status', arguments: {} })
  const statusText = status.content?.find((entry) => entry.type === 'text')?.text ?? ''
  const statusPayload = JSON.parse(statusText)
  const expectedRevision = statusPayload.editor.connection.sceneRevision
  const imported = await client.callTool({
    name: 'harmony_asset_import_local',
    arguments: {
      expectedRevision,
      select: true,
      items,
    },
  })
  console.log(imported.content?.find((entry) => entry.type === 'text')?.text ?? JSON.stringify(imported))
} finally {
  await client.close().catch(() => undefined)
}
