
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import {
  AudioLines,
  Bot,
  BookOpen,
  BrainCircuit,
  Braces,
  CalendarClock,
  Captions,
  Clapperboard,
  Database,
  Download,
  FileText,
  FileUp,
  Film,
  FolderPlus,
  FolderSearch,
  FolderX,
  GitBranch,
  GitMerge,
  Globe,
  Image,
  ImagePlus,
  Images,
  MessageSquareText,
  Mic,
  Play,
  ScanSearch,
  Scissors,
  ShieldAlert,
  Sparkles,
  Split,
  Video,
  WandSparkles,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react'

import type {
  WorkflowCatalogItem,
  WorkflowNode,
} from './workflowTypes'
import { GeminiBrandIcon } from './GeminiBrandIcon'

const icons: Record<string, LucideIcon> = {
  'audio-lines': AudioLines,
  bot: Bot,
  'book-open': BookOpen,
  'brain-circuit': BrainCircuit,
  braces: Braces,
  'calendar-clock': CalendarClock,
  captions: Captions,
  clapperboard: Clapperboard,
  database: Database,
  download: Download,
  'file-text': FileText,
  'file-up': FileUp,
  film: Film,
  'folder-plus': FolderPlus,
  'folder-search': FolderSearch,
  'folder-x': FolderX,
  'git-branch': GitBranch,
  'git-merge': GitMerge,
  globe: Globe,
  image: Image,
  'image-plus': ImagePlus,
  images: Images,
  'message-square-text': MessageSquareText,
  mic: Mic,
  play: Play,
  'scan-search': ScanSearch,
  scissors: Scissors,
  'shield-alert': ShieldAlert,
  sparkles: Sparkles,
  split: Split,
  video: Video,
  'wand-sparkles': WandSparkles,
  workflow: Workflow,
  zap: Zap,
}

const brandFiles: Record<string, string> = {
  gemini: '/icons/nodes/gemini.svg',
  openai: '/icons/nodes/openai.svg',
  ollama: '/icons/nodes/ollama.svg',
}

type Action = {
  id: string
  label?: string
  icon?: string
}

type Meta = {
  icon?: string
  family_icon?: string
  operation_icon?: string
  actions?: Action[]
}

type IconCatalog = {
  byType: Map<string, Meta>
  byNodeId: Map<string, WorkflowNode>
}

const Context = createContext<IconCatalog | null>(null)

export function NodeIconCatalogProvider({
  catalog,
  nodes,
  children,
}: {
  catalog: WorkflowCatalogItem[]
  nodes: WorkflowNode[]
  children: ReactNode
}) {
  const value = useMemo<IconCatalog>(() => {
    const byType = new Map<string, Meta>()

    for (const item of catalog) {
      const raw = Array.isArray(item.actions)
        ? (item.actions as unknown[])
        : []

      const actions = raw.flatMap((action): Action[] => {
        if (typeof action === 'string') {
          return [{
            id: action,
            label: item.action_capabilities?.[action]?.label,
          }]
        }

        if (!action || typeof action !== 'object') {
          return []
        }

        const data = action as Record<string, unknown>

        if (typeof data.id !== 'string') {
          return []
        }

        return [{
          id: data.id,
          label: typeof data.label === 'string'
            ? data.label
            : undefined,
          icon: typeof data.icon === 'string'
            ? data.icon
            : undefined,
        }]
      })

      byType.set(item.type, {
        icon: item.icon,
        family_icon: (
          item as WorkflowCatalogItem & {
            family_icon?: string
          }
        ).family_icon,
        operation_icon: (
          item as WorkflowCatalogItem & {
            operation_icon?: string
          }
        ).operation_icon,
        actions,
      })
    }

    return {
      byType,
      byNodeId: new Map(
        nodes.map(node => [node.id, node]),
      ),
    }
  }, [catalog, nodes])

  return (
    <Context.Provider value={value}>
      {children}
    </Context.Provider>
  )
}

/**
 * Resolve icon using the backend catalog.
 *
 * Order:
 * 1. Selected sub-node
 * 2. Parent operation icon
 * 3. Parent icon
 * 4. Family icon
 * 5. Generic workflow icon
 */
export function useNodeIcon(
  type: string,
  actionId?: string | null,
  nodeId?: string,
): string {
  const catalog = useContext(Context)
  const meta = catalog?.byType.get(type)

  const actualNode = nodeId
    ? catalog?.byNodeId.get(nodeId)
    : undefined

  const selectedAction = actionId ?? (
    typeof actualNode?.settings.action === 'string'
      ? actualNode.settings.action
      : typeof actualNode?.settings.operation === 'string'
        ? actualNode.settings.operation
        : null
  )

  return (
    meta?.actions?.find(
      action => action.id === selectedAction,
    )?.icon ||
    meta?.operation_icon ||
    meta?.icon ||
    meta?.family_icon ||
    'lucide:workflow'
  )
}

export function getActionIcon(
  meta: Meta,
  actionId?: string | null,
): string {
  return (
    meta.actions?.find(
      action => action.id === actionId,
    )?.icon ||
    meta.operation_icon ||
    meta.icon ||
    meta.family_icon ||
    'lucide:workflow'
  )
}

export function NodeIcon({
  icon = 'lucide:workflow',
  size = 24,
  className,
  title,
}: {
  icon?: string
  size?: number
  className?: string
  title?: string
}) {
  const [broken, setBroken] = useState(false)

  const safeSize = Number.isFinite(size)
    ? Math.max(12, Math.min(128, size))
    : 24

  const [prefix, name] = icon.split(':', 2)

  const asset = prefix === 'brand'
    ? brandFiles[name]
    : undefined

  if (asset && !broken) {
    return (
      <img
        src={asset}
        width={safeSize}
        height={safeSize}
        alt={title || `${name} icon`}
        className={className}
        style={{
          width: safeSize,
          height: safeSize,
          flexShrink: 0,
        }}
        onError={() => setBroken(true)}
      />
    )
  }

  if (prefix === 'brand' && name === 'gemini') {
    return (
      <GeminiBrandIcon
        size={safeSize}
        className={className}
      />
    )
  }

  const Icon = prefix === 'lucide'
    ? icons[name] ?? Workflow
    : Workflow

  return (
    <Icon
      size={safeSize}
      className={className}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    />
  )
}

export function WorkflowNodeIcon({
  meta,
  actionId,
  size = 28,
  showActionBadge = false,
  className,
}: {
  meta: Meta
  actionId?: string | null
  size?: number
  showActionBadge?: boolean
  className?: string
}) {
  const main = meta.family_icon ||
    meta.icon ||
    'lucide:workflow'

  const sub = getActionIcon(meta, actionId)

  return (
    <span
      className={`relative inline-flex shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size }}
    >
      <NodeIcon icon={main} size={size} />

      {showActionBadge && actionId && sub !== main && (
        <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-md bg-white shadow-sm ring-1 ring-black/10">
          <NodeIcon icon={sub} size={14} />
        </span>
      )}
    </span>
  )
}
