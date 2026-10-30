import type { WorkflowNodeUI } from '../nodeTypes'
import { FileJson2 } from 'lucide-react'

/** UI extension for backend node `transcript.import`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'transcript.import',
  Icon: FileJson2,
}

export default node
