import { useContext, type CSSProperties } from 'react'
import {
  Bot,
  Check,
  Clock3,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Zap,
} from 'lucide-react'

import {
  Handle,
  Position,
  useEdges,
  type Node as FlowNode,
  type NodeProps,
} from '@xyflow/react'

import { WorkflowToolIcon } from './WorkflowToolIcon'
import { WorkflowQuickAddContext } from './WorkflowNodeContexts'
import { getNodeUI } from './nodeRegistry'
import { NodeProgress } from './editor/NodeProgress'
import type { WorkflowRun } from './workflowTypes'

export type StudioFlowNode = FlowNode<{
  label: string
  nodeType: string
  subtitle: string
  meta: string
  status: 'done' | 'running' | 'waiting' | 'failed'
  run?: WorkflowRun | null
  pinned?: boolean
  note?: string
}, 'studio'>

export {
  WorkflowQuickAddContext,
  WorkflowInputQuickAddContext,
  WorkflowManualTriggerExecuteContext,
} from './WorkflowNodeContexts'

export type {
  WorkflowQuickAdd,
  WorkflowManualTriggerExecution,
} from './WorkflowNodeContexts'

export function isManualTriggerNode(
  type: string,
  label: string,
): boolean {
  const value = type.toLowerCase()

  return (
    /(?:^|[._-])manual[._-]?(?:trigger|start)(?:$|[._-])/.test(value) ||
    /(?:^|[._-])trigger[._-]?(?:manual|click)(?:$|[._-])/.test(value) ||
    /(?:^|[._-])execute[._-]?workflow(?:$|[._-])/.test(value) ||
    /manual\s+trigger|when\s+clicking.*execute\s+workflow/i.test(label)
  )
}

function StatusIcon({
  status,
}: {
  status: StudioFlowNode['data']['status']
}) {
  if (status === 'done') {
    return <Check size={18} strokeWidth={3} />
  }

  if (status === 'running') {
    return (
      <LoaderCircle
        size={17}
        strokeWidth={2.2}
        className="animate-spin"
      />
    )
  }

  if (status === 'failed') {
    return (
      <span className="text-lg font-bold leading-none">
        ×
      </span>
    )
  }

  return <Clock3 size={17} strokeWidth={2.1} />
}

const agentPorts = [
  { id: 'chat_model', label: 'Chat Model', x: '17%', required: true },
  { id: 'memory', label: 'Memory', x: '50%', required: false },
  { id: 'tool', label: 'Tool', x: '83%', required: false },
] as const

function AIAgentCard({ id, data, selected }: NodeProps<StudioFlowNode>) {
  const quickAdd = useContext(WorkflowQuickAddContext)
  const mainHandleClass =
    '!z-30 !size-[17px] !border-[2px] !border-[#9ca5b5] !bg-white dark:!border-[#9ca5b5] dark:!bg-cl-dark-panel !shadow-[0_0_0_3px_white] dark:!shadow-none'

  return (
    <div className="group/agent relative w-[300px] h-[222px] cursor-grab select-none overflow-visible text-left active:cursor-grabbing">
      <div className={`relative flex h-[112px] items-center gap-[18px] rounded-[22px] border-[1.5px] bg-white px-[25px] dark:bg-cl-dark-panel ${
        data.status === 'done'
          ? 'border-emerald-400'
          : data.status === 'failed'
            ? 'border-red-300'
            : 'border-[#d8dce3] dark:border-[#515966]'
      } shadow-[0_2px_7px_rgba(15,23,42,0.07)] transition-shadow hover:shadow-[0_5px_16px_rgba(15,23,42,0.11)] ${
        selected ? 'ring-[4px] ring-violet-200/70 dark:ring-violet-900/50' : ''
      }`}>
        <Handle id="input" type="target" position={Position.Left} className={mainHandleClass} style={{ left: -9 }} />

        <span className="pointer-events-none grid size-[57px] shrink-0 place-items-center text-[#9135f0] dark:text-[#b486ff]">
          <Bot size={49} strokeWidth={2.1} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[20px] font-semibold tracking-[-0.02em] text-[#1a1a1c] dark:text-[#f3f4f6]">
          {data.label}
        </span>

        <Handle id="main" type="source" position={Position.Right} className={mainHandleClass} style={{ right: -9 }} />
        {quickAdd && (
          <button
            type="button"
            className="nodrag nopan absolute left-[calc(100%+34px)] top-[40px] z-20 grid size-[32px] place-items-center rounded-[9px] bg-[#ededee] text-[#333] transition-colors hover:bg-[#dedee2] dark:bg-[#343946] dark:text-[#eee] dark:hover:bg-[#454b59]"
            title="Add next node"
            aria-label="Add next node"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); quickAdd(id, 'main', e) }}
          >
            <Plus size={21} strokeWidth={1.9} />
          </button>
        )}

        {/* Status belongs to the card's lower-right corner, not the ports. */}
        <span
          className={`pointer-events-none absolute -bottom-[10px] right-[11px] z-30 grid size-[25px] place-items-center rounded-full border-[3px] border-white bg-[#f5f6f8] dark:border-[#232833] dark:bg-[#2b303b] ${
            data.status === 'done' ? 'text-emerald-600' : data.status === 'failed' ? 'text-red-500' : data.status === 'running' ? 'text-violet-600' : 'text-[#9299a6]'
          }`}
          title={data.status}
        >
          <StatusIcon status={data.status} />
        </span>
      </div>

      {agentPorts.map(port => (
        <div
          key={port.id}
          className="absolute top-[112px] z-30 h-[108px] w-[96px] -translate-x-1/2 overflow-visible"
          style={{ left: port.x }}
        >
          {/* Position each handle at the precise horizontal centre of its own port. */}
          <Handle
            id={port.id}
            type="target"
            position={Position.Bottom}
            className="!absolute !z-30 !size-[14px] !rounded-[2px] !border-[1.5px] !border-[#a5acb7] !bg-white dark:!bg-cl-dark-panel"
            style={{
              left: '50%',
              top: -7,
              right: 'auto',
              bottom: 'auto',
              transform: 'translateX(-50%) rotate(45deg)',
            }}
            title={port.label}
          />

          {/* Each caption uses its own fixed-width centered row; no flex shifting. */}
          <div className="pointer-events-none absolute left-1/2 top-[21px] z-50 flex -translate-x-1/2 items-center justify-center whitespace-nowrap rounded-md bg-white px-[7px] py-[2px] text-center text-[11px] font-medium leading-[15px] text-[#707784] dark:bg-cl-dark-panel dark:text-[#c1c6d0]">
            <span>{port.label}</span>
            {port.required && <span className="ml-[2px] text-red-500">*</span>}
          </div>

          {/* Decoration only. React Flow draws the real connection separately. */}
          <span className="pointer-events-none absolute left-1/2 top-[46px] z-10 h-[18px] w-[1px] -translate-x-1/2 bg-[#d5d9df] dark:bg-[#626a78]" />

          {quickAdd && (
            <button
              type="button"
              className="nodrag nopan absolute left-1/2 top-[65px] z-50 grid size-[30px] -translate-x-1/2 place-items-center rounded-[8px] bg-[#ebeced] text-[#333] transition-colors hover:bg-[#dedee2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 dark:bg-[#343946] dark:text-[#eee] dark:hover:bg-[#454b59]"
              title={`Add ${port.label}`}
              aria-label={`Add ${port.label}`}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); quickAdd(id, port.id, e) }}
            >
              <Plus size={20} strokeWidth={1.8} />
            </button>
          )}
        </div>
      ))}

      {data.pinned && (
        <span className="pointer-events-none absolute left-2 top-2 z-30 rounded-full bg-white p-1 text-[#777] dark:bg-cl-dark-panel" title="Pinned node">
          <LockKeyhole size={13} />
        </span>
      )}
      {(data.status === 'running' || data.status === 'failed') && (
        <NodeProgress run={data.run} nodeId={id} label={data.label} variant="compact" className="absolute left-0 top-[202px] w-full" />
      )}
      {data.note && (
        <div className="nodrag absolute left-0 top-[222px] z-10 w-full whitespace-pre-wrap break-words rounded-md border border-[#e9e1b9] bg-[#fffbe6] px-2 py-1.5 text-[11px] leading-4 text-[#675c37] dark:border-[#696553] dark:bg-[#1f2937] dark:text-[#bfbbab]">
          {data.note}
        </div>
      )}
    </div>
  )
}

/** Attached n8n-style sub-node. The same node keeps its main-flow card when detached. */
function AgentSubNodeCard({
  id,
  data,
  selected,
  port,
}: NodeProps<StudioFlowNode> & { port: 'chat_model' | 'memory' | 'tool' }) {
  const portLabel = port === 'chat_model' ? 'Model' : port === 'memory' ? 'Memory' : 'Tool'
  const border = data.status === 'failed'
    ? 'border-red-400'
    : data.status === 'done'
      ? 'border-emerald-400'
      : 'border-[#dedfe2] dark:border-[#515966]'

  return (
    <div className="group/subnode relative flex w-[190px] cursor-grab select-none flex-col items-center overflow-visible text-center active:cursor-grabbing">
      <div className="relative mt-[17px] flex size-[112px] items-center justify-center">
        <div className={`relative grid size-[112px] place-items-center rounded-full border-[2px] bg-white shadow-[0_2px_7px_rgba(15,23,42,0.07)] transition-shadow hover:shadow-[0_4px_14px_rgba(15,23,42,0.12)] dark:bg-cl-dark-panel ${border} ${selected ? 'ring-[6px] ring-[#dce0e8] dark:ring-violet-900/50' : ''}`}>
          <Handle
            id="main"
            type="source"
            position={Position.Top}
            className="!absolute !z-30 !size-[15px] !rounded-[2px] !border-[1.5px] !border-[#a5acb7] !bg-white dark:!bg-cl-dark-panel"
            style={{ left: '50%', top: -9, transform: 'translateX(-50%) rotate(45deg)' }}
            title={`Connect as ${portLabel}`}
          />
          <span className="pointer-events-none grid size-[72px] place-items-center">
            <WorkflowToolIcon type={data.nodeType} label={data.label} nodeId={id} size={57} />
          </span>
          <span className={`pointer-events-none absolute -bottom-[9px] -right-[5px] z-20 grid size-[24px] place-items-center rounded-full border-[3px] border-white bg-[#f5f6f8] dark:border-cl-dark-line dark:bg-[#2b303b] ${data.status === 'failed' ? 'text-red-500' : data.status === 'done' ? 'text-emerald-600' : data.status === 'running' ? 'text-violet-600' : 'text-[#9299a6]'}`}>
            <StatusIcon status={data.status} />
          </span>
        </div>
      </div>
      <span className="pointer-events-none mt-[11px] rounded bg-white/95 px-1.5 text-[12px] font-medium text-[#777] dark:bg-cl-dark-panel dark:text-[#c1c6d0]">
        {portLabel}
      </span>
      <strong className="mt-[7px] max-w-[190px] break-words text-[15px] font-semibold leading-[1.3] text-[#242424] dark:text-[#f3f4f6]">
        {data.label}
      </strong>
      {(data.status === 'running' || data.status === 'failed') && (
        <NodeProgress run={data.run} nodeId={id} label={data.label} variant="compact" className="mt-2 w-full" />
      )}
      {data.note && (
        <div className="nodrag mt-2 max-w-[190px] whitespace-pre-wrap break-words rounded-md border border-[#e9e1b9] bg-[#fffbe6] px-2 py-1.5 text-left text-[11px] leading-4 text-[#675c37] dark:border-[#696553] dark:bg-[#1f2937] dark:text-[#bfbbab]">
          {data.note}
        </div>
      )}
    </div>
  )
}

function StudioNodeCard(props: NodeProps<StudioFlowNode>) {
  const { id, data, selected } = props
  const onQuickAdd = useContext(WorkflowQuickAddContext)
  const edges = useEdges()

  // n8n-style sub-node is determined by a real, typed edge, not its node type.
  // This preserves existing main-flow cards for the very same node types.
  const attachedEdge = edges.find(edge =>
    edge.source === id &&
    (edge.targetHandle === 'chat_model' || edge.targetHandle === 'memory' || edge.targetHandle === 'tool')
  )
  const attachedPort = attachedEdge?.targetHandle
  if (attachedPort === 'chat_model' || attachedPort === 'memory' || attachedPort === 'tool') {
    return <AgentSubNodeCard {...props} port={attachedPort} />
  }

  const CustomCard = getNodeUI(data.nodeType)?.Card

  if (CustomCard) {
    return <CustomCard {...props} />
  }

  if (data.nodeType.toLowerCase() === 'ai.agent') {
    return <AIAgentCard {...props} />
  }

  const isBranch = data.nodeType.toLowerCase() === 'flow.if'

  const isTrigger =
    /trigger|webhook|schedule|cron|manual|video_source/.test(
      data.nodeType.toLowerCase(),
    )

  const handleClass =
    "!z-20 !size-[18px] !border-[3px] !border-[#a5abb0] !bg-white dark:bg-cl-dark-panel !opacity-100 !shadow-[0_0_0_5px_#ffffffcc] after:!absolute after:!-inset-[9px] after:!content-[''] hover:!border-[#e6daff] dark:border-[#8c57ff] hover:!bg-[#f7f2ff] dark:bg-[#1f2937]"

  const borderColor =
    data.status === 'done'
      ? 'border-[#00b449]'
      : data.status === 'failed'
        ? 'border-[#fbccd2] dark:border-[#ed1933]'
        : data.status === 'running'
          ? 'border-[#ff9acb]'
          : data.nodeType.startsWith('ai.')
            ? 'border-[#ff9acb]'
            : 'border-[#e0e2e5] dark:border-[#374151]'

  const addButton = (
    handle: string,
    style: CSSProperties,
  ) => onQuickAdd && (
    <button
      type="button"
      title={`Add a node after ${data.label}${isBranch ? ` (${handle})` : ''}`}
      aria-label={`Add a node after ${data.label}${isBranch ? ` (${handle})` : ''}`}
      className="nodrag nopan absolute z-20 grid size-[27px] place-items-center rounded-[7px] bg-[#ededee] dark:bg-[#1f2937] text-[#494949] dark:text-[#b8bec7] shadow-[0_1px_2px_#0000000d] transition-colors hover:bg-[#dedede] dark:hover:bg-[#1f2937] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500"
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
        <span
          title="Pinned node"
          className="pointer-events-none absolute left-[5px] top-[8px] z-30 grid size-5 place-items-center rounded-full bg-white dark:bg-cl-dark-panel text-[#777] dark:text-[#b8bec7] shadow-sm"
        >
          <LockKeyhole size={14} />
        </span>
      )}

      {isTrigger && (
        <Zap
          size={21}
          strokeWidth={2.3}
          className="pointer-events-none absolute left-[5px] top-[42px] text-[#292929] dark:text-[#f3f4f6]"
          aria-hidden="true"
        />
      )}

      <div className={`relative grid size-[108px] place-items-center rounded-[21px] border-[2px] bg-white dark:bg-cl-dark-panel shadow-[0_2px_4px_#00000010] transition-shadow hover:shadow-[0_4px_14px_#0000001c] ${borderColor} ${
        selected
          ? 'ring-[5px] ring-[#c8b5ff83] shadow-[0_4px_18px_#00000018]'
          : ''
      }`}>
        {data.nodeType === 'ai.agent' && (
          <div className="absolute left-0 right-0 top-[calc(100%+5px)] z-20 flex justify-between px-1">
            {([
              ['chat_model', 'Chat Model', '#8b5cf6'],
              ['memory', 'Memory', '#10b981'],
              ['tool', 'Tool', '#3b82f6'],
            ] as const).map(([port, title, color]) => (
              <div key={port} className="relative flex flex-col items-center gap-1">
                <Handle
                  id={port}
                  type="target"
                  position={Position.Bottom}
                  className="!relative !left-auto !top-auto !size-[13px] !translate-x-0 !translate-y-0 !rounded-full !border-[2px] !border-white dark:!border-[#374151]"
                  style={{ backgroundColor: color }}
                  title={title}
                />
                <span className="whitespace-nowrap text-[9px] font-semibold" style={{ color }}>{title}</span>
              </div>
            ))}
          </div>
        )}
        {!isTrigger && (
          <Handle
            id="input"
            type="target"
            position={Position.Left}
            className={handleClass}
            style={{ left: -11 }}
          />
        )}

        <div className="pointer-events-none grid size-[66px] place-items-center">
          <WorkflowToolIcon
            type={data.nodeType}
            label={data.label}
            nodeId={id}
            size={48}
          />
        </div>

        {isBranch ? (
          <>
            <Handle
              id="true"
              type="source"
              position={Position.Right}
              className={handleClass}
              style={{ right: -11, top: '33%' }}
            />

            <Handle
              id="false"
              type="source"
              position={Position.Right}
              className={handleClass}
              style={{ right: -11, top: '69%' }}
            />

            <span
              className="pointer-events-none absolute text-[13px] text-[#777] dark:text-[#b8bec7]"
              style={{
                left: 'calc(100% + 12px)',
                top: 'calc(33% - 11px)',
              }}
            >
              true
            </span>

            <span
              className="pointer-events-none absolute text-[13px] text-[#777] dark:text-[#b8bec7]"
              style={{
                left: 'calc(100% + 12px)',
                top: 'calc(69% - 11px)',
              }}
            >
              false
            </span>

            {addButton('true', {
              left: 'calc(100% + 70px)',
              top: 'calc(33% - 14px)',
            })}

            {addButton('false', {
              left: 'calc(100% + 70px)',
              top: 'calc(69% - 14px)',
            })}
          </>
        ) : (
          <>
            <Handle
              id="main"
              type="source"
              position={Position.Right}
              className={handleClass}
              style={{ right: -11 }}
            />

            {addButton('main', {
              left: 'calc(100% + 30px)',
              top: 'calc(50% - 14px)',
            })}
          </>
        )}

        <span className={`pointer-events-none absolute -bottom-[12px] -right-[12px] z-20 grid size-[28px] place-items-center rounded-full border-[3px] border-white dark:border-cl-dark-line ${
          data.status === 'done'
            ? 'bg-[#eefff3] dark:bg-[#1f2937] text-[#00ad4c]'
            : data.status === 'running'
              ? 'bg-[#fff3f8] dark:bg-[#1f2937] text-[#f36aa8]'
              : data.status === 'failed'
                ? 'bg-[#fff0f2] dark:bg-[#1f2937] text-[#ed1933] dark:text-[#f79ea9]'
                : 'bg-[#f5f6f6] dark:bg-[#1f2937] text-[#858585] dark:text-[#b8bec7]'
        }`}>
          <StatusIcon status={data.status} />
        </span>
      </div>

      <strong className={`${data.nodeType === 'ai.agent' ? 'mt-[35px]' : 'mt-[12px]'} max-w-[190px] break-words text-[16px] font-semibold leading-[1.25] text-[#202020] dark:text-[#f3f4f6]`}>
        {data.label}
      </strong>

      <span className="mt-[6px] max-w-[190px] break-words text-[13px] leading-[1.3] text-[#898989] dark:text-[#b8bec7]">
        {data.status === 'running'
          ? 'Processing…'
          : data.status === 'done'
            ? data.meta
            : data.subtitle}
      </span>

      {(data.status === 'running' || data.status === 'failed') && (
        <NodeProgress
          run={data.run}
          nodeId={id}
          label={data.label}
          variant="compact"
          className="mt-2 max-w-[190px]"
        />
      )}

      {data.note && (
        <div className="nodrag mt-2 max-w-[190px] whitespace-pre-wrap break-words rounded-md border border-[#e9e1b9] dark:border-[#696553] bg-[#fffbe6] dark:bg-[#1f2937] px-2 py-1.5 text-left text-[11px] leading-4 text-[#675c37] dark:text-[#bfbbab]">
          {data.note}
        </div>
      )}
    </div>
  )
}

export const flowNodeTypes = {
  studio: StudioNodeCard,
}