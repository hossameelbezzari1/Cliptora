import { useMemo, useState } from 'react'
import {
  Braces, CalendarDays, Check, Clock3, Copy, FileImage, FolderOpen, Info,
  Layers3, MonitorPlay, Variable,
} from 'lucide-react'
import { interpolateVariables } from '../../../lib/variables'
import type { SmartLibraryModel } from './useSmartLibrary'

export type VariableFilter = 'All' | 'Project' | 'Media' | 'Date/Time' | 'System' | 'Custom'
type BuiltIn = { key: string; label: string; description: string; category: Exclude<VariableFilter, 'All' | 'Custom'>; icon: typeof Variable }

export const defaultVariables: BuiltIn[] = [
  { key: 'project.title', label: 'Project title', description: 'Project title', category: 'Project', icon: FolderOpen },
  { key: 'project.description', label: 'Project description', description: 'Project description', category: 'Project', icon: FolderOpen },
  { key: 'project.width', label: 'Project width', description: 'Canvas width (px)', category: 'Project', icon: MonitorPlay },
  { key: 'project.height', label: 'Project height', description: 'Canvas height (px)', category: 'Project', icon: MonitorPlay },
  { key: 'project.resolution', label: 'Resolution', description: 'Canvas resolution', category: 'Project', icon: MonitorPlay },
  { key: 'project.fps', label: 'Frame rate', description: 'Frames per second', category: 'Project', icon: Clock3 },
  { key: 'project.duration', label: 'Project duration', description: 'Timeline duration (s)', category: 'Project', icon: Clock3 },
  { key: 'project.created_at', label: 'Created at', description: 'Project creation date', category: 'Project', icon: CalendarDays },
  { key: 'project.updated_at', label: 'Updated at', description: 'Project last update', category: 'Project', icon: CalendarDays },
  { key: 'project.clips_count', label: 'Clips count', description: 'Number of clips', category: 'Project', icon: Layers3 },
  { key: 'project.layers_count', label: 'Layers count', description: 'Number of layers', category: 'Project', icon: Layers3 },
  { key: 'media.file_name', label: 'Media filename', description: 'Current media file name', category: 'Media', icon: FileImage },
  { key: 'media.extension', label: 'Media extension', description: 'Current media extension', category: 'Media', icon: FileImage },
  { key: 'now()', label: 'Current date & time', description: 'Current date/time function', category: 'Date/Time', icon: Clock3 },
  { key: 'today()', label: 'Today', description: 'Current calendar date', category: 'Date/Time', icon: CalendarDays },
  { key: 'now() + 1h', label: 'One hour later', description: 'Date plus one hour', category: 'Date/Time', icon: Clock3 },
  { key: 'system.now', label: 'System timestamp', description: 'Timestamp from editor context', category: 'System', icon: Braces },
]

const categoryTheme: Record<Exclude<VariableFilter, 'All' | 'Custom'>, string> = {
  Project: 'bg-[#15324a] text-[#65b7f5]',
  Media: 'bg-[#163c3c] text-[#6de2ce]',
  'Date/Time': 'bg-[#34274f] text-[#c0a0fd]',
  System: 'bg-[#44331f] text-[#e4b87d]',
}

function toDisplay(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return 'Not set'
  if (typeof raw === 'object') return JSON.stringify(raw)
  return String(raw)
}

export function DefaultVariablesTab({ library, search, category, onUse }: {
  library: SmartLibraryModel
  search: string
  category: VariableFilter
  onUse: (reference: string) => void
}) {
  const [copied, setCopied] = useState('')
  const [expanded, setExpanded] = useState(true)
  const visible = useMemo(() => defaultVariables.filter(item => {
    if (category !== 'All' && item.category !== category) return false
    const match = `${item.key} ${item.label} ${item.description}`.toLowerCase()
    return match.includes(search.trim().toLowerCase())
  }), [category, search])

  const copy = async (reference: string) => {
    try { await navigator.clipboard.writeText(reference); setCopied(reference) } catch { /* Clipboard permissions depend on the browser. */ }
  }

  return <section className="min-w-0 overflow-hidden rounded-xl border border-[#2d3b4c] bg-[#121c28]">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(open => !open)}
      className="flex w-full items-center justify-between gap-2 border-b border-[#2b3949] px-3 py-3 text-left">
      <span className="flex min-w-0 items-center gap-2">
        <span className="text-[13px] font-semibold text-[#f3f4fa]">Default Variables</span>
        <span className="rounded-full bg-[#302f4c] px-2 py-0.5 text-[10px] text-[#d0bdff]">{visible.length}</span>
      </span>
      <span className="rounded-md border border-[#38475a] bg-[#1e2938] px-2 py-1 text-[10px] text-[#b7c6dc]">{expanded ? 'Hide' : 'Show'}</span>
    </button>
    {expanded && <>
      <div className="cl-default-vars-list max-h-[460px] min-w-0 overflow-y-auto p-2">
        {visible.map(item => {
          const reference = `{{${item.key}}}`
          let rendered: unknown
          try { rendered = item.key.includes('(') ? interpolateVariables(reference, library.vars, library.context)
            : library.context[item.key as keyof typeof library.context] }
          catch { rendered = 'Unavailable' }
          const preview = toDisplay(rendered)
          const Icon = item.icon
          return <div key={item.key} className="group min-w-0 border-b border-[#253241] bg-[#121c28] px-2 py-2 last:border-b-0 hover:bg-[#1a2a3c]">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${categoryTheme[item.category]}`}><Icon size={14}/></span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[11px] font-medium text-[#e5eaf5]" title={reference}>{item.key}</div>
                <div className="truncate text-[10px] text-[#8f9daf]" title={item.description}>{item.description}</div>
              </div>
              <button type="button" onClick={() => { void copy(reference) }} title={`Copy ${reference}`} aria-label={`Copy ${reference}`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[#b8c5d6] hover:bg-[#304156]">
                {copied === reference ? <Check size={14}/> : <Copy size={14}/>}
              </button>
            </div>
            <div className="mt-1.5 flex min-w-0 items-center gap-1.5 pl-9">
              <span className="min-w-0 flex-1 truncate rounded border border-[#2d4053] bg-[#1c2838] px-1.5 py-1 text-[10px] text-[#c3ccdb]" title={preview}>{preview}</span>
              <button type="button" onClick={() => onUse(reference)} title={`Use ${reference} in expression`} aria-label={`Use ${reference}`}
                className="shrink-0 rounded border border-[#514673] px-2 py-1 text-[10px] text-[#d9c6ff] hover:bg-[#3c2e5f]">Use</button>
            </div>
          </div>
        })}
        {!visible.length && <p className="p-5 text-center text-[11px] text-[#95a6b8]">No default variables match this filter.</p>}
      </div>
      <div className="flex items-start gap-2 border-t border-[#23516b] bg-[#10283d] p-3 text-[10px] leading-4 text-[#99c5ed]">
        <Info size={14} className="mt-0.5 shrink-0"/>
        <p>Built-in variables are read-only. Values come from the existing editor context; some project and media fields may be placeholders until connected to actual metadata.</p>
      </div>
    </>}
  </section>
}
