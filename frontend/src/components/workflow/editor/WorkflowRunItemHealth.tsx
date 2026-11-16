import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

type Failure = { id?: string; index?: number; error?: string; instance_id?: string }
export type WorkflowRunNodeHealth = {
  state?: string
  result_status?: string
  partial_result?: boolean
  failed_item_count?: number
  warning?: string
  item_execution?: { completed?: number; failed?: number; executions?: number }
}

export function WorkflowRunItemHealth({
  health,
  failedItems = [],
  onRetry,
}: {
  health: WorkflowRunNodeHealth
  failedItems?: Failure[]
  onRetry?: () => void
}) {
  const [open, setOpen] = useState(false)
  const failed = health.failed_item_count ?? failedItems.length
  const partial = health.partial_result === true || failed > 0 ||
    ['partial', 'invalid', 'limit_reached'].includes(health.result_status ?? '')
  const count = health.item_execution?.executions

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
      <div className="flex items-center gap-2">
        {partial ? <AlertTriangle size={16} className="text-amber-600" /> :
          <CheckCircle2 size={16} className="text-emerald-600" />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{partial ? 'Completed with item issues' : 'Node execution completed'}</p>
          <p className="mt-1 text-slate-500">
            {health.warning ?? `${health.result_status ?? health.state ?? 'completed'}`}
            {typeof count === 'number' ? ` · ${count} executions` : ''}
          </p>
        </div>
        {failedItems.length > 0 && (
          <button type="button" className="rounded-lg p-1 hover:bg-slate-100" onClick={() => setOpen(v => !v)}
            aria-label={open ? 'Hide failed items' : 'Show failed items'}>
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        )}
      </div>
      {open && failedItems.length > 0 && (
        <ul className="mt-2 max-h-52 space-y-1 overflow-auto border-t border-slate-100 pt-2">
          {failedItems.map((item, i) => (
            <li key={`${item.id ?? item.instance_id ?? i}-${i}`} className="rounded-lg bg-amber-50 p-2">
              <span className="font-medium">{item.id ?? item.instance_id ?? `Item ${item.index ?? i + 1}`}</span>
              <p className="mt-1 break-words text-slate-600">{item.error ?? 'Execution failed'}</p>
            </li>
          ))}
        </ul>
      )}
      {partial && onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5">
          Retry via workflow controls
        </button>
      )}
    </section>
  )
}
