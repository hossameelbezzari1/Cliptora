import { useState, type ReactNode } from 'react'
import { ArrowLeft, Braces, CalendarDays, Check, ChevronDown, ChevronRight, Hash, List, Plus, Settings2, Trash2, Type, ToggleLeft, Box as BoxIcon } from 'lucide-react'
import { Button } from '../ui/Button'
import { ContextMenu, type MenuState } from '../ui/ContextMenu'
import { Field, SelectField, SwitchField } from '../ui/Field'

type Category = 'string' | 'number' | 'datetime' | 'boolean' | 'array' | 'object'
type Operand = { mode: 'fixed' | 'expression'; value: string }
type Rule = { id?: string; type: Category; operator: string; left: Operand; right: Operand }
type Props = { settings: Record<string, unknown>; onChange: (key: string, value: unknown) => void }

type Operator = { id: string; label: string; unary?: boolean }
const categories: { id: Category; label: string; icon: ReactNode }[] = [
  { id: 'string', label: 'String', icon: <Type size={17} /> },
  { id: 'number', label: 'Number', icon: <Hash size={17} /> },
  { id: 'datetime', label: 'Date & Time', icon: <CalendarDays size={17} /> },
  { id: 'boolean', label: 'Boolean', icon: <ToggleLeft size={17} /> },
  { id: 'array', label: 'Array', icon: <List size={17} /> },
  { id: 'object', label: 'Object', icon: <BoxIcon size={17} /> },
]
const op = (id: string, label: string, unary = false): Operator => ({ id, label, unary })
const common = [op('truthy', 'is truthy', true), op('exists', 'exists', true), op('not_exists', 'does not exist', true), op('is_empty', 'is empty', true), op('is_not_empty', 'is not empty', true), op('equals', 'is equal to'), op('not_equals', 'is not equal to')]
const options: Record<Category, Operator[]> = {
  string: [...common, op('contains', 'contains'), op('not_contains', 'does not contain'), op('starts_with', 'starts with'), op('ends_with', 'ends with')],
  number: [...common, op('greater_than', 'is greater than'), op('greater_or_equal', 'is greater or equal to'), op('less_than', 'is less than'), op('less_or_equal', 'is less or equal to')],
  datetime: [...common, op('after', 'is after'), op('before', 'is before'), op('after_or_equal', 'is after or equal to'), op('before_or_equal', 'is before or equal to')],
  boolean: [op('truthy', 'is truthy', true), op('exists', 'exists', true), op('not_exists', 'does not exist', true), op('is_true', 'is true', true), op('is_false', 'is false', true), op('equals', 'is equal to'), op('not_equals', 'is not equal to')],
  array: [...common, op('contains', 'contains'), op('not_contains', 'does not contain')],
  object: [...common, op('contains_key', 'contains key')],
}
const unary = new Set(['truthy', 'exists', 'not_exists', 'is_empty', 'is_not_empty', 'is_true', 'is_false'])
const isCategory = (value: unknown): value is Category => categories.some(category => category.id === value)
const asOperand = (value: unknown): Operand => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { mode: 'fixed', value: '' }
  const item = value as Record<string, unknown>
  return { mode: item.mode === 'expression' ? 'expression' : 'fixed', value: String(item.value ?? '') }
}

function initialRules(settings: Record<string, unknown>): Rule[] {
  if (Array.isArray(settings.conditions)) {
    return settings.conditions.map((row, index) => {
      const rule = row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : {}
      const category = isCategory(rule.type) ? rule.type : 'string'
      return { id: typeof rule.id === 'string' ? rule.id : `rule-${index}`, type: category, operator: options[category].some(option => option.id === rule.operator) ? String(rule.operator) : 'equals', left: asOperand(rule.left), right: asOperand(rule.right) }
    })
  }
  const oldPath = typeof settings.path === 'string' ? settings.path : ''
  const oldOperator = String(settings.operator ?? 'truthy')
  // Old rules are converted to the new model when the user first edits a field.
  const compatible = ['truthy', 'exists', 'equals', 'not_equals', 'contains', 'greater_than', 'less_than'].includes(oldOperator)
  const type: Category = ['greater_than', 'less_than'].includes(oldOperator) ? 'number' : 'string'
  return [{ id: 'rule-0', type, operator: compatible ? oldOperator : 'truthy', left: { mode: 'expression', value: oldPath ? `{{ ${oldPath} }}` : '' }, right: { mode: 'fixed', value: String(settings.value ?? '') } }]
}

function OperandInput({ label, operand, onChange, type }: { label: string; operand: Operand; onChange: (value: Operand) => void; type: Category }) {
  return <div className="min-w-0 space-y-1.5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[11px] font-medium text-[#777]">{label}</span>
      <div className="inline-flex rounded-md bg-[#f1f1f1] p-[2px]" aria-label={`${label} mode`}>
        {(['fixed', 'expression'] as const).map(mode => <button key={mode} type="button" aria-pressed={operand.mode === mode} onClick={() => onChange({ ...operand, mode })} className={`rounded px-2 py-1 text-[10px] font-medium ${operand.mode === mode ? 'bg-white text-[#222] shadow-sm' : 'text-[#777] hover:text-[#333]'}`}>{mode === 'fixed' ? 'Fixed' : 'Expression'}</button>)}
      </div>
    </div>
    <div className="relative">
      {operand.mode === 'expression' && <Braces size={16} className="pointer-events-none absolute left-3 top-3.5 text-violet-600" />}
      <Field appearance="light" label={label} hideLabel aria-label={label} value={operand.value} onChange={event => onChange({ ...operand, value: event.target.value })}
        placeholder={operand.mode === 'expression' ? '{{ $json.probe.duration }}' : label === 'value1' ? 'value1' : type === 'boolean' ? 'true / false' : type === 'array' ? '["item"]' : type === 'object' ? '{"key":"value"}' : 'value2'}
        className={operand.mode === 'expression' ? 'pl-9 font-mono text-[12px]' : ''} />
    </div>
  </div>
}

function CategoryOperatorMenu({ menu, onClose, category, onCategory, onSelect, selected }: {
  menu: MenuState; onClose: () => void; category: Category; onCategory: (category: Category) => void; onSelect: (category: Category, operator: string) => void; selected: string
}) {
  const content = <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-1 text-[12px]">
    <div className="min-w-0 border-r border-[#eeeeee] pr-1">
      {categories.map(item => <button type="button" role="menuitem" key={item.id} onClick={() => onCategory(item.id)} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left ${category === item.id ? 'bg-[#f2f2f2] font-medium' : 'hover:bg-[#f7f7f7]'}`}>
        <span className="text-[#777]">{item.icon}</span><span className="min-w-0 flex-1 truncate">{item.label}</span><ChevronRight size={14} className="text-[#aaa]" />
      </button>)}
    </div>
    <div className="max-h-[360px] min-w-0 overflow-y-auto pl-1">
      {options[category].map(item => <button type="button" role="menuitem" key={item.id} onClick={() => onSelect(category, item.id)} className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-[#f4f4f4] ${selected === item.id ? 'bg-[#f6f2ff] text-[#6843be]' : ''}`}>
        <span>{item.label}</span>{selected === item.id && <Check size={14} />}
      </button>)}
    </div>
  </div>
  return <ContextMenu menu={menu ? { ...menu, actions: [{ label: 'Operators', content }] } : null} onClose={onClose} width={490} appearance="light" />
}

export function WorkflowIfParameters({ settings, onChange }: Props) {
  const [operatorMenu, setOperatorMenu] = useState<{ row: number; x: number; y: number; category: Category } | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const rows = initialRules(settings)
  const combine = settings.combine === 'any' ? 'any' : 'all'
  const convert = settings.convert_types === true
  const ignoreCase = settings.ignore_case === true

  const save = (next: Rule[]) => onChange('conditions', next.map(row => ({ type: row.type, operator: row.operator, left: row.left, right: row.right })))
  const patch = (index: number, changes: Partial<Rule>) => save(rows.map((row, i) => i === index ? { ...row, ...changes } : row))
  const changeOperator = (index: number, type: Category, operator: string) => { patch(index, { type, operator }); setOperatorMenu(null) }
  const addRule = () => { if (rows.length < 25) save([...rows, { type: 'string', operator: 'equals', left: { mode: 'expression', value: '' }, right: { mode: 'fixed', value: '' } }]) }

  return <div className="space-y-6 text-[#292929]">
    <section className="space-y-3">
      <div className="border-b border-[#e5e5e5] pb-2 text-[14px] font-semibold">Conditions</div>
      {rows.map((row, index) => {
        const selectedOperator = options[row.type].find(item => item.id === row.operator)
        return <div key={row.id ?? index} className="space-y-2">
          {index > 0 && <div className="flex justify-center py-1"><span className="rounded-full border border-[#e2e2e2] bg-[#f8f8f8] px-4 py-1 text-[11px] font-semibold text-[#777]">{combine === 'all' ? 'AND' : 'OR'}</span></div>}
          <div className="rounded-xl border border-[#e2e2e2] bg-white p-3 shadow-[0_1px_2px_#00000008]">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(160px,0.75fr)_auto] sm:items-end">
              <OperandInput label="value1" operand={row.left} type={row.type} onChange={left => patch(index, { left })} />
              <div className="min-w-0 space-y-1.5">
                <span className="text-[11px] font-medium text-[#777]">Operator</span>
                <button type="button" aria-label={`Condition ${index + 1} operator`} aria-haspopup="menu" aria-expanded={operatorMenu?.row === index} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setOperatorMenu({ row: index, category: row.type, x: rect.left, y: rect.bottom + 5 }) }} className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-[#dedede] bg-[#f9f9f9] px-2.5 text-left text-[12px] text-[#3f3f3f] hover:bg-[#f1f1f1]">
                  <span className="text-[11px] text-[#888]">{categories.find(cat => cat.id === row.type)?.icon}</span><span className="min-w-0 flex-1 truncate">{selectedOperator?.label ?? row.operator}</span><ChevronDown size={15} />
                </button>
              </div>
              <button type="button" title={rows.length > 1 ? 'Remove condition' : 'Clear condition'} aria-label="Remove condition" onClick={() => rows.length > 1 ? save(rows.filter((_, i) => i !== index)) : save([{ type: 'string', operator: 'equals', left: { mode: 'expression', value: '' }, right: { mode: 'fixed', value: '' } }])} className="mb-[2px] grid size-9 place-items-center rounded-full text-[#999] hover:bg-red-50 hover:text-red-600"><Trash2 size={17}/></button>
            </div>
            {!unary.has(row.operator) && <div className="mt-3"><OperandInput label="value2" operand={row.right} type={row.type} onChange={right => patch(index, { right })}/></div>}
          </div>
        </div>
      })}
      <div className="flex flex-wrap items-center gap-3">
        <Button appearance="light" variant="primary" icon={<Plus size={18}/>} disabled={rows.length >= 25} onClick={addRule} className="rounded-full">Add condition</Button>
        {rows.length > 1 && <div className="min-w-[155px]"><SelectField appearance="light" label="Combine conditions" value={combine} onChange={event => onChange('combine', event.target.value)}><option value="all">Match all (AND)</option><option value="any">Match any (OR)</option></SelectField></div>}
      </div>
    </section>
    <SwitchField label="Convert types where required" checked={convert} onChange={value => onChange('convert_types', value)} description="Convert text into numbers, booleans and JSON values when needed" />
    <section className="space-y-3">
      <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-2"><span className="text-[14px] font-semibold">Options</span><button type="button" aria-label="Toggle options" aria-expanded={optionsOpen} className="rounded-md p-1 hover:bg-[#f4f4f4]" onClick={() => setOptionsOpen(value => !value)}><Plus size={21}/></button></div>
      {optionsOpen ? <div className="space-y-3 rounded-lg bg-[#fafafa] p-3"><SwitchField label="Ignore case" checked={ignoreCase} onChange={value => onChange('ignore_case', value)} description="Applies to string comparisons"/><p className="text-[11px] leading-4 text-[#888]">Expressions only resolve upstream JSON paths. Arbitrary JavaScript execution is disabled.</p><Button appearance="light" variant="ghost" icon={<ArrowLeft size={14}/>} className="min-h-8 text-xs" onClick={() => setOptionsOpen(false)}>Close options</Button></div>
        : <Button appearance="light" variant="primary" icon={<Plus size={16}/>} className="min-h-9 rounded-full text-xs" onClick={() => setOptionsOpen(true)}>Add option</Button>}
    </section>
    <div className="flex items-start gap-2 rounded-lg bg-[#f8f7fc] p-3 text-[11px] leading-5 text-[#706c7b]"><Settings2 size={16} className="mt-0.5 shrink-0" />Use expressions like <code className="rounded bg-white px-1 font-mono">{'{{ $json.probe.duration }}'}</code> to read data from the previous node. You can also target an explicit node: <code className="rounded bg-white px-1 font-mono">{'{{ probe.probe.width }}'}</code>.</div>
    <CategoryOperatorMenu menu={operatorMenu ? { x: operatorMenu.x, y: operatorMenu.y, actions: [] } : null} onClose={() => setOperatorMenu(null)} category={operatorMenu?.category ?? 'string'} onCategory={category => setOperatorMenu(value => value ? { ...value, category } : value)} onSelect={(category, operator) => { if (operatorMenu) changeOperator(operatorMenu.row, category, operator) }} selected={operatorMenu ? rows[operatorMenu.row]?.operator ?? '' : ''} />
  </div>
}
