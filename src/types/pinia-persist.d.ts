import type { StateTree } from 'pinia'
import type { StorePersistOptions } from '@/plugins/piniaPersist'

declare module 'pinia' {
  interface DefineStoreOptionsBase<S extends StateTree, Store> {
    persist?: StorePersistOptions<S>
  }
}
