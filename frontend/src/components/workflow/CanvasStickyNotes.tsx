import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { ViewportPortal } from '@xyflow/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlignCenter,
  AlignLeft,
  AtSign,
  Bold,
  Check,
  Code2,
  Copy,
  GripHorizontal,
  Hash,
  Italic,
  Link2,
  List,
  MessageCircle,
  MoreHorizontal,
  Palette,
  Pin,
  Search,
  SmilePlus,
  Star,
  Tag,
  Trash2,
  X,
} from 'lucide-react'

export type StickyCanvasNote = {
  id: string
  x: number
  y: number
  width: number
  height?: number
  color: string
  content: string
  tags?: string[]
  reactions?: Record<string, number>
  pinned?: boolean
  align?: 'left' | 'center'
  comments?: { id: string; text: string; createdAt: number }[]
}

export type CanvasStickyNotesHandle = {
  addNote: (position: { x: number; y: number }) => void
  clearSelection: () => void
}

type Props = {
  scope: string
  zoom: number
  searchOpen?: boolean
}

type NotePatch = Partial<Omit<StickyCanvasNote, 'id'>>
type Popover = 'search' | 'tags' | 'mention' | 'reactions' | 'palette' | 'comments' | 'more' | null

type Drag = {
  pointerId: number
  initialClientX: number
  initialClientY: number
  initialX: number
  initialY: number
  nextX: number
  nextY: number
  frame: number | null
}

type Resize = {
  pointerId: number
  initialClientX: number
  initialClientY: number
  initialWidth: number
  initialHeight: number
  nextWidth: number
  nextHeight: number
  frame: number | null
}

const COLORS = [
  '#fff9c4',
  '#dff9e8',
  '#dff7fc',
  '#f0dfff',
  '#ffe3df',
  '#ffffff',
]
const EMOJIS = ['👍', '❤️', '⭐', '🎉', '👀', '😕']
const MIN_WIDTH = 230
const MAX_WIDTH = 680
const MIN_HEIGHT = 190
const MAX_HEIGHT = 780
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const noteId = () => `sticky-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

function loadNotes(scope: string): StickyCanvasNote[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(scope) ?? '[]')
    if (!Array.isArray(saved)) return []

    return saved.flatMap((value): StickyCanvasNote[] => {
      if (!value || typeof value !== 'object') return []
      const record = value as Record<string, unknown>
      if (
        typeof record.id !== 'string' ||
        typeof record.content !== 'string' ||
        typeof record.x !== 'number' || !Number.isFinite(record.x) ||
        typeof record.y !== 'number' || !Number.isFinite(record.y)
      ) return []

      const tags = Array.isArray(record.tags)
        ? record.tags.filter((v): v is string => typeof v === 'string').slice(0, 20)
        : []
      const reactions: Record<string, number> = {}
      if (record.reactions && typeof record.reactions === 'object' && !Array.isArray(record.reactions)) {
        for (const [emoji, count] of Object.entries(record.reactions)) {
          if (EMOJIS.includes(emoji) && typeof count === 'number' && Number.isFinite(count)) {
            reactions[emoji] = clamp(Math.floor(count), 0, 999)
          }
        }
      }
      const comments = Array.isArray(record.comments)
        ? record.comments.flatMap((item): NonNullable<StickyCanvasNote['comments']> => {
            if (!item || typeof item !== 'object') return []
            const c = item as Record<string, unknown>
            if (typeof c.id !== 'string' || typeof c.text !== 'string') return []
            return [{ id: c.id, text: c.text, createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now() }]
          }).slice(0, 100)
        : []

      return [{
        id: record.id,
        x: record.x,
        y: record.y,
        width: typeof record.width === 'number' && Number.isFinite(record.width)
          ? clamp(record.width, MIN_WIDTH, MAX_WIDTH) : 330,
        height: typeof record.height === 'number' && Number.isFinite(record.height)
          ? clamp(record.height, MIN_HEIGHT, MAX_HEIGHT) : 255,
        color: typeof record.color === 'string' && COLORS.includes(record.color)
          ? record.color : COLORS[0],
        content: record.content,
        tags,
        reactions,
        pinned: record.pinned === true,
        align: record.align === 'left' ? 'left' : 'center',
        comments,
      }]
    })
  } catch {
    return []
  }
}

const iconButton =
  'grid size-9 shrink-0 place-items-center rounded-xl text-[#373737] dark:text-[#f3f4f6] transition-colors hover:bg-[#f2f2f2] dark:hover:bg-[#1f2937] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400'

function NoteItem({
  note,
  zoom,
  selected,
  onSelect,
  onPatch,
  onDuplicate,
  onDelete,
}: {
  note: StickyCanvasNote
  zoom: number
  selected: boolean
  onSelect: (id: string) => void
  onPatch: (id: string, patch: NotePatch) => void
  onDuplicate: (note: StickyCanvasNote) => void
  onDelete: (id: string) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const resizeRef = useRef<Resize | null>(null)
  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null)
  const pendingResizeRef = useRef<{ width: number; height: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [popover, setPopover] = useState<Popover>(null)
  const [searchText, setSearchText] = useState('')
  const [tagText, setTagText] = useState('')
  const [mentionText, setMentionText] = useState('')
  const [commentText, setCommentText] = useState('')

  useLayoutEffect(() => {
    const position = pendingMoveRef.current
    if (position && !dragRef.current && Math.abs(position.x - note.x) < 0.01 && Math.abs(position.y - note.y) < 0.01) {
      if (rootRef.current) {
        rootRef.current.style.transform = ''
        rootRef.current.style.willChange = ''
      }
      pendingMoveRef.current = null
    }
    const size = pendingResizeRef.current
    if (size && !resizeRef.current && Math.abs(size.width - note.width) < 0.01 && Math.abs(size.height - (note.height ?? 255)) < 0.01) {
      if (rootRef.current) {
        rootRef.current.style.width = `${note.width}px`
        rootRef.current.style.height = `${note.height ?? 255}px`
      }
      pendingResizeRef.current = null
    }
  }, [note.x, note.y, note.width, note.height])

  useEffect(() => () => {
    if (dragRef.current?.frame != null) cancelAnimationFrame(dragRef.current.frame)
    if (resizeRef.current?.frame != null) cancelAnimationFrame(resizeRef.current.frame)
  }, [])

  const openPopover = (value: Exclude<Popover, null>) => {
    onSelect(note.id)
    setPopover(current => current === value ? null : value)
  }

  const beginEdit = () => {
    onSelect(note.id)
    setDraft(note.content)
    setPopover(null)
    setEditing(true)
  }

  const finishEdit = () => {
    onPatch(note.id, { content: draft })
    setEditing(false)
  }

  const applyFormatting = (before: string, after = before, placeholder = 'text') => {
    const input = editorRef.current
    if (!input) return
    const from = input.selectionStart
    const to = input.selectionEnd
    const content = input.value
    const selection = content.slice(from, to) || placeholder
    const replacement = before + selection + after
    setDraft(content.slice(0, from) + replacement + content.slice(to))
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(from + before.length, from + before.length + selection.length)
    })
  }

  const addTag = () => {
    const clean = tagText.trim().replace(/^#/, '').slice(0, 35)
    if (!clean) return
    onPatch(note.id, { tags: [...new Set([...(note.tags ?? []), clean])].slice(0, 20) })
    setTagText('')
  }

  const addMention = () => {
    const value = mentionText.trim().replace(/^@/, '').replace(/\s+/g, '').slice(0, 50)
    if (!value) return
    if (editing) setDraft(current => current + ` @${value}`)
    else onPatch(note.id, { content: `${note.content}${note.content ? '\n' : ''}@${value}` })
    setMentionText('')
    setPopover(null)
  }

  const toggleReaction = (emoji: string) => {
    const next = { ...(note.reactions ?? {}) }
    // One click adds one local reaction. Click its badge again to remove one.
    next[emoji] = (next[emoji] ?? 0) + 1
    onPatch(note.id, { reactions: next })
    setPopover(null)
  }

  const removeReaction = (emoji: string) => {
    const next = { ...(note.reactions ?? {}) }
    next[emoji] = Math.max(0, (next[emoji] ?? 0) - 1)
    onPatch(note.id, { reactions: next })
  }

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || editing || note.pinned) return
    if ((event.target as HTMLElement).closest('button, input, textarea')) return
    event.preventDefault()
    event.stopPropagation()
    onSelect(note.id)
    setPopover(null)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      initialClientX: event.clientX,
      initialClientY: event.clientY,
      initialX: note.x,
      initialY: note.y,
      nextX: note.x,
      nextY: note.y,
      frame: null,
    }
    if (rootRef.current) rootRef.current.style.willChange = 'transform'
  }

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const scale = Math.max(zoom, 0.05)
    drag.nextX = drag.initialX + (event.clientX - drag.initialClientX) / scale
    drag.nextY = drag.initialY + (event.clientY - drag.initialClientY) / scale
    if (drag.frame === null) {
      drag.frame = requestAnimationFrame(() => {
        if (dragRef.current !== drag) return
        drag.frame = null
        if (rootRef.current) rootRef.current.style.transform =
          `translate3d(${drag.nextX - drag.initialX}px, ${drag.nextY - drag.initialY}px, 0)`
      })
    }
  }

  const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (drag.frame !== null) cancelAnimationFrame(drag.frame)
    const scale = Math.max(zoom, 0.05)
    drag.nextX = drag.initialX + (event.clientX - drag.initialClientX) / scale
    drag.nextY = drag.initialY + (event.clientY - drag.initialClientY) / scale
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (drag.nextX === note.x && drag.nextY === note.y) {
      if (rootRef.current) {
        rootRef.current.style.transform = ''
        rootRef.current.style.willChange = ''
      }
      return
    }
    if (rootRef.current) rootRef.current.style.transform =
      `translate3d(${drag.nextX - drag.initialX}px, ${drag.nextY - drag.initialY}px, 0)`
    pendingMoveRef.current = { x: drag.nextX, y: drag.nextY }
    onPatch(note.id, { x: drag.nextX, y: drag.nextY })
  }

  const cancelDrag = () => {
    const drag = dragRef.current
    if (!drag) return
    if (drag.frame !== null) cancelAnimationFrame(drag.frame)
    dragRef.current = null
    if (rootRef.current) {
      rootRef.current.style.transform = ''
      rootRef.current.style.willChange = ''
    }
  }

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || note.pinned) return
    event.preventDefault()
    event.stopPropagation()
    onSelect(note.id)
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeRef.current = {
      pointerId: event.pointerId,
      initialClientX: event.clientX,
      initialClientY: event.clientY,
      initialWidth: note.width,
      initialHeight: note.height ?? 255,
      nextWidth: note.width,
      nextHeight: note.height ?? 255,
      frame: null,
    }
  }

  const resizeMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = resizeRef.current
    if (!session || session.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    const scale = Math.max(zoom, 0.05)
    session.nextWidth = clamp(session.initialWidth + (event.clientX - session.initialClientX) / scale, MIN_WIDTH, MAX_WIDTH)
    session.nextHeight = clamp(session.initialHeight + (event.clientY - session.initialClientY) / scale, MIN_HEIGHT, MAX_HEIGHT)
    if (session.frame === null) {
      session.frame = requestAnimationFrame(() => {
        if (resizeRef.current !== session) return
        session.frame = null
        if (rootRef.current) {
          rootRef.current.style.width = `${session.nextWidth}px`
          rootRef.current.style.height = `${session.nextHeight}px`
        }
      })
    }
  }

  const stopResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = resizeRef.current
    if (!session || session.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (session.frame !== null) cancelAnimationFrame(session.frame)
    const scale = Math.max(zoom, 0.05)
    session.nextWidth = clamp(session.initialWidth + (event.clientX - session.initialClientX) / scale, MIN_WIDTH, MAX_WIDTH)
    session.nextHeight = clamp(session.initialHeight + (event.clientY - session.initialClientY) / scale, MIN_HEIGHT, MAX_HEIGHT)
    resizeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    pendingResizeRef.current = { width: session.nextWidth, height: session.nextHeight }
    onPatch(note.id, { width: session.nextWidth, height: session.nextHeight })
  }

  const occurrences = searchText.trim()
    ? note.content.toLowerCase().split(searchText.trim().toLowerCase()).length - 1
    : 0

  const popoverContent = () => {
    if (!popover) return null
    if (popover === 'search') return (
      <div className="space-y-2">
        <label className="flex items-center gap-2 rounded-lg bg-[#f5f5f5] dark:bg-[#1f2937] px-3 py-2">
          <Search size={16} className="text-[#4b5563] dark:text-[#999]" />
          <input autoFocus value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="Find in note..." className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </label>
        <p className="text-xs text-[#888] dark:text-[#b8bec7]">{searchText.trim() ? `${occurrences} match${occurrences === 1 ? '' : 'es'} in this note` : 'Search this note’s Markdown text'}</p>
      </div>
    )
    if (popover === 'tags') return (
      <div className="space-y-3">
        <p className="text-xs font-semibold text-[#555] dark:text-[#b8bec7]">Tags</p>
        <div className="flex flex-wrap gap-1.5">
          {(note.tags ?? []).map(tag => (
            <button type="button" key={tag} onClick={() => onPatch(note.id, { tags: (note.tags ?? []).filter(t => t !== tag) })}
              title="Remove tag" className="rounded-lg bg-[#f2f2f2] dark:bg-[#1f2937] px-2 py-1 text-xs text-[#555] dark:text-[#b8bec7]">#{tag} ×</button>
          ))}
        </div>
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); addTag() }}>
          <input autoFocus value={tagText} onChange={e => setTagText(e.target.value)} placeholder="New tag" maxLength={35}
            className="min-w-0 flex-1 rounded-lg border border-[#ddd] dark:border-[#374151] px-2.5 py-2 text-sm outline-none focus:border-violet-400" />
          <button type="submit" className="rounded-lg bg-[#f8fafc] dark:bg-[#27272a] px-3 text-xs text-gray-900 dark:text-white">Add</button>
        </form>
      </div>
    )
    if (popover === 'mention') return (
      <form className="space-y-2" onSubmit={e => { e.preventDefault(); addMention() }}>
        <p className="text-xs font-semibold text-[#555] dark:text-[#b8bec7]">Insert mention</p>
        <div className="flex gap-2">
          <input autoFocus value={mentionText} onChange={e => setMentionText(e.target.value)} placeholder="@username" maxLength={50}
            className="min-w-0 flex-1 rounded-lg border border-[#ddd] dark:border-[#374151] px-2.5 py-2 text-sm outline-none focus:border-violet-400" />
          <button type="submit" className="rounded-lg bg-[#f8fafc] dark:bg-[#27272a] px-3 text-xs text-gray-900 dark:text-white">Insert</button>
        </div>
        <p className="text-[11px] text-[#4b5563] dark:text-[#999]">Mentions are text only; no notifications are sent.</p>
      </form>
    )
    if (popover === 'reactions') return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-[#555] dark:text-[#b8bec7]">Add a reaction</p>
        <div className="flex items-center gap-1">{EMOJIS.map(emoji => (
          <button key={emoji} type="button" onClick={() => toggleReaction(emoji)} title={`React ${emoji}`}
            className="grid size-9 place-items-center rounded-lg text-[20px] hover:bg-[#f4f4f4] dark:hover:bg-[#1f2937]">{emoji}</button>
        ))}</div>
      </div>
    )
    if (popover === 'palette') return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-[#555] dark:text-[#b8bec7]">Note color</p>
        <div className="flex gap-2">{COLORS.map(color => (
          <button key={color} type="button" aria-label={`Set note color ${color}`} onClick={() => { onPatch(note.id, { color }); setPopover(null) }}
            className={`size-8 rounded-full border border-black/15 ${color === note.color ? 'ring-2 ring-[#d1d5db] dark:ring-[#4a4a4a] ring-offset-2' : ''}`} style={{ backgroundColor: color }} />
        ))}</div>
      </div>
    )
    if (popover === 'comments') return (
      <div className="space-y-3">
        <p className="text-xs font-semibold text-[#555] dark:text-[#b8bec7]">Comments (this browser)</p>
        <div className="max-h-36 space-y-2 overflow-y-auto">
          {(note.comments ?? []).map(c => (
            <div key={c.id} className="rounded-lg bg-[#f7f7f7] dark:bg-[#1f2937] p-2 text-xs text-[#555] dark:text-[#b8bec7]">
              <div className="mb-1 text-[10px] text-[#4b5563] dark:text-[#999]">{new Date(c.createdAt).toLocaleString()}</div>
              <p className="whitespace-pre-wrap break-words">{c.text}</p>
            </div>
          ))}
          {!note.comments?.length && <p className="text-xs text-[#4b5563] dark:text-[#999]">No comments yet.</p>}
        </div>
        <form onSubmit={e => {
          e.preventDefault()
          if (!commentText.trim()) return
          onPatch(note.id, { comments: [...(note.comments ?? []), { id: noteId(), text: commentText.trim(), createdAt: Date.now() }] })
          setCommentText('')
        }} className="flex gap-2">
          <input autoFocus value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Write a comment..." maxLength={1000}
            className="min-w-0 flex-1 rounded-lg border border-[#ddd] dark:border-[#374151] px-2.5 py-2 text-xs outline-none focus:border-violet-400" />
          <button type="submit" className="rounded-lg bg-[#f8fafc] dark:bg-[#27272a] px-3 text-xs text-gray-900 dark:text-white">Post</button>
        </form>
      </div>
    )
    return (
      <div className="space-y-1">
        <button type="button" className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm hover:bg-[#f6f6f6] dark:hover:bg-[#1f2937]" onClick={() => { onPatch(note.id, { pinned: !note.pinned }); setPopover(null) }}>
          <Pin size={15} /> {note.pinned ? 'Unpin note' : 'Pin note'}
        </button>
        <button type="button" className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm hover:bg-[#f6f6f6] dark:hover:bg-[#1f2937]" onClick={() => { onPatch(note.id, { align: note.align === 'left' ? 'center' : 'left' }); setPopover(null) }}>
          {note.align === 'left' ? <AlignCenter size={15} /> : <AlignLeft size={15} />} Align {note.align === 'left' ? 'center' : 'left'}
        </button>
        <button type="button" className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm hover:bg-[#f6f6f6] dark:hover:bg-[#1f2937]" onClick={() => { setPopover('palette') }}>
          <Palette size={15} /> Change color
        </button>
        <button type="button" className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm hover:bg-[#f6f6f6] dark:hover:bg-[#1f2937]" onClick={() => { setPopover('comments') }}>
          <MessageCircle size={15} /> Comments ({note.comments?.length ?? 0})
        </button>
        <button type="button" className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm hover:bg-[#f6f6f6] dark:hover:bg-[#1f2937]" onClick={() => { onDuplicate(note); setPopover(null) }}>
          <Copy size={15} /> Duplicate
        </button>
        <button type="button" className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm hover:bg-[#f6f6f6] dark:hover:bg-[#1f2937]" onClick={() => { if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(note.content).catch(() => {}); setPopover(null) }}>
          <Code2 size={15} /> Copy Markdown
        </button>
        <div className="my-1 border-t border-[#eee] dark:border-[#374151]" />
        <button type="button" className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40" onClick={() => onDelete(note.id)}>
          <Trash2 size={15} /> Delete note
        </button>
      </div>
    )
  }

  return (
    <div ref={rootRef} tabIndex={0} aria-label="Sticky note"
      className="nodrag nopan nowheel pointer-events-auto group absolute select-none outline-none"
      style={{
        left: note.x,
        top: note.y,
        width: note.width,
        height: note.height ?? 255,
        zIndex: selected ? 100 : 5,
      }}
      onPointerDown={event => {
        event.stopPropagation()
        if (!(event.target as HTMLElement).closest('input, textarea, button, a')) event.currentTarget.focus({ preventScroll: true })
        onSelect(note.id)
      }}
      onKeyDown={event => {
        if (editing || (event.target as HTMLElement).closest('input, textarea')) return
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault()
          event.stopPropagation()
          onDelete(note.id)
        }
      }}
    >
      {selected && (
        <div className="nodrag nopan nowheel pointer-events-auto absolute left-1/2 z-30 flex items-center gap-1 rounded-2xl border border-[#e6e6e6] dark:border-[#374151] bg-white dark:bg-cl-dark-panel p-1.5 shadow-[0_7px_25px_rgba(0,0,0,0.10)]"
          style={{ top: -12 / Math.max(zoom, 0.05), transform: `translate(-50%, -100%) scale(${1 / Math.max(zoom, 0.05)})`, transformOrigin: 'center bottom' }}
          onPointerDown={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()}
        >
          <button type="button" className={iconButton} title="Find in note" aria-label="Find in note" onClick={() => openPopover('search')}><Search size={18} /></button>
          <div className="h-7 w-px bg-[#ececec] dark:bg-[#1f2937]" />
          <button type="button" className={iconButton} title="Tags" aria-label="Tags" onClick={() => openPopover('tags')}><Tag size={18} /></button>
          <button type="button" className={iconButton} title="Mention" aria-label="Mention" onClick={() => openPopover('mention')}><AtSign size={18} /></button>
          <button type="button" className={iconButton} title="Reactions" aria-label="Reactions" onClick={() => openPopover('reactions')}><SmilePlus size={18} /></button>
          <button type="button" className={iconButton} title="More actions" aria-label="More actions" onClick={() => openPopover('more')}><MoreHorizontal size={18} /></button>
          {popover && (
            <div className="nodrag nopan nowheel pointer-events-auto absolute right-0 top-[calc(100%+8px)] z-40 w-[280px] max-w-[70vw] rounded-xl border border-[#e5e5e5] dark:border-[#374151] bg-white dark:bg-cl-dark-panel p-3 text-left text-[#282828] dark:text-[#f3f4f6] shadow-[0_12px_28px_rgba(0,0,0,0.14)]" onPointerDown={event => event.stopPropagation()}>
              <button type="button" aria-label="Close note menu" className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md text-[#4b5563] dark:text-[#999] hover:bg-[#f4f4f4] dark:hover:bg-[#1f2937]" onClick={() => setPopover(null)}><X size={13} /></button>
              <div className="pr-2">{popoverContent()}</div>
            </div>
          )}
        </div>
      )}

      {note.pinned && (
        <div className="pointer-events-none absolute -right-4 -top-4 z-20 grid size-10 place-items-center rounded-full border-2 border-[#e6b34d] bg-[#ffdf88] dark:bg-[#52472c] text-[#b8730b] shadow-sm">
          <Star size={23} fill="none" strokeWidth={2.2} />
        </div>
      )}

      <div className="relative flex size-full flex-col overflow-hidden rounded-[17px] border-[1.5px] shadow-[0_5px_18px_rgba(0,0,0,0.065)]"
        style={{ backgroundColor: note.color, borderColor: selected ? '#454545' : '#d1c7b3' }}>
        <div className={`nodrag nopan flex h-8 shrink-0 touch-none items-center justify-center rounded-t-[17px] ${note.pinned ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
          onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={stopDrag}
          onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} title="Drag note">
          <GripHorizontal size={21} className={`text-[#555] dark:text-[#b8bec7] transition-opacity ${selected ? 'opacity-40' : 'opacity-0 group-hover:opacity-40'}`} />
        </div>

        {editing ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-white dark:bg-cl-dark-panel/75 p-1">
              <button type="button" className={iconButton} title="Heading" onClick={() => applyFormatting('## ', '', 'Heading')}><Hash size={16} /></button>
              <button type="button" className={iconButton} title="Bold" onClick={() => applyFormatting('**')}><Bold size={16} /></button>
              <button type="button" className={iconButton} title="Italic" onClick={() => applyFormatting('*')}><Italic size={16} /></button>
              <button type="button" className={iconButton} title="List" onClick={() => applyFormatting('- ', '', 'Item')}><List size={16} /></button>
              <button type="button" className={iconButton} title="Link" onClick={() => applyFormatting('[', '](https://example.com)', 'link')}><Link2 size={16} /></button>
              <button type="button" className={iconButton} title="Inline code" onClick={() => applyFormatting('`')}><Code2 size={16} /></button>
            </div>
            <textarea ref={editorRef} autoFocus spellCheck value={draft} onChange={event => setDraft(event.target.value)}
              onPointerDown={event => event.stopPropagation()}
              onKeyDown={event => {
                event.stopPropagation()
                if (event.key === 'Escape') setEditing(false)
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') finishEdit()
              }}
              className="nodrag nowheel min-h-0 flex-1 resize-none select-text rounded-lg border border-black/15 bg-white dark:bg-cl-dark-panel/90 p-2.5 font-mono text-[13px] leading-[1.6] outline-none focus:border-[#a78bfa]" />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-[#777] dark:text-[#b8bec7]">Markdown · Ctrl+Enter to save</span>
              <div className="flex gap-1.5">
                <button type="button" className="rounded-lg px-2 py-1.5 text-xs hover:bg-black/5" onClick={() => setEditing(false)}>Cancel</button>
                <button type="button" className="flex items-center gap-1 rounded-lg bg-[#f8fafc] dark:bg-[#2b2b2b] px-2.5 py-1.5 text-xs text-gray-900 dark:text-white" onClick={finishEdit}><Check size={14} /> Save</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="nodrag nopan nowheel min-h-0 flex-1 cursor-text overflow-auto px-5 pb-2 pt-2 [scrollbar-width:thin]"
            title="Double click to edit Markdown" onDoubleClick={event => { event.stopPropagation(); beginEdit() }}>
            <div className={`select-text break-words text-[17px] leading-[1.45] text-[#5d6269] dark:text-[#b8bec7] ${note.align === 'left' ? 'text-left' : 'text-center'}
              [&_h1]:mb-2 [&_h1]:text-[27px] [&_h1]:font-semibold [&_h1]:leading-tight
              [&_h2]:mb-2 [&_h2]:text-[23px] [&_h2]:font-semibold [&_h2]:leading-tight
              [&_h3]:mb-2 [&_h3]:text-[20px] [&_h3]:font-semibold
              [&_p]:mb-2 [&_p:last-child]:mb-0
              [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5
              [&_li]:my-0.5 [&_li]:text-left [&_blockquote]:my-2 [&_blockquote]:border-l-[3px] [&_blockquote]:border-[#d1d5db] dark:border-[#777]/40 [&_blockquote]:pl-3 [&_blockquote]:italic
              [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-2
              [&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:text-[0.87em]
              [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/10 [&_pre]:p-2 [&_pre]:text-left [&_pre_code]:bg-transparent
              [&_hr]:my-3 [&_hr]:border-[#d1d5db] dark:border-[#666]/30 [&_table]:my-2 [&_table]:w-full [&_table]:text-left [&_th]:border [&_th]:p-1 [&_td]:border [&_td]:p-1
              [&_input]:mr-1 [&_img]:mx-auto [&_img]:max-h-36 [&_img]:max-w-full [&_img]:rounded-md`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
                a: ({ href, children }) => <a href={href} rel="noopener noreferrer" target="_blank" onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>{children}</a>,
              }}>{note.content}</ReactMarkdown>
            </div>
          </div>
        )}

        {!editing && (note.tags?.length ?? 0) > 0 && (
          <div className="flex max-h-12 shrink-0 flex-wrap items-center gap-1 overflow-hidden px-4 pb-1.5">
            {(note.tags ?? []).map(tag => <span key={tag} className="rounded-full bg-white dark:bg-cl-dark-panel/70 px-2 py-0.5 text-[11px] font-medium text-[#666] dark:text-[#b8bec7]">#{tag}</span>)}
          </div>
        )}
        {!editing && (note.comments?.length ?? 0) > 0 && (
          <button type="button" title="View comments" onClick={() => openPopover('comments')} className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-white dark:bg-cl-dark-panel/70 px-2 py-1 text-[11px] text-[#666] dark:text-[#b8bec7] hover:bg-white dark:hover:bg-cl-dark-panel"><MessageCircle size={13} /> {note.comments?.length}</button>
        )}
      </div>

      {!editing && Object.entries(note.reactions ?? {}).some(([, value]) => value > 0) && (
        <div className="nodrag nopan pointer-events-auto absolute -bottom-4 left-3 z-10 flex flex-wrap items-center gap-1" onPointerDown={event => event.stopPropagation()}>
          {Object.entries(note.reactions ?? {}).filter(([, value]) => value > 0).map(([emoji, count]) => (
            <button key={emoji} type="button" title="Remove one reaction" onClick={() => removeReaction(emoji)} className="flex items-center gap-1 rounded-full border border-[#ddd] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-1.5 py-0.5 text-[17px] shadow-sm">
              {emoji}<span className="text-[11px] font-semibold text-[#777] dark:text-[#b8bec7]">{count}</span>
            </button>
          ))}
        </div>
      )}

      {selected && !editing && !note.pinned && (
        <button type="button" title="Resize note" aria-label="Resize note" className="nodrag nopan pointer-events-auto absolute -bottom-1 -right-1 z-20 flex size-6 touch-none cursor-nwse-resize items-center justify-center rounded-md bg-white dark:bg-cl-dark-panel/85 text-[#666] dark:text-[#b8bec7] shadow-sm"
          onPointerDown={beginResize} onPointerMove={resizeMove} onPointerUp={stopResize}
          onPointerCancel={() => { resizeRef.current = null }}>
          <span className="select-none text-[15px] leading-none">◢</span>
        </button>
      )}
    </div>
  )
}

const StickyNoteItem = memo(NoteItem)

export const CanvasStickyNotes = forwardRef<CanvasStickyNotesHandle, Props>(
  function CanvasStickyNotes({ scope, zoom, searchOpen = false }, ref) {
    const [noteState, setNoteState] = useState<{ scope: string; notes: StickyCanvasNote[] }>(
      () => ({ scope, notes: loadNotes(scope) }),
    )
    const [activeId, setActiveId] = useState<string | null>(null)

    useEffect(() => {
      setNoteState(previous => {
        if (previous.scope === scope) return previous
        const stored = loadNotes(scope)
        const switchingDraftToSaved = previous.scope.includes(':draft:') && !scope.includes(':draft:')
        return { scope, notes: switchingDraftToSaved && stored.length === 0 ? previous.notes : stored }
      })
      setActiveId(null)
    }, [scope])

    useEffect(() => {
      try {
        localStorage.setItem(noteState.scope, JSON.stringify(noteState.notes))
      } catch {
        // Local notes are still usable when browser storage is unavailable.
      }
    }, [noteState])

    const updateNotes = useCallback((apply: (notes: StickyCanvasNote[]) => StickyCanvasNote[]) => {
      setNoteState(previous => previous.scope === scope
        ? { ...previous, notes: apply(previous.notes) }
        : previous,
      )
    }, [scope])

    const patchNote = useCallback((id: string, patch: NotePatch) => {
      updateNotes(previous => previous.map(note => note.id === id ? { ...note, ...patch } : note))
    }, [updateNotes])

    const removeNote = useCallback((id: string) => {
      updateNotes(previous => previous.filter(note => note.id !== id))
      setActiveId(current => current === id ? null : current)
    }, [updateNotes])

    const duplicateNote = useCallback((original: StickyCanvasNote) => {
      const copy: StickyCanvasNote = { ...original, id: noteId(), x: original.x + 35, y: original.y + 35,
        tags: [...(original.tags ?? [])], reactions: { ...(original.reactions ?? {}) },
        comments: [...(original.comments ?? [])], pinned: false, }
      updateNotes(previous => [...previous, copy])
      setActiveId(copy.id)
    }, [updateNotes])

    useImperativeHandle(ref, () => ({
      addNote(position) {
        const note: StickyCanvasNote = {
          id: noteId(), x: position.x, y: position.y, width: 330, height: 255,
          color: COLORS[0], content: '## I’m a note\n**Double-click** to edit with Markdown.',
          tags: [], reactions: {}, pinned: false, align: 'center', comments: [],
        }
        updateNotes(previous => [...previous, note])
        setActiveId(note.id)
      },
      clearSelection() { setActiveId(null) },
    }), [updateNotes])

    useEffect(() => {
      const handleDelete = (event: KeyboardEvent) => {
        if (!activeId || searchOpen || event.ctrlKey || event.metaKey) return
        if (!['Delete', 'Backspace'].includes(event.key)) return
        if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return
        event.preventDefault()
        event.stopImmediatePropagation()
        removeNote(activeId)
      }
      window.addEventListener('keydown', handleDelete, true)
      return () => window.removeEventListener('keydown', handleDelete, true)
    }, [activeId, searchOpen, removeNote])

    const notes = noteState.scope === scope ? noteState.notes : []

    return (
      <ViewportPortal>
        {notes.map(note => (
          <StickyNoteItem key={note.id} note={note} zoom={zoom} selected={note.id === activeId}
            onSelect={setActiveId} onPatch={patchNote} onDuplicate={duplicateNote} onDelete={removeNote} />
        ))}
      </ViewportPortal>
    )
  },
)
