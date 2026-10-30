import { createContext, type MouseEvent } from 'react'

export type WorkflowQuickAdd = (
  sourceId: string,
  sourceHandle: string,
  event: MouseEvent<HTMLButtonElement>
) => void

export type WorkflowManualTriggerExecution = {
  execute: () => void
  disabled: boolean
}

export const WorkflowQuickAddContext = createContext<WorkflowQuickAdd | null>(null)
export const WorkflowInputQuickAddContext = createContext<WorkflowQuickAdd | null>(null)
export const WorkflowManualTriggerExecuteContext = createContext<WorkflowManualTriggerExecution | null>(null)
