import type { ComponentType } from 'react'
import type { NodeProps } from '@xyflow/react'
import type { StudioFlowNode } from './WorkflowNodeCard'
import type { WorkflowCatalogItem, WorkflowNode, WorkflowSource } from './workflowTypes'
import type { WorkflowStudioState } from './useWorkflowStudio'

/** The UI plugin controls its own Parameters, optional INPUT and OUTPUT previews.
 * Backend catalog & executor remain the authority for available node types.
 */
export type WorkflowNodeParametersProps = {
  node: WorkflowNode
  catalog?: WorkflowCatalogItem
  onChange: (key: string, value: unknown) => void
  studio?: WorkflowStudioState
  /** Real upstream artifacts, keyed by connected node ID. */
  inputValue?: unknown
  onManageCredentials?: () => void
  hasAgentModel?: boolean
}

export type WorkflowNodeInputProps = {
  source: WorkflowSource | null
  hasUpstream: boolean
}

export type WorkflowNodeOutputProps = {
  value: unknown
}

export type WorkflowNodeUI = {
  type: string
  Icon?: ComponentType<{ size?: number; className?: string }>
  Card?: ComponentType<NodeProps<StudioFlowNode>>
  Parameters?: ComponentType<WorkflowNodeParametersProps>
  Settings?: ComponentType<WorkflowNodeParametersProps>
  Input?: ComponentType<WorkflowNodeInputProps>
  Output?: ComponentType<WorkflowNodeOutputProps>
  /** Node-owned JSON presentation adapter; does not change backend artifacts. */
  formatOutput?: (value: unknown) => unknown
}
