import { useSyncExternalStore } from 'react'
import {
  getPluginCatalogSnapshot,
  subscribePluginCatalog,
} from './runtime'

export function usePluginCatalog() {
  return useSyncExternalStore(
    subscribePluginCatalog,
    getPluginCatalogSnapshot,
    getPluginCatalogSnapshot
  )
}
