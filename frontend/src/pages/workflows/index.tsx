import { ArrowLeft, ExternalLink, RefreshCw, Workflow } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { api } from '../../lib/api'
import { useEditor } from '../../stores/editorStore'
import type { Project, Timeline } from '../../types'

type N8nStatus = { configured: boolean; reachable: boolean; editor_path: string }
type N8nWorkflowLink = {
  id: number
  project_id: number
  element_client_id: string
  n8n_workflow_id: string
  title: string
  status: 'active' | 'inactive'
  last_synced_at: string
  editor_path: string
}

const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)

export function WorkflowPage() {
  const { id, workflowId: routeWorkflowId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const projectId = Number(id)
  const elementId = searchParams.get('element')
  const isNew = routeWorkflowId === 'new'
  const linkId = !isNew && routeWorkflowId ? Number(routeWorkflowId) : null
  const invalidProject = !Number.isInteger(projectId) || projectId < 1
  const invalidLink = !isNew && (linkId === null || !Number.isInteger(linkId) || linkId < 1)
  const [link, setLink] = useState<N8nWorkflowLink | null>(null)
  const [status, setStatus] = useState<N8nStatus | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [frameLoaded, setFrameLoaded] = useState(false)
  const [frameKey, setFrameKey] = useState(0)
  const creating = useRef(false)

  useEffect(() => {
    if (invalidProject || invalidLink) return
    let disposed = false
    const openWorkflow = async () => {
      setLoading(true)
      setError('')
      const [project, timeline, integration] = await Promise.all([
        api<Project>(`/projects/${projectId}`),
        api<Timeline>(`/projects/${projectId}/timeline`),
        api<N8nStatus>('/n8n/status'),
      ])
      if (disposed) return
      useEditor.getState().hydrate(projectId, timeline)
      setStatus(integration)
      if (isNew) {
        if (!elementId) throw new Error('Create Workflow requires a Timeline Empty Element.')
        if (creating.current) return
        creating.current = true
        const element = timeline.tracks.flatMap(track => track.clips).find(clip => clip.client_id === elementId)
        if (!element?.props?.empty_element && element?.props?.shape_kind !== 'Empty Element') {
          throw new Error('The linked Empty Element no longer exists.')
        }
        const created = await api<N8nWorkflowLink>(`/n8n/projects/${projectId}/workflows`, {
          method: 'POST',
          body: JSON.stringify({ element_client_id: elementId, title: `${project.name} — ${element.name}`.slice(0, 160) }),
        })
        if (disposed) return
        useEditor.getState().patchProps(elementId, { workflow_id: created.id })
        const current = useEditor.getState()
        try {
          const saved = await api<Timeline>(`/projects/${projectId}/timeline`, {
            method: 'PUT', body: JSON.stringify({ revision: current.revision, tracks: current.tracks }),
          })
          current.markSaved(saved.revision)
        } catch (reason) {
          await api<void>(`/n8n/projects/${projectId}/workflows/${created.id}?delete_underlying=true`, { method: 'DELETE' })
          throw reason
        }
        if (disposed) return
        setLink(created)
        navigate(`/projects/${projectId}/workflows/${created.id}?element=${encodeURIComponent(elementId)}`, { replace: true })
      } else {
        const existing = await api<N8nWorkflowLink>(`/n8n/projects/${projectId}/workflows/${linkId}`)
        if (!disposed) setLink(existing)
      }
    }
    void openWorkflow().catch(reason => {
      if (!disposed) setError(errorMessage(reason))
    }).finally(() => {
      if (!disposed) setLoading(false)
    })
    return () => { disposed = true }
  }, [elementId, invalidLink, invalidProject, isNew, linkId, navigate, projectId])

  const pageError = invalidProject ? 'Invalid project.' : invalidLink ? 'Invalid workflow link.' : error
  const editorUrl = link?.editor_path ?? status?.editor_path ?? '/n8n/'

  return (
    <main className="fixed inset-0 z-[100] flex min-h-0 flex-col overflow-hidden bg-[#f7f7f8] text-[#18181b]" aria-label="CLIPTORA n8n workflow workspace">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[#dedee3] bg-white px-3 shadow-sm">
        <button type="button" onClick={() => navigate(`/projects/${projectId}/editor`)} className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-xs font-semibold text-[#3f3f46] hover:bg-[#f1f1f3] focus-visible:outline-2 focus-visible:outline-violet-600">
          <ArrowLeft size={15} /> Timeline
        </button>
        <div className="h-5 w-px bg-[#dedee3]" />
        <Workflow size={16} className="text-[#7c3aed]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold">{link?.title ?? 'n8n Workflow'}</div>
          <div className="truncate text-[10px] text-[#71717a]">{link ? `CLIPTORA link ${link.id} · n8n ${link.status}` : 'Genuine self-hosted n8n editor'}</div>
        </div>
        <button type="button" aria-label="Reload n8n editor" title="Reload n8n editor" onClick={() => { setFrameLoaded(false); setFrameKey(key => key + 1) }} className="grid size-8 place-items-center rounded-md text-[#52525b] hover:bg-[#f1f1f3] focus-visible:outline-2 focus-visible:outline-violet-600">
          <RefreshCw size={15} />
        </button>
        <a href={editorUrl} target="_blank" rel="noreferrer" title="Open the same n8n workflow in a separate tab" className="grid size-8 place-items-center rounded-md text-[#52525b] hover:bg-[#f1f1f3] focus-visible:outline-2 focus-visible:outline-violet-600">
          <ExternalLink size={15} />
        </a>
      </header>
      {!loading && status && (!status.reachable || !status.configured) && (
        <div role="alert" className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          {!status.reachable ? 'n8n is not reachable. Start the CLIPTORA n8n Docker service, then reload this page.' : 'n8n is running, but FastAPI has no N8N_API_KEY. Sign in below, create an API key in n8n Settings, add it to backend/.env, and restart FastAPI.'}
        </div>
      )}
      {pageError && <div role="alert" className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">{pageError}</div>}
      <section className="relative min-h-0 flex-1 bg-white" aria-label="n8n editor">
        {(loading || !frameLoaded) && <div className="absolute inset-0 z-10 animate-pulse bg-[#f4f4f5] p-5" aria-label="Loading n8n editor"><div className="mb-4 h-10 rounded-lg bg-[#e4e4e7]" /><div className="h-[calc(100%-3.5rem)] rounded-xl border border-[#e4e4e7] bg-white" /></div>}
        {status?.reachable && <iframe key={frameKey} src={editorUrl} title="n8n workflow editor" className="h-full w-full border-0 bg-white" allow="clipboard-read; clipboard-write" onLoad={() => setFrameLoaded(true)} />}
      </section>
    </main>
  )
}

export default WorkflowPage
