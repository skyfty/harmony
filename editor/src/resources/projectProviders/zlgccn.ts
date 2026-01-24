import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import type { ResourceProvider } from './types'

function transformZlgccnResponse(payload: unknown): ProjectDirectory[] {
  const dataArray = Array.isArray((payload as { data?: unknown })?.data)
    ? (payload as { data: unknown[] }).data
    : []

  if (!dataArray.length) {
    return [
      {
        id: 'zlgccn-empty',
        name: 'zlgccn Models',
        assets: [],
      },
    ]
  }

  const seriesMap = new Map<string, ProjectAsset[]>()

  dataArray.forEach((itemRaw) => {
    if (!itemRaw || typeof itemRaw !== 'object') {
      return
    }
    const item = itemRaw as Record<string, unknown>
    if (item.file == null || typeof item.file !== 'string' || !item.file.trim().length) {
      return
    }
    const assetIdSource = item.id ?? item.file ?? `temp-${Math.random().toString(36).slice(2, 10)}`
    const name = typeof item.name === 'string' && item.name.trim().length ? item.name : `模型 ${assetIdSource}`
    const series = typeof item.series === 'string' && item.series.trim().length ? item.series.trim() : '未分组'

    const asset: ProjectAsset = {
      id: item.file,
      name,
      type: 'model',
      previewColor: '#26C6DA',
      thumbnail: null,
      description: item.file,
      downloadUrl: item.file,
      gleaned: false,
      extension: (() => {
        try {
          const urlOrName = String(item.file)
          const m = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(urlOrName)
          return m && m[1] ? m[1].toLowerCase() : null
        } catch (_e) {
          return null
        }
      })(),
    }

    if (!seriesMap.has(series)) {
      seriesMap.set(series, [])
    }
    seriesMap.get(series)!.push(asset)
  })

  const directories: ProjectDirectory[] = []
  let index = 0
  for (const [seriesName, assets] of seriesMap.entries()) {
    directories.push({
      id: `zlgccn-series-${index++}`,
      name: seriesName,
      assets,
    })
  }

  return directories.length
    ? directories
    : [
        {
          id: 'zlgccn-models',
          name: 'zlgccn Models',
          assets: [],
        },
      ]
}

export const zlgccnProvider: ResourceProvider = {
  id: 'zlgccn',
  name: 'zlgccn',
  url: 'https://api-prod.zlgccn.com/index.php/Api/resources/GetAllModels',
  transform: transformZlgccnResponse,
}
