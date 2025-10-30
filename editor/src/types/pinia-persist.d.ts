import type { StateTree } from 'pinia'
import type { StorePersistOptions } from '@/utils/piniaPersist'

declare module 'pinia' {
  interface DefineStoreOptionsBase<S extends StateTree, Store> {
    persist?: StorePersistOptions<S>
  }
}
