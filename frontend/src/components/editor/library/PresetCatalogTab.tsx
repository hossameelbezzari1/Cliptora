import { useMemo, useState } from 'react'
import {
  Check, ChevronDown, ChevronRight, Clapperboard, Pencil,
  Play, RotateCcw, Save, Search, SlidersHorizontal,
  Trash2, X, type LucideIcon,
} from 'lucide-react'
import { animations, effects } from '../../../lib/catalog'
import type { LibraryItem, SmartLibraryModel } from './useSmartLibrary'

type PresetTab = 'effects' | 'animations'
type CatalogPreset = (typeof effects)[number] | (typeof animations)[number]
type ParamValue = number | boolean | string
type ParamRecord = Record<string, ParamValue>

const ASSETS = '/assets/cliptora-presets/'
const buttonClass = 'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#394352] bg-[#1c2531] px-2.5 py-2 text-[11px] font-semibold text-[#d8e0ee] transition hover:border-[#6c568f] hover:bg-[#2a2a3e] disabled:cursor-not-allowed disabled:opacity-40'
const inputClass = 'min-w-0 rounded-lg border border-[#37404d] bg-[#111721] px-2.5 py-2 text-xs text-[#f1eff8] outline-none placeholder:text-[#777f8f] focus:border-[#9063eb]'
const gradientButton = 'inline-flex items-center justify-center gap-2 rounded-lg border border-[#a981ff] bg-gradient-to-r from-[#7b49eb] via-[#814af0] to-[#7040e6] px-3 py-2.5 text-[11px] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40'
const surface = 'rounded-xl border border-[#2c3644] bg-gradient-to-b from-[#141c27] to-[#101822]'
const prettyName = (name: string) => name.replace(/_/g, ' ').replace(/\b\w/g, match => match.toUpperCase())
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n))

// The pictures in public/assets/cliptora-presets are *illustrations*, not live export previews.
function thumbnail(name: string, group = '', kind: PresetTab = 'effects'): string {
  const value = `${name} ${group}`.toLowerCase()
  if (/drop.?shadow|shadow/.test(value)) return `${ASSETS}drop-shadow.webp`
  if (/chromatic|rgb|aberrat/.test(value)) return `${ASSETS}chromatic.webp`
  if (/sharpen|sharpness|clarity/.test(value)) return `${ASSETS}sharpen.webp`
  if (/vignette/.test(value)) return `${ASSETS}vignette.webp`
  if (/grain|noise|static/.test(value)) return `${ASSETS}noise.webp`
  if (/grading|color|colour|lut|saturat/.test(value)) return `${ASSETS}color-grading.webp`
  if (/glow|bloom|light|neon/.test(value)) return `${ASSETS}glow.webp`
  if (/blur|gaussian|pixel|mosaic/.test(value)) return `${ASSETS}blur.webp`
  if (/fade.?out|outro/.test(value)) return `${ASSETS}fade-out.webp`
  if (/fade|opacity|appear/.test(value)) return `${ASSETS}fade-in.webp`
  if (/slide.?right|move.?right/.test(value)) return `${ASSETS}slide-right.webp`
  if (/slide|move/.test(value)) return `${ASSETS}slide-left.webp`
  if (/zoom.?out|scale.?down|shrink/.test(value)) return `${ASSETS}zoom-out.webp`
  if (/zoom|scale|grow/.test(value)) return `${ASSETS}zoom-in.webp`
  if (/rotate|spin|turn/.test(value)) return `${ASSETS}rotate.webp`
  if (/bounce|spring|elastic/.test(value)) return `${ASSETS}bounce.webp`
  return `${ASSETS}${kind === 'effects' ? 'color-grading' : 'fade-in'}.webp`
}

function defaultValue(key: string): ParamValue {
  const lower = key.toLowerCase()
  if (/^(enabled|active|loop|reverse|mirror|repeat|visible)$/.test(lower)) return true
  if (/quality/.test(lower)) return 'Medium'
  if (/easing|ease/.test(lower)) return 'Ease In Out'
  if (/direction/.test(lower)) return 'Left'
  if (/duration/.test(lower)) return 1
  if (/delay|offset|start/.test(lower)) return 0
  if (/count|iterations/.test(lower)) return 2
  if (/rotation|angle/.test(lower)) return 0
  if (/speed/.test(lower)) return 1
  return 0.5
}

function configFor(name: string): { min: number; max: number; step: number } {
  const p = name.toLowerCase()
  if (/duration|delay|offset/.test(p)) return { min: 0, max: 60, step: 0.05 }
  if (/rotation|angle/.test(p)) return { min: -360, max: 360, step: 1 }
  if (/count|iterations/.test(p)) return { min: 1, max: 100, step: 1 }
  if (/speed/.test(p)) return { min: 0.1, max: 8, step: 0.1 }
  if (/scale/.test(p)) return { min: 0, max: 4, step: 0.01 }
  return { min: 0, max: 1, step: 0.01 }
}

function Setting({ name, value, onChange }: {
  name: string; value: ParamValue; onChange: (value: ParamValue) => void
}) {
  const label = prettyName(name)
  if (typeof value === 'boolean') return <label className="cl-preset-setting flex items-center justify-between gap-3 text-[11px]">
    <span className="text-[#b7c0d0]">{label}</span>
    <input type="checkbox" aria-label={label} className="cl-preset-toggle" checked={value} onChange={event => onChange(event.target.checked)}/>
  </label>
  if (typeof value === 'string') {
    const options = /quality/i.test(name) ? ['Low', 'Medium', 'High', 'Ultra']
      : /easing|ease/i.test(name) ? ['Linear', 'Ease In', 'Ease Out', 'Ease In Out']
      : /direction/i.test(name) ? ['Left', 'Right', 'Up', 'Down'] : [value]
    return <label className="cl-preset-setting grid gap-1.5 text-[11px] text-[#b7c0d0]">
      <span>{label}</span>
      <select className={`${inputClass} w-full`} aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  }
  const { min, max, step } = configFor(name)
  const nextValue = (n: number) => onChange(Number(clamp(n, min, max).toFixed(3)))
  return <div className="cl-preset-setting grid min-w-0 grid-cols-[minmax(64px,1fr)_minmax(56px,1.3fr)_64px] items-center gap-2 text-[11px]">
    <label className="min-w-0 truncate text-[#b7c0d0]" title={label}>{label}</label>
    <input className="cl-preset-range min-w-0 w-full accent-[#9b6af3]" type="range" aria-label={`${label} slider`}
      value={clamp(value, min, max)} min={min} max={max} step={step} onChange={event => nextValue(Number(event.target.value))}/>
    <input className={`${inputClass} w-full px-1.5 text-center tabular-nums`} type="number" aria-label={`${label} value`}
      value={value} min={min} max={max} step={step} onChange={event => {
        if (event.target.value === '') return
        const n = Number(event.target.value)
        if (Number.isFinite(n)) nextValue(n)
      }}/>
  </div>
}

function PresetPicture({ name, group, kind, className = '' }: {
  name: string; group?: string; kind: PresetTab; className?: string
}) {
  return <div className={`relative overflow-hidden bg-gradient-to-br from-[#243853] via-[#273a5a] to-[#111827] ${className}`}>
    <img src={thumbnail(name, group, kind)} alt="" draggable={false} loading="lazy" className="h-full w-full object-cover"/>
  </div>
}

function IconButton({ icon: Icon, title, onClick, disabled = false, danger = false }: {
  icon: LucideIcon; title: string; onClick: () => void; disabled?: boolean; danger?: boolean
}) {
  return <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#303c4b] bg-[#232c3a] transition hover:border-[#795ab8] hover:text-white disabled:cursor-not-allowed disabled:opacity-35 ${danger ? 'text-[#ef6475] hover:border-[#ba485b] hover:bg-[#49242f]' : 'text-[#d2d8e7]'}`}>
    <Icon size={14}/>
  </button>
}

export function PresetCatalogTab({ library, tab }: { library: SmartLibraryModel; tab: PresetTab }) {
  const { search, setSearch, name, setName, selected, busy, save, all, refresh, apply, remove } = library
  const isEffect = tab === 'effects'
  const presets: CatalogPreset[] = isEffect ? effects : animations
  const kind = isEffect ? 'effect' : 'animation'
  const [category, setCategory] = useState('All')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [paramValues, setParamValues] = useState<Record<string, ParamRecord>>({})
  const [selectedSaved, setSelectedSaved] = useState<LibraryItem | null>(null)
  const [customClone, setCustomClone] = useState<LibraryItem | null>(null)
  const [showCustom, setShowCustom] = useState(true)
  const [showSaved, setShowSaved] = useState(true)

  const categories = useMemo(() => [...new Set(presets.map(entry => entry.group))], [presets])
  const activeCategory = categories.includes(category) ? category : 'All'
  const query = search.trim().toLowerCase()
  const filtered = presets.filter(entry =>
    (activeCategory === 'All' || entry.group === activeCategory) &&
    `${entry.name} ${entry.group} ${entry.engine}`.toLowerCase().includes(query),
  )
  const presetKey = (p: CatalogPreset) => `${p.kind}:${p.group}:${p.name}`
  const chosen = filtered.find(entry => presetKey(entry) === selectedKey)
    ?? filtered.find(entry => isEffect ? /blur/i.test(entry.name) : /fade.?in/i.test(entry.name))
    ?? filtered[0]
  const chosenKey = chosen ? presetKey(chosen) : ''
  const currentParams: ParamRecord = chosen ? Object.fromEntries(
    chosen.parameters.map(parameter => [parameter, paramValues[chosenKey]?.[parameter] ?? defaultValue(parameter)]),
  ) : {}

  const saved = all.filter(item => item.kind === kind && item.payload.preset_type !== 'transition' && item.parent_id === null &&
    item.name.toLowerCase().includes(query))

  const setParameter = (parameter: string, value: ParamValue) => setParamValues(state => ({
    ...state,
    [chosenKey]: { ...(state[chosenKey] ?? {}), [parameter]: value },
  }))
  const resetParameters = () => setParamValues(state => {
    const next = { ...state }
    delete next[chosenKey]
    return next
  })
  const editCopy = (item: LibraryItem) => {
    const source = presets.find(entry => entry.name === item.name)
    if (source) {
      const key = presetKey(source)
      setCategory('All')
      setSearch('')
      setSelectedKey(key)
      const parameters = item.payload.parameters
      if (parameters && typeof parameters === 'object' && !Array.isArray(parameters)) {
        const config = Object.fromEntries(Object.entries(parameters).filter((entry): entry is [string, ParamValue] =>
          typeof entry[1] === 'number' || typeof entry[1] === 'string' || typeof entry[1] === 'boolean'))
        setParamValues(state => ({ ...state, [key]: config }))
      }
      setSelectedSaved(item)
      setName(`${item.name} copy`)
      setCustomClone(null)
    } else {
      setName(`${item.name} copy`)
      setShowCustom(true)
      setSelectedSaved(null)
      setCustomClone(item)
    }
  }

  return <section className="cl-preset-root min-w-0 space-y-3 pb-5 text-xs text-[#f4f4fa]" style={{ containerType: 'inline-size' }}>
    <style>{`
      .cl-preset-root{--cl-accent:#8e58f5}
      .cl-preset-root .cl-preset-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,110px),1fr));gap:9px}
      .cl-preset-root .cl-preset-card{min-width:0;overflow:hidden;border-radius:12px;border:1px solid #2e3b4b;background:#17202b;text-align:left;transition:background .15s,border-color .15s,box-shadow .15s}
      .cl-preset-root .cl-preset-card:hover{border-color:#8e63d9;background:#1c2634}
      .cl-preset-root .cl-preset-card[aria-pressed="true"]{border-color:#b280ff;box-shadow:0 0 0 2px #8854de88;background:#1e2535}
      .cl-preset-root .cl-preset-card:focus-visible{outline:2px solid #c29bff;outline-offset:2px}
      .cl-preset-root .cl-preset-toggle{appearance:none;position:relative;width:34px;height:20px;flex:0 0 34px;border-radius:99px;border:1px solid #596273;background:#3a4350;cursor:pointer;transition:background .15s}
      .cl-preset-root .cl-preset-toggle:checked{background:#874ef2;border-color:#9566ed}
      .cl-preset-root .cl-preset-toggle:after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;background:white;border-radius:50%;transition:transform .15s}
      .cl-preset-root .cl-preset-toggle:checked:after{transform:translateX(14px)}
      .cl-preset-root .cl-preset-setting{min-height:32px}
      .cl-preset-root .cl-preset-categories{scrollbar-width:thin;scrollbar-color:#55456f transparent}
      @container (max-width: 300px){.cl-preset-root .cl-preset-card-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.cl-preset-root .cl-preset-settings-grid{grid-template-columns:1fr}}
      @container (min-width: 460px){.cl-preset-root .cl-preset-card-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
    `}</style>

    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold tracking-[-0.03em]">{isEffect ? 'Effects' : 'Animations'}</h2>
          <span className="rounded-full border border-[#454060] bg-[#322c50] px-2 py-0.5 text-[11px] font-bold text-[#cbb3ff]">{presets.length}</span>
        </div>
        <p className="mt-1 text-[11px] leading-5 text-[#9ca8b9]">{isEffect ? 'Apply visual effects to your clips. Save presets globally.' : 'Add motion to your clips. Save presets globally.'}</p>
      </div>
    </div>

    <div className="flex min-w-0 items-center gap-2">
      <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#354151] bg-[#151c26] px-3 focus-within:border-[#9462fa]">
        <Search size={15} className="shrink-0 text-[#9ca7b8]"/>
        <input aria-label={`Search ${tab}`} className="min-w-0 flex-1 bg-transparent text-[11px] text-white outline-none placeholder:text-[#838d9d]"
          placeholder={isEffect ? 'Search effects...' : 'Search animations...'} value={search} onChange={event => setSearch(event.target.value)}/>
        {search && <button type="button" title="Clear search" aria-label="Clear search" onClick={() => setSearch('')}><X size={14}/></button>}
      </label>
      <div className="relative min-w-[85px] max-w-[40%]">
        <select aria-label="Filter preset group" className={`${inputClass} h-10 w-full cursor-pointer appearance-none pr-7 text-[11px]`}
          value={activeCategory} onChange={event => setCategory(event.target.value)}>
          <option value="All">All Groups</option>
          {categories.map(group => <option value={group} key={group}>{group}</option>)}
        </select>
        <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#b7c1d2]"/>
      </div>
    </div>

    <div className="cl-preset-categories flex min-w-0 gap-1.5 overflow-x-auto pb-1" aria-label={tab + ' groups'}>
      {['All', ...categories].map(group => <button key={group} type="button" onClick={() => setCategory(group)}
        aria-pressed={activeCategory === group} className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${activeCategory === group
          ? 'border-[#a475fa] bg-gradient-to-r from-[#8b54f7] to-[#6536bd] text-white'
          : 'border-[#344051] bg-[#1a222d] text-[#c3cad8] hover:border-[#7b5ca8]'}`}>{group}</button>)}
    </div>

    <div className="cl-preset-card-grid" aria-label={tab + ' catalog'}>
      {filtered.map(entry => {
        const key = presetKey(entry)
        const selectedCard = key === chosenKey
        return <button type="button" key={key} className="cl-preset-card p-1.5" aria-pressed={selectedCard}
          title={`Configure ${entry.name}`} onClick={() => { setSelectedKey(key); setSelectedSaved(null) }}>
          <div className="relative aspect-[1.44] w-full overflow-hidden rounded-lg bg-[#26344b]">
            <PresetPicture name={entry.name} group={entry.group} kind={tab} className="h-full w-full"/>
            <span className="absolute left-1.5 top-1.5 rounded-md bg-[#172132]/85 p-1 text-[#e7edfb]">
              {isEffect ? <SlidersHorizontal size={12}/> : <Clapperboard size={12}/>}
            </span>
          </div>
          <span className="mt-2 block truncate text-[11px] font-semibold" title={entry.name}>{entry.name}</span>
          <span className="mt-0.5 block truncate text-[10px] text-[#9ca6b9]" title={`${entry.group} · ${entry.engine}`}>{entry.group} · {entry.engine}</span>
        </button>
      })}
    </div>
    {filtered.length === 0 && <div className="rounded-xl border border-dashed border-[#354252] px-4 py-8 text-center text-[11px] text-[#a7aebd]">No presets found. Try another category or search term.</div>}

    {chosen && <div className={`${surface} p-3`}>
      <div className="cl-preset-settings-grid grid min-w-0 grid-cols-[minmax(70px,94px)_minmax(0,1fr)] gap-3">
        <PresetPicture name={chosen.name} group={chosen.group} kind={tab} className="aspect-[1.15] self-start rounded-lg"/>
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <h3 className="min-w-0 break-words text-[14px] font-bold">{chosen.name}</h3>
            <span className="rounded-full bg-[#2b3144] px-2 py-0.5 text-[10px] text-[#ded2fa]">{chosen.group}</span>
            <span className="rounded-full bg-[#1a2b48] px-2 py-0.5 text-[10px] text-[#90b7ff]">{chosen.engine}</span>
            <button type="button" className={`${buttonClass} ml-auto`} onClick={resetParameters} title="Reset to defaults"><RotateCcw size={13}/> Reset</button>
          </div>
          <p className="text-[11px] leading-4 text-[#a6b0c2]">{isEffect ? 'Adjust the effect parameters, then save a reusable preset.' : 'Adjust motion and timing, then save an animation preset.'}</p>
          {selectedSaved && <p className="text-[10px] text-[#baa2ed]">Editing a copy of “{selectedSaved.name}”. Save creates a new preset.</p>}
        </div>
      </div>
      <div className="mt-3 space-y-2 border-t border-[#293646] pt-3">
        {selectedSaved && <input aria-label="New preset name" className={`${inputClass} w-full`} value={name} onChange={event => setName(event.target.value)} placeholder="New preset name"/>}
        {chosen.parameters.length
          ? chosen.parameters.map(parameter => <Setting key={parameter} name={parameter} value={currentParams[parameter]} onChange={value => setParameter(parameter, value)}/> )
          : <p className="text-[11px] text-[#9eabba]">This preset has no adjustable parameters.</p>}
      </div>
      <button type="button" disabled={busy || (Boolean(selectedSaved) && !name.trim())} className={`${gradientButton} mt-3 w-full`} onClick={() => void save(chosen.kind, selectedSaved ? name.trim() : chosen.name, {
        ...chosen,
        name: selectedSaved ? name.trim() : chosen.name,
        parameters: currentParams,
      }, null)}><Save size={15}/>{busy ? 'Saving...' : 'Save preset to library'}</button>
    </div>}

    <div className={`${surface} p-3`}>
      <button type="button" className="flex w-full items-center justify-between gap-2 text-left" aria-expanded={showCustom} onClick={() => setShowCustom(open => !open)}>
        <span className="min-w-0">
          <span className="block text-[12px] font-bold">Save custom {isEffect ? 'effect' : 'animation'} from selected clip</span>
          <span className="mt-1 block text-[10px] leading-4 text-[#9ca8b8]">Save the current {isEffect ? 'effect' : 'animation'} stack as a reusable preset.</span>
        </span>
        {showCustom ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
      </button>
      {showCustom && <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
        {customClone && <p className="w-full text-[10px] text-[#baa2ed]">Creating a copy of “{customClone.name}”. The original remains unchanged.</p>}
        <input className={`${inputClass} min-w-[120px] flex-1`} value={name} placeholder={`My custom ${isEffect ? 'effect' : 'animation'}`}
          onChange={event => setName(event.target.value)}/>
        <button type="button" className={gradientButton} disabled={(!selected && !customClone) || !name.trim() || busy} onClick={() => {
          void save(kind, name, customClone ? { ...customClone.payload, name } : {
            name, stack: isEffect ? selected?.props?.effect_stack ?? [] : selected?.props?.animation_stack ?? [],
          }, null)
        }}><Save size={14}/>Save</button>
        {!selected && !customClone && <span className="w-full text-[10px] text-[#a6a0b6]">Select a clip in Timeline to save its settings.</span>}
      </div>}
    </div>

    <div className={`${surface} min-w-0 p-3`}>
      <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setShowSaved(open => !open)} aria-expanded={showSaved}>
        <h3 className="min-w-0 text-[12px] font-bold">Saved {isEffect ? 'Effects' : 'Animations'} <span className="text-[#baa3eb]">({saved.length})</span></h3>
        {showSaved ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}
      </button>
      {showSaved && <>
        <div className="mt-2 flex justify-end">
          <button type="button" className={`${buttonClass} py-1.5`} onClick={() => void refresh()}><RotateCcw size={13}/> Refresh</button>
        </div>
        <div className="mt-2 space-y-1.5">
          {saved.map(item => {
            const matching = presets.find(entry => entry.name === item.name)
            const group = typeof item.payload.group === 'string' ? item.payload.group : matching?.group ?? ''
            const engine = typeof item.payload.engine === 'string' ? item.payload.engine : matching?.engine ?? ''
            return <div key={item.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-[#273240] bg-[#1b2530] p-1.5">
              <PresetPicture name={item.name} group={group} kind={tab} className="h-10 w-12 shrink-0 rounded-md"/>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-semibold" title={item.name}>{item.name}</span>
                <span className="mt-0.5 block truncate text-[9px] text-[#9daabe]">{[group, engine].filter(Boolean).join(' · ') || 'Custom preset'}</span>
              </span>
              <IconButton icon={Play} title={selected ? `Apply ${item.name} to selected clip` : 'Select a clip in Timeline to apply'} disabled={!selected} onClick={() => apply(item)}/>
              <IconButton icon={Pencil} title="Edit a copy" onClick={() => editCopy(item)}/>
              <IconButton icon={Trash2} title={`Delete ${item.name}`} danger onClick={() => void remove(item)}/>
            </div>
          })}
          {saved.length === 0 && <p className="rounded-lg border border-dashed border-[#384353] px-3 py-5 text-center text-[11px] text-[#9ea9b9]">No saved {tab} yet. Configure a preset above and save it.</p>}
        </div>
      </>}
    </div>
    <p className="flex items-center gap-1.5 text-[10px] leading-4 text-[#8390a2]"><Check size={12}/> Thumbnail images are illustrative. Preview/export rendering depends on your engine.</p>
  </section>
}
