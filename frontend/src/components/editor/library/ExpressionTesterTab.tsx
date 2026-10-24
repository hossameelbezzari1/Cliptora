import { useMemo, useState } from 'react'
import { Check, ClipboardCopy, ChevronDown, Play, Sparkles, WandSparkles } from 'lucide-react'
import { interpolateVariables } from '../../../lib/variables'
import type { SmartLibraryModel } from './useSmartLibrary'

const quickExamples = [
  '{{project.title}}',
  '{{project.width}} × {{project.height}}',
  '{{now()}}',
  '{{now() + 1h}}',
  '{{today()}}',
  '{{media.file_name}}',
]

export function ExpressionTesterTab({ library, open, setOpen }: {
  library: SmartLibraryModel
  open: boolean
  setOpen: (next: boolean) => void
}) {
  const { expression, setExpression, vars, context } = library
  const [copied, setCopied] = useState(false)
  const [tested, setTested] = useState(false)
  const result = useMemo(() => {
    try { return { value: interpolateVariables(expression, vars, context), error: '' } }
    catch (exc) { return { value: '', error: exc instanceof Error ? exc.message : 'Expression failed' } }
  }, [expression, vars, context])

  const copy = async () => {
    try { await navigator.clipboard.writeText(result.value); setCopied(true) } catch { /* optional clipboard permission */ }
  }

  return <section className="min-w-0 rounded-xl border border-[#2d3b4c] bg-[#141e2b] p-3 cl-vars-card">
    <div className="mb-2 flex items-start justify-between gap-2">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#945cf8] to-[#6535df]"><Sparkles size={16}/></span>
        <div className="min-w-0"><h3 className="text-[13px] font-semibold text-white">Expression Tester</h3>
          <p className="mt-1 text-[10px] text-[#9eacc2]">Test your variables, date functions and references.</p></div>
      </div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex shrink-0 items-center gap-1 rounded-lg border border-[#344359] bg-[#1c2838] px-2 py-1.5 text-[10px] text-[#ccd7e7]">
        {open ? 'Collapse' : 'Expand'}<ChevronDown size={13} className={open ? 'rotate-180' : ''}/>
      </button>
    </div>
    {open && <div className="mt-3 space-y-3">
      <div className="flex min-w-0 gap-2">
        <input value={expression} onChange={event => { setExpression(event.target.value); setTested(false) }}
          aria-label="Expression to evaluate" spellCheck={false} placeholder="{{project.title}} — {{now() + 1h}}"
          className="h-10 min-w-0 flex-1 rounded-lg border border-[#35455c] bg-[#111b27] px-3 font-mono text-[11px] text-[#f0ecff] outline-none focus:border-[#966afa]"/>
        <button type="button" onClick={() => setTested(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#8248f4] to-[#6e3bdd] px-3 text-[11px] font-semibold text-white hover:brightness-110">
          <Play size={13}/> <span className="hidden sm:inline">Evaluate</span><span className="sm:hidden">Run</span>
        </button>
      </div>
      <div className="rounded-lg border border-[#35465d] bg-[#111b27] px-3 py-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className={`flex items-center gap-1 text-[10px] font-semibold ${result.error ? 'text-rose-300' : 'text-emerald-400'}`}>
            <Check size={13}/> {result.error ? 'Error' : tested ? 'Result evaluated' : 'Live result'}
          </span>
          <button type="button" disabled={!!result.error} onClick={() => { void copy() }} title="Copy result" aria-label="Copy expression result"
            className="rounded-md p-1 text-[#b3bfd0] hover:bg-[#27384e] disabled:opacity-40">
            {copied ? <Check size={13}/> : <ClipboardCopy size={13}/>}
          </button>
        </div>
        <p className={`max-h-24 overflow-y-auto break-all font-mono text-[11px] leading-5 ${result.error ? 'text-rose-300' : 'text-[#edf4fc]'}`}>
          {result.error || result.value || '—'}
        </p>
      </div>
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-[#b4c0d2]"><WandSparkles size={13}/> Quick Examples</p>
        <div className="flex flex-wrap gap-1.5">
          {quickExamples.map(example => <button key={example} type="button" onClick={() => { setExpression(example); setTested(false) }}
            className="rounded-md border border-[#34445b] bg-[#1c293b] px-2 py-1.5 font-mono text-[10px] text-[#cbd7eb] hover:border-[#9668eb] hover:text-white">{example}</button>)}
        </div>
      </div>
    </div>}
  </section>
}
