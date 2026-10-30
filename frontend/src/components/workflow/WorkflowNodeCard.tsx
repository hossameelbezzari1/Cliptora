import { createContext, useContext, type CSSProperties, type MouseEvent } from 'react'
import { Check, Clock3, FlaskConical, LoaderCircle, LockKeyhole, Plus, Zap } from 'lucide-react'
import { Handle, Position, type Node as FlowNode, type NodeProps } from '@xyflow/react'
import { WorkflowToolIcon } from './WorkflowToolIcon'

export type StudioFlowNode = FlowNode<{
  label: string
  nodeType: string
  subtitle: string
  meta: string
  status: 'done' | 'running' | 'waiting' | 'failed'
  pinned?: boolean
  note?: string
}, 'studio'>

export type WorkflowQuickAdd = (
  sourceId: string,
  sourceHandle: string,
  event: MouseEvent<HTMLButtonElement>
) => void

export type WorkflowManualTriggerExecution = {
  execute: () => void
  disabled: boolean
}

export const WorkflowQuickAddContext = createContext<WorkflowQuickAdd | null>(null)
export const WorkflowInputQuickAddContext = createContext<WorkflowQuickAdd | null>(null)
export const WorkflowManualTriggerExecuteContext = createContext<WorkflowManualTriggerExecution | null>(null)

export function isManualTriggerNode(type: string, label: string): boolean {
  const value = type.toLowerCase()
  return /(?:^|[._-])manual[._-]?(?:trigger|start)(?:$|[._-])/.test(value)
    || /(?:^|[._-])trigger[._-]?(?:manual|click)(?:$|[._-])/.test(value)
    || /(?:^|[._-])execute[._-]?workflow(?:$|[._-])/.test(value)
    || /manual\s+trigger|when\s+clicking.*execute\s+workflow/i.test(label)
}

function ManualClickIcon() {
  return (
    <svg
      viewBox="0 0 112 112"
      width="68"
      height="68"
      fill="none"
      aria-hidden="true"
      className="pointer-events-none"
    >
      <path d="M77 28C62 11 36 11 21 28 5 45 8 70 25 84" stroke="#303030" strokeWidth="6.5" strokeLinecap="round" />
      <path d="M68 43C59 31 42 30 32 40 23 50 23 65 32 75" stroke="#303030" strokeWidth="6.5" strokeLinecap="round" />
      <path d="M57 54C52 50 45 51 41 56 38 60 38 65 41 69" stroke="#303030" strokeWidth="6" strokeLinecap="round" />
      <path d="M50 60L93 77 75 83 84 104 72 109 62 88 50 102Z" fill="white" stroke="#303030" strokeWidth="5.5" strokeLinejoin="round" />
    </svg>
  )
}

function StatusIcon({ status }: { status: StudioFlowNode['data']['status'] }) {
  if (status === 'done') return <Check size={18} strokeWidth={3} />
  if (status === 'running') return <LoaderCircle size={17} strokeWidth={2.2} className="animate-spin" />
  if (status === 'failed') return <span className="text-lg font-bold leading-none">×</span>
  return <Clock3 size={17} strokeWidth={2.1} />
}

function ManualTriggerCard({ id, data, selected }: NodeProps<StudioFlowNode>) {
  const onQuickAdd = useContext(WorkflowQuickAddContext)
  const execution = useContext(WorkflowManualTriggerExecuteContext)
  const running = data.status === 'running'
  const title = /manual\s+trigger|when\s+clicking.*execute\s+workflow/i.test(data.label)
    ? 'When clicking ‘Execute workflow’'
    : data.label

  const borderColor = data.status === 'done'
    ? 'border-[#00b449]'
    : data.status === 'failed'
      ? 'border-[#ed1933]'
      : data.status === 'running'
        ? 'border-[#ff9acb]'
        : 'border-[#d9dce0]'

  return (
    <div className="group/manual relative flex w-[190px] cursor-grab select-none flex-col items-center overflow-visible text-center active:cursor-grabbing">
      <button
        type="button"
        aria-label="Execute workflow"
        title={execution ? 'Execute the workflow through FastAPI' : 'Connect workflow execution in WorkflowCanvas.tsx'}
        disabled={!execution || execution.disabled}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          event.preventDefault()
          event.stopPropagation()
          if (execution && !execution.disabled) execution.execute()
        }}
        className="nodrag nopan absolute right-[calc(100%+10px)] top-[33px] z-30 flex h-[43px] items-center gap-2 whitespace-nowrap rounded-full bg-[#252525] px-4 text-[14px] font-semibold text-white shadow-sm transition-colors hover:bg-[#393939] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {running ? <LoaderCircle size={18} strokeWidth={2.2} className="animate-spin" /> : <FlaskConical size={19} strokeWidth={2.2} />}
        Execute workflow
      </button>

      {data.pinned && (
        <span title="Pinned node" className="pointer-events-none absolute left-[30px] top-[4px] z-30 grid size-5 place-items-center rounded-full bg-white text-[#666] shadow-sm">
          <LockKeyhole size={13} />
        </span>
      )}

      <div className={`relative grid size-[108px] place-items-center rounded-[28px] border-[2px] bg-white shadow-[0_2px_5px_#00000010] transition-shadow hover:shadow-[0_4px_13px_#00000016] ${borderColor} ${selected ? 'ring-[6px] ring-[#d8c6ff99]' : 'ring-[6px] ring-[#e7e8eacc]'}`}>
        <ManualClickIcon />
        <Handle
          id="main"
          type="source"
          position={Position.Right}
          className="!z-20 !size-[18px] !border-[2px] !border-[#a5abb0] !bg-white !opacity-100 !shadow-[0_0_0_4px_#ffffffcc] hover:!border-[#8c57ff] hover:!bg-[#f7f2ff]"
          style={{ right: -10, top: '50%' }}
        />

        {onQuickAdd && (
          <button
            type="button"
            aria-label="Add a node after manual trigger"
            title="Add next node"
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation()
              onQuickAdd(id, 'main', event)
            }}
            className="nodrag nopan absolute -right-[40px] top-1/2 z-20 grid size-[25px] -translate-y-1/2 place-items-center rounded-[6px] bg-[#ededee] text-[#555] opacity-0 transition-opacity hover:bg-[#dcdce0] group-hover/manual:opacity-100 focus:opacity-100"
          >
            <Plus size={17} strokeWidth={2} />
          </button>
        )}

        {data.status !== 'waiting' && (
          <span className={`pointer-events-none absolute -bottom-[11px] -right-[11px] z-20 grid size-[26px] place-items-center rounded-full border-[3px] border-white ${data.status === 'done' ? 'bg-[#eefff3] text-[#00ad4c]' : data.status === 'failed' ? 'bg-[#fff0f2] text-[#ed1933]' : 'bg-[#fff3f8] text-[#f36aa8]'}`}>
            <StatusIcon status={data.status} />
          </span>
        )}
      </div>

      <strong className="mt-[13px] block w-[275px] max-w-none text-center text-[16px] font-semibold leading-[1.25] text-[#202020]">
        {title}
      </strong>

      {running && <span className="mt-1 text-[12px] text-[#777]">Executing…</span>}
      {data.note && (
        <div className="nodrag mt-2 max-w-[190px] whitespace-pre-wrap break-words rounded-md border border-[#e9e1b9] bg-[#fffbe6] px-2 py-1.5 text-left text-[11px] leading-4 text-[#675c37]">
          {data.note}
        </div>
      )}
    </div>
  )
}

function StudioNodeCard(props: NodeProps<StudioFlowNode>) {
  const { id, data, selected } = props
  const onQuickAdd = useContext(WorkflowQuickAddContext)

  if (isManualTriggerNode(data.nodeType, data.label)) {
    return <ManualTriggerCard {...props} />
  }

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
