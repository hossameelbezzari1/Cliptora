import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { WorkflowStudio } from '../../components/workflow/WorkflowStudio'
import type { WorkflowDefinition } from '../../components/workflow/workflowTypes'
import { WorkflowLayout } from '../../layouts/WorkflowLayout'
import { api } from '../../lib/api'
import { useEditor } from '../../stores/editorStore'
import type { MediaAsset, Project, Timeline } from '../../types'

export function WorkflowPage() {
  const { id, workflowId: routeWorkflowId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const projectId = Number(id)
  const elementId = searchParams.get('element')
  const workflowId =
    routeWorkflowId && routeWorkflowId !== 'new'
      ? Number(routeWorkflowId)
      : null

  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')

  const invalidProjectId = !Number.isInteger(projectId) || projectId < 1
  const invalidWorkflowId =
    workflowId !== null &&
    (!Number.isInteger(workflowId) || workflowId < 1)

  useEffect(() => {
    if (invalidProjectId || invalidWorkflowId) return

    let disposed = false

    setReady(false)
    setError('')

    void Promise.all([
      api<Project>(`/projects/${projectId}`),
      api<Timeline>(`/projects/${projectId}/timeline`),
      api<MediaAsset[]>(`/projects/${projectId}/media`),
    ])
      .then(([, timeline, media]) => {
        if (disposed) return

        useEditor.getState().hydrate(projectId, timeline)
        useEditor.getState().setMedia(media)

        setReady(true)
      })
      .catch(reason => {
        if (disposed) return

        setError(
          reason instanceof Error
            ? reason.message
            : String(reason)
        )
      })

    return () => {
      disposed = true
    }
  }, [projectId, invalidProjectId, invalidWorkflowId])

  const attachWorkflow = useCallback(
    async (definition: WorkflowDefinition) => {
      if (!elementId) return

      const editor = useEditor.getState()

      const element = editor.tracks
        .flatMap(track => track.clips)
        .find(clip => clip.client_id === elementId)

      if (!element?.props?.empty_element) {
        throw new Error('The linked Empty Element no longer exists.')
      }

      editor.patchProps(elementId, {
        workflow_id: definition.id,
      })

      const updated = useEditor.getState()

      const timeline = await api<Timeline>(
        `/projects/${projectId}/timeline`,
        {
          method: 'PUT',
          body: JSON.stringify({
            revision: updated.revision,
            tracks: updated.tracks,
          }),
        }
      )

      updated.markSaved(timeline.revision)

      navigate(
        `/projects/${projectId}/workflows/${definition.id}?element=${encodeURIComponent(elementId)}`,
        { replace: true }
      )
    },
    [elementId, navigate, projectId]
  )

  const pageError = invalidProjectId
    ? 'Invalid project.'
    : invalidWorkflowId
      ? 'Invalid workflow.'
      : error

  if (pageError) {
    return (
      <WorkflowLayout>
        <div
          role="alert"
          className="grid h-full place-items-center p-6 text-sm text-red-700"
        >
          {pageError}
        </div>
      </WorkflowLayout>
    )
  }

  if (!ready) {
    return (
      <WorkflowLayout>
        <div className="grid h-full place-items-center text-sm text-[#71717a]">
          Loading workflow workspace…
        </div>
      </WorkflowLayout>
    )
  }

  return (
    <WorkflowStudio
      projectId={projectId}
      initialWorkflowId={workflowId}
      onSaved={attachWorkflow}
      onClose={() => navigate(`/projects/${projectId}/editor`)}
    />
  )
}

export default WorkflowPage
