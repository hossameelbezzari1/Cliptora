import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft,
  ChevronRight,
  FolderOpen,
  GripVertical,
  Layers3,
  ListFilter,
  Search,
  Star,
  Workflow,
  X,
  Zap,
} from 'lucide-react'

import type { WorkflowCatalogItem } from './workflowTypes'
import type { WorkflowStudioState } from './useWorkflowStudio'
import { WorkflowToolIcon } from './WorkflowToolIcon'

type View = 'nodes' | 'templates' | 'workflows'
type Mode = 'actions' | 'triggers'
type SubNode = {
  id: string
  label: string
  description: string
  disabled: boolean
  reason?: string
}
type Provider = {
  key: string
  label: string
  items: WorkflowCatalogItem[]
}
type FlyoutPosition = { left: number; top: number }

const WIDTH_KEY = 'cliptora.workflow.libraryWidth'
const FAV_KEY = 'cliptora.workflow.favoriteProviders'
const MIN_WIDTH = 350
const MAX_WIDTH = 600
const DEFAULT_WIDTH = 520
const clamp = (value: number) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value))

const triggerNode = (item: WorkflowCatalogItem): boolean =>
  /(^|[._-])(trigger|webhook|schedule|cron)([._-]|$)/i.test(item.type) ||
  item.type === 'core.video_source' ||
  /\btriggers?\b/i.test(item.group)

function providerInfo(item: WorkflowCatalogItem): { key: string; label: string } {
  if (['ai.openai', 'ai.agent', 'ai.chat_model'].includes(item.type)) {
    return { key: 'openai', label: 'OpenAI' }
  }
  if (item.type === 'ai.gemini') return { key: 'gemini', label: 'Google Gemini' }
  if (item.type === 'ai.ollama') return { key: 'ollama', label: 'Ollama' }
  if (triggerNode(item)) return { key: item.type, label: item.label }

  const prefixes: Record<string, string> = {
    'flow.': 'Logic',
    'audio.': 'Audio',
    'media.': 'Media',
    'animation.': 'Animation',
    'timeline.': 'Timeline',
    'caption.': 'Captions',
    'video.': 'Video',
    'data.': 'Data',
    'integration.': 'Integrations',
  }
  const match = Object.entries(prefixes).find(([prefix]) => item.type.startsWith(prefix))
  const label = match?.[1] ?? item.group ?? item.label
  return { key: `group:${label}`, label }
}

function actionsFor(item: WorkflowCatalogItem): SubNode[] {
  const rawActions: unknown[] = Array.isArray(item.actions) ? item.actions : []
  const actions = rawActions.flatMap((raw): string[] => {
    if (typeof raw === 'string') return [raw]
    if (raw && typeof raw === 'object' && 'id' in raw && typeof raw.id === 'string') {
      return [raw.id]
    }
    return []
  })
  if (!actions.length) {
    return [{
      id: '',
      label: item.label,
      description: item.description || item.group,
      disabled: false,
    }]
  }
  return actions.map(id => {
    const meta = item.action_capabilities?.[id]
    const label = meta?.label || id.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
    return {
      id,
      label,
      description: item.description || `Use ${item.label} to ${label.toLowerCase()}.`,
      disabled: meta?.status === 'unavailable',
      reason: meta?.reason,
    }
  })
}

function makeProviders(items: WorkflowCatalogItem[]): Provider[] {
  const map = new Map<string, Provider>()
  for (const item of items) {
    const info = providerInfo(item)
    const existing = map.get(info.key)
    if (existing) existing.items.push(item)
    else map.set(info.key, { ...info, items: [item] })
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label))
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
  const [mode, setMode] = useState<Mode>('actions')
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [actionSearch, setActionSearch] = useState('')
  const [flyoutPosition, setFlyoutPosition] = useState<FlyoutPosition | null>(null)
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(FAV_KEY) || 'null')
      if (Array.isArray(saved)) return saved.filter((value): value is string => typeof value === 'string')
    } catch { /* Defaults below. */ }
    return ['openai', 'gemini']
  })
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY))
      return clamp(saved > 0 ? saved : DEFAULT_WIDTH)
    } catch { return DEFAULT_WIDTH }
  })

  const dragRef = useRef<{ x: number; width: number } | null>(null)
  const anchorRef = useRef<HTMLButtonElement | null>(null)

  const setPosition = useCallback((anchor: HTMLButtonElement) => {
    const rect = anchor.getBoundingClientRect()
    const panelWidth = Math.min(480, window.innerWidth - 24)
    const roomOnRight = window.innerWidth - rect.right
    const left = roomOnRight >= panelWidth + 12
      ? rect.right + 8
      : Math.max(12, window.innerWidth - panelWidth - 12)
    const top = Math.min(Math.max(12, rect.top - 5), Math.max(12, window.innerHeight - 340))
    setFlyoutPosition({ left, top })
  }, [])

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (dragRef.current) {
        setWidth(clamp(dragRef.current.width + event.clientX - dragRef.current.x))
      }
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
    try { localStorage.setItem(WIDTH_KEY, String(width)) } catch { /* Ignore */ }
  }, [width])

  useEffect(() => {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(favorites)) } catch { /* Ignore */ }
  }, [favorites])

  useEffect(() => {
    if (!selectedProvider) return
    const update = () => {
      if (anchorRef.current?.isConnected) setPosition(anchorRef.current)
      else setSelectedProvider(null)
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [selectedProvider, setPosition])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedProvider(null)
        setFilterOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const available = useMemo(
    () => catalog.filter(item => item.status === 'implemented' && Boolean(item.backend_executor)),
    [catalog],
  )
  const categories = useMemo(() => [...new Set(available.map(item => item.group))].sort(), [available])

  const providers = useMemo(() => {
    const search = nodeSearch.trim().toLowerCase()
    return makeProviders(available.filter(item => {
      if (mode === 'triggers' ? !triggerNode(item) : triggerNode(item)) return false
      if (nodeGroup !== 'All' && item.group !== nodeGroup) return false
      if (!search) return true
      return [
        providerInfo(item).label,
        item.label,
        item.type,
        item.group,
        item.description ?? '',
        ...actionsFor(item).map(action => action.label),
      ].some(value => value.toLowerCase().includes(search))
    }))
  }, [available, mode, nodeGroup, nodeSearch])

  const favoriteProviders = providers.filter(provider => favorites.includes(provider.key))
  const currentProvider = providers.find(provider => provider.key === selectedProvider) ?? null
  const actionItems = useMemo(() => {
    if (!currentProvider) return []
    const search = actionSearch.trim().toLowerCase()
    return currentProvider.items.flatMap(item =>
      actionsFor(item).map(action => ({ item, action })),
    ).filter(({ item, action }) =>
      !search || `${item.label} ${action.label} ${action.description}`.toLowerCase().includes(search),
    )
  }, [currentProvider, actionSearch])

  const showProvider = (key: string, event: ReactMouseEvent<HTMLButtonElement>) => {
    anchorRef.current = event.currentTarget
    setPosition(event.currentTarget)
    if (key !== selectedProvider) setActionSearch('')
    setSelectedProvider(key)
    setFilterOpen(false)
  }

  const toggleFavorite = (key: string) => {
    setFavorites(previous => previous.includes(key)
      ? previous.filter(value => value !== key)
      : [...previous, key])
  }

  const changeMode = (next: Mode) => {
    setMode(next)
    setSelectedProvider(null)
    setActionSearch('')
    setNodeSearch('')
    setNodeGroup('All')
    setFilterOpen(false)
  }

  const changeView = (next: View) => {
    setView(next)
    setNodeSearch('')
    setNodeGroup('All')
    setSelectedProvider(null)
    setFilterOpen(false)
  }

  const add = (item: WorkflowCatalogItem, actionId?: string) => {
    if (working || nodes.length >= 100) return
    const existingIds = new Set(nodes.map(node => node.id))
    addNode(item.type)
    if (actionId) {
      const actionKey = Object.prototype.hasOwnProperty.call(item.settings, 'action')
        ? 'action'
        : 'operation'
      setNodesTransient(previous => previous.map(node =>
        node.type === item.type && !existingIds.has(node.id)
          ? { ...node, settings: { ...node.settings, [actionKey]: actionId } }
          : node,
      ))
    }
    setSelectedProvider(null)
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
    `${item.name} ${item.description}`.toLowerCase().includes(nodeSearch.toLowerCase()),
  )
  const workflowsFiltered = definitions.filter(item =>
    item.name.toLowerCase().includes(nodeSearch.toLowerCase()),
  )
  const blocked = working || nodes.length >= 100

  const providerRow = (provider: Provider, favorite = false) => (
    <div key={`${favorite ? 'fav' : 'all'}:${provider.key}`} className="group flex items-center pr-2">
      <button
        type="button"
        onMouseEnter={event => showProvider(provider.key, event)}
        onClick={event => showProvider(provider.key, event)}
        disabled={working}
        draggable={!working && !blocked && provider.items.length === 1}
        onDragStart={event => {
          if (provider.items.length === 1) {
            event.dataTransfer.setData('text/cliptora-node', provider.items[0].type)
            event.dataTransfer.effectAllowed = 'copy'
          }
        }}
        className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl px-4 py-2.5 text-left transition-colors hover:bg-[#f5f5f5] disabled:opacity-45 ${selectedProvider === provider.key ? 'bg-[#f5f5f5]' : ''}`}
      >
        <span className="grid size-9 shrink-0 place-items-center">
          <WorkflowToolIcon type={provider.items[0].type} size={27} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[16px] font-medium text-[#222]">{provider.label}</span>
        <ChevronRight size={17} className="shrink-0 text-[#b8b8b8]" />
      </button>
      <button
        type="button"
        title={favorites.includes(provider.key) ? 'Remove from favorites' : 'Add to favorites'}
        aria-label={favorites.includes(provider.key) ? `Unfavorite ${provider.label}` : `Favorite ${provider.label}`}
        onClick={() => toggleFavorite(provider.key)}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-[#aaa] opacity-0 transition hover:text-amber-500 focus:opacity-100 group-hover:opacity-100"
      >
        <Star size={17} fill={favorites.includes(provider.key) ? 'currentColor' : 'none'} />
      </button>
    </div>
  )

  return (
    <>
      <aside
        id="ws-tool-library"
        aria-label="Add Node"
        className="absolute left-4 top-4 z-[90] flex h-fit min-h-0 flex-col overflow-visible rounded-[24px] border border-[#e2e2e2] bg-white text-[#242424] shadow-[0_9px_30px_rgba(0,0,0,0.09)]"
        style={{ width, maxWidth: 'calc(100% - 96px)', maxHeight: 'calc(100% - 32px)' }}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 px-5 pb-3 pt-5">
          <h2 className="min-w-0 truncate text-[23px] font-semibold tracking-[-0.035em]">
            {view === 'nodes' ? 'Add Node' : view === 'templates' ? 'Templates' : 'Workflows'}
          </h2>
          {view === 'nodes' ? (
            <div className="flex shrink-0 items-center gap-1">
              <div className="flex rounded-xl border border-[#dedede] bg-[#f7f7f7] p-0.5">
                {(['actions', 'triggers'] as const).map(value => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    onClick={() => changeMode(value)}
                    className={`rounded-[10px] px-3.5 py-2 text-[14px] font-medium transition-colors ${mode === value ? 'bg-white text-[#202020] shadow-[0_1px_4px_#00000014]' : 'text-[#444] hover:text-black'}`}
                  >
                    {value === 'actions' ? 'Actions' : 'Triggers'}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setLibraryOpen(false)} title="Close" aria-label="Close Add Node" className="ml-1 grid size-8 place-items-center rounded-lg text-[#999] hover:bg-[#f5f5f5] hover:text-[#222]">
                <X size={18} />
              </button>
            </div>
          ) : (
            <div className="flex gap-1">
              <button type="button" onClick={() => changeView('nodes')} className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-[#666] hover:bg-[#f7f7f7]">
                <ArrowLeft size={16} /> Nodes
              </button>
              <button type="button" onClick={() => setLibraryOpen(false)} title="Close" aria-label="Close Add Node" className="grid size-8 place-items-center rounded-lg text-[#999] hover:bg-[#f5f5f5]">
                <X size={18} />
              </button>
            </div>
          )}
        </header>

        <div className="relative mx-3 mb-2 flex shrink-0 items-center gap-2 rounded-2xl bg-[#f6f6f6] px-4 py-3">
          <Search size={22} className="shrink-0 text-[#969696]" />
          <input
            ref={toolSearchRef}
            type="search"
            autoComplete="off"
            value={nodeSearch}
            onChange={event => { setNodeSearch(event.target.value); setSelectedProvider(null) }}
            placeholder={view === 'nodes' ? 'Search Apps' : `Search ${view}`}
            className="min-w-0 flex-1 bg-transparent text-[16px] text-[#222] outline-none placeholder:text-[#999]"
          />
          {view === 'nodes' && (
            <button type="button" title="Filter categories" aria-label="Filter categories" aria-expanded={filterOpen} onClick={() => setFilterOpen(value => !value)} className="grid size-8 shrink-0 place-items-center rounded-lg text-[#888] hover:text-[#333]">
              <ListFilter size={21} />
            </button>
          )}
        </div>

        {view === 'nodes' && filterOpen && (
          <div className="mx-4 mb-2 max-h-32 shrink-0 overflow-y-auto rounded-xl border border-[#eee] p-1.5">
            {['All', ...categories].map(group => (
              <button key={group} type="button" onClick={() => { setNodeGroup(group); setSelectedProvider(null); setFilterOpen(false) }} className={`block w-full rounded-lg px-3 py-1.5 text-left text-[12px] hover:bg-[#f4f4f4] ${nodeGroup === group ? 'font-semibold text-[#222]' : 'text-[#777]'}`}>
                {group}
              </button>
            ))}
          </div>
        )}

        {view === 'nodes' && (
          <div className="min-h-0 overflow-y-auto px-2 pb-3 [scrollbar-width:thin]">
            {favoriteProviders.length > 0 && (
              <section className="mb-3">
                <h3 className="px-3 pb-2 pt-2 text-[15px] font-medium text-[#777]">Favorites</h3>
                {favoriteProviders.map(provider => providerRow(provider, true))}
              </section>
            )}
            <section>
              <h3 className="px-3 pb-2 pt-2 text-[15px] font-medium text-[#777]">All App/Providers</h3>
              {providers.map(provider => providerRow(provider))}
              {!providers.length && (
                <p className="px-4 py-7 text-center text-sm text-[#999]">No available {mode} found.</p>
              )}
            </section>
          </div>
        )}

        {view === 'templates' && (
          <div className="min-h-0 overflow-y-auto px-3 pb-4 [scrollbar-width:thin]">
            {templatesFiltered.map(template => (
              <button key={template.key} type="button" disabled={working} onClick={() => { openTemplate(template); setLibraryOpen(false) }} className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-[#f6f6f6] disabled:opacity-40">
                <Layers3 size={22} className="mt-0.5 shrink-0 text-[#7956ba]" />
                <span className="min-w-0 flex-1"><strong className="block truncate text-[14px]">{template.name}</strong><span className="mt-1 block text-[12px] text-[#888]">{template.description}</span></span>
              </button>
            ))}
            {!templatesFiltered.length && <p className="p-5 text-center text-sm text-[#999]">No matching templates.</p>}
          </div>
        )}

        {view === 'workflows' && (
          <div className="min-h-0 overflow-y-auto px-3 pb-4 [scrollbar-width:thin]">
            {workflowsFiltered.map(item => (
              <div key={item.id}>
                <button type="button" disabled={working} onClick={() => openDefinition(item)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-[#f6f6f6] disabled:opacity-40 ${activeId === item.id ? 'bg-[#f7f5fb]' : ''}`}>
                  <Workflow size={22} className="shrink-0 text-[#7956ba]" />
                  <span className="min-w-0 flex-1"><strong className="block truncate text-[14px]">{item.name}</strong><span className="block text-[12px] text-[#999]">{item.nodes.length} nodes · v{item.version || 1}</span></span>
                  <ChevronRight size={17} className="text-[#bbb]" />
                </button>
                {activeId === item.id && versions.length > 0 && (
                  <div className="ml-10 border-l border-[#eee] pl-3">
                    {versions.map(version => (
                      <div key={version.id} className="flex items-center justify-between py-1.5 text-xs text-[#777]">
                        <span>Version {version.version}</span>
                        <button type="button" disabled={working || version.version === item.version} onClick={() => void restoreVersion(version.version)} className="rounded-md px-2 py-1 text-[#7453b7] hover:bg-[#f5f1fb] disabled:opacity-40">Restore</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {!workflowsFiltered.length && <p className="flex items-center justify-center gap-2 p-5 text-sm text-[#999]"><FolderOpen size={18} /> No workflows found.</p>}
          </div>
        )}

        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-[#f1f1f1] px-5 py-3 text-[12px] text-[#999]">
          <div className="flex items-center gap-2">
            {view === 'nodes' ? (
              <><Zap size={14} /> {nodes.length >= 100 ? 'Maximum 100 nodes' : 'Select an app to see its actions'}</>
            ) : view === 'templates' ? (
              <><Layers3 size={14} /> {templates.length} templates</>
            ) : (
              <><Workflow size={14} /> {definitions.length} workflows</>
            )}
          </div>
          <div className="flex items-center gap-2 font-medium">
            {view !== 'nodes' && <button type="button" onClick={() => changeView('nodes')} className="hover:text-[#444]">Nodes</button>}
            {view !== 'templates' && <button type="button" onClick={() => changeView('templates')} className="hover:text-[#444]">Templates</button>}
            {view !== 'workflows' && <button type="button" onClick={() => changeView('workflows')} className="hover:text-[#444]">Workflows</button>}
          </div>
        </footer>

        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize Add Node"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={width}
          onPointerDown={startResize}
          onKeyDown={event => {
            const delta = event.key === 'ArrowRight' ? 15 : event.key === 'ArrowLeft' ? -15 : 0
            if (delta) { event.preventDefault(); setWidth(current => clamp(current + delta)) }
          }}
          className="absolute inset-y-0 -right-1.5 z-50 w-3 cursor-col-resize touch-none outline-none"
        >
          <GripVertical size={15} className="absolute left-0 top-1/2 -translate-y-1/2 text-transparent hover:text-[#aaa]" />
        </div>
      </aside>

      {view === 'nodes' && currentProvider && flyoutPosition && createPortal(
        <div
          role="dialog"
          aria-label={`${currentProvider.label} actions`}
          className="fixed z-[9999] flex w-[480px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[22px] border border-[#e2e2e2] bg-white shadow-[0_12px_36px_#00000019]"
          style={{ left: flyoutPosition.left, top: flyoutPosition.top, maxHeight: 'min(610px, calc(100dvh - 24px))' }}
        >
          <div className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-4">
            <label className="flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-[#f7f7f7] px-3 py-3">
              <Search size={21} className="shrink-0 text-[#999]" />
              <input
                type="search"
                autoFocus
                value={actionSearch}
                onChange={event => setActionSearch(event.target.value)}
                placeholder="Search Actions"
                className="min-w-0 flex-1 bg-transparent text-[15px] text-[#222] outline-none placeholder:text-[#999]"
              />
            </label>
            <button type="button" title="Close actions" aria-label="Close actions" onClick={() => setSelectedProvider(null)} className="grid size-8 shrink-0 place-items-center rounded-lg text-[#aaa] hover:bg-[#f4f4f4] hover:text-[#333]">
              <X size={17} />
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto px-2 pb-3 pt-1 [scrollbar-width:thin]">
            {actionItems.map(({ item, action }) => (
              <button
                key={`${item.type}:${action.id || 'default'}`}
                type="button"
                disabled={blocked || action.disabled}
                draggable={!blocked && !action.disabled && !action.id}
                onDragStart={event => {
                  event.dataTransfer.setData('text/cliptora-node', item.type)
                  event.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => add(item, action.id || undefined)}
                title={action.reason || action.label}
                className="group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-[#f5f5f5] focus-visible:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center">
                  <WorkflowToolIcon type={item.type} actionId={action.id || undefined} size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium leading-6 text-[#222]">{action.label}</span>
                  <span className="mt-0.5 block text-[12px] leading-[18px] text-[#999]">{action.reason || action.description}</span>
                </span>
              </button>
            ))}
            {!actionItems.length && <p className="px-4 py-8 text-center text-sm text-[#999]">No matching actions.</p>}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
