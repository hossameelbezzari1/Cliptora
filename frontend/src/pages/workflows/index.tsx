import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { WorkflowStudio } from '../../components/workflow/WorkflowStudio'
import type { WorkflowDefinition } from '../../components/workflow/workflowTypes'
import { api } from '../../lib/api'
import { useEditor } from '../../stores/editorStore'
import type { Clip, Project, Timeline } from '../../types'

const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)

export function WorkflowPage() {
  const { id, workflowId: routeWorkflowId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const projectId = Number(id)
  const elementId = searchParams.get('element')
  const isNew = routeWorkflowId === 'new'
  const workflowId = !isNew && routeWorkflowId ? Number(routeWorkflowId) : null
  const invalidProject = !Number.isInteger(projectId) || projectId < 1
  const invalidWorkflow = !isNew && (workflowId === null || !Number.isInteger(workflowId) || workflowId < 1)
  const [project, setProject] = useState<Project | null>(null)
  const [element, setElement] = useState<Clip | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const linkedWorkflow = useRef<number | null>(workflowId)

  useEffect(() => {
    if (invalidProject || invalidWorkflow) {
      setLoading(false)
      return
    }
    let disposed = false
    setLoading(true)
    setError('')
    void Promise.all([
      api<Project>(`/projects/${projectId}`),
      api<Timeline>(`/projects/${projectId}/timeline`),
    ]).then(([projectRow, timeline]) => {
      if (disposed) return
      useEditor.getState().hydrate(projectId, timeline)
      const linkedElement = elementId
        ? timeline.tracks.flatMap(track => track.clips).find(clip => clip.client_id === elementId) ?? null
        : null
      if (isNew) {
        if (!elementId) throw new Error('Create Workflow requires a Timeline Empty Element.')
        if (!linkedElement || (!linkedElement.props?.empty_element && linkedElement.props?.shape_kind !== 'Empty Element')) {
          throw new Error('The linked Empty Element no longer exists.')
        }
        if (linkedElement.props?.workflow_id) {
          navigate(`/projects/${projectId}/workflows/${linkedElement.props.workflow_id}?element=${encodeURIComponent(elementId)}`, { replace: true })
          return
        }
      }
      setProject(projectRow)
      setElement(linkedElement)
    }).catch(reason => {
      if (!disposed) setError(errorMessage(reason))
    }).finally(() => {
      if (!disposed) setLoading(false)
    })
    return () => { disposed = true }
  }, [elementId, invalidProject, invalidWorkflow, isNew, navigate, projectId])

  const initialName = useMemo(() => {
    if (!project) return 'Untitled Workflow'
    return element ? `${project.name} — ${element.name}`.slice(0, 160) : `${project.name} Workflow`.slice(0, 160)
  }, [element, project])

  const linkElement = async (definition: WorkflowDefinition) => {
    if (!elementId || linkedWorkflow.current === definition.id) return
    const state = useEditor.getState()
    const currentElement = state.tracks.flatMap(track => track.clips).find(clip => clip.client_id === elementId)
    if (!currentElement || (!currentElement.props?.empty_element && currentElement.props?.shape_kind !== 'Empty Element')) {
      throw new Error('The linked Empty Element no longer exists.')
    }
    state.patchProps(elementId, { workflow_id: definition.id })
    try {
      const current = useEditor.getState()
      const saved = await api<Timeline>(`/projects/${projectId}/timeline`, {
        method: 'PUT',
        body: JSON.stringify({ revision: current.revision, tracks: current.tracks }),
      })
      current.markSaved(saved.revision)
      linkedWorkflow.current = definition.id
      navigate(`/projects/${projectId}/workflows/${definition.id}?element=${encodeURIComponent(elementId)}`, { replace: true })
    } catch (reason) {
      useEditor.getState().patchProps(elementId, { workflow_id: null })
      throw reason
    }
  }

  const pageError = invalidProject ? 'Invalid project.' : invalidWorkflow ? 'Invalid workflow.' : error
  if (loading) {
    return <main className="fixed inset-0 z-[100] animate-pulse bg-[#f7f7f8] p-5" aria-label="Loading CLIPTORA Workflow Studio"><div className="mb-4 h-14 rounded-xl bg-[#e4e4e7]" /><div className="h-[calc(100%-4.5rem)] rounded-xl border border-[#e4e4e7] bg-white" /></main>
  }
  if (pageError || !project) {
    return <main className="fixed inset-0 z-[100] grid place-items-center bg-[#f7f7f8] p-6"><section className="max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm"><h1 className="text-base font-semibold text-[#27272a]">Workflow Studio unavailable</h1><p role="alert" className="mt-2 text-sm text-red-700">{pageError || 'Project could not be loaded.'}</p><button type="button" onClick={() => navigate(`/projects/${projectId}/editor`)} className="mt-5 rounded-lg bg-[#27272a] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3f3f46]">Back to Timeline</button></section></main>
  }

  return (
    <WorkflowStudio
      projectId={projectId}
      initialWorkflowId={workflowId}
      initialName={initialName}
      onSaved={linkElement}
      onClose={() => navigate(`/projects/${projectId}/editor`)}
    />
  )
}

export default WorkflowPage
