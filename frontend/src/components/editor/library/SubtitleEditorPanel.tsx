import { useEffect, useMemo, useRef, useState } from 'react'
import { Captions, Download, FileJson, FileText, ListPlus, Play, Plus, Trash2 } from 'lucide-react'
import { fileUrl } from '../../../lib/api'
import type { MediaAsset } from '../../../types'
import { mediaName } from './mediaLibraryUtils'
import type { SubtitleLibraryModel } from './useSubtitlesLibrary'
import { saveSubtitleDownload, shortTime, type SubtitleCue, type SubtitleStyle } from './subtitleUtils'

const input = 'w-full min-w-0 rounded-lg border border-[#343d4c] bg-[#111924] px-3 py-2 text-[12px] text-white outline-none focus:border-[#8b50ed]'
const smallBtn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#343c4b] bg-[#18202c] px-3 py-2 text-[11px] text-[#d0d7e4] hover:border-[#8754d6] hover:text-white'
const tabs = ['Content', 'Style', 'Timing', 'Export'] as const
type EditorTab = typeof tabs[number]
const languageOptions = ['English', 'Français', 'العربية', 'Español', 'Deutsch', 'Other']

function CueFields({ cue, onChange }: { cue: SubtitleCue; onChange: (patch: Partial<SubtitleCue>) => void }) {
  return <div className="grid min-w-0 grid-cols-2 gap-3">
    <label className="grid min-w-0 gap-1 text-[11px] text-[#a8b3c2]">Start (seconds)
      <input className={input} type="number" min="0" step="0.01" value={cue.start} onChange={e => onChange({ start: Math.max(0, Number(e.target.value) || 0) })}/>
    </label>
    <label className="grid min-w-0 gap-1 text-[11px] text-[#a8b3c2]">End (seconds)
      <input className={input} type="number" min="0" step="0.01" value={cue.end} onChange={e => onChange({ end: Math.max(0, Number(e.target.value) || 0) })}/>
    </label>
  </div>
}

export function SubtitleEditorPanel({ library, media, onAddCueToTimeline }: {
  library: SubtitleLibraryModel
  media: MediaAsset[]
  onAddCueToTimeline: (cue: SubtitleCue, style: SubtitleStyle) => string
}) {
  const doc = library.selected
  const [tab, setTab] = useState<EditorTab>('Content')
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null)
  const [playTime, setPlayTime] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const player = useRef<HTMLVideoElement>(null)
  const audioPlayer = useRef<HTMLAudioElement>(null)
  useEffect(() => { setTab('Content'); setSelectedCueId(null); setPlayTime(0); setFeedback(''); setTagDraft(doc?.tags.join(', ') ?? '') }, [doc?.id])
  const sorted = useMemo(() => [...(doc?.cues ?? [])].sort((a, b) => a.start - b.start), [doc?.cues])
  const active = sorted.find(cue => cue.id === selectedCueId) ?? sorted.find(cue => cue.start <= playTime && playTime < cue.end) ?? sorted[0] ?? null
  const displayCue = sorted.find(cue => cue.start <= playTime && playTime < cue.end)
  const asset = media.find(item => item.id === doc?.mediaId) ?? null
  const visualMedia = asset?.kind === 'video' || asset?.kind === 'image'
  const maxDuration = Math.max(10, ...sorted.map(cue => cue.end))
  const isValidCue = (cue: SubtitleCue) => cue.end > cue.start && cue.start >= 0 && !!cue.text.trim()

  function seek(seconds: number) {
    setPlayTime(seconds)
    if (player.current) {
      try { player.current.currentTime = seconds } catch { /* Metadata may not be loaded */ }
    }
    if (audioPlayer.current) {
      try { audioPlayer.current.currentTime = seconds } catch { /* Metadata may not be loaded */ }
    }
  }
  function focusCue(cue: SubtitleCue) { setSelectedCueId(cue.id); seek(cue.start) }
  function doTimeline() {
    if (!active) return
    if (!isValidCue(active)) { setFeedback('Enter subtitle text and valid start/end times first.'); return }
    setFeedback(onAddCueToTimeline(active, doc!.style))
  }
  if (!doc) return <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 px-6 text-center text-[#8e9aaa]">
    <Captions size={36} className="text-[#8e62d7]"/>
    <div className="text-[15px] font-semibold text-white">Select a subtitle document</div>
    <p className="max-w-xs text-xs leading-5">Create a manual subtitle or import an SRT/VTT file, then edit text and timing here.</p>
  </div>

  const style = doc.style
  const changeStyle = (patch: Partial<SubtitleStyle>) => library.update(doc.id, { style: { ...style, ...patch } })
  return <div className="flex h-full min-h-0 min-w-0 flex-col bg-[#0c1119] text-white">
    <div className="relative shrink-0 p-3 pb-0">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-[#2c3748] bg-[#05090f]">
        {asset && visualMedia ? (asset.kind === 'video'
          ? <video key={asset.id} ref={player} className="h-full w-full object-contain" src={fileUrl(asset.id)} preload="metadata" playsInline controls onTimeUpdate={e => setPlayTime(e.currentTarget.currentTime)}/>
          : <img className="h-full w-full object-contain" src={fileUrl(asset.id)} alt={mediaName(asset)}/>
        ) : <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(ellipse_at_center,#222241_0%,#0a0c14_66%)] text-center text-xs text-[#8895aa]">
          <span><Captions className="mx-auto mb-2 text-[#7651ab]" size={28}/>{asset?.kind === 'audio' ? 'Audio subtitle preview' : 'Choose a project video/image for preview'}</span>
        </div>}
        {displayCue && <div className={`pointer-events-none absolute inset-x-4 flex justify-center ${style.position === 'top' ? 'top-3' : style.position === 'middle' ? 'top-1/2 -translate-y-1/2' : 'bottom-7'}`}>
          <span className="max-w-full whitespace-pre-wrap break-words rounded px-2 py-1 text-center leading-snug shadow-lg" style={{ color: style.textColor, backgroundColor: `${style.backgroundColor}dd`, fontSize: `${Math.max(9, Math.min(style.fontSize, 48))}px`, fontWeight: style.bold ? 700 : 400, textTransform: style.uppercase ? 'uppercase' : 'none' }}>{displayCue.text}</span>
        </div>}
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-2.5 text-[#a2aabb]">
        <Play size={15} className="shrink-0"/>
        <span className="shrink-0 text-[11px] tabular-nums">{shortTime(playTime)} / {shortTime(maxDuration)}</span>
        <input type="range" aria-label="Subtitle preview time" className="min-w-0 flex-1 accent-[#8745e9]" min="0" max={maxDuration} step="0.01" value={Math.min(playTime, maxDuration)} onChange={e => seek(Number(e.target.value))}/>
      </div>
      {asset?.kind === 'audio' && <audio ref={audioPlayer} className="mt-2 h-8 w-full" controls src={fileUrl(asset.id)} onTimeUpdate={e => setPlayTime(e.currentTarget.currentTime)}/>}
    </div>
    <nav aria-label="Subtitle editor settings" className="mt-3 flex shrink-0 overflow-x-auto border-b border-[#30394a] px-3 [scrollbar-width:thin]">
      {tabs.map(name => <button type="button" key={name} aria-pressed={tab === name} onClick={() => setTab(name)} className={`relative shrink-0 px-3 py-3 text-[12px] ${tab === name ? 'font-semibold text-white after:absolute after:inset-x-1 after:bottom-0 after:h-[3px] after:rounded-full after:bg-[#8a43ed]' : 'text-[#a4aec0] hover:text-white'}`}>{name}</button>)}
    </nav>
    <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-3 pb-8 [scrollbar-width:thin]">
      <label className="grid gap-1.5 text-[11px] text-[#afb8c8]">Subtitle document name
        <input maxLength={120} className={input} value={doc.title} onChange={e => library.update(doc.id, { title: e.target.value })}/>
      </label>
      {tab === 'Content' && <>
        <label className="grid gap-1.5 text-[11px] text-[#afb8c8]">Subtitle text
          <textarea rows={3} className={`${input} resize-y`} placeholder="Enter subtitle text..." value={active?.text ?? ''} disabled={!active} onChange={e => active && library.updateCue(doc.id, active.id, { text: e.target.value })}/>
        </label>
        <label className="grid gap-1.5 text-[11px] text-[#afb8c8]">Language
          <select className={input} value={doc.language} onChange={e => library.update(doc.id, { language: e.target.value })}>{[...new Set([...languageOptions, doc.language])].map(l => <option key={l}>{l}</option>)}</select>
        </label>
        <label className="grid gap-1.5 text-[11px] text-[#afb8c8]">Preview source (project media)
          <select className={input} value={doc.mediaId ?? ''} onChange={e => { library.update(doc.id, { mediaId: e.target.value ? Number(e.target.value) : null }); seek(0) }}>
            <option value="">No media selected</option>
            {media.filter(m => ['video', 'image', 'audio'].includes(m.kind)).map(m => <option key={m.id} value={m.id}>{mediaName(m)}</option>)}
          </select>
        </label>
        <div className="flex items-center justify-between gap-2"><span className="text-[12px] font-semibold">Cues <span className="text-[#9c85bf]">({sorted.length})</span></span>
          <button className={smallBtn} type="button" onClick={() => { const id = library.addCue(doc.id); if (id) setSelectedCueId(id) }}><ListPlus size={14}/> Add cue</button>
        </div>
        <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:thin]">{sorted.map((cue, index) => <button type="button" key={cue.id} onClick={() => focusCue(cue)} className={`flex w-full min-w-0 items-start gap-2 rounded-lg border p-2 text-left text-[11px] ${active?.id === cue.id ? 'border-[#9254e9] bg-[#32214d]' : 'border-[#30394b] bg-[#151c27] hover:border-[#7654ac]'}`}>
          <span className="shrink-0 tabular-nums text-[#aca0ce]">{index + 1}.</span>
          <span className="min-w-0 flex-1 truncate text-[#e5e9f2]">{cue.text || 'Empty subtitle'}</span>
          <span className="shrink-0 tabular-nums text-[#9aa6bc]">{shortTime(cue.start)}</span>
        </button>)}</div>
        {active && <><CueFields cue={active} onChange={patch => library.updateCue(doc.id, active.id, patch)}/>
          {active.end <= active.start && <p className="text-[11px] text-rose-300">End must be later than start.</p>}
          <div className="flex flex-wrap gap-2"><button className={smallBtn} type="button" onClick={doTimeline}><Plus size={14}/> Add selected cue to Timeline</button><button className={`${smallBtn} text-rose-300`} type="button" onClick={() => { library.deleteCue(doc.id, active.id); setSelectedCueId(null) }}><Trash2 size={14}/> Delete cue</button></div>
        </>}
        {feedback && <p role="status" className="rounded-lg border border-[#55456e] bg-[#211c2d] p-2 text-[11px] text-[#d7c9ed]">{feedback}</p>}
        <label className="grid gap-1.5 text-[11px] text-[#afb8c8]">Tags (comma-separated)
          <input className={input} placeholder="travel, tutorial" value={tagDraft} onChange={e => setTagDraft(e.target.value)} onBlur={() => library.update(doc.id, { tags: tagDraft.split(',').map(t => t.trim()).filter(Boolean) })} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}/>
        </label>
      </>}
      {tab === 'Style' && <>
        <label className="grid gap-1.5 text-[11px] text-[#afb8c8]">Font size: {style.fontSize}px
          <input type="range" min="10" max="48" className="w-full accent-[#843cef]" value={style.fontSize} onChange={e => changeStyle({ fontSize: Number(e.target.value) })}/>
        </label>
        <div className="grid grid-cols-2 gap-3">{([['textColor', 'Text color'], ['backgroundColor', 'Background color']] as const).map(([key, label]) => <label key={key} className="grid gap-1.5 text-[11px] text-[#afb8c8]">{label}<input className="h-10 w-full rounded border border-[#343d4c] bg-[#111924] p-1" type="color" value={style[key]} onChange={e => changeStyle({ [key]: e.target.value })}/></label>)}</div>
        <label className="grid gap-1.5 text-[11px] text-[#afb8c8]">Position
          <select className={input} value={style.position} onChange={e => changeStyle({ position: e.target.value as SubtitleStyle['position'] })}><option value="bottom">Bottom</option><option value="middle">Middle</option><option value="top">Top</option></select>
        </label>
        <label className="flex gap-2 text-[12px] text-[#afb8c8]"><input className="accent-[#8240ee]" type="checkbox" checked={style.bold} onChange={e => changeStyle({ bold: e.target.checked })}/> Bold text</label>
        <label className="flex gap-2 text-[12px] text-[#afb8c8]"><input className="accent-[#8240ee]" type="checkbox" checked={style.uppercase} onChange={e => changeStyle({ uppercase: e.target.checked })}/> Uppercase text</label>
        <p className="text-[11px] leading-5 text-[#8091a8]">Styles apply to the preview and this subtitle document. The current Timeline text renderer does not support all these styling settings yet.</p>
      </>}
      {tab === 'Timing' && <>
        <p className="text-[11px] leading-5 text-[#a4afbe]">Edit the timing of each subtitle, then preview it with the scrubber above.</p>
        {sorted.map((cue, i) => <div className="space-y-2 rounded-lg border border-[#30394b] bg-[#141c27] p-3" key={cue.id}>
          <div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate text-[11px] font-semibold">{i + 1}. {cue.text || 'Empty subtitle'}</span><span className="shrink-0 text-[10px] text-[#94a1b5]">{(cue.end - cue.start).toFixed(2)}s</span></div>
          <CueFields cue={cue} onChange={patch => library.updateCue(doc.id, cue.id, patch)}/>
          <button className="text-[11px] text-[#bd98ff] hover:underline" type="button" onClick={() => { setTab('Content'); focusCue(cue) }}>Edit text</button>
        </div>)}
      </>}
      {tab === 'Export' && <>
        <div className="rounded-xl border border-[#343d4d] bg-[#151d29] p-3 text-[11px] leading-5 text-[#b5bfd0]">Export your timed subtitles to standard SRT / WebVTT. Use JSON to include styles, language, tags, and all cues.</div>
        <div className="grid grid-cols-2 gap-2"><button className={smallBtn} onClick={() => saveSubtitleDownload(doc, 'srt')}><Download size={15}/> Export .srt</button><button className={smallBtn} onClick={() => saveSubtitleDownload(doc, 'vtt')}><FileText size={15}/> Export .vtt</button><button className={`${smallBtn} col-span-2`} onClick={() => saveSubtitleDownload(doc, 'json')}><FileJson size={15}/> Export project JSON</button></div>
        <p className="text-[11px] text-[#8493a8]">Saved automatically in this browser for the current project. Server/MySQL storage requires a subtitles API.</p>
      </>}
    </div>
  </div>
}
