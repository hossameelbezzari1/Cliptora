import { PresetCatalogTab } from './PresetCatalogTab'
import type { SmartLibraryModel } from './useSmartLibrary'

export function EffectsTab({ library }: { library: SmartLibraryModel }) {
  return <PresetCatalogTab library={library} tab="effects"/>
}
