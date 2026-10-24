import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../../../lib/api'
import { useEditor } from '../../../stores/editorStore'
import { Columns2, Rows3, Search, Variable, X } from 'lucide-react'
import type { SmartLibraryModel } from './useSmartLibrary'
import { DefaultVariablesTab, defaultVariables, type VariableFilter } from './DefaultVariablesTab'
import { CreateVariableTab } from './CreateVariableTab'
import { ExpressionTesterTab } from './ExpressionTesterTab'
import { SavedVariablesTab } from './SavedVariablesTab'

const filters: VariableFilter[] = ['All', 'Project', 'Media', 'Date/Time', 'System', 'Custom']

/** Main Variables workspace, responsive to the resizable Library panel. */
export function VariablesTab({ library }: { library: SmartLibraryModel }) {
  const { id } = useParams()
  const media = useEditor(state => state.media)
  const [projectMetadata, setProjectMetadata] = useState<Record<string, unknown> | null>(null)
  useEffect(() => {
    if (!id || !/^\d+$/.test(id)) return
    let cancelled = false
    void api<Record<string, unknown>>(`/projects/${id}`)
      .then(project => { if (!cancelled) setProjectMetadata(project) })
      .catch(() => { /* Keep the existing context if metadata is unavailable. */ })
    return () => { cancelled = true }
  }, [id])

  const projectContext = useMemo(() => {
    const base = library.context
    const meta = projectMetadata
    const selectedMedia = media.find(asset => String(asset.id) === String(library.selected?.media_id ?? ''))
    const rawMedia = selectedMedia as unknown as Record<string, unknown> | undefined
    const fileName = String(rawMedia?.original_filename ?? rawMedia?.file_name ?? rawMedia?.filename ?? rawMedia?.name ?? '')
    const numberOr = (raw: unknown, fallback: number) => typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback
    const stringOr = (raw: unknown, fallback: string) => typeof raw === 'string' ? raw : fallback
    const width = numberOr(meta?.width, base['project.width'])
    const height = numberOr(meta?.height, base['project.height'])
    return {
      ...base,
      'project.title': stringOr(meta?.title ?? meta?.name, base['project.title']),
      'project.description': stringOr(meta?.description, base['project.description']),
      'project.created_at': stringOr(meta?.created_at, base['project.created_at']),
      'project.updated_at': stringOr(meta?.updated_at, base['project.updated_at']),
      'project.width': width,
      'project.height': height,
      'project.resolution': `${width}×${height}`,
      'project.fps': numberOr(meta?.fps, base['project.fps']),
      'media.file_name': fileName || base['media.file_name'],
      'media.extension': fileName.includes('.') ? fileName.split('.').pop() ?? '' : base['media.extension'],
    }
  }, [library.context, library.selected?.media_id, media, projectMetadata])
  const model = { ...library, context: projectContext }

  // Two columns are the default. Do not base the whole layout on the width
  // of the *window* or a high threshold such as 760px: Library is a resizable
  // panel inside the editor, not a full-page view.
  const [layout, setLayout] = useState<'columns' | 'stacked'>('columns')

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<VariableFilter>('All')
  const [expressionOpen, setExpressionOpen] = useState(true)
  const savedCount = library.all.filter(item => item.kind === 'variable').length

  const useReference = (ref: string) => {
    library.setExpression(ref)
    setExpressionOpen(true)
  }
  const testVariable = (name: string) => useReference(`{{${name}}}`)
  const showDefaults = filter !== 'Custom'

  return <section className="cl-vars w-full min-w-0 flex-1 self-stretch pb-5 text-[#edf3fa]" data-layout={layout}>
    <style>{`
      .cl-vars-layout{display:grid;width:100%;min-width:0;grid-template-columns:minmax(0,0.92fr) minmax(0,1.08fr);column-gap:12px;align-items:start}
      .cl-vars[data-layout="stacked"] .cl-vars-layout{grid-template-columns:minmax(0,1fr)}
      .cl-vars-left{min-width:0;display:flex;flex-direction:column;gap:10px}
      .cl-vars-main{min-width:0;display:grid;gap:12px;align-content:start}
      .cl-vars-form-pair{grid-template-columns:minmax(0,1fr)}
      .cl-vars-filterbar{display:flex;align-items:center;gap:6px;overflow-x:auto;max-width:100%;padding:1px 0 7px;scrollbar-width:thin;scrollbar-color:#4a5270 transparent}
      .cl-vars-filterbar button{flex:0 0 auto;border:1px solid #354154;border-radius:999px;background:#151f2c;color:#bcc9db;padding:6px 10px;font-size:10px;white-space:nowrap}
      .cl-vars-filterbar button[aria-pressed="true"]{border-color:#a075ff;background:#7643e3;color:#fff}
      .cl-default-vars-list{scrollbar-width:thin;scrollbar-color:#3d536c transparent;max-height:min(62dvh,620px)}
      .cl-vars-main .cl-vars-card{max-width:100%;min-width:0}
      .cl-vars-main .cl-vars-card input,.cl-vars-main .cl-vars-card select,.cl-vars-main .cl-vars-card textarea{max-width:100%}
      @media(min-width:1300px){.cl-vars:not([data-layout="stacked"]) .cl-vars-form-pair{grid-template-columns:minmax(0,1fr)}}
    `}</style>

    <div className="mb-2 flex justify-end gap-1" role="group" aria-label="Variables layout">
      <button type="button" onClick={() => setLayout('columns')} aria-pressed={layout === 'columns'}
        title="Show defaults and editor side by side"
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] ${layout === 'columns' ? 'border-[#9266ee] bg-[#493375] text-white' : 'border-[#354358] bg-[#1b2636] text-[#adb9cc]'}`}>
        <Columns2 size={13}/> 2 Columns
      </button>
      <button type="button" onClick={() => setLayout('stacked')} aria-pressed={layout === 'stacked'}
        title="Stack variables sections vertically"
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] ${layout === 'stacked' ? 'border-[#9266ee] bg-[#493375] text-white' : 'border-[#354358] bg-[#1b2636] text-[#adb9cc]'}`}>
        <Rows3 size={13}/> Stack
      </button>
    </div>
    <div className="cl-vars-layout" style={{display:'grid',width:'100%',minWidth:0,gridTemplateColumns:layout === 'columns' ? 'minmax(0,0.92fr) minmax(0,1.08fr)' : 'minmax(0,1fr)',columnGap:12,rowGap:12,alignItems:'start'}}>
      <div className="cl-vars-left">
        <header className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2"><Variable size={19} className="shrink-0 text-[#a679fa]"/>
              <h2 className="text-[17px] font-bold text-white">Variables</h2>
              <span className="rounded-full bg-[#312e4c] px-2 py-0.5 text-[11px] text-[#d4bfff]">{defaultVariables.length + savedCount}</span>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-[#abb9ce]">Global values, expressions &amp; project information.</p>
          </div>
        </header>

        <label className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-[#344358] bg-[#121d2a] px-3 focus-within:border-[#9c73f6]">
          <Search size={15} className="shrink-0 text-[#a2b0c7]"/>
          <input type="search" aria-label="Search variables" placeholder="Search variables…"
            value={search} onChange={event => setSearch(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[11px] text-white outline-none placeholder:text-[#8290a3]"/>
          {search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="text-[#aab6c7]"><X size={14}/></button>}
        </label>
        <nav className="cl-vars-filterbar" aria-label="Filter variables">
          {filters.map(item => <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}
        </nav>
        {showDefaults
          ? <DefaultVariablesTab library={model} search={search} category={filter} onUse={useReference}/>
          : <div className="rounded-lg border border-[#2e3d50] bg-[#132130] p-3 text-[11px] text-[#a9bdd2]">Your custom variables are listed in Saved Variables on the right. Choose All to see the built-in variables.</div>}
      </div>

      <div className="cl-vars-main">
        <CreateVariableTab library={model}/>
        <ExpressionTesterTab library={model} open={expressionOpen} setOpen={setExpressionOpen}/>
        <SavedVariablesTab library={model} search={search} onTest={testVariable}/>
      </div>
    </div>
  </section>
}
