import { Plus, Shapes, Type, WandSparkles } from 'lucide-react'
import { ComponentThumbnail, shapeCategory } from './ComponentThumbnail'
import { shapes } from '../../../lib/catalog'
import { useEditor } from '../../../stores/editorStore'
import type { SmartLibraryModel } from './useSmartLibrary'

export type BuiltinCategory = 'Text' | 'Shapes' | 'Blur'

export function ComponentCatalogSection({ category, library }: {
  category: BuiltinCategory
  library: SmartLibraryModel
}) {
  const { search, componentView, cardSize, addShape, dragShape } = library
  const entries = shapes.filter(shape =>
    shapeCategory(shape) === category && shape.toLowerCase().includes(search.toLowerCase()),
  )
  if (!entries.length) return null
  const Icon = category === 'Text' ? Type : category === 'Blur' ? WandSparkles : Shapes

  return <div className="mb-3">
    <div className="mb-2 flex items-center gap-2">
      <Icon size={15} className={category === 'Blur' ? 'text-[#63dce5]' : 'text-[#ae86f1]'}/>
      <h3 className="text-xs font-semibold text-[#e6e6eb]">{category}</h3>
      <span className="rounded bg-[#252830] px-1.5 text-[10px] text-[#a1a5ae]">{entries.length}</span>
    </div>
    <div className={componentView === 'grid' ? 'grid gap-2' : 'flex flex-col gap-1.5'}
      style={componentView === 'grid' ? { gridTemplateColumns: `repeat(auto-fill,minmax(${cardSize === 'compact' ? 100 : 142}px,1fr))` } : undefined}>
      {entries.map(shape => <button
        key={shape} type="button" draggable
        onDragStart={event => dragShape(event, shape)}
        onDragEnd={() => useEditor.getState().startDrag(null)}
        onClick={() => addShape(shape)}
        title={`Add ${shape} to Timeline`} aria-label={`Add ${shape} to Timeline`}
        className={`group min-w-0 overflow-hidden rounded-lg border border-[#343c47] bg-[#1b1f26] text-left transition-all hover:border-[#9868f0] hover:bg-[#242430] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ae83ff] ${componentView === 'list' ? 'flex items-center gap-2 p-1.5' : 'flex flex-col'}`}>
        <div className={`relative shrink-0 overflow-hidden rounded-t-md ${componentView === 'list' ? 'h-11 w-16 rounded-md' : cardSize === 'compact' ? 'h-[70px] w-full' : 'h-[96px] w-full'}`}>
          <ComponentThumbnail name={shape} compact={cardSize === 'compact'}/>
        </div>
        <div className={`flex min-w-0 flex-1 items-center justify-between gap-1 ${componentView === 'list' ? 'pr-1' : 'px-2 py-2'}`}>
          <span className="min-w-0 text-[11px] font-medium leading-4 text-[#e0e1e8]" title={shape}>{shape}</span>
          <span className="shrink-0 rounded-md bg-[#333744] p-1 text-[#b5a0d9] group-hover:bg-[#7544cc] group-hover:text-white"><Plus size={11}/></span>
        </div>
      </button>)}
    </div>
  </div>
}
