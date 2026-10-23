import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

/**
 * Non-destructive CLIPTORA workspace layout.
 * Put existing Library / Preview / Inspector / Timeline components in its slots.
 * Each original panel keeps its state, tools, events and internal scrolling.
 */
type ResizableEditorWorkspaceProps = {
  library: ReactNode
  preview: ReactNode
  inspector: ReactNode
  timeline: ReactNode
  className?: string
  storageKey?: string
}

type Sizes = { left: number; right: number; bottom: number }
type Handle = 'left' | 'right' | 'bottom'
type DragState = { handle: Handle; startX: number; startY: number; sizes: Sizes }

const HANDLE = 9
const DEFAULTS: Sizes = { left: 290, right: 335, bottom: 285 }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function fitSizes(sizes: Sizes, width: number, height: number): Sizes {
  const availableWidth = Math.max(0, width - HANDLE * 2)
  const availableHeight = Math.max(0, height - HANDLE)

  // Preserve all three columns, even when the editor becomes narrow.
  const minPreview = Math.min(320, availableWidth * 0.48)
  const rest = Math.max(0, availableWidth - minPreview)
  const minLeft = Math.min(210, rest * 0.42)
  const minRight = Math.min(240, rest - minLeft)

  const left = clamp(sizes.left, minLeft, Math.max(minLeft, rest - minRight))
  const right = clamp(sizes.right, minRight, Math.max(minRight, rest - left))

  const minPreviewHeight = Math.min(215, availableHeight * 0.55)
  const minTimelineHeight = Math.min(150, availableHeight - minPreviewHeight)
  const bottom = clamp(sizes.bottom, minTimelineHeight, Math.max(minTimelineHeight, availableHeight - minPreviewHeight))
  return { left, right, bottom }
}

const handleStyle: CSSProperties = {
  position: 'relative',
  zIndex: 25,
  touchAction: 'none',
  userSelect: 'none',
  backgroundColor: '#15171c',
  outlineOffset: '-2px',
}

export function ResizableEditorWorkspace({
  library, preview, inspector, timeline, className = '',
  storageKey = 'cliptora.editor.workspace.sizes.v1',
}: ResizableEditorWorkspaceProps) {
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | null>(null)
  const [bounds, setBounds] = useState({ width: 1280, height: 800 })
  const [sizes, setSizes] = useState<Sizes>(DEFAULTS)
  const [hydrated, setHydrated] = useState(false)
  const [moving, setMoving] = useState<Handle | null>(null)

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey)
      if (saved) {
        const parsed: unknown = JSON.parse(saved)
        if (parsed && typeof parsed === 'object') {
          const item = parsed as Record<string, unknown>
          if (['left', 'right', 'bottom'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key]))) {
            setSizes({ left: item.left as number, right: item.right as number, bottom: item.bottom as number })
          }
        }
      }
    } catch { /* Storage may be unavailable; resizing still works. */ }
    setHydrated(true)
  }, [storageKey])

  useEffect(() => {
    if (!hydrated) return
    try { window.localStorage.setItem(storageKey, JSON.stringify(sizes)) } catch { /* Storage is optional. */ }
  }, [hydrated, sizes, storageKey])

  useEffect(() => {
    const node = root.current
    if (!node) return
    const update = () => setBounds({ width: node.clientWidth, height: node.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const fitted = fitSizes(sizes, bounds.width, bounds.height)

  function change(handle: Handle, target: number) {
    setSizes(previous => {
      const current = fitSizes(previous, bounds.width, bounds.height)
      const availableWidth = Math.max(0, bounds.width - HANDLE * 2)
      const minPreview = Math.min(320, availableWidth * 0.48)
      const rest = Math.max(0, availableWidth - minPreview)
      const minLeft = Math.min(210, rest * 0.42)
      const minRight = Math.min(240, rest - minLeft)
      const availableHeight = Math.max(0, bounds.height - HANDLE)
      const minTop = Math.min(215, availableHeight * 0.55)
      const minBottom = Math.min(150, availableHeight - minTop)
      if (handle === 'left') return { ...current, left: clamp(target, minLeft, Math.max(minLeft, rest - current.right)) }
      if (handle === 'right') return { ...current, right: clamp(target, minRight, Math.max(minRight, rest - current.left)) }
      return { ...current, bottom: clamp(target, minBottom, Math.max(minBottom, availableHeight - minTop)) }
    })
  }

  function start(handle: Handle, event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    drag.current = { handle, startX: event.clientX, startY: event.clientY, sizes: fitted }
    setMoving(handle)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (current.handle === 'left') change('left', current.sizes.left + dx)
    if (current.handle === 'right') change('right', current.sizes.right - dx)
    if (current.handle === 'bottom') change('bottom', current.sizes.bottom - dy)
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    drag.current = null
    setMoving(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function keys(handle: Handle, event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 40 : 12
    if (handle === 'left' && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault()
      change(handle, fitted.left + (event.key === 'ArrowRight' ? step : -step))
    } else if (handle === 'right' && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault()
      change(handle, fitted.right + (event.key === 'ArrowLeft' ? step : -step))
    } else if (handle === 'bottom' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      change(handle, fitted.bottom + (event.key === 'ArrowUp' ? step : -step))
    }
  }

  function separator(handle: Handle, name: string) {
    const vertical = handle !== 'bottom'
    const value = handle === 'left' ? fitted.left : handle === 'right' ? fitted.right : fitted.bottom
    return <div
      key={handle}
      role="separator"
      tabIndex={0}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={name}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={vertical ? Math.round(bounds.width) : Math.round(bounds.height)}
      title={`${name} — drag to resize · double-click to reset`}
      onPointerDown={event => start(handle, event)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={() => { drag.current = null; setMoving(null) }}
      onKeyDown={event => keys(handle, event)}
      onDoubleClick={() => change(handle, DEFAULTS[handle])}
      style={{ ...handleStyle, cursor: vertical ? 'col-resize' : 'row-resize' }}
      className={`group flex items-center justify-center outline-none focus-visible:bg-[#342b49] ${vertical ? 'h-full' : 'w-full'}`}
    >
      <div
        aria-hidden="true"
        className={`rounded-full bg-[#53505f] transition-colors group-hover:bg-[#b38aff] group-focus-visible:bg-[#b38aff] ${moving === handle ? 'bg-[#b38aff]' : ''} ${vertical ? 'h-12 w-[3px]' : 'h-[3px] w-12'}`}
      />
    </div>
  }

  return <div ref={root} className={`relative h-full min-h-0 w-full min-w-0 overflow-hidden ${className}`}
    style={{ display: 'grid', gridTemplateRows: `minmax(0, 1fr) ${HANDLE}px ${fitted.bottom}px` }}>
    <div className="min-h-0 min-w-0" style={{ display: 'grid', gridTemplateColumns: `${fitted.left}px ${HANDLE}px minmax(0, 1fr) ${HANDLE}px ${fitted.right}px` }}>
      <div className="flex h-full min-h-0 min-w-0 overflow-hidden">{library}</div>
      {separator('left', 'Resize Library and Preview')}
      <div className="h-full min-h-0 min-w-0 overflow-hidden">{preview}</div>
      {separator('right', 'Resize Preview and Clip Settings')}
      <div className="h-full min-h-0 min-w-0 overflow-hidden">{inspector}</div>
    </div>
    {separator('bottom', 'Resize Preview and Timeline')}
    <div className="h-full min-h-0 min-w-0 overflow-hidden">{timeline}</div>
  </div>
}
