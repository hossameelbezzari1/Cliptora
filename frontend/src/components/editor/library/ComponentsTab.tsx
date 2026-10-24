import { useState } from 'react'
import {
  Boxes, Columns2, Grid2X2, Layers3, List, Rows3, Search, Shapes, X,
} from 'lucide-react'
import { shapeCategory } from './ComponentThumbnail'
import { shapes } from '../../../lib/catalog'
import { AllComponentsTab } from './AllComponentsTab'
import { TextComponentsTab } from './TextComponentsTab'
import { ShapesComponentsTab } from './ShapesComponentsTab'
import { BlurComponentsTab } from './BlurComponentsTab'
import { MyComponentsTab } from './MyComponentsTab'
import type { ComponentCategory, SmartLibraryModel } from './useSmartLibrary'

const categories: ComponentCategory[] = ['All', 'Text', 'Shapes', 'Blur', 'Saved']

const toolButton =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2 text-[10px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ae83ff]'

/**
 * Two-pane Components workspace.
 * Built-ins are on the left; My Components is always visible on the right.
 * The Stack button is an optional compact alternative, never an automatic breakpoint.
 */
export function ComponentsTab({ library }: { library: SmartLibraryModel }) {
  const {
    search, setSearch, componentCategory, setComponentCategory,
    componentView, setComponentView, cardSize, setCardSize,
    visible, folder,
  } = library
  const [layout, setLayout] = useState<'columns' | 'stacked'>('columns')

  const activeBuiltinCategory = componentCategory === 'Saved' ? 'All' : componentCategory
  const visibleCount = shapes.filter(shape =>
    (activeBuiltinCategory === 'All' || activeBuiltinCategory === shapeCategory(shape)) &&
    shape.toLowerCase().includes(search.toLowerCase()),
  ).length
  const savedCount = visible.filter(item => item.kind === 'component' || item.kind === 'group').length

  return <section className="flex w-full min-w-0 flex-1 flex-col self-stretch pb-3 text-white" data-components-layout={layout}>
    <style>{`
      .cl-components-grid { width: 100%; min-width: 0; display: grid; align-items: start; column-gap: 12px; row-gap: 12px; }
      .cl-components-pane { min-width: 0; max-width: 100%; overflow: hidden; border: 1px solid #333b4b; border-radius: 13px; background: #151b25; }
      .cl-components-scroll { min-width: 0; overflow-y: auto; overflow-x: hidden; max-height: min(68dvh, 720px); scrollbar-width: thin; scrollbar-color: #45516c transparent; }
      .cl-components-tabs { display: flex; align-items: center; gap: 6px; overflow-x: auto; padding: 2px 0 7px; scrollbar-width: thin; scrollbar-color: #45516c transparent; }
      .cl-components-tabs button { flex: 0 0 auto; }
      .cl-components-pane input, .cl-components-pane select, .cl-components-pane textarea { max-width: 100%; }
      .cl-components-pane .grid { min-width: 0; }
    `}</style>

    <div className="mb-3 flex min-w-0 items-center gap-2 rounded-xl border border-[#364155] bg-[#121b29] px-3 py-2.5 focus-within:border-[#a17bfa]">
      <Search size={16} className="shrink-0 text-[#96a7c0]"/>
      <input
        type="search"
        value={search}
        onChange={event => setSearch(event.target.value)}
        aria-label="Search components"
        placeholder="Search components and saved elements…"
        className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#8391a8]"
      />
      {search && <button type="button" title="Clear search" aria-label="Clear search"
        className="shrink-0 rounded p-1 text-[#a9b4c6] hover:text-white"
        onClick={() => setSearch('')}><X size={15}/></button>}
    </div>

    <nav className="cl-components-tabs mb-2 w-full min-w-0" aria-label="Component categories">
      {categories.map(category => <button
        key={category}
        type="button"
        aria-pressed={componentCategory === category}
        onClick={() => setComponentCategory(category)}
        className={`h-8 rounded-full border px-3 text-[11px] font-semibold transition-colors ${
          componentCategory === category
            ? 'border-[#966af0] bg-[#7847d5] text-white'
            : 'border-[#343d4d] bg-[#1e2734] text-[#c3cada] hover:border-[#71558f] hover:text-white'
        }`}
      >{category === 'Saved' ? 'My Components' : category}</button>)}
    </nav>

    <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 truncate text-[11px] text-[#9ba9bd]">
        {visibleCount} built-in elements · {savedCount} saved {folder === null ? 'in root' : 'in folder'}
      </span>
      <div className="flex shrink-0 items-center gap-1" aria-label="Component display options">
        <button type="button" title="Toggle card size" aria-label="Toggle card size"
          aria-pressed={cardSize === 'compact'}
          onClick={() => setCardSize(size => size === 'compact' ? 'comfortable' : 'compact')}
          className={`${toolButton} border-[#343d4d] bg-[#202734] text-[#bdc4d3] hover:text-white`}>
          <Shapes size={14}/>
        </button>
        <button type="button" title="Grid view" aria-label="Grid view"
          aria-pressed={componentView === 'grid'} onClick={() => setComponentView('grid')}
          className={`${toolButton} ${componentView === 'grid' ? 'border-[#8c63d9] bg-[#3c2b58] text-[#ddc4ff]' : 'border-[#343d4d] bg-[#202734] text-[#aab4c5]'}`}>
          <Grid2X2 size={14}/>
        </button>
        <button type="button" title="List view" aria-label="List view"
          aria-pressed={componentView === 'list'} onClick={() => setComponentView('list')}
          className={`${toolButton} ${componentView === 'list' ? 'border-[#8c63d9] bg-[#3c2b58] text-[#ddc4ff]' : 'border-[#343d4d] bg-[#202734] text-[#aab4c5]'}`}>
          <List size={14}/>
        </button>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-[#3c4555]"/>
        <button type="button" title="Show two columns" aria-label="Show two columns"
          aria-pressed={layout === 'columns'} onClick={() => setLayout('columns')}
          className={`${toolButton} ${layout === 'columns' ? 'border-[#8c63d9] bg-[#493471] text-white' : 'border-[#343d4d] bg-[#202734] text-[#aab4c5]'}`}>
          <Columns2 size={14}/><span>2 Columns</span>
        </button>
        <button type="button" title="Stack panels" aria-label="Stack panels"
          aria-pressed={layout === 'stacked'} onClick={() => setLayout('stacked')}
          className={`${toolButton} ${layout === 'stacked' ? 'border-[#8c63d9] bg-[#493471] text-white' : 'border-[#343d4d] bg-[#202734] text-[#aab4c5]'}`}>
          <Rows3 size={14}/><span>Stack</span>
        </button>
      </div>
    </div>

    {/* The inline grid-template prevents the editor's resizable parent from
        forcing a one-column breakpoint when the library is resized. */}
    <div
      className="cl-components-grid flex-1"
      style={{ gridTemplateColumns: layout === 'columns' ? 'minmax(0,1fr) minmax(0,1fr)' : 'minmax(0,1fr)' }}
    >
      <section className="cl-components-pane" aria-label="Built-in components">
        <header className="flex min-w-0 items-center justify-between gap-2 border-b border-[#323c4c] bg-[#192330] px-3 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Layers3 size={16} className="shrink-0 text-[#b28bf6]"/>
            <h3 className="truncate text-xs font-semibold text-[#f1f1f7]">
              {activeBuiltinCategory === 'All' ? 'Built-in Components' : `${activeBuiltinCategory} Components`}
            </h3>
          </div>
          <span className="shrink-0 rounded-full bg-[#332b50] px-2 py-0.5 text-[10px] text-[#d8c2ff]">{visibleCount}</span>
        </header>
        <div className="cl-components-scroll p-3">
          {componentCategory === 'Saved' && <div className="mb-3 rounded-lg border border-[#594374] bg-[#30243e] p-2 text-[11px] leading-5 text-[#d0bce7]">
            Your saved components are on the right. Choose a category above to browse built-in elements.
          </div>}
          {activeBuiltinCategory === 'All' && <AllComponentsTab library={library} includeSaved={false}/>}
          {activeBuiltinCategory === 'Text' && <TextComponentsTab library={library}/>}
          {activeBuiltinCategory === 'Shapes' && <ShapesComponentsTab library={library}/>}
          {activeBuiltinCategory === 'Blur' && <BlurComponentsTab library={library}/>}
          {visibleCount === 0 && <p className="rounded-lg border border-dashed border-[#485064] px-3 py-6 text-center text-[11px] leading-5 text-[#a5afc3]">
            No matching built-in components.
          </p>}
        </div>
      </section>

      <section className={`cl-components-pane ${componentCategory === 'Saved' ? 'border-[#8b61d4]' : ''}`} aria-label="My Components">
        <header className="flex min-w-0 items-center justify-between gap-2 border-b border-[#323c4c] bg-[#192330] px-3 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Boxes size={16} className="shrink-0 text-[#ba98ff]"/>
            <h3 className="truncate text-xs font-semibold text-[#f1f1f7]">Saved Library</h3>
          </div>
          <span className="shrink-0 rounded-full bg-[#332b50] px-2 py-0.5 text-[10px] text-[#d8c2ff]">{savedCount}</span>
        </header>
        <div className="cl-components-scroll p-3">
          <MyComponentsTab library={library}/>
        </div>
      </section>
    </div>
  </section>
}
