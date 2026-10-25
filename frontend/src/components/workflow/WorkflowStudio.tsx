import { WorkflowLayout } from '../../layouts/WorkflowLayout'
import {
  useWorkflowStudio,
  type WorkflowStudioProps,
} from './useWorkflowStudio'

import '@xyflow/react/dist/style.css'

export function WorkflowStudio(props: WorkflowStudioProps) {
  const studio = useWorkflowStudio(props)

  return <WorkflowLayout studio={studio} />
}

export default WorkflowStudio
