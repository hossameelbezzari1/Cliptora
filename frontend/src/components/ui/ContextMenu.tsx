import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type ContextAction = { label: string; icon?: ReactNode; onClick?: () => void; disabled?: boolean; danger?: boolean; divider?: boolean; content?: ReactNode }
export type MenuState = { x: number; y: number; actions: ContextAction[] } | null

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const element = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  useLayoutEffect(() => {
    if (!menu) return
    const width = element.current?.offsetWidth ?? 240
    const height = element.current?.offsetHeight ?? 280
    setPosition({ x: Math.max(8, Math.min(menu.x, window.innerWidth - width - 8)), y: Math.max(8, Math.min(menu.y, window.innerHeight - height - 8)) })
  }, [menu])
  useEffect(() => {
    if (!menu) return
    const onPointer = (event: PointerEvent) => { if (!element.current?.contains(event.target as Node)) onClose() }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const onScroll = (event: Event) => { if (!element.current?.contains(event.target as Node)) onClose() }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => { window.removeEventListener('pointerdown', onPointer, true); window.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll, true) }
  }, [menu, onClose])
  if (!menu) return null
  return createPortal(<div ref={element} role="menu" aria-label="Editor context menu" onContextMenu={e => e.preventDefault()}
    className="fixed z-[100] w-[244px] max-h-[calc(100vh-16px)] overflow-y-auto rounded-xl border border-[#393d45] bg-[#202226] p-1.5 text-xs text-[#e9e9eb] shadow-[0_18px_48px_#000b]"
    style={{ left: position.x, top: position.y }}>
    {menu.actions.map((action, index) => action.divider ? <div key={index} className="my-1.5 h-px bg-white/10"/> : action.content ? <div key={index} className="px-2 py-1.5">{action.content}</div> : <button key={index} role="menuitem" type="button" disabled={action.disabled} onClick={() => { action.onClick?.(); onClose() }} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-white/10 disabled:opacity-35 ${action.danger ? 'text-[#fa858e]' : ''}`}>
      {action.icon && <span className="flex w-4 shrink-0 justify-center">{action.icon}</span>}<span>{action.label}</span>
    </button>)}
  </div>, document.body)
}
