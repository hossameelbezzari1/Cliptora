import { useMemo, useState } from 'react'
import { ArrowLeftRight, Check, ChevronDown, ChevronRight, Pencil, Play, RotateCcw, Save, Search, Trash2, X } from 'lucide-react'
import { useEditor } from '../../../stores/editorStore'
import type { LibraryItem, SmartLibraryModel } from './useSmartLibrary'
import { TransitionPreview } from './TransitionPreview'
import { defaultTransitionSettings, transitionGroups, transitionPayload, transitions,
  type TransitionDefinition, type TransitionSettings, type TransitionGroup } from './transitionCatalog'

type Filter = 'All' | TransitionGroup
const cnInput = 'w-full min-w-0 rounded-lg border border-[#354052] bg-[#121a26] px-2.5 py-2 text-xs text-[#f1f3fa] outline-none placeholder:text-[#818b9a] focus:border-[#9870e9]'
const cnButton = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#354156] bg-[#1b2735] px-2.5 py-2 text-[11px] text-[#d4dcf0] hover:bg-[#293549] disabled:cursor-not-allowed disabled:opacity-40'
const cnPurple = 'inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#7d4ae9] to-[#6940db] px-3 py-2.5 text-xs font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40'
const cnSection = 'rounded-xl border border-[#2c394b] bg-[#151e2a] p-3'
const clamp = (x: number, low: number, high: number) => Math.min(high, Math.max(low, x))
const isEasing = (v: unknown): v is TransitionSettings['easing'] => ['Linear', 'Ease In', 'Ease Out', 'Ease In Out'].includes(String(v))
const isBlend = (v: unknown): v is TransitionSettings['blend'] => ['Normal', 'Screen', 'Multiply'].includes(String(v))

function loadedSettings(item: LibraryItem, def: TransitionDefinition): TransitionSettings {
  const raw = item.payload
  return {
    duration: typeof raw.duration === 'number' ? clamp(raw.duration, 0.1, 5) : def.duration,
    easing: isEasing(raw.easing) ? raw.easing : 'Linear',
    blend: isBlend(raw.blend) ? raw.blend : 'Normal',
    intensity: typeof raw.intensity === 'number' ? clamp(raw.intensity, 0, 1) : 1,
    applyAudio: typeof raw.applyAudio === 'boolean' ? raw.applyAudio : true,
  }
}

function SettingSlider({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (value: number) => void
}) {
  return <label className="grid min-w-0 grid-cols-[minmax(68px,1fr)_minmax(60px,1.3fr)_64px] items-center gap-2 text-[11px] text-[#b6c1d2]">
    <span>{label}</span>
    <input aria-label={label} className="min-w-0 w-full accent-[#9b6cf3]" type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))}/>
    <span className="relative min-w-0"><input aria-label={`${label} exact value`} className={`${cnInput} w-full px-1.5 text-center tabular-nums`} type="number" min={min} max={max} step={step} value={Number(value.toFixed(2))} onChange={event => {const next=Number(event.target.value);if(event.target.value!==''&&Number.isFinite(next))onChange(clamp(next,min,max))}}/>{unit && <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-[#8292a6]">{unit}</span>}</span>
  </label>
}

function IconAction({ label, icon: Icon, onClick, disabled = false, danger = false }: {
  label: string; icon: typeof Play; onClick: () => void; disabled?: boolean; danger?: boolean
}) {
  return <button type="button" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#354158] bg-[#253143] hover:bg-[#36445b] disabled:opacity-35 ${danger?'text-rose-400':'text-[#dee5f1]'}`} disabled={disabled} title={label} aria-label={label} onClick={onClick}><Icon size={14}/></button>
}

export function TransitionsTab({ library }: { library: SmartLibraryModel }) {
  const { search, setSearch, all, selected, tracks, busy, refresh, remove, save } = library
  const [filter, setFilter] = useState<Filter>('All')
  const [chosenId, setChosenId] = useState('cross-fade')
  const [settings, setSettings] = useState<TransitionSettings>(() => defaultTransitionSettings(transitions[0]))
  const [progress, setProgress] = useState(0)
  const [customName, setCustomName] = useState('')
  const [savedExpanded, setSavedExpanded] = useState(true)
  const [customExpanded, setCustomExpanded] = useState(true)
  const [message, setMessage] = useState('')

  const activeEntry = transitions.find(item => item.id === chosenId) ?? transitions[0]
  const query = search.toLowerCase().trim()
  const shown = useMemo(() => transitions.filter(item =>
    (filter === 'All' || item.group === filter) && `${item.name} ${item.group}`.toLowerCase().includes(query),
  ), [filter, query])
  // Existing /library schema supports "effect". Mark transitions explicitly in the JSON
  // payload rather than sending a new kind that older FastAPI validators may reject.
  const saved = all.filter(item => item.kind === 'effect' && item.payload.preset_type === 'transition'
    && item.parent_id === null && item.name.toLowerCase().includes(query))

  const cut = useMemo(() => {
    if (!selected || (selected.type !== 'video' && selected.type !== 'image')) return null
    const track = tracks.find(t => t.clips.some(c => c.client_id === selected.client_id))
    if (!track || track.locked || selected.locked) return null
    const end = selected.start + selected.duration
    const neighbor = [...track.clips].filter(c => c.client_id !== selected.client_id && (c.type === 'video' || c.type === 'image'))
      .sort((a,b) => Math.abs(a.start - end) - Math.abs(b.start - end))[0]
    if (!neighbor || Math.abs(neighbor.start - end) > 0.15 || neighbor.locked) return null
    return { outgoing: selected, incoming: neighbor }
  }, [selected, tracks])

  const select = (entry: TransitionDefinition) => {
    setChosenId(entry.id)
    setSettings(defaultTransitionSettings(entry))
    setProgress(0)
    setMessage('')
  }
  const patchSetting = <K extends keyof TransitionSettings>(key: K, val: TransitionSettings[K]) => setSettings(old => ({ ...old, [key]: val }))
  const selectSaved = (item: LibraryItem) => {
    const ref = String(item.payload.transition_id ?? 'cross-fade')
    const entry = transitions.find(entry => entry.id === ref) ?? transitions[0]
    setChosenId(entry.id)
    setSettings(loadedSettings(item, entry))
    setProgress(0)
    setMessage(`Loaded “${item.name}”. This is a copy; the saved preset is unchanged.`)
  }
  const attach = (name: string, entry: TransitionDefinition, config: TransitionSettings) => {
    if (!cut) { setMessage('Select a visual clip directly followed by another visual clip on the same unlocked layer.'); return }
    const state = useEditor.getState()
    const metadata = { ...transitionPayload(entry, config), name, from_clip_id: cut.outgoing.client_id, to_clip_id: cut.incoming.client_id }
    // Persist metadata on the outgoing clip using the existing timeline state. Rendering this
    // metadata requires a separate timeline compositor/export-engine implementation.
    const stack = (cut.outgoing.props?.effect_stack ?? []) as Array<Record<string, unknown>>
    const remaining = stack.filter(element => element.preset_type !== 'transition' || element.to_clip_id !== cut.incoming.client_id)
    state.patchProps(cut.outgoing.client_id, { effect_stack: [...remaining, metadata] })
    setMessage(`Settings attached to the cut: ${cut.outgoing.name} → ${cut.incoming.name}. Rendering requires engine support.`)
  }

  return <section className="cl-transitions min-w-0 pb-5 text-[#f2f4fa]" style={{ containerType:'inline-size' }}>
    <style>{`
      .cl-transitions-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:13px}
      .cl-transitions-card-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      .cl-transitions-card{min-width:0;display:flex;flex-direction:column;text-align:left;border:1px solid #344152;border-radius:10px;background:#101924;overflow:hidden;padding:5px;cursor:pointer}
      .cl-transitions-card:hover{border-color:#9a76e9;background:#1c2737}
      .cl-transitions-card[aria-pressed="true"]{border-color:#ae7dff;box-shadow:0 0 0 2px #955de7;background:#24243d}
      .cl-transitions-categories{display:flex;gap:5px;max-width:100%;overflow-x:auto;padding:2px 0 6px;scrollbar-width:thin;scrollbar-color:#48566b transparent}
      .cl-transitions-categories button{flex:0 0 auto;border:1px solid #334255;border-radius:9999px;padding:5px 9px;background:#151e2b;font-size:10px;color:#bdc8d7}
      .cl-transitions-categories button[aria-pressed="true"]{background:#7946dc;border-color:#a37bf7;color:#fff}
      @container (min-width:430px){.cl-transitions-card-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @container (min-width:600px){.cl-transitions-card-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
      @container (min-width:940px){.cl-transitions-grid{grid-template-columns:minmax(0,1.06fr) minmax(0,.94fr)}.cl-transitions-card-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @container (min-width:1160px){.cl-transitions-card-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
    `}</style>
    <header className="mb-3"><div className="flex items-center gap-2"><h2 className="text-lg font-bold">Transitions</h2><span className="rounded-full bg-[#353050] px-2 py-0.5 text-xs text-[#cdb6ff]">{transitions.length}</span></div>
      <p className="mt-1 text-[11px] leading-5 text-[#9da9b9]">Transitions between clips · preview and save reusable presets.</p>
    </header>
    <div className="cl-transitions-grid">
      <div className="min-w-0 space-y-3">
        <div className="flex min-w-0 flex-wrap gap-2">
          <label className="relative min-w-[140px] flex-1"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9bacc0]" size={14}/><input className={`${cnInput} pl-8`} placeholder="Search transitions…" aria-label="Search transitions" value={search} onChange={event => setSearch(event.target.value)}/>{search&&<button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-[#919caf]" onClick={()=>setSearch('')} aria-label="Clear search"><X size={13}/></button>}</label>
          <select className={`${cnInput} w-auto max-w-[136px]`} aria-label="Transition category" value={filter} onChange={event=>setFilter(event.target.value as Filter)}><option value="All">All Groups</option>{transitionGroups.map(group => <option key={group} value={group}>{group}</option>)}</select>
        </div>
        <nav className="cl-transitions-categories" aria-label="Transition categories">{(['All',...transitionGroups] as Filter[]).map(group => <button key={group} type="button" aria-pressed={filter === group} onClick={()=>setFilter(group)}>{group}</button>)}</nav>
        <div className="cl-transitions-card-grid">
          {shown.map(entry => <button type="button" key={entry.id} className="cl-transitions-card" aria-pressed={activeEntry.id === entry.id} title={`Preview ${entry.name}`} onClick={()=>select(entry)}>
            <div className="relative w-full overflow-hidden rounded-md bg-[#223349]" style={{aspectRatio:'1.65'}}><img loading="lazy" className="h-full w-full object-cover" src={entry.thumbnail} alt=""/><span className="absolute bottom-1 right-1 rounded bg-[#0d1522]/90 px-1 py-0.5 text-[9px] font-semibold">{entry.duration.toFixed(1)}s</span></div>
            <strong className="mt-1.5 block truncate text-[11px] font-semibold" title={entry.name}>{entry.name}</strong><span className="mb-0.5 mt-0.5 text-[10px] text-[#9caac0]">{entry.group}</span>
          </button>)}
        </div>
        {!shown.length&&<p className="rounded-lg border border-dashed border-[#344354] p-5 text-center text-xs text-[#9daab9]">No transitions match the current filters.</p>}
      </div>
      <div className="min-w-0 space-y-3">
        <div className={cnSection}><TransitionPreview entry={activeEntry} settings={settings} progress={progress} onProgress={setProgress}/></div>
        <div className={cnSection}>
          <div className="flex min-w-0 items-start gap-3">
            <img className="h-16 w-16 shrink-0 rounded-md object-cover" src={activeEntry.thumbnail} alt=""/>
            <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-bold">{activeEntry.name}</h3><div className="mt-1 flex flex-wrap gap-1"><span className="rounded bg-[#353251] px-1.5 py-0.5 text-[10px] text-[#d1bcff]">{activeEntry.group}</span><span className="rounded bg-[#1b344f] px-1.5 py-0.5 text-[10px] text-[#9dc4ff]">CSS Preview</span></div><p className="mt-2 text-[10px] leading-5 text-[#a6b3c3]">{activeEntry.description}</p></div>
            <button type="button" title="Reset settings" className={cnButton} onClick={() => {setSettings(defaultTransitionSettings(activeEntry));setProgress(0)}}><RotateCcw size={13}/></button>
          </div>
          <div className="mt-4 space-y-3">
            <SettingSlider label="Duration" value={settings.duration} min={0.1} max={5} step={0.05} onChange={n=>patchSetting('duration',n)}/>
            <label className="grid grid-cols-[minmax(70px,1fr)_minmax(0,1.7fr)] items-center gap-2 text-[11px] text-[#b6c1d2]">Easing<select className={cnInput} value={settings.easing} onChange={event=>patchSetting('easing',event.target.value as TransitionSettings['easing'])}>{(['Linear','Ease In','Ease Out','Ease In Out'] as const).map(x=><option key={x}>{x}</option>)}</select></label>
            <label className="grid grid-cols-[minmax(70px,1fr)_minmax(0,1.7fr)] items-center gap-2 text-[11px] text-[#b6c1d2]">Blend Mode<select className={cnInput} value={settings.blend} onChange={event=>patchSetting('blend',event.target.value as TransitionSettings['blend'])}>{(['Normal','Screen','Multiply'] as const).map(x=><option key={x}>{x}</option>)}</select></label>
            <SettingSlider label="Intensity" value={settings.intensity} min={0} max={1} step={0.05} onChange={n=>patchSetting('intensity',n)}/>
            <label className="flex items-center justify-between gap-2 text-[11px] text-[#b6c1d2]">Apply to audio <input className="h-4 w-4 accent-[#945aff]" type="checkbox" checked={settings.applyAudio} onChange={e=>patchSetting('applyAudio',e.target.checked)}/></label>
          </div>
          <button type="button" className={`${cnPurple} mt-4 w-full`} disabled={busy} onClick={()=>void save('effect', activeEntry.name, transitionPayload(activeEntry,settings), null)}><Save size={14}/>Save preset to library</button>
          <button type="button" className={`${cnButton} mt-2 w-full`} disabled={!cut} title={!cut?'Select the outgoing visual clip of an adjacent pair on an unlocked layer':''} onClick={()=>attach(activeEntry.name,activeEntry,settings)}><ArrowLeftRight size={14}/>Attach settings to selected cut</button>
          <p className="mt-2 text-[10px] leading-4 text-[#93a3b5]">{cut ? `${cut.outgoing.name} → ${cut.incoming.name}` : 'For attachment, select an image/video clip followed immediately by another on the same unlocked layer.'}</p>
        </div>
        <div className={cnSection}>
          <button type="button" className="flex w-full items-center justify-between text-left text-xs font-bold" onClick={()=>setCustomExpanded(v=>!v)} aria-expanded={customExpanded}>Save custom transition {customExpanded ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}</button>
          {customExpanded&&<><p className="my-2 text-[10px] leading-4 text-[#a5b0bf]">Save the currently configured transition as your own reusable preset.</p><div className="flex min-w-0 flex-wrap gap-2"><input className={`${cnInput} min-w-[120px] flex-1`} placeholder="My custom transition" value={customName} onChange={e=>setCustomName(e.target.value)}/><button type="button" className={cnPurple} disabled={busy||!customName.trim()} onClick={()=>void save('effect',customName.trim(),transitionPayload(activeEntry,settings),null)}><Save size={13}/>Save</button></div></>}
        </div>
        <div className={cnSection}>
          <button type="button" className="flex w-full items-center justify-between text-left text-xs font-bold" onClick={()=>setSavedExpanded(v=>!v)} aria-expanded={savedExpanded}>Saved Transitions <span className="ml-1 text-[#c4a6fd]">({saved.length})</span>{savedExpanded ? <ChevronDown className="ml-auto" size={16}/> : <ChevronRight className="ml-auto" size={16}/>}</button>
          {savedExpanded&&<><div className="mt-2 flex justify-end"><button type="button" className={cnButton} onClick={()=>void refresh()}><RotateCcw size={13}/>Refresh</button></div>
            <div className="mt-2 space-y-1.5">{saved.map(item=>{
              const preset=transitions.find(entry=>entry.id===item.payload.transition_id)??transitions[0]
              return <div key={item.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-[#303d52] bg-[#1d2938] p-1.5">
                <img src={preset.thumbnail} alt="" className="h-10 w-11 shrink-0 rounded object-cover"/>
                <div className="min-w-0 flex-1"><strong className="block truncate text-[11px]" title={item.name}>{item.name}</strong><span className="text-[10px] text-[#9faec0]">{preset.group} · {loadedSettings(item,preset).duration.toFixed(2)}s</span></div>
                <IconAction label={`Preview ${item.name}`} icon={Play} onClick={()=>selectSaved(item)}/>
                <IconAction label={`Load ${item.name} for editing`} icon={Pencil} onClick={()=>{selectSaved(item);setCustomName(`${item.name} copy`);setCustomExpanded(true)}}/>
                <IconAction label={`Delete ${item.name}`} icon={Trash2} danger onClick={()=>void remove(item)}/>
              </div>
            })}</div>
            {!saved.length&&<p className="mt-2 rounded-lg border border-dashed border-[#364459] px-3 py-4 text-center text-[11px] text-[#9dabbe]">No saved transitions yet. Configure a preset and save it above.</p>}
          </>}
        </div>
        {message&&<div role="status" className="rounded-lg border border-[#3f3c62] bg-[#24213a] p-2.5 text-[11px] text-[#d8ccf8]"><Check className="mr-1 inline" size={13}/>{message}</div>}
        <p className="text-[10px] leading-4 text-[#8a99ac]">Demo preview is illustrative. Saved transition presets use the existing library API. Clip attachment stores transition metadata; live timeline/export rendering must be implemented separately.</p>
      </div>
    </div>
  </section>
}
