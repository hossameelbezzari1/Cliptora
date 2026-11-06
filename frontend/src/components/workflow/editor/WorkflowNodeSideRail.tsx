import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import type { WorkflowStudioState } from '../useWorkflowStudio'
import type { WorkflowCatalogItem, WorkflowNode } from '../workflowTypes'
import { WorkflowToolIcon } from '../WorkflowToolIcon'
import { WorkflowNodeConnections } from './WorkflowNodeConnections'

type Side = 'input' | 'output'
type Props = { studio: WorkflowStudioState; side: Side }

function labelOf(node: WorkflowNode, catalog: WorkflowCatalogItem[]) {
  const custom = node.settings.__cliptora_ui_label
  return typeof custom === 'string' && custom.trim()
    ? custom.trim()
    : catalog.find(item => item.type === node.type)?.label ?? 'Workflow node'
}

function isEntry(type: string) {
  return type === 'core.video_source' || /(?:^|[._-])(trigger|webhook|schedule|cron)(?:$|[._-])/.test(type)
}

function compatible(source: WorkflowCatalogItem | undefined, target: WorkflowCatalogItem | undefined) {
  const outputs = source?.output_types ?? []
  const inputs = target?.input_types ?? []
  return !outputs.length || !inputs.length || outputs.includes('any') || inputs.includes('any') ||
    outputs.some(kind => inputs.includes(kind))
}

function hasAncestor(nodes: WorkflowNode[], nodeId: string, ancestorId: string) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const stack = [...(byId.get(nodeId)?.depends_on ?? [])]
  const seen = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    if (id === ancestorId) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(byId.get(id)?.depends_on ?? []))
  }
  return false
}

export function WorkflowNodeSideRail({ studio, side }: Props) {
  const { selected, nodes, catalog, setSelectedId, working } = studio
  const [open, setOpen] = useState(false)
  const [searchHint, setSearchHint] = useState('')
  const railRef = useRef<HTMLDivElement>(null)
  const input = side === 'input'
  const connected = useMemo(() => {
    if (!selected) return []
    return input
      ? selected.depends_on.map(id => nodes.find(node => node.id === id)).filter((node): node is WorkflowNode => Boolean(node))
      : nodes.filter(node => node.depends_on.includes(selected.id))
  }, [selected, nodes, input])

  const suggestions = useMemo(() => {
    if (!selected || (input && isEntry(selected.type))) return []
    const selectedCatalog = catalog.find(item => item.type === selected.type)
    const usableExisting = nodes.filter(candidate => {
      if (candidate.id === selected.id) return false
      if (!input && isEntry(candidate.type)) return false
      const source = input ? candidate : selected
      const target = input ? selected : candidate
      if (target.depends_on.includes(source.id) || hasAncestor(nodes, source.id, target.id)) return false
      return compatible(catalog.find(item => item.type === source.type), catalog.find(item => item.type === target.type))
    })
    if (usableExisting.length) return usableExisting.slice(0, 2).map(node => ({ type: node.type, label: labelOf(node, catalog), id: node.id }))
    return catalog.filter(item => item.status === 'implemented' &&
      !(input && item.type === 'core.video_source' && nodes.some(node => node.type === item.type)) &&
      !(!input && isEntry(item.type)) &&
      compatible(input ? item : selectedCatalog, input ? selectedCatalog : item))
      .slice(0, 2).map(item => ({ type: item.type, label: item.label, id: '' }))
  }, [selected, nodes, catalog, input])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!railRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  if (!selected || (input && isEntry(selected.type))) return null
  const visible = connected.slice(0, 6)
  const badgeClass = 'group grid size-[54px] cursor-pointer place-items-center rounded-[18px] border border-[#dedede] dark:border-[#374151] bg-white dark:bg-cl-dark-panel text-[#454545] dark:text-[#b8bec7] shadow-[0_4px_15px_rgba(0,0,0,0.12)] transition-all hover:-translate-y-px hover:border-violet-400 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500'

  return <div ref={railRef} className={`pointer-events-none absolute top-1/2 z-[70] hidden -translate-y-1/2 lg:block ${input ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2'}`}>
    <div className="pointer-events-auto flex flex-col items-center gap-2">
      {visible.map(node => <button key={node.id} type="button" className={badgeClass}
        title={`${input ? 'Previous' : 'Next'} node: ${labelOf(node, catalog)}`}
        aria-label={`Open ${labelOf(node, catalog)}`}
        onClick={() => { setOpen(false); setSelectedId(node.id) }}>
        <WorkflowToolIcon label={labelOf(node, catalog)} type={node.type} size={28} />
      </button>)}
      {connected.length > 6 && <button type="button" className={badgeClass} onClick={() => { setSearchHint(''); setOpen(value => !value) }} title="More connected nodes">+{connected.length - 6}</button>}
      {connected.length === 0 && suggestions.map(item => <button key={`${item.type}:${item.id}`} type="button" className={badgeClass}
        title={`Suggested ${input ? 'previous' : 'next'} node: ${item.label}. Click to choose a connection.`}
        aria-label={`Choose ${item.label} as ${input ? 'previous' : 'next'} node`}
        onClick={() => { setSearchHint(item.label); setOpen(true) }}>
        <WorkflowToolIcon label={item.label} type={item.type} size={28} />
      </button>)}
      <button type="button" disabled={working} className="grid size-8 cursor-pointer place-items-center rounded-full border border-[#dcdce1] dark:border-[#374151] bg-white dark:bg-cl-dark-panel text-[#777] dark:text-[#b8bec7] shadow-sm transition-colors hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => { setSearchHint(''); setOpen(value => !value) }} aria-expanded={open} aria-label={`Add ${input ? 'previous' : 'next'} node`} title={`Add ${input ? 'previous' : 'next'} node`}>
        <Plus size={17} />
      </button>
    </div>

    {open && <div role="dialog" aria-label={`${input ? 'Previous' : 'Next'} node connections`}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }}
      className={`pointer-events-auto absolute top-0 w-[min(340px,75vw)] rounded-xl bg-white dark:bg-cl-dark-panel shadow-[0_18px_55px_rgba(0,0,0,0.25)] ${input ? 'left-[calc(100%+12px)]' : 'right-[calc(100%+12px)]'}`}>
      <WorkflowNodeConnections key={searchHint} studio={studio} side={side} mode="popover" initialSearch={searchHint} onClose={() => setOpen(false)} />
    </div>}
  </div>
}
