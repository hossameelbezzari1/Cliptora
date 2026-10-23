import { PresetCatalogTab } from './PresetCatalogTab'
import type { SmartLibraryModel } from './useSmartLibrary'

export function AnimationsTab({ library }: { library: SmartLibraryModel }) {
  return <PresetCatalogTab library={library} tab="animations"/>
}
