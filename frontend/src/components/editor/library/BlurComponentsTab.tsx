import { ComponentCatalogSection } from './ComponentCatalogSection'
import type { SmartLibraryModel } from './useSmartLibrary'

export function BlurComponentsTab({ library }: { library: SmartLibraryModel }) {
  return <ComponentCatalogSection category="Blur" library={library}/>
}
