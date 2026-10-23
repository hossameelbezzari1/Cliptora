import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import {
  AudioLines, Boxes, Clapperboard, Eye, Film, FlipHorizontal2, FlipVertical2,
  Image as ImageIcon, Layers3, LockKeyhole, Move, Palette, Repeat2,
  RotateCcw, Settings2, SlidersHorizontal, Sparkles, TerminalSquare,
  Type, WandSparkles, X, type LucideIcon,
} from 'lucide-react'
import { useEditor } from '../../../stores/editorStore'
import type { Clip, ClipProperties } from '../../../types'
import { RepeatSettings } from './RepeatSettings'
import { ClipCommandsSection } from './ClipCommandsSection'

type TabKey = 'general' | 'transform' | 'media' | 'audio' | 'appearance' | 'effects' | 'animations' | 'repeat' | 'commands' | 'all'
type Kind = 'none' | 'image' | 'video' | 'audio' | 'text' | 'shape' | 'blur'
type Tab = { id: TabKey; label: string; icon: LucideIcon }
type Tracks = ReturnType<typeof useEditor.getState>['tracks']

const inputStyle = 'w-full min-w-0 rounded-lg border border-[#393b48] bg-[#15171d] px-2.5 py-2 text-xs text-[#f0edf8] outline-none transition-colors focus:border-[#9b71ea] disabled:cursor-not-allowed disabled:opacity-50'
const fieldStyle = 'flex min-w-0 flex-col gap-1.5 text-[11px] font-medium text-[#a9acba]'
const panelStyle = 'min-w-0 rounded-xl border border-[#343641] bg-[#22232b] p-3'
const mutedStyle = 'text-[11px] leading-[1.6] text-[#9da1af]'
const secondaryButton = 'inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg border border-[#474351] bg-[#292833] px-3 py-2 text-[11px] font-medium text-[#eee5fc] transition-colors hover:bg-[#363043] disabled:cursor-not-allowed disabled:opacity-40'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const number = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits

function getKind(clip: Clip | null): Kind {
  if (!clip) return 'none'
  if (clip.type === 'image' || clip.type === 'video' || clip.type === 'audio') return clip.type
  const name = String(clip.props?.shape_kind ?? '').toLowerCase()
  if (!name) return 'text'
  return /blur|mosaic|pixel/.test(name) ? 'blur' : 'shape'
}

function kindLabel(kind: Kind) {
  const labels: Record<Kind, string> = {
    none: 'No selection', image: 'Image', video: 'Video', audio: 'Audio',
    text: 'Text', shape: 'Shape', blur: 'Blur',
  }
  return labels[kind]
}

function getTabs(kind: Kind): Tab[] {
  if (kind === 'none') return [{ id: 'all', label: 'Settings', icon: Settings2 }]
  const result: Tab[] = [
    { id: 'general', label: 'General', icon: SlidersHorizontal },
    { id: 'transform', label: 'Transform', icon: Move },
  ]
  if (kind === 'image' || kind === 'video') {
    result.push({ id: 'media', label: kind === 'image' ? 'Image' : 'Video', icon: kind === 'image' ? ImageIcon : Film })
  }
  if (kind === 'video' || kind === 'audio') result.push({ id: 'audio', label: 'Audio', icon: AudioLines })
  if (kind === 'text' || kind === 'shape' || kind === 'blur') {
    result.push({
      id: 'appearance',
      label: kind === 'blur' ? 'Blur' : kind === 'shape' ? 'Shape' : 'Text',
      icon: kind === 'blur' ? WandSparkles : kind === 'shape' ? Palette : Type,
    })
  }
  result.push(
    { id: 'effects', label: 'Effects', icon: Sparkles },
    { id: 'animations', label: 'Animation', icon: Clapperboard },
    { id: 'repeat', label: 'Repeat', icon: Repeat2 },
    { id: 'commands', label: 'Commands', icon: TerminalSquare },
    { id: 'all', label: 'All settings', icon: Settings2 },
  )
  return result
}

function Group({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <section className="mb-3 min-w-0 space-y-3">
    <div className="min-w-0">
      <h3 className="break-words text-[12px] font-semibold text-[#f1edf8]">{title}</h3>
      {subtitle && <p className={`mt-1 ${mutedStyle}`}>{subtitle}</p>}
    </div>
    <div className={`${panelStyle} space-y-3`}>{children}</div>
  </section>
}

function NumericField({ label, value, onChange, min = -1e7, max = 1e7, step = 1, unit, disabled = false }: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  disabled?: boolean
}) {
  return <label className={fieldStyle}>
    <span>{label}</span>
    <span className="relative block min-w-0">
      <input
        aria-label={label}
        className={`${inputStyle} ${unit ? 'pr-9' : ''}`}
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={event => {
          if (event.target.value.trim() === '') return
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(clamp(next, min, max))
        }}
      />
      {unit && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[#838996]">{unit}</span>}
    </span>
  </label>
}

function RangeField({ label, value, onChange, min = 0, max = 100, step = 1, unit = '%', disabled = false }: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  disabled?: boolean
}) {
  return <label className="block min-w-0 space-y-2">
    <span className="flex min-w-0 items-center justify-between gap-2 text-[11px]">
      <span className="truncate text-[#b3b6c3]">{label}</span>
      <span className="shrink-0 font-semibold tabular-nums text-[#d9bcff]">{round(value, 1)}{unit}</span>
    </span>
    <input type="range" className="block w-full min-w-0 cursor-pointer accent-[#9a66e8] disabled:cursor-not-allowed disabled:opacity-50"
      aria-label={label} value={clamp(value, min, max)} min={min} max={max} step={step}
      disabled={disabled} onChange={event => onChange(Number(event.target.value))}/>
  </label>
}

function CheckField({ label, checked, onChange, disabled = false }: {
  label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean
}) {
  return <label className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border border-[#373942] bg-[#1b1c24] p-2.5 text-[11px] text-[#e0dce8]">
    <input type="checkbox" className="h-4 w-4 shrink-0 accent-[#9764e4]" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}/>
    <span>{label}</span>
  </label>
}

function InspectorContent({ tab, kind, clip, tracks, onAll }: {
  tab: TabKey; kind: Kind; clip: Clip; tracks: Tracks; onAll: () => void
}) {
  const patchClip = useEditor(state => state.patchClip)
  const patchProps = useEditor(state => state.patchProps)
  const setPlayhead = useEditor(state => state.setPlayhead)
  const setPreviewTool = useEditor(state => state.setPreviewTool)
  const props = clip.props ?? {}
  const extra = props as ClipProperties & { blur_strength?: number; blurStrength?: number }
  const setBlurStrength = (value: number) => patchProps(clip.client_id, { blur_strength: value } as unknown as ClipProperties)
  const shapeKind = String(props.shape_kind ?? '')
  const track = tracks.find(item => item.clips.some(itemClip => itemClip.client_id === clip.client_id))
  const locked = Boolean(clip.locked || track?.locked)
  const setProp = <K extends keyof ClipProperties>(key: K, value: ClipProperties[K]) => {
    patchProps(clip.client_id, { [key]: value } as ClipProperties)
  }
  const numericProp = (label: string, key: keyof ClipProperties, fallback: number, options: {
    min?: number; max?: number; step?: number; unit?: string
  } = {}) => <NumericField key={key} label={label} value={number(props[key], fallback)}
    onChange={value => setProp(key, value as ClipProperties[typeof key])}
    min={options.min} max={options.max} step={options.step} unit={options.unit} disabled={locked}/>
  const openAll = <button type="button" className="mt-1 text-left text-[11px] text-[#c8a9fc] hover:underline" onClick={onAll}>More settings →</button>

  if (tab === 'general') return <>
    <Group title="Clip information" subtitle={`${kindLabel(kind)} · ${track?.name ?? 'Timeline'}`}>
      <label className={fieldStyle}>Element name
        <input className={inputStyle} type="text" value={clip.name ?? ''} disabled={locked}
          onChange={event => patchClip(clip.client_id, { name: event.target.value })}/>
      </label>
      <div className="cl-inspector-pair grid min-w-0 grid-cols-1 gap-2">
        <NumericField label="Start" value={number(clip.start)} min={0} step={0.01} unit="s" disabled={locked}
          onChange={value => patchClip(clip.client_id, { start: round(value) })}/>
        <NumericField label="Duration" value={number(clip.duration, 5)} min={0.04} step={0.01} unit="s" disabled={locked}
          onChange={value => patchClip(clip.client_id, { duration: round(value) })}/>
      </div>
      <button type="button" className={`${secondaryButton} w-full`} onClick={() => setPlayhead(clip.start)}>
        <Eye size={14}/> Show at clip start
      </button>
      {locked && <p className="flex items-center gap-2 text-[11px] text-amber-300"><LockKeyhole size={13}/> Unlock the clip or layer to edit.</p>}
    </Group>
    {openAll}
  </>

  if (tab === 'transform') return <>
    {kind === 'audio' ? <p className={mutedStyle}>Audio has no visual transform. Edit its volume under Audio.</p> : <>
      <Group title="Position & size" subtitle="Values are relative to the preview canvas, in percent.">
        <div className="cl-inspector-pair grid min-w-0 grid-cols-1 gap-2">
          {numericProp('Position X', 'x', 0, { step: 0.5, unit: '%' })}
          {numericProp('Position Y', 'y', 0, { step: 0.5, unit: '%' })}
          {numericProp('Width', 'width', 100, { min: 0.1, max: 500, step: 0.5, unit: '%' })}
          {numericProp('Height', 'height', 100, { min: 0.1, max: 500, step: 0.5, unit: '%' })}
        </div>
      </Group>
      <Group title="Rotation & scale">
        {numericProp('Rotation', 'rotation', 0, { min: -3600, max: 3600, step: 1, unit: '°' })}
        {numericProp('Scale', 'scale', 1, { min: 0.01, max: 20, step: 0.05, unit: '×' })}
        <div className="cl-inspector-pair grid min-w-0 grid-cols-1 gap-2">
          <button type="button" disabled={locked} className={secondaryButton} onClick={() => setProp('flip_x', !Boolean(props.flip_x))}>
            <FlipHorizontal2 size={15}/> Flip X {props.flip_x ? '✓' : ''}
          </button>
          <button type="button" disabled={locked} className={secondaryButton} onClick={() => setProp('flip_y', !Boolean(props.flip_y))}>
            <FlipVertical2 size={15}/> Flip Y {props.flip_y ? '✓' : ''}
          </button>
        </div>
        <button type="button" className={secondaryButton} disabled={locked}
          onClick={() => patchProps(clip.client_id, { rotation: 0, scale: 1, flip_x: false, flip_y: false })}>
          <RotateCcw size={14}/> Reset rotation & flips
        </button>
      </Group>
      <Group title="Visibility">
        <RangeField label="Opacity" value={round(number(props.opacity, 1) * 100)} disabled={locked}
          onChange={value => setProp('opacity', round(value / 100, 3))}/>
      </Group>
    </>}
    {openAll}
  </>

  if (tab === 'media') return <>
    <Group title={`${kindLabel(kind)} source`} subtitle="Non-destructive editing: original media is unchanged.">
      <p className={`${mutedStyle} break-all`}>Media ID: {clip.media_id ?? 'None'}</p>
      <button type="button" className={`${secondaryButton} w-full`} disabled={locked || !clip.media_id}
        onClick={() => {
          useEditor.getState().selectClip(clip.client_id)
          setPreviewTool('crop')
          setPlayhead(clip.start + Math.min(0.03, clip.duration / 4))
        }}>
        Crop in Preview
      </button>
    </Group>
    <Group title="Crop" subtitle="Percent of the image or video dimension removed from each edge.">
      <div className="cl-inspector-pair grid min-w-0 grid-cols-1 gap-2">
        {numericProp('Left', 'crop_left', 0, { min: 0, max: 95, step: 0.5, unit: '%' })}
        {numericProp('Right', 'crop_right', 0, { min: 0, max: 95, step: 0.5, unit: '%' })}
        {numericProp('Top', 'crop_top', 0, { min: 0, max: 95, step: 0.5, unit: '%' })}
        {numericProp('Bottom', 'crop_bottom', 0, { min: 0, max: 95, step: 0.5, unit: '%' })}
      </div>
      <button type="button" className={secondaryButton} disabled={locked}
        onClick={() => patchProps(clip.client_id, { crop_left: 0, crop_right: 0, crop_top: 0, crop_bottom: 0 })}>Reset crop</button>
    </Group>
    {kind === 'video' && <Group title="Playback">
      <CheckField label="Reverse playback" checked={Boolean(props.reversed)} disabled={locked}
        onChange={checked => setProp('reversed', checked)}/>
    </Group>}
    {openAll}
  </>

  if (tab === 'audio') return <>
    <Group title="Sound" subtitle={kind === 'video' ? 'Audio from the selected video.' : 'Audio clip properties.'}>
      <RangeField label="Volume" min={0} max={100} value={round(number(props.volume, 1) * 100)} disabled={locked}
        onChange={value => setProp('volume', round(value / 100, 3))}/>
      <CheckField label="Mute this clip" checked={Boolean(props.audio_muted)} disabled={locked}
        onChange={checked => setProp('audio_muted', checked)}/>
    </Group>
    {openAll}
  </>

  if (tab === 'appearance') return <>
    {kind === 'text' && <Group title="Text content">
      <label className={fieldStyle}>Content
        <textarea className={`${inputStyle} min-h-28 resize-y`} value={clip.text ?? ''} disabled={locked}
          onChange={event => patchClip(clip.client_id, { text: event.target.value })}/>
      </label>
    </Group>}
    {(kind === 'text' || kind === 'shape') && <Group title="Appearance" subtitle={shapeKind || undefined}>
      <label className={fieldStyle}>Fill / text color
        <div className="flex min-w-0 items-center gap-2">
          <input type="color" className="h-10 w-11 shrink-0 cursor-pointer rounded-lg border border-[#40424d] bg-[#17191e] p-1"
            aria-label="Element color" value={/^#[0-9a-f]{6}$/i.test(clip.color ?? '') ? clip.color : '#a580db'}
            disabled={locked} onChange={event => patchClip(clip.client_id, { color: event.target.value })}/>
          <span className="min-w-0 truncate font-mono text-[11px] text-[#c0bfcb]">{clip.color ?? '#a580db'}</span>
        </div>
      </label>
    </Group>}
    {kind === 'blur' && <>
      <Group title="Blur intensity" subtitle={`Effect: ${shapeKind || 'Blur Box'}`}>
        <RangeField label="Blur strength" min={0} max={100}
          value={clamp(number(extra.blur_strength ?? extra.blurStrength, 16), 0, 100)} disabled={locked}
          onChange={setBlurStrength}/>
        <NumericField label="Exact strength" min={0} max={100} step={1} unit="%"
          value={clamp(number(extra.blur_strength ?? extra.blurStrength, 16), 0, 100)} disabled={locked}
          onChange={setBlurStrength}/>
        <p className={mutedStyle}>0% disables the blur. Blur uses the lower visible timeline layers as the background in Preview.</p>
      </Group>
    </>}
    {openAll}
  </>

  if (tab === 'effects' || tab === 'animations') {
    const isEffect = tab === 'effects'
    const entries = isEffect ? props.effect_stack ?? [] : props.animation_stack ?? []
    return <>
      <Group title={isEffect ? 'Effects stack' : 'Animation stack'} subtitle="Applied to this element in order.">
        {entries.length === 0 && <p className={mutedStyle}>No {isEffect ? 'effects' : 'animations'} applied. Add presets from the Library.</p>}
        {entries.map((entry, index) => {
          const label = entry && typeof entry === 'object' && 'name' in entry
            ? String((entry as { name: unknown }).name) : `${isEffect ? 'Effect' : 'Animation'} ${index + 1}`
          return <div key={`${label}-${index}`}
            className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-[#3b3a46] bg-[#1b1c24] px-2.5 py-2">
            <span className="min-w-0 truncate text-[11px] text-[#e5e0f0]" title={label}>{index + 1}. {label}</span>
            <button type="button" title={`Remove ${label}`} aria-label={`Remove ${label}`}
              disabled={locked} className="shrink-0 rounded-md p-1 text-[#a4a7b1] hover:bg-[#452b38] hover:text-rose-300 disabled:opacity-40"
              onClick={() => {
                if (isEffect) setProp('effect_stack', (props.effect_stack ?? []).filter((_, i) => i !== index))
                else setProp('animation_stack', (props.animation_stack ?? []).filter((_, i) => i !== index))
              }}><X size={14}/></button>
          </div>
        })}
      </Group>
      {openAll}
    </>
  }

  if (tab === 'repeat') return <>
    <div className="mb-3"><h3 className="text-sm font-semibold text-white">Repeat / Linked Element</h3></div>
    <RepeatSettings clip={clip} tracks={tracks}/>
  </>

  if (tab === 'commands') return <>
    <div className="mb-3"><h3 className="text-sm font-semibold text-white">Commands / Automation</h3></div>
    <ClipCommandsSection clipId={clip.client_id}/>
  </>

  return null
}

/** The original InspectorPanel remains available under "All settings". */
export function AdaptiveInspectorPanel({ original }: { original: ReactNode }) {
  const id = useId().replace(/:/g, '')
  const selectedClipId = useEditor(state => state.selectedClipId)
  const tracks = useEditor(state => state.tracks)
  const clip = useMemo(() => tracks.flatMap(track => track.clips)
    .find(item => item.client_id === selectedClipId) ?? null, [tracks, selectedClipId])
  const kind = getKind(clip)
  const tabs = useMemo(() => getTabs(kind), [kind])
  const [active, setActive] = useState<TabKey>('general')
  const [previousKind, setPreviousKind] = useState<Kind>(kind)

  // Choose relevant initial tab when the selected element changes type;
  // switching between two images, for example, preserves the user's current tab.
  useEffect(() => {
    if (previousKind === kind) return
    setPreviousKind(kind)
    setActive(kind === 'none' ? 'all' : 'general')
  }, [kind, previousKind])

  const current = tabs.some(item => item.id === active) ? active : tabs[0].id
  const selectedTab = tabs.find(item => item.id === current) ?? tabs[0]
  const CurrentIcon = selectedTab.icon

  return <aside className="cl-inspector-root relative flex h-full min-h-0 min-w-0 w-full overflow-hidden bg-[#191a20] text-white"
    style={{ containerType: 'inline-size' }} aria-label="Clip settings">
    <style>{`
      .cl-inspector-root{display:flex;flex-direction:row;min-height:0;min-width:0;align-items:stretch}
      .cl-inspector-pair{grid-template-columns:minmax(0,1fr)}
      .cl-inspector-content{order:1;flex:1 1 0;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#51505c transparent}
      .cl-inspector-rail{order:2;display:flex;flex-direction:column;align-items:stretch;flex:0 0 76px;width:76px;min-height:0;overflow-y:auto;overflow-x:hidden;background:#22222a;border-left:1px solid #373640;scrollbar-width:thin;scrollbar-color:#585364 transparent}
      .cl-inspector-tab{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;width:100%;min-height:63px;padding:8px 3px;border-left:3px solid transparent;color:#9da0ae;transition:background .15s,color .15s}
      .cl-inspector-tab:hover{background:#302d3a;color:#f6f0ff}
      .cl-inspector-tab[aria-selected="true"]{background:#392b54;border-left-color:#b18cff;color:#edddff}
      .cl-inspector-tab:focus-visible{outline:2px solid #b68aff;outline-offset:-3px}
      .cl-inspector-tab-label{max-width:100%;font-size:10px;line-height:1.2;font-weight:500;text-align:center;overflow-wrap:anywhere}
      .cl-inspector-legacy{min-width:0;max-width:100%;overflow-x:hidden}
      .cl-inspector-legacy > .inspector,.cl-inspector-legacy .inspector{min-width:0!important;width:100%!important;max-width:100%!important;height:auto!important;min-height:0!important;overflow:visible!important;padding:0!important;background:transparent!important;border:0!important}
      @container (min-width: 430px){.cl-inspector-pair{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @container (max-width: 350px){.cl-inspector-rail{width:57px;flex-basis:57px}.cl-inspector-tab{min-height:54px;gap:4px;padding:5px 2px}.cl-inspector-tab-label{font-size:9px}.cl-inspector-content .cl-inspector-padding{padding:10px}}
      @container (max-width: 260px){.cl-inspector-rail{width:47px;flex-basis:47px}.cl-inspector-tab{min-height:45px}.cl-inspector-tab-label{display:none}.cl-inspector-content .cl-inspector-padding{padding:8px}}
    `}</style>

    <div className="cl-inspector-content" id={`${id}-content`} role="tabpanel" aria-labelledby={`${id}-tab-${current}`}>
      <div className="sticky top-0 z-20 flex min-w-0 items-center gap-2 border-b border-[#33343e] bg-[#1a1b22]/95 px-3 py-3 backdrop-blur-xl">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#352945] text-[#caadf5]"><CurrentIcon size={17}/></span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-bold">{clip?.name || 'Clip Settings'}</h2>
          <p className="truncate text-[10px] text-[#a19aaa]">{kindLabel(kind)} · {selectedTab.label}</p>
        </div>
        {clip && <span title={kindLabel(kind)} className="shrink-0 text-[#947ac3]">
          {kind === 'blur' ? <WandSparkles size={17}/> : kind === 'shape' ? <Boxes size={17}/> : kind === 'video' ? <Film size={17}/> : kind === 'image' ? <ImageIcon size={17}/> : kind === 'audio' ? <AudioLines size={17}/> : kind === 'text' ? <Type size={17}/> : <Layers3 size={17}/>}
        </span>}
      </div>
      <div className="cl-inspector-padding min-w-0 p-3" key={`${selectedClipId ?? 'none'}:${current}`}>
        {current === 'all' || !clip
          ? <div className="cl-inspector-legacy">{original}</div>
          : <InspectorContent tab={current} kind={kind} clip={clip} tracks={tracks} onAll={() => setActive('all')}/>}
      </div>
    </div>

    <nav className="cl-inspector-rail" role="tablist" aria-orientation="vertical" aria-label="Clip settings sections">
      {tabs.map(({ id: tabId, label, icon: Icon }) => <button key={tabId} type="button"
        id={`${id}-tab-${tabId}`} aria-controls={`${id}-content`} aria-selected={current === tabId}
        title={label} role="tab" className="cl-inspector-tab" onClick={() => setActive(tabId)}>
        <Icon size={19} strokeWidth={1.85}/>
        <span className="cl-inspector-tab-label">{label}</span>
      </button>)}
    </nav>
  </aside>
}
