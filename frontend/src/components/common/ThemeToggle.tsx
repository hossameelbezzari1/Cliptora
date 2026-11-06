import { useEffect, useRef, useState } from 'react'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemePreference } from '../../app/ThemeProvider'

const choices: Array<{
  value: ThemePreference
  label: string
  icon: typeof Sun
}> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const CurrentIcon = theme === 'system'
    ? Monitor
    : resolvedTheme === 'dark'
      ? Moon
      : Sun

  useEffect(() => {
    if (!open) return

    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`Theme: ${theme}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Theme: ${theme}`}
        onClick={() => setOpen(value => !value)}
        className="theme-control inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-cl-line bg-cl-panel px-3 text-cl-muted transition-colors hover:bg-cl-panel-2 hover:text-[var(--cl-text)]"
      >
        <CurrentIcon size={17} />
        {!compact && <span className="text-xs font-semibold capitalize">{theme}</span>}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Choose theme"
          className="theme-menu absolute right-0 top-12 z-[20000] w-44 rounded-2xl border border-cl-line bg-cl-panel p-1.5 text-[var(--cl-text)] shadow-2xl"
        >
          {choices.map(choice => {
            const Icon = choice.icon
            const selected = theme === choice.value
            return (
              <button
                key={choice.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  setTheme(choice.value)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-semibold hover:bg-cl-panel-2"
              >
                <Icon size={16} className="text-cl-muted" />
                <span className="flex-1">{choice.label}</span>
                {selected && <Check size={15} className="text-cl-purple" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
