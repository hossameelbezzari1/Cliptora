import { TextComponentsTab } from './TextComponentsTab'
import { ShapesComponentsTab } from './ShapesComponentsTab'
import { BlurComponentsTab } from './BlurComponentsTab'
import { MyComponentsTab } from './MyComponentsTab'
import type { SmartLibraryModel } from './useSmartLibrary'

export function AllComponentsTab({ library }: { library: SmartLibraryModel }) {
  return <>
    <TextComponentsTab library={library}/>
    <ShapesComponentsTab library={library}/>
    <BlurComponentsTab library={library}/>
    <MyComponentsTab library={library}/>
  </>
}
