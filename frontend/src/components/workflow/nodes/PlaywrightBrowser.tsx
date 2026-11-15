import { Globe2 } from 'lucide-react'
import type { WorkflowNodeParametersProps, WorkflowNodeUI } from '../nodeTypes'
import { WorkflowSchemaParameters } from '../editor/WorkflowSchemaParameters'
import { PlaywrightDevPanel } from '../editor/BrowserDevControls'

function Parameters(props: WorkflowNodeParametersProps) {
  return <div>
    <PlaywrightDevPanel node={props.node} studio={props.studio}/>
    <WorkflowSchemaParameters {...props}/>
  </div>
}

const node: WorkflowNodeUI = { type: 'browser.playwright', Icon: Globe2, Parameters }
export default node
