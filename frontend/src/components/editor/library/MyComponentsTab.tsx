import { ArrowLeft, Boxes, Folder, Plus } from 'lucide-react'
import { SavedComponentThumbnail } from './ComponentThumbnail'
import { buttonClass, fieldClass, type SmartLibraryModel } from './useSmartLibrary'

export function MyComponentsTab({ library }: { library: SmartLibraryModel }) {
  const {
    search, folder, setFolder, currentFolder, folders, visible, selected,
    componentView, cardSize, name, setName, busy, save, apply, remove,
  } = library
  const saved = visible.filter(item => item.kind === 'component' || item.kind === 'group')

  return <section className="min-w-0">
    <div className="mb-2 mt-1 flex items-center gap-2">
      <Boxes size={15} className="text-[#b78afc]"/>
      <h3 className="text-xs font-semibold">My Components</h3>
      <span className="rounded bg-[#252830] px-1.5 text-[10px] text-[#a1a5ae]">{saved.length}</span>
    </div>
    <div className="mb-2 flex items-center gap-2">
      {folder !== null && <button type="button" className={buttonClass}
        onClick={() => setFolder(currentFolder?.parent_id ?? null)} title="Back to parent folder">
        <ArrowLeft size={13}/>
      </button>}
      <span className="min-w-0 flex-1 truncate text-[11px] text-[#a8adba]">{currentFolder?.name ?? 'My Components /'}</span>
    </div>
    <div className="mb-2 grid grid-cols-2 gap-1.5">
      {folders.filter(item => item.parent_id === folder && item.name.toLowerCase().includes(search.toLowerCase()))
        .map(item => <button type="button" key={item.id}
          className="flex items-center gap-1.5 rounded-lg border border-[#353a45] bg-[#21242b] px-2 py-2 text-left text-[11px] hover:border-[#9360d8]"
          onClick={() => setFolder(item.id)}>
          <Folder size={14} className="shrink-0 text-[#b998fa]"/>
          <span className="min-w-0 truncate">{item.name}</span>
        </button>)}
    </div>
    {saved.length > 0 ? <div className={componentView === 'grid' ? 'grid gap-2' : 'flex flex-col gap-1.5'}
      style={componentView === 'grid' ? { gridTemplateColumns: `repeat(auto-fill,minmax(${cardSize === 'compact' ? 100 : 142}px,1fr))` } : undefined}>
      {saved.map(item => {
        const snapshot = item.payload.snapshot as Record<string, unknown> | undefined
        return <div key={item.id} className={`group min-w-0 overflow-hidden rounded-lg border border-[#363945] bg-[#21242b] ${componentView === 'list' ? 'flex items-center gap-1.5 p-1.5' : 'flex flex-col'}`}>
          <div className={`shrink-0 overflow-hidden rounded-md ${componentView === 'list' ? 'h-11 w-16' : cardSize === 'compact' ? 'h-[70px] w-full' : 'h-[96px] w-full'}`}>
            <SavedComponentThumbnail snapshot={snapshot} kind={item.kind as 'component' | 'group'}/>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-2">
            <span className="min-w-0 flex-1 truncate text-[11px] text-[#e0e1e8]" title={item.name}>{item.name}</span>
            <button type="button" onClick={() => apply(item)} disabled={!selected}
              title="Apply to selected clip" aria-label={`Apply ${item.name}`}
              className="rounded bg-[#6941b6] p-1 text-white hover:bg-[#8859ed] disabled:cursor-not-allowed disabled:opacity-40"><Plus size={12}/></button>
            <button type="button" onClick={() => void remove(item)} aria-label={`Delete ${item.name}`}
              title="Delete saved component" className="rounded px-1 text-[#9299a5] hover:text-red-400">×</button>
          </div>
        </div>
      })}
    </div> : <p className="rounded-lg border border-dashed border-[#343946] px-3 py-4 text-center text-[11px] leading-5 text-[#9299a5]">
      No saved components here. Select an object in Timeline and save it below.
    </p>}
    <div className="mt-3 flex gap-1.5">
      <input className={`${fieldClass} min-w-0 flex-1`} placeholder="Folder / component name"
        value={name} onChange={event => setName(event.target.value)}/>
      <button type="button" title="Create folder" className={buttonClass}
        disabled={busy || !name.trim()} onClick={() => void save('folder', name, {})}>
        <Folder size={13}/> +
      </button>
    </div>
    <div className="mt-2 grid grid-cols-2 gap-1.5">
      <button type="button" className={buttonClass} disabled={!selected || busy}
        onClick={() => selected && void save('component', name || selected.name, { snapshot: selected })}>Save selected clip</button>
      <button type="button" className={buttonClass} disabled={busy || !name.trim()}
        onClick={() => void save('group', name, { children: [] })}>Create group</button>
    </div>
  </section>
}
