import type { WorkflowNodeUI } from '../nodeTypes'
import { ScanSearch } from 'lucide-react'

/** UI extension for backend node `media.probe`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'media.probe',
  Icon: ScanSearch,
}

export default node
