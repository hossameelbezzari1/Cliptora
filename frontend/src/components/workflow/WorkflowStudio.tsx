
import { useMemo } from 'react'
import { WorkflowLayout } from '../../layouts/WorkflowLayout'
import { NodeIconCatalogProvider } from './NodeIcon'
import {
  useWorkflowStudio,
  type WorkflowStudioProps,
  type WorkflowStudioState,
} from './useWorkflowStudio'
import type { WorkflowCatalogItem } from './workflowTypes'

import '@xyflow/react/dist/style.css'

/**
 * Use the existing FastAPI /workflows/catalog endpoint.
 * Backend owns node/action names, icons, and default settings.
 *
 * Normalize actions into IDs for components that expect string[].
 * Keep the original metadata for NodeIcon.
 */
function normalizeCatalog(rows: WorkflowCatalogItem[]): WorkflowCatalogItem[] {
  return rows.map(item => {
    const raw = Array.isArray(item.actions)
      ? (item.actions as unknown[])
      : []

    const actions: string[] = []
    const capabilities = { ...item.action_capabilities }

    for (const entry of raw) {
      if (typeof entry === 'string') {
        actions.push(entry)
        continue
      }

      if (!entry || typeof entry !== 'object') continue

      const action = entry as Record<string, unknown>

      if (typeof action.id !== 'string') continue

      actions.push(action.id)

      const previous = capabilities[action.id]

      capabilities[action.id] = {
        status: previous?.status ?? 'implemented',
        group: previous?.group ?? 'Actions',
        label: typeof action.label === 'string'
          ? action.label
          : previous?.label,
        reason: previous?.reason,
      }
    }

    return {
      ...item,
      actions,
      action_capabilities: capabilities,
    }
  })
}

export function WorkflowStudio(props: WorkflowStudioProps) {
  const studio = useWorkflowStudio(props)

  const catalog = useMemo(
    () => normalizeCatalog(studio.catalog),
    [studio.catalog],
  )

  const normalized = useMemo<WorkflowStudioState>(() => ({
    ...studio,
    catalog,
    selectedCatalog: catalog.find(
      item => item.type === studio.selected?.type,
    ),
    visibleCatalog: catalog.filter(item =>
      (
        studio.nodeGroup === 'All' ||
        item.group === studio.nodeGroup
      ) &&
      `${item.label} ${item.type}`
        .toLowerCase()
        .includes(studio.nodeSearch.toLowerCase()),
    ),
  }), [studio, catalog])

  return (
    <NodeIconCatalogProvider
      catalog={studio.catalog}
      nodes={studio.nodes}
    >
      <WorkflowLayout studio={normalized} />
    </NodeIconCatalogProvider>
  )
}

export default WorkflowStudio
