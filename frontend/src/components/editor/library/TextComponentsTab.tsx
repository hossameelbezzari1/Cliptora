import { ComponentCatalogSection } from './ComponentCatalogSection'
import type { SmartLibraryModel } from './useSmartLibrary'

export function TextComponentsTab({ library }: { library: SmartLibraryModel }) {
  return <ComponentCatalogSection category="Text" library={library}/>
}
