import { useContext } from 'react'
import { Check, FlaskConical, LoaderCircle, LockKeyhole, Plus } from 'lucide-react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { StudioFlowNode } from '../WorkflowNodeCard'
import { WorkflowQuickAddContext, WorkflowManualTriggerExecuteContext } from '../WorkflowNodeContexts'
import type { WorkflowNodeParametersProps, WorkflowNodeUI } from '../nodeTypes'

function StatusIcon({ status }: { status: StudioFlowNode['data']['status'] }) {
  if (status === 'done') return <Check size={16} strokeWidth={3} />
  if (status === 'running') return <LoaderCircle size={16} strokeWidth={2.2} className="animate-spin" />
  if (status === 'failed') return <span className="text-base font-bold leading-none">×</span>
  return null
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

function ManualTriggerParameters(_props: WorkflowNodeParametersProps) {
  return <>
    <div className="rounded-[9px] border border-[#eab308] bg-[#fffbeb] p-3 text-[12px] leading-[1.5] text-[#66461c]">
      This node starts the workflow when you manually execute it. Other trigger types can start workflows from schedules or incoming events.
    </div>
    <p className="text-[13px] text-[#454545]">This node does not have any parameters.</p>
  </>
}

const node: WorkflowNodeUI = { type: 'core.manual_trigger', Card: ManualTriggerCard, Parameters: ManualTriggerParameters }
export default node
