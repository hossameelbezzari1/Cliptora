import { useState, type FormEvent } from 'react'
import { Braces, Check, ClipboardCopy, Database, Plus, Save } from 'lucide-react'
import type { VariableType } from '../../../lib/variables'
import { variableTypes, type SmartLibraryModel } from './useSmartLibrary'

const control = 'h-10 w-full min-w-0 rounded-lg border border-[#354459] bg-[#121b27] px-3 text-[12px] text-[#ecf1fa] outline-none placeholder:text-[#7f8a9d] focus:border-[#9567f4] disabled:opacity-50'
const label = 'mb-1.5 block text-[11px] font-medium text-[#b8c4d8]'
const namePattern = /^[_a-zA-Z][\w.]*$/

export function CreateVariableTab({ library }: { library: SmartLibraryModel }) {
  const { name, setName, varType, setVarType, value, setValue, all, busy, save } = library
  const [copied, setCopied] = useState(false)
  const existing = all.some(item => item.kind === 'variable' && item.name.toLowerCase() === name.trim().toLowerCase())
  const validName = namePattern.test(name.trim())
  const validNumber = (varType !== 'number' && varType !== 'percentage') || (value.trim() !== '' && Number.isFinite(Number(value)))
  let validJson = true
  if (varType === 'json' && value.trim()) { try { JSON.parse(value) } catch { validJson = false } }
  const canSave = !busy && validName && !existing && validNumber && validJson
  const preview = validName ? `{{${name.trim()}}}` : '{{variable_name}}'
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSave) return
    const typedValue: unknown = varType === 'boolean' ? value === 'true'
      : (varType === 'number' || varType === 'percentage') ? Number(value)
      : value
    void save('variable', name.trim(), { type: varType, value: typedValue }, null)
  }
  const copyRef = async () => {
    if (!validName) return
    try { await navigator.clipboard.writeText(preview); setCopied(true) } catch { /* no clipboard permission */ }
  }
  const valueField = varType === 'boolean'
    ? <select className={control} value={value === 'true' ? 'true' : 'false'} onChange={event => setValue(event.target.value)}><option value="false">False</option><option value="true">True</option></select>
    : varType === 'color'
      ? <div className="flex min-w-0 gap-2"><input aria-label="Pick a color" type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#7c3aed'} onChange={event => setValue(event.target.value)} className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-[#384557] bg-[#192230] p-1"/><input className={control} value={value} onChange={event => setValue(event.target.value)} placeholder="#7C3AED" /></div>
      : varType === 'json'
        ? <textarea className={`${control} h-20 resize-y py-2 font-mono`} spellCheck={false} value={value} onChange={event => setValue(event.target.value)} placeholder='{"enabled":true}'/>
        : <input className={control}
            type={varType === 'number' || varType === 'percentage' ? 'number' : varType === 'date' ? 'date' : varType === 'datetime' ? 'datetime-local' : varType === 'url' ? 'url' : 'text'}
            step={varType === 'number' || varType === 'percentage' ? 'any' : undefined}
            value={value} onChange={event => setValue(event.target.value)}
            placeholder={varType === 'duration' ? '00:05' : varType === 'url' ? 'https://example.com' : 'Enter value…'}/>

  return <section className="min-w-0 rounded-xl border border-[#2d3b4c] bg-[#141e2b] p-3 cl-vars-card">
    <div className="mb-3 flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#a66bff] to-[#6a36df] text-white"><Plus size={17}/></div>
      <div className="min-w-0">
        <h3 className="text-[14px] font-semibold text-white">Create Variable</h3>
        <p className="mt-0.5 text-[10px] leading-4 text-[#a5b4c9]">Global variable stored in MySQL. Reference with <code>{'{{variable_name}}'}</code>.</p>
      </div>
    </div>
    <form onSubmit={submit} className="space-y-3">
      <div className="cl-vars-form-pair grid min-w-0 grid-cols-1 gap-2.5">
        <label className="min-w-0"><span className={label}>Name</span>
          <input id="cl-new-variable-name" className={`${control} font-mono`} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. brand_color" autoComplete="off" spellCheck={false}/>
        </label>
        <label className="min-w-0"><span className={label}>Type</span>
          <select className={control} value={varType} onChange={event => setVarType(event.target.value as VariableType)}>
            {variableTypes.map(type => <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>)}
          </select>
        </label>
      </div>
      <label className="block min-w-0"><span className={label}>Value</span>{valueField}</label>
      {!validName && name.trim() && <p className="text-[10px] text-amber-300">Name must begin with a letter or _ and contain only letters, numbers, _ or dots.</p>}
      {existing && <p className="text-[10px] text-amber-300">Variable name already exists. Choose a different name.</p>}
      {!validNumber && <p className="text-[10px] text-amber-300">Enter a valid number.</p>}
      {!validJson && <p className="text-[10px] text-amber-300">JSON is invalid.</p>}
      <div className="flex min-w-0 items-center justify-between gap-2 text-[10px] text-[#8293ad]">
        <span className="flex min-w-0 items-center gap-1 truncate font-mono"><Braces size={12}/>{preview}</span>
        <button type="button" disabled={!validName} onClick={() => { void copyRef() }} className="flex shrink-0 items-center gap-1 text-[#c7b1f4] disabled:opacity-40">{copied ? <Check size={13}/> : <ClipboardCopy size={13}/>} Copy ref</button>
      </div>
      <button type="submit" disabled={!canSave}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#854bf4] to-[#773be5] px-3 py-3 text-xs font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
        {busy ? <Database size={15}/> : <Save size={15}/>} {busy ? 'Saving…' : 'Save Variable'}
      </button>
    </form>
  </section>
}
