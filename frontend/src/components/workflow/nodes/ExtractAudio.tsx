import type { WorkflowNodeUI } from '../nodeTypes'
import { AudioLines } from 'lucide-react'

/** UI extension for backend node `audio.extract`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'audio.extract',
  Icon: AudioLines,
}

export default node
