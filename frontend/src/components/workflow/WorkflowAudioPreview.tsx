import { useEffect, useMemo, useState } from 'react'
import { AudioLines, Download, RefreshCw } from 'lucide-react'
import { api } from '../../lib/api'

export type WorkflowAudioItem = {
  id: string
  name: string
  filename: string
  category: 'voiceover' | 'extracted'
  format: string
  size_bytes: number
  group_id: string | null
  node_id: string | null
}

type Filter = 'all' | 'voiceover' | 'extracted'

type Props = {
  projectId: number
  runId: number | null | undefined
  defaultFilter?: Filter
  compact?: boolean
  showFilters?: boolean
}

const bytesLabel = (bytes: number) => bytes < 1048576
  ? `${Math.max(1, Math.round(bytes / 1024))} KB`
  : `${(bytes / 1048576).toFixed(1)} MB`

const route = (projectId: number, runId: number, fileId: string) =>
  `/api/v1/workflows/${projectId}/runs/${runId}/audios/${fileId}`

export function WorkflowAudioPreview({ projectId, runId, defaultFilter = 'all', compact = false, showFilters = true }: Props) {
  const [items, setItems] = useState<WorkflowAudioItem[]>([])
  const [filter, setFilter] = useState<Filter>(defaultFilter)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setFilter(defaultFilter)
  }, [defaultFilter, runId])

  useEffect(() => {
    setItems([])
    setError('')
    if (runId == null) return
    let active = true
    let pending = false
    const load = async () => {
      if (pending || !active) return
      pending = true
      if (active) setLoading(true)
      try {
        const result = await api<WorkflowAudioItem[]>(`/workflows/${projectId}/runs/${runId}/audios`)
        if (active) { setItems(result); setError('') }
      } catch (exc) {
        if (active) setError(exc instanceof Error ? exc.message : 'Unable to load audio previews')
      } finally {
        pending = false
        if (active) setLoading(false)
      }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 4000)
    return () => { active = false; window.clearInterval(timer) }
  }, [projectId, runId, refreshKey])

  const visible = useMemo(() => items.filter(item => filter === 'all' || item.category === filter), [items, filter])

  return <section className="flex h-full min-h-0 min-w-0 flex-col text-[#262626] dark:text-[#f3f4f6]" aria-label="Workflow audio previews">
    <div className="flex shrink-0 items-center gap-2 border-b border-[#eeeeee] px-3 py-2 dark:border-[#374151]">
      <AudioLines size={16} className="shrink-0 text-violet-600" />
      <strong className="truncate text-[12px] font-semibold">Audio Previews</strong>
      <span className="rounded-full bg-[#f0f0f0] px-1.5 py-0.5 text-[10px] tabular-nums text-[#666] dark:bg-[#303642] dark:text-[#bbb]">{visible.length}</span>
      <button type="button" aria-label="Refresh audio files" title="Refresh audio files" onClick={() => setRefreshKey(key => key + 1)} className="ml-auto grid size-7 place-items-center rounded-md hover:bg-[#f0f0f0] dark:hover:bg-[#303642]">
        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
      </button>
    </div>
    {showFilters && <div className="flex shrink-0 items-center gap-1 border-b border-[#ededed] px-3 py-1.5 dark:border-[#374151]">
      {([['all', 'All'], ['voiceover', 'Voiceovers'], ['extracted', 'Extracted']] as const).map(([key, label]) =>
        <button key={key} type="button" onClick={() => setFilter(key)} className={`rounded-full px-2.5 py-1 text-[11px] transition ${filter === key ? 'bg-violet-100 font-semibold text-violet-800 dark:bg-violet-900/40 dark:text-violet-200' : 'text-[#777] hover:bg-[#f1f1f1] dark:text-[#bbb] dark:hover:bg-[#303642]'}`}>{label}</button>,
      )}
    </div>}
    <div className={`min-h-0 flex-1 overflow-y-auto px-3 py-2 [scrollbar-width:thin] ${compact ? 'space-y-2' : 'space-y-3'}`}>
      {runId == null ? <p className="py-4 text-center text-[12px] text-[#888]">Run the workflow to preview its audio files.</p> : null}
      {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-[11px] text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
      {runId != null && !visible.length && !error && <p className="py-4 text-center text-[12px] leading-5 text-[#888] dark:text-[#bbb]">
        {loading ? 'Searching for audio…' : filter === 'voiceover' ? 'No generated voiceovers saved for this run yet.' : 'No playable audio files saved for this run yet.'}
      </p>}
      {runId != null && visible.map(item => <div key={item.id} className="min-w-0 rounded-xl border border-[#e7e7e7] bg-white p-2.5 dark:border-[#414141] dark:bg-[#252b35]">
        <div className="flex min-w-0 items-start gap-2">
          <AudioLines size={15} className="mt-0.5 shrink-0 text-violet-600" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium" title={item.name}>{item.name}</p>
            <p className="mt-0.5 truncate text-[10px] text-[#888] dark:text-[#aab0bb]">{item.category === 'voiceover' ? 'Voiceover / Browser download' : 'Extracted audio'} · {item.format} · {bytesLabel(item.size_bytes)}{item.node_id ? ` · ${item.node_id}` : ''}</p>
          </div>
          <a href={`${route(projectId, runId, item.id)}?download=true`} download={item.filename} aria-label={`Download ${item.filename}`} title={`Download ${item.filename}`} className="grid size-7 shrink-0 place-items-center rounded-md text-[#666] hover:bg-[#f2f2f2] dark:text-[#aaa] dark:hover:bg-[#353d49]">
            <Download size={15} />
          </a>
        </div>
        <audio
          data-cliptora-run-audio
          aria-label={`Listen to ${item.name}`}
          controls
          preload="none"
          src={route(projectId, runId, item.id)}
          onPlay={event => {
            document.querySelectorAll<HTMLAudioElement>('audio[data-cliptora-run-audio]').forEach(player => {
              if (player !== event.currentTarget) player.pause()
            })
          }}
          className={`mt-2 block w-full ${compact ? 'h-9' : 'h-10'}`}
        />
      </div>)}
    </div>
  </section>
}
