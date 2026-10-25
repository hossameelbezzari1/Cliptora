import { Check, Clock3, LoaderCircle } from 'lucide-react'
import { Handle, Position, type Node as FlowNode, type NodeProps } from '@xyflow/react'
import { iconFor, toneFor } from './workflowUI'

export type StudioFlowNode = FlowNode<{
  label: string
  nodeType: string
  subtitle: string
  meta: string
  status: 'done' | 'running' | 'waiting'
}, 'studio'>

function StudioNodeCard({ data, selected }: NodeProps<StudioFlowNode>) {
  return (
    <div className="group/node flex w-[168px] flex-col items-center text-center">
      <div className={`relative grid size-[70px] place-items-center rounded-xl border-2 bg-white shadow-sm transition-all ${toneFor(data.nodeType)} ${selected ? 'ring-[3px] ring-violet-200 shadow-md' : 'hover:shadow-md'}`}>
        <Handle
          type="target"
          position={Position.Left}
          className="!size-[10px] !border-2 !border-white !bg-[#343434] !opacity-0 group-hover/node:!opacity-100 group-focus-within/node:!opacity-100"
        />
        <span className={`grid size-10 place-items-center rounded-lg border ${toneFor(data.nodeType)}`}>
          {iconFor(data.nodeType, 22)}
        </span>
        <span className={`absolute -bottom-2 -right-2 grid size-[23px] place-items-center rounded-full border-2 border-white ${data.status === 'done' ? 'bg-emerald-100 text-emerald-700' : data.status === 'running' ? 'bg-amber-100 text-amber-700' : 'bg-[#f3f4f6] text-[#8a8a8a]'}`}>
          {data.status === 'done' ? <Check size={13} /> : data.status === 'running' ? <LoaderCircle size={13} className="animate-spin" /> : <Clock3 size={12} />}
        </span>
        <Handle
          type="source"
          position={Position.Right}
          className="!size-[10px] !border-2 !border-white !bg-[#343434] !opacity-0 group-hover/node:!opacity-100 group-focus-within/node:!opacity-100"
        />
      </div>
      <strong className="mt-2.5 max-w-[168px] truncate text-[13px] font-semibold text-[#202020]">{data.label}</strong>
      <small className="mt-0.5 max-w-[168px] truncate text-[11px] font-normal text-[#858585]">
        {data.status === 'running' ? 'Processing…' : data.status === 'done' ? data.meta : data.subtitle}
      </small>
    </div>
  )
}

export const flowNodeTypes = { studio: StudioNodeCard }
