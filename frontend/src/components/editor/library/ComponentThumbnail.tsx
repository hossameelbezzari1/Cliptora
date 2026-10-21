import { useId, type CSSProperties } from 'react'
import { AudioLines, Boxes, Film, FolderOpen, Image as ImageIcon, Layers3, Type } from 'lucide-react'

/** These previews are illustrations, not separate editable canvases. The card itself adds the component. */
export type ShapeName =
  | 'Text' | 'Rectangle' | 'Square' | 'Circle' | 'Ellipse' | 'Triangle'
  | 'Line' | 'Arrow' | 'Star' | 'Polygon' | 'Blur Box'
  | 'Directional Blur Box' | 'Mosaic Blur Box'

const blurSource: Record<string, string> = {
  'Blur Box': '/assets/components/blur-gaussian.webp',
  'Directional Blur Box': '/assets/components/blur-directional.webp',
  'Mosaic Blur Box': '/assets/components/blur-mosaic.webp',
}

export function shapeCategory(name: string): 'Text' | 'Blur' | 'Shapes' {
  return name === 'Text' ? 'Text' : name.includes('Blur Box') ? 'Blur' : 'Shapes'
}

export function ComponentThumbnail({ name, compact = false }: { name: string; compact?: boolean }) {
  const gradientId = useId().replace(/:/g, '')
  if (name in blurSource) {
    return <div className="relative h-full w-full overflow-hidden bg-[#2b2a34]">
      <img className="h-full w-full object-cover" loading="lazy" src={blurSource[name]} alt={`${name} preview: a person's face partially obscured by this blur`} />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
      <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-medium text-white/90">{name === 'Blur Box' ? 'Gaussian' : name === 'Mosaic Blur Box' ? 'Mosaic' : 'Motion'}</span>
    </div>
  }
  if (name === 'Text') {
    return <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-[radial-gradient(ellipse_at_center,_#36284a_0%,_#1b1d26_65%)] text-white">
      <span className={`${compact ? 'text-3xl' : 'text-4xl'} font-extrabold tracking-tight drop-shadow-[0_3px_15px_#7b54e8]`}>Aa</span>
      <span className="text-[9px] tracking-widest text-[#c4a4fb]">TEXT</span>
    </div>
  }
  const common: CSSProperties = { filter: 'drop-shadow(0 3px 9px #12151e)' }
  return <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_50%_45%,_#222939_0%,_#171a21_75%)]">
    <svg viewBox="0 0 120 75" className="h-[77%] w-[82%] max-w-[124px]" role="img" aria-label={`${name} shape`}>
      <defs>
        <linearGradient id={`${gradientId}-blue`} x1="0" x2="1" y1="0" y2="1"><stop stopColor="#49a6ff"/><stop offset="1" stopColor="#216bea"/></linearGradient>
        <linearGradient id={`${gradientId}-purple`} x1="0" x2="1" y1="0" y2="1"><stop stopColor="#ad7bff"/><stop offset="1" stopColor="#713be0"/></linearGradient>
        <linearGradient id={`${gradientId}-pink`} x1="0" x2="1" y1="0" y2="1"><stop stopColor="#ff718c"/><stop offset="1" stopColor="#f2386c"/></linearGradient>
        <linearGradient id={`${gradientId}-green`} x1="0" x2="1" y1="0" y2="1"><stop stopColor="#5af5b8"/><stop offset="1" stopColor="#1cbd8b"/></linearGradient>
      </defs>
      {name === 'Rectangle' && <rect x="13" y="15" width="94" height="46" rx="6" fill={`url(#${gradientId}-blue)`} style={common}/>}
      {name === 'Square' && <rect x="34" y="7" width="58" height="58" rx="6" fill={`url(#${gradientId}-purple)`} style={common}/>}
      {name === 'Circle' && <circle cx="60" cy="37.5" r="30" fill={`url(#${gradientId}-pink)`} style={common}/>}
      {name === 'Ellipse' && <ellipse cx="60" cy="38" rx="49" ry="25" fill={`url(#${gradientId}-green)`} style={common}/>}
      {name === 'Triangle' && <path d="M60 7 L103 67 H17 Z" fill="#ffbc60" style={common}/>}
      {name === 'Polygon' && <path d="M38 9 H82 L108 38 L82 66 H38 L12 38 Z" fill={`url(#${gradientId}-purple)`} style={common}/>}
      {name === 'Star' && <path d="M60 5 L73.5 27 L100 30 L80 47 L86 72 L60 59 L34 72 L40 47 L20 30 L46.5 27 Z" fill="#ffcf5e" style={common}/>}
      {name === 'Line' && <path d="M13 38 H107" stroke="#5dd5ff" strokeWidth="5" strokeLinecap="round" style={common}/>}
      {name === 'Arrow' && <path d="M15 38 H102 M78 13 L103 38 L78 63" stroke="#55e3ad" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" style={common}/>}
    </svg>
  </div>
}

export function SavedComponentThumbnail({ snapshot, kind }: { snapshot?: Record<string, unknown>; kind: 'component' | 'group' }) {
  const props = snapshot?.props
  const shapeName = props && typeof props === 'object' && 'shape_kind' in props && typeof props.shape_kind === 'string' ? props.shape_kind : null
  if (shapeName) return <ComponentThumbnail name={shapeName}/>
  if (kind === 'group') return <div className="flex h-full items-center justify-center gap-1 bg-gradient-to-br from-[#35284e] to-[#171a21] text-[#bc93fc]" aria-label="Saved group preview"><Layers3 size={29}/><Boxes size={22}/></div>
  if (snapshot?.type === 'text') {
    const label = typeof snapshot.text === 'string' ? snapshot.text : 'Aa'
    return <div className="flex h-full items-center justify-center overflow-hidden bg-gradient-to-br from-[#32214b] to-[#171a23] px-3 text-center text-base font-bold text-[#e5d4ff]" aria-label="Saved text preview">{label.slice(0, 24) || 'Aa'}</div>
  }
  const Icon = snapshot?.type === 'video' ? Film : snapshot?.type === 'image' ? ImageIcon : snapshot?.type === 'audio' ? AudioLines : snapshot?.type === 'text' ? Type : FolderOpen
  return <div className="flex h-full items-center justify-center bg-gradient-to-br from-[#253a55] to-[#171a23] text-[#86bfff]" aria-label="Saved component preview"><Icon size={32}/></div>
}
