import type { WorkflowStudioState } from './useWorkflowStudio'
import { ChevronDown, Search, X, Zap } from 'lucide-react'
import { iconFor, toneFor } from './workflowUI'

export function ToolLibrary({ studio }: { studio: WorkflowStudioState }) {
  const {
    setLibraryOpen, catalog, nodeSearch, setNodeSearch, toolSearchRef,
    nodeGroup, setNodeGroup, groups, visibleCatalog, addNode,
  } = studio

  return (
    <aside
      id="ws-tool-library"
      aria-label="Tool Library"
      className="absolute inset-y-0 left-0 z-40 flex w-[min(320px,calc(100%-28px))] shrink-0 flex-col overflow-hidden border-r border-[#e5e7eb] bg-white shadow-xl lg:relative lg:z-auto lg:w-[280px] lg:shadow-none xl:w-[296px]"
    >
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-[#ececec] px-4 py-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold tracking-tight text-[#18181b]">Tool Library</h2>
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-[#858585]" title={`${catalog.filter(item => item.status !== 'planned').length} enabled tools`}>
            <Zap size={12} className="text-violet-600" /> {catalog.length} tools and actions
          </span>
        </div>
        <button type="button" onClick={() => setLibraryOpen(false)} title="Hide Tool Library" aria-label="Hide Tool Library" className="inline-flex size-8 items-center justify-center rounded-lg text-[#71717a] hover:bg-[#f4f4f5] hover:text-[#18181b] focus-visible:outline-2 focus-visible:outline-violet-500"><X size={17} /></button>
      </div>

      <div className="shrink-0 space-y-3 px-3 pt-3">
        <label className="flex h-10 items-center gap-2 rounded-lg border border-[#e4e4e7] bg-white px-3 text-[#71717a] focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
          <Search size={15} />
          <input ref={toolSearchRef} type="search" value={nodeSearch} onChange={event => setNodeSearch(event.target.value)} placeholder="Search tools..." aria-label="Search tools" className="min-w-0 flex-1 border-0 bg-transparent text-xs text-[#171717] outline-none placeholder:text-[#9ca3af]" />
        </label>
        <div className="flex gap-1 overflow-x-auto pb-2 [scrollbar-width:thin]" aria-label="Tool categories">
          {['All', ...groups].map(group => (
            <button
              key={group}
              type="button"
              onClick={() => setNodeGroup(group)}
              className={`shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${nodeGroup === group ? 'bg-[#222] text-white' : 'text-[#71717a] hover:bg-[#f3f4f6] hover:text-[#333]'}`}
            >
              {group}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-5 [scrollbar-width:thin]">
        {groups.map(group => {
          const items = visibleCatalog.filter(item => item.group === group)
          if (!items.length) return null
          return (
            <section key={group} className="mb-5">
              <h3 className="mb-2 flex items-center justify-between px-1 text-[10px] font-bold uppercase tracking-wide text-[#898989]">
                {group}<ChevronDown size={13} />
              </h3>
              <div className="space-y-1">
                {items.map(item => (
                  <button
                    key={item.type}
                    type="button"
                    disabled={item.status === 'planned'}
                    draggable={item.status !== 'planned'}
                    onDragStart={event => event.dataTransfer.setData('text/cliptora-node', item.type)}
                    onClick={() => addNode(item.type)}
                    title={item.status === 'planned' ? 'Planned tool — executor not installed yet' : `Add ${item.label}`}
                    className="group flex w-full cursor-grab items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-[#e5e7eb] hover:bg-[#f7f7f8] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className={`grid size-9 shrink-0 place-items-center rounded-lg border ${toneFor(item.type)}`}>{iconFor(item.type, 17)}</span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-xs font-semibold text-[#292929]">{item.label}</strong>
                      <small className="mt-0.5 block truncate text-[10px] text-[#888]">{item.status === 'planned' ? `${item.priority ?? 'P1'} · Planned` : item.type.replace('.', ' · ')}</small>
                    </span>
                    <span className="text-lg text-[#999] opacity-0 group-hover:opacity-100">+</span>
                  </button>
                ))}
              </div>
            </section>
          )
        })}
        {visibleCatalog.length === 0 && <div className="rounded-lg border border-dashed border-[#dedede] p-4 text-center text-xs text-[#929292]">No tools match your search.</div>}
      </div>
      <div className="shrink-0 border-t border-[#ececec] bg-white px-4 py-2.5 text-[10px] text-[#929292]">Drag an available tool onto the canvas</div>
    </aside>
  )
}
