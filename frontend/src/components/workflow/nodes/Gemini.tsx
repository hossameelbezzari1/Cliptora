import type { WorkflowNodeUI } from '../nodeTypes'
import { GeminiParameters } from '../editor/GeminiParameters'
import { GeminiBrandIcon } from '../GeminiBrandIcon'

/** Registers the existing backend ai.gemini node with the native UI registry. */
const plugin: WorkflowNodeUI = {
  type: 'ai.gemini',
  Icon: GeminiBrandIcon,
  Parameters: GeminiParameters,
}

export default plugin
