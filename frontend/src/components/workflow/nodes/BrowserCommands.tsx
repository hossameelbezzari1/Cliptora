import { ListChecks } from 'lucide-react'
import type { WorkflowNodeParametersProps, WorkflowNodeUI } from '../nodeTypes'
import { WorkflowSchemaParameters } from '../editor/WorkflowSchemaParameters'
import { BrowserCommandsDevPanel } from '../editor/BrowserDevControls'

function Parameters(props: WorkflowNodeParametersProps) {
  return <div>
    <BrowserCommandsDevPanel node={props.node} studio={props.studio}/>
    <WorkflowSchemaParameters {...props}/>
  </div>
}

const node: WorkflowNodeUI = { type: 'browser.commands', Icon: ListChecks, Parameters }
export default node
