
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronRight,
  GripVertical,
  Layers3,
  ListFilter,
  Plus,
  Search,
  Star,
  Workflow,
  X,
  Zap,
} from 'lucide-react'

import type {
  WorkflowCatalogItem,
  WorkflowDefinition,
} from './workflowTypes'
import type { WorkflowStudioState } from './useWorkflowStudio'
import { WorkflowToolIcon } from './WorkflowToolIcon'

type View = 'nodes' | 'templates' | 'discover'

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

type FlyoutPosition = {
  left: number
  top: number
  maxHeight: number
}

const WIDTH_KEY = 'cliptora.workflow.libraryWidth'
const FAVORITES_KEY = 'cliptora.workflow.favoriteProviders'
const SAVED_TEMPLATES_KEY = 'cliptora.workflow.savedTemplateIds'

const MIN_WIDTH = 320
const MAX_WIDTH = 540
const DEFAULT_WIDTH = 440

const clamp = (n: number) =>
  Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, n))

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function triggerNode(item: WorkflowCatalogItem): boolean {
  return (
    /(^|[._-])(trigger|webhook|schedule|cron)([._-]|$)/i.test(
      item.type,
    ) ||
    item.type === 'core.video_source' ||
    /\btriggers?\b/i.test(item.group)
  )
}

function providerInfo(
  item: WorkflowCatalogItem,
): { key: string; label: string } {
  if (
    ['ai.openai', 'ai.agent', 'ai.chat_model'].includes(
      item.type,
    )
  ) {
    return { key: 'openai', label: 'OpenAI' }
  }

  if (item.type === 'ai.gemini') {
    return { key: 'gemini', label: 'Google Gemini' }
  }

  if (item.type === 'ai.ollama') {
    return { key: 'ollama', label: 'Ollama' }
  }

  if (triggerNode(item)) {
    return { key: item.type, label: item.label }
  }

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

  const found = Object.entries(prefixes).find(
    ([prefix]) => item.type.startsWith(prefix),
  )

  const label = found?.[1] ?? item.group ?? item.label

  return {
    key: `group:${label}`,
    label,
  }
}

function actionsFor(
  item: WorkflowCatalogItem,
): SubNode[] {
  const raw: unknown[] = Array.isArray(item.actions)
    ? item.actions
    : []

  const actions = raw.flatMap(
    (value): { id: string; label?: string }[] => {
      if (typeof value === 'string') {
        return [{ id: value }]
      }

      if (
        value &&
        typeof value === 'object' &&
        'id' in value &&
        typeof value.id === 'string'
      ) {
        const label =
          'label' in value &&
          typeof value.label === 'string'
            ? value.label
            : undefined

        return [{
          id: value.id,
          label,
        }]
      }

      return []
    },
  )

  if (!actions.length) {
    return [{
      id: '',
      label: item.label,
      description: item.description || item.group,
      disabled: false,
    }]
  }

  return actions.map(action => {
    const meta = item.action_capabilities?.[action.id]

    const label =
      meta?.label ||
      action.label ||
      action.id
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())

    return {
      id: action.id,
      label,
      description:
        item.description ||
        `Use ${item.label} to ${label.toLowerCase()}.`,
      disabled: meta?.status === 'unavailable',
      reason: meta?.reason,
    }
  })
}

function makeProviders(
  items: WorkflowCatalogItem[],
): Provider[] {
  const grouped = new Map<string, Provider>()

  for (const item of items) {
    const info = providerInfo(item)
    const group = grouped.get(info.key)

    if (group) {
      group.items.push(item)
    } else {
      grouped.set(info.key, {
        ...info,
        items: [item],
      })
    }
  }

  return [...grouped.values()].sort((a, b) =>
    a.label.localeCompare(b.label),
  )
}

export function ToolLibrary({
  studio,
  onOpenNode,
}: {
  studio: WorkflowStudioState
  onOpenNode?: () => void
}) {
  const {
    projectId,
    catalog,
    templates,
    definitions,
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
    save,
    setMessage,
  } = studio

  const [view, setView] = useState<View>('nodes')


  const [filterOpen, setFilterOpen] = useState(false)

  const [selectedProvider, setSelectedProvider] =
    useState<string | null>(null)

  const [actionSearch, setActionSearch] = useState('')

  const [flyoutPosition, setFlyoutPosition] =
    useState<FlyoutPosition | null>(null)

  const [favorites, setFavorites] = useState<string[]>(() => {
    const result = readStorage<unknown>(
      FAVORITES_KEY,
      ['openai', 'gemini'],
    )

    return Array.isArray(result)
      ? result.filter(
          (v): v is string => typeof v === 'string',
        )
      : ['openai', 'gemini']
  })

  const [savedTemplateIds, setSavedTemplateIds] =
    useState<Record<string, number[]>>(() => {
      const result = readStorage<unknown>(
        SAVED_TEMPLATES_KEY,
        {},
      )

      if (
        !result ||
        typeof result !== 'object' ||
        Array.isArray(result)
      ) {
        return {}
      }

      const valid: Record<string, number[]> = {}

      for (const [key, value] of Object.entries(result)) {
        if (Array.isArray(value)) {
          valid[key] = value.filter(
            (id): id is number =>
              Number.isSafeInteger(id) && id > 0,
          )
        }
      }

      return valid
    })

  const [width, setWidth] = useState(() => {
    const saved = Number(
      readStorage<unknown>(WIDTH_KEY, DEFAULT_WIDTH),
    )

    return clamp(
      Number.isFinite(saved) && saved > 0
        ? saved
        : DEFAULT_WIDTH,
    )
  })

  const [savingTemplate, setSavingTemplate] =
    useState(false)

  const dragRef = useRef<{
    x: number
    width: number
  } | null>(null)

  const anchorRef =
    useRef<HTMLButtonElement | null>(null)

  const flyoutRef =
    useRef<HTMLDivElement | null>(null)

  const projectKey = String(projectId)

  const pinnedIds =
    savedTemplateIds[projectKey] ?? []

  const savedDefinitions = definitions.filter(
    item => pinnedIds.includes(item.id),
  )

  useEffect(() => {
    try {
      localStorage.setItem(
        WIDTH_KEY,
        JSON.stringify(width),
      )
    } catch {
      // Browser storage unavailable.
    }
  }, [width])

  useEffect(() => {
    try {
      localStorage.setItem(
        FAVORITES_KEY,
        JSON.stringify(favorites),
      )
    } catch {
      // Browser storage unavailable.
    }
  }, [favorites])

  useEffect(() => {
    try {
      localStorage.setItem(
        SAVED_TEMPLATES_KEY,
        JSON.stringify(savedTemplateIds),
      )
    } catch {
      // Browser storage unavailable.
    }
  }, [savedTemplateIds])

  const setPosition = useCallback(
    (anchor: HTMLButtonElement) => {
      const rect = anchor.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const panelWidth = Math.min(400, viewportWidth - 32)

      const spaceRight = viewportWidth - rect.right
      const spaceLeft = rect.left

      const left =
        spaceRight >= panelWidth + 12
          ? rect.right + 8
          : spaceLeft >= panelWidth + 12
            ? rect.left - panelWidth - 8
            : Math.max(16, viewportWidth - panelWidth - 16)

      const desiredHeight = Math.min(
        490,
        viewportHeight - 32,
      )

      const top = Math.max(
        16,
        Math.min(
          rect.top - 8,
          viewportHeight - desiredHeight - 16,
        ),
      )

      const maxHeight = Math.max(
        150,
        Math.min(490, viewportHeight - top - 16),
      )

      setFlyoutPosition({
        left,
        top,
        maxHeight,
      })
    },
    [],
  )

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (dragRef.current) {
        setWidth(
          clamp(
            dragRef.current.width +
            event.clientX -
            dragRef.current.x,
          ),
        )
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
    if (!selectedProvider) return

    const update = () => {
      if (anchorRef.current?.isConnected) {
        setPosition(anchorRef.current)
      } else {
        setSelectedProvider(null)
      }
    }

    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)

    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [selectedProvider, setPosition])

  useEffect(() => {
    if (!selectedProvider) return

    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node | null

      if (
        !target ||
        flyoutRef.current?.contains(target) ||
        anchorRef.current?.contains(target)
      ) {
        return
      }

      setSelectedProvider(null)
      setActionSearch('')
    }

    document.addEventListener(
      'pointerdown',
      closeOutside,
      true,
    )

    return () => {
      document.removeEventListener(
        'pointerdown',
        closeOutside,
        true,
      )
    }
  }, [selectedProvider])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedProvider(null)
        setFilterOpen(false)
      }
    }

    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const available = useMemo(
    () =>
      catalog.filter(
        item =>
          item.status === 'implemented' &&
          Boolean(item.backend_executor),
      ),
    [catalog],
  )

  const categories = useMemo(
    () => [
      ...new Set(available.map(item => item.group)),
    ].sort(),
    [available],
  )

  const providers = useMemo(() => {
    const search = nodeSearch.trim().toLowerCase()

    return makeProviders(
      available.filter(item => {


        if (
          nodeGroup !== 'All' &&
          item.group !== nodeGroup
        ) {
          return false
        }

        if (!search) return true

        return [
          providerInfo(item).label,
          item.label,
          item.type,
          item.group,
          item.description ?? '',
          ...actionsFor(item).map(
            action => action.label,
          ),
        ].some(value =>
          value.toLowerCase().includes(search),
        )
      }),
    )
  }, [available, nodeGroup, nodeSearch])

  const favoriteProviders = providers.filter(
    provider => favorites.includes(provider.key),
  )

  const actionProviders = providers.filter(
    provider =>
      provider.items.some(
        item => !triggerNode(item),
      ),
  )

  const triggerProviders = providers.filter(
    provider =>
      provider.items.every(triggerNode),
  )

  const currentProvider =
    providers.find(
      provider => provider.key === selectedProvider,
    ) ?? null

  const allActionItems = useMemo(
    () =>
      currentProvider
        ? currentProvider.items.flatMap(item =>
            actionsFor(item).map(action => ({
              item,
              action,
            })),
          )
        : [],
    [currentProvider],
  )

  const showActionSearch =
    allActionItems.length > 3

  const actionItems = allActionItems.filter(
    ({ item, action }) =>
      !actionSearch.trim() ||
      `${item.label} ${action.label} ${action.description}`
        .toLowerCase()
        .includes(actionSearch.trim().toLowerCase()),
  )

  const filteredDefinitions = definitions.filter(
    item =>
      `${item.name} ${item.nodes.length}`
        .toLowerCase()
        .includes(nodeSearch.toLowerCase()),
  )

  const filteredTemplates = templates.filter(
    item =>
      `${item.name} ${item.description}`
        .toLowerCase()
        .includes(nodeSearch.toLowerCase()),
  )

  const filteredSavedDefinitions =
    savedDefinitions.filter(item =>
      item.name
        .toLowerCase()
        .includes(nodeSearch.toLowerCase()),
    )

  const blocked =
    working || savingTemplate || nodes.length >= 100

  const changeView = (next: View) => {
    setView(next)
    setNodeSearch('')
    setNodeGroup('All')
    setSelectedProvider(null)
    setActionSearch('')
    setFilterOpen(false)
  }

  const showProvider = (
    key: string,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    anchorRef.current = event.currentTarget
    setPosition(event.currentTarget)

    if (key !== selectedProvider) {
      setActionSearch('')
    }

    setSelectedProvider(key)
    setFilterOpen(false)
  }

  const toggleFavorite = (key: string) => {
    setFavorites(previous =>
      previous.includes(key)
        ? previous.filter(value => value !== key)
        : [...previous, key],
    )
  }

  const toggleSavedTemplate = (id: number) => {
    setSavedTemplateIds(previous => {
      const ids = previous[projectKey] ?? []

      return {
        ...previous,
        [projectKey]: ids.includes(id)
          ? ids.filter(value => value !== id)
          : [...ids, id],
      }
    })
  }

  const saveCurrentAsTemplate = async () => {
    if (
      working ||
      savingTemplate ||
      !nodes.length ||
      !studio.name.trim()
    ) {
      return
    }

    setSavingTemplate(true)

    try {
      const definition = await save(false)

      if (!definition) return

      setSavedTemplateIds(previous => ({
        ...previous,
        [projectKey]: [
          ...new Set([
            ...(previous[projectKey] ?? []),
            definition.id,
          ]),
        ],
      }))

      setMessage(
        `Added "${definition.name}" to My Templates.`,
      )
    } finally {
      setSavingTemplate(false)
    }
  }

  const useSavedTemplate = (
    definition: WorkflowDefinition,
  ) => {
    openTemplate({
      key: `mine:${definition.id}`,
      name: definition.name,
      description: 'My saved workflow template',
      nodes: definition.nodes,
    })

    setLibraryOpen(false)
  }

  const add = (
    item: WorkflowCatalogItem,
    actionId?: string,
  ) => {
    if (blocked) return

    const existingIds = new Set(
      nodes.map(node => node.id),
    )

    addNode(item.type)

    if (actionId) {
      const actionKey =
        Object.prototype.hasOwnProperty.call(
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

    setSelectedProvider(null)
    setLibraryOpen(false)
    onOpenNode?.()
  }

  const providerRow = (
    provider: Provider,
    favorite = false,
  ) => {
    const isFavorite = favorites.includes(
      provider.key,
    )

    return (
      <div
        key={`${favorite ? 'fav' : 'all'}:${provider.key}`}
        className={`group relative flex items-center rounded-xl transition-colors hover:bg-[#f5f5f5] dark:hover:bg-[#1f2937] ${
          selectedProvider === provider.key
            ? 'bg-[#f5f5f5] dark:bg-[#1f2937]'
            : ''
        }`}
      >
        <button
          type="button"
          onMouseEnter={event =>
            showProvider(provider.key, event)
          }
          onClick={event =>
            showProvider(provider.key, event)
          }
          disabled={working}
          draggable={
            !blocked &&
            provider.items.length === 1
          }
          onDragStart={event => {
            if (provider.items.length === 1) {
              event.dataTransfer.setData(
                'text/cliptora-node',
                provider.items[0].type,
              )
              event.dataTransfer.effectAllowed = 'copy'
            }
          }}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-2 pl-3 pr-12 text-left disabled:opacity-45"
        >
          <span className="grid size-8 shrink-0 place-items-center">
            <WorkflowToolIcon
              type={provider.items[0].type}
              size={24}
            />
          </span>

          <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#222] dark:text-[#f3f4f6]">
            {provider.label}
          </span>

          <ChevronRight
            size={17}
            className="shrink-0 text-[#4b5563] dark:text-[#b8b8b8]"
          />
        </button>

        <button
          type="button"
          aria-label={
            isFavorite
              ? `Unfavorite ${provider.label}`
              : `Favorite ${provider.label}`
          }
          aria-pressed={isFavorite}
          title={
            isFavorite
              ? 'Remove from favorites'
              : 'Add to favorites'
          }
          onClick={() =>
            toggleFavorite(provider.key)
          }
          className={`absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg transition hover:bg-amber-500/10 hover:text-amber-500 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-amber-500 ${
            isFavorite
              ? 'text-amber-500'
              : 'text-[#737b88] opacity-0 group-hover:opacity-100'
          }`}
        >
          <Star
            size={18}
            fill={
              isFavorite
                ? 'currentColor'
                : 'none'
            }
          />
        </button>
      </div>
    )
  }

  const providerSection = (
    title: string,
    rows: Provider[],
  ) =>
    rows.length > 0 && (
      <section key={title} className="mb-3">
        <h3 className="px-3 pb-2 pt-2 text-[13px] font-semibold text-[#777] dark:text-[#b8bec7]">
          {title}
        </h3>

        {rows.map(provider =>
          providerRow(
            provider,
            title === 'Favorites',
          ),
        )}
      </section>
    )

  const tabClass = (active: boolean) =>
    `relative flex min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap px-2 py-3 text-[13px] font-semibold transition-colors ${
      active
        ? 'text-[#28223a] after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-violet-500 dark:text-white'
        : 'text-[#7d8491] hover:text-[#292d36] dark:text-[#aab0be] dark:hover:text-white'
    }`

  return createPortal(
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-[9990] bg-white/25 backdrop-blur-[5px] dark:bg-[#060914]/40"
        onPointerDown={() => {
          if (selectedProvider) {
            setSelectedProvider(null)
            setActionSearch('')
          } else {
            setLibraryOpen(false)
          }
        }}
      />

      <aside
        id="ws-tool-library"
        aria-label="Add to workflow"
        className="fixed left-4 top-4 z-[9991] flex h-fit min-h-0 flex-col overflow-visible rounded-[24px] border border-[#e2e2e2] bg-white text-[#242424] shadow-[0_9px_30px_rgba(0,0,0,0.09)] dark:border-[#374151] dark:bg-cl-dark-panel dark:text-[#f3f4f6]"
        style={{
          width,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100dvh - 32px)',
        }}
      >
        <header className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3">
          <nav
            aria-label="Library tabs"
            className="flex min-w-0 flex-1 rounded-xl border border-[#dedede] bg-[#f7f7f7] p-0.5 dark:border-[#374151] dark:bg-[#1f2937]"
          >
            {([
              ['nodes', 'Nodes'],
              ['templates', 'My Templates'],
              ['discover', 'Discover'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => changeView(key)}
                className={`min-w-0 flex-1 rounded-[10px] px-2 py-2 text-[12px] font-medium transition-colors ${
                  view === key
                    ? 'bg-white text-[#202020] shadow-[0_1px_4px_#00000014] dark:bg-cl-dark-panel dark:text-[#f3f4f6]'
                    : 'text-[#444] hover:text-gray-900 dark:text-[#b8bec7] dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <button
            type="button"
            onClick={() => setLibraryOpen(false)}
            title="Close"
            aria-label="Close Add Node"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-[#6b7280] hover:bg-[#f4f4f4] dark:hover:bg-[#1f2937]"
          >
            <X size={17} />
          </button>
        </header>

        <div className="relative mx-3 mb-3 flex shrink-0 items-center gap-2 rounded-xl bg-[#f6f6f6] px-3 py-2.5 dark:bg-[#1f2937]">
          <Search
            size={20}
            className="shrink-0 text-[#647080] dark:text-[#a0a8b5]"
          />

          <input
            ref={toolSearchRef}
            type="search"
            autoComplete="off"
            value={nodeSearch}
            onChange={event => {
              setNodeSearch(event.target.value)
              setSelectedProvider(null)
            }}
            placeholder={
              view === 'nodes'
                ? 'Search nodes, apps or triggers'
                : view === 'templates'
                  ? 'Search my templates'
                  : 'Search workflow ideas'
            }
            className="min-w-0 flex-1 bg-transparent text-[14px] text-[#222] outline-none placeholder:text-[#858d98] dark:text-[#f3f4f6] dark:placeholder:text-[#a0a8b5]"
          />

          {view === 'nodes' && (
            <button
              type="button"
              title="Filter categories"
              aria-label="Filter categories"
              aria-expanded={filterOpen}
              onClick={() =>
                setFilterOpen(value => !value)
              }
              className="grid size-8 shrink-0 place-items-center rounded-lg text-[#777] hover:text-[#222] dark:text-[#b8bec7] dark:hover:text-white"
            >
              <ListFilter size={20} />
            </button>
          )}
        </div>


        {view === 'nodes' && filterOpen && (
          <div className="mx-4 mb-2 max-h-36 shrink-0 overflow-y-auto rounded-xl border border-[#eee] p-1.5 dark:border-[#374151]">
            {['All', ...categories].map(group => (
              <button
                key={group}
                type="button"
                onClick={() => {
                  setNodeGroup(group)
                  setSelectedProvider(null)
                  setFilterOpen(false)
                }}
                className={`block w-full rounded-lg px-3 py-2 text-left text-[12px] hover:bg-[#f4f4f4] dark:hover:bg-[#1f2937] ${
                  nodeGroup === group
                    ? 'font-bold text-[#222] dark:text-white'
                    : 'text-[#777] dark:text-[#b8bec7]'
                }`}
              >
                {group}
              </button>
            ))}
          </div>
        )}

        {view === 'nodes' && (
          <div className="min-h-0 overflow-y-auto px-2 pb-3 [scrollbar-width:thin]">
            {providerSection(
              'Favorites',
              favoriteProviders,
            )}

            {providerSection(
              'Actions & Apps',
              actionProviders,
            )}

            {providerSection(
              'Triggers',
              triggerProviders,
            )}

            {!providers.length && (
              <p className="px-4 py-8 text-center text-sm text-[#777]">
                No nodes match your search.
              </p>
            )}
          </div>
        )}

        {view === 'templates' && (
          <div className="min-h-0 space-y-4 overflow-y-auto px-4 pb-4 [scrollbar-width:thin]">
            <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-500/20 dark:bg-violet-500/10">
              <div className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-[#38245e] dark:text-violet-200">
                <Star size={17} />
                Save current workflow
              </div>

              <p className="mb-3 text-[12px] leading-5 text-[#6b6178] dark:text-[#b5acc2]">
                Save your canvas to MySQL and keep it
                here as a reusable template.
              </p>

              <button
                type="button"
                disabled={
                  working ||
                  savingTemplate ||
                  !nodes.length ||
                  !studio.name.trim()
                }
                onClick={() =>
                  void saveCurrentAsTemplate()
                }
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={16} />

                {savingTemplate
                  ? 'Saving…'
                  : 'Save as template'}
              </button>
            </div>

            <section>
              <h3 className="mb-2 text-[13px] font-semibold text-[#666] dark:text-[#c3c8d2]">
                My Templates (
                {filteredSavedDefinitions.length})
              </h3>

              {filteredSavedDefinitions.map(item => (
                <div
                  key={item.id}
                  className="mb-2 flex items-center gap-2 rounded-xl border border-[#eceef2] p-2 dark:border-[#374151]"
                >
                  <button
                    type="button"
                    disabled={working}
                    onClick={() =>
                      useSavedTemplate(item)
                    }
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-[#f8f8fa] disabled:opacity-40 dark:hover:bg-[#1f2937]"
                  >
                    <Workflow
                      size={20}
                      className="shrink-0 text-violet-600 dark:text-violet-400"
                    />

                    <span className="min-w-0">
                      <strong className="block truncate text-[13px]">
                        {item.name}
                      </strong>

                      <small className="text-[11px] text-[#888] dark:text-[#aaa]">
                        {item.nodes.length} nodes ·
                        Use a copy
                      </small>
                    </span>
                  </button>

                  <button
                    type="button"
                    title="Remove from My Templates (workflow remains saved)"
                    aria-label={`Remove ${item.name} from My Templates`}
                    onClick={() =>
                      toggleSavedTemplate(item.id)
                    }
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-amber-500 hover:bg-amber-50 dark:hover:bg-[#1f2937]"
                  >
                    <Star
                      size={17}
                      fill="currentColor"
                    />
                  </button>
                </div>
              ))}

              {!filteredSavedDefinitions.length && (
                <p className="rounded-xl bg-[#f8f8fa] px-4 py-5 text-center text-[12px] text-[#888] dark:bg-[#1f2937] dark:text-[#b8bec7]">
                  No templates yet. Save the current
                  canvas or star one of your saved
                  workflows below.
                </p>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-[13px] font-semibold text-[#666] dark:text-[#c3c8d2]">
                Saved workflows (
                {filteredDefinitions.length})
              </h3>

              {filteredDefinitions.map(item => {
                const selected =
                  pinnedIds.includes(item.id)

                return (
                  <div
                    key={item.id}
                    className="group flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-[#f7f7f8] dark:hover:bg-[#1f2937]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">
                        {item.name}
                      </p>

                      <p className="text-[11px] text-[#888] dark:text-[#aaa]">
                        {item.nodes.length} nodes ·
                        v{item.version ?? 1}
                        {activeId === item.id
                          ? ' · Open'
                          : ''}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        toggleSavedTemplate(item.id)
                      }
                      title={
                        selected
                          ? 'Remove from My Templates'
                          : 'Add to My Templates'
                      }
                      aria-label={
                        selected
                          ? `Unsave ${item.name} as template`
                          : `Save ${item.name} as template`
                      }
                      className={`grid size-8 shrink-0 place-items-center rounded-lg hover:bg-amber-50 dark:hover:bg-[#2b3140] ${
                        selected
                          ? 'text-amber-500'
                          : 'text-[#999] group-hover:text-amber-500'
                      }`}
                    >
                      <Star
                        size={17}
                        fill={
                          selected
                            ? 'currentColor'
                            : 'none'
                        }
                      />
                    </button>
                  </div>
                )
              })}

              {!filteredDefinitions.length && (
                <p className="px-2 py-4 text-center text-[12px] text-[#888]">
                  No saved workflows found.
                </p>
              )}
            </section>
          </div>
        )}

        {view === 'discover' && (
          <div className="min-h-0 overflow-y-auto px-3 pb-4 [scrollbar-width:thin]">
            <p className="mb-3 px-2 text-[12px] leading-5 text-[#888] dark:text-[#a8b0bc]">
              Start faster with CLIPTORA's ready-made
              workflow recipes. They open as editable
              copies.
            </p>

            {filteredTemplates.map(template => (
              <button
                key={template.key}
                type="button"
                disabled={working}
                onClick={() => {
                  openTemplate(template)
                  setLibraryOpen(false)
                }}
                className="mb-2 flex w-full items-start gap-3 rounded-2xl border border-[#eceef2] px-4 py-3 text-left transition hover:border-violet-200 hover:bg-violet-50/50 disabled:opacity-40 dark:border-[#374151] dark:hover:bg-[#1f2937]"
              >
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
                  <Zap size={18} />
                </span>

                <span className="min-w-0 flex-1">
                  <strong className="block text-[14px]">
                    {template.name}
                  </strong>

                  <span className="mt-1 block text-[12px] leading-5 text-[#777] dark:text-[#aeb8c6]">
                    {template.description}
                  </span>

                  <span className="mt-2 block text-[11px] font-semibold text-violet-600 dark:text-violet-400">
                    {template.nodes.length} nodes ·
                    Use template
                  </span>
                </span>

                <ChevronRight
                  size={17}
                  className="mt-2 shrink-0 text-[#9aa2ae]"
                />
              </button>
            ))}

            {!filteredTemplates.length && (
              <p className="p-5 text-center text-sm text-[#777]">
                No suggested templates found.
              </p>
            )}
          </div>
        )}


        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize Add Node"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={width}
          onPointerDown={(
            event: ReactPointerEvent<HTMLDivElement>,
          ) => {
            if (event.button !== 0) return

            event.preventDefault()

            dragRef.current = {
              x: event.clientX,
              width,
            }

            document.body.style.userSelect = 'none'
          }}
          onKeyDown={event => {
            const delta =
              event.key === 'ArrowRight'
                ? 15
                : event.key === 'ArrowLeft'
                  ? -15
                  : 0

            if (delta) {
              event.preventDefault()
              setWidth(current =>
                clamp(current + delta),
              )
            }
          }}
          className="absolute inset-y-0 -right-1.5 z-50 w-3 cursor-col-resize touch-none outline-none"
        >
          <GripVertical
            size={15}
            className="absolute left-0 top-1/2 -translate-y-1/2 text-transparent hover:text-[#4b5563]"
          />
        </div>
      </aside>

      {view === 'nodes' &&
        currentProvider &&
        flyoutPosition &&
        (
          <div
            ref={flyoutRef}
            role="dialog"
            aria-label={`${currentProvider.label} actions`}
            className="fixed z-[9992] flex w-[400px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[22px] border border-[#e2e2e2] bg-white shadow-[0_12px_36px_#00000019] dark:border-[#374151] dark:bg-cl-dark-panel"
            style={{
              left: flyoutPosition.left,
              top: flyoutPosition.top,
              maxHeight: flyoutPosition.maxHeight,
            }}
          >
            <div className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-4">
              {showActionSearch ? (
                <label className="flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-[#f7f7f7] px-3 py-3 dark:bg-[#1f2937]">
                  <Search
                    size={20}
                    className="shrink-0 text-[#777] dark:text-[#aaa]"
                  />

                  <input
                    type="search"
                    autoFocus
                    value={actionSearch}
                    onChange={event =>
                      setActionSearch(
                        event.target.value,
                      )
                    }
                    placeholder="Search actions"
                    className="min-w-0 flex-1 bg-transparent text-[14px] text-[#222] outline-none dark:text-white"
                  />
                </label>
              ) : (
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[#222] dark:text-white">
                  {currentProvider.label}
                </span>
              )}

              <button
                type="button"
                aria-label="Close actions"
                title="Close actions"
                onClick={() =>
                  setSelectedProvider(null)
                }
                className="grid size-8 shrink-0 place-items-center rounded-lg text-[#777] hover:bg-[#f4f4f4] dark:hover:bg-[#1f2937]"
              >
                <X size={17} />
              </button>
            </div>

            <div className="min-h-0 overflow-y-auto px-2 pb-3 pt-1 [scrollbar-width:thin]">
              {actionItems.map(
                ({ item, action }) => (
                  <button
                    key={`${item.type}:${action.id || 'default'}`}
                    type="button"
                    disabled={
                      blocked ||
                      action.disabled
                    }
                    draggable={
                      !blocked &&
                      !action.disabled &&
                      !action.id
                    }
                    onDragStart={event => {
                      event.dataTransfer.setData(
                        'text/cliptora-node',
                        item.type,
                      )
                      event.dataTransfer.effectAllowed =
                        'copy'
                    }}
                    onClick={() =>
                      add(
                        item,
                        action.id || undefined,
                      )
                    }
                    title={
                      action.reason ||
                      action.label
                    }
                    className="group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[#f5f5f5] focus-visible:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-[#1f2937] dark:focus-visible:bg-[#1f2937]"
                  >
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center">
                      <WorkflowToolIcon
                        type={item.type}
                        actionId={
                          action.id ||
                          undefined
                        }
                        size={19}
                      />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium leading-5 text-[#222] dark:text-white">
                        {action.label}
                      </span>

                      <span className="mt-0.5 block text-[11px] leading-[16px] text-[#777] dark:text-[#aaa]">
                        {action.reason ||
                          action.description}
                      </span>
                    </span>
                  </button>
                ),
              )}

              {!actionItems.length && (
                <p className="px-4 py-8 text-center text-sm text-[#777]">
                  No matching actions.
                </p>
              )}
            </div>
          </div>
        )}
    </>,
    document.body,
  )
}
