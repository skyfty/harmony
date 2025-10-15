import { zlgccnProvider } from './zlgccn'
import type { ResourceProvider } from './types'

export { type ResourceProvider }

const sceneProvider: ResourceProvider = {
  id: 'scene',
  name: '内置资源',
  url: null,
}

export const resourceProviders: ResourceProvider[] = [sceneProvider, zlgccnProvider]
