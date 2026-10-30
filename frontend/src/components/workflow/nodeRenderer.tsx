import type { NodeProps } from '@xyflow/react'
import type { StudioFlowNode } from './WorkflowNodeCard'
import { getNodeUI } from './nodeRegistry'

/** Optional per-node canvas renderer; generic card is used when undefined. */
export function customNodeCard(type: string) {
  return getNodeUI(type)?.Card as ((props: NodeProps<StudioFlowNode>) => import("react").ReactNode) | undefined
}
