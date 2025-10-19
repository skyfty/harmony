import { zlgccnProvider } from './zlgccn'
import { presetProvider } from './preset'
import { adminProvider } from './admin'
import type { ResourceProvider } from './types'

export { type ResourceProvider }

const sceneProvider: ResourceProvider = {
  id: 'builtin',
  name: '内置资源',
  url: null,
  includeInPackages: false,
}

export const resourceProviders: ResourceProvider[] = [sceneProvider, presetProvider, zlgccnProvider, adminProvider]
