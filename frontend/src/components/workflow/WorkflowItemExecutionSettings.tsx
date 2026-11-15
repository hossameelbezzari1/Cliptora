import { useMemo, type ReactNode } from 'react'
import { GitBranch, Layers3, Repeat2, Settings2 } from 'lucide-react'

type Settings = Record<string, unknown>

type SourceCollection = {
  path: string
  elements?: number
  label?: string
}

type BodyNodeOption = {
  id: string
  label: string
  type: string
}

type Props = {
  nodeType: string
  nodeId: string
  settings: Settings
  connectedCollections?: SourceCollection[]
  bodyCandidates?: BodyNodeOption[]
  onChange: (patch: Settings) => void
  disabled?: boolean
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function parseValue(value: string): unknown {
  if (value.trim() === '') return null
  try { return JSON.parse(value) } catch { return value }
}

function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-slate-600">
      <span>{title}</span>
      {children}
    </label>
  )
}

const inputClass = 'w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:opacity-60'

export function WorkflowItemExecutionSettings({
  nodeType,
  nodeId,
  settings,
  connectedCollections = [],
  bodyCandidates = [],
  onChange,
  disabled = false,
}: Props) {
  const controller = nodeType === 'items.loop' || nodeType === 'items.repeat_until'
  const repeat = nodeType === 'items.repeat_until'
  const mode = str(settings.execution_mode, 'once')
  const collectionKey = controller ? 'input_path' : 'execution_input_path'
  const collectionValue = str(settings[collectionKey])
  const selectedBody = list(settings.body_node_ids)
  const candidates = useMemo(
    () => bodyCandidates.filter(candidate => candidate.id !== nodeId && !['items.loop', 'items.repeat_until'].includes(candidate.type)),
    [bodyCandidates, nodeId],
  )
  const showItemSettings = !controller && !nodeType.endsWith('trigger') && !['ai.chat_model', 'ai.window_memory'].includes(nodeType)

  if (!controller && !showItemSettings) return null

  const pathControl = (
    <Field title={repeat ? 'Initial Input (optional)' : 'Input Collection'}>
      {connectedCollections.length > 0 ? (
        <select
          className={inputClass}
          value={collectionValue}
          disabled={disabled}
          onChange={e => onChange({ [collectionKey]: e.target.value })}
        >
          <option value="">{repeat ? 'Use initial value below' : 'Select an upstream array'}</option>
          {connectedCollections.map(entry => (
            <option key={entry.path} value={entry.path}>
              {entry.label || entry.path}{typeof entry.elements === 'number' ? ` (${entry.elements} elements)` : ''}
            </option>
          ))}
        </select>
      ) : (
        <input
          className={inputClass}
          disabled={disabled}
          placeholder={repeat ? 'source.value' : 'source.items'}
          value={collectionValue}
          onChange={e => onChange({ [collectionKey]: e.target.value })}
        />
      )}
    </Field>
  )

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 text-slate-800 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <span className="rounded-lg bg-slate-100 p-2 text-slate-600">
          {repeat ? <Repeat2 size={16} /> : controller ? <GitBranch size={16} /> : <Settings2 size={16} />}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{controller ? (repeat ? 'Repeat Until' : 'Loop Over Items') : 'Execution Settings'}</h3>
          <p className="text-xs text-slate-500">{controller ? 'Repeat connected body nodes as a group' : 'Choose how this node processes items'}</p>
        </div>
      </header>

      <div className="space-y-3">
        {!controller && (
          <Field title="Execution Mode">
            <select className={inputClass} disabled={disabled} value={mode} onChange={e => onChange({ execution_mode: e.target.value })}>
              <option value="once">Run Once (legacy)</option>
              <option value="for_each">For Each Item</option>
              <option value="batch">Batch</option>
            </select>
          </Field>
        )}

        {(controller || mode !== 'once') && pathControl}

        {controller && (
          <>
            <div className="rounded-xl border border-slate-200 p-2.5">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-600">
                <Layers3 size={14} /> Body Nodes
              </div>
              {candidates.length ? (
                <div className="max-h-52 space-y-1 overflow-y-auto">
                  {candidates.map(candidate => (
                    <label key={candidate.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={selectedBody.includes(candidate.id)}
                        onChange={e => {
                          const next = e.target.checked
                            ? candidates.filter(item => selectedBody.includes(item.id) || item.id === candidate.id).map(item => item.id)
                            : selectedBody.filter(value => value !== candidate.id)
                          onChange({ body_node_ids: next })
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-700">{candidate.label}</span>
                      <span className="text-[10px] text-slate-400">{candidate.id}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500">Connect body nodes to this controller, then pass graph candidates here.</p>
              )}
            </div>
            {repeat && (
              <>
                <Field title="Initial Value (JSON or text)">
                  <input
                    className={inputClass}
                    disabled={disabled}
                    value={settings.initial_value == null ? '' : typeof settings.initial_value === 'string' ? settings.initial_value : JSON.stringify(settings.initial_value)}
                    onChange={e => onChange({ initial_value: parseValue(e.target.value) })}
                  />
                </Field>
                <Field title="Stop Condition — Body Output Path">
                  <input className={inputClass} disabled={disabled} value={str(settings.condition_path)}
                    placeholder="model.json.finished" onChange={e => onChange({ condition_path: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field title="Operator">
                    <select className={inputClass} disabled={disabled} value={str(settings.condition_operator, 'truthy')}
                      onChange={e => onChange({ condition_operator: e.target.value })}>
                      {['truthy', 'equals', 'not_equals', 'greater_equal', 'less_equal'].map(item => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </Field>
                  <Field title="Expected (JSON)">
                    <input className={inputClass} disabled={disabled}
                      value={settings.condition_value == null ? '' : typeof settings.condition_value === 'string' ? settings.condition_value : JSON.stringify(settings.condition_value)}
                      onChange={e => onChange({ condition_value: parseValue(e.target.value) })} />
                  </Field>
                </div>
                <Field title="When Maximum Reached">
                  <select className={inputClass} disabled={disabled} value={str(settings.on_limit, 'error')}
                    onChange={e => onChange({ on_limit: e.target.value })}>
                    <option value="error">Fail with clear error</option>
                    <option value="complete">Return limit_reached status</option>
                  </select>
                </Field>
              </>
            )}
            <Field title={repeat ? 'Maximum Repeats' : 'Maximum Items'}>
              <input type="number" className={inputClass} disabled={disabled} min={1} max={2000}
                value={num(settings.max_iterations, repeat ? 10 : 20)}
                onChange={e => onChange({ max_iterations: Math.min(2000, Math.max(1, Number(e.target.value) || 1)) })} />
            </Field>
            {!repeat && (
              <Field title="On Item Error">
                <select className={inputClass} disabled={disabled} value={str(settings.error_policy, 'stop')}
                  onChange={e => onChange({ error_policy: e.target.value })}>
                  <option value="stop">Stop entire loop</option>
                  <option value="continue">Continue and report failed items</option>
                </select>
              </Field>
            )}
          </>
        )}

        {!controller && mode !== 'once' && (
          <>
            <Field title="Input Shape">
              <select className={inputClass} disabled={disabled} value={str(settings.execution_input_shape, 'item')}
                onChange={e => onChange({ execution_input_shape: e.target.value })}>
                <option value="item">Unwrap current item</option>
                <option value="collection">Preserve one-item collection</option>
              </select>
            </Field>
            {mode === 'batch' && (
              <Field title="Batch Size">
                <input type="number" min={1} max={200} className={inputClass} disabled={disabled}
                  value={num(settings.execution_batch_size, 10)}
                  onChange={e => onChange({ execution_batch_size: Math.min(200, Math.max(1, Number(e.target.value) || 1)) })} />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Field title="Max Items">
                <input type="number" min={1} max={2000} className={inputClass} disabled={disabled}
                  value={num(settings.execution_max_items, 500)}
                  onChange={e => onChange({ execution_max_items: Math.min(2000, Math.max(1, Number(e.target.value) || 1)) })} />
              </Field>
              <Field title="Parallel Workers">
                <select className={inputClass} disabled={disabled} value={num(settings.execution_parallelism, 1)}
                  onChange={e => onChange({ execution_parallelism: Number(e.target.value) })}>
                  {[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </Field>
            </div>
            <Field title="On Item Error">
              <select className={inputClass} disabled={disabled} value={str(settings.execution_error_policy, 'stop')}
                onChange={e => onChange({ execution_error_policy: e.target.value })}>
                <option value="stop">Stop</option>
                <option value="continue">Continue and collect failures</option>
              </select>
            </Field>
            <Field title="Empty Collection">
              <select className={inputClass} disabled={disabled} value={str(settings.execution_empty_policy, 'stop')}
                onChange={e => onChange({ execution_empty_policy: e.target.value })}>
                <option value="stop">Fail before execution</option>
                <option value="empty">Return an empty result</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" disabled={disabled} checked={settings.execution_flatten === true}
                onChange={e => onChange({ execution_flatten: e.target.checked })} />
              Flatten nested input arrays
            </label>
            {num(settings.execution_parallelism, 1) > 1 && !['ai.gemini', 'ai.openai', 'ai.ollama', 'audio.edge_tts'].includes(nodeType) && (
              <p className="text-xs text-amber-600">This operation does not support parallel workers. Use 1 worker.</p>
            )}
          </>
        )}
      </div>
    </section>
  )
}