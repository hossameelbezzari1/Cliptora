
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

/**
 * CLIPTORA - Centralized Node Icon Colors
 *
 * Applies only to Lucide icons.
 * Brand logos, images and external SVG files remain unchanged.
 * No icon background is added.
 */

const NODE_ICON_COLORS: Record<string, string> = {
  'flow.if': '#16a34a',
  'flow.switch': '#059669',
  'flow.merge': '#0d9488',

  'audio.extract': '#ea580c',
  'audio.transcribe': '#d97706',

  'media.probe': '#7c3aed',
  'core.video_source': '#0284c7',

  'integration.http_request': '#2563eb',
  'data.json_extract': '#0f766e',

  'animation.storyboard': '#db2777',
  'animation.keyframes': '#c026d3',

  'ai.highlights': '#a21caf',
  'ai.summary': '#9333ea',
  'ai.agent': '#9333ea',
  'ai.chat_model': '#7c3aed',

  'caption.generate': '#0891b2',
  'video.render': '#475569',
  'timeline.cut_plan': '#475569',

  'core.manual_trigger': '#d97706',
  'core.schedule_trigger': '#d97706',
}

const NODE_ICON_FAMILY_COLORS: Record<string, string> = {
  flow: '#16a34a',
  audio: '#ea580c',
  media: '#7c3aed',
  core: '#0284c7',
  integration: '#2563eb',
  data: '#0f766e',
  animation: '#c026d3',
  ai: '#8b5cf6',
  caption: '#0891b2',
  video: '#475569',
  timeline: '#64748b',
}

export function getNodeIconColor(type: string): string {
  return (
    NODE_ICON_COLORS[type] ??
    NODE_ICON_FAMILY_COLORS[type.split('.')[0]] ??
    '#475569'
  )
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
  color,
}: {
  icon?: string
  size?: number
  className?: string
  title?: string
  color?: string
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
      color={prefix === 'lucide' ? color : undefined}
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
        <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center">
          <NodeIcon icon={sub} size={14} />
        </span>
      )}
    </span>
  )
}
