import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'

export type ContextMenuAction = {
  id: string
  label: string
  icon: LucideIcon
  shortcut?: string[]
  disabled?: boolean
  disabledReason?: string
  dividerBefore?: boolean
  destructive?: boolean
  run: () => void
}

type Props = {
  x: number
  y: number
  actions: ContextMenuAction[]
  onClose: () => void
}

const VIEWPORT_GAP = 8

export function WorkflowContextMenu({ x, y, actions, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y, ready: false })

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    setPosition({
      left: Math.max(VIEWPORT_GAP, Math.min(x, window.innerWidth - rect.width - VIEWPORT_GAP)),
      top: Math.max(VIEWPORT_GAP, Math.min(y, window.innerHeight - rect.height - VIEWPORT_GAP)),
      ready: true,
    })
  }, [actions, x, y])

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    const closeOnScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', escape, true)
    document.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('resize', onClose)
    const first = menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    first?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', escape, true)
      document.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    if (!items.length) return
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % items.length
      : (index - 1 + items.length) % items.length
    items[next].focus()
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Workflow context menu"
      onContextMenu={event => event.preventDefault()}
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={handleKeyDown}
      className="fixed z-[1000] w-[min(330px,calc(100vw-16px))] overflow-y-auto overscroll-contain rounded-[12px] border border-[#e3e3e5] bg-white py-[7px] text-[#202020] shadow-[0_14px_45px_rgba(0,0,0,0.18)] [scrollbar-width:thin]"
      style={{
        left: position.left,
        top: position.top,
        maxHeight: 'calc(100vh - 16px)',
        visibility: position.ready ? 'visible' : 'hidden',
      }}
    >
      {actions.map(action => {
        const Icon = action.icon
        return (
          <div key={action.id}>
            {action.dividerBefore && <div role="separator" className="mx-3 my-[6px] border-t border-[#e8e8e8]" />}
            <button
              type="button"
              role="menuitem"
              disabled={action.disabled}
              title={action.disabledReason}
              className={`flex min-h-[38px] w-full items-center gap-3 px-[13px] py-[7px] text-left outline-none transition-colors focus-visible:bg-[#f2edff] ${action.disabled ? 'cursor-not-allowed text-[#bdbdbd]' : action.destructive ? 'text-[#c62838] hover:bg-red-50' : 'text-[#202020] hover:bg-[#f6f6f7]'}`}
              onClick={() => { if (!action.disabled) { onClose(); action.run() } }}
            >
              <Icon size={17} strokeWidth={1.8} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-normal">{action.label}</span>
              {action.shortcut?.length && (
                <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
                  {action.shortcut.map((part, i) => <kbd key={`${part}-${i}`} className="grid min-h-[23px] min-w-[23px] place-items-center rounded-full border border-[#e4e4e5] bg-[#f6f6f7] px-1.5 text-[11px] text-[#777] shadow-[0_1px_1px_#0000000b]">{part}</kbd>)}
                </span>
              )}
            </button>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
