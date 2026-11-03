
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import {
  ChevronDown,
  ChevronLeft,
  FolderOpen,
  Layers3,
  Search,
  Workflow,
  X,
} from 'lucide-react'

import type { WorkflowCatalogItem } from './workflowTypes'
import type { WorkflowStudioState } from './useWorkflowStudio'
import { WorkflowToolIcon } from './WorkflowToolIcon'

type View = 'nodes' | 'templates' | 'workflows'

type SubNode = {
  id: string
  label: string
  icon?: string
  disabled: boolean
  reason?: string
}

const WIDTH_KEY = 'cliptora.workflow.libraryWidth'
const MIN_WIDTH = 270
const MAX_WIDTH = 550
const DEFAULT_WIDTH = 365

const clamp = (value: number) =>
  Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value))

function actionsFor(item: WorkflowCatalogItem): SubNode[] {
  return (item.actions ?? []).map(value => {
    const action = typeof value === 'string'
      ? value
      : String(value)

    const meta = item.action_capabilities?.[action]

    return {
      id: action,
      label: meta?.label ||
        action.replace(/_/g, ' ')
          .replace(/\b\w/g, s => s.toUpperCase()),
      disabled: meta?.status === 'unavailable',
      reason: meta?.reason,
    }
  })
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
  const [expandedType, setExpandedType] = useState<string | null>(null)

  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(WIDTH_KEY))
      return clamp(stored > 0 ? stored : DEFAULT_WIDTH)
    } catch {
      return DEFAULT_WIDTH
    }
  })

  const dragRef = useRef<{
    x: number
    width: number
  } | null>(null)

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragRef.current) return

      setWidth(clamp(
        dragRef.current.width +
        event.clientX -
        dragRef.current.x,
      ))
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
      // Private browsing may disable storage.
    }
  }, [width])

  const groups = useMemo(
    () => [
      ...new Set(
        catalog
          .filter(item => item.status === 'implemented')
          .map(item => item.group),
      ),
    ],
    [catalog],
  )

  const available = useMemo(
    () => catalog.filter(
      item =>
        item.status === 'implemented' &&
        !!item.backend_executor,
    ),
    [catalog],
  )

  const filtered = useMemo(
    () => available.filter(item => {
      if (
        nodeGroup !== 'All' &&
        item.group !== nodeGroup
      ) {
        return false
      }

      const needle = nodeSearch.trim().toLowerCase()

      if (!needle) return true

      return [
        item.label,
        item.type,
        item.group,
        ...actionsFor(item).flatMap(
          action => [action.id, action.label],
        ),
      ].some(
        text => text.toLowerCase().includes(needle),
      )
    }),
    [available, nodeGroup, nodeSearch],
  )

  const grouped = useMemo(() => {
    const byGroup = new Map<
      string,
      WorkflowCatalogItem[]
    >()

    for (const item of filtered) {
      byGroup.set(
        item.group,
        [
          ...(byGroup.get(item.group) || []),
          item,
        ],
      )
    }

    return [...byGroup.entries()]
  }, [filtered])

  const add = (
    item: WorkflowCatalogItem,
    actionId?: string,
  ) => {
    if (working || nodes.length >= 100) return

    const existingIds = new Set(
      nodes.map(node => node.id),
    )

    addNode(item.type)

    if (actionId) {
      const actionKey = Object.prototype.hasOwnProperty.call(
        item.settings,
        'action',
      )
        ? 'action'
        : 'operation'

      setNodesTransient(previous =>
        previous.map(node =>
          node.type === item.type &&
          !existingIds.has(node.id)
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

  const startResize = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return

    event.preventDefault()

    dragRef.current = {
      x: event.clientX,
      width,
    }

    document.body.style.userSelect = 'none'
  }

  const search = nodeSearch.trim().toLowerCase()

  return (
    <aside
      aria-label="Workflow node library"
      id="ws-tool-library"
      className="relative flex h-full min-h-0 shrink-0 flex-col border-r border-[#e5e7eb] bg-white text-[#222] shadow-sm"
      style={{ width }}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[#eee] px-4 py-3">
        <strong className="text-sm font-semibold">
          Workflow Library
        </strong>

        <button
          type="button"
          aria-label="Close library"
          title="Close library"
          className="rounded-md p-1.5 text-[#777] hover:bg-[#f4f4f5]"
          onClick={() => setLibraryOpen(false)}
        >
          <X size={18} />
        </button>
      </header>

      <nav
        aria-label="Library views"
        className="grid shrink-0 grid-cols-3 gap-1 border-b border-[#eee] p-2"
      >
        {(
          ['nodes', 'templates', 'workflows'] as const
        ).map(next => (
          <button
            key={next}
            type="button"
            onClick={() => {
              setView(next)
              setNodeSearch('')
            }}
            aria-pressed={view === next}
            className={`rounded-lg px-2 py-2 text-xs font-medium capitalize transition-colors ${
              view === next
                ? 'bg-[#252525] text-white'
                : 'text-[#737373] hover:bg-[#f4f4f5]'
            }`}
          >
            {next}
          </button>
        ))}
      </nav>

      <label className="mx-3 mt-3 flex h-10 shrink-0 items-center gap-2 rounded-lg border border-[#dedede] bg-white px-3 focus-within:border-violet-400">
        <Search
          size={17}
          className="shrink-0 text-[#888]"
        />

        <input
          ref={toolSearchRef}
          type="search"
          value={nodeSearch}
          placeholder={`Search ${view}...`}
          aria-label="Search workflow library"
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[#999]"
          onChange={event =>
            setNodeSearch(event.target.value)
          }
        />

        {nodeSearch && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setNodeSearch('')}
          >
            <X size={15} />
          </button>
        )}
      </label>

      {view === 'nodes' && (
        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#eee] px-3 pb-2 [scrollbar-width:thin]">
            {['All', ...groups].map(group => (
              <button
                type="button"
                key={group}
                onClick={() => setNodeGroup(group)}
                aria-pressed={nodeGroup === group}
                className={`shrink-0 rounded-full px-2.5 py-1.5 text-[11px] ${
                  nodeGroup === group
                    ? 'bg-[#282828] text-white'
                    : 'bg-[#f5f5f5] text-[#666] hover:bg-[#eee]'
                }`}
              >
                {group}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-5 [scrollbar-width:thin]">
            {grouped.map(([group, items]) => (
              <section key={group}>
                <h3 className="sticky top-0 z-10 border-b border-[#eee] bg-[#fafafa] px-4 py-2.5 text-[11px] font-semibold text-[#777]">
                  {group}
                </h3>

                {items.map(item => {
                  const actions = actionsFor(item)
                  const expanded =
                    expandedType === item.type

                  return (
                    <div
                      key={item.type}
                      className="border-b border-[#f0f0f0]"
                    >
                      <button
                        type="button"
                        disabled={working}
                        aria-expanded={
                          actions.length
                            ? expanded
                            : undefined
                        }
                        draggable={!working}
                        onDragStart={event => {
                          event.dataTransfer.setData(
                            'text/cliptora-node',
                            item.type,
                          )
                          event.dataTransfer.effectAllowed =
                            'copy'
                        }}
                        onClick={() =>
                          actions.length
                            ? setExpandedType(
                                expanded
                                  ? null
                                  : item.type,
                              )
                            : add(item)
                        }
                        className="group flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#f8f7fb] disabled:opacity-50"
                      >
                        <WorkflowToolIcon
                          type={item.type}
                          size={29}
                        />

                        <span className="min-w-0 flex-1">
                          <strong className="block truncate text-[13px] font-semibold">
                            {item.label}
                          </strong>

                          <span className="block truncate text-[10px] text-[#888]">
                            {actions.length
                              ? `${actions.length} actions · `
                              : ''}
                            {item.type}
                          </span>
                        </span>

                        {actions.length ? (
                          <ChevronDown
                            size={16}
                            className={`shrink-0 text-[#aaa] transition-transform ${
                              expanded
                                ? 'rotate-180'
                                : ''
                            }`}
                          />
                        ) : (
                          <ChevronLeft
                            size={16}
                            className="shrink-0 rotate-180 text-[#aaa]"
                          />
                        )}
                      </button>

                      {expanded && actions.length > 0 && (
                        <div className="bg-[#fbfbfd] pb-1">
                          {actions.map(action => (
                            <button
                              type="button"
                              key={action.id}
                              disabled={
                                working ||
                                action.disabled
                              }
                              title={
                                action.reason ||
                                action.label
                              }
                              onClick={() =>
                                add(item, action.id)
                              }
                              className="flex w-full items-center gap-3 py-2.5 pl-8 pr-3 text-left text-xs hover:bg-[#f0ecff] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <WorkflowToolIcon
                                type={item.type}
                                actionId={action.id}
                                size={23}
                              />

                              <span className="min-w-0 flex-1 truncate">
                                {action.label}
                              </span>
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
              <p className="p-6 text-center text-xs text-[#999]">
                No matching executable nodes.
              </p>
            )}
          </div>
        </div>
      )}

      {view === 'templates' && (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto p-3">
          {templates
            .filter(item =>
              `${item.name} ${item.description}`
                .toLowerCase()
                .includes(search),
            )
            .map(template => (
              <button
                type="button"
                key={template.key}
                disabled={working}
                onClick={() => {
                  openTemplate(template)
                  setLibraryOpen(false)
                }}
                className="mb-2 flex w-full items-start gap-3 rounded-lg border border-[#e9e9ed] p-3 text-left hover:border-violet-300 hover:bg-[#faf7ff] disabled:opacity-50"
              >
                <Layers3
                  size={20}
                  className="shrink-0 text-violet-500"
                />

                <span className="min-w-0">
                  <strong className="block text-xs">
                    {template.name}
                  </strong>

                  <span className="mt-1 block text-[11px] leading-4 text-[#777]">
                    {template.description}
                  </span>
                </span>
              </button>
            ))}

          {!templates.length && (
            <p className="p-4 text-center text-xs text-[#999]">
              No templates available.
            </p>
          )}
        </div>
      )}

      {view === 'workflows' && (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto p-3">
          {definitions
            .filter(item =>
              item.name
                .toLowerCase()
                .includes(search),
            )
            .map(item => (
              <section
                key={item.id}
                className={`mb-2 rounded-lg border p-2.5 ${
                  activeId === item.id
                    ? 'border-violet-300 bg-violet-50/40'
                    : 'border-[#e9e9ed]'
                }`}
              >
                <button
                  type="button"
                  disabled={working}
                  onClick={() =>
                    openDefinition(item)
                  }
                  className="flex w-full items-start gap-2.5 text-left disabled:opacity-50"
                >
                  <Workflow
                    size={19}
                    className="shrink-0 text-violet-500"
                  />

                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-xs">
                      {item.name}
                    </strong>

                    <span className="mt-0.5 block text-[10px] text-[#777]">
                      {item.nodes.length} nodes · v
                      {item.version || 1}
                    </span>
                  </span>
                </button>

                {activeId === item.id &&
                  versions.length > 0 && (
                    <div className="mt-3 border-t border-[#e9e3fa] pt-2">
                      <p className="mb-2 text-[10px] font-semibold text-[#777]">
                        Version History
                      </p>

                      {versions.map(version => (
                        <div
                          key={version.id}
                          className="flex items-center justify-between gap-2 py-1 text-[11px]"
                        >
                          <span>
                            v{version.version}
                          </span>

                          <button
                            type="button"
                            disabled={
                              working ||
                              version.version ===
                                item.version
                            }
                            onClick={() =>
                              void restoreVersion(
                                version.version,
                              )
                            }
                            className="rounded-md border border-[#ddd] px-2 py-1 text-violet-600 hover:bg-white disabled:opacity-40"
                          >
                            Restore
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
              </section>
            ))}

          {!definitions.length && (
            <div className="grid justify-items-center gap-2 p-6 text-center text-[#999]">
              <FolderOpen size={27} />

              <p className="text-xs">
                No workflows saved in this project.
              </p>
            </div>
          )}
        </div>
      )}

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
            event.key === 'ArrowRight'
              ? 15
              : event.key === 'ArrowLeft'
                ? -15
                : 0

          if (!delta) return

          event.preventDefault()

          setWidth(current =>
            clamp(current + delta),
          )
        }}
        className="absolute inset-y-0 -right-1.5 z-50 w-3 cursor-col-resize touch-none outline-none"
      >
        <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent hover:bg-violet-300" />
      </div>
    </aside>
  )
}
