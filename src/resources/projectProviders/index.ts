import { zlgccnProvider } from './zlgccn'
import type { ResourceProvider } from './types'

export { type ResourceProvider }

const builtinProvider: ResourceProvider = {
  id: 'builtin',
  name: '内置资源',
  url: null,
}

export const resourceProviders: ResourceProvider[] = [builtinProvider, zlgccnProvider]
