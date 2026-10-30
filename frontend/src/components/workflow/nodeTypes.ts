import type { ComponentType } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { StudioFlowNode } from './WorkflowNodeCard'
import type { WorkflowCatalogItem, WorkflowNode } from './workflowTypes'

/** Plugins use type IDs from the backend catalog. No frontend-only executors. */
export type WorkflowNodeParametersProps = {
  node: WorkflowNode
  catalog?: WorkflowCatalogItem
  onChange: (key: string, value: unknown) => void
}

export type WorkflowNodeUI = {
  type: string
  Icon?: ComponentType<{ size?: number; className?: string }>
  Card?: ComponentType<NodeProps<StudioFlowNode>>
  Parameters?: ComponentType<WorkflowNodeParametersProps>
}
