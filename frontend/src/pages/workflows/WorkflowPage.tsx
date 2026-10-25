import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { WorkflowStudio } from '../../components/editor/workflows/WorkflowStudio'
import { WorkflowLayout } from '../../layouts/WorkflowLayout'
import { api } from '../../lib/api'
import { useEditor } from '../../stores/editorStore'
import type { MediaAsset, Project, Timeline } from '../../types'
import type { WorkflowDefinition } from '../../components/editor/workflows/workflowTypes'

export function WorkflowPage() {
  const { id, workflowId: routeWorkflowId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const projectId = Number(id)
  const elementId = params.get('element')
  const workflowId = routeWorkflowId && routeWorkflowId !== 'new' ? Number(routeWorkflowId) : null
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!Number.isInteger(projectId) || projectId < 1) { setError('Invalid project.'); return }
    let disposed = false
    void Promise.all([
      api<Project>(`/projects/${projectId}`),
      api<Timeline>(`/projects/${projectId}/timeline`),
      api<MediaAsset[]>(`/projects/${projectId}/media`),
    ]).then(([, timeline, media]) => {
      if (disposed) return
      useEditor.getState().hydrate(projectId, timeline)
      useEditor.getState().setMedia(media)
      setReady(true)
    }).catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { disposed = true }
  }, [projectId])

  const attachWorkflow = useCallback(async (definition: WorkflowDefinition) => {
    if (!elementId) return
    const state = useEditor.getState()
    const element = state.tracks.flatMap(track => track.clips).find(clip => clip.client_id === elementId)
    if (!element?.props?.empty_element) throw new Error('The linked Empty Element no longer exists.')
    state.patchProps(elementId, { workflow_id: definition.id })
    const updated = useEditor.getState()
    const saved = await api<Timeline>(`/projects/${projectId}/timeline`, {
      method: 'PUT', body: JSON.stringify({ revision: updated.revision, tracks: updated.tracks }),
    })
    updated.markSaved(saved.revision)
    navigate(`/projects/${projectId}/workflows/${definition.id}?element=${encodeURIComponent(elementId)}`, { replace: true })
  }, [elementId, navigate, projectId])

  if (error) return <WorkflowLayout><div className="grid h-full place-items-center p-6 text-sm text-red-200">{error}</div></WorkflowLayout>
  if (!ready) return <WorkflowLayout><div className="grid h-full place-items-center text-sm text-[#8995aa]">Loading workflow workspace…</div></WorkflowLayout>

  return <WorkflowLayout>
    <WorkflowStudio
      projectId={projectId}
      initialWorkflowId={Number.isInteger(workflowId) ? workflowId : null}
      onSaved={attachWorkflow}
      onClose={() => navigate(`/projects/${projectId}/editor`)}
    />
  </WorkflowLayout>
}
