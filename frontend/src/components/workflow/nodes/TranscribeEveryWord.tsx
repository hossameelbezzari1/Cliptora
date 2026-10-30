import type { WorkflowNodeUI } from '../nodeTypes'
import { Captions } from 'lucide-react'

/** UI extension for backend node `audio.transcribe`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'audio.transcribe',
  Icon: Captions,
}

export default node
