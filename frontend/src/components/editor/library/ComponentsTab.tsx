import { Grid2X2, List, Search, Shapes } from 'lucide-react'
import { shapeCategory } from './ComponentThumbnail'
import { shapes } from '../../../lib/catalog'
import { AllComponentsTab } from './AllComponentsTab'
import { TextComponentsTab } from './TextComponentsTab'
import { ShapesComponentsTab } from './ShapesComponentsTab'
import { BlurComponentsTab } from './BlurComponentsTab'
import { MyComponentsTab } from './MyComponentsTab'
import type { ComponentCategory, SmartLibraryModel } from './useSmartLibrary'

const categories: ComponentCategory[] = ['All', 'Text', 'Shapes', 'Blur', 'Saved']

export function ComponentsTab({ library }: { library: SmartLibraryModel }) {
  const {
    search, setSearch, componentCategory, setComponentCategory,
    componentView, setComponentView, cardSize, setCardSize,
  } = library
  const visibleCount = shapes.filter(shape =>
    (componentCategory === 'All' || componentCategory === 'Saved' || componentCategory === shapeCategory(shape)) &&
    shape.toLowerCase().includes(search.toLowerCase()),
  ).length

  return <>
    <div className="mb-2 flex min-w-0 shrink-0 items-center gap-2 rounded-lg border border-[#343944] bg-[#121519] px-2.5 py-2">
      <Search size={15} className="shrink-0 text-[#8d94a1]"/>
      <input value={search} onChange={event => setSearch(event.target.value)}
        aria-label="Search components" placeholder="Search components..."
        className="w-full min-w-0 bg-transparent text-xs text-white outline-none placeholder:text-[#777f8e]"/>
      {search && <button type="button" onClick={() => setSearch('')}
        className="text-[#8e97a3] hover:text-white" aria-label="Clear search">×</button>}
    </div>
    <nav className="mb-3 flex min-h-[36px] w-full shrink-0 flex-wrap items-center gap-1.5" aria-label="Component categories">
      {categories.map(category => <button key={category} type="button" aria-pressed={componentCategory === category}
        onClick={() => setComponentCategory(category)}
        className={`inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3 text-[11px] font-semibold leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ae83ff] ${componentCategory === category ? 'bg-[#7847d5] text-white' : 'bg-[#252830] text-[#c4c8d1] hover:bg-[#343442] hover:text-white'}`}>
        {category === 'Saved' ? 'My Components' : category}
      </button>)}
    </nav>
    <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
      <span className="truncate text-[11px] text-[#8e98a4]">
        {componentCategory === 'Saved' ? 'Your reusable library' : `${visibleCount} elements available`}
      </span>
      <div className="flex shrink-0 items-center gap-1" aria-label="Component display options">
        <button type="button" aria-pressed={cardSize === 'compact'}
          onClick={() => setCardSize(size => size === 'compact' ? 'comfortable' : 'compact')}
          title="Toggle card size" className="rounded p-1.5 text-[#a0a6b0] hover:bg-[#30343d] hover:text-white"><Shapes size={14}/></button>
        <button type="button" aria-pressed={componentView === 'grid'} onClick={() => setComponentView('grid')}
          title="Grid view" className={`rounded p-1.5 ${componentView === 'grid' ? 'bg-[#3a2a56] text-[#d3b3ff]' : 'text-[#8b929e]'}`}><Grid2X2 size={14}/></button>
        <button type="button" aria-pressed={componentView === 'list'} onClick={() => setComponentView('list')}
          title="List view" className={`rounded p-1.5 ${componentView === 'list' ? 'bg-[#3a2a56] text-[#d3b3ff]' : 'text-[#8b929e]'}`}><List size={14}/></button>
      </div>
    </div>
    {componentCategory === 'All' && <AllComponentsTab library={library}/>}
    {componentCategory === 'Text' && <TextComponentsTab library={library}/>}
    {componentCategory === 'Shapes' && <ShapesComponentsTab library={library}/>}
    {componentCategory === 'Blur' && <BlurComponentsTab library={library}/>}
    {componentCategory === 'Saved' && <MyComponentsTab library={library}/>}
    {componentCategory !== 'Saved' && !visibleCount && <p className="rounded-lg border border-dashed border-[#363c46] p-4 text-center text-[11px] text-[#a5abb5]">
      No matching elements.
    </p>}
  </>
}
