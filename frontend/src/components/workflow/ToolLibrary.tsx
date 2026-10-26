import { useMemo, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  ChevronDown,
  ChevronsLeftRight,
  CircleHelp,
  Clapperboard,
  Code2,
  Database,
  FileJson2,
  Film,
  FolderOpen,
  History,
  GitBranch,
  Globe2,
  Layers3,
  ListFilter,
  Mic2,
  PlayCircle,
  Search,
  Sparkles,
  UserCheck,
  X,
  Zap,
  Check,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { WorkflowCatalogItem } from './workflowTypes'
import type { WorkflowStudioState } from './useWorkflowStudio'
import { iconFor } from './workflowUI'

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
    description: 'Build autonomous agents, summarize or search documents, etc.',
    icon: Bot,
  },
  {
    id: 'apps',
    title: 'Action in an app',
    pageTitle: 'Action in an app',
    description: 'Do something in an app or service like Google Sheets, Telegram or Notion',
    icon: Globe2,
  },
  {
    id: 'data',
    title: 'Data transformation',
    pageTitle: 'Data transformation',
    description: 'Manipulate, filter or convert data',
    icon: ChevronsLeftRight,
  },
  {
    id: 'flow',
    title: 'Flow',
    pageTitle: 'Flow',
    description: 'Branch, merge or loop the flow, etc.',
    icon: GitBranch,
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
    description: 'Request approval via services like Slack and Telegram before making tool calls',
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
  if (category === 'ai') return 'AI Nodes'
  return 'Available nodes'
}

/**
 * Real multicolour brand marks. Iconify's logos collection is SVG, not Lucide.
 * For a fully offline desktop build, copy these SVGs to /public/workflow-logos/
 * and change the BRAND_ASSET_BASE below to '/workflow-logos/'.
 * This UI never pretends an uninstalled connector is runnable.
 */
const BRAND_ASSET_BASE = 'https://api.iconify.design/logos/'
const BRANDS: Array<{ test: RegExp; file: string; label: string; letter: string; bg: string }> = [
  { test: /gmail/, file: 'gmail', label: 'Gmail', letter: 'M', bg: '#ffffff' },
  { test: /google[ ._-]?sheets|sheets/, file: 'google-sheets', label: 'Google Sheets', letter: 'S', bg: '#16a765' },
  { test: /excel/, file: 'microsoft-excel', label: 'Microsoft Excel', letter: 'X', bg: '#107c41' },
  { test: /google[ ._-]?drive/, file: 'google-drive', label: 'Google Drive', letter: 'D', bg: '#ffffff' },
  { test: /gemini/, file: 'google-gemini', label: 'Google Gemini', letter: '✦', bg: '#796bdf' },
  { test: /anthropic|claude/, file: 'anthropic-icon', label: 'Anthropic', letter: 'A', bg: '#d87859' },
  { test: /openai|chatgpt/, file: 'openai-icon', label: 'OpenAI', letter: '◎', bg: '#161616' },
  { test: /telegram/, file: 'telegram', label: 'Telegram', letter: '➤', bg: '#229ed9' },
  { test: /notion/, file: 'notion-icon', label: 'Notion', letter: 'N', bg: '#191919' },
  { test: /slack/, file: 'slack-icon', label: 'Slack', letter: 'S', bg: '#4a154b' },
  { test: /youtube/, file: 'youtube-icon', label: 'YouTube', letter: '▶', bg: '#ff0033' },
  { test: /discord/, file: 'discord-icon', label: 'Discord', letter: 'D', bg: '#5865f2' },
  { test: /dropbox/, file: 'dropbox', label: 'Dropbox', letter: 'D', bg: '#0061ff' },
  { test: /figma/, file: 'figma', label: 'Figma', letter: 'F', bg: '#ffffff' },
  { test: /python/, file: 'python', label: 'Python', letter: 'Py', bg: '#316b9c' },
  { test: /ffmpeg/, file: 'ffmpeg-icon', label: 'FFmpeg', letter: 'F', bg: '#25862a' },
]

function BrandLogo({ brand }: { brand: (typeof BRANDS)[number] }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span aria-label={brand.label} className="grid size-8 shrink-0 place-items-center rounded-[6px] text-[15px] font-extrabold text-white"
        style={{ backgroundColor: brand.bg, color: brand.bg === '#ffffff' ? '#252525' : '#ffffff' }}>
        {brand.letter}
      </span>
    )
  }
  return <img src={`${BRAND_ASSET_BASE}${brand.file}.svg`} alt={brand.label} loading="lazy" draggable={false}
    onError={() => setFailed(true)} className="size-8 shrink-0 object-contain" />
}

function iconForTool(item: WorkflowCatalogItem): ReactNode {
  const text = `${item.type} ${item.label}`.toLowerCase()
  const brand = BRANDS.find(candidate => candidate.test.test(text))
  if (brand) return <BrandLogo brand={brand} />
  if (/json|data/.test(text)) return <FileJson2 size={26} className="text-[#b8b8b8]" />
  if (/filter|limit/.test(text)) return <ListFilter size={26} className="text-[#b8b8b8]" />
  if (/if|switch|flow|loop|merge/.test(text)) return <GitBranch size={26} className="text-[#b8b8b8]" />
  if (/http|webhook/.test(text)) return <Globe2 size={26} className="text-[#b8b8b8]" />
  if (/code/.test(text)) return <Code2 size={26} className="text-[#b8b8b8]" />
  if (/database|mysql/.test(text)) return <Database size={26} className="text-[#b8b8b8]" />
  return <span className="text-[#b8b8b8]">{iconFor(item.type, 26)}</span>
}

/** Discoverability-only entries: NEVER added to the execution registry. */
const SHOWCASE: Array<WorkflowCatalogItem & { description: string }> = [
  { type: 'app.gmail', label: 'Gmail', group: 'Integrations', settings: {}, status: 'planned', description: 'Send and receive emails' },
  { type: 'app.google.sheets', label: 'Google Sheets', group: 'Integrations', settings: {}, status: 'planned', description: 'Read and write spreadsheet data' },
  { type: 'app.microsoft.excel', label: 'Microsoft Excel', group: 'Integrations', settings: {}, status: 'planned', description: 'Manage workbooks and tables' },
  { type: 'app.google.drive', label: 'Google Drive', group: 'Integrations', settings: {}, status: 'planned', description: 'Work with cloud files and folders' },
  { type: 'app.telegram', label: 'Telegram', group: 'Integrations', settings: {}, status: 'planned', description: 'Send messages and notifications' },
  { type: 'app.notion', label: 'Notion', group: 'Integrations', settings: {}, status: 'planned', description: 'Manage pages and databases' },
  { type: 'app.slack', label: 'Slack', group: 'Integrations', settings: {}, status: 'planned', description: 'Send messages and coordinate teams' },
  { type: 'app.youtube', label: 'YouTube', group: 'Integrations', settings: {}, status: 'planned', description: 'Manage your YouTube content' },
  { type: 'ai.google.gemini', label: 'Google Gemini', group: 'AI', settings: {}, status: 'planned', description: 'Generate text, analyze media and use AI models' },
  { type: 'ai.anthropic', label: 'Anthropic', group: 'AI', settings: {}, status: 'planned', description: 'Use Claude models and tools' },
  { type: 'ai.openai', label: 'OpenAI', group: 'AI', settings: {}, status: 'planned', description: 'Use text, vision and speech models' },
  { type: 'data.code', label: 'Code', group: 'Data transformation', settings: {}, status: 'planned', description: 'Run custom JavaScript or Python code' },
  { type: 'data.date_time', label: 'Date & Time', group: 'Data transformation', settings: {}, status: 'planned', description: 'Manipulate date and time values' },
  { type: 'data.edit_fields', label: 'Edit Fields (Set)', group: 'Data transformation', settings: {}, status: 'planned', description: 'Modify, add, or remove item fields' },
  { type: 'data.filter', label: 'Filter', group: 'Data transformation', settings: {}, status: 'planned', description: 'Keep only items matching a condition' },
  { type: 'data.limit', label: 'Limit', group: 'Data transformation', settings: {}, status: 'planned', description: 'Restrict the number of items' },
  { type: 'data.remove_duplicates', label: 'Remove Duplicates', group: 'Data transformation', settings: {}, status: 'planned', description: 'Delete items with matching field values' },
  { type: 'data.split_out', label: 'Split Out', group: 'Data transformation', settings: {}, status: 'planned', description: 'Turn a list inside item(s) into separate items' },
  { type: 'flow.if', label: 'If', group: 'Flow', settings: {}, status: 'planned', description: 'Route items to different branches (true/false)' },
  { type: 'flow.loop', label: 'Loop Over Items (Split in Batches)', group: 'Flow', settings: {}, status: 'planned', description: 'Split data into batches and iterate over each batch' },
  { type: 'flow.merge', label: 'Merge', group: 'Flow', settings: {}, status: 'planned', description: 'Merges data of multiple streams once data from both is available' },
  { type: 'flow.switch', label: 'Switch', group: 'Flow', settings: {}, status: 'planned', description: 'Route items to multiple branches' },
  { type: 'flow.compare', label: 'Compare Datasets', group: 'Flow', settings: {}, status: 'planned', description: 'Compare two inputs for changes' },
  { type: 'flow.subworkflow', label: 'Execute Sub-workflow', group: 'Flow', settings: {}, status: 'planned', description: 'Helpers for calling other n8n workflows. Used for designing modular, microservice-like workflows.' },
  { type: 'flow.stop', label: 'Stop and Error', group: 'Flow', settings: {}, status: 'planned', description: 'Throw an error in the workflow' },
]

function rowText(item: WorkflowCatalogItem): string {
  const custom = (item as WorkflowCatalogItem & { description?: string }).description
  if (custom?.trim()) return custom
  if (item.status === 'planned') return 'Backend executor not installed'
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

export function ToolLibrary({ studio }: { studio: WorkflowStudioState }) {
  const {
    setLibraryOpen,
    catalog,
    templates,
    definitions,
    activeId,
    versions,
    setVersions,
    working,
    groups,
    nodeGroup,
    setNodeGroup,
    openDefinition,
    restoreVersion,
    nodeSearch,
    setNodeSearch,
    toolSearchRef,
    addNode,
    setNodes,
    nodes,
    openTemplate,
  } = studio

  const [page, setPage] = useState<PickerPage>({ kind: 'home' })
  const [collapsed, setCollapsed] = useState<string[]>([])

  const browseCatalog = useMemo(() => {
    // Hide a showcase item as soon as the real plugin is installed in the backend.
    const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
    return [
      ...catalog,
      ...SHOWCASE.filter(example => !catalog.some(real =>
        normalize(real.label) === normalize(example.label) || real.type === example.type
      )),
    ]
  }, [catalog])
  const classified = useMemo(() => browseCatalog.map(item => ({ ...item, category: categoryOf(item) })), [browseCatalog])
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
    else if (page.kind === 'templates') goCategory('ai')
    else if (page.kind === 'workflows' || page.kind === 'alltools') goHome()
    else goHome()
  }

  function goApp(item: WorkflowCatalogItem, parent: CategoryId) {
    if (item.status === 'planned') return
    setPage({ kind: 'app', type: item.type, parent })
    setNodeSearch('')
  }

  function addItem(item: WorkflowCatalogItem, action?: string) {
    if (item.status === 'planned') return
    if (item.actions?.length && action === undefined) {
      goApp(item, categoryOf(item))
      return
    }

    // addNode() creates the actual node. If an action was picked, apply it to
    // the newly added node in the same React state batch (not an existing node).
    const previousIds = new Set(nodes.map(node => node.id))
    addNode(item.type)
    if (action !== undefined) {
      const property = Object.prototype.hasOwnProperty.call(item.settings, 'action') &&
        !Object.prototype.hasOwnProperty.call(item.settings, 'operation') ? 'action' : 'operation'
      setNodes(previous => previous.map(node => (
        node.type === item.type && !previousIds.has(node.id)
          ? { ...node, settings: { ...node.settings, [property]: action } }
          : node
      )))
    }
    setLibraryOpen(false)
  }

  const renderTool = (item: WorkflowCatalogItem, category: CategoryId) => {
    const disabled = item.status === 'planned'
    return (
      <button
        key={item.type}
        type="button"
        draggable={!disabled}
        onDragStart={event => {
          event.dataTransfer.effectAllowed = 'copy'
          event.dataTransfer.setData('text/cliptora-node', item.type)
        }}
        onClick={() => item.actions?.length ? goApp(item, category) : addItem(item)}
        disabled={disabled}
        title={disabled ? 'Available after backend plugin installation' : `Add ${item.label}`}
        className={`group flex w-full min-w-0 items-start gap-4 px-5 py-[17px] text-left transition-colors hover:bg-[#f8f8f9] focus-visible:bg-[#f6f2ff] disabled:cursor-not-allowed disabled:opacity-75 ${focusRing}`}
      >
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center" aria-hidden="true">{iconForTool(item)}</span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <strong className="block break-words text-[15px] font-medium leading-6 text-[#202020]">{item.label}</strong>
            {disabled && <span className="rounded border border-[#e4e4e7] bg-[#fafafa] px-1.5 py-0.5 text-[10px] text-[#777]">Not installed</span>}
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
        className={`group flex w-full items-start gap-4 px-5 py-[18px] text-left transition-colors hover:bg-[#f8f8f9] ${focusRing}`}
      >
        <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center text-[#b6b6b6]" aria-hidden="true"><Icon size={29} strokeWidth={1.7} /></span>
        <span className="min-w-0 flex-1">
          <strong className="block text-[17px] font-medium leading-6 text-[#202020]">{category.title}</strong>
          <span className="mt-0.5 block text-[13px] leading-[1.45] text-[#505050]">{category.description}</span>
        </span>
        <ArrowRight size={21} className="mt-2 shrink-0 text-[#777] transition-colors group-hover:text-[#8750ff]" />
      </button>
    )
  }

  const sectionOrder = page.kind === 'category' && page.category === 'data'
    ? ['Popular', 'Add or remove items', 'Combine items']
    : page.kind === 'category' && page.category === 'flow'
      ? ['Popular', 'Other']
      : ['AI Nodes', 'Available nodes']

  const groupSections = (() => {
    const category = page.kind === 'category' ? page.category : null
    if (!category || category === 'apps' || category === 'triggers') return []
    const grouped = new Map<string, WorkflowCatalogItem[]>()
    filtered.forEach(item => {
      const key = sectionOf(category, item)
      grouped.set(key, [...(grouped.get(key) ?? []), item])
    })
    return sectionOrder.filter(section => grouped.has(section)).map(section => ({ title: section, items: grouped.get(section)! }))
  })()

  const isSearch = query.length > 0
  const pageTitle = page.kind === 'home'
    ? 'What happens next?'
    : page.kind === 'app'
      ? currentApp?.label ?? 'Tool actions'
      : page.kind === 'templates'
        ? 'AI Templates'
        : page.kind === 'workflows'
          ? 'Saved Workflows'
          : page.kind === 'alltools'
            ? 'All Tools'
        : currentCategory?.pageTitle ?? 'Tools'

  return (
    <aside
      id="ws-tool-library"
      aria-label="Tool Library"
      className="absolute inset-y-0 left-0 z-40 flex w-[min(400px,calc(100vw-20px))] shrink-0 flex-col overflow-hidden border-r border-[#e5e5e5] bg-white text-[#202020] shadow-[8px_0_28px_#00000018] lg:relative lg:z-auto lg:w-[360px] lg:shadow-none 2xl:w-[400px]"
    >
      {/* n8n-style page title and back navigation */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[#e8e8e8] bg-[#fafafa] px-5 py-4">
        {page.kind !== 'home' && (
          <button type="button" onClick={goBack} title="Back" aria-label="Back" className={`-ml-2 grid size-9 shrink-0 place-items-center rounded-md text-[#777] hover:bg-[#eeeeee] hover:text-[#222] ${focusRing}`}>
            <ArrowLeft size={25} strokeWidth={1.9} />
          </button>
        )}
        {page.kind === 'category' && currentCategory && <currentCategory.icon size={26} className="shrink-0 text-[#b9b9b9]" strokeWidth={1.7} />}
        {page.kind === 'app' && currentApp && <div className="shrink-0">{iconForTool(currentApp)}</div>}
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-[23px] font-medium leading-tight tracking-[-0.025em] text-[#151515]">{pageTitle}</h2>
          {page.kind === 'category' && page.category === 'ai' && <p className="mt-2 text-[13px] leading-5 text-[#555]">Select an AI Node to add to your workflow</p>}
          {page.kind === 'app' && <p className="mt-1 text-[12px] text-[#666]">Select an action to add to your workflow</p>}
        </div>
        <button type="button" onClick={() => setLibraryOpen(false)} aria-label="Hide Tool Library" title="Hide Tool Library" className={`-mr-2 grid size-8 shrink-0 place-items-center rounded-lg text-[#9b9b9b] hover:bg-[#ececec] hover:text-[#222] ${focusRing}`}><X size={18} /></button>
      </div>

      {/* Search always uses the backend catalog, and is scoped to the active page. */}
      <div className="shrink-0 bg-white px-4 pb-3 pt-[18px]">
        <label className="flex p-2 items-center gap-3 rounded-lg border border-[#cecece] bg-white px-4 text-[#878787] shadow-sm transition-colors focus-within:border-[#8846ff] focus-within:ring-1 focus-within:ring-[#8846ff]">
          <Search size={23} strokeWidth={2} className="shrink-0" />
          <input
            ref={toolSearchRef}
            type="search"
            value={nodeSearch}
            onChange={event => setNodeSearch(event.target.value)}
            placeholder={page.kind === 'app' ? 'Search actions...' : page.kind === 'templates' ? 'Search templates...' : page.kind === 'workflows' ? 'Search workflows...' : 'Search nodes...'}
            aria-label={page.kind === 'app' ? 'Search actions' : page.kind === 'templates' ? 'Search templates' : page.kind === 'workflows' ? 'Search workflows' : 'Search nodes'}
            className="min-w-0 w-full flex-1 border-0 bg-transparent text-[17px] leading-normal text-[#222] outline-none placeholder:text-[#898989]"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-8 [scrollbar-width:thin] [scrollbar-color:#d4d4d8_transparent]">
        {page.kind === 'home' && !isSearch && (
          <>
            <nav aria-label="Node categories" className="pt-1">
              {PRIMARY_CATEGORIES.map(renderCategory)}
            </nav>
            <div className="mx-5 my-4 border-t border-[#e6e6e6]" />
            {renderCategory(TRIGGER_CATEGORY)}
            <div className="mx-5 my-4 border-t border-[#e6e6e6]" />
            <p className="px-5 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#969696]">CLIPTORA tools</p>
            {CLIPTORA_CATEGORIES.map(renderCategory)}
            <div className="mx-5 my-4 border-t border-[#e6e6e6]" />
            <button type="button" onClick={() => { setPage({ kind: 'workflows' }); setNodeSearch('') }}
              className={`group flex w-full items-start gap-4 px-5 py-[18px] text-left transition-colors hover:bg-[#f8f8f9] ${focusRing}`}>
              <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center text-[#b6b6b6]" aria-hidden="true"><FolderOpen size={29} strokeWidth={1.7} /></span>
              <span className="min-w-0 flex-1"><strong className="block text-[17px] font-medium leading-6 text-[#202020]">Saved Workflows</strong>
                <span className="mt-0.5 block text-[13px] leading-[1.45] text-[#505050]">Open saved workflows and restore previous versions</span></span>
              <span className="mt-1 flex shrink-0 items-center gap-2 text-[#777]"><span className="text-xs">{definitions.length}</span><ArrowRight size={21} /></span>
            </button>
            <button type="button" onClick={() => { setPage({ kind: 'alltools' }); setNodeSearch(''); setNodeGroup('All') }}
              className={`group flex w-full items-start gap-4 px-5 py-[18px] text-left transition-colors hover:bg-[#f8f8f9] ${focusRing}`}>
              <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center text-[#b6b6b6]" aria-hidden="true"><Database size={29} strokeWidth={1.7} /></span>
              <span className="min-w-0 flex-1"><strong className="block text-[17px] font-medium leading-6 text-[#202020]">All tools</strong>
                <span className="mt-0.5 block text-[13px] leading-[1.45] text-[#505050]">Browse tools by their original backend groups</span></span>
              <ArrowRight size={21} className="mt-2 shrink-0 text-[#777]" />
            </button>
          </>
        )}

        {page.kind === 'home' && isSearch && (
          <>
            <p className="px-5 pb-2 pt-3 text-[12px] text-[#777]">{filtered.length} matching nodes</p>
            {filtered.map(item => renderTool(item, categoryOf(item)))}
          </>
        )}

        {page.kind === 'category' && page.category === 'ai' && !isSearch && templates.length > 0 && (
          <>
            <button type="button" onClick={() => { setPage({ kind: 'templates' }); setNodeSearch('') }} className={`group flex w-full items-start gap-4 border-b border-[#e6e6e6] px-5 py-[15px] text-left hover:bg-[#f8f8f9] ${focusRing}`}>
              <span className="mt-1 grid size-9 shrink-0 place-items-center text-[#6f6f6f]"><Layers3 size={25} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2"><strong className="text-[15px] font-medium text-[#202020]">AI Templates</strong><span className="rounded border border-[#dedede] bg-white px-1.5 py-0.5 text-[11px] font-medium text-[#555]">Recommended</span></span>
                <span className="mt-0.5 block text-[13px] leading-5 text-[#555]">See what's possible and get started 5x faster</span>
              </span>
              <ArrowRight size={19} className="mt-2 text-[#777]" />
            </button>
          </>
        )}

        {page.kind === 'category' && (page.category === 'apps' || page.category === 'triggers') &&
          [...filtered].sort((a, b) => a.label.localeCompare(b.label)).map(item => renderTool(item, page.category))}

        {page.kind === 'category' && !['apps', 'triggers'].includes(page.category) && groupSections.map((section, idx) => (
          <section key={section.title}>
            {page.category !== 'ai' && (
              <button type="button" onClick={() => setCollapsed(value => value.includes(section.title) ? value.filter(v => v !== section.title) : [...value, section.title])} className={`flex w-full items-center justify-between border-y border-[#e7e7e7] bg-[#fafafa] px-5 py-3.5 text-left text-[14px] font-medium text-[#222] hover:bg-[#f3f3f3] ${idx === 0 ? 'border-t-0' : ''} ${focusRing}`} aria-expanded={!collapsed.includes(section.title)}>
                {section.title}
                <ChevronDown size={19} className={`text-[#777] transition-transform ${collapsed.includes(section.title) ? '-rotate-90' : ''}`} />
              </button>
            )}
            {!collapsed.includes(section.title) && section.items.map(item => renderTool(item, page.category))}
          </section>
        ))}

        {page.kind === 'alltools' && (
          <>
            <div className="flex gap-1 overflow-x-auto border-b border-[#e7e7e7] px-4 pb-3 pt-2 [scrollbar-width:thin]" aria-label="Tool groups">
              {['All', ...groups].map(group => (
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
            {templates.filter(template => !isSearch || `${template.name} ${template.description}`.toLowerCase().includes(query.toLowerCase())).map(template => (
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
            <div className="px-5 pb-2 pt-4 text-[12px] font-medium text-[#858585]">ACTIONS</div>
            {(currentApp.actions ?? []).filter(action => !isSearch || action.toLowerCase().includes(query.toLowerCase())).map(action => (
              <button key={action} type="button" onClick={() => addItem(currentApp, action)} className={`group flex w-full items-start gap-4 px-5 py-[17px] text-left hover:bg-[#f8f8f9] ${focusRing}`}>
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center text-[#9e9e9e]"><PlayCircle size={22} /></span>
                <span className="min-w-0 flex-1"><strong className="block text-[15px] font-medium leading-6">{prettyOperation(action)}</strong><small className="mt-0.5 block text-[12px] leading-5 text-[#666]">Add this action to your workflow</small></span>
                <ArrowRight size={19} className="mt-2 text-[#c9c9c9] group-hover:text-[#8750ff]" />
              </button>
            ))}
          </>
        )}

        {page.kind !== 'home' && page.kind !== 'templates' && filtered.length === 0 && !(page.kind === 'category' && page.category === 'ai' && templates.length > 0) && (
          <div className="mx-5 mt-5 rounded-xl border border-dashed border-[#dfdfdf] px-5 py-7 text-center">
            <CircleHelp size={23} className="mx-auto mb-2 text-[#b0b0b0]" />
            <p className="text-[13px] font-medium text-[#484848]">{isSearch ? 'No matching nodes' : 'No tools registered in this category'}</p>
            <p className="mt-2 text-[12px] leading-5 text-[#888]">{isSearch ? 'Try another keyword.' : 'Install or enable the required tool in the backend registry.'}</p>
          </div>
        )}
      </div>

    </aside>
  )
}