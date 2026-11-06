
import { NodeIcon, getNodeIconColor, useNodeIcon } from './NodeIcon'

/**
 * Compatibility component for existing Workflow UI.
 * Icon definitions are centralized in NodeIcon.tsx.
 */
export function WorkflowToolIcon({
  type,
  size = 32,
  actionId,
  nodeId,
}: {
  type: string
  label?: string
  size?: number
  actionId?: string
  nodeId?: string
}) {
  const icon = useNodeIcon(type, actionId, nodeId)

  return (
    <NodeIcon
      icon={icon}
      size={size}
      color={getNodeIconColor(type)}
    />
  )
}
