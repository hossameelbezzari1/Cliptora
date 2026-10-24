import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Maximize2, Minimize2, Pause, Play, RotateCcw } from 'lucide-react'
import type { TransitionDefinition, TransitionSettings } from './transitionCatalog'

type Props = { entry: TransitionDefinition; settings: TransitionSettings; progress: number; onProgress: (progress: number) => void }
const imageA = '/assets/cliptora-transitions/demo-before.webp'
const imageB = '/assets/cliptora-transitions/demo-after.webp'
const clamp = (x: number) => Math.max(0, Math.min(1, x))

function easing(t: number, name: TransitionSettings['easing']) {
  if (name === 'Ease In') return t * t
  if (name === 'Ease Out') return 1 - (1 - t) ** 2
  if (name === 'Ease In Out') return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2
  return t
}

function previewStyles(id: string, amount: number, settings: TransitionSettings) {
  const p = clamp(amount), q = 1 - p
  const strength = Math.min(1, Math.max(0, settings.intensity))
  const before: CSSProperties = { opacity: 1, transform: 'none' }
  const after: CSSProperties = { opacity: p }
  let shade: CSSProperties | undefined
  const direction = id.includes('right') ? 1 : id.includes('up') ? -1 : id.includes('down') ? 1 : -1
  if (/slide|push/.test(id)) {
    const vertical = /up|down/.test(id)
    const vector = vertical ? 'Y' : 'X'
    const entering = (vertical && id.includes('up')) || (!vertical && id.includes('left')) ? 1 : -1
    after.opacity = 1
    after.transform = `translate${vector}(${entering * q * 100}%)`
    if (id.includes('push')) before.transform = `translate${vector}(${-entering * p * 100}%)`
  } else if (/wipe|shutter/.test(id)) {
    after.opacity = 1
    if (/iris/.test(id)) {
      after.clipPath = `circle(${id.includes('close') ? q * 80 : p * 80}% at 50% 50%)`
    } else if (/split/.test(id)) {
      after.clipPath = id.includes('horizontal')
        ? `inset(0 ${q * 50}% 0 ${q * 50}%)`
        : `inset(${q * 50}% 0 ${q * 50}% 0)`
    } else if (/diagonal/.test(id)) {
      after.clipPath = `polygon(0 0, ${p * 130}% 0, ${p * 130 - 35}% 100%, 0 100%)`
    } else {
      const horizontal = /left|right|shutter/.test(id)
      after.clipPath = horizontal
        ? direction < 0 ? `inset(0 ${q * 100}% 0 0)` : `inset(0 0 0 ${q * 100}%)`
        : direction < 0 ? `inset(${q * 100}% 0 0 0)` : `inset(0 0 ${q * 100}% 0)`
    }
  } else if (/zoom|squeeze/.test(id)) {
    after.opacity = Math.min(1, p * 1.7)
    const zoomOut = id.includes('out')
    after.transform = `scale(${zoomOut ? 1 + q * strength * 0.6 : 1 - q * strength * 0.45})`
    if (id.includes('blur')) after.filter = `blur(${q * strength * 14}px)`
  } else if (/flip|cube|rotate|swing|page-turn/.test(id)) {
    after.opacity = p > 0.07 ? 1 : 0
    after.transform = `perspective(800px) rotateY(${q * 85 * strength}deg) scale(${0.92 + p * 0.08})`
    before.transform = `perspective(800px) rotateY(${-p * 60 * strength}deg)`
  } else if (/blur|whip/.test(id)) {
    after.filter = `blur(${q * strength * 14}px)`
    before.filter = `blur(${p * strength * 14}px)`
  } else if (/glitch|pixel|film-burn/.test(id)) {
    after.opacity = p
    after.transform = `translateX(${Math.sin(p * 43) * strength * (1 - Math.abs(2 * p - 1)) * 4}%)`
    after.filter = `contrast(${1 + strength * 0.4}) saturate(${1 + strength * 0.8})`
  } else if (/black|fade-through/.test(id)) {
    after.opacity = p > 0.5 ? (p - 0.5) * 2 : 0
    shade = { background: '#050608', opacity: 1 - Math.abs(2 * p - 1) }
  } else if (/white|flash/.test(id)) {
    shade = { background: '#ffffff', opacity: (1 - Math.abs(2 * p - 1)) * strength }
  }
  if (settings.blend !== 'Normal') after.mixBlendMode = settings.blend.toLowerCase() as CSSProperties['mixBlendMode']
  return { before, after, shade }
}

export function TransitionPreview({ entry, settings, progress, onProgress }: Props) {
  const [playing, setPlaying] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const elapsedRef = useRef(0)
  const startRef = useRef(0)
  useEffect(() => { setPlaying(false); onProgress(0) }, [entry.id, onProgress])
  useEffect(() => {
    if (!playing) return
    let raf = 0
    startRef.current = 0
    elapsedRef.current = progress * settings.duration * 1000
    const frame = (now: number) => {
      if (!startRef.current) startRef.current = now
      const next = clamp((elapsedRef.current + now - startRef.current) / Math.max(50, settings.duration * 1000))
      onProgress(next)
      if (next < 1) raf = requestAnimationFrame(frame)
      else setPlaying(false)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // Re-starting the animation should use the progress at the click, not every slider update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, settings.duration, onProgress])
  const toggle = () => {
    if (!playing && progress >= 0.999) onProgress(0)
    setPlaying(value => !value)
  }
  const value = easing(progress, settings.easing)
  const styles = previewStyles(entry.id, value, settings)
  const stage = <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-[#324356] bg-[#101924]">
    <img className="absolute inset-0 h-full w-full object-cover" src={imageA} alt="Outgoing demo image" style={styles.before}/>
    <img className="absolute inset-0 h-full w-full object-cover" src={imageB} alt="Incoming demo image" style={styles.after}/>
    {styles.shade && <div className="pointer-events-none absolute inset-0" style={styles.shade}/>}
    <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-[#0e1622]/80 px-2 py-1 text-[10px] text-white">Illustrative preview · {entry.name}</div>
    <div className="pointer-events-none absolute right-2 top-2 rounded bg-[#0e1622]/80 px-2 py-1 text-[10px] text-white">{Math.round(progress * 100)}%</div>
  </div>
  return <div className={expanded ? 'fixed inset-4 z-[100] m-auto flex max-w-5xl flex-col justify-center gap-3 overflow-auto rounded-2xl border border-[#46526c] bg-[#101722] p-4 shadow-2xl' : 'min-w-0'}>
    {stage}
    <div className="mt-2 flex min-w-0 items-center gap-2 text-[10px] text-[#a2aec0]">
      <button type="button" onClick={toggle} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#3a4556] bg-[#1d2939] text-white" aria-label={playing ? 'Pause preview' : 'Play preview'}>{playing ? <Pause size={15}/> : <Play size={15}/>}</button>
      <span className="shrink-0 tabular-nums">{(progress * settings.duration).toFixed(2)} / {settings.duration.toFixed(2)}s</span>
      <input className="min-w-0 flex-1 accent-[#9864f5]" aria-label="Transition preview progress" type="range" min={0} max={100} step={1} value={Math.round(progress * 100)} onChange={event => {setPlaying(false);onProgress(Number(event.target.value) / 100)}}/>
      <button type="button" onClick={() => { setPlaying(false); onProgress(0) }} title="Restart preview" aria-label="Restart preview" className="rounded-md p-1.5 hover:bg-[#293548]"><RotateCcw size={14}/></button>
      <button type="button" onClick={() => setExpanded(x => !x)} title={expanded ? 'Close expanded preview' : 'Expand preview'} aria-label={expanded ? 'Close expanded preview' : 'Expand preview'} className="rounded-md p-1.5 hover:bg-[#293548]">{expanded ? <Minimize2 size={15}/> : <Maximize2 size={15}/>}</button>
    </div>
  </div>
}
