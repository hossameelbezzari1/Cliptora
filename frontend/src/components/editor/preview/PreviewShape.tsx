import { useEffect, useId, useRef } from 'react'

/**
 * Renders actual shapes in the Preview, not an opaque rectangle labeled with a shape name.
 * Blur effects composite pixels from the image/video behind the selected object.
 * They do not alter source media and require no AI API.
 */
type PreviewShapeProps = { shape: string; color?: string; blurStrength?: number }

type MediaSurface = HTMLImageElement | HTMLVideoElement

function isDrawable(node: MediaSurface): boolean {
  if (node instanceof HTMLVideoElement) return node.readyState >= 2 && node.videoWidth > 0
  return node.complete && node.naturalWidth > 0
}

function paintedRect(node: MediaSurface) {
  const rect = node.getBoundingClientRect()
  const naturalW = node instanceof HTMLVideoElement ? node.videoWidth : node.naturalWidth
  const naturalH = node instanceof HTMLVideoElement ? node.videoHeight : node.naturalHeight
  const fit = getComputedStyle(node).objectFit
  if (!naturalW || !naturalH || !rect.width || !rect.height) return rect
  if (fit === 'fill') return rect
  const aspect = naturalW / naturalH
  const container = rect.width / rect.height
  if (fit === 'contain' || fit === 'scale-down') {
    const width = container > aspect ? rect.height * aspect : rect.width
    const height = container > aspect ? rect.height : rect.width / aspect
    return new DOMRect(rect.left + (rect.width - width) / 2, rect.top + (rect.height - height) / 2, width, height)
  }
  // 'cover' uses the whole box and crops the source; simplified for preview performance.
  return rect
}

function captureBehind(box: HTMLElement, ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const area = box.getBoundingClientRect()
  const stage = box.closest<HTMLElement>('[data-preview-canvas]')
  if (!stage || !area.width || !area.height) return false
  let source: MediaSurface | null = null
  let score = 0
  // Pick the largest visible media overlapping the blur box, ignoring its own canvas.
  for (const node of stage.querySelectorAll<HTMLImageElement | HTMLVideoElement>('video,img')) {
    if (box.contains(node) || !isDrawable(node)) continue
    const rect = node.getBoundingClientRect()
    const areaOverlap = Math.max(0, Math.min(rect.right, area.right) - Math.max(rect.left, area.left)) *
      Math.max(0, Math.min(rect.bottom, area.bottom) - Math.max(rect.top, area.top))
    if (areaOverlap > score) { score = areaOverlap; source = node }
  }
  if (!source) return false
  const painted = paintedRect(source)
  const scaleX = width / area.width
  const scaleY = height / area.height
  const drawX = (painted.left - area.left) * scaleX
  const drawY = (painted.top - area.top) * scaleY
  const drawW = painted.width * scaleX
  const drawH = painted.height * scaleY
  try {
    ctx.drawImage(source, drawX, drawY, drawW, drawH)
    return true
  } catch { return false }
}

function BlurArea({mode,strength}:{mode:'gaussian'|'motion'|'mosaic';strength:number}) {
  const holder = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const root = holder.current
    const canvas = canvasRef.current
    if (!root || !canvas || mode === 'gaussian') return
    let frame = 0
    let previous = 0
    let lastContent = ''
    const render = (timestamp: number) => {
      frame = requestAnimationFrame(render)
      if (timestamp - previous < 90) return
      previous = timestamp
      const rect = root.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const width = Math.min(560, Math.max(24, Math.round(rect.width)))
      const height = Math.min(360, Math.max(24, Math.round(rect.height)))
      const stage = root.closest('[data-preview-canvas]')
      const video = stage?.querySelector<HTMLVideoElement>('video')
      const signature = `${Math.round(rect.x)}:${Math.round(rect.y)}:${width}:${height}:${video?.currentTime ?? 0}`
      if (signature === lastContent) return
      lastContent = signature
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) return
      context.clearRect(0,0,width,height)
      if (mode === 'mosaic') {
        const block = Math.max(7,Math.min(35,Math.round(strength * 1.05)))
        const small = document.createElement('canvas')
        small.width = Math.max(2,Math.ceil(width / block))
        small.height = Math.max(2,Math.ceil(height / block))
        const smallCtx = small.getContext('2d')
        if (!smallCtx || !captureBehind(root,smallCtx,small.width,small.height)) return
        context.imageSmoothingEnabled = false
        context.drawImage(small,0,0,width,height)
      } else {
        const temp = document.createElement('canvas')
        temp.width = width
        temp.height = height
        const tempCtx = temp.getContext('2d')
        if (!tempCtx || !captureBehind(root,tempCtx,width,height)) return
        const span = Math.max(8,strength * 2)
        const passes = 13
        context.globalAlpha = 1/passes
        for (let index=0; index<passes; index++) {
          context.drawImage(temp, -span/2 + index*span/(passes-1), 0)
        }
        context.globalAlpha = 1
      }
    }
    frame = requestAnimationFrame(render)
    return ()=>cancelAnimationFrame(frame)
  },[mode,strength])
  return <div ref={holder} className="relative h-full w-full overflow-hidden rounded-[10px] border border-white/45" style={{backgroundColor:'rgba(210,220,255,.035)',backdropFilter:`blur(${mode==='gaussian'?strength:3}px)`,WebkitBackdropFilter:`blur(${mode==='gaussian'?strength:3}px)`}}>
    {mode !== 'gaussian' && <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full"/>}
  </div>
}

function ShapeSvg({kind,color}: {kind:string;color:string}) {
  const uid = useId().replace(/:/g,'')
  const common = {fill:color,stroke:'rgba(255,255,255,.4)',strokeWidth:0.75}
  const graphic = (() => {
    switch(kind.toLowerCase()) {
      case 'rectangle': return <rect x="6" y="22" width="88" height="56" rx="3" {...common}/>
      case 'square': return <rect x="20" y="13" width="65" height="65" rx="2" {...common}/>
      case 'circle': return <circle cx="50" cy="50" r="44" {...common}/>
      case 'ellipse': return <ellipse cx="50" cy="50" rx="49" ry="32" {...common}/>
      case 'triangle': return <path d="M50 3 L99 96 H1 Z" {...common}/>
      case 'polygon': return <polygon points="25,5 75,5 99,50 75,95 25,95 1,50" {...common}/>
      case 'star': return <polygon points="50,1 62,34 98,35 69,57 81,95 50,73 19,95 31,57 2,35 38,34" {...common}/>
      case 'line': return <path d="M2 50 H98" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"/>
      case 'arrow': return <path d="M3 50 H93 M72 25 L97 50 L72 75" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
      default: return <rect x="6" y="17" width="88" height="66" rx="8" {...common}/>
    }
  })()
  return <svg role="img" aria-label={`${kind} shape`} viewBox="0 0 100 100" preserveAspectRatio={kind.toLowerCase()==='rectangle'||kind.toLowerCase()==='polygon'||kind.toLowerCase()==='line'||kind.toLowerCase()==='arrow'?'none':'xMidYMid meet'} className="h-full w-full overflow-visible" style={{filter:`drop-shadow(0 1px 3px ${color}55)`}}>
    <defs><clipPath id={`${uid}-bounds`}><rect width="100" height="100"/></clipPath></defs>
    <g clipPath={`url(#${uid}-bounds)`}>{graphic}</g>
  </svg>
}

export function PreviewShape({shape,color='#a580db',blurStrength=16}:PreviewShapeProps) {
  const kind = shape.toLowerCase()
  if (kind === 'empty element') return <div data-cl-preview-shape={shape} className="h-full w-full bg-transparent"/>
  const blurMode = kind.includes('mosaic') || kind.includes('pixel') ? 'mosaic'
    : kind.includes('directional') || kind.includes('motion') ? 'motion'
    : kind.includes('blur') ? 'gaussian' : null
  // No opaque parent/background: the video below remains visible around the SVG shape.
  return <div data-cl-preview-shape={shape} className="h-full w-full bg-transparent">
    {blurMode ? <BlurArea mode={blurMode} strength={blurStrength}/> : <ShapeSvg kind={shape} color={color}/>}
  </div>
}
