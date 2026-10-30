import type { WorkflowNodeUI } from '../nodeTypes'
import { ListFilter } from 'lucide-react'

/** UI extension for backend node `data.filter`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'data.filter',
  Icon: ListFilter,
}

export default node
