import { evaluateExpression, interpolateVariables } from '../../../lib/variables'
import { SavedLibraryItems } from './SavedLibraryItems'
import { buttonClass, fieldClass, variableTypes, type SmartLibraryModel } from './useSmartLibrary'
import type { VariableType } from '../../../lib/variables'

export function VariablesTab({ library }: { library: SmartLibraryModel }) {
  const { name, setName, varType, setVarType, value, setValue, expression, setExpression, busy, vars, context, save } = library
  return <>
    <p className="mb-2 text-[#9ea5ae]">Typed global values, stored in MySQL. Expressions accept now(), today(), durations and references.</p>
    <input className={`${fieldClass} mb-2 w-full`} value={name} placeholder="variable name e.g. brand_color"
      onChange={event => setName(event.target.value)}/>
    <select className={`${fieldClass} mb-2 w-full`} value={varType}
      onChange={event => setVarType(event.target.value as VariableType)}>
      {variableTypes.map(type => <option key={type} value={type}>{type}</option>)}
    </select>
    <input className={`${fieldClass} mb-2 w-full`} value={value} placeholder="Value"
      onChange={event => setValue(event.target.value)}/>
    <button type="button" className={buttonClass} disabled={busy || !/^[_a-zA-Z][\w.]*$/.test(name)}
      onClick={() => void save('variable', name, {
        type: varType, value: varType === 'number' ? Number(value) : varType === 'boolean' ? value === 'true' : value,
      })}>Save global variable</button>
    <label className="mb-1 mt-4 block text-[#9ea5ae]" htmlFor="cl-variable-expression">Expression preview</label>
    <input id="cl-variable-expression" className={`${fieldClass} w-full`} value={expression}
      onChange={event => setExpression(event.target.value)}/>
    <p className="mt-2 break-all rounded bg-[#20242b] p-2">{interpolateVariables(expression, vars, context)}</p>
    <p className="mt-2 text-[#8f98a6]">Example: {'{{now() + 1h}}'} → {String(evaluateExpression('now() + 1h', vars, context))}</p>
    <SavedLibraryItems library={library} kind="variable" canApply={false}/>
  </>
}
