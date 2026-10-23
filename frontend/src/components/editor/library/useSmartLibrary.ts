import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import { api } from '../../../lib/api'
import { shapes } from '../../../lib/catalog'
import type { VariableType } from '../../../lib/variables'
import { useEditor } from '../../../stores/editorStore'
import type { ClipProperties } from '../../../types'

export type LibraryItemKind = 'component' | 'group' | 'folder' | 'effect' | 'animation' | 'variable'
export type LibraryItem = {
  id: number
  kind: LibraryItemKind
  name: string
  parent_id: number | null
  payload: Record<string, unknown>
}
export type ComponentCategory = 'All' | 'Text' | 'Shapes' | 'Blur' | 'Saved'
export type ComponentView = 'grid' | 'list'
export type CardSize = 'compact' | 'comfortable'

export const fieldClass = 'rounded-md border border-[#333940] bg-[#171a1e] px-2 py-1.5 text-xs text-white outline-none focus:border-[#9060d9]'
export const buttonClass = 'rounded-md border border-[#41464e] px-2 py-1.5 text-xs text-[#d2d4da] hover:bg-[#30343b] disabled:cursor-not-allowed disabled:opacity-40'
export const variableTypes: VariableType[] = [
  'string', 'number', 'boolean', 'color', 'date', 'datetime', 'duration',
  'percentage', 'url', 'media', 'select', 'json',
]

export function useSmartLibrary() {
  const tracks = useEditor(state => state.tracks)
  const selectedClipId = useEditor(state => state.selectedClipId)
  const patchProps = useEditor(state => state.patchProps)
  const patchClip = useEditor(state => state.patchClip)

  const [all, setAll] = useState<LibraryItem[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [name, setName] = useState('')
  const [folder, setFolder] = useState<number | null>(null)
  const [componentCategory, setComponentCategory] = useState<ComponentCategory>('All')
  const [componentView, setComponentView] = useState<ComponentView>('grid')
  const [cardSize, setCardSize] = useState<CardSize>('comfortable')
  const [varType, setVarType] = useState<VariableType>('string')
  const [value, setValue] = useState('')
  const [expression, setExpression] = useState('{{project.title}} — {{now() + 1h}}')

  const clips = useMemo(() => tracks.flatMap(track => track.clips), [tracks])
  const selected = clips.find(clip => clip.client_id === selectedClipId)

  const refresh = useCallback(async () => {
    try {
      setAll(await api<LibraryItem[]>('/library'))
      setError('')
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Cannot load library')
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function save(
    kind: LibraryItemKind,
    label: string,
    payload: Record<string, unknown>,
    parentId: number | null = folder,
  ) {
    if (!label.trim()) return
    setBusy(true)
    try {
      await api('/library', {
        method: 'POST',
        body: JSON.stringify({ kind, name: label.trim(), payload, parent_id: parentId }),
      })
      await refresh()
      setName('')
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove(item: LibraryItem) {
    if (!window.confirm(`Delete ${item.name}?`)) return
    try {
      await api(`/library/${item.id}`, { method: 'DELETE' })
      await refresh()
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Delete failed')
    }
  }

  function apply(item: LibraryItem) {
    if (!selected) {
      setError('Select a clip in Timeline first.')
      return
    }
    if (item.kind === 'effect') {
      patchProps(selected.client_id, {
        effect_stack: [...(selected.props?.effect_stack ?? []), { ...item.payload, name: item.name }],
      })
    }
    if (item.kind === 'animation') {
      patchProps(selected.client_id, {
        animation_stack: [...(selected.props?.animation_stack ?? []), { ...item.payload, name: item.name }],
      })
    }
    if (item.kind === 'component' || item.kind === 'group') {
      const snapshot = item.payload.snapshot as Record<string, unknown> | undefined
      if (snapshot) {
        patchClip(selected.client_id, {
          name: item.name,
          text: typeof snapshot.text === 'string' ? snapshot.text : selected.text,
          color: typeof snapshot.color === 'string' ? snapshot.color : selected.color,
        })
        patchProps(selected.client_id, (snapshot.props ?? {}) as ClipProperties)
      }
    }
  }

  function addShape(shape: typeof shapes[number]) {
    if (!useEditor.getState().addShapeClip(shape)) {
      setError('No free space at playhead. Unlock a layer or create a new layer.')
    }
  }

  function dragShape(event: DragEvent<HTMLButtonElement>, shape: typeof shapes[number]) {
    useEditor.getState().startDrag({ kind: 'shape', shape, duration: 5 })
    event.dataTransfer.setData('application/x-cliptora', `shape:${shape}`)
    event.dataTransfer.setData('text/plain', `cliptora:shape:${shape}`)
    event.dataTransfer.effectAllowed = 'copy'
  }

  const visible = useMemo(() => all.filter(item =>
    item.parent_id === folder && item.kind !== 'folder' &&
    item.name.toLowerCase().includes(search.toLowerCase()),
  ), [all, folder, search])
  const folders = all.filter(item => item.kind === 'folder')
  const currentFolder = all.find(item => item.id === folder)
  const vars = Object.fromEntries(all.filter(item => item.kind === 'variable').map(item => [
    item.name,
    { type: (item.payload.type ?? 'string') as VariableType, value: item.payload.value },
  ]))
  const context = {
    'project.title': 'Current project',
    'project.description': '',
    'project.created_at': '',
    'project.updated_at': '',
    'project.width': 1920,
    'project.height': 1080,
    'project.resolution': '1920×1080',
    'project.fps': 30,
    'project.duration': Math.max(0, ...clips.map(clip => clip.start + clip.duration)),
    'project.clips_count': clips.length,
    'project.layers_count': tracks.length,
    'media.file_name': '',
    'media.extension': '',
    'system.now': new Date().toISOString(),
  }

  return {
    all, error, busy, setError, search, setSearch, name, setName,
    folder, setFolder, componentCategory, setComponentCategory,
    componentView, setComponentView, cardSize, setCardSize,
    varType, setVarType, value, setValue, expression, setExpression,
    selected, clips, tracks, refresh, save, remove, apply, addShape, dragShape,
    visible, folders, currentFolder, vars, context,
  }
}

export type SmartLibraryModel = ReturnType<typeof useSmartLibrary>
