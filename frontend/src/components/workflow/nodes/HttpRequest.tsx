import type { WorkflowNodeUI } from '../nodeTypes'
import { Globe2 } from 'lucide-react'

/** UI extension for backend node `core.http_request`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'core.http_request',
  Icon: Globe2,
}

export default node
