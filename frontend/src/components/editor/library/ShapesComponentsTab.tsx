import { ComponentCatalogSection } from './ComponentCatalogSection'
import type { SmartLibraryModel } from './useSmartLibrary'

export function ShapesComponentsTab({ library }: { library: SmartLibraryModel }) {
  return <ComponentCatalogSection category="Shapes" library={library}/>
}
