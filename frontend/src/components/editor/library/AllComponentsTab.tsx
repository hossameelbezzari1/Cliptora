import { TextComponentsTab } from './TextComponentsTab'
import { ShapesComponentsTab } from './ShapesComponentsTab'
import { BlurComponentsTab } from './BlurComponentsTab'
import { MyComponentsTab } from './MyComponentsTab'
import type { SmartLibraryModel } from './useSmartLibrary'

/**
 * Keep the original All Components behaviour by default.
 * In ComponentsTab's two-column layout, saved components have their own
 * right-hand pane, so includeSaved={false} prevents duplicate rendering.
 */
export function AllComponentsTab({
  library,
  includeSaved = true,
}: {
  library: SmartLibraryModel
  includeSaved?: boolean
}) {
  return <>
    <TextComponentsTab library={library}/>
    <ShapesComponentsTab library={library}/>
    <BlurComponentsTab library={library}/>
    {includeSaved && <MyComponentsTab library={library}/>}
  </>
}
