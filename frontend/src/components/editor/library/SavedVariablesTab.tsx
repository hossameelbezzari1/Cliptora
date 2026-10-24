import { useMemo, useState } from 'react'
import { api } from '../../../lib/api'
import { Braces, Check, Clock3, Copy, Database, Edit3, Hash, Palette, RefreshCw, Trash2, Type, Variable } from 'lucide-react'
import type { SmartLibraryModel, LibraryItem } from './useSmartLibrary'
import type { VariableType } from '../../../lib/variables'

function getString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const iconFor = (type: string) => type === 'number' || type === 'percentage' ? Hash
  : type === 'color' ? Palette : type === 'boolean' ? Variable
  : type === 'date' || type === 'datetime' || type === 'duration' ? Clock3
  : type === 'json' ? Braces : Type

export function SavedVariablesTab({ library, search, onTest }: {
  library: SmartLibraryModel
  search: string
  onTest: (name: string) => void
}) {
  const [copied, setCopied] = useState('')
  const [duplicating, setDuplicating] = useState<number | null>(null)
  const { all, busy, refresh, remove, setName, setValue, setVarType, setError } = library
  const saved = useMemo(() => all.filter(item => item.kind === 'variable')
    .filter(item => `${item.name} ${getString(item.payload.value)} ${getString(item.payload.type)}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => b.id - a.id), [all, search])
  const total = all.filter(item => item.kind === 'variable').length

  const uniqueCopyName = (base: string) => {
    const taken = new Set(all.filter(item => item.kind === 'variable').map(item => item.name.toLowerCase()))
    let candidate = `${base}_copy`
    let index = 2
    while (taken.has(candidate.toLowerCase())) { candidate = `${base}_copy_${index}`; index += 1 }
    return candidate
  }

  const editCopy = (item: LibraryItem) => {
    setName(uniqueCopyName(item.name))
    setVarType((item.payload.type ?? 'string') as VariableType)
    setValue(getString(item.payload.value))
    document.getElementById('cl-new-variable-name')?.focus()
  }

  const duplicate = async (item: LibraryItem) => {
    if (duplicating !== null) return
    setDuplicating(item.id)
    try {
      await api('/library', { method: 'POST', body: JSON.stringify({
        kind: 'variable', name: uniqueCopyName(item.name), parent_id: item.parent_id,
        payload: { ...item.payload },
      }) })
      await refresh()
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Could not duplicate variable')
    } finally {
      setDuplicating(null)
    }
  }

  const copy = async (name: string) => {
    const reference = `{{${name}}}`
    try { await navigator.clipboard.writeText(reference); setCopied(name) } catch { /* clipboard may be disabled */ }
  }

  return <section className="min-w-0 rounded-xl border border-[#2d3b4c] bg-[#141e2b] p-3 cl-vars-card">
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#a05dfc] to-[#6438d6]"><Database size={15}/></span>
        <h3 className="truncate text-[13px] font-semibold text-white">Saved Variables <span className="ml-1 rounded-full bg-[#302d4f] px-2 py-0.5 text-[10px] text-[#d7c6ff]">{total}</span></h3>
      </div>
      <button type="button" onClick={() => { void refresh() }} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#354359] bg-[#1b2737] px-2.5 py-1.5 text-[10px] text-[#cbd6e6]"><RefreshCw size={13}/> Refresh</button>
    </div>
    <p className="mb-3 text-[10px] text-[#94a3ba]">Your custom global variables are stored in MySQL.</p>
    <div className="min-w-0 overflow-x-auto rounded-lg border border-[#2f3d50]">
      <table className="w-full min-w-[340px] border-collapse text-left text-[10px]">
        <thead><tr className="bg-[#1d2b3c] text-[#b6c8e2]"><th className="px-2 py-2 font-medium">Name</th><th className="px-2 py-2 font-medium">Type</th><th className="px-2 py-2 font-medium">Value</th><th className="px-2 py-2 text-right font-medium">Actions</th></tr></thead>
        <tbody>
          {saved.map(item => {
            const type = getString(item.payload.type || 'string')
            const Icon = iconFor(type)
            const displayed = getString(item.payload.value)
            return <tr key={item.id} className="border-t border-[#2c3949] bg-[#131e2a] text-[#e2ebf7] hover:bg-[#1c293b]">
              <td className="max-w-[150px] px-2 py-2"><button type="button" onClick={() => onTest(item.name)} title={`Test {{${item.name}}}`} className="flex min-w-0 items-center gap-2 text-left hover:text-[#cbb0ff]">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#2d2b4d] text-[#d4b8fe]"><Icon size={14}/></span>
                <span className="truncate font-medium">{item.name}</span>
              </button></td>
              <td className="max-w-20 px-2 py-2 capitalize text-[#aabbd1]">{type}</td>
              <td className="max-w-[150px] px-2 py-2"><span className="block truncate" title={displayed}>{type === 'boolean' ? (item.payload.value ? 'true' : 'false') : displayed || '—'}</span></td>
              <td className="px-1.5 py-1.5"><div className="flex justify-end gap-1">
                <button type="button" onClick={() => editCopy(item)} aria-label={`Edit a copy of ${item.name}`} title="Edit as a new copy" className="rounded-md bg-[#243246] p-1.5 text-[#d5e0f0] hover:bg-[#394965]"><Edit3 size={13}/></button>
                <button type="button" disabled={busy || duplicating !== null} onClick={() => { void duplicate(item) }} aria-label={`Duplicate ${item.name}`} title="Duplicate variable" className="rounded-md bg-[#243246] p-1.5 text-[#d5e0f0] hover:bg-[#394965] disabled:opacity-40"><Copy size={13}/></button>
                <button type="button" onClick={() => { void copy(item.name) }} aria-label={`Copy reference for ${item.name}`} title="Copy variable reference" className="rounded-md bg-[#243246] p-1.5 text-[#d5e0f0] hover:bg-[#394965]">{copied === item.name ? <Check size={13}/> : <Braces size={13}/>}</button>
                <button type="button" disabled={busy} onClick={() => { void remove(item) }} aria-label={`Delete ${item.name}`} title="Delete variable" className="rounded-md bg-[#30232e] p-1.5 text-rose-400 hover:bg-[#4a2c3c] disabled:opacity-40"><Trash2 size={13}/></button>
              </div></td>
            </tr>
          })}
        </tbody>
      </table>
      {saved.length === 0 && <p className="px-3 py-5 text-center text-[11px] text-[#9aaac0]">{search ? 'No saved variables match your search.' : 'No saved variables yet. Create one above.'}</p>}
    </div>
    <p className="mt-2 text-[10px] text-[#8190a6]">Edit fills the creation form with a new copy. Existing items are not overwritten because update support has not been confirmed.</p>
  </section>
}
