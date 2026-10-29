import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  ChevronDown,
  Pencil,
  Repeat2,
  CircleHelp,
  Clapperboard,
  Database,
  Film,
  FolderOpen,
  History,
  Globe2,
  Layers3,
  Mic2,
  PlayCircle,
  Search,
  UserCheck,
  X,
  Zap,
  Check,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { WorkflowCatalogItem } from './workflowTypes'
import type { WorkflowStudioState } from './useWorkflowStudio'
import { WorkflowToolIcon } from './WorkflowToolIcon'

type CategoryId =
  | 'ai'
  | 'apps'
  | 'data'
  | 'flow'
  | 'core'
  | 'review'
  | 'triggers'
  | 'video'
  | 'audio'
  | 'editing'

type PickerPage =
  | { kind: 'home' }
  | { kind: 'category'; category: CategoryId }
  | { kind: 'app'; type: string; parent: CategoryId }
  | { kind: 'templates' }
  | { kind: 'workflows' }
  | { kind: 'alltools' }

type CategoryDefinition = {
  id: CategoryId
  title: string
  description: string
  pageTitle: string
  icon: LucideIcon
}

const PRIMARY_CATEGORIES: CategoryDefinition[] = [
  {
    id: 'ai',
    title: 'AI',
    pageTitle: 'AI Nodes',
    description: 'AI tools and models available in CLIPTORA',
    icon: Bot,
  },
  {
    id: 'apps',
    title: 'Action in an app',
    pageTitle: 'Action in an app',
    description: 'Connect to the installed apps and services',
    icon: Globe2,
  },
  {
    id: 'data',
    title: 'Data transformation',
    pageTitle: 'Data transformation',
    description: 'Manipulate, filter or convert data',
    icon: Pencil,
  },
  {
    id: 'flow',
    title: 'Flow',
    pageTitle: 'Flow',
    description: 'Branch, merge or loop the flow, etc.',
    icon: Repeat2,
  },
  {
    id: 'core',
    title: 'Core',
    pageTitle: 'Core',
    description: 'Run code, make HTTP requests, set webhooks, etc.',
    icon: BriefcaseBusiness,
  },
  {
    id: 'review',
    title: 'Human review',
    pageTitle: 'Human review',
    description: 'Review and approval tools registered in your workspace',
    icon: UserCheck,
  },
]

const CLIPTORA_CATEGORIES: CategoryDefinition[] = [
  {
    id: 'video',
    title: 'Video & Media',
    pageTitle: 'Video & Media',
    description: 'Import, inspect, trim, merge and process videos',
    icon: Film,
  },
  {
    id: 'audio',
    title: 'Audio & Speech',
    pageTitle: 'Audio & Speech',
    description: 'Extract audio, transcribe, clean and generate speech',
    icon: Mic2,
  },
  {
    id: 'editing',
    title: 'Editing & Timeline',
    pageTitle: 'Editing & Timeline',
    description: 'Create clips, captions, animations and render results',
    icon: Clapperboard,
  },
]

const TRIGGER_CATEGORY: CategoryDefinition = {
  id: 'triggers',
  title: 'Add another trigger',
  pageTitle: 'Triggers',
  description: 'Triggers start your workflow. Workflows can have multiple triggers.',
  icon: Zap,
}

const CATEGORY_BY_ID = Object.fromEntries(
  [...PRIMARY_CATEGORIES, ...CLIPTORA_CATEGORIES, TRIGGER_CATEGORY].map(category => [category.id, category]),
) as Record<CategoryId, CategoryDefinition>

const LIBRARY_WIDTH_KEY = 'cliptora.workflow.toolLibraryWidth'
const LIBRARY_MIN_WIDTH = 280
const LIBRARY_DEFAULT_WIDTH = 340
const LIBRARY_MAX_WIDTH = 520

function clampLibraryWidth(width: number) {
  const viewportMaximum = typeof window === 'undefined'
    ? LIBRARY_MAX_WIDTH
    : Math.max(LIBRARY_MIN_WIDTH, Math.min(LIBRARY_MAX_WIDTH, window.innerWidth - 16))
  return Math.max(LIBRARY_MIN_WIDTH, Math.min(viewportMaximum, Math.round(width)))
}

/**
 * Use the backend registry as the source of truth. This classifier only organizes
 * tools for display; it never creates nonexistent plugins or executors.
 */
function categoryOf(item: WorkflowCatalogItem): CategoryId {
  const id = item.type.toLowerCase()
  const label = item.label.toLowerCase()
  const group = item.group.toLowerCase()
  const text = `${id} ${label} ${group}`

  if (/trigger|schedule|cron|on.event|on.upload|on.message/.test(text)) return 'triggers'
  if (/approv|human.review|manual.review|review.highlights|checkpoint|validate.clip/.test(text)) return 'review'
  if (/\bif\b|\bswitch\b|condition|branch|loop|iterator|sub.workflow|split.batch|retry|wait|flow|merge.stream|stop.and.error/.test(text)) return 'flow'
  if (/integration|third.party|^app\.|^apps\.|^gmail|google.sheets|google.drive|microsoft.excel|outlook|telegram|notion|slack|discord|dropbox|onedrive|whatsapp|youtube|airtable|salesforce|hubspot/.test(text)) return 'apps'
  if (/^ai[.]|\bai\b|agent|gemini|anthropic|claude|openai|guardrail/.test(text)) return 'ai'
  if (/transcri|speech|voiceover|diariz|whisper|audio|sound|music|tts|silence/.test(text)) return 'audio'
  if (/animation|caption|subtitle|timeline|composition|overlay|effect|render|export|cut.plan|autocut|auto.cut|edit.clip/.test(text)) return 'editing'
  if (/video|media|ffmpeg|crop|trim|reframe|scene|frame|image|thumbnail|merge.clip/.test(text)) return 'video'
  if (/\bai\b|^ai\.|\bllm\b|agent|openai|gemini|anthropic|claude|model|prompt|highlight|summariz|guardrail|embedding/.test(text)) return 'ai'
  if (/^data[.]|transform|data|json|csv|excel.file|regex|filter|limit|deduplicat|array|date|field|sort|aggregate|convert|parse/.test(text)) return 'data'
  return 'core'
}

function belongsTo(item: WorkflowCatalogItem, category: CategoryId) {
  const text = `${item.type} ${item.label}`.toLowerCase()
  return categoryOf(item) === category ||
    (category === 'flow' && /\bfilter\b/.test(text)) ||
    (category === 'data' && /\bcode\b/.test(text))
}

function toolMatches(item: WorkflowCatalogItem, query: string) {
  const q = query.trim().toLocaleLowerCase()
  return !q || `${item.label} ${item.type} ${item.group} ${(item.actions ?? []).join(' ')}`
    .toLocaleLowerCase()
    .includes(q)
}

function prettyOperation(action: string) {
  return action.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function sectionOf(category: CategoryId, item: WorkflowCatalogItem): string {
  const text = `${item.label} ${item.type}`.toLowerCase()
  if (category === 'data') {
    if (/code|date|set|edit.fields|convert/.test(text)) return 'Popular'
    if (/filter|limit|duplicate|split|remove/.test(text)) return 'Add or remove items'
    return 'Combine items'
  }
  if (category === 'flow') {
    if (/filter|\bif\b|loop|merge|switch/.test(text)) return 'Popular'
    return 'Other'
  }
  if (category === 'ai') {
    if (item.group.startsWith('AI · ')) return item.group.slice(5)
    return 'CLIPTORA AI'
  }
  return 'Available nodes'
}

function iconForTool(item: WorkflowCatalogItem) {
  return <WorkflowToolIcon type={item.type} label={item.label} size={32} />
}

function rowText(item: WorkflowCatalogItem): string {
  const custom = (item as WorkflowCatalogItem & { description?: string }).description
  if (custom?.trim()) return custom
  const text = `${item.type} ${item.label}`.toLowerCase()
  if (/gmail/.test(text)) return 'Send and receive emails through Gmail'
  if (/excel/.test(text)) return 'Read, write and manage spreadsheets'
  if (/gemini/.test(text)) return 'Generate text and work with Google AI models'
  if (/agent/.test(text)) return 'Create an AI agent that can execute actions'
  if (/transcrib/.test(text)) return 'Convert speech into timestamped text'
  if (/highlights/.test(text)) return 'Find the best moments from a transcript'
  if (/summar/.test(text)) return 'Generate a concise summary from your content'
  if (/\bif\b|condition/.test(text)) return 'Route items to true and false branches'
  if (/loop/.test(text)) return 'Process each item or batch in a loop'
  if (/merge/.test(text)) return 'Combine data from multiple branches'
  if (/filter/.test(text)) return 'Keep only items that match a condition'
  if (/duplicate/.test(text)) return 'Remove items with matching field values'
  if (/\bcode\b|python/.test(text)) return 'Run custom JavaScript or Python code'
  if (/date/.test(text)) return 'Manipulate date and time values'
  if (/\bhttp\b/.test(text)) return 'Make a request to an external HTTP API'
  if (/webhook/.test(text)) return 'Receive events from an external service'
  if (/render/.test(text)) return 'Export the processed timeline to a video'
  if (/cut|trim/.test(text)) return 'Trim or split clips at selected timestamps'
  const description = item.type.replace(/\./g, ' · ').replace(/_/g, ' ')
  return description || item.group
}

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8750ff]'

export function ToolLibrary({ studio, onOpenNode }: { studio: WorkflowStudioState; onOpenNode?: () => void }) {
  const {
    setLibraryOpen,
    catalog,
    templates,
    definitions,
    activeId,
    versions,
    setVersions,
    working,
    nodeGroup,
    setNodeGroup,
    openDefinition,
    restoreVersion,
    nodeSearch,
    setNodeSearch,
    toolSearchRef,
    addNode,
    setNodesTransient,
    nodes,
    openTemplate,
  } = studio

  const [page, setPage] = useState<PickerPage>({ kind: 'home' })
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [libraryWidth, setLibraryWidth] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem(LIBRARY_WIDTH_KEY))
      return clampLibraryWidth(Number.isFinite(saved) && saved > 0 ? saved : LIBRARY_DEFAULT_WIDTH)
    } catch { return LIBRARY_DEFAULT_WIDTH }
  })
  const widthRef = useRef(libraryWidth)
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    const resize = (event: PointerEvent) => {
      const state = resizeRef.current
      if (!state) return
      const width = clampLibraryWidth(state.startWidth + event.clientX - state.startX)
      widthRef.current = width
      setLibraryWidth(width)
    }
    const stop = () => {
      if (!resizeRef.current) return
      resizeRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      try { window.localStorage.setItem(LIBRARY_WIDTH_KEY, String(widthRef.current)) } catch {}
    }
    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    resizeRef.current = { startX: event.clientX, startWidth: widthRef.current }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
    const requested = event.key === 'Home' ? LIBRARY_MIN_WIDTH : event.key === 'End' ? LIBRARY_MAX_WIDTH : widthRef.current + delta
    if (!delta && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const width = clampLibraryWidth(requested)
    widthRef.current = width
    setLibraryWidth(width)
    try { window.localStorage.setItem(LIBRARY_WIDTH_KEY, String(width)) } catch {}
  }

  const browseCatalog = useMemo(() => catalog.filter(item =>
    item.status === 'implemented' && (
      !item.actions?.length || item.actions.some(action => item.action_capabilities?.[action]?.status !== 'unavailable')
    )
  ), [catalog])
  const classified = useMemo(() => browseCatalog.map(item => ({ ...item, category: categoryOf(item) })), [browseCatalog])
  const availableCategories = useMemo(() => new Set(classified.map(item => item.category)), [classified])
  const primaryCategories = PRIMARY_CATEGORIES.filter(category => availableCategories.has(category.id))
  const cliptoraCategories = CLIPTORA_CATEGORIES.filter(category => availableCategories.has(category.id))
  const hasTriggerCategory = availableCategories.has('triggers')
  const activeGroups = useMemo(() => [...new Set(browseCatalog.map(item => item.group))], [browseCatalog])
  const availableTemplates = useMemo(() => {
    const types = new Set(browseCatalog.map(item => item.type))
    return templates.filter(template => template.nodes.length > 0 && template.nodes.every(node => types.has(node.type)))
  }, [templates, browseCatalog])

  useEffect(() => {
    if (page.kind === 'category' && !availableCategories.has(page.category)) setPage({ kind: 'home' })
    if (page.kind === 'app' && !browseCatalog.some(item => item.type === page.type)) setPage({ kind: 'home' })
    if (page.kind === 'templates' && !availableTemplates.length) setPage({ kind: 'home' })
    if (page.kind === 'alltools' && !browseCatalog.length) setPage({ kind: 'home' })
  }, [availableCategories, browseCatalog, availableTemplates, page])

  const query = nodeSearch.trim()
  const currentCategory = page.kind === 'category' ? CATEGORY_BY_ID[page.category] : null
  const currentApp = page.kind === 'app' ? browseCatalog.find(item => item.type === page.type) : undefined
  const filtered = useMemo(() => {
    if (page.kind === 'home') return classified.filter(item => toolMatches(item, nodeSearch))
    if (page.kind === 'templates' || page.kind === 'workflows') return []
    if (page.kind === 'alltools') return classified.filter(item => (nodeGroup === 'All' || item.group === nodeGroup) && toolMatches(item, nodeSearch))
    const cat = page.kind === 'category' ? page.category : page.parent
    return classified.filter(item => belongsTo(item, cat) && toolMatches(item, nodeSearch))
  }, [classified, nodeSearch, page])

  function goHome() {
    setPage({ kind: 'home' })
    setNodeSearch('')
  }

  function goCategory(category: CategoryId) {
    setPage({ kind: 'category', category })
    setNodeSearch('')
    setCollapsed([])
    window.requestAnimationFrame(() => toolSearchRef.current?.focus())
  }

  function goBack() {
    if (page.kind === 'app') goCategory(page.parent)
    else if (page.kind === 'templates') goHome()
    else if (page.kind === 'workflows' || page.kind === 'alltools') goHome()
    else goHome()
  }

  function goApp(item: WorkflowCatalogItem, parent: CategoryId) {
    if (item.status !== 'implemented') return
    setPage({ kind: 'app', type: item.type, parent })
    setNodeSearch('')
  }

  function addItem(item: WorkflowCatalogItem, action?: string) {
    if (item.status !== 'implemented') return
    if (item.actions?.length && action === undefined) {
      goApp(item, categoryOf(item))
      return
    }

    // addNode() creates the actual node. If an action was picked, apply it to
    // the newly added node in the same React state batch (not an existing node).
    const previousIds = new Set(nodes.map(node => node.id))
    addNode(item.type)
    if (action !== undefined) {
      const actionDefaults: Record<string, Record<string, unknown>> = {
        message_model: { model: 'gpt-4o-mini', prompt: '' },
        classify_violations: { model: 'omni-moderation-latest', prompt: '', simplify_output: true },
        analyze_image: { model: 'gpt-4o-mini', prompt: "What's in this image?", image_urls: '', simplify_output: true },
        generate_image: { model: 'gpt-image-1', prompt: '', image_size: '1024x1024', simplify_output: true },
      }
      const property = Object.prototype.hasOwnProperty.call(item.settings, 'action') &&
        !Object.prototype.hasOwnProperty.call(item.settings, 'operation') ? 'action' : 'operation'
      setNodesTransient(previous => previous.map(node => (
        node.type === item.type && !previousIds.has(node.id)
          ? { ...node, settings: { ...node.settings, ...(actionDefaults[action] ?? {}), [property]: action } }
          : node
      )))
    }
    setLibraryOpen(false)
    onOpenNode?.()
  }

  const renderTool = (item: WorkflowCatalogItem, category: CategoryId) => {
    return (
      <button
        key={item.type}
        type="button"
        draggable
        onDragStart={event => {
          event.dataTransfer.effectAllowed = 'copy'
          event.dataTransfer.setData('text/cliptora-node', item.type)
        }}
        onClick={() => item.actions?.length ? goApp(item, category) : addItem(item)}
        title={`Add ${item.label}`}
        className={`group flex w-full min-w-0 items-start gap-4 px-5 py-[17px] text-left transition-colors hover:bg-[#f8f8f9] focus-visible:bg-[#f6f2ff] ${focusRing}`}
      >
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center" aria-hidden="true">{iconForTool(item)}</span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <strong className="block break-words text-[15px] font-medium leading-6 text-[#202020]">{item.label}</strong>
          </span>
          <span className="mt-0.5 block break-words text-[13px] leading-5 text-[#575757]">{rowText(item)}</span>
        </span>
        <ArrowRight size={19} className="mt-2 shrink-0 text-[#d1d1d1] transition-colors group-hover:text-[#8b5cf6]" />
      </button>
    )
  }

  const renderCategory = (category: CategoryDefinition) => {
    const Icon = category.icon
    return (
      <button
        key={category.id}
        type="button"
        onClick={() => goCategory(category.id)}
        className={`group flex w-full items-center gap-3 border-l-[2px] py-[11px] pl-[18px] pr-6 text-left transition-colors hover:bg-[#f8f8f9] ${category.id === 'ai' ? 'border-l-[#222222]' : 'border-l-transparent'} ${focusRing}`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center text-[#bbbbbb]" aria-hidden="true"><Icon size={29} strokeWidth={1.8} /></span>
        <span className="min-w-0 flex-1">
          <strong className="block text-[16px] font-medium leading-6 text-[#202020]">{category.title}</strong>
          <span className="mt-0.5 block text-[13px] leading-[1.45] text-[#505050]">{category.description}</span>
        </span>
        <ArrowRight size={21} strokeWidth={1.8} className="shrink-0 text-[#777] transition-colors group-hover:text-[#8750ff]" />
      </button>
    )
  }

  const sectionOrder = page.kind === 'category' && page.category === 'data'
    ? ['Popular', 'Add or remove items', 'Combine items']
    : page.kind === 'category' && page.category === 'flow'
      ? ['Popular', 'Other']
      : page.kind === 'category' && page.category === 'ai'
        ? ['CLIPTORA AI', 'Agents & Chains', 'Chat Models', 'Memory', 'Embeddings', 'Vector Stores', 'Document Processing', 'Retrievers & Rerankers', 'Output Parsers', 'Tools']
        : ['Available nodes']

  const groupSections = (() => {
    const category = page.kind === 'category' ? page.category : null
    if (!category || category === 'apps' || category === 'triggers') return []
    const grouped = new Map<string, WorkflowCatalogItem[]>()
    filtered.forEach(item => {
      const key = sectionOf(category, item)
      grouped.set(key, [...(grouped.get(key) ?? []), item])
    })
    const ordered = [...sectionOrder.filter(section => grouped.has(section)), ...[...grouped.keys()].filter(section => !sectionOrder.includes(section)).sort()]
    return ordered.map(section => ({ title: section, items: [...grouped.get(section)!].sort((a, b) => a.label.localeCompare(b.label)) }))
  })()

  const isSearch = query.length > 0
  const pageTitle = page.kind === 'home'
    ? 'What happens next?'
    : page.kind === 'app'
      ? currentApp?.type === 'ai.openai' ? `Actions (${currentApp.actions?.length ?? 0})` : currentApp?.label ?? 'Tool actions'
      : page.kind === 'templates'
        ? 'Workflow Templates'
        : page.kind === 'workflows'
          ? 'Saved Workflows'
          : page.kind === 'alltools'
            ? 'All Tools'
            : currentCategory?.pageTitle ?? 'Tools'

  const appActionSections = (() => {
    if (!currentApp) return [] as Array<{ title: string; actions: string[] }>
    const visible = (currentApp.actions ?? []).filter(action => !isSearch || `${action} ${currentApp.action_capabilities?.[action]?.label ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    const grouped = new Map<string, string[]>()
    visible.forEach(action => {
      const group = currentApp.action_capabilities?.[action]?.group ?? 'Actions'
      grouped.set(group, [...(grouped.get(group) ?? []), action])
    })
    return [...grouped.entries()].map(([title, actions]) => ({ title, actions }))
  })()

  return (
    <aside
      id="ws-tool-library"
      aria-label="Tool Library"
      className="absolute inset-y-0 left-0 z-40 flex shrink-0 flex-col overflow-visible border-r border-[#e5e5e5] bg-white text-[#202020] shadow-[8px_0_28px_#00000018] lg:relative lg:z-auto lg:shadow-none"
      style={{ width: `min(${libraryWidth}px, calc(100vw - 16px))` }}
    >
      {/* n8n-style page title and back navigation */}
      <div className={`group flex shrink-0 items-center gap-3 border-b border-[#dedede] bg-[#f6f6f6] px-2 ${page.kind === 'category' && page.category === 'ai' ? 'min-h-[88px] py-3' : page.kind === 'app' ? 'min-h-[74px] py-3' : 'h-[62px]'}`}>
        {page.kind !== 'home' && (
          <button type="button" onClick={goBack} title="Back" aria-label="Back" className={`-ml-2 grid size-9 shrink-0 place-items-center rounded-md text-[#777] hover:bg-[#eeeeee] hover:text-[#222] ${focusRing}`}>
            <ArrowLeft size={25} strokeWidth={1.9} />
          </button>
        )}
        {page.kind === 'category' && currentCategory && <currentCategory.icon size={26} className="shrink-0 text-[#b9b9b9]" strokeWidth={1.7} />}
        {page.kind === 'app' && currentApp && currentApp.type !== 'ai.openai' && <div className="shrink-0">{iconForTool(currentApp)}</div>}
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-[18px] font-medium leading-[1.2] tracking-[-0.025em] text-[#111111]">{pageTitle}</h2>
          {page.kind === 'category' && page.category === 'ai' && <p className="mt-2 text-[13px] leading-5 text-[#555]">Select an AI Node to add to your workflow</p>}
          {page.kind === 'app' && currentApp?.type !== 'ai.openai' && <p className="mt-1 text-[12px] text-[#666]">Select an action to add to your workflow</p>}
        </div>
        <button type="button" onClick={() => setLibraryOpen(false)} aria-label="Hide Tool Library" title="Hide Tool Library" className={`-mr-2 grid size-8 shrink-0 place-items-center rounded-lg text-[#9b9b9b] opacity-0 transition-opacity hover:bg-[#ececec] hover:text-[#222] group-hover:opacity-100 focus-visible:opacity-100 max-lg:opacity-100 ${focusRing}`}><X size={18} /></button>
      </div>

      {/* Search always uses the backend catalog, and is scoped to the active page. */}

      <label className="flex h-[45px] items-center gap-[9px] bg-white px-[14px] text-[#777777]  focus-within:border-[#8e26ff] focus-within:ring-1 focus-within:ring-[#8e26ff]">
        <Search size={20} strokeWidth={2} className="shrink-0" />
        <input
          ref={toolSearchRef}
          autoFocus
          type="search"
          value={nodeSearch}
          onChange={event => setNodeSearch(event.target.value)}
          placeholder={page.kind === 'app' ? 'Search actions...' : page.kind === 'templates' ? 'Search templates...' : page.kind === 'workflows' ? 'Search workflows...' : 'Search nodes...'}
          aria-label={page.kind === 'app' ? 'Search actions' : page.kind === 'templates' ? 'Search templates' : page.kind === 'workflows' ? 'Search workflows' : 'Search nodes'}
          className="h-full min-w-0 w-full flex-1 border-0 bg-transparent p-0 text-[16px] leading-normal text-[#222] outline-none placeholder:text-[#777]"
        />
      </label>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-8 [scrollbar-width:thin] [scrollbar-color:#d4d4d8_transparent]">
        {page.kind === 'home' && !isSearch && (
          <>
            <nav aria-label="Node categories" className="pt-1">
              {primaryCategories.map(renderCategory)}
            </nav>
            {primaryCategories.length > 0 && hasTriggerCategory && <div className="ml-5 mr-4 my-4 border-t border-[#dedede]" />}
            {hasTriggerCategory && renderCategory(TRIGGER_CATEGORY)}
            {availableTemplates.length > 0 && (
              <button type="button" onClick={() => { setPage({ kind: 'templates' }); setNodeSearch('') }}
                className={`group flex w-full items-center gap-3 border-l-[2px] border-l-transparent py-[11px] pl-[18px] pr-6 text-left transition-colors hover:bg-[#f8f8f9] ${focusRing}`}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center text-[#b6b6b6]" aria-hidden="true"><Layers3 size={29} strokeWidth={1.7} /></span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-[13px] font-medium leading-6 text-[#202020]">Workflow Templates</strong>
                  <span className="mt-0.5 block text-[11px] leading-[1.45] text-[#505050]">Start with a ready-made set of connected nodes</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[#777]"><span className="text-xs">{availableTemplates.length}</span><ArrowRight size={21} /></span>
              </button>
            )}
            {cliptoraCategories.length > 0 && <>
              <div className="mx-5 mb-4 mt-8 border-t border-[#e6e6e6]" />
              <p className="px-5 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#969696]">CLIPTORA tools</p>
              {cliptoraCategories.map(renderCategory)}
            </>}
            <div className="mx-5 my-4 border-t border-[#e6e6e6]" />
            {definitions.length > 0 && <button type="button" onClick={() => { setPage({ kind: 'workflows' }); setNodeSearch('') }}
              className={`group flex w-full items-center gap-3 border-l-[2px] border-l-transparent py-[11px] pl-[18px] pr-6 text-left transition-colors hover:bg-[#f8f8f9] ${focusRing}`}>
              <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center text-[#b6b6b6]" aria-hidden="true"><FolderOpen size={29} strokeWidth={1.7} /></span>
              <span className="min-w-0 flex-1"><strong className="block text-[17px] font-medium leading-6 text-[#202020]">Saved Workflows</strong>
                <span className="mt-0.5 block text-[13px] leading-[1.45] text-[#505050]">Open saved workflows and restore previous versions</span></span>
              <span className="mt-1 flex shrink-0 items-center gap-2 text-[#777]"><span className="text-xs">{definitions.length}</span><ArrowRight size={21} /></span>
            </button>}
            {browseCatalog.length > 0 && <button type="button" onClick={() => { setPage({ kind: 'alltools' }); setNodeSearch(''); setNodeGroup('All') }}
              className={`group flex w-full items-center gap-3 border-l-[2px] border-l-transparent py-[11px] pl-[18px] pr-6 text-left transition-colors hover:bg-[#f8f8f9] ${focusRing}`}>
              <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center text-[#b6b6b6]" aria-hidden="true"><Database size={29} strokeWidth={1.7} /></span>
              <span className="min-w-0 flex-1"><strong className="block text-[17px] font-medium leading-6 text-[#202020]">All tools</strong>
                <span className="mt-0.5 block text-[13px] leading-[1.45] text-[#505050]">Browse tools by their original backend groups</span></span>
              <ArrowRight size={21} className="mt-2 shrink-0 text-[#777]" />
            </button>}
            {!browseCatalog.length && <div className="px-5 py-6 text-[13px] text-[#818181]">No executable tools are registered in this workspace.</div>}
          </>
        )}

        {page.kind === 'home' && isSearch && (
          <>
            <p className="px-5 pb-2 pt-3 text-[12px] text-[#777]">{filtered.length} matching nodes</p>
            {filtered.map(item => renderTool(item, categoryOf(item)))}
          </>
        )}

        {page.kind === 'category' && (page.category === 'apps' || page.category === 'triggers') &&
          [...filtered].sort((a, b) => a.label.localeCompare(b.label)).map(item => renderTool(item, page.category))}

        {page.kind === 'category' && !['apps', 'triggers'].includes(page.category) && groupSections.map((section, idx) => (
          <section key={section.title}>
            <button type="button" onClick={() => setCollapsed(value => value.includes(section.title) ? value.filter(v => v !== section.title) : [...value, section.title])} className={`flex w-full items-center justify-between border-y border-[#e7e7e7] bg-[#fafafa] px-5 py-3.5 text-left text-[14px] font-medium text-[#222] hover:bg-[#f3f3f3] ${idx === 0 ? 'border-t-0' : ''} ${focusRing}`} aria-expanded={!collapsed.includes(section.title)}>
              {section.title}
              <ChevronDown size={19} className={`text-[#777] transition-transform ${collapsed.includes(section.title) ? '-rotate-90' : ''}`} />
            </button>
            {!collapsed.includes(section.title) && section.items.map(item => renderTool(item, page.category))}
          </section>
        ))}

        {page.kind === 'alltools' && (
          <>
            <div className="flex gap-1 overflow-x-auto border-b border-[#e7e7e7] px-4 pb-3 pt-2 [scrollbar-width:thin]" aria-label="Tool groups">
              {['All', ...activeGroups].map(group => (
                <button key={group} type="button" onClick={() => setNodeGroup(group)}
                  aria-pressed={nodeGroup === group}
                  className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium ${focusRing} ${nodeGroup === group ? 'bg-[#222] text-white' : 'text-[#606060] hover:bg-[#f2f2f2]'}`}>{group}</button>
              ))}
            </div>
            {filtered.length ? filtered.map(item => renderTool(item, categoryOf(item))) : (
              <p className="p-6 text-sm text-[#777]">No matching tools found.</p>
            )}
          </>
        )}

        {page.kind === 'workflows' && (
          <div className="px-4 pb-6 pt-4">
            <div className="mb-3 flex items-center justify-between px-1">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#858585]">Project workflows</h3>
              <span className="text-xs text-[#888]">{definitions.length} saved</span>
            </div>
            {!definitions.length && (
              <div className="rounded-xl border border-dashed border-[#dedede] px-4 py-8 text-center">
                <FolderOpen size={26} className="mx-auto mb-2 text-[#a3a3a3]" />
                <strong className="block text-sm font-medium text-[#333]">No saved workflows yet</strong>
                <p className="mt-2 text-xs leading-5 text-[#777]">Save your first workflow from the top toolbar.</p>
              </div>
            )}
            {definitions.filter(definition => !isSearch || definition.name.toLowerCase().includes(query.toLowerCase())).map(definition => (
              <div key={definition.id} className={`mb-2 rounded-lg border ${activeId === definition.id ? 'border-[#b8a2f9] bg-[#f8f6ff]' : 'border-[#e8e8e8] bg-white'}`}>
                <button type="button" onClick={() => { setVersions([]); openDefinition(definition) }}
                  aria-current={activeId === definition.id ? 'true' : undefined}
                  className={`flex w-full items-start gap-3 rounded-lg p-3 text-left hover:bg-[#f9f7ff] ${focusRing}`}>
                  <Workflow size={21} className="mt-0.5 shrink-0 text-[#7357c8]" />
                  <span className="min-w-0 flex-1"><strong className="block truncate text-sm font-semibold text-[#242424]">{definition.name}</strong>
                    <span className="mt-1 block text-xs text-[#777]">{definition.nodes.length} nodes · {definition.version != null ? `v${definition.version}` : 'Saved'}</span>
                  </span>
                  {activeId === definition.id ? <Check size={17} className="shrink-0 text-[#7357c8]" /> : <ArrowRight size={17} className="shrink-0 text-[#aaa]" />}
                </button>
                {activeId === definition.id && versions.length > 0 && (
                  <div className="border-t border-[#e9e3fa] px-3 py-3">
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-[#666]"><History size={14} /> Version History</div>
                    <div className="max-h-[220px] space-y-1 overflow-y-auto">
                      {versions.map(version => (
                        <div key={version.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white">
                          <span className="min-w-0 truncate text-[#555]" title={new Date(version.created_at).toLocaleString()}>
                            v{version.version} · {new Date(version.created_at).toLocaleDateString()}
                          </span>
                          <button type="button" disabled={working || version.version === definition.version}
                            onClick={() => void restoreVersion(version.version)}
                            className={`shrink-0 rounded-md border border-[#dfd8f0] bg-white px-2 py-1 text-[#6543bc] hover:bg-[#f4edff] disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}>
                            Restore
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {page.kind === 'templates' && (
          <>
            <div className="px-5 pb-2 pt-4 text-[12px] font-medium text-[#858585]">WORKFLOW TEMPLATES</div>
            {availableTemplates.filter(template => !isSearch || `${template.name} ${template.description}`.toLowerCase().includes(query.toLowerCase())).map(template => (
              <button key={template.key} type="button" onClick={() => { openTemplate(template); setLibraryOpen(false) }} className={`group flex w-full items-start gap-4 px-5 py-[17px] text-left hover:bg-[#f8f8f9] ${focusRing}`}>
                <span className="mt-1 grid size-9 shrink-0 place-items-center text-[#888]"><Layers3 size={22} /></span>
                <span className="min-w-0 flex-1"><strong className="block text-[15px] font-medium">{template.name}</strong><small className="mt-1 block text-[12px] leading-5 text-[#666]">{template.description}</small></span>
                <ArrowRight size={19} className="mt-2 text-[#c9c9c9] group-hover:text-[#8750ff]" />
              </button>
            ))}
          </>
        )}

        {page.kind === 'app' && currentApp && (
          <>
            {appActionSections.map(section => <section key={section.title}>
              <div className="px-5 pb-2 pt-6 text-[12px] font-medium uppercase tracking-[0.08em] text-[#5f5f5f]">{section.title}</div>
              {section.actions.map(action => {
                const capability = currentApp.action_capabilities?.[action]
                const disabled = capability?.status === 'unavailable'
                return <button key={action} type="button" disabled={disabled} onClick={() => addItem(currentApp, action)} title={disabled ? capability?.reason : `Add ${capability?.label ?? prettyOperation(action)}`}
                  className={`group flex w-full items-center gap-4 px-5 py-[15px] text-left transition-colors ${disabled ? 'cursor-not-allowed opacity-45' : 'hover:bg-[#f8f8f9]'} ${focusRing}`}>
                  <span className="grid size-9 shrink-0 place-items-center text-[#111]">{currentApp.type === 'ai.openai' ? <WorkflowToolIcon type="ai.openai" label="OpenAI" size={31} /> : <PlayCircle size={22} />}</span>
                  <span className="min-w-0 flex-1"><strong className="block text-[15px] font-normal leading-6 text-[#202020]">{capability?.label ?? prettyOperation(action)}</strong>{disabled && <small className="mt-0.5 block text-[11px] leading-4 text-[#777]">{capability?.reason}</small>}</span>
                  {!disabled && <ArrowRight size={18} className="text-[#c9c9c9] group-hover:text-[#8750ff]" />}
                </button>
              })}
            </section>)}
          </>
        )}

        {page.kind !== 'home' && page.kind !== 'templates' && page.kind !== 'app' && page.kind !== 'workflows' && filtered.length === 0 && (
          <div className="mx-5 mt-5 rounded-xl border border-dashed border-[#dfdfdf] px-5 py-7 text-center">
            <CircleHelp size={23} className="mx-auto mb-2 text-[#b0b0b0]" />
            <p className="text-[13px] font-medium text-[#484848]">{isSearch ? 'No matching nodes' : 'No tools registered in this category'}</p>
            <p className="mt-2 text-[12px] leading-5 text-[#888]">{isSearch ? 'Try another keyword.' : 'No implemented tools are available in this section.'}</p>
          </div>
        )}
      </div>

      <div
        role="separator"
        aria-label="Resize Tool Library"
        aria-orientation="vertical"
        aria-valuemin={LIBRARY_MIN_WIDTH}
        aria-valuemax={LIBRARY_MAX_WIDTH}
        aria-valuenow={libraryWidth}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeWithKeyboard}
        className="group absolute inset-y-0 right-0 z-50 w-3 translate-x-1/2 cursor-col-resize touch-none outline-none"
      >
        <span className="absolute left-1/2 top-1/2 grid h-14 w-3 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[#d8d8da] bg-white shadow-sm transition-colors group-hover:border-[#9b7be8] group-hover:bg-[#f7f3ff] group-focus-visible:border-[#7c4dff] group-focus-visible:ring-2 group-focus-visible:ring-violet-200">
          <span className="h-7 w-px rounded-full bg-[#b8b8bc] group-hover:bg-[#7c4dff]" />
        </span>
      </div>

    </aside>
  )
}
