import { useContext, type CSSProperties } from 'react'
import { Check, Clock3, LoaderCircle, LockKeyhole, Plus, Zap } from 'lucide-react'
import { Handle, Position, type Node as FlowNode, type NodeProps } from '@xyflow/react'
import { WorkflowToolIcon } from './WorkflowToolIcon'
import { WorkflowQuickAddContext } from './WorkflowNodeContexts'
import { getNodeUI } from './nodeRegistry'

export type StudioFlowNode = FlowNode<{
  label: string
  nodeType: string
  subtitle: string
  meta: string
  status: 'done' | 'running' | 'waiting' | 'failed'
  pinned?: boolean
  note?: string
}, 'studio'>

export {
  WorkflowQuickAddContext,
  WorkflowInputQuickAddContext,
  WorkflowManualTriggerExecuteContext,
} from './WorkflowNodeContexts'
export type { WorkflowQuickAdd, WorkflowManualTriggerExecution } from './WorkflowNodeContexts'

export function isManualTriggerNode(type: string, label: string): boolean {
  const value = type.toLowerCase()
  return /(?:^|[._-])manual[._-]?(?:trigger|start)(?:$|[._-])/.test(value)
    || /(?:^|[._-])trigger[._-]?(?:manual|click)(?:$|[._-])/.test(value)
    || /(?:^|[._-])execute[._-]?workflow(?:$|[._-])/.test(value)
    || /manual\s+trigger|when\s+clicking.*execute\s+workflow/i.test(label)
}

function StatusIcon({ status }: { status: StudioFlowNode['data']['status'] }) {
  if (status === 'done') return <Check size={18} strokeWidth={3} />
  if (status === 'running') return <LoaderCircle size={17} strokeWidth={2.2} className="animate-spin" />
  if (status === 'failed') return <span className="text-lg font-bold leading-none">×</span>
  return <Clock3 size={17} strokeWidth={2.1} />
}

function StudioNodeCard(props: NodeProps<StudioFlowNode>) {
  const { id, data, selected } = props
  const onQuickAdd = useContext(WorkflowQuickAddContext)

  const CustomCard = getNodeUI(data.nodeType)?.Card
  if (CustomCard) return <CustomCard {...props} />

  const isBranch = data.nodeType.toLowerCase() === 'flow.if'
  const isTrigger = /trigger|webhook|schedule|cron|manual|video_source/.test(data.nodeType.toLowerCase())
  const handleClass = "!z-20 !size-[18px] !border-[3px] !border-[#a5abb0] !bg-white !opacity-100 !shadow-[0_0_0_5px_#ffffffcc] after:!absolute after:!-inset-[9px] after:!content-[''] hover:!border-[#8c57ff] hover:!bg-[#f7f2ff]"
  const borderColor = data.status === 'done'
    ? 'border-[#00b449]'
    : data.status === 'failed'
      ? 'border-[#ed1933]'
      : data.status === 'running'
        ? 'border-[#ff9acb]'
        : data.nodeType.startsWith('ai.')
          ? 'border-[#ff9acb]'
          : 'border-[#e0e2e5]'

  const addButton = (handle: string, style: CSSProperties) => onQuickAdd && (
    <button
      type="button"
      title={`Add a node after ${data.label}${isBranch ? ` (${handle})` : ''}`}
      aria-label={`Add a node after ${data.label}${isBranch ? ` (${handle})` : ''}`}
      className="nodrag nopan absolute z-20 grid size-[27px] place-items-center rounded-[7px] bg-[#ededee] text-[#494949] shadow-[0_1px_2px_#0000000d] transition-colors hover:bg-[#dedede] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500"
      style={style}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation()
        onQuickAdd(id, handle, event)
      }}
    >
      <Plus size={19} strokeWidth={2} />
    </button>
  )

  return (
    <div className="group/node relative flex w-[190px] cursor-grab select-none flex-col items-center overflow-visible text-center active:cursor-grabbing">
      {data.pinned && (
        <span title="Pinned node" className="pointer-events-none absolute left-[5px] top-[8px] z-30 grid size-5 place-items-center rounded-full bg-white text-[#777] shadow-sm">
          <LockKeyhole size={14} />
        </span>
      )}
      {isTrigger && (
        <Zap size={21} strokeWidth={2.3} className="pointer-events-none absolute left-[5px] top-[42px] text-[#292929]" aria-hidden="true" />
      )}
      <div className={`relative grid size-[108px] place-items-center rounded-[21px] border-[2px] bg-white shadow-[0_2px_4px_#00000010] transition-shadow hover:shadow-[0_4px_14px_#0000001c] ${borderColor} ${selected ? 'ring-[5px] ring-[#c8b5ff83] shadow-[0_4px_18px_#00000018]' : ''}`}>
        {!isTrigger && (
          <Handle
            id="input"
            type="target"
            position={Position.Left}
            className={handleClass}
            style={{ left: -11 }}
          />
        )}
        <div className={`pointer-events-none grid size-[66px] place-items-center rounded-[14px] ${data.nodeType.startsWith('ai.') ? 'border border-[#ffb0d5] bg-[#fff2f9]' : isBranch ? 'bg-[#f6fcfb]' : 'bg-white'}`}>
          <WorkflowToolIcon type={data.nodeType} label={data.label} size={48} />
        </div>
        {isBranch ? (
          <>
            <Handle id="true" type="source" position={Position.Right} className={handleClass} style={{ right: -11, top: '33%' }} />
            <Handle id="false" type="source" position={Position.Right} className={handleClass} style={{ right: -11, top: '69%' }} />
            <span className="pointer-events-none absolute text-[13px] text-[#777]" style={{ left: 'calc(100% + 12px)', top: 'calc(33% - 11px)' }}>true</span>
            <span className="pointer-events-none absolute text-[13px] text-[#777]" style={{ left: 'calc(100% + 12px)', top: 'calc(69% - 11px)' }}>false</span>
            {addButton('true', { left: 'calc(100% + 70px)', top: 'calc(33% - 14px)' })}
            {addButton('false', { left: 'calc(100% + 70px)', top: 'calc(69% - 14px)' })}
          </>
        ) : (
          <>
            <Handle id="main" type="source" position={Position.Right} className={handleClass} style={{ right: -11 }} />
            {addButton('main', { left: 'calc(100% + 30px)', top: 'calc(50% - 14px)' })}
          </>
        )}
        <span className={`pointer-events-none absolute -bottom-[12px] -right-[12px] z-20 grid size-[28px] place-items-center rounded-full border-[3px] border-white ${data.status === 'done' ? 'bg-[#eefff3] text-[#00ad4c]' : data.status === 'running' ? 'bg-[#fff3f8] text-[#f36aa8]' : data.status === 'failed' ? 'bg-[#fff0f2] text-[#ed1933]' : 'bg-[#f5f6f6] text-[#858585]'}`}>
          <StatusIcon status={data.status} />
        </span>
      </div>
      <strong className="mt-[12px] max-w-[190px] break-words text-[16px] font-semibold leading-[1.25] text-[#202020]">
        {data.label}
      </strong>
      <span className="mt-[6px] max-w-[190px] break-words text-[13px] leading-[1.3] text-[#898989]">
        {data.status === 'running' ? 'Processing…' : data.status === 'done' ? data.meta : data.subtitle}
      </span>
      {data.note && (
        <div className="nodrag mt-2 max-w-[190px] whitespace-pre-wrap break-words rounded-md border border-[#e9e1b9] bg-[#fffbe6] px-2 py-1.5 text-left text-[11px] leading-4 text-[#675c37]">
          {data.note}
        </div>
      )}
    </div>
  )
}

export const flowNodeTypes = { studio: StudioNodeCard }
