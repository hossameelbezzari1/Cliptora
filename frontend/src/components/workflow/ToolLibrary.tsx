import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import {
  ArrowLeft,
  Boxes,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  Database,
  FolderOpen,
  GitBranch,
  Globe2,
  GripVertical,
  Layers3,
  Plus,
  Search,
  Sparkles,
  Workflow,
  Wrench,
  X,
  Zap,
} from 'lucide-react'

import type { WorkflowCatalogItem } from './workflowTypes'
import type { WorkflowStudioState } from './useWorkflowStudio'
import { WorkflowToolIcon } from './WorkflowToolIcon'

type View = 'nodes' | 'templates' | 'workflows'

type SubNode = {
  id: string
  label: string
  disabled: boolean
  reason?: string
}

const WIDTH_KEY = 'cliptora.workflow.libraryWidth'
const MIN_WIDTH = 300
const MAX_WIDTH = 550
const DEFAULT_WIDTH = 375

const clamp = (value: number) =>
  Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value))

function actionsFor(item: WorkflowCatalogItem): SubNode[] {
  return (item.actions ?? []).map(value => {
    const action = String(value)
    const meta = item.action_capabilities?.[action]

    return {
      id: action,
      label:
        meta?.label ||
        action
          .replace(/_/g, ' ')
          .replace(/\b\w/g, char => char.toUpperCase()),
      disabled: meta?.status === 'unavailable',
      reason: meta?.reason,
    }
  })
}

function categoryIcon(group: string) {
  const name = group.toLowerCase()

  if (name.includes('ai') || name.includes('intelligen')) {
    return <BrainCircuit size={19} />
  }
  if (name.includes('trigger') || name.includes('schedule')) {
    return <Zap size={19} />
  }
  if (name.includes('flow') || name.includes('logic') || name.includes('control')) {
    return <GitBranch size={19} />
  }
  if (name.includes('data') || name.includes('transform')) {
    return <Database size={19} />
  }
  if (name.includes('app') || name.includes('integrat') || name.includes('social')) {
    return <Globe2 size={19} />
  }
  if (name.includes('media') || name.includes('video') || name.includes('audio')) {
    return <Layers3 size={19} />
  }
  if (name.includes('tool') || name.includes('core') || name.includes('util')) {
    return <Wrench size={19} />
  }
  return <Boxes size={19} />
}

export function ToolLibrary({
  studio,
  onOpenNode,
}: {
  studio: WorkflowStudioState
  onOpenNode?: () => void
}) {
  const {
    catalog,
    templates,
    definitions,
    versions,
    activeId,
    working,
    nodes,
    nodeSearch,
    setNodeSearch,
    nodeGroup,
    setNodeGroup,
    toolSearchRef,
    setLibraryOpen,
    addNode,
    setNodesTransient,
    openTemplate,
    openDefinition,
    restoreVersion,
  } = studio

  const [view, setView] = useState<View>('nodes')
  const [showCategories, setShowCategories] = useState(true)
  const [expandedType, setExpandedType] = useState<string | null>(null)

  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(WIDTH_KEY))
      return clamp(stored > 0 ? stored : DEFAULT_WIDTH)
    } catch {
      return DEFAULT_WIDTH
    }
  })

  const dragRef = useRef<{ x: number; width: number } | null>(null)

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragRef.current) return
      setWidth(clamp(dragRef.current.width + event.clientX - dragRef.current.x))
    }

    const stop = () => {
      dragRef.current = null
      document.body.style.userSelect = ''
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)

    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      document.body.style.userSelect = ''
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width))
    } catch {
      // Storage can be unavailable in private browsing.
    }
  }, [width])

  const available = useMemo(
    () =>
      catalog.filter(
        item => item.status === 'implemented' && Boolean(item.backend_executor),
      ),
    [catalog],
  )

  const groups = useMemo(() => {
    const result = new Map<string, number>()
    for (const item of available) {
      result.set(item.group, (result.get(item.group) ?? 0) + 1)
    }
    return [...result.entries()]
  }, [available])

  const search = nodeSearch.trim().toLowerCase()
  const isSearching = search.length > 0
  const categoryHome = view === 'nodes' && showCategories && !isSearching

  const filtered = useMemo(
    () =>
      available.filter(item => {
        if (!isSearching && nodeGroup !== 'All' && item.group !== nodeGroup) {
          return false
        }
        if (!isSearching) return true

        return [
          item.label,
          item.type,
          item.group,
          item.description || '',
          ...actionsFor(item).flatMap(action => [action.id, action.label]),
        ].some(value => value.toLowerCase().includes(search))
      }),
    [available, isSearching, nodeGroup, search],
  )

  const grouped = useMemo(() => {
    const result = new Map<string, WorkflowCatalogItem[]>()
    for (const item of filtered) {
      const items = result.get(item.group) ?? []
      items.push(item)
      result.set(item.group, items)
    }
    return [...result.entries()]
  }, [filtered])

  const selectCategory = (group: string) => {
    setNodeGroup(group)
    setNodeSearch('')
    setExpandedType(null)
    setShowCategories(false)
  }

  const backToCategories = () => {
    setNodeSearch('')
    setNodeGroup('All')
    setExpandedType(null)
    setShowCategories(true)
  }

  const changeView = (next: View) => {
    setView(next)
    setNodeSearch('')
    setExpandedType(null)
  }

  const add = (item: WorkflowCatalogItem, actionId?: string) => {
    if (working || nodes.length >= 100) return

    const existingIds = new Set(nodes.map(node => node.id))
    addNode(item.type)

    if (actionId) {
      const actionKey = Object.prototype.hasOwnProperty.call(item.settings, 'action')
        ? 'action'
        : 'operation'

      setNodesTransient(previous =>
        previous.map(node =>
          node.type === item.type && !existingIds.has(node.id)
            ? {
                ...node,
                settings: {
                  ...node.settings,
                  [actionKey]: actionId,
                },
              }
            : node,
        ),
      )
    }

    setLibraryOpen(false)
    onOpenNode?.()
  }

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    dragRef.current = { x: event.clientX, width }
    document.body.style.userSelect = 'none'
  }

  const templatesFiltered = templates.filter(item =>
    `${item.name} ${item.description}`.toLowerCase().includes(search),
  )

  const workflowsFiltered = definitions.filter(item =>
    item.name.toLowerCase().includes(search),
  )

  const nodeLimitReached = nodes.length >= 100

  return (
    <aside
      id="ws-tool-library"
      aria-label="Workflow node library"
      className="relative flex h-full min-h-0 shrink-0 flex-col border-r border-[#e7e7eb] bg-white text-[#303038] shadow-[4px_0_20px_rgba(19,19,27,0.035)]"
      style={{ width }}
    >
      <header className="shrink-0 border-b border-[#ececf0] px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold leading-6 tracking-[-0.025em] text-[#27272f]">
              {view === 'nodes'
                ? 'What happens next?'
                : view === 'templates'
                  ? 'Workflow templates'
                  : 'Your workflows'}
            </h2>
            <p className="mt-1 text-[11px] leading-4 text-[#85858e]">
              {view === 'nodes'
                ? 'Search or browse available steps'
                : view === 'templates'
                  ? 'Start with a reusable workflow'
                  : 'Open a saved workflow'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close library"
            title="Close library"
            onClick={() => setLibraryOpen(false)}
            className="-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-[#8b8b93] transition-colors hover:bg-[#f4f4f6] hover:text-[#292930] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8b6fce]"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <nav aria-label="Library views" className="grid shrink-0 grid-cols-3 gap-1 border-b border-[#ececf0] px-4 py-2.5">
        {([
          { key: 'nodes', label: 'Nodes', icon: <Boxes size={15} /> },
          { key: 'templates', label: 'Templates', icon: <Layers3 size={15} /> },
          { key: 'workflows', label: 'Workflows', icon: <Workflow size={15} /> },
        ] as const).map(tab => (
          <button
            key={tab.key}
            type="button"
            aria-pressed={view === tab.key}
            onClick={() => changeView(tab.key)}
            className={`flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8b6fce] ${
              view === tab.key
                ? 'bg-[#f1efff] text-[#694db2]'
                : 'text-[#85858d] hover:bg-[#f7f7f8] hover:text-[#383841]'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      <div className="shrink-0 px-4 pb-3 pt-4">
        <label className="flex h-11 items-center gap-2.5 rounded-lg border border-[#dcdce3] bg-white px-3 shadow-[0_1px_2px_rgba(0,0,0,0.025)] transition-all focus-within:border-[#9476db] focus-within:ring-[3px] focus-within:ring-[#eee8fc]">
          <Search size={17} className="shrink-0 text-[#a1a1ab]" />
          <input
            ref={toolSearchRef}
            type="search"
            autoComplete="off"
            aria-label={`Search ${view}`}
            placeholder={view === 'nodes' ? 'Search nodes...' : `Search ${view}...`}
            value={nodeSearch}
            onChange={event => setNodeSearch(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-[#303038] outline-none placeholder:text-[#a5a5ae]"
          />
          {nodeSearch && (
            <button
              type="button"
              aria-label="Clear search"
              className="rounded p-1 text-[#9999a2] hover:bg-[#f4f4f6] hover:text-[#444]"
              onClick={() => setNodeSearch('')}
            >
              <X size={14} />
            </button>
          )}
        </label>
      </div>

      {view === 'nodes' && (
        <div className="flex min-h-0 flex-1 flex-col">
          {categoryHome ? (
            <div className="min-h-0 flex-1 overflow-y-auto pb-5 [scrollbar-width:thin]">
              <div className="px-5 pb-2 pt-2 text-[11px] font-semibold text-[#92929b]">
                Browse categories
              </div>

              <button
                type="button"
                onClick={() => selectCategory('All')}
                className="group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[#f7f7fb]"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[#e9e7f5] bg-[#f5f2ff] text-[#8164c7]">
                  <Boxes size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-[#303038]">All nodes</span>
                  <span className="mt-0.5 block text-[11px] text-[#92929b]">
                    Browse all {available.length} available nodes
                  </span>
                </span>
                <ChevronRight size={16} className="text-[#b3b3bb] group-hover:text-[#7860b5]" />
              </button>

              {groups.map(([group, count]) => (
                <button
                  key={group}
                  type="button"
                  onClick={() => selectCategory(group)}
                  className="group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[#f7f7fb]"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[#ebebef] bg-[#f8f8fa] text-[#676773] group-hover:border-[#e5dcfb] group-hover:bg-[#f3efff] group-hover:text-[#7656c0]">
                    {categoryIcon(group)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-[#303038]">
                      {group}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[#92929b]">
                      {count} {count === 1 ? 'node' : 'nodes'} available
                    </span>
                  </span>
                  <ChevronRight size={16} className="text-[#b3b3bb] group-hover:text-[#7860b5]" />
                </button>
              ))}

              {!available.length && (
                <p className="px-5 py-8 text-center text-xs text-[#9a9aa2]">
                  No executable nodes are available yet.
                </p>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {!isSearching ? (
                <button
                  type="button"
                  onClick={backToCategories}
                  className="flex shrink-0 items-center gap-2 border-b border-[#efeff2] px-5 py-3 text-left text-xs font-semibold text-[#585865] transition-colors hover:bg-[#fafafd]"
                >
                  <ArrowLeft size={16} />
                  <span className="min-w-0 flex-1 truncate">
                    {nodeGroup === 'All' ? 'All nodes' : nodeGroup}
                  </span>
                  <span className="rounded-md bg-[#f4f4f6] px-2 py-1 text-[10px] text-[#8c8c95]">
                    {filtered.length}
                  </span>
                </button>
              ) : (
                <p className="shrink-0 px-5 pb-2 pt-1 text-[11px] text-[#9999a2]">
                  {filtered.length} {filtered.length === 1 ? 'result' : 'results'} for “{nodeSearch.trim()}”
                </p>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto pb-5 [scrollbar-width:thin]">
                {grouped.map(([group, items]) => (
                  <section key={group}>
                    {(isSearching || nodeGroup === 'All') && (
                      <h3 className="sticky top-0 z-10 border-y border-[#efeff2] bg-[#fafafd] px-5 py-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-[#93939d]">
                        {group}
                      </h3>
                    )}

                    {items.map(item => {
                      const actions = actionsFor(item)
                      const expanded = expandedType === item.type
                      const blocked = working || nodeLimitReached

                      return (
                        <div key={item.type} className="border-b border-[#f0f0f2]">
                          <button
                            type="button"
                            disabled={blocked}
                            aria-expanded={actions.length ? expanded : undefined}
                            title={item.description || item.label}
                            draggable={!blocked}
                            onDragStart={event => {
                              event.dataTransfer.setData('text/cliptora-node', item.type)
                              event.dataTransfer.effectAllowed = 'copy'
                            }}
                            onClick={() => {
                              if (actions.length) {
                                setExpandedType(expanded ? null : item.type)
                              } else {
                                add(item)
                              }
                            }}
                            className={`group flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[#f8f7fc] focus-visible:bg-[#f8f7fc] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45 ${
                              expanded ? 'bg-[#faf9ff]' : ''
                            }`}
                          >
                            <span className="flex size-10 shrink-0 items-center justify-center">
                              <WorkflowToolIcon type={item.type} size={29} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-semibold text-[#33333d]">
                                {item.label}
                              </span>
                              <span className="mt-0.5 block truncate text-[11px] leading-4 text-[#92929c]">
                                {item.description || (actions.length ? `${actions.length} available actions` : item.group)}
                              </span>
                            </span>
                            {actions.length ? (
                              <ChevronDown
                                size={16}
                                className={`shrink-0 text-[#aaaab3] transition-transform ${expanded ? 'rotate-180 text-[#7860ba]' : ''}`}
                              />
                            ) : (
                              <Plus size={16} className="shrink-0 text-[#aaaab3] group-hover:text-[#7257b6]" />
                            )}
                          </button>

                          {expanded && actions.length > 0 && (
                            <div className="border-t border-[#efedf5] bg-[#fbfaff] pb-2">
                              <div className="px-5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9c93b1]">
                                Available actions
                              </div>
                              {actions.map(action => (
                                <button
                                  key={action.id}
                                  type="button"
                                  disabled={blocked || action.disabled}
                                  title={action.reason || action.label}
                                  onClick={() => add(item, action.id)}
                                  className="group flex w-full items-center gap-2.5 py-2.5 pl-7 pr-5 text-left text-xs transition-colors hover:bg-[#f0ecfb] disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  <span className="flex size-7 shrink-0 items-center justify-center">
                                    <WorkflowToolIcon type={item.type} actionId={action.id} size={21} />
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-[#555461]">
                                    {action.label}
                                  </span>
                                  <ChevronRight size={14} className="shrink-0 text-[#b4a7d3] group-hover:text-[#7755b7]" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </section>
                ))}

                {!filtered.length && (
                  <div className="flex flex-col items-center px-7 py-12 text-center">
                    <span className="mb-3 flex size-11 items-center justify-center rounded-xl bg-[#f4f2fa] text-[#9c8ec1]">
                      <Search size={20} />
                    </span>
                    <p className="text-[13px] font-semibold text-[#4d4d57]">No matching nodes</p>
                    <p className="mt-1 text-[11px] leading-5 text-[#9696a0]">
                      Try another keyword or choose a different category.
                    </p>
                    <button
                      type="button"
                      onClick={backToCategories}
                      className="mt-4 rounded-lg border border-[#e5e0f0] px-3 py-2 text-[11px] font-semibold text-[#755ab3] hover:bg-[#f7f4ff]"
                    >
                      Browse categories
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'templates' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5 [scrollbar-width:thin]">
          {templatesFiltered.map(template => (
            <button
              key={template.key}
              type="button"
              disabled={working}
              onClick={() => {
                openTemplate(template)
                setLibraryOpen(false)
              }}
              className="group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-[#f7f6fc] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[#e8e4f3] bg-[#f4f0ff] text-[#7655bd]">
                <Layers3 size={21} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-[#35353e]">
                  {template.name}
                </span>
                <span className="mt-1 block text-[11px] leading-[17px] text-[#91919b]">
                  {template.description}
                </span>
              </span>
              <ChevronRight size={15} className="mt-2 shrink-0 text-[#b3b3be] group-hover:text-[#785abb]" />
            </button>
          ))}
          {!templatesFiltered.length && (
            <div className="flex flex-col items-center px-4 py-12 text-center text-[#9999a1]">
              <Sparkles size={25} className="mb-3 text-[#b0a0ce]" />
              <p className="text-xs">No matching templates.</p>
            </div>
          )}
        </div>
      )}

      {view === 'workflows' && (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5 [scrollbar-width:thin]">
          {workflowsFiltered.map(item => (
            <section
              key={item.id}
              className={`mb-1 rounded-xl transition-colors ${
                activeId === item.id ? 'bg-[#f7f4ff]' : 'hover:bg-[#f8f8fa]'
              }`}
            >
              <button
                type="button"
                disabled={working}
                onClick={() => openDefinition(item)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[#e9e5f2] bg-white text-[#755ab9]">
                  <Workflow size={21} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-[#35353e]">
                    {item.name}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[#9898a1]">
                    {item.nodes.length} nodes · Version {item.version || 1}
                  </span>
                </span>
                <ChevronRight size={15} className="text-[#b8b8bf]" />
              </button>

              {activeId === item.id && versions.length > 0 && (
                <div className="mx-3 border-t border-[#e8e1fa] pb-2 pt-2">
                  <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-[#9685b7]">
                    Version history
                  </p>
                  {versions.map(version => (
                    <div key={version.id} className="flex items-center justify-between gap-2 px-1 py-1.5 text-[11px]">
                      <span className="text-[#73717d]">v{version.version}</span>
                      <button
                        type="button"
                        disabled={working || version.version === item.version}
                        onClick={() => void restoreVersion(version.version)}
                        className="rounded-md border border-[#e8e0f6] bg-white px-2.5 py-1.5 font-semibold text-[#7659b5] hover:bg-[#f5f0ff] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
          {!workflowsFiltered.length && (
            <div className="flex flex-col items-center px-5 py-12 text-center text-[#9999a1]">
              <FolderOpen size={27} className="mb-3 text-[#b5a4d3]" />
              <p className="text-[12px] font-semibold text-[#666670]">No workflows found</p>
              <p className="mt-1 text-[11px]">Save a workflow to see it here.</p>
            </div>
          )}
        </div>
      )}

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[#efeff2] bg-[#fcfcfd] px-4 py-3 text-[10px] text-[#9999a3]">
        <span className="flex items-center gap-1.5">
          <GripVertical size={13} />
          {view === 'nodes'
            ? nodeLimitReached
              ? 'Maximum 100 nodes reached'
              : 'Drag nodes onto the canvas'
            : view === 'templates'
              ? `${templates.length} templates`
              : `${definitions.length} workflows`}
        </span>
        {view === 'nodes' && (
          <span className="shrink-0 rounded bg-[#f1eff8] px-2 py-1 font-semibold text-[#8b78ac]">
            {available.length} nodes
          </span>
        )}
      </footer>

      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label="Resize Tool Library"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        onPointerDown={startResize}
        onKeyDown={event => {
          const delta =
            event.key === 'ArrowRight' ? 15 : event.key === 'ArrowLeft' ? -15 : 0
          if (!delta) return
          event.preventDefault()
          setWidth(current => clamp(current + delta))
        }}
        className="absolute inset-y-0 -right-1.5 z-50 w-3 cursor-col-resize touch-none outline-none"
      >
        <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent transition-colors hover:bg-[#bda7eb]" />
      </div>
    </aside>
  )
}
