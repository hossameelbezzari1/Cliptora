import type { WorkflowNodeUI } from '../nodeTypes'
import { PanelsTopLeft } from 'lucide-react'

/** UI extension for backend node `animation.storyboard`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'animation.storyboard',
  Icon: PanelsTopLeft,
}

export default node
